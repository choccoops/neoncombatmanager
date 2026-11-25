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
Socket.on("climbContest", (data, userId) => Climb._contest(data, userId));

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

test("chases (pure): reach, the leap's landing, opposed checks, the d10, falls, and tokens fanned out", () => {
  assert.equal(D.d10Total(7), 7);
  assert.equal(D.d10Total(10, 4), 14, "a 10 rolls on");
  assert.equal(D.d10Total(1, 6), -5, "a 1 rolls back");
  assert.equal(D.beats(15, 14), true);
  assert.equal(D.beats(14, 14), false, "a tie holds on");
  const rivals = [{ id: "a", at: 5 }, { id: "b", at: 8 }, { id: "c", at: 1 }];
  assert.deepEqual(D.within(3, rivals).map((r) => r.id), ["a", "c"], "2 m either way");
  assert.equal(D.inFront(3, rivals).id, "a");
  assert.equal(D.inFront(6, rivals).id, "b");
  assert.equal(D.inFront(1, rivals), null, "nobody within reach above");
  // Past the one at 5 m: to 7 m. With someone at 8 m there's no room there.
  assert.deepEqual(D.leapTo({ front: 5, total: 12, others: [5] }), { at: 7, done: false });
  assert.equal(D.leapTo({ front: 5, total: 12, others: [5, 8] }), null);
  assert.deepEqual(D.leapTo({ front: 7, total: 8, others: [7] }), { at: 8, done: true }, "past them and off the top");
  // Falling.
  assert.equal(D.fallDice(9), "");
  assert.equal(D.fallDice(10), "2d6");
  assert.equal(D.fallDice(25), "4d6");
  // Drawn apart.
  assert.deepEqual(D.fanLayout(0, 1, 100, 100), { scale: 1, dx: 0, dy: 0 });
  assert.deepEqual(D.fanLayout(1, 2, 100, 100), { scale: 1, dx: 30, dy: -55 });
  // Three or four: three quarters the size, the lowest in the middle of the square's bottom edge.
  assert.equal(D.fanScale(2), 1);
  assert.equal(D.fanScale(3), 0.75);
  assert.equal(D.fanScale(4), 0.75);
  assert.equal(D.fanScale(5), 0.6);
  assert.equal(D.fanScale(9), 0.6);
  assert.deepEqual(D.fanLayout(0, 3, 100, 100), { scale: 0.75, dx: 13, dy: 25 });
  assert.deepEqual(D.fanLayout(2, 3, 100, 100), { scale: 0.75, dx: -10, dy: -57 });
  // Six on one ladder: the top one starts 1.4 squares above the square, not 2.75.
  assert.deepEqual(D.fanLayout(5, 6, 100, 100), { scale: 0.6, dx: 38, dy: -125 });
});

