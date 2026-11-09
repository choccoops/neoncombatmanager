/** Neon FX AV landings: the holo zone, the flight in, sounds, and who puts the zone away. */
import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { registerSettings, root, asGM, missingKeys, notes, testUsers } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();

/* ---------------------------------------- */
/*  Sequencer, as far as landings use it    */
/* ---------------------------------------- */

const played = []; // { kind, calls }
let live = []; // persistent effects: { data: { name, source, file, creationTimestamp, sceneId }, sourcePosition }
const sounds = []; // { files, volume, name }
const ended = []; // endSounds names
let crosshair = null;
let jb2aDb = [];

const call = (s, m) => s.calls.find(([n]) => n === m)?.[1];
const calls = (s, m) => s.calls.filter(([n]) => n === m).map(([, a]) => a);
class Sequence {
  constructor(options) {
    this.options = options;
    this.sections = [];
  }
  _section(kind) {
    const rec = { kind, calls: [] };
    this.sections.push(rec);
    const proxy = new Proxy({}, { get: (_, m) => (m === "then" ? undefined : (...args) => (rec.calls.push([m, args]), proxy)) });
    return proxy;
  }
  effect() {
    return this._section("effect");
  }
  sound() {
    return this._section("sound");
  }
  canvasPan() {
    return this._section("canvasPan");
  }
  play() {
    for (const s of this.sections) {
      played.push(s);
      if (s.kind === "effect" && call(s, "persist")) {
        const source = call(s, "atLocation")[0];
        const e = { data: { name: call(s, "name")?.[0], source, file: call(s, "file")?.[0], creationTimestamp: Date.now(), sceneId: canvas.scene.id }, sourcePosition: source };
        live.push(e);
        Hooks.callAll("createSequencerEffect", e);
      }
      if (s.kind === "sound") sounds.push({ files: call(s, "file")[0], volume: call(s, "volume")[0], name: call(s, "name")?.[0] ?? null });
    }
    return new Promise(() => {});
  }
}
globalThis.Sequence = Sequence;
globalThis.Sequencer = {
  Database: {
    getEntry: (p) => jb2aDb.some((e) => e === p || e.startsWith(`${p}.`)),
    getPathsUnder: (p) => [...new Set(jb2aDb.filter((e) => e.startsWith(`${p}.`)).map((e) => e.slice(p.length + 1).split(".")[0]))]
  },
  EffectManager: {
    getEffects: ({ sceneId }) => live.filter((e) => e.data.sceneId === sceneId),
    async endEffects({ name, sceneId }) {
      for (const e of live.filter((x) => x.data.name === name && x.data.sceneId === sceneId)) Hooks.callAll("endedSequencerEffect", e);
      live = live.filter((x) => !(x.data.name === name && x.data.sceneId === sceneId));
    }
  },
  SoundManager: { endSounds: ({ name }) => ended.push(name) },
  Crosshair: { show: async () => crosshair }
};
game.modules.set("sequencer", { id: "sequencer", active: true });
CONST.GRID_SNAPPING_MODES = { CENTER: 1, VERTEX: 2 };

/* ---------------------------------------- */
/*  A canvas with an AV                     */
/* ---------------------------------------- */

const ticker = { fns: new Set(), add(fn) { this.fns.add(fn); }, remove(fn) { this.fns.delete(fn); } };
globalThis.canvas = {
  ready: true,
  scene: { id: "sc1" },
  dimensions: { size: 100, distance: 5 },
  grid: { size: 100 },
  app: { ticker },
  tokens: {
    placeables: [],
    controlled: [],
    get(id) {
      return this.placeables.find((t) => t.id === id);
    }
  }
};

