/**
 * Damage detection pipeline.
 *
 * Every HP loss is caught at the Actor update itself (preUpdateActor / updateActor), so
 * damage from any source is seen: dnd5e damage application, midi-qol, token HUD edits,
 * macros. The dnd5e and midi-qol damage hooks only *enrich* that with what an HP delta
 * can't tell us — whether the hit was a critical, whether it was an attack, and its
 * damage types (psychic doesn't ablate armour) — stored briefly per actor as a "context".
 *
 * All processing happens on the client that made the HP update (userId === game.user.id),
 * so each hit is handled exactly once.
 */
import { MODULE_ID } from "./constants.js";
import { setting, t, tf } from "./settings.js";
import { ablate, ablationLine, activeShield, equippedShield } from "./armour.js";
import { getWounds, rollWound, changeExhaustion, isWoundable } from "./wounds.js";
import { shouldOfferBlock, askBlock } from "./shield-block.js";
import { postCard, esc } from "./chat.js";

export const CONTEXT_QUERY = `${MODULE_ID}.hitContext`;
const CONTEXT_TTL = 5000;
const contexts = new Map();
let lastApply = null;

/* -------------------------------------------- */
/*  Hit context                                 */
/* -------------------------------------------- */

export function storeContext(uuid, data) {
  const prev = contexts.get(uuid);
  const base = prev && Date.now() - prev.time < CONTEXT_TTL ? prev : {};
  contexts.set(uuid, { ...base, ...data, time: Date.now() });
}
export function peekContext(uuid) {
  const ctx = contexts.get(uuid);
  return ctx && Date.now() - ctx.time < CONTEXT_TTL ? ctx : null;
}
export function takeContext(uuid) {
  const ctx = peekContext(uuid);
  contexts.delete(uuid);
  return ctx;
}

/** Remember which chat card's damage-application control was just used. */
export function trackDamageClicks() {
  document.addEventListener("click", event => {
    const app = event.target?.closest?.("damage-application");
    const message = app?.closest("[data-message-id]");
    if (message) lastApply = { messageId: message.dataset.messageId, time: Date.now() };
  }, true);
}

/** Crit / attack info from the damage roll message being applied. */
function messageContext(options) {
  let message = options?.originatingMessage;
  if (typeof message === "string") message = game.messages.get(message);
  if (!message && lastApply && Date.now() - lastApply.time < CONTEXT_TTL) message = game.messages.get(lastApply.messageId);
  if (!message) return {};
  const crit = (message.rolls ?? []).some(r => r.isCritical || r.options?.isCritical);
  let isAttack = null;
  try {
    const activity = message.getAssociatedActivity?.();
    if (activity) isAttack = activity.type === "attack";
  } catch (err) { /* no activity */ }
  return { crit, isAttack, messageId: message.id };
}

/* -------------------------------------------- */
/*  dnd5e damage hooks                          */
/* -------------------------------------------- */

/** After resistances: note damage types and the source message. */
export function onCalculateDamage(actor, damages, options) {
  if (options?.[MODULE_ID]?.decided) return;
  const types = {};
  for (const d of damages ?? []) {
    if (!d?.type || d.type === "healing" || d.type === "temphp") continue;
    types[d.type] = (types[d.type] ?? 0) + Math.max(0, Number(d.value) || 0);
  }
  storeContext(actor.uuid, { ...messageContext(options), types, source: "dnd5e" });
}

/** Final amount; offer Shield Block before HP changes. */
export function onPreApplyDamage(actor, amount, updates, options) {
  const decided = options?.[MODULE_ID]?.decided;
  storeContext(actor.uuid, { amount });
  if (decided || !(amount > 0)) return;
  const ctx = peekContext(actor.uuid) ?? {};
  if (!shouldOfferBlock(actor, ctx)) return;
  resolveBlock(actor, amount, ctx);
  return false;
}

async function resolveBlock(actor, amount, ctx) {
  const blocked = await askBlock(actor, amount, ctx);
  const final = blocked ? Math.floor(amount / 2) : amount;
  storeContext(actor.uuid, { ...ctx, amount: final, blocked, originalAmount: amount });
  await actor.applyDamage(final, { ignore: true, [MODULE_ID]: { decided: true } });
}

/* -------------------------------------------- */
/*  midi-qol                                    */
/* -------------------------------------------- */

/**
 * midi-qol applies damage through its own workflow (usually as the GM), so read what we
 * need from the workflow and hand it to whoever will make the HP update.
 */
export function onMidiDamage(token, data) {
  try {
    const actor = token?.actor ?? token?.document?.actor;
    if (!actor) return;
    const workflow = data?.workflow;
    const item = data?.ditem ?? data?.damageItem ?? {};
    const types = {};
    const details = [item.damageDetail, item.rawDamageDetail].flat(3).filter(Boolean);
    for (const d of details) if (d.type) types[d.type] = (types[d.type] ?? 0) + (Number(d.value ?? d.damage) || 0);
    const ctx = {
      crit: !!(workflow?.isCritical ?? item.critical),
      isAttack: workflow ? !!(workflow.activity?.type === "attack" || workflow.attackRoll) : null,
      types,
      source: "midi"
    };
    const amount = Number(item.totalDamage ?? item.appliedDamage);
    if (Number.isFinite(amount) && amount > 0) ctx.amount = amount;
    storeContext(actor.uuid, ctx);
    const gm = game.users.activeGM;
    if (gm && !gm.isSelf && typeof gm.query === "function") gm.query(CONTEXT_QUERY, { uuid: actor.uuid, ctx }).catch(() => {});
  } catch (err) {
    console.warn(`${MODULE_ID} | midi-qol context`, err);
  }
}

