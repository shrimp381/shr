/**
 * Shrimp's Homebrew Rules — static rules data.
 *
 * Everything here comes from "The Crucible Worlds — Homebrew Rules" (V4):
 * Perils of Adventuring (Wounds and Injuries, Permanent Wounds, Dealing with Wounds)
 * and Armour Changes (Ablated Armour, Shields, Magic Armour, Repair and Maintenance),
 * plus the NPC Wounds and Injuries table.
 *
 * This file has no Foundry dependencies so the table logic can be unit tested.
 * The objects are exposed at runtime as CONFIG.SHR so a world script can
 * tweak them (e.g. mark another wound as repeatable) without editing the module.
 */

export const MODULE_ID = "shr";

/**
 * Wound definitions. Which table a wound sits on, and at which result, is in TABLES below,
 * so a wound that appears on more than one table (Concussion, Laceration, Sprained Wrist,
 * Sprained Ankle) is defined once.
 * - permanent:  belongs to the Permanent Wound table
 * - repeatable: the "*" in the rules. Repeatable wounds skip the duplicate check.
 * - statuses:   conditions the wound's Active Effect applies
 * - changes:    Active Effect changes (mode is a CONST.ACTIVE_EFFECT_MODES key)
 * - speed:      halves walking speed; a second instance of the same wound sets it to 0
 * - escalate:   extra effect from the second instance onward
 * - onGain:     one-off effect applied when the wound is gained
 * - halveHp:    Internal Bleeding: halves hit point maximum
 */
export const WOUNDS = {
  // Player characters (2d6 Wounds and Injuries)
  internalBleeding: { repeatable: true, img: "icons/svg/blood.svg", halveHp: true },
  concussion: { repeatable: false, img: "icons/svg/daze.svg", statuses: ["dazed"] },
  laceration: { repeatable: false, img: "icons/svg/blood.svg", statuses: ["bleeding"] },
  deepWound: { repeatable: true, img: "icons/svg/skull.svg" },
  battered: { repeatable: true, img: "icons/svg/falling.svg", onGain: "exhaustion" },
  sprainedWrist: { repeatable: true, img: "icons/svg/downgrade.svg" },
  damagedEardrum: { repeatable: false, img: "icons/svg/deaf.svg", statuses: ["deafened"] },
  systemShock: {
    repeatable: false, img: "icons/svg/lightning.svg",
    changes: [{ key: "system.attributes.init.roll.mode", mode: "ADD", value: "-1" }]
  },
  sprainedAnkle: { repeatable: true, img: "icons/svg/net.svg", speed: true },
  closeCall: { repeatable: true, img: "icons/svg/heal.svg", onGain: "closeCall" },

  // NPCs (2d6 Wounds and Injuries (NPC)). The table doesn't mark repeatable wounds; Sprained
  // Wrist and Sprained Ankle keep their player-table behaviour, and Impaired Vision repeats
  // because its second instance makes the creature Blind.
  collapsedLung: { repeatable: false, img: "icons/svg/hazard.svg" },
  tornMuscle: { repeatable: false, img: "icons/svg/combat.svg" },
  wornOut: { repeatable: false, img: "icons/svg/sleep.svg" },
  impairedVision: { repeatable: true, img: "icons/svg/blind.svg", escalate: { statuses: ["blinded"] } },
  desperatePanic: { repeatable: false, img: "icons/svg/terror.svg", statuses: ["frightened"] },
  brutalBlow: { repeatable: false, img: "icons/svg/explosion.svg", onGain: "prone" },

  // Permanent Wound (1d6)
  fatalWound: { permanent: true, repeatable: false, img: "icons/svg/skull.svg", onGain: "fatal" },
  lostArm: { permanent: true, repeatable: true, img: "icons/svg/bones.svg" },
  lostLeg: { permanent: true, repeatable: true, img: "icons/svg/bones.svg", speed: true },
  lostEye: {
    permanent: true, repeatable: true, img: "icons/svg/eye.svg",
    changes: [
      { key: "system.skills.prc.roll.mode", mode: "ADD", value: "-1" },
      { key: "system.skills.inv.roll.mode", mode: "ADD", value: "-1" }
    ],
    escalate: { statuses: ["blinded"] }
  },
  scarredLungs: { permanent: true, repeatable: false, img: "icons/svg/degen.svg" },
  hideousScar: {
    permanent: true, repeatable: false, img: "icons/svg/mystery-man.svg",
    changes: [
      { key: "system.skills.prf.roll.mode", mode: "ADD", value: "-1" },
      { key: "system.skills.per.roll.mode", mode: "ADD", value: "-1" }
    ]
  }
};

