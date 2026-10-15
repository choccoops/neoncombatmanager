/**
 * Night City weather as conditions on the characters out in it, from R. Talsorian's free Night
 * City Weather DLC (NCW p.4-5) and the core rulebook's Exposure, radiation and poison rules
 * (p.181). Neon Hub plans the weather (same DLC tables); this turns the day's weather into what
 * each character suffers, given their gear. Pure functions, no Foundry.
 */

/** Neon Hub condition key (and temperature) to this module's condition id. */
export const WEATHER_CONDITION = {
  lightRain: "wxLightRain",
  heavyRain: "wxHeavyRain",
  acidRain: "wxAcidRain",
  bloodRain: "wxBloodRain",
  ashStorm: "wxAshStorm",
  dustStorm: "wxDustStorm",
  inversionSmog: "wxInversionSmog",
  deadlyThunderstorm: "wxThunderstorm",
  radioactiveWindstorm: "wxRadioactiveWind",
  coldSnap: "wxColdSnap",
  heatWave: "wxHeatWave",
  flooding: "wxFlooding",
  blackout: "wxBlackout",
  hot: "wxHot"
};

/** How much each weather obscures sight (Perception to see, ranged attacks at a distance). */
export const WEATHER_SIGHT = {
  heavyRain: -2,
  bloodRain: -1,
  ashStorm: -2,
  dustStorm: -2,
  inversionSmog: -4,
  deadlyThunderstorm: -2
};

/** Skills a slick or icy surface makes harder (situational, off until the GM calls for it). */
export const SLICK_SKILLS = ["athletics", "driveLandVehicle", "riding", "contortionist"];

/**
 * Hazards that need a roll or a choice on a timer while exposed (handled as GM cards):
 *  every: seconds between checks; after: seconds of exposure before the first one; needs: the
 *  protection that spares a character. (Radioactive wind is the High Radiation condition instead.)
 */
export const HAZARDS = {
  acidRain: { every: 60, needs: "rain" },
  bloodRain: { every: 60, needs: "rain" },
  ashStorm: { after: 60, needs: "breathing" },
  inversionSmog: { after: 60, needs: "breathing" },
  dustStorm: { after: 300, needs: "breathing" },
  deadlyThunderstorm: { every: 600 }
};

/**
 * The weather keys in effect at a moment.
 * @param {object} day - a Neon Hub weather day: { band, f, cond, strange: { key, start, minutes }|null, event: { key }|null }
 * @param {number} minutes - minute of the day (0-1439)
 * @returns {{ keys: string[], band: string|null, f: number|null }}
 */
export function activeWeather(day, minutes) {
  if (!day) return { keys: [], band: null, f: null };
  const keys = [];
  if (day.cond === "lightRain" || day.cond === "heavyRain") keys.push(day.cond);
  const s = day.strange;
  if (s?.key) {
    const start = Number(s.start) || 0;
    const end = start + (Number(s.minutes) || 0);
    const m = Number(minutes) || 0;
    // An event can run past midnight: count the wrapped part too.
    if ((m >= start && m < end) || (end > 1440 && m < end - 1440)) keys.push(s.key);
  }
  if (day.event?.key) keys.push(day.event.key);
  const band = day.band ?? null;
  if (band === "hot" && !keys.includes("heatWave")) keys.push("hot");
  return { keys: [...new Set(keys)], band, f: Number.isFinite(day.f) ? day.f : null };
}

/** The weather from the GM's manual choice: { cond, band, strange }. */
export function manualWeather({ cond = "clear", band = "warm", strange = "" } = {}) {
  const day = { cond, band, strange: null, event: strange ? { key: strange } : null };
  if (strange === "coldSnap") day.band = "freezing";
  if (strange === "heatWave") day.band = "scorching";
  return activeWeather(day, 0);
}

/**
 * What the weather does to one character.
 * @param {string[]} keys - activeWeather().keys
 * @param {object} gear - { breathing, radiation, rain, cold, heat, vision } booleans
 * @param {object} opts - armorPenalty: CPR's armor penalty to REF/DEX/MOVE (positive)
 * @returns {{ conditions: {id, changes}[], sight: number, extra: string[], hazards: string[] }}
 *   conditions: weather conditions with this character's changes; sight: the weather's sight
 *   penalty (joined with darkness by the visibility system); extra: other conditions the
 *   weather puts on them (radiation); hazards: timed hazards they're exposed to
 */
export function weatherFor(keys, gear = {}, { armorPenalty = 0 } = {}) {
  const conditions = [];
  const extra = [];
  const hazards = [];
  let sight = 0;
  const slick = (n) => SLICK_SKILLS.map((s) => ({ key: `bonuses.${s}`, value: n, situational: true, onByDefault: false }));
  const heat = (n) => {
    const extraPenalty = Math.max(0, n - (gear.heat ? 1 : 0));
    if (!armorPenalty || !extraPenalty) return [];
    return ["ref", "dex", "move"].map((s) => ({ key: `system.stats.${s}.value`, value: -extraPenalty }));
  };

  for (const key of keys) {
    const id = WEATHER_CONDITION[key];
    if (!id) continue;
    let changes = [];
    if (key === "lightRain") changes = slick(-1);
    if (key === "heavyRain") changes = slick(-1);
    if (key === "coldSnap") changes = slick(-2);
    if (key === "heatWave") changes = heat(2);
    if (key === "hot") changes = heat(1);
    if (WEATHER_SIGHT[key] && !gear.vision) sight = Math.min(sight, WEATHER_SIGHT[key]);
    const hz = HAZARDS[key];
    if (hz && !(hz.needs && gear[hz.needs])) hazards.push(key);
    if (key === "radioactiveWindstorm" && !gear.radiation) extra.push("radiationHigh");
    conditions.push({ id, changes });
  }
  return { conditions, sight, extra, hazards };
}

/** A short label for the weather now: "Heavy Rain · Hot" (keys localized by the caller). */
export function weatherSummary(keys, label = (k) => k) {
  return keys.map(label).join(" · ");
}
