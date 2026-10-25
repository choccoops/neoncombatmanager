import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Registry } from "./registry.js";
import { Conditions } from "./engine.js";
import { CATEGORIES } from "./data.js";
import { CLT, fromClt } from "./clt.js";
import { OPS } from "./triggers.js";
import { ADD } from "./cpr-flags.js";
import { L, esc, shortDuration, slug, pageLabel } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { deepClone } = foundry.utils;

/** A change key in words: "All Actions", "REF", "Perception (sight)". */
export function keyLabel(key) {
  const k = String(key ?? "");
  const stat = k.match(/^system\.stats\.(\w+)\.(value|max)$/);
  if (stat) return stat[1].toUpperCase();
  const bonus = k.replace(/^bonuses\./, "");
  const own = `${LANG}.Key.${bonus}`;
  if (game.i18n.has(own)) return game.i18n.localize(own);
  const skill = `CPR.global.itemType.skill.${bonus}`;
  if (game.i18n.has(skill)) return game.i18n.localize(skill);
  return bonus.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** Foundry's name for a change mode other than ADD ("Custom", "Override"...), or "" for ADD. */
export function modeLabel(mode) {
  const m = mode ?? ADD;
  if (m === ADD) return "";
  const name = Object.entries(CONST.ACTIVE_EFFECT_MODES ?? {}).find(([, v]) => v === m)?.[0] ?? String(m);
  return name.charAt(0) + name.slice(1).toLowerCase();
}

/**
 * A change as the editor's row holds it. Changes from other modules can be CUSTOM (resolved by
 * their own hook, like Neon At Home's encumbrance) with a text value and a priority: those come
 * back exactly as they were, not as a number.
 * @param {Function} field - name => the row's input element
 */
export function changeFromRow(field) {
  const text = (n) => String(field(n)?.value ?? "").trim();
  const modeText = text("mode");
  const mode = modeText === "" || !Number.isFinite(Number(modeText)) ? ADD : Number(modeText);
  const raw = text("value");
  const number = Number(raw);
  let value = raw !== "" && Number.isFinite(number) ? number : raw;
  if (value === "" && mode === ADD) value = 0;
  const priorityText = text("priority");
  const change = { key: text("key"), value, mode, situational: !!field("situational")?.checked, onByDefault: !!field("onByDefault")?.checked };
  if (priorityText !== "" && Number.isFinite(Number(priorityText))) change.priority = Number(priorityText);
  return change;
}

/** A condition's mechanics in a line: "-2 All Actions · -4 MOVE · 1 min". */
export function summary(c) {
  const parts = (c.rawChanges ?? []).map((ch) => {
    const v = Number(ch.value);
    if ((ch.mode ?? ADD) !== ADD || !Number.isFinite(v)) return `${keyLabel(ch.key)}: ${ch.value}${(ch.mode ?? ADD) !== ADD ? ` (${modeLabel(ch.mode)})` : ""}`;
    return `${v > 0 ? "+" : ""}${v} ${keyLabel(ch.key)}${ch.situational ? "*" : ""}`;
  });
  if (c.duration) parts.push(shortDuration(c.duration));
  if (c.turnStart?.damage) parts.push(L(`${LANG}.Lab.TurnStartDamage`, { damage: c.turnStart.damage }));
  if (c.turnEnd?.damage) parts.push(L(`${LANG}.Lab.TurnEndDamage`, { damage: c.turnEnd.damage }));
  if (c.moveDamage) parts.push(L(`${LANG}.Lab.MoveDamage`, { damage: c.moveDamage }));
  if (c.critical) parts.push(L(`${LANG}.Lab.CriticalItem`));
  if (c.mirror === "wound") parts.push(L(`${LANG}.Lab.WoundMirror`));
  return parts.join(" · ");
}

/**
 * The Condition Lab: every condition, what it does and where it's from, with the GM's edits,
 * custom conditions, import/export and the Triggler.
 */
export class ConditionLab extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-lab`,
    classes: ["neon-combat", "ncm-window", "ncm-lab"],
    window: { icon: "fa-solid fa-flask", resizable: true },
    position: { width: 860, height: 720 },
    actions: {
      view: ConditionLab.#onView,
      edit: ConditionLab.#onEdit,
      create: ConditionLab.#onCreate,
      toggleHud: ConditionLab.#onToggleHud,
      reset: ConditionLab.#onReset,
      deleteCustom: ConditionLab.#onDelete,
      applyCondition: ConditionLab.#onApply,
      exportJson: ConditionLab.#onExport,
      importJson: ConditionLab.#onImport,
      importClt: ConditionLab.#onImportClt,
      openTriggers: ConditionLab.#onTriggers
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/lab.hbs`, scrollable: [".ncm-lab-list"] } };

  static open() {
    this.instance ??= new this();
    this.instance.render(true);
    return this.instance;
  }

  /** Category shown ("all" or one) and the search text. Not `state`: AppV2 owns that name. */
  _view = "all";
  _search = "";

  get title() {
    return L(`${LANG}.Lab.Title`);
  }

  _onClose(options) {
    super._onClose?.(options);
    ConditionLab.instance = null;
  }

  async _prepareContext() {
    const all = Registry.all();
    const cats = [...CATEGORIES, "custom"].filter((cat) => all.some((c) => c.category === cat));
    const q = slug(this._search);
    const list = all
      .filter((c) => this._view === "all" || c.category === this._view)
      .filter((c) => !q || slug(c.name).includes(q) || slug(c.hint).includes(q))
      .map((c) => ({
        id: c.id,
        name: c.name,
        img: c.img,
        hint: c.hint,
        category: L(`${LANG}.Category.${c.category}`),
        summary: summary(c),
        page: pageLabel(c.page),
        disabled: c.disabled,
        hud: c.hud !== false,
        override: c.override,
        custom: c.source === "custom",
        module: c.source === "module"
      }));
    return {
      gm: game.user.isGM,
      search: this._search,
      views: [{ id: "all", label: L(`${LANG}.Lab.All`), count: all.length, active: this._view === "all" },
        ...cats.map((cat) => ({ id: cat, label: L(`${LANG}.Category.${cat}`), count: all.filter((c) => c.category === cat).length, active: this._view === cat }))],
      list,
      cltPending: !!CLT.savedMap()?.length,
      shim: !!game.clt?.neon,
      cltActive: CLT.active
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const input = this.element.querySelector("input[name=search]");
    input?.addEventListener("input", (ev) => {
      this._search = ev.target.value;
      clearTimeout(this._searchTimer);
      this._searchTimer = setTimeout(async () => {
        await this.render();
        const box = this.element.querySelector("input[name=search]");
        box?.focus();
        box?.setSelectionRange(box.value.length, box.value.length);
      }, 200);
    });
  }

  static #onView(event, target) {
    this._view = target.dataset.view;
    this.render();
  }

  static #onEdit(event, target) {
    new ConditionEditor({ conditionId: target.closest("[data-id]").dataset.id }).render(true);
  }

  static #onCreate() {
    new ConditionEditor({ conditionId: null }).render(true);
  }

  static async #onToggleHud(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const c = Registry.get(id);
    await saveOverride(id, { disabled: !c.disabled });
    this.render();
  }

  static async #onReset(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const overrides = deepClone(Settings.get("conditionOverrides") ?? {});
    delete overrides[id];
    await Settings.set("conditionOverrides", overrides);
    Registry.refresh();
    this.render();
  }

  static async #onDelete(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    const ok = await Compat.DialogV2.confirm({ window: { title: L(`${LANG}.Lab.Delete`) }, content: `<p>${L(`${LANG}.Lab.DeleteConfirm`, { name: esc(Registry.get(id)?.name) })}</p>` });
    if (!ok) return;
    await Settings.set("customConditions", (Settings.get("customConditions") ?? []).filter((c) => c.id !== id));
    Registry.refresh();
    this.render();
  }

  /** Click an icon: toggle the condition on the selected tokens. */
  static async #onApply(event, target) {
    const id = target.closest("[data-id]").dataset.id;
    if (!canvas?.tokens?.controlled.length) return ui.notifications.warn(L(`${LANG}.Lab.SelectTokens`));
    await Conditions.toggle(id);
  }

  static #onExport() {
    const data = { module: MODULE_ID, version: game.modules.get(MODULE_ID)?.version, overrides: Settings.get("conditionOverrides"), custom: Settings.get("customConditions"), triggers: Settings.get("triggers") };
    const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
    save(JSON.stringify(data, null, 2), "application/json", `neon-conditions-${game.world.id}.json`);
  }

  static async #onImport() {
    const file = await pickFile();
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      return ui.notifications.error(L(`${LANG}.Lab.BadFile`));
    }
    // Condition Lab & Triggler's own export: { system, map }.
    if (Array.isArray(data?.map)) {
      const result = await CLT.migrate(data.map);
      ui.notifications.info(L(`${LANG}.Lab.CltImported`, result));
    } else {
      if (data.overrides) await Settings.set("conditionOverrides", data.overrides);
      if (Array.isArray(data.custom)) await Settings.set("customConditions", data.custom);
      if (Array.isArray(data.triggers)) await Settings.set("triggers", data.triggers);
      ui.notifications.info(L(`${LANG}.Lab.Imported`));
    }
    Registry.refresh();
    this.render();
  }

  static async #onImportClt() {
    const result = await CLT.migrate();
    if (result) ui.notifications.info(L(`${LANG}.Lab.CltImported`, result));
    this.render();
  }

  static #onTriggers() {
    new TriggerApp().render(true);
  }
}

