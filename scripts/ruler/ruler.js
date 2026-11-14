import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Conditions } from "../conditions/engine.js";
import { reach, legs, squaresAlong, label, bandOf, moveCheck, ranThisTurn, reachTaken, RUN_FLAG, COLORS } from "./ruler-core.js";
import { Cards } from "../combat/cards.js";
import { L } from "../util.js";

export const DRAG_RULER_ID = "drag-ruler";

/** The combatant flag holding a token's path this Turn: { points: [{x, y}] (centres), metres, noMove }. */
export const PATH_FLAG = "path";

/**
 * The movement ruler, in place of Drag Ruler. While you drag a token, its path shows square by
 * square in the band each one falls in: within the Move Action (cyan), with a Run (yellow), out of
 * reach (red), from the character's MOVE now (conditions included), counting what they already
 * walked this Turn (the faded path). Space or right-click drops a waypoint, Backspace takes the
 * last one back, and on release the token walks the waypoints (stopping at a wall).
 *
 * Foundry v13 measures token drags itself: there Neon Combat Manager colours its ruler by the same
 * bands. With Drag Ruler running (v12), Drag Ruler gets these bands as its speed provider instead.
 */
export const NeonRuler = {
  state: null,
  gfx: null,

  init() {
    Hooks.once("dragRuler.ready", (SpeedProvider) => this.registerSpeedProvider(SpeedProvider));
    // Before the first scene is drawn: a token keeps the drag handlers it was drawn with, so a
    // ruler put in at "ready" (after the canvas) never reached the tokens already on the map.
    Hooks.once("setup", () => {
      try {
        this.ready({ quiet: true });
      } catch (err) {
        console.warn(`${MODULE_ID} | ruler`, err);
      }
    });
    // In a fight, on their Turn, a token goes as far as its character can this Turn.
    Hooks.on("preUpdateToken", (doc, changes, options) => this.limit(doc, changes, options));
  },

  get on() {
    return Settings.get("movementRuler") !== "off";
  },

  ready({ quiet = false } = {}) {
    if (!this.on) return;
    if (Compat.isV13) return this.installV13();
    if (game.modules.get(DRAG_RULER_ID)?.active) {
      if (!quiet && game.user.isGM && !Settings.get("movementRulerNoticed")) {
        ui.notifications.info(L(`${LANG}.Ruler.DragRulerNotice`), { permanent: true });
        Settings.set("movementRulerNoticed", true);
      }
      return false;
    }
    return this.installV12();
  },

  /* ---------------------------------------- */
  /*  Who can go how far                      */
  /* ---------------------------------------- */

  /** The combatant for a token in the started combat, or null. */
  combatantOf(token) {
    const doc = token?.document ?? token;
    const combat = game.combats?.find?.((c) => c.started && (!c.scene || c.scene.id === doc?.parent?.id)) ?? null;
    return combat?.combatants?.find?.((c) => c.tokenId === doc?.id) ?? null;
  },

  /** How far this token's character gets this Turn: { move, run, why }. */
  reachFor(token) {
    const actor = token?.actor ?? token?.document?.actor;
    if (!actor) return { move: Infinity, run: Infinity, why: null };
    const cb = this.combatantOf(token);
    return reach(CPR.stat(actor, "move"), {
      prone: Conditions.has("prone", actor),
      grappled: Conditions.has("grappled", actor),
      noMove: !!cb?.flags?.[MODULE_ID]?.[PATH_FLAG]?.noMove
    });
  },

  /**
   * A token is about to move (whoever moves it): held to what its character can cover this Turn.
   * A player's move past it doesn't happen (or goes with a warning, by setting); a GM's always does.
   */
  limit(doc, changes, options = {}) {
    if (!("x" in (changes ?? {}) || "y" in (changes ?? {})) || options?.[MODULE_ID]?.free) return true;
    const mode = Settings.get("movementLimit");
    if (mode === "off" || !Settings.get("trackMovement")) return true;
    const cb = this.combatantOf(doc);
    const combat = cb?.parent ?? cb?.combat ?? null;
    if (!cb || !combat?.started || combat.combatant?.id !== cb.id) return true;
    const size = doc.parent?.grid?.size ?? canvas?.dimensions?.size ?? 100;
    const half = { x: ((Number(doc.width) || 1) * size) / 2, y: ((Number(doc.height) || 1) * size) / 2 };
    const from = { x: doc.x + half.x, y: doc.y + half.y };
    const to = { x: (changes.x ?? doc.x) + half.x, y: (changes.y ?? doc.y) + half.y };
    const full = this.reachFor(doc);
    // Past the Move Action takes a Run (the Action HUD's button), where there's an Action HUD to take it on.
    const ran = !this.runTaken || this.ran(cb, combat);
    const r = reachTaken(full, ran);
    const walked = this.historyFor(doc).metres;
    const step = this.measure(from, to);
    const check = moveCheck({ walked, step, r, mode, gm: !!game.user?.isGM, ownTurn: true });
    if (!check.warn) return true;
    const unit = canvas?.scene?.grid?.units || canvas?.grid?.units || "m";
    const round = (n) => Math.round(n * 10) / 10;
    // Would a Run cover it? Then that's what to say.
    const needsRun = !ran && !moveCheck({ walked, step, r: full, mode, ownTurn: true }).warn;
    const why = check.why && !needsRun ? ` ${L(`${LANG}.Ruler.why.${check.why}`)}` : "";
    const key = needsRun ? (check.ok ? "PastMove" : "NeedRun") : check.ok ? "PastReach" : "Held";
    ui.notifications?.warn(L(`${LANG}.Ruler.${key}`, { name: doc.name, left: round(check.left), unit }) + why);
    return check.ok;
  },

  /** Is a Run something that's taken (a button to press) here? Only with the Action HUD to press it on. */
  get runTaken() {
    return !!Settings.get("actionHud") && !!Settings.get("movementRun");
  },

  /** Has this combatant taken a Run this Turn? */
  ran(cb, combat = cb?.parent ?? game.combat) {
    return ranThisTurn(cb?.flags?.[MODULE_ID]?.[RUN_FLAG], combat?.round);
  },

  /**
   * Take a Run this Turn (the Action HUD): the Action goes on a second Move Action, and the
   * token can go on into the Run's distance. Pressed again before going that far, it's taken back.
   * @returns {Promise<boolean|null>} whether a Run is now taken; null when it can't be
   */
  async toggleRun(actor, token = null) {
    const combat = game.combats?.find?.((c) => c.started && [...(c.combatants ?? [])].some((x) => (token && x.tokenId === (token.id ?? token.document?.id)) || x.actor === actor || x.actorId === actor?.id)) ?? null;
    const cb = combat ? [...combat.combatants].find((x) => (token && x.tokenId === (token.id ?? token.document?.id)) || x.actor === actor || x.actorId === actor?.id) : null;
    if (!cb || combat.combatant?.id !== cb.id) {
      ui.notifications?.warn(L(`${LANG}.Hud.NotYourTurn`));
      return null;
    }
    if (!cb.isOwner) return null;
    if (this.ran(cb, combat)) {
      const r = this.reachFor(cb.token ?? token);
      if ((Number(cb.flags?.[MODULE_ID]?.[PATH_FLAG]?.metres) || 0) > r.move + 1e-6) {
        ui.notifications?.info(L(`${LANG}.Ruler.RunUsed`, { name: cb.name }));
        return true;
      }
      await cb.unsetFlag(MODULE_ID, RUN_FLAG);
      return false;
    }
    await cb.setFlag(MODULE_ID, RUN_FLAG, { round: combat.round });
    const r = this.reachFor(cb.token ?? token);
    const unit = canvas?.scene?.grid?.units || "m";
    await Cards.post({ actor, kicker: L(`${LANG}.Ruler.RunKicker`), title: L(`${LANG}.Ruler.RunTitle`, { name: cb.name }), body: `<p>${L(`${LANG}.Ruler.RunBody`, { total: r.run, unit })}</p>`, tone: "cyan" });
    return true;
  },

  /** The path walked this Turn (on its own Turn, in combat): { points, metres }. */
  historyFor(token) {
    const cb = this.combatantOf(token);
    const combat = cb?.parent ?? cb?.combat ?? game.combat;
    if (!cb || !Settings.get("trackMovement") || combat?.combatant?.id !== cb.id) return { points: [], metres: 0 };
    const p = cb.flags?.[MODULE_ID]?.[PATH_FLAG];
    return { points: Array.isArray(p?.points) ? p.points : [], metres: Number(p?.metres) || 0 };
  },

  /* ---------------------------------------- */
  /*  Drag Ruler (when it's running)          */
  /* ---------------------------------------- */

  registerSpeedProvider(SpeedProvider) {
    const self = this;
    class NeonSpeedProvider extends SpeedProvider {
      get colors() {
        return [
          { id: "move", default: COLORS.move, name: `${LANG}.Ruler.move` },
          { id: "run", default: COLORS.run, name: `${LANG}.Ruler.run` }
        ];
      }

      get defaultUnreachableColor() {
        return COLORS.over;
      }

      getRanges(token) {
        const r = self.reachFor(token);
        return [{ range: r.move, color: "move" }, { range: r.run, color: "run" }].filter((x) => x.range > 0);
      }
    }
    globalThis.dragRuler?.registerModule?.(MODULE_ID, NeonSpeedProvider);
    return NeonSpeedProvider;
  },

  /* ---------------------------------------- */
  /*  Foundry v13: its own token ruler        */
  /* ---------------------------------------- */

  /** The band colour for a v13 ruler waypoint (its distance is measured from the drag's start, history included). */
  colorFor(token, waypoint) {
    const d = waypoint?.measurement?.distance ?? waypoint?.distance;
    if (!Number.isFinite(Number(d))) return null;
    return COLORS[bandOf(Number(d), this.reachFor(token))];
  },

  installV13() {
    const Base = CONFIG.Token?.rulerClass;
    if (!Base || Base[`${MODULE_ID}Ruler`]) return false;
    const self = this;
    class NeonTokenRuler extends Base {
      static [`${MODULE_ID}Ruler`] = true;

      _getGridHighlightStyle(waypoint, offset) {
        const style = super._getGridHighlightStyle(waypoint, offset);
        const color = waypoint?.stage === "passed" ? null : self.colorFor(this.token, waypoint);
        return color === null || !style ? style : { ...style, color };
      }

      _getSegmentStyle(waypoint) {
        const style = super._getSegmentStyle(waypoint);
        const color = waypoint?.stage === "passed" ? null : self.colorFor(this.token, waypoint);
        return color === null || !style ? style : { ...style, color };
      }
    }
    CONFIG.Token.rulerClass = NeonTokenRuler;
    return true;
  },

  /* ---------------------------------------- */
  /*  Foundry v12: Neon Combat Manager's own  */
  /* ---------------------------------------- */

  installV12() {
    const proto = CONFIG.Token?.objectClass?.prototype;
    if (!proto || Object.prototype.hasOwnProperty.call(proto, `${MODULE_ID}Ruler`)) return false;
    proto[`${MODULE_ID}Ruler`] = true;
    const self = this;
    const wrap = (name, fn) => {
      const original = proto[name];
      if (typeof original !== "function") return;
      proto[name] = function (...args) {
        return fn.call(this, original, ...args);
      };
    };
    wrap("_onDragLeftStart", function (original, event) {
      const out = original.call(this, event);
      try {
        self.start(this);
      } catch (err) {
        console.warn(`${MODULE_ID} | ruler`, err);
      }
      return out;
    });
    wrap("_onDragLeftMove", function (original, event) {
      const out = original.call(this, event);
      if (self.state?.token === this) self.move(event);
      return out;
    });
    wrap("_onDragLeftDrop", function (original, event) {
      const s = self.state;
      if (s?.token === this && s.waypoints.length && Settings.get("movementRulerWaypoints")) {
        const path = [...s.waypoints, s.end].filter(Boolean);
        self.end();
        this._onDragLeftCancel?.(event);
        self.walk(this.document, path).catch((err) => console.error(`${MODULE_ID} | ruler walk`, err));
        return false;
      }
      self.end();
      return original.call(this, event);
    });
    wrap("_onDragLeftCancel", function (original, event) {
      if (self.state?.token === this) self.end();
      return original.call(this, event);
    });
    // Tokens already drawn took their handlers before this: give them the new ones.
    for (const t of canvas?.tokens?.placeables ?? []) {
      try {
        t.activateListeners?.();
      } catch {
        /* drawn again on the next scene change */
      }
    }
    return true;
  },

  /** A drag starts: one token you own. */
  start(token) {
    this.end();
    const dragged = canvas.tokens?.controlled ?? [];
    if (dragged.length > 1 || !token?.isOwner || !token.actor) return;
    const history = this.historyFor(token);
    this.state = {
      token,
      origin: Compat.snapCenter(token.center),
      history,
      reach: this.reachFor(token),
      waypoints: [],
      end: null
    };
    this.gfx = new PIXI.Container();
    this.gfx.eventMode = "none";
    (canvas.controls ?? canvas.stage).addChild(this.gfx);
    this.onKey = (ev) => this.key(ev);
    this.onPointer = (ev) => {
      if ((ev.button ?? ev.data?.button) === 2) this.addWaypoint();
    };
    document.addEventListener("keydown", this.onKey, true);
    canvas.stage.on("pointerdown", this.onPointer);
  },

  /** Where the dragged token's centre is now (snapped to the square). */
  move(event) {
    const s = this.state;
    if (!s) return;
    const clone = event?.interactionData?.clones?.[0];
    const at = clone?.center ?? event?.interactionData?.destination ?? Compat.mousePosition;
    if (!at) return;
    s.end = Compat.snapCenter(at);
    this.draw();
  },

  key(ev) {
    if (!this.state) return;
    if (ev.code === "Space") this.addWaypoint();
    else if (ev.code === "Backspace") this.state.waypoints.pop();
    else return;
    ev.preventDefault();
    ev.stopPropagation();
    this.draw();
  },

  addWaypoint() {
    const s = this.state;
    if (!s?.end) return;
    const last = s.waypoints.at(-1) ?? s.origin;
    if (last.x !== s.end.x || last.y !== s.end.y) s.waypoints.push({ ...s.end });
    this.draw();
  },

  end() {
    if (this.onKey) document.removeEventListener("keydown", this.onKey, true);
    if (this.onPointer) canvas?.stage?.off?.("pointerdown", this.onPointer);
    this.onKey = null;
    this.onPointer = null;
    this.gfx?.destroy?.({ children: true });
    this.gfx = null;
    this.state = null;
  },

  measure(a, b) {
    return Compat.measure(a, b);
  },

  /** Draw the path: the walked part faded, then each square in its band, the line and the distance. */
  draw() {
    const s = this.state;
    if (!s || !this.gfx || !s.end) return;
    const size = canvas.grid.size;
    const g = new PIXI.Graphics();
    this.gfx.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.gfx.addChild(g);
    const histPts = s.history.points;
    if (histPts.length > 1) {
      for (const sq of squaresAlong(histPts, (a, b) => this.measure(a, b), { move: Infinity, run: Infinity }, { size })) {
        g.beginFill(COLORS.history, 0.18).drawRect(sq.x - size / 2, sq.y - size / 2, size, size).endFill();
      }
    }
    const pts = [s.origin, ...s.waypoints, s.end];
    for (const sq of squaresAlong(pts, (a, b) => this.measure(a, b), s.reach, { size }, s.history.metres)) {
      g.beginFill(COLORS[sq.band], 0.3).drawRect(sq.x - size / 2, sq.y - size / 2, size, size).endFill();
    }
    const segs = legs(pts, (a, b) => this.measure(a, b), s.reach, s.history.metres);
    for (const leg of segs) {
      g.lineStyle(4, 0x000000, 0.5).moveTo(leg.from.x, leg.from.y).lineTo(leg.to.x, leg.to.y);
      g.lineStyle(2, COLORS[leg.band], 0.95).moveTo(leg.from.x, leg.from.y).lineTo(leg.to.x, leg.to.y);
    }
    for (const w of s.waypoints) g.lineStyle(2, 0xffffff, 0.9).beginFill(0x000000, 0.6).drawCircle(w.x, w.y, size / 8).endFill();
    const total = segs.at(-1)?.end ?? s.history.metres;
    const unit = canvas.scene?.grid?.units || "m";
    let text = label(total, s.reach, { unit, words: { move: L(`${LANG}.Ruler.move`), run: L(`${LANG}.Ruler.run`), over: L(`${LANG}.Ruler.over`) } });
    if (s.reach.why) text += `\n${L(`${LANG}.Ruler.why.${s.reach.why}`)}`;
    if (s.history.metres) text += `\n${L(`${LANG}.Ruler.walked`, { metres: Math.round(s.history.metres), unit })}`;
    const style = CONFIG.canvasTextStyle.clone();
    style.fontSize = Math.max(14, Math.round(size / 4));
    style.fill = COLORS[bandOf(total, s.reach)];
    const t = new Compat.PreciseText(text, style);
    t.anchor.set(0.5, 1.4);
    t.position.set(s.end.x, s.end.y - size / 2);
    this.gfx.addChild(t);
  },

  /** Walk a token along waypoints (centres), one leg at a time; a wall stops it (players). */
  async walk(doc, centres) {
    const token = doc.object;
    const size = doc.parent?.grid?.size ?? canvas.grid.size;
    const half = { x: ((Number(doc.width) || 1) * size) / 2, y: ((Number(doc.height) || 1) * size) / 2 };
    let from = { x: doc.x + half.x, y: doc.y + half.y };
    for (const c of centres) {
      if (!game.user.isGM && token?.checkCollision?.(c, { origin: from, type: "move", mode: "any" })) {
        ui.notifications.warn(L(`${LANG}.Ruler.Blocked`));
        return false;
      }
      await doc.update({ x: c.x - half.x, y: c.y - half.y });
      const ctx = token?.animationContexts?.get?.(token.animationName);
      await (ctx?.promise ?? new Promise((r) => setTimeout(r, 200)));
      from = c;
    }
    return true;
  }
};
