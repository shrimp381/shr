import { MODULE_ID } from "./constants.js";

export const t = key => game.i18n.localize(`SHR.${key}`);
export const tf = (key, data) => game.i18n.format(`SHR.${key}`, data);
export const setting = key => game.settings.get(MODULE_ID, key);

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `SHR.Settings.${key}.Name`, hint: `SHR.Settings.${key}.Hint`, scope: "world", config: true, ...data
  });

  // Armour
  reg("ablation", { type: Boolean, default: true });
  reg("npcFlatAblation", { type: Boolean, default: true });
  reg("shieldMassive", {
    type: String, default: "negate",
    choices: { negate: "SHR.Settings.shieldMassive.Negate", absorb: "SHR.Settings.shieldMassive.Absorb", off: "SHR.Settings.shieldMassive.Off" }
  });
  reg("shieldBlock", {
    type: String, default: "attack",
    choices: { attack: "SHR.Settings.shieldBlock.Attack", always: "SHR.Settings.shieldBlock.Always", off: "SHR.Settings.shieldBlock.Off" }
  });
  reg("shieldBlockNpc", { type: Boolean, default: false });
  reg("shieldBlockTimeout", { type: Number, default: 30, range: { min: 5, max: 120, step: 5 } });
  reg("magicRecovery", {
    type: String, default: "longRest",
    choices: { longRest: "SHR.Settings.magicRecovery.LongRest", worldTime: "SHR.Settings.magicRecovery.WorldTime", manual: "SHR.Settings.magicRecovery.Manual" }
  });
  reg("longRestDays", { type: Number, default: 1.5, range: { min: 0, max: 7, step: 0.5 } });

  // Wounds
  reg("wounds", { type: Boolean, default: true });
  reg("woundsNpc", { type: Boolean, default: false });
  reg("npcPermanent", {
    type: String, default: "ask",
    choices: { ask: "SHR.Settings.npcPermanent.Ask", always: "SHR.Settings.npcPermanent.Always", reroll: "SHR.Settings.npcPermanent.Reroll" }
  });
  reg("countPermanent", { type: Boolean, default: true });
  reg("exhaustionAtZero", { type: Boolean, default: true });
  reg("longRestTreatment", { type: Boolean, default: true });
  reg("potionPrompt", { type: Boolean, default: true });
  reg("whisperGM", { type: Boolean, default: false });

  // Per-user display preference: show the Perils panel on the first tab of Tidy 5e sheets
  // instead of as its own tab.
  game.settings.register(MODULE_ID, "perilsPinned", { scope: "client", config: false, type: Boolean, default: false });
}
