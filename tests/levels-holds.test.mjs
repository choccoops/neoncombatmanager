/** Levels (floors, heights, the distance a DV uses) and holds (Grab, carry, Human Shield). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings, asGM } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const LD = await import("../scripts/senses/levels-data.js");
const { Levels, FLOORS_FLAG } = await import("../scripts/senses/levels.js");
const HD = await import("../scripts/combat/hold-data.js");
const { Hold } = await import("../scripts/combat/hold.js");
const { Dv } = await import("../scripts/arsenal/dv.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { Registry } = await import("../scripts/conditions/registry.js");
Registry.refresh();

const rect = (x, y, width, height) => ({ type: "rectangle", x, y, width, height });

test("floors (pure): which one you're on, plans that line up, across and up", () => {
  const floors = [{ region: "g", stack: "Tower", height: 0 }, { region: "f2", stack: "Tower", height: 8 }, { region: "roof", stack: "", height: 20 }];
  assert.equal(LD.floorIn(floors, ["f2"]).height, 8);
  assert.equal(LD.floorIn(floors, ["g", "f2"]).height, 8, "the higher, where two overlap");
  assert.equal(LD.floorIn(floors, ["x"]), null);
  assert.equal(LD.stacked(floors[0], floors[1]), true);
  assert.equal(LD.stacked(floors[0], floors[0]), false);
  assert.equal(LD.stacked(floors[0], floors[2]), false, "no building named: its plan is the map's");
  assert.deepEqual(LD.onto({ x: 1150, y: 250 }, { x: 1000, y: 0 }, { x: 0, y: 0 }), { x: 150, y: 250 });
  assert.equal(LD.through(30, 40), 50);
  assert.equal(LD.through(12, 0), 12);
  assert.equal(LD.cleanFloor({ region: "a", height: "x" }), null);
  assert.deepEqual(LD.cleanFloor({ region: "a", stack: " Tower ", height: "4.26" }), { region: "a", stack: "Tower", height: 4.3 });
});

test("levels at the table: the distance a DV uses", async () => {
  const scene = {
    grid: { size: 100, units: "m" },
    regions: [{ id: "g", name: "Ground", shapes: [rect(0, 0, 1000, 1000)] }, { id: "f2", name: "2nd", shapes: [rect(2000, 0, 1000, 1000)] }, { id: "roof", name: "Roof", shapes: [rect(0, 2000, 500, 500)] }],
    flags: { [M]: { [FLOORS_FLAG]: [{ region: "g", stack: "Tower", height: 0 }, { region: "f2", stack: "Tower", height: 8 }, { region: "roof", stack: "", height: 30 }] } },
    tokens: new Map()
  };
  const tok = (id, x, y, extra = {}) => {
    const t = { id, center: { x, y }, document: { id, parent: scene, elevation: 0, flags: {}, ...extra } };
    scene.tokens.set(id, t.document);
    t.document.object = t;
    return t;
  };
  const prev = globalThis.canvas;
  // 100 px a square, 2 m a square.
  globalThis.canvas = { ...(prev ?? {}), scene, dimensions: { size: 100, distance: 2 }, grid: null };
  try {
    await Settings.set("levels", true);
    const a = tok("a", 150, 150);
    const b = tok("b", 2150, 450); // the same plan, 3 squares down: 6 m across, 8 m up
    assert.equal(Levels.distance(a, b), 10);
    assert.equal(Dv.distance(a, b), 10, "not the 40 m the map shows");
    const c = tok("c", 450, 150);
    assert.equal(Levels.distance(a, c), null, "same floor: the map is right");
    assert.equal(Dv.distance(a, c), 6);
    // A rooftop with no building named: the map's distance, and its height.
    const r = tok("r", 150, 2050);
    const street = tok("s", 1650, 2050); // 30 m off on the map, on the ground
    assert.equal(Levels.distance(r, street), 42);
    // A token's own elevation counts.
    const drone = tok("d", 450, 150, { elevation: 8 });
    assert.equal(Levels.distance(a, drone), 10);
    // A Multilevel Tokens clone of b, shown on the ground floor: measured to the real one.
    const clone = tok("k", 150, 450, { flags: { "multilevel-tokens": { stoken: "b" } } });
    assert.equal(Levels.distance(a, clone), 10);
    // A point (where a grenade lands) will do.
    assert.equal(Levels.distance(a, { x: 2150, y: 150 }), 8);
    await Settings.set("levels", false);
    assert.equal(Levels.distance(a, b), null);
  } finally {
    await Settings.set("levels", true);
    globalThis.canvas = prev;
  }
});

test("holds (pure): reach, where the held one goes, who a shot goes at", () => {
  assert.equal(HD.inReach(2, 2), true);
  assert.equal(HD.inReach(4, 2), false);
  assert.equal(HD.inReach(1.5, 1), true);
  assert.deepEqual(HD.carriedTo({ x: 500, y: 300 }, { dx: 100, dy: -100 }), { x: 600, y: 200 });
  assert.deepEqual(HD.redirect(["h", "x"], { h: "s" }), { ids: ["s", "x"], swapped: [{ holder: "h", shield: "s" }] });
  assert.deepEqual(HD.redirect(["h", "s"], { h: "s" }).ids, ["s"], "not twice");
  assert.deepEqual(HD.redirect(["x"], {}), { ids: ["x"], swapped: [] });
});

test("holds at the table: Grab, carried along, Human Shield, let go", async () => {
  asGM(true);
  await Settings.set("holds", true);
  // Foundry's collections hand out their documents, not [id, document] pairs.
  class Docs extends Map {
    [Symbol.iterator]() {
      return this.values();
    }
  }
  const scene = { id: "sc", grid: { size: 100 }, tokens: new Docs() };
  const mk = (id, x, y, name) => {
    const actor = makeActor({ name });
    const doc = {
      id, x, y, name, parent: scene, actor, flags: {}, moves: [],
      async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; },
      async unsetFlag(m, k) { delete this.flags[m]?.[k]; },
      async update(data, options) { Object.assign(this, data); this.moves.push(options); }
    };
    scene.tokens.set(id, doc);
    return doc;
  };
  const prevScenes = game.scenes;
  game.scenes = { get: () => scene };
  try {
    const h = mk("h", 500, 500, "Holder");
    const t = mk("t", 600, 500, "Held");
    assert.equal(await Hold._grab({ scene: "sc", holder: "h", target: "t" }), true);
    assert.deepEqual(Hold.heldBy(t), { id: "h", dx: 100, dy: 0, shield: false });
    assert.equal(Hold.held(h), t);
    assert.equal(Conditions.has("grappling", h.actor), true);
    assert.equal(Conditions.has("grappled", t.actor), true);
    assert.equal(Hold.shieldOf(h), null);
    // The holder walks: the held one comes along, where it was held, at no cost to its movement.
    Object.assign(h, { x: 800, y: 700 });
    await Hold.onMove(h, { x: 800, y: 700 }, {});
    assert.deepEqual([t.x, t.y], [900, 700]);
    assert.deepEqual(t.moves.at(-1)[M], { free: true, carried: true });
    // Its own carried move doesn't carry anything on.
    await Hold.onMove(t, { x: 900 }, { [M]: { carried: true } });
    assert.equal(Hold.heldBy(t).dx, 100);
    // Human Shield.
    assert.equal(await Hold._shield({ scene: "sc", held: "t", on: true }), true);
    assert.equal(Hold.shieldOf(h), t);
    assert.equal(Conditions.has("humanShield", t.actor), true);
    assert.equal(Hold.cantDodge(t.actor), true);
    const tokH = { id: "h", name: "Holder", document: h, setTarget() { this.off = true; } };
    const tokT = { id: "t", name: "Held", document: t, setTarget(on) { this.on = on; } };
    const prevCanvas = globalThis.canvas;
    globalThis.canvas = { ...(prevCanvas ?? {}), tokens: { get: (id) => (id === "t" ? tokT : id === "h" ? tokH : null) } };
    try {
      const r = Hold.retarget([tokH], { ranged: true });
      assert.deepEqual(r.targets, [tokT]);
      assert.deepEqual(r.swapped, [{ holder: "Holder", shield: "Held" }]);
      assert.equal(tokT.on, true, "the attacker's own target moves to the shield");
      assert.deepEqual(Hold.retarget([tokH], { ranged: false }).targets, [tokH], "a blade goes where it's swung");
    } finally {
      globalThis.canvas = prevCanvas;
    }
    // Let go: flags and conditions come off.
    assert.equal(await Hold._release({ scene: "sc", held: "t" }), true);
    assert.equal(Hold.heldBy(t), null);
    assert.equal(Conditions.has("grappled", t.actor) || Conditions.has("humanShield", t.actor) || Conditions.has("grappling", h.actor), false);
    // A Grapple ended on the sheet: the next move finds nothing to carry and clears the hold.
    await Hold._grab({ scene: "sc", holder: "h", target: "t" });
    await Conditions.remove(["grappled"], [t.actor]);
    Object.assign(h, { x: 0, y: 0 });
    await Hold.onMove(h, { x: 0 }, {});
    assert.equal(Hold.heldBy(t), null);
    assert.deepEqual([t.x, t.y], [900, 700], "left where it stood");
  } finally {
    game.scenes = prevScenes;
  }
});
