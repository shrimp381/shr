/**
 * Wounds and Injuries: rolling, storing, effects, treatment.
 *
 * Storage (actor flags, namespaced under the module id):
 *   wounds           Array<Wound>   the source of truth
 *   woundCount       number         wounds that count toward the 2d6 subtraction
 *   pendingPermanent {id, dc, damage} | null   a permanent-wound Con save waiting to be rolled
 *
 * Each wound owns one Active Effect (flag `woundId`), rebuilt from the list by
 * syncWoundEffects() so the flag list and the effects never drift apart.
 *
 * @typedef {object} Wound
 * @property {string} id
 * @property {string} key          a WOUNDS key, or "custom"
 * @property {string|null} name    the wound's name when it was gained (from the table result)
 * @property {string} [text]       its text when it was gained
 * @property {object} [auto]       the automation it was gained with (table result setting); absent = the built-in one
 * @property {boolean} permanent
 * @property {boolean} suppressed  subdued until the next rest (potion, grit and bear it)
 * @property {string} source       "roll" | "manual"
 * @property {number|null} result  table result that produced it
 * @property {number} [hpReduction] Internal Bleeding: HP max lost
 * @property {string} note
 */
import { MODULE_ID, resolveResult, instanceIndex, specFromDef, normalizeAuto } from "./constants.js";
import { keyName } from "./tables.js";
import { setting, t, tf } from "./settings.js";
import { postCard, esc } from "./chat.js";

const defs = () => CONFIG.SHR.WOUNDS;
const tables = () => CONFIG.SHR.TABLES;

/* -------------------------------------------- */
/*  Reading                                     */
/* -------------------------------------------- */

export function getWounds(actor) {
  return foundry.utils.deepClone(actor.getFlag(MODULE_ID, "wounds") ?? []);
}

/** Wounds that count toward the 2d6 subtraction (the "wound penalty"). */
export function woundCount(actor, wounds = getWounds(actor)) {
  const countPermanent = setting("countPermanent");
  return wounds.filter(w => countPermanent || !w.permanent).length;
}

export function woundName(wound) {
  return wound.name || (defs()[wound.key] ? keyName(wound.key) : "") || t("Wound.Custom");
}

export function woundText(wound) {
  return wound.text || defs()[wound.key]?.text || (defs()[wound.key] ? "" : wound.note) || "";
}

/** What a wound does: the automation it was gained with, else its definition's. */
const specFor = wound => (wound.auto ? normalizeAuto(wound.auto) : specFromDef(defs()[wound.key]));

export const isWoundable = actor => actor?.type === "character" || (actor?.type === "npc" && setting("woundsNpc"));

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

async function saveWounds(actor, wounds) {
  await actor.update({
    [`flags.${MODULE_ID}.wounds`]: wounds,
    [`flags.${MODULE_ID}.woundCount`]: woundCount(actor, wounds)
  }, { shrInternal: true });
  await syncWoundEffects(actor);
}

/**
 * Add a wound.
 * @param {Actor} actor
 * @param {string} key                 WOUNDS key or "custom"
 * @param {object} [options]
 * @param {string} [options.name]      the name to record (custom wounds; table rolls record the result's name)
 * @param {string} [options.text]      the text to record
 * @param {object} [options.auto]      automation from the table result (conditions, effects)
 * @param {boolean} [options.permanent] custom wounds
 * @param {string} [options.note]
 * @param {string} [options.source="manual"]
 * @param {number} [options.result]
 * @param {boolean} [options.immediate=true]  apply one-off effects (exhaustion, Close Call, Fatal Wound)
 * @param {boolean} [options.force=false]     allow a duplicate non-repeatable wound
 */
