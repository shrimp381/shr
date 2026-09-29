/**
 * Level Cap Ruleset (Veteran Levels).
 *
 * When the GM turns on "At level cap", levels a character gains beyond the cap (6) are Veteran Levels.
 * They keep their class levels and features, but the progression the rules freezes is overridden:
 *   - Proficiency bonus stays where it was at the cap (+3)
 *   - Max HP stays fixed: veteran levels add no hit points
 *   - Spell slots (and Warlock pact slots) stop progressing; cantrips stop scaling
 *   - Hit Dice from veteran levels are Veteran Dice, tracked separately
 *
 * Veteran levels are recorded per class in an item flag (`veteran`), when a class levels up past the cap
 * (or, for characters already past it, when the GM turns the rule on). The overrides are applied while the
 * system prepares actor data, so every sheet, roll and HUD sees them.
 */
import {
  MODULE_ID, DEFAULT_LEVEL_CAP, veteranGain, reconcileVeteran, hpWithoutVeteran, splitHitDice, proficiencyForLevel
} from "./constants.js";
import { setting } from "./settings.js";

/* -------------------------------------------- */
/*  State                                       */
/* -------------------------------------------- */

/** Veteran Levels apply only while both the feature and the GM's "at level cap" switch are on. */
export function veteranActive() {
  try { return !!setting("veteranLevels") && !!setting("atLevelCap"); } catch (err) { return false; }
}

export function levelCap() {
  try { return Math.max(1, Math.floor(Number(setting("levelCap"))) || DEFAULT_LEVEL_CAP); } catch (err) { return DEFAULT_LEVEL_CAP; }
}

export const classItems = actor => (actor?.items ? actor.items.filter(i => i.type === "class") : []);
export const totalLevel = actor => classItems(actor).reduce((s, c) => s + (Number(c.system?.levels) || 0), 0);

/** Veteran levels a class holds (0 while the rule is off). */
export function veteranOf(cls) {
  return veteranActive() ? Math.max(0, Math.floor(Number(cls?.getFlag?.(MODULE_ID, "veteran"))) || 0) : 0;
}

export const veteranTotal = actor => (actor?.type === "character" ? classItems(actor).reduce((s, c) => s + veteranOf(c), 0) : 0);

/* -------------------------------------------- */
/*  Hit Dice and Veteran Dice                   */
/* -------------------------------------------- */

/** Hit Dice and Veteran Dice, remaining and total. Spent dice come off Veteran Dice first. */
export function hitDiceSummary(actor) {
  const out = { hd: { value: 0, max: 0 }, vet: { value: 0, max: 0 } };
  for (const cls of classItems(actor)) {
    const s = splitHitDice({ levels: Number(cls.system.levels) || 0, spent: Number(cls.system.hd?.spent) || 0, veteran: veteranOf(cls) });
    out.hd.value += s.normalAvail; out.hd.max += s.normalMax;
    out.vet.value += s.vetAvail; out.vet.max += s.vetMax;
  }
  return out;
}

/** What the tracker shows: null unless the rule is on and the character has veteran levels. */
export function veteranContext(actor) {
  const levels = veteranTotal(actor);
  if (!levels) return null;
  return { levels, cap: levelCap(), ...hitDiceSummary(actor) };
}

/** Total Hit Dice (normal + veteran) left to spend. */
export const hitDiceAvailable = actor => classItems(actor).reduce((s, c) => s + Math.max(0, (Number(c.system.levels) || 0) - (Number(c.system.hd?.spent) || 0)), 0);

/**
 * Spend Hit Dice: Veteran Dice first, then the largest die.
 * @returns {Promise<Array<{die:string,n:number}>|null>} what was spent, or null if there aren't enough
 */
export async function spendHitDice(actor, count) {
  if (count > hitDiceAvailable(actor)) return null;
  const size = c => Number(String(c.system.hd?.denomination ?? "d6").replace(/\D/g, "")) || 0;
  const avail = c => Math.max(0, (Number(c.system.levels) || 0) - (Number(c.system.hd?.spent) || 0));
  const vetAvail = c => splitHitDice({ levels: c.system.levels, spent: c.system.hd?.spent ?? 0, veteran: veteranOf(c) }).vetAvail;
  const order = classItems(actor).filter(c => avail(c) > 0).sort((a, b) => (vetAvail(b) > 0) - (vetAvail(a) > 0) || size(b) - size(a));
  const spent = [];
  let need = count;
  for (const cls of order) {
    if (need <= 0) break;
    const n = Math.min(avail(cls), need);
    await cls.update({ "system.hd.spent": (Number(cls.system.hd?.spent) || 0) + n });
    spent.push({ die: cls.system.hd?.denomination ?? "d6", n });
    need -= n;
  }
  return spent;
}

/* -------------------------------------------- */
/*  Recording veteran levels                    */
/* -------------------------------------------- */

