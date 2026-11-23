import { MODULE_ID, LANG, HOOKS } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Conditions } from "../conditions/engine.js";
import { Senses } from "../senses/senses.js";
import { UV_GLOW } from "../senses/senses-data.js";
import { TIERS, TIER_SIZE, tierForCondition, trailTier, bleedsAtAll, dropsAlong, shapeOf, trimMarks, seesMark, clearNear } from "./blood-data.js";
import { debounce, L } from "../util.js";

/**
 * Blood on the map. A spatter where a character takes a Critical Injury or becomes Seriously
 * Wounded, a pool where they become Mortally Wounded or flatline, and a trail behind the wounded
 * as they move: faint drops Lightly Wounded (only UV picks them up), a plain trail Seriously
 * Wounded, a smear where a Mortally Wounded or dead body is dragged. The GM can paint any of
 * them by hand, and wipe them.
 *
 * The marks are records on the scene (flag `blood`), written by the active GM and drawn by
 * every client under the tokens; under UV they fluoresce.
 */
export const BLOOD_FLAG = "blood";
const LAYER = "ncmBlood";
const RED = 0x7a0a10;

export const Blood = {
  /** Marks waiting to be written (the GM's client), and the tokens' last known places. */
  _pending: [],
  pos: new Map(),
  _paint: null,

  get on() {
    return !!Settings.get("bloodFx");
  },

  init() {
    const draw = debounce(() => this.draw(), 60);
    for (const h of ["canvasReady", "controlToken", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => draw());
    Hooks.on("updateScene", (scene, changed) => {
      if (scene.id === canvas?.scene?.id && changed?.flags?.[MODULE_ID] && (BLOOD_FLAG in changed.flags[MODULE_ID] || `-=${BLOOD_FLAG}` in changed.flags[MODULE_ID])) draw();
    });
    Hooks.on("canvasTearDown", () => {
      this.clearLayer();
      this.stopPaint();
    });
    Hooks.on("canvasReady", () => {
      this.pos.clear();
      for (const t of canvas?.scene?.tokens ?? []) this.pos.set(t.id, this.centre(t));
    });
    Hooks.on("createToken", (t) => this.pos.set(t.id, this.centre(t)));
    Hooks.on("deleteToken", (t) => this.pos.delete(t.id));
    Hooks.on("updateToken", (token, changed) => this.onMove(token, changed));
    Hooks.on(HOOKS.conditionAdded, (actor, c) => this.onCondition(actor, c));
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-blood", title: `${LANG}.Blood.Tool`, icon: "fa-solid fa-droplet", order: 113, visible: !!game.user?.isGM, onClick: () => this.open() }
    ]));
  },

  centre(token) {
    const grid = token.parent?.grid?.size ?? canvas?.dimensions?.size ?? 100;
    return { x: token.x + ((Number(token.width) || 1) * grid) / 2, y: token.y + ((Number(token.height) || 1) * grid) / 2 };
  },

  marks(scene = canvas?.scene) {
    const list = scene?.flags?.[MODULE_ID]?.[BLOOD_FLAG];
    return Array.isArray(list) ? list : [];
  },

  /** Does this character bleed? */
  bleeds(actor) {
    return bleedsAtAll({ meat: CPR.isMeat(actor), borg: CPR.isBorg(actor) });
  },

  /* ---------------------------------------- */
  /*  Leaving it (the active GM)              */
  /* ---------------------------------------- */

  /** Add marks to the scene: gathered for a moment, written together. */
  add(marks, scene = canvas?.scene) {
    if (!scene || !marks?.length || !game.user?.isGM) return;
    for (const m of marks) this._pending.push({ x: Math.round(m.x), y: Math.round(m.y), t: TIERS.includes(m.t) ? m.t : "trail", s: m.s ?? Math.floor(Math.random() * 1e6) + 1 });
    this._flush ??= debounce(() => this.flush(scene).catch((err) => console.error(`${MODULE_ID} | blood`, err)), 250);
    this._flush();
  },

  async flush(scene = canvas?.scene) {
    const add = this._pending.splice(0);
    if (!add.length || !scene) return;
    await scene.setFlag(MODULE_ID, BLOOD_FLAG, trimMarks([...this.marks(scene), ...add], Number(Settings.get("bloodMax")) || 600));
  },

  /** A condition arrived: a spatter or a pool under its character's tokens. */
  onCondition(actor, c) {
    if (!this.on || !Compat.isActiveGM || !canvas?.ready) return;
    const tier = tierForCondition(c);
    if (!tier || !this.bleeds(actor)) return;
    const tokens = (canvas.tokens?.placeables ?? []).filter((t) => t.actor === actor);
    this.add(tokens.map((t) => ({ x: t.center.x, y: t.center.y, t: tier })));
  },

  /** A token moved: the wounded leave a trail; a body that can't walk leaves a smear. */
  onMove(token, changed) {
    if (!("x" in changed || "y" in changed)) return;
    const from = this.pos.get(token.id) ?? null;
    const to = this.centre(token);
    this.pos.set(token.id, to);
    if (!this.on || !Settings.get("bloodTrails") || !Compat.isActiveGM || !from || token.parent?.id !== canvas?.scene?.id) return;
    const actor = token.actor;
    if (!actor || !this.bleeds(actor)) return;
    const tier = trailTier(Conditions.has("dead", actor) ? "dead" : CPR.woundState(actor));
    if (!tier) return;
    const grid = token.parent?.grid?.size ?? canvas.grid?.size ?? 100;
    const drops = dropsAlong(from, to, grid, { step: tier === "drag" ? 0.5 : 1, max: tier === "drag" ? 40 : 20, seed: Math.floor(Math.random() * 1e6) + 1 });
    this.add(drops.map((p) => ({ ...p, t: tier })));
  },

  /* ---------------------------------------- */
  /*  Drawing it (every client)               */
  /* ---------------------------------------- */

  clearLayer() {
    try {
      this._layer?.destroy?.({ children: true });
    } catch {
      /* gone with the canvas */
    }
    this._layer = null;
  },

  /** Draw the scene's blood under the tokens: red to the eye, bright under UV; the faint only under UV (and for the GM). */
  draw() {
    this.clearLayer();
    if (!canvas?.ready || typeof PIXI === "undefined" || !this.on || !Settings.get("bloodShow")) return 0;
    const uv = Senses.viewer()?.mode === "uv";
    const gm = !!game.user?.isGM;
    const grid = canvas.grid?.size ?? 100;
    const g = new PIXI.Graphics();
    let n = 0;
    for (const m of this.marks()) {
      if (!seesMark(m, { uv, gm })) continue;
      const faint = m.t === "faint";
      const color = uv ? UV_GLOW : RED;
      const dim = faint && !uv ? 0.35 : 1;
      for (const b of shapeOf(m, grid)) g.beginFill(color, Math.min(1, b.a * dim * (uv ? 1.1 : 1))).drawCircle(m.x + b.dx, m.y + b.dy, b.r).endFill();
      n++;
    }
    if (!n) {
      g.destroy();
      return 0;
    }
    const box = new PIXI.Container();
    box.name = LAYER;
    box.eventMode = "none";
    box.addChild(g);
    // Under the tokens, over the map and its tiles.
    const primary = canvas.primary;
    if (primary?.addChild) {
      box.elevation = 0;
      box.sortLayer = 550;
      box.sort = 1e6;
      box.zIndex = 1e6;
      primary.addChild(box);
      primary.sortChildren?.();
    } else (canvas.interface ?? canvas.stage).addChild(box);
    this._layer = box;
    return n;
  },

  /* ---------------------------------------- */
  /*  The GM's hand                           */
  /* ---------------------------------------- */

  /** The GM's window: paint a tier, wipe near the selected tokens, or wipe the scene. */
  async open() {
    if (!game.user?.isGM) return null;
    const content = `<div class="ncm-grid"><label>${L(`${LANG}.Blood.Tier`)}<select name="tier">${TIERS.map((t) => `<option value="${t}"${t === "trail" ? " selected" : ""}>${L(`${LANG}.Blood.Tiers.${t}`)}</option>`).join("")}</select></label><p class="ncm-ref">${L(`${LANG}.Blood.PaintHint`)}</p></div>`;
    const DialogV2 = Compat.DialogV2;
    const choice = await DialogV2.wait({
      window: { title: L(`${LANG}.Blood.Tool`) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      buttons: [
        { action: "paint", label: L(`${LANG}.Blood.Paint`), icon: "fa-solid fa-paintbrush", default: true, callback: (event, button) => ({ do: "paint", tier: button.form.elements.tier.value }) },
        { action: "near", label: L(`${LANG}.Blood.ClearNear`), icon: "fa-solid fa-eraser", callback: () => ({ do: "near" }) },
        { action: "all", label: L(`${LANG}.Blood.ClearAll`), icon: "fa-solid fa-trash", callback: () => ({ do: "all" }) }
      ],
      rejectClose: false
    }).catch(() => null);
    if (!choice) return null;
    if (choice.do === "paint") return this.paint(choice.tier);
    if (choice.do === "all") return this.clear();
    return this.clear({ near: (canvas.tokens?.controlled ?? []).map((t) => t.center) });
  },

  /** Wipe the scene's blood: all of it, or within three squares of each point given. */
  async clear({ near = null } = {}) {
    const scene = canvas?.scene;
    if (!scene || !game.user?.isGM) return 0;
    const before = this.marks(scene);
    let left = [];
    if (near?.length) {
      const radius = (canvas.grid?.size ?? 100) * 3;
      left = before;
      for (const p of near) left = clearNear(left, p, radius);
    } else if (near) {
      ui.notifications?.info(L(`${LANG}.Blood.SelectFirst`));
      return 0;
    }
    this._pending.length = 0;
    await scene.setFlag(MODULE_ID, BLOOD_FLAG, left);
    return before.length - left.length;
  },

  stopPaint() {
    const p = this._paint;
    if (!p) return;
    this._paint = null;
    canvas?.stage?.off?.("pointerdown", p.down);
    canvas?.stage?.off?.("pointermove", p.move);
    canvas?.stage?.off?.("pointerup", p.up);
    document.removeEventListener("keydown", p.key, true);
    ui.notifications?.info(L(`${LANG}.Blood.PaintDone`));
  },

  /**
   * Paint a tier with the mouse: hold the left button and drag (a mark about every square for
   * trails and smears; one where you press for spatters and pools). Right-click or Escape stops.
   */
  paint(tier) {
    if (!game.user?.isGM || !canvas?.ready || !TIERS.includes(tier)) return false;
    this.stopPaint();
    const grid = canvas.grid?.size ?? 100;
    const gap = ["splat", "pool"].includes(tier) ? Infinity : grid * (tier === "drag" ? 0.5 : 0.9);
    const p = { last: null, held: false };
    const here = () => Compat.mousePosition;
    const drop = () => {
      const at = here();
      if (!at) return;
      if (p.last && Math.hypot(at.x - p.last.x, at.y - p.last.y) < gap) return;
      p.last = { x: at.x, y: at.y };
      this.add([{ x: at.x, y: at.y, t: tier }]);
    };
    p.down = (ev) => {
      const b = ev.button ?? ev.data?.button;
      if (b === 2) return this.stopPaint();
      if (b !== 0) return undefined;
      p.held = true;
      p.last = null;
      drop();
      return undefined;
    };
    p.move = () => p.held && drop();
    p.up = () => {
      p.held = false;
    };
    p.key = (ev) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      this.stopPaint();
    };
    canvas.stage.on("pointerdown", p.down);
    canvas.stage.on("pointermove", p.move);
    canvas.stage.on("pointerup", p.up);
    document.addEventListener("keydown", p.key, true);
    this._paint = p;
    ui.notifications?.info(L(`${LANG}.Blood.Painting`, { tier: L(`${LANG}.Blood.Tiers.${tier}`) }));
    return true;
  },

  size: (tier) => TIER_SIZE[tier] ?? 0.4
};
