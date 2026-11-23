import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Conditions } from "../conditions/engine.js";
import { MODES, HEAT_MODES, HEAT_TINT, modesOf, heatOf, torchOf, torchLight } from "./senses-data.js";
import { debounce, L } from "../util.js";

/**
 * Enhanced sight and torches, on the Action HUD.
 *
 * - Low Light, Infrared, UV: a character with the chrome, a scope on the gun in hand, or
 *   glasses or a helmet that has it switches one on. While it's on their sight penalties
 *   (darkness, smoke, fog, the weather's obscurement) are gone, and their screen takes that
 *   mode's look (scripts/neonfx/screen.js) while their token is the one being looked through.
 * - Heat: in Infrared or UV, the bodies they can see show warm or cold on their screen alone:
 *   people and animals warm; a Full Body Conversion (as Neon Hub's Full Borg module marks it,
 *   else by its chrome's name) cold unless Realskinn covers it; Thermal
 *   Damping on running Optical Camo, nothing.
 * - Torch: a flashlight carried (or built in) throws a cone of light the way the token faces.
 *
 * What's on lives on the token (flags `vision`, `torch`), so every client agrees and it
 * survives a reload; the heat picture is each viewer's own.
 */
export const VISION_FLAG = "vision";
export const TORCH_FLAG = "torch";
const HEAT_ID = "ncmHeat";

