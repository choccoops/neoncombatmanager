/** Seeing the other floors (who shows where) and stairs (which way a move takes, where it comes out). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettings, asGM } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const LD = await import("../scripts/senses/levels-data.js");
const SD = await import("../scripts/senses/stairs-data.js");
const { Stairs } = await import("../scripts/senses/stairs.js");
// What Stairs.init() registers for the GM's client.
const { Socket } = await import("../scripts/socket.js");
Socket.on("wayTake", (data, userId) => Stairs._take(data, userId));

test("the other floors (pure): who shows on the viewer's floor, and where", () => {
  const g = { region: "g", stack: "Tower", height: 0 };
  const f2 = { region: "f2", stack: "Tower", height: 4 };
  const f3 = { region: "f3", stack: "Tower", height: 8 };
  const shop = { region: "shop", stack: "Shop", height: 4 };
  const floors = [g, f2, f3, shop];
  const viewer = { floor: f2, corner: { x: 2000, y: 0 } };
  const others = [
    { id: "up", floor: f3, corner: { x: 4000, y: 0 }, point: { x: 4150, y: 250 } },
    { id: "down", floor: g, corner: { x: 0, y: 0 }, point: { x: 350, y: 50 } },
    { id: "same", floor: f2, corner: { x: 2000, y: 0 }, point: { x: 2050, y: 50 } },
    { id: "next-door", floor: shop, corner: { x: 0, y: 3000 }, point: { x: 50, y: 3050 } },
    { id: "street", floor: null, corner: null, point: { x: 9000, y: 9000 } }
  ];
  assert.deepEqual(LD.ghostsFor(viewer, others, floors, "all"), [{ id: "up", x: 2150, y: 250, up: 4 }, { id: "down", x: 2350, y: 50, up: -4 }]);
  assert.deepEqual(LD.ghostsFor(viewer, others, floors, "off"), []);
  // From the ground, the next floor only.
  const low = { floor: g, corner: { x: 0, y: 0 } };
  assert.deepEqual(LD.ghostsFor(low, others, floors, "near").map((x) => x.id), ["same"], "the one on the 2nd floor, not the 3rd");
  const two = [...others, { id: "mid", floor: f2, corner: { x: 2000, y: 0 }, point: { x: 2050, y: 50 } }];
  assert.deepEqual(LD.ghostsFor(low, two, floors, "near").map((x) => [x.id, x.up]), [["same", 4], ["mid", 4]]);
  assert.deepEqual(LD.ghostsFor(low, two, floors, "all").map((x) => x.id), ["up", "same", "mid"]);
  // No building named, or not on a floor: nothing to look onto.
  assert.deepEqual(LD.ghostsFor({ floor: { region: "r", stack: "", height: 20 }, corner: { x: 0, y: 0 } }, others, floors), []);
  assert.deepEqual(LD.ghostsFor({ floor: null, corner: null }, others, floors), []);
  assert.equal(LD.apart({ floor: g }, { floor: f3 }), true);
  assert.equal(LD.apart({ floor: g }, { floor: shop }), false);
});

test("stairs (pure): stepping on takes the way, standing on it or stepping off doesn't", () => {
  const tiles = [{ id: "foot", x: 0, y: 0, width: 200, height: 200, to: "head" }, { id: "head", x: 2000, y: 0, width: 200, height: 200, to: "foot" }, { id: "orphan", x: 500, y: 500, width: 100, height: 100, to: "gone" }];
  assert.equal(SD.wayTaken(tiles, { x: 300, y: 100 }, { x: 150, y: 100 }).to.id, "head");
  assert.equal(SD.wayTaken(tiles, { x: 50, y: 50 }, { x: 150, y: 100 }), null, "already on it");
  assert.equal(SD.wayTaken(tiles, { x: 150, y: 100 }, { x: 300, y: 100 }), null, "stepping off");
  assert.equal(SD.wayTaken(tiles, null, { x: 2100, y: 100 }).to.id, "foot", "unknown start counts as off it");
  assert.equal(SD.wayTaken(tiles, { x: 0, y: 900 }, { x: 550, y: 550 }), null, "the far end is gone");
  // A ladder thinner than the token, set off the grid: the token's middle misses it, but it's under the token.
  const ladder = [{ id: "ladder", x: 470, y: 20, width: 30, height: 60, to: "top" }, { id: "top", x: 3000, y: 0, width: 30, height: 60, to: "ladder" }];
  const size = { w: 100, h: 100 };
  assert.equal(SD.wayTaken(ladder, { x: 250, y: 50 }, { x: 450, y: 50 }), null, "by its middle alone: missed");
  assert.equal(SD.wayTaken(ladder, { x: 250, y: 50 }, { x: 450, y: 50 }, size).to.id, "top");
  assert.equal(SD.wayTaken(ladder, { x: 250, y: 50 }, { x: 350, y: 50 }, size), null, "the square beside it");
  assert.equal(SD.wayTaken(ladder, { x: 450, y: 50 }, { x: 450, y: 50 }, size), null, "already on it");
  // Standing on an end: that's the way on offer, whichever way the token came.
  assert.equal(SD.wayAt(tiles, { x: 150, y: 100 }).to.id, "head");
  assert.equal(SD.wayAt(tiles, { x: 2100, y: 100 }).to.id, "foot");
  assert.equal(SD.wayAt(tiles, { x: 300, y: 100 }), null);
  assert.equal(SD.wayAt(tiles, { x: 550, y: 550 }), null, "the far end is gone");
  assert.equal(SD.wayAt(ladder, { x: 450, y: 50 }, size).to.id, "top");
  assert.equal(SD.kindOf("door"), "door");
  assert.equal(SD.kindOf("lift"), "stairs");
  assert.deepEqual(SD.landing(tiles[1], 100, 100), { x: 2050, y: 50 });
  assert.deepEqual(SD.landing(tiles[1], 200, 200), { x: 2000, y: 0 });
});

test("ways at the table: linked as stairs or a door, taken when asked for, or by themselves in the automatic mode", async () => {
  asGM(true);
  await Settings.set("stairs", true);
  await Settings.set("stairsAsk", true);
  class Docs extends Map {
    [Symbol.iterator]() {
      return this.values();
    }
  }
  const scene = { id: "sc", grid: { size: 100 }, tiles: new Docs(), tokens: new Docs(), regions: [], flags: {} };
  const tile = (id, x, y) => {
    const d = {
      id, x, y, width: 200, height: 200, parent: scene, flags: {},
      async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; },
      async unsetFlag(m, k) { delete this.flags[m]?.[k]; }
    };
    scene.tiles.set(id, d);
    return d;
  };
  const foot = tile("foot", 0, 0);
  const head = tile("head", 2000, 0);
  const other = tile("other", 4000, 0);
  const prevScenes = game.scenes;
  game.scenes = { get: () => scene };
  try {
    assert.equal(await Stairs.link(foot, head, "door"), true);
    assert.deepEqual([Stairs.linkOf(foot), Stairs.linkOf(head)], ["head", "foot"]);
    assert.deepEqual(Stairs.tiles(scene).map((t) => t.kind), ["door", "door"]);
    const tok = {
      id: "t", uuid: "Scene.sc.Token.t", x: 300, y: 0, width: 1, height: 1, parent: scene, isOwner: true, moves: [],
      async update(data, options) { Object.assign(this, data); this.moves.push({ data, options }); }
    };
    scene.tokens.set("t", tok);
    Stairs.see(tok);
    assert.equal(Stairs.wayFor(tok), null, "beside it");
    // Walks onto the foot: nothing happens by itself, but the way is there to take.
    Object.assign(tok, { x: 100, y: 0 });
    await Stairs.onMove(tok, { x: 100 }, {});
    assert.deepEqual([tok.x, tok.y], [100, 0]);
    assert.equal(Stairs.wayFor(tok).to.id, "head");
    assert.deepEqual(Stairs.entries(null, tok).map((e) => e.key), ["way:foot"]);
    // Chosen: comes out in the middle of the far end, for free.
    assert.equal(await Stairs.take(tok), true);
    assert.deepEqual([tok.x, tok.y], [2050, 50]);
    assert.deepEqual(tok.moves.at(-1).options, { animate: false, [M]: { free: true, stairs: true } });
    // And from there it can be taken back.
    assert.equal(Stairs.wayFor(tok).to.id, "foot");
    // Someone asking for a tile the token isn't on gets nothing.
    assert.equal(await Stairs._take({ scene: "sc", token: "t", tile: "other" }, null), false);
    // Off its tile: nothing to take.
    Object.assign(tok, { x: 2300, y: 0 });
    assert.equal(await Stairs.take(tok), false);

    // The automatic mode: stepping on takes it, arriving and shuffling about don't.
    await Settings.set("stairsAsk", false);
    Stairs.see(tok);
    const before = tok.moves.length;
    Object.assign(tok, { x: 2100, y: 0 });
    await Stairs.onMove(tok, { x: 2100 }, {});
    assert.deepEqual([tok.x, tok.y], [50, 50]);
    await Stairs.onMove(tok, { x: 50, y: 50 }, { [M]: { free: true, stairs: true } });
    Object.assign(tok, { x: 0, y: 0 });
    await Stairs.onMove(tok, { x: 0, y: 0 }, {});
    assert.equal(tok.moves.length, before + 1);
    // Carried there by whoever holds it: left alone.
    Object.assign(tok, { x: 300, y: 0 });
    await Stairs.onMove(tok, { x: 300 }, {});
    Object.assign(tok, { x: 100, y: 0 });
    await Stairs.onMove(tok, { x: 100 }, { [M]: { carried: true } });
    assert.deepEqual([tok.x, tok.y], [100, 0]);
    await Settings.set("stairsAsk", true);

    // Switched off: tiles are tiles.
    await Settings.set("stairs", false);
    assert.equal(Stairs.wayFor(tok), null);
    assert.equal(await Stairs.take(tok), false);
    await Settings.set("stairs", true);
    // Linking one end elsewhere lets the old end go; unlinking clears both.
    await Stairs.link(foot, other);
    assert.deepEqual([Stairs.linkOf(foot), Stairs.linkOf(head), Stairs.linkOf(other)], ["other", null, "foot"]);
    assert.equal(Stairs.tiles(scene)[0].kind, "stairs");
    await Stairs.unlink(other);
    assert.equal(Stairs.tiles(scene).length, 0);
  } finally {
    game.scenes = prevScenes;
    await Settings.set("stairsAsk", true);
  }
});

test("openings: a floor is solid except where the building is open between floors", async () => {
  const { inShapes } = await import("../scripts/senses/far-data.js");
  const { Levels, FLOORS_FLAG, OPENINGS_FLAG } = await import("../scripts/senses/levels.js");
  const rect = (x, y, width, height) => ({ type: "rectangle", x, y, width, height });
  const g = { region: "g", stack: "Tower", height: 0 };
  const f2 = { region: "f2", stack: "Tower", height: 4 };
  // A stairwell drawn on the ground floor, in the plan's top left 200 × 200.
  const well = [{ stack: "Tower", shapes: [rect(0, 0, 200, 200)], corner: { x: 0, y: 0 } }];
  const at = (floor, cx, x, y) => ({ floor, corner: { x: cx, y: 0 }, point: { x: cx + x, y } });
  assert.equal(LD.openBetween(well, at(g, 0, 100, 100), at(f2, 2000, 150, 50), inShapes), true, "both in the stairwell");
  assert.equal(LD.openBetween(well, at(g, 0, 100, 100), at(f2, 2000, 500, 500), inShapes), false, "one of them out on the floor");
  assert.equal(LD.openBetween(well, at(g, 0, 500, 500), at(f2, 2000, 500, 500), inShapes), false);
  assert.equal(LD.openBetween([], at(g, 0, 100, 100), at(f2, 2000, 100, 100), inShapes), false, "no openings: every floor is solid");
  assert.equal(LD.openBetween([{ ...well[0], stack: "Shop" }], at(g, 0, 100, 100), at(f2, 2000, 100, 100), inShapes), false, "another building's stairwell");
  assert.equal(LD.openBetween(well, at(g, 0, 100, 100), at(g, 0, 150, 150), inShapes), false, "same floor: not a question of openings");

  // At the table.
  const scene = {
    grid: { size: 100 },
    regions: [{ id: "g", shapes: [rect(0, 0, 1000, 1000)] }, { id: "f2", shapes: [rect(2000, 0, 1000, 1000)] }, { id: "well", name: "Stairwell", shapes: [rect(2000, 0, 200, 200)] }],
    flags: { [M]: { [FLOORS_FLAG]: [g, f2], [OPENINGS_FLAG]: ["well"] } }
  };
  const tok = (id, x, y) => ({ id, center: { x, y }, document: { id, parent: scene, elevation: 0, flags: {} } });
  const prev = globalThis.canvas;
  globalThis.canvas = { ...(prev ?? {}), scene, dimensions: { size: 100, distance: 2 }, grid: null };
  try {
    await Settings.set("levels", true);
    await Settings.set("levelsView", "open");
    // The opening was drawn on the 2nd floor: it's that part of the plan on every floor.
    assert.deepEqual(Levels.openings(scene).map((o) => [o.id, o.stack, o.corner]), [["well", "Tower", { x: 2000, y: 0 }]]);
    const below = tok("a", 100, 100);
    const above = tok("b", 2150, 150);
    const room = tok("c", 2700, 700);
    assert.equal(Levels.floorBetween(below, above), false, "up the stairwell");
    assert.equal(Levels.floorBetween(below, room), true, "through the floor: no shot");
    assert.equal(Levels.floorBetween(above, room), false, "same floor");
    // The GM's choice of see-through floors.
    await Settings.set("levelsView", "all");
    assert.equal(Levels.floorBetween(below, room), false);
  } finally {
    await Settings.set("levelsView", "open");
    globalThis.canvas = prev;
  }
});
