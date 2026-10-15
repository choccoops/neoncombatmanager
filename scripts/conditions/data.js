/**
 * Neon Conditions: the built-in Cyberpunk RED condition set.
 *
 * Mechanics follow the Cyberpunk RED core rulebook (page numbers are the printed pages) and,
 * for weather, R. Talsorian's free Night City Weather DLC (NCW). Every name and hint shown in
 * Foundry is this module's own wording (lang/en.json, NEONCOMBAT.Condition.<id>); nothing here
 * reproduces the book's text.
 *
 * A condition:
 *   id          status id (Foundry's own id where the meaning matches: dead, unconscious, prone, blind, deaf, sleep)
 *   category    wound | critical | combat | hazard | situation | drug | weather | visibility
 *   img         icon (Cyberpunk RED's own status icons where it has one)
 *   page        rulebook reference shown in the Condition Lab
 *   changes     [{ key, value, situational?, onByDefault? }] in CPR roll keys (see cpr-flags.js)
 *   sight       a penalty to "tasks that need sight", expanded at runtime into the keys set in
 *               the module settings (default Perception (sight), ranged and melee attacks)
 *   duration    seconds of world time (a Round is 3 s, so 60 s is 20 Rounds)
 *   overlay     shown large over the token
 *   defeated    marks the combatant defeated
 *   group       only one condition of a group at a time (adding one removes the others)
 *   also        other conditions added with this one
 *   critical    { location, name }: the Critical Injury item in CPR's compendium it stands for
 *   turnStart / turnEnd  { damage, armor?, note? } automation when the bearer's Turn starts or ends
 *   moveDamage  bonus damage when the bearer moves more than 4 m/yds on foot in a Turn
 *   moveLock    no Move Action next Turn after moving more than 4 m/yds
 *   remindOnce  a reminder on the bearer's next Turn start, once
 *   suppressedBy  conditions whose presence switches this one's changes off (addictions)
 *   purges      categories removed when this is added (Rapidetox)
 *   immune      { items: [names] } gear or cyberware that makes the bearer immune
 *   heal        HP healed when added (Speedheal), unless Mortally Wounded
 *   stabilize   a Mortally Wounded bearer goes to 1 HP, Unconscious for a minute, Death Save penalty reset
 *   addiction   an addiction (Rapidetox doesn't purge it)
 *   secondary   { dv, adds }: when the drug wears off, a Resist Torture/Drugs Check against dv or gain `adds`
 *   hud         false to keep it out of the token HUD (added automatically instead)
 *   mirror      "wound": follows CPR's Wound State, which already applies its own penalties
 */

const S = "systems/cyberpunk-red-core/icons/compendium/status";
const A = "modules/cpr-neon-combat-manager/assets/icons";
const DAY = 86400;
const HOUR = 3600;

const ds = (n = 1) => ({ key: "bonuses.deathSavePenalty", value: n });

export const CATEGORIES = ["wound", "critical", "combat", "hazard", "situation", "drug", "weather", "visibility"];

