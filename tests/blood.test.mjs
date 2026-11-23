/** Blood on the map: who bleeds, what each wound leaves, trails, what a mark looks like, who sees it, and the GM's hand. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, registerSettings } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const D = await import("../scripts/blood/blood-data.js");
const { Blood, BLOOD_FLAG } = await import("../scripts/blood/blood.js");
const { Conditions } = await import("../scripts/conditions/engine.js");

test("what bleeds and what it leaves (pure)", () => {
  assert.deepEqual(D.TIERS, ["faint", "trail", "drag", "splat", "pool"]);
  // A condition arriving.
  assert.equal(D.tierForCondition({ id: "seriouslyWounded", category: "wound" }), "splat");
  assert.equal(D.tierForCondition({ id: "mortallyWounded", category: "wound" }), "pool");
  assert.equal(D.tierForCondition({ id: "dead", category: "wound" }), "pool");
  assert.equal(D.tierForCondition({ id: "brokenRibs", category: "critical" }), "splat", "a Critical Injury");
  assert.equal(D.tierForCondition({ id: "lightlyWounded", category: "wound" }), null);
  assert.equal(D.tierForCondition({ id: "prone", category: "combat" }), null);
  // Moving.
  assert.equal(D.trailTier("lightlyWounded"), "faint");
  assert.equal(D.trailTier("seriouslyWounded"), "trail");
  assert.equal(D.trailTier("mortallyWounded"), "drag", "it isn't walking: it's being dragged");
  assert.equal(D.trailTier("dead"), "drag");
  assert.equal(D.trailTier("notWounded"), null);
  // Flesh bleeds; a Full Body Conversion and a truck don't.
  assert.equal(D.bleedsAtAll({ meat: true }), true);
  assert.equal(D.bleedsAtAll({ meat: true, borg: true }), false);
  assert.equal(D.bleedsAtAll({ meat: false }), false);
  // Who sees what: the faint takes UV, or being the GM.
  assert.equal(D.seesMark({ t: "faint" }), false);
  assert.equal(D.seesMark({ t: "faint" }, { uv: true }), true);
  assert.equal(D.seesMark({ t: "faint" }, { gm: true }), true);
  assert.equal(D.seesMark({ t: "trail" }), true);
});

test("a trail's drops fall along the move, about one a square; a mark looks the same on every screen", () => {
  const drops = D.dropsAlong({ x: 0, y: 0 }, { x: 500, y: 0 }, 100, { seed: 7 });
  assert.equal(drops.length, 5);
  assert.ok(drops.every((p, i) => Math.abs(p.x - (i + 1) * 100) <= 1 && Math.abs(p.y) <= 16), "along the line, a little off it");
  assert.deepEqual(D.dropsAlong({ x: 0, y: 0 }, { x: 60, y: 0 }, 100), [], "less than a square: nothing");
  assert.deepEqual(D.dropsAlong({ x: 0, y: 0 }, { x: 9000, y: 0 }, 100, { max: 12 }), [], "a jump across the map isn't a trail");
  assert.deepEqual(D.dropsAlong({ x: 0, y: 0 }, { x: 500, y: 0 }, 100, { seed: 7 }), drops, "the same seed, the same drops");
  // Shapes: from the seed alone.
  const pool = { x: 0, y: 0, t: "pool", s: 42 };
  assert.deepEqual(D.shapeOf(pool, 100), D.shapeOf({ ...pool }, 100));
  assert.notDeepEqual(D.shapeOf(pool, 100), D.shapeOf({ ...pool, s: 43 }, 100));
  const widest = (t) => Math.max(...D.shapeOf({ t, s: 5 }, 100).map((b) => Math.hypot(b.dx, b.dy) + b.r));
  assert.ok(widest("pool") > widest("trail") && widest("trail") > widest("faint"), "a pool is bigger than a trail's drops, those than a speck");
  assert.ok(D.shapeOf({ t: "splat", s: 5 }, 100).length > D.shapeOf({ t: "trail", s: 5 }, 100).length, "a spatter throws drops out");
  // Keeping and wiping.
  const many = Array.from({ length: 10 }, (_, i) => ({ x: i * 100, y: 0, t: "trail", s: i + 1 }));
  assert.deepEqual(D.trimMarks(many, 4).map((m) => m.x), [600, 700, 800, 900], "the newest stay");
  assert.deepEqual(D.clearNear(many, { x: 0, y: 0 }, 250).map((m) => m.x), [300, 400, 500, 600, 700, 800, 900]);
  assert.deepEqual(D.clearNear(many, null), [], "no point: all of it");
});

test("at the table: a spatter under a Critical Injury, a pool under the Mortally Wounded, trails behind the wounded, none from a borg; the GM wipes it", async () => {
  await Settings.set("bloodFx", true);
  await Settings.set("bloodTrails", true);
  await Settings.set("bloodMax", 600);
  const flags = {};
  const scene = { id: "sc", flags: { [M]: flags }, grid: { size: 100 }, tokens: [], async setFlag(scope, key, value) { flags[key] = value; } };
  const saved = { canvas: globalThis.canvas, gm: game.user.isGM };
  game.user.isGM = true;
  const actor = makeActor({ name: "Ganger", hasPlayerOwner: false });
  const borgActor = makeActor({ name: "Borg", hasPlayerOwner: false });
  borgActor.flags["cpr-neon-full-borg"] = { fbc: { body: { id: "b", name: "Gemini" } } };
  const tok = (a, id, x) => ({ id, actor: a, center: { x: x + 50, y: 50 } });
  const doc = (a, id, x) => ({ id, actor: a, x, y: 0, width: 1, height: 1, parent: scene });
  globalThis.canvas = { ready: true, scene, grid: { size: 100 }, tokens: { placeables: [tok(actor, "t1", 0), tok(borgActor, "t2", 1000)], controlled: [] } };
  const wait = () => new Promise((r) => setTimeout(r, 320));
  const tiers = () => Blood.marks(scene).map((m) => m.t);

  // A Critical Injury, then Mortally Wounded.
  Blood.onCondition(actor, { id: "brokenRibs", category: "critical" });
  Blood.onCondition(actor, { id: "mortallyWounded", category: "wound" });
  Blood.onCondition(borgActor, { id: "mortallyWounded", category: "wound" });
  Blood.onCondition(actor, { id: "prone", category: "combat" });
  await wait();
  assert.deepEqual(tiers(), ["splat", "pool"], "under the one who bleeds; nothing under the borg, nothing for Prone");
  assert.deepEqual([Blood.marks(scene)[0].x, Blood.marks(scene)[0].y], [50, 50]);

  // Moving while wounded.
  const d1 = doc(actor, "t1", 0);
  Blood.pos.set("t1", Blood.centre(d1));
  await actor.update({ "system.derivedStats.hp.value": 30, "system.derivedStats.currentWoundState": "lightlyWounded" });
  d1.x = 400;
  Blood.onMove(d1, { x: 400 });
  await wait();
  assert.deepEqual(tiers().slice(2), ["faint", "faint", "faint", "faint"], "Lightly Wounded: faint drops, about one a square");
  await actor.update({ "system.derivedStats.hp.value": 10, "system.derivedStats.currentWoundState": "seriouslyWounded" });
  d1.x = 700;
  Blood.onMove(d1, { x: 700 });
  await wait();
  assert.deepEqual(tiers().slice(6), ["trail", "trail", "trail"], "Seriously Wounded: a trail");
  await actor.update({ "system.derivedStats.hp.value": 0, "system.derivedStats.currentWoundState": "mortallyWounded" });
  d1.x = 900;
  Blood.onMove(d1, { x: 900 });
  await wait();
  assert.deepEqual(tiers().slice(9), ["drag", "drag", "drag", "drag"], "a body moved: a smear, thicker");
  // A borg moving, an unhurt person moving: nothing.
  const before = tiers().length;
  const d2 = doc(borgActor, "t2", 1000);
  Blood.pos.set("t2", Blood.centre(d2));
  d2.x = 1500;
  Blood.onMove(d2, { x: 1500 });
  await wait();
  assert.equal(tiers().length, before);
  // Trails off in the settings.
  await Settings.set("bloodTrails", false);
  d1.x = 1300;
  Blood.onMove(d1, { x: 1300 });
  await wait();
  assert.equal(tiers().length, before);
  await Settings.set("bloodTrails", true);

  // The GM's hand: add by hand, wipe near a point, wipe it all.
  Blood.add([{ x: 5000, y: 5000, t: "pool" }, { x: 5050, y: 5000, t: "nonsense" }]);
  await wait();
  assert.deepEqual(tiers().slice(-2), ["pool", "trail"], "an unknown tier is a trail");
  assert.equal(await Blood.clear({ near: [{ x: 5000, y: 5000 }] }), 2);
  assert.equal(tiers().length, before);
  assert.equal(await Blood.clear({ near: [] }), 0, "nothing selected: nothing wiped");
  assert.ok((await Blood.clear()) > 0);
  assert.deepEqual(Blood.marks(scene), []);
  // The oldest go past the cap.
  await Settings.set("bloodMax", 100);
  Blood.add(Array.from({ length: 130 }, (_, i) => ({ x: i, y: 0, t: "trail" })));
  await wait();
  assert.equal(Blood.marks(scene).length, 100);
  assert.equal(Blood.marks(scene)[0].x, 30);
  await Settings.set("bloodMax", 600);
  // Switched off: nothing is left.
  await Blood.clear();
  await Settings.set("bloodFx", false);
  Blood.onCondition(actor, { id: "dead", category: "wound" });
  await wait();
  assert.deepEqual(Blood.marks(scene), []);
  await Settings.set("bloodFx", true);
  assert.equal(BLOOD_FLAG, "blood");
  assert.ok(Conditions);
  globalThis.canvas = saved.canvas;
  game.user.isGM = saved.gm;
});
