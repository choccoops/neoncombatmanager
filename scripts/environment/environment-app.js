import { MODULE_ID, TEMPLATE_PATH, LANG, HOOKS, FLAGS } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Registry } from "../conditions/registry.js";
import { Sources } from "./sources.js";
import { Environment } from "./environment.js";
import { WEATHER_CONDITION } from "./weather-data.js";
import { L } from "../util.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const SKY = ["clear", "overcast", "lightRain", "heavyRain"];
const STRANGE = ["acidRain", "bloodRain", "ashStorm", "dustStorm", "inversionSmog", "deadlyThunderstorm", "radioactiveWindstorm", "coldSnap", "heatWave", "flooding", "blackout"];
const BANDS = ["freezing", "cold", "cool", "warm", "hot", "scorching"];

/**
 * The GM's Environment window: where the weather comes from (Neon Hub's calendar or a manual
 * pick), whether this scene is outdoors, and what light, weather and gear add up to for each
 * character in the encounter right now.
 */
export class EnvironmentApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-environment`,
    tag: "form",
    classes: ["neon-combat", "ncm-window", "ncm-environment"],
    window: { icon: "fa-solid fa-cloud-moon-rain", resizable: true },
    position: { width: 720, height: 640 },
    form: { handler: EnvironmentApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: { refreshEnv: EnvironmentApp.#onRefresh }
  };

  static PARTS = { body: { template: `${TEMPLATE_PATH}/environment.hbs`, scrollable: [".ncm-env-rows"] } };

  static open() {
    this.instance ??= new this();
    this.instance.render(true);
    return this.instance;
  }

  get title() {
    return L(`${LANG}.Environment.Title`);
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    this._hook = Hooks.on(HOOKS.environmentChanged, () => this.render());
  }

  _onClose(options) {
    super._onClose?.(options);
    Hooks.off(HOOKS.environmentChanged, this._hook);
    EnvironmentApp.instance = null;
  }

  async _prepareContext() {
    const weather = Environment.state.weather ?? Sources.weather();
    const source = Settings.get("weatherSource");
    const manual = Settings.get("manualWeather") ?? {};
    const scene = canvas?.scene ?? null;
    const sceneMode = scene?.getFlag(MODULE_ID, FLAGS.weather) ?? "default";
    const calendars = Sources.calendars();
    const cal = Sources.calendar();
    const opt = (list, value, prefix) => list.map((k) => ({ value: k, label: L(`${prefix}.${k}`), selected: k === value }));
    const level = (l) => L(`${LANG}.Environment.Level.${l}`);
    return {
      gm: game.user.isGM,
      hub: !!Sources.hub(),
      source,
      sources: opt(["neonhub", "manual", "off"], source, `${LANG}.Settings.WeatherSource`),
      calendars: calendars.map((c) => ({ value: c.id, label: c.name, selected: c.id === cal?.id })),
      manual: source === "manual" || (source === "neonhub" && !Sources.hub()),
      sky: opt(SKY, manual.cond ?? "clear", `${LANG}.Weather`),
      strange: [{ value: "", label: L(`${LANG}.Environment.NoStrange`), selected: !manual.strange }, ...opt(STRANGE, manual.strange, `${LANG}.Weather`)],
      bands: opt(BANDS, manual.band ?? "warm", `${LANG}.Band`),
      now: weather.keys.map((k) => Registry.get(WEATHER_CONDITION[k])).filter(Boolean).map((c) => ({ img: c.img, name: c.name, hint: c.hint })),
      band: weather.band ? L(`${LANG}.Band.${weather.band}`) : "",
      temp: Number.isFinite(weather.f) ? `${weather.f}°F / ${Math.round(((weather.f - 32) * 5) / 9)}°C` : "",
      calendarName: weather.calendar,
      scene: scene ? { name: scene.name, darkness: Math.round(Compat.darkness(scene) * 100), global: Compat.globalLight(scene).enabled } : null,
      sceneModes: opt(["default", "outdoor", "indoor", "off"], sceneMode, `${LANG}.SceneWeather`),
      rows: (Environment.state.rows ?? []).map((r) => ({
        ...r,
        levelLabel: level(r.level),
        sightLabel: r.sight ? String(r.sight) : "—",
        conditions: r.conditions.map((c) => ({ img: c.img, name: c.name }))
      }))
    };
  }

  static async #onSubmit(event, form, formData) {
    if (!game.user.isGM) return;
    const d = formData.object;
    if (d.source && d.source !== Settings.get("weatherSource")) await Settings.set("weatherSource", d.source);
    if (d.calendar !== undefined && d.calendar !== Settings.get("weatherCalendar")) await Settings.set("weatherCalendar", d.calendar);
    if (d.cond !== undefined) {
      const next = { cond: d.cond, band: d.band, strange: d.strange ?? "" };
      const cur = Settings.get("manualWeather") ?? {};
      if (next.cond !== cur.cond || next.band !== cur.band || next.strange !== cur.strange) await Settings.set("manualWeather", next);
    }
    const scene = canvas?.scene;
    if (scene && d.sceneMode && d.sceneMode !== (scene.getFlag(MODULE_ID, FLAGS.weather) ?? "default")) await scene.setFlag(MODULE_ID, FLAGS.weather, d.sceneMode);
    this.render();
  }

  static async #onRefresh() {
    await Environment.refresh();
    this.render();
  }
}
