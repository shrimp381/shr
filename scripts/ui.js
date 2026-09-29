/**
 * Wound Tracker UI: context preparation, sheet injection (default dnd5e sheet and
 * Tidy 5e), and control handling.
 *
 * Controls use data-shr-action (not data-action) so the sheet's own ApplicationV2
 * action dispatch never picks them up.
 */
import { veteranContext } from "./veteran.js";
import { getBacklashes, removeBacklash } from "./backlash.js";
import { MODULE_ID } from "./constants.js";
import { setting, t, tf } from "./settings.js";
import {
  getWounds, woundCount, woundName, woundText, addWound, removeWound, setSuppressed, rollWound,
  treatWound, treatmentDC, resolvePermanent
} from "./wounds.js";
import {
  isShield, equippedShield, equippedArmour, currentAC, baseAC, lostAC, isImmune, recoveryRate, exemption,
  repairInfo, repairItem, activeShield, magicBonus
} from "./armour.js";
import { manualShieldBlock } from "./shield-block.js";
import { esc } from "./chat.js";
import { keyName } from "./tables.js";

export const TEMPLATE = `modules/${MODULE_ID}/templates/tracker.hbs`;
const LAST_HIT_WINDOW = 10 * 60 * 1000;
const DialogV2 = () => foundry.applications.api.DialogV2;

/* -------------------------------------------- */
/*  Context                                     */
/* -------------------------------------------- */

function rateLabel(item) {
  if (isImmune(item)) return t("Armour.Immune");
  const rate = recoveryRate(item);
  if (!rate) return "";
  return rate < 1 ? tf("Armour.RateSlow", { n: Math.round(1 / rate) }) : tf("Armour.Rate", { n: rate });
}

function armourEntry(item) {
  const base = baseAC(item);
  const cur = currentAC(item);
  const lost = lostAC(item);
  const shield = isShield(item);
  return {
    id: item.id,
    name: item.name,
    img: item.img,
    shield,
    cur, base, lost,
    bonus: magicBonus(item),
    pips: Array.from({ length: base }, (_, i) => ({ on: i < cur })),
    broken: shield && cur <= 0,
    rate: rateLabel(item),
    canRepair: lost > 0,
    repairLabel: shield ? t("Armour.Replace") : t("Armour.RepairButton")
  };
}

export function trackerContext(actor, { editable = actor.isOwner, tidy = false, pinnable = false, pinned = false } = {}) {
  const wounds = getWounds(actor);
  const seen = {};
  const list = wounds.map(w => {
    seen[w.key] = (seen[w.key] ?? 0) + 1;
    const def = CONFIG.SHR.WOUNDS[w.key];
    return {
      id: w.id,
      name: woundName(w),
      instance: seen[w.key] > 1 ? seen[w.key] : null,
      text: woundText(w),
      note: def ? w.note : "",
      img: def?.img ?? "icons/svg/blood.svg",
      permanent: w.permanent,
      suppressed: w.suppressed,
      result: w.result,
      repeatable: !!def?.repeatable
    };
  });
  const count = woundCount(actor, wounds);
  const shield = equippedShield(actor);
  const armour = [...(shield ? [shield] : []), ...equippedArmour(actor)].map(armourEntry);
  const hit = actor.getFlag(MODULE_ID, "lastHit");
  const exempt = exemption(actor);
  const pending = actor.getFlag(MODULE_ID, "pendingPermanent");
  return {
    veteran: veteranContext(actor),
    backlashes: getBacklashes(actor),
    actorUuid: actor.uuid,
    editable,
    tidy,
    pinnable,
    pinned,
    isGM: game.user.isGM,
    wounds: list,
    temporary: list.filter(w => !w.permanent),
    permanent: list.filter(w => w.permanent),
    count,
    total: list.length,
    armour,
    exempt: exempt ? t(`Armour.Exempt.${exempt}`) : "",
    pending: pending ? { id: pending.id, dc: pending.dc } : null,
    shieldBlock: editable && activeShield(actor) && hit && !hit.blocked && Date.now() - hit.time < LAST_HIT_WINDOW
      ? { amount: hit.amount, refund: hit.amount - Math.floor(hit.amount / 2) } : null
  };
}

/* -------------------------------------------- */
/*  Default dnd5e sheet                         */
/* -------------------------------------------- */

function findAnchor(root) {
  const sidebar = root.querySelector('[data-application-part="sidebar"]') ?? root.querySelector(".sheet-body .sidebar, .sidebar");
  if (sidebar) {
    const card = sidebar.querySelector(":scope > .card") ?? sidebar.querySelector(".card");
    return card ? { node: card, where: "afterend" } : { node: sidebar, where: "beforeend" };
  }
  const details = root.querySelector('.tab[data-tab="details"]');
  if (details) return { node: details, where: "afterbegin" };
  return { node: root.querySelector(".window-content") ?? root, where: "beforeend" };
}

