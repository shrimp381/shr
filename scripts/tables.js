/**
 * Wound roll tables as real RollTable documents.
 *
 * The three tables ("Wounds & Injuries", "Wounds & Injuries (NPC)", "Permanent Wound") are created in the
 * world the first time a GM loads it, so they can be edited like any other roll table: change a result's
 * text, move ranges around to change how severe wounds are, delete results to shrink a table, add new ones.
 * Every load (and every edit) the tables are compiled into CONFIG.SHR.TABLES, which the rules use.
 *
 * Reading a result:
 *  - name / description: the wound's name and text. Like the rules doc, the text may be written as
 *    "Name*. Text" in the description with the name field left empty, or the name can be in the name field.
 *  - a * after the name marks a repeatable wound (it skips the duplicate check on that table).
 *  - the automation (conditions, Active Effects, exhaustion, ...) is picked by the wound's name, so
 *    "Concussion" always gives the Dazed condition. A result the module doesn't know is a custom wound:
 *    it is tracked and shown on the sheet, but has no automation.
 *  - on the two 2d6 tables, a result called "Permanent Wound" sends the roll to the Permanent Wound table.
 */
import { MODULE_ID, WOUNDS, normalizeAuto, specFromDef } from "./constants.js";
import { DEFAULT_TABLES } from "./table-data.js";

export const TABLE_IDS = ["main", "npc", "permanent"];
const DEFAULT_IMG = "icons/svg/d20-black.svg";
const FOLDER_NAME = "Shrimp's Homebrew Rules";

/* -------------------------------------------- */
/*  Parsing (pure)                              */
/* -------------------------------------------- */

/** Plain text from a table result: strips markup, turns @condition[prone] into "prone". */
export function clean(value) {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/@\w+\[([^\]]*)\](?:\{([^}]*)\})?/g, (m, a, b) => b || a)
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a result into {name, text, repeatable}. */
export function parseEntry(name, description) {
  let title = clean(name);
  let text = clean(description);
  if (!title) {
    const m = text.match(/^(.+?)\.\s+(.*)$/s);
    if (m) { title = m[1]; text = m[2]; } else { title = text.replace(/\.$/, ""); text = ""; }
  }
  const repeatable = /\*\s*$/.test(title);
  title = title.replace(/\*\s*$/, "").trim();
  return { name: title, text, repeatable };
}

const norm = s => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Wound key by name, from the default tables ("permanent wound" → "permanent"). */
const NAME_TO_KEY = (() => {
  const map = new Map();
  for (const table of Object.values(DEFAULT_TABLES)) {
    for (const r of table.results) map.set(norm(parseEntry("", r.description).name), r.key);
  }
  return map;
})();

/** Which wound a result is: a known wound (by flag, then by name), the Permanent Wound band, or custom. */
export function keyFor({ flagKey, name, id }, tableId) {
  const valid = k => k && (k === "permanent" ? tableId !== "permanent" : !!WOUNDS[k] || String(k).startsWith("custom-"));
  const named = NAME_TO_KEY.get(norm(name));
  if (named && valid(named)) {
    // A result renamed by the GM keeps its flag; an unflagged one is matched by name.
    if (!flagKey || !valid(flagKey) || norm(name) === norm(nameOfKey(flagKey))) return named;
  }
  if (valid(flagKey) && !String(flagKey).startsWith("custom-")) return flagKey;
  return `custom-${id ?? norm(name).replace(/ /g, "-")}`;
}

const NAMES = (() => {
  const map = {};
  for (const table of Object.values(DEFAULT_TABLES)) {
    for (const r of table.results) map[r.key] ??= parseEntry("", r.description).name;
  }
  return map;
})();
const nameOfKey = key => NAMES[key] ?? "";
export const defaultName = key => nameOfKey(key);

/**
 * Compile a list of result entries into the structure the rules use.
 * @param {"main"|"npc"|"permanent"} id
 * @param {Array<{lo:number,hi:number,key:string,name:string,text:string,repeatable:boolean}>} entries
 * @param {string} formula
 */
