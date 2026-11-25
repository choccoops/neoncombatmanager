import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { Conditions } from "../conditions/engine.js";
import { Core } from "../neonfx/core.js";
import { L, debounce } from "../util.js";
import { specialsOf } from "./specials.js";
import { Senses } from "../senses/senses.js";
import { HEAT_MODES, HEAT_TINT, MODE_TINT, UV_GLOW } from "../senses/senses-data.js";
import { Cloak } from "../senses/cloak.js";
import { Far } from "../senses/far.js";

/**
 * A Tech scope's view through thin cover (2070 Ch07: "its scope shows outlines through Thin
 * cover"). While a character with a Tech Weapon is selected, their player sees a glowing outline
 * of anyone they can't otherwise see whose only cover from them is thin: walls marked "Thin cover"
 * and, by default, closed doors. Drawn on that player's screen only; hidden tokens never show.
 */
export const XRAY = "ncm-xray";
const CYAN = 0x00e5ff;
/** How far the scope picks people out, in metres/yards. */
export const XRAY_RANGE = 50;
const PADS = "ncm-xray-pads";

/**
 * The next token to target from the scope: the one after the current target in the list (nearest
 * first), or the first. Null when the scope shows nobody.
 */
export function nextScopeTarget(seen, targetedIds = []) {
  if (!seen.length) return null;
  const at = seen.findIndex((t) => targetedIds.includes(t.id));
  return seen[(at + 1) % seen.length];
}

/** Do segments ab and cd cross (touching ends count)? */
export function segmentsCross(a, b, c, d) {
  const orient = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const on = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

/**
 * Is the only cover between two points thin? True when the line crosses at least one wall that
 * blocks sight and every one it crosses is thin.
 * @param {object[]} walls - { c: [x1, y1, x2, y2], blocks, thin }
 */
export function throughThinCover(from, to, walls, { thick = 0 } = {}) {
  let crossed = 0;
  let solid = 0;
  for (const w of walls) {
    if (!w.blocks) continue;
    const [x1, y1, x2, y2] = w.c;
    if (!segmentsCross(from, to, { x: x1, y: y1 }, { x: x2, y: y2 })) continue;
    // A scope that reads one layer of any cover (`thick`): one wall in all, thin or not.
    if (!w.thin && ++solid > thick) return false;
    crossed++;
  }
  return crossed > 0 && (!thick || crossed <= thick);
}

/** A wall document, read for the scope: { c, blocks, thin }. */
export function readWall(doc, { doorsThin = true } = {}) {
  const door = Number(doc?.door) || 0;
  const open = door > 0 && Number(doc?.ds) === 1;
  const blocks = Number(doc?.sight ?? 1) !== 0 && !open;
  // Marked Thin cover, or tagged as Thin cover of some material (Cover), or a closed door.
  const cover = doc?.flags?.[MODULE_ID]?.cover;
  const thin = !!doc?.flags?.[MODULE_ID]?.thinCover || (!!cover?.material && cover.thickness === "thin") || (doorsThin && door > 0);
  return { c: doc?.c ?? [0, 0, 0, 0], blocks, thin };
}

/**
 * Is there a clear line of sight between two points: no wall that blocks sight across it? Pure.
 * (Enhanced sight sees in the dark, not through cover.)
 */
export function clearSight(from, to, walls) {
  return !walls.some((w) => w.blocks && segmentsCross(from, to, { x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] }));
}

/**
 * The outline someone gets in a way of seeing, pure: a colour, or null for nothing to show.
 * Low Light shows everyone there in its green; Infrared and UV show bodies by their heat (warm
 * or cold), and nothing where there's no heat to read (Thermal Damping under running camo, a
 * crate).
 */
export function sensedColor(mode, heat) {
  if (HEAT_MODES.includes(mode)) return heat ? HEAT_TINT[mode][heat] : null;
  return Number.parseInt(String(MODE_TINT[mode] ?? "#39ff14").slice(1), 16);
}

