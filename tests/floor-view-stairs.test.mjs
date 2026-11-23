/** Seeing the other floors (who shows where) and stairs (which way a move takes, where it comes out). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettings, asGM } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const LD = await import("../scripts/senses/levels-data.js");
const SD = await import("../scripts/senses/stairs-data.js");
const { Stairs } = await import("../scripts/senses/stairs.js");

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
  assert.deepEqual(SD.landing(tiles[1], 100, 100), { x: 2050, y: 50 });
  assert.deepEqual(SD.landing(tiles[1], 200, 200), { x: 2000, y: 0 });
});

test("stairs at the table: linking two tiles, a token taken up and not straight back down", async () => {
  asGM(true);
  await Settings.set("stairs", true);
  class Docs extends Map {
    [Symbol.iterator]() {
      return this.values();
    }
  }
  const scene = { id: "sc", grid: { size: 100 }, tiles: new Docs(), tokens: new Docs() };
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
  assert.equal(await Stairs.link(foot, head), true);
  assert.deepEqual([Stairs.linkOf(foot), Stairs.linkOf(head)], ["head", "foot"]);
  assert.equal(Stairs.tiles(scene).length, 2);
  const tok = {
    id: "t", uuid: "Scene.sc.Token.t", x: 300, y: 0, width: 1, height: 1, parent: scene, moves: [],
    async update(data, options) { Object.assign(this, data); this.moves.push({ data, options }); }
  };
  scene.tokens.set("t", tok);
  Stairs.see(tok);
  // Walks onto the foot: comes out in the middle of the head, for free.
  Object.assign(tok, { x: 100, y: 0 });
  await Stairs.onMove(tok, { x: 100 }, {});
  assert.deepEqual([tok.x, tok.y], [2050, 50]);
  assert.deepEqual(tok.moves.at(-1).options, { animate: false, [M]: { free: true, stairs: true } });
  // That arrival isn't a step onto the head.
  await Stairs.onMove(tok, { x: 2050, y: 50 }, { [M]: { free: true, stairs: true } });
  assert.equal(tok.moves.length, 1);
  // Shuffling about on the head: stays.
  Object.assign(tok, { x: 2000, y: 0 });
  await Stairs.onMove(tok, { x: 2000, y: 0 }, {});
  assert.equal(tok.moves.length, 1);
  // Off, and back on: down again.
  Object.assign(tok, { x: 2300, y: 0 });
  await Stairs.onMove(tok, { x: 2300 }, {});
  Object.assign(tok, { x: 2100, y: 0 });
  await Stairs.onMove(tok, { x: 2100 }, {});
  assert.deepEqual([tok.x, tok.y], [50, 50]);
  // Carried there by whoever holds it, or taken back with Ctrl+Z: left alone.
  Object.assign(tok, { x: 300, y: 0 });
  await Stairs.onMove(tok, { x: 300 }, {});
  Object.assign(tok, { x: 100, y: 0 });
  await Stairs.onMove(tok, { x: 100 }, { [M]: { carried: true } });
  assert.deepEqual([tok.x, tok.y], [100, 0]);
  // Switched off: tiles are tiles.
  await Settings.set("stairs", false);
  Object.assign(tok, { x: 300, y: 0 });
  await Stairs.onMove(tok, { x: 300 }, {});
  Object.assign(tok, { x: 100, y: 0 });
  await Stairs.onMove(tok, { x: 100 }, {});
  assert.deepEqual([tok.x, tok.y], [100, 0]);
  await Settings.set("stairs", true);
  // Linking one end elsewhere lets the old end go; unlinking clears both.
  await Stairs.link(foot, other);
  assert.deepEqual([Stairs.linkOf(foot), Stairs.linkOf(head), Stairs.linkOf(other)], ["other", null, "foot"]);
  await Stairs.unlink(other);
  assert.equal(Stairs.tiles(scene).length, 0);
});