/**
 * Roll tables. `results` maps a table result to a wound key.
 * A main or NPC result below `min` (2 or less) is a Permanent Wound.
 */
export const TABLES = {
  main: {
    die: "2d6", min: 3, max: 12,
    results: {
      3: "internalBleeding", 4: "concussion", 5: "laceration", 6: "deepWound", 7: "battered",
      8: "sprainedWrist", 9: "damagedEardrum", 10: "systemShock", 11: "sprainedAnkle", 12: "closeCall"
    }
  },
  npc: {
    die: "2d6", min: 3, max: 12,
    results: {
      3: "collapsedLung", 4: "concussion", 5: "laceration", 6: "tornMuscle", 7: "wornOut",
      8: "sprainedWrist", 9: "impairedVision", 10: "desperatePanic", 11: "sprainedAnkle", 12: "brutalBlow"
    }
  },
  permanent: {
    die: "1d6", min: 1, max: 6,
    results: { 1: "fatalWound", 2: "lostArm", 3: "lostLeg", 4: "lostEye", 5: "scarredLungs", 6: "hideousScar" }
  }
};

/** Conditions the module registers if the system doesn't already provide them. */
export const EXTRA_STATUSES = [
  { id: "dazed", name: "SHR.Status.dazed", img: "icons/svg/daze.svg" },
  { id: "bleeding", name: "SHR.Status.bleeding", img: "icons/svg/blood.svg" }
];

/** Armour repair costs and tools, by armour type. */
export const REPAIR = {
  light: { cost: 2, tools: ["leather"] },
  medium: { cost: 5, tools: ["smith"] },
  heavy: { cost: 10, tools: ["leather", "smith"] }
};

/** Mending can't repair a piece that has lost this much AC or more. */
export const MENDING_LIMIT = 3;

/**
 * Magic armour AC recovery per day, indexed by magical bonus.
 * Index 0 = "basic enchantment" (magical, no +X): 1 every 2 days.
 * A +3 piece (or better) cannot be ablated at all.
 */
export const MAGIC_RECOVERY = [0.5, 1, 2];
export const ABLATION_IMMUNE_BONUS = 3;

/** AC calculations that count as natural armour or Unarmoured Defence (no ablation). */
export const EXEMPT_AC_CALCS = {
  natural: "natural",
  draconic: "natural",
  unarmoredMonk: "unarmored",
  unarmoredBarb: "unarmored",
  unarmoredBard: "unarmored"
};

export const BODY_ARMOUR_TYPES = ["light", "medium", "heavy"];

/* -------------------------------------------- */
/*  Pure table logic                            */
/* -------------------------------------------- */

/**
 * Resolve a (modified) roll against a table, applying the duplicate rule:
 * "If a player rolls the same result as one they already have a wound for, they skip
 * this result and select the next lowest result they do not have as a wound.
 * Results with a * next to them can be taken more than once."
 *
 * @param {"main"|"npc"|"permanent"} table
 * @param {number} value       the modified roll (2d6 minus existing wounds, or 1d6)
 * @param {Set<string>} owned  wound keys the creature already has
 * @returns {{result:number, key:string|null, permanent:boolean, skipped:number[]}}
 *   On the main and NPC tables, `permanent: true` (and key null) means "roll on the Permanent Wound table".
 */
