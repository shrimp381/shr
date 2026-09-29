/**
 * Ablated Armour, Shields, Magic Armour recovery, Repair and Maintenance.
 *
 * Ablation lowers the item's own `system.armor.value`, so every sheet, HUD and AC
 * calculation sees the damaged value with no extra wiring. The undamaged value is kept
 * in the item flag `baseAC` so repairs and recovery know where to stop.
 */
import {
  MODULE_ID, REPAIR, MENDING_LIMIT, MAGIC_RECOVERY, ABLATION_IMMUNE_BONUS, BODY_ARMOUR_TYPES, recoveryStep
} from "./constants.js";
import { setting, t, tf } from "./settings.js";
import { postCard, esc } from "./chat.js";

const cfg = () => CONFIG.CRUCIBLE;

/* -------------------------------------------- */
/*  Queries                                     */
/* -------------------------------------------- */

export const isShield = item => item?.type === "equipment" && item.system?.type?.value === "shield";
export const isBodyArmour = item => item?.type === "equipment" && BODY_ARMOUR_TYPES.includes(item.system?.type?.value);
export const isArmourPiece = item => isShield(item) || isBodyArmour(item);

export const currentAC = item => Number(item.system?.armor?.value ?? 0) || 0;
export const baseAC = item => Math.max(Number(item.getFlag(MODULE_ID, "baseAC") ?? 0) || 0, currentAC(item));
export const lostAC = item => Math.max(0, baseAC(item) - currentAC(item));
export const magicBonus = item => Number(item.system?.armor?.magicalBonus ?? 0) || 0;
export const isMagical = item => magicBonus(item) > 0 || !!item.system?.properties?.has?.("mgc");
export const isImmune = item => magicBonus(item) >= ABLATION_IMMUNE_BONUS;

/** AC regained per day for magic armour (0 for mundane or immune pieces). */
export function recoveryRate(item) {
  if (!isMagical(item) || isImmune(item)) return 0;
  const table = cfg()?.MAGIC_RECOVERY ?? MAGIC_RECOVERY;
  return table[Math.min(magicBonus(item), table.length - 1)] ?? 0;
}

export const equippedShield = actor => actor.items.find(i => isShield(i) && i.system.equipped) ?? null;
/** A shield only counts while it still gives AC. */
export function activeShield(actor) {
  const shield = equippedShield(actor);
  return shield && currentAC(shield) > 0 ? shield : null;
}
export const equippedArmour = actor => actor.items.filter(i => isBodyArmour(i) && i.system.equipped);

/** "natural" | "unarmored" | null — creatures that never lose AC. */
export function exemption(actor) {
  const calc = actor.system?.attributes?.ac?.calc;
  return (cfg()?.EXEMPT_AC_CALCS ?? {})[calc] ?? null;
}

/* -------------------------------------------- */
/*  Ablation                                    */
/* -------------------------------------------- */

/**
 * Take AC off a creature's armour. Shields go first.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {number} [options.amount=1]
 * @param {boolean} [options.shieldOnly=false]  Shield Block: only the shield, and ignore exemptions
 * @returns {Promise<{piece?:Item|null, name?:string, lost:number, remaining?:number, base?:number, broken?:boolean, skipped?:string}>}
 */
export async function ablate(actor, { amount = 1, shieldOnly = false } = {}) {
  if (!shieldOnly) {
    const exempt = exemption(actor);
    if (exempt) return { lost: 0, skipped: exempt };
  }

  let piece = activeShield(actor);
  if (!piece && !shieldOnly) {
    piece = equippedArmour(actor).filter(i => currentAC(i) > 0).sort((a, b) => currentAC(b) - currentAC(a))[0] ?? null;
  }

  if (!piece) {
    if (shieldOnly) return { lost: 0, skipped: "noShield" };
    const flat = actor.system?.attributes?.ac?.calc === "flat";
    if (actor.type === "npc" && flat && !equippedArmour(actor).length && setting("npcFlatAblation")) return ablateFlat(actor, amount);
    return { lost: 0, skipped: "noArmour" };
  }

  if (isImmune(piece)) return { piece, name: piece.name, lost: 0, skipped: "immune" };

  const base = baseAC(piece);
  const current = currentAC(piece);
  const remaining = Math.max(0, current - amount);
  const broken = isShield(piece) && remaining === 0;
  await piece.update({
    "system.armor.value": remaining,
    [`flags.${MODULE_ID}.baseAC`]: base,
    [`flags.${MODULE_ID}.broken`]: broken
  }, { cwInternal: true });
  return { piece, name: piece.name, lost: current - remaining, remaining, base, broken };
}

/** NPCs with a flat stat-block AC and no armour items: a stacking -1 AC effect. */
async function ablateFlat(actor, amount) {
  const existing = actor.effects.find(e => e.getFlag(MODULE_ID, "flatAblation"));
  const lost = (existing?.getFlag(MODULE_ID, "flatAblation") ?? 0) + amount;
  const data = {
    name: t("Armour.FlatEffect"),
    img: "icons/svg/downgrade.svg",
    changes: [{ key: "system.attributes.ac.flat", mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: String(-lost) }],
    flags: { [MODULE_ID]: { flatAblation: lost } }
  };
  if (existing) await existing.update(data, { cwInternal: true });
  else await actor.createEmbeddedDocuments("ActiveEffect", [data], { cwInternal: true });
  return { piece: null, name: t("Armour.StatBlock"), lost: amount, remaining: null, flat: lost };
}

