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
const { segmentsCross, throughThinCover, readWall, Xray, nextScopeTarget } = await import("../scripts/arsenal/xray.js");
const { bouncePoint, shotLook, shotWall, Shots, flightMs, crossings } = await import("../scripts/arsenal/shots.js");
const { Equipped, flavorsInHand, inHand, REBUILD_CONDITION } = await import("../scripts/arsenal/equipped.js");
const { Arsenal, penaltyOf, retryFormula, obscurementMods, rolledCrit } = await import("../scripts/arsenal/arsenal.js");
const { dodgeAbility, tracksRicochet } = await import("../scripts/arsenal/defense.js");
const { RebuildRegistry, Rebuilds } = await import("../scripts/arsenal/rebuilds.js");
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

test("an outline can be targeted: a click on it, the Target key over it, or the Action HUD's button, for a shot through the cover", async () => {
  const shooter = crew("Lattice", [weapon("w1", "Heavy Pistol (Tech)")]);
  await Conditions.add("techRebuild", shooter);
  const me = tokenAt(shooter, 100, 500);
  canvas.tokens.controlled = [me];
  const targets = new Set();
  const saved = game.user.targets;
  game.user.targets = targets;
  const far = tokenAt(makeActor({ name: "Far" }), 900, 500, { visible: false });
  const near = tokenAt(makeActor({ name: "Near" }), 700, 500, { visible: false });
  for (const t of [far, near]) t.setTarget = (on, { releaseOthers = true } = {}) => {
    if (releaseOthers) targets.clear();
    if (on) targets.add(t);
    else targets.delete(t);
  };
  canvas.tokens.get = (id) => canvas.tokens.placeables.find((t) => t.id === id);
  canvas.walls.placeables = [wall([500, 0, 500, 1000], { flags: { [M]: { thinCover: true } } })];
  Xray.refresh();
  assert.deepEqual(Xray.seen().map((t) => t.name), ["Near", "Far"], "nearest first");

  assert.equal(Xray.target(far), true);
  assert.deepEqual([...targets].map((t) => t.name), ["Far"]);
  Xray.target(near, { add: true });
  assert.equal(targets.size, 2, "Shift keeps the others");
  Xray.target(far);
  assert.deepEqual([...targets].map((t) => t.name), [], "a second click lets go (and, without Shift, of the others)");
  assert.equal(Xray.target(me), false, "only what the scope shows");

  // The HUD's button walks through them.
  assert.equal(Xray.cycle().name, "Near");
  assert.equal(Xray.cycle().name, "Far");
  assert.equal(Xray.cycle().name, "Near");
  assert.equal(nextScopeTarget([], []), null);

  // The Tech gun's HUD entry has the button, lit up while the scope shows someone.
  const { catalog } = await import("../scripts/hud/catalog.js");
  const entry = catalog(shooter).weapons.find((w) => w.label === "Heavy Pistol (Tech)");
  const scope = entry.buttons.find((b) => b.key === "scope:w1");
  assert.ok(scope && !scope.off && scope.sub === "2");
  Xray.drawn.clear();
  assert.ok(catalog(shooter).weapons.find((w) => w.label === "Heavy Pistol (Tech)").buttons.find((b) => b.key === "scope:w1").off);
  game.user.targets = saved;
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

/* ---------------------------------------- */
/*  The rest of the Rebuild rules           */
/* ---------------------------------------- */

class CPRAttackRoll {
  constructor(mods = []) {
    this.mods = [...mods];
    this.rollCardExtraArgs = {};
    this.resultTotal = 14;
  }
  addMod(list) {
    this.mods.push(...list);
  }
  removeMod(id) {
    this.mods.splice(this.mods.findIndex((m) => m.id === id), 1);
  }
}

test("Improved Smart rounds ignore visual obscurement: darkness, smoke and weather's sight penalties come off", async () => {
  const conds = { e1: Registry.get("darkness"), e2: Registry.get("heavyRain") ?? { category: "weather", id: "rain" }, e3: { category: "weather", id: "cold" }, e4: Registry.get("blind"), e5: Registry.get("smoke") };
  const mods = [
    { id: "bonuses.ranged-e1", key: "bonuses.ranged", value: -4 },
    { id: "bonuses.ranged-e2", key: "bonuses.ranged", value: -2 },
    { id: "bonuses.allActions-e3", key: "bonuses.allActions", value: -2 },
    { id: "bonuses.ranged-e4", key: "bonuses.ranged", value: -4 },
    { id: "bonuses.ranged-e5", key: "bonuses.ranged", value: -4 },
    { value: 1, source: "Smart" }
  ];
  assert.deepEqual(obscurementMods(mods, (id) => conds[id]).map((m) => m.id), ["bonuses.ranged-e1", "bonuses.ranged-e2", "bonuses.ranged-e5"], "not blindness, not the cold");

  // On the roll: only with Improved Smart rounds in a Smart gun.
  const actor = crew("Fury", [weapon("w1", "Assault Rifle (Smart)", { weaponType: "assaultRifle", installedItems: { list: ["a1"] } }), { _id: "a1", name: "Improved Smart Rifle Ammo", type: "ammo", system: { variety: "rifle", type: "smart", amount: 10 } }]);
  game.user.targets = new Set();
  const [dark] = await Conditions.add("darkness", actor);
  const roll = new CPRAttackRoll([{ id: `bonuses.ranged-${dark.id}`, key: "bonuses.ranged", value: -4, source: "Darkness" }]);
  await Arsenal.preRoll(actor.items.get("w1"), roll);
  assert.ok(!roll.mods.some((m) => m.source === "Darkness"));
  assert.equal(Arsenal.pending.tag.unobscured, -4);
  const plain = crew("Lattice", [weapon("w1", "Assault Rifle (Smart)", { weaponType: "assaultRifle" })]);
  const [dark2] = await Conditions.add("darkness", plain);
  const r2 = new CPRAttackRoll([{ id: `bonuses.ranged-${dark2.id}`, key: "bonuses.ranged", value: -4, source: "Darkness" }]);
  await Arsenal.preRoll(plain.items.get("w1"), r2);
  assert.ok(r2.mods.some((m) => m.source === "Darkness"), "ordinary rounds still take it");
});

test("a Smart gun before its roll dialog: the +1 by name, and Improved Smart rounds take obscurement off; both show as conditions and on the card", async () => {
  const HUB = "cpr-neon-hub";
  const ammo = { _id: "a1", name: "Improved Smart Ammunition (Rifle)", type: "ammo", system: { variety: "rifle", type: "smart", amount: 10 } };
  const port = { _id: "n1", name: "Neuroport", type: "cyberware", system: { isInstalled: true } };
  const hubGun = (extra = {}) => ({ ...weapon("w1", "Kang Tao G-58 Dian", { weaponType: "smg", attackmod: 1, ...extra }), flags: { [HUB]: { weaponType2070: "smart" } } });
  game.user.targets = new Set();

  // Neon Hub's Smart gun (the +1 is in its own attack modifier), linked, Improved Smart loaded, in the dark.
  const fury = crew("Fury", [hubGun({ installedItems: { list: ["a1"] } }), ammo, port]);
  for (const i of fury.items) if (i.flags?.[HUB]) i.flags = { [HUB]: { weaponType2070: "smart" } };
  const [dark] = await Conditions.add("obscured", fury);
  const roll = new CPRAttackRoll([
    { value: 1, source: "Kang Tao G-58 Dian", key: "bonuses.universalAttack", category: "combat" },
    { id: `bonuses.ranged-${dark.id}`, key: "bonuses.ranged", value: -4, source: "Obscured" }
  ]);
  const done = Arsenal.preDialog(fury.items.get("w1"), roll);
  assert.equal(done.unobscured, -4);
  assert.equal(done.split, true);
  assert.deepEqual(roll.mods.map((m) => [m.id ?? m.source, m.value]), [[`${M}-smart`, 1]], "the dialog opens with Smart weapon +1 and Obscured unticked");
  // The player ticks Obscured back on in the dialog: it still comes off, and the +1 isn't added twice.
  roll.mods.push({ id: `bonuses.ranged-${dark.id}`, key: "bonuses.ranged", value: -4, source: "Obscured" });
  await Arsenal.preRoll(fury.items.get("w1"), roll);
  assert.deepEqual(roll.mods.map((m) => [m.id, m.value]), [[`${M}-smart`, 1]]);
  assert.equal(Arsenal.pending.tag.unobscured, -8);
  assert.equal(Arsenal.pending.tag.smartBonus, 1);

  // Without a link the +1 comes out of the gun's modifier and nothing takes its place.
  const nolink = crew("Rook", [hubGun(), { ...ammo }]);
  for (const i of nolink.items) if (i.name.startsWith("Kang")) i.flags = { [HUB]: { weaponType2070: "smart" } };
  const r2 = new CPRAttackRoll([{ value: 1, source: "Kang Tao G-58 Dian", key: "bonuses.universalAttack" }]);
  Arsenal.preDialog(nolink.items.get("w1"), r2);
  await Arsenal.preRoll(nolink.items.get("w1"), r2);
  assert.deepEqual(r2.mods, [], "no link: no +1, and not taken off twice");

  // A Smart gun that isn't Neon Hub's: the +1 is added by name.
  const other = crew("Lattice", [weapon("w1", "Assault Rifle (Smart)", { weaponType: "assaultRifle" }), { ...port }]);
  const r3 = new CPRAttackRoll([]);
  Arsenal.preDialog(other.items.get("w1"), r3);
  assert.deepEqual(r3.mods.map((m) => [m.id, m.value]), [[`${M}-smart`, 1]]);
  // A Tech gun, or a damage roll: untouched.
  const tech = crew("Sable", [weapon("w1", "Heavy Pistol (Tech)")]);
  assert.equal(Arsenal.preDialog(tech.items.get("w1"), new CPRAttackRoll([])), null);

  // The conditions: Smart Weapon, and Improved Smart Loaded only with the rounds in a Smart gun.
  assert.deepEqual([...flavorsInHand(fury)].sort(), ["improved", "smart"]);
  assert.deepEqual([...flavorsInHand(nolink)], ["smart"], "the rounds aren't loaded");
  const linkGun = crew("V", [weapon("w1", "Assault Rifle", { weaponType: "assaultRifle", installedItems: { list: ["a1"] } }), { ...ammo }]);
  assert.deepEqual([...flavorsInHand(linkGun)], [], "Improved Smart in a gun that isn't Smart does nothing");
  await Equipped.sync(fury);
  assert.ok(Conditions.has("improvedSmart", fury) && Conditions.has("smartRebuild", fury));
  assert.match(game.i18n.localize("NEONCOMBAT.Condition.improvedSmart.hint"), /obscurement/);
});

test("a ricochet can be dodged at -4 by whoever can follow it: speedware that's on, or optics in the dark", () => {
  const kz = [{ name: "Kerenzikov", installed: true }];
  const sande = (disabled) => [{ name: "Militech Sandevistan", installed: true, effects: [{ name: "Sandevistan (active)", disabled }] }];
  const optics = [{ name: "Low Light / Infrared / UV", installed: true }];
  assert.ok(tracksRicochet(kz));
  assert.ok(!tracksRicochet(sande(true)) && tracksRicochet(sande(false)));
  assert.ok(!tracksRicochet(optics, false) && tracksRicochet(optics, true));
  assert.ok(!tracksRicochet([{ name: "Kerenzikov", installed: false }]));
  assert.deepEqual(dodgeAbility({ ref: 8, ricochet: true, tracks: true }), { can: true, why: "ref", blocked: null, penalty: -4 });
  assert.equal(dodgeAbility({ ref: 8, ricochet: true }).blocked, "ricochet");
});

test("a Power crit, a charged Tech shot through thin cover, a Propulsion push and a Smartgun Link each get their look", () => {
  assert.ok(rolledCrit({ wasCritSuccess: () => true }));
  assert.ok(rolledCrit({ faces: [6, 6, 2] }) && !rolledCrit({ faces: [6, 1, 3] }));
  assert.deepEqual(crossings({ x: 0, y: 50 }, { x: 1000, y: 50 }, [{ c: [700, 0, 700, 100] }, { c: [300, 0, 300, 100] }]), [{ x: 300, y: 50 }, { x: 700, y: 50 }]);

  const me = tokenAt(makeActor({ name: "Fury" }), 100, 500);
  const them = tokenAt(makeActor({ name: "Ganger" }), 900, 500);
  canvas.walls.placeables = [wall([500, 0, 500, 1000], { flags: { [M]: { thinCover: true } } })];
  const a = { kind: "attack", ranged: true, mode: "single", tokenId: me.id, targets: [them.id] };
  assert.equal(Shots.charged({ ...a, charged: true, flavor: "tech" }), 1, "one hole punched");
  assert.ok(played.some((s) => call(s, "atLocation")?.[0]?.x === 500), "the ripple is on the wall");

  played.length = 0;
  assert.ok(Shots.powerCrit({ targets: [them.id] }));
  assert.ok(played.some((s) => String(call(s, "file")?.[0]).endsWith("ring-pulse.webp")));
  played.length = 0;
  assert.ok(Shots.pushed({ x: 100, y: 100 }, { x: 300, y: 100 }, { wall: true }));
  assert.ok(played.some((s) => String(call(s, "file")?.[0]).endsWith("trajectory.webp")));

  // A Smartgun Link on a Power gun: the lock-on only, over Automated Animations' own shot.
  assert.equal(shotLook({ ...a, flavor: "power", smartLink: true }), "smartlink");
  played.length = 0;
  assert.ok(Shots.attack({ ...a, flavor: "power", smartLink: true }));
  assert.ok(played.every((s) => String(call(s, "file")?.[0]).endsWith("reticle-white.webp")));
  const actor = crew("Fury", [weapon("w1", "Heavy Pistol (Power)", { weaponType: "heavyPistol" })]);
  const data = { item: actor.items.get("w1"), token: { actor }, workflow: { flags: { [M]: { arsenal: { ...a, flavor: "power", smartLink: true } } } } };
  AA.onWorkflowStart(data, {});
  assert.ok(!data.stopWorkflow);
});

test("a Mono-edge blade in hand puts on Mono-edge Weapon", async () => {
  RebuildRegistry.register({ id: "monoEdge", label: "Mono-edge Blading", match: "mono-?edge", traits: { ignoreBelowSP: 7, tag: "Monoblade" } });
  const actor = crew("Fury", [weapon("w1", "Katana", { isRanged: false, weaponType: "heavyMelee", installedItems: { list: ["u1"] } }), { _id: "u1", name: "Mono-edge Blading", type: "itemUpgrade", system: {} }]);
  assert.deepEqual([...flavorsInHand(actor)], ["mono"]);
  await Equipped.sync(actor);
  assert.ok(Conditions.has("monoRebuild", actor));
  assert.ok(LAYERED.has("monoRebuild"));
  RebuildRegistry.clear();
});

/* ---------------------------------------- */
/*  Tactile Boost                           */
/* ---------------------------------------- */

test("Tactile Boost: a hand on a surface feels motion within 20 m/yds, through any wall, as a ripple where it last moved", async () => {
  const { Tactile, ripples, feltBy, isTactileBoost, TACTILE_RANGE } = await import("../scripts/neonfx/tactile.js");
  await Settings.set("fxTactile", true);
  assert.equal(TACTILE_RANGE, 20);
  assert.ok(isTactileBoost("Tactile Boost") && isTactileBoost("TACTILE  BOOST (Chipware)") && !isTactileBoost("Olfactory Boost"));
  assert.ok(feltBy([{ x: 0, y: 0 }], { x: 600, y: 800 }, 1000) && !feltBy([{ x: 0, y: 0 }], { x: 800, y: 800 }, 1000));
  // Pure: hidden by the GM, in plain view, the viewer, or out of range: no ripple.
  const felt = new Map([["a", { x: 300, y: 0 }], ["b", { x: 300, y: 0 }], ["c", { x: 300, y: 0 }], ["d", { x: 5000, y: 0 }], ["me", { x: 0, y: 0 }]]);
  const tokens = [{ id: "a", hidden: false, visible: false }, { id: "b", hidden: true, visible: false }, { id: "c", hidden: false, visible: true }, { id: "d", hidden: false, visible: false }, { id: "me", hidden: false, visible: true }];
  assert.deepEqual(ripples(felt, tokens, [{ id: "me", x: 0, y: 0 }], 1000), [{ id: "a", x: 300, y: 0 }]);
  assert.deepEqual(ripples(felt, tokens, [], 1000), [], "nobody feeling: nothing");

  // On the canvas (100 px squares of 2 m/yds: 20 m/yds is 1000 px).
  Tactile.reset();
  const fixer = crew("Sable", [{ _id: "tb", name: "Tactile Boost", type: "cyberware", system: { isInstalled: true } }]);
  const me = tokenAt(fixer, 100, 500);
  canvas.tokens.controlled = [me];
  const guard = tokenAt(makeActor({ name: "Guard" }), 600, 500, { visible: false });
  const moveTo = (t, x, y) => {
    t.center = { x: x + 50, y: y + 50 };
    Tactile.moved({ id: t.id, x, y, width: 1, height: 1, parent: canvas.scene });
  };
  moveTo(guard, 600, 450);
  assert.deepEqual(Tactile.wanted(), [], "no hand on the surface: nothing is felt");
  await Conditions.add("tactileBoost", fixer);
  moveTo(guard, 700, 450);
  assert.deepEqual(Tactile.wanted(), [{ id: guard.id, x: 750, y: 500 }], "behind any wall: it's the surface that carries it");
  Tactile.refresh();
  const fx = played.filter((s) => call(s, "name")?.[0] === `ncm-tactile-${guard.id}`);
  assert.equal(fx.length, 2, "two rings a beat apart");
  assert.ok(fx.every((e) => call(e, "locally") && call(e, "persist") && call(e, "xray")), "this player's screen only, through vision");
  assert.ok(!fx.some((e) => call(e, "copySprite")), "a ripple, not the person's outline");
  assert.ok(played.some((s) => call(s, "name")?.[0] === `ncm-tactile-self-${me.id}`), "the reach of the sense, from the hand");

  // They move again: the ripple moves with them. Out past 20 m/yds: gone.
  moveTo(guard, 800, 450);
  Tactile.refresh();
  assert.deepEqual(ended.map((e) => e.name), [`ncm-tactile-${guard.id}`]);
  assert.equal(Tactile.drawn.get(guard.id).x, 850);
  moveTo(guard, 1500, 450);
  assert.deepEqual(Tactile.wanted(), []);
  // The hand comes off: everything goes, and nothing is remembered.
  moveTo(guard, 700, 450);
  await Conditions.remove("tactileBoost", fixer);
  assert.deepEqual(Tactile.wanted(), []);
  assert.equal(Tactile.felt.size, 0);

  // With the chipware installed, the Action HUD's Chrome group has the switch.
  const { catalog } = await import("../scripts/hud/catalog.js");
  assert.ok(catalog(fixer).chrome.some((e) => e.key === "chrome:tactileboost"));
  assert.equal(catalog(crew("V", [])).chrome.length, 0);
  assert.ok(existsSync(path.join(root, "assets/icons/tactile-boost.svg")));
});

/* ---------------------------------------- */
/*  Chrome switches, Kerenzikov, the screen */
/* ---------------------------------------- */

test("chrome switches: what a character can switch on, by what's installed; a Kerenzikov has none", async () => {
  const { switchesOf, kerenzikovOf } = await import("../scripts/neonfx/switches.js");
  const { chromeConditions } = await import("../scripts/neonfx/chrome.js");
  const cw = (id, name, extra = {}) => ({ id, name, type: "cyberware", installed: true, effects: [], in: null, ...extra });
  const up = (id, name, host, extra = {}) => ({ id, name, type: "itemUpgrade", installed: false, effects: [], in: host, ...extra });
  const items = [
    cw("s", "Sandevistan", { effects: [{ name: "Sandevistan (active)", disabled: true }] }),
    up("f", "Militech ‘Falcon’ OS", "s", { effects: [{ name: "Militech ‘Falcon’ OS (active)", disabled: true }] }),
    cw("b", "Berserk"),
    cw("k", "Kerenzikov"), up("kb", "Kerenzikov Boost System", "k"),
    cw("t", "Tactile Boost"), cw("o", "Optical Camo"), cw("m", "Microrotors"), cw("x", "Kaleidoscopic Electric Reflection System (KERS)"),
    cw("d", "DeathTrance", { effects: [{ name: "DeathTrance (active)", disabled: true }] }),
    cw("a", "Adrenaline Convertor", { installed: false, effects: [{ name: "Adrenaline Convertor (active)", disabled: true }] }),
    cw("e", "Cybereye"), up("loose", "Zetatech ‘Brawler’ OS", null)
  ];
  const list = switchesOf(items, chromeConditions());
  assert.deepEqual(list.map((s) => [s.key, s.kind, s.id]), [
    ["chrome:sandevistan", "chrome", "sandevistan"], ["chrome:berserk", "chrome", "berserk"],
    ["chrome:tactileboost", "condition", "tactileBoost"], ["chrome:opticalcamo", "condition", "chromeOpticalCamo"],
    ["chrome:microrotors", "condition", "chromeMicrorotors"], ["chrome:kaleidoscopicelectricreflectionsystemkers", "condition", "chromeKers"],
    ["chrome:deathtrance", "effect", "d"]
  ], "not the Kerenzikov, the Cybereye, chrome that isn't installed, or an Operating System lying loose");
  assert.equal(list[0].label, "Militech ‘Falcon’ OS", "a Sandevistan's switch is named for the Operating System in it");
  assert.equal(list[0].condition, "chromeFalcon");
  assert.equal(list[1].condition, "chromeBerserk", "the loose Brawler OS doesn't run");
  assert.deepEqual(kerenzikovOf(items), { installed: true, boost: true });
  assert.deepEqual(kerenzikovOf([cw("k", "Kerenzikov"), up("kb", "Kerenzikov Boost System", null)]), { installed: true, boost: false });
  assert.deepEqual(kerenzikovOf([cw("k", "Kerenzikov", { installed: false })]), { installed: false, boost: false });
});

test("switching chrome from the Action HUD puts its Active Effect on and takes it off; a Kerenzikov is on once installed", async () => {
  await Settings.set("fxChrome", true);
  const { Switches } = await import("../scripts/neonfx/switches.js");
  const { catalog } = await import("../scripts/hud/catalog.js");
  const { Run } = await import("../scripts/hud/run.js");
  const chromeItem = (id, name, extra = {}) => ({ _id: id, name, type: "cyberware", system: { isInstalled: true, installedItems: { list: [] }, ...extra } });
  const solo = crew("Fury", [chromeItem("b", "Berserk"), chromeItem("o", "Optical Camo"), chromeItem("k", "Kerenzikov", { installedItems: { list: ["kb"] } }),
    { _id: "kb", name: "Kerenzikov Boost System", type: "itemUpgrade", system: { type: "cyberware" } }]);
  solo.isOwner = true;
  const keys = () => catalog(solo).chrome.map((e) => [e.key, !!e.on]);
  assert.deepEqual(keys(), [["chrome:berserk", false], ["chrome:opticalcamo", false]]);

  await Run.action(solo, "chrome:berserk");
  assert.ok(Conditions.has("chromeBerserk", solo), "Berserk runs as its Chrome running condition");
  await Run.action(solo, "chrome:opticalcamo");
  assert.ok(Conditions.has("chromeOpticalCamo", solo));
  assert.deepEqual(keys(), [["chrome:berserk", true], ["chrome:opticalcamo", true]]);
  await Run.action(solo, "chrome:berserk");
  await Switches.toggle(solo, "chrome:opticalcamo", { on: false });
  assert.ok(!Conditions.has("chromeBerserk", solo) && !Conditions.has("chromeOpticalCamo", solo));
  assert.equal(await Switches.toggle(solo, "chrome:nothing"), null);

  // The Kerenzikov: no switch; the GM's client keeps its condition on, with the Boost System's +2 Initiative.
  assert.equal(await Switches.syncKerenzikov(solo), true);
  const [kz] = Conditions.effects(solo, "chromeKerenzikov");
  assert.ok(kz, "on from the day it's installed");
  assert.ok(kz.changes.some((c) => c.key === "bonuses.initiative" && Number(c.value) === 2), "the Boost System's +2 Initiative");
  assert.equal(Registry.get("chromeKerenzikov").hud, false);
  // The Boost System comes out: the condition stays, without the Initiative.
  solo.items.get("k").system.installedItems.list = [];
  await Switches.syncKerenzikov(solo);
  const [plain] = Conditions.effects(solo, "chromeKerenzikov");
  assert.ok(plain && !plain.changes.some((c) => c.key === "bonuses.initiative"));
  assert.ok(plain.changes.some((c) => c.key === "bonuses.perception"), "+2 to notice an Ambush stays, as a tick box");
  // The Kerenzikov comes out: gone.
  solo.items.get("k").system.isInstalled = false;
  assert.equal(await Switches.syncKerenzikov(solo), false);
  assert.ok(!Conditions.has("chromeKerenzikov", solo));
});

test("running chrome on its owner's screen only: Berserk over a Sandevistan over a Kerenzikov, in the Operating System's colour, and a switch to turn it off", async () => {
  const { screenLook, viewpoints, Screen, SCREEN_ID } = await import("../scripts/neonfx/screen.js");
  assert.equal(screenLook([]), null);
  assert.deepEqual(screenLook([{ kerenzikov: true }]), { kind: "kerenzikov", tint: "#3d8bff" });
  assert.deepEqual(screenLook([{ kerenzikov: true, sandevistan: "falcon" }]), { kind: "sandevistan", tint: "#00e5ff" });
  assert.deepEqual(screenLook([{ sandevistan: true }, { berserk: true }]), { kind: "berserk", tint: "#ff1744" });
  assert.equal(screenLook([{ berserk: true }], { enabled: false }), null, "the player's own switch");
  // Whose eyes: your character; selected tokens you own; a GM's NPC only while it's selected.
  const mine = { id: "a", isOwner: true };
  const npc = { id: "n", isOwner: true };
  const theirs = { id: "t", isOwner: false };
  assert.deepEqual(viewpoints({ character: mine, controlled: [npc, theirs], isGM: false }).map((a) => a.id), ["a", "n"]);
  assert.deepEqual(viewpoints({ character: mine, controlled: [npc], isGM: true }).map((a) => a.id), ["a", "n"]);
  assert.deepEqual(viewpoints({ controlled: [npc], isGM: true }).map((a) => a.id), ["n"]);
  assert.deepEqual(viewpoints({ controlled: [], isGM: true }), []);

  // On a page: the layer goes up while it runs and comes down after, and never takes a click (the stylesheet).
  const made = [];
  const el = () => ({ id: "", dataset: {}, style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, classList: { set: new Set(), toggle(c, on) { on ? this.set.add(c) : this.set.delete(c); } }, setAttribute() {}, remove() { made.length = 0; } });
  globalThis.document = { getElementById: (id) => made.find((e) => e.id === id) ?? null, createElement: () => el(), body: { append: (e) => made.push(e) } };
  await Settings.set("fxScreen", true);
  const solo = crew("Fury", []);
  solo.isOwner = true;
  const savedChar = game.user.character;
  game.user.character = solo;
  assert.equal(Screen.refresh(), null);
  await Conditions.add("chromeFalcon", solo);
  assert.deepEqual(Screen.refresh(), { kind: "sandevistan", tint: "#00e5ff" });
  assert.equal(made[0].id, SCREEN_ID);
  assert.equal(made[0].dataset.kind, "sandevistan");
  assert.equal(made[0].style.props["--ncm-screen-tint"], "#00e5ff");
  await Settings.set("fxScreen", false);
  assert.equal(Screen.refresh(), null);
  assert.equal(made.length, 0, "switched off: the layer is gone");
  await Settings.set("fxScreen", true);
  await Conditions.remove("chromeFalcon", solo);
  assert.equal(Screen.refresh(), null);
  game.user.character = savedChar;
  delete globalThis.document;
  const css = readFileSync(path.join(root, "styles/neon-combat.css"), "utf8");
  assert.match(css, /#ncm-screen-fx \{[^}]*pointer-events: none/);
});

/* ---------------------------------------- */
/*  A weapon's own rules, from its card     */
/* ---------------------------------------- */

test("a weapon's own rules are read from its card: bursts, Autofire rounds, Aimed Shot dice, ablation, Critical Injuries, modifiers, limits", async () => {
  const { parseSpecials, specialMods, moreDice, ruleCrit, ruleText } = await import("../scripts/arsenal/specials.js");
  const card = (rule) => `<p>${rule}</p><p><strong>Class:</strong> Heavy Pistol • SMART <strong>Damage:</strong> 3d6/2d6</p><p><small>Item Compendium (2070) • Weapons</small></p>`;
  assert.equal(ruleText(card("Aimed Shots deal +1d6 (6d6).")), "Aimed Shots deal +1d6 (6d6).", "the stat lines aren't rules");
  assert.deepEqual(parseSpecials(card("Single Shot fires a 3-round burst. With fewer than 3 left, it empties the magazine for 2d6.")),
    { burst: { rounds: 3, every: false, short: "empty", shortDamage: "2d6" } });
  assert.deepEqual(parseSpecials(card("Single Shot fires a 2-round burst; with fewer than 2 left, it empties the magazine for 2d6.")).burst, { rounds: 2, every: false, short: "empty", shortDamage: "2d6" });
  assert.deepEqual(parseSpecials(card("Every shot is a 3-round burst; it won't fire with fewer than 3 left. Ablates 1 extra SP (2, or 3 with Armor-Piercing).")),
    { burst: { rounds: 3, every: true, short: "refuse", shortDamage: null }, ablate: { extra: 1, charged: null } });
  assert.deepEqual(parseSpecials(card("Autofire uses 6 rounds instead of 10.")), { autofire: { rounds: 6, shells: false } });
  assert.deepEqual(parseSpecials(card("Ablates 2 extra SP (3 charged).")), { ablate: { extra: 2, charged: 3 } });
  assert.deepEqual(parseSpecials(card("No Aimed Shots. −2 to every attack. Its Power Rebuild can't ricochet.")), { attackMod: -2, noAimed: true, noRicochet: true });
  assert.deepEqual(parseSpecials(card("On an Aimed Shot, 5s count as 6s for Critical Injuries. Still halves SP when thrown.")), { crit: { face: 5, when: "aimed" } });
  assert.deepEqual(parseSpecials(card("+1 to Aimed Shots and Autofire.")), { aimedMod: 1, autofireMod: 1 });
  // Lines that only sound alike are left to the table.
  assert.deepEqual(parseSpecials(card("Two-handed: +1 to Aimed Shots and Autofire.")), { twoHanded: { attack: 0, aimed: 1, autofire: 1 } }, "for the weapon's Two hands switch");
  assert.deepEqual(parseSpecials(card("Loads only its own Armor-Piercing shells (100eb per 10), which ablate 1 extra SP.")), { ablate: { extra: 1, charged: null }, ap: true }, "it loads nothing else, so its rounds' rules are the gun's");
  assert.equal(parseSpecials(card("Leg and Held Item Aimed Shots deal +1d6 (6d6); head Aimed Shots deal −1d6 (4d6).")), null);
  assert.equal(parseSpecials("<p>Generic weapon (standard quality).</p>"), null);

  assert.deepEqual(specialMods({ attackMod: -2, aimedMod: 1 }, { aimed: true, name: "Moron Labe", moduleId: M }), [{ id: `${M}-special`, value: -1, source: "Moron Labe", key: "bonuses.universalAttack", category: "combat" }]);
  assert.deepEqual(specialMods({ aimedMod: 1 }, { aimed: false }), []);
  assert.equal(moreDice("5d6", 1), "6d6");
  assert.equal(moreDice("3d6+2", 2), "5d6+2");
  const five = { crit: { face: 5, when: "always" } };
  assert.ok(ruleCrit(five, [5, 6, 2]) && ruleCrit(five, [5, 5, 1]));
  assert.ok(!ruleCrit(five, [6, 6, 1]), "two 6s is the plain rule's");
  assert.ok(!ruleCrit(five, [5, 4, 4]));
  assert.ok(!ruleCrit({ crit: { face: 5, when: "aimed" } }, [5, 6]) && ruleCrit({ crit: { face: 5, when: "aimed" } }, [5, 6], { aimed: true }));
});

test("on the rolls: a burst named on the card and its short damage, Aimed Shot dice, extra ablation, the weapon's Critical Injury rule, its modifier; no Aimed button where it can't", async () => {
  const SYS = "cyberpunk-red-core";
  const desc = (rule) => ({ value: `<p>${rule}</p><p><strong>Class:</strong> x</p>` });
  class CPRDamageRoll { constructor(formula) { this.formula = formula; this.mods = []; this.rollCardExtraArgs = { ablationValue: 1 }; this.bonusDamage = 5; } }
  game.user.targets = new Set();

  // The Yukimura: a 3-round burst; with 2 left it empties the magazine for 2d6.
  const fury = crew("Fury", [weapon("w1", "Arasaka HJKE-11 Yukimura", { weaponType: "heavyPistol", damage: "3d6", magazine: { value: 2, max: 21 }, description: desc("Single Shot fires a 3-round burst. With fewer than 3 left, it empties the magazine for 2d6.") })]);
  const gun = fury.items.get("w1");
  const atk = new CPRAttackRoll([]);
  Arsenal.preDialog(gun, atk);
  await Arsenal.preRoll(gun, atk);
  assert.deepEqual(Arsenal.pending.tag.burst, { rounds: 2, short: true, damage: "2d6" });
  const dmg = new CPRDamageRoll("3d6");
  await Arsenal.preRoll(gun, dmg);
  assert.equal(dmg.formula, "2d6", "fired short: the card's damage");
  assert.equal(Arsenal.pending.tag.shortBurst, "2d6");
  gun.system.magazine.value = 9;
  const full = new CPRAttackRoll([]);
  Arsenal.preDialog(gun, full);
  await Arsenal.preRoll(gun, full);
  assert.deepEqual(Arsenal.pending.tag.burst, { rounds: 3, short: false, damage: null });
  const dmg2 = new CPRDamageRoll("3d6");
  await Arsenal.preRoll(gun, dmg2);
  assert.equal(dmg2.formula, "3d6", "a full burst: its own damage again");

  // Aimed Shots +1d6, 1 extra SP ablated, 5s count as 6s, −2 to every attack.
  const sable = crew("Sable", [weapon("w1", "Dezerter", { weaponType: "shotgun", damage: "5d6", description: desc("Aimed Shots deal +1d6 (6d6). Ablates 1 extra SP. 5s count as 6s for Critical Injuries. −2 to every attack. No Aimed Shots.") })]);
  const sg = sable.items.get("w1");
  const a2 = new CPRAttackRoll([]);
  assert.ok(Arsenal.preDialog(sg, a2).special);
  assert.deepEqual(a2.mods.map((m) => [m.id, m.value, m.source]), [[`${M}-special`, -2, "Dezerter"]], "on the roll before its dialog, by the weapon's name");
  await Arsenal.preRoll(sg, a2);
  assert.equal(a2.mods.length, 1, "once");
  assert.equal(Arsenal.pending.tag.specialMod, -2);
  sable.flags[SYS] = { "firetype-w1": "aimed" };
  const d3 = new CPRDamageRoll("5d6");
  await Arsenal.preRoll(sg, d3);
  assert.equal(d3.formula, "6d6");
  assert.equal(d3.rollCardExtraArgs.ablationValue, 2);
  assert.deepEqual(Arsenal.pending.tag.critRule, { face: 5, when: "always", aimed: true, head: false, distance: null });
  // The card: a 5 and a 6 is a Critical Injury by this weapon's rule; two 6s is the plain rule's.
  const msg = (roll) => {
    const m = { content: '<div class="rollcard"></div>', flags: {}, updateSource(u) { Object.assign(this.flags, u); } };
    Arsenal.pending.roll = roll;
    Arsenal.tag(m, game.user.id);
    return m.flags[`flags.${M}.arsenal`];
  };
  d3.faces = [5, 6, 1, 2, 3, 4];
  assert.equal(msg(d3).ruleCrit, 5);
  await Arsenal.preRoll(sg, d3);
  d3.faces = [6, 6, 1, 2, 3, 4];
  assert.equal(msg(d3).ruleCrit, undefined);
  sable.flags[SYS] = {};
  const d4 = new CPRDamageRoll("5d6");
  await Arsenal.preRoll(sg, d4);
  assert.equal(d4.formula, "5d6", "not an Aimed Shot: no extra die");

  // The Action HUD: no Aimed button on a weapon that can't; an ordinary gun keeps it.
  const { catalog } = await import("../scripts/hud/catalog.js");
  assert.ok(!catalog(sable).weapons[0].buttons.some((b) => b.key === "aim:w1"));
  assert.ok(catalog(fury).weapons[0].buttons.some((b) => b.key === "aim:w1"));
  for (const k of ["burst", "burstShort", "burstShortDamage", "autofireRounds", "specialMod", "shortBurstDamage", "aimedDice", "ablate", "ruleCrit"]) assert.notEqual(game.i18n.localize(`NEONCOMBAT.Arsenal.Note.${k}`), `NEONCOMBAT.Arsenal.Note.${k}`, k);
});

test("the rest of the first part: Bonus Damage, Armor-Piercing rounds, the first shot of a fight, two hands, Autofire-only guns, charged shots that stop at cover, scopes that read Thick cover", async () => {
  const { parseSpecials, specialMods, singleShots } = await import("../scripts/arsenal/specials.js");
  const desc = (rule) => ({ value: `<p>${rule}</p><p><strong>Class:</strong> x</p>` });
  const P = (rule) => parseSpecials(desc(rule).value);
  assert.deepEqual(P("Critical Injuries deal +3 Bonus Damage (8)."), { critBonus: 3 });
  assert.deepEqual(P("Its Critical Injuries deal +5 Bonus Damage (10) and −2 MOVE (min 1) for 1 Round."), { critBonus: 5 });
  assert.equal(P("In the Round you draw it: head Aimed Shots count 5s as 6s for Critical Injuries."), null, "tied to the Round it's drawn: the table's");
  assert.deepEqual(P("An Aimed Shot fires 2 rounds for +1d6 (6d6)."), { aimedRounds: 2, aimedDice: 1 });
  assert.deepEqual(P("+1 to hit on its first Single Shot of a fight."), { firstShot: 1 });
  assert.deepEqual(P("No capacity attachments; every round also counts as Armor-Piercing."), { ap: true, noCapacity: true });
  assert.deepEqual(P("Excellent Quality two-handed."), { twoHanded: { attack: 1, aimed: 0, autofire: 0 } });
  assert.deepEqual(P("Autofire and Suppressive Fire only, 20 rounds each."), { autoOnly: true });
  assert.deepEqual(P("No Autofire."), { noAutofire: true });
  assert.deepEqual(P("Charged, it can't see or fire through cover and can only Autofire."), { chargedAutoOnly: true, noThrough: true });
  assert.deepEqual(P("Its Tech scope sees outlines through one layer of Thin or Thick cover."), { scopeThick: true });
  assert.ok(singleShots(null) && !singleShots({ autoOnly: true }) && singleShots({ chargedAutoOnly: true }) && !singleShots({ chargedAutoOnly: true }, true));
  const two = { twoHanded: { attack: 0, aimed: 1, autofire: 1 } };
  assert.equal(specialMods(two, { aimed: true, twoHands: true })[0].value, 1);
  assert.deepEqual(specialMods(two, { aimed: true, twoHands: false }), [], "one-handed: nothing");
  assert.deepEqual(specialMods(two, { twoHands: true }), [], "a plain shot: nothing");
  assert.equal(specialMods({ firstShot: 1 }, { firstShot: true })[0].value, 1);
  assert.deepEqual(specialMods({ firstShot: 1 }, { firstShot: true, aimed: true }), []);

  class CPRDamageRoll { constructor(formula) { this.formula = formula; this.mods = []; this.rollCardExtraArgs = { ablationValue: 1 }; this.bonusDamage = 5; } }
  game.user.targets = new Set();
  const solo = crew("Fury", [
    weapon("w1", "Comrade’s Hammer", { weaponType: "vHeavyPistol", description: desc("Critical Injuries deal +3 Bonus Damage (8). Every round also counts as Armor-Piercing. +1 to hit on its first Single Shot of a fight. Excellent Quality two-handed.") }),
    weapon("w2", "Militech Mk. 31 HMG", { weaponType: "assaultRifle", fireModes: { autoFire: 4, suppressiveFire: true }, description: desc("Autofire and Suppressive Fire only, 20 rounds each.") }),
    weapon("w3", "Senkoh (Tech)", { weaponType: "heavySmg", fireModes: { autoFire: 3 }, description: desc("While its Tech Rebuild is charged, it can only Autofire.") })
  ]);
  solo.isOwner = true;
  const gun = solo.items.get("w1");
  const d = new CPRDamageRoll("4d6");
  await Arsenal.preRoll(gun, d);
  assert.equal(d.bonusDamage, 8);
  assert.equal(d.rollCardExtraArgs.ablationValue, 2, "as Armor-Piercing ablates");

  // The first Single Shot of a fight gets +1, once; two hands add Excellent Quality's +1 while the switch is on.
  const savedCombat = game.combat;
  game.combat = { id: "fight1", started: true, combatants: [] };
  const first = new CPRAttackRoll([]);
  Arsenal.preDialog(gun, first);
  assert.equal(first.mods[0].value, 1);
  await Arsenal.preRoll(gun, first);
  const second = new CPRAttackRoll([]);
  Arsenal.preDialog(gun, second);
  assert.equal(second.mods.length, 0, "not the second shot");
  assert.equal(await Arsenal.toggle(solo, gun, "twoHands"), true);
  const third = new CPRAttackRoll([]);
  Arsenal.preDialog(gun, third);
  assert.equal(third.mods[0].value, 1, "Excellent Quality in two hands");
  game.combat = { id: "fight2", started: true, combatants: [] };
  const again = new CPRAttackRoll([]);
  Arsenal.preDialog(gun, again);
  assert.equal(again.mods[0].value, 2, "a new fight: the first shot again, and still two hands");
  game.combat = savedCombat;

  // The Action HUD: Two hands on the pistol; no Attack or Aimed on an Autofire-only gun, or on one that's charged.
  const { catalog } = await import("../scripts/hud/catalog.js");
  const { Run } = await import("../scripts/hud/run.js");
  const keys = (name) => catalog(solo).weapons.find((w) => w.label === name).buttons.map((b) => b.key.split(":")[0]);
  assert.ok(keys("Comrade’s Hammer").includes("2h"));
  assert.ok(!keys("Militech Mk. 31 HMG").includes("atk") && !keys("Militech Mk. 31 HMG").includes("aim") && keys("Militech Mk. 31 HMG").includes("auto"));
  assert.equal(await Run.action(solo, "atk:w2"), null, "refused, with the reason");
  assert.ok(keys("Senkoh (Tech)").includes("atk"));
  await Rebuilds.toggleCharge(solo, solo.items.get("w3"));
  assert.ok(!keys("Senkoh (Tech)").includes("atk") && keys("Senkoh (Tech)").includes("auto"), "charged: Autofire only");

  // A scope that reads one layer of Thick cover: one solid wall, not two; an ordinary scope, thin only.
  const solid = { c: [500, 0, 500, 1000], blocks: true, thin: false };
  const thin = { c: [700, 0, 700, 1000], blocks: true, thin: true };
  const a = { x: 100, y: 500 };
  assert.ok(!throughThinCover(a, { x: 600, y: 500 }, [solid]));
  assert.ok(throughThinCover(a, { x: 600, y: 500 }, [solid], { thick: 1 }));
  assert.ok(!throughThinCover(a, { x: 900, y: 500 }, [solid, thin], { thick: 1 }), "one layer in all");
  assert.ok(!throughThinCover(a, { x: 900, y: 500 }, [solid, { ...solid, c: [800, 0, 800, 1000] }], { thick: 1 }));
  for (const k of ["ap", "critBonus"]) assert.notEqual(game.i18n.localize(`NEONCOMBAT.Arsenal.Note.${k}`), `NEONCOMBAT.Arsenal.Note.${k}`);
});

test("the last of the first part: rules by the head or a range, dice that drop the lowest, what a charge costs, Aimed Shots that are hard to dodge", async () => {
  const { parseSpecials, ruleCrit } = await import("../scripts/arsenal/specials.js");
  const desc = (rule) => ({ value: `<p>${rule}</p><p><strong>Class:</strong> x</p>` });
  const P = (rule) => parseSpecials(desc(rule).value);
  assert.deepEqual(P("On a head Aimed Shot, 5s count as 6s for Critical Injuries."), { crit: { face: 5, when: "head" } });
  assert.deepEqual(P("Within 6m, 5s count as 6s for Critical Injuries."), { crit: { face: 5, when: "within", range: 6 } });
  assert.deepEqual(P("Head Critical Injuries deal +5 Bonus Damage."), { critBonusHead: 5 });
  assert.deepEqual(P("Aimed Shots deal 6d6, dropping the lowest."), { aimedDrop: "6d6dl1" });
  assert.deepEqual(P("Autofire damage: roll 3d6, drop the lowest, then multiply."), { autofireDrop: "3d6dl1" });
  assert.deepEqual(P("Its Tech Rebuild charges without a Move Action."), { chargeCost: "free" });
  assert.deepEqual(P("Charging takes only half your MOVE (round down), given up before you move."), { chargeCost: "half" });
  assert.deepEqual(P("Dodging its Aimed Shots or Held Action shots takes −2."), { aimedDodge: -2 });
  const head = { crit: { face: 5, when: "head" } };
  assert.ok(ruleCrit(head, [5, 6], { aimed: true, head: true }) && !ruleCrit(head, [5, 6], { aimed: true, head: false }));
  const near = { crit: { face: 5, when: "within", range: 6 } };
  assert.ok(ruleCrit(near, [5, 5], { distance: 4 }) && !ruleCrit(near, [5, 5], { distance: 8 }) && !ruleCrit(near, [5, 5], {}));

  class CPRDamageRoll { constructor(formula) { this.formula = formula; this.mods = []; this.rollCardExtraArgs = { ablationValue: 1 }; this.bonusDamage = 5; this.location = "body"; } }
  game.user.targets = new Set();
  const solo = crew("Fury", [weapon("w1", "Death And Taxes", { weaponType: "heavyPistol", description: desc("Aimed Shots deal 4d6, dropping the lowest. Head Critical Injuries deal +5 Bonus Damage. Autofire damage: roll 3d6, drop the lowest, then multiply. Dodging its Aimed Shots or Held Action shots takes −2.") })]);
  const gun = solo.items.get("w1");
  solo.flags["cyberpunk-red-core"] = { "firetype-w1": "aimed" };
  const d = new CPRDamageRoll("3d6");
  d.location = "head";
  await Arsenal.preRoll(gun, d);
  assert.equal(d.formula, "4d6dl1");
  assert.equal(d.bonusDamage, 10, "a head Aimed Shot");
  const body = new CPRDamageRoll("3d6");
  await Arsenal.preRoll(gun, body);
  assert.equal(body.bonusDamage, 5, "an Aimed Shot elsewhere: the plain Bonus Damage");
  const atk = new CPRAttackRoll([]);
  await Arsenal.preRoll(gun, atk);
  assert.equal(Arsenal.pending.tag.dodgePenalty, -2);
  solo.flags["cyberpunk-red-core"] = { "firetype-w1": "autofire" };
  const auto = new CPRDamageRoll("2d6");
  auto.isAutofire = true;
  await Arsenal.preRoll(gun, auto);
  assert.equal(auto.formula, "3d6dl1");
  for (const k of ["Arsenal.Note.dropLowest", "Arsenal.ChargeBodyFree", "Arsenal.ChargeBodyHalf", "Arsenal.Defense.WeaponDodge"]) assert.notEqual(game.i18n.localize(`NEONCOMBAT.${k}`), `NEONCOMBAT.${k}`, k);
});

/* ---------------------------------------- */
/*  Weapons' own rules, second part         */
/* ---------------------------------------- */

test("second part: what a weapon does to its targets and asks of its shooter, its ammo and its reloading", async () => {
  const { parseSpecials, wielderCheck, CAPACITY } = await import("../scripts/arsenal/specials.js");
  const desc = (rule) => ({ value: `<p>${rule}</p><p><strong>Class:</strong> x</p>` });
  const P = (rule) => parseSpecials(desc(rule).value);
  assert.deepEqual(P("Sets what it damages Strongly On Fire."), { effect: { id: "onFireStrong" } });
  assert.deepEqual(P("Anyone it hits must beat DV15 Athletics or go Prone."), { effect: { id: "prone", dv: 15, skill: "Athletics" } });
  assert.deepEqual(P("BODY 11+ unless mounted."), { bodyReq: { body: 11, proneBody: null, prone: false, cyberarm: false } });
  assert.deepEqual(P("BODY 13+ (or 11+ and Prone) unless mounted.").bodyReq, { body: 13, proneBody: 11, prone: false, cyberarm: false });
  assert.deepEqual(P("BODY 9+ or Prone unless mounted.").bodyReq, { body: 9, proneBody: null, prone: true, cyberarm: false });
  assert.deepEqual(P("BODY 9+ or a cyberarm unless mounted.").bodyReq, { body: 9, proneBody: null, prone: false, cyberarm: true });
  assert.deepEqual(P("Without BODY 8+ or a cyberarm, firing gives you Torn Muscle; on Autofire without BODY 10+ or a cyberarm, a Broken Arm."),
    { recoil: { body: 8, arms: 1, injury: "tornMuscle" }, recoilAuto: { body: 10, arms: 1, injury: "brokenArm" } });
  assert.deepEqual(P("Fire it without BODY 12+ or paired cyberarms and you suffer Torn Muscle (if you don't have it already)."), { recoil: { body: 12, arms: 2, injury: "tornMuscle" } });
  assert.equal(P("With BODY 10+, its Critical Injuries deal +3 Bonus Damage (8)."), null, "not a requirement");
  assert.deepEqual(P("No capacity attachments, Improved Smart Ammunition only."), { ammoOnly: "smart", noCapacity: true });
  assert.deepEqual(P("Armor-Piercing only, at the price of Basic (this gun only)."), { ammoOnly: "armorPiercing" });
  assert.deepEqual(P("Reloading takes two Reload Actions."), { reload: { actions: 2, move: null } });
  assert.deepEqual(P("With one hand free, reload by giving up your Move Action."), { reload: { actions: 1, move: "oneHand" } });
  assert.deepEqual(P("Its rounds carry damage through cover like an Explosive."), { throughCover: true });
  assert.ok(CAPACITY.test("Extended Magazine") && CAPACITY.test("Drum Magazine") && !CAPACITY.test("Smartgun Link"));

  const heavy = { bodyReq: { body: 13, proneBody: 11, prone: false, cyberarm: false } };
  assert.deepEqual(wielderCheck(heavy, { body: 12 }).short, { need: 13, have: 12 });
  assert.equal(wielderCheck(heavy, { body: 12, prone: true }).short, null, "Prone, 11 is enough");
  assert.equal(wielderCheck({ bodyReq: { body: 9, cyberarm: true } }, { body: 5, cyberarms: 1 }).short, null);
  const kick = { recoil: { body: 8, arms: 1, injury: "tornMuscle" }, recoilAuto: { body: 10, arms: 1, injury: "brokenArm" } };
  assert.equal(wielderCheck(kick, { body: 7 }).injury, "tornMuscle");
  assert.equal(wielderCheck(kick, { body: 9 }).injury, null);
  assert.equal(wielderCheck(kick, { body: 9 }, { autofire: true }).injury, "brokenArm", "Autofire asks for more");
  assert.equal(wielderCheck(kick, { body: 5, cyberarms: 1 }, { autofire: true }).injury, null, "a cyberarm takes it");

  // On the rolls.
  class CPRDamageRoll { constructor(formula) { this.formula = formula; this.mods = []; this.rollCardExtraArgs = { ablationValue: 1 }; this.bonusDamage = 5; } }
  game.user.targets = new Set();
  const ammo = { _id: "a1", name: "Basic Shotgun Slugs", type: "ammo", system: { variety: "shotgunSlug", type: "basic", amount: 10 } };
  const solo = crew("Fury", [weapon("w1", "Alabai", { weaponType: "shotgun", installedItems: { list: ["a1"] }, description: desc("Without BODY 8+ or a cyberarm, firing gives you Torn Muscle. BODY 11+ unless mounted. Sets what it damages Strongly On Fire. Armor-Piercing only, at the price of Basic. Its rounds carry damage through cover like an Explosive.") }), ammo]);
  solo.system.stats = { body: { value: 6 } };
  const gun = solo.items.get("w1");
  await Arsenal.preRoll(gun, new CPRAttackRoll([]));
  const t = Arsenal.pending.tag;
  assert.deepEqual(t.bodyShort, { need: 11, have: 6 });
  assert.equal(t.recoil, "tornMuscle");
  assert.ok(Conditions.has("tornMuscle", solo), "the injury is on the shooter");
  assert.equal(t.wrongAmmo, "armorPiercing");
  await Arsenal.preRoll(gun, new CPRAttackRoll([]));
  assert.equal(Conditions.effects(solo, "tornMuscle").length, 1, "not twice");
  await Arsenal.preRoll(gun, new CPRDamageRoll("5d6"));
  assert.deepEqual(Arsenal.pending.tag.effect, { id: "onFireStrong" });
  assert.equal(Arsenal.pending.tag.throughCover, true);
  // The damage card's button puts the condition on the targets, through the GM.
  const asked = [];
  const { Socket } = await import("../scripts/socket.js");
  const request = Socket.request;
  Socket.request = async (action, data) => asked.push([action, data]);
  await Arsenal.applyEffect({ effect: { id: "onFireStrong" }, targets: ["t1", "t2"] });
  Socket.request = request;
  assert.deepEqual(asked, [["arsenalConditions", { scene: "sc1", tokens: ["t1", "t2"], ids: ["onFireStrong"] }]]);
  // Someone with the BODY for it: nothing.
  const big = crew("Stop Sign", [weapon("w1", "Alabai", { weaponType: "shotgun", description: gun.system.description })]);
  big.system.stats = { body: { value: 12 } };
  await Arsenal.preRoll(big.items.get("w1"), new CPRAttackRoll([]));
  assert.ok(!Arsenal.pending.tag.bodyShort && !Arsenal.pending.tag.recoil && !Conditions.has("tornMuscle", big));
  for (const k of ["Note.bodyShort", "Note.recoil", "Note.wrongAmmo", "Note.effect", "Note.effectDv", "Note.throughCover", "EffectButton", "NoCapacity", "AmmoOnly.smart", "ReloadRule.actions", "ReloadRule.oneHand", "ReloadRule.twoHanded", "ReloadRule.always"]) assert.notEqual(game.i18n.localize(`NEONCOMBAT.Arsenal.${k}`), `NEONCOMBAT.Arsenal.${k}`, k);
});

test("second part, the rest: Weapon Strain while a heavy weapon is held, a gun's own rounds, target checks on the card, a weapon's own blast size", async () => {
  const { parseSpecials, strainOf } = await import("../scripts/arsenal/specials.js");
  const { STRAIN } = await import("../scripts/arsenal/equipped.js");
  const { classify } = await import("../scripts/arsenal/kinds.js");
  const desc = (rule) => ({ value: `<p>${rule}</p><p><strong>Class:</strong> x</p>` });
  const P = (rule) => parseSpecials(desc(rule).value);
  assert.deepEqual(P("Without BODY 10+ or paired cyberarms, −1 DEX and MOVE while held.").heldPenalty, { body: 10, arms: 2, value: -1, stats: ["dex", "move"] });
  assert.deepEqual(P("Without BODY 14+, −2 REF, DEX and MOVE while you hold it.").heldPenalty, { body: 14, arms: 0, value: -2, stats: ["ref", "dex", "move"] });
  assert.deepEqual(P("BODY 14+ or −2 MOVE while held.").heldPenalty, { body: 14, arms: 0, value: -2, stats: ["move"] });
  assert.deepEqual(P("−2 MOVE while held (min 4).").heldPenalty, { body: null, arms: 0, value: -2, stats: ["move"] });
  const osprey = P("Without BODY 10+ or paired cyberarms, −2 MOVE while held and Torn Muscle when fired.");
  assert.deepEqual(osprey.recoil, { body: 10, arms: 2, injury: "tornMuscle" });
  assert.deepEqual(strainOf([{ body: 10, arms: 2, value: -1, stats: ["dex", "move"] }, { body: 14, arms: 0, value: -2, stats: ["move"] }], { body: 9 }), { dex: -1, move: -2 }, "the worst of each");
  assert.equal(strainOf([{ body: 10, arms: 2, value: -1, stats: ["dex"] }], { body: 5, cyberarms: 2 }), null, "paired cyberarms carry it");
  assert.deepEqual(strainOf([{ body: null, arms: 0, value: -2, stats: ["move"] }], { body: 20 }), { move: -2 }, "heavy for anyone");

  assert.deepEqual(P("Loads only its own Incendiary rounds (50eb per 10), which set targets Strongly On Fire and also count as Armor-Piercing."), { effect: { id: "onFireStrong" }, ap: true });
  assert.deepEqual(P("Loads only its own High Velocity rounds (500eb per 10), which carry damage past destroyed cover."), { throughCover: true });
  assert.deepEqual(P("Its own Armor-Piercing rounds cost 20eb per 10 and fit only this gun."), { ap: true });
  const ear = P("On a hit, the target rolls DV15 Resist Torture/Drugs or suffers Damaged Ear (no Bonus Damage).");
  assert.equal(ear.check.dv, 15);
  assert.equal(ear.check.skill, "Resist Torture/Drugs");
  assert.deepEqual(ear.effect, { id: "damagedEar", dv: 15, skill: "Resist Torture/Drugs", own: true });
  const tox = P("Aimed Shots deal +1d6 (4d6), and a meat target must also beat DV17 Resist Torture/Drugs or take 3d6 more, ignoring armor.");
  assert.equal(tox.check.dv, 17);
  assert.equal(tox.effect, undefined, "nothing the module has a condition for: the card says it");
  assert.equal(P("Its grenades burst in a 6×6m area.").area, 6);
  const maw = { name: "Modern Assault Weapon", system: { weaponType: "grenadeLauncher", isRanged: true, description: desc("Its grenades burst in a 6×6m area.") } };
  assert.deepEqual(classify(maw, null, []).area, { shape: "rect", size: 6 });
  assert.deepEqual(classify({ ...maw, system: { ...maw.system, description: desc("") } }, null, []).area, { shape: "rect", size: 10 });

  // In hand without the BODY for it: Weapon Strain, with the card's numbers; stowed, it goes.
  const runner = crew("Lattice", [weapon("w1", "Nokota D6 Hawk", { weaponType: "assaultRifle", description: desc("Without BODY 10+ or paired cyberarms, −1 DEX and MOVE while held.") })]);
  runner.system.stats = { body: { value: 5 } };
  await Equipped.sync(runner);
  const [fx] = Conditions.effects(runner, STRAIN);
  assert.ok(fx, "on while it's held");
  assert.deepEqual(fx.changes.map((c) => [c.key, Number(c.value)]).sort(), [["system.stats.dex.value", -1], ["system.stats.move.value", -1]]);
  await Equipped.sync(runner);
  assert.equal(Conditions.effects(runner, STRAIN).length, 1, "kept, not stacked");
  runner.items.get("w1").system.equipped = "carried";
  await Equipped.sync(runner);
  assert.ok(!Conditions.has(STRAIN, runner));
  runner.items.get("w1").system.equipped = "equipped";
  runner.system.stats.body.value = 11;
  await Equipped.sync(runner);
  assert.ok(!Conditions.has(STRAIN, runner), "with the BODY for it: nothing");
  // The damage card carries the weapon's check in the card's words.
  class CPRDamageRoll { constructor(formula) { this.formula = formula; this.mods = []; this.rollCardExtraArgs = { ablationValue: 1 }; this.bonusDamage = 5; } }
  game.user.targets = new Set();
  const med = crew("Doc Mags", [weapon("w1", "Shrieker", { weaponType: "heavyPistol", description: desc("On a hit, the target rolls DV15 Resist Torture/Drugs or suffers Damaged Ear (no Bonus Damage).") })]);
  await Arsenal.preRoll(med.items.get("w1"), new CPRDamageRoll("3d6"));
  assert.match(Arsenal.pending.tag.check, /DV15 Resist Torture\/Drugs/);
  assert.equal(Arsenal.pending.tag.effect.id, "damagedEar");
  assert.ok(existsSync(path.join(root, "assets/icons/weapon-strain.svg")));
});