export function resolveResult(table, value, owned = new Set(), wounds = WOUNDS, tables = TABLES) {
  const { min, max, results, repeat = {} } = tables[table];
  const skipped = [];
  let r = Math.min(Math.floor(value), max);
  while (r >= min) {
    const key = results[r];
    // A gap in an edited table (a deleted result) is passed over silently.
    if (key === undefined) { r--; continue; }
    // "*" on the result itself (per table) decides repeatable; otherwise the wound's own setting.
    const repeatable = repeat[r] ?? wounds[key]?.repeatable;
    if (repeatable || !owned.has(key)) return { result: r, key, permanent: false, skipped };
    skipped.push(r);
    r--;
  }
  if (table !== "permanent") return { result: Math.min(r, 2), key: null, permanent: true, skipped };
  // Permanent table floor: the lowest result that exists.
  const floor = Object.keys(results).map(Number).sort((a, b) => a - b)[0];
  return floor === undefined ? { result: min, key: null, permanent: false, skipped } : { result: floor, key: results[floor], permanent: false, skipped };
}

/* -------------------------------------------- */
/*  Wound automation                            */
/* -------------------------------------------- */

/**
 * What a wound does, in one flat shape (this is what the automation dropdowns on a table result edit):
 *  statuses     conditions applied by the wound's Active Effect
 *  escalate     extra conditions from the second instance of the same wound onward
 *  halveHp      hit point maximum halved
 *  speed        walking speed halved; a second instance sets it to 0
 *  exhaustion   levels of exhaustion gained when the wound is gained
 *  prone        knocked prone when gained
 *  closeCall    at 0 HP, drop to 1 HP instead (and prone)
 *  fatal        the creature dies
 *  skills       skill abbreviations rolled at disadvantage (prc, inv, ...)
 *  initiative   disadvantage on initiative
 */
export function normalizeAuto(a = {}) {
  const list = v => (Array.isArray(v) ? v : v ? Object.values(v) : []).filter(Boolean).map(String);
  return {
    statuses: list(a.statuses), escalate: list(a.escalate),
    halveHp: !!a.halveHp, speed: !!a.speed,
    exhaustion: Math.max(0, Math.floor(Number(a.exhaustion) || 0)),
    prone: !!a.prone, closeCall: !!a.closeCall, fatal: !!a.fatal,
    skills: list(a.skills), initiative: !!a.initiative
  };
}

/** The automation described by a wound definition (WOUNDS entry). */
export function specFromDef(def) {
  if (!def) return normalizeAuto();
  if (def.auto) return normalizeAuto(def.auto);
  const skills = [];
  let initiative = false;
  for (const c of def.changes ?? []) {
    const m = String(c.key).match(/^system\.skills\.(\w+)\.roll\.mode$/);
    if (m) skills.push(m[1]);
    else if (c.key === "system.attributes.init.roll.mode") initiative = true;
  }
  return normalizeAuto({
    statuses: def.statuses, escalate: def.escalate?.statuses, halveHp: def.halveHp, speed: def.speed,
    exhaustion: def.onGain === "exhaustion" ? 1 : 0, prone: def.onGain === "prone",
    closeCall: def.onGain === "closeCall", fatal: def.onGain === "fatal", skills, initiative
  });
}

/** How many existing instances of `key` precede the wound at `position` in the list. */
export function instanceIndex(list, position) {
  const key = list[position]?.key;
  let n = 0;
  for (let i = 0; i < position; i++) if (list[i].key === key) n++;
  return n;
}

/** Magic armour AC recovery. Returns {gain, progress}. */
export function recoveryStep({ lost, rate, progress = 0, days }) {
  if (!lost || !rate || days <= 0) return { gain: 0, progress };
  const total = progress + rate * days;
  const gain = Math.min(lost, Math.floor(total + 1e-9));
  return { gain, progress: gain >= lost ? 0 : total - gain };
}