export const CONDITIONS = [
  /* ------------------------------------------------------------------ */
  /*  Wound States (p.186): CPR applies these penalties itself          */
  /* ------------------------------------------------------------------ */
  { id: "lightlyWounded", category: "wound", img: `${S}/wounded_lightly.svg`, page: 186, mirror: "wound", group: "wound", hud: false },
  { id: "seriouslyWounded", category: "wound", img: `${S}/wounded_seriously.svg`, page: 186, mirror: "wound", group: "wound", hud: false },
  { id: "mortallyWounded", category: "wound", img: `${S}/wounded_mortally.svg`, page: 186, mirror: "wound", group: "wound", hud: false },
  { id: "dead", category: "wound", img: "icons/svg/skull.svg", page: 188, overlay: true, defeated: true },
  { id: "unconscious", category: "wound", img: `${S}/unconcious.svg`, page: 177, overlay: true },
  { id: "stabilized", category: "wound", img: "icons/svg/regen.svg", page: 186, stabilize: true },

  /* ------------------------------------------------------------------ */
  /*  Critical Injuries (p.187-188): CPR's own items carry the effects  */
  /* ------------------------------------------------------------------ */
  { id: "dismemberedArm", category: "critical", img: `${S}/dismembered_arm.svg`, page: 187, critical: { location: "body", name: "Dismembered Arm" }, changes: [ds()] },
  { id: "dismemberedHand", category: "critical", img: `${S}/dismembered_hand.svg`, page: 187, critical: { location: "body", name: "Dismembered Hand" }, changes: [ds()] },
  { id: "collapsedLung", category: "critical", img: `${S}/collapsed_lung.svg`, page: 187, critical: { location: "body", name: "Collapsed Lung" }, changes: [{ key: "system.stats.move.value", value: -2 }, ds()] },
  { id: "brokenRibs", category: "critical", img: `${S}/broken_ribs.svg`, page: 187, critical: { location: "body", name: "Broken Ribs" }, moveDamage: 5 },
  { id: "brokenArm", category: "critical", img: `${S}/broken_arm.svg`, page: 187, critical: { location: "body", name: "Broken Arm" } },
  { id: "foreignObject", category: "critical", img: `${S}/foreign_object_body.svg`, page: 187, critical: { location: "body", name: "Foreign Object" }, moveDamage: 5 },
  { id: "brokenLeg", category: "critical", img: `${S}/broken_leg.svg`, page: 187, critical: { location: "body", name: "Broken Leg" }, changes: [{ key: "system.stats.move.value", value: -4 }] },
  { id: "tornMuscle", category: "critical", img: `${S}/torn_muscle.svg`, page: 187, critical: { location: "body", name: "Torn Muscle" }, changes: [{ key: "bonuses.melee", value: -2 }] },
  { id: "spinalInjury", category: "critical", img: `${S}/spinal_injury.svg`, page: 187, critical: { location: "body", name: "Spinal Injury" }, changes: [ds()], remindOnce: true },
  { id: "crushedFingers", category: "critical", img: `${S}/crushed_fingers.svg`, page: 187, critical: { location: "body", name: "Crushed Fingers" }, changes: [{ key: "bonuses.allActionsHands", value: -4 }] },
  { id: "dismemberedLeg", category: "critical", img: `${S}/dismembered_leg.svg`, page: 187, critical: { location: "body", name: "Dismembered Leg" }, changes: [{ key: "system.stats.move.value", value: -6 }, ds()] },
  { id: "lostEye", category: "critical", img: `${S}/lost_eye.svg`, page: 188, critical: { location: "head", name: "Lost Eye" }, changes: [{ key: "bonuses.ranged", value: -4 }, { key: "bonuses.perceptionSight", value: -4 }, ds()] },
  { id: "brainInjury", category: "critical", img: `${S}/brain_injury.svg`, page: 188, critical: { location: "head", name: "Brain Injury" }, changes: [{ key: "bonuses.allActions", value: -2 }, ds()] },
  { id: "damagedEye", category: "critical", img: `${S}/damaged_eye.svg`, page: 188, critical: { location: "head", name: "Damaged Eye" }, changes: [{ key: "bonuses.ranged", value: -2 }, { key: "bonuses.perceptionSight", value: -2 }] },
  { id: "concussion", category: "critical", img: `${S}/concussion.svg`, page: 188, critical: { location: "head", name: "Concussion" }, changes: [{ key: "bonuses.allActions", value: -2 }] },
  { id: "brokenJaw", category: "critical", img: `${S}/broken_jaw.svg`, page: 188, critical: { location: "head", name: "Broken Jaw" }, changes: [{ key: "bonuses.allActionsSpeech", value: -4 }] },
  { id: "foreignObjectHead", category: "critical", img: `${S}/foreign_object_head.svg`, page: 188, critical: { location: "head", name: "Foreign Object (H)" }, moveDamage: 5 },
  { id: "whiplash", category: "critical", img: `${S}/whiplash.svg`, page: 188, critical: { location: "head", name: "Whiplash" }, changes: [ds()] },
  { id: "crackedSkull", category: "critical", img: `${S}/cracked_skull.svg`, page: 188, critical: { location: "head", name: "Cracked Skull" }, changes: [ds()] },
  { id: "damagedEar", category: "critical", img: `${S}/damaged_ear.svg`, page: 188, critical: { location: "head", name: "Damaged Ear" }, changes: [{ key: "bonuses.perceptionHearing", value: -2 }], moveLock: true },
  { id: "crushedWindpipe", category: "critical", img: `${S}/crushed_windpipe.svg`, page: 188, critical: { location: "head", name: "Crushed Windpipe" }, changes: [ds()] },
  { id: "lostEar", category: "critical", img: `${S}/lost_ear.svg`, page: 188, critical: { location: "head", name: "Lost Ear" }, changes: [{ key: "bonuses.perceptionHearing", value: -4 }, ds()], moveLock: true },

  /* ------------------------------------------------------------------ */
  /*  Combat (p.168-185)                                                */
  /* ------------------------------------------------------------------ */
  { id: "prone", category: "combat", img: `${S}/prone.svg`, page: 169 },
  { id: "grappled", category: "combat", img: `${S}/grappled.svg`, page: 177, changes: [{ key: "bonuses.allActions", value: -2 }] },
  { id: "grappling", category: "combat", img: `${A}/grappling.svg`, page: 177, changes: [{ key: "bonuses.allActions", value: -2 }] },
  { id: "ironGrip", category: "combat", img: `${S}/iron_grip.svg`, page: 179, changes: [{ key: "bonuses.brawling", value: -2, situational: true }] },
  { id: "choking1", category: "combat", img: `${S}/choking1.svg`, page: 177, group: "choke" },
  { id: "choking2", category: "combat", img: `${S}/choking2.svg`, page: 177, group: "choke" },
  { id: "humanShield", category: "combat", img: `${S}/human_shield.svg`, page: 184 },
  { id: "cover", category: "combat", img: `${S}/cover.svg`, page: 182 },
  { id: "hidden", category: "combat", img: `${S}/hidden.svg`, page: 130 },
  { id: "readiedAction", category: "combat", img: `${S}/readied_action.svg`, page: 169 },
  { id: "suppressed", category: "combat", img: `${S}/suppressed.svg`, page: 174 },
  { id: "netrunning", category: "combat", img: `${S}/netrunning.svg`, page: 197 },
  { id: "blind", category: "combat", img: `${S}/blinded.svg`, page: 130, sight: -4 },
  { id: "deaf", category: "combat", img: `${S}/deafened.svg`, page: 130, changes: [{ key: "bonuses.perceptionHearing", value: -4 }] },
  { id: "flashbanged", category: "combat", img: `${A}/flashbang.svg`, page: 346, duration: 60, immune: { items: ["Anti-Dazzle"] },
    changes: [{ key: "bonuses.ranged", value: -2 }, { key: "bonuses.perceptionSight", value: -2 }, { key: "bonuses.perceptionHearing", value: -2 }], moveLock: true },
  { id: "teargassed", category: "combat", img: `${A}/teargas.svg`, page: 347, duration: 60, changes: [{ key: "bonuses.ranged", value: -2 }, { key: "bonuses.perceptionSight", value: -2 }] },
  { id: "sleep", category: "combat", img: `${S}/sedative.svg`, page: 346, duration: 60, overlay: true, also: ["prone"] },
  { id: "emp", category: "combat", img: `${S}/emp.svg`, page: 345, duration: 60 },

  /* ------------------------------------------------------------------ */
  /*  Other ways to get hurt (p.180-181)                                */
  /* ------------------------------------------------------------------ */
  { id: "onFireMild", category: "hazard", img: `${S}/on_fire_mild.svg`, page: 180, group: "fire", turnEnd: { damage: 2 } },
  { id: "onFireStrong", category: "hazard", img: `${S}/on_fire_strong.svg`, page: 180, group: "fire", turnEnd: { damage: 4 } },
  { id: "onFireDeadly", category: "hazard", img: `${S}/on_fire_deadly.svg`, page: 180, group: "fire", turnEnd: { damage: 6 } },
  { id: "drowning", category: "hazard", img: `${S}/drowning.svg`, page: 180, turnStart: { damage: "@body" } },
  { id: "asphyxiating", category: "hazard", img: `${S}/asphyxiating.svg`, page: 180, turnStart: { damage: "@body" } },
  { id: "electrocuted", category: "hazard", img: `${A}/electrocuted.svg`, page: 180, turnEnd: { damage: "6d6", armor: true } },
  { id: "radiationLow", category: "hazard", img: `${S}/radiation_low.svg`, page: 181, group: "radiation" },
  { id: "radiationHigh", category: "hazard", img: `${S}/radiation_high.svg`, page: 181, group: "radiation", turnEnd: { damage: 2 } },
  { id: "falling", category: "hazard", img: `${S}/falling.svg`, page: 181 },
  { id: "exposure", category: "hazard", img: `${A}/exposure.svg`, page: 181 },
  { id: "acid", category: "hazard", img: `${S}/acid.svg`, page: 347 },

  /* ------------------------------------------------------------------ */
  /*  Situational Modifiers (p.129)                                     */
  /* ------------------------------------------------------------------ */
  { id: "exhausted", category: "situation", img: `${A}/exhausted.svg`, page: 129, group: "rest", changes: [{ key: "bonuses.allActions", value: -4 }] },
  { id: "badSleep", category: "situation", img: `${A}/bad-sleep.svg`, page: 129, group: "rest", changes: [{ key: "bonuses.allActions", value: -2 }] },
  { id: "extremeStress", category: "situation", img: `${A}/stress.svg`, page: 129, changes: [{ key: "bonuses.allActions", value: -2 }] },
  { id: "drunk", category: "situation", img: `${S}/drugged.svg`, page: 129, changes: [{ key: "bonuses.allActions", value: -4 }] },
  { id: "smoke", category: "situation", img: `${A}/smoke.svg`, page: 347, duration: 60, sight: -4 },

  /* ------------------------------------------------------------------ */
  /*  Pharmaceuticals (p.150) and Street Drugs (p.227-228)              */
  /* ------------------------------------------------------------------ */
  { id: "antibiotics", category: "drug", img: `${S}/antibiotics.svg`, page: 150, duration: 7 * DAY },
  { id: "rapidetox", category: "drug", img: `${S}/rapiddetox.svg`, page: 150, purges: ["drug"] },
  { id: "speedheal", category: "drug", img: `${S}/speedheal.svg`, page: 150, duration: DAY, heal: "@body+@will" },
  { id: "stim", category: "drug", img: `${S}/stim.svg`, page: 150, duration: HOUR, changes: [{ key: "bonuses.hasPainSuppression", value: 1 }] },
  { id: "surge", category: "drug", img: `${S}/surge.svg`, page: 150, duration: DAY },
  { id: "blackLace", category: "drug", secondary: { dv: 17, adds: "blackLaceAddiction" }, img: `${S}/black_lace.svg`, page: 227, duration: DAY, changes: [{ key: "bonuses.hasPainSuppression", value: 1 }] },
  { id: "blackLaceAddiction", category: "drug", img: `${S}/black_lace_addiction.svg`, page: 227, addiction: true, suppressedBy: ["blackLace"], changes: [{ key: "system.stats.ref.value", value: -2 }] },
  { id: "blueGlass", category: "drug", secondary: { dv: 15, adds: "blueGlassAddiction" }, img: `${S}/blue_glass.svg`, page: 228, duration: 4 * HOUR },
  { id: "blueGlassAddiction", category: "drug", img: `${S}/blue_glass_addiction.svg`, page: 228, addiction: true },
  { id: "boost", category: "drug", secondary: { dv: 17, adds: "boostAddiction" }, img: `${S}/boost.svg`, page: 228, duration: DAY, changes: [{ key: "system.stats.int.value", value: 2 }] },
  { id: "boostAddiction", category: "drug", img: `${S}/boost_addiction.svg`, page: 228, addiction: true, changes: [{ key: "system.stats.int.value", value: -2 }] },
  { id: "smash", category: "drug", secondary: { dv: 15, adds: "smashAddiction" }, img: `${S}/smash.svg`, page: 229, duration: 4 * HOUR,
    changes: ["dance", "contortionist", "conversation", "humanPerception", "persuasion", "acting"].map((s) => ({ key: `bonuses.${s}`, value: 2 })) },
  { id: "smashAddiction", category: "drug", img: `${S}/smash_addiciton.svg`, page: 229, addiction: true,
    changes: ["dance", "contortionist", "conversation", "humanPerception", "persuasion", "acting"].map((s) => ({ key: `bonuses.${s}`, value: -2 })) },
  { id: "synthcoke", category: "drug", secondary: { dv: 15, adds: "synthcokeAddiction" }, img: `${S}/synthcoke.svg`, page: 229, duration: 4 * HOUR, changes: [{ key: "system.stats.ref.value", value: 1 }] },
  { id: "synthcokeAddiction", category: "drug", img: `${S}/synthcoke_addiciton.svg`, page: 229, addiction: true, suppressedBy: ["synthcoke"], changes: [{ key: "system.stats.ref.value", value: -2 }] },

  /* ------------------------------------------------------------------ */
  /*  Night City Weather (NCW p.4-5): added by the weather system       */
  /*  Their changes are worked out per character (gear, armor, eyes).   */
  /* ------------------------------------------------------------------ */
  { id: "wxLightRain", category: "weather", img: `${A}/light-rain.svg`, page: "NCW 5", hud: false },
  { id: "wxHeavyRain", category: "weather", img: `${A}/heavy-rain.svg`, page: "NCW 5", hud: false },
  { id: "wxAcidRain", category: "weather", img: `${A}/acid-rain.svg`, page: "NCW 4", hud: false },
  { id: "wxBloodRain", category: "weather", img: `${A}/blood-rain.svg`, page: "NCW 4", hud: false },
  { id: "wxAshStorm", category: "weather", img: `${A}/ash-storm.svg`, page: "NCW 4", hud: false },
  { id: "wxDustStorm", category: "weather", img: `${A}/dust-storm.svg`, page: "NCW 5", hud: false },
  { id: "wxInversionSmog", category: "weather", img: `${A}/smog.svg`, page: "NCW 5", hud: false },
  { id: "wxThunderstorm", category: "weather", img: `${A}/thunderstorm.svg`, page: "NCW 5", hud: false },
  { id: "wxRadioactiveWind", category: "weather", img: `${A}/radioactive-wind.svg`, page: "NCW 5", hud: false },
  { id: "wxColdSnap", category: "weather", img: `${A}/cold-snap.svg`, page: "NCW 4", hud: false },
  { id: "wxHeatWave", category: "weather", img: `${A}/heat-wave.svg`, page: "NCW 5", hud: false },
  { id: "wxHot", category: "weather", img: `${A}/hot.svg`, page: "NCW 4", hud: false },
  { id: "wxCold", category: "weather", img: `${A}/cold.svg`, page: "NCW 4", hud: false },
  { id: "wxFlooding", category: "weather", img: `${A}/flooding.svg`, page: "NCW 5", hud: false },
  { id: "wxBlackout", category: "weather", img: `${A}/blackout.svg`, page: "NCW 4", hud: false },

  /* ------------------------------------------------------------------ */
  /*  Visibility (p.129): added by the visibility system                */
  /* ------------------------------------------------------------------ */
  { id: "lowLight", category: "visibility", img: `${A}/low-light.svg`, page: 129, sight: -1, group: "visibility" },
  { id: "darkness", category: "visibility", img: `${A}/darkness.svg`, page: 129, sight: -4, group: "visibility" },
  { id: "obscured", category: "visibility", img: `${A}/obscured.svg`, page: 129, sight: -4, group: "visibility" }
];

/** Built-in conditions by id. */
export const BY_ID = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));

/** The Foundry core status ids this set replaces (Foundry's fantasy list has no place in Night City). */
export const CORE_STATUS_IDS = [
  "dead", "unconscious", "sleep", "stun", "prone", "restrain", "paralysis", "fly", "blind", "deaf", "silence", "fear",
  "burning", "frozen", "shock", "corrode", "bleeding", "disease", "poison", "curse", "regen", "degen", "hover", "burrow",
  "upgrade", "downgrade", "invisible", "target", "eye", "bless", "fireShield", "coldShield", "magicShield", "holyShield"
];

/** Wound State (CPR's derivedStats.currentWoundState) to condition id. */
export const WOUND_CONDITION = {
  lightlyWounded: "lightlyWounded",
  seriouslyWounded: "seriouslyWounded",
  mortallyWounded: "mortallyWounded"
};
