/**
 * Crucible Worlds — static rules data.
 *
 * Everything here comes from "The Crucible Worlds — Homebrew Rules" (V4):
 * Perils of Adventuring (Wounds and Injuries, Permanent Wounds, Dealing with Wounds)
 * and Armour Changes (Ablated Armour, Shields, Magic Armour, Repair and Maintenance).
 *
 * This file has no Foundry dependencies so the table logic can be unit tested.
 * The objects are exposed at runtime as CONFIG.CRUCIBLE so a world script can
 * tweak them (e.g. mark another wound as repeatable) without editing the module.
 */

export const MODULE_ID = "crucible-worlds";

/**
 * Wound definitions.
 * - table:      "main" (2d6 Wounds and Injuries) or "permanent" (1d6 Permanent Wound)
 * - result:     the table result that gives this wound
 * - repeatable: the "*" in the rules. Repeatable wounds skip the duplicate check.
 * - statuses:   conditions the wound's Active Effect applies
 * - changes:    Active Effect changes (mode is a CONST.ACTIVE_EFFECT_MODES key)
 * - speed:      halves walking speed; a second instance of the same wound sets it to 0
 * - escalate:   extra effect from the second instance onward
 * - onGain:     one-off effect applied when the wound is gained
 */
export const WOUNDS = {
  // 2d6 — Wounds and Injuries. A result of 2 or less rolls on the permanent table.
  internalBleeding: { table: "main", result: 3, repeatable: true, img: "icons/svg/blood.svg", halveHp: true },
  concussion: { table: "main", result: 4, repeatable: false, img: "icons/svg/daze.svg", statuses: ["dazed"] },
  laceration: { table: "main", result: 5, repeatable: false, img: "icons/svg/blood.svg", statuses: ["bleeding"] },
  deepWound: { table: "main", result: 6, repeatable: true, img: "icons/svg/skull.svg" },
  battered: { table: "main", result: 7, repeatable: true, img: "icons/svg/falling.svg", onGain: "exhaustion" },
  sprainedWrist: { table: "main", result: 8, repeatable: true, img: "icons/svg/downgrade.svg" },
  damagedEardrum: { table: "main", result: 9, repeatable: false, img: "icons/svg/deaf.svg", statuses: ["deafened"] },
  systemShock: {
    table: "main", result: 10, repeatable: false, img: "icons/svg/lightning.svg",
    changes: [{ key: "system.attributes.init.roll.mode", mode: "ADD", value: "-1" }]
  },
  sprainedAnkle: { table: "main", result: 11, repeatable: true, img: "icons/svg/net.svg", speed: true },
  closeCall: { table: "main", result: 12, repeatable: true, img: "icons/svg/heal.svg", onGain: "closeCall" },

  // 1d6 — Permanent Wound
  fatalWound: { table: "permanent", result: 1, repeatable: false, img: "icons/svg/skull.svg", onGain: "fatal" },
  lostArm: { table: "permanent", result: 2, repeatable: true, img: "icons/svg/bones.svg" },
  lostLeg: { table: "permanent", result: 3, repeatable: true, img: "icons/svg/bones.svg", speed: true },
  lostEye: {
    table: "permanent", result: 4, repeatable: true, img: "icons/svg/eye.svg",
    changes: [
      { key: "system.skills.prc.roll.mode", mode: "ADD", value: "-1" },
      { key: "system.skills.inv.roll.mode", mode: "ADD", value: "-1" }
    ],
    escalate: { statuses: ["blinded"] }
  },
  scarredLungs: { table: "permanent", result: 5, repeatable: false, img: "icons/svg/degen.svg" },
  hideousScar: {
    table: "permanent", result: 6, repeatable: false, img: "icons/svg/terror.svg",
    changes: [
      { key: "system.skills.prf.roll.mode", mode: "ADD", value: "-1" },
      { key: "system.skills.per.roll.mode", mode: "ADD", value: "-1" }
    ]
  }
};

export const TABLES = {
  main: { min: 3, max: 12, die: "2d6" },
  permanent: { min: 1, max: 6, die: "1d6" }
};

/** Conditions the module registers if the system doesn't already provide them. */
export const EXTRA_STATUSES = [
  { id: "dazed", name: "CW.Status.dazed", img: "icons/svg/daze.svg" },
  { id: "bleeding", name: "CW.Status.bleeding", img: "icons/svg/blood.svg" }
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

/** Map of result number -> wound key for one table. */
export function tableIndex(table, wounds = WOUNDS) {
  const index = {};
  for (const [key, def] of Object.entries(wounds)) if (def.table === table) index[def.result] = key;
  return index;
}

/**
 * Resolve a (modified) roll against a table, applying the duplicate rule:
 * "If a player rolls the same result as one they already have a wound for, they skip
 * this result and select the next lowest result they do not have as a wound.
 * Results with a * next to them can be taken more than once."
 *
 * @param {"main"|"permanent"} table
 * @param {number} value       the modified roll (2d6 minus existing wounds, or 1d6)
 * @param {Set<string>} owned  wound keys the character already has
 * @returns {{result:number, key:string|null, permanent:boolean, skipped:number[]}}
 *   On the main table, `permanent: true` (and key null) means "roll on the Permanent Wound table".
 */
export function resolveResult(table, value, owned = new Set(), wounds = WOUNDS) {
  const { min, max } = TABLES[table];
  const index = tableIndex(table, wounds);
  const skipped = [];
  let r = Math.min(Math.floor(value), max);
  while (r >= min) {
    const key = index[r];
    if (key && (wounds[key].repeatable || !owned.has(key))) return { result: r, key, permanent: false, skipped };
    skipped.push(r);
    r--;
  }
  if (table === "main") return { result: Math.min(r, 2), key: null, permanent: true, skipped };
  // Permanent table floor: result 1.
  return { result: min, key: index[min], permanent: false, skipped };
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