export function compileTable(id, entries, formula) {
  const results = {};
  const repeat = {};
  const details = {};
  let permanentMax = 0;
  for (const e of entries) {
    const lo = Math.floor(e.lo);
    const hi = Math.min(Math.floor(e.hi), lo + 200);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    for (let v = lo; v <= hi; v++) {
      if (e.key === "permanent" && id !== "permanent") { permanentMax = Math.max(permanentMax, v); continue; }
      results[v] = e.key;
      repeat[v] = !!e.repeatable;
      details[v] = { name: e.name, text: e.text, auto: e.auto ?? null };
    }
  }
  const values = Object.keys(results).map(Number);
  const lowest = values.length ? Math.min(...values) : 1;
  return {
    die: formula,
    min: id === "permanent" ? lowest : (permanentMax ? Math.max(permanentMax + 1, 1) : lowest),
    max: values.length ? Math.max(...values) : (id === "permanent" ? 6 : 12),
    results, repeat, entries: details
  };
}

export function defaultEntries(id) {
  return DEFAULT_TABLES[id].results.map(r => {
    const p = parseEntry("", r.description);
    return { lo: r.range[0], hi: r.range[1], key: r.key, ...p, id: r.key };
  });
}

/* -------------------------------------------- */
/*  Finding and reading the world tables        */
/* -------------------------------------------- */

/** The world's RollTable for one of our tables: by flag, else by its exact default name. */
export function findTable(id) {
  const tables = game.tables?.contents ?? [];
  return tables.find(t => t.getFlag(MODULE_ID, "tableId") === id)
    ?? tables.find(t => t.name === DEFAULT_TABLES[id].name && !t.getFlag(MODULE_ID, "tableId"));
}

function entriesFromTable(id, table) {
  const entries = [];
  for (const r of table.results) {
    if (r.type && r.type !== "text" && r.type !== "document" && r.type !== 0 && r.type !== 1) continue;
    const [lo, hi] = r.range ?? [];
    const p = parseEntry(r.name, r.description ?? r.text);
    if (!p.name) continue;
    const key = keyFor({ flagKey: r.getFlag?.(MODULE_ID, "key"), name: p.name, id: r.id }, id);
    const flag = r.getFlag?.(MODULE_ID, "auto");
    entries.push({ lo, hi, key, ...p, id: r.id, img: r.img, auto: flag ? normalizeAuto(flag) : null });
  }
  return entries;
}

function validFormula(formula, fallback) {
  const f = String(formula ?? "").replace(/[{}]/g, "").trim();
  if (!f) return fallback;
  try { if (typeof Roll.validate === "function" && !Roll.validate(f)) return fallback; } catch (err) { return fallback; }
  return f;
}

/**
 * Compile the world's tables (or the defaults where a table doesn't exist) into CONFIG.SHR.TABLES,
 * and update CONFIG.SHR.WOUNDS to match (names, repeatable flags, custom wounds).
 */
export function loadTables() {
  if (!CONFIG.SHR) return;
  const wounds = CONFIG.SHR.WOUNDS;
  // Custom wounds from the previous load are rebuilt below.
  for (const key of Object.keys(wounds)) if (wounds[key].custom) delete wounds[key];
  const seenRepeat = {};
  const tables = {};
  for (const id of TABLE_IDS) {
    const doc = findTable(id);
    const entries = doc ? entriesFromTable(id, doc) : defaultEntries(id);
    const fallback = DEFAULT_TABLES[id].formula;
    tables[id] = compileTable(id, entries, doc ? validFormula(doc.formula, fallback) : fallback);
    tables[id].uuid = doc?.uuid ?? null;
    for (const e of entries) {
      if (e.key === "permanent") continue;
      if (e.key.startsWith("custom-")) {
        wounds[e.key] = { custom: true, permanent: id === "permanent", repeatable: e.repeatable, img: e.img && e.img !== DEFAULT_IMG ? e.img : "icons/svg/blood.svg", name: e.name, text: e.text, auto: e.auto };
        continue;
      }
      seenRepeat[e.key] = (seenRepeat[e.key] ?? false) || e.repeatable;
      wounds[e.key].name = wounds[e.key].name ?? e.name;
      wounds[e.key].text = wounds[e.key].text ?? e.text;
    }
  }
  for (const [key, repeatable] of Object.entries(seenRepeat)) wounds[key].repeatable = repeatable;
  Object.assign(CONFIG.SHR.TABLES, tables);
}