/* -------------------------------------------- */
/*  Actor update hooks                          */
/* -------------------------------------------- */

export function onPreUpdateActor(actor, changes, options) {
  if (options.shrInternal) return;
  const flat = foundry.utils.flattenObject(changes);
  if (!("system.attributes.hp.value" in flat) && !("system.attributes.hp.temp" in flat)) return;
  const hp = actor.system.attributes?.hp;
  if (!hp) return;
  options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), prev: { value: hp.value ?? 0, temp: hp.temp ?? 0 } };
}

export function onUpdateActor(actor, changes, options, userId) {
  if (userId !== game.user.id || options.shrInternal) return;
  const prev = options[MODULE_ID]?.prev;
  if (!prev) return;
  const hp = actor.system.attributes.hp;
  const now = { value: hp.value ?? 0, temp: hp.temp ?? 0 };
  const dealt = (prev.value + prev.temp) - (now.value + now.temp);
  if (dealt <= 0) return;
  const hit = { prev, now, dealt, droppedToZero: prev.value > 0 && now.value <= 0 };
  const run = () => processHit(actor, hit, takeContext(actor.uuid) ?? {}).catch(err => console.error(`${MODULE_ID} |`, err));
  // midi-qol's context can arrive from another client a moment after the HP update.
  if (game.modules.get("midi-qol")?.active && !peekContext(actor.uuid)) setTimeout(run, 300);
  else run();
}

/* -------------------------------------------- */
/*  The rules                                   */
/* -------------------------------------------- */

/**
 * Apply Ablated Armour, Shields, Exhaustion, Deep Wound and Wounds and Injuries for one hit.
 * @param {Actor} actor
 * @param {{dealt:number, droppedToZero:boolean}} hit
 * @param {object} ctx   {amount, crit, isAttack, types, blocked}
 */
export async function processHit(actor, hit, ctx = {}) {
  const hp = actor.system.attributes.hp;
  const max = hp.effectiveMax ?? hp.max ?? 0;
  const amount = Math.max(Number(ctx.amount) || 0, hit.dealt);
  const half = max / 2;
  const massive = max > 0 && amount > half;

  const hadShield = !!equippedShield(actor);
  const shield = activeShield(actor);
  const shieldMode = setting("shieldMassive");
  const shieldStops = massive && !!shield && shieldMode !== "off";

  const lines = [];

  // Shield Block chosen in the prompt: the shield pays 1 AC.
  if (ctx.blocked) {
    const r = await ablate(actor, { shieldOnly: true });
    lines.push(tf("Hit.Blocked", { from: ctx.originalAmount ?? amount * 2, to: amount }));
    lines.push(ablationLine(r, "block"));
  }

  // Ablated Armour: critical hits, and massive damage from an attack. Psychic damage never ablates.
  if (setting("ablation")) {
    const types = ctx.types && Object.keys(ctx.types).length ? ctx.types : null;
    const physical = types ? Object.entries(types).reduce((s, [k, v]) => s + (k === "psychic" ? 0 : v), 0) : amount;
    const psychicOnly = types ? physical <= 0 : false;
    const critTrigger = !!ctx.crit && !psychicOnly;
    const massiveTrigger = physical > half && max > 0 && ctx.isAttack !== false && (!shieldStops || shieldMode === "absorb");
    if (critTrigger || massiveTrigger) {
      const reason = critTrigger ? "crit" : shieldStops ? "absorb" : "massive";
      lines.push(ablationLine(await ablate(actor), reason));
    } else if (ctx.crit && psychicOnly) {
      lines.push(t("Hit.PsychicNoAblation"));
    }
  }

  if (shieldStops) lines.push(tf("Hit.ShieldStops", { shield: esc(shield.name) }));

  // Perils of Adventuring. Player characters roll at 0 HP and on massive damage, and gain
  // exhaustion / Deep Wound failures at 0 HP. NPCs (if enabled) roll on their own table for
  // massive damage they survive; an NPC at 0 HP is dead or defeated, not wounded.
  let triggered = false;
  if (setting("wounds") && isWoundable(actor)) {
    const isPc = actor.type === "character";
    if (isPc && hit.droppedToZero) {
      if (setting("exhaustionAtZero")) {
        const level = await changeExhaustion(actor, 1);
        lines.push(tf("Hit.Exhaustion", { level }));
        triggered = true;
      }
      const deep = getWounds(actor).filter(w => w.key === "deepWound" && !w.suppressed).length;
      if (deep) {
        const failures = Math.min(3, (Number(actor.system.attributes.death?.failure) || 0) + deep);
        await actor.update({ "system.attributes.death.failure": failures }, { shrInternal: true });
        lines.push(tf("Hit.DeepWound", { n: deep }));
      }
    }
    const massiveWound = massive && !shieldStops;
    const woundTrigger = isPc
      ? (hit.droppedToZero ? "zero" : massiveWound ? "massive" : null)
      : (massiveWound && !hit.droppedToZero && (hp.value ?? 0) > 0 ? "massive" : null);
    if (woundTrigger) {
      triggered = true;
      await recordHit(actor, amount, hadShield, ctx, triggered);
      return rollWound(actor, { reason: woundTrigger, damage: amount, lines });
    }
  }

  await recordHit(actor, amount, hadShield, ctx, triggered);
  if (lines.length) await postCard(actor, { title: tf("Hit.Title", { name: esc(actor.name) }), icon: "fa-solid fa-shield-halved", lines });
}

/** Keep the last hit on shield users so Shield Block can be used after the fact. */
async function recordHit(actor, amount, hadShield, ctx, triggered) {
  if (!hadShield) return;
  await actor.setFlag(MODULE_ID, "lastHit", { amount, time: Date.now(), blocked: !!ctx.blocked, triggered });
}
