/** Night City Messenger in the 2070s: the spam pack, and the map's dead ground as NCM dead zones. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettings, fakeMessenger, missingKeys } from "./helpers/foundry.mjs";

const Settings = await registerSettings();
const { spamPools, deadScenes, SceneSignal } = await import("../scripts/comms/ncm-world.js");
const { SPAM_2070, CORPS_2070, DISTRICTS_2070 } = await import("../scripts/comms/spam-2070.js");

const NCM_CATEGORIES = ["corpo", "scam", "ripperdoc", "braindance", "political", "blackmarket", "fixer"];
const TOKENS = ["playerName", "networkName", "currentDate", "randomCorpo", "randomDistrict"];

test("the 2070 spam: Night City Messenger's shape, its categories and tokens, nothing from 2045", () => {
  assert.ok(SPAM_2070.length >= 35);
  assert.equal(new Set(SPAM_2070.map((t) => t.id)).size, SPAM_2070.length, "ids are unique");
  for (const t of SPAM_2070) {
    assert.ok(t.id.startsWith("ncm2070-") && NCM_CATEGORIES.includes(t.category), t.id);
    for (const k of ["fromName", "fromEmail", "subject", "body"]) assert.ok(t[k], `${t.id} ${k}`);
    for (const [, tok] of `${t.subject} ${t.body}`.matchAll(/\{\{(\w+)\}\}/g)) assert.ok(TOKENS.includes(tok), `${t.id}: {{${tok}}}`);
    assert.doesNotMatch(`${t.subject} ${t.body}`, /Time of the Red|red sky|crater|REDSKY|Reconstruction/i, t.id);
  }
  for (const c of NCM_CATEGORIES) assert.ok(SPAM_2070.some((t) => t.category === c), c);
});

test("spam pools: 2070 only, both, or Night City Messenger's own", () => {
  const own = { templates: [{ id: "corpo-01" }], corps: ["Militech", "Lazarus Group"], districts: ["the Combat Zone"] };
  const ours = spamPools(own, "2070");
  assert.equal(ours.templates.length, SPAM_2070.length);
  assert.deepEqual(ours.districts, DISTRICTS_2070);
  const both = spamPools(own, "mix");
  assert.equal(both.templates.length, SPAM_2070.length + 1);
  assert.equal(both.corps.filter((c) => c === "Militech").length, 1, "no repeats");
  assert.ok(both.corps.includes("Lazarus Group") && both.districts.includes("the Combat Zone"));
  assert.deepEqual(spamPools(own, "off"), own);
  assert.ok(CORPS_2070.includes("Arasaka"));
});

test("dead scenes: a scene is dead when a place opening into it stands on dead ground", () => {
  const plan = deadScenes([
    { x: 390, y: 1386, scene: "west" }, // West Wind, UC 9
    { x: 562, y: 726, scene: "lc" }, // Little China
    { x: 562, y: 726, scene: "both" },
    { x: 390, y: 1386, scene: "both" },
    { x: 562, y: 726, scene: "" }
  ]);
  assert.deepEqual([...plan], [["west", true], ["lc", false], ["both", true]]);
  assert.equal(deadScenes([{ x: 562, y: 726, scene: "lc" }], { extra: ["Little China"] }).get("lc"), true, "the GM's extra dead zones count");
});

/** A scene that keeps its flags as Foundry would. */
function scene(id, flags = {}) {
  return {
    id, flags,
    async update(u) {
      for (const [path, v] of Object.entries(u)) {
        const parts = path.split(".");
        const last = parts.pop();
        let o = this;
        for (const p of parts) o = o[p] ??= {};
        if (last.startsWith("-=")) delete o[last.slice(2)];
        else o[last] = v;
      }
    }
  };
}

test("syncing dead zones: the map's dead ground goes dead in Night City Messenger; the GM's own are left alone", async () => {
  const ncm = fakeMessenger();
  const toggled = [];
  game.nightcity.messenger.toggleDeadZone = async (id, dead) => {
    toggled.push([id, dead]);
    await game.scenes.get(id).update({ "flags.night-city-messenger.deadZone": dead });
    return { success: true };
  };
  const scenes = { west: scene("west"), lc: scene("lc"), gm: scene("gm", { "night-city-messenger": { deadZone: true } }) };
  for (const s of Object.values(scenes)) game.scenes.set(s.id, s);
  try {
    await Settings.set("cityHub", {
      custom: { w: { id: "w", name: "Shack", x: 390, y: 1386 }, l: { id: "l", name: "Noodle bar", x: 562, y: 726 }, g: { id: "g", name: "Bunker", x: 562, y: 726 } },
      notes: { "c-w": { scene: "west" }, "c-l": { scene: "lc" }, "c-g": { scene: "gm" } }
    });
    assert.deepEqual(await SceneSignal.sync(), [["west", true]]);
    assert.equal(scenes.west.flags["night-city-messenger"].deadZone, true);
    assert.equal(scenes.gm.flags["night-city-messenger"].deadZone, true, "the GM's dead zone stays");
    assert.deepEqual(await SceneSignal.sync(), [], "nothing more to do");

    // The GM switches the West Wind scene back on by hand: it stays on.
    await scenes.west.update({ "flags.night-city-messenger.deadZone": false });
    assert.deepEqual(await SceneSignal.sync(), []);

    // The rule off: what this module switched goes back (and only that).
    await Settings.set("hubSignalScenes", false);
    assert.deepEqual(await SceneSignal.sync(), [["west", false]]);
    assert.equal(scenes.west.flags["cpr-neon-combat-manager"]?.ncmDead, undefined);
    assert.equal(scenes.gm.flags["night-city-messenger"].deadZone, true);
    assert.deepEqual(toggled, [["west", true]], "already on: nothing to switch");
  } finally {
    await Settings.set("hubSignalScenes", true);
    await Settings.set("cityHub", {});
    for (const id of Object.keys(scenes)) game.scenes.delete(id);
    ncm.off();
  }
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

test("no signal: plays for a player whose view lands in a dead zone, once, not for the GM", async () => {
  const { NoSignal } = await import("../scripts/comms/no-signal.js");
  const { asGM } = await import("./helpers/foundry.mjs");
  const ncm = fakeMessenger();
  const live = { id: "a", flags: {} };
  const dead = { id: "b", flags: { "night-city-messenger": { deadZone: true } } };
  const dead2 = { id: "c", flags: { "night-city-messenger": { deadZone: true } } };
  try {
    asGM(false);
    NoSignal.dead = undefined;
    assert.equal(NoSignal.check(live), false);
    assert.equal(NoSignal.check(dead), true, "into a dead zone");
    assert.equal(NoSignal.check(dead2), false, "dead to dead: still no signal, no replay");
    NoSignal.check(live);
    asGM(true);
    NoSignal.dead = false;
    assert.equal(NoSignal.isDead(dead), true);
  } finally {
    asGM(true);
    ncm.off();
  }
  assert.equal(NoSignal.isDead(dead), false, "without Night City Messenger, nothing is dead");
});