/** Make the recorded veteran levels add up to (total level - cap). Run by the active GM. */
export async function reconcile(actor) {
  if (!veteranActive() || actor?.type !== "character") return;
  const classes = classItems(actor);
  const data = classes.map(c => ({ id: c.id, levels: Number(c.system.levels) || 0, veteran: Number(c.getFlag(MODULE_ID, "veteran")) || 0 }));
  const next = reconcileVeteran(data, levelCap());
  for (const cls of classes) {
    if ((Number(cls.getFlag(MODULE_ID, "veteran")) || 0) !== next[cls.id]) await cls.setFlag(MODULE_ID, "veteran", next[cls.id]);
  }
}

/** A class item gains or loses levels: levels gained beyond the cap are veteran levels. */
export function onPreUpdateClass(item, changes) {
  if (item.type !== "class" || !veteranActive()) return;
  const actor = item.actor;
  if (actor?.type !== "character") return;
  const next = foundry.utils.getProperty(changes, "system.levels");
  if (next === undefined) return;
  const prev = Number(item.system.levels) || 0;
  const current = Number(item.getFlag(MODULE_ID, "veteran")) || 0;
  let value = current;
  if (next > prev) value = current + veteranGain(totalLevel(actor), next - prev, levelCap());
  else if (next < prev) value = Math.min(current, next);
  if (value !== current) foundry.utils.setProperty(changes, `flags.${MODULE_ID}.veteran`, value);
}

/** A class added to a character already at the cap starts with veteran levels. */
export function onPreCreateClass(item) {
  if (item.type !== "class" || !veteranActive()) return;
  const actor = item.parent;
  if (actor?.documentName !== "Actor" || actor.type !== "character") return;
  const levels = Number(item.system?.levels) || 0;
  const add = veteranGain(totalLevel(actor), levels, levelCap());
  if (add) item.updateSource({ [`flags.${MODULE_ID}.veteran`]: add });
}

/* -------------------------------------------- */
/*  Overriding progression                      */
/* -------------------------------------------- */

const veteranOfActor = actor => (actor ? veteranTotal(actor) : 0);

/**
 * Spell slots: contribute fewer class levels to the spellcasting progression (leveled and pact).
 * Set from the class's own levels each time, so it can't stack.
 */
function clampProgression(progression, actor, cls, spellcasting) {
  if (!veteranActive() || !spellcasting) return;
  const klass = cls?.type === "subclass" ? cls.class : cls;
  const v = veteranOf(klass);
  if (!v) return;
  const levels = Number(klass?.system?.levels ?? spellcasting.levels) || 0;
  spellcasting.levels = Math.max(0, levels - v);
}

/**
 * Patch the system where it derives proficiency, cantrip scaling and hit points, so veteran levels add none.
 * @returns {string[]} the patches that could not be applied
 */
export function installPatches() {
  const failed = [];
  const sys = globalThis.dnd5e;
  try {
    const CharacterData = sys.dataModels.actor.CharacterData;
    const baseData = CharacterData.prototype.prepareBaseData;
    CharacterData.prototype.prepareBaseData = function (...args) {
      const result = baseData.apply(this, args);
      try {
        const v = veteranOfActor(this.parent);
        if (v > 0) this.attributes.prof = proficiencyForLevel(Math.max(1, (Number(this.details.level) || 0) - v));
      } catch (err) { console.warn(`${MODULE_ID} | proficiency override`, err); }
      return result;
    };
    const cantrip = CharacterData.prototype.cantripLevel;
    if (typeof cantrip === "function") {
      CharacterData.prototype.cantripLevel = function (...args) {
        const level = cantrip.apply(this, args);
        const v = veteranOfActor(this.parent);
        return v > 0 ? Math.max(1, level - v) : level;
      };
    }
  } catch (err) { failed.push("proficiency and cantrips"); console.warn(`${MODULE_ID} | could not patch CharacterData`, err); }

  try {
    const proto = sys.documents.advancement.HitPointsAdvancement.prototype;
    const total = proto.getAdjustedTotal;
    proto.getAdjustedTotal = function (mod) {
      const v = veteranOf(this.item);
      if (!v) return total.call(this, mod);
      const keep = Math.max(0, (Number(this.item.system.levels) || 0) - v);
      return hpWithoutVeteran(Object.keys(this.value ?? {}).map(Number), l => this.valueForLevel(l), mod, keep);
    };
  } catch (err) { failed.push("hit points"); console.warn(`${MODULE_ID} | could not patch HitPointsAdvancement`, err); }
  return failed;
}

export function registerVeteranHooks() {
  Hooks.on("dnd5e.computeLeveledProgression", clampProgression);
  Hooks.on("dnd5e.computePactProgression", clampProgression);
  Hooks.on("preUpdateItem", onPreUpdateClass);
  Hooks.on("preCreateItem", onPreCreateClass);
}

/* -------------------------------------------- */
/*  Turning the rule on and off                 */
/* -------------------------------------------- */

/** After a setting change: the GM records veteran levels, then everyone re-prepares actors and sheets. */
export async function refresh() {
  if (game.user.isActiveGM && veteranActive()) {
    for (const actor of game.actors) if (actor.type === "character") await reconcile(actor);
  }
  for (const actor of game.actors) { try { actor.reset?.(); } catch (err) { /* ignore */ } }
  for (const app of foundry.applications.instances.values()) {
    if (app.document?.documentName === "Actor" && app.rendered) app.render();
  }
}
