export const MODULE_ID = "cpr-neon-combat-manager";
export const SYSTEM_ID = "cyberpunk-red-core";
export const TEMPLATE_PATH = `modules/${MODULE_ID}/templates`;
export const ASSET_PATH = `modules/${MODULE_ID}/assets`;
/** Prefix of this module's localization keys. */
export const LANG = "NEONCOMBAT";

/** Sibling and integrated modules. */
export const NEON_HUB_ID = "cpr-neon-hub";
export const NEON_HOME_ID = "cpr-neon-at-home";
export const SMALLTIME_ID = "smalltime";
export const CLT_ID = "condition-lab-triggler";
export const DF_LIGHTS_ID = "df-active-lights";

/** A Cyberpunk RED Round (and Turn) is about 3 seconds (core rulebook p.126 and p.168). */
export const ROUND_SECONDS = 3;

/** Flag keys on ActiveEffects, Combats and Scenes. */
export const FLAGS = {
  /** ActiveEffect: the condition id it carries. */
  condition: "condition",
  /** ActiveEffect: set by an automatic system ("env", "wound", "critical"); the GM's own effects never are. */
  managed: "managed",
  /** ActiveEffect: the criticalInjury item it mirrors. */
  item: "item",
  /** Combat: world time when it started. */
  started: "started",
  /** Combatant: metres moved on foot this Turn. */
  moved: "moved",
  /** Scene: "outdoor" | "indoor" | "off" | "default" for weather. */
  weather: "weather"
};

/** Hook names other modules can listen to. */
export const HOOKS = {
  ready: `${MODULE_ID}.ready`,
  registerConditions: `${MODULE_ID}.registerConditions`,
  conditionAdded: `${MODULE_ID}.conditionAdded`,
  conditionRemoved: `${MODULE_ID}.conditionRemoved`,
  turnStart: `${MODULE_ID}.turnStart`,
  turnEnd: `${MODULE_ID}.turnEnd`,
  roundTime: `${MODULE_ID}.roundTime`,
  environmentChanged: `${MODULE_ID}.environmentChanged`
};