export const Senses = {
  get on() {
    return !!Settings.get("visionModes");
  },

  init() {
    const soon = debounce(() => this.drawHeat(), 80);
    this.soon = soon;
    for (const h of ["controlToken", "canvasReady", "updateToken", "refreshToken", "sightRefresh", "createActiveEffect", "deleteActiveEffect", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    Hooks.on("canvasTearDown", () => this.clearHeat());
    // What gave the sight or the light is gone (unequipped, removed, uninstalled): it goes off.
    const check = (item, userId) => {
      if (userId !== game.user.id) return;
      const actor = item?.parent;
      if (actor?.documentName !== "Actor") return;
      for (const t of actor.getActiveTokens?.() ?? []) {
        const doc = t.document;
        const v = doc?.flags?.[MODULE_ID]?.[VISION_FLAG];
        if (v && !this.modes(actor).some((m) => m.mode === v.mode)) this.setVision(doc, null).catch(() => null);
        if (doc?.flags?.[MODULE_ID]?.[TORCH_FLAG] && !this.torch(actor)) this.setTorch(doc, null).catch(() => null);
      }
    };
    Hooks.on("updateItem", (item, changes, options, userId) => check(item, userId));
    Hooks.on("deleteItem", (item, options, userId) => check(item, userId));
  },

  /* ---------------------------------------- */
  /*  What a character has                    */
  /* ---------------------------------------- */

  /** Items a character is using: installed chrome, what they wear, the gun in hand and what's fitted to it. */
  _inUse(actor) {
    const items = [...(actor?.items ?? [])];
    const out = [];
    const seen = new Set();
    const add = (i) => {
      if (!i || seen.has(i.id)) return;
      seen.add(i.id);
      out.push(i);
      for (const id of i.system?.installedItems?.list ?? []) add(actor.items.get(id));
    };
    for (const i of items) {
      if (i.type === "cyberware" ? i.system?.isInstalled : ["armor", "gear", "clothing", "weapon"].includes(i.type) && i.system?.equipped === "equipped") add(i);
    }
    return out;
  },

  _card(i) {
    return { name: i.name, description: i.system?.description?.value };
  },

  /** The ways of seeing a character can switch on: [{ mode, by }] (by: the item that gives it). */
  modes(actor) {
    const found = new Map();
    for (const i of this._inUse(actor)) for (const m of modesOf(this._card(i))) if (!found.has(m)) found.set(m, i.name);
    return MODES.filter((m) => found.has(m)).map((mode) => ({ mode, by: found.get(mode) }));
  },

  /** The torch a character can switch on: { range, by }, or null. Carried counts: it's in a hand in a moment. */
  torch(actor) {
    let best = null;
    for (const i of actor?.items ?? []) {
      const have = i.type === "cyberware" ? i.system?.isInstalled : i.system?.equipped !== "owned";
      if (!have) continue;
      const t = torchOf(this._card(i));
      if (t && (!best || t.range > best.range)) best = { ...t, by: i.name };
    }
    return best;
  },

  /* ---------------------------------------- */
  /*  On and off                              */
  /* ---------------------------------------- */

  /** The way of seeing a token has on, or null. */
  vision(token) {
    const doc = token?.document ?? token;
    return this.on ? doc?.flags?.[MODULE_ID]?.[VISION_FLAG]?.mode ?? null : null;
  },

  torchOn(token) {
    const doc = token?.document ?? token;
    return !!doc?.flags?.[MODULE_ID]?.[TORCH_FLAG];
  },

  _doc(actor, token) {
    const tok = token ?? actor?.getActiveTokens?.()[0] ?? null;
    return tok?.document ?? tok;
  },

  async setVision(doc, mode, by = "") {
    if (mode) await doc.update({ [`flags.${MODULE_ID}.${VISION_FLAG}`]: { mode, by } });
    else await doc.update({ [`flags.${MODULE_ID}.-=${VISION_FLAG}`]: null });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    Hooks.callAll(`${MODULE_ID}.environmentConfig`);
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
  },

  /** Switch a way of seeing on (the others off), or off if it's the one that's on. */
  async toggleVision(actor, mode, { token = null } = {}) {
    if (!this.on || !actor?.isOwner || !MODES.includes(mode)) return null;
    const doc = this._doc(actor, token);
    if (!doc?.update) {
      ui.notifications?.warn(L(`${LANG}.Scope.NoToken`, { name: actor.name }));
      return null;
    }
    const have = this.modes(actor).find((m) => m.mode === mode);
    if (!have) return null;
    const next = this.vision(doc) === mode ? null : mode;
    await this.setVision(doc, next, have.by);
    return next;
  },

  _max(doc) {
    const d = doc?.parent?.dimensions ?? canvas?.dimensions;
    if (!d?.size) return Infinity;
    return (Math.hypot(d.sceneWidth ?? d.width ?? 0, d.sceneHeight ?? d.height ?? 0) / d.size) * (d.distance || 1);
  },

  async setTorch(doc, torch) {
    const held = doc.flags?.[MODULE_ID]?.[TORCH_FLAG];
    if (torch) {
      const was = held?.was ?? { dim: doc.light?.dim ?? 0, bright: doc.light?.bright ?? 0, angle: doc.light?.angle ?? 360, color: doc.light?.color ?? null, alpha: doc.light?.alpha ?? 0.5, luminosity: doc.light?.luminosity ?? 0.5, attenuation: doc.light?.attenuation ?? 0.5 };
      const light = torchLight({ range: torch.range, angle: Number(Settings.get("torchAngle")) || 60, max: this._max(doc) });
      await doc.update({ light, [`flags.${MODULE_ID}.${TORCH_FLAG}`]: { by: torch.by, was } });
    } else if (held) await doc.update({ light: held.was ?? { dim: 0, bright: 0, angle: 360 }, [`flags.${MODULE_ID}.-=${TORCH_FLAG}`]: null });
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
  },

  /** The torch on or off: a cone of light the way the token faces; off, the light it had. */
  async toggleTorch(actor, { token = null } = {}) {
    if (!Settings.get("torchAction") || !actor?.isOwner) return null;
    const doc = this._doc(actor, token);
    if (!doc?.update) {
      ui.notifications?.warn(L(`${LANG}.Scope.NoToken`, { name: actor.name }));
      return null;
    }
    if (this.torchOn(doc)) {
      await this.setTorch(doc, null);
      return false;
    }
    const torch = this.torch(actor);
    if (!torch) return null;
    await this.setTorch(doc, torch);
    return true;
  },

  /** The Action HUD's entries: one for each way of seeing they have, and the torch. */
  entries(actor, token) {
    const out = [];
    const doc = this._doc(actor, token);
    if (this.on) {
      const now = this.vision(doc);
      for (const m of this.modes(actor)) out.push({ key: `sense:${m.mode}`, label: L(`${LANG}.Senses.Mode.${m.mode}`), sub: m.by, icon: { lowlight: "fa-solid fa-moon", infrared: "fa-solid fa-temperature-high", uv: "fa-solid fa-sun" }[m.mode], on: now === m.mode, alert: now === m.mode });
    }
    if (Settings.get("torchAction")) {
      const t = this.torch(actor);
      if (t) out.push({ key: "sense:torch", label: L(`${LANG}.Senses.Torch`), sub: t.by, icon: "fa-solid fa-lightbulb", on: this.torchOn(doc), alert: this.torchOn(doc) });
    }
    return out;
  },

  /* ---------------------------------------- */
  /*  Whose eyes, and what they show          */
  /* ---------------------------------------- */

  /**
   * The token this client is looking through, with the way of seeing it has on: the one token
   * selected (a GM: only that); for a player with nothing selected, their own character's.
   */
  viewer() {
    if (!this.on || !canvas?.ready) return null;
    const controlled = canvas.tokens?.controlled ?? [];
    let token = controlled.length === 1 ? controlled[0] : null;
    if (!token && !controlled.length && !game.user?.isGM) token = game.user?.character?.getActiveTokens?.()[0] ?? null;
    if (!token?.isOwner && !game.user?.isGM) return null;
    const mode = this.vision(token);
    return mode ? { token, mode } : null;
  },

  /** How a token's body reads to heat sight: "warm", "cold" or null. */
  heat(token) {
    const actor = token?.actor;
    if (!actor) return null;
    const chrome = [...(actor.items ?? [])].filter((i) => (i.type === "cyberware" || i.type === "itemUpgrade") && i.system?.isInstalled !== false);
    const camo = Conditions.has("chromeOpticalCamo", actor);
    return heatOf({
      meat: CPR.isMeat(actor),
      borg: CPR.isBorg(actor),
      skinned: chrome.some((i) => /realskinn/i.test(i.name ?? "")),
      damped: camo && chrome.some((i) => /thermal damping/i.test(i.name ?? "")),
      dead: Conditions.has("dead", actor)
    });
  },

  clearHeat() {
    const box = this._heat;
    this._heat = null;
    try {
      if (this._tick) canvas?.app?.ticker?.remove(this._tick);
      box?.destroy?.({ children: true });
    } catch {
      /* already gone with the canvas */
    }
    this._tick = null;
  },

  /** Draw (this client only) the heat of every body the viewer can see, while they look in a heat mode. */
  drawHeat() {
    this.clearHeat();
    const v = this.viewer();
    if (!v || !HEAT_MODES.includes(v.mode) || !Settings.get("visionHeat") || typeof PIXI === "undefined") return 0;
    const tint = HEAT_TINT[v.mode];
    const box = new PIXI.Container();
    box.name = HEAT_ID;
    box.eventMode = "none";
    let n = 0;
    for (const t of canvas.tokens?.placeables ?? []) {
      if (t === v.token || !t.visible) continue;
      const heat = this.heat(t);
      if (!heat) continue;
      const c = t.center;
      const r = Math.max(t.w, t.h) / 2;
      const g = new PIXI.Graphics();
      if (heat === "warm") {
        // A body's glow: brightest at the core, fading out past the token's edge.
        for (const [k, a] of [[1.45, 0.12], [1.15, 0.2], [0.8, 0.3], [0.45, 0.4]]) g.beginFill(tint.warm, a).drawCircle(c.x, c.y, r * k).endFill();
      } else {
        // Cold metal: a hard, dark outline and no glow.
        g.beginFill(tint.cold, 0.28).drawCircle(c.x, c.y, r * 0.95).endFill();
        g.lineStyle(3, tint.cold, 0.9).drawCircle(c.x, c.y, r * 0.95);
      }
      g.heat = heat;
      box.addChild(g);
      n++;
    }
    if (!n) {
      box.destroy();
      return 0;
    }
    try {
      if (PIXI.BlurFilter) box.filters = [new PIXI.BlurFilter(6)];
    } catch {
      /* drawn sharp */
    }
    (canvas.interface ?? canvas.stage).addChild(box);
    this._heat = box;
    // Warm bodies breathe.
    if (Settings.get("fxMotion") && canvas.app?.ticker) {
      this._tick = () => {
        const a = 0.82 + 0.18 * Math.sin(performance.now() / 420);
        for (const g of box.children) if (g.heat === "warm") g.alpha = a;
      };
      canvas.app.ticker.add(this._tick);
    }
    return n;
  },

  measure: (a, b) => Compat.measure(a, b)
};
