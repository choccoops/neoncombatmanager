import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Conditions } from "../conditions/engine.js";
import { debounce } from "../util.js";
import { Core, img } from "./core.js";

/**
 * Tactile Boost (Cyberpunk RED p.359, Neuralware; 2070 Item Compendium): with a hand on a
 * surface, the chipware feels motion within 20 m/yds. Here that's the "Feeling for Motion"
 * condition, switched on and off like any other. While a character with it is selected, their
 * player gets an amber ripple where anyone they can't see moves within 20 m/yds, through any wall
 * (it's the floor and walls carrying it, not line of sight). It marks where motion was last felt:
 * no outline and no name, and it stays until that someone moves again, comes into view or leaves
 * the range. Drawn on that player's screen only; GM-hidden tokens never show.
 */
export const TACTILE = "ncm-tactile";
export const TACTILE_CONDITION = "tactileBoost";
/** How far the chipware feels, in metres/yards. */
export const TACTILE_RANGE = 20;
const AMBER = 0xffb300;

/** Is this cyberware a Tactile Boost? */
export const isTactileBoost = (name) => /tactile\s*boost/i.test(String(name ?? ""));

/** Is a point within `range` (pixels) of any of the viewers' centres? */
export function feltBy(viewers, point, range) {
  return viewers.some((v) => Math.hypot(point.x - v.x, point.y - v.y) <= range);
}

/**
 * Which felt movers still show, pure: those not hidden by the GM, not in plain view, not one of
 * the viewers, and last felt within range. [{ id, x, y }]
 * @param {Map<string, {x, y}>} felt - where each token was last felt moving
 * @param {object[]} tokens - [{ id, hidden, visible }]
 * @param {object[]} viewers - [{ id, x, y }]
 */
export function ripples(felt, tokens, viewers, range) {
  if (!viewers.length) return [];
  const out = [];
  for (const [id, at] of felt) {
    const t = tokens.find((x) => x.id === id);
    if (!t || t.hidden || t.visible || viewers.some((v) => v.id === id) || !feltBy(viewers, at, range)) continue;
    out.push({ id, x: at.x, y: at.y });
  }
  return out;
}

export const Tactile = {
  /** tokenId -> where it was last felt moving (its centre). */
  felt: new Map(),
  /** tokenId -> { name, x, y }, the ripples drawn here. */
  drawn: new Map(),
  /** The viewers' own range pulses drawn here: tokenId -> effect name. */
  pulses: new Map(),

  init() {
    const soon = debounce(() => this.refresh(), 150);
    Hooks.on("updateToken", (doc, changes) => {
      if (("x" in changes || "y" in changes) && doc.parent === canvas?.scene) this.moved(doc);
      soon();
    });
    for (const hook of ["controlToken", "deleteToken", "sightRefresh", "createActiveEffect", "deleteActiveEffect", `${MODULE_ID}.fxChanged`]) Hooks.on(hook, () => soon());
    Hooks.on("canvasReady", () => {
      this.reset();
      soon();
    });
    Hooks.on("canvasTearDown", () => this.reset());
  },

  reset() {
    this.felt.clear();
    this.drawn.clear();
    this.pulses.clear();
  },

  get on() {
    return !!Settings.get("fxTactile") && Core.on;
  },

  get range() {
    return (TACTILE_RANGE / (canvas?.dimensions?.distance || 1)) * (canvas?.grid?.size || 100);
  },

  /** The tokens this player feels through: the selected ones Feeling for Motion. */
  viewers() {
    return (canvas?.tokens?.controlled ?? []).filter((t) => t.actor && Conditions.has(TACTILE_CONDITION, t.actor));
  },

  /** Someone moved: where they ended up is felt, if a viewer is near enough. */
  moved(doc) {
    const size = canvas?.grid?.size || 100;
    const at = { x: (Number(doc.x) || 0) + ((Number(doc.width) || 1) * size) / 2, y: (Number(doc.y) || 0) + ((Number(doc.height) || 1) * size) / 2 };
    const viewers = this.viewers().map((v) => ({ id: v.id, x: v.center.x, y: v.center.y }));
    if (this.on && viewers.length && feltBy(viewers, at, this.range)) this.felt.set(doc.id, at);
    else this.felt.delete(doc.id);
  },

  wanted() {
    if (!this.on || !canvas?.ready) return [];
    const viewers = this.viewers().map((v) => ({ id: v.id, x: v.center.x, y: v.center.y }));
    // Nothing is remembered once the hand comes off the surface.
    if (!viewers.length) this.felt.clear();
    const tokens = (canvas.tokens?.placeables ?? []).map((t) => ({ id: t.id, hidden: !!t.document?.hidden, visible: !!t.visible }));
    return ripples(this.felt, tokens, viewers, this.range);
  },

  end(name) {
    try {
      Sequencer.EffectManager.endEffects({ name });
    } catch {
      /* gone */
    }
  },

  /** Draw the ripples that are missing or have moved, end the ones no longer felt (this screen only). */
  refresh() {
    const want = this.wanted();
    const ids = new Set(want.map((r) => r.id));
    for (const [id, d] of this.drawn) {
      const now = want.find((r) => r.id === id);
      if (ids.has(id) && now.x === d.x && now.y === d.y) continue;
      this.drawn.delete(id);
      this.end(d.name);
    }
    const viewers = this.on ? this.viewers() : [];
    for (const [id, name] of this.pulses) {
      if (viewers.some((v) => v.id === id)) continue;
      this.pulses.delete(id);
      this.end(name);
    }
    const add = want.filter((r) => !this.drawn.has(r.id));
    const pulse = viewers.filter((v) => !this.pulses.has(v.id));
    if (!add.length && !pulse.length) return want;
    const grid = canvas.grid?.size || 100;
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    for (const r of add) {
      const name = `${TACTILE}-${r.id}`;
      this.drawn.set(r.id, { name, x: r.x, y: r.y });
      // Two rings a beat apart, spreading from the spot and thinning out, over and over.
      for (const delay of [0, 700]) {
        seq.effect().name(name).file(img("ring-pulse.webp")).atLocation({ x: r.x, y: r.y }).size(grid * 1.6).tint(AMBER)
          .xray(true).zIndex(19).persist().locally().delay(delay).fadeOut(400)
          .loopProperty("spriteContainer", "scale.x", { values: [0.25, 1], duration: 1400 })
          .loopProperty("spriteContainer", "scale.y", { values: [0.25, 1], duration: 1400 })
          .loopProperty("sprite", "alpha", { values: [0.85, 0], duration: 1400, absolute: true });
      }
    }
    for (const v of pulse) {
      const name = `${TACTILE}-self-${v.id}`;
      this.pulses.set(v.id, name);
      // The reach of the sense: one slow, faint ring out to 20 m/yds from the hand.
      seq.effect().name(name).file(img("ring-pulse.webp")).attachTo(v, { bindVisibility: false, bindAlpha: false }).size(this.range * 2).tint(AMBER)
        .belowTokens().zIndex(1).persist().locally().fadeOut(400)
        .loopProperty("spriteContainer", "scale.x", { values: [0.05, 1], duration: 3200 })
        .loopProperty("spriteContainer", "scale.y", { values: [0.05, 1], duration: 3200 })
        .loopProperty("sprite", "alpha", { values: [0.35, 0], duration: 3200, absolute: true });
    }
    seq.play();
    return want;
  }
};
