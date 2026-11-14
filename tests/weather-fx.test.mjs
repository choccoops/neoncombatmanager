/** Weather you can see: Night City presets, scene weather sync, shelters, who the weather reaches, ambience. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { makeActor, registerSettings, root, asGM, missingKeys, lang } from "./helpers/foundry.mjs";

const { sightParts } = await import("../scripts/environment/visibility-data.js");
const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();

// Foundry's own presets, the shape v12 uses.
const shader = (id, config) => ({ id, effectClass: "WeatherShaderEffect", shaderClass: id, blendMode: 1, config });
CONFIG.weatherEffects = {
  rain: { id: "rain", label: "WEATHER.Rain", filter: { enabled: false }, effects: [shader("rainShader", { opacity: 0.25, tint: [0.7, 0.9, 1], intensity: 1, speed: 0.2 })] },
  rainStorm: { id: "rainStorm", label: "WEATHER.RainStorm", filter: { enabled: false }, effects: [shader("fogShader", { intensity: 0.05 }), shader("rainShader", { opacity: 0.45, intensity: 1.5 })] },
  fog: { id: "fog", label: "WEATHER.Fog", filter: { enabled: false }, effects: [shader("fogShader", { intensity: 0.4, slope: 0.45 })] },
  snow: { id: "snow", label: "WEATHER.Snow", filter: { enabled: false }, effects: [shader("snowShader", { tint: [0.85, 0.95, 1], direction: 0.5 })] },
  blizzard: { id: "blizzard", label: "WEATHER.Blizzard", effects: [shader("snowShader", {})] }
};

const { WeatherFx, PRESETS, AMBIENCE, presetFor, buildPreset } = await import("../scripts/environment/weather-fx.js");
const { Sources, inTile, suppressesWeather } = await import("../scripts/environment/sources.js");
const { Environment } = await import("../scripts/environment/environment.js");
const { Registry } = await import("../scripts/conditions/registry.js");
Registry.refresh();
WeatherFx.registerPresets();

function makeScene({ mode = "outdoor", weather = "", flags = {}, tiles = [], regions = [], tokens = [] } = {}) {
  const scene = {
    id: `scene${Math.random().toString(36).slice(2, 7)}`,
    weather,
    flags: { [M]: { weather: mode, ...flags } },
    tiles,
    regions,
    tokens,
    grid: { size: 100 },
    updates: [],
    getFlag(scope, key) {
      return this.flags?.[scope]?.[key];
    },
    async update(data) {
      this.updates.push(data);
      for (const [k, v] of Object.entries(data)) {
        if (k === "weather") this.weather = v;
        else if (k.includes(".-=")) delete this.flags[M][k.split(".-=")[1]];
        else this.flags[M][k.split(".").at(-1)] = v;
      }
    }
  };
  for (const t of tokens) t.parent = scene;
  return scene;
}

beforeEach(async () => {
  asGM(true);
  for (const [k, v] of Object.entries({ weatherFx: true, weatherEveryone: true, weatherAmbience: true, weatherSource: "manual", fxVolume: 0.4 })) await Settings.set(k, v);
  await Settings.set("manualWeather", { cond: "heavyRain", band: "warm", strange: "acidRain" });
});

/* ---------------------------------------- */
/*  Presets                                 */
/* ---------------------------------------- */

