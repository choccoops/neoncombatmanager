import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Stairs } from "./stairs.js";
import { Levels } from "./levels.js";
import { NeonRuler } from "../ruler/ruler.js";
import { Turns } from "../combat/turns.js";
import { STAIRS_FLAG, KIND_ICON, landing } from "./stairs-data.js";
import { CLIMB_FLAG, WALL_FLAG, GAP, factorOf, stretch, aheadOf, heightAt, across, toSegment, elevationAfter } from "./climb-data.js";
import { L, esc, debounce } from "../util.js";

/**
 * Climbing at the table (see climb-data.js for the rules).
 *
 * - **Ladders with a height**: linking two tiles as a ladder asks how high it is. A token on the
 *   foot is offered "Climb"; it goes up as far as its movement allows this Turn (2 for 1, or 1 for
 *   1 with Grip Feet or a grapple line) and stays there, its elevation raised, until it climbs on.
 *   At the top it's put on the head tile. From the head it's offered the climb down.
 * - **Climbable walls**: the GM selects walls and presses the ladder button in the wall controls,
 *   giving a height and whether it's climbed over (a fence: up and down the far side) or onto (a
 *   ledge or roof). A token next to one is offered the climb.
 * - **Height** is the token's elevation while it climbs, so Foundry shows it and attack distances
 *   count it. A gauge beside the ladder shows everyone on it, in order.
 * - **Several climbers** on one ladder go single file, a body's length apart; the one in front
 *   sets the pace. Walls are climbed side by side.
 * - Out of combat, or off its own Turn, a token climbs the whole way at once.
 * The GM's client does the climbing for whoever may move the token.
 */
