/** The Awareness Ladder on the tokens, and the Alert: its countdown to the security response, clearing, and calling. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { makeActor, makeCombat, registerSettings, settle, root, asGM, missingKeys, chat } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();

const played = [];
const sounds = [];
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
      if (s.kind === "sound") sounds.push(String(call(s, "file")[0]));
    }
    return new Promise(() => {});
  }
}
globalThis.Sequence = Sequence;
globalThis.Sequencer = { Database: { getEntry: () => false, getPathsUnder: () => [] }, EffectManager: { getEffects: () => [], endEffects() {} }, SoundManager: { endSounds() {} } };
game.modules.set("sequencer", { id: "sequencer", active: true });
globalThis.canvas = { ready: true, scene: { id: "s1" }, grid: { size: 100 }, tokens: { placeables: [], get: () => null } };

const { Registry } = await import("../scripts/conditions/registry.js");
const { Conditions } = await import("../scripts/conditions/engine.js");
const { BY_ID } = await import("../scripts/conditions/data.js");
const { Ladder } = await import("../scripts/roller/ladder.js");
const { SOUNDS } = await import("../scripts/neonfx/core.js");
const Rules = await import("../scripts/stealth/alert-rules.js");
const { Alert } = await import("../scripts/stealth/alert.js");

Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Registry.refresh();
Alert.init();

/** A fight (or stealth segment) with one player's character and some guards, flags that tell the hooks. */
function encounter(guards = 2, { round = 1 } = {}) {
  const pc = makeActor({ name: "Fury", hasPlayerOwner: true });
  const mooks = Array.from({ length: guards }, (_, i) => {
    const a = makeActor({ name: `Guard ${i + 1}`, type: "mook", hasPlayerOwner: false });
    const token = { id: `t${a.id}`, name: a.name, actor: a, visible: true, document: { isOwner: true } };
    a.getActiveTokens = () => [token];
    return a;
  });
  const combat = makeCombat([pc, ...mooks], { round });
  combat.setFlag = async (s, k, v) => {
    combat.flags[s] ??= {};
    combat.flags[s][k] = v;
    Hooks.callAll("updateCombat", combat, { flags: { [s]: { [k]: v } } }, {}, game.user.id);
  };
  combat.unsetFlag = async (s, k) => {
    delete combat.flags[s]?.[k];
    Hooks.callAll("updateCombat", combat, { flags: { [s]: { [`-=${k}`]: null } } }, {}, game.user.id);
  };
  game.combat = combat;
  return { combat, pc, mooks };
}
const next = async (combat, rounds = 1) => {
  combat.round += rounds;
  game.time.worldTime += rounds * 3;
  Hooks.callAll("updateCombat", combat, { round: combat.round }, {}, game.user.id);
  await Alert.check();
  await settle(120);
};
const has = (actor, id) => Conditions.has(id, actor);

beforeEach(async () => {
  asGM(true);
  played.length = 0;
  sounds.length = 0;
  chat.length = 0;
  game.time.worldTime = 0;
  for (const c of [...game.combats.keys()]) game.combats.delete(c);
  Alert._levels.clear();
  Alert._shown.clear();
  for (const [k, v] of Object.entries({ awarenessLadder: true, awarenessTokens: "alert", alertTimer: 20, alertClears: true, alertBanner: true, fxEnabled: true, fxConditions: true, fxVolume: 0.4, roundSeconds: 3, conditionChat: "off" })) await Settings.set(k, v);
});

/* ---------------------------------------- */
/*  Rules (pure)                            */
/* ---------------------------------------- */

test("each raised step of the Ladder has its condition, shown by the setting", () => {
  for (const id of Object.values(Rules.AWARE_CONDITIONS)) {
    assert.equal(BY_ID[id].category, "awareness", id);
    assert.ok(existsSync(path.join(root, BY_ID[id].img.replace(`modules/${M}/`, ""))), BY_ID[id].img);
  }
  assert.equal(Rules.conditionAt("unaware", "all"), null);
  assert.equal(Rules.conditionAt("suspicious", "all"), "awareSuspicious");
  assert.equal(Rules.conditionAt("suspicious", "alert"), null);
  assert.equal(Rules.conditionAt("alert", "alert"), "awareAlert");
  assert.equal(Rules.conditionAt("spotted", "alert"), "awareSpotted");
  assert.equal(Rules.conditionAt("alert", "off"), null);
  assert.equal(Rules.raised("searching", "alert"), true);
  assert.equal(Rules.raised("unaware", "spotted"), true);
  assert.equal(Rules.raised("alert", "spotted"), false);
  assert.equal(Rules.raised("alert", "searching"), false);
});

