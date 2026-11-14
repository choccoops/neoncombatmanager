import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { FX } from "../fx.js";
import { Conditions } from "../conditions/engine.js";
import { Cards } from "../combat/cards.js";
import { L, esc } from "../util.js";

/**
 * An Apogee interrupt (Item Compendium, Militech 'Apogee' OS, "Out of turn"): switched on during
 * someone else's Turn, it interrupts them when it puts your Initiative ahead of theirs, and always
 * when you Held your Action to do it. The Turn goes to the interrupter and, when they end it, back
 * to whoever was cut into (a setting); and the moment is made plain to the whole table: a banner, a card, a mark on the carousel, and time standing
 * still on every screen that isn't in Sandevistan time (scripts/neonfx/screen.js).
 *
 * Sandevistan Time: while it lasts, anyone else with an Apogee can cut in too. Everyone who has
 * is in a queue on the combat (flag `interrupt`), and they act highest Initiative first, whether
 * or not either Held an Action to do it; a later one with the higher Initiative goes ahead of the
 * one acting. It lasts until every one of them has ended their Turn: then the Turn goes back to
 * whoever was first cut into, and the banner and the stopped world go with it. The flag is on the
 * combat, so a client that joins late sees it.
 *
 * The flag: { stamp, round, turn, cutId, returnTo, target, anchor, queue: [{ combatantId, actorId,
 * name, by, initiative, done }], combatantId, actorId, name, by } (the last four: whoever is
 * acting now; cutId: whose Turn was cut into; returnTo: the same, when the Turn was taken).
 */
export const INTERRUPT_FLAG = "interrupt";
const BANNER_ID = "ncm-interrupt-banner";
const STRIP_ID = "ncm-sandtime";
const HELD = "readiedAction";

/**
 * Does switching the Apogee on interrupt whoever's Turn it is, pure: "held" (a Held Action:
 * always), "initiative" (now ahead of them), or null.
 */
export function interruptBy({ ownTurn = false, held = false, initiative = null, current = null } = {}) {
  if (ownTurn) return null;
  if (held) return "held";
  return Number.isFinite(Number(initiative)) && Number.isFinite(Number(current)) && initiative !== null && current !== null && Number(initiative) > Number(current) ? "initiative" : null;
}

/**
 * Is an interrupt still the one happening: the same Round, and the Turn still with whoever it
 * rests on (`anchor`: whoever is acting; with the turn order left alone, whoever was cut into)?
 * By combatant, so the order re-sorting under it (an Initiative moving) changes nothing; by the
 * Turn's place for a flag with no anchor.
 */
export function interruptLive(flag, { round = 0, turn = 0, started = false, current = null, present = true } = {}) {
  // `present`: whoever cut in is still in the fight. Taken out of it (or the tracker emptied),
  // there is no Turn of theirs left to end, and nothing would ever clear it.
  if (!flag || !started || flag.round !== round || !present) return false;
  if (flag.anchor) return flag.anchor === current;
  return flag.turn === turn;
}

/** Who has still to act in Sandevistan Time, highest Initiative first (ties: who cut in first), pure. */
export function pendingOf(flag) {
  return (flag?.queue ?? [])
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => !q.done)
    .sort((a, b) => (Number(b.q.initiative) || 0) - (Number(a.q.initiative) || 0) || a.i - b.i)
    .map(({ q }) => q);
}

/** The flag with whoever acts now written on it, or null when nobody is left, pure. */
function settle(flag) {
  const now = pendingOf(flag)[0];
  if (!now) return null;
  return { ...flag, combatantId: now.combatantId, actorId: now.actorId, name: now.name, by: now.by, anchor: flag.returnTo ? now.combatantId : flag.cutId ?? null };
}

/** Someone cuts in (or cuts in again with a new Initiative), pure: the flag with them in the queue. */
export function joinQueue(flag, entry) {
  const queue = [...(flag?.queue ?? []).filter((q) => q.combatantId !== entry.combatantId), { ...entry, done: false }];
  return settle({ ...flag, queue, stamp: entry.stamp ?? flag?.stamp });
}

