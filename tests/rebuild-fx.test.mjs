/** Neon Arsenal's Rebuild looks: weapon conditions, Tech scope outlines, ricochets, smart rounds and the Improved Smart retry. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeActor, registerSettings, root, asGM, missingKeys, chat, dice } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();

/* ---------------------------------------- */
/*  Sequencer, as far as these looks use it */
/* ---------------------------------------- */

const played = []; // { kind, calls }
const ended = [];
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
    played.push(...this.sections);
    return new Promise(() => {});
  }
}
globalThis.Sequence = Sequence;
globalThis.Sequencer = {
  Database: { getEntry: () => false, getPathsUnder: () => [] },
  EffectManager: { getEffects: () => [], endEffects: async (f) => ended.push(f) },
  SoundManager: { endSounds: () => {} }
};
game.modules.set("sequencer", { id: "sequencer", active: true });
game.socket.emit = () => {};

// Formulas the way Foundry reads them, spaces and all.
globalThis.Roll = class Roll {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    const f = this.formula.replace(/(\d+)d(\d+)/g, (m, n, d) => String(dice.length ? dice.shift() : Math.ceil(Number(d) / 2))).replace(/\s+/g, "");
    this.total = f.split(/(?=[+-])/).reduce((a, b) => a + Number(b), 0);
    return this;
  }
  async toMessage(data) {
    chat.push({ ...data, roll: this });
    return data;
  }
};

/* ---------------------------------------- */
/*  A canvas                                */
/* ---------------------------------------- */

globalThis.canvas = {
  ready: true,
  scene: { id: "sc1" },
  dimensions: { size: 100, distance: 2 },
  grid: { size: 100 },
  tokens: { placeables: [], controlled: [], get(id) { return this.placeables.find((t) => t.id === id); } },
  walls: { placeables: [] }
};
const wall = (c, extra = {}) => ({ document: { c, move: 20, sight: 20, door: 0, ds: 0, flags: {}, ...extra } });
function tokenAt(actor, x, y, { visible = true, hidden = false } = {}) {
  const t = { id: `t${canvas.tokens.placeables.length + 1}`, name: actor?.name ?? "x", actor, visible, center: { x, y }, w: 100, h: 100,
    mesh: { texture: { width: 100, height: 100 } }, document: { width: 1, height: 1, hidden, texture: { fit: "contain", scaleX: 1, scaleY: 1 } } };
  canvas.tokens.placeables.push(t);
  return t;
}

/* ---------------------------------------- */
/*  The module                              */
/* ---------------------------------------- */

const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { segmentsCross, throughThinCover, readWall, Xray } = await import("../scripts/arsenal/xray.js");
const { bouncePoint, shotLook, shotWall, Shots, flightMs } = await import("../scripts/arsenal/shots.js");
const { Equipped, flavorsInHand, inHand, REBUILD_CONDITION } = await import("../scripts/arsenal/equipped.js");
const { Arsenal, penaltyOf, retryFormula } = await import("../scripts/arsenal/arsenal.js");
const { AA } = await import("../scripts/arsenal/aa.js");
const { RECIPES, LAYERED } = await import("../scripts/neonfx/recipes.js");
const { SOUNDS, soundFiles } = await import("../scripts/arsenal/profile.js");
Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Registry.refresh();

const weapon = (id, name, system = {}) => ({ _id: id, name, type: "weapon", system: { isRanged: true, equipped: "equipped", fireModes: { autoFire: 0 }, ...system } });
function crew(name, items) {
  const actor = makeActor({ name }, items);
  for (const i of actor.items) i.actor = actor;
  return actor;
}

beforeEach(async () => {
  asGM(true);
  played.length = 0;
  ended.length = 0;
  chat.length = 0;
  dice.length = 0;
  canvas.tokens.placeables.length = 0;
  canvas.tokens.controlled = [];
  canvas.walls.placeables = [];
  Xray.drawn.clear();
  for (const [k, v] of Object.entries({ fxEnabled: true, arsenalRebuilds: true, arsenalRebuildConditions: true, arsenalShotFx: true, arsenalXray: true, arsenalThinDoors: true, arsenalSmartPrompt: true })) await Settings.set(k, v);
});

/* ---------------------------------------- */
/*  Weapon conditions                       */
/* ---------------------------------------- */

test("the weapon conditions exist, carry no numbers, stay out of the HUD and have a look and an icon", () => {
  for (const id of Object.values(REBUILD_CONDITION)) {
    const c = Registry.get(id);
    assert.ok(c, id);
    assert.equal(c.rawChanges?.length ?? 0, 0, `${id} adds nothing to rolls (the weapon traits do)`);
    assert.equal(c.hud, false);
    assert.ok(LAYERED.has(id), `${id} shows on the token`);
    assert.ok(existsSync(path.join(root, c.img.replace(`modules/${M}/`, ""))), c.img);
  }
});