/**
 * How someone enhanced sight shows is drawn, pure: "image" (Low Light: the token itself, as an
 * image intensifier shows it, in its green), or "heat" (Infrared, UV: its shape filled with its
 * heat, a warm body bright, a cold one dark and hard-edged).
 */
export const sensedLook = (mode) => (HEAT_MODES.includes(mode) ? "heat" : "image");

export const Xray = {
  /** tokenId -> effect name, the outlines drawn here. */
  drawn: new Map(),

  init() {
    const soon = debounce(() => this.refresh(), 120);
    for (const hook of ["controlToken", "createToken", "deleteToken", "updateToken", "sightRefresh", "createWall", "updateWall", "deleteWall", "createActiveEffect", "deleteActiveEffect", `${MODULE_ID}.xrayChanged`, `${MODULE_ID}.fxChanged`]) {
      Hooks.on(hook, () => soon());
    }
    Hooks.on("canvasReady", () => {
      this.drawn.clear();
      soon();
    });
    Hooks.on("canvasTearDown", () => {
      this.drawn.clear();
      this.clearPads();
    });
    Hooks.on("targetToken", (user) => user?.id === game.user?.id && this.drawPads());
    Hooks.once("ready", () => this.wrapClicks());
    Hooks.on("renderWallConfig", (app, html) => this.wallConfig(app, html));
  },

  get on() {
    return !!Settings.get("arsenalXray") && !!Settings.get("arsenalRebuilds") && Core.on;
  },

  /** The tokens this player looks through: the selected ones with a Tech Weapon in hand. */
  viewers() {
    return (canvas?.tokens?.controlled ?? []).filter((t) => t.actor && Conditions.has("techRebuild", t.actor));
  },

  /** Does a character hold a weapon whose scope reads one layer of Thick cover too (its card)? */
  scopeThick(actor) {
    return [...(actor?.items ?? [])].some((i) => i.type === "weapon" && i.system?.equipped === "equipped" && specialsOf(i)?.scopeThick);
  },

  /** Who this player should see outlined now: [token]. */
  wanted() {
    if (!this.on || !canvas?.ready) return [];
    const viewers = this.viewers();
    if (!viewers.length) return [];
    const doorsThin = !!Settings.get("arsenalThinDoors");
    const walls = (canvas.walls?.placeables ?? []).map((w) => readWall(w.document, { doorsThin }));
    const range = (XRAY_RANGE / (canvas.dimensions?.distance || 1)) * (canvas.grid?.size || 100);
    return (canvas.tokens?.placeables ?? []).filter((t) => {
      if (!t.actor || t.document?.hidden || t.visible || viewers.includes(t)) return false;
      return viewers.some((v) => {
        if (Math.hypot(t.center.x - v.center.x, t.center.y - v.center.y) > range) return false;
        if (throughThinCover(v.center, t.center, walls)) return true;
        // A scope whose card says it reads one layer of Thin or Thick cover.
        return this.scopeThick(v.actor) && throughThinCover(v.center, t.center, walls, { thick: 1 });
      });
    });
  },

  /**
   * Who enhanced sight shows this player: with Low Light, Infrared or UV on for the token they
   * look through, everyone it has a clear line of sight to whom Foundry isn't drawing (out in the
   * dark, past what the token's own eyes reach), each in the colour that way of seeing gives
   * them: [{ token, color }]. Not through cover: a wall that blocks sight blocks this too.
   */
  sensed() {
    const v = Senses.viewer();
    if (!v || !canvas?.ready || !Settings.get("visionOutlines")) return [];
    const walls = (canvas.walls?.placeables ?? []).map((w) => readWall(w.document));
    const out = [];
    for (const t of canvas.tokens?.placeables ?? []) {
      if (!t.actor || t === v.token || t.document?.hidden || t.visible) continue;
      if (!clearSight(v.token.center, t.center, walls)) continue;
      // Under a cloak, until this watcher's Perception has beaten it (the GM's secret roll).
      if (Cloak.hides(t, v.token)) continue;
      const color = sensedColor(v.mode, Senses.heat(t));
      if (color !== null) out.push({ token: t, color, look: sensedLook(v.mode), heat: Senses.heat(t), blood: v.mode === "uv" && Senses.bleeds(t) });
    }
    return out;
  },

  /** Draw the outlines that are missing and end the ones no longer wanted (this screen only). */
  refresh() {
    // The Tech scope's (cyan), then what enhanced sight shows (its own colours).
    const marks = new Map((this.on ? this.wanted() : []).map((t) => [t.id, { token: t, color: CYAN }]));
    for (const s of this.sensed()) if (!marks.has(s.token.id)) marks.set(s.token.id, s);
    // And whoever is in a far area the viewer sees into (a linked area, through a scope that reaches it).
    for (const s of Far.sensed()) if (!marks.has(s.token.id)) marks.set(s.token.id, s);
    const want = [...marks.values()].map((m) => m.token);
    // The Tech scope's keep their name; a way of seeing's carry their colour (it changes with the mode).
    const nameOf = (m) => (m.look ? `${XRAY}-${m.token.id}-${m.look}-${m.color.toString(16)}${m.blood ? "-b" : ""}` : `${XRAY}-${m.token.id}`);
    for (const [id, name] of this.drawn) {
      const m = marks.get(id);
      if (m && nameOf(m) === name) continue;
      this.drawn.delete(id);
      try {
        Sequencer.EffectManager.endEffects({ name });
      } catch {
        /* gone */
      }
    }
    const add = [...marks.values()].filter((m) => !this.drawn.has(m.token.id));
    this.drawPads(want);
    if (!add.length) return want;
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    for (const m of add) {
      const t = m.token;
      const name = nameOf(m);
      this.drawn.set(t.id, name);
      const fx = seq.effect().name(name).copySprite(t).attachTo(t, { bindVisibility: false, bindAlpha: false }).size(Core.artSize(t)).rotate(0);
      if (m.look === "image") {
        // Low Light: the token itself, amplified: its own picture in the intensifier's green, a thin rim to pick it out.
        fx.filter("ColorMatrix", { saturate: -1, brightness: 1.6, contrast: 0.25 }).tint(m.color)
          // Under UV, blood on the badly wounded fluoresces: a bright, uneven halo.
          .filter("Glow", m.blood ? { color: UV_GLOW, distance: 10, outerStrength: 3.5, innerStrength: 1.2, quality: 0.2 } : { color: m.color, distance: 5, outerStrength: 1.5, innerStrength: 0, quality: 0.2 })
          .xray(true).zIndex(20).persist().locally().fadeIn(250).fadeOut(250)
          .loopProperty("sprite", "alpha", { values: [0.82, 1], duration: 1400, pingPong: true, absolute: true });
      } else if (m.look === "far") {
        // Seen across a linked distance: the token as it is, picked out with a thin pale rim.
        fx.filter("Glow", { color: m.color, distance: 4, outerStrength: 1.2, innerStrength: 0, quality: 0.2 })
          .xray(true).zIndex(20).persist().locally().fadeIn(250).fadeOut(250);
      } else if (m.look === "heat") {
        // Infrared, UV: the shape, filled with its heat. A warm body burns bright from the core out; a cold one is flat and dark with a hard edge.
        const warm = m.heat === "warm";
        fx.filter("ColorMatrix", { saturate: -1, brightness: warm ? 2.6 : 0.9, contrast: warm ? -0.6 : 0.2 }).tint(m.color)
          .filter("Glow", { color: m.color, distance: warm ? 12 : 4, outerStrength: warm ? 3 : 1.2, innerStrength: warm ? 3 : 0.6, quality: 0.2 })
          .xray(true).zIndex(20).persist().locally().fadeIn(250).fadeOut(250);
        if (warm) fx.loopProperty("sprite", "alpha", { values: [0.8, 1], duration: 900, pingPong: true, absolute: true });
      } else {
        // The Tech scope: an outline alone.
        fx.filter("Glow", { color: m.color, distance: 8, outerStrength: 3, innerStrength: 0, quality: 0.2, knockout: true })
          .xray(true).zIndex(20).persist().locally().fadeIn(250).fadeOut(250)
          .loopProperty("sprite", "alpha", { values: [0.5, 0.95], duration: 900, pingPong: true, absolute: true });
      }
    }
    seq.play();
    return want;
  },

  /* ---------------------------------------- */
  /*  Targeting an outline                    */
  /* ---------------------------------------- */

  /** The outlined tokens, nearest the viewer first. */
  seen() {
    const v = this.viewers()[0] ?? Senses.viewer()?.token ?? null;
    const list = [...this.drawn.keys()].map((id) => canvas.tokens?.get?.(id) ?? canvas.tokens?.placeables?.find((t) => t.id === id)).filter(Boolean);
    const d = (t) => (v ? Math.hypot(t.center.x - v.center.x, t.center.y - v.center.y) : 0);
    return list.sort((a, b) => d(a) - d(b));
  },

  /** Target (or let go of) someone the scope shows; `add` keeps the other targets, as Shift does. */
  target(token, { add = false } = {}) {
    if (!token || !this.drawn.has(token.id)) return false;
    const on = !game.user.targets?.has?.(token);
    if (typeof token.setTarget === "function") token.setTarget(on, { releaseOthers: !add });
    else Compat.setTargets(on ? [token.id] : []);
    this.drawPads();
    return on;
  },

  /** From the Action HUD: target the next person the scope shows (nearest first, round and round). */
  cycle() {
    const next = nextScopeTarget(this.seen(), [...(game.user.targets ?? [])].map((t) => t.id));
    if (!next) {
      ui.notifications?.info(L(`${LANG}.Arsenal.ScopeNone`));
      return null;
    }
    if (!game.user.targets?.has?.(next)) this.target(next);
    return next;
  },

  /** The outlined token under a point on the canvas (its square), or null. */
  at(point) {
    if (!point || !this.drawn.size) return null;
    return this.seen().find((t) => {
      const w = t.w ?? 100;
      const h = t.h ?? 100;
      return Math.abs(point.x - t.center.x) <= w / 2 && Math.abs(point.y - t.center.y) <= h / 2;
    }) ?? null;
  },

  /**
   * A token nobody can see takes no clicks, so the click on its outline arrives at the token layer
   * as a click on empty canvas, which would let go of the shooter (and of every target). The layer's
   * own click handler is where it's caught: a click on an outline targets it and goes no further.
   * The Target key works the same way, from where the pointer is.
   */
  wrapClicks() {
    if (!this._clicks) {
      const self = this;
      // A click on an outline targets it and goes no further; any other click goes on as it was.
      const handle = function (wrapped, event, ...rest) {
        const hit = self.drawn.size ? self.at(self.pointOf(event)) : null;
        if (!hit) return wrapped(event, ...rest);
        self.target(hit, { add: !!(event?.shiftKey ?? event?.data?.originalEvent?.shiftKey) });
        return undefined;
      };
      const lib = globalThis.libWrapper;
      if (lib && typeof lib.register === "function") {
        // Through libWrapper where it's installed, so other modules wrapping the same click chain with this one.
        try {
          lib.register(MODULE_ID, "TokenLayer.prototype._onClickLeft", handle, "MIXED");
          this._clicks = "libWrapper";
        } catch (err) {
          console.warn(`${MODULE_ID} | libWrapper wouldn't take the token layer's click; wrapping it directly`, err);
        }
      }
      const proto = CONFIG.Canvas?.layers?.tokens?.layerClass?.prototype;
      if (!this._clicks && proto && typeof proto._onClickLeft === "function" && !proto._onClickLeft._ncmScope) {
        const original = proto._onClickLeft;
        proto._onClickLeft = function (event, ...rest) {
          return handle.call(this, (...args) => original.call(this, ...args), event, ...rest);
        };
        proto._onClickLeft._ncmScope = true;
        this._clicks = "direct";
      }
    }
    if (typeof document !== "undefined" && !this._keys) {
      this._keys = true;
      document.addEventListener("keydown", (event) => this.onKey(event));
    }
  },

  /** Where a canvas click landed, in canvas coordinates. */
  pointOf(event) {
    const p = event?.interactionData?.origin ?? event?.data?.origin ?? canvas?.mousePosition ?? null;
    return p ? { x: Number(p.x), y: Number(p.y) } : null;
  },

  /** The Target key with the pointer over an outline (and no token of its own under it). */
  onKey(event) {
    if (!this.drawn.size || event.repeat || canvas?.tokens?.hover) return false;
    const el = event.target;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ""))) return false;
    let keys = ["KeyT"];
    try {
      const bound = (game.keybindings?.get("core", "target") ?? []).map((b) => b.key).filter(Boolean);
      if (bound.length) keys = bound;
    } catch {
      /* the default */
    }
    if (!keys.includes(event.code)) return false;
    const hit = this.at(canvas?.mousePosition);
    if (!hit) return false;
    this.target(hit, { add: !!event.shiftKey });
    return true;
  },

  clearPads() {
    const old = canvas?.interface?.getChildByName?.(PADS);
    if (old) old.destroy({ children: true });
  },

  /**
   * Foundry draws no target marker on a token that's out of sight, so each targeted outline gets
   * brackets of its own, drawn here.
   */
  drawPads(want = this.seen()) {
    this.clearPads();
    if (!want.length || !canvas?.interface || typeof PIXI === "undefined") return;
    const box = new PIXI.Container();
    box.name = PADS;
    box.eventMode = "passive";
    for (const t of want) {
      const w = t.w ?? 100;
      const h = t.h ?? 100;
      const pad = new PIXI.Graphics();
      pad.position.set(t.center.x - w / 2, t.center.y - h / 2);
      // Drawn only: the click and the Target key are caught at the token layer (wrapClicks), so nothing is handled twice.
      pad.eventMode = "none";
      if (game.user.targets?.has?.(t)) {
        const k = Math.max(8, Math.round(Math.min(w, h) * 0.22));
        pad.lineStyle(3, CYAN, 0.95);
        for (const [x, y, dx, dy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) {
          pad.moveTo(x + dx * k, y).lineTo(x, y).lineTo(x, y + dy * k);
        }
      }
      box.addChild(pad);
    }
    canvas.interface.addChild(box);
  },

  /** A "Thin cover" box in the wall's settings. */
  wallConfig(app, html) {
    const root = Compat.element(html);
    const wall = app.document ?? app.object;
    if (!root || !wall || root.querySelector(".ncm-wall-thin")) return;
    const form = root.querySelector("form") ?? root;
    const anchor = form.querySelector("footer, .form-footer, button[type=submit]");
    const group = document.createElement("div");
    group.className = "form-group ncm-wall-thin";
    group.innerHTML = `<label>${L(`${LANG}.Arsenal.ThinCover.Label`)}</label><div class="form-fields"><input type="checkbox" name="flags.${MODULE_ID}.thinCover" ${wall.flags?.[MODULE_ID]?.thinCover ? "checked" : ""}></div><p class="hint">${L(`${LANG}.Arsenal.ThinCover.Hint`)}</p>`;
    const before = anchor?.closest("footer, .form-footer") ?? anchor;
    if (before) before.before(group);
    else form.append(group);
    app.setPosition?.({ height: "auto" });
  }
};