/** Save part of a condition's override (built-in) or the custom condition itself. */
async function saveOverride(id, patch) {
  const custom = Settings.get("customConditions") ?? [];
  const i = custom.findIndex((c) => c.id === id);
  if (i >= 0) {
    const next = deepClone(custom);
    next[i] = { ...next[i], ...patch };
    await Settings.set("customConditions", next);
  } else {
    const overrides = deepClone(Settings.get("conditionOverrides") ?? {});
    overrides[id] = { ...(overrides[id] ?? {}), ...patch };
    await Settings.set("conditionOverrides", overrides);
  }
  Registry.refresh();
}

/** Every change key Cyberpunk RED's effect sheet offers, read from the system's own config. */
let KEYS = null;
async function cprKeys() {
  if (KEYS) return KEYS;
  try {
    const { default: config } = await import("../../../../systems/cyberpunk-red-core/modules/system/config.js");
    KEYS = Object.values(config?.activeEffectKeys ?? {}).flatMap((group) => Object.keys(group));
  } catch {
    KEYS = [];
  }
  return KEYS;
}

/** Ask for a JSON file. */
function pickFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
    input.click();
  });
}

/* -------------------------------------------- */
/*  Editor                                      */
/* -------------------------------------------- */

/** Edit a condition (built-in ones store the edits as an override; Reset brings the original back). */
export class ConditionEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["neon-combat", "ncm-window", "ncm-editor"],
    window: { icon: "fa-solid fa-pen-to-square", resizable: true },
    position: { width: 620, height: "auto" },
    actions: { addChange: ConditionEditor.#onAddChange, removeChange: ConditionEditor.#onRemoveChange, pickImg: ConditionEditor.#onPickImg, saveCondition: ConditionEditor.#onSave }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/lab-edit.hbs` } };

  constructor(options = {}) {
    super(options);
    this.conditionId = options.conditionId ?? null;
    const c = this.conditionId ? Registry.get(this.conditionId) : null;
    // What's being edited, kept between re-renders (adding a change row re-renders).
    this._draft = c
      ? {
        name: c.name,
        img: c.img,
        hint: c.hint,
        category: c.category,
        changes: deepClone(c.changes ?? []),
        sight: Number(c.sight) || 0,
        duration: Number(c.duration) || 0,
        overlay: !!c.overlay,
        defeated: !!c.defeated,
        hud: c.hud !== false,
        group: c.group ?? "",
        turnStart: c.turnStart?.damage ?? "",
        turnEnd: c.turnEnd?.damage ?? ""
      }
      : { name: "", img: "icons/svg/aura.svg", hint: "", category: "custom", changes: [], sight: 0, duration: 0, overlay: false, defeated: false, hud: true, group: "", turnStart: "", turnEnd: "" };
  }

  get title() {
    return this._draft.name ? L(`${LANG}.Lab.EditTitle`, { name: this._draft.name }) : L(`${LANG}.Lab.NewTitle`);
  }

  async _prepareContext() {
    const keys = await cprKeys();
    const fallbackKeys = ["bonuses.allActions", "bonuses.allActionsHands", "bonuses.allActionsSpeech", "bonuses.ranged", "bonuses.melee", "bonuses.universalAttack",
      "bonuses.initiative", "bonuses.deathSavePenalty", "bonuses.perceptionSight", "bonuses.perceptionHearing", "bonuses.hasPainSuppression",
      ...["int", "ref", "dex", "tech", "cool", "will", "move", "body"].map((s) => `system.stats.${s}.value`)];
    const custom = !this.conditionId || Registry.get(this.conditionId)?.source === "custom";
    return {
      ...this._draft,
      builtIn: !custom,
      categories: [...CATEGORIES, "custom"].map((cat) => ({ value: cat, label: L(`${LANG}.Category.${cat}`), selected: cat === this._draft.category })),
      changes: this._draft.changes.map((ch, i) => ({ ...ch, index: i, label: keyLabel(ch.key), priority: ch.priority ?? "", modeLabel: modeLabel(ch.mode) })),
      keys: [...new Set([...keys, ...fallbackKeys])].sort()
    };
  }

  /** Read the form into the draft. */
  _read() {
    const f = this.element;
    const val = (n) => f.querySelector(`[name="${n}"]`);
    const d = this._draft;
    d.name = val("name")?.value?.trim() ?? d.name;
    d.img = val("img")?.value?.trim() || d.img;
    d.hint = val("hint")?.value ?? d.hint;
    d.category = val("category")?.value ?? d.category;
    d.sight = Number(val("sight")?.value) || 0;
    d.duration = Number(val("duration")?.value) || 0;
    d.overlay = !!val("overlay")?.checked;
    d.defeated = !!val("defeated")?.checked;
    d.hud = !!val("hud")?.checked;
    d.group = val("group")?.value?.trim() ?? "";
    d.turnStart = val("turnStart")?.value?.trim() ?? "";
    d.turnEnd = val("turnEnd")?.value?.trim() ?? "";
    d.changes = [...f.querySelectorAll("[data-change]")].map((row) => changeFromRow((n) => row.querySelector(`[name=${n}]`))).filter((ch) => ch.key);
  }

  static #onAddChange() {
    this._read();
    this._draft.changes.push({ key: "bonuses.allActions", value: -2, situational: false, onByDefault: true });
    this.render();
  }

  static #onRemoveChange(event, target) {
    this._read();
    this._draft.changes.splice(Number(target.closest("[data-change]").dataset.change), 1);
    this.render();
  }

  static #onPickImg() {
    this._read();
    const FP = Compat.FilePicker;
    new FP({ type: "image", current: this._draft.img, callback: (path) => {
      this._draft.img = path;
      this.render();
    } }).render(true);
  }

  static async #onSave() {
    this._read();
    const d = this._draft;
    if (!d.name) return ui.notifications.warn(L(`${LANG}.Lab.NeedName`));
    const def = {
      name: d.name,
      img: d.img,
      hint: d.hint,
      changes: d.changes,
      sight: d.sight,
      duration: d.duration || null,
      overlay: d.overlay,
      defeated: d.defeated,
      hud: d.hud,
      group: d.group || null,
      turnStart: d.turnStart ? { ...(Registry.get(this.conditionId)?.turnStart ?? {}), damage: d.turnStart } : null,
      turnEnd: d.turnEnd ? { ...(Registry.get(this.conditionId)?.turnEnd ?? {}), damage: d.turnEnd } : null
    };
    const existing = this.conditionId ? Registry.get(this.conditionId) : null;
    if (!existing) {
      const id = `custom-${slug(d.name) || foundry.utils.randomID(6)}`;
      if (Registry.get(id)) return ui.notifications.warn(L(`${LANG}.Lab.Exists`, { name: esc(d.name) }));
      await Settings.set("customConditions", [...(Settings.get("customConditions") ?? []), { id, category: d.category, ...def }]);
      Registry.refresh();
    } else if (existing.source === "custom") {
      await saveOverride(existing.id, { category: d.category, ...def });
    } else {
      await saveOverride(existing.id, def);
    }
    ConditionLab.instance?.render();
    this.close();
  }
}