test("they follow the guns in hand: on when equipped, off when stowed, a hand-placed one stays", async () => {
  const actor = crew("Fury", [weapon("w1", "Assault Rifle (Smart)"), weapon("w2", "Heavy Pistol (Tech)", { equipped: "carried" }), { _id: "c1", name: "Gorilla Arms", type: "cyberware", system: { isWeapon: true, isInstalled: true } }]);
  assert.ok(inHand(actor.items.get("w1")) && !inHand(actor.items.get("w2")) && inHand(actor.items.get("c1")));
  assert.deepEqual([...flavorsInHand(actor)], ["smart"]);
  await Equipped.sync(actor);
  assert.ok(Conditions.has("smartRebuild", actor));
  assert.ok(!Conditions.has("techRebuild", actor));
  assert.equal(chat.length, 0, "no chat card for picking up a gun");

  actor.items.get("w1").system.equipped = "carried";
  actor.items.get("w2").system.equipped = "equipped";
  await Equipped.sync(actor);
  assert.ok(!Conditions.has("smartRebuild", actor));
  assert.ok(Conditions.has("techRebuild", actor));

  // The GM's own Power Weapon isn't taken away; switching the setting off takes Neon Arsenal's.
  await Conditions.add("powerRebuild", actor);
  await Equipped.sync(actor);
  assert.ok(Conditions.has("powerRebuild", actor));
  await Settings.set("arsenalRebuildConditions", false);
  await Equipped.sync(actor);
  assert.ok(!Conditions.has("techRebuild", actor));
  assert.ok(Conditions.has("powerRebuild", actor));
});

/* ---------------------------------------- */
/*  Tech scopes                             */
/* ---------------------------------------- */

test("thin cover: every wall crossed must be thin; doors count unless switched off; open doors don't block", () => {
  const a = { x: 0, y: 0 };
  const b = { x: 10, y: 0 };
  assert.ok(segmentsCross(a, b, { x: 5, y: -5 }, { x: 5, y: 5 }));
  assert.ok(!segmentsCross(a, b, { x: 5, y: 1 }, { x: 5, y: 5 }));
  const thin = readWall({ c: [5, -5, 5, 5], sight: 20, flags: { [M]: { thinCover: true } } });
  const solid = readWall({ c: [7, -5, 7, 5], sight: 20 });
  const door = readWall({ c: [5, -5, 5, 5], sight: 20, door: 1, ds: 0 });
  const open = readWall({ c: [5, -5, 5, 5], sight: 20, door: 1, ds: 1 });
  assert.ok(throughThinCover(a, b, [thin]));
  assert.ok(!throughThinCover(a, b, [thin, solid]));
  assert.ok(!throughThinCover(a, b, []), "nothing in the way isn't cover");
  assert.ok(throughThinCover(a, b, [door]));
  assert.ok(!readWall({ c: [5, -5, 5, 5], door: 1 }, { doorsThin: false }).thin);
  assert.ok(!open.blocks);
});

test("a selected Tech shooter sees outlines behind thin cover, on their screen only; hidden tokens never", async () => {
  const shooter = crew("Lattice", [weapon("w1", "Heavy Pistol (Tech)")]);
  await Conditions.add("techRebuild", shooter);
  const me = tokenAt(shooter, 100, 500);
  canvas.tokens.controlled = [me];
  const behindThin = tokenAt(makeActor({ name: "Ganger" }), 900, 500, { visible: false });
  const behindSolid = tokenAt(makeActor({ name: "Boss" }), 100, 100, { visible: false });
  const seen = tokenAt(makeActor({ name: "Bystander" }), 900, 900, { visible: true });
  const gmHidden = tokenAt(makeActor({ name: "Ambush" }), 900, 450, { visible: false, hidden: true });
  canvas.walls.placeables = [wall([500, 0, 500, 1000], { flags: { [M]: { thinCover: true } } }), wall([0, 300, 300, 300])];
  assert.deepEqual(Xray.wanted().map((t) => t.name), ["Ganger"]);
  assert.ok(seen && behindSolid && gmHidden);

  Xray.refresh();
  const fx = played.filter((s) => call(s, "name")?.[0] === `ncm-xray-${behindThin.id}`);
  assert.equal(fx.length, 1);
  assert.ok(call(fx[0], "locally") && call(fx[0], "xray") && call(fx[0], "persist"), "local, through vision, until it goes");
  assert.equal(call(fx[0], "filter")[0], "Glow");

  // Moving out from behind the cover (or putting the gun away) ends it.
  canvas.walls.placeables = [wall([500, 0, 500, 1000])];
  Xray.refresh();
  assert.deepEqual(ended.map((e) => e.name), [`ncm-xray-${behindThin.id}`]);
  canvas.tokens.controlled = [];
  assert.deepEqual(Xray.wanted(), []);
});