test("the countdown runs on the game clock, or in Rounds when the clock stands still", () => {
  const a = Rules.startAlert({ time: 100, round: 2, roundSeconds: 3 }, 20);
  assert.deepEqual([a.total, a.endsAt, a.endRound, a.called, a.dismissed], [60, 160, 22, false, false]);
  assert.equal(Rules.remaining(a, { time: 100, round: 2, roundSeconds: 3 }), 60);
  assert.equal(Rules.remaining(a, { time: 130, round: 12, roundSeconds: 3 }), 30);
  assert.equal(Rules.remaining(a, { time: 999, round: 99, roundSeconds: 3 }), 0);
  assert.equal(Rules.remaining(a, { time: 100, round: 12, roundSeconds: 0 }), 30, "by Rounds");
  assert.equal(Rules.remaining(Rules.startAlert({}, 0), { time: 5 }), 0, "no timer");
  assert.equal(Rules.clock(57), "57.00");
  assert.equal(Rules.clock(8.256), "08.25");
  assert.equal(Rules.clock(-3), "00.00");
  assert.equal(Rules.clock(120), "120.00");
  assert.equal(Rules.ticking(a), true);
  assert.equal(Rules.ticking({ ...a, dismissed: true }), false);
  assert.equal(Rules.ticking({ ...a, called: true }), false);
});

test("an Alert is kept until something is done: every enemy down clears it, the clock at zero calls the response", () => {
  const a = Rules.startAlert({ time: 0, round: 1 }, 20);
  assert.deepEqual(Rules.tally([{ player: true }, { player: false }, { player: false, out: true }, { player: false, defeated: true }]), { enemies: 3, awake: 1 });
  assert.equal(Rules.outcome(a, { enemies: 3, awake: 1, left: 30 }), "run");
  assert.equal(Rules.outcome(a, { enemies: 3, awake: 0, left: 30 }), "clear");
  assert.equal(Rules.outcome(a, { enemies: 3, awake: 0, left: 0 }), "clear", "down before the call");
  assert.equal(Rules.outcome(a, { enemies: 3, awake: 2, left: 0 }), "call");
  assert.equal(Rules.outcome({ ...a, called: true }, { enemies: 3, awake: 0, left: 0 }), "run", "the response is already coming");
  assert.equal(Rules.outcome({ ...a, dismissed: true }, { enemies: 3, awake: 2, left: 0 }), "run", "waved away: the clock calls nothing");
  assert.equal(Rules.outcome({ ...a, dismissed: true }, { enemies: 3, awake: 0, left: 0 }), "clear");
  assert.equal(Rules.outcome(a, { enemies: 3, awake: 0, left: 30, clears: false }), "run");
  assert.equal(Rules.outcome(a, { enemies: 0, awake: 0, left: 30 }), "run", "an empty room isn't a cleared one");
});

/* ---------------------------------------- */
/*  On the table                            */
/* ---------------------------------------- */