const updates = [];
function makeAV({ x = 0, y = 0, width = 2, height = 2, hidden = false, owner = true } = {}) {
  const pt = (a, b) => ({ x: a, y: b, set(c, d) { this.x = c; this.y = d; } });
  const token = {
    id: `av${canvas.tokens.placeables.length + 1}`,
    name: "AV-4",
    w: width * 100,
    h: height * 100,
    visible: true,
    position: pt(x, y),
    mesh: { position: pt(x + width * 50, y + height * 50), scale: pt(1, 1), rotation: 0, texture: { width: 400, height: 400 } },
    renderFlags: { set() {} }
  };
  token.document = {
    id: token.id,
    object: token,
    parent: canvas.scene,
    isOwner: owner,
    x,
    y,
    width,
    height,
    hidden,
    rotation: 0,
    flags: {},
    texture: { src: "tokens/av.webp", scaleX: 1, scaleY: 1, fit: "contain" },
    async update(data, options = {}) {
      updates.push({ data, options });
      const changes = {};
      for (const [k, v] of Object.entries(data)) {
        foundry.utils.setProperty(changes, k, v);
        foundry.utils.setProperty(this, k, v);
      }
      Hooks.callAll("updateToken", this, changes, options, game.user.id);
    }
  };
  canvas.tokens.placeables.push(token);
  return token;
}

/* ---------------------------------------- */
/*  The module                              */
/* ---------------------------------------- */

const { Landing, zoneSize, parseZone, zoneName, landingSpot } = await import("../scripts/neonfx/landing.js");
const { Flight, planFlight, flightAt, AIR } = await import("../scripts/neonfx/flight.js");
const { Motion } = await import("../scripts/neonfx/motion.js");
const { NeonFX } = await import("../scripts/neonfx/neonfx.js");
const { SOUNDS, Core } = await import("../scripts/neonfx/core.js");
NeonFX.init();

const zoneEffects = () => live.filter((e) => parseZone(e.data.name));

beforeEach(async () => {
  asGM(true);
  played.length = 0;
  live = [];
  sounds.length = 0;
  ended.length = 0;
  updates.length = 0;
  notes.length = 0;
  crosshair = null;
  jb2aDb = [];
  Core.clearCache();
  Flight.clear();
  Motion.clear();
  canvas.tokens.placeables.length = 0;
  canvas.tokens.controlled = [];
  for (const [k, v] of Object.entries({ fxEnabled: true, fxConditions: true, fxVolume: 0.4, fxMotion: true })) await Settings.set(k, v);
});

/* ---------------------------------------- */
/*  Shapes and sums                         */
/* ---------------------------------------- */

test("the grav field is a rectangle along the AV's long side, keeping its odd/even", () => {
  assert.deepEqual(zoneSize(null), { w: 3, h: 5 });
  assert.deepEqual(zoneSize({ width: 1, height: 1 }), { w: 3, h: 5 });
  assert.deepEqual(zoneSize({ width: 2, height: 2 }), { w: 4, h: 6 });
  assert.deepEqual(zoneSize({ width: 2, height: 3 }), { w: 4, h: 7 });
  assert.deepEqual(zoneSize({ width: 3, height: 2 }), { w: 7, h: 4 });
  for (const [tw, th] of [[1, 1], [2, 2], [2, 3], [3, 2], [4, 6]]) {
    const { w, h } = zoneSize({ width: tw, height: th });
    assert.ok(Math.max(w, h) >= Math.min(w, h) * 1.5 - 0.5, `${tw}x${th} is long`);
    assert.equal((w - tw) % 2, 0, `${tw}x${th} width parity`);
    assert.equal((h - th) % 2, 0, `${tw}x${th} height parity`);
  }
  assert.deepEqual(parseZone(zoneName("abc123", 4, 6, true)), { id: "abc123", w: 4, h: 6, pad: true });
  assert.deepEqual(parseZone(zoneName("abc123", 4, 6)), { id: "abc123", w: 4, h: 6, pad: false });
  assert.equal(parseZone("ncm-fx-psycho-tok1"), null);
  assert.deepEqual(landingSpot({ width: 2, height: 2 }, { x: 600, y: 800 }, 100), { x: 500, y: 700 });
});

