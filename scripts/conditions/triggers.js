import { MODULE_ID, FLAGS } from "../constants.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Registry } from "./registry.js";
import { Conditions } from "./engine.js";
import { WOUND_CONDITION } from "./data.js";

const { getProperty } = foundry.utils;

/** Operators a trigger can test with. */
export const OPS = {
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  eq: (a, b) => a == b, // eslint-disable-line eqeqeq
  ne: (a, b) => a != b, // eslint-disable-line eqeqeq
  gte: (a, b) => a >= b,
  gt: (a, b) => a > b
};

/** Does a trigger's test hold for a value? Numbers compare as numbers, anything else as text. */
export function testTrigger(trigger, value) {
  const op = OPS[trigger.op];
  if (!op || value === undefined || value === null) return false;
  const a = Number(value);
  const b = Number(trigger.value);
  if (Number.isFinite(a) && Number.isFinite(b) && String(trigger.value).trim() !== "") return op(a, b);
  return op(String(value), String(trigger.value ?? ""));
}

/**
 * Triggers (the Triggler, rebuilt): rules the GM writes in the Condition Lab, "when an actor's
 * <data path> <op> <value>, add (or remove) <condition>", optionally undone when the test stops
 * holding. Wound States follow Cyberpunk RED's own Wound State the same way, built in.
 */
export const Triggers = {
  list() {
    return (Settings.get("triggers") ?? []).filter((t) => t && t.path && t.condition);
  },

  /** Run every trigger and the Wound State mirror for an actor (active GM). */
  async evaluate(actor) {
    if (!actor) return;
    await this.syncWound(actor);
    for (const t of this.list()) {
      if (t.disabled) continue;
      if (t.types?.length && !t.types.includes(actor.type)) continue;
      const holds = testTrigger(t, getProperty(actor, t.path));
      const has = Conditions.has(t.condition, actor);
      if (holds && t.action === "remove" && has) await Conditions.remove(t.condition, actor);
      else if (holds && t.action !== "remove" && !has) await Conditions.add(t.condition, actor, { flags: { [MODULE_ID]: { trigger: t.id } } });
      else if (!holds && t.revert && t.action !== "remove" && has) {
        // Only undo what this trigger did.
        const mine = Conditions.effects(actor, t.condition).filter((e) => e.getFlag(MODULE_ID, "trigger") === t.id);
        if (mine.length) await actor.deleteEmbeddedDocuments("ActiveEffect", mine.map((e) => e.id));
      }
    }
  },

  /**
   * Show CPR's Wound State on the token: Lightly, Seriously or Mortally Wounded. These carry no
   * changes (CPR applies -2/-4 itself); they're for the eye, the carousel and the party bar.
   */
  async syncWound(actor) {
    if (!Settings.get("mirrorWounds") || !CPR.isMeat(actor) || !actor.isOwner) return;
    const want = WOUND_CONDITION[CPR.woundState(actor)] ?? null;
    const have = actor.effects.filter((e) => Registry.ofEffect(e)?.mirror === "wound");
    const stale = have.filter((e) => Registry.ofEffect(e).id !== want);
    if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map((e) => e.id), { [MODULE_ID]: { quiet: true } });
    if (want && !have.some((e) => Registry.ofEffect(e).id === want) && !Registry.get(want)?.disabled) {
      await Conditions.add(want, actor, { managed: "wound" });
    }
  },

  /** Paths whose change re-runs the triggers (any path a trigger names, and HP). */
  watched(changes) {
    const flat = foundry.utils.flattenObject(changes ?? {});
    const keys = Object.keys(flat);
    if (keys.some((k) => k.startsWith("system.derivedStats"))) return true;
    return this.list().some((t) => keys.some((k) => k === t.path || k.startsWith(`${t.path}.`) || t.path.startsWith(`${k}.`)));
  },

  /** Is this one of the effects the triggers manage? */
  isManaged(effect) {
    return !!effect?.getFlag?.(MODULE_ID, FLAGS.managed) || !!effect?.getFlag?.(MODULE_ID, "trigger");
  }
};
