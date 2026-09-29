/**
 * Overcharging spells.
 *
 * A caster can cast a spell without a slot by spending Hit Dice. Base rules (level 6 or lower): spend Hit Dice
 * equal to the spell's level, then make a spell check against DC 10 + level. Fail and the spell fails and the
 * caster takes Force damage equal to the Hit Dice spent (nothing reduces it).
 * At the level cap the GM's "at level cap" rules apply: 1st-3rd level spells cost Hit Dice equal to their level;
 * 4th level and up expend a slot and a Hit Die for each level it is below the spell. No check, no damage.
 *
 * The option appears in the spell's usage dialog. Choosing it cancels the normal consumption, pays the cost and,
 * if the spell goes off, casts it at the chosen level without spending a slot.
 */
import { MODULE_ID, MAX_SPELL_LEVEL, overchargePlan, usesCapRules, maxSpellLevel } from "./constants.js";
import { setting, t, tf } from "./settings.js";
import { postCard, esc } from "./chat.js";
import { levelCap, totalLevel, veteranActive, hitDiceAvailable, spendHitDice } from "./veteran.js";

export const overchargeEnabled = () => { try { return !!setting("overcharge"); } catch (err) { return false; } };

/** Whether the cap rules apply to this actor right now. */
export function capRules(actor) {
  return usesCapRules({ atLevelCap: !!setting("atLevelCap"), level: totalLevel(actor), cap: levelCap() });
}

/** Spell slots an actor can still expend: [{key, level, value}] (pact slots count as 3rd level under the level cap rules). */
export function availableSlots(actor) {
  const out = [];
  const spells = actor.system?.spells ?? {};
  for (let l = 1; l <= MAX_SPELL_LEVEL; l++) {
    const s = spells[`spell${l}`];
    if (s && Number(s.value) > 0) out.push({ key: `spell${l}`, level: l, value: Number(s.value) });
  }
  const pact = spells.pact;
  if (pact && Number(pact.value) > 0) {
    out.push({ key: "pact", level: veteranActive() || capRules(actor) ? Math.min(3, Number(pact.level) || 3) : Number(pact.level) || 1, value: Number(pact.value), pact: true });
  }
  return out;
}

/** The highest spell level this character could cast by the normal progression (Overcharge can't go past it). */
export function castableMax(actor) {
  const classes = actor.items.filter(i => i.type === "class").map(cls => {
    let progression = cls.system?.spellcasting?.progression ?? "none";
    if (progression === "none") {
      const sub = actor.items.find(i => i.type === "subclass" && i.system?.classIdentifier === cls.system?.identifier);
      progression = sub?.system?.spellcasting?.progression ?? "none";
    }
    return { levels: Number(cls.system?.levels) || 0, progression };
  });
  return maxSpellLevel(classes);
}

/** Only leveled spells cast by player characters can be overcharged. */
export function canOvercharge(activity) {
  const item = activity?.item;
  const actor = item?.actor;
  return overchargeEnabled() && actor?.type === "character" && item?.type === "spell" && Number(item.system?.level) >= 1;
}

const label = key => t(`Overcharge.${key}`);

/* -------------------------------------------- */
/*  Usage dialog                                */
/* -------------------------------------------- */

function costText(plan, cap) {
  if (!plan.valid) return t(`Overcharge.Invalid.${plan.reason}`);
  if (cap) return plan.slot ? tf("Overcharge.CostSlot", { hd: plan.hd, slot: plan.slot }) : tf("Overcharge.CostHD", { hd: plan.hd });
  return tf("Overcharge.CostBase", { hd: plan.hd, dc: plan.dc });
}

