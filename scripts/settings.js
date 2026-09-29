import { MODULE_ID } from "./constants.js";

export const t = key => game.i18n.localize(`CW.${key}`);
export const tf = (key, data) => game.i18n.format(`CW.${key}`, data);
export const setting = key => game.settings.get(MODULE_ID, key);

export function registerSettings() {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, {
    name: `CW.Settings.${key}.Name`, hint: `CW.Settings.${key}.Hint`, scope: "world", config: true, ...data
  });

  // Armour
  reg("ablation", { type: Boolean, default: true });
  reg("npcFlatAblation", { type: Boolean, default: true });
  reg("shieldMassive", {
    type: String, default: "negate",
    choices: { negate: "CW.Settings.shieldMassive.Negate", absorb: "CW.Settings.shieldMassive.Absorb", off: "CW.Settings.shieldMassive.Off" }
  });
  reg("shieldBlock", {
    type: String, default: "attack",
    choices: { attack: "CW.Settings.shieldBlock.Attack", always: "CW.Settings.shieldBlock.Always", off: "CW.Settings.shieldBlock.Off" }
  });
  reg("shieldBlockNpc", { type: Boolean, default: false });
  reg("shieldBlockTimeout", { type: Number, default: 30, range: { min: 5, max: 120, step: 5 } });
  reg("magicRecovery", {
    type: String, default: "longRest",
    choices: { longRest: "CW.Settings.magicRecovery.LongRest", worldTime: "CW.Settings.magicRecovery.WorldTime", manual: "CW.Settings.magicRecovery.Manual" }
  });
  reg("longRestDays", { type: Number, default: 1.5, range: { min: 0, max: 7, step: 0.5 } });

  // Wounds
  reg("wounds", { type: Boolean, default: true });
  reg("woundsNpc", { type: Boolean, default: false });
  reg("countPermanent", { type: Boolean, default: true });
  reg("exhaustionAtZero", { type: Boolean, default: true });
  reg("longRestTreatment", { type: Boolean, default: true });
  reg("potionPrompt", { type: Boolean, default: true });
  reg("whisperGM", { type: Boolean, default: false });
}