/* -------------------------------------------- */
/*  Triggler                                    */
/* -------------------------------------------- */

/** The GM's triggers: "when <path> <op> <value>, add/remove <condition>". */
export class TriggerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-triggers`,
    classes: ["neon-combat", "ncm-window", "ncm-triggers"],
    window: { icon: "fa-solid fa-bolt", resizable: true },
    position: { width: 900, height: "auto" },
    actions: { addTrigger: TriggerApp.#onAdd, removeTrigger: TriggerApp.#onRemove, saveTriggers: TriggerApp.#onSave }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/triggers.hbs` } };

  _rows = deepClone(Settings.get("triggers") ?? []);

  get title() {
    return L(`${LANG}.Triggers.Title`);
  }

  async _prepareContext() {
    const conditions = Registry.all().sort((a, b) => a.name.localeCompare(b.name));
    return {
      rows: this._rows.map((t, i) => ({
        ...t,
        index: i,
        ops: Object.keys(OPS).map((op) => ({ value: op, label: L(`${LANG}.Triggers.Op.${op}`), selected: op === t.op })),
        conditions: conditions.map((c) => ({ value: c.id, label: c.name, selected: c.id === t.condition })),
        actions: ["add", "remove"].map((a) => ({ value: a, label: L(`${LANG}.Triggers.Action.${a}`), selected: a === (t.action ?? "add") })),
        types: (t.types ?? []).join(", ")
      }))
    };
  }

  _read() {
    this._rows = [...this.element.querySelectorAll("[data-trigger]")].map((row) => {
      const v = (n) => row.querySelector(`[name=${n}]`);
      return {
        id: row.dataset.id || foundry.utils.randomID(8),
        label: v("label").value.trim(),
        path: v("path").value.trim(),
        op: v("op").value,
        value: v("value").value.trim(),
        condition: v("condition").value,
        action: v("action").value,
        revert: v("revert").checked,
        disabled: !v("enabled").checked,
        types: v("types").value.split(",").map((s) => s.trim()).filter(Boolean)
      };
    });
  }

  static #onAdd() {
    this._read();
    this._rows.push({ id: foundry.utils.randomID(8), label: "", path: "system.derivedStats.hp.value", op: "lte", value: "0", condition: "unconscious", action: "add", revert: true, disabled: false, types: ["character", "mook"] });
    this.render();
  }

  static #onRemove(event, target) {
    this._read();
    this._rows.splice(Number(target.closest("[data-trigger]").dataset.index), 1);
    this.render();
  }

  static async #onSave() {
    this._read();
    await Settings.set("triggers", this._rows.filter((t) => t.path && t.condition));
    ui.notifications.info(L(`${LANG}.Triggers.Saved`));
    this.close();
  }
}

export { fromClt };
