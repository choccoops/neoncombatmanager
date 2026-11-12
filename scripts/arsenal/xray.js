import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { Conditions } from "../conditions/engine.js";
import { Core } from "../neonfx/core.js";
import { L, debounce } from "../util.js";

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
export function throughThinCover(from, to, walls) {
  let crossed = 0;
  for (const w of walls) {
    if (!w.blocks) continue;
    const [x1, y1, x2, y2] = w.c;
    if (!segmentsCross(from, to, { x: x1, y: y1 }, { x: x2, y: y2 })) continue;
    if (!w.thin) return false;
    crossed++;
  }
  return crossed > 0;
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
    Hooks.on("renderWallConfig", (app, html) => this.wallConfig(app, html));
  },

  get on() {
    return !!Settings.get("arsenalXray") && !!Settings.get("arsenalRebuilds") && Core.on;
  },

  /** The tokens this player looks through: the selected ones with a Tech Weapon in hand. */
  viewers() {
    return (canvas?.tokens?.controlled ?? []).filter((t) => t.actor && Conditions.has("techRebuild", t.actor));
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
      return viewers.some((v) => Math.hypot(t.center.x - v.center.x, t.center.y - v.center.y) <= range && throughThinCover(v.center, t.center, walls));
    });
  },

  /** Draw the outlines that are missing and end the ones no longer wanted (this screen only). */
  refresh() {
    const want = this.on ? this.wanted() : [];
    const ids = new Set(want.map((t) => t.id));
    for (const [id, name] of this.drawn) {
      if (ids.has(id)) continue;
      this.drawn.delete(id);
      try {
        Sequencer.EffectManager.endEffects({ name });
      } catch {
        /* gone */
      }
    }
    const add = want.filter((t) => !this.drawn.has(t.id));
    this.drawPads(want);
    if (!add.length) return want;
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    for (const t of add) {
      const name = `${XRAY}-${t.id}`;
      this.drawn.set(t.id, name);
      seq.effect().name(name).copySprite(t).attachTo(t, { bindVisibility: false, bindAlpha: false }).size(Core.artSize(t)).rotate(0)
        .filter("Glow", { color: CYAN, distance: 8, outerStrength: 3, innerStrength: 0, quality: 0.2, knockout: true })
        .xray(true).zIndex(20).persist().locally().fadeIn(250).fadeOut(250)
        .loopProperty("sprite", "alpha", { values: [0.5, 0.95], duration: 900, pingPong: true, absolute: true });
    }
    seq.play();
    return want;
  },

  /* ---------------------------------------- */
  /*  Targeting an outline                    */
  /* ---------------------------------------- */

  /** The outlined tokens, nearest the viewer first. */
  seen() {
    const [v] = this.viewers();
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

  clearPads() {
    const old = canvas?.interface?.getChildByName?.(PADS);
    if (old) old.destroy({ children: true });
  },

  /**
   * A token nobody can see can't be clicked, so each outline gets a pad of its own over it: click
   * to target (Shift adds), hover and press the Target key as on any token. Foundry draws no
   * target marker on a token that's out of sight, so the pad draws the brackets.
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
      pad.hitArea = new PIXI.Rectangle(0, 0, w, h);
      pad.eventMode = "static";
      pad.cursor = "crosshair";
      if (game.user.targets?.has?.(t)) {
        const k = Math.max(8, Math.round(Math.min(w, h) * 0.22));
        pad.lineStyle(3, CYAN, 0.95);
        for (const [x, y, dx, dy] of [[0, 0, 1, 1], [w, 0, -1, 1], [w, h, -1, -1], [0, h, 1, -1]]) {
          pad.moveTo(x + dx * k, y).lineTo(x, y).lineTo(x, y + dy * k);
        }
      }
      // The click stays here: the canvas would otherwise let go of the selected shooter, and the scope with it.
      pad.on("pointerdown", (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        event.stopPropagation?.();
        this.target(t, { add: !!event.shiftKey });
      });
      pad.on("pointerover", () => {
        if (canvas.tokens) canvas.tokens.hover = t;
      });
      pad.on("pointerout", () => {
        if (canvas.tokens?.hover === t) canvas.tokens.hover = null;
      });
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
