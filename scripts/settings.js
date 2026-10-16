import { MODULE_ID, LANG, ROUND_SECONDS } from "./constants.js";

const K = (key) => `${LANG}.Settings.${key}`;

/** World settings grouped into submenus; everything else shows in Foundry's own list. */
export const MENUS = {
  combat: ["roundSeconds", "turnSeconds", "combatSummary", "npcHealth", "enhanceTracker", "deathSaves", "hazardDamage", "trackMovement"],
  conditions: ["replaceStatuses", "conditionChat", "mirrorWounds", "mirrorCriticals", "critItems", "cltShim"],
  environment: [
    "weatherSource", "sceneWeatherDefault", "shelterKeywords", "weatherOnByDefault", "weatherHazardCards", "visibilityEnabled",
    "lowLightAt", "darkAt", "sightKeys", "visibilityCap", "visibilityFrom", "envOutsideCombat",
    "gearBreathing", "gearRadiation", "gearRain", "gearCold", "gearHeat", "gearVision"
  ]
};

/** Every setting: [key, scope, type, default, extra]. Hidden ones carry config: false. */
const DEFS = [
  // Interface (client)
  ["carouselEnabled", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["carouselSize", "client", String, "medium", { config: true, choices: { small: K("Size.small"), medium: K("Size.medium"), large: K("Size.large") }, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["carouselPlacement", "client", String, "top", { config: true, choices: { top: K("Placement.top"), belowNav: K("Placement.belowNav") }, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["carouselCollapsed", "client", Boolean, false, { config: false }],
  ["partyEnabled", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["partyPosition", "client", String, "bottom", { config: true, choices: { bottom: K("Position.bottom"), left: K("Position.left"), top: K("Position.top") }, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["partyCollapsed", "client", Boolean, false, { config: false }],
  ["partyMembers", "world", Array, [], { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],

  // Combat & time
  ["roundSeconds", "world", Number, ROUND_SECONDS, { range: { min: 0, max: 12, step: 1 }, onChange: () => Hooks.callAll(`${MODULE_ID}.timeConfig`) }],
  ["turnSeconds", "world", Number, 0, { range: { min: 0, max: 6, step: 1 }, onChange: () => Hooks.callAll(`${MODULE_ID}.timeConfig`) }],
  ["combatSummary", "world", Boolean, true, {}],
  ["npcHealth", "world", String, "wound", { choices: { hidden: K("NpcHealth.hidden"), wound: K("NpcHealth.wound"), bar: K("NpcHealth.bar") }, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["enhanceTracker", "world", Boolean, true, { onChange: () => ui.combat?.render() }],
  ["deathSaves", "world", Boolean, true, {}],
  ["hazardDamage", "world", String, "card", { choices: { card: K("HazardDamage.card"), auto: K("HazardDamage.auto"), off: K("HazardDamage.off") } }],
  ["trackMovement", "world", Boolean, true, {}],

  // Conditions
  ["replaceStatuses", "world", Boolean, true, { requiresReload: true }],
  ["conditionChat", "world", String, "gm", { choices: { off: K("ConditionChat.off"), gm: K("ConditionChat.gm"), all: K("ConditionChat.all") } }],
  ["mirrorWounds", "world", Boolean, true, {}],
  ["mirrorCriticals", "world", Boolean, true, {}],
  ["critItems", "world", Boolean, true, {}],
  ["cltShim", "world", Boolean, true, { requiresReload: true }],
  ["conditionOverrides", "world", Object, {}, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.conditionsChanged`) }],
  ["customConditions", "world", Array, [], { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.conditionsChanged`) }],
  ["triggers", "world", Array, [], { config: false }],

  // Weather & visibility
  ["weatherSource", "world", String, "neonhub", { choices: { neonhub: K("WeatherSource.neonhub"), manual: K("WeatherSource.manual"), off: K("WeatherSource.off") }, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["weatherCalendar", "world", String, "", { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["manualWeather", "world", Object, { cond: "clear", band: "warm", strange: "" }, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["sceneWeatherDefault", "world", String, "outdoor", { choices: { outdoor: K("SceneWeather.outdoor"), indoor: K("SceneWeather.indoor") }, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["shelterKeywords", "world", String, "indoor, inside, interior, shelter, roof", { onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["weatherOnByDefault", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["weatherHazardCards", "world", Boolean, true, {}],
  ["visibilityEnabled", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["lowLightAt", "world", Number, 0.3, { range: { min: 0, max: 1, step: 0.05 }, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["darkAt", "world", Number, 0.7, { range: { min: 0, max: 1, step: 0.05 }, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["sightKeys", "world", String, "perceptionSight, ranged, melee", { onChange: () => Hooks.callAll(`${MODULE_ID}.conditionsChanged`) }],
  ["visibilityCap", "world", Number, 4, { range: { min: 0, max: 8, step: 1 }, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["visibilityFrom", "world", String, "target", { choices: { target: K("VisibilityFrom.target"), self: K("VisibilityFrom.self") }, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["envOutsideCombat", "world", Boolean, false, { onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["gearBreathing", "world", String, "Nasal Filters, Anti-Smog Breathing Mask, Anti-Smog Mask", {}],
  ["gearRadiation", "world", String, "Radiation Suit", {}],
  ["gearRain", "world", String, "Umbrella, Tactical Umbrella, Waterproof Jacket Lining", {}],
  ["gearCold", "world", String, "Cold-Weather Jacket Lining", {}],
  ["gearHeat", "world", String, "Hot-Weather Jacket Lining", {}],
  ["gearVision", "world", String, "Low Light / Infrared / UV, Low Light/Infrared/UV", { onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],

  // Bookkeeping
  ["migratedClt", "world", Boolean, false, { config: false }]
];

const IN_MENU = new Set(Object.values(MENUS).flat());

export const Settings = {
  register(menuClass = null) {
    for (const [key, scope, type, def, extra] of DEFS) {
      const config = extra.config ?? !IN_MENU.has(key);
      const data = { name: K(`${key}.name`), hint: K(`${key}.hint`), scope, config, type, default: def, ...extra, config };
      if (extra.choices) data.choices = extra.choices;
      game.settings.register(MODULE_ID, key, data);
    }
    if (menuClass) {
      for (const [id, keys] of Object.entries(MENUS)) {
        game.settings.registerMenu(MODULE_ID, `menu-${id}`, {
          name: K(`Menu.${id}.name`),
          label: K(`Menu.${id}.label`),
          hint: K(`Menu.${id}.hint`),
          icon: { combat: "fa-solid fa-hourglass-half", conditions: "fa-solid fa-heart-pulse", environment: "fa-solid fa-cloud-moon-rain" }[id],
          type: menuClass.for(id, keys),
          restricted: true
        });
      }
    }
  },

  get(key) {
    try {
      return game.settings.get(MODULE_ID, key);
    } catch {
      return DEFS.find((d) => d[0] === key)?.[3];
    }
  },

  set(key, value) {
    return game.settings.set(MODULE_ID, key, value);
  },

  /** A comma-separated setting as a trimmed list. */
  list(key) {
    return String(this.get(key) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  },

  /** The definition of a setting (for the submenu form). */
  def(key) {
    return game.settings.settings.get(`${MODULE_ID}.${key}`);
  }
};
