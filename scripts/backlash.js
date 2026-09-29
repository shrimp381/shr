/**
 * Arcane Backlash: the table rolled after a Reckless Overcharge.
 *
 * Like the wound tables it is a real RollTable in the world ("Arcane Backlash"), created the first time a GM
 * loads it. Edit its text, ranges and formula, delete or add results. The effects are picked by a result's
 * name: the ten default results (Arcane Rupture ... Volatile Overflow) are automated; a result with any other
 * name is shown in chat but has no automation.
 */
import { MODULE_ID } from "./constants.js";
import { t, tf, setting } from "./settings.js";
import { postCard, esc } from "./chat.js";
import { changeExhaustion, rollWound } from "./wounds.js";
import { classItems, hitDiceAvailable, spendHitDice } from "./veteran.js";

const TABLE_NAME = "Arcane Backlash";
const FOLDER_NAME = "Shrimp's Homebrew Rules";
const IMG = "icons/svg/d20-black.svg";
export const NO_CASTING = "noSpells";
export const UNTIL_LONG_REST = "untilLongRest";

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export const DEFAULT_BACKLASH = {
  name: TABLE_NAME, formula: "1d10",
  results: [
    [1, "Arcane Rupture", "The magic violently detonates within your body. You immediately drop to 0 Hit Points, which automatically triggers 1 point of exhaustion according to your standard campaign rules."],
    [2, "Weave Burn", "You severely burn your physical tethers to the weave. You lose all remaining Hit Dice and Veteran Dice. Additionally, you cannot cast spells of 1st-level or higher for 1 minute. Cantrips function normally."],
    [3, "Arcane Exhaustion", "The surge taxes your physical limits. You immediately gain 1 level of exhaustion."],
    [4, "Strained Conduits", "Your magical pathways need a moment to cool down. You cannot cast spells of 1st-level or higher until the end of your next turn. Cantrips function normally."],
    [5, "Sensory Overload", "The magical crackle overwhelms your nervous system. You gain the dazed and deafened conditions until the end of your next turn."],
    [6, "Magical Siphon", "The weave demands physical fuel. You instantly lose 1d4 Hit or Veteran Dice. If you have no dice remaining to lose, you take 2 Force damage per missing die."],
    [7, "Arcane Feedback", "The spell backfires against your life force. Your hit point maximum is reduced by twice the spell's level until you finish a Long Rest."],
    [8, "Physical Toll", "Pushing beyond your limit literally breaks your body. You suffer a physical injury. Roll on your Wounds and Injuries table as if you took massive damage, subtracting your existing wounds from the roll as normal."],
    [9, "Spell Echo", "The magic creates a localized, lingering distortion around you. For the next 10 minutes, you have disadvantage on saving throws against spells and magical effects."],
    [10, "Volatile Overflow", "The magic bleeds out uncontrollably. You and all creatures within 10 feet take Force damage equal to the total number of expended Hit or Veteran Dice."]
  ]
};

/* -------------------------------------------- */
/*  The table                                   */
/* -------------------------------------------- */

export const findBacklash = () => {
  const tables = game.tables?.contents ?? [];
  return tables.find(x => x.getFlag(MODULE_ID, "tableId") === "backlash") ?? tables.find(x => x.name === TABLE_NAME);
};

const resultData = ([n, name, description]) => ({
  type: "text", img: IMG, weight: 1, range: [n, n], drawn: false, name, description
});

async function folder() {
  const found = game.folders?.find(f => f.type === "RollTable" && f.name === FOLDER_NAME);
  if (found) return found.id;
  try { return (await Folder.create({ name: FOLDER_NAME, type: "RollTable" }))?.id ?? null; } catch (err) { return null; }
}

async function create() {
  return RollTable.create({
    name: TABLE_NAME, description: "", formula: DEFAULT_BACKLASH.formula, replacement: true, displayRoll: true,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2 },
    folder: await folder(), flags: { [MODULE_ID]: { tableId: "backlash" } },
    results: DEFAULT_BACKLASH.results.map(resultData)
  });
}

