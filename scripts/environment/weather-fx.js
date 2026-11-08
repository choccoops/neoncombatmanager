import { MODULE_ID, NEON_HUB_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { FX } from "../fx.js";
import { Sources } from "./sources.js";
import { debounce } from "../util.js";

/**
 * Weather you can see and hear: Night City's weather (Neon Hub's calendar, or the GM's manual
 * pick) becomes the scene's own Foundry weather, using presets built from Foundry's rain, storm,
 * snow and fog and tinted for the city (acid rain green, blood rain red, ash grey, dust brown,
 * smog yellow, radioactive wind green). Foundry draws it, so it's the same for everyone and it
 * stays off under weather-restricting roof tiles and inside Suppress Weather regions.
 *
 * Scenes: Outdoors gets it; Indoors doesn't; Off (HUB, title and menu screens) is never touched,
 * not even its own weather. A weather the GM set by hand on a scene stays: only what this module
 * set itself is ever changed.
 *
 * Each client adds quiet ambience (rain, wind, a Geiger counter) and, in a thunderstorm, soft
 * lightning flashes with thunder.
 */

const sfx = (name) => [`modules/${MODULE_ID}/assets/fx/sfx/${name}-a.ogg`, `modules/${MODULE_ID}/assets/fx/sfx/${name}-b.ogg`];

/** Ambience loops, with their share of the player's FX volume. */
export const AMBIENCE = {
  rainLight: { files: sfx("rain-light-loop"), level: 0.35 },
  rainHeavy: { files: sfx("rain-heavy-loop"), level: 0.35 },
  wind: { files: sfx("wind-storm-loop"), level: 0.3 },
  geiger: { files: sfx("geiger-loop"), level: 0.2 },
  thunder: { files: sfx("thunder"), level: 0.45 }
};

/**
 * The presets: which of Foundry's own to build from, a tint ([r, g, b], 0-1) and a strength,
 * the ambience to play and whether lightning strikes.
 */
export const PRESETS = {
  ncmThunderstorm: { from: ["rainStorm"], tint: [0.75, 0.85, 1], strength: 1.2, sounds: ["rainHeavy"], lightning: true },
  ncmAcidRain: { from: ["rainStorm"], tint: [0.65, 1, 0.3], strength: 1, sounds: ["rainHeavy"] },
  ncmBloodRain: { from: ["rain"], tint: [1, 0.28, 0.28], strength: 1.1, sounds: ["rainLight"] },
  ncmHeavyRain: { from: ["rainStorm"], tint: null, strength: 1, sounds: ["rainHeavy"] },
  ncmLightRain: { from: ["rain"], tint: null, strength: 0.7, sounds: ["rainLight"] },
  ncmAshStorm: { from: ["snow", "fog"], tint: [0.55, 0.55, 0.58], strength: 1.2, sounds: ["wind"] },
  ncmDustStorm: { from: ["fog", "snow"], tint: [0.85, 0.62, 0.38], strength: 1.3, sounds: ["wind"] },
  ncmRadioactiveWind: { from: ["fog", "snow"], tint: [0.5, 1, 0.35], strength: 1.1, sounds: ["wind", "geiger"] },
  ncmSmog: { from: ["fog"], tint: [0.85, 0.78, 0.45], strength: 1.6, sounds: [] },
  ncmColdSnap: { from: ["snow"], tint: [0.85, 0.95, 1], strength: 1, sounds: ["wind"] },
  ncmHeatWave: { from: ["fog"], tint: [1, 0.6, 0.3], strength: 0.45, sounds: [] }
};

/** Neon Hub weather keys to a preset, the most dramatic first when several are in effect. */
export const PRIORITY = [
  ["deadlyThunderstorm", "ncmThunderstorm"],
  ["acidRain", "ncmAcidRain"],
  ["bloodRain", "ncmBloodRain"],
  ["radioactiveWindstorm", "ncmRadioactiveWind"],
  ["ashStorm", "ncmAshStorm"],
  ["dustStorm", "ncmDustStorm"],
  ["inversionSmog", "ncmSmog"],
  ["heavyRain", "ncmHeavyRain"],
  ["coldSnap", "ncmColdSnap"],
  ["lightRain", "ncmLightRain"],
  ["flooding", "ncmLightRain"],
  ["heatWave", "ncmHeatWave"]
];

/** Foundry's own presets (set by a GM by hand) get ambience too. */
const CORE_SOUNDS = { rain: ["rainLight"], rainStorm: ["rainHeavy"], blizzard: ["wind"], snow: [] };

/** Scene flag: what this module last put on the scene, { weather (the Foundry id set), preset (ours) }. */
export const FLAG = "weatherFx";

/** The preset for a set of weather keys, or "" for clear skies. */
export function presetFor(keys = []) {
  return PRIORITY.find(([key]) => keys.includes(key))?.[1] ?? "";
}

/**
 * Build one preset from Foundry's own: copy each source preset's effects, giving each a unique id,
 * the tint, and opacity/intensity scaled by strength. null when Foundry's presets aren't the
 * expected shape (then the plain source preset is used instead).
 */
export function buildPreset(id, spec, base = globalThis.CONFIG?.weatherEffects ?? {}) {
  const sources = spec.from.map((k) => base[k]).filter((p) => p && Array.isArray(p.effects));
  if (sources.length !== spec.from.length) return null;
  const effects = [];
  sources.forEach((src, i) => {
    for (const e of src.effects) {
      const config = { ...(e.config ?? {}) };
      if (spec.tint) config.tint = [...spec.tint];
      for (const k of ["opacity", "intensity"]) if (Number.isFinite(config[k])) config[k] *= spec.strength;
      effects.push({ ...e, id: `${id}-${i}-${e.id ?? "fx"}`, config });
    }
  });
  return { ...sources[0], id, label: `NEONCOMBAT.WeatherFx.${id}`, effects };
}

export const WeatherFx = {
  /** The preset id each of ours resolved to (itself, or a plain Foundry fallback). */
  resolved: {},
  _ambience: [],
  _lightning: null,
  _playing: null,

  /** Add the presets to CONFIG.weatherEffects (init). */
  registerPresets() {
    const base = globalThis.CONFIG?.weatherEffects;
    if (!base) return;
    for (const [id, spec] of Object.entries(PRESETS)) {
      try {
        const preset = buildPreset(id, spec, base);
        if (preset) {
          base[id] = preset;
          this.resolved[id] = id;
        } else this.resolved[id] = spec.from.find((k) => base[k]) ?? "";
      } catch (err) {
        console.warn(`${MODULE_ID} | weather preset ${id}`, err);
        this.resolved[id] = spec.from.find((k) => base[k]) ?? "";
      }
    }
  },

  init() {
    const soon = debounce(() => this.syncAll().catch((err) => console.error(`${MODULE_ID} | scene weather`, err)), 500);
    this.soon = soon;
    for (const h of [`${NEON_HUB_ID}.weatherChanged`, `${NEON_HUB_ID}.calendarChanged`, `${MODULE_ID}.environmentConfig`, "updateWorldTime", "canvasReady"]) {
      Hooks.on(h, () => soon());
    }
    // A player arriving on a scene, or a scene's weather mode changing.
    Hooks.on("updateUser", (user, changed) => {
      if ("viewedScene" in (changed ?? {})) soon();
    });
    Hooks.on("updateScene", (scene, changed) => {
      if (changed?.flags?.[MODULE_ID] && FLAG_KEYS.some((k) => k in changed.flags[MODULE_ID])) soon();
      if (scene.id === canvas?.scene?.id && ("weather" in (changed ?? {}) || changed?.flags?.[MODULE_ID])) this.ambience();
    });
    Hooks.on("canvasReady", () => this.ambience());
    Hooks.on("canvasTearDown", () => this.stopAmbience());
    Hooks.on(`${MODULE_ID}.fxChanged`, () => this.ambience());
  },

  /* ---------------------------------------- */
  /*  The scene's weather (active GM)         */
  /* ---------------------------------------- */

  /** The Night City preset a scene should show now (ncmAcidRain...), or "" for none. */
  desiredFor(scene, weather) {
    if (!Settings.get("weatherFx") || Sources.sceneMode(scene) !== "outdoor") return "";
    return presetFor(weather?.keys ?? []);
  },

  /** Scenes someone is looking at: the active one and every active user's. */
  scenesInUse() {
    const ids = new Set([game.scenes?.active?.id, canvas?.scene?.id]);
    for (const u of game.users ?? []) if (u.active && u.viewedScene) ids.add(u.viewedScene);
    return [...ids].map((id) => game.scenes?.get?.(id)).filter(Boolean);
  },

  async syncAll() {
    if (!Compat.isActiveGM) return;
    const weather = Sources.weather();
    for (const scene of this.scenesInUse()) await this.syncScene(scene, weather);
  },

  /**
   * Put the right preset on a scene. A weather the GM set by hand is never touched; on an Off
   * scene (HUB, title screen) nothing is set, and only a weather this module left there is taken off.
   */
  async syncScene(scene, weather = Sources.weather()) {
    if (!scene) return false;
    const ours = scene.flags?.[MODULE_ID]?.[FLAG] ?? null;
    const current = scene.weather ?? "";
    if (current && current !== ours?.weather) return false; // the GM's own
    if (Sources.sceneMode(scene) === "off" && !ours) return false;
    const preset = this.desiredFor(scene, weather);
    const want = preset ? (this.resolved[preset] ?? preset) : "";
    if (want === current && (ours?.preset ?? "") === preset) return false;
    const flag = want ? { [`flags.${MODULE_ID}.${FLAG}`]: { weather: want, preset } } : { [`flags.${MODULE_ID}.-=${FLAG}`]: null };
    await scene.update({ weather: want, ...flag });
    return true;
  },

  /* ---------------------------------------- */
  /*  Ambience and lightning (each client)    */
  /* ---------------------------------------- */

  /** What this client should hear and see for the scene it's on. */
  plan(scene = canvas?.scene) {
    const none = { sounds: [], lightning: false };
    if (!scene || Sources.sceneMode(scene) !== "outdoor" || !Settings.get("weatherFx")) return none;
    const weather = scene.weather ?? "";
    if (!weather) return none;
    const ours = scene.flags?.[MODULE_ID]?.[FLAG];
    const id = ours?.weather === weather && PRESETS[ours.preset] ? ours.preset : PRESETS[weather] ? weather : null;
    if (id) return { sounds: PRESETS[id].sounds, lightning: !!PRESETS[id].lightning };
    return { sounds: CORE_SOUNDS[weather] ?? [], lightning: false };
  },

  volume(level) {
    const v = Number(level) * Number(Settings.get("fxVolume") ?? 0);
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  },

  /** Start or change the ambience loops (and lightning) to match the scene. */
  async ambience() {
    const plan = Settings.get("weatherAmbience") ? this.plan() : { sounds: [], lightning: false };
    const key = `${plan.sounds.join("+")}|${plan.lightning}|${Settings.get("fxVolume")}`;
    if (key === this._playing) return;
    this._playing = key;
    this.stopAmbience({ keepKey: true });
    for (const name of plan.sounds) {
      const a = AMBIENCE[name];
      const volume = this.volume(a.level);
      if (!volume) continue;
      const src = a.files[Math.floor(Math.random() * a.files.length)];
      try {
        const sound = await foundry.audio.AudioHelper.play({ src, volume: 0, loop: true, channel: "environment" }, false);
        if (!sound) continue;
        this._ambience.push(sound);
        sound.fade?.(volume, { duration: 2500 });
        if (!sound.fade) sound.volume = volume;
      } catch (err) {
        console.warn(`${MODULE_ID} | weather ambience ${name}`, err);
      }
    }
    if (plan.lightning) this._scheduleLightning();
  },

  stopAmbience({ keepKey = false } = {}) {
    for (const s of this._ambience) {
      try {
        if (s.fade) s.fade(0, { duration: 1500 }).then?.(() => s.stop?.());
        else s.stop?.();
        setTimeout(() => s.stop?.(), 1700);
      } catch {
        /* already gone */
      }
    }
    this._ambience = [];
    clearTimeout(this._lightning);
    this._lightning = null;
    if (!keepKey) this._playing = null;
  },

  _scheduleLightning() {
    clearTimeout(this._lightning);
    this._lightning = setTimeout(() => {
      this.strike();
      this._scheduleLightning();
    }, 12000 + Math.random() * 23000);
  },

  /** A lightning flash (soft; none with motion off or reduced motion) and, a moment later, thunder. */
  strike() {
    if (!canvas?.ready) return;
    const motion = !!Settings.get("fxMotion") && !FX.reduced();
    if (motion && typeof document !== "undefined") {
      const flash = document.createElement("div");
      flash.className = "ncm-lightning";
      document.body.append(flash);
      setTimeout(() => flash.remove(), 1200);
    }
    const thunder = AMBIENCE.thunder;
    const volume = this.volume(thunder.level);
    if (!volume) return;
    const src = thunder.files[Math.floor(Math.random() * thunder.files.length)];
    setTimeout(() => {
      try {
        foundry.audio.AudioHelper.play({ src, volume, loop: false, channel: "environment" }, false);
      } catch {
        /* no audio */
      }
    }, 400 + Math.random() * 2200);
  }
};

/** Scene flags whose change means the weather visuals need another look. */
const FLAG_KEYS = ["weather"];