/** Add the Overcharge fields to the spell usage dialog. */
export function injectDialog(app, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const activity = app?.activity;
  if (!root || !canOvercharge(activity)) return;
  const actor = activity.item.actor;
  const form = root.querySelector("form") ?? root;
  root.querySelectorAll(".shr-overcharge").forEach(el => el.remove());

  const cap = capRules(actor);
  const base = Number(activity.item.system.level) || 1;
  app.config ??= {};
  const state = app.config.shr ??= {};
  state.level = Math.min(Math.max(base, castableMax(actor)), Math.max(base, Number(state.level) || base));
  const slots = availableSlots(actor);

  const levels = [];
  const top = Math.max(base, castableMax(actor));
  for (let l = base; l <= top; l++) levels.push(l);
  const opts = (list, sel) => list.map(([v, txt]) => `<option value="${v}" ${String(v) === String(sel) ? "selected" : ""}>${esc(txt)}</option>`).join("");

  const box = document.createElement("fieldset");
  box.className = "shr-overcharge";
  box.innerHTML = `
    <legend><i class="fa-solid fa-bolt"></i> ${esc(label("Title"))}</legend>
    <div class="form-group">
      <label class="checkbox"><input type="checkbox" name="shr.overcharge" ${state.overcharge ? "checked" : ""}> ${esc(label("Use"))}</label>
      <p class="hint">${esc(cap ? label("HintCap") : label("HintBase"))}</p>
    </div>
    <div class="shr-oc-fields" ${state.overcharge ? "" : "hidden"}>
      <div class="form-group">
        <label>${esc(label("Level"))}</label>
        <div class="form-fields"><select name="shr.level">${opts(levels.map(l => [l, `${l}`]), state.level)}</select></div>
      </div>
      <div class="form-group shr-oc-slot" ${cap && state.level >= 4 ? "" : "hidden"}>
        <label>${esc(label("Slot"))}</label>
        <div class="form-fields"><select name="shr.slot">
          <option value="">—</option>
          ${opts(slots.filter(s => s.level < state.level).map(s => [s.key, tf("Overcharge.SlotOption", { level: s.level, n: s.value, pact: s.pact ? ` ${t("Overcharge.Pact")}` : "" })]), state.slot)}
        </select></div>
      </div>
      <p class="shr-oc-cost"></p>
      <p class="hint">${esc(tf("Overcharge.Dice", { n: hitDiceAvailable(actor) }))}</p>
    </div>`;
  const anchor = form.querySelector("footer, .form-footer, button[type=submit]")?.closest("footer") ?? null;
  if (anchor && anchor.parentElement === form) form.insertBefore(box, anchor); else form.appendChild(box);

  const update = () => {
    const chosen = slots.find(s => s.key === state.slot);
    const plan = overchargePlan({ target: state.level, capRules: cap, slotLevel: chosen?.level ?? null });
    const short = plan.valid && plan.hd > hitDiceAvailable(actor);
    box.querySelector(".shr-oc-cost").textContent = costText(plan, cap) + (short ? ` ${t("Overcharge.NotEnough")}` : "");
    box.querySelector(".shr-oc-cost").classList.toggle("bad", !plan.valid || short);
    box.querySelector(".shr-oc-fields").hidden = !state.overcharge;
    box.querySelector(".shr-oc-slot").hidden = !(cap && state.level >= 4);
  };
  box.addEventListener("change", event => {
    event.stopPropagation();
    const el = event.target;
    if (el.name === "shr.overcharge") state.overcharge = el.checked;
    else if (el.name === "shr.level") { state.level = Number(el.value); if (!slots.some(s => s.key === state.slot && s.level < state.level)) state.slot = ""; }
    else if (el.name === "shr.slot") state.slot = el.value;
    if (el.name === "shr.level") {
      const sel = box.querySelector("[name='shr.slot']");
      if (sel) sel.innerHTML = `<option value="">—</option>` + opts(slots.filter(s => s.level < state.level).map(s => [s.key, tf("Overcharge.SlotOption", { level: s.level, n: s.value, pact: s.pact ? ` ${t("Overcharge.Pact")}` : "" })]), state.slot);
    }
    update();
  });
  // Keep the values out of the system's own form handling.
  box.addEventListener("input", event => event.stopPropagation());
  update();
}

/* -------------------------------------------- */
/*  Casting                                     */
/* -------------------------------------------- */

