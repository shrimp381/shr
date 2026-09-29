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
 * @property {string|null} name    custom name (custom wounds only)
 * @property {boolean} permanent
 * @property {boolean} suppressed  subdued until the next rest (potion, grit and bear it)
 * @property {string} source       "roll" | "manual"
 * @property {number|null} result  table result that produced it
 * @property {number} [hpReduction] Internal Bleeding: HP max lost
 * @property {string} note
 */
import { MODULE_ID, resolveResult, instanceIndex, TABLES } from "./constants.js";
import { setting, t, tf } from "./settings.js";
import { postCard, esc } from "./chat.js";

const defs = () => CONFIG.CRUCIBLE.WOUNDS;

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
  if (wound.key === "custom" || !defs()[wound.key]) return wound.name || t("Wound.Custom");
  return t(`Wound.${wound.key}.Name`);
}

export function woundText(wound) {
  if (wound.key === "custom" || !defs()[wound.key]) return wound.note ?? "";
  return t(`Wound.${wound.key}.Text`);
}

export const isWoundable = actor => actor?.type === "character" || (actor?.type === "npc" && setting("woundsNpc"));

/* -------------------------------------------- */
/*  Writing                                     */
/* -------------------------------------------- */

async function saveWounds(actor, wounds) {
  await actor.update({
    [`flags.${MODULE_ID}.wounds`]: wounds,
    [`flags.${MODULE_ID}.woundCount`]: woundCount(actor, wounds)
  }, { cwInternal: true });
  await syncWoundEffects(actor);
}

/**
 * Add a wound.
 * @param {Actor} actor
 * @param {string} key                 WOUNDS key or "custom"
 * @param {object} [options]
 * @param {string} [options.name]      custom wounds
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
    ui.notifications.warn(tf("Notify.AlreadyHas", { name: t(`Wound.${key}.Name`) }));
    return null;
  }
  const wound = {
    id: foundry.utils.randomID(),
    key: def ? key : "custom",
    name: def ? null : (options.name || t("Wound.Custom")),
    permanent: def ? def.table === "permanent" : !!options.permanent,
    suppressed: false,
    source: options.source ?? "manual",
    result: options.result ?? null,
    note: options.note ?? "",
    created: Date.now()
  };
  if (def?.halveHp) {
    const hp = actor.system.attributes.hp;
    const max = hp.effectiveMax ?? (hp.max + (hp.tempmax ?? 0));
    wound.hpReduction = Math.floor(max / 2);
  }
  wounds.push(wound);
  await saveWounds(actor, wounds);
  if (def?.halveHp) {
    const hp = actor.system.attributes.hp;
    const max = hp.effectiveMax ?? hp.max;
    if (hp.value > max) await actor.update({ "system.attributes.hp.value": max }, { cwInternal: true });
  }
  if (options.immediate !== false) await onGain(actor, wound, def);
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
async function onGain(actor, wound, def) {
  switch (def?.onGain) {
    case "exhaustion":
      await changeExhaustion(actor, 1);
      break;
    case "closeCall": {
      if ((actor.system.attributes.hp.value ?? 0) <= 0) {
        await actor.update({
          "system.attributes.hp.value": 1,
          "system.attributes.death.success": 0,
          "system.attributes.death.failure": 0
        }, { cwInternal: true });
        if (actor.statuses?.has("unconscious")) await actor.toggleStatusEffect("unconscious", { active: false });
      }
      await actor.toggleStatusEffect("prone", { active: true });
      break;
    }
    case "fatal":
      await actor.update({
        "system.attributes.hp.value": 0,
        "system.attributes.death.failure": 3
      }, { cwInternal: true });
      await actor.toggleStatusEffect("dead", { active: true, overlay: true });
      break;
  }
}

export async function changeExhaustion(actor, delta) {
  const current = Number(actor.system.attributes?.exhaustion ?? 0) || 0;
  const max = CONFIG.DND5E?.conditionTypes?.exhaustion?.levels ?? 6;
  const next = Math.clamp(current + delta, 0, max);
  if (next !== current) await actor.update({ "system.attributes.exhaustion": next }, { cwInternal: true });
  return next;
}

/* -------------------------------------------- */
/*  Active Effects                              */
/* -------------------------------------------- */

