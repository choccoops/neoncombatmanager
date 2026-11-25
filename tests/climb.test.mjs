/** Climbing: what a stretch costs and where it stops, single file on a ladder, walls, and a ladder at the table. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, asGM } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const D = await import("../scripts/senses/climb-data.js");
const { Stairs } = await import("../scripts/senses/stairs.js");
const { Climb } = await import("../scripts/senses/climb.js");
const { Turns } = await import("../scripts/combat/turns.js");
const { Socket } = await import("../scripts/socket.js");
Socket.on("climbGo", (data, userId) => Climb._go(data, userId));
Socket.on("wayTake", (data, userId) => Stairs._take(data, userId));

test("a stretch of climbing (pure): 2 for 1, what takes the penalty off, where it stops", () => {
  assert.equal(D.factorOf(), 2);
  assert.equal(D.factorOf({ sure: true }), 1, "Grip Feet");
  assert.equal(D.factorOf({ line: true }), 1, "a grapple line");
  assert.equal(D.reachOf(7, 2), 3, "whole metres");
  assert.equal(D.reachOf(Infinity, 2), Infinity);
  // 8 m of ladder, 6 m of movement left: 3 m up, stopped for want of movement.
  assert.deepEqual(D.stretch({ at: 0, total: 8, left: 6 }), { at: 3, climbed: 3, cost: 6, done: false, stopped: "movement" });
  // The next Turn, 8 m of movement: another 4. Then a Run's worth finishes it.
  assert.deepEqual(D.stretch({ at: 3, total: 8, left: 8 }), { at: 7, climbed: 4, cost: 8, done: false, stopped: "movement" });
  assert.deepEqual(D.stretch({ at: 7, total: 8, left: 8 }), { at: 8, climbed: 1, cost: 2, done: true, stopped: null });
  // Grip Feet: the same 6 m of movement is 6 m of ladder.
  assert.deepEqual(D.stretch({ at: 0, total: 8, left: 6, factor: 1 }), { at: 6, climbed: 6, cost: 6, done: false, stopped: "movement" });
  // Nothing counted (out of combat): the whole way.
  assert.deepEqual(D.stretch({ at: 0, total: 8 }), { at: 8, climbed: 8, cost: 16, done: true, stopped: null });
  // Down.
  assert.deepEqual(D.stretch({ at: 8, total: 8, dir: "down", left: 6 }), { at: 5, climbed: 3, cost: 6, done: false, stopped: "movement" });
  assert.deepEqual(D.stretch({ at: 2, total: 8, dir: "down", left: 20 }), { at: 0, climbed: 2, cost: 4, done: true, stopped: null });
  // No movement at all: nowhere.
  assert.deepEqual(D.stretch({ at: 3, total: 8, left: 1 }), { at: 3, climbed: 0, cost: 0, done: false, stopped: "movement" });
});

test("single file (pure): the one in front sets the pace, a body's length apart", () => {
  assert.equal(D.GAP, 2);
  assert.equal(D.aheadOf(1, [5, 7, 0], "up"), 5);
  assert.equal(D.aheadOf(6, [5, 7, 0], "down"), 5);
  assert.equal(D.aheadOf(7, [5, 3], "up"), null);
  // Plenty of movement, but someone's 5 m up: to 3 m and no further.
  assert.deepEqual(D.stretch({ at: 0, total: 8, left: 20, ahead: 5 }), { at: 3, climbed: 3, cost: 6, done: false, stopped: "climber" });
  // Right behind them already: nowhere to go.
  assert.deepEqual(D.stretch({ at: 3, total: 8, left: 20, ahead: 5 }), { at: 3, climbed: 0, cost: 0, done: false, stopped: "climber" });
  // Movement runs out before the gap does: that's what's said.
  assert.equal(D.stretch({ at: 0, total: 8, left: 2, ahead: 5 }).stopped, "movement");
  // Coming down onto someone below.
  assert.deepEqual(D.stretch({ at: 8, total: 8, dir: "down", left: 20, ahead: 3 }), { at: 5, climbed: 3, cost: 6, done: false, stopped: "climber" });
});

test("walls and heights (pure)", () => {
  // A vertical wall at x = 500: its far side is the mirror image.
  assert.deepEqual(D.across({ x: 450, y: 250 }, { x: 500, y: 0 }, { x: 500, y: 1000 }), { x: 550, y: 250 });
  assert.equal(D.toSegment({ x: 450, y: 250 }, { x: 500, y: 0 }, { x: 500, y: 1000 }), 50);
  assert.equal(D.toSegment({ x: 500, y: 1100 }, { x: 500, y: 0 }, { x: 500, y: 1000 }), 100, "past its end");
  // Over a 3 m fence: up 3, down 3, back on the ground.
  assert.equal(D.heightAt({ over: true, at: 2, total: 6 }), 2);
  assert.equal(D.heightAt({ over: true, at: 5, total: 6 }), 1);
  assert.equal(D.heightAt({ at: 5, total: 8 }), 5);
  // Onto a roof 8 m up: with no floors set up the token keeps the 8 m as elevation; onto a floor that's 8 m up, none.
  assert.equal(D.elevationAfter({ base: 0, height: 8 }), 8);
  assert.equal(D.elevationAfter({ base: 0, height: 8, floorFrom: 0, floorTo: 8 }), 0);
  assert.equal(D.elevationAfter({ base: 0, height: 8, floorFrom: 0, floorTo: 4 }), 4);
});

test("a ladder at the table: climbed a stretch at a time on your Turn, two climbers in single file", async () => {
  asGM(true);
  await Settings.set("stairs", true);
  await Settings.set("climbing", true);
  await Settings.set("levels", false);
  class Docs extends Map {
    [Symbol.iterator]() {
      return this.values();
    }
  }
  const scene = { id: "sc", grid: { size: 100, units: "m" }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), regions: [], flags: {} };
  const flagged = {
    flags: {},
    async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; },
    async unsetFlag(m, k) { delete this.flags[m]?.[k]; }
  };
  const tile = (id, x, y) => {
    const d = { ...flagged, flags: {}, id, x, y, width: 100, height: 100, parent: scene };
    scene.tiles.set(id, d);
    return d;
  };
  const tok = (id, x, y, items = []) => {
    const d = {
      ...flagged, flags: {}, id, name: id, x, y, width: 1, height: 1, elevation: 0, parent: scene, isOwner: true, actor: makeActor({ name: id }, items),
      async update(data) { Object.assign(this, data); }
    };
    scene.tokens.set(id, d);
    return d;
  };
  const foot = tile("foot", 0, 0);
  const head = tile("head", 2000, 0);
  const prevScenes = game.scenes;
  const prevCombats = game.combats;
  game.scenes = { get: () => scene };
  // Whose Turn it is and what they have left is the test's to say.
  let left = Infinity;
  const spent = [];
  const prevBudget = Climb.budget;
  Climb.budget = () => ({ left, cb: Number.isFinite(left) ? { id: "cb" } : null });
  const prevSpend = Turns.spend;
  Turns.spend = async (cb, m) => { spent.push(m); };
  try {
    assert.equal(await Stairs.link(foot, head, "ladder", { height: 8 }), true);
    assert.deepEqual(Stairs.tiles(scene).map((t) => [t.id, t.rise, t.end, t.height]), [["foot", 8, "foot", 100], ["head", 8, "head", 100]]);
    const a = tok("Ana", 0, 0);
    // A ladder with a height isn't simply taken.
    assert.equal(await Stairs.take(a), false);
    assert.deepEqual(Climb.choices(a).options.map((o) => o.dir), ["up"]);
    // Her Turn, 6 m of movement: 3 m up, and she stays on the ladder with her height as elevation.
    left = 6;
    let r = await Climb.go(a, { dir: "up" });
    assert.deepEqual([r.at, r.done, r.stopped, r.cost], [3, false, "movement", 6]);
    assert.deepEqual([a.x, a.y, a.elevation], [0, 0, 3]);
    assert.equal(Climb.state(a).at, 3);
    assert.deepEqual(spent, [6]);
    assert.deepEqual(Climb.choices(a).options.map((o) => o.dir), ["up", "down"]);
    // Ben follows with all the movement in the world: stopped a body's length below her.
    const b = tok("Ben", 0, 0);
    left = 40;
    r = await Climb.go(b, { dir: "up" });
    assert.deepEqual([r.at, r.stopped], [1, "climber"]);
    assert.equal(b.elevation, 1);
    // Ana tops out: onto the head tile; no floors here, so she keeps the 8 m.
    left = 10;
    r = await Climb.go(a, { dir: "up" });
    assert.deepEqual([r.done, r.cost], [true, 10]);
    assert.deepEqual([a.x, a.y, a.elevation], [2000, 0, 8]);
    assert.equal(Climb.state(a), null);
    // The way's clear: Ben, with Grip Feet now, climbs 1 for 1.
    b.actor = makeActor({ name: "Ben" }, [{ name: "Grip Foot", type: "cyberware", system: { isInstalled: true } }]);
    const grip = Climb.sure(b.actor);
    left = 4;
    r = await Climb.go(b, { dir: "up" });
    assert.deepEqual([r.at, r.cost], grip ? [5, 4] : [3, 4]);
    // From the head, Ana is offered the way down, and takes it out of combat: all the way to the foot.
    assert.deepEqual(Climb.choices(a).options.map((o) => o.dir), ["down"]);
    left = Infinity;
    await Climb.onMove(b, { x: 300 }, {});
    assert.equal(Climb.state(b), null, "Ben was dragged off: he's let go");
    assert.equal(b.elevation, 0);
    r = await Climb.go(a, { dir: "down" });
    assert.equal(r.done, true);
    assert.deepEqual([a.x, a.y, a.elevation], [0, 0, 0]);
    // Climbing switched off: the ladder is taken in one go again.
    await Settings.set("climbing", false);
    assert.equal(Climb.choices(a), null);
    assert.equal(await Stairs.take(a), true);
    assert.deepEqual([a.x, a.y], [2000, 0]);
  } finally {
    game.scenes = prevScenes;
    game.combats = prevCombats;
    Climb.budget = prevBudget;
    Turns.spend = prevSpend;
    await Settings.set("climbing", true);
    await Settings.set("levels", true);
  }
});

test("a wall at the table: onto a roof, and over a fence", async () => {
  asGM(true);
  await Settings.set("stairs", true);
  await Settings.set("climbing", true);
  await Settings.set("levels", false);
  class Docs extends Map {
    [Symbol.iterator]() {
      return this.values();
    }
  }
  const scene = { id: "sc", grid: { size: 100, units: "m" }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), regions: [], flags: {} };
  const wall = (id, c, climb) => scene.walls.set(id, { id, c, parent: scene, flags: { [M]: { climb } } });
  wall("roof", [500, 0, 500, 1000], { height: 6, over: false });
  wall("fence", [0, 2000, 1000, 2000], { height: 3, over: true });
  wall("plain", [900, 0, 900, 1000], undefined);
  const tok = (id, x, y) => {
    const d = {
      id, name: id, x, y, width: 1, height: 1, elevation: 0, parent: scene, isOwner: true, actor: makeActor({ name: id }), flags: {},
      async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; },
      async unsetFlag(m, k) { delete this.flags[m]?.[k]; },
      async update(data) { Object.assign(this, data); }
    };
    scene.tokens.set(id, d);
    return d;
  };
  const prevScenes = game.scenes;
  game.scenes = { get: () => scene };
  let left = Infinity;
  const prevBudget = Climb.budget;
  Climb.budget = () => ({ left, cb: null });
  try {
    assert.deepEqual(Climb.walls(scene).map((w) => w.id), ["roof", "fence"]);
    const a = tok("Ana", 400, 200); // against the roof wall, on its left
    assert.equal(Climb.wallFor(a).id, "roof");
    assert.equal(Climb.wallFor(tok("Far", 100, 200)), null, "not next to it");
    left = 4;
    let r = await Climb.go(a, { dir: "up" });
    assert.deepEqual([r.at, r.done], [2, false]);
    assert.deepEqual([a.x, a.elevation], [400, 2], "still on her side, 2 m up");
    left = 20;
    r = await Climb.go(a, { dir: "up" });
    assert.equal(r.done, true);
    assert.deepEqual([a.x, a.y, a.elevation], [500, 200, 6], "over the edge, on the roof");
    // From up there the climb on offer is down.
    assert.deepEqual(Climb.choices(a).options.map((o) => o.dir), ["down"]);
    left = Infinity;
    r = await Climb.go(a, { dir: "down" });
    assert.deepEqual([a.x, a.elevation], [400, 0]);
    // Over a 3 m fence: 6 m of climbing, crossing at the top.
    const b = tok("Ben", 200, 1900);
    assert.equal(Climb.wallFor(b).id, "fence");
    left = 8; // 4 m of climbing: up 3, 1 down the far side
    r = await Climb.go(b, { dir: "up" });
    assert.deepEqual([r.at, r.done], [4, false]);
    assert.deepEqual([b.x, b.y, b.elevation], [200, 2000, 2], "on the far side, 2 m off the ground");
    left = 20;
    r = await Climb.go(b, { dir: "up" });
    assert.equal(r.done, true);
    assert.deepEqual([b.y, b.elevation], [2000, 0]);
  } finally {
    game.scenes = prevScenes;
    Climb.budget = prevBudget;
    await Settings.set("levels", true);
  }
});
