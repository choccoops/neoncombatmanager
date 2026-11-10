/** Neon Arsenal's timing: when rounds leave and land, the clock shared with Automated Animations, and what's placed by it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettings } from "./helpers/foundry.mjs";

await registerSettings();
const { FLIGHT, RANGE_STEPS, rangeStep, flightKey, flightFor, squaresBetween, contactFor, MELEE_CONTACT, SOUND_LEAD } = await import("../scripts/arsenal/timing.js");
const { Sync } = await import("../scripts/arsenal/sync.js");
const { ROWS, buildMenu, soundPlan, lookOf, LABEL_PREFIX: _ } = await import("../scripts/arsenal/profile.js").then((m) => ({ ...m, LABEL_PREFIX: null }));
const { profileKeys, LABEL_PREFIX } = await import("../scripts/arsenal/kinds.js");

/* ---------------------------------------- */
/*  Sequencer, as far as the hits use it    */
/* ---------------------------------------- */

const played = [];
const call = (s, m) => s.calls.find(([n]) => n === m)?.[1];
globalThis.Sequence = class Sequence {
  constructor() {
    this.sections = [];
  }
  effect() {
    const rec = { kind: "effect", calls: [] };
    this.sections.push(rec);
    const proxy = new Proxy({}, { get: (_t, m) => (m === "then" ? undefined : (...args) => (rec.calls.push([m, args]), proxy)) });
    return proxy;
  }
  play() {
    played.push(...this.sections);
  }
};
globalThis.Sequencer = { Database: { getEntry: (p) => /^jb2a\.(impact\.00[14]|explosion\.01)\.(orange|blue|yellow)$/.test(p), getPathsUnder: () => [] } };
game.modules.set("sequencer", { id: "sequencer", active: true });
const { AA } = await import("../scripts/arsenal/aa.js");