test("climbers drawn smaller as more join, and back to size when they leave", async () => {
  await Settings.set("stairs", true);
  await Settings.set("climbing", true);
  const pt = (x = 0, y = 0) => ({ x, y, set(nx, ny = nx) { this.x = nx; this.y = ny; } });
  const scene = { tokens: null };
  const docs = [];
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  scene.tokens = new Docs();
  const mk = (id, at) => {
    const document = { id, name: id, x: 400, y: 400, parent: scene, flags: { [M]: { [D.CLIMB_FLAG]: { kind: "tile", id: "L", at, height: 12, total: 12 } } } };
    scene.tokens.set(id, document);
    docs.push(document);
    // A picture Foundry drew at 0.5: a 200 px image on a 100 px square.
    return { document, w: 100, h: 100, position: pt(400, 400), scale: pt(1, 1), mesh: { position: pt(450, 450), scale: pt(0.5, 0.5) } };
  };
  const a = mk("a", 0);
  const b = mk("b", 3);
  Climb.fan(a);
  Climb.fan(b);
  assert.equal(a.scale.x, 1, "two: full size");
  assert.deepEqual([b.position.x, b.position.y], [430, 345]);
  assert.equal(b.mesh.scale.x, 0.5);
  const c = mk("c", 6);
  for (const t of [a, b, c]) Climb.fan(t);
  assert.equal(a.scale.x, 0.75);
  assert.deepEqual([a.position.x, a.position.y], [413, 425], "the lowest: smaller, on the bottom of its square");
  assert.equal(c.mesh.scale.x, 0.375);
  assert.deepEqual([c.mesh.position.x, c.mesh.position.y], [400 - 10 + 37.5, 400 - 57 + 37.5]);
  // Drawn again without Foundry resizing the picture: not shrunk twice.
  Climb.fan(c);
  assert.equal(c.mesh.scale.x, 0.375);
  // Foundry resizes the picture (a new image, twice the size): shrunk from that.
  c.mesh.scale.set(0.25, 0.25);
  Climb.fan(c);
  assert.equal(c.mesh.scale.x, 0.1875);
  c.mesh.scale.set(0.5, 0.5);
  Climb.fan(c);
  // Two more: smaller still.
  const d = mk("d", 8);
  const e = mk("e", 10);
  for (const t of [a, b, c, d, e]) Climb.fan(t);
  assert.equal(e.scale.x, 0.6);
  assert.equal(c.mesh.scale.x, 0.3);
  // c is thrown off: back to its own place and size, and the rest grow again.
  delete c.document.flags[M][D.CLIMB_FLAG];
  for (const t of [a, b, c, d, e]) Climb.fan(t);
  assert.equal(c.scale.x, 1);
  assert.equal(c.mesh.scale.x, 0.5);
  assert.deepEqual([c.position.x, c.position.y, c.mesh.position.x, c.mesh.position.y], [400, 400, 450, 450]);
  assert.equal(c._ncmFan, undefined);
  assert.equal(a.scale.x, 0.75);
  assert.equal(a.mesh.scale.x, 0.375);
});

