/** The movement ruler: Move and Run bands, the path walked this Turn, Drag Ruler, Foundry v13's ruler, waypoints. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { makeActor, makeCombat, registerSettings, settle, asGM, missingKeys, notes } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const { reach, bandOf, legs, squaresAlong, label, COLORS } = await import("../scripts/ruler/ruler-core.js");
const { NeonRuler } = await import("../scripts/ruler/ruler.js");
const { Turns } = await import("../scripts/combat/turns.js");
const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
Registry.refresh();

// Two metres a square, 100 pixels a square, as Cyberpunk RED's scenes are.
const metres = (a, b) => (Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 100) * 2;

beforeEach(() => {
  asGM(true);
  game.combats.clear();
  globalThis.canvas = null;
});

test("a Move Action is MOVE × 2 m/yds and a Run as much again; Prone and Grappled don't move", () => {
  assert.deepEqual(reach(5), { move: 10, run: 20, why: null });
  assert.deepEqual(reach(5, { prone: true }), { move: 0, run: 0, why: "prone" });
  assert.deepEqual(reach(5, { grappled: true }), { move: 0, run: 0, why: "grappled" });
  assert.deepEqual(reach(4, { noMove: true }), { move: 0, run: 8, why: "noMove" }, "a lost Move Action leaves the Run");
  assert.equal(bandOf(10, reach(5)), "move");
  assert.equal(bandOf(10.5, reach(5)), "run");
  assert.equal(bandOf(21, reach(5)), "over");
});

test("legs and squares count what was already walked", () => {
  const r = reach(3); // 6 m Move, 12 m Run
  const path = [{ x: 50, y: 50 }, { x: 250, y: 50 }, { x: 250, y: 450 }];
  const l = legs(path, metres, r, 2);
  assert.deepEqual(l.map((x) => [x.distance, x.end, x.band]), [[4, 6, "move"], [8, 14, "over"]]);
  const sq = squaresAlong(path, metres, r, { size: 100 }, 2);
  assert.deepEqual(sq.map((s) => `${s.x},${s.y}:${s.distance}:${s.band}`), [
    "150,50:4:move", "250,50:6:move", "250,150:8:run", "250,250:10:run", "250,350:12:run", "250,450:14:over"
  ]);
  // A diagonal lights the squares it crosses, one per step.
  assert.equal(squaresAlong([{ x: 50, y: 50 }, { x: 350, y: 350 }], metres, r, { size: 100 }).length, 3);
  assert.equal(label(6, r), "6 m · Move");
  assert.equal(label(14, r), "14 m · out of reach (12 m)");
});

test("a character's reach follows MOVE now and their conditions", async () => {
  const actor = makeActor({ name: "Stop Sign", system: { stats: { move: { value: 6 } } } });
  const token = { id: "t1", actor, document: { id: "t1", parent: null, actor } };
  assert.deepEqual(NeonRuler.reachFor(token), { move: 12, run: 24, why: null });
  await Conditions.add("prone", actor);
  assert.equal(NeonRuler.reachFor(token).why, "prone");
  await Conditions.remove("prone", actor);
  assert.equal(NeonRuler.reachFor(token).move, 12);
});

test("the path walked this Turn is recorded on the combatant, for every client's ruler", async () => {
  const actor = makeActor({ name: "Fury" });
  const combat = makeCombat([actor]);
  const cb = combat.combatant;
  cb.tokenId = "tok1";
  cb.token = { id: "tok1", x: 0, y: 0, width: 1, height: 1, parent: { grid: { size: 100 } } };
  cb.parent = combat;
  game.combats.set(combat.id, combat);
  Turns.resetMove(cb);
  await settle();
  assert.deepEqual(cb.flags[M].path, { points: [{ x: 50, y: 50 }], metres: 0, noMove: false });
  globalThis.canvas = { dimensions: { size: 100, distance: 2 }, grid: { size: 100 } };
  const token = { id: "tok1", x: 200, y: 0, width: 1, height: 1, parent: { id: null, grid: { size: 100 } } };
  Turns.onMove(token, { x: 200 });
  await settle();
  assert.deepEqual(cb.flags[M].path.points, [{ x: 50, y: 50 }, { x: 250, y: 50 }]);
  assert.equal(cb.flags[M].path.metres, 4);
  const h = NeonRuler.historyFor({ id: "tok1", document: { id: "tok1", parent: { id: null } } });
  assert.equal(h.metres, 4);
  assert.equal(h.points.length, 2);
  // Not their Turn: nothing counts.
  combat.turn = 5;
  assert.deepEqual(NeonRuler.historyFor({ id: "tok1", document: { id: "tok1", parent: { id: null } } }), { points: [], metres: 0 });
  // A lost Move Action shows in the reach.
  combat.turn = 0;
  cb.flags[M].path.noMove = true;
  assert.equal(NeonRuler.reachFor({ id: "tok1", actor, document: { id: "tok1", parent: { id: null }, actor } }).why, "noMove");
});

test("with Drag Ruler running, Drag Ruler gets the Move and Run bands", () => {
  let registered = null;
  globalThis.dragRuler = { registerModule: (id, cls) => (registered = { id, cls }) };
  class SpeedProvider {}
  NeonRuler.registerSpeedProvider(SpeedProvider);
  assert.equal(registered.id, M);
  const sp = new registered.cls();
  assert.deepEqual(sp.colors.map((c) => c.id), ["move", "run"]);
  const actor = makeActor({ system: { stats: { move: { value: 4 } } } });
  assert.deepEqual(sp.getRanges({ actor, document: { id: "x", parent: null } }), [{ range: 8, color: "move" }, { range: 16, color: "run" }]);
  delete globalThis.dragRuler;
});

test("on Foundry v13, its own token ruler is coloured by the bands", () => {
  class TokenRuler {
    _getGridHighlightStyle() {
      return { color: 0x123456, alpha: 0.5 };
    }
    _getSegmentStyle() {
      return { width: 4, color: 0x123456 };
    }
  }
  globalThis.CONFIG.Token = { rulerClass: TokenRuler };
  assert.ok(NeonRuler.installV13());
  assert.ok(!NeonRuler.installV13(), "once");
  const ruler = new CONFIG.Token.rulerClass();
  ruler.token = { actor: makeActor({ system: { stats: { move: { value: 5 } } } }), document: { id: "x", parent: null } };
  assert.deepEqual(ruler._getGridHighlightStyle({ measurement: { distance: 8 } }), { color: COLORS.move, alpha: 0.5 });
  assert.equal(ruler._getGridHighlightStyle({ measurement: { distance: 16 } }).color, COLORS.run);
  assert.equal(ruler._getSegmentStyle({ measurement: { distance: 30 } }).color, COLORS.over);
  assert.equal(ruler._getGridHighlightStyle({ stage: "passed", measurement: { distance: 2 } }).color, 0x123456, "the walked part keeps Foundry's look");
  delete globalThis.CONFIG.Token;
});

test("waypoints: Space or right-click drops one, Backspace takes it back", () => {
  NeonRuler.state = { token: {}, origin: { x: 50, y: 50 }, waypoints: [], end: { x: 250, y: 50 }, history: { points: [], metres: 0 }, reach: reach(5) };
  const ev = (code) => ({ code, preventDefault() {}, stopPropagation() {} });
  NeonRuler.key(ev("Space"));
  NeonRuler.key(ev("Space"));
  assert.deepEqual(NeonRuler.state.waypoints, [{ x: 250, y: 50 }], "not twice on the same square");
  NeonRuler.state.end = { x: 250, y: 250 };
  NeonRuler.addWaypoint();
  NeonRuler.key(ev("Backspace"));
  assert.equal(NeonRuler.state.waypoints.length, 1);
  NeonRuler.state = null;
});

test("on release the token walks its waypoints, and a wall stops a player's", async () => {
  const moves = [];
  const doc = { x: 0, y: 0, width: 1, height: 1, parent: { grid: { size: 100 } }, object: null, async update(u) {
    moves.push([u.x, u.y]);
    Object.assign(this, u);
  } };
  assert.ok(await NeonRuler.walk(doc, [{ x: 250, y: 50 }, { x: 250, y: 250 }]));
  assert.deepEqual(moves, [[200, 0], [200, 200]]);
  asGM(false);
  moves.length = 0;
  doc.object = { checkCollision: (dest) => dest.y > 100 };
  assert.equal(await NeonRuler.walk(doc, [{ x: 450, y: 250 }, { x: 450, y: 50 }]), false);
  assert.deepEqual(moves, []);
  assert.ok(notes.some(([kind]) => kind === "warn"));
});

test("the ruler's text is all in the language file", () => {
  assert.deepEqual([...missingKeys].filter((k) => k.includes("Ruler")), []);
});
