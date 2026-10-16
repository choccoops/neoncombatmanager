/** Pure rules: CPR's effect bookkeeping, weather, visibility, triggers, time formatting. */
import { test } from "node:test";
import assert from "node:assert/strict";
import "./helpers/foundry.mjs";

const { keyCategory, cprChanges, needsRepair, repairFlags } = await import("../scripts/conditions/cpr-flags.js");
const { activeWeather, manualWeather, weatherFor } = await import("../scripts/environment/weather-data.js");
const { lightLevel, sightPenalty, litBy, worse } = await import("../scripts/environment/visibility-data.js");
const { testTrigger } = await import("../scripts/conditions/triggers.js");
const { formatElapsed, clockTime, shortDuration } = await import("../scripts/util.js");

test("change keys get Cyberpunk RED's effect-sheet categories", () => {
  assert.equal(keyCategory("system.stats.move.value"), "stat");
  assert.equal(keyCategory("bonuses.allActions"), "misc");
  assert.equal(keyCategory("bonuses.ranged"), "combat");
  assert.equal(keyCategory("bonuses.deathSavePenalty"), "combat");
  assert.equal(keyCategory("bonuses.perceptionSight"), "skill");
  assert.equal(keyCategory("bonuses.zap"), "netrun");
  assert.equal(keyCategory("bonuses.moto"), "role");
  assert.equal(keyCategory("flags.other"), "custom");
});

test("every change gets cats and situational flags for its index; STATs are never situational", () => {
  const { changes, flags } = cprChanges([
    { key: "bonuses.ranged", value: -2, situational: true },
    { key: "system.stats.ref.value", value: -1, situational: true },
    { key: "bonuses.allActions", value: "-4" }
  ]);
  assert.deepEqual(changes.map((c) => [c.key, c.mode, c.value]), [["bonuses.ranged", 2, "-2"], ["system.stats.ref.value", 2, "-1"], ["bonuses.allActions", 2, "-4"]]);
  assert.deepEqual(flags.cats, { 0: "combat", 1: "stat", 2: "misc" });
  assert.deepEqual(flags.situational[0], { isSituational: true, onByDefault: true });
  assert.deepEqual(flags.situational[1], { isSituational: false, onByDefault: false });
  assert.deepEqual(flags.situational[2], { isSituational: false, onByDefault: false });
});

test("effects missing CPR's bookkeeping are spotted and repaired without losing what's there", () => {
  const changes = [{ key: "bonuses.melee", value: "-2" }, { key: "system.stats.move.value", value: "-4" }];
  assert.equal(needsRepair({ changes, flags: {} }), true);
  // a situational object missing an index throws inside CPR: that needs repair too
  assert.equal(needsRepair({ changes, flags: { "cyberpunk-red-core": { changes: { cats: { 0: "combat", 1: "stat" }, situational: { 0: {} } } } } }), true);
  const fixed = repairFlags(changes, { cats: { 0: "skill" } });
  assert.deepEqual(fixed.cats, { 0: "skill", 1: "stat" });
  assert.deepEqual(fixed.situational[1], { isSituational: false, onByDefault: false });
  assert.equal(needsRepair({ changes, flags: { "cyberpunk-red-core": { changes: fixed } } }), false);
  assert.equal(needsRepair({ changes: [] }), false);
});

test("the weather in effect follows Neon Hub's day: sky, strange events in their window, events, heat", () => {
  const day = { band: "hot", f: 85, cond: "heavyRain", strange: { key: "dustStorm", start: 600, minutes: 30 }, event: null };
  assert.deepEqual(activeWeather(day, 500).keys, ["heavyRain", "hot"]);
  assert.deepEqual(activeWeather(day, 610).keys, ["heavyRain", "dustStorm", "hot"]);
  assert.deepEqual(activeWeather(day, 630).keys, ["heavyRain", "hot"]);
  // an event running past midnight still counts in the small hours
  const late = { band: "cool", cond: "clear", strange: { key: "ashStorm", start: 1420, minutes: 40 }, event: null };
  assert.deepEqual(activeWeather(late, 10).keys, ["ashStorm"]);
  assert.deepEqual(activeWeather({ band: "scorching", cond: "clear", event: { key: "heatWave" } }, 0).keys, ["heatWave"]);
  assert.deepEqual(activeWeather(null, 0).keys, []);
  assert.deepEqual(manualWeather({ cond: "lightRain", band: "warm", strange: "acidRain" }).keys, ["lightRain", "acidRain"]);
  assert.equal(manualWeather({ strange: "coldSnap" }).band, "freezing");
});