test("a chase up a ladder at the table: thrown off, caught, leapt past, and a leap that misses", async () => {
  asGM(true);
  await Settings.set("stairs", true);
  await Settings.set("climbing", true);
  await Settings.set("climbContests", true);
  await Settings.set("levels", false);
  class Docs extends Map {
    [Symbol.iterator]() {
      return this.values();
    }
  }
  const scene = { id: "sc", grid: { size: 100, units: "m" }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), regions: [], flags: {} };
  const tile = (id, x, y, flag) => scene.tiles.set(id, { id, x, y, width: 100, height: 100, parent: scene, flags: { [M]: { stairs: flag } } });
  tile("foot", 0, 0, { to: "head", kind: "ladder", height: 30, end: "foot" });
  tile("head", 2000, 0, { to: "foot", kind: "ladder", height: 30, end: "head" });
  const climber = (id, at) => {
    const d = {
      id, name: id, x: 0, y: 0, width: 1, height: 1, elevation: at, parent: scene, isOwner: true, actor: makeActor({ name: id }),
      flags: { [M]: { climb: { kind: "tile", id: "foot", at, height: 30, total: 30, base: 0, to: "head" } } },
      async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; },
      async unsetFlag(m, k) { delete this.flags[m]?.[k]; },
      async update(data) { Object.assign(this, data); }
    };
    scene.tokens.set(id, d);
    return d;
  };
  const prevScenes = game.scenes;
  game.scenes = { get: () => scene };
  const { Cards } = await import("../scripts/combat/cards.js");
  const cards = [];
  const hurt = [];
  const prev = { check: Climb.check, post: Cards.post, damage: Cards.damage };
  Cards.post = async (c) => { cards.push(c.kicker); };
  Cards.damage = async (actor, d) => { hurt.push([actor.name, d.armor, d.amount > 0]); };
  // The dice are the test's to call: each check takes the next total.
  let totals = [];
  Climb.check = async () => {
    const total = totals.shift();
    return { total, base: 0, die: total, text: String(total) };
  };
  try {
    const ana = climber("Ana", 14);
    const ben = climber("Ben", 12);
    const cy = climber("Cy", 3);
    // Who can try what: Ben is within reach of Ana (throw, and a leap past her); Cy isn't near anyone.
    assert.deepEqual(Climb.moves(ben).map((m) => [m.kind, m.target]), [["throw", "Ana"], ["leap", "Ana"]]);
    assert.deepEqual(Climb.moves(ana).map((m) => [m.kind, m.target]), [["throw", "Ben"]]);
    assert.deepEqual(Climb.moves(cy), []);
    assert.deepEqual([Climb.rankOf(cy), Climb.rankOf(ben), Climb.rankOf(ana)], [0, 1, 2]);
    // Ben tries to throw Ana off and doesn't beat her.
    totals = [12, 12];
    let r = await Climb.contest(ben, "throw", "Ana");
    assert.deepEqual([r.won, cards.at(-1)], [false, "Holds on"]);
    assert.equal(Climb.state(ana).at, 14);
    // He wins the next one, but she catches the ladder (beats DV15).
    totals = [15, 9, 16];
    r = await Climb.contest(ben, "throw", "Ana");
    assert.deepEqual([r.won, r.fell, cards.at(-1)], [true, false, "Caught it"]);
    assert.equal(Climb.state(ana).at, 14);
    // And the one after that she doesn't: 14 m down, so 2d6, soaked by armor.
    totals = [15, 9, 15];
    r = await Climb.contest(ben, "throw", "Ana");
    assert.deepEqual([r.won, r.fell], [true, true]);
    assert.equal(Climb.state(ana), null);
    assert.equal(ana.elevation, 0);
    assert.deepEqual(hurt, [["Ana", true, true]]);
    // Cy climbs to just under Ben and leaps past him: lands a body's length above.
    cy.flags[M].climb.at = 10;
    assert.deepEqual(Climb.moves(cy).map((m) => m.kind), ["throw", "leap"]);
    totals = [16];
    r = await Climb.contest(cy, "leap", "Ben");
    assert.deepEqual([r.won, r.at, cards.at(-1)], [true, 14, "Past them"]);
    assert.deepEqual([Climb.state(cy).at, cy.elevation], [14, 14]);
    // Ben tries the same back and misses: off the ladder from 12 m.
    totals = [15];
    r = await Climb.contest(ben, "leap", "Cy");
    assert.deepEqual([r.won, r.fell], [false, true]);
    assert.equal(Climb.state(ben), null);
    assert.equal(hurt.length, 2);
    // Nobody near: nothing to try, and asking anyway does nothing.
    assert.equal(await Climb.contest(cy, "throw", "Ben"), null);
    // Switched off: climbers just climb.
    await Settings.set("climbContests", false);
    ben.flags[M].climb = { kind: "tile", id: "foot", at: 12, height: 30, total: 30, base: 0, to: "head" };
    assert.deepEqual(Climb.moves(cy), []);
  } finally {
    game.scenes = prevScenes;
    Climb.check = prev.check;
    Cards.post = prev.post;
    Cards.damage = prev.damage;
    await Settings.set("climbContests", true);
    await Settings.set("levels", true);
  }
});