/** Name and text of a wound definition (from the tables). */
export function keyName(key) {
  return CONFIG.SHR.WOUNDS[key]?.name ?? defaultName(key) ?? key;
}

/* -------------------------------------------- */
/*  Creating and resetting                      */
/* -------------------------------------------- */

async function tableFolder() {
  const found = game.folders?.find(f => f.type === "RollTable" && f.name === FOLDER_NAME);
  if (found) return found.id;
  try { return (await Folder.create({ name: FOLDER_NAME, type: "RollTable" }))?.id ?? null; } catch (err) { return null; }
}

function resultData(id, r) {
  const entry = DEFAULT_TABLES[id];
  return {
    type: "text", img: DEFAULT_IMG, weight: 1, range: r.range, drawn: false,
    name: "", description: r.description, flags: { [MODULE_ID]: { key: r.key } }
  };
}

async function createTable(id) {
  const d = DEFAULT_TABLES[id];
  const folder = await tableFolder();
  return RollTable.create({
    name: d.name, description: d.description, formula: d.formula, replacement: true, displayRoll: true,
    ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS?.OBSERVER ?? 2 },
    folder, flags: { [MODULE_ID]: { tableId: id } },
    results: d.results.map(r => resultData(id, r))
  });
}

/** Create any wound table that doesn't exist yet (active GM only). */
export async function ensureTables() {
  if (!game.user.isActiveGM) return;
  for (const id of TABLE_IDS) {
    const existing = findTable(id);
    if (existing) {
      if (!existing.getFlag(MODULE_ID, "tableId")) await existing.setFlag(MODULE_ID, "tableId", id);
      continue;
    }
    try { await createTable(id); } catch (err) { console.error(`${MODULE_ID} | could not create the ${id} table`, err); }
  }
  loadTables();
}

/** Put one or all tables back to the defaults (GM). */
export async function resetTables(which = TABLE_IDS) {
  for (const id of [].concat(which)) {
    const doc = findTable(id);
    if (!doc) { await createTable(id); continue; }
    const d = DEFAULT_TABLES[id];
    await doc.deleteEmbeddedDocuments("TableResult", doc.results.map(r => r.id));
    await doc.update({ formula: d.formula, description: d.description, replacement: true });
    await doc.createEmbeddedDocuments("TableResult", d.results.map(r => resultData(id, r)));
    await doc.setFlag(MODULE_ID, "tableId", id);
  }
  loadTables();
}

/* -------------------------------------------- */
/*  Live updates                                */
/* -------------------------------------------- */

export function registerTableHooks() {
  const reload = foundry.utils.debounce(() => loadTables(), 150);
  const ours = doc => {
    const table = doc?.documentName === "RollTable" ? doc : doc?.parent;
    if (!table) return false;
    return !!table.getFlag?.(MODULE_ID, "tableId") || TABLE_IDS.some(id => table.name === DEFAULT_TABLES[id].name);
  };
  for (const name of ["createRollTable", "updateRollTable", "deleteRollTable", "createTableResult", "updateTableResult", "deleteTableResult"]) {
    Hooks.on(name, doc => { if (ours(doc)) reload(); });
  }
}

/* -------------------------------------------- */
/*  Settings menu                               */
/* -------------------------------------------- */

/** A settings-menu entry that opens a small dialog instead of a form: open a table, or reset them. */
export function makeTablesMenu() {
  const T = key => game.i18n.localize(`SHR.${key}`);
  return class TablesMenu extends foundry.applications.api.ApplicationV2 {
    async render() {
      const Dialog = foundry.applications.api.DialogV2;
      const button = (action, label, icon) => ({ action, label, icon, callback: () => action });
      const choice = await Dialog.wait({
        window: { title: T("Tables.MenuTitle"), icon: "fa-solid fa-table-list" },
        content: `<div class="shr-dialog"><p>${T("Tables.MenuBody")}</p></div>`,
        buttons: [
          button("main", T("Tables.Main"), "fa-solid fa-heart-crack"),
          button("npc", T("Tables.Npc"), "fa-solid fa-skull"),
          button("permanent", T("Tables.Permanent"), "fa-solid fa-bone"),
          button("reset", T("Tables.Reset"), "fa-solid fa-rotate-left")
        ],
        rejectClose: false
      });
      if (!choice) return this;
      if (choice === "reset") {
        const ok = await Dialog.confirm({
          window: { title: T("Tables.ResetTitle"), icon: "fa-solid fa-rotate-left" },
          content: `<div class="shr-dialog"><p>${T("Tables.ResetBody")}</p></div>`, rejectClose: false
        });
        if (ok) { await resetTables(); ui.notifications.info(T("Tables.ResetDone")); }
        return this;
      }
      let doc = findTable(choice);
      if (!doc) { await ensureTables(); doc = findTable(choice); }
      doc?.sheet?.render(true);
      return this;
    }
  };
}

