import { MODULE_ID } from "../constants.js";

/**
 * Cyberpunk RED - CORE ships its source as ES modules (systems/cyberpunk-red-core/modules/...),
 * and doesn't expose its roll classes. Importing the same files gets the same classes, as long
 * as the URL is the one the system loaded them from: the bridge finds it, checks it against a
 * class the system does expose (its ActiveEffect class), and only then hands the classes over.
 * Nothing is patched when the check fails (another system, a bundled build, a CDN path).
 */
export const Bridge = {
  /** { CPRRoll, CPRAttackRoll, CPRDamageRoll, ... } and CPRChat, once loaded. */
  rolls: null,
  chat: null,
  base: null,

  /** Where the system's files are, in the order worth trying. */
  candidates() {
    const id = game.system?.id;
    const out = [];
    const tag = typeof document !== "undefined"
      ? [...document.querySelectorAll("script[src]")].find((s) => /\/cpr\.js(\?|$)/.test(s.src) && s.src.includes(id))
      : null;
    if (tag) out.push(new URL(".", tag.src).href);
    const route = foundry.utils.getRoute?.(`systems/${id}/`) ?? `/systems/${id}/`;
    if (typeof location !== "undefined") out.push(new URL(route, location.origin).href);
    return [...new Set(out)];
  },

  /** Load the classes. @returns {Promise<boolean>} whether the roller can be hooked */
  async load() {
    if (game.system?.id !== "cyberpunk-red-core") return false;
    for (const base of this.candidates()) {
      try {
        const effect = await import(`${base}modules/cpr-active-effect.js`);
        // The same module instance as the system's, or patching would miss.
        if (effect.default !== CONFIG.ActiveEffect.documentClass) continue;
        this.rolls = await import(`${base}modules/rolls/cpr-rolls.js`);
        this.chat = (await import(`${base}modules/chat/cpr-chat.js`)).default;
        this.base = base;
        return !!this.rolls?.CPRRoll && typeof this.chat?.RenderRollCard === "function";
      } catch (err) {
        console.debug(`${MODULE_ID} | Cyberpunk RED's roller isn't at ${base}`, err);
      }
    }
    console.warn(`${MODULE_ID} | couldn't reach Cyberpunk RED's roll classes: the roller features stay off`);
    return false;
  },

  /** The kind of a roll: attack, damage, skill, stat, role, initiative, deathSave, ... */
  kindOf(roll) {
    const R = this.rolls ?? {};
    if (R.CPRDamageRoll && roll instanceof R.CPRDamageRoll) return "damage";
    if (R.CPRAttackRoll && roll instanceof R.CPRAttackRoll) return "attack";
    if (R.CPRInitiative && roll instanceof R.CPRInitiative) return "initiative";
    if (R.CPRDeathSaveRoll && roll instanceof R.CPRDeathSaveRoll) return "deathSave";
    if (R.CPRHumanityLossRoll && roll instanceof R.CPRHumanityLossRoll) return "humanity";
    if (R.CPRTableRoll && roll instanceof R.CPRTableRoll) return "table";
    if (R.CPRInterfaceRoll && roll instanceof R.CPRInterfaceRoll) return "interface";
    if (R.CPRRoleRoll && roll instanceof R.CPRRoleRoll) return "role";
    if (R.CPRSkillRoll && roll instanceof R.CPRSkillRoll) return "skill";
    if (R.CPRStatRoll && roll instanceof R.CPRStatRoll) return "stat";
    return "other";
  }
};

/** Kinds that are Checks (STAT + Skill + 1d10 against a DV): they explode, chain and take LUCK. */
export const CHECKS = ["attack", "skill", "stat", "role", "interface"];