test("climbers drawn apart are clicked where they're drawn: select, target, sheet, HUD", async () => {
  await Settings.set("stairs", true);
  await Settings.set("climbing", true);
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  const scene = { tokens: new Docs() };
  const log = [];
  const mk = (id, at, extra = {}) => {
    const document = { id, name: id, x: 400, y: 400, parent: scene, flags: { [M]: { [D.CLIMB_FLAG]: { kind: "tile", id: "L", at, height: 12, total: 12 } } } };
    scene.tokens.set(id, document);
    return { document, w: 100, h: 100, isOwner: false, controlled: false, control: (o) => log.push(["control", id, o.releaseOthers]), setTarget: (on, o) => log.push(["target", id, on, o.releaseOthers]), actor: { testUserPermission: () => true, sheet: { render: () => log.push(["sheet", id]) } }, ...extra };
  };
  const a = mk("a", 0, { isOwner: true });
  const prev = globalThis.canvas;
  const hud = { object: null, rendered: false, bind(t) { this.object = t; this.rendered = true; log.push(["hud", t.document.id]); }, clear() { this.rendered = false; log.push(["hud off"]); } };
  globalThis.canvas = { ...(prev ?? {}), tokens: { placeables: [a] }, hud: { token: hud } };
  asGM(false);
  try {
    assert.deepEqual(Climb.pads(), [], "alone on the ladder: clicked as ever");
    const b = mk("b", 3);
    const c = mk("c", 6, { visible: false });
    canvas.tokens.placeables.push(b, c);
    const pads = Climb.pads();
    assert.deepEqual(pads.map((p) => p.token.document.id), ["a", "b"], "not one this player can't see");
    // Three on the ladder: three quarters the size, where fan() draws them.
    assert.deepEqual([pads[0].x, pads[0].y, pads[0].w, pads[0].h], [413, 425, 75, 75]);
    assert.deepEqual([pads[1].x, pads[1].y], [435, 384]);
    Climb.press(a, { button: 0 });
    assert.deepEqual(log.pop(), ["control", "a", true], "your own: selected");
    Climb._pressed = null;
    Climb.press(a, { button: 0, altKey: true, shiftKey: true });
    assert.deepEqual(log.pop(), ["target", "a", true, false], "Alt: targeted, Shift: added");
    Climb._pressed = null;
    Climb.press(b, { button: 0 });
    assert.deepEqual(log.pop(), ["target", "b", true, true], "someone else's: targeted");
    Climb.press(b, { button: 0 });
    assert.deepEqual(log.pop(), ["sheet", "b"], "twice quickly: its sheet");
    Climb.press(b, { button: 2 });
    assert.deepEqual(log.pop(), ["target", "b", true, true], "right-click on someone else's: targeted");
    Climb.press(a, { button: 2 });
    assert.deepEqual(log.splice(-2), [["control", "a", true], ["hud", "a"]], "right-click on your own: its HUD");
    Climb.press(a, { button: 2 });
    assert.deepEqual(log.pop(), ["hud off"]);
  } finally {
    globalThis.canvas = prev;
    asGM(true);
  }
});

test("falling (pure): what the ground does, 40 a Turn, Death From Above", () => {
  assert.deepEqual(D.fallPlan({ height: 9 }), { counted: 9, dice: "", spared: "short" });
  assert.deepEqual(D.fallPlan({ height: 25 }), { counted: 25, dice: "4d6", spared: "" });
  // Two Cyberlegs: nothing up to 30, everything past it.
  assert.deepEqual(D.fallPlan({ height: 30, legs: true }), { counted: 30, dice: "", spared: "legs" });
  assert.deepEqual(D.fallPlan({ height: 31, legs: true }), { counted: 31, dice: "6d6", spared: "" });
  // Skydrivers take 4 off: 12 counts as 8, 33 as 29 (and that's inside what the legs take).
  assert.deepEqual(D.fallPlan({ height: 12, shorter: 4 }), { counted: 8, dice: "", spared: "short" });
  assert.deepEqual(D.fallPlan({ height: 33, legs: true, shorter: 4 }), { counted: 29, dice: "", spared: "legs" });
  assert.deepEqual(D.fallStep(25), { fell: 25, left: 0 });
  assert.deepEqual(D.fallStep(100), { fell: 40, left: 60 });
  assert.deepEqual(D.deathFromAbove({ damage: 14, body: 10, sp: 11 }), { dealt: 14, taken: 0 });
  assert.deepEqual(D.deathFromAbove({ damage: 30, body: 10, sp: 11 }), { dealt: 21, taken: 9 });
  assert.deepEqual(D.besideStep({ x: 0, y: 500 }, { x: 500, y: 500 }), { x: -1, y: 0 });
  assert.deepEqual(D.besideStep({ x: 900, y: 100 }, { x: 500, y: 500 }), { x: 1, y: -1 });
});