/* ---------------------------------------- */
/*  Ricochets and smart rounds              */
/* ---------------------------------------- */

test("which attacks get the drawn shot: ricochets and Smart guns, not areas, explosives or Suppressive Fire", () => {
  const a = { kind: "attack", ranged: true, mode: "single" };
  assert.equal(shotLook({ ...a, ricochet: true, flavor: "power" }), "ricochet");
  assert.equal(shotLook({ ...a, flavor: "smart" }), "smart");
  assert.equal(shotLook({ ...a, flavor: "tech" }), null);
  assert.equal(shotLook({ ...a, flavor: "smart", mode: "suppressive" }), null);
  assert.equal(shotLook({ ...a, flavor: "smart", explosive: true }), null);
  assert.equal(shotLook({ ...a, flavor: "smart", area: true }), null);
  assert.equal(shotLook({ ...a, flavor: "smart" }, { on: false }), null);
  assert.equal(shotLook({ kind: "damage", ranged: true, flavor: "smart" }), null);
});

test("a ricochet bounces off the wall that gets it round, with a clear line both ways", () => {
  const from = { x: 100, y: 500 };
  const to = { x: 900, y: 500 };
  // A wall across the middle (the cover), one along the top to bounce off.
  const walls = [shotWall({ c: [500, 350, 500, 700], move: 20 }), shotWall({ c: [0, 200, 1000, 200], move: 20 })];
  const b = bouncePoint(from, to, walls, 100);
  assert.ok(b.wall);
  assert.ok(Math.abs(b.y - 203) <= 1, "on the top wall's near face");
  assert.ok(Math.abs(b.x - 500) <= 60, "about halfway along");
  // An open door is no wall; with nothing to bounce off, it bows out to one side.
  assert.equal(shotWall({ c: [0, 0, 1, 1], move: 20, door: 1, ds: 1 }).blocks, false);
  const none = bouncePoint(from, to, [], 100);
  assert.equal(none.wall, false);
  assert.ok(Math.abs(none.y - 500) >= 140);
  assert.ok(flightMs(10000, 100) <= 320 && flightMs(10, 100) >= 120);
});

test("the drawn shots: a ricochet's sparks at the bounce, Smart rounds that lock on and curve, Improved Smart in magenta", () => {
  const me = tokenAt(makeActor({ name: "Fury" }), 100, 500);
  const them = tokenAt(makeActor({ name: "Ganger" }), 900, 500);
  canvas.walls.placeables = [wall([0, 200, 1000, 200])];
  const base = { kind: "attack", ranged: true, tokenId: me.id, targets: [them.id], total: 18, hits: [{ name: "Ganger", dv: 15 }] };

  assert.ok(Shots.attack({ ...base, ricochet: true, flavor: "power", mode: "single" }));
  const files = played.map((s) => call(s, "file")?.[0] ?? "");
  assert.ok(files.some((f) => f.endsWith("trajectory.webp")), "the path lingers");
  assert.ok(files.some((f) => f.endsWith("tracer.webp")));
  assert.ok(played.every((s) => !call(s, "locally")), "everyone sees it");

  played.length = 0;
  assert.ok(Shots.attack({ ...base, flavor: "smart", ammoType: "basic", mode: "autofire" }));
  const reticle = played.find((s) => String(call(s, "file")?.[0]).endsWith("reticle-white.webp"));
  assert.equal(call(reticle, "tint")[0], 0x00e5ff);
  const rounds = played.filter((s) => String(call(s, "file")?.[0]).endsWith("glow-soft.webp") && s.calls.some(([m, args]) => m === "animateProperty" && args[1] === "position.y"));
  assert.equal(rounds.length, 16, "Autofire: four rounds, each with a three-dot trail, all curving");

  played.length = 0;
  Shots.attack({ ...base, flavor: "smart", ammoType: "smart", mode: "single" });
  assert.ok(played.some((s) => String(call(s, "file")?.[0]).endsWith("data-ring-white.webp")), "Improved Smart paints the shooter");
  assert.ok(played.filter((s) => call(s, "tint")).every((s) => call(s, "tint")[0] === 0xff4fd8));

  assert.equal(Shots.attack({ ...base, flavor: "tech", mode: "single" }), false);
  for (const f of ["tracer.webp", "trajectory.webp", "reticle-white.webp", "data-ring-white.webp", "ring-pulse.webp", "glow-soft.webp"]) assert.ok(existsSync(path.join(root, "assets", "fx", "img", f)), f);
});