test("weather on a character: sight, slick ground, heat on armor, radiation and hazards, cut by gear", () => {
  const open = weatherFor(["heavyRain", "acidRain", "inversionSmog"], {});
  assert.equal(open.sight, -4, "the worst obscurement counts");
  assert.deepEqual(open.conditions.map((c) => c.id), ["wxHeavyRain", "wxAcidRain", "wxInversionSmog"]);
  assert.ok(open.conditions[0].changes.every((c) => c.situational && c.onByDefault === false && c.value === -1));
  assert.deepEqual(open.hazards, ["acidRain", "inversionSmog"]);

  const geared = weatherFor(["heavyRain", "acidRain", "inversionSmog"], { rain: true, breathing: true, vision: true });
  assert.equal(geared.sight, 0, "Low Light/IR/UV sees through it");
  assert.deepEqual(geared.hazards, []);

  const wave = weatherFor(["heatWave"], {}, { armorPenalty: 2 });
  assert.deepEqual(wave.conditions[0].changes.map((c) => [c.key, c.value]), [["system.stats.ref.value", -2], ["system.stats.dex.value", -2], ["system.stats.move.value", -2]]);
  assert.equal(weatherFor(["heatWave"], { heat: true }, { armorPenalty: 2 }).conditions[0].changes[0].value, -1, "hot-weather lining takes 1 off");
  assert.deepEqual(weatherFor(["heatWave"], {}, { armorPenalty: 0 }).conditions[0].changes, [], "no armor penalty, nothing to worsen");
  assert.deepEqual(weatherFor(["hot"], { heat: true }, { armorPenalty: 2 }).conditions[0].changes, []);

  assert.deepEqual(weatherFor(["radioactiveWindstorm"], {}).extra, ["radiationHigh"]);
  assert.deepEqual(weatherFor(["radioactiveWindstorm"], { radiation: true }).extra, []);
});

test("light levels from darkness, global light, light sources and darkness sources", () => {
  assert.equal(lightLevel({ darkness: 0.1 }), "bright");
  assert.equal(lightLevel({ darkness: 0.5 }), "dim");
  assert.equal(lightLevel({ darkness: 0.9 }), "dark");
  assert.equal(lightLevel({ darkness: 0.9, lit: "dim" }), "dim", "a lamp's dim light helps");
  assert.equal(lightLevel({ darkness: 0.9, lit: "bright" }), "bright");
  assert.equal(lightLevel({ darkness: 0.5, global: { enabled: true, max: 1 } }), "bright");
  assert.equal(lightLevel({ darkness: 0.9, global: { enabled: true, max: 1 } }), "dim", "a lit city at night is still night");
  assert.equal(lightLevel({ darkness: 0.9, global: { enabled: true, max: 0.5 } }), "dark", "global light cuts out above its max");
  assert.equal(lightLevel({ darkness: 0, unlit: true }), "dark");
  assert.equal(worse("dim", "dark"), "dark");
  assert.equal(worse("bright", "dim"), "dim");
});

test("sight penalty: darkness and weather add up to the cap; cybereyes cancel it", () => {
  assert.deepEqual(sightPenalty({ level: "dim" }), { total: -1, darkness: -1, weather: 0, condition: "lowLight" });
  assert.deepEqual(sightPenalty({ level: "dark" }), { total: -4, darkness: -4, weather: 0, condition: "darkness" });
  assert.equal(sightPenalty({ level: "dark", weather: -2 }).total, -4, "capped at 4");
  assert.equal(sightPenalty({ level: "dark", weather: -2, cap: 0 }).total, -6, "no cap");
  assert.equal(sightPenalty({ level: "bright", weather: -2 }).condition, "obscured");
  assert.equal(sightPenalty({ level: "dim", weather: -2 }).condition, "obscured");
  assert.deepEqual(sightPenalty({ level: "dark", weather: -4, vision: true }), { total: 0, darkness: 0, weather: 0, condition: null });
  assert.deepEqual(sightPenalty({ level: "bright" }).condition, null);
});

test("light reaching a point: bright radius, dim radius, blocked by walls", () => {
  const lamp = { x: 0, y: 0, bright: 100, dim: 200 };
  assert.equal(litBy({ x: 50, y: 0 }, [lamp]), "bright");
  assert.equal(litBy({ x: 150, y: 0 }, [lamp]), "dim");
  assert.equal(litBy({ x: 250, y: 0 }, [lamp]), null);
  assert.equal(litBy({ x: 50, y: 0 }, [{ ...lamp, contains: () => false }]), null, "behind a wall");
});

test("trigger tests compare numbers as numbers and text as text", () => {
  assert.equal(testTrigger({ op: "lte", value: "0" }, 0), true);
  assert.equal(testTrigger({ op: "lte", value: "0" }, 3), false);
  assert.equal(testTrigger({ op: "gt", value: "10" }, 9), false);
  assert.equal(testTrigger({ op: "eq", value: "mortallyWounded" }, "mortallyWounded"), true);
  assert.equal(testTrigger({ op: "ne", value: "notWounded" }, "lightlyWounded"), true);
  assert.equal(testTrigger({ op: "lt", value: "5" }, undefined), false);
  assert.equal(testTrigger({ op: "nope", value: "5" }, 1), false);
});

test("time formatting", () => {
  assert.equal(formatElapsed(9), "00:09");
  assert.equal(formatElapsed(3 * 21), "01:03");
  assert.equal(formatElapsed(3725), "1:02:05");
  assert.equal(clockTime(0), "00:00");
  assert.equal(clockTime(86400 + 3600 * 22 + 60 * 14), "22:14");
  assert.equal(clockTime(3600 * 19, true), "7:00 PM", "Neon Hub's 12-hour clock");
  assert.equal(clockTime(0, true), "12:00 AM");
  assert.equal(clockTime(3600 * 12 + 300, true), "12:05 PM");
  assert.equal(clockTime(3600 * 9 + 60 * 7, true), "9:07 AM");
  assert.equal(shortDuration(60), "1 min");
  assert.equal(shortDuration(14400), "4 h");
  assert.equal(shortDuration(86400 * 7), "7 d");
  assert.equal(shortDuration(0), "");
});