test("falls at the table: held on the climb, 40 a Turn, Cyberlegs, a Broken Leg, Death From Above, the HUD", async () => {
  asGM(true);
  await Settings.set("stairs", true);
  await Settings.set("climbing", true);
  await Settings.set("levels", false);
  Socket.on("climbDrop", (data, userId) => Climb._drop(data, userId));
  Socket.on("climbDive", (data, userId) => Climb._dive(data, userId));
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  const scene = { id: "sc", grid: { size: 100, units: "m", distance: 2 }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), regions: [], flags: {} };
  const tok = (id, { x = 0, y = 0, at = null, items = [], elevation = 0 } = {}) => {
    const d = {
      id, name: id, x, y, width: 1, height: 1, elevation: at ?? elevation, parent: scene, isOwner: true, actor: makeActor({ name: id }, items),
      flags: { [M]: at === null ? {} : { climb: { kind: "tile", id: "foot", at, height: 60, total: 60, base: 0, to: "head" } } },
      async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; },
      async unsetFlag(m, k) { delete this.flags[m]?.[k]; },
      async update(data) { Object.assign(this, data); }
    };
    scene.tokens.set(id, d);
    return d;
  };
  const prevScenes = game.scenes;
  const prevCanvas = globalThis.canvas;
  const prevTargets = game.user.targets;
  game.scenes = { get: () => scene };
  globalThis.canvas = { ...(prevCanvas ?? {}), scene, dimensions: { size: 100, distance: 2 }, grid: null };
  const { Cards } = await import("../scripts/combat/cards.js");
  const { Conditions } = await import("../scripts/conditions/engine.js");
  const { NeonRuler } = await import("../scripts/ruler/ruler.js");
  const { Registry } = await import("../scripts/conditions/registry.js");
  Registry.refresh();
  const cards = [];
  const hurt = [];
  const added = [];
  const prev = { check: Climb.check, post: Cards.post, damage: Cards.damage, add: Conditions.add, cb: NeonRuler.combatantOf, ask: Climb.askDrop, roll: Conditions.roll };
  Cards.post = async (c) => { cards.push(c.kicker); };
  Cards.damage = async (actor, d) => { hurt.push([actor.name, d.amount, !!d.armor]); };
  Conditions.add = async (id, actor) => { added.push([id, actor.name]); return []; };
  Conditions.roll = async (formula) => ({ total: Number(formula.split("d")[0]) * 3, roll: {} });
  let fighting = new Set();
  NeonRuler.combatantOf = (doc) => (fighting.has(doc.id) ? { id: `c-${doc.id}`, tokenId: doc.id, token: doc } : null);
  let totals = [];
  Climb.check = async () => {
    const total = totals.shift() ?? 0;
    return { total, base: 0, die: total, text: String(total) };
  };
  try {
    // Dragged off the climb, 14 m up: the move is stopped and the mover asked. Climbing itself goes on.
    const ana = tok("Ana", { at: 14 });
    const asked = [];
    Climb.askDrop = async (doc, to, height) => { asked.push([doc.id, to.x, to.y, height]); };
    assert.equal(Climb.hold(ana, { x: 100 }, {}, game.user.id), false);
    assert.deepEqual(asked, [["Ana", 100, 0, 14]]);
    assert.equal(Climb.hold(ana, { x: 100 }, { [M]: { climb: true } }, game.user.id), true, "the climb's own moves");
    assert.equal(Climb.hold(ana, { x: 100 }, { [M]: { carried: true } }, game.user.id), true, "carried by whoever holds them");
    assert.equal(Climb.hold(ana, { elevation: 3 }, {}, game.user.id), true, "not a move");
    assert.equal(Climb.hold(tok("Foot", { at: 0 }), { x: 100 }, {}, game.user.id), true, "at the foot: just steps off");
    // They say yes, out of a fight: down at once where they were moved. 14 m: 2d6, armor soaks, DV15 for the leg.
    totals = [16];
    await Climb.drop(ana, { x: 100, y: 0 });
    assert.deepEqual([ana.x, ana.elevation, Climb.state(ana), Climb.falling(ana)], [100, 0, null, null]);
    assert.deepEqual(hurt.pop(), ["Ana", 6, true]);
    assert.deepEqual(added, [], "beat DV15: no Broken Leg");
    assert.equal(cards.at(-1), "Landed");
    // In a fight, from 55 m: in the air till the end of their Turn, 40 down, then the ground at the end of the next.
    const ben = tok("Ben", { at: 55 });
    fighting = new Set(["Ben"]);
    totals = [15];
    await Climb.drop(ben, { x: 200, y: 0 });
    assert.deepEqual([ben.x, ben.elevation, Climb.falling(ben).left, cards.at(-1)], [200, 55, 55, "Falling"]);
    assert.deepEqual(await Climb.fallOn(ben), { landed: false, left: 15 });
    assert.equal(ben.elevation, 15);
    assert.deepEqual(await Climb.fallOn(ben), { landed: true, left: 0 });
    assert.deepEqual([ben.elevation, Climb.falling(ben)], [0, null]);
    assert.deepEqual(hurt.pop(), ["Ben", 30, true], "55 m: 10d6");
    assert.deepEqual(added.pop(), ["brokenLeg", "Ben"], "15 doesn't beat DV15");
    fighting = new Set();
    // Two Cyberlegs: 28 m is nothing, 31 m is everything.
    const legs = [{ name: "Cyberleg", type: "cyberware", system: { isInstalled: true } }, { name: "Cyberleg", type: "cyberware", system: { isInstalled: true } }];
    const cy = tok("Cy", { at: 28, items: legs });
    await Climb.drop(cy, { x: 300, y: 0 });
    assert.deepEqual([hurt.length, added.length], [0, 0]);
    cy.flags[M].climb = { kind: "tile", id: "foot", at: 31, height: 60, total: 60, base: 0, to: "head" };
    totals = [16];
    await Climb.drop(cy, { x: 300, y: 0 });
    assert.deepEqual(hurt.pop(), ["Cy", 18, true]);
    // Death From Above: a borg with PanzerFaust lets go onto the square Eve stands on, from 20 m.
    const borg = [{ name: "FBC Alpha", type: "cyberware", system: { isInstalled: true } }, { name: "Martial Arts (PanzerFaust)", type: "skill", system: { level: 6, stat: "dex" } }];
    const dan = tok("Dan", { at: 20, items: borg });
    const eve = tok("Eve", { x: 400, y: 0 });
    assert.ok(Climb.panzer(dan.actor));
    assert.equal(Climb.panzer(ana.actor), null);
    totals = [16];
    await Climb.drop(dan, { x: 400, y: 0 });
    // 4d6 = 12; BODY 6 + SP 11 take all of it: Eve takes 12 to HP and is Prone, Dan nothing and no leg Check.
    assert.deepEqual(hurt.splice(0), [["Eve", 12, false]]);
    assert.deepEqual(added.splice(0), [["prone", "Eve"]]);
    assert.equal(cards.at(-1), "Death From Above");
    // From 50 m: 10d6 = 30; 17 into Eve, 13 left for Dan, and the leg Check.
    dan.flags[M].climb = { kind: "tile", id: "foot", at: 50, height: 60, total: 60, base: 0, to: "head" };
    dan.x = 0;
    totals = [16, 10];
    await Climb.drop(dan, { x: 400, y: 0 });
    assert.deepEqual(hurt.splice(0), [["Eve", 17, false], ["Dan", 13, false]]);
    assert.deepEqual(added.splice(0), [["brokenLeg", "Dan"], ["prone", "Eve"]]);
    // The Check fails: an ordinary landing, and Eve is fine.
    dan.flags[M].climb = { kind: "tile", id: "foot", at: 20, height: 60, total: 60, base: 0, to: "head" };
    dan.x = 0;
    totals = [15, 16];
    await Climb.drop(dan, { x: 400, y: 0 });
    assert.deepEqual(hurt.splice(0), [["Dan", 12, true]]);
    assert.deepEqual(added.splice(0), []);
    // From a height, on a target: offered on the HUD while Eve is targeted, 12 m below and 6 m off.
    dan.x = 700;
    dan.elevation = 12;
    game.user.targets = new Set([{ id: "Eve", document: eve }]);
    const dive = Climb.diveFor(dan);
    assert.deepEqual([dive.target.id, dive.up, dive.across], ["Eve", 12, 6]);
    assert.deepEqual(Climb.entries(dan.actor, dan).map((e) => e.run), ["climb:dive:Eve"]);
    dan.elevation = 8;
    assert.equal(Climb.diveFor(dan), null, "under 10: not a fall that hurts");
    dan.elevation = 12;
    dan.x = 2000;
    assert.equal(Climb.diveFor(dan), null, "further off than their MOVE");
    dan.x = 700;
    totals = [16];
    await Climb.act(dan, "climb:dive:Eve");
    assert.deepEqual([dan.x, dan.y, dan.elevation], [500, 0, 0], "down beside her, on the side he came from");
    assert.deepEqual(hurt.splice(0), [["Eve", 6, false]]);
    // Off a floor with a height. A 20 m roof (its own plan), and a tower: ground and 12 m floor side by side, with an opening.
    await Settings.set("levels", true);
    const rect = (x, y, width, height) => ({ type: "rectangle", x, y, width, height });
    scene.regions = [
      { id: "roof", shapes: [rect(3000, 0, 500, 500)] },
      { id: "g", shapes: [rect(5000, 0, 1000, 1000)] }, { id: "f2", shapes: [rect(7000, 0, 1000, 1000)] },
      { id: "hole", shapes: [rect(7400, 400, 200, 200)] }
    ];
    scene.flags[M] = { floors: [{ region: "roof", stack: "", height: 20 }, { region: "g", stack: "Tower", height: 0 }, { region: "f2", stack: "Tower", height: 12 }], openings: ["hole"] };
    const gus = tok("Gus", { x: 3400, y: 200 });
    assert.equal(Climb.ledge(gus, { x: 3300, y: 200 }), null, "still on the roof");
    assert.deepEqual(Climb.ledge(gus, { x: 3500, y: 200 }), { drop: 20, land: { x: 3500, y: 200 }, opening: false });
    gus.elevation = 5;
    assert.equal(Climb.ledge(gus, { x: 3500, y: 200 }), null, "a token with its own elevation: flying, not asked");
    gus.elevation = 0;
    const edges = [];
    const prevLedge = Climb.askLedge;
    Climb.askLedge = async (doc, to, edge) => { edges.push([doc.id, edge.drop]); };
    assert.equal(Climb.hold(gus, { x: 3500 }, {}, game.user.id), false);
    assert.deepEqual(edges, [["Gus", 20]]);
    assert.equal(Climb.hold(gus, { x: 3500 }, { [M]: { ledge: true } }, game.user.id), true, "move without falling");
    assert.equal(Climb.hold(gus, { x: 3300 }, {}, game.user.id), true);
    Climb.askLedge = prevLedge;
    // They fall: 20 m, 4d6.
    totals = [16];
    await Socket.request("climbDrop", { scene: "sc", token: "Gus", x: 3500, y: 200 });
    assert.deepEqual([gus.x, gus.elevation], [3500, 0]);
    assert.deepEqual(hurt.splice(0), [["Gus", 12, true]]);
    // The tower's upper floor: across to the ground floor's plan is a reposition; into the opening is 12 m down onto it.
    const hal = tok("Hal", { x: 7200, y: 400 });
    assert.equal(Climb.ledge(hal, { x: 5200, y: 400 }), null);
    assert.deepEqual(Climb.ledge(hal, { x: 7400, y: 400 }), { drop: 12, land: { x: 5400, y: 400 }, opening: true });
    totals = [16];
    await Socket.request("climbDrop", { scene: "sc", token: "Hal", x: 7400, y: 400 });
    assert.deepEqual([hal.x, hal.y, hal.elevation], [5400, 400, 0], "on the floor below, at the same spot of its plan");
    assert.deepEqual(hurt.splice(0), [["Hal", 6, true]]);
    await Settings.set("levelsFalls", false);
    assert.equal(Climb.ledge(gus, { x: 3300, y: 200 }), null);
    await Settings.set("levelsFalls", true);
    await Settings.set("levels", false);
    scene.regions = [];
    // The Action HUD: one Climb entry with a button for each thing to do.
    const fay = tok("Fay", { at: 5 });
    const rows = Climb.entries(fay.actor, fay);
    assert.deepEqual(rows.map((e) => [e.key, e.buttons.map((b) => b.key)]), [["climb:menu", ["climb:up", "climb:down"]]]);
  } finally {
    game.scenes = prevScenes;
    globalThis.canvas = prevCanvas;
    game.user.targets = prevTargets;
    Climb.check = prev.check;
    Climb.askDrop = prev.ask;
    Cards.post = prev.post;
    Cards.damage = prev.damage;
    Conditions.add = prev.add;
    Conditions.roll = prev.roll;
    NeonRuler.combatantOf = prev.cb;
    await Settings.set("levels", true);
  }
});