test("the flight comes in from where the AV was, high, and sets down exactly on the pad", () => {
  const p = planFlight({ from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, gs: 100 });
  assert.ok(p.cruise >= 1200 && p.cruise <= 3200);
  assert.deepEqual(flightAt(p, 0), { x: -1000, y: 0, scale: 1, r: 0, done: false });
  const mid = flightAt(p, p.cruise / 2);
  assert.ok(mid.x > -1000 && mid.x < 0 && mid.scale === AIR);
  const down = flightAt(p, p.cruise + p.descent - 1);
  assert.ok(Math.abs(down.x) < 1 && Math.abs(down.scale - 1) < 0.01);
  assert.deepEqual(flightAt(p, p.total), { x: 0, y: 0, scale: 1, r: 0, done: true });
  // Far is capped; over the pad already, it only sets down; a hidden AV starts high.
  assert.equal(planFlight({ from: { x: 0, y: 0 }, to: { x: 100000, y: 0 }, gs: 100 }).cruise, 3200);
  const over = planFlight({ from: { x: 1000, y: 0 }, to: { x: 1010, y: 0 }, gs: 100 });
  assert.equal(over.cruise, 0);
  assert.equal(flightAt(over, 10).scale > 1, true);
  assert.equal(planFlight({ from: { x: 0, y: 0 }, to: { x: 1000, y: 0 }, gs: 100, airborne: true }).start, AIR);
});

/* ---------------------------------------- */
/*  The zone                                */
/* ---------------------------------------- */

