import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { catalog } from "./catalog.js";
import { Run } from "./run.js";
import { Hands } from "./hands.js";
import { HandsApp } from "./hands-app.js";
import { normalize, resolve, TEMPLATE, addPick, setGroup } from "./layout.js";
import { debounce, L, slug } from "../util.js";

/** Each built-in group's icon; a player's own groups carry theirs. */
export const GROUP_ICONS = {
  turn: "fa-solid fa-hourglass-half",
  weapons: "fa-solid fa-gun",
  skills: "fa-solid fa-dice",
  role: "fa-solid fa-diamond",
  net: "fa-solid fa-network-wired",
  chrome: "fa-solid fa-microchip",
  status: "fa-solid fa-person-falling",
  utility: "fa-solid fa-toolbox",
  macros: "fa-solid fa-terminal",
  stats: "fa-solid fa-chart-simple",
  gear: "fa-solid fa-capsules"
};

/** A group's name: the player's, else the built-in one. */
export const groupLabel = (g) => g.name || (g.source ? L(`${LANG}.Hud.Group.${g.id in GROUP_ICONS ? g.id : g.source}`) : L(`${LANG}.Hud.Group.own`));

/**
 * The Action HUD: a bar of a character's actions for the token you control (a player with none
 * gets their own character), grouped in tabs that open on hover or click. What's in it is each
 * player's own (scripts/hud/layout.js), kept on their user: one layout for all their characters,
 * and any number of per-character ones. Plain DOM, like the carousel; dragged where you want it.
 */
/** Keys whose number didn't work out, already named in the console (once each). */
const warned = new Set();

/**
 * A button's small yellow label, or "" when its number didn't work out: "NaN" tells nobody
 * anything. The key is named in the console once, so the number can be put right.
 */
export function cleanSub(entry) {
  const sub = entry?.sub === undefined || entry?.sub === null ? "" : String(entry.sub);
  if (!/NaN|undefined|null|Infinity/.test(sub)) return sub;
  if (!warned.has(entry.key)) {
    warned.add(entry.key);
    console.warn(`${MODULE_ID} | Action HUD: no number for "${entry.key}" (${sub})`);
  }
  return "";
}