/** A clock the test moves. */
function fakeTimers() {
  let now = 1000;
  let n = 0;
  const pending = new Map();
  Sync.timers = { now: () => now, set: (fn, ms) => (pending.set(++n, { fn, at: now + ms }), n), clear: (id) => pending.delete(id) };
  Sync.flows.clear();
  return (ms) => {
    const end = now + ms;
    for (;;) {
      const next = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      pending.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = end;
  };
}

test("which clip plays: Sequencer's steps by distance, and every look has all five", () => {
  assert.deepEqual([0, 1.9, 2, 4.9, 5, 8.9, 9, 14.9, 15, 40].map(rangeStep), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.equal(RANGE_STEPS.length, 5);
  for (const [key, f] of Object.entries(FLIGHT)) {
    assert.equal(f.arrive.length, 5, key);
    for (let i = 0; i < 5; i++) {
      const launch = Array.isArray(f.launch) ? f.launch[i] : f.launch;
      assert.ok(f.arrive[i] >= launch, `${key}: lands after it leaves`);
      if (i) assert.ok(f.arrive[i] >= f.arrive[i - 1], `${key}: farther takes no less time`);
    }
  }
});

test("flight: a bullet across the room against point-blank, an arrow's draw, a thrown grenade's wind-up", () => {
  assert.deepEqual(flightFor({ animation: "bullet", variant: "1" }, 1), { launch: 0, arrive: 70 });
  assert.deepEqual(flightFor({ animation: "bullet", variant: "1" }, 16), { launch: 0, arrive: 730 });
  assert.deepEqual(flightFor({ animation: "lasershot", variant: "01" }, 6), { launch: 0, arrive: 270 });
  assert.equal(flightFor({ animation: "arrow", variant: "regular" }, 6).launch, 330, "nocked and drawn first");
  assert.equal(flightFor({ animation: "arrow", variant: "physical" }, 6).launch, 750);
  assert.deepEqual(flightFor("jb2a.throwable.throw.grenade.01.green", 6), { launch: 2000, arrive: 2570 });
  assert.deepEqual(flightFor("jb2a.throwable.launch.grenade.01.green", 6), { launch: 130, arrive: 1000 });
  assert.equal(flightKey("jb2a.bullet.02.orange"), "bullet2");
  assert.deepEqual(flightFor({ animation: "sword" }, 6), { launch: 0, arrive: 0 }, "not a ranged look");
  assert.equal(squaresBetween({ x: 0, y: 0 }, { x: 300, y: 400 }, 100), 5);
  assert.equal(contactFor({ animation: "greatsword" }), 1600);
});

test("every ranged row's look is timed, and every melee row's swing", () => {
  for (const row of ROWS) {
    for (const patreon of [false, true]) {
      const look = lookOf(row, patreon);
      if (row.menu === "melee") assert.ok(MELEE_CONTACT[look.animation] > 0, `${row.kind}: ${look.animation}`);
      else assert.ok(flightKey(look), `${row.kind}: ${look.animation} ${look.variant}`);
    }
    if (row.menu === "melee") assert.ok(SOUND_LEAD[row.sound] !== undefined, `${row.kind}: ${row.sound}`);
  }
});

test("sounds follow the picture: the shot as the round leaves, the impact as it lands, a blade as it connects", () => {
  const rifle = profileKeys({ kind: "assaultRifle" });
  assert.deepEqual(soundPlan(rifle, { hit: true, times: { launch: 0, arrive: 700 } }), [{ key: "rifle", delay: 0 }, { key: "impactBody", delay: 700 }]);
  assert.deepEqual(soundPlan(rifle, { hit: true }), [{ key: "rifle", delay: 0 }, { key: "impactBody", delay: 370 }], "no distance known: a middling one");
  const bow = profileKeys({ kind: "bow" });
  assert.deepEqual(soundPlan(bow, { patreon: true, times: flightFor({ animation: "arrow", variant: "physical" }, 6) }), [{ key: "bow", delay: 750 }], "the string sounds at the release");
  assert.deepEqual(soundPlan(profileKeys({ kind: "pistol", flavor: "power" }), { ricochet: true, hit: true, times: { launch: 0, ricochet: 150, arrive: 310 } }).map((s) => s.delay), [0, 150, 310]);
  assert.deepEqual(soundPlan(profileKeys({ kind: "pistol", flavor: "smart" }), { hit: true, times: { launch: 380, arrive: 830 } }).map((s) => [s.key, s.delay]), [["smart", 380], ["impactBody", 830]], "after the lock");
  assert.deepEqual(soundPlan(profileKeys({ kind: "heavyBlade" })), [{ key: "blade", delay: 1510 }]);
  assert.deepEqual(soundPlan(profileKeys({ kind: "grenadeLauncher" }), { hit: true, explosive: true, times: { launch: 130, arrive: 1000 } }), [{ key: "launcher", delay: 130 }]);
});

test("the profile: no secondary in a world with the module (it's drawn on arrival), a held-back one in the export", () => {
  const world = buildMenu({ patreon: true, sounds: false, hits: false });
  assert.ok([...world.range, ...world.melee].every((e) => e.secondary.enable === false));
  const exported = buildMenu({ patreon: true, sounds: true });
  const tech = exported.range.find((e) => e.label === `${LABEL_PREFIX}Bow · Tech`);
  assert.equal(tech.secondary.enable, true);
  assert.equal(tech.secondary.options.delay, 270);
  const hammer = exported.melee.find((e) => e.label === `${LABEL_PREFIX}Heavy Blunt · Propulsion`);
  assert.equal(hammer.secondary.options.delay, 1300, "as the hammer lands");
});

test("the shared clock: waits for AA's first frame, goes at once when AA isn't taking the attack", () => {
  const tick = fakeTimers();
  const got = [];
  // AA never takes it up: after the grace.
  Sync.when("t1", (s) => got.push(["none", s]));
  tick(299);
  assert.equal(got.length, 0);
  tick(2);
  assert.deepEqual(got, [["none", false]]);
  // AA takes it up after the card, then starts.
  Sync.when("t1", (s) => got.push(["late", s]));
  tick(100);
  Sync.seen("t1");
  tick(900);
  assert.equal(got.length, 1, "still loading");
  Sync.started("t1");
  assert.deepEqual(got[1], ["late", true]);
  // Right after a start (the card came second): at once.
  Sync.when("t1", (s) => got.push(["now", s]));
  assert.deepEqual(got[2], ["now", true]);
  // Taken up but never started: gives up.
  tick(1000);
  Sync.seen("t2");
  Sync.when("t2", (s) => got.push(["stuck", s]), { limit: 3000 });
  tick(2999);
  assert.equal(got.length, 3);
  tick(2);
  assert.deepEqual(got[3], ["stuck", false]);
  // Stopped (Neon Arsenal draws it): let go at once, and once only.
  Sync.seen("t3");
  Sync.when("t3", (s) => got.push(["dropped", s]));
  Sync.dropped("t3");
  Sync.started("t3");
  assert.deepEqual(got.slice(4), [["dropped", false]]);
});

test("hits are drawn when the round lands: by distance, on AA's first frame, never on a shot shown missing", () => {
  const tick = fakeTimers();
  globalThis.canvas = { ...(globalThis.canvas ?? {}), grid: { size: 100 } };
  const token = { id: "shooter", center: { x: 0, y: 0 } };
  const near = { id: "near", center: { x: 100, y: 0 } };
  const far = { id: "far", center: { x: 1600, y: 0 } };
  const row = ROWS.find((r) => r.kind === "Bow" && r.flavor === "Tech");
  played.length = 0;
  Sync.seen("shooter");
  const plan = AA.planHits({ token, targets: [near, far] }, row, "shooter");
  assert.deepEqual(plan.map((p) => p.delay), [70, 600]);
  assert.equal(played.length, 0, "not before the shot starts");
  Sync.started("shooter");
  assert.equal(played.length, 2);
  assert.deepEqual(played.map((s) => call(s, "delay")[0]), [70, 600]);
  assert.deepEqual(call(played[0], "file")[0], ["jb2a.impact.001.blue", "jb2a.impact.004.blue"]);

  played.length = 0;
  assert.equal(AA.planHits({ token, targets: [far], forceMiss: true }, row, "shooter"), false);
  tick(10);
  Sync.seen("shooter");
  AA.planHits({ token, targets: [far], overrideRepeat: 5 }, ROWS.find((r) => r.kind === "Assault Rifle" && !r.flavor && !r.ammo), "shooter");
  tick(6000);
  assert.equal(played.length, 0, "AA never started: no hit out of nowhere");

  const hammer = ROWS.find((r) => r.kind === "Heavy Blunt" && r.ammo === "Propulsion");
  Sync.seen("shooter");
  AA.planHits({ token, targets: [near] }, hammer, "shooter");
  Sync.started("shooter");
  assert.equal(call(played[0], "delay")[0], 1300);
  Sync.timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id), now: () => Date.now() };
});
