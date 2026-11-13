import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { L } from "../util.js";
import { Core, FX_FLAG } from "./core.js";
import { Interrupt } from "./interrupt.js";

/**
 * Chrome you switch on: a Sandevistan, Berserk, and the Operating Systems that run on them (a
 * Kerenzikov is always on: its look is a macro's to flip).
 *
 * Running chrome is a Neon Condition ("Chrome running": an Active Effect with the rule's flat
 * numbers and a status icon), and three things stay in step with it:
 * - the chrome's own "<item> (active)" effect (Neon Hub's items have one where the book gives a
 *   flat bonus): switching it on or off adds or removes the condition, and the condition ending
 *   switches it off. Numbers the item's effect already gives are left off the condition;
 * - the token's Neon FX switch (what the Sandevistan macro flips): the condition holds it on, in
 *   the running Operating System's colour;
 * - Initiative in a fight under way: up by the condition's bonus as it starts, back as it ends.
 */

/** The Neon FX switches chrome can hold on. */
export const CHROME_KINDS = ["sandevistan", "berserk", "kerenzikov"];

/** Operating Systems by what they run on (Item Compendium), by a word of their name. */
export const OS = {
  sandevistan: ["apogee", "professional", "warp dancer", "falcon", "reflex-plus"],
  berserk: ["berserker", "baldur", "matterhorn", "brawler"]
};

/** Each Operating System's colour (a look of its own on the same switch); a kind's default otherwise. */
export const CHROME_TINT = {
  sandevistan: 0x39ff14,
  berserk: 0xff1744,
  kerenzikov: 0x3d8bff,
  apogee: 0xffd23f,
  professional: 0xffffff,
  warpdancer: 0xff4fd8,
  falcon: 0x00e5ff,
  reflexplus: 0xffb300,
  berserker: 0xb3001b,
  baldur: 0xff7a1a,
  matterhorn: 0x9ecbff,
  brawler: 0xffb300
};