/** One-line description of an ablation result for chat. */
export function ablationLine(result, reason) {
  const why = t(`Armour.Reason.${reason}`);
  if (result.skipped === "natural") return tf("Armour.Line.Natural", { why });
  if (result.skipped === "unarmored") return tf("Armour.Line.Unarmored", { why });
  if (result.skipped === "immune") return tf("Armour.Line.Immune", { why, name: esc(result.name) });
  if (result.skipped) return tf("Armour.Line.None", { why });
  if (result.flat) return tf("Armour.Line.Flat", { why, n: result.flat });
  const line = tf("Armour.Line.Ablated", { why, name: esc(result.name), from: result.remaining + result.lost, to: result.remaining });
  return result.broken ? `${line} <strong>${t("Armour.Line.Broken")}</strong>` : line;
}

/* -------------------------------------------- */
/*  Repair                                      */
/* -------------------------------------------- */

/** Repair details for the tracker and the repair dialog. */
export function repairInfo(item) {
  const type = item.system?.type?.value;
  const info = (cfg()?.REPAIR ?? REPAIR)[type];
  const lost = lostAC(item);
  return {
    lost,
    cost: info?.cost ?? 0,
    tools: (info?.tools ?? []).map(k => t(`Armour.Tool.${k}`)).join(" + "),
    mending: lost > 0 && lost < (cfg()?.MENDING_LIMIT ?? MENDING_LIMIT),
    price: Number(item.system?.price?.value ?? 0) || 0
  };
}

/**
 * Restore a piece of armour to its full AC.
 * @param {Item} item
 * @param {"craftsman"|"party"|"mending"|"replace"} method
 * @param {object} [options]
 * @param {boolean} [options.pay=false]  deduct the gold from the owner
 */
export async function repairItem(item, method, { pay = false } = {}) {
  const actor = item.actor;
  const info = repairInfo(item);
  if (!info.lost) return ui.notifications.info(t("Notify.NothingToRepair"));
  if (isShield(item) && method !== "replace") return ui.notifications.warn(t("Notify.ShieldNoRepair"));
  if (method === "mending" && !info.mending) return ui.notifications.warn(t("Notify.MendingLimit"));

  const cost = method === "craftsman" ? info.cost : method === "replace" ? info.price : 0;
  if (pay && cost && actor) {
    const gp = Number(actor.system.currency?.gp ?? 0);
    if (gp < cost) return ui.notifications.warn(tf("Notify.NotEnoughGold", { cost }));
    await actor.update({ "system.currency.gp": gp - cost }, { cwInternal: true });
  }

  await item.update({
    "system.armor.value": baseAC(item),
    [`flags.${MODULE_ID}.broken`]: false,
    [`flags.${MODULE_ID}.recovery`]: 0
  }, { cwInternal: true });

  if (actor) {
    const line = tf(`Armour.Repair.${method}`, { name: esc(item.name), ac: baseAC(item), cost, tools: info.tools });
    await postCard(actor, { title: t("Armour.Repair.Title"), icon: "fa-solid fa-hammer", lines: [line + (pay && cost ? ` ${tf("Armour.Repair.Paid", { cost })}` : "")] });
  }
}

/* -------------------------------------------- */
/*  Magic armour recovery                       */
/* -------------------------------------------- */

/** Recover AC on one actor's magic armour. Returns chat lines for pieces that improved. */
export async function recoverMagic(actor, days) {
  const updates = [];
  const lines = [];
  for (const item of actor.items) {
    if (!isArmourPiece(item)) continue;
    const lost = lostAC(item);
    const rate = recoveryRate(item);
    if (!lost || !rate) continue;
    const { gain, progress } = recoveryStep({ lost, rate, progress: item.getFlag(MODULE_ID, "recovery") ?? 0, days });
    const update = { _id: item.id, [`flags.${MODULE_ID}.recovery`]: progress };
    if (gain) {
      update["system.armor.value"] = currentAC(item) + gain;
      update[`flags.${MODULE_ID}.broken`] = false;
      lines.push(tf("Armour.Recovered", { name: esc(item.name), n: gain, ac: currentAC(item) + gain, base: baseAC(item) }));
    }
    updates.push(update);
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates, { cwInternal: true });
  return lines;
}

/** GM: advance magic armour recovery for every actor (world actors + unlinked tokens on the viewed scene). */
export async function advanceDays(days = 1) {
  if (!game.user.isGM) return ui.notifications.warn(t("Notify.GMOnly"));
  const actors = new Set(game.actors.contents);
  for (const token of canvas?.scene?.tokens ?? []) if (!token.actorLink && token.actor) actors.add(token.actor);
  for (const actor of actors) {
    const lines = await recoverMagic(actor, days);
    if (lines.length) await postCard(actor, { title: t("Armour.RecoveryTitle"), icon: "fa-solid fa-wand-sparkles", lines });
  }
}