test("the enemies carry the Ladder's step: by default only from Alert up, and never the players' characters", async () => {
  const { combat, pc, mooks } = encounter(2);
  await Ladder.set(combat, "suspicious");
  await settle(120);
  assert.ok(mooks.every((m) => !has(m, "awareSuspicious")), "below Alert stays the GM's");
  assert.equal(Alert.of(combat), null);
  assert.ok(played.some((s) => call(s, "text")?.[0] === "?" && call(s, "forUsers")), "the GM alone gets the mark");

  await Ladder.set(combat, "alert");
  await settle(120);
  assert.ok(mooks.every((m) => has(m, "awareAlert")));
  assert.equal(has(pc, "awareAlert"), false);
  await Ladder.set(combat, "spotted");
  await settle(120);
  assert.ok(mooks.every((m) => has(m, "awareSpotted") && !has(m, "awareAlert")), "one step at a time");
  await Ladder.set(combat, "searching");
  await settle(120);
  assert.ok(mooks.every((m) => !has(m, "awareSpotted") && !has(m, "awareSearching")));

  await Settings.set("awarenessTokens", "all");
  await Alert.check();
  await settle(120);
  assert.ok(mooks.every((m) => has(m, "awareSearching")), "every step, when the table wants it");
  await Settings.set("awarenessTokens", "off");
  await Alert.check();
  await settle(120);
  assert.ok(mooks.every((m) => !has(m, "awareSearching")));
  assert.equal(chat.length, 0, "the Ladder's own conditions post no cards");
});

test("reaching Alert: a mark over each enemy, the sting once, and a countdown that follows the Rounds", async () => {
  const { combat, mooks } = encounter(3, { round: 2 });
  await Ladder.set(combat, "alert");
  await settle(120);
  const alert = Alert.of(combat);
  assert.deepEqual([alert.total, alert.endRound, alert.called], [60, 22, false]);
  assert.equal(played.filter((s) => call(s, "text")?.[0] === "!").length, mooks.length, "a ! over each of them");
  assert.equal(sounds.filter((f) => f.includes("alert-sting")).length, 1, "one sting, not one per enemy");
  let ctx = Alert.context(combat);
  assert.deepEqual([ctx.ticking, ctx.clock, ctx.share, ctx.gm], [true, "60.00", 1, true]);

  await next(combat, 5);
  ctx = Alert.context(combat);
  assert.deepEqual([ctx.clock, ctx.share], ["45.00", 0.75]);
  // Climbing to Spotted is the same Alert: no second sting, the clock keeps running.
  await Ladder.set(combat, "spotted");
  await settle(120);
  assert.equal(Alert.of(combat).id, alert.id);
  assert.equal(sounds.filter((f) => f.includes("alert-sting")).length, 1);
  assert.equal(Alert.context(combat).clock, "45.00");
});

test("the clock at zero calls the response: the GM is told, and the Alert stays", async () => {
  const { combat, mooks } = encounter(2);
  await Ladder.set(combat, "alert");
  await settle(120);
  await next(combat, 19);
  assert.equal(Alert.of(combat).called, false);
  await next(combat, 1);
  assert.equal(Alert.of(combat).called, true);
  assert.equal(Ladder.level(combat), "alert");
  assert.ok(mooks.every((m) => has(m, "awareAlert")));
  const card = chat.at(-1);
  assert.match(card.content, /security response is called/);
  assert.ok(card.whisper?.length, "the GM's to act on");
  assert.equal(sounds.filter((f) => f.includes("alert-response")).length, 1);
  const ctx = Alert.context(combat);
  assert.deepEqual([ctx.called, ctx.ticking, ctx.label], [true, false, "Response called"]);
  // Putting them down now doesn't call it back.
  for (const m of mooks) await Conditions.add("unconscious", m);
  await Alert.check();
  await settle(120);
  assert.equal(Ladder.level(combat), "alert");
  assert.ok(Alert.of(combat));
});

test("every alerted enemy down before the call: the alarm never goes out", async () => {
  const { combat, mooks } = encounter(2);
  await Ladder.set(combat, "alert");
  await settle(120);
  await next(combat, 3);
  await Conditions.add("unconscious", mooks[0]);
  await Alert.check();
  await settle(120);
  assert.equal(has(mooks[0], "awareAlert"), false, "someone out cold isn't alert");
  assert.ok(Alert.of(combat), "one of them is still up");
  combat.turns[2].defeated = true;
  await Alert.check();
  await settle(120);
  assert.equal(Alert.of(combat), null);
  assert.equal(Ladder.level(combat), "unaware");
  assert.ok(mooks.every((m) => !has(m, "awareAlert")));
  assert.match(chat.at(-1).content, /alarm never went out/);
  assert.equal(sounds.filter((f) => f.includes("alert-clear")).length, 1);
  assert.equal(Alert.context(combat), null);

  // With the rule off, it's the GM's to end.
  const b = encounter(1);
  await Settings.set("alertClears", false);
  await Ladder.set(b.combat, "alert");
  await settle(120);
  await Conditions.add("dead", b.mooks[0]);
  await Alert.check();
  await settle(120);
  assert.equal(Ladder.level(b.combat), "alert");
});

