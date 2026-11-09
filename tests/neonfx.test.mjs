/** Neon FX: condition looks, the Cyberpsychosis and Sandevistan switches, motion, the trail, macros, and Extreme Cyberpsychosis. */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { makeActor, registerSettings, settle, root, asGM, missingKeys, notes } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
const Settings = await registerSettings();

/* ---------------------------------------- */
/*  Sequencer, as far as Neon FX uses it    */
/* ---------------------------------------- */

const played = []; // every section played: { kind, calls: [[method, args]] }
const live = []; // persistent effects: { name, object }
const sounds = []; // sounds played: { files, volume, name, local }
const ended = []; // endSounds names
let jb2aDb = [];

const call = (s, m) => s.calls.find(([n]) => n === m)?.[1];
class Sequence {
  constructor(options) {
    this.options = options;
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
      if (s.kind === "effect" && call(s, "persist")) live.push({ name: call(s, "name")?.[0], object: call(s, "attachTo")?.[0] });
      if (s.kind === "sound") sounds.push({ files: call(s, "file")[0], volume: call(s, "volume")[0], name: call(s, "name")?.[0] ?? null, local: !!call(s, "locally") });
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
    getEffects: ({ object }) => live.filter((e) => e.object === object).map((e) => ({ data: { name: e.name } })),
    async endEffects({ name, object }) {
      for (let i = live.length - 1; i >= 0; i--) if (live[i].name === name && live[i].object === object) live.splice(i, 1);
    }
  },
  SoundManager: { endSounds: ({ name }, push) => ended.push([name, push]) }
};
game.modules.set("sequencer", { id: "sequencer", active: true });

/* ---------------------------------------- */
/*  A canvas with tokens                    */
/* ---------------------------------------- */