export async function addWound(actor, key, options = {}) {
  const def = defs()[key];
  const wounds = getWounds(actor);
  if (def && !def.repeatable && !options.force && wounds.some(w => w.key === key)) {
    ui.notifications.warn(tf("Notify.AlreadyHas", { name: keyName(key) }));
    return null;
  }
  const wound = {
    id: foundry.utils.randomID(),
    key: def ? key : "custom",
    name: options.name || (def ? null : t("Wound.Custom")),
    text: options.text || undefined,
    auto: options.auto ? normalizeAuto(options.auto) : undefined,
    permanent: def ? !!def.permanent : !!options.permanent,
    suppressed: false,
    source: options.source ?? "manual",
    result: options.result ?? null,
    note: options.note ?? "",
    created: Date.now()
  };
  const spec = specFor(wound);
  if (spec.halveHp) {
    const hp = actor.system.attributes.hp;
    const max = hp.effectiveMax ?? (hp.max + (hp.tempmax ?? 0));
    wound.hpReduction = Math.floor(max / 2);
  }
  wounds.push(wound);
  await saveWounds(actor, wounds);
  if (spec.halveHp) {
    const hp = actor.system.attributes.hp;
    const max = hp.effectiveMax ?? hp.max;
    if (hp.value > max) await actor.update({ "system.attributes.hp.value": max }, { shrInternal: true });
  }
  if (options.immediate !== false) await onGain(actor, spec);
  return wound;
}

export async function removeWound(actor, id) {
  const wounds = getWounds(actor).filter(w => w.id !== id);
  await saveWounds(actor, wounds);
}

export async function setSuppressed(actor, id, suppressed) {
  const wounds = getWounds(actor);
  const wound = wounds.find(w => w.id === id);
  if (!wound) return;
  wound.suppressed = !!suppressed;
  await saveWounds(actor, wounds);
}

/** One-off effects when a wound is gained. */
async function onGain(actor, spec) {
  if (spec.exhaustion) await changeExhaustion(actor, spec.exhaustion);
  if (spec.closeCall) {
    if ((actor.system.attributes.hp.value ?? 0) <= 0) {
      await actor.update({
        "system.attributes.hp.value": 1,
        "system.attributes.death.success": 0,
        "system.attributes.death.failure": 0
      }, { shrInternal: true });
      if (actor.statuses?.has("unconscious")) await actor.toggleStatusEffect("unconscious", { active: false });
    }
    await actor.toggleStatusEffect("prone", { active: true });
  } else if (spec.prone) {
    await actor.toggleStatusEffect("prone", { active: true });
  }
  if (spec.fatal) {
    await actor.update({
      "system.attributes.hp.value": 0,
      "system.attributes.death.failure": 3
    }, { shrInternal: true });
    await actor.toggleStatusEffect("dead", { active: true, overlay: true });
  }
}

export async function changeExhaustion(actor, delta) {
  const current = Number(actor.system.attributes?.exhaustion ?? 0) || 0;
  const max = CONFIG.DND5E?.conditionTypes?.exhaustion?.levels ?? 6;
  const next = Math.clamp(current + delta, 0, max);
  if (next !== current) await actor.update({ "system.attributes.exhaustion": next }, { shrInternal: true });
  return next;
}

/* -------------------------------------------- */
/*  Active Effects                              */
/* -------------------------------------------- */

function effectData(actor, wound, index) {
  const def = defs()[wound.key];
  const spec = specFor(wound);
  const M = CONST.ACTIVE_EFFECT_MODES;
  const statuses = [...spec.statuses];
  const changes = [];
  if (spec.halveHp && wound.hpReduction) {
    changes.push({ key: "system.attributes.hp.tempmax", mode: M.ADD, value: String(-wound.hpReduction) });
  }
  if (spec.speed) {
    changes.push(index === 0
      ? { key: "system.attributes.movement.walk", mode: M.MULTIPLY, value: "0.5" }
      : { key: "system.attributes.movement.walk", mode: M.OVERRIDE, value: "0", priority: 60 });
  }
  if (spec.initiative) changes.push({ key: "system.attributes.init.roll.mode", mode: M.ADD, value: "-1" });
  for (const skill of spec.skills) changes.push({ key: `system.skills.${skill}.roll.mode`, mode: M.ADD, value: "-1" });
  if (index >= 1) statuses.push(...spec.escalate.filter(s => !statuses.includes(s)));

  const kind = wound.permanent ? t("Tracker.Permanent") : t("Tracker.Temporary");
  return {
    name: `${woundName(wound)}${index ? ` (${index + 1})` : ""}`,
    img: def?.img ?? "icons/svg/blood.svg",
    description: `<p><em>${kind}.</em> ${esc(woundText(wound))}</p>${wound.note && def ? `<p>${esc(wound.note)}</p>` : ""}`,
    origin: actor.uuid,
    disabled: !!wound.suppressed,
    statuses,
    changes,
    flags: { [MODULE_ID]: { woundId: wound.id } }
  };
}