test("the DVs to a climber drawn apart are drawn beside where it's drawn", async () => {
  const { Dv } = await import("../scripts/arsenal/dv.js");
  const { Compat } = await import("../scripts/compat.js");
  await Settings.set("arsenalDvDisplay", true);
  const prev = { text: Dv.textFor, pt: Object.getOwnPropertyDescriptor(Compat, "PreciseText"), diwako: Object.getOwnPropertyDescriptor(Dv, "diwako"), config: globalThis.CONFIG, layer: Climb.layer, tips: Climb.tips, targets: game.user.targets };
  class Text {
    constructor(text, style) { this.text = text; this.style = style; this.anchor = { set: (x, y) => { this.anchored = [x, y]; } }; this.position = { set: (x, y) => { this.at = [x, y]; } }; }
    destroy() { this.destroyed = true; }
  }
  Object.defineProperty(Compat, "PreciseText", { value: Text, configurable: true });
  Object.defineProperty(Dv, "diwako", { value: true, configurable: true });
  globalThis.CONFIG = { ...(prev.config ?? {}), canvasTextStyle: { clone: () => ({}) } };
  const added = [];
  Climb.layer = { addChild: (c) => added.push(c) };
  Climb.tips = new Map();
  let info = { text: "Heavy Pistol: DV 15", right: false };
  Dv.textFor = async () => info;
  const token = { id: "t1", document: { id: "t1" } };
  const pad = { token, x: 413, y: 425, w: 75, h: 75 };
  game.user.targets = new Set();
  try {
    await Climb.tip(pad, true);
    assert.deepEqual([added[0].text, added[0].at, added[0].anchored], ["Heavy Pistol: DV 15", [401, 425], [1, 0]], "left of the shrunk token");
    // Shown again (the pointer comes back): the old one goes, one stays.
    info = { text: "Heavy Pistol: DV 13", right: true };
    await Climb.tip(pad, true);
    assert.equal(added[0].destroyed, true);
    assert.deepEqual([added[1].at, added[1].anchored, Climb.tips.size], [[500, 425], [0, 0], 1], "Diwako's setting: on the right");
    // The pointer leaves: gone, unless it's targeted.
    Climb.hover(pad, false, {});
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual([added[1].destroyed, Climb.tips.size], [true, 0]);
    game.user.targets = new Set([token]);
    Climb.hover(pad, false, {});
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(Climb.tips.size, 1, "targeted: it stays");
    // Nothing to say (nobody selected, out of combat): nothing drawn.
    info = null;
    await Climb.tip(pad, true);
    assert.equal(Climb.tips.size, 0);
  } finally {
    Dv.textFor = prev.text;
    if (prev.pt) Object.defineProperty(Compat, "PreciseText", prev.pt);
    if (prev.diwako) Object.defineProperty(Dv, "diwako", prev.diwako);
    globalThis.CONFIG = prev.config;
    Climb.layer = prev.layer;
    Climb.tips = prev.tips;
    game.user.targets = prev.targets;
  }
});
