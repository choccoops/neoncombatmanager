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
const { RebuildRegistry } = await import("../scripts/arsenal/rebuilds.js");
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
  assert.deepEqual(done, { unobscured: -4, split: true });
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

  // With the chipware installed, the Action HUD's Status group has the switch.
  const { catalog } = await import("../scripts/hud/catalog.js");
  assert.ok(catalog(fixer).status.some((e) => e.key === "cond:tactileBoost"));
  assert.ok(!catalog(crew("V", [])).status.some((e) => e.key === "cond:tactileBoost"));
  assert.ok(existsSync(path.join(root, "assets/icons/tactile-boost.svg")));
});