test("Automated Animations' straight shot stands aside for the drawn ones", () => {
  const actor = crew("Fury", [weapon("w1", "Heavy Pistol (Power)", { weaponType: "heavyPistol" })]);
  const item = actor.items.get("w1");
  const workflow = (tag) => ({ flags: { [M]: { arsenal: { kind: "attack", ranged: true, mode: "single", ...tag } } } });
  const ricochet = { item, token: { actor }, workflow: workflow({ ricochet: true, flavor: "power" }) };
  AA.onWorkflowStart(ricochet, {});
  assert.equal(ricochet.stopWorkflow, true);
  const plain = { item, token: { actor }, workflow: workflow({ flavor: "power" }) };
  AA.onWorkflowStart(plain, {});
  assert.ok(!plain.stopWorkflow);
});

/* ---------------------------------------- */
/*  Improved Smart retry                    */
/* ---------------------------------------- */

test("the retry keeps the first shot's penalties and adds the LUCK spent", () => {
  assert.equal(penaltyOf({ mods: [{ value: 1 }, { value: -4 }, { value: -2 }] }), -6);
  assert.equal(penaltyOf({ mods: [3, -1] }), -1);
  assert.equal(penaltyOf({}), 0);
  assert.equal(retryFormula(), "14 + 1d10");
  assert.equal(retryFormula(-6, 2), "14 + 1d10 - 6 + 2");
});

test("a miss by 5 or less asks the shooter; the retry spends LUCK, rolls once and loops a round back", async () => {
  const actor = crew("Fury", [weapon("w1", "Assault Rifle (Smart)")]);
  game.actors.set(actor.id, actor);
  const me = tokenAt(actor, 100, 500);
  const them = tokenAt(makeActor({ name: "Ganger" }), 900, 500);
  const a = { kind: "attack", flavor: "smart", ammoType: "smart", ranged: true, actorId: actor.id, tokenId: me.id, targets: [them.id], total: 13, dv: 15, penalty: -2 };
  const message = { flags: { [M]: { arsenal: a } }, async setFlag(scope, key, v) { foundry.utils.setProperty(this.flags[scope], key, v); } };
  assert.ok(Arsenal.canRetry(a));
  assert.ok(!Arsenal.canRetry({ ...a, total: 9 }), "missed by 6");
  assert.ok(!Arsenal.canRetry({ ...a, ammoType: "basic" }), "only Improved Smart rounds");

  let asked = null;
  foundry.applications.api.DialogV2.wait = async (opts) => {
    asked = opts;
    return 2;
  };
  dice.push(4);
  await Arsenal.promptRetry(message);
  assert.match(asked.content, /14 \+ 1d10 - 2/);
  assert.equal(actor.system.stats.luck.value, 3, "2 LUCK spent");
  const roll = chat.at(-1).roll;
  assert.equal(roll.formula, "14 + 1d10 - 2 + 2");
  assert.equal(roll.total, 18);
  assert.match(chat.at(-1).flavor, /on target/);
  assert.ok(played.some((s) => String(call(s, "file")?.[0]).endsWith("reticle-white.webp")), "the round comes back round");

  // Once only.
  chat.length = 0;
  await Arsenal.promptRetry(message);
  assert.equal(chat.length, 0);
});

/* ---------------------------------------- */
/*  Files and words                         */
/* ---------------------------------------- */

test("the new sounds ship, quiet; every word is in the language file", () => {
  for (const k of ["smartLock", "smartSeek", "smartReacquire"]) {
    for (const f of soundFiles(k)) assert.ok(existsSync(path.join(root, f.replace(`modules/${M}/`, ""))), f);
    assert.ok(SOUNDS[k].level <= 0.6);
  }
  for (const id of Object.values(REBUILD_CONDITION)) assert.ok(RECIPES[id]);
  for (const file of ["xray.js", "shots.js", "equipped.js"]) {
    const src = readFileSync(path.join(root, "scripts", "arsenal", file), "utf8");
    for (const [, key] of src.matchAll(/LANG\}\.([A-Za-z.]+)/g)) assert.ok(game.i18n.has?.(`NEONCOMBAT.${key}`) ?? true, key);
  }
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});
