/** Security systems: the devices, what each watches, and what happens at the table. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeActor, makeCombat, registerSettings, asGM } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();
const D = await import("../scripts/security/security-data.js");
const { Security } = await import("../scripts/security/security.js");
const { Cards } = await import("../scripts/combat/cards.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { Climb } = await import("../scripts/senses/climb.js");
const { Dv } = await import("../scripts/arsenal/dv.js");
const { Socket } = await import("../scripts/socket.js");
for (const [a, fn] of Object.entries({ secStep: "_step", secSearch: "_search", secCounter: "_counter", secControl: "_control", secToggle: "_toggle" })) Socket.on(a, (data, userId) => Security[fn](data, userId));

test("devices (pure): every kind, what it's given, who it leaves alone", () => {
  assert.equal(D.KIND_IDS.length, 13, "the corebook's three Emplaced and ten Environmental defenses");
  assert.equal(D.cleanDevice({ kind: "nope" }), null);
  const cam = D.cleanDevice({ kind: "camera" });
  assert.deepEqual([cam.hp, cam.hpMax, cam.range, cam.angle, cam.node, cam.on], [5, 5, 20, 90, 8, true]);
  const t = D.cleanDevice({ kind: "turret", hp: 99, angle: 999, weapon: "bazooka", passes: ["a", "a", 7] });
  assert.deepEqual([t.hp, t.angle, t.weapon, t.passes], [25, 360, "assaultRifle", ["a", "7"]]);
  assert.equal(D.working(cam), true);
  assert.equal(D.working({ ...cam, on: false }), false);
  assert.equal(D.working({ ...cam, hp: 0 }), false, "destroyed");
  assert.equal(D.working(D.cleanDevice({ kind: "laser" })), true, "no HP to lose: it can't be broken");
  assert.equal(D.working({ ...D.cleanDevice({ kind: "bloodSwarm" }), spent: true }), false);
  assert.equal(D.friendly(t, "a"), true);
  assert.equal(D.friendly({ ...t, controllers: ["net"] }, "net"), true, "whoever holds its node");
  assert.equal(D.friendly(t, "x"), false);
  assert.equal(D.label(cam, 1), "CAM 02");
  assert.equal(D.label({ ...cam, name: "Lobby" }, 1), "Lobby");
});

test("fields of view (pure): a rotation of 0 looks down the map", () => {
  const o = { x: 0, y: 0 };
  assert.deepEqual(D.facing(0), { x: Math.cos(Math.PI / 2), y: 1 });
  assert.equal(D.inCone(o, 0, 90, 500, { x: 0, y: 300 }), true, "straight down");
  assert.equal(D.inCone(o, 0, 90, 500, { x: 250, y: 300 }), true, "inside 45° of it");
  assert.equal(D.inCone(o, 0, 90, 500, { x: 400, y: 300 }), false, "outside");
  assert.equal(D.inCone(o, 0, 90, 500, { x: 0, y: -300 }), false, "behind");
  assert.equal(D.inCone(o, 0, 90, 500, { x: 0, y: 600 }), false, "too far");
  assert.equal(D.inCone(o, 90, 90, 500, { x: -300, y: 0 }), true, "turned a quarter clockwise: looking left");
  assert.equal(D.inCone(o, 0, 360, 500, { x: 0, y: -300 }), true, "all round");
  assert.equal(D.conePoints(o, 0, 90, 100, 4).length, 12, "the apex and five points of arc");
  const grid = { size: 100, distance: 2 };
  const tile = { x: 1000, y: 1000, width: 200, height: 200, rotation: 0 };
  // A camera 20 m (1000 px) down; a floor on its own tile; a stun panel 2 m round it.
  assert.equal(D.notices(tile, D.cleanDevice({ kind: "camera" }), { x: 1100, y: 2000 }, grid), true);
  assert.equal(D.notices(tile, D.cleanDevice({ kind: "camera" }), { x: 1100, y: 2200 }, grid), false);
  assert.equal(D.notices(tile, D.cleanDevice({ kind: "electric" }), { x: 1150, y: 1150 }, grid), true);
  assert.equal(D.notices(tile, D.cleanDevice({ kind: "electric" }), { x: 1250, y: 1150 }, grid), false);
  assert.equal(D.notices(tile, D.cleanDevice({ kind: "stunPanel" }), { x: 1290, y: 1150 }, grid), true);
  assert.equal(D.notices(tile, D.cleanDevice({ kind: "stunPanel" }), { x: 1350, y: 1150 }, grid), false);
});

test("swivel mounts (pure): the way to a point, and how far a mount turns towards it", () => {
  const o = { x: 0, y: 0 };
  assert.equal(D.bearing(o, { x: 0, y: 100 }), 0, "down the map");
  assert.equal(D.bearing(o, { x: -100, y: 0 }), 90, "clockwise: left");
  assert.equal(D.bearing(o, { x: 0, y: -100 }), 180);
  assert.equal(D.bearing(o, { x: 100, y: 0 }), 270);
  for (const p of [{ x: 30, y: 80 }, { x: -70, y: -20 }]) assert.equal(D.inCone(o, D.bearing(o, p), 5, 500, p), true, "it looks straight at them");
  assert.equal(D.swing(0, 40, 180), 40);
  assert.equal(D.swing(0, 270, 180), 270, "a quarter turn the other way");
  assert.equal(D.swing(0, 130, 180), 90, "as far as it goes");
  assert.equal(D.swing(0, 200, 180), 270, "the short way round");
  assert.equal(D.swing(350, 20, 60), 20, "across the top of the dial");
  assert.equal(D.swing(350, 60, 60), 20);
  assert.equal(D.swing(90, 300, 0), 90, "fixed");
  assert.equal(D.swing(90, 300, 360), 300, "all round");
  assert.deepEqual([D.cleanDevice({ kind: "turret" }).traverse, D.cleanDevice({ kind: "camera" }).traverse, D.cleanDevice({ kind: "melee" }).traverse], [180, 0, 0]);
  assert.equal(D.cleanDevice({ kind: "electric", traverse: 90 }).traverse, 0, "a floor has nothing to turn");
  assert.deepEqual([D.cleanDevice({ kind: "turret" }).home, D.cleanDevice({ kind: "turret", home: 45, lock: "t" }).home], [null, 45]);
});

test("what each defense does (pure)", () => {
  const e = (kind, o, extra = {}) => D.effectOf(D.cleanDevice({ kind, ...extra }), o);
  assert.deepEqual(e("tanglefoot"), { slow: "1d6" });
  assert.deepEqual(e("goop"), { slow: "2d6" });
  assert.deepEqual(e("electric"), { damage: "6d6", armor: true, ablate: false }, "2070: armor isn't worn away");
  assert.deepEqual(e("punchers"), { damage: "6d6", armor: true, ablate: true });
  assert.deepEqual(e("laser").check, { skill: "Contortionist", dv: 17 });
  assert.deepEqual(e("slipFloor"), { check: { skill: "Athletics", dv: 15 }, conditions: ["prone"] });
  assert.deepEqual(e("stunPanel").conditions, ["damagedEye", "damagedEar"]);
  assert.deepEqual(e("tipFloor", { grapple: true }), { saved: "grapple" });
  assert.equal(e("tipFloor").damage, "", "an empty pit");
  assert.deepEqual([e("tipFloor", {}, { spikes: true, depth: 12 }).damage, e("tipFloor", {}, { depth: 12 }).fall], ["6d6", 12]);
  assert.deepEqual(e("bloodSwarm", { meat: false }), { saved: "chrome" });
  assert.deepEqual([e("bloodSwarm").damage, e("bloodSwarm").direct], ["3d6", true]);
  assert.deepEqual(e("sleepGas").check, { skill: "Resist Torture/Drugs", dv: 13 });
});

test("security at the table: a camera, a turret, a live floor, a tip-floor, a search, a hack", async () => {
  asGM(true);
  await Settings.set("security", true);
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  const scene = { id: "sc", grid: { size: 100, units: "m", distance: 2 }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), regions: [], flags: {} };
  const tile = (id, kind, x, y, extra = {}, size = 100) => {
    const doc = { id, x, y, width: size, height: size, rotation: 0, hidden: false, parent: scene, flags: { [M]: { security: { kind, ...extra } } }, async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; }, async update(d) { for (const [k, v] of Object.entries(d)) { if (k === `flags.${M}.security`) this.flags[M].security = v; else this[k] = v; } } };
    scene.tiles.set(id, doc);
    return doc;
  };
  const tok = (id, x, y, { items = [], stats = {} } = {}) => {
    const actor = makeActor({ name: id, system: { stats } }, items);
    actor.effects = [];
    actor.createEmbeddedDocuments = async (type, list) => { for (const e of list) actor.effects.push({ id: `e${actor.effects.length}`, ...e }); return list; };
    actor.deleteEmbeddedDocuments = async (type, ids) => { actor.effects = actor.effects.filter((e) => !ids.includes(e.id)); };
    const d = { id, name: id, x, y, width: 1, height: 1, elevation: 0, parent: scene, isOwner: true, actor, async update(data) { Object.assign(this, data); } };
    scene.tokens.set(id, d);
    return d;
  };
  const prevScenes = game.scenes;
  const prevCanvas = globalThis.canvas;
  game.scenes = { get: () => scene };
  globalThis.canvas = { ...(prevCanvas ?? {}), scene, dimensions: { size: 100, distance: 2 }, grid: null, ready: false };
  const posted = [];
  const hurt = [];
  const added = [];
  const prev = { post: Cards.post, hurt: Security.hurt, add: Conditions.add, roll: Conditions.roll, rollFor: Climb.rollFor, at: Dv.at, fx: Security.fx, land: Climb.land };
  Cards.post = async (c) => { posted.push(c); };
  Security.hurt = async (actor, amount, o = {}) => { hurt.push([actor.name, amount, !!o.armor, o.ablation ?? null]); return amount; };
  Conditions.add = async (id, actor) => { added.push([id, actor.name]); return []; };
  let dice = [];
  Conditions.roll = async (formula) => ({ total: dice.length ? dice.shift() : Number(formula.split("d")[0]) * 3, roll: {} });
  Security.fx = () => {};
  Dv.at = async (table, dist) => (dist <= 50 ? 15 : null);
  const press = (i = 0, total = 0) => {
    const c = posted.at(-1);
    const b = c.buttons[i];
    return Security._step({ ...b.data, action: b.action, total }, game.user.id);
  };
  try {
    // A camera at (500,0) looking down the map, 20 m.
    const cam = tile("cam", "camera", 500, 0);
    const ana = tok("Ana", 500, 600);
    assert.deepEqual(Security.devices(scene).map((d) => d.name), ["CAM 01"]);
    assert.deepEqual(await Security.sweep(ana, { moved: true }), ["cam"]);
    assert.equal(posted.at(-1).title, "CAM 01 sees Ana");
    assert.deepEqual(await Security.sweep(ana, { moved: true }), [], "still in view: said once");
    ana.x = 3000;
    await Security.sweep(ana, { moved: true });
    ana.x = 500;
    assert.deepEqual(await Security.sweep(ana, { moved: true }), ["cam"], "out and back in: seen again");
    // A pass: left alone.
    cam.flags[M].security.passes = [ana.actor.id];
    ana.x = 3000;
    await Security.sweep(ana, { moved: true });
    ana.x = 500;
    assert.deepEqual(await Security.sweep(ana, { moved: true }), []);
    scene.tiles.delete("cam");
    // A turret: Combat Number 14 + 1d10 against the range DV; REF 8 may dodge.
    tile("tur", "turret", 500, 0);
    const ben = tok("Ben", 500, 800);
    dice = [4];
    await Security.sweep(ben, { moved: true });
    // 18 beats DV15: 5d6 = 15, armor soaking, ablation 1.
    assert.equal(posted.at(-1).title, "TUR 01 hits Ben");
    assert.deepEqual(hurt.splice(0), [["Ben", 15, true, 1]]);
    assert.deepEqual(await Security.sweep(ben, { turn: true }), [], "it has fired at him: no more for staying put");
    assert.equal(hurt.length, 0);
    scene.tokens.delete("Ben");
    const cy = tok("Cy", 500, 800, { stats: { ref: { value: 8 } } });
    Security.fired.clear();
    dice = [4];
    await Security.sweep(cy, { moved: true });
    assert.deepEqual(posted.at(-1).buttons.map((b) => b.action), ["sec-evade", "sec-tank"]);
    assert.deepEqual(await press(0, 19), { hit: false }, "Evasion 19 against 18");
    assert.equal(posted.at(-1).title, "TUR 01 misses Cy");
    scene.tiles.delete("tur");
    scene.tokens.delete("Cy");
    Security.inside.clear();
    Security.fired.clear();
    // Electrical flooring: 6d6 on stepping on and at each Turn's start, armor not ablated.
    tile("zap", "electric", 1000, 1000, {}, 200);
    const dee = tok("Dee", 1000, 1000);
    await Security.sweep(dee, { moved: true });
    assert.deepEqual(hurt.splice(0), [["Dee", 18, true, 0]]);
    await Security.sweep(dee, { moved: true });
    assert.equal(hurt.length, 0, "moving about on it: nothing more");
    await Security.sweep(dee, { turn: true });
    assert.deepEqual(hurt.splice(0), [["Dee", 18, true, 0]]);
    // Tanglefoot: MOVE down by 1d6 while on it.
    tile("tang", "tanglefoot", 2000, 1000, {}, 200);
    dee.x = 2000;
    dice = [4];
    await Security.sweep(dee, { moved: true });
    assert.deepEqual(dee.actor.effects.map((e) => e.changes[0]), [{ key: "system.stats.move.value", mode: 2, value: "-4" }]);
    dee.x = 4000;
    await Security.sweep(dee, { moved: true });
    assert.equal(dee.actor.effects.length, 0, "off the carpet: free");
    // A tip-floor with spikes: the Check is theirs to roll; failed, 6d6 and Prone.
    tile("pit", "tipFloor", 1000, 3000, { spikes: true }, 200);
    dee.x = 1000;
    dee.y = 3000;
    await Security.sweep(dee, { moved: true });
    assert.deepEqual(posted.at(-1).buttons.map((b) => b.action), ["sec-check"]);
    assert.deepEqual(await press(0, 15), { ok: false }, "15 doesn't beat DV15");
    assert.deepEqual([hurt.splice(0), added.splice(0)], [[["Dee", 18, true, 1]], [["prone", "Dee"]]]);
    assert.equal(posted.at(-1).title, "Dee goes into the pit");
    // A blood swarm goes off once.
    tile("swarm", "bloodSwarm", 3000, 3000, {}, 400);
    dee.x = 3000;
    await Security.sweep(dee, { moved: true });
    assert.equal(scene.tiles.get("swarm").flags[M].security.spent, true);
    assert.deepEqual(await press(0, 16), { ok: true });
    const eli = tok("Eli", 3000, 3000);
    assert.deepEqual(await Security.sweep(eli, { moved: true }), [], "spent");
    // A search finds the hidden ones in reach that the roll beats (DV17).
    const hiddenCam = tile("cam2", "camera", 3200, 3200);
    hiddenCam.hidden = true;
    assert.deepEqual(await Security._search({ scene: "sc", token: "Eli", total: 17 }, game.user.id), { found: [] });
    assert.deepEqual(await Security._search({ scene: "sc", token: "Eli", total: 18 }, game.user.id), { found: ["cam2"] });
    assert.equal(hiddenCam.hidden, false);
    eli.x = 3100;
    eli.y = 3200;
    // By hand: Electronics/Security Tech against DV9 switches it off. With a deck: Interface against the node's DV8 takes it.
    assert.deepEqual(await Security._counter({ scene: "sc", token: "Eli", tile: "cam2", total: 9 }, game.user.id), { ok: false });
    assert.deepEqual(await Security._control({ scene: "sc", token: "Eli", tile: "cam2", total: 9 }, game.user.id), { ok: true });
    assert.deepEqual(hiddenCam.flags[M].security.controllers, [eli.actor.id]);
    assert.deepEqual(Security.options(eli).find((o) => o.dev.id === "cam2").can, ["view", "toggle", "pass"], "on its node: they can cut passes to it");
    assert.deepEqual(await Security._toggle({ scene: "sc", token: "Eli", tile: "cam2" }, game.user.id), { on: false });
    assert.equal(hiddenCam.flags[M].security.on, false);
    assert.equal(await Security._toggle({ scene: "sc", token: "Dee", tile: "cam2" }, game.user.id), null, "no pass, no node: not theirs to switch");
    // The Action HUD: the search, then what's in reach.
    const rows = Security.entries(eli.actor, eli);
    assert.equal(rows[0].key, "sec:search");
    assert.ok(rows.some((r) => r.key === "sec:device:cam2" && r.buttons.map((b) => b.key).join() === "sec:toggle:cam2,sec:pass:cam2"), "switched off: no feed to look through, still theirs to switch");
    // A turret on its swivel: it follows whoever it has, as far as its traverse goes, and swings back.
    const gun = tile("gun", "turret", 5000, 5000);
    const flag = () => gun.flags[M].security;
    const fay = tok("Fay", 5000, 5600);
    assert.deepEqual(await Security.sweep(fay, { moved: true }), ["gun"]);
    assert.deepEqual([gun.rotation, flag().lock, flag().home], [0, "Fay", 0], "dead ahead: held without turning");
    Object.assign(fay, { x: 5600, y: 5000 });
    assert.deepEqual(await Security.sweep(fay, { moved: true }), [], "still in its sights: no second attack for moving");
    assert.deepEqual([gun.rotation, flag().lock, flag().home], [270, "Fay", 0], "out of where it looked, so it turned");
    // Someone nearer walks in: it keeps the one it has.
    const gus = tok("Gus", 5300, 5000);
    await Security.sweep(gus, { moved: true });
    assert.deepEqual([gun.rotation, flag().lock], [270, "Fay"]);
    // Behind it, past its traverse: lost. Gus is still in view, so it takes him.
    Object.assign(fay, { x: 5000, y: 4400 });
    await Security.sweep(fay, { moved: true });
    assert.deepEqual([gun.rotation, flag().lock, flag().home], [270, "Gus", 0]);
    // Gus is gone from the map: nobody left, back to rest.
    scene.tokens.delete("Gus");
    await Security.gone(gus);
    assert.deepEqual([gun.rotation, flag().lock, flag().home], [0, "", null]);
    // A pass holder isn't followed; a fixed mount doesn't turn; a switched-off one lets go.
    Object.assign(fay, { x: 5000, y: 5600 });
    flag().passes = [fay.actor.id];
    await Security.sweep(fay, { moved: true });
    assert.equal(flag().lock, "");
    flag().passes = [];
    flag().traverse = 0;
    await Security.sweep(fay, { moved: true });
    Object.assign(fay, { x: 5600, y: 5000 });
    await Security.sweep(fay, { moved: true });
    assert.deepEqual([gun.rotation, flag().lock], [0, ""], "fixed");
    flag().traverse = 180;
    Object.assign(fay, { x: 5000, y: 5600 });
    await Security.sweep(fay, { moved: true });
    Object.assign(fay, { x: 5600, y: 5000 });
    await Security.sweep(fay, { moved: true });
    assert.equal(gun.rotation, 270);
    flag().on = false;
    await Security.sweep(fay, { moved: true });
    assert.deepEqual([gun.rotation, flag().lock], [0, ""], "switched off: it swings back");
    // In an encounter the site takes one Turn, first: nothing fires as people move, each turret once on that Turn.
    tile("sen", "turret", 8000, 8000);
    const hal = tok("Hal", 8000, 8600);
    const ivy = tok("Ivy", 8200, 8700);
    const combat = makeCombat([hal.actor, ivy.actor]);
    combat.scene = scene;
    let passed = 0;
    combat.createEmbeddedDocuments = async (type, list) => {
      for (const c of list) {
        const cb = { id: `seat${combat.turns.length}`, actor: null, token: null, ...c, async update(u) { Object.assign(cb, u); } };
        combat.combatants.set(cb.id, cb);
        combat.turns.unshift(cb);
      }
    };
    game.combat = combat;
    Security.fired.clear();
    hurt.length = 0;
    // It hasn't attacked this Round: its Action is held for the first to come into its view.
    assert.deepEqual(await Security.sweep(hal, { moved: true }), ["sen"]);
    assert.deepEqual(hurt.splice(0), [["Hal", 15, true, 1]], "held, and spent on him");
    assert.deepEqual(await Security.sweep(ivy, { moved: true }), []);
    assert.equal(hurt.length, 0, "nothing left for the next one in");
    combat.round = 2;
    const seats = [...combat.combatants].filter((c) => Security.isSeat(c));
    assert.deepEqual([seats.length, seats[0].initiative, combat.combatant === seats[0]], [1, 21, true], "one place for the whole site, above everyone");
    assert.deepEqual(await Security.volley(combat), ["sen"]);
    assert.deepEqual(hurt.splice(0), [["Hal", 15, true, 1]], "the nearest, once");
    assert.equal(scene.tiles.get("sen").flags[M].security.lock, "Hal");
    assert.deepEqual(await Security.volley(combat), [], "once a Round");
    Object.assign(ivy, { x: 8000, y: 4000 });
    await Security.sweep(ivy, { moved: true });
    Object.assign(ivy, { x: 8200, y: 8700 });
    assert.deepEqual(await Security.sweep(ivy, { moved: true }), [], "it attacked on its Turn: nothing held");
    combat.round = 3;
    assert.deepEqual(await Security.volley(combat), ["sen"]);
    assert.deepEqual(hurt.splice(0).map((h) => h[0]), ["Hal"], "it keeps the one it follows");
    // Someone rolls above it: it still goes first.
    [...combat.combatants].find((c) => c.actor === ivy.actor).initiative = 30;
    await Security.top(combat);
    assert.equal(seats[0].initiative, 31);
    // Nobody left in view: its Turn is passed.
    Object.assign(hal, { x: 8000, y: 4000 });
    Object.assign(ivy, { x: 8000, y: 4000 });
    combat.round = 4;
    combat.nextTurn = async () => { passed += 1; };
    assert.deepEqual(await Security.volley(combat), []);
    assert.equal(passed, 1);
    Object.assign(ivy, { x: 8200, y: 8700 });
    assert.deepEqual(await Security.sweep(ivy, { moved: true }), ["sen"], "nobody on its Turn: held for whoever walks in");
    assert.deepEqual(hurt.splice(0).map((h) => h[0]), ["Ivy"]);
    game.combat = null;
  } finally {
    game.combat = null;
    game.scenes = prevScenes;
    globalThis.canvas = prevCanvas;
    Cards.post = prev.post;
    Security.hurt = prev.hurt;
    Conditions.add = prev.add;
    Conditions.roll = prev.roll;
    Dv.at = prev.at;
    Security.fx = prev.fx;
    Security.inside.clear();
    Security.fired.clear();
  }
});

test("a device's token: made with its HP, kept in step with the Tile, and damage to it is the device's", async () => {
  asGM(true);
  await Settings.set("security", true);
  await Settings.set("securityTokens", true);
  class Docs extends Map { [Symbol.iterator]() { return this.values(); } }
  const scene = { id: "sc2", grid: { size: 100, units: "m", distance: 2 }, tiles: new Docs(), tokens: new Docs(), walls: new Docs(), flags: {} };
  const base = makeActor({ name: "Security Device" });
  base.flags = { [M]: { securityDevice: true } };
  let made = 0;
  scene.createEmbeddedDocuments = async (type, list) => list.map((data) => {
    const hp = { ...data.delta.system.derivedStats.hp };
    const tok = { ...data, id: `t${(made += 1)}`, parent: scene, actor: { flags: base.flags, system: { derivedStats: { hp } }, async update(u) { hp.value = u["system.derivedStats.hp.value"] ?? hp.value; hp.max = u["system.derivedStats.hp.max"] ?? hp.max; } },
      async update(u) { for (const [k, v] of Object.entries(u)) { if (k === "texture.src") tok.texture.src = v; else tok[k] = v; } } };
    scene.tokens.set(tok.id, tok);
    return tok;
  });
  scene.deleteEmbeddedDocuments = async (type, ids) => ids.forEach((id) => scene.tokens.delete(id));
  const tile = (id, kind, x, y, size = 100) => {
    const doc = { id, x, y, width: size, height: size, rotation: 0, hidden: false, parent: scene, texture: { src: "" }, flags: { [M]: { security: { kind } } }, async setFlag(m, k, v) { (this.flags[m] ??= {})[k] = v; } };
    scene.tiles.set(id, doc);
    return doc;
  };
  const posted = [];
  const prev = { post: Cards.post, fx: Security.fx, scenes: game.scenes };
  Cards.post = async (c) => { posted.push(c); };
  Security.fx = () => {};
  game.scenes = { get: () => scene };
  try {
    const tur = tile("tur", "turret", 1000, 1000);
    const floor = tile("floor", "electric", 2000, 2000, 200);
    tile("grid", "laser", 3000, 3000, 200);
    await Security.embodyAll(scene);
    assert.equal(scene.tokens.size, 2, "a laser grid has no HP: nothing to attack");
    const body = Security.body(scene, "tur");
    assert.deepEqual([body.name, body.x, body.y, body.actorLink, body.hidden, body.actor.system.derivedStats.hp], ["TUR 01", 1000, 1000, false, false, { value: 25, max: 25 }]);
    assert.deepEqual([Security.body(scene, "floor").x, Security.body(scene, "floor").y, Security.body(scene, "floor").width], [2050, 2050, 1], "one square, in the middle of the floor");
    assert.equal(Security.isDevice(body), true);
    assert.equal(Security.fair(Security.device(scene, "tur").d, body), false, "no device goes for a device");
    assert.deepEqual(await Security.sweep(Security.body(scene, "floor"), { moved: true }), [], "nor does a floor go off under its own token");
    await Security.embodyAll(scene);
    assert.equal(made, 2, "made once");
    // The Tile turns, hides, moves and is renamed: so does the token.
    Object.assign(tur, { rotation: 90, hidden: true, x: 1200 });
    tur.flags[M].security.name = "Lobby gun";
    await Security.embodyTile(tur);
    assert.deepEqual([body.rotation, body.hidden, body.x, body.name], [90, true, 1200, "Lobby gun"]);
    // Shot: the device has what the token has left. At 0 it's done.
    body.actor.system.derivedStats.hp.value = 9;
    assert.deepEqual(await Security.struck(body), { hp: 9, dead: false });
    assert.equal(tur.flags[M].security.hp, 9);
    assert.equal(D.working(Security.device(scene, "tur").d), true);
    body.actor.system.derivedStats.hp.value = -4;
    assert.deepEqual(await Security.struck(body), { hp: 0, dead: true });
    assert.equal(D.working(Security.device(scene, "tur").d), false);
    assert.equal(posted.at(-1).title, "Lobby gun is destroyed");
    assert.equal(await Security.struck(body), null, "nothing new");
    // The GM sets its HP in the window: the token has it too.
    tur.flags[M].security.hp = 25;
    await Security.embodyTile(tur);
    assert.equal(body.actor.system.derivedStats.hp.value, 25);
    // No longer a device, or its Tile deleted, or tokens switched off: the token goes.
    delete tur.flags[M].security;
    await Security.embodyTile(tur);
    assert.equal(Security.body(scene, "tur"), null);
    scene.tiles.delete("floor");
    await Security.embodyAll(scene);
    assert.equal(scene.tokens.size, 0);
    tur.flags[M].security = { kind: "camera" };
    await Security.embodyAll(scene);
    assert.equal(Security.body(scene, "tur").actor.system.derivedStats.hp.max, 5);
    await Settings.set("securityTokens", false);
    await Security.embodyAll(scene);
    assert.equal(scene.tokens.size, 0);
  } finally {
    await Settings.set("securityTokens", true);
    Cards.post = prev.post;
    Security.fx = prev.fx;
    game.scenes = prev.scenes;
    game.actors.delete(base.id);
  }
});