export const Climb = {
  layer: null,

  get on() {
    return Stairs.on && Settings.get("climbing") !== false;
  },

  init() {
    Socket.on("climbGo", (data, userId) => this._go(data, userId));
    Stairs.providers.push((token) => this.promptFor(token));
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-climb-wall", title: `${LANG}.Climb.WallTool`, icon: "fa-solid fa-water-ladder", order: 120, visible: !!game.user?.isGM, onClick: () => this.markWalls() }
    ], "walls"));
    const soon = debounce(() => this.draw(), 120);
    for (const h of ["canvasReady", "updateToken", "deleteToken", "createTile", "updateTile", "deleteTile", "updateWall", "deleteWall", "updateScene", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    Hooks.on("canvasTearDown", () => this.clear());
    Hooks.on("updateToken", (doc, changed, options) => {
      this.onMove(doc, changed, options).catch((err) => console.error(`${MODULE_ID} | climb`, err));
    });
  },

  doc: (t) => t?.document ?? t ?? null,
  state(token) {
    const st = this.doc(token)?.flags?.[MODULE_ID]?.[CLIMB_FLAG];
    return st?.id ? st : null;
  },

  /** Grip Feet: no penalty for climbing, anywhere. */
  sure: (actor) => !!actor && CPR.hasGear(actor, ["Grip Foot", "Grip Feet"]),
  /** A Grapple Hand or a Grapple Gun: no penalty when it's their line that's climbed. */
  hasLine: (actor) => !!actor && CPR.hasGear(actor, ["Grapple Hand", "Grapple Gun"]),

  floorAt(point, scene) {
    return Levels.on ? Levels.place(point, scene)?.floor?.height ?? 0 : 0;
  },

  /* ---------------------------------------- */
  /*  What can be climbed from here           */
  /* ---------------------------------------- */

  /** The ladder (with a height) a token stands at an end of: { id (the foot tile), foot, head, height, end }. */
  ladderFor(token) {
    const doc = this.doc(token);
    const way = Stairs.wayFor(doc);
    if (!way || way.from.kind !== "ladder" || !(way.from.rise > 0)) return null;
    const atFoot = way.from.end !== "head";
    const foot = atFoot ? way.from : way.to;
    const head = atFoot ? way.to : way.from;
    return { id: foot.id, foot, head, height: way.from.rise, end: atFoot ? "foot" : "head" };
  },

  walls(scene = canvas?.scene) {
    return [...(scene?.walls ?? [])].filter((w) => Number(w.flags?.[MODULE_ID]?.[WALL_FLAG]?.height) > 0).map((w) => {
      const c = w.c ?? [];
      return { id: w.id, a: { x: c[0], y: c[1] }, b: { x: c[2], y: c[3] }, height: Number(w.flags[MODULE_ID][WALL_FLAG].height), over: !!w.flags[MODULE_ID][WALL_FLAG].over };
    });
  },

  /** The climbable wall a token stands against (the nearest within reach), or null. */
  wallFor(token) {
    const doc = this.doc(token);
    if (!doc?.parent) return null;
    const size = Stairs.sizeOf(doc);
    const p = Stairs.centre(doc);
    const reach = Math.max(size.w, size.h) / 2 + Stairs.grid(doc) * 0.6;
    return this.walls(doc.parent).map((w) => ({ ...w, d: toSegment(p, w.a, w.b) })).filter((w) => w.d <= reach).sort((x, y) => x.d - y.d)[0] ?? null;
  },

  /** Is a token standing at the top of a wall (so the climb on offer is down)? */
  upAt(doc, wall) {
    if (wall.over) return false;
    const here = Stairs.centre(doc);
    const there = across(here, wall.a, wall.b);
    const mine = this.floorAt(here, doc.parent) + (Number(doc.elevation) || 0);
    return mine - this.floorAt(there, doc.parent) >= wall.height - 0.5;
  },

  /** What a token can do about climbing where it stands: [{ dir, label, sub }] with what's being climbed. */
  choices(token) {
    const doc = this.doc(token);
    if (!this.on || !doc?.parent) return null;
    const st = this.state(doc);
    if (st) {
      const what = L(`${LANG}.Climb.${st.kind === "wall" ? "Wall" : "Ladder"}`);
      return { icon: KIND_ICON.ladder, text: L(`${LANG}.Climb.On`, { what, at: st.at, total: st.total, unit: this.unit(doc) }), options: [{ dir: "up", label: L(`${LANG}.Climb.${st.over ? "Onward" : "Up"}`) }, { dir: "down", label: L(`${LANG}.Climb.${st.over ? "Back" : "Down"}`) }] };
    }
    const ladder = this.ladderFor(doc);
    if (ladder) {
      const dir = ladder.end === "foot" ? "up" : "down";
      return { icon: KIND_ICON.ladder, text: L(`${LANG}.Climb.Offer`, { what: L(`${LANG}.Climb.Ladder`), height: ladder.height, unit: this.unit(doc) }), options: [{ dir, label: L(`${LANG}.Climb.${dir === "up" ? "Up" : "Down"}`) }] };
    }
    const wall = this.wallFor(doc);
    if (wall) {
      const dir = this.upAt(doc, wall) ? "down" : "up";
      return { icon: KIND_ICON.ladder, text: L(`${LANG}.Climb.Offer`, { what: L(`${LANG}.Climb.${wall.over ? "Fence" : "Wall"}`), height: wall.height, unit: this.unit(doc) }), options: [{ dir, label: L(`${LANG}.Climb.${wall.over ? "Over" : dir === "up" ? "Up" : "Down"}`) }] };
    }
    return null;
  },

  unit: (doc) => doc?.parent?.grid?.units || canvas?.scene?.grid?.units || "m",

  /** The prompt at the foot of the screen (through Stairs.offer). */
  promptFor(token) {
    const c = this.choices(token);
    if (!c) return null;
    const doc = this.doc(token);
    const st = this.state(doc);
    const line = !this.sure(token.actor) && this.hasLine(token.actor);
    const buttons = c.options.map((o) => ({ label: o.label, run: () => this.go(token, { dir: o.dir }) }));
    if (line) buttons.push(...c.options.map((o) => ({ label: L(`${LANG}.Climb.ByLine`, { dir: o.label }), quiet: true, run: () => this.go(token, { dir: o.dir, line: true }) })));
    return { key: `climb:${doc.id}:${st?.id ?? ""}:${st?.at ?? ""}:${doc.x}:${doc.y}`, icon: c.icon, name: token.name ?? doc.name ?? "", text: c.text, buttons };
  },

  entries(actor, token) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    const c = tok ? this.choices(tok) : null;
    if (!c) return [];
    return c.options.map((o) => ({ key: `climb:${o.dir}`, label: o.label, sub: c.text, icon: c.icon, alert: true }));
  },

  /* ---------------------------------------- */
  /*  Climbing                                */
  /* ---------------------------------------- */

  /** Climb a stretch (through the GM's client), and tell this player how it went. */
  async go(token, { dir = "up", line = false } = {}) {
    const doc = this.doc(token);
    if (!doc?.parent) return null;
    const r = await Socket.request("climbGo", { scene: doc.parent.id, token: doc.id, dir, line });
    if (r?.note) ui.notifications?.info(r.note);
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return r;
  },

  /** The movement a token has left to climb with: counted on its own Turn in a running combat, else unlimited. */
  budget(doc) {
    if (!Settings.get("trackMovement")) return { left: Infinity, cb: null };
    const combat = game.combats?.find?.((c) => c.started && c.combatant?.tokenId === doc.id && (!c.scene || c.scene.id === doc.parent?.id));
    const cb = combat?.combatant ?? null;
    if (!cb) return { left: Infinity, cb: null };
    const left = NeonRuler.leftFor(cb, combat)?.left;
    return { left: Number.isFinite(left) ? left : Infinity, cb };
  },

  /** Where everyone else on the same one-lane climb is. */
  othersOn(doc, st) {
    if (st.kind !== "tile") return [];
    return [...(doc.parent?.tokens ?? [])].filter((t) => t.id !== doc.id && this.state(t)?.id === st.id).map((t) => this.state(t).at);
  },

  opts: () => ({ animate: false, [MODULE_ID]: { free: true, stairs: true, climb: true } }),

  /** GM's client: one stretch of climbing for a token, for whoever may move it. */
  async _go({ scene, token, dir = "up", line = false }, userId) {
    const sc = game.scenes?.get?.(scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(token);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!this.on || !doc || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return null;
    const size = Stairs.sizeOf(doc);
    let st = this.state(doc);
    // Starting: onto the ladder or the wall.
    if (!st) {
      const elevation = Number(doc.elevation) || 0;
      const ladder = this.ladderFor(doc);
      const wall = ladder ? null : this.wallFor(doc);
      if (ladder) {
        const floorFoot = this.floorAt(this.mid(ladder.foot), sc);
        const floorHead = this.floorAt(this.mid(ladder.head), sc);
        if (ladder.end === "foot") st = { kind: "tile", id: ladder.id, at: 0, height: ladder.height, total: ladder.height, base: elevation, to: ladder.head.id };
        else {
          // From the head: onto the ladder at its top, which is drawn at its foot.
          st = { kind: "tile", id: ladder.id, at: ladder.height, height: ladder.height, total: ladder.height, base: Math.round((elevation + (floorHead - floorFoot) - ladder.height) * 10) / 10, to: ladder.head.id };
          await doc.update({ ...landing(ladder.foot, size.w, size.h), elevation: st.base + st.at }, this.opts());
        }
      } else if (wall) {
        const here = Stairs.centre(doc);
        const there = across(here, wall.a, wall.b);
        if (this.upAt(doc, wall)) {
          const base = Math.round((elevation + (this.floorAt(here, sc) - this.floorAt(there, sc)) - wall.height) * 10) / 10;
          st = { kind: "wall", id: wall.id, at: wall.height, height: wall.height, total: wall.height, base, over: false, crossed: true, from: here };
          await doc.update({ x: there.x - size.w / 2, y: there.y - size.h / 2, elevation: base + wall.height }, this.opts());
        } else st = { kind: "wall", id: wall.id, at: 0, height: wall.height, total: wall.over ? wall.height * 2 : wall.height, base: elevation, over: wall.over, crossed: false, to: there };
      } else return null;
    }
    const { left, cb } = this.budget(doc);
    const factor = factorOf({ sure: this.sure(doc.actor), line: !!line && this.hasLine(doc.actor) });
    const ahead = aheadOf(st.at, this.othersOn(doc, st), dir);
    const res = stretch({ at: st.at, total: st.total, dir, left, factor, ahead });
    if (cb && res.cost > 0) await Turns.spend(cb, res.cost);
    const next = { ...st, at: res.at };
    const unit = this.unit(doc);
    const name = doc.name ?? "";
    // A wall climbed over: across the top to the far side.
    if (st.kind === "wall" && st.over && !st.crossed && res.at >= st.height && st.to) {
      next.crossed = true;
      await doc.update({ x: st.to.x - size.w / 2, y: st.to.y - size.h / 2 }, this.opts());
    } else if (st.kind === "wall" && st.over && st.crossed && res.at < st.height && dir === "down") {
      // And back again, for someone who turns round on the far side.
      const back = across(Stairs.centre(doc), ...this.wallEnds(sc, st.id));
      next.crossed = false;
      await doc.update({ x: back.x - size.w / 2, y: back.y - size.h / 2 }, this.opts());
    }
    const atTop = dir !== "down" && res.done;
    const atFoot = dir === "down" && res.done;
    if (atTop || atFoot) {
      await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
      if (atFoot || st.over) await doc.update({ elevation: st.base }, this.opts());
      else if (st.kind === "tile") {
        const head = sc.tiles?.get(st.to);
        const foot = sc.tiles?.get(st.id);
        const elevation = elevationAfter({ base: st.base, height: st.height, floorFrom: foot ? this.floorAt(this.mid(foot), sc) : 0, floorTo: head ? this.floorAt(this.mid(head), sc) : 0 });
        await doc.update({ ...(head ? landing(head, size.w, size.h) : {}), elevation }, this.opts());
      } else {
        const here = Stairs.centre(doc);
        const there = st.to ?? across(here, ...this.wallEnds(sc, st.id));
        const elevation = elevationAfter({ base: st.base, height: st.height, floorFrom: this.floorAt(here, sc), floorTo: this.floorAt(there, sc) });
        await doc.update({ x: there.x - size.w / 2, y: there.y - size.h / 2, elevation }, this.opts());
      }
      return { at: res.at, total: st.total, done: true, cost: res.cost, note: L(`${LANG}.Climb.Note.${atTop ? "top" : "foot"}`, { name: esc(name), cost: res.cost, unit }) };
    }
    await doc.setFlag(MODULE_ID, CLIMB_FLAG, next);
    await doc.update({ elevation: Math.round((st.base + heightAt(next)) * 10) / 10 }, this.opts());
    const why = res.stopped === "climber" ? "climber" : res.stopped === "movement" ? "movement" : "part";
    return { at: res.at, total: st.total, done: false, stopped: res.stopped, cost: res.cost, note: L(`${LANG}.Climb.Note.${why}`, { name: esc(name), at: res.at, total: st.total, cost: res.cost, unit }) };
  },

  mid: (t) => ({ x: t.x + t.width / 2, y: t.y + t.height / 2 }),

  wallEnds(scene, id) {
    const c = scene?.walls?.get?.(id)?.c ?? [0, 0, 0, 0];
    return [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }];
  },

  /** A climber's token was moved by hand: they've let go. The fall is the GM's to rule on. */
  async onMove(doc, changed, options = {}) {
    if (!Compat.isActiveGM || !("x" in (changed ?? {}) || "y" in (changed ?? {}))) return;
    const st = this.state(doc);
    if (!st || options?.[MODULE_ID]?.climb || options?.[MODULE_ID]?.carried) return;
    const height = heightAt(st);
    await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
    await doc.update({ elevation: st.base }, this.opts());
    if (height > 0) ui.notifications?.warn(L(`${LANG}.Climb.Note.letGo`, { name: esc(doc.name ?? ""), at: height, unit: this.unit(doc) }));
  },

  /* ---------------------------------------- */
  /*  The GM's walls                          */
  /* ---------------------------------------- */

  /** GM: make walls climbable ({ height, over }), or (height 0) plain again. */
  async setWalls(walls, { height = 0, over = false } = {}) {
    if (!game.user?.isGM) return 0;
    let n = 0;
    for (const w of walls ?? []) {
      const doc = w?.document ?? w;
      if (!doc?.id) continue;
      if (Number(height) > 0) await doc.setFlag(MODULE_ID, WALL_FLAG, { height: Math.round(Number(height) * 10) / 10, over: !!over });
      else await doc.unsetFlag(MODULE_ID, WALL_FLAG);
      n += 1;
    }
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return n;
  },

  async markWalls() {
    if (!game.user?.isGM) return null;
    const picked = canvas?.walls?.controlled ?? [];
    if (!picked.length) {
      ui.notifications?.info(L(`${LANG}.Climb.PickWalls`));
      return null;
    }
    const now = (picked[0].document ?? picked[0]).flags?.[MODULE_ID]?.[WALL_FLAG] ?? {};
    const unit = esc(canvas.scene?.grid?.units || "m");
    const content = `<div class="ncm-levels"><p class="ncm-hint">${L(`${LANG}.Climb.WallHint`, { count: picked.length })}</p><div class="ncm-grid">`
      + `<label>${L(`${LANG}.Climb.Height`, { unit })}<input type="number" name="height" min="0" step="0.5" value="${Number(now.height) || ""}" placeholder="0"></label>`
      + `<label class="ncm-check"><input type="checkbox" name="over" ${now.over ? "checked" : ""}> ${L(`${LANG}.Climb.OverTick`)}</label></div></div>`;
    const got = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Climb.WallTool`) }, classes: ["neon-combat", "ncm-dialog"], content,
      ok: { label: L(`${LANG}.Levels.Save`), callback: (event, button) => ({ height: Number(button.form.elements.height.value) || 0, over: button.form.elements.over.checked }) },
      rejectClose: false
    }).catch(() => null);
    if (!got) return null;
    return this.setWalls(picked, got);
  },

  /* ---------------------------------------- */
  /*  What's drawn                            */
  /* ---------------------------------------- */

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

  /**
   * This client's drawing: for everyone, a gauge beside each ladder or wall with someone on it;
   * for the GM, a badge on every linked tile and climbable wall saying what it is.
   */
  draw() {
    this.clear();
    if (!canvas?.ready || typeof PIXI === "undefined" || !Stairs.on) return 0;
    const scene = canvas.scene;
    const layer = new PIXI.Container();
    layer.eventMode = "passive";
    let n = 0;
    const unit = scene?.grid?.units || "m";
    if (game.user?.isGM && Settings.get("stairsMarks") !== false) {
      const tiles = Stairs.tiles(scene);
      const seen = new Set();
      for (const t of tiles) {
        const far = tiles.find((x) => x.id === t.to);
        if (far && !seen.has(far.id)) {
          const line = new PIXI.Graphics();
          line.lineStyle(2, 0x05d9e8, 0.28).moveTo(...Object.values(this.mid(t))).lineTo(...Object.values(this.mid(far)));
          layer.addChild(line);
        }
        seen.add(t.id);
        const to = far ? Stairs.toward({ from: t, to: far }, scene) : "";
        const words = [L(`${LANG}.Stairs.Kind.${t.kind}`), t.rise > 0 ? `${t.rise} ${unit}${t.end === "head" ? " ▼" : " ▲"}` : "", to ? `→ ${to}` : ""].filter(Boolean).join(" · ");
        layer.addChild(this.badge(this.mid(t), t.kind, words));
        n += 1;
      }
      for (const w of this.walls(scene)) {
        layer.addChild(this.badge({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, "ladder", `${L(`${LANG}.Climb.${w.over ? "Fence" : "Wall"}`)} · ${w.height} ${unit}`, 0xf3e600));
        n += 1;
      }
    }
    if (this.on) {
      const groups = new Map();
      for (const t of canvas.tokens?.placeables ?? []) {
        const st = this.state(t);
        if (!st || t.document?.hidden) continue;
        const key = st.kind === "tile" ? st.id : `${st.id}:${t.id}`;
        if (!groups.has(key)) groups.set(key, { st, tokens: [] });
        groups.get(key).tokens.push(t);
      }
      for (const g of groups.values()) {
        layer.addChild(this.gauge(g, unit));
        n += 1;
      }
    }
    if (!n) {
      layer.destroy();
      return 0;
    }
    (canvas.interface ?? canvas.stage).addChild(layer);
    this.layer = layer;
    return n;
  },

  /** A round badge with a drawn sign (stairs, a ladder, a door) and a line of words under it. */
  badge(at, kind, words, color = 0x05d9e8) {
    const box = new PIXI.Container();
    box.position.set(at.x, at.y);
    box.eventMode = "none";
    const g = new PIXI.Graphics();
    g.beginFill(0x07070b, 0.85).lineStyle(2, color, 0.95).drawCircle(0, 0, 18).endFill();
    g.lineStyle(2.5, color, 1);
    if (kind === "stairs") g.moveTo(-10, 8).lineTo(-4, 8).lineTo(-4, 2).lineTo(2, 2).lineTo(2, -4).lineTo(8, -4).lineTo(8, -10);
    else if (kind === "door") {
      g.drawRect(-6, -10, 12, 20);
      g.beginFill(color, 1).lineStyle(0).drawCircle(3, 1, 1.6).endFill();
    } else {
      g.moveTo(-5, -11).lineTo(-5, 11).moveTo(5, -11).lineTo(5, 11);
      for (const y of [-7, -1, 5]) g.moveTo(-5, y).lineTo(5, y);
    }
    box.addChild(g);
    if (words) {
      const text = new PIXI.Text(words, { fontFamily: globalThis.CONFIG?.canvasTextStyle?.fontFamily ?? "Signika", fontSize: 13, fontWeight: "bold", fill: color, stroke: 0x000000, strokeThickness: 4, align: "center" });
      text.anchor.set(0.5, 0);
      text.position.set(0, 22);
      box.addChild(text);
    }
    return box;
  },

  /** A ladder drawn beside the climb, as long as the climb is high, with everyone on it where they are. */
  gauge({ st, tokens }, unit) {
    const first = tokens[0];
    const size = canvas.dimensions?.size ?? 100;
    const perMetre = size / (canvas.dimensions?.distance || 2);
    const len = Math.max(size * 1.5, Math.min(size * 5, st.total * perMetre));
    const box = new PIXI.Container();
    box.eventMode = "passive";
    box.position.set(first.x + (first.w ?? size) + 14, first.y + (first.h ?? size));
    const g = new PIXI.Graphics();
    g.beginFill(0x07070b, 0.7).lineStyle(1, 0x36364f, 1).drawRect(-6, -len - 10, 44, len + 20).endFill();
    g.lineStyle(2, 0x05d9e8, 0.9).moveTo(4, 0).lineTo(4, -len).moveTo(28, 0).lineTo(28, -len);
    const rungs = Math.max(2, Math.min(24, Math.round(st.total)));
    for (let i = 0; i <= rungs; i += 1) g.lineStyle(1.5, 0x05d9e8, 0.55).moveTo(4, -(len * i) / rungs).lineTo(28, -(len * i) / rungs);
    box.addChild(g);
    const style = { fontFamily: globalThis.CONFIG?.canvasTextStyle?.fontFamily ?? "Signika", fontSize: 12, fontWeight: "bold", fill: 0xd8dbec, stroke: 0x000000, strokeThickness: 3 };
    const top = new PIXI.Text(`${st.total} ${unit}`, style);
    top.anchor.set(0.5, 1);
    top.position.set(16, -len - 12);
    box.addChild(top);
    for (const t of [...tokens].sort((a, b) => this.state(a).at - this.state(b).at)) {
      const s = this.state(t);
      const y = -(len * s.at) / (s.total || 1);
      const pip = new PIXI.Container();
      pip.position.set(16, y);
      const ring = new PIXI.Graphics();
      ring.beginFill(0x07070b, 1).lineStyle(2, t.controlled ? 0xf3e600 : 0xff2a6d, 1).drawCircle(0, 0, 13).endFill();
      pip.addChild(ring);
      const texture = t.mesh?.texture ?? t.texture ?? null;
      if (texture) {
        const pic = new PIXI.Sprite(texture);
        pic.anchor.set(0.5);
        pic.width = 22;
        pic.height = 22;
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff).drawCircle(0, 0, 11).endFill();
        pip.addChild(mask);
        pic.mask = mask;
        pip.addChild(pic);
      }
      const label = new PIXI.Text(`${t.name ?? ""} · ${s.at} ${unit}`, style);
      label.anchor.set(0, 0.5);
      label.position.set(18, 0);
      pip.addChild(label);
      // Climbers share a square: click one here to pick it out.
      pip.eventMode = "static";
      pip.cursor = "pointer";
      pip.hitArea = new PIXI.Circle(0, 0, 14);
      pip.on("pointerdown", (ev) => {
        ev.stopPropagation?.();
        if (t.isOwner || game.user?.isGM) t.control?.({ releaseOthers: !ev.shiftKey });
      });
      box.addChild(pip);
    }
    return box;
  }
};
