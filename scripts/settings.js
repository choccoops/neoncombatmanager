import { MODULE_ID, LANG, ROUND_SECONDS } from "./constants.js";

const K = (key) => `${LANG}.Settings.${key}`;

/** World settings grouped into submenus; everything else shows in Foundry's own list. */
export const MENUS = {
  combat: ["encounterMode", "roundSeconds", "turnSeconds", "combatSummary", "npcHealth", "enhanceTracker", "deathSaves", "hazardDamage", "trackMovement", "pickupCarried", "movementRuler", "movementRulerWaypoints"],
  conditions: ["replaceStatuses", "conditionChat", "mirrorWounds", "mirrorCyberpsychosis", "mirrorCriticals", "critItems", "fireEscalates", "wakeOnDamage", "cltShim", "conditionSheetNotes"],
  comms: ["holocallSheetButton", "linkNeedsImplant", "linkImplants", "ncmSpam"],
  chat: ["chatFormatting", "chatMerge", "chatEditing", "adventureLog", "adventureLogName", "stageEnabled"],
  fx: ["fxEnabled", "fxConditions", "fxChrome", "fxTactile", "hackFx", "hackGhostFx", "fxMacros"],
  arsenal: ["arsenalAnimations", "arsenalAutoInstall", "arsenalSounds", "arsenalAreas", "arsenalBlowBack", "arsenalRebuilds", "arsenalRebuildConditions", "arsenalShotFx", "arsenalXray", "arsenalThinDoors", "arsenalSmartPrompt", "arsenalRicochetDodge", "arsenalHitCheck", "arsenalHideDiwakoHit", "arsenalDefense", "arsenalDefenseMelee", "arsenalDefenseTies", "arsenalDefenseVisibility", "arsenalDvDisplay", "arsenalPlayerFlashes", "coverOn", "coverDoors", "coverLabels", "coverPieceWalls"],
  rules: ["rollerHooks", "rideEdge", "chainReactions", "tarotCriticals", "flashOfLuck", "awarenessLadder", "combatRaisesAlert", "awarenessTokens", "alertTimer", "alertClears", "hackFlow"],
  hub: ["hubPlayers", "hubDiscovery", "hubRevealDossier", "hubTravel", "hubSignal", "hubDeadZones", "hubSignalScenes"],
  environment: [
    "weatherSource", "weatherFx", "weatherEveryone", "sceneWeatherDefault", "shelterKeywords", "weatherOnByDefault", "weatherHazardCards", "visibilityEnabled",
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
  ["actionHud", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["actionHudState", "client", Object, {}, { config: false }],
  ["chatPortraits", "client", String, "token", { config: true, choices: { token: K("ChatPortraits.token"), actor: K("ChatPortraits.actor"), off: K("ChatPortraits.off") } }],
  ["chatPortraitSize", "client", Number, 36, { config: true, range: { min: 20, max: 64, step: 2 } }],
  ["chatPortraitShape", "client", String, "notch", { config: true, choices: { notch: K("PortraitShape.notch"), circle: K("PortraitShape.circle"), square: K("PortraitShape.square") } }],
  ["rollPrivacyButtons", "client", Boolean, true, { config: true }],
  ["chatCommandMenu", "client", Boolean, true, { config: true }],
  ["chatSpeakAs", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.stageChanged`) }],
  ["stageShow", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.stageChanged`) }],

  // Chat
  ["chatFormatting", "world", Boolean, true, {}],
  ["chatMerge", "world", Boolean, true, {}],
  ["chatEditing", "world", Boolean, true, {}],
  ["adventureLog", "world", Boolean, true, {}],
  ["adventureLogName", "world", String, "", {}],
  ["stageEnabled", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.stageChanged`) }],
  ["stageCast", "world", Object, { cast: [], focus: true }, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.stageChanged`) }],

  ["noSignalFx", "client", Boolean, true, { config: true }],
  ["biomonAlerts", "client", String, "toast", { config: true, choices: { toast: K("BiomonAlerts.toast"), open: K("BiomonAlerts.open"), off: K("BiomonAlerts.off") } }],

  // Holocall: the sheet-header button (off: headers stay clear; the macro and the Actors menu remain)
  ["holocallSheetButton", "world", Boolean, false, {}],

  // Biomon Link
  ["linkNeedsImplant", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.linksChanged`) }],
  ["linkImplants", "world", String, "Neuroport, Biomonitor", { onChange: () => Hooks.callAll(`${MODULE_ID}.linksChanged`) }],
  ["ncmSpam", "world", String, "2070", { choices: { 2070: K("NcmSpam.2070"), mix: K("NcmSpam.mix"), off: K("NcmSpam.off") }, onChange: () => Hooks.callAll(`${MODULE_ID}.spamChanged`) }],
  ["vitalLinks", "world", Object, {}, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.linksChanged`) }],

  // City & NCART hub
  ["hubPlayers", "world", Boolean, true, {}],
  ["hubDiscovery", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.hubChanged`, null) }],
  ["hubRevealDossier", "world", Boolean, true, {}],
  ["hubTravel", "world", String, "always", { choices: { off: K("HubTravel.off"), session: K("HubTravel.session"), always: K("HubTravel.always") } }],
  ["hubSignal", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.signalChanged`) }],
  ["hubDeadZones", "world", String, "", { onChange: () => Hooks.callAll(`${MODULE_ID}.signalChanged`) }],
  ["hubSignalScenes", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.signalChanged`) }],
  ["cityHub", "world", Object, {}, { config: false, onChange: (v) => Hooks.callAll(`${MODULE_ID}.hubChanged`, v) }],

  // Combat & time
  ["encounterMode", "world", String, "combat", { choices: { combat: K("EncounterMode.combat"), stealth: K("EncounterMode.stealth") }, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["roundSeconds", "world", Number, ROUND_SECONDS, { range: { min: 0, max: 12, step: 1 }, onChange: () => Hooks.callAll(`${MODULE_ID}.timeConfig`) }],
  ["turnSeconds", "world", Number, 0, { range: { min: 0, max: 6, step: 1 }, onChange: () => Hooks.callAll(`${MODULE_ID}.timeConfig`) }],
  ["combatSummary", "world", Boolean, true, {}],
  ["npcHealth", "world", String, "wound", { choices: { hidden: K("NpcHealth.hidden"), wound: K("NpcHealth.wound"), bar: K("NpcHealth.bar") }, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["enhanceTracker", "world", Boolean, true, { onChange: () => ui.combat?.render() }],
  ["deathSaves", "world", Boolean, true, {}],
  ["hazardDamage", "world", String, "card", { choices: { card: K("HazardDamage.card"), auto: K("HazardDamage.auto"), off: K("HazardDamage.off") } }],
  ["trackMovement", "world", Boolean, true, {}],
  ["pickupCarried", "world", Boolean, true, {}],
  ["movementRuler", "world", String, "auto", { choices: { auto: K("MovementRuler.auto"), off: K("MovementRuler.off") }, requiresReload: true }],
  ["movementRulerWaypoints", "world", Boolean, true, {}],
  ["movementRulerNoticed", "world", Boolean, false, { config: false }],

  // Conditions
  ["replaceStatuses", "world", Boolean, true, { requiresReload: true }],
  ["conditionChat", "world", String, "gm", { choices: { off: K("ConditionChat.off"), gm: K("ConditionChat.gm"), all: K("ConditionChat.all") } }],
  ["mirrorWounds", "world", Boolean, true, {}],
  ["mirrorCyberpsychosis", "world", Boolean, true, {}],
  ["mirrorCriticals", "world", Boolean, true, {}],
  ["critItems", "world", Boolean, true, {}],
  ["conditionSheetNotes", "world", Boolean, true, {}],
  ["fireEscalates", "world", Boolean, true, {}],
  // Neon FX (Sequencer): condition visuals, Cyberpsychosis glitch, Sandevistan
  ["fxEnabled", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
  ["fxConditions", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
  ["fxMacros", "world", Boolean, true, {}],
  // The Awareness Ladder on the tokens, and the Alert: its countdown to the response, and whether it clears
  ["awarenessTokens", "world", String, "alert", { choices: { alert: K("AwarenessTokens.alert"), all: K("AwarenessTokens.all"), off: K("AwarenessTokens.off") }, onChange: () => Hooks.callAll(`${MODULE_ID}.awarenessChanged`) }],
  ["alertTimer", "world", Number, 20, { range: { min: 0, max: 60, step: 1 } }],
  ["alertClears", "world", Boolean, true, {}],
  ["alertBanner", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  // Speedware, Berserk and their Operating Systems light up while their "(active)" effect is on
  ["fxChrome", "world", Boolean, true, {}],
  ["fxTactile", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
  // Quickhacking (2070 ch.10): the flow on the Action HUD, its animations, and who sees a Ghost's
  ["hackFlow", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["hackFx", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
  ["hackGhostFx", "world", String, "owners", { choices: { owners: K("HackGhostFx.owners"), all: K("HackGhostFx.all"), off: K("HackGhostFx.off") }, onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
  ["fxMacrosInstalled", "world", Boolean, false, { config: false }],
  ["fxMacrosKnown", "world", Array, [], { config: false }],
  ["fxVolume", "client", Number, 0.4, { config: true, range: { min: 0, max: 1, step: 0.05 }, onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
  ["fxChannel", "client", String, "interface", { config: true, choices: { interface: K("FxChannel.interface"), environment: K("FxChannel.environment"), music: K("FxChannel.music") } }],
  ["fxMotion", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
  // Neon Arsenal: Automated Animations profile, weapon sounds, area attacks, weapon traits
  ["arsenalAnimations", "world", Boolean, true, {}],
  ["arsenalAutoInstall", "world", Boolean, true, {}],
  ["arsenalProfile", "world", String, "", { config: false }],
  ["arsenalSounds", "world", Boolean, true, {}],
  ["arsenalAreas", "world", Boolean, true, {}],
  ["arsenalBlowBack", "world", Boolean, true, {}],
  ["arsenalRebuilds", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["arsenalRebuildConditions", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.rebuildConditionsChanged`) }],
  ["arsenalShotFx", "world", Boolean, true, {}],
  ["arsenalXray", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.xrayChanged`) }],
  ["arsenalThinDoors", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.xrayChanged`) }],
  ["coverOn", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.coverChanged`) }],
  ["coverDoors", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.coverChanged`) }],
  ["coverLabels", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.coverChanged`) }],
  ["coverPieceWalls", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.coverChanged`) }],
  ["arsenalSmartPrompt", "world", Boolean, true, {}],
  ["arsenalRicochetDodge", "world", Boolean, true, {}],
  ["arsenalHitCheck", "world", Boolean, true, {}],
  ["arsenalHideDiwakoHit", "world", Boolean, true, {}],
  ["arsenalDefense", "world", Boolean, true, {}],
  ["arsenalDefenseMelee", "world", String, "auto", { choices: { auto: K("DefenseMelee.auto"), prompt: K("DefenseMelee.prompt") } }],
  ["arsenalDefenseTies", "world", Boolean, true, {}],
  ["arsenalDefenseVisibility", "world", String, "public", { choices: { public: K("DefenseVisibility.public"), gm: K("DefenseVisibility.gm") } }],
  ["arsenalDvDisplay", "world", Boolean, true, { requiresReload: true }],
  ["arsenalPlayerFlashes", "world", Boolean, true, {}],
  // The 2070 roller and table rules
  ["rollerHooks", "world", Boolean, true, { requiresReload: true }],
  ["rideEdge", "world", Boolean, true, {}],
  ["chainReactions", "world", Boolean, true, {}],
  ["tarotCriticals", "world", Boolean, true, {}],
  ["tarotDeck", "world", Object, {}, { config: false }],
  ["flashOfLuck", "world", Boolean, true, {}],
  ["flashBeat", "world", Number, 0, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.stakesChanged`) }],
  ["flashMission", "world", Number, 0, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.stakesChanged`) }],
  ["awarenessLadder", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.refreshUI`) }],
  ["combatRaisesAlert", "world", Boolean, true, {}],
  ["wakeOnDamage", "world", Boolean, true, {}],
  ["cltShim", "world", Boolean, true, { requiresReload: true }],
  ["conditionOverrides", "world", Object, {}, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.conditionsChanged`) }],
  ["customConditions", "world", Array, [], { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.conditionsChanged`) }],
  ["triggers", "world", Array, [], { config: false }],

  // Weather & visibility
  ["weatherSource", "world", String, "neonhub", { choices: { neonhub: K("WeatherSource.neonhub"), manual: K("WeatherSource.manual"), off: K("WeatherSource.off") }, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["weatherCalendar", "world", String, "", { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["manualWeather", "world", Object, { cond: "clear", band: "warm", strange: "" }, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["weatherFx", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["weatherEveryone", "world", Boolean, true, { onChange: () => Hooks.callAll(`${MODULE_ID}.environmentConfig`) }],
  ["weatherAmbience", "client", Boolean, true, { config: true, onChange: () => Hooks.callAll(`${MODULE_ID}.fxChanged`) }],
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
  ["migratedClt", "world", Boolean, false, { config: false }],
  // The Plot Die: bumped by "New session" so Double Down and Force Fate come back.
  ["stakesSession", "world", Number, 0, { config: false, onChange: () => Hooks.callAll(`${MODULE_ID}.stakesChanged`) }]
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
          icon: { fx: "fa-solid fa-bolt", arsenal: "fa-solid fa-gun", combat: "fa-solid fa-hourglass-half", conditions: "fa-solid fa-heart-pulse", rules: "fa-solid fa-dice-d10", comms: "fa-solid fa-heart-pulse", chat: "fa-solid fa-comments", hub: "fa-solid fa-map-location-dot", environment: "fa-solid fa-cloud-moon-rain" }[id],
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