export const Hud = {
  el: null,
  /** The group pinned open (a click), by id. */
  pinned: null,
  /** What the HUD is showing: { actor, token }. */
  current: null,

  init() {
    const soon = debounce(() => this.render(), 50);
    this.soon = soon;
    for (const h of ["controlToken", "canvasReady", "updateCombat", "createCombat", "deleteCombat", "createCombatant",
      "updateCombatant", "deleteCombatant", `${MODULE_ID}.refreshUI`]) {
      Hooks.on(h, () => soon());
    }
    for (const h of ["updateActor", "createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
      Hooks.on(h, (doc) => {
        const actor = doc?.documentName === "Actor" ? doc : doc?.parent;
        if (actor && actor === this.current?.actor) soon();
        if (actor && doc?.documentName !== "Actor") HandsApp.refresh(actor);
      });
    }
    Hooks.on("updateUser", (user) => user?.id === game.user?.id && soon());
    for (const h of ["createMacro", "updateMacro", "deleteMacro"]) Hooks.on(h, () => soon());
    Hands.init();
    game.keybindings.register(MODULE_ID, "toggleActionHud", {
      name: `${LANG}.Hud.Title`,
      hint: `${LANG}.Hud.KeyHint`,
      editable: [],
      onDown: () => {
        Settings.set("actionHud", !Settings.get("actionHud"));
        return true;
      }
    });
  },

  get enabled() {
    return !!Settings.get("actionHud");
  },

  /** Whose actions: the one token you control (and own), else (a player) your character. */
  target() {
    const controlled = globalThis.canvas?.tokens?.controlled ?? [];
    let token = controlled.length === 1 ? controlled[0] : null;
    let actor = token?.actor ?? null;
    if (!token && !controlled.length && !game.user.isGM) {
      actor = game.user.character ?? null;
      token = actor?.getActiveTokens?.()?.[0] ?? null;
    }
    if (!actor?.isOwner || !CPR.isMeat(actor)) return null;
    return { actor, token };
  },

  /* ---------------------------------------- */
  /*  Layouts (on the user)                   */
  /* ---------------------------------------- */

  _flags(user = game.user) {
    return user?.flags?.[MODULE_ID]?.hud ?? {};
  },

  /** The layout for a character: theirs if the player made one, else the player's own, else the template. */
  layoutFor(actor, user = game.user) {
    const f = this._flags(user);
    return normalize((actor && f.actors?.[actor.id]) ?? f.layout ?? TEMPLATE);
  },

  /** Has the player a layout for this character only? */
  hasOwn(actor, user = game.user) {
    return !!(actor && this._flags(user).actors?.[actor.id]);
  },

  /** Keep a layout: for the player's characters, or one character. */
  async saveLayout(layout, actor = null) {
    const path = actor ? `flags.${MODULE_ID}.hud.actors.${actor.id}` : `flags.${MODULE_ID}.hud.layout`;
    return game.user.update({ [path]: normalize(layout) });
  },

  /** Drop a character's own layout (they go back to the player's). */
  async clearLayout(actor) {
    if (!this.hasOwn(actor)) return null;
    return game.user.update({ [`flags.${MODULE_ID}.hud.actors.-=${actor.id}`]: null });
  },

  /* ---------------------------------------- */
  /*  Rendering                               */
  /* ---------------------------------------- */

  context(actor, token = null) {
    const groups = resolve(this.layoutFor(actor), catalog(actor, { token })).map((g) => ({
      ...g,
      label: groupLabel(g),
      icon: g.icon || GROUP_ICONS[g.source] || "fa-solid fa-star",
      open: g.id === this.pinned,
      entries: g.entries.map((e) => ({ ...e, run: e.run ?? e.key, sub: cleanSub(e) }))
    }));
    const hp = CPR.hp(actor);
    const state = Settings.get("actionHudState") ?? {};
    return {
      name: token?.name ?? actor.name,
      img: token?.document?.texture?.src ?? actor.img,
      hp,
      pct: hp.max ? Math.max(0, Math.min(100, Math.round((hp.value / hp.max) * 100))) : 0,
      luck: CPR.stat(actor, "luck"),
      wound: CPR.woundState(actor),
      collapsed: !!state.collapsed,
      groups
    };
  },

  async render() {
    const t = this.enabled ? this.target() : null;
    this.current = t;
    if (!t) return this.remove();
    const html = await Compat.renderTemplate(`${TEMPLATE_PATH}/action-hud.hbs`, this.context(t.actor, t.token));
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.id = "ncm-action-hud";
      this.el.className = "neon-combat ncm-ah";
      document.body.append(this.el);
      this._listen(this.el);
    }
    this.el.innerHTML = html;
    this.place();
  },

  remove() {
    this.el?.remove();
    this.el = null;
  },

  /** Where it sits: where the player dragged it, else above the hotbar. Panels open away from the edge. */
  place() {
    if (!this.el) return;
    const s = Settings.get("actionHudState") ?? {};
    const moved = Number.isFinite(s.left) && Number.isFinite(s.top);
    this.el.classList.toggle("is-placed", moved);
    if (moved) {
      const left = Math.max(0, Math.min(s.left, window.innerWidth - 120));
      const top = Math.max(0, Math.min(s.top, window.innerHeight - 40));
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
    } else {
      this.el.style.left = "";
      this.el.style.top = "";
    }
    const r = this.el.getBoundingClientRect();
    this.el.classList.toggle("opens-down", r.top < window.innerHeight * 0.4);
  },

  _listen(el) {
    el.addEventListener("click", (ev) => this._onClick(ev));
    el.addEventListener("contextmenu", (ev) => {
      // Right-click a tab: unpin it.
      if (ev.target.closest(".ncm-ah-tab")) {
        ev.preventDefault();
        this.pinned = null;
        this.render();
      }
    });
    // A macro dropped on the HUD (from the hotbar, the sidebar or a compendium) joins its Macros group.
    el.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      el.classList.add("is-drop");
    });
    el.addEventListener("dragleave", (ev) => {
      if (!el.contains(ev.relatedTarget)) el.classList.remove("is-drop");
    });
    el.addEventListener("drop", (ev) => {
      ev.preventDefault();
      el.classList.remove("is-drop");
      let data = null;
      try {
        data = JSON.parse(ev.dataTransfer.getData("text/plain"));
      } catch {
        return;
      }
      if (data?.type === "Macro") this.dropMacro(data).catch((err) => ui.notifications.error(err.message));
    });
    el.addEventListener("pointerdown", (ev) => {
      if (ev.button === 0 && ev.target.closest("[data-ah=drag]")) this._drag(ev);
    });
  },

  async _onClick(ev) {
    const run = ev.target.closest("[data-run]");
    const ah = ev.target.closest("[data-ah]")?.dataset.ah;
    if (run) {
      ev.preventDefault();
      const t = this.current;
      if (!t) return null;
      return Run.action(t.actor, run.dataset.run, { event: ev, token: t.token }).catch((err) => {
        console.error(`${MODULE_ID} | action HUD`, err);
        ui.notifications.error(err.message);
      });
    }
    switch (ah) {
      case "tab": {
        const id = ev.target.closest("[data-group]")?.dataset.group ?? null;
        this.pinned = this.pinned === id ? null : id;
        this.el?.querySelectorAll(".ncm-ah-group").forEach((g) => g.classList.toggle("is-open", g.dataset.group === this.pinned));
        return null;
      }
      case "who":
        return Compat.openSheet(this.current?.actor);
      case "edit": {
        const { HudEditor } = await import("./hud-editor.js");
        return HudEditor.open(this.current?.actor ?? null);
      }
      case "collapse": {
        const s = Settings.get("actionHudState") ?? {};
        await Settings.set("actionHudState", { ...s, collapsed: !s.collapsed });
        return this.render();
      }
      default:
        return null;
    }
  },

  /**
   * Add a dropped macro to the Macros group of the layout in use (this character's own, else the
   * player's), shown. One from a compendium is imported first, as the hotbar does.
   */
  async dropMacro(data) {
    let macro = await fromUuid(data.uuid);
    if (!macro) return null;
    if (macro.pack) {
      const Cls = getDocumentClass("Macro");
      const existing = game.macros.find((m) => m.name === macro.name && m.author?.id === game.user.id);
      macro = existing ?? await Cls.create({ ...macro.toObject(), _id: undefined, folder: null, ownership: { default: 0, [game.user.id]: 3 } });
    }
    if (!macro?.canExecute) {
      ui.notifications.warn(L(`${LANG}.Hud.MacroNoRun`, { name: macro?.name ?? "" }));
      return null;
    }
    const actor = this.current?.actor ?? null;
    const own = actor && this.hasOwn(actor);
    let layout = this.layoutFor(own ? actor : null);
    layout = addPick(layout, "macros", `macro:${slug(macro.name)}`);
    layout = setGroup(layout, "macros", { hidden: false });
    await this.saveLayout(layout, own ? actor : null);
    ui.notifications.info(L(`${LANG}.Hud.MacroAdded`, { name: macro.name }));
    return this.render();
  },

  /** Drag by the grip; where it lands is kept (per browser). */
  _drag(ev) {
    const el = this.el;
    const grip = ev.target.closest("[data-ah=drag]");
    const start = el.getBoundingClientRect();
    const dx = ev.clientX - start.left;
    const dy = ev.clientY - start.top;
    grip.setPointerCapture?.(ev.pointerId);
    el.classList.add("is-placed", "is-dragging");
    const move = (e) => {
      el.style.left = `${Math.max(0, e.clientX - dx)}px`;
      el.style.top = `${Math.max(0, e.clientY - dy)}px`;
    };
    const up = async () => {
      grip.removeEventListener("pointermove", move);
      grip.removeEventListener("pointerup", up);
      el.classList.remove("is-dragging");
      const r = el.getBoundingClientRect();
      const s = Settings.get("actionHudState") ?? {};
      await Settings.set("actionHudState", { ...s, left: Math.round(r.left), top: Math.round(r.top) });
      this.place();
    };
    grip.addEventListener("pointermove", move);
    grip.addEventListener("pointerup", up);
  },

  /** Back above the hotbar. */
  async resetPosition() {
    const s = Settings.get("actionHudState") ?? {};
    await Settings.set("actionHudState", { collapsed: !!s.collapsed });
    this.place();
  }
};
