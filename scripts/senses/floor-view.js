import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Levels } from "./levels.js";
import { ghostsFor } from "./levels-data.js";
import { Cloak } from "./cloak.js";
import { debounce } from "../util.js";

/**
 * Looking onto the other floors: whoever is on another floor of the building the viewer's token
 * is in shows on the viewer's own floor, at the spot straight above or below, as a pale figure:
 * cool blue with ▲ and the height for those above, warm amber with ▼ for those below. The
 * figures are this client's own drawing (nothing is added to the scene), and clicking one
 * targets the real token (Shift to add), so an attack up or down the building is aimed and
 * measured at the right one.
 *
 * Left out: hidden tokens (for players), cloaks the viewer hasn't seen through, and anyone
 * Multilevel Tokens already shows on this floor as a clone.
 */
const ABOVE = 0x7fd4ff;
const BELOW = 0xffb46b;
const AIMED = 0xff4d4d;
const MLT = "multilevel-tokens";

export const FloorView = {
  layer: null,

  get mode() {
    return Levels.on ? String(Settings.get("levelsView") || "all") : "off";
  },

  init() {
    const soon = debounce(() => this.draw(), 80);
    for (const h of ["canvasReady", "controlToken", "updateToken", "createToken", "deleteToken", "targetToken", "updateScene", "updateRegion", "deleteRegion", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    Hooks.on("canvasTearDown", () => this.clear());
  },

  viewer() {
    if (!canvas?.ready) return null;
    const controlled = canvas.tokens?.controlled ?? [];
    let token = controlled.length === 1 ? controlled[0] : null;
    if (!token && !controlled.length && !game.user?.isGM) token = game.user?.character?.getActiveTokens?.()[0] ?? null;
    return token && (token.isOwner || game.user?.isGM) ? token : null;
  },

  /** Who's drawn for this client right now: [{ token, x, y, up }]. */
  ghosts() {
    const v = this.viewer();
    if (!v || this.mode === "off") return [];
    const scene = v.document?.parent ?? canvas.scene;
    const floors = Levels.floors(scene);
    if (!floors.length) return [];
    const vp = Levels.place(v, scene);
    if (!vp?.floor) return [];
    const all = canvas.tokens?.placeables ?? [];
    // Who Multilevel Tokens has already put on this floor.
    const cloned = new Set(all.filter((t) => t.document?.flags?.[MLT]?.stoken && Levels.place(t, scene)?.floor?.region === vp.floor.region).map((t) => t.document.flags[MLT].stoken));
    const others = [];
    for (const t of all) {
      if (t === v || !t.actor || t.document?.flags?.[MLT]?.stoken || cloned.has(t.id)) continue;
      if (!game.user?.isGM && (t.document?.hidden || Cloak.hides(t, v) || Cloak.unseen(t))) continue;
      const p = Levels.place(t, scene);
      if (p?.floor) others.push({ id: t.id, floor: p.floor, corner: p.corner, point: p.point, height: p.height });
    }
    return ghostsFor(vp, others, floors, this.mode).map((g) => ({ ...g, token: all.find((t) => t.id === g.id) })).filter((g) => g.token);
  },

  clear() {
    const l = this.layer;
    this.layer = null;
    try {
      l?.parent?.removeChild(l);
      l?.destroy({ children: true });
    } catch {
      /* gone with the canvas */
    }
  },

  draw() {
    this.clear();
    if (!canvas?.ready || typeof PIXI === "undefined") return 0;
    const ghosts = this.ghosts();
    if (!ghosts.length) return 0;
    const layer = new PIXI.Container();
    layer.eventMode = "passive";
    const unit = canvas.scene?.grid?.units || "m";
    for (const g of ghosts) layer.addChild(this.figure(g, unit));
    (canvas.interface ?? canvas.stage).addChild(layer);
    this.layer = layer;
    return ghosts.length;
  },

  /** One pale figure: the token's own picture, a ring in its floor's colour, and how far up or down it is. */
  figure(g, unit) {
    const t = g.token;
    const color = g.up > 0 ? ABOVE : BELOW;
    const aimed = !!t.isTargeted && [...(game.user?.targets ?? [])].includes(t);
    const w = t.w || 100;
    const h = t.h || 100;
    const box = new PIXI.Container();
    box.position.set(g.x, g.y);
    const r = Math.max(w, h) / 2;
    const ring = new PIXI.Graphics();
    ring.beginFill(color, 0.12).drawCircle(0, 0, r).endFill();
    ring.lineStyle(aimed ? 4 : 2, aimed ? AIMED : color, 0.9).drawCircle(0, 0, r + 1);
    if (aimed) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ring.moveTo(dx * (r - 6), dy * (r - 6)).lineTo(dx * (r + 10), dy * (r + 10));
    box.addChild(ring);
    const texture = t.mesh?.texture ?? t.texture ?? null;
    if (texture) {
      const pic = new PIXI.Sprite(texture);
      pic.anchor.set(0.5);
      pic.width = w;
      pic.height = h;
      pic.alpha = 0.55;
      pic.tint = color;
      box.addChild(pic);
    }
    const label = new PIXI.Text(`${g.up > 0 ? "▲" : "▼"} ${Math.abs(g.up)} ${unit}`, {
      fontFamily: globalThis.CONFIG?.canvasTextStyle?.fontFamily ?? "Signika", fontSize: Math.max(14, Math.round(h * 0.2)), fontWeight: "bold",
      fill: color, stroke: 0x000000, strokeThickness: 4, align: "center"
    });
    label.anchor.set(0.5, 0);
    label.position.set(0, r + 4);
    box.addChild(label);
    // Click it to aim at the real one.
    box.eventMode = "static";
    box.cursor = "pointer";
    box.hitArea = new PIXI.Circle(0, 0, r);
    box.on("pointerdown", (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      ev.stopPropagation?.();
      this.aim(t, { add: !!ev.shiftKey });
    });
    return box;
  },

  aim(token, { add = false } = {}) {
    const on = !(token.isTargeted && [...(game.user?.targets ?? [])].includes(token));
    token.setTarget?.(on, { releaseOthers: !add });
  }
};
