/** Quickhacking (the flow, its rules and its animations) and chrome that runs (Sandevistan, Berserk, their Operating Systems). */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeActor, makeCombat, registerSettings, settle, root, asGM, missingKeys, notes, chat, dice, testUsers } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const HOME = "cpr-neon-at-home";
const Settings = await registerSettings();

/* ---------------------------------------- */
/*  Sequencer and a canvas                  */
/* ---------------------------------------- */

const played = [];
const live = [];
const sounds = [];
let jb2aDb = [];
const call = (s, m) => s.calls.find(([n]) => n === m)?.[1];
class Sequence {
  constructor() {
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
  play() {
    for (const s of this.sections) {
      played.push(s);
      if (s.kind === "effect" && call(s, "persist")) live.push({ name: call(s, "name")?.[0], users: call(s, "forUsers")?.[0] ?? null });
      if (s.kind === "sound") sounds.push(call(s, "file")[0]);
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
    getEffects: () => live.map((e) => ({ data: { name: e.name } })),
    endEffects({ name }) {
      for (let i = live.length - 1; i >= 0; i--) if (live[i].name === name) live.splice(i, 1);
    }
  },
  SoundManager: { endSounds() {} }
};
game.modules.set("sequencer", { id: "sequencer", active: true });

globalThis.canvas = {
  ready: true,
  scene: { id: "scene1" },
  grid: { size: 100 },
  app: { ticker: { add() {}, remove() {} } },
  tokens: {
    placeables: [],
    controlled: [],
    get(id) {
      return this.placeables.find((t) => t.id === id);
    }
  }
};

let tokenCount = 0;
function makeToken(actor, { x = 0, y = 0 } = {}) {
  const id = `tok${++tokenCount}`;
  const token = { id, name: actor.name, actor, w: 100, h: 100, visible: true, center: { x: x + 50, y: y + 50 }, position: { x, y }, mesh: { position: { x, y, set() {} }, rotation: 0, texture: { width: 400, height: 400 } }, renderFlags: { set() {} } };
  token.document = {
    id, object: token, isOwner: true, width: 1, height: 1, flags: {}, texture: { src: "t.webp", scaleX: 1, scaleY: 1, fit: "contain" },
    async update(data, options = {}, userId = game.user.id) {
      const changes = {};
      for (const [k, v] of Object.entries(data)) {
        foundry.utils.setProperty(changes, k, v);
        const parts = k.split(".");
        const last = parts.at(-1);
        if (last.startsWith("-=")) {
          const parent = foundry.utils.getProperty(this, parts.slice(0, -1).join("."));
          if (parent) delete parent[last.slice(2)];
        } else foundry.utils.setProperty(this, k, v);
      }
      Hooks.callAll("updateToken", this, changes, options, userId);
    },
    setFlag(scope, key, value) {
      return this.update({ [`flags.${scope}.${key}`]: value });
    },
    unsetFlag(scope, key) {
      const parts = key.split(".");
      return this.update({ [`flags.${scope}.${[...parts.slice(0, -1), `-=${parts.at(-1)}`].join(".")}`]: null });
    }
  };
  actor.getActiveTokens = () => [token];
  canvas.tokens.placeables.push(token);
  return token;
}

/* ---------------------------------------- */
/*  The module                              */
/* ---------------------------------------- */

const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { BY_ID } = await import("../scripts/conditions/data.js");
const { NeonFX } = await import("../scripts/neonfx/neonfx.js");
const { Core, SOUNDS } = await import("../scripts/neonfx/core.js");
const Rules = await import("../scripts/hack/rules.js");
const Plan = await import("../scripts/hack/fx-plan.js");
const Timing = await import("../scripts/hack/fx-timing.js");
const { HackFx, JB, soundFor, hueTurn, linkName } = await import("../scripts/hack/fx.js");
const { Hack } = await import("../scripts/hack/hack.js");
const { catalog } = await import("../scripts/hud/catalog.js");
const { chromeKind, chromeState, conditionFor, withoutGiven, chromeConditions, tintOf, Chrome, OS } = await import("../scripts/neonfx/chrome.js");

Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Registry.refresh();
NeonFX.init();
Hack.init();
Hack.wait = async () => {};

const FREE = [
  "jb2a.energy_strands.range.standard.purple.01", "jb2a.energy_beam.normal.bluepink.02", "jb2a.shield.01.intro.blue", "jb2a.shield.01.outro_explode.blue",
  "jb2a.static_electricity.03.blue", "jb2a.impact.004.blue", "jb2a.extras.tmfx.outpulse.circle.01.normal", "jb2a.extras.tmfx.radar.circle.pulse.01.normal",
  "jb2a.shimmer.01.blue", "jb2a.flames.01.orange"
];

const qh = (name, type, dv, cooldown, quiet, needs = "") => ({ _id: `qh${Rules.hackKey(name)}`, name, type: "program", flags: { [HOME]: { quickhack: { type, dv, cooldown, quiet, needs } } } });
const HACKS = [qh("Short Circuit", "Control", 8, 6, true), qh("Overheat", "Combat", 8, 6, false), qh("Synapse Burnout", "Combat", 10, 10, false), qh("Scannerz", "Intel", 6, 3, true), qh("Total System Kill", "Ultimate", 16, "single use", false)];

/** A Netrunner (Interface `rank`) running a deck with the quickhacks slotted, and their token. */
function netrunner(rank = 6, name = "Lattice") {
  const actor = makeActor({ name, system: { roleInfo: { activeNetRole: "roleNet" } } }, [
    { _id: "roleNet", name: "Netrunner", type: "role", system: { rank, mainRoleAbility: "Interface" } },
    { _id: "deck1", name: "Cyberdeck", type: "cyberdeck", system: { equipped: "equipped", installedItems: { list: HACKS.map((h) => h._id) } } },
    ...HACKS
  ]);
  return { actor, token: makeToken(actor) };
}
/** A target with WILL 5 and `ice` Self-ICE, and their token `squares` away. */
function mark(name = "Guard", { ice = 0, defender = false, squares = 3 } = {}) {
  const items = Array.from({ length: ice }, (_, i) => ({ name: "Self-ICE", type: "cyberware", system: { isInstalled: true }, _id: `ice${i}${name}` }));
  if (defender) items.push({ name: "Self-ICE: Defender", type: "cyberware", system: { isInstalled: true } });
  const actor = makeActor({ name, type: "mook" }, items);
  return { actor, token: makeToken(actor, { x: squares * 100 }) };
}
const aim = (token) => {
  game.user.targets = new Set([token]);
};
const beats = () => played.filter((s) => s.kind === "effect" && !call(s, "persist"));
const files = () => beats().map((s) => String(call(s, "file")?.[0]));
const lastCard = () => chat.at(-1);

beforeEach(async () => {
  asGM(true);
  played.length = 0;
  live.length = 0;
  sounds.length = 0;
  notes.length = 0;
  chat.length = 0;
  dice.length = 0;
  jb2aDb = [...FREE];
  Core.clearCache();
  game.combat = null;
  game.time.worldTime = 0;
  game.user.targets = new Set();
  canvas.tokens.placeables.length = 0;
  for (const [k, v] of Object.entries({ fxEnabled: true, fxConditions: true, fxVolume: 0.4, hackFlow: true, hackFx: true, hackGhostFx: "owners", fxChrome: true, conditionChat: "off" })) await Settings.set(k, v);
});

/* ---------------------------------------- */
/*  Rules (pure)                            */
/* ---------------------------------------- */

test("a Check has to beat what it's against: Jack In gets you in either way, and a loss tells them", () => {
  assert.deepEqual(Rules.jackIn({ attack: 12, defense: 11 }), { won: true, aware: false, ghosted: false });
  assert.deepEqual(Rules.jackIn({ attack: 11, defense: 11 }), { won: false, aware: true, ghosted: false });
  assert.deepEqual(Rules.jackIn({ attack: 12, defense: 11, ghost: true }), { won: true, aware: false, ghosted: true });
  assert.deepEqual(Rules.jackIn({ attack: 9, defense: 11, ghost: true }), { won: false, aware: true, ghosted: false });
});

test("the firewall, Passwalls and NET Actions follow Interface and Self-ICE", () => {
  assert.equal(Rules.firewallDv(2), 6);
  assert.equal(Rules.firewallDv(3), null);
  assert.deepEqual([0, 1, 2, 3, 4].map(Rules.breachDv), [null, 6, 8, 10, 10]);
  assert.deepEqual([1, 3, 4, 6, 7, 9, 10].map(Rules.netActions), [2, 2, 3, 3, 4, 4, 5]);
  const items = [{ name: "Self-ICE", type: "cyberware", installed: true }, { name: "Self-ICE", type: "cyberware", installed: true }, { name: "Self-ICE: Defender", type: "cyberware", installed: true }, { name: "Self-ICE", type: "cyberware", installed: false }];
  assert.equal(Rules.passwalls(items), 2);
  assert.equal(Rules.hasDefender(items), true);
  assert.equal(Rules.soaked(9, true), 5);
  assert.equal(Rules.soaked(3, true), 0);
  assert.deepEqual(Rules.breach({ total: 8, dv: 8 }), { down: false });
});

test("a quickhack that lands tells the target, unless it's Quiet and the Netrunner is Ghosted", () => {
  assert.deepEqual(Rules.quickhack({ total: 8, dv: 8 }), { hit: false, aware: false, ghostBroken: false, noticeRoll: false });
  assert.deepEqual(Rules.quickhack({ total: 9, dv: 8 }), { hit: true, aware: true, ghostBroken: false, noticeRoll: false });
  assert.deepEqual(Rules.quickhack({ total: 9, dv: 8, quiet: true, ghosted: true }), { hit: true, aware: false, ghostBroken: false, noticeRoll: false });
  assert.deepEqual(Rules.quickhack({ total: 9, dv: 8, quiet: true, ghosted: true, targetNetrunner: true }), { hit: true, aware: false, ghostBroken: false, noticeRoll: true });
  assert.deepEqual(Rules.quickhack({ total: 9, dv: 8, quiet: false, ghosted: true }), { hit: true, aware: true, ghostBroken: true, noticeRoll: false });
  assert.deepEqual(Rules.quickhack({ total: 5, dv: 8, quiet: false, ghosted: true }).ghostBroken, false, "a miss changes nothing");
  assert.equal(Rules.ghostHolds({ runner: 10, target: 10 }), true);
  assert.equal(Rules.ghostHolds({ runner: 10, target: 11 }), false);
  assert.deepEqual(Rules.eject({ target: 15, runner: 15 }), { ejected: false });
});

test("Cooldowns run in Rounds in a fight and in time outside it; a single-use chip burns out", () => {
  const cd = Rules.startCooldown(6, { combat: "c1", round: 2, time: 100, roundSeconds: 3 });
  assert.equal(Rules.cooldownLeft(cd, { combat: "c1", round: 5, time: 109 }), 3);
  assert.equal(Rules.cooldownLeft(cd, { combat: "c1", round: 8, time: 118 }), 0);
  assert.equal(Rules.cooldownLeft(cd, { combat: null, time: 110 }), 8);
  assert.equal(Rules.cooldownLeft(cd, { combat: null, time: 118 }), 0);
  assert.equal(Rules.cooldownLeft(Rules.startCooldown("1 hour", { time: 0 }), { time: 3599 }), 1);
  assert.equal(Rules.cooldownLeft(Rules.startCooldown("single use", {}), { time: 1e9 }), Infinity);
  assert.equal(Rules.hackedThisTurn({ at: { combat: "c1", round: 2, turn: 1 } }, { combat: "c1", round: 2, turn: 1 }), true);
  assert.equal(Rules.hackedThisTurn({ at: { combat: "c1", round: 2, turn: 1 } }, { combat: "c1", round: 3, turn: 1 }), false);
  assert.equal(Rules.hackedThisTurn({ at: null }, { combat: null }), false);
});

test("every quickhack condition the flow places exists, and Neon At Home's Programs read as quickhacks", () => {
  for (const [key, id] of Object.entries(Rules.HACK_CONDITIONS)) assert.ok(BY_ID[id], `${key} -> ${id}`);
  const q = Rules.quickhackOf({ id: "x", name: "Q-KRASH", type: "program", flags: { [HOME]: { quickhack: { type: "Combat", dv: 12, cooldown: 15, quiet: false, needs: "Netrunner's deck" } } } });
  assert.deepEqual([q.key, q.family, q.dv, q.condition, q.damage], ["qkrash", "combat", 12, "qhQKrash", null]);
  assert.equal(Rules.quickhackOf({ name: "Sword", type: "program", flags: {} }), null);
  assert.equal(Rules.quickhackOf(HACKS[2]).damage, "3d6");
});

/* ---------------------------------------- */
/*  The looks (pure)                        */
/* ---------------------------------------- */

test("the pulse's timing follows the clip Sequencer picks for the distance", () => {
  assert.deepEqual(Timing.strandFor(1), { launch: 170, arrive: 430, gone: 800 });
  assert.deepEqual(Timing.strandFor(6), { launch: 70, arrive: 500, gone: 800 });
  assert.deepEqual(Timing.strandFor(20), { launch: 100, arrive: 1270, gone: 1900 });
  for (const k of ["launch", "arrive", "gone"]) assert.equal(Timing.STRAND[k].length, 5);
  assert.ok(Timing.STRAND.arrive.every((a, i) => a > Timing.STRAND.launch[i] && a < Timing.STRAND.gone[i]));
  assert.equal(Timing.tracerFor(0).arrive, 250);
  assert.equal(Plan.arrival(6, true), 500);
  assert.equal(Plan.arrival(6, false), 250);
});

test("who sees a Ghost Hack: the GM and the Netrunner's players, everyone, or no one", () => {
  assert.equal(Plan.audience({ ghost: false, setting: "off" }), "all");
  assert.equal(Plan.audience({ ghost: true, setting: "owners" }), "owners");
  assert.equal(Plan.audience({ ghost: true, setting: "all" }), "all");
  assert.equal(Plan.audience({ ghost: true, setting: "off" }), "none");
  assert.equal(Plan.sees("owners", { isGM: true }), true);
  assert.equal(Plan.sees("owners", { ownsRunner: true }), true);
  assert.equal(Plan.sees("owners", {}), false);
  assert.equal(Plan.sees("all", {}), true);
  assert.equal(Plan.sees("none", { isGM: true }), false);
});

test("Jack In: the pulse, then the ring as it arrives; losing adds the alert and the trace back", () => {
  const won = Plan.jackIn({ squares: 6 });
  assert.deepEqual(won.map((s) => [s.kind, s.at]), [["strand", 0], ["sound", 70], ["port", 500]]);
  const lost = Plan.jackIn({ squares: 6, aware: true });
  assert.deepEqual(lost.filter((s) => s.at >= 750).map((s) => s.kind), ["alert", "sound", "beam", "spark"]);
  assert.deepEqual(lost.find((s) => s.kind === "beam"), { at: 950, kind: "beam", from: "target", to: "runner", colour: "red", life: 900 });
  const ghost = Plan.jackIn({ squares: 6, ghosted: true });
  assert.ok(ghost.every((s) => s.kind !== "port") && ghost[0].dim && ghost.find((s) => s.kind === "sound").key === "ghost");
});

test("Self-ICE: a Passwall that holds flares up as the pulse arrives and throws it back; one that goes down shatters", () => {
  const held = Plan.breach({ squares: 6, down: false });
  const shield = held.find((s) => s.kind === "shield");
  assert.deepEqual([shield.result, shield.at], ["hold", 500 - Timing.SHIELD_INTRO.up]);
  assert.ok(held.some((s) => s.kind === "strand" && s.from === "target" && s.at === 600));
  assert.equal(held.find((s) => s.kind === "sound").key, "iceBlock");
  const down = Plan.breach({ squares: 6, down: true });
  assert.deepEqual([down.find((s) => s.kind === "shield").result, down.find((s) => s.kind === "shield").at], ["shatter", 500]);
  assert.deepEqual(down.find((s) => s.kind === "sound"), { at: 500 + Timing.SHIELD_EXPLODE.burst - Timing.SHIELD_EXPLODE.skip, kind: "sound", key: "iceBreak" });
});

test("each family of quickhack lands its own way, some quickhacks their own; a miss fizzles; a Ghost's is a small glitch", () => {
  const looks = Object.fromEntries(["intel", "covert", "control", "combat", "ultimate"].map((f) => [f, Plan.lookFor(f).look]));
  assert.equal(new Set(Object.values(looks)).size, 5);
  assert.equal(Plan.lookFor("combat", "overheat").look, "fire");
  assert.equal(Plan.lookFor("ultimate", "systemreset").look, "shutdown");
  for (const key of Object.keys(Plan.HACK_LOOKS)) assert.ok(/^[a-z0-9]+$/.test(key));
  const hit = Plan.upload({ squares: 6, hit: true, family: "combat", key: "synapseburnout" });
  assert.deepEqual(hit.find((s) => s.kind === "burst"), { at: 500, kind: "burst", on: "target", look: "static", colour: "red", dim: false });
  assert.deepEqual(hit.filter((s) => s.kind === "sound").map((s) => s.key), ["upload", "zap"]);
  // A condition's own burst and sound play as it's placed: the upload doesn't double them.
  assert.deepEqual(Plan.upload({ squares: 6, hit: true, family: "control", key: "shortcircuit", condition: true }).filter((s) => s.kind === "sound").map((s) => s.key), ["zap"]);
  const miss = Plan.upload({ squares: 6, hit: false, family: "combat" });
  assert.deepEqual(miss.map((s) => s.kind), ["strand", "fizzle"]);
  const ghost = Plan.upload({ squares: 6, hit: true, family: "control", ghosted: true });
  assert.deepEqual(ghost.find((s) => s.kind === "burst").look, "glitch");
  assert.ok(ghost[0].dim);
  assert.deepEqual(Plan.conditionEnd().map((s) => s.kind), ["open", "burst", "sound"]);
  assert.ok(Plan.length(Plan.eject({ squares: 6 })) >= 500);
});

test("every beat has its own quiet sound, and a missing one falls back or stays silent", () => {
  for (const key of ["jackIn", "jackOut", "eject", "iceBlock", "iceBreak", "alert", "reboot", "ghost"]) assert.match(soundFor(key), /^hack/, key);
  assert.ok(SOUNDS.hackGhost.level < SOUNDS.hackJackIn.level, "a Ghost is quieter still");
  assert.equal(soundFor("upload"), "upload");
  assert.equal(soundFor("jackIn", { upload: {} }), "upload");
  assert.equal(soundFor("jackIn", { upload: {}, hackJackIn: {} }), "hackJackIn");
  assert.equal(soundFor("alert", { upload: {} }), null);
  for (const key of Object.keys(SOUNDS)) for (const f of SOUNDS[key].files) assert.ok(existsSync(path.join(root, f.replace(`modules/${M}/`, ""))), f);
});

test("a clip JB2A only has in another colour is turned to the one wanted", () => {
  assert.equal(hueTurn("jb2a.energy_strands.range.standard.purple.01", "cyan"), -90);
  assert.equal(hueTurn("jb2a.energy_strands.range.standard.blue", "cyan"), -30);
  assert.equal(hueTurn("jb2a.x.dark_red", "red"), 0);
  assert.equal(hueTurn("jb2a.x.nocolour", "red"), 0);
  // Every JB2A entry the looks ask for is in the free pack's database (checked against JB2A_DnD5e's list).
  const free = ["energy_strands.range.standard", "energy_beam.normal", "shield.01.intro", "shield.01.outro_explode", "extras.tmfx.radar.circle.pulse.01", "shimmer.01", "static_electricity.03", "impact.004",
    "extras.tmfx.outpulse.circle.02", "extras.tmfx.inpulse.circle.01", "flames.01", "soundwave.01", "energy_strands.complete"];
  for (const [k, bases] of Object.entries(JB)) assert.ok(free.includes(bases[0].replace("jb2a.", "")), `${k}: ${bases[0]}`);
  const src = readFileSync(path.join(root, "scripts", "hack", "fx.js"), "utf8");
  for (const m of src.matchAll(/img\("([^"$]+)"\)/g)) assert.ok(existsSync(path.join(root, "assets", "fx", "img", m[1])), m[1]);
});

/* ---------------------------------------- */
/*  The flow                                */
/* ---------------------------------------- */

test("Jack In: Interface against WILL, a link on the Netrunner, a card, and the pulse to the target", async () => {
  const run = netrunner(6);
  const guard = mark("Guard", { ice: 2 });
  aim(guard.token);
  dice.push(7, 4); // Interface 6 + 7 = 13 against WILL 5 + 4 = 9
  const out = await Hack.jackIn(run.actor, { token: run.token });
  await settle();
  assert.deepEqual(out, { won: true, aware: false, ghosted: false, walls: 2 });
  const link = Hack.state(run.actor).links[guard.token.id];
  assert.deepEqual([link.ghost, link.aware, link.walls, link.scene], [false, false, 2, "scene1"]);
  assert.match(lastCard().content, /Lattice jacks in to Guard/);
  assert.match(lastCard().content, /Interface 13 against WILL 9/);
  assert.match(lastCard().content, /Passwalls up: 2 \(Breach DV8 each\)/);
  assert.equal(lastCard().whisper, undefined);
  assert.ok(files().some((f) => f.includes("energy_strands.range")), "the pulse");
  assert.ok(files().some((f) => f.endsWith("data-ring.webp")), "the ring on the port");
  assert.deepEqual(live.map((e) => e.name), [linkName(run.token.id, guard.token.id)], "the link stays drawn");
  // Twice is once.
  assert.equal(await Hack.jackIn(run.actor, { token: run.token }), null);
  assert.match(notes.at(-1)[1], /Already jacked in/);
});

test("lose the Jack In and they know: the alert, the trace back, and an Eject button for the target's player", async () => {
  const run = netrunner(6);
  const guard = mark();
  aim(guard.token);
  dice.push(2, 9); // 8 against 14
  const out = await Hack.jackIn(run.actor, { token: run.token });
  assert.equal(out.aware, true);
  assert.match(lastCard().content, /and they know it/);
  assert.match(lastCard().content, /data-ncm-action="hack-eject"/);
  assert.ok(files().some((f) => f.endsWith("reticle-red.webp")), "the alert");
  assert.ok(files().some((f) => f.includes("energy_beam")), "the trace back");
  assert.deepEqual(Hack.intruders(guard.token).map((x) => x.runner.id), [run.token.id]);
  assert.ok(catalog(guard.actor, { token: guard.token }).net.some((e) => e.run === `hack:eject:${run.token.id}`), "Eject on the target's Action HUD");
});

test("Interface 1-2 has to beat the firewall first; failing tells no one", async () => {
  const run = netrunner(2);
  const guard = mark();
  aim(guard.token);
  dice.push(3); // 2 + 3 = 5 against DV6
  assert.equal(await Hack.jackIn(run.actor, { token: run.token }), null);
  assert.deepEqual(Hack.state(run.actor).links, {});
  assert.match(lastCard().content, /can&#x27;t get through|can't get through/);
  assert.ok(lastCard().whisper?.length, "only the Netrunner's side hears of it");
  assert.equal(beats().length, 0);
});

test("Breach: Self-ICE holds or goes down, and quickhacks wait for the last Passwall", async () => {
  const run = netrunner(6);
  const guard = mark("Guard", { ice: 2 });
  aim(guard.token);
  dice.push(7, 4);
  await Hack.jackIn(run.actor, { token: run.token });
  assert.equal(await Hack.quickhack(run.actor, "qhshortcircuit"), null);
  assert.match(notes.at(-1)[1], /2 Passwalls up/);
  played.length = 0;
  dice.push(2); // 8 against DV8: a tie fails
  assert.deepEqual(await Hack.breach(run.actor), { down: false, broken: false });
  assert.match(lastCard().content, /Self-ICE holds/);
  assert.ok(files().some((f) => f.includes("shield.01.intro")));
  played.length = 0;
  dice.push(5, 5);
  assert.equal((await Hack.breach(run.actor)).down, true);
  assert.ok(files().some((f) => f.includes("shield.01.outro_explode")));
  assert.equal((await Hack.breach(run.actor)).down, true);
  assert.equal(Hack.state(run.actor).links[guard.token.id].walls, 0);
  assert.match(lastCard().content, /Passwalls left: 0/);
  assert.equal(await Hack.breach(run.actor), null);
});

test("a quickhack that lands places its condition as the upload arrives, starts its Cooldown, and tells the target", async () => {
  const run = netrunner(6);
  const guard = mark();
  aim(guard.token);
  game.combat = makeCombat([run.actor, guard.actor], { round: 2, turn: 0 });
  dice.push(7, 4);
  await Hack.jackIn(run.actor, { token: run.token });
  played.length = 0;
  dice.push(5); // 11 against DV8
  const out = await Hack.quickhack(run.actor, "qhshortcircuit");
  await settle();
  assert.deepEqual([out.hit, out.aware, out.condition], [true, true, "qhShortCircuit"]);
  assert.ok(Conditions.has("qhShortCircuit", guard.actor));
  assert.match(chat.find((m) => /runs Short Circuit on Guard/.test(m.content)).content, /Interface 11 against DV8/);
  assert.ok(files().some((f) => f.includes("static_electricity")), "Control's look");
  assert.ok(files().some((f) => f.endsWith("reticle-red.webp")), "they know now");
  assert.equal(Hack.state(run.actor).links[guard.token.id].aware, true);
  // One quickhack per target per Turn, and the Cooldown in Rounds.
  assert.equal(await Hack.quickhack(run.actor, "qhoverheat"), null);
  assert.match(notes.at(-1)[1], /One quickhack per target per Turn/);
  game.combat.turn = 1;
  assert.equal(await Hack.quickhack(run.actor, "qhshortcircuit"), null);
  assert.match(notes.at(-1)[1], /Cooldown for 6 more Rounds/);
  const entry = catalog(run.actor, { token: run.token }).net.find((e) => e.run === "hack:run:qhshortcircuit");
  assert.deepEqual([entry.off, entry.sub], [true, "6 R"]);
  // The condition ending plays the reboot.
  played.length = 0;
  await Conditions.remove("qhShortCircuit", guard.actor);
  await settle();
  assert.ok(files().some((f) => f.includes("outpulse") || f.endsWith("ring-pulse.webp")), "the reboot beat");
});

test("a miss runs the Cooldown and leaves nothing; damage goes straight to HP, less Self-ICE: Defender", async () => {
  const run = netrunner(6);
  const guard = mark("Guard", { defender: true });
  aim(guard.token);
  dice.push(7, 4);
  await Hack.jackIn(run.actor, { token: run.token });
  dice.push(2); // 8 against DV8
  const miss = await Hack.quickhack(run.actor, "qhoverheat");
  assert.equal(miss.hit, false);
  assert.equal(Conditions.has("onFireStrong", guard.actor), false);
  assert.ok(Hack.state(run.actor).cooldowns.qhoverheat);
  dice.push(8, 4, 4, 4); // 14 against DV10; 3d6 = 12, less 4
  const hit = await Hack.quickhack(run.actor, "qhsynapseburnout");
  await settle();
  assert.equal(hit.damage, 8);
  assert.equal(guard.actor.system.derivedStats.hp.value, 32);
  assert.match(chat.find((m) => /Synapse Burnout/.test(m.content)).content, /Self-ICE: Defender took 4 off/);
});

test("a Ghost run stays between the GM and the Netrunner until it breaks", async () => {
  const run = netrunner(6);
  const guard = mark("Guard", { ice: 1 });
  aim(guard.token);
  dice.push(7, 4);
  const out = await Hack.jackIn(run.actor, { token: run.token, ghost: true });
  await settle();
  assert.equal(out.ghosted, true);
  assert.ok(lastCard().whisper?.length, "the card is whispered");
  assert.match(lastCard().content, /NET Actions: 2/);
  assert.ok(beats().every((s) => !String(call(s, "file")?.[0]).endsWith("data-ring.webp")), "nothing shows on the target");
  assert.deepEqual(live.map((e) => e.name), [linkName(run.token.id, guard.token.id, true)]);
  assert.deepEqual(live[0].users, [testUsers.gm.id], "the link is drawn for the GM and the Netrunner's players");
  assert.deepEqual(Hack.intruders(guard.token), [], "no Eject for someone who doesn't know");

  // Another player's client gets the beat and doesn't play it.
  played.length = 0;
  asGM(false);
  run.token.document.isOwner = false;
  assert.equal(HackFx.receive({ beat: "upload", runner: run.token.id, target: guard.token.id, scene: "scene1", hit: true, family: "control", ghosted: true, audience: "owners" }), null);
  assert.equal(played.length, 0);
  assert.ok(HackFx.receive({ beat: "upload", runner: run.token.id, target: guard.token.id, scene: "scene1", hit: true, family: "control", audience: "all" }));
  run.token.document.isOwner = true;
  asGM(true);

  // A failed Breach rattles the port: the target wins the roll and the Ghost is broken.
  dice.push(1, 5, 2, 9); // Breach 6+1-5 = 2 against DV6; stay Ghosted 6+2 = 8 against WILL 5+9 = 14
  const b = await Hack.breach(run.actor);
  await settle();
  assert.deepEqual(b, { down: false, broken: true });
  const link = Hack.state(run.actor).links[guard.token.id];
  assert.deepEqual([link.ghost, link.aware], [false, true]);
  assert.deepEqual(live.map((e) => e.name), [linkName(run.token.id, guard.token.id)], "now everyone's link");
});

test("Quiet quickhacks keep a Ghost; anything else breaks it", async () => {
  const run = netrunner(6);
  const guard = mark();
  aim(guard.token);
  dice.push(7, 4);
  await Hack.jackIn(run.actor, { token: run.token, ghost: true });
  played.length = 0;
  dice.push(5);
  const quiet = await Hack.quickhack(run.actor, "qhshortcircuit");
  await settle();
  assert.deepEqual([quiet.hit, quiet.aware, quiet.broken], [true, false, false]);
  assert.ok(chat.find((m) => /runs Short Circuit/.test(m.content)).whisper?.length);
  assert.equal(Hack.state(run.actor).links[guard.token.id].ghost, true);
  assert.ok(!files().some((f) => f.endsWith("reticle-red.webp")), "no alert");
  dice.push(5);
  const loud = await Hack.quickhack(run.actor, "qhoverheat");
  await settle();
  assert.equal(loud.broken, true);
  assert.equal(Hack.state(run.actor).links[guard.token.id].ghost, false);
  assert.equal(chat.find((m) => /runs Overheat/.test(m.content)).whisper, undefined, "a broken Ghost is everyone's news");
  assert.ok(Conditions.has("onFireStrong", guard.actor));
});

test("the target kicks the Netrunner out: the link goes, and so does hacking them for an hour", async () => {
  const run = netrunner(6);
  const guard = mark();
  guard.actor.createRoll = () => ({ roll: async () => {}, resultTotal: 0, total: 0 });
  aim(guard.token);
  dice.push(2, 9);
  await Hack.jackIn(run.actor, { token: run.token });
  const { CPR } = await import("../scripts/cpr.js");
  const real = CPR.skillCheck;
  CPR.skillCheck = async () => ({ total: 16 });
  dice.push(5); // Interface 6 + 5 = 11
  const out = await Hack.eject(guard.actor, run.token.id, { token: guard.token });
  CPR.skillCheck = real;
  await settle();
  assert.deepEqual(out, { ejected: true });
  assert.deepEqual(Hack.state(run.actor).links, {});
  assert.deepEqual(live, []);
  assert.match(lastCard().content, /Guard kicks Lattice out/);
  assert.equal(await Hack.jackIn(run.actor, { token: run.token }), null);
  assert.match(notes.at(-1)[1], /no hacking them for another 60 min/);
  game.time.worldTime = 3601;
  dice.push(7, 4);
  assert.ok(await Hack.jackIn(run.actor, { token: run.token }));
});

test("Jack Out takes the link away; the Action HUD lists the steps; the flow can be switched off", async () => {
  const run = netrunner(6);
  const guard = mark("Guard", { ice: 1 });
  aim(guard.token);
  let net = catalog(run.actor, { token: run.token }).net.map((e) => e.run ?? e.key);
  assert.ok(net.includes("hack:jackIn") && net.includes("hack:ghost") && net.includes("hack:run:qhoverheat"));
  assert.ok(catalog(run.actor, { token: run.token }).net.find((e) => e.run === "hack:run:qhoverheat").off, "nothing to hack yet");
  dice.push(7, 4);
  await Hack.run(run.actor, ["jackIn"], { token: run.token });
  net = catalog(run.actor, { token: run.token }).net.map((e) => e.run ?? e.key);
  assert.ok(net.includes(`hack:breach:${guard.token.id}`) && net.includes(`hack:out:${guard.token.id}`));
  await Hack.run(run.actor, ["out", guard.token.id], { token: run.token });
  await settle();
  assert.deepEqual(Hack.state(run.actor).links, {});
  assert.deepEqual(live, []);
  assert.match(lastCard().content, /jacks out of Guard/);
  await Settings.set("hackFlow", false);
  assert.ok(!catalog(run.actor, { token: run.token }).net.some((e) => String(e.key).startsWith("hack:")));
  // Animations off: the flow still runs, nothing is drawn.
  await Settings.set("hackFlow", true);
  await Settings.set("hackFx", false);
  played.length = 0;
  dice.push(7, 4);
  assert.ok(await Hack.jackIn(run.actor, { token: run.token }));
  assert.equal(played.length, 0);
});

test("without JB2A the module's own art carries every beat", async () => {
  jb2aDb = [];
  Core.clearCache();
  const run = netrunner(6);
  const guard = mark("Guard", { ice: 1 });
  for (const [beat, ctx] of [["jackIn", { aware: true }], ["breach", { down: true }], ["breach", { down: false }], ["upload", { hit: true, family: "ultimate" }], ["upload", { hit: false }], ["eject", {}], ["jackOut", {}]]) {
    played.length = 0;
    assert.ok(HackFx.send(beat, { runner: run.token.id, target: guard.token.id, ...ctx }), beat);
    assert.ok(beats().length >= 1, beat);
    assert.ok(files().every((f) => f.includes(`modules/${M}/assets/fx/img/`)), beat);
  }
});

/* ---------------------------------------- */
/*  Chrome that runs                        */
/* ---------------------------------------- */

test("chrome is read off its name: a Sandevistan, Berserk, and whose Operating System it is", () => {
  assert.deepEqual(chromeKind("Sandevistan"), { kind: "sandevistan", os: null });
  assert.deepEqual(chromeKind("Sandevistan Overdrive System (SOS)"), { kind: "sandevistan", os: null });
  assert.deepEqual(chromeKind("MILITECH ‘FALCON’ OS"), { kind: "sandevistan", os: "falcon" });
  assert.deepEqual(chromeKind("Militech 'Apogee' OS"), { kind: "sandevistan", os: "apogee" });
  assert.deepEqual(chromeKind("ZETATECH ‘REFLEX-PLUS’ OS"), { kind: "sandevistan", os: "reflexplus" });
  assert.deepEqual(chromeKind("QIANT ‘WARP DANCER’ OS"), { kind: "sandevistan", os: "warpdancer" });
  assert.deepEqual(chromeKind("BIODYNE ‘BERSERKER’ OS"), { kind: "berserk", os: "berserker" });
  assert.deepEqual(chromeKind("Berserk"), { kind: "berserk", os: null });
  assert.deepEqual(chromeKind("Kerenzikov"), { kind: "kerenzikov", os: null });
  assert.equal(chromeKind("ARASAKA ‘SHADOW’ OS"), null, "a deck's OS isn't speedware");
  assert.equal(chromeKind("Cybereye"), null);
  // Every Operating System has its running condition and its colour.
  const conds = chromeConditions();
  for (const [kind, words] of Object.entries(OS)) {
    for (const w of words) {
      const os = w.replace(/[^a-z]/g, "");
      assert.ok(conds.some((c) => c.kind === kind && c.os === os), `${w} condition`);
      assert.notEqual(tintOf(kind, os), tintOf(kind, true), `${w} colour`);
    }
  }
  assert.equal(conds.length, 11);
  const items = [{ name: "Sandevistan", type: "cyberware", installed: true, effects: [{ name: "Sandevistan (active)", disabled: false }] }, { name: "MILITECH ‘FALCON’ OS", type: "cyberware", installed: true }];
  assert.equal(conditionFor(items, "sandevistan", conds).id, "chromeFalcon");
  assert.equal(conditionFor(items.slice(0, 1), "sandevistan", conds).id, "chromeSandevistan");
  assert.equal(conditionFor([], "berserk", conds).id, "chromeBerserk");
  assert.deepEqual(chromeState(items), { sandevistan: true });
  assert.deepEqual(withoutGiven([{ key: "bonuses.initiative", value: 3 }, { key: "system.stats.ref.value", value: 1 }], ["bonuses.initiative"]), [{ key: "system.stats.ref.value", value: 1 }]);
});

test("Berserk from the macro: the condition, the token's red look and a burst; it all goes when the condition does", async () => {
  const actor = makeActor({ name: "Stop Sign" }, [{ name: "Berserk", type: "cyberware", system: { isInstalled: true } }, { name: "MILITECH ‘BALDUR’ OS", type: "cyberware", system: { isInstalled: true } }]);
  const token = makeToken(actor);
  await NeonFX.activate("berserk", [token]);
  await settle();
  assert.ok(Conditions.has("chromeBaldur", actor), "their Operating System's condition");
  assert.equal(token.document.flags[M].fx.berserk, "baldur");
  assert.ok(live.some((e) => e.name === `ncm-fx-berserk-${token.id}`), "the look while it runs");
  assert.ok(beats().length >= 2, "the burst as it kicks in");
  assert.ok(sounds.some((f) => String(f).includes("berserk-activate")), "and its surge");
  await Conditions.remove("chromeBaldur", actor);
  await settle();
  assert.equal(token.document.flags[M].fx.berserk, undefined);
  assert.ok(sounds.some((f) => String(f).includes("berserk-deactivate")), "winding down");
  assert.ok(!live.some((e) => e.name === `ncm-fx-berserk-${token.id}`));
});

test("a Sandevistan switched on and off again and again leaves Initiative where it was (chrome and its Operating System both switch)", async () => {
  await Settings.set("fxChrome", true);
  const actor = makeActor({ name: "Rogue" }, [
    { _id: "sande", name: "Sandevistan", type: "cyberware", system: { isInstalled: true } },
    { _id: "falcon", name: "MILITECH ‘FALCON’ OS", type: "cyberware", system: { isInstalled: true } }
  ]);
  const token = makeToken(actor);
  const mk = (item, id, name) => {
    const sw = { documentName: "ActiveEffect", id, name, disabled: true, changes: [{ key: "bonuses.initiative", value: "3" }], parent: item, statuses: new Set(), flags: {},
      async update(u) {
        Object.assign(this, u);
        Hooks.callAll("updateActiveEffect", this, u, {}, game.user.id);
      } };
    item.effects = [sw];
    item.documentName = "Item";
    return sw;
  };
  const a = mk(actor.items.get("sande"), "sw1", "Sandevistan (active)");
  const b = mk(actor.items.get("falcon"), "sw2", "Falcon OS (active)");
  // Every write takes a trip to the server, as it does at the table.
  const lag = (obj, fn) => {
    const real = obj[fn].bind(obj);
    obj[fn] = async (...args) => {
      await settle(4);
      return real(...args);
    };
  };
  lag(actor, "createEmbeddedDocuments");
  lag(actor, "deleteEmbeddedDocuments");
  lag(a, "update");
  lag(b, "update");
  const combat = makeCombat([actor]);
  game.combat = combat;
  const cb = combat.turns[0];
  lag(cb, "update");
  const start = cb.initiative;
  let up = null;
  for (let i = 0; i < 4; i++) {
    await NeonFX.activate("sandevistan", [token]);
    await settle(120);
    assert.equal(a.disabled, true, "the bare Sandevistan's switch stays off under an Operating System");
    assert.equal(b.disabled, false);
    assert.equal(Chrome.running(actor, "sandevistan")?.id, "chromeFalcon", `on, time ${i + 1}`);
    up ??= cb.initiative;
    assert.ok(up > start, "up while it runs");
    assert.equal(cb.initiative, up, `the same bonus, time ${i + 1}`);
    await NeonFX.activate("sandevistan", [token]);
    await settle(120);
    assert.equal(a.disabled, true);
    assert.equal(b.disabled, true);
    assert.equal(Chrome.running(actor, "sandevistan"), null, `off, time ${i + 1}`);
    assert.equal(cb.initiative, start, `back where it was, time ${i + 1}`);
  }
  assert.equal(Conditions.effects(actor, "chromeFalcon").length, 0);

  // The sum itself: on twice adds once, off twice takes back once.
  const { initiativeMove } = await import("../scripts/neonfx/chrome.js");
  assert.deepEqual(initiativeMove({ initiative: 12, had: undefined, bonus: 6, on: true }), { initiative: 18, keep: 6 });
  assert.equal(initiativeMove({ initiative: 18, had: 6, bonus: 6, on: true }), null, "already in");
  assert.deepEqual(initiativeMove({ initiative: 18, had: 6, bonus: 6, on: false }), { initiative: 12, keep: 0 });
  assert.equal(initiativeMove({ initiative: 12, had: 0, bonus: 6, on: false }), null, "already taken back");
  assert.deepEqual(initiativeMove({ initiative: 20, had: undefined, bonus: 6, on: false }), { initiative: 14, keep: 0 }, "rolled while it ran");
  assert.equal(initiativeMove({ initiative: null, had: undefined, bonus: 6, on: true }), null, "not rolled yet");
});

test("an Operating System fitted in its chrome (an Item Upgrade) runs as itself: the Apogee's condition and switch, not the bare Sandevistan's on top", async () => {
  await Settings.set("fxChrome", true);
  const actor = makeActor({ name: "V" }, [
    { _id: "sande", name: "Sandevistan", type: "cyberware", system: { isInstalled: true, installedItems: { list: ["apogee"] } } },
    { _id: "apogee", name: "Militech 'Apogee' OS", type: "itemUpgrade", system: { type: "cyberware", isInstalled: true } },
    { _id: "spare", name: "Militech ‘Falcon’ OS", type: "itemUpgrade", system: { type: "cyberware" } }
  ]);
  const token = makeToken(actor);
  const mk = (id, sid, name, changes) => {
    const item = actor.items.get(id);
    const sw = { documentName: "ActiveEffect", id: sid, name, disabled: true, changes, parent: item, statuses: new Set(), flags: {},
      async update(u) {
        Object.assign(this, u);
        Hooks.callAll("updateActiveEffect", this, u, {}, game.user.id);
      } };
    item.effects = [sw];
    item.documentName = "Item";
    return sw;
  };
  const base = mk("sande", "sw1", "Sandevistan (active)", [{ key: "bonuses.initiative", value: "3" }]);
  const os = mk("apogee", "sw2", "Militech 'Apogee' OS (active)", [{ key: "bonuses.aimedShot", value: "2" }, { key: "bonuses.initiative", value: "6" }]);
  const spare = mk("spare", "sw3", "Militech ‘Falcon’ OS (active)", [{ key: "bonuses.initiative", value: "4" }]);
  assert.deepEqual(Chrome.fitted(actor).map((i) => i.id).sort(), ["apogee", "sande"], "an Operating System lying in the gear isn't fitted");
  assert.deepEqual(Chrome.switches(actor, "sandevistan"), [os]);
  const combat = makeCombat([actor]);
  game.combat = combat;
  const cb = combat.turns[0];
  const start = cb.initiative;

  await NeonFX.activate("sandevistan", [token]);
  await settle(40);
  assert.equal(Chrome.running(actor, "sandevistan")?.id, "chromeApogee");
  assert.equal(Conditions.has("chromeSandevistan", actor), false, "not the bare Sandevistan's");
  assert.equal(os.disabled, false);
  assert.equal(base.disabled, true, "the Apogee's +6 stands in for the Sandevistan's +3");
  assert.equal(spare.disabled, true);
  assert.equal(cb.initiative, start + 6);
  assert.equal(token.document.flags[M].fx.sandevistan, "apogee");

  await NeonFX.activate("sandevistan", [token]);
  await settle(40);
  assert.equal(Chrome.running(actor, "sandevistan"), null);
  assert.equal(os.disabled, true);
  assert.equal(cb.initiative, start);

  // Switched on by hand at the bare Sandevistan: the Apogee's takes over.
  await base.update({ disabled: false });
  await settle(40);
  assert.equal(Chrome.running(actor, "sandevistan")?.id, "chromeApogee");
  assert.equal(os.disabled, false);
  assert.equal(base.disabled, true);
  assert.equal(cb.initiative, start + 6);
  await Conditions.remove("chromeApogee", actor);
  await settle(40);
  assert.equal(os.disabled, true);
  assert.equal(cb.initiative, start);
});

test("a Sandevistan's \"(active)\" effect, the condition and Initiative move together, and nothing counts twice", async () => {
  const actor = makeActor({ name: "Fury" }, [{ _id: "sande", name: "Sandevistan", type: "cyberware", system: { isInstalled: true } }]);
  const token = makeToken(actor);
  const item = actor.items.get("sande");
  const sw = { documentName: "ActiveEffect", id: "sw1", name: "Sandevistan (active)", disabled: true, changes: [{ key: "bonuses.initiative", value: "3" }], parent: item, statuses: new Set(), flags: {},
    async update(u) {
      Object.assign(this, u);
      Hooks.callAll("updateActiveEffect", this, u, {}, game.user.id);
    } };
  item.effects = [sw];
  item.documentName = "Item";
  const combat = makeCombat([actor]);
  game.combat = combat;
  const cb = combat.turns[0];
  assert.equal(cb.initiative, 20);

  await sw.update({ disabled: false });
  await settle(20);
  assert.ok(Conditions.has("chromeSandevistan", actor));
  const effect = Conditions.effects(actor, "chromeSandevistan")[0];
  assert.ok(!effect.changes.some((c) => c.key === "bonuses.initiative"), "the item's effect already gives the +3");
  assert.equal(cb.initiative, 23, "their place in the fight moves up");
  assert.equal(token.document.flags[M].fx.sandevistan, true);

  // The condition running out switches the chrome off again.
  await Conditions.remove("chromeSandevistan", actor);
  await settle(20);
  assert.equal(sw.disabled, true);
  assert.equal(cb.initiative, 20);
  assert.equal(token.document.flags[M].fx.sandevistan, undefined);

  // The macro goes through the chrome's own switch.
  await NeonFX.activate("sandevistan", [token]);
  await settle(20);
  assert.equal(sw.disabled, false);
  assert.ok(Conditions.has("chromeSandevistan", actor));
  await NeonFX.activate("sandevistan", [token]);
  await settle(20);
  assert.equal(sw.disabled, true);
  assert.equal(Conditions.has("chromeSandevistan", actor), false);

  // Switched off in the settings: the macro is the look alone, as before.
  await Settings.set("fxChrome", false);
  await NeonFX.activate("sandevistan", [token]);
  await settle();
  assert.equal(Conditions.has("chromeSandevistan", actor), false);
  assert.equal(token.document.flags[M].fx.sandevistan, true);
  assert.equal(Chrome.on, false);
});

test("no string the quickhack flow or the chrome conditions use is missing", () => {
  assert.deepEqual([...missingKeys].filter((k) => /Hack|chrome|FX/.test(k)), []);
});

/* ---------------------------------------- */
/*  What starting chrome costs and allows   */
/* ---------------------------------------- */

test("starting chrome: Humanity Loss unless the body carries it, the cooldown and what starting early costs, a Solo's free Combat Awareness (pure)", async () => {
  const { OS_RULES, rulesOf, framed, startPlan, AWARENESS_MODES } = await import("../scripts/neonfx/os.js");
  // Every Operating System a condition names has its rules.
  for (const c of chromeConditions().filter((x) => x.kind !== "kerenzikov")) assert.ok(OS_RULES[c.os ?? c.kind], `${c.id} has rules`);
  const apogee = rulesOf({ kind: "sandevistan", os: "apogee" });
  assert.deepEqual(startPlan({ rules: apogee, now: 100 }), { humanity: "1d6", early: null, left: 0, blocked: false, awareness: false, keep: 0 });
  assert.equal(startPlan({ rules: apogee, framed: true }).humanity, null, "an FBC or Cyberspine carries it");
  assert.equal(startPlan({ rules: apogee, solo: true }).awareness, true);
  assert.equal(startPlan({ rules: rulesOf({ kind: "sandevistan", os: "falcon" }), solo: true }).awareness, false);
  // Inside the cooldown: 3, then 6, then 9, and 9 from there on.
  const cool = (early) => ({ until: 160, early });
  assert.deepEqual([0, 1, 2, 5].map((n) => startPlan({ rules: apogee, now: 100, cool: cool(n) }).early), [3, 6, 9, 9]);
  assert.equal(startPlan({ rules: apogee, now: 100, cool: cool(1) }).keep, 2);
  assert.equal(startPlan({ rules: apogee, now: 100, cool: cool(1) }).left, 60);
  // The cooldown over: the count starts again.
  assert.deepEqual(startPlan({ rules: apogee, now: 200, cool: cool(2) }), { humanity: "1d6", early: null, left: 0, blocked: false, awareness: false, keep: 0 });
  // A bare Sandevistan can't be started early: the GM's call.
  assert.equal(startPlan({ rules: rulesOf({ kind: "sandevistan" }), now: 100, cool: cool(0) }).blocked, true);
  assert.equal(framed([{ name: "Sycust Cyberspine", type: "cyberware", installed: true }]), true);
  assert.equal(framed([{ name: "Sycust Cyberspine", type: "cyberware", installed: false }]), false);
  assert.equal(framed([{ name: "FBC EMP Coating", type: "cyberware", installed: true }]), true);
  assert.equal(framed([{ name: "Sandevistan", type: "cyberware", installed: true }]), false);
  assert.deepEqual(AWARENESS_MODES, ["aimed", "autofire", "suppressive"]);
});

test("an Apogee starting: the card and its buttons; Humanity Loss taken once; stopping starts the cooldown and starting inside it costs 3; a Solo's free Combat Awareness", async () => {
  await Settings.set("fxChrome", true);
  await Settings.set("chromeCards", true);
  const { OS: Card } = await import("../scripts/neonfx/os.js");
  const { Awareness } = await import("../scripts/awareness/awareness.js");
  const actor = makeActor({ name: "Fury" }, [
    { _id: "solo", name: "Solo", type: "role", system: { rank: 4, mainRoleAbility: "Combat Awareness", abilities: [{ name: "Precision Attack", rank: 2 }, { name: "Spot Weakness", rank: 2 }] } }
  ]);
  game.combat = null;
  game.time.worldTime = 1000;
  const cards = () => chat.filter((m) => m.flags?.[M]?.card);
  chat.length = 0;
  await Conditions.add("chromeApogee", actor);
  await settle(40);
  let card = cards().find((m) => /switches on/.test(m.content));
  assert.ok(card, "a card as it starts");
  assert.match(card.content, /chrome-humanity/);
  assert.match(card.content, /data-formula="1d6"/);
  assert.match(card.content, /chrome-awareness/, "a Solo's free Combat Awareness");
  assert.doesNotMatch(card.content, /data-key="early"/);

  // The Humanity Loss, once.
  const before = actor.system.derivedStats.humanity.value;
  dice.length = 0;
  dice.push(4);
  const btn = (action, data = {}) => ({ dataset: { ncmAction: action, actor: actor.uuid, ...data }, disabled: false });
  await Card.click(card, btn("chrome-humanity", { formula: "1d6", key: "start" }), {}, actor);
  assert.equal(actor.system.derivedStats.humanity.value, before - 4);
  await Card.click(card, btn("chrome-humanity", { formula: "1d6", key: "start" }), {}, actor);
  assert.equal(actor.system.derivedStats.humanity.value, before - 4, "not twice off one card");

  // Free Combat Awareness: one reassignment, whoever's Turn it is.
  await Card.click(card, btn("chrome-awareness"), {}, actor).catch(() => {});
  assert.equal(Awareness.mode(actor), "free");
  await Awareness.assign(actor, { precisionAttack: 4 });
  assert.equal(Awareness._pass.has(actor.id), false, "spent");

  // Stopping: the cooldown starts (20 Rounds).
  await Conditions.remove("chromeApogee", actor);
  await settle(40);
  assert.deepEqual(Card.cool(actor, "sandevistan"), { until: 1060, early: 0 });
  // Started again 5 Rounds in: 3 Humanity Loss; and again: 6.
  for (const want of ["3", "6"]) {
    game.time.worldTime += 15;
    chat.length = 0;
    await Conditions.add("chromeApogee", actor);
    await settle(40);
    card = cards().find((m) => /switches on/.test(m.content));
    assert.match(card.content, new RegExp(`data-formula="${want}"[^>]*data-key="early"|data-key="early"[^>]*data-formula="${want}"`));
    await Conditions.remove("chromeApogee", actor);
    await settle(40);
  }
  // Let it cool: no early cost, and the count starts over.
  game.time.worldTime += 4000;
  chat.length = 0;
  await Conditions.add("chromeApogee", actor);
  await settle(40);
  assert.doesNotMatch(cards().find((m) => /switches on/.test(m.content)).content, /data-key="early"/);
  assert.equal(Card.cool(actor, "sandevistan").early, 0);
  await Conditions.remove("chromeApogee", actor);
  await settle(40);

  // Switched off in the settings: no cards.
  await Settings.set("chromeCards", false);
  chat.length = 0;
  await Conditions.add("chromeApogee", actor);
  await settle(40);
  assert.equal(cards().filter((m) => /switches on/.test(m.content)).length, 0);
  await Conditions.remove("chromeApogee", actor);
  await settle(40);
  await Settings.set("chromeCards", true);
});

test("Berserk's Operating Systems: -4 to ranged attacks unless an FBC or Cyberspine carries it; a Baldur gives 5 HP back as it stops; a Falcon asks each Turn", async () => {
  await Settings.set("fxChrome", true);
  await Settings.set("chromeCards", true);
  const { OS: Card } = await import("../scripts/neonfx/os.js");
  const ranged = (a, id) => Conditions.effects(a, id)[0]?.changes.find((c) => c.key === "bonuses.ranged")?.value;
  game.combat = null;
  const bare = makeActor({ name: "Meat" });
  await Conditions.add("chromeBaldur", bare);
  await settle(40);
  assert.equal(Number(ranged(bare, "chromeBaldur")), -4);
  const spine = makeActor({ name: "Chrome" }, [{ _id: "spine", name: "Sycust Cyberspine", type: "cyberware", system: { isInstalled: true } }]);
  await Conditions.add("chromeBaldur", spine);
  await settle(40);
  assert.equal(ranged(spine, "chromeBaldur"), undefined, "the Cyberspine carries it");
  const card = chat.filter((m) => /switches on/.test(m.content ?? "")).at(-1);
  assert.doesNotMatch(card.content, /chrome-humanity/, "and no Humanity Loss either");

  // 5 HP back as a Baldur stops.
  await spine.update({ "system.derivedStats.hp.value": 20 });
  await Conditions.remove("chromeBaldur", spine);
  await settle(40);
  assert.equal(spine.system.derivedStats.hp.value, 25);

  // A Falcon: the choice at the start of each of their Turns, one at a time.
  const pilot = makeActor({ name: "Pilot" });
  const other = makeActor({ name: "Ganger" });
  await Conditions.add("chromeFalcon", pilot);
  await settle(40);
  const combat = makeCombat([pilot, other]);
  game.combat = combat;
  chat.length = 0;
  const asked = await Card.turn(combat);
  assert.ok(asked, "asked on their Turn");
  assert.match(asked.content, /chromeFalconMove/);
  assert.match(asked.content, /chromeFalconEvasion/);
  const pick = (id, others) => Card.click(asked, { dataset: { ncmAction: "chrome-pick", condition: id, others } }, {}, pilot);
  await pick("chromeFalconMove", "chromeFalconEvasion");
  assert.ok(Conditions.has("chromeFalconMove", pilot));
  await pick("chromeFalconEvasion", "chromeFalconMove");
  assert.ok(Conditions.has("chromeFalconEvasion", pilot) && !Conditions.has("chromeFalconMove", pilot), "one or the other");
  combat.turn = 1;
  assert.equal(await Card.turn(combat), null, "nobody else is asked");
  combat.turn = 0;
  await Card.turn(combat);
  assert.ok(!Conditions.has("chromeFalconEvasion", pilot), "last Turn's choice is over");
  await pick("chromeFalconMove", "chromeFalconEvasion");
  await Conditions.remove("chromeFalcon", pilot);
  await settle(40);
  assert.ok(!Conditions.has("chromeFalconMove", pilot), "gone with the Falcon");
  game.combat = null;
});

test("while an Operating System runs: a Baldur halves damage, a Matterhorn takes half BODY off the first each Round, an Apogee dodges bullets, a card lists the half-Actions", async () => {
  await Settings.set("fxChrome", true);
  await Settings.set("chromeCards", true);
  const { OS: Card, soaked, OS_RULES } = await import("../scripts/neonfx/os.js");
  const { Defense, dodgeAbility } = await import("../scripts/arsenal/defense.js");
  // The sums, pure.
  assert.equal(soaked({ loss: 9, soak: "half" }), 5, "halved, rounded up");
  assert.equal(soaked({ loss: 1, soak: "half" }), 1);
  assert.equal(soaked({ loss: 9, soak: "first", body: 7, first: true }), 5, "half of BODY 7 is 4");
  assert.equal(soaked({ loss: 3, soak: "first", body: 12, first: true }), 0, "never below nothing");
  assert.equal(soaked({ loss: 9, soak: "first", body: 7, first: false }), 9, "only the first each Round");
  assert.equal(soaked({ loss: 9 }), 9);
  assert.equal(OS_RULES.apogee.dodge && OS_RULES.falcon.dodge, true);

  game.combat = null;
  game.time.worldTime = 5000;
  const hp = (a) => a.system.derivedStats.hp.value;
  const hit = (a, n) => {
    const changes = { system: { derivedStats: { hp: { value: hp(a) - n } } } };
    const options = {};
    const out = Card.soak(a, changes, options);
    return { out, changes, options, to: changes.system.derivedStats.hp.value };
  };
  // A Baldur: every loss halved; healing and no chrome untouched.
  const tank = makeActor({ name: "Tank" });
  assert.equal(hit(tank, 9).out, null, "nothing running");
  await Conditions.add("chromeBaldur", tank);
  await settle(40);
  let r = hit(tank, 9);
  assert.deepEqual(r.out, { from: 9, to: 5 });
  assert.equal(r.to, hp(tank) - 5);
  assert.equal(r.options[M].soaked, true);
  assert.equal(Card.soak(tank, r.changes, r.options), null, "not twice on one change");
  assert.equal(Card.soak(tank, { system: { derivedStats: { hp: { value: hp(tank) + 5 } } } }, {}), null, "healing is healing");
  assert.equal(Card.soak(tank, { name: "Tank II" }, {}), null);

  // A Matterhorn: the first damage each Round, by half their BODY.
  const wall = makeActor({ name: "Wall" });
  const body = Number(wall.system.stats.body.value);
  await Conditions.add("chromeMatterhorn", wall);
  await settle(40);
  r = hit(wall, 20);
  assert.deepEqual(r.out, { from: 20, to: 20 - Math.ceil(body / 2) });
  await wall.update({ "system.derivedStats.hp.value": r.to, [`flags.${M}.chromeHit`]: r.changes.flags[M].chromeHit });
  assert.equal(hit(wall, 20).out, null, "the second this Round lands whole");
  game.time.worldTime += 3;
  assert.ok(hit(wall, 20).out, "a new Round");

  // Switched off in the settings: nothing soaks.
  await Settings.set("chromeCards", false);
  assert.equal(hit(tank, 9).out, null);
  await Settings.set("chromeCards", true);

  // Dodging bullets: the running condition is enough, whatever the REF and the items.
  assert.deepEqual(dodgeAbility({ ref: 5 }), { can: false, why: null, blocked: null });
  assert.equal(dodgeAbility({ ref: 5, chrome: "Sandevistan: Apogee OS" }).can, true);
  assert.equal(dodgeAbility({ ref: 5, chrome: "Sandevistan: Apogee OS", attackerHidden: true }).can, false, "still not a shooter they can't see");
  const slow = makeActor({ name: "Slow" });
  await slow.update({ "system.stats.ref.value": 5 });
  assert.equal(Defense.ability(slow).can, false);
  await Conditions.add("chromeApogee", slow);
  await settle(40);
  assert.equal(Defense.ability(slow).can, true);
  assert.equal(Card.dodges(slow), Registry.get("chromeApogee").name);
  await Conditions.remove("chromeApogee", slow);
  await settle(40);
  assert.equal(Defense.ability(slow).can, false, "over when it stops");

  // Each Turn under a Baldur: what can be half of a ROF2 Action.
  const combat = makeCombat([tank, wall]);
  game.combat = combat;
  chat.length = 0;
  await Card.turn(combat);
  assert.ok(chat.some((m) => /half of a ROF2 Action/.test(m.content ?? "")), "a reminder on their Turn");
  chat.length = 0;
  combat.turn = 1;
  await Card.turn(combat);
  assert.equal(chat.length, 0, "a Matterhorn has none");
  game.combat = null;

  // A Brawler: 2 off all damage, through the system's own reduction.
  assert.ok(BY_ID.chromeBrawler.changes.some((c) => c.key === "bonuses.universalDamageReduction" && c.value === 2));
});