/**
 * Whoever is acting has ended their Turn (or dropped out), pure.
 * @returns {{ flag: object|null, next: string|null }} flag: null when Sandevistan Time is over;
 *   next: the combatant id the Turn goes to (the next interrupter, else whoever was cut into)
 */
export function resolveQueue(flag, combatantId = flag?.combatantId) {
  const queue = (flag?.queue ?? []).map((q) => (q.combatantId === combatantId ? { ...q, done: true } : q));
  const left = settle({ ...flag, queue });
  return left ? { flag: left, next: left.combatantId } : { flag: null, next: flag?.returnTo ?? null };
}

/** Does someone joining Sandevistan Time under way get in: a Held Action, or ahead of the Turn that was cut into? Pure. */
export function joins({ held = false, initiative = null, cut = null, already = false } = {}) {
  if (already) return null;
  if (held) return "held";
  return initiative !== null && cut !== null && Number(initiative) > Number(cut) ? "initiative" : null;
}

/** Where a combatant sits in the turn order, or -1. */
const turnIndex = (combat, id) => [...(combat?.turns ?? [])].findIndex((t) => t.id === id);

export const Interrupt = {
  _shown: null,

  init() {
    Hooks.on("updateCombat", (combat) => {
      // The Turn has left Sandevistan Time some other way (stepped by hand, a new Round): it's over.
      const flag = combat.getFlag?.(MODULE_ID, INTERRUPT_FLAG);
      if (flag && Compat.isActiveGM && !this.active(combat)) {
        combat.unsetFlag(MODULE_ID, INTERRUPT_FLAG).catch(() => {});
      }
      this.sync(combat);
    });
    // Whoever is acting ends their Turn (on whichever client presses it): the Turn goes to the
    // next one who cut in, or back to whoever was cut into, in the same Round.
    // Braces, not an arrow's value: a pre-update hook that answers `false` cancels the update, and
    // returnTurn's "nothing to do" is false. Answered straight back, it stopped every change to
    // every combat: Begin, the next Turn, the flags.
    Hooks.on("preUpdateCombat", (combat, changes, options) => {
      this.returnTurn(combat, changes, options);
    });
    Hooks.on("deleteCombat", () => this.sync(null));
    // Someone taken out of the fight, or a world opened with an old interrupt still on its combat.
    Hooks.on("deleteCombatant", (cb) => this.sweep(cb?.parent ?? cb?.combat ?? game.combat));
    Hooks.on("canvasReady", () => this.sweep(game.combat));
    Hooks.on("deleteActiveEffect", () => this.dropIfOver());
    Hooks.on(`${MODULE_ID}.fxChanged`, () => this.sync(game.combat));
  },

  /** Sandevistan Time under way in the combat this client is looking at: its flag, or null. */
  active(combat = game.combat) {
    const flag = combat?.flags?.[MODULE_ID]?.[INTERRUPT_FLAG] ?? null;
    const present = !!flag && [...(combat?.combatants ?? [])].some((cb) => cb.id === flag.combatantId);
    return interruptLive(flag, { round: combat?.round, turn: combat?.turn, started: !!combat?.started, current: combat?.combatant?.id ?? null, present }) ? flag : null;
  },

  /** An interrupt nothing can end any more (its combatant gone, the Turn elsewhere): the active GM takes it off the combat. */
  sweep(combat = game.combat) {
    const flag = combat?.getFlag?.(MODULE_ID, INTERRUPT_FLAG) ?? combat?.flags?.[MODULE_ID]?.[INTERRUPT_FLAG];
    if (flag && Compat.isActiveGM && !this.active(combat)) combat.unsetFlag?.(MODULE_ID, INTERRUPT_FLAG)?.catch?.(() => {});
    this.sync(combat);
  },

  /** How a combatant stands in Sandevistan Time: "acting", "waiting" (cut in, still to act), "done", "cut" (whose Turn it was), or null. */
  role(combat, combatantId) {
    const flag = this.active(combat);
    if (!flag) return null;
    if (flag.combatantId === combatantId) return "acting";
    const q = (flag.queue ?? []).find((x) => x.combatantId === combatantId);
    if (q) return q.done ? "done" : "waiting";
    return flag.returnTo === combatantId ? "cut" : null;
  },

  /**
   * The Apogee has just been switched on (the active GM's client, after its Initiative moved):
   * if that interrupts the Turn under way, or joins Sandevistan Time already under way, say so
   * on the combat.
   */
  async check(actor, { currentId = null } = {}) {
    const combat = game.combat;
    if (!combat?.started || !Compat.isActiveGM) return null;
    const all = [...(combat.combatants ?? [])];
    const mine = all.find((cb) => cb.actor === actor || cb.actorId === actor?.id);
    if (!mine) return null;
    const held = Conditions.has(HELD, actor);
    const live = this.active(combat);
    const takes = !!Settings.get("interruptTurn");
    let flag;
    let by;
    let target;
    if (live) {
      // Sandevistan Time already: measured against the Turn that was first cut into.
      const cut = all.find((cb) => cb.id === (live.cutId ?? live.returnTo)) ?? null;
      by = joins({ held, initiative: mine.initiative, cut: cut?.initiative ?? null, already: (live.queue ?? []).some((q) => q.combatantId === mine.id && !q.done) });
      if (!by) return null;
      target = live.target ?? "";
      flag = joinQueue(live, { combatantId: mine.id, actorId: actor.id, name: mine.name ?? actor.name, by, initiative: mine.initiative, stamp: Date.now() });
    } else {
      // Whose Turn it was as the Apogee went on (the caller read it before the Initiative moved).
      const now = (currentId ? all.find((cb) => cb.id === currentId) : null) ?? combat.combatant;
      if (!now) return null;
      by = interruptBy({ ownTurn: now.id === mine.id, held, initiative: mine.initiative, current: now.initiative });
      if (!by) return null;
      target = now.name ?? "";
      const at = turnIndex(combat, now.id);
      flag = joinQueue({ round: combat.round, turn: at >= 0 ? at : combat.turn ?? 0, target, cutId: now.id, ...(takes && mine.id !== now.id ? { returnTo: now.id } : {}) }, { combatantId: mine.id, actorId: actor.id, name: mine.name ?? actor.name, by, initiative: mine.initiative, stamp: Date.now() });
    }
    // The Turn goes to whoever acts now (the highest Initiative of those who cut in).
    const to = turnIndex(combat, flag.combatantId);
    if (takes && flag.returnTo && to >= 0) {
      flag.turn = to;
      if (combat.turn !== to) await combat.update({ turn: to }, { [MODULE_ID]: { interrupt: "to" } });
    }
    await combat.setFlag(MODULE_ID, INTERRUPT_FLAG, flag);
    await Cards.post({ actor, kicker: L(`${LANG}.Interrupt.Kicker`), title: L(`${LANG}.Interrupt.Title`, { name: esc(mine.name ?? actor.name), target: esc(target) }), tone: "yellow", body: `<p>${L(`${LANG}.Interrupt.Body.${by}`)}</p>${(flag.queue ?? []).length > 1 ? `<p>${L(`${LANG}.Interrupt.Order`, { names: pendingOf(flag).map((q) => esc(q.name)).join(" → ") })}</p>` : ""}` });
    return { ...flag, by };
  },

  /**
   * A Turn change while Sandevistan Time holds the Turn: forward, whoever was acting is done and
   * the Turn goes to the next who cut in, or back to whoever was cut into (same Round, marked so
   * nothing treats it as a new Turn starting). Going back a Turn by hand is left alone.
   */
  returnTurn(combat, changes, options = {}) {
    const flag = combat?.flags?.[MODULE_ID]?.[INTERRUPT_FLAG];
    // Not ours, and not Foundry keeping its place as the order re-sorts (an Initiative moved).
    if (!flag?.returnTo || options?.[MODULE_ID]?.interrupt || options?.turnEvents === false) return false;
    if (!("turn" in (changes ?? {})) && !("round" in (changes ?? {}))) return false;
    if (!this.active(combat) || (options.direction ?? 1) < 0) return false;
    const { flag: left, next } = resolveQueue(flag);
    const to = turnIndex(combat, next);
    if (to < 0) return false;
    changes.turn = to;
    changes.round = flag.round;
    // The queue moves with the Turn, in the same change: still Sandevistan Time, or over.
    changes.flags = { ...(changes.flags ?? {}), [MODULE_ID]: { ...(changes.flags?.[MODULE_ID] ?? {}), ...(left ? { [INTERRUPT_FLAG]: { ...left, turn: to } } : { [`-=${INTERRUPT_FLAG}`]: null }) } };
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), interrupt: left ? "next" : "back" };
    return true;
  },

  /** A Sandevistan went off before its Turn in Sandevistan Time was over: they drop out, and the Turn moves on if it was theirs. */
  dropIfOver() {
    const combat = game.combat;
    const flag = combat?.flags?.[MODULE_ID]?.[INTERRUPT_FLAG];
    if (!flag || !Compat.isActiveGM) return;
    const running = (q) => {
      // The combatant's own actor first: an unlinked token's character isn't the world actor.
      const actor = [...(combat.combatants ?? [])].find((cb) => cb.id === q.combatantId)?.actor ?? game.actors?.get(q.actorId);
      return !actor || Conditions.active(actor).some((c) => c.chrome?.kind === "sandevistan");
    };
    const gone = pendingOf(flag).filter((q) => !running(q));
    if (!gone.length) return;
    let left = flag;
    let next = flag.combatantId;
    for (const q of gone) ({ flag: left, next } = resolveQueue(left ?? flag, q.combatantId));
    const to = turnIndex(combat, next);
    const move = flag.returnTo && to >= 0 && combat.turn !== to;
    const run = async () => {
      if (move && typeof combat.update === "function") await combat.update({ turn: to }, { [MODULE_ID]: { interrupt: left ? "next" : "back" } });
      if (left) await combat.setFlag(MODULE_ID, INTERRUPT_FLAG, { ...left, turn: move ? to : left.turn });
      else await combat.unsetFlag(MODULE_ID, INTERRUPT_FLAG);
    };
    run().catch(() => {});
  },

  /** This client: announce each new interrupt once, keep the Sandevistan Time strip up, and let the screen and the carousel catch up. */
  sync(combat) {
    const flag = this.active(combat ?? undefined);
    if (flag && this._shown !== flag.stamp) {
      this._shown = flag.stamp;
      this.banner(flag);
    }
    if (!flag) this._shown = null;
    this.strip(flag);
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
  },

  /**
   * SANDEVISTAN TIME, for as long as it lasts: who is acting and who is still to act. This client
   * only; takes no clicks; follows "Chrome on my screen".
   */
  strip(flag) {
    if (typeof document === "undefined") return null;
    let el = document.getElementById(STRIP_ID);
    if (!flag || !Settings.get("fxScreen")) {
      el?.remove();
      return null;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = STRIP_ID;
      el.setAttribute("aria-hidden", "true");
      document.body.appendChild(el);
    }
    el.className = FX.reduced() ? "is-still" : "";
    const order = pendingOf(flag).map((q, i) => `<span class="${i ? "" : "is-acting"}">${esc(q.name)}</span>`).join('<i class="fa-solid fa-angle-right"></i>');
    el.innerHTML = `<b>${esc(L(`${LANG}.Interrupt.Time`))}</b><div>${order}</div>`;
    return el;
  },

  /** INTERRUPT across the screen, with who and whom. This client only; takes no clicks. */
  banner(flag) {
    if (typeof document === "undefined" || !Settings.get("fxScreen")) return null;
    document.getElementById(BANNER_ID)?.remove();
    const el = document.createElement("div");
    el.id = BANNER_ID;
    el.className = FX.reduced() ? "is-still" : "";
    const who = [...(flag.queue ?? [])].reverse().find((q) => !q.done) ?? flag;
    el.innerHTML = `<b>${esc(L(`${LANG}.Interrupt.Banner`))}</b><span>${L(`${LANG}.Interrupt.Title`, { name: esc(who.name), target: esc(flag.target) })}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("is-out"), 2600);
    setTimeout(() => el.remove(), 3400);
    return el;
  }
};