const effectSignature = d => JSON.stringify([d.name, d.disabled, [...(d.statuses ?? [])].sort(), d.changes.map(c => [c.key, c.mode, String(c.value)])]);

/** Make the actor's wound effects match the wound list. */
export async function syncWoundEffects(actor) {
  const wounds = getWounds(actor);
  const existing = new Map();
  for (const effect of actor.effects) {
    const id = effect.getFlag(MODULE_ID, "woundId");
    if (id) existing.set(id, effect);
  }
  const create = [];
  const update = [];
  wounds.forEach((wound, i) => {
    const data = effectData(actor, wound, instanceIndex(wounds, i));
    const effect = existing.get(wound.id);
    existing.delete(wound.id);
    if (!effect) return create.push(data);
    const current = { name: effect.name, disabled: effect.disabled, statuses: [...(effect.statuses ?? [])], changes: effect.changes ?? [] };
    if (effectSignature(current) !== effectSignature(data)) update.push({ _id: effect.id, ...data });
  });
  const remove = [...existing.values()].map(e => e.id);
  if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove, { shrInternal: true });
  if (update.length) await actor.updateEmbeddedDocuments("ActiveEffect", update, { shrInternal: true });
  if (create.length) await actor.createEmbeddedDocuments("ActiveEffect", create, { shrInternal: true });
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

const ownedKeys = wounds => new Set(wounds.map(w => w.key));
const resolve = (table, value, wounds) => resolveResult(table, value, ownedKeys(wounds), defs(), tables());

/** The wound table this creature rolls on: NPCs have their own. */
export const woundTable = actor => (actor?.type === "npc" ? "npc" : "main");

function skippedText(table, skipped) {
  if (!skipped.length) return "";
  const results = tables()[table].results;
  const names = skipped.map(r => `${r} (${keyName(results[r])})`).join(", ");
  return tf("Roll.Skipped", { list: names });
}

/** Name, text and automation of a table result, recorded on the wound so later table edits don't rewrite it. */
function entryOptions(table, result) {
  const entry = tables()[table]?.entries?.[result];
  return entry ? { name: entry.name, text: entry.text, auto: entry.auto ?? undefined } : {};
}

function woundLine(wound, result) {
  return `<div class="shr-card-wound ${wound.permanent ? "perm" : ""}"><strong>${result ?? ""}${result != null ? " · " : ""}${esc(woundName(wound))}</strong><p>${esc(woundText(wound))}</p></div>`;
}

/**
 * NPC rolled 2 or less: "Permanent Wound ... (Reroll if not a significant NPC)".
 * The npcPermanent setting decides: always apply, always reroll, or ask the GM.
 */
async function npcTakesPermanent(actor) {
  const mode = setting("npcPermanent");
  if (mode === "always") return true;
  if (mode === "reroll") return false;
  return !!(await foundry.applications.api.DialogV2.confirm({
    window: { title: t("Dialog.NpcPermanentTitle"), icon: "fa-solid fa-skull" },
    content: `<div class="shr-dialog"><p>${tf("Dialog.NpcPermanentBody", { name: esc(actor.name) })}</p></div>`,
    yes: { label: t("Dialog.NpcPermanentYes") },
    no: { label: t("Dialog.NpcPermanentNo") },
    rejectClose: false
  }));
}

/**
 * Roll on the Wounds and Injuries table (the NPC table for NPCs).
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string} [options.reason="manual"]   "zero" | "massive" | "manual"
 * @param {number} [options.damage=0]          damage taken (sets the permanent-wound save DC)
 * @param {string[]} [options.lines=[]]        extra chat lines to lead the card with
 */
