/**
 * Cyberpunk RED - CORE's bookkeeping for Active Effect changes (verified against 0.92.4).
 *
 * CPR turns every change of every effect on an actor into a CPRMod, and reads two flags while
 * doing it: flags["cyberpunk-red-core"].changes.cats[i] (the change's category, shown on the
 * effect sheet) and .situational[i] = { isSituational, onByDefault }. A missing `changes` flag
 * throws and the character sheet stops opening; a `situational` object missing an index throws
 * too. So every change a condition carries gets both, for every index.
 *
 * Roll keys (what the CPR roll code looks up, all ADD mode):
 *   bonuses.allActions / allActionsHands / allActionsSpeech  - every Stat and Skill Check
 *   bonuses.<skillSlug>, bonuses.perceptionSight / perceptionHearing - one Skill
 *   bonuses.ranged / melee / universalAttack / aimedShot / autofire ... - attacks
 *   bonuses.initiative, bonuses.deathSavePenalty, bonuses.hasPainSuppression
 *   system.stats.<stat>.value - the STAT itself (never situational)
 * Situational changes appear as toggles in CPR's roll dialog; onByDefault ones start ticked
 * and also count on rolls made without the dialog.
 */
import { SYSTEM_ID } from "../constants.js";

const COMBAT = new Set([
  "hands", "initiative", "maxHumanity", "maxHp", "deathSavePenalty", "universalAttack", "universalDamage",
  "universalDamageReduction", "aimedShot", "singleShot", "melee", "ranged", "autofire", "suppressive", "run", "walk"
]);
const MISC = new Set(["allActions", "allActionsHands", "allActionsSpeech", "hasPainSuppression"]);
const NETRUN = new Set([
  "attack", "defense", "brainDamageReduction", "perception_net", "rez", "speed", "backdoor", "cloak",
  "control", "eyedee", "pathfinder", "scanner", "slide", "virus", "zap"
]);
const ROLE = new Set([
  "teamwork", "operator", "backup", "credibility", "medicalTechCryosystemOperation", "medicalTechPharmaceuticals",
  "medicalTechSkill", "medicine", "surgery", "surgerySkill", "interface", "moto", "charismaticImpact", "combatAwareness",
  "damageDeflection", "fumbleRecovery", "initiativeReaction", "precisionAttack", "spotWeakness", "threatDetection",
  "fabricationExpertise", "fieldExpertise", "inventionExpertise", "maker", "upgradeExpertise"
]);

/** CPR's effect-sheet category for a change key. */
export function keyCategory(key) {
  const k = String(key ?? "");
  if (k.startsWith("system.stats.")) return "stat";
  if (!k.startsWith("bonuses.")) return "custom";
  const bonus = k.slice("bonuses.".length);
  if (COMBAT.has(bonus)) return "combat";
  if (MISC.has(bonus)) return "misc";
  if (NETRUN.has(bonus)) return "netrun";
  if (ROLE.has(bonus)) return "role";
  return "skill";
}

/** ADD, the only mode CPR's roll code counts. */
export const ADD = 2;

/**
 * A condition's change list in Foundry's shape, plus CPR's flags for it.
 * Input changes: { key, value, situational?, onByDefault? } (value a number or numeric string).
 * @returns {{ changes: object[], flags: { cats: object, situational: object } }}
 */
export function cprChanges(list = []) {
  const changes = [];
  const cats = {};
  const situational = {};
  list.forEach((c, i) => {
    const key = String(c.key);
    const stat = key.startsWith("system.stats.");
    changes.push({ key, mode: c.mode ?? ADD, value: String(c.value), priority: c.priority ?? null });
    cats[i] = keyCategory(key);
    situational[i] = { isSituational: !stat && !!c.situational, onByDefault: !stat && !!c.situational && c.onByDefault !== false };
  });
  return { changes, flags: { cats, situational } };
}

/** The flags object for an effect's data: flags["cyberpunk-red-core"].changes. */
export function cprEffectFlags(list = []) {
  return { [SYSTEM_ID]: { changes: cprChanges(list).flags } };
}

/**
 * Fill in CPR's bookkeeping for an effect's existing changes, keeping what's there.
 * Used on any effect created with changes but without the flags (other modules, macros).
 */
export function repairFlags(changes = [], existing = {}) {
  const cats = { ...(existing?.cats ?? {}) };
  const situational = { ...(existing?.situational ?? {}) };
  changes.forEach((c, i) => {
    cats[i] ??= keyCategory(c?.key);
    situational[i] ??= { isSituational: false, onByDefault: false };
  });
  return { ...(existing ?? {}), cats, situational };
}

/** Does an effect (document or data) carry changes without complete CPR bookkeeping? */
export function needsRepair(effect) {
  const changes = effect?.changes ?? [];
  if (!changes.length) return false;
  const flags = effect?.flags?.[SYSTEM_ID]?.changes;
  if (!flags?.cats) return true;
  return changes.some((c, i) => flags.cats[i] === undefined || (flags.situational && flags.situational[i] === undefined));
}