/** renderCharacterActorSheet: inject the tracker into the main page's sidebar, under HP. */
export async function injectTracker(app, html) {
  const actor = app.actor ?? app.document;
  if (actor?.type !== "character") return;
  if (app.constructor?.name?.toLowerCase().includes("tidy")) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  if (!root) return;
  const markup = await foundry.applications.handlebars.renderTemplate(TEMPLATE, trackerContext(actor, { editable: app.isEditable }));
  root.querySelectorAll(".shr-tracker").forEach(el => el.remove());
  const { node, where } = findAnchor(root);
  node.insertAdjacentHTML(where, markup);
  bindTracker(root, actor);
}

/* -------------------------------------------- */
/*  Tidy 5e                                     */
/* -------------------------------------------- */

export const PERILS_TAB = `${MODULE_ID}-perils`;
export const isPinned = () => !!game.settings.get(MODULE_ID, "perilsPinned");

/** Classic layout: the right-hand column of the Attributes tab (favourites / pinned items). */
const CLASSIC_PANEL = '[data-tab-contents-for="attributes"] .attributes-tab-contents > .main-panel';

/** The first tab in a Quadrone sheet is the tab right after the sidebar container. */
const FIRST_TAB = '.main-content > [data-tidy-sheet-part="sidebar-container"] + .tidy-tab, .main-content > .sidebar + .tidy-tab';

export function registerTidy(api) {
  const isPc = context => context.actor?.type === "character";
  const perils = (options = {}) => new api.models.HandlebarsTab({
    title: "SHR.Tracker.Tab",
    tabId: PERILS_TAB,
    iconClass: "fa-solid fa-heart-crack",
    path: `/${TEMPLATE}`,
    tabContentsClasses: ["shr-tidy-tab"],
    enabled: context => isPc(context) && (options.hideWhenPinned ? !isPinned() : true),
    getData: async context => trackerContext(context.actor, {
      editable: context.editable ?? context.actor?.isOwner, tidy: true, pinnable: !!options.hideWhenPinned
    }),
    onRender: params => {
      const actor = params.data?.actor ?? params.app?.actor ?? params.app?.document;
      if (actor) bindTracker(params.tabContentsElement, actor);
    }
  });

  api.registerCharacterTab(perils({ hideWhenPinned: true }), { layout: "classic" });
  api.registerCharacterTab(perils({ hideWhenPinned: true }), { layout: "quadrone" });

  // Pinned: the same panel at the bottom of the first tab, under whatever list that tab shows.
  const pinned = selector => new api.models.HandlebarsContent({
    path: `/${TEMPLATE}`,
    injectParams: { selector, position: "beforeend" },
    enabled: context => isPc(context) && isPinned(),
    getData: async context => trackerContext(context.actor, {
      editable: context.editable ?? context.actor?.isOwner, tidy: true, pinnable: true, pinned: true
    }),
    onRender: params => {
      const actor = params.app?.actor ?? params.app?.document;
      const root = params.element?.querySelector(".shr-tracker.shr-pinned");
      if (actor && root) bindTracker(root, actor);
    }
  });
  api.registerCharacterContent(pinned(CLASSIC_PANEL), { layout: "classic" });
  api.registerCharacterContent(pinned(FIRST_TAB), { layout: "quadrone" });
}

/** Re-render every open player character sheet (used after the pin preference changes). */
export function refreshSheets() {
  for (const app of foundry.applications.instances.values()) {
    if (app.document?.documentName === "Actor" && app.document.type === "character" && app.rendered) app.render();
  }
}

/** Bookmark toggle: move the Perils panel between its own tab and the first tab of Tidy sheets. */
export async function togglePinned(actor) {
  const next = !isPinned();
  await game.settings.set(MODULE_ID, "perilsPinned", next);
  for (const app of foundry.applications.instances.values()) {
    if (app.document?.documentName !== "Actor" || app.document.type !== "character" || !("currentTabId" in app)) continue;
    if (next) {
      // The Perils tab is about to disappear: land on the first tab, where the panel now lives.
      if (app.currentTabId === PERILS_TAB) {
        app.currentTabId = app.element?.querySelector(FIRST_TAB)?.dataset.tabContentsFor ?? "attributes";
      }
    } else if (app.document === actor || app.document.id === actor.id) {
      app.currentTabId = PERILS_TAB;
    }
  }
  refreshSheets();
}

/* -------------------------------------------- */
/*  Controls                                    */
/* -------------------------------------------- */

