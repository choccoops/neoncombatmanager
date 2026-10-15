import { NEON_HUB_ID, MODULE_ID, FLAGS } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { slug } from "../util.js";
import { activeWeather, manualWeather } from "./weather-data.js";
import { lightLevel, litBy } from "./visibility-data.js";

/**
 * Where the environment comes from: Neon Hub's calendar weather (or the GM's manual pick), the
 * scene's darkness (SmallTime drives it from the clock), its light sources (DF Active Lights and
 * token lights are ordinary light sources), regions marking shelter, and each character's gear.
 */
export const Sources = {
  /** Neon Hub's public API when it's running. */
  hub() {
    const m = game.modules.get(NEON_HUB_ID);
    return m?.active ? m.api ?? null : null;
  },

  /** Neon Hub calendars this user can see. */
  calendars() {
    try {
      return this.hub()?.listCalendars?.() ?? [];
    } catch {
      return [];
    }
  },

  /** The calendar whose weather counts: the GM's pick, else one that follows the clock, else the first. */
  calendar() {
    const list = this.calendars();
    const id = Settings.get("weatherCalendar");
    return list.find((c) => c.id === id) ?? list.find((c) => c.clock) ?? list[0] ?? null;
  },

  /**
   * The weather now: { keys, band, f, source, calendar }.
   * keys are Neon Hub's condition keys (lightRain, acidRain...) plus "hot".
   */
  weather() {
    const mode = Settings.get("weatherSource");
    if (mode === "off") return { keys: [], band: null, f: null, source: "off", calendar: null };
    const hub = this.hub();
    if (mode === "neonhub" && hub) {
      const cal = this.calendar();
      if (cal) {
        try {
          const seen = hub.weather(cal.id);
          const minutes = Number(hub.time?.().minutes) || 0;
          return { ...activeWeather(seen?.actual ?? null, minutes), source: "neonhub", calendar: cal.name };
        } catch (err) {
          console.warn(`${MODULE_ID} | couldn't read Neon Hub's weather`, err);
        }
      }
      return { keys: [], band: null, f: null, source: "neonhub", calendar: null };
    }
    return { ...manualWeather(Settings.get("manualWeather") ?? {}), source: "manual", calendar: null };
  },

  /** A scene's weather mode: outdoor, indoor or off. */
  sceneMode(scene) {
    const mode = scene?.getFlag?.(MODULE_ID, FLAGS.weather) ?? "default";
    return mode === "default" || !mode ? Settings.get("sceneWeatherDefault") : mode;
  },

  /** Is a token under a roof: inside a region whose name has one of the shelter keywords? */
  sheltered(token) {
    const doc = token?.document ?? token;
    const scene = doc?.parent;
    const words = Settings.list("shelterKeywords").map(slug).filter(Boolean);
    if (!scene || !words.length) return false;
    const center = this.center(doc);
    return Compat.regions(scene).some((r) => words.some((w) => slug(r.name).includes(w)) && Compat.inRegion(r, center, doc.elevation ?? 0));
  },

  center(doc) {
    const size = doc?.parent?.grid?.size ?? canvas?.dimensions?.size ?? 100;
    return { x: doc.x + ((doc.width ?? 1) * size) / 2, y: doc.y + ((doc.height ?? 1) * size) / 2 };
  },

  /** How lit a token's spot is on the canvas: bright, dim or dark. */
  lightAt(doc) {
    const scene = doc?.parent ?? canvas?.scene;
    const center = this.center(doc);
    const sources = Compat.lightSources().map((s) => ({
      x: s.x ?? s.data?.x ?? 0,
      y: s.y ?? s.data?.y ?? 0,
      bright: s.data?.bright ?? 0,
      dim: s.data?.dim ?? s.radius ?? 0,
      contains: (x, y) => (typeof s.shape?.contains === "function" ? s.shape.contains(x, y) : true)
    }));
    return lightLevel({
      darkness: Compat.darkness(scene),
      global: Compat.globalLight(scene),
      lit: litBy(center, sources),
      unlit: Compat.insideDarkness(center, doc.elevation ?? 0),
      lowAt: Number(Settings.get("lowLightAt")),
      darkAt: Number(Settings.get("darkAt"))
    });
  },

  /** The protective gear and cyberware a character has in use. */
  gear(actor) {
    return {
      breathing: CPR.hasGear(actor, Settings.list("gearBreathing")),
      radiation: CPR.hasGear(actor, Settings.list("gearRadiation")),
      rain: CPR.hasGear(actor, Settings.list("gearRain")),
      cold: CPR.hasGear(actor, Settings.list("gearCold")),
      heat: CPR.hasGear(actor, Settings.list("gearHeat")),
      vision: CPR.hasGear(actor, Settings.list("gearVision"))
    };
  }
};