export async function ensureBacklash() {
  if (!game.user.isActiveGM) return;
  const existing = findBacklash();
  if (existing) { if (!existing.getFlag(MODULE_ID, "tableId")) await existing.setFlag(MODULE_ID, "tableId", "backlash"); return; }
  try { await create(); } catch (err) { console.error(`${MODULE_ID} | could not create the Arcane Backlash table`, err); }
}

export async function resetBacklash() {
  const doc = findBacklash();
  if (!doc) return create();
  await doc.deleteEmbeddedDocuments("TableResult", doc.results.map(r => r.id));
  await doc.update({ formula: DEFAULT_BACKLASH.formula, replacement: true });
  await doc.createEmbeddedDocuments("TableResult", DEFAULT_BACKLASH.results.map(resultData));
  await doc.setFlag(MODULE_ID, "tableId", "backlash");
}

/** The entries of the table (the world's, or the defaults). */
function entries() {
  const doc = findBacklash();
  if (!doc) return { formula: DEFAULT_BACKLASH.formula, list: DEFAULT_BACKLASH.results.map(([n, name, text]) => ({ lo: n, hi: n, name, text })) };
  const list = [];
  for (const r of doc.results) {
    const [lo, hi] = r.range ?? [];
    const text = String(r.description ?? r.text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    list.push({ lo, hi, name: String(r.name ?? "").trim() || text.split(/\.\s/)[0], text });
  }
  let formula = String(doc.formula ?? "").replace(/[{}]/g, "").trim() || DEFAULT_BACKLASH.formula;
  try { if (typeof Roll.validate === "function" && !Roll.validate(formula)) formula = DEFAULT_BACKLASH.formula; } catch (err) { formula = DEFAULT_BACKLASH.formula; }
  return { formula, list };
}

/** Pick the entry for a roll (a total beyond the ends of the table takes the nearest end). */
export function pickEntry(list, total) {
  if (!list.length) return null;
  const hit = list.find(e => total >= e.lo && total <= e.hi);
  if (hit) return hit;
  const sorted = [...list].sort((a, b) => a.lo - b.lo);
  return total < sorted[0].lo ? sorted[0] : sorted.at(-1);
}

/* -------------------------------------------- */
/*  Effects                                     */
/* -------------------------------------------- */

const seconds = s => ({ seconds: s, rounds: Math.max(1, Math.ceil(s / 6)) });

async function addEffect(actor, { name, img = IMG, statuses = [], changes = [], duration = {}, flags = {}, description = "" }) {
  return actor.createEmbeddedDocuments("ActiveEffect", [{
    name, img, statuses, changes, duration, description, origin: actor.uuid,
    flags: { [MODULE_ID]: { backlash: true, ...flags } }
  }]);
}

/** Force damage straight off hit points (temporary hit points and resistances don't apply). */
export async function forceDamage(actor, amount) {
  amount = Math.max(0, Math.floor(amount));
  const hp = actor.system.attributes.hp;
  const value = Math.max(0, (Number(hp.value) || 0) - amount);
  if (value !== hp.value) await actor.update({ "system.attributes.hp.value": value });
  return value;
}

export const spentDice = actor => classItems(actor).reduce((s, c) => s + Math.min(Number(c.system.levels) || 0, Number(c.system.hd?.spent) || 0), 0);

/** Force damage to another creature: the GM's client applies it when a player can't. */
export async function damageOther(actor, amount) {
  if (actor.isOwner) return forceDamage(actor, amount);
  const gm = game.users.activeGM;
  if (gm && typeof gm.query === "function") return gm.query(FORCE_QUERY, { uuid: actor.uuid, amount });
}
export const FORCE_QUERY = "shr.forceDamage";
export async function onForceQuery({ uuid, amount } = {}) {
  const actor = await fromUuid(uuid);
  const target = actor?.actor ?? actor;
  if (target && game.user.isGM) await forceDamage(target, amount);
  return true;
}

/** Tokens within 10 feet of the caster's token (edge to edge, the way the grid counts it). */
function nearbyActors(actor) {
  const token = actor.getActiveTokens?.()[0] ?? canvas.tokens?.placeables?.find(x => x.actor === actor);
  if (!token || !canvas.grid || !canvas.scene) return [];
  const unit = canvas.scene.grid.distance || 5;
  const out = [];
  for (const other of canvas.tokens.placeables) {
    if (other === token || !other.actor) continue;
    const centers = canvas.grid.measurePath([token.center, other.center]).distance;
    const gap = centers - (((token.document.width + other.document.width) / 2) - 1) * unit;
    if (gap <= 10 + 1e-6) out.push(other.actor);
  }
  return out;
}

/**
 * The automation of the default results. Each handler returns the chat lines describing what happened.
 * @param {Actor} actor
 * @param {{level:number}} ctx   the level the spell was cast at
 */
const HANDLERS = {
  "arcane rupture": async actor => {
    await forceDamage(actor, actor.system.attributes.hp.value);
    return [t("Backlash.Line.Rupture")];
  },
  "weave burn": async actor => {
    const lost = hitDiceAvailable(actor);
    for (const cls of classItems(actor)) await cls.update({ "system.hd.spent": Number(cls.system.levels) || 0 });
    await addEffect(actor, {
      name: t("Backlash.Effect.WeaveBurn"), duration: seconds(60), flags: { [NO_CASTING]: true },
      description: t("Backlash.Effect.NoSpells")
    });
    return [tf("Backlash.Line.WeaveBurn", { n: lost })];
  },
  "arcane exhaustion": async actor => [tf("Backlash.Line.Exhaustion", { level: await changeExhaustion(actor, 1) })],
  "strained conduits": async actor => {
    await addEffect(actor, {
      name: t("Backlash.Effect.Strained"), duration: seconds(12), flags: { [NO_CASTING]: true },
      description: t("Backlash.Effect.NoSpells")
    });
    return [t("Backlash.Line.Strained")];
  },
  "sensory overload": async actor => {
    await addEffect(actor, { name: t("Backlash.Effect.Overload"), statuses: ["dazed", "deafened"], duration: seconds(12) });
    return [t("Backlash.Line.Overload")];
  },
  "magical siphon": async actor => {
    const roll = await new Roll("1d4").evaluate();
    const have = hitDiceAvailable(actor);
    const lose = Math.min(roll.total, have);
    if (lose) await spendHitDice(actor, lose);
    const missing = roll.total - lose;
    const lines = [tf("Backlash.Line.Siphon", { roll: roll.total, lost: lose })];
    if (missing) {
      const left = await forceDamage(actor, missing * 2);
      lines.push(tf("Backlash.Line.SiphonDamage", { damage: missing * 2, hp: left }));
    }
    return { lines, rolls: [roll] };
  },
  "arcane feedback": async (actor, ctx) => {
    const amount = 2 * (Number(ctx.level) || 0);
    await addEffect(actor, {
      name: t("Backlash.Effect.Feedback"), flags: { [UNTIL_LONG_REST]: true },
      changes: [{ key: "system.attributes.hp.tempmax", mode: 2, value: String(-amount), priority: 20 }],
      description: tf("Backlash.Effect.FeedbackText", { n: amount })
    });
    const hp = actor.system.attributes.hp;
    const max = hp.effectiveMax ?? hp.max;
    if (hp.value > max) await actor.update({ "system.attributes.hp.value": max });
    return [tf("Backlash.Line.Feedback", { n: amount })];
  },
  "physical toll": async actor => {
    await rollWound(actor, { reason: "massive", damage: 0 });
    return [t("Backlash.Line.Toll")];
  },
  "spell echo": async actor => {
    await addEffect(actor, {
      name: t("Backlash.Effect.Echo"), duration: seconds(600), description: t("Backlash.Effect.EchoText")
    });
    return [t("Backlash.Line.Echo")];
  },
  "volatile overflow": async actor => {
    const n = spentDice(actor);
    const lines = [tf("Backlash.Line.Overflow", { n })];
    if (n > 0) {
      await forceDamage(actor, n);
      for (const other of nearbyActors(actor)) {
        try { await damageOther(other, n); lines.push(tf("Backlash.Line.OverflowHit", { name: esc(other.name), n })); } catch (err) { console.warn(`${MODULE_ID} | overflow`, err); }
      }
    }
    return lines;
  }
};

/* -------------------------------------------- */
/*  Results kept on the character              */
/* -------------------------------------------- */

/** Backlash results the character is carrying (shown in the Wound Tracker until a Long Rest). */
export const getBacklashes = actor => foundry.utils.deepClone(actor?.getFlag?.(MODULE_ID, "backlashes") ?? []).map(b => ({ ...b, img: b.img || IMG }));

async function recordBacklash(actor, entry, level) {
  const list = getBacklashes(actor);
  list.push({ id: foundry.utils.randomID(), name: entry.name, text: entry.text, level: Number(level) || 0, created: Date.now() });
  await actor.setFlag(MODULE_ID, "backlashes", list);
}

export async function removeBacklash(actor, id) {
  if (!id) return;
  await actor.setFlag(MODULE_ID, "backlashes", getBacklashes(actor).filter(b => b.id !== id));
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

/**
 * Roll on the Arcane Backlash table and apply the result.
 * @param {Actor} actor
 * @param {{level?:number}} [ctx]  level the spell was cast at
 */
export async function rollBacklash(actor, ctx = {}) {
  const { formula, list } = entries();
  const roll = await new Roll(formula).evaluate();
  const entry = pickEntry(list, roll.total);
  const lines = [tf("Backlash.Rolled", { formula, total: roll.total })];
  const rolls = [roll];
  if (!entry) return postCard(actor, { title: t("Backlash.Title"), icon: "fa-solid fa-burst", lines, rolls });
  await recordBacklash(actor, entry, ctx.level);
  lines.push(`<strong>${esc(entry.name)}.</strong> ${esc(entry.text)}`);
  await postCard(actor, { title: tf("Backlash.CardTitle", { name: esc(actor.name) }), icon: "fa-solid fa-burst", lines, rolls });
  const handler = HANDLERS[norm(entry.name)];
  if (handler) {
    try {
      const out = await handler(actor, ctx);
      const more = Array.isArray(out) ? { lines: out, rolls: [] } : out;
      if (more.lines?.length || more.rolls?.length) await postCard(actor, { title: t("Backlash.Effects"), icon: "fa-solid fa-bolt", lines: more.lines ?? [], rolls: more.rolls ?? [] });
    } catch (err) {
      console.error(`${MODULE_ID} | backlash effect`, err);
      ui.notifications.error(err.message);
    }
  }
  return entry;
}

/* -------------------------------------------- */
/*  Not being able to cast                      */
/* -------------------------------------------- */

export const cannotCast = actor => actor?.effects?.some(e => !e.disabled && e.getFlag?.(MODULE_ID, NO_CASTING));

/** dnd5e.preUseActivity: leveled spells can't be cast while a backlash effect forbids it. */
export function onPreUse(activity, usageConfig) {
  const item = activity?.item;
  if (item?.type !== "spell" || !(Number(item.system?.level) >= 1)) return;
  if (usageConfig?.shr?.paid) return;
  if (!cannotCast(item.actor)) return;
  ui.notifications.warn(t("Backlash.CannotCast"));
  return false;
}

/** After a long rest: effects that last until then end. */
export async function onLongRest(actor) {
  if ((actor.getFlag?.(MODULE_ID, "backlashes") ?? []).length) await actor.setFlag(MODULE_ID, "backlashes", []);
  const ids = actor.effects.filter(e => e.getFlag?.(MODULE_ID, UNTIL_LONG_REST)).map(e => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
}

export function registerBacklash() {
  Hooks.on("dnd5e.preUseActivity", onPreUse);
}
