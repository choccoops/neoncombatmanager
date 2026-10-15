import { MODULE_ID, SYSTEM_ID } from "./constants.js";
import { Compat } from "./compat.js";
import { slug } from "./util.js";

const { getProperty } = foundry.utils;

/**
 * The Cyberpunk RED - CORE behaviour this module relies on, verified against the v0.92.4 source.
 * Each check guards its call so a system update that renames something degrades instead of
 * throwing.
 */
export const CPR = {
  /** Actor types that take part in combat as meat (Black ICE and Demons have no body). */
  isMeat(actor) {
    return actor?.type === "character" || actor?.type === "mook";
  },

  hp(actor) {
    const hp = getProperty(actor, "system.derivedStats.hp") ?? {};
    return { value: Number(hp.value) || 0, max: Number(hp.max) || 0 };
  },

  /** CPR's Wound State: notWounded | lightlyWounded | seriouslyWounded | mortallyWounded. */
  woundState(actor) {
    const set = getProperty(actor, "system.derivedStats.currentWoundState");
    if (set && set !== "invalidState") return set;
    const { value, max } = this.hp(actor);
    const serious = Number(getProperty(actor, "system.derivedStats.seriouslyWounded")) || Math.ceil(max / 2);
    if (!max) return "notWounded";
    if (value < 1) return "mortallyWounded";
    if (value < serious) return "seriouslyWounded";
    if (value < max) return "lightlyWounded";
    return "notWounded";
  },

  deathSave(actor) {
    const ds = getProperty(actor, "system.derivedStats.deathSave") ?? {};
    return { value: Number(ds.value) || 0, penalty: Number(ds.penalty) || 0, base: Number(ds.basePenalty) || 0 };
  },

  stat(actor, name) {
    return Number(getProperty(actor, `system.stats.${name}.value`)) || 0;
  },

  /** Worn armor SP: { head, body } (current values, after ablation). */
  armor(actor) {
    return {
      head: Number(getProperty(actor, "system.externalData.currentArmorHead.value")) || 0,
      body: Number(getProperty(actor, "system.externalData.currentArmorBody.value")) || 0
    };
  },

  /** The armor penalty CPR applies to REF/DEX/MOVE, as a positive number (0 without one). */
  armorPenalty(actor) {
    try {
      if (typeof actor?.getArmorPenaltyMods === "function") return Math.abs(Number(actor.getArmorPenaltyMods("ref")) || 0);
    } catch {
      /* not a character */
    }
    return 0;
  },

  /** Active role names, for display. */
  roles(actor) {
    return (actor?.items ?? []).filter((i) => i.type === "role").map((r) => ({ name: r.name, rank: Number(r.system?.rank) || 0 }));
  },

  /**
   * Does the actor have one of these items in use? Names match loosely (case, spaces and
   * punctuation ignored; "Low Light" matches "Cybereye Option: Low Light / Infrared / UV").
   * In use: cyberware installed, anything else equipped (worn) or installed as an upgrade.
   */
  hasGear(actor, names) {
    const wanted = (names ?? []).map(slug).filter(Boolean);
    if (!wanted.length) return false;
    return (actor?.items ?? []).some((item) => {
      const s = slug(item.name);
      if (!wanted.some((w) => s.includes(w))) return false;
      return this.inUse(item);
    });
  },

  inUse(item) {
    const sys = item?.system ?? {};
    try {
      if (sys.isInstalled) return true;
    } catch {
      /* getter may throw outside an actor */
    }
    if (item?.type === "cyberware") return !!sys.isInstalled;
    return sys.equipped === "equipped";
  },

  /* ---------------------------------------- */
  /*  Damage and healing                      */
  /* ---------------------------------------- */

  /**
   * Damage straight to Hit Points, as fire, drowning and Critical Injury bonus damage do
   * (armor isn't touched). Wound States follow from CPR's own data preparation.
   */
  async damageHP(actor, amount, { reason = "" } = {}) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    if (!n || !actor) return 0;
    const { value } = this.hp(actor);
    await actor.update({ "system.derivedStats.hp.value": value - n }, { [MODULE_ID]: { reason } });
    return n;
  },

  async healHP(actor, amount) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    if (!n || !actor) return 0;
    const { value, max } = this.hp(actor);
    const next = Math.min(max, value + n);
    if (next !== value) await actor.update({ "system.derivedStats.hp.value": next });
    return next - value;
  },

  /** Ablate worn armor on a location by an amount, through CPR's own method. */
  async ablate(actor, location, amount = 1) {
    if (typeof actor?._ablateArmor !== "function") return false;
    await actor._ablateArmor(location, amount);
    return true;
  },

  /** Reset the Death Save penalty to its base (Stabilization). */
  async resetDeathPenalty(actor) {
    const { base } = this.deathSave(actor);
    await actor.update({ "system.derivedStats.deathSave.penalty": base });
  },

  /**
   * Roll a Death Save through Cyberpunk RED's own roll: its dialog (unless Ctrl-clicked), its
   * modifiers, its card, and its bookkeeping (a passed save raises the penalty).
   * @returns {Promise<{passed: boolean}|null>} null when cancelled or unsupported
   */
  async rollDeathSave(actor, event = null) {
    if (typeof actor?.createRoll !== "function") return null;
    const roll = actor.createRoll("deathsave");
    if (!roll) return null;
    const ev = event ?? { type: "click", ctrlKey: false, metaKey: false };
    if (typeof roll.handleRollDialog === "function") {
      const go = await roll.handleRollDialog(ev, actor, null);
      if (!go) return null;
    }
    await roll.roll();
    let result = null;
    if (typeof actor.processDeathSave === "function") result = actor.processDeathSave(roll);
    roll.saveResult = result;
    roll.entityData = { actor: actor.id, token: actor.token?.id ?? null };
    roll.criticalCard = typeof roll.wasCritical === "function" ? roll.wasCritical() : false;
    if (roll.rollCard) {
      const content = await Compat.renderTemplate(roll.rollCard, roll);
      await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });
    }
    const failed = game.i18n.localize("CPR.rolls.failed");
    const passed = result ? result !== failed : Number(roll.resultTotal) < this.stat(actor, "body") && roll.initialRoll !== 10;
    return { passed };
  },

  /** A character's skill item by name (ignoring case, spaces and slashes), or null. */
  skill(actor, skillName) {
    const want = slug(skillName);
    return actor?.items?.find((i) => i.type === "skill" && slug(i.name) === want) ?? null;
  },

  /**
   * Roll a Skill Check through Cyberpunk RED's own roll: its dialog (unless Ctrl-clicked), LUCK,
   * situational modifiers (including this module's conditions), critical dice and its roll card.
   * Without the skill it's the STAT alone.
   * @returns {Promise<{total: number}|null>} null when cancelled
   */
  async skillCheck(actor, skillName, { event = null, stat = "will" } = {}) {
    const skill = this.skill(actor, skillName);
    let roll = null;
    if (skill && typeof skill.createRoll === "function") roll = skill.createRoll("skill", actor);
    else if (typeof actor?.createRoll === "function") roll = actor.createRoll("stat", stat);
    if (!roll) return null;
    const ev = event ?? { type: "click", ctrlKey: false, metaKey: false };
    if (typeof roll.handleRollDialog === "function") {
      const go = await roll.handleRollDialog(ev, actor, skill);
      if (!go) return null;
    }
    if (skill && typeof skill.confirmRoll === "function") roll = await skill.confirmRoll(roll);
    await roll.roll();
    const luck = Number(roll.luck) || 0;
    if (luck > 0) {
      const have = this.stat(actor, "luck");
      await actor.update({ "system.stats.luck.value": Math.max(0, have - luck) });
    }
    roll.entityData = { actor: actor.id, token: null, item: skill?.id ?? null };
    roll.criticalCard = typeof roll.wasCritical === "function" ? roll.wasCritical() : false;
    if (roll.rollCard) {
      const content = await Compat.renderTemplate(roll.rollCard, roll);
      await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });
    }
    return { total: Number(roll.resultTotal) || 0 };
  },

  /* ---------------------------------------- */
  /*  Critical Injuries                       */
  /* ---------------------------------------- */

  /** CPR's Critical Injury compendium for a location. */
  critPack(location) {
    const ids = location === "head"
      ? [`${SYSTEM_ID}.core_critical-injuries-head`, `${SYSTEM_ID}.criticalInjuriesHead`]
      : [`${SYSTEM_ID}.core_critical-injuries-body`, `${SYSTEM_ID}.criticalInjuriesBody`];
    for (const id of ids) {
      const pack = game.packs?.get(id);
      if (pack) return pack;
    }
    return null;
  },

  /** The Critical Injury item data from CPR's compendium, or null. */
  async critItemData(location, name) {
    const pack = this.critPack(location);
    if (!pack) return null;
    const index = await pack.getIndex();
    const entry = index.find((e) => slug(e.name) === slug(name));
    if (!entry) return null;
    const doc = await pack.getDocument(entry._id);
    const data = doc?.toObject() ?? null;
    if (data) delete data._id;
    return data;
  },

  /** The actor's Critical Injury item of a name, or null. */
  critItem(actor, name) {
    return (actor?.items ?? []).find((i) => i.type === "criticalInjury" && slug(i.name) === slug(name)) ?? null;
  }
};