const plain = (s) => String(s ?? "").toLowerCase().replace(/[‘’'"`]/g, "").replace(/\s+/g, " ").trim();
const osKey = (word) => word.replace(/[^a-z]/g, "");

/**
 * What a piece of chrome switches on, from its name, pure: { kind, os } or null.
 * "MILITECH ‘FALCON’ OS" is a Sandevistan's; "Berserk" is itself; a Kerenzikov and other speedware
 * are "kerenzikov".
 */
export function chromeKind(name) {
  const n = plain(name);
  if (!n) return null;
  if (/\bos\b|operating system/.test(n)) {
    for (const [kind, words] of Object.entries(OS)) {
      const w = words.find((x) => n.includes(x) || n.includes(x.replace("-", " ")));
      if (w) return { kind, os: osKey(w) };
    }
    return null;
  }
  if (n.includes("sandevistan")) return { kind: "sandevistan", os: null };
  if (n.includes("berserk")) return { kind: "berserk", os: null };
  if (/kerenzikov|speedware/.test(n)) return { kind: "kerenzikov", os: null };
  return null;
}

/** Is this the switch effect of an item ("<item> (active)")? */
export const isSwitch = (effect) => /\(active\)\s*$/i.test(String(effect?.name ?? ""));

/**
 * The switches a character's chrome holds on, pure: { sandevistan, berserk, kerenzikov }, each the
 * running Operating System's key, true (the chrome by itself), or absent.
 * @param {object[]} items - [{ name, type, installed, effects: [{ name, disabled }] }]
 */
export function chromeState(items = []) {
  const out = {};
  for (const i of items) {
    if (i.type !== "cyberware" || !i.installed) continue;
    const what = chromeKind(i.name);
    if (!what || !(i.effects ?? []).some((e) => isSwitch(e) && !e.disabled)) continue;
    // An Operating System's look wins over the bare chrome's.
    if (what.os || !out[what.kind]) out[what.kind] = what.os ?? true;
  }
  return out;
}

/** The colour of a switch as a token holds it (true, or an Operating System's key). */
export const tintOf = (kind, value) => CHROME_TINT[typeof value === "string" ? value : kind] ?? CHROME_TINT[kind];

/** The Chrome running conditions, as { kind, os, id }. */
export const chromeConditions = () => Registry.all().filter((c) => c.chrome?.kind).map((c) => ({ id: c.id, kind: c.chrome.kind, os: c.chrome.os ?? null }));

/**
 * The condition a character's chrome of a kind runs as, pure: its installed Operating System's,
 * else the bare chrome's.
 * @param {object[]} items - as chromeState takes them
 * @param {{id, kind, os}[]} conditions
 */
export function conditionFor(items, kind, conditions) {
  const os = items.filter((i) => i.type === "cyberware" && i.installed).map((i) => chromeKind(i.name)).find((w) => w?.kind === kind && w.os)?.os ?? null;
  return (os && conditions.find((c) => c.kind === kind && c.os === os)) || conditions.find((c) => c.kind === kind && !c.os) || null;
}

/** A condition's changes without the keys the chrome's own switched-on effects already give, pure. */
export const withoutGiven = (changes = [], given = []) => changes.filter((ch) => !given.includes(ch.key));

export const Chrome = {
  init() {
    Hooks.on("updateActiveEffect", (effect, changes, options, userId) => {
      if (changes && "disabled" in changes) this._switched(effect, userId);
    });
    Hooks.on("createActiveEffect", (effect, options, userId) => {
      this._switched(effect, userId);
      this._condition(effect, userId, true);
    });
    Hooks.on("deleteActiveEffect", (effect, options, userId) => {
      this._switched(effect, userId);
      this._condition(effect, userId, false);
    });
  },

  get on() {
    return !!Settings.get("fxChrome");
  },

  /** An actor's items as the pure functions read them. */
  items(actor) {
    return [...(actor?.items ?? [])].map((i) => ({
      id: i.id,
      name: i.name,
      type: i.type,
      installed: !!i.system?.isInstalled,
      effects: [...(i.effects ?? [])].map((e) => ({ name: e.name, disabled: !!e.disabled, keys: (e.changes ?? []).map((c) => c.key) }))
    }));
  },

  /** The switch effects ("(active)") on a character's chrome of a kind. */
  switches(actor, kind) {
    return [...(actor?.items ?? [])]
      .filter((i) => i.type === "cyberware" && i.system?.isInstalled && chromeKind(i.name)?.kind === kind)
      .flatMap((i) => [...(i.effects ?? [])].filter(isSwitch));
  },

  /** Keys the chrome's switched-on effects give (the condition leaves those to them). */
  given(actor, kind) {
    return this.switches(actor, kind).filter((e) => !e.disabled).flatMap((e) => (e.changes ?? []).map((c) => c.key));
  },

  /** The condition of a kind a character has running, or null. */
  running(actor, kind) {
    return Conditions.active(actor).find((c) => c.chrome?.kind === kind) ?? null;
  },

  /** A chrome item's "(active)" effect was switched: whoever switched it puts the condition on or takes it off. */
  _switched(effect, userId) {
    if (userId !== game.user.id || !this.on || !isSwitch(effect)) return;
    const item = effect.parent;
    const actor = item?.parent;
    const kind = item?.documentName === "Item" && actor?.documentName === "Actor" ? chromeKind(item.name)?.kind : null;
    if (!kind) return;
    this._follow(actor, kind).catch((err) => console.error(`${MODULE_ID} | chrome`, err));
  },

  async _follow(actor, kind) {
    const on = this.switches(actor, kind).some((e) => !e.disabled);
    // A Kerenzikov's or other speedware's switch has no condition: the token's look follows it.
    if (kind === "kerenzikov") return this._flag(actor, kind, on ? true : null);
    const running = this.running(actor, kind);
    if (on && !running) {
      const c = conditionFor(this.items(actor), kind, chromeConditions());
      if (c) await Conditions.add(c.id, actor);
    } else if (!on && running) await Conditions.remove(running.id, actor);
  },

  /** A Chrome running condition was placed or went (by hand, a macro, its duration): the rest follows. */
  _condition(effect, userId, added) {
    const c = Registry.ofEffect(effect);
    const actor = effect?.parent;
    if (!c?.chrome?.kind || actor?.documentName !== "Actor" || !this.on || !Core.writes(userId)) return;
    this._after(actor, c, effect, added).catch((err) => console.error(`${MODULE_ID} | chrome`, err));
  },

  async _after(actor, c, effect, added) {
    const { kind, os } = c.chrome;
    const bonus = Number((c.rawChanges ?? []).find((ch) => ch.key === "bonuses.initiative")?.value) || 0;
    if (added) {
      // What the chrome's own effect already gives isn't counted twice.
      const given = this.given(actor, kind);
      if (given.length && (c.rawChanges ?? []).some((ch) => given.includes(ch.key))) await Conditions.add(c.id, actor, { changes: withoutGiven(c.rawChanges, given) });
      await this._flag(actor, kind, os ?? true);
      await this._initiative(actor, bonus);
      // An Apogee switched on during someone else's Turn can interrupt them.
      if (os === "apogee") await Interrupt.check(actor);
      return;
    }
    if (this.running(actor, kind)) return; // another of its kind took over
    await this._flag(actor, kind, null);
    await this._initiative(actor, -bonus);
    for (const e of this.switches(actor, kind)) if (!e.disabled && actor.isOwner) await e.update({ disabled: true });
  },

  /** Hold (or drop) a Neon FX switch on a character's tokens. */
  async _flag(actor, kind, value) {
    for (const token of Core.tokensOf(actor)) {
      if (!token.document?.isOwner) continue;
      const have = Core.state(token)[kind];
      if (value && have !== value) await token.document.setFlag(MODULE_ID, `${FX_FLAG}.${kind}`, value);
      else if (!value && have) await token.document.unsetFlag(MODULE_ID, `${FX_FLAG}.${kind}`);
    }
  },

  /** Speedware kicking in mid-fight: the character's place in the Initiative order moves with it. */
  async _initiative(actor, by) {
    const combat = game.combat;
    if (!by || !combat?.started) return;
    for (const cb of combat.combatants ?? []) {
      if ((cb.actor !== actor && cb.actorId !== actor.id) || !Number.isFinite(cb.initiative) || !cb.isOwner) continue;
      await cb.update({ initiative: cb.initiative + by });
    }
  },

  /**
   * Switch a kind of chrome on or off for tokens' characters (the macros): through the chrome's
   * own "(active)" effect when it has one, else the condition itself. A character with no such
   * chrome still gets the bare condition (an NPC the GM runs).
   * @param {"sandevistan"|"berserk"} kind
   * @param {Token[]} tokens
   * @param {boolean|null} on - null flips each
   */
  async activate(kind, tokens, on = null) {
    const done = [];
    for (const token of tokens) {
      const actor = token?.actor;
      if (!actor) continue;
      const running = this.running(actor, kind);
      const want = on ?? !running;
      if (want === !!running) continue;
      const switches = this.switches(actor, kind);
      if (!want) await Conditions.remove(running.id, actor);
      else if (switches.length && actor.isOwner) for (const e of switches) await e.update({ disabled: false });
      else {
        const c = conditionFor(this.items(actor), kind, chromeConditions());
        if (c) await Conditions.add(c.id, actor);
        else ui.notifications?.warn(L(`${LANG}.FX.NoChrome`, { name: actor.name }));
      }
      done.push(token);
    }
    return done;
  }
};
