import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { catalog } from "./catalog.js";
import { Hud, GROUP_ICONS, groupLabel } from "./hud.js";
import { SOURCES, TEMPLATE, normalize, template, moveGroup, setGroup, setAuto, addPick, removePick, movePick, addGroup, removeGroup } from "./layout.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** A key with nothing behind it on this character, readable: "skill:meleeweapon" -> "meleeweapon". */
const bare = (key) => String(key).split(":").slice(1).join(":") || key;

/**
 * Customize the Action HUD: show, hide, rename and reorder its groups, choose and order the
 * actions in each (or let a group show everything it has), and add groups of your own that mix
 * actions from anywhere. A layout is for all your characters, or for one of them only.
 */
export class HudEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-hud-editor`,
    classes: ["neon-combat", "ncm-window", "ncm-ah-editor"],
    window: { icon: "fa-solid fa-sliders", resizable: true },
    position: { width: 560, height: 640 },
    actions: {
      grpUp: HudEditor.#onGroup,
      grpDown: HudEditor.#onGroup,
      grpHide: HudEditor.#onGroup,
      grpRemove: HudEditor.#onGroup,
      pickRemove: HudEditor.#onPick,
      pickLeft: HudEditor.#onPick,
      pickRight: HudEditor.#onPick,
      addGroup: HudEditor.#onAddGroup,
      resetLayout: HudEditor.#onReset,
      saveLayout: HudEditor.#onSave,
      clearOwn: HudEditor.#onClearOwn
    }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/action-hud-editor.hbs`, scrollable: [".ncm-ahe-groups"] } };

  /** Open for a character (the HUD's), at their own layout if they have one. */
  static open(actor = null) {
    this.instance ??= new this();
    const app = this.instance;
    app._actorId = actor?.id ?? null;
    app._scope = actor && Hud.hasOwn(actor) ? "actor" : "me";
    app._load();
    app.render(true);
    return app;
  }

  get title() {
    return L(`${LANG}.Hud.Customize`);
  }

  get actor() {
    return this._actorId ? game.actors.get(this._actorId) ?? null : null;
  }

  /** Start from what's kept for the scope: the character's own layout, or the player's. */
  _load() {
    const f = Hud._flags();
    this.layout = this._scope === "actor" && this.actor ? Hud.layoutFor(this.actor) : normalize(f.layout ?? TEMPLATE);
  }

  _onClose(options) {
    super._onClose?.(options);
    HudEditor.instance = null;
  }

  async _prepareContext() {
    const actor = this.actor;
    const cat = actor ? catalog(actor, { token: Hud.current?.actor === actor ? Hud.current.token : null }) : {};
    const all = new Map();
    for (const s of SOURCES) for (const e of cat[s] ?? []) all.set(e.key, { ...e, source: s });
    const label = (key) => all.get(key)?.label ?? bare(key);
    const groups = this.layout.groups.map((g, i, list) => {
      const pool = g.source ? cat[g.source] ?? [] : [...all.values()];
      const picked = new Set(g.picks ?? []);
      const addable = pool.filter((e) => !picked.has(e.key));
      return {
        id: g.id,
        label: groupLabel(g),
        placeholder: g.source ? groupLabel({ ...g, name: "" }) : L(`${LANG}.Hud.Group.own`),
        name: g.name,
        icon: g.icon || GROUP_ICONS[g.source] || "fa-solid fa-star",
        custom: !g.source,
        hidden: g.hidden,
        auto: g.picks === null,
        canAuto: !!g.source,
        // Everything an automatic group shows, as text.
        autoList: g.picks === null ? pool.map((e) => e.label).join(", ") : "",
        chips: (g.picks ?? []).map((k) => ({ key: k, label: label(k), missing: !all.has(k) })),
        // A group of your own picks from every source: the choices come under their group's name.
        addable: g.source
          ? [{ label: "", options: addable.map((e) => ({ key: e.key, label: e.label })) }]
          : SOURCES.map((s) => ({ label: groupLabel({ id: s, source: s, name: "" }), options: addable.filter((e) => e.source === s).map((e) => ({ key: e.key, label: e.label })) })).filter((o) => o.options.length),
        first: i === 0,
        last: i === list.length - 1
      };
    });
    return {
      actor: actor ? { name: actor.name, img: actor.img } : null,
      scope: this._scope,
      hasOwn: actor ? Hud.hasOwn(actor) : false,
      groups
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const el = this.element;
    el.querySelector("[name=scope]")?.addEventListener("change", (ev) => {
      this._scope = ev.target.value;
      this._load();
      this.render();
    });
    for (const input of el.querySelectorAll("[name=groupName]")) {
      input.addEventListener("change", (ev) => {
        this.layout = setGroup(this.layout, ev.target.closest("[data-group]").dataset.group, { name: ev.target.value.trim() });
        this.render();
      });
    }
    for (const box of el.querySelectorAll("[name=auto]")) {
      box.addEventListener("change", (ev) => {
        const id = ev.target.closest("[data-group]").dataset.group;
        const current = [...ev.target.closest("[data-group]").querySelectorAll("[data-key]")].map((x) => x.dataset.key);
        this.layout = setAuto(this.layout, id, ev.target.checked, current);
        this.render();
      });
    }
    for (const sel of el.querySelectorAll("[name=addPick]")) {
      sel.addEventListener("change", (ev) => {
        if (!ev.target.value) return;
        this.layout = addPick(this.layout, ev.target.closest("[data-group]").dataset.group, ev.target.value);
        this.render();
      });
    }
  }

  static #onGroup(event, target) {
    const id = target.closest("[data-group]").dataset.group;
    const g = this.layout.groups.find((x) => x.id === id);
    switch (target.dataset.action) {
      case "grpUp":
        this.layout = moveGroup(this.layout, id, -1);
        break;
      case "grpDown":
        this.layout = moveGroup(this.layout, id, 1);
        break;
      case "grpHide":
        this.layout = setGroup(this.layout, id, { hidden: !g?.hidden });
        break;
      case "grpRemove":
        this.layout = removeGroup(this.layout, id);
        break;
      default:
    }
    this.render();
  }

  static #onPick(event, target) {
    const id = target.closest("[data-group]").dataset.group;
    const key = target.closest("[data-key]").dataset.key;
    if (target.dataset.action === "pickRemove") this.layout = removePick(this.layout, id, key);
    else this.layout = movePick(this.layout, id, key, target.dataset.action === "pickLeft" ? -1 : 1);
    this.render();
  }

  static #onAddGroup() {
    this.layout = addGroup(this.layout, "");
    this.render();
  }

  static #onReset() {
    this.layout = template();
    this.render();
  }

  static async #onSave() {
    await Hud.saveLayout(this.layout, this._scope === "actor" ? this.actor : null);
    ui.notifications.info(L(`${LANG}.Hud.Saved`));
    this.close();
  }

  static async #onClearOwn() {
    if (!this.actor) return;
    await Hud.clearLayout(this.actor);
    this._scope = "me";
    this._load();
    this.render();
  }
}