test("a landing zone: shared, saved, one pad, every file it uses ships, and it powers up quietly", async () => {
  const z = await Landing.placeZone({ at: { x: 1050, y: 1050 } });
  assert.deepEqual({ w: z.w, h: z.h }, { w: 3, h: 5 });
  const fx = zoneEffects();
  assert.ok(fx.length >= 9, "field, frame, pad, scan, brackets and four beacons");
  assert.equal(fx.filter((e) => parseZone(e.data.name).pad).length, 1);
  for (const s of played.filter((x) => x.kind === "effect")) {
    assert.ok(call(s, "persist") && call(s, "belowTokens"), "persistent, on the ground");
    assert.ok(!call(s, "locally"), "everyone sees it");
  }
  const src = readFileSync(path.join(root, "scripts", "neonfx", "landing.js"), "utf8");
  for (const [, f] of src.matchAll(/img\("([^"]+)"\)/g)) assert.ok(existsSync(path.join(root, "assets", "fx", "img", f)), f);
  for (const k of ["avZoneOn", "avZoneLoop", "avApproach", "avTouchdown"]) {
    for (const f of SOUNDS[k].files) assert.ok(existsSync(path.join(root, f.replace(`modules/${M}/`, ""))), f);
    assert.ok(SOUNDS[k].level <= 0.6, `${k} is quiet`);
  }
  assert.deepEqual(Landing.zones(), [{ id: z.id, w: 3, h: 5, x: 1050, y: 1050 }]);
  assert.equal(sounds.length, 2, "power-up and the warning beeps, once");
  assert.ok(sounds.every((s) => s.volume <= 0.4 * 0.6));
  assert.ok(sounds[1].name.endsWith("-beep"));
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

test("a zone sized to the selected AV, turned when it's wider than tall, picked square on the grid", async () => {
  const av = makeAV({ width: 3, height: 2 });
  canvas.tokens.controlled = [av];
  crosshair = { x: 1033, y: 1061 };
  const z = await Landing.placeZone();
  assert.deepEqual({ w: z.w, h: z.h }, { w: 7, h: 4 });
  assert.deepEqual({ x: z.x, y: z.y }, { x: 1050, y: 1100 }, "odd side on a square's middle, even side on a grid line");
  const pad = played.find((s) => parseZone(call(s, "name")?.[0])?.pad);
  assert.deepEqual(call(pad, "rotate"), [90]);
  assert.deepEqual(call(pad, "size")[0], { width: 4, height: 7 });
});

test("a zone Sequencer brings back with the scene is silent; one ending stops its beeps", async () => {
  const z = await Landing.placeZone({ at: { x: 500, y: 500 } });
  sounds.length = 0;
  const pad = live.find((e) => parseZone(e.data.name)?.pad);
  Hooks.callAll("createSequencerEffect", { data: { ...pad.data, creationTimestamp: Date.now() - 60000 } });
  assert.equal(sounds.length, 0);
  await Landing.endZone(z.id);
  assert.equal(zoneEffects().length, 0);
  assert.ok(ended.some((n) => n.endsWith("-beep")));
});

test("cancelling the pick on a scene with zones offers to take them away", async () => {
  await Landing.placeZone({ at: { x: 500, y: 500 } });
  await Landing.placeZone({ at: { x: 1500, y: 500 } });
  crosshair = false;
  assert.equal(await Landing.placeZone(), null);
  assert.equal(Landing.zones().length, 0);
});

/* ---------------------------------------- */
/*  The landing                             */
/* ---------------------------------------- */

test("landing: one update onto the pad, the art flies in and gives everything back exactly", async () => {
  const z = await Landing.placeZone({ at: { x: 1000, y: 1000 }, size: { w: 4, h: 6 } });
  const av = makeAV({ x: 0, y: 0 });
  canvas.tokens.controlled = [av];
  sounds.length = 0;
  const landing = await Landing.land();
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0].options, { animate: false });
  assert.equal(av.document.x, 900);
  assert.equal(av.document.y, 900);
  assert.equal(landing.zone, z.id);
  assert.equal(av.document.flags[M].fx.landing.id, landing.id);

  // Foundry puts the art on the pad; the flight draws it back where it was, big, and brings it in.
  av.position.set(900, 900);
  av.mesh.position.set(1000, 1000);
  assert.ok(Flight.isFlying(av.id));
  const s = Flight.active.get(av.id);
  Flight.tick(s.t0 + 1);
  assert.ok(Math.abs(av.mesh.position.x - 100) < 2 && Math.abs(av.position.x) < 2, "starts where it was");
  Flight.tick(s.t0 + s.plan.cruise + 200);
  assert.ok(av.mesh.scale.x > 1.3, "high over the pad");
  Flight.tick(s.t0 + s.plan.total + 1);
  assert.equal(Flight.isFlying(av.id), false);
  assert.deepEqual([av.mesh.position.x, av.mesh.position.y, av.mesh.rotation, av.mesh.scale.x, av.position.x], [1000, 1000, 0, 1, 900]);

  // Sounds and looks here: engines, a shadow coming in under it, dust.
  assert.ok(sounds.some((x) => x.files.some((f) => f.includes("av-approach"))));
  const shadow = played.find((x) => call(x, "copySprite")?.[0] === av);
  assert.ok(shadow && calls(shadow, "animateProperty").some(([t, p]) => t === "spriteContainer" && p === "position.x"));
  assert.ok(!call(shadow, "persist"));
});

test("Foundry moving the token mid-flight becomes the new base; motion waits for the flight", async () => {
  const av = makeAV({ x: 0, y: 0, width: 1, height: 1 });
  Motion.set(av, "sway");
  const plan = planFlight({ from: { x: -950, y: 50 }, to: { x: 50, y: 50 }, gs: 100 });
  Flight.start(av, plan);
  const t0 = Flight.active.get(av.id).t0;
  Flight.tick(t0 + 100);
  Motion.tick(t0 + 100);
  const flying = av.mesh.position.x;
  Motion.tick(t0 + 120);
  assert.equal(av.mesh.position.x, flying, "motion leaves the art to the flight");
  av.mesh.position.set(250, 50); // Foundry places it
  Flight.tick(t0 + plan.total + 1);
  assert.equal(av.mesh.position.x, 250);
  Motion.set(av, null);
});

test("a hidden AV comes in from off the map and is revealed (GM)", async () => {
  await Landing.placeZone({ at: { x: 1000, y: 1000 } });
  const av = makeAV({ x: 4000, y: 4000, hidden: true });
  canvas.tokens.controlled = [av];
  const landing = await Landing.land();
  assert.equal(av.document.hidden, false);
  assert.equal(landing.airborne, true);
  assert.ok(landing.fy < 1000, "from the sky above the pad, not from where it was parked");
});

test("the writer puts the zone away after touchdown; keepZone leaves it; other clients don't", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const z = await Landing.placeZone({ at: { x: 1000, y: 1000 } });
    const av = makeAV();
    canvas.tokens.controlled = [av];
    await Landing.land(null, { keepZone: true });
    mock.timers.tick(10000);
    await Promise.resolve();
    assert.equal(Landing.zones().length, 1, "kept");

    // A player's client, a GM about: not theirs to tidy.
    asGM(false);
    Landing.onUpdate(av.document, { flags: { [M]: { fx: { landing: { id: "x1", fx: 0, fy: 0, zone: z.id } } } } }, testUsers.player.id);
    mock.timers.tick(10000);
    await Promise.resolve();
    assert.equal(Landing.zones().length, 1);

    // The GM's client tidies it.
    asGM(true);
    Landing.onUpdate(av.document, { flags: { [M]: { fx: { landing: { id: "x2", fx: 0, fy: 0, zone: z.id } } } } }, testUsers.player.id);
    mock.timers.tick(10000);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    assert.equal(Landing.zones().length, 0);
    assert.ok(sounds.some((x) => x.files.some((f) => f.includes("av-touchdown"))));
  } finally {
    mock.timers.reset();
  }
});