export function bindTracker(root, actor) {
  const el = root?.classList?.contains("shr-tracker") ? root : root?.querySelector?.(".shr-tracker");
  if (!el || el._shrBound) return;
  el._shrBound = true;
  el.addEventListener("click", async event => {
    const target = event.target.closest("[data-shr-action]");
    if (!target || !el.contains(target) || target.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      await handleAction(target.dataset.shrAction, target, actor);
    } catch (err) {
      console.error(`${MODULE_ID} |`, err);
      ui.notifications.error(err.message);
    }
  });
}

async function handleAction(action, target, actor) {
  const woundId = target.closest("[data-wound-id]")?.dataset.woundId;
  const itemId = target.closest("[data-item-id]")?.dataset.itemId;
  switch (action) {
    case "pin": return togglePinned(actor);
    case "removeBacklash": return removeBacklash(actor, target.closest("[data-backlash-id]")?.dataset.backlashId);
    case "expand": return target.closest(".shr-wound")?.classList.toggle("expanded");
    case "add": return addWoundDialog(actor);
    case "roll": return rollWoundDialog(actor);
    case "remove": return removeWoundDialog(actor, woundId);
    case "treat": return treatDialog(actor, woundId);
    case "suppress": {
      const wound = getWounds(actor).find(w => w.id === woundId);
      return wound && setSuppressed(actor, woundId, !wound.suppressed);
    }
    case "repair": {
      const item = actor.items.get(itemId);
      return item && repairDialog(item);
    }
    case "shieldBlock": return manualShieldBlock(actor);
    case "permSave": return resolvePermanent(actor, target.dataset.pendingId);
  }
}

/* -------------------------------------------- */
/*  Dialogs                                     */
/* -------------------------------------------- */

function woundOptions() {
  const seen = new Set();
  const group = (table, label) => {
    const items = [];
    for (const [result, key] of Object.entries(CONFIG.SHR.TABLES[table].results)) {
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(`<option value="${key}">${esc(`${result} · ${keyName(key)}${CONFIG.SHR.WOUNDS[key].repeatable ? "*" : ""}`)}</option>`);
    }
    return items.length ? `<optgroup label="${label}">${items.join("")}</optgroup>` : "";
  };
  return `${group("main", t("Dialog.MainTable"))}${group("npc", t("Dialog.NpcTable"))}${group("permanent", t("Dialog.PermanentTable"))}
    <option value="custom">${t("Dialog.Custom")}</option>`;
}

async function addWoundDialog(actor) {
  const content = `<div class="shr-dialog">
    <div class="form-group"><label>${t("Dialog.Wound")}</label><select name="key">${woundOptions()}</select></div>
    <div class="form-group"><label>${t("Dialog.CustomName")}</label><input type="text" name="name"></div>
    <div class="form-group"><label>${t("Dialog.CustomPermanent")}</label><input type="checkbox" name="permanent"></div>
    <div class="form-group"><label>${t("Dialog.Note")}</label><input type="text" name="note"></div>
    <div class="form-group"><label>${t("Dialog.Immediate")}</label><input type="checkbox" name="immediate" checked></div>
    <p class="hint">${t("Dialog.AddHint")}</p>
  </div>`;
  const data = await DialogV2().prompt({
    window: { title: tf("Dialog.AddTitle", { name: actor.name }), icon: "fa-solid fa-plus" },
    content,
    ok: { label: t("Dialog.Add"), callback: (event, button) => readForm(button.form) },
    rejectClose: false
  });
  if (!data) return;
  if (data.key === "custom" && !data.name) return ui.notifications.warn(t("Notify.NeedName"));
  return addWound(actor, data.key, { name: data.name, permanent: data.permanent, note: data.note, immediate: data.immediate });
}

async function rollWoundDialog(actor) {
  const content = `<div class="shr-dialog">
    <div class="form-group"><label>${t("Dialog.Reason")}</label><select name="reason">
      <option value="zero">${t("Roll.Reason.zero")}</option>
      <option value="massive">${t("Roll.Reason.massive")}</option>
      <option value="manual" selected>${t("Roll.Reason.manual")}</option>
    </select></div>
    <div class="form-group"><label>${t("Dialog.Damage")}</label><input type="number" name="damage" value="0" min="0"></div>
    <p class="hint">${tf("Dialog.RollHint", { n: woundCount(actor) })}</p>
  </div>`;
  const data = await DialogV2().prompt({
    window: { title: tf("Dialog.RollTitle", { name: actor.name }), icon: "fa-solid fa-dice" },
    content,
    ok: { label: t("Dialog.Roll"), callback: (event, button) => readForm(button.form) },
    rejectClose: false
  });
  if (!data) return;
  return rollWound(actor, { reason: data.reason, damage: Number(data.damage) || 0 });
}

async function removeWoundDialog(actor, woundId) {
  const wound = getWounds(actor).find(w => w.id === woundId);
  if (!wound) return;
  const ok = await DialogV2().confirm({
    window: { title: t("Dialog.RemoveTitle") },
    content: `<p>${tf("Dialog.RemoveBody", { name: esc(woundName(wound)) })}</p>${wound.permanent ? `<p class="hint">${t("Dialog.RemovePermanent")}</p>` : ""}`,
    rejectClose: false
  });
  if (ok) return removeWound(actor, woundId);
}

