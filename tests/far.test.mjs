/** Linked areas: which Region a point is in, the links out of it, who sees across, and the distance an attack is made at. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettings } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const D = await import("../scripts/senses/far-data.js");
const { Far, LINKS_FLAG } = await import("../scripts/senses/far.js");
const { Dv } = await import("../scripts/arsenal/dv.js");

const rect = (x, y, width, height, hole = false) => ({ type: "rectangle", x, y, width, height, hole });

test("which area a point is in (pure)", () => {
  assert.equal(D.inShapes([rect(0, 0, 100, 100)], { x: 50, y: 50 }), true);
  assert.equal(D.inShapes([rect(0, 0, 100, 100)], { x: 150, y: 50 }), false);
  assert.equal(D.inShapes([rect(0, 0, 100, 100), rect(40, 40, 20, 20, true)], { x: 50, y: 50 }), false, "a hole cuts it out");
  assert.equal(D.inShapes([{ type: "circle", x: 0, y: 0, radius: 10 }], { x: 6, y: 6 }), true);
  assert.equal(D.inShapes([{ type: "ellipse", x: 0, y: 0, radiusX: 20, radiusY: 5 }], { x: 15, y: 4 }), false);
  assert.equal(D.inShapes([{ type: "ellipse", x: 0, y: 0, radiusX: 20, radiusY: 5 }], { x: 15, y: 1 }), true);
  const tri = { type: "polygon", points: [0, 0, 100, 0, 0, 100] };
  assert.equal(D.inShapes([tri], { x: 20, y: 20 }), true);
  assert.equal(D.inShapes([tri], { x: 80, y: 80 }), false);
  assert.equal(D.inShapes([], { x: 0, y: 0 }), false);
  const b = D.boundsOf([rect(100, 200, 300, 400), { type: "circle", x: 500, y: 300, radius: 50 }, rect(0, 0, 5, 5, true)]);
  assert.deepEqual([b.x, b.y, b.width, b.height, b.cx, b.cy], [100, 200, 450, 400, 325, 400]);
  assert.equal(D.boundsOf([]), null);
});

test("links: out of where you stand, between two places, and who sees across (pure)", () => {
  const links = [{ id: "1", a: "roof", b: "plaza", distance: 300, both: true }, { id: "2", a: "tower", b: "plaza", distance: 600, both: false }, { id: "3", a: "roof", b: "plaza", distance: 250, both: true }];
  assert.deepEqual(D.linksFrom(links, ["roof"]).map((x) => [x.link.id, x.to]), [["1", "plaza"], ["3", "plaza"]]);
  assert.deepEqual(D.linksFrom(links, ["plaza"]).map((x) => [x.link.id, x.to]), [["1", "roof"], ["3", "roof"]], "the one-way link doesn't lead back");
  assert.equal(D.linkBetween(links, ["roof"], ["plaza"]).link.distance, 250, "the shortest of several");
  assert.equal(D.linkBetween(links, ["plaza"], ["tower"]), null);
  assert.equal(D.linkBetween(links, ["tower"], ["plaza"]).link.distance, 600);
  assert.equal(D.linkBetween(links, [], ["plaza"]), null);
  assert.equal(D.seesAcross({ distance: 300, eye: 50, scope: 0 }), false);
  assert.equal(D.seesAcross({ distance: 300, eye: 50, scope: 800 }), true);
  assert.equal(D.seesAcross({ distance: 40, eye: 50 }), true, "near enough for the naked eye");
  assert.equal(D.cleanLink({ a: "x", b: "x", distance: 10 }), null);
  assert.equal(D.cleanLink({ a: "x", b: "y", distance: 0 }), null);
  assert.deepEqual(D.cleanLink({ a: "x", b: "y", distance: "120.4" }), { id: "x:y", a: "x", b: "y", distance: 120, both: true });
});

test("at the table: a token on the roof, a scope, and the distance to the plaza", async () => {
  const scene = {
    grid: { units: "m" },
    regions: [{ id: "roof", name: "Rooftop", shapes: [rect(0, 0, 500, 500)] }, { id: "plaza", name: "Plaza", shapes: [rect(1000, 0, 500, 500)] }],
    flags: { [M]: { [LINKS_FLAG]: [{ id: "L1", a: "roof", b: "plaza", distance: 300, both: true }] } }
  };
  const tok = (id, x, y, flags = {}) => ({ id, center: { x, y }, document: { id, parent: scene, flags: { [M]: flags } } });
  const prev = globalThis.canvas;
  globalThis.canvas = { ...(prev ?? {}), scene };
  try {
    await Settings.set("farLinks", true);
    await Settings.set("sightBase", 50);
    const sniper = tok("s", 100, 100);
    const mark = tok("m", 1200, 100);
    const street = tok("x", 700, 100);
    assert.deepEqual(Far.where(sniper), ["roof"]);
    assert.deepEqual(Far.where(street), []);
    assert.equal(Far.distance(sniper, mark), 300);
    assert.equal(Far.distance(mark, sniper), 300, "both ways");
    assert.equal(Far.distance(sniper, street), null, "nothing links the roof to the street");
    assert.equal(Far.distance(sniper, { x: 1100, y: 400 }), 300, "a point will do: where a grenade lands");
    // What an attack is made at.
    assert.equal(Dv.distance(sniper, mark), 300);
    // The naked eye doesn't see 300 m; a Sniping Scope does, whatever the scene let its range be.
    assert.deepEqual(Far.reach(sniper).map((x) => [x.name, x.distance, x.sees]), [["Plaza", 300, false]]);
    const scoped = tok("s", 100, 100, { scope: { key: "zoom:w", range: 120, scope: { range: 800 } } });
    assert.deepEqual(Far.reach(scoped).map((x) => x.sees), [true]);
    const short = tok("s", 100, 100, { scope: { key: "zoom:w", range: 100, scope: { range: 100 } } });
    assert.deepEqual(Far.reach(short).map((x) => x.sees), [false]);
    assert.deepEqual(Far.entries(null, sniper).map((e) => [e.key, e.label.includes("Plaza") || e.label.includes("Far.Look")]), [["far:L1", true]]);
    // Off: the map is the map.
    await Settings.set("farLinks", false);
    assert.equal(Far.distance(sniper, mark), null);
    assert.deepEqual(Far.reach(scoped), []);
  } finally {
    await Settings.set("farLinks", true);
    globalThis.canvas = prev;
  }
});