test("Night City presets are built from Foundry's own, tinted, with unique effect ids", () => {
  for (const id of Object.keys(PRESETS)) {
    const p = CONFIG.weatherEffects[id];
    assert.ok(p, id);
    assert.equal(WeatherFx.resolved[id], id);
    assert.equal(p.label, `NEONCOMBAT.WeatherFx.${id}`);
    assert.ok(lang.NEONCOMBAT.WeatherFx[id], `label for ${id}`);
    const ids = p.effects.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    if (PRESETS[id].tint) assert.ok(p.effects.every((e) => e.config.tint.join() === PRESETS[id].tint.join()));
  }
  // Acid rain: Foundry's storm (fog + rain), green, and Foundry's own preset left as it was.
  const acid = CONFIG.weatherEffects.ncmAcidRain;
  assert.equal(acid.effects.length, 2);
  assert.deepEqual(acid.effects[1].config.tint, [0.65, 1, 0.3]);
  assert.deepEqual(CONFIG.weatherEffects.rainStorm.effects[1].config.tint, undefined);
  // Ash: snow and fog together.
  assert.equal(CONFIG.weatherEffects.ncmAshStorm.effects.length, 2);
  // A Foundry that lacks a source preset: no build, and the plain preset is used instead.
  assert.equal(buildPreset("x", { from: ["sleet"], tint: null, strength: 1 }, CONFIG.weatherEffects), null);
  // Every ambience file ships.
  for (const a of Object.values(AMBIENCE)) for (const f of a.files) assert.ok(existsSync(path.join(root, f.replace(`modules/${M}/`, ""))), f);
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

test("the most dramatic weather wins the scene", () => {
  assert.equal(presetFor(["heavyRain", "acidRain"]), "ncmAcidRain");
  assert.equal(presetFor(["lightRain", "deadlyThunderstorm"]), "ncmThunderstorm");
  assert.equal(presetFor(["hot"]), "");
  assert.equal(presetFor(["blackout"]), "");
  assert.equal(presetFor([]), "");
});

/* ---------------------------------------- */
/*  Scene weather                           */
/* ---------------------------------------- */

test("outdoor scenes get the weather; indoor ones lose theirs; the GM's own and Off scenes are left alone", async () => {
  const out = makeScene({ mode: "outdoor" });
  assert.equal(await WeatherFx.syncScene(out), true);
  assert.equal(out.weather, "ncmAcidRain");
  assert.deepEqual(out.flags[M].weatherFx, { weather: "ncmAcidRain", preset: "ncmAcidRain" });
  assert.equal(await WeatherFx.syncScene(out), false, "nothing to change");

  // The weather clears: so does ours.
  await Settings.set("manualWeather", { cond: "clear", band: "warm", strange: "" });
  await WeatherFx.syncScene(out);
  assert.equal(out.weather, "");
  assert.equal(out.flags[M].weatherFx, undefined);

  await Settings.set("manualWeather", { cond: "lightRain", band: "warm", strange: "" });
  // Indoors: none, and ours comes off.
  const inside = makeScene({ mode: "indoor", weather: "ncmLightRain", flags: { weatherFx: { weather: "ncmLightRain", preset: "ncmLightRain" } } });
  await WeatherFx.syncScene(inside);
  assert.equal(inside.weather, "");

  // The GM's own weather stays.
  const gmRain = makeScene({ mode: "outdoor", weather: "blizzard" });
  assert.equal(await WeatherFx.syncScene(gmRain), false);
  assert.equal(gmRain.weather, "blizzard");

  // Off (a HUB or title screen): never given weather, its own never touched...
  const hub = makeScene({ mode: "off", weather: "fog" });
  assert.equal(await WeatherFx.syncScene(hub), false);
  assert.equal(hub.weather, "fog");
  const blank = makeScene({ mode: "off" });
  assert.equal(await WeatherFx.syncScene(blank), false);
  assert.equal(blank.weather, "");
  // ...but weather this module left there before it was switched Off is taken back.
  const was = makeScene({ mode: "off", weather: "ncmLightRain", flags: { weatherFx: { weather: "ncmLightRain", preset: "ncmLightRain" } } });
  await WeatherFx.syncScene(was);
  assert.equal(was.weather, "");

  // Weather visuals switched off: ours comes off everywhere.
  await Settings.set("weatherFx", false);
  const again = makeScene({ mode: "outdoor", weather: "ncmLightRain", flags: { weatherFx: { weather: "ncmLightRain", preset: "ncmLightRain" } } });
  await WeatherFx.syncScene(again);
  assert.equal(again.weather, "");
});

test("only the active GM writes scene weather", async () => {
  const scene = makeScene();
  globalThis.canvas = { scene, ready: true };
  game.scenes.set(scene.id, scene);
  asGM(false);
  await WeatherFx.syncAll();
  assert.equal(scene.updates.length, 0);
  asGM(true);
  await WeatherFx.syncAll();
  assert.equal(scene.weather, "ncmAcidRain");
  game.scenes.delete(scene.id);
  globalThis.canvas = null;
});

/* ---------------------------------------- */
/*  Shelter                                 */
/* ---------------------------------------- */

test("roofs, awnings and Suppress Weather regions keep characters out of the weather", () => {
  const roof = { x: 0, y: 0, width: 400, height: 200, rotation: 0, elevation: 20, restrictions: { weather: true }, flags: {} };
  const awning = { x: 600, y: 0, width: 200, height: 100, rotation: 0, elevation: 0, restrictions: { weather: false }, flags: { [M]: { shelter: true } } };
  const decor = { x: 900, y: 0, width: 200, height: 200, rotation: 0, elevation: 0, restrictions: { weather: false }, flags: {} };
  const behaviors = (type, disabled = false) => [{ type, disabled }];
  const inside = (x, y) => (r) => x >= r.box[0] && x <= r.box[2] && y >= r.box[1] && y <= r.box[3];
  const region = (name, box, list = []) => ({ name, box, behaviors: list, testPoint(p) { return inside(p.x, p.y)(this); } });
  const regions = [
    region("Alley", [0, 500, 300, 800], behaviors("suppressWeather")),
    region("Warehouse interior", [400, 500, 700, 800]),
    region("Plaza", [800, 500, 1100, 800], behaviors("suppressWeather", true))
  ];
  const tok = (x, y, elevation = 0) => ({ x, y, width: 1, height: 1, elevation });
  const scene = makeScene({ tiles: [roof, awning, decor], regions, tokens: [] });
  const at = (x, y, e) => Object.assign(tok(x, y, e), { parent: scene });

  assert.ok(Sources.sheltered(at(100, 50)), "under a roof that restricts weather");
  assert.ok(!Sources.sheltered(at(100, 50, 30)), "standing on that roof");
  assert.ok(Sources.sheltered(at(650, 0)), "under a tile ticked as a shelter");
  assert.ok(!Sources.sheltered(at(950, 50)), "an ordinary tile doesn't shelter");
  assert.ok(Sources.sheltered(at(100, 600)), "a Suppress Weather region");
  assert.ok(Sources.sheltered(at(500, 600)), "a region named like a shelter keyword");
  assert.ok(!Sources.sheltered(at(900, 600)), "a switched-off behavior doesn't count");
  assert.ok(!Sources.sheltered(at(1500, 1500)), "out in the open");

  // A tile turned 90 degrees.
  const turned = { x: 0, y: 0, width: 400, height: 100, rotation: 90 };
  assert.ok(inTile(turned, { x: 200, y: 200 }));
  assert.ok(!inTile(turned, { x: 20, y: 50 }));
  assert.ok(suppressesWeather({ behaviors: [{ type: "suppressWeather" }] }));
});

/* ---------------------------------------- */
/*  Who the weather reaches                 */
/* ---------------------------------------- */

test("the weather reaches every character on the scene, out of combat too, with its obscurement, and so do light and darkness", () => {
  const doc = (name, x = 2000) => {
    const actor = makeActor({ name, hasPlayerOwner: false });
    return { id: name, name, actor, x, y: 2000, width: 1, height: 1, elevation: 0, texture: {} };
  };
  const a = doc("Ganger");
  const b = doc("Bystander");
  const scene = makeScene({ tokens: [a, b] });
  globalThis.canvas = { scene, ready: false };
  assert.deepEqual(Environment.weatherScope().map((d) => d.id).sort(), ["Bystander", "Ganger"]);
  const { desired } = Environment.evaluate(a, Sources.weather());
  assert.ok(desired.has("wxAcidRain") && desired.has("wxHeavyRain"), "the weather's conditions");
  assert.ok(![...desired.keys()].some((id) => ["lowLight", "darkness"].includes(id)), "no light read before the canvas is up");
  // The rain itself is in the way of everyone it falls on, in a fight or not: Obscured at the weather's own penalty.
  assert.ok(desired.has("obscured"), "the weather's obscurement, outside the encounter too");
  assert.deepEqual(desired.get("obscured").changes.map((c) => [c.key, c.value]), [["bonuses.perceptionSight", -2], ["bonuses.ranged", -2], ["bonuses.melee", -2]]);
  assert.match(desired.get("obscured").name, /\(-2\)/, "named for what it takes off");

  // In poor light as well, in a fight or not (nobody here is in one): two conditions, each for what it is.
  const savedLevel = Environment.levelFor;
  const savedReady = canvas.ready;
  canvas.ready = true;
  const sight = (d, id) => d.get(id)?.changes.find((c) => c.key === "bonuses.ranged")?.value;
  Environment.levelFor = () => "dim";
  let d = Environment.evaluate(a, Sources.weather()).desired;
  assert.equal(sight(d, "lowLight"), -1, "Low Light shows as itself");
  assert.equal(sight(d, "obscured"), -2, "and the rain as Obscured");
  assert.match(d.get("lowLight").name, /\(-1\)$/);
  assert.match(d.get("obscured").name, /\(-2\)$/);
  assert.ok(!d.has("darkness"));
  // In the dark, in the rain: both in full. Nothing caps a sight penalty.
  Environment.levelFor = () => "dark";
  d = Environment.evaluate(a, Sources.weather()).desired;
  assert.equal(sight(d, "darkness"), -4);
  assert.equal(sight(d, "obscured"), -2, "-6 in all");
  assert.ok(!d.has("lowLight"));
  Environment.levelFor = () => "bright";
  d = Environment.evaluate(a, Sources.weather()).desired;
  assert.equal(sight(d, "obscured"), -2);
  assert.ok(!d.has("lowLight") && !d.has("darkness"), "rain alone");
  Environment.levelFor = savedLevel;
  canvas.ready = savedReady;
  assert.deepEqual(sightParts({ level: "dim", weather: -4, cap: 4 }), { total: -4, light: { id: "lowLight", value: -1 }, obscured: -3, capped: true }, "smog in low light: the light in full, the weather what's left under the cap");
  assert.deepEqual(sightParts({ level: "dim", weather: -4, cap: 0 }), { total: -5, light: { id: "lowLight", value: -1 }, obscured: -4, capped: false }, "no cap: both in full");
  assert.deepEqual(sightParts({ level: "dark", weather: -2, vision: true }), { total: 0, light: null, obscured: 0, capped: false });

  // Under a roof: nothing.
  scene.tiles = [{ x: 1900, y: 1900, width: 300, height: 300, rotation: 0, elevation: 10, restrictions: { weather: true }, flags: {} }];
  assert.equal(Environment.evaluate(a, Sources.weather()).desired.size, 0);
  scene.tiles = [];

  return Settings.set("weatherEveryone", false).then(() => {
    assert.deepEqual(Environment.weatherScope(), [], "off: only the encounter");
    globalThis.canvas = null;
  });
});

/* ---------------------------------------- */
/*  Ambience                                */
/* ---------------------------------------- */

test("ambience follows the scene's weather; Indoors, Off and the GM's switch silence it", async () => {
  const storm = makeScene({ weather: "ncmThunderstorm", flags: { weatherFx: { weather: "ncmThunderstorm", preset: "ncmThunderstorm" } } });
  assert.deepEqual(WeatherFx.plan(storm), { sounds: ["rainHeavy"], lightning: true });
  const rad = makeScene({ weather: "ncmRadioactiveWind" });
  assert.deepEqual(WeatherFx.plan(rad).sounds, ["wind", "geiger"]);
  // The GM's own Foundry rain still sounds like rain.
  assert.deepEqual(WeatherFx.plan(makeScene({ weather: "rain" })).sounds, ["rainLight"]);
  // A preset that fell back to Foundry's plain one keeps its own sound and lightning.
  const fallback = makeScene({ weather: "rainStorm", flags: { weatherFx: { weather: "rainStorm", preset: "ncmThunderstorm" } } });
  assert.equal(WeatherFx.plan(fallback).lightning, true);
  assert.deepEqual(WeatherFx.plan(makeScene({ mode: "indoor", weather: "ncmAcidRain" })).sounds, []);
  assert.deepEqual(WeatherFx.plan(makeScene({ mode: "off", weather: "rain" })).sounds, []);
  await Settings.set("weatherFx", false);
  assert.deepEqual(WeatherFx.plan(storm).sounds, []);
  // Quiet: a loop is a third of the player's FX volume or less.
  for (const a of Object.values(AMBIENCE)) assert.ok(WeatherFx.volume(a.level) <= 0.4 * 0.45 + 1e-9);
});