function healerOptions(actor) {
  const actors = game.actors.filter(a => a.type === "character" && a.isOwner && a.id !== actor.id);
  return [actor, ...actors].map(a => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("");
}

async function treatDialog(actor, woundId) {
  const wound = getWounds(actor).find(w => w.id === woundId);
  if (!wound) return;
  const methods = ["kit", "grit", "potion", "longRest"].map((m, i) => {
    const dc = treatmentDC(actor, m);
    return `<label class="shr-radio"><input type="radio" name="method" value="${m}" ${i === 0 ? "checked" : ""}>
      <span><strong>${t(`Treat.Method.${m}`)}</strong>${dc ? ` <span class="shr-dc">DC ${dc}</span>` : ""}<br><span class="hint">${t(`Treat.Desc.${m}`)}</span></span></label>`;
  }).join("");
  const content = `<div class="shr-dialog">
    <p><strong>${esc(woundName(wound))}</strong></p>
    <div class="shr-methods">${methods}</div>
    <div class="form-group"><label>${t("Dialog.Healer")}</label><select name="healer">${healerOptions(actor)}</select></div>
  </div>`;
  const data = await DialogV2().prompt({
    window: { title: tf("Dialog.TreatTitle", { name: actor.name }), icon: "fa-solid fa-kit-medical" },
    content,
    ok: { label: t("Dialog.Treat"), callback: (event, button) => readForm(button.form) },
    rejectClose: false
  });
  if (!data) return;
  const healer = (await fromUuid(data.healer)) ?? actor;
  return treatWound(actor, woundId, data.method, healer);
}

async function repairDialog(item) {
  const info = repairInfo(item);
  const shield = isShield(item);
  const option = (value, label, detail, disabled = false, checked = false) =>
    `<label class="shr-radio ${disabled ? "disabled" : ""}"><input type="radio" name="method" value="${value}" ${disabled ? "disabled" : ""} ${checked ? "checked" : ""}>
      <span><strong>${label}</strong><br><span class="hint">${detail}</span></span></label>`;
  const methods = shield
    ? option("replace", t("Armour.Method.replace"), tf("Armour.MethodDesc.replace", { cost: info.price }), false, true)
    : option("craftsman", t("Armour.Method.craftsman"), tf("Armour.MethodDesc.craftsman", { cost: info.cost }), false, true)
      + option("party", t("Armour.Method.party"), tf("Armour.MethodDesc.party", { tools: info.tools }))
      + option("mending", t("Armour.Method.mending"), t(info.mending ? "Armour.MethodDesc.mending" : "Armour.MethodDesc.mendingNo"), !info.mending);
  const content = `<div class="shr-dialog">
    <p>${tf("Armour.RepairIntro", { name: esc(item.name), cur: currentAC(item), base: baseAC(item) })}</p>
    ${shield ? `<p class="hint">${t("Armour.ShieldNote")}</p>` : ""}
    <div class="shr-methods">${methods}</div>
    <div class="form-group"><label>${t("Armour.Pay")}</label><input type="checkbox" name="pay"></div>
  </div>`;
  const data = await DialogV2().prompt({
    window: { title: t("Armour.Repair.Title"), icon: "fa-solid fa-hammer" },
    content,
    ok: { label: shield ? t("Armour.Replace") : t("Armour.RepairButton"), callback: (event, button) => readForm(button.form) },
    rejectClose: false
  });
  if (!data) return;
  return repairItem(item, data.method, { pay: data.pay });
}

/** Read a dialog form into a plain object (checkboxes as booleans). */
function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") out[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) out[el.name] = el.value; }
    else out[el.name] = el.value;
  }
  return out;
}

/** Potion used while wounded: offer to subdue one temporary wound. */
export async function potionPrompt(actor) {
  const wounds = getWounds(actor).filter(w => !w.permanent && !w.suppressed);
  if (!wounds.length) return;
  const options = wounds.map(w => `<option value="${w.id}">${esc(woundName(w))}</option>`).join("");
  const data = await DialogV2().prompt({
    window: { title: t("Dialog.PotionTitle"), icon: "fa-solid fa-flask" },
    content: `<div class="shr-dialog"><p>${t("Dialog.PotionBody")}</p>
      <div class="form-group"><label>${t("Dialog.Wound")}</label><select name="wound"><option value="">${t("Dialog.None")}</option>${options}</select></div></div>`,
    ok: { label: t("Dialog.Subdue"), callback: (event, button) => readForm(button.form) },
    rejectClose: false
  });
  if (data?.wound) return treatWound(actor, data.wound, "potion");
}