/* -------------------------------------------- */
/*  Automation controls on a table result       */
/* -------------------------------------------- */

const lc = key => game.i18n.localize(key);

/**
 * Add "Wound automation" to the result editor: pick the conditions and effects a wound applies when it is
 * rolled. Stored on the result (flags.shr.auto). Left untouched, a known wound keeps its built-in automation.
 */
export function injectAutomation(app, html) {
  const result = app.document ?? app.object;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? app.element;
  if (!result || !root || root.querySelector(".shr-automation")) return;
  const table = result.parent;
  const tableId = TABLE_IDS.find(id => table?.getFlag?.(MODULE_ID, "tableId") === id || table?.name === DEFAULT_TABLES[id].name);
  if (!tableId) return;
  const p = parseEntry(result.name, result.description ?? result.text);
  const key = keyFor({ flagKey: result.getFlag?.(MODULE_ID, "key"), name: p.name, id: result.id }, tableId);
  if (key === "permanent") return;
  const flag = result.getFlag?.(MODULE_ID, "auto");
  const spec = normalizeAuto(flag ?? specFromDef(CONFIG.SHR.WOUNDS[key]));

  const F = foundry.applications.fields;
  const statusOptions = CONFIG.statusEffects
    .filter(s => s.id && s.name)
    .map(s => ({ value: s.id, label: lc(s.name) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const skillOptions = Object.entries(CONFIG.DND5E?.skills ?? {}).map(([value, s]) => ({ value, label: lc(s.label ?? value) }));
  const N = "flags." + MODULE_ID + ".auto.";
  const group = (label, hint, input) => {
    const g = F.createFormGroup({ label, hint, input, localize: false });
    return g;
  };
  const multi = (name, options, value) => F.createMultiSelectInput({ name: N + name, options, value });
  const check = (name, value) => F.createCheckboxInput({ name: N + name, value });
  const number = (name, value) => F.createNumberInput({ name: N + name, value, min: 0, step: 1, integer: true });

  const fieldset = document.createElement("fieldset");
  fieldset.className = "shr-automation";
  fieldset.innerHTML = `<legend>${lc("SHR.Automation.Title")}</legend><p class="hint">${lc("SHR.Automation.Hint")}</p>`;
  fieldset.append(
    group(lc("SHR.Automation.Statuses"), lc("SHR.Automation.StatusesHint"), multi("statuses", statusOptions, spec.statuses)),
    group(lc("SHR.Automation.Escalate"), lc("SHR.Automation.EscalateHint"), multi("escalate", statusOptions, spec.escalate)),
    group(lc("SHR.Automation.Skills"), lc("SHR.Automation.SkillsHint"), multi("skills", skillOptions, spec.skills)),
    group(lc("SHR.Automation.Initiative"), "", check("initiative", spec.initiative)),
    group(lc("SHR.Automation.HalveHp"), "", check("halveHp", spec.halveHp)),
    group(lc("SHR.Automation.Speed"), lc("SHR.Automation.SpeedHint"), check("speed", spec.speed)),
    group(lc("SHR.Automation.Exhaustion"), "", number("exhaustion", spec.exhaustion)),
    group(lc("SHR.Automation.Prone"), "", check("prone", spec.prone)),
    group(lc("SHR.Automation.CloseCall"), lc("SHR.Automation.CloseCallHint"), check("closeCall", spec.closeCall)),
    group(lc("SHR.Automation.Fatal"), "", check("fatal", spec.fatal))
  );
  const form = root.tagName === "FORM" ? root : root.querySelector("form") ?? root;
  const footer = form.querySelector("footer.form-footer, footer");
  if (footer) footer.before(fieldset); else form.append(fieldset);
  app.setPosition?.({ height: "auto" });
}