/** dnd5e.preActivityConsumption: take over when the caster chose to overcharge. */
export function onPreConsumption(activity, usageConfig, messageConfig) {
  const choice = usageConfig?.shr;
  if (!choice?.overcharge || choice.paid || !canOvercharge(activity)) return;
  const config = foundry.utils.deepClone(usageConfig ?? {});
  runOvercharge(activity, config, messageConfig).catch(err => {
    console.error(`${MODULE_ID} | overcharge`, err);
    ui.notifications.error(err.message);
  });
  return false;
}

/** Force damage: straight off hit points, past temporary hit points and resistances. */
async function forceDamage(actor, amount) {
  const hp = actor.system.attributes.hp;
  const value = Math.max(0, (Number(hp.value) || 0) - amount);
  await actor.update({ "system.attributes.hp.value": value });
  return value;
}

export async function runOvercharge(activity, config, messageConfig) {
  const item = activity.item;
  const actor = item.actor;
  const choice = config.shr ?? {};
  const cap = capRules(actor);
  const target = Number(choice.level) || Number(item.system.level) || 1;
  const chosen = availableSlots(actor).find(s => s.key === choice.slot);
  const plan = overchargePlan({ target, capRules: cap, slotLevel: chosen?.level ?? null });
  if (!plan.valid) return ui.notifications.warn(t(`Overcharge.Invalid.${plan.reason}`));
  if (target < (Number(item.system.level) || 1)) return ui.notifications.warn(t("Overcharge.Invalid.level"));
  if (target > Math.max(Number(item.system.level) || 1, castableMax(actor))) return ui.notifications.warn(tf("Overcharge.Invalid.tooHigh", { max: castableMax(actor) }));
  if (plan.hd > hitDiceAvailable(actor)) return ui.notifications.warn(tf("Overcharge.NotEnoughWarn", { hd: plan.hd, have: hitDiceAvailable(actor) }));

  // Pay: the slot first (cap rules), then the dice.
  if (chosen) {
    const path = chosen.pact ? "system.spells.pact.value" : `system.spells.${chosen.key}.value`;
    await actor.update({ [path]: Math.max(0, chosen.value - 1) });
  }
  const spent = await spendHitDice(actor, plan.hd);
  if (!spent) return ui.notifications.warn(t("Overcharge.NotEnough"));
  const dice = spent.map(s => `${s.n}${s.die}`).join(" + ");
  const lines = [tf("Overcharge.Line.Cost", { spell: esc(item.name), level: target, hd: plan.hd, dice: esc(dice) })];
  if (chosen) lines.push(tf("Overcharge.Line.Slot", { level: chosen.level }));

  let success = true;
  const rolls = [];
  if (plan.check) {
    const mod = Number(actor.system.attributes?.spell?.mod) || 0;
    const prof = Number(actor.system.attributes?.prof) || 0;
    const roll = await new Roll("1d20 + @mod + @prof", { mod, prof }).evaluate();
    rolls.push(roll);
    success = roll.total >= plan.dc;
    lines.push(tf("Overcharge.Line.Check", { total: roll.total, dc: plan.dc }));
    if (!success) {
      const left = await forceDamage(actor, plan.hd);
      lines.push(tf("Overcharge.Line.Fail", { damage: plan.hd, hp: left }));
    }
  }
  if (success && plan.check) lines.push(t("Overcharge.Line.Success"));
  await postCard(actor, {
    title: tf(success ? "Overcharge.CardTitle" : "Overcharge.CardFailed", { spell: esc(item.name) }),
    icon: success ? "fa-solid fa-bolt" : "fa-solid fa-burst", lines, rolls
  });
  if (!success) return;

  // Cast it for real: at the chosen level, with no slot spent (the cost is already paid).
  const usage = foundry.utils.mergeObject(config, {
    spell: { slot: `spell${target}` },
    consume: { spellSlot: false },
    shr: { paid: true }
  }, { inplace: false });
  await activity.use(usage, { configure: false }, foundry.utils.deepClone(messageConfig ?? {}));
}

export function registerOvercharge() {
  Hooks.on("renderActivityUsageDialog", injectDialog);
  Hooks.on("dnd5e.preActivityConsumption", onPreConsumption);
}