function effectData(actor, wound, index) {
  const def = defs()[wound.key];
  const M = CONST.ACTIVE_EFFECT_MODES;
  const statuses = [...(def?.statuses ?? [])];
  const changes = [];
  if (def?.halveHp && wound.hpReduction) {
    changes.push({ key: "system.attributes.hp.tempmax", mode: M.ADD, value: String(-wound.hpReduction) });
  }
  if (def?.speed) {
    changes.push(index === 0
      ? { key: "system.attributes.movement.walk", mode: M.MULTIPLY, value: "0.5" }
      : { key: "system.attributes.movement.walk", mode: M.OVERRIDE, value: "0", priority: 60 });
  }
  for (const c of def?.changes ?? []) changes.push({ key: c.key, mode: M[c.mode] ?? M.ADD, value: c.value });
  if (def?.escalate && index >= 1) statuses.push(...(def.escalate.statuses ?? []));

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
  if (remove.length) await actor.deleteEmbeddedDocuments("ActiveEffect", remove, { cwInternal: true });
  if (update.length) await actor.updateEmbeddedDocuments("ActiveEffect", update, { cwInternal: true });
  if (create.length) await actor.createEmbeddedDocuments("ActiveEffect", create, { cwInternal: true });
}

/* -------------------------------------------- */
/*  Rolling                                     */
/* -------------------------------------------- */

const ownedKeys = wounds => new Set(wounds.map(w => w.key));

function skippedText(table, skipped) {
  if (!skipped.length) return "";
  const index = {};
  for (const [key, def] of Object.entries(defs())) if (def.table === table) index[def.result] = key;
  const names = skipped.map(r => `${r} (${t(`Wound.${index[r]}.Name`)})`).join(", ");
  return tf("Roll.Skipped", { list: names });
}

function woundLine(wound, result) {
  return `<div class="cw-card-wound ${wound.permanent ? "perm" : ""}"><strong>${result ?? ""}${result != null ? " · " : ""}${esc(woundName(wound))}</strong><p>${esc(woundText(wound))}</p></div>`;
}

/**
 * Roll on the Wounds and Injuries table.
 * @param {Actor} actor
 * @param {object} [options]
 * @param {string} [options.reason="manual"]   "zero" | "massive" | "manual"
 * @param {number} [options.damage=0]          damage taken (sets the permanent-wound save DC)
 * @param {string[]} [options.lines=[]]        extra chat lines to lead the card with
 */
export async function rollWound(actor, { reason = "manual", damage = 0, lines = [] } = {}) {
  const wounds = getWounds(actor);
  const count = woundCount(actor, wounds);
  const roll = await new Roll(TABLES.main.die).evaluate();
  const value = roll.total - count;
  const res = resolveResult("main", value, ownedKeys(wounds), defs());

  const card = [...lines];
  card.push(tf("Roll.Main", { reason: t(`Roll.Reason.${reason}`), roll: roll.total, count, value }));
  const skipped = skippedText("main", res.skipped);
  if (skipped) card.push(skipped);

  if (res.permanent) {
    const dc = Math.max(1, Math.floor(damage / 2));
    const id = foundry.utils.randomID();
    await actor.setFlag(MODULE_ID, "pendingPermanent", { id, dc, damage });
    card.push(`<strong>${t("Roll.PermanentTriggered")}</strong>`);
    const body = `<button type="button" class="cw-card-button" data-cw-chat="permSave" data-actor-uuid="${actor.uuid}" data-pending-id="${id}">
      <i class="fa-solid fa-shield-heart"></i> ${tf("Roll.PermanentSave", { dc })}</button>`;
    await postCard(actor, { title: tf("Roll.Title", { name: esc(actor.name) }), lines: card, rolls: [roll], body });
    return { permanent: true, dc, roll };
  }

  const wound = await addWound(actor, res.key, { source: "roll", result: res.result, force: true });
  await postCard(actor, { title: tf("Roll.Title", { name: esc(actor.name) }), lines: card, rolls: [roll], body: woundLine(wound, res.result) });
  return { wound, roll };
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

/** Roll 1d6 on the Permanent Wound table. */
export async function rollPermanent(actor, { lines = [] } = {}) {
  const wounds = getWounds(actor);
  const roll = await new Roll(TABLES.permanent.die).evaluate();
  const res = resolveResult("permanent", roll.total, ownedKeys(wounds), defs());
  const card = [...lines, tf("Roll.Permanent", { roll: roll.total })];
  const skipped = skippedText("permanent", res.skipped);
  if (skipped) card.push(skipped);
  const wound = await addWound(actor, res.key, { source: "roll", result: res.result, force: true });
  await postCard(actor, { title: tf("Roll.PermanentTitle", { name: esc(actor.name) }), icon: "fa-solid fa-skull", lines: card, rolls: [roll], body: woundLine(wound, res.result) });
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