test("the GM waves the countdown away: no clock, no call, the Alert stays; lowering the Ladder ends it", async () => {
  const { combat, mooks } = encounter(2);
  await Ladder.set(combat, "alert");
  await settle(120);
  asGM(false);
  await Alert.dismiss(combat);
  assert.equal(Alert.of(combat).dismissed, false, "a player can't");
  assert.equal(Alert.context(combat).gm, false);
  asGM(true);
  await Alert.dismiss(combat);
  assert.equal(Alert.context(combat), null);
  await next(combat, 25);
  assert.equal(Alert.of(combat).called, false);
  assert.ok(mooks.every((m) => has(m, "awareAlert")));
  // Something new sets them off: the clock starts again, without a second banner.
  await Alert.restart(combat, 10);
  assert.equal(Alert.context(combat).clock, "30.00");
  assert.equal(sounds.filter((f) => f.includes("alert-sting")).length, 1);
  await Ladder.set(combat, "searching");
  await settle(120);
  assert.equal(Alert.of(combat), null);
  assert.ok(mooks.every((m) => !has(m, "awareAlert")));
});

test("no countdown when it's set to 0, nothing at all with the Ladder off, and the fight's end takes the conditions with it", async () => {
  await Settings.set("alertTimer", 0);
  const { combat, mooks } = encounter(1);
  await Ladder.set(combat, "alert");
  await settle(120);
  assert.equal(Alert.of(combat).total, 0);
  assert.equal(Alert.context(combat), null);
  await next(combat, 30);
  assert.equal(Alert.of(combat).called, false);
  assert.ok(has(mooks[0], "awareAlert"));
  game.combats.delete(combat.id);
  Hooks.callAll("deleteCombat", combat, {}, game.user.id);
  await settle(120);
  assert.equal(has(mooks[0], "awareAlert"), false);

  await Settings.set("awarenessLadder", false);
  const b = encounter(1);
  await Ladder.set(b.combat, "alert");
  await settle(120);
  assert.equal(Alert.of(b.combat), null);
  assert.equal(has(b.mooks[0], "awareAlert"), false);
});

test("the alert sounds ship, and no string is missing", () => {
  for (const k of ["alertSting", "alertResponse", "alertClear"]) for (const f of SOUNDS[k].files) assert.ok(existsSync(path.join(root, f.replace(`modules/${M}/`, ""))), f);
  assert.deepEqual([...missingKeys].filter((k) => /Alert|aware/i.test(k)), []);
});

test("the Awareness condition goes on once: asked for several times at once (the mode switching, the Ladder, the clock), it doesn't stack; ones that had are cleared", async () => {
  const { combat, mooks } = encounter(2);
  const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));
  await Ladder.set(combat, "alert");
  await settle();
  const count = (a) => Conditions.effects(a, "awareAlert").length;
  for (const a of mooks) await Conditions.remove("awareAlert", a);
  // Every write takes a trip to the server, as at the table.
  for (const a of mooks) {
    const real = a.createEmbeddedDocuments.bind(a);
    a.createEmbeddedDocuments = async (...args) => {
      await settle(5);
      return real(...args);
    };
  }
  await Promise.all([Alert.syncConditions(combat), Alert.syncConditions(combat), Alert.syncConditions(combat)]);
  assert.deepEqual(mooks.map(count), [1, 1], "one each, however many asked");
  // Stacked by an older version: cleared down to one on the next look.
  await Conditions.add("awareAlert", mooks[0], { managed: "ladder", allowDuplicates: true });
  await Conditions.add("awareAlert", mooks[0], { managed: "ladder", allowDuplicates: true });
  assert.equal(count(mooks[0]), 3);
  await Alert.syncConditions(combat);
  assert.equal(count(mooks[0]), 1);
  game.combat = null;
});
