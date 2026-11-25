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