const ticker = { fns: new Set(), add(fn) { this.fns.add(fn); }, remove(fn) { this.fns.delete(fn); } };
globalThis.canvas = {
  ready: true,
  grid: { size: 100 },
  app: { ticker },
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
  const token = {
    id,
    name: actor.name,
    actor,
    w: 100,
    h: 100,
    visible: true,
    position: { x, y },
    mesh: { position: { x: x + 50, y: y + 50, set(a, b) { this.x = a; this.y = b; } }, rotation: 0, texture: { width: 400, height: 400 } },
    renderFlags: { set() {} }
  };
  token.document = {
    id,
    object: token,
    isOwner: true,
    width: 1,
    height: 1,
    flags: {},
    texture: { src: "tokens/v.webp", scaleX: 1, scaleY: 1, fit: "contain" },
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
const { Triggers } = await import("../scripts/conditions/triggers.js");
const { CONDITIONS, BY_ID } = await import("../scripts/conditions/data.js");
const { NeonFX, SWITCHES } = await import("../scripts/neonfx/neonfx.js");
const { RECIPES, recipeFor, LAYERED } = await import("../scripts/neonfx/recipes.js");
const { SOUNDS, Core } = await import("../scripts/neonfx/core.js");
const { Motion, offsetFor } = await import("../scripts/neonfx/motion.js");
const { Trail } = await import("../scripts/neonfx/sandevistan.js");

Hooks.on("preCreateActiveEffect", (e, d, o, u) => Conditions.onPreCreate(e, d, o, u));
Hooks.on("createActiveEffect", (e, o, u) => Conditions.onCreate(e, o, u));
Hooks.on("deleteActiveEffect", (e, o, u) => Conditions.onDelete(e, o, u));
Registry.refresh();
NeonFX.init();

const names = (token) => live.filter((e) => e.object === token).map((e) => e.name);

beforeEach(async () => {
  asGM(true);
  played.length = 0;
  live.length = 0;
  sounds.length = 0;
  ended.length = 0;
  notes.length = 0;
  jb2aDb = [];
  Core.clearCache();
  Motion.clear();
  Trail.clear();
  NeonFX._made.clear();
  NeonFX._seen.clear();
  canvas.tokens.placeables.length = 0;
  for (const [k, v] of Object.entries({ fxEnabled: true, fxConditions: true, fxVolume: 0.4, fxMotion: true, mirrorCyberpsychosis: true })) await Settings.set(k, v);
});

/* ---------------------------------------- */
/*  Data                                    */
/* ---------------------------------------- */

test("every look belongs to a condition (or a switch), and every file it names ships", () => {
  for (const key of Object.keys(RECIPES)) assert.ok(BY_ID[key] || SWITCHES.includes(key), `recipe ${key}`);
  const src = readFileSync(path.join(root, "scripts", "neonfx", "recipes.js"), "utf8");
  const files = [...src.matchAll(/img\("([^"]+)"\)/g)].map((m) => m[1]);
  files.push(...[1, 2, 3, 4].map((n) => `glitch-0${n}.webp`));
  for (const f of files) assert.ok(existsSync(path.join(root, "assets", "fx", "img", f)), `assets/fx/img/${f}`);
  for (const s of Object.values(SOUNDS)) {
    for (const f of s.files) assert.ok(existsSync(path.join(root, f.replace(`modules/${M}/`, ""))), f);
    assert.ok(s.level > 0 && s.level <= 0.7, "sounds play at well under full volume");
  }
  // Every Critical Injury hits, every quickhack uploads.
  for (const c of CONDITIONS.filter((x) => x.category === "critical" || x.category === "quickhack")) assert.ok(recipeFor(Registry.get(c.id))?.once?.length, c.id);
  assert.ok(LAYERED.has("extremeCyberpsychosis") && LAYERED.has("psycho") && LAYERED.has("sandevistan"));
  assert.equal(missingKeys.size, 0, [...missingKeys].join(", "));
});

test("JB2A is used when installed, with the wanted colour; otherwise Neon FX's own art", () => {
  assert.equal(Core.jb2a(["jb2a.flames.01", "jb2a.flames"], ["orange"]), null);
  Core.clearCache();
  jb2aDb = ["jb2a.flames.02.orange", "jb2a.static_electricity.01.blue"];
  assert.equal(Core.jb2a(["jb2a.flames.01", "jb2a.flames.02"], ["orange"]), "jb2a.flames.02.orange");
  assert.equal(Core.jb2a(["jb2a.static_electricity"], ["blue"]), "jb2a.static_electricity.01.blue");
});

/* ---------------------------------------- */
/*  Extreme Cyberpsychosis                  */
/* ---------------------------------------- */

test("Extreme Cyberpsychosis follows Humanity below 0, and only the mirror's own goes", async () => {
  const actor = makeActor({ name: "Gonk" });
  await actor.update({ "system.derivedStats.humanity.value": -3 });
  await Triggers.syncPsychosis(actor);
  await settle();
  const [effect] = Conditions.effects(actor, "extremeCyberpsychosis");
  assert.ok(effect, "added below 0");
  assert.equal(effect.getFlag(M, "managed"), "humanity");
  assert.ok(effect.changes.some((c) => c.key === "bonuses.allActions" && Number(c.value) === 2));

  await actor.update({ "system.derivedStats.humanity.value": 0 });
  await Triggers.syncPsychosis(actor);
  assert.ok(Conditions.has("extremeCyberpsychosis", actor), "0 isn't positive yet");

  await actor.update({ "system.derivedStats.humanity.value": 4 });
  await Triggers.syncPsychosis(actor);
  await settle();
  assert.ok(!Conditions.has("extremeCyberpsychosis", actor), "positive again: gone");

  // A GM's own stays whatever Humanity says.
  await Conditions.add("extremeCyberpsychosis", actor);
  await Triggers.syncPsychosis(actor);
  await settle();
  assert.ok(Conditions.has("extremeCyberpsychosis", actor));

  // Switched off: nothing happens.
  const other = makeActor({ name: "Quiet" });
  await Settings.set("mirrorCyberpsychosis", false);
  await other.update({ "system.derivedStats.humanity.value": -10 });
  await Triggers.syncPsychosis(other);
  assert.ok(!Conditions.has("extremeCyberpsychosis", other));
});

/* ---------------------------------------- */
/*  Condition looks                         */
/* ---------------------------------------- */

test("a condition's look appears and goes with it, drawn once by the GM", async () => {
  const actor = makeActor({ name: "Burner" });
  const token = makeToken(actor);
  await Conditions.add("onFireStrong", actor);
  await settle();
  assert.ok(names(token).length >= 1);
  assert.ok(names(token).every((n) => n === `ncm-fx-onFireStrong-${token.id}`));

  // A second refresh doesn't draw it twice.
  const before = names(token).length;
  NeonFX.refresh(token);
  await settle();
  assert.equal(names(token).length, before);

  await Conditions.remove("onFireStrong", actor);
  await settle();
  assert.deepEqual(names(token), []);
});

test("players don't draw the shared looks while a GM is on (no doubles)", async () => {
  const actor = makeActor({ name: "Shocked" });
  const token = makeToken(actor);
  asGM(false);
  NeonFX.refresh(token);
  await Conditions.add("electrocuted", actor);
  await settle();
  assert.deepEqual(names(token), [], "the player client leaves it to the GM");
  asGM(true);
  NeonFX.refresh(token);
  await settle();
  assert.ok(names(token).length);
});

test("one-offs and sounds: a quickhack uploads, quietly, on each client", async () => {
  const actor = makeActor({ name: "Target" });
  makeToken(actor);
  await Conditions.add("qhShortCircuit", actor);
  await settle();
  const local = played.filter((s) => s.kind === "effect" && call(s, "locally"));
  assert.ok(local.length >= 2, "the upload burst is drawn locally");
  const zap = sounds.find((s) => s.files[0].includes("/zap-"));
  assert.ok(zap?.local, "the zap is this client's own");
  assert.ok(Math.abs(zap.volume - SOUNDS.zap.level * 0.4) < 1e-9, "level x the player's FX volume");
});

test("FX volume 0 is silence; condition visuals off or the dead show nothing", async () => {
  await Settings.set("fxVolume", 0);
  const actor = makeActor({ name: "Quiet" });
  const token = makeToken(actor);
  await Conditions.add("qhSonicShock", actor);
  await settle();
  assert.equal(sounds.length, 0);
  assert.ok(names(token).length, "the look still shows");

  await Settings.set("fxConditions", false);
  await settle();
  assert.deepEqual(names(token), [], "visuals off: cleared");

  await Settings.set("fxConditions", true);
  await Conditions.add("dead", actor);
  await settle();
  assert.deepEqual(names(token), [], "the dead don't glitch");
});

/* ---------------------------------------- */
/*  The switches                            */
/* ---------------------------------------- */

test("Sandevistan switches on and off with sound, and the look follows", async () => {
  const actor = makeActor({ name: "David" });
  const token = makeToken(actor);
  canvas.tokens.controlled = [token];
  await NeonFX.toggle("sandevistan");
  await settle();
  assert.equal(token.document.flags[M].fx.sandevistan, true);
  assert.ok(names(token).every((n) => n === `ncm-fx-sandevistan-${token.id}`) && names(token).length);
  assert.ok(sounds.some((s) => s.files[0].includes("sande-activate")));
  const hum = sounds.find((s) => s.files[0].includes("sande-loop"));
  assert.ok(hum?.name && hum.volume < 0.2, "a quiet, named hum");

  await NeonFX.toggle("sandevistan");
  await settle();
  assert.equal(token.document.flags[M].fx.sandevistan, undefined);
  assert.deepEqual(names(token), []);
  assert.ok(sounds.some((s) => s.files[0].includes("sande-deactivate")));
  assert.ok(ended.some(([n, push]) => n === hum.name && push === false), "the hum stops on this client");
  canvas.tokens.controlled = [];
});

test("Cyberpsychosis glitch: the real token shakes, nothing hides it, clear switches it off", async () => {
  const actor = makeActor({ name: "Cyberpsycho" });
  const token = makeToken(actor);
  await NeonFX.toggle("psycho", [token], true);
  await settle();
  assert.equal(Motion.modeOf(token), "psycho");
  assert.ok(names(token).length >= 6, "glitch layers");
  assert.ok(!("alpha" in token.document), "the token's opacity is never touched");
  assert.ok(sounds.some((s) => s.files[0].includes("psycho-sting") && s.volume <= 0.25), "the sting is quiet");

  await NeonFX.clear([token]);
  await settle();
  assert.equal(Motion.modeOf(token), null);
  assert.deepEqual(names(token), []);
});

test("you can only switch tokens you own", async () => {
  const actor = makeActor({ name: "Not yours" });
  const token = makeToken(actor);
  token.document.isOwner = false;
  const done = await NeonFX.toggle("sandevistan", [token]);
  assert.deepEqual(done, []);
  assert.ok(notes.some(([k]) => k === "warn"));
});

/* ---------------------------------------- */
/*  Motion and the trail                    */
/* ---------------------------------------- */

test("motion moves only the art, gives it back exactly, and follows Foundry's own moves", () => {
  const actor = makeActor({ name: "Shaky" });
  const token = makeToken(actor, { x: 200, y: 300 });
  Motion.set(token, "psycho");
  let jolted = false;
  for (let t = 0; t < 2000; t += 16) {
    Motion.tick(t);
    if (token.mesh.position.x !== 250 || token.mesh.position.y !== 350) jolted = true;
    assert.ok(Math.abs(token.mesh.position.x - 250) <= 100 * 0.07 * 2.5 + 1e-9);
  }
  assert.ok(jolted);
  assert.equal(token.position.x, 200, "the token itself never moves");

  // Foundry places the art somewhere new: that's the new base.
  token.mesh.position.set(650, 350);
  Motion.tick(5000);
  assert.ok(Math.abs(token.mesh.position.x - 650) <= 100 * 0.07 * 2.5 + 1e-9);

  Motion.set(token, null);
  assert.equal(token.mesh.position.x, 650);
  assert.equal(token.mesh.position.y, 350);
  assert.equal(token.mesh.rotation, 0);
  assert.equal(ticker.fns.size, 0, "no ticker left running");

  // Strongest wins; sway is smooth.
  const s = { next: 0, hold: { x: 0, y: 0, r: 0 } };
  const a = offsetFor("sway", s, 1000, 100);
  const b = offsetFor("sway", s, 1016, 100);
  assert.ok(Math.abs(a.x - b.x) < 2);
});

test("motion respects the player's switch", async () => {
  const actor = makeActor({ name: "Drunk" });
  const token = makeToken(actor);
  await Conditions.add("drunk", actor);
  await settle();
  assert.equal(Motion.modeOf(token), "sway");
  await Settings.set("fxMotion", false);
  await settle();
  assert.equal(Motion.modeOf(token), null);
});

test("the Sandevistan trail drops afterimages along the drawn move, on this client only", async () => {
  const actor = makeActor({ name: "Runner" });
  const token = makeToken(actor);
  await NeonFX.toggle("sandevistan", [token], true);
  await settle();
  played.length = 0;
  Hooks.callAll("refreshToken", token, {});
  for (let i = 1; i <= 10; i++) {
    token.position = { x: 50 * i, y: 0 };
    Hooks.callAll("refreshToken", token, {});
  }
  const ghosts = played.filter((s) => s.kind === "effect" && call(s, "copySprite"));
  assert.ok(ghosts.length >= 13 && ghosts.length <= 15, `${ghosts.length} afterimages over 5 squares`);
  assert.ok(ghosts.every((s) => call(s, "locally") && !call(s, "persist")));

  // Hidden from you: no trail.
  played.length = 0;
  token.visible = false;
  token.position = { x: 900, y: 0 };
  Hooks.callAll("refreshToken", token, {});
  assert.equal(played.length, 0);
});

/* ---------------------------------------- */
/*  Macros                                  */
/* ---------------------------------------- */

test("the Neon FX macros go in their folder once", async () => {
  const folders = [];
  const macros = [];
  globalThis.Folder = { create: async (d) => (folders.push({ id: `f${folders.length}`, ...d }), folders.at(-1)) };
  globalThis.Macro = { createDocuments: async (list) => list.map((d) => (macros.push({ ...d, folder: folders.find((f) => f.id === d.folder) }), macros.at(-1))) };
  game.folders = { find: (fn) => folders.find(fn) };
  game.macros = { find: (fn) => macros.find(fn) };
  const made = await NeonFX.installMacros();
  assert.equal(made.length, 6);
  assert.deepEqual(macros.map((m) => m.name), ["Sandevistan", "Cyberpsychosis Glitch", "Extreme Cyberpsychosis", "Clear Neon FX", "AV Landing Zone", "AV Landing"]);
  assert.ok(macros.every((m) => m.type === "script" && m.command.includes(`game.modules.get("${M}").api`)));
  assert.equal((await NeonFX.installMacros()).length, 0);
  assert.equal(folders.length, 1);
  assert.equal(Settings.get("fxMacrosInstalled"), true);
});
