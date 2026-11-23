import { MODULE_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { withRange, withoutRange, lightRange, clearShape } from "./sight-data.js";
import { debounce } from "../util.js";

/**
 * Sight range at the table (see sight-data.js for the idea).
 *
 * - The active GM's client gives every character token on the scene the naked-eye range as its
 *   light perception, keeping what it had on the token (flag `sightBase`) so switching the
 *   feature off puts every token back exactly as it was.
 * - A scope (scripts/arsenal/scope.js) raises that range and narrows the token's vision to a
 *   cone while it's up; this module doesn't touch a token with a scope up.
 * - Each client draws the haze for the token it is looking through: the one token selected, or
 *   a player's own character's.
 */
export const BASE_FLAG = "sightBase";
const HAZE = "ncmSightHaze";

export const Sight = {
  get on() {
    return !!Settings.get("sightRange");
  },

  get base() {
    return Math.max(1, Number(Settings.get("sightBase")) || 50);
  },

  init() {
    const sweep = debounce(() => this.sweep().catch((err) => console.error(`${MODULE_ID} | sight range`, err)), 300);
    const haze = debounce(() => this.drawHaze(), 40);
    Hooks.on("canvasReady", () => {
      sweep();
      haze();
    });
    Hooks.on("createToken", (doc) => this.on && Compat.isActiveGM && this.apply(doc).catch(() => null));
    Hooks.on("updateToken", (doc, changes) => {
      // A scope came down: the token gets its naked-eye range back.
      if (changes?.flags?.[MODULE_ID] && "-=scope" in changes.flags[MODULE_ID] && this.on && Compat.isActiveGM) this.apply(doc).catch(() => null);
      haze();
    });
    Hooks.on(`${MODULE_ID}.sightChanged`, () => {
      sweep();
      haze();
    });
    for (const h of ["controlToken", "refreshToken", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => haze());
    Hooks.on("canvasTearDown", () => this.clearHaze());
  },

  /** Does this token get a sight range: a character's (a person, an animal), not a crate or a car. */
  fits(doc) {
    return !!doc?.actor && CPR.isMeat(doc.actor);
  },

  /** Give a token the naked-eye range (the GM). Its own setting is kept on it, to put back. */
  async apply(doc) {
    if (!this.fits(doc) || doc.flags?.[MODULE_ID]?.scope) return false;
    const held = doc.flags?.[MODULE_ID]?.[BASE_FLAG] ?? null;
    const saved = doc._source?.detectionModes ?? doc.detectionModes ?? [];
    const { modes, was, changed } = withRange(saved, this.base);
    if (held && !changed) return false;
    await doc.update({ detectionModes: modes, [`flags.${MODULE_ID}.${BASE_FLAG}`]: { range: this.base, was: held ? held.was ?? null : was } });
    return true;
  },

  /** Put a token's light perception back as it was before this feature touched it. */
  async release(doc) {
    const held = doc?.flags?.[MODULE_ID]?.[BASE_FLAG];
    if (!held || doc.flags?.[MODULE_ID]?.scope) return false;
    const saved = doc._source?.detectionModes ?? doc.detectionModes ?? [];
    await doc.update({ detectionModes: withoutRange(saved, held.was ?? null), [`flags.${MODULE_ID}.-=${BASE_FLAG}`]: null });
    return true;
  },

  /** The scene this GM is on: every character token brought to the setting (on: the range; off: as it was). */
  async sweep(scene = canvas?.scene) {
    if (!Compat.isActiveGM || !scene) return 0;
    let n = 0;
    for (const doc of scene.tokens ?? []) {
      const did = this.on ? await this.apply(doc) : await this.release(doc);
      if (did) n++;
    }
    return n;
  },

  /* ---------------------------------------- */
  /*  The haze (each client)                  */
  /* ---------------------------------------- */

  /** The token this client looks through: the one selected; for a player with none selected, their character's. */
  viewer() {
    if (!canvas?.ready) return null;
    const controlled = canvas.tokens?.controlled ?? [];
    let token = controlled.length === 1 ? controlled[0] : null;
    if (!token && !controlled.length && !game.user?.isGM) token = game.user?.character?.getActiveTokens?.()[0] ?? null;
    return token && (token.isOwner || game.user?.isGM) ? token : null;
  },

  /** The clear part of the map for a token, in pixels: its range all round, or down its cone. */
  shapeFor(token) {
    const doc = token?.document ?? token;
    const range = lightRange(doc?.detectionModes ?? []);
    if (!Number.isFinite(range)) return null;
    const d = canvas?.dimensions ?? {};
    const px = (m) => (m / (d.distance || 1)) * (d.size || 100);
    return clearShape({
      center: token.center,
      range: px(range),
      angle: Number(doc.sight?.angle) || 360,
      rotation: Number(doc.rotation) || 0,
      // Around their feet, a scope up or not: what Foundry shows a token of itself and its square.
      near: Math.max(token.w ?? 100, token.h ?? 100) * 0.9
    });
  },

  clearHaze() {
    try {
      this._haze?.destroy?.({ children: true });
    } catch {
      /* gone with the canvas */
    }
    this._haze = null;
  },

  /** Haze over everything past what the viewer makes out (this client only). */
  drawHaze() {
    this.clearHaze();
    if (!this.on || !Settings.get("sightHaze") || !canvas?.ready || typeof PIXI === "undefined") return null;
    const token = this.viewer();
    const shape = token ? this.shapeFor(token) : null;
    if (!shape) return null;
    const d = canvas.dimensions;
    const g = new PIXI.Graphics();
    g.beginFill(0x0a0f1a, 0.55).drawRect(0, 0, d.width, d.height);
    g.beginHole();
    if (shape.kind === "circle") g.drawCircle(shape.x, shape.y, shape.r);
    else g.moveTo(shape.x, shape.y).arc(shape.x, shape.y, shape.r, shape.from, shape.to).closePath();
    g.endHole();
    if (shape.kind === "cone" && shape.near > 0) g.beginHole().drawCircle(shape.x, shape.y, shape.near).endHole();
    g.endFill();
    const box = new PIXI.Container();
    box.name = HAZE;
    box.eventMode = "none";
    box.addChild(g);
    try {
      if (PIXI.BlurFilter) box.filters = [new PIXI.BlurFilter(Math.max(6, Math.round((d.size || 100) * 0.25)))];
    } catch {
      /* drawn sharp */
    }
    (canvas.interface ?? canvas.stage).addChildAt?.(box, 0) ?? (canvas.interface ?? canvas.stage).addChild(box);
    this._haze = box;
    return shape;
  }
};
