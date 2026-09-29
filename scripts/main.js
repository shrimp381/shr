/**
 * Crucible Worlds — Wounds & Armour (Foundry v13, dnd5e 5.x)
 *
 * Automates the Perils of Adventuring and Armour Changes chapters of
 * "The Crucible Worlds — Homebrew Rules":
 *   - Ablated Armour (crits, massive damage), shields first, magic armour recovery, repairs
 *   - Shields stopping massive damage, and the Shield Block reaction
 *   - Wounds and Injuries (2d6 minus wounds, duplicate skipping) and Permanent Wounds
 *   - Exhaustion at 0 HP, Deep Wound death saves, wound treatment and rest handling
 *   - A Wound Tracker on the character sheet (default dnd5e sheet and Tidy 5e)
 *
 * File layout:
 *   constants.js     rules data + pure table logic
 *   settings.js      settings + i18n helpers
 *   damage.js        hooks → hit detection → rules (the "hooks" layer)
 *   armour.js        ablation / repair / recovery (data modification)
 *   wounds.js        wound rolls / flags / effects / treatment (data modification)
 *   shield-block.js  Shield Block prompt + after-the-fact macro
 *   ui.js            tracker rendering and dialogs (UI layer)
 *   chat.js          chat cards
 */
import {
  MODULE_ID, WOUNDS, TABLES, REPAIR, MENDING_LIMIT, MAGIC_RECOVERY, EXEMPT_AC_CALCS, EXTRA_STATUSES
} from "./constants.js";
import { registerSettings, setting } from "./settings.js";
import {
  trackDamageClicks, onCalculateDamage, onPreApplyDamage, onPreUpdateActor, onUpdateActor, onMidiDamage,
  storeContext, processHit, CONTEXT_QUERY
} from "./damage.js";
import {
  ablate, repairItem, recoverMagic, advanceDays, activeShield
} from "./armour.js";
import {
  getWounds, woundCount, addWound, removeWound, setSuppressed, rollWound, rollPermanent, resolvePermanent,
  treatWound, onRest, syncWoundEffects
} from "./wounds.js";
import { manualShieldBlock, blockDialog, QUERY as BLOCK_QUERY } from "./shield-block.js";
import { TEMPLATE, injectTracker, registerTidy, potionPrompt } from "./ui.js";
import { bindChatCard, postCard } from "./chat.js";

/* -------------------------------------------- */
/*  Init                                        */
/* -------------------------------------------- */

Hooks.once("init", () => {
  registerSettings();

  // Rules data, editable by world scripts (e.g. CONFIG.CRUCIBLE.WOUNDS.concussion.repeatable = true).
  CONFIG.CRUCIBLE = {
    WOUNDS: foundry.utils.deepClone(WOUNDS),
    TABLES, REPAIR, MENDING_LIMIT, MAGIC_RECOVERY, EXEMPT_AC_CALCS
  };

  // v13 user queries: Shield Block prompts on the player's client, midi-qol hit context to the GM.
  CONFIG.queries ??= {};
  CONFIG.queries[BLOCK_QUERY] = async data => blockDialog(data, data?.timeout ?? 30);
  CONFIG.queries[CONTEXT_QUERY] = async ({ uuid, ctx } = {}) => {
    if (uuid && ctx) storeContext(uuid, ctx);
    return true;
  };

  foundry.applications.handlebars.loadTemplates([TEMPLATE]);

  const api = {
    // Wounds
    getWounds, woundCount, addWound, removeWound, setSuppressed, rollWound, rollPermanent, resolvePermanent,
    treatWound, syncWoundEffects,
    // Armour
    ablate, repairItem, recoverMagic, advanceDays, activeShield,
    // Shield Block (macro): CrucibleWorlds.shieldBlock(actor)
    shieldBlock: actor => manualShieldBlock(actor ?? canvas.tokens?.controlled[0]?.actor ?? game.user.character),
    // Run the rules for a hit by hand: processHit(actor, {dealt, droppedToZero}, {crit, isAttack, types})
    processHit
  };
  game.modules.get(MODULE_ID).api = api;
  globalThis.CrucibleWorlds = api;
});

/** Conditions the rules name that the system may not have (Dazed, Bleeding). */
Hooks.once("setup", () => {
  for (const status of EXTRA_STATUSES) {
    if (!CONFIG.statusEffects.some(s => s.id === status.id)) CONFIG.statusEffects.push({ ...status });
  }
});

Hooks.once("ready", () => {
  trackDamageClicks();
});

/* -------------------------------------------- */
/*  Damage                                      */
/* -------------------------------------------- */

Hooks.on("dnd5e.calculateDamage", onCalculateDamage);
Hooks.on("dnd5e.preApplyDamage", onPreApplyDamage);
Hooks.on("midi-qol.preTargetDamageApplication", onMidiDamage);
Hooks.on("preUpdateActor", onPreUpdateActor);
Hooks.on("updateActor", onUpdateActor);

/* -------------------------------------------- */
/*  Rests, potions, time                        */
/* -------------------------------------------- */

Hooks.on("dnd5e.restCompleted", async (actor, result, config) => {
  if (!actor?.isOwner) return;
  const longRest = !!(result?.longRest ?? (config?.type === "long"));
  if (getWounds(actor).length) await onRest(actor, longRest);
  if (longRest && setting("magicRecovery") === "longRest") {
    const days = setting("longRestDays");
    if (days > 0) {
      const lines = await recoverMagic(actor, days);
      if (lines.length) await postCard(actor, { title: game.i18n.localize("CW.Armour.RecoveryTitle"), icon: "fa-solid fa-wand-sparkles", lines });
    }
  }
});

Hooks.on("dnd5e.postUseActivity", (activity) => {
  const item = activity?.item;
  const actor = item?.actor;
  if (!actor?.isOwner || !setting("potionPrompt")) return;
  if (item.type !== "consumable" || item.system?.type?.value !== "potion") return;
  potionPrompt(actor);
});

Hooks.on("updateWorldTime", (worldTime, delta) => {
  if (!game.user.isActiveGM || setting("magicRecovery") !== "worldTime" || !(delta > 0)) return;
  advanceDays(delta / 86400);
});

/* -------------------------------------------- */
/*  UI                                          */
/* -------------------------------------------- */

Hooks.on("renderCharacterActorSheet", injectTracker);
Hooks.once("tidy5e-sheet.ready", registerTidy);
Hooks.on("renderChatMessageHTML", bindChatCard);
