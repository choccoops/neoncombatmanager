import { MODULE_ID, TEMPLATE_PATH, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { CombatTime } from "./time.js";
import { Sources } from "../environment/sources.js";
import { WEATHER_CONDITION } from "../environment/weather-data.js";
import { Awareness } from "../awareness/awareness.js";
import { debounce, formatElapsed, L } from "../util.js";

const WOUND_TONE = { notWounded: "ok", lightlyWounded: "light", seriouslyWounded: "serious", mortallyWounded: "mortal" };

/**
 * The Initiative Queue as a carousel across the top of the screen: one card per combatant
 * with portrait, Initiative, HP (as much as this user may see), Wound State and conditions;
 * the Round, combat time and Night City time; the weather; and the controls to run it.
 * Plain DOM in #ui-top (no Application window), so it behaves the same on v12 and v13.
 */
export const Carousel = {
  el: null,

  init() {
    const soon = debounce(() => this.render(), 60);
    this.soon = soon;
    for (const h of ["createCombat", "updateCombat", "deleteCombat", "createCombatant", "updateCombatant", "deleteCombatant",
      "updateActor", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateToken", "canvasReady",
      "updateWorldTime", "updateItem", `${MODULE_ID}.refreshUI`, `${MODULE_ID}.environmentChanged`]) {
      Hooks.on(h, () => soon());
    }
    // Keep the queue reachable when the sidebar is toggled.
    Hooks.on("collapseSidebar", () => setTimeout(() => this.place(), 250));
    Hooks.on("renderSceneNavigation", () => this.place());
    window.addEventListener("resize", debounce(() => this.place(), 100));
    // The clock's 12/24-hour format follows SmallTime's setting, as Neon Hub's calendar does.
    Hooks.on("updateSetting", (setting) => {
      if (String(setting?.key ?? "").startsWith("smalltime.")) soon();
    });
    Hooks.on("clientSettingChanged", (key) => {
      if (String(key).startsWith("smalltime.")) soon();
    });
  },

  get enabled() {
    return !!Settings.get("carouselEnabled");
  },

  /** The combat this user is looking at. */
  get combat() {
    return game.combat ?? null;
  },

  async render() {
    const combat = this.combat;
    if (!this.enabled || !combat || !combat.combatants.size && !game.user.isGM) return this.remove();
    const data = this.context(combat);
    const html = await Compat.renderTemplate(`${TEMPLATE_PATH}/carousel.hbs`, data);
    if (!this.el) {
      this.el = document.createElement("section");
      this.el.id = "ncm-carousel";
      this.el.addEventListener("click", (ev) => this._onClick(ev));
      this.el.addEventListener("dblclick", (ev) => this._onDblClick(ev));
      this.el.addEventListener("contextmenu", (ev) => this._onContext(ev));
      this.el.addEventListener("pointerover", (ev) => this._onHover(ev, true));
      this.el.addEventListener("pointerout", (ev) => this._onHover(ev, false));
      // Fixed to the window, not slotted into #ui-top's flow: whatever else sits there (scene
      // tabs, notifications, a hub scene's hidden navigation) can't push it down.
      document.body.append(this.el);
    }
    const scroll = this.el.querySelector(".ncm-car-track")?.scrollLeft ?? 0;
    this.el.className = `neon-combat ncm-carousel size-${Settings.get("carouselSize")}${data.collapsed ? " is-collapsed" : ""}`;
    this.place();
    this.el.innerHTML = html;
    const track = this.el.querySelector(".ncm-car-track");
    if (track) {
      track.scrollLeft = scroll;
      const active = track.querySelector(".ncm-card.is-active");
      if (active && combat.combatant?.id !== this._lastActive) {
        this._lastActive = combat.combatant?.id;
        track.scrollTo({ left: active.offsetLeft - track.clientWidth / 2 + active.clientWidth / 2, behavior: "smooth" });
      }
    }
  },

  /**
   * The play area's top strip: { top, center, room } in pixels. Centred between the scene
   * controls and the sidebar (#ui-middle); top is the very top of the screen, or just under the
   * scene tabs with the "under the scene tabs" setting. The crew bar's top position uses it too.
   */
  area() {
    const middle = document.getElementById("ui-middle")?.getBoundingClientRect();
    const left = middle?.width ? middle.left : 0;
    const width = middle?.width ? middle.width : window.innerWidth;
    let top = 4;
    if (Settings.get("carouselPlacement") === "belowNav") {
      const nav = document.querySelector("#navigation, #scene-navigation");
      const r = nav?.getBoundingClientRect();
      if (r && r.height > 0 && getComputedStyle(nav).visibility !== "hidden") top = Math.round(r.bottom) + 4;
    }
    return { top, center: Math.round(left + width / 2), room: Math.max(240, Math.round(width - 16)) };
  },

  /** Put the carousel in the top strip. Hook cpr-neon-combat-manager.carouselPlaced follows. */
  place() {
    if (this.el) {
      const { top, center, room } = this.area();
      this.el.style.setProperty("--ncm-top", `${top}px`);
      this.el.style.setProperty("--ncm-center", `${center}px`);
      this.el.style.setProperty("--ncm-room", `${room}px`);
    }
    Hooks.callAll(`${MODULE_ID}.carouselPlaced`, this.el);
  },

  /** Where the carousel ends on screen (the pixel row below it), or null when it isn't showing. */
  get bottom() {
    const r = this.el?.getBoundingClientRect();
    return r && r.height ? Math.round(r.bottom) : null;
  },

  remove() {
    const was = !!this.el;
    this.el?.remove();
    this.el = null;
    if (was) Hooks.callAll(`${MODULE_ID}.carouselPlaced`, null);
  },

  context(combat) {
    const gm = game.user.isGM;
    const npcHealth = Settings.get("npcHealth");
    const cards = [];
    for (const cb of combat.turns ?? []) {
      const token = cb.token;
      const actor = cb.actor;
      const owner = cb.isOwner;
      const hiddenToMe = !gm && (cb.hidden || token?.hidden);
      if (hiddenToMe) continue;
      const showName = owner || gm || !token || [CONST.TOKEN_DISPLAY_MODES.HOVER, CONST.TOKEN_DISPLAY_MODES.ALWAYS].includes(token.displayName);
      const wound = actor && CPR.isMeat(actor) ? CPR.woundState(actor) : null;
      const hp = actor && CPR.isMeat(actor) ? CPR.hp(actor) : null;
      const friendly = actor?.hasPlayerOwner;
      const health = owner || gm || friendly ? "bar" : npcHealth;
      const dead = cb.defeated || (actor && Conditions.has("dead", actor));
      const conditions = actor ? this.effects(actor) : [];
      const solo = !!actor && (owner || gm) && Awareness.isSolo(actor);
      cards.push({
        id: cb.id,
        name: showName ? cb.name : L(`${LANG}.Carousel.Unknown`),
        img: cb.img ?? token?.texture?.src ?? actor?.img ?? "icons/svg/mystery-man.svg",
        initiative: cb.initiative ?? null,
        hasInit: cb.initiative !== null && cb.initiative !== undefined,
        canRoll: (owner || gm) && (cb.initiative === null || cb.initiative === undefined),
        active: combat.combatant?.id === cb.id && combat.started,
        defeated: dead,
        hidden: cb.hidden || token?.hidden,
        owner,
        disposition: token?.disposition ?? 0,
        friendly,
        showBar: hp && health === "bar",
        showWound: !!wound && health !== "hidden",
        hp: hp ? { ...hp, pct: hp.max ? Math.max(0, Math.min(100, Math.round((hp.value / hp.max) * 100))) : 0 } : null,
        wound,
        woundTone: WOUND_TONE[wound] ?? "ok",
        woundLabel: wound ? L(`${LANG}.Wound.${wound}`) : "",
        deathSave: wound === "mortallyWounded" && !dead ? CPR.deathSave(actor).penalty : null,
        conditions: conditions.slice(0, 6),
        more: Math.max(0, conditions.length - 6),
        moved: null,
        solo,
        awareness: solo ? Awareness.summary(actor) : "",
        awarenessSpent: solo && Awareness.spent(actor, combat)
      });
    }
    const current = combat.combatant;
    const myTurn = !!current?.isOwner && combat.started && !gm;
    const weather = this.weather();
    return {
      gm,
      collapsed: !!Settings.get("carouselCollapsed"),
      started: combat.started,
      round: combat.round,
      elapsed: formatElapsed(CombatTime.elapsed(combat)),
      clock: CombatTime.clock(),
      roundSeconds: CombatTime.roundSeconds,
      cards,
      myTurn,
      weather,
      count: combat.combatants.size
    };
  },

  /** Conditions and other temporary effects to show on a card: { img, name }. */
  effects(actor) {
    const out = [];
    const seen = new Set();
    for (const e of actor.temporaryEffects ?? actor.effects ?? []) {
      if (e.disabled || e.isSuppressed) continue;
      const c = Registry.ofEffect(e);
      const key = c?.id ?? e.id;
      if (seen.has(key)) continue;
      seen.add(key);
      // Wound States show as the badge, not an icon.
      if (c?.mirror === "wound") continue;
      out.push({ img: e.img ?? e.icon ?? c?.img, name: e.name, category: c?.category ?? "other" });
    }
    return out;
  },

  /** The weather chip: icons and names of the weather in effect where the combat is. */
  weather() {
    const w = Sources.weather();
    if (w.source === "off") return null;
    const scene = canvas?.scene;
    const mode = scene ? Sources.sceneMode(scene) : "outdoor";
    const items = w.keys.map((k) => Registry.get(WEATHER_CONDITION[k])).filter(Boolean).map((c) => ({ img: c.img, name: c.name }));
    return { items, indoor: mode !== "outdoor", label: items.map((i) => i.name).join(" · ") || L(`${LANG}.Weather.clear`), source: w.source };
  },

  /* ---------------------------------------- */
  /*  Interaction                             */
  /* ---------------------------------------- */

  _combatant(ev) {
    const li = ev.target.closest?.(".ncm-card");
    return li ? this.combat?.combatants.get(li.dataset.combatantId) ?? null : null;
  },

  async _onClick(ev) {
    const btn = ev.target.closest("[data-ncm]");
    const combat = this.combat;
    if (!combat) return;
    const cb = this._combatant(ev);
    if (btn) {
      ev.preventDefault();
      ev.stopPropagation();
      return this._action(btn.dataset.ncm, combat, cb, ev);
    }
    if (!cb) return;
    // Click a card: select (if yours) and look at the token.
    const token = cb.token?.object;
    if (!token) return;
    if (token.isOwner) token.control({ releaseOthers: !ev.shiftKey });
    if (token.visible) canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
  },

  _onDblClick(ev) {
    const cb = this._combatant(ev);
    if (cb?.actor?.testUserPermission(game.user, "OBSERVER")) Compat.openSheet(cb.actor);
  },

  _onContext(ev) {
    const cb = this._combatant(ev);
    if (!cb || !game.user.isGM) return;
    ev.preventDefault();
    const token = cb.token?.object;
    if (token) token.setTarget(!token.isTargeted, { releaseOthers: !ev.shiftKey });
  },

  _onHover(ev, over) {
    const li = ev.target.closest?.(".ncm-card");
    if (!li || (ev.relatedTarget && li.contains(ev.relatedTarget))) return;
    const token = this.combat?.combatants.get(li.dataset.combatantId)?.token?.object;
    if (!token?.visible) return;
    try {
      if (over) token._onHoverIn(ev, { hoverOutOthers: true });
      else token._onHoverOut(ev);
    } catch {
      /* hover is cosmetic */
    }
  },

  async _action(action, combat, cb, ev) {
    switch (action) {
      case "collapse":
        await Settings.set("carouselCollapsed", !Settings.get("carouselCollapsed"));
        return this.render();
      case "start":
        return combat.startCombat();
      case "end":
        return combat.endCombat();
      case "prevRound":
        return combat.previousRound();
      case "prevTurn":
        return combat.previousTurn();
      case "nextTurn":
        return combat.nextTurn();
      case "nextRound":
        return combat.nextRound();
      case "endTurn":
        if (combat.combatant?.isOwner) return combat.nextTurn();
        return null;
      case "rollNPC":
        return combat.rollNPC();
      case "rollAll":
        return combat.rollAll();
      case "roll":
        return cb ? combat.rollInitiative([cb.id]) : null;
      case "hide":
        return cb?.update({ hidden: !cb.hidden });
      case "defeat":
        if (!cb?.actor) return cb?.update({ defeated: !cb.defeated });
        return Conditions.toggle("dead", cb.actor);
      case "remove":
        return cb?.delete();
      case "sheet":
        return Compat.openSheet(cb?.actor);
      case "environment": {
        const { EnvironmentApp } = await import("../environment/environment-app.js");
        return EnvironmentApp.open();
      }
      case "lab": {
        const { ConditionLab } = await import("../conditions/lab-app.js");
        return ConditionLab.open();
      }
      case "stakes": {
        const { Stakes } = await import("../stakes/stakes.js");
        return Stakes.open(cb?.actor ?? null);
      }
      case "awareness": {
        return Awareness.open(cb?.actor ?? null);
      }
      case "tracker":
        return ui.combat?.renderPopout?.() ?? ui.sidebar?.activateTab?.("combat");
      default:
        return null;
    }
  }
};