export async function rollWound(actor, { reason = "manual", damage = 0, lines = [] } = {}) {
  const wounds = getWounds(actor);
  const count = woundCount(actor, wounds);
  const table = woundTable(actor);
  const rolls = [];
  const card = [...lines];

  let res;
  for (let attempt = 0; ; attempt++) {
    const roll = await new Roll(tables()[table].die).evaluate();
    rolls.push(roll);
    const value = roll.total - count;
    res = resolve(table, value, wounds);
    card.push(attempt
      ? tf("Roll.Reroll", { roll: roll.total, count, value })
      : tf("Roll.Main", { reason: t(`Roll.Reason.${reason}`), roll: roll.total, count, value }));
    const skipped = skippedText(table, res.skipped);
    if (skipped) card.push(skipped);
    if (!res.permanent || table !== "npc") break;
    if (await npcTakesPermanent(actor)) break;
    card.push(t("Roll.NpcRerolled"));
    if (attempt >= 9) {
      // Ten rerolls in a row all landed on a permanent wound: take the best result left.
      res = resolve(table, tables()[table].max, wounds);
      card.push(t("Roll.NpcRerollLimit"));
      break;
    }
  }

  if (res.permanent) {
    if (table === "npc") {
      card.push(`<strong>${t("Roll.NpcPermanent")}</strong>`);
      return rollPermanent(actor, { lines: card, rolls });
    }
    if (!setting("permanentSave")) {
      // As on the Wounds & Injuries table: roll on the Permanent Wound table and apply the result.
      card.push(`<strong>${t("Roll.PermanentDirect")}</strong>`);
      return rollPermanent(actor, { lines: card, rolls });
    }
    const dc = Math.max(1, Math.floor(damage / 2));
    const id = foundry.utils.randomID();
    await actor.setFlag(MODULE_ID, "pendingPermanent", { id, dc, damage });
    card.push(`<strong>${t("Roll.PermanentTriggered")}</strong>`);
    const body = `<button type="button" class="shr-card-button" data-shr-chat="permSave" data-actor-uuid="${actor.uuid}" data-pending-id="${id}">
      <i class="fa-solid fa-shield-heart"></i> ${tf("Roll.PermanentSave", { dc })}</button>`;
    await postCard(actor, { title: tf("Roll.Title", { name: esc(actor.name) }), lines: card, rolls, body });
    return { permanent: true, dc, roll: rolls.at(-1) };
  }

  const wound = await addWound(actor, res.key, { source: "roll", result: res.result, force: true, ...entryOptions(table, res.result) });
  await postCard(actor, { title: tf("Roll.Title", { name: esc(actor.name) }), lines: card, rolls, body: woundLine(wound, res.result) });
  return { wound, roll: rolls.at(-1) };
}

/** Roll the Constitution save for a pending permanent wound, then the 1d6 table on a failure. */
export async function resolvePermanent(actor, pendingId) {
  const pending = actor.getFlag(MODULE_ID, "pendingPermanent");
  if (!pending || (pendingId && pending.id !== pendingId)) return ui.notifications.info(t("Notify.AlreadyResolved"));
  await actor.unsetFlag(MODULE_ID, "pendingPermanent");

  let rolls;
  try {
    rolls = await actor.rollSavingThrow({ ability: "con", target: pending.dc });
  } catch (err) {
    await actor.setFlag(MODULE_ID, "pendingPermanent", pending);
    throw err;
  }
  const save = Array.isArray(rolls) ? rolls[0] : rolls;
  if (!save) {
    // Dialog cancelled — keep it pending.
    await actor.setFlag(MODULE_ID, "pendingPermanent", pending);
    return;
  }
  if (save.total >= pending.dc) {
    await postCard(actor, {
      title: tf("Roll.PermanentTitle", { name: esc(actor.name) }), icon: "fa-solid fa-shield-heart",
      lines: [tf("Roll.PermanentSaved", { total: save.total, dc: pending.dc })]
    });
    return { saved: true };
  }
  return rollPermanent(actor, { lines: [tf("Roll.PermanentFailed", { total: save.total, dc: pending.dc })] });
}

