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

/** Where a combatant keeps what its running chrome added to its Initiative: { [kind]: n }. */
export const INIT_FLAG = "chromeInit";

/**
 * What switching speedware does to a combatant's Initiative, pure.
 * `had` is what this kind is on record as having added: a number while it's in, 0 once taken
 * back, undefined when we never touched it (rolled with the chrome already running: the roll
 * carried the bonus, so "off" takes it out).
 * @returns {{ initiative: number, keep: number }|null} null: nothing to do
 */
export function initiativeMove({ initiative, had, bonus, on }) {
  const b = Number(bonus) || 0;
  if (!b || !Number.isFinite(initiative)) return null;
  if (on) return had > 0 ? null : { initiative: initiative + b, keep: b };
  if (had === 0) return null;
  return { initiative: initiative - (had > 0 ? had : b), keep: 0 };
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

  /**
   * A character's fitted chrome: installed cyberware, and the upgrades sitting in it. An
   * Operating System is an Item Upgrade inside its Sandevistan or Berserk, not cyberware of its
   * own, so it counts when the piece it's in is installed.
   */
  fitted(actor) {
    const list = [...(actor?.items ?? [])];
    const host = new Map();
    for (const i of list) for (const id of i.system?.installedItems?.list ?? []) host.set(id, i);
    const ok = (i) => {
      if (i.type === "cyberware") return !!i.system?.isInstalled;
      if (i.type !== "itemUpgrade") return false;
      return host.has(i.id) ? ok(host.get(i.id)) : false;
    };
    return list.filter(ok);
  },

  /** An actor's items as the pure functions read them (a fitted upgrade reads as installed chrome). */
  items(actor) {
    const fitted = new Set(this.fitted(actor).map((i) => i.id));
    return [...(actor?.items ?? [])].map((i) => ({
      id: i.id,
      name: i.name,
      type: fitted.has(i.id) ? "cyberware" : i.type,
      installed: fitted.has(i.id),
      effects: [...(i.effects ?? [])].map((e) => ({ name: e.name, disabled: !!e.disabled, keys: (e.changes ?? []).map((c) => c.key) }))
    }));
  },

  /** Every switch effect ("(active)") on a character's chrome of a kind, its Operating System's included. */
  allSwitches(actor, kind) {
    return this.fitted(actor).filter((i) => chromeKind(i.name)?.kind === kind).flatMap((i) => [...(i.effects ?? [])].filter(isSwitch));
  },

  /**
   * The switches that run a character's chrome of a kind: its Operating System's when that has
   * one, else the bare chrome's. An Operating System's numbers stand in for the chrome's own
   * (an Apogee's +6 Initiative, not that on top of the Sandevistan's +3), so the two are never
   * on together.
   */
  switches(actor, kind) {
    const pieces = this.fitted(actor).filter((i) => chromeKind(i.name)?.kind === kind);
    const of = (list) => list.flatMap((i) => [...(i.effects ?? [])].filter(isSwitch));
    const os = of(pieces.filter((i) => chromeKind(i.name).os));
    return os.length ? os : of(pieces);
  },

  /**
   * Put a kind's switches where they belong: the ones that run it on or off together, any other
   * (the bare chrome's, under an Operating System) off. Ours to do, so nothing reacts half way.
   */
  async _settle(actor, kind, on) {
    if (!actor?.isOwner) return;
    const mine = this.switches(actor, kind);
    const rest = this.allSwitches(actor, kind).filter((e) => !mine.includes(e));
    const key = this._key(actor, kind);
    const held = this._held.has(key);
    this._held.add(key);
    try {
      for (const e of mine) if (!!e.disabled === on) await e.update({ disabled: !on });
      for (const e of rest) if (!e.disabled) await e.update({ disabled: true });
    } finally {
      if (!held) this._held.delete(key);
    }
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
    // Our own hand is on the switches (opening or closing them all): one look when it's done.
    if (!kind || this._held.has(this._key(actor, kind))) return;
    this._queue(actor, kind, () => this._follow(actor, kind));
  },

  /** Being opened or closed by us right now: `${actor}:${kind}`. */
  _held: new Set(),
  /** One thing at a time for a character's chrome of a kind (this client). */
  _busy: new Map(),
  _key: (actor, kind) => `${actor?.uuid ?? actor?.id}:${kind}`,

  /**
   * A character's chrome often has two switches (the Sandevistan's and its Operating System's),
   * and each write takes a trip to the server: handled side by side, the second saw the world
   * before the first had finished (two conditions placed, or one put back as it was coming off).
   * So they queue, and each reads the state as its turn comes.
   */
  _queue(actor, kind, fn) {
    const key = this._key(actor, kind);
    const next = (this._busy.get(key) ?? Promise.resolve()).then(fn).catch((err) => console.error(`${MODULE_ID} | chrome`, err));
    this._busy.set(key, next);
    next.then(() => {
      if (this._busy.get(key) === next) this._busy.delete(key);
    });
    return next;
  },

  async _follow(actor, kind) {
    const on = this.allSwitches(actor, kind).some((e) => !e.disabled);
    // A Kerenzikov's or other speedware's switch has no condition: the token's look follows it.
    if (kind === "kerenzikov") return this._flag(actor, kind, on ? true : null);
    const running = this.running(actor, kind);
    // Switched on by hand at the bare chrome with an Operating System in it: the Operating System's runs.
    if (on) await this._settle(actor, kind, true);
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
    this._queue(actor, c.chrome.kind, () => this._after(actor, c, effect, added));
  },

  async _after(actor, c, effect, added) {
    const { kind, os } = c.chrome;
    const bonus = Number((c.rawChanges ?? []).find((ch) => ch.key === "bonuses.initiative")?.value) || 0;
    if (added) {
      // The same condition placed twice at once (two clients, two switches): one stays.
      const twins = effect ? Conditions.effects(actor, c.id).filter((e) => e.id !== effect.id) : [];
      if (twins.length && actor.isOwner) {
        const drop = twins.some((e) => e.id < effect.id) ? [effect.id] : twins.map((e) => e.id);
        await actor.deleteEmbeddedDocuments("ActiveEffect", drop).catch(() => {}); // already gone: fine
        if (drop.includes(effect.id)) return;
      }
      // What the chrome's own effect already gives isn't counted twice.
      const given = this.given(actor, kind);
      if (given.length && (c.rawChanges ?? []).some((ch) => given.includes(ch.key))) await Conditions.add(c.id, actor, { changes: withoutGiven(c.rawChanges, given) });
      await this._flag(actor, kind, os ?? true);
      // Whose Turn it is, read before the Initiative moves (the order re-sorts under it).
      const current = game.combat?.combatant?.id ?? null;
      await this._initiative(actor, kind, bonus, true);
      // An Apogee switched on during someone else's Turn can interrupt them.
      if (os === "apogee") await Interrupt.check(actor, { currentId: current });
      return;
    }
    if (this.running(actor, kind)) return; // another of its kind took over
    await this._flag(actor, kind, null);
    await this._initiative(actor, kind, bonus, false);
    // All its switches go off together: none of them, half way, reads as "still on".
    await this._settle(actor, kind, false);
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

  /**
   * Speedware kicking in mid-fight: the character's place in the Initiative order moves with it,
   * once. What was added is kept on the combatant, so a second "on" adds nothing and "off" takes
   * back what's there, however many times either arrives.
   */
  async _initiative(actor, kind, bonus, on) {
    const combat = game.combat;
    if (!bonus || !combat?.started) return;
    for (const cb of combat.combatants ?? []) {
      if ((cb.actor !== actor && cb.actorId !== actor.id) || !cb.isOwner) continue;
      const all = cb.flags?.[MODULE_ID]?.[INIT_FLAG] ?? {};
      const had = all[kind];
      const next = initiativeMove({ initiative: cb.initiative, had, bonus, on });
      if (!next) continue;
      const flags = { [MODULE_ID]: { ...(cb.flags?.[MODULE_ID] ?? {}), [INIT_FLAG]: { ...all, [kind]: next.keep } } };
      await cb.update(next.initiative === cb.initiative ? { flags } : { initiative: next.initiative, flags });
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
      else if (switches.length && actor.isOwner) {
        // Its switches on (the Operating System's, in place of the bare chrome's), then one look: the condition is placed once.
        await this._settle(actor, kind, true);
        await this._queue(actor, kind, () => this._follow(actor, kind));
      } else {
        const c = conditionFor(this.items(actor), kind, chromeConditions());
        if (c) await Conditions.add(c.id, actor);
        else ui.notifications?.warn(L(`${LANG}.FX.NoChrome`, { name: actor.name }));
      }
      done.push(token);
    }
    return done;
  }
};