test("no pad, no zone: you pick a spot; nothing selected or not yours: a warning", async () => {
  const av = makeAV();
  canvas.tokens.controlled = [av];
  crosshair = { x: 777, y: 777 };
  const landing = await Landing.land();
  assert.equal(landing.zone, null);
  assert.deepEqual([av.document.x, av.document.y], [700, 700]);

  canvas.tokens.controlled = [];
  assert.equal(await Landing.land(), null);
  canvas.tokens.controlled = [makeAV({ owner: false })];
  assert.equal(await Landing.land(), null);
  assert.equal(notes.filter(([k]) => k === "warn").length, 2);
});

test("FX off: the AV still lands, nothing is drawn or heard", async () => {
  await Settings.set("fxEnabled", false);
  const av = makeAV();
  canvas.tokens.controlled = [av];
  crosshair = { x: 500, y: 500 };
  await Landing.land();
  assert.equal(updates.length, 1);
  assert.equal(Flight.isFlying(av.id), false);
  assert.equal(sounds.length, 0);
});

/* ---------------------------------------- */
/*  Macros                                  */
/* ---------------------------------------- */

test("the AV macros join a world that already had the Neon FX folder, once", async () => {
  await Settings.set("fxMacrosInstalled", true);
  await Settings.set("fxMacrosKnown", []);
  assert.deepEqual(NeonFX._newMacros(), ["LandingZone", "Land"]);
  const macros = [];
  const folder = { id: "f1", type: "Macro", name: "Neon FX" };
  globalThis.Folder = { create: async () => folder };
  globalThis.Macro = { createDocuments: async (list) => list.map((d) => (macros.push({ ...d, folder }), macros.at(-1))) };
  game.folders = { find: (fn) => [folder].find(fn) };
  game.macros = { find: (fn) => macros.find(fn) };
  await NeonFX.installMacros({ quiet: true, keys: NeonFX._newMacros() });
  assert.deepEqual(macros.map((m) => m.name), ["AV Landing Zone", "AV Landing"]);
  assert.ok(macros.every((m) => m.command.includes(".fx.") && existsSync(path.join(root, m.img.replace(`modules/${M}/`, "")))));
  assert.deepEqual(NeonFX._newMacros(), [], "a deleted macro isn't brought back");
});