/**
 * Roll 1d6 on the Permanent Wound table.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string[]} [options.lines]   chat lines to lead the card with
 * @param {Roll[]} [options.rolls]     earlier rolls to show on the same card
 */
export async function rollPermanent(actor, { lines = [], rolls: earlier = [] } = {}) {
  const wounds = getWounds(actor);
  const roll = await new Roll(tables().permanent.die).evaluate();
  const res = resolve("permanent", roll.total, wounds);
  const card = [...lines, tf("Roll.Permanent", { roll: roll.total })];
  const skipped = skippedText("permanent", res.skipped);
  if (skipped) card.push(skipped);
  const wound = await addWound(actor, res.key, { source: "roll", result: res.result, force: true, ...entryOptions("permanent", res.result) });
  await postCard(actor, { title: tf("Roll.PermanentTitle", { name: esc(actor.name) }), icon: "fa-solid fa-skull", lines: card, rolls: [...earlier, roll], body: woundLine(wound, res.result) });
  return { wound, roll };
}

/* -------------------------------------------- */
/*  Dealing with Wounds                         */
/* -------------------------------------------- */

export function treatmentDC(actor, method) {
  if (method === "longRest") return 10;
  if (method === "potion") return null;
  return 8 + (Number(actor.system.details?.level ?? 0) || 0);
}

async function medicineCheck(healer, dc) {
  const rolls = await healer.rollSkill({ skill: "med", target: dc });
  const roll = Array.isArray(rolls) ? rolls[0] : rolls;
  if (!roll) return null;
  return roll.total >= dc;
}

/**
 * Treat a temporary wound.
 * - longRest: DC 10 Medicine — success removes it
 * - kit:      healer's kit, DC 8 + character level — success removes it
 * - grit:     grit and bear it, DC 8 + level — always suppresses until a short rest;
 *             1 exhaustion on a success, 2 on a failure
 * - potion:   a potion subdues it until a short rest
 * @param {Actor} actor
 * @param {string} woundId
 * @param {"longRest"|"kit"|"grit"|"potion"} method
 * @param {Actor} [healer=actor]  who makes the Medicine check
 */
export async function treatWound(actor, woundId, method, healer = actor) {
  const wound = getWounds(actor).find(w => w.id === woundId);
  if (!wound) return;
  if (wound.permanent) return ui.notifications.warn(t("Notify.PermanentNoTreat"));
  const name = esc(woundName(wound));
  const dc = treatmentDC(actor, method);
  const title = tf("Treat.Title", { name: esc(actor.name) });

  if (method === "potion") {
    await setSuppressed(actor, woundId, true);
    return postCard(actor, { title, icon: "fa-solid fa-flask", lines: [tf("Treat.Potion", { name })] });
  }

  const success = await medicineCheck(healer, dc);
  if (success === null) return;
  const who = esc(healer.name);

  if (method === "grit") {
    await setSuppressed(actor, woundId, true);
    const levels = success ? 1 : 2;
    await changeExhaustion(actor, levels);
    return postCard(actor, { title, icon: "fa-solid fa-hand-fist", lines: [tf(success ? "Treat.GritSuccess" : "Treat.GritFail", { name, who, dc, n: levels })] });
  }

  if (success) await removeWound(actor, woundId);
  return postCard(actor, {
    title, icon: "fa-solid fa-kit-medical",
    lines: [tf(success ? "Treat.Success" : "Treat.Fail", { name, who, dc, method: t(`Treat.Method.${method}`) })]
  });
}

/** Rest handling: suppressed wounds return; on a long rest, try DC 10 Medicine on each temporary wound. */
export async function onRest(actor, longRest) {
  let wounds = getWounds(actor);
  if (wounds.some(w => w.suppressed)) {
    wounds.forEach(w => { w.suppressed = false; });
    await saveWounds(actor, wounds);
  }
  if (!longRest || !setting("longRestTreatment")) return;
  const temporary = getWounds(actor).filter(w => !w.permanent);
  for (const wound of temporary) await treatWound(actor, wound.id, "longRest", actor);
}
