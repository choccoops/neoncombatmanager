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
 * when you Held your Action to do it. The module doesn't move the turn for you; it makes the
 * moment plain to the whole table: a banner, a card, a mark on the carousel, and time standing
 * still on every screen that isn't in Sandevistan time (scripts/neonfx/screen.js) until the next
 * Turn begins. The interrupt lives on the combat (flag `interrupt`), so a client that joins late
 * sees it and nothing outlasts the Turn it happened in.
 */
export const INTERRUPT_FLAG = "interrupt";
const BANNER_ID = "ncm-interrupt-banner";
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

/** Is an interrupt still the one happening: same combat Round and Turn it was made in? */
export function interruptLive(flag, { round = 0, turn = 0, started = false } = {}) {
  return !!flag && started && flag.round === round && flag.turn === turn;
}

export const Interrupt = {
  _shown: null,

  init() {
    Hooks.on("updateCombat", (combat, changes) => {
      // The next Turn: the interrupt is over (the active GM clears it; every client stops showing it at once).
      if (("turn" in changes || "round" in changes) && Compat.isActiveGM && combat.getFlag?.(MODULE_ID, INTERRUPT_FLAG)) {
        combat.unsetFlag(MODULE_ID, INTERRUPT_FLAG).catch(() => {});
      }
      this.sync(combat);
    });
    Hooks.on("deleteCombat", () => this.sync(null));
    Hooks.on("deleteActiveEffect", () => this.dropIfOver());
  },

  /** The interrupt happening now in the combat this client is looking at, or null. */
  active(combat = game.combat) {
    const flag = combat?.flags?.[MODULE_ID]?.[INTERRUPT_FLAG] ?? null;
    return interruptLive(flag, { round: combat?.round, turn: combat?.turn, started: !!combat?.started }) ? flag : null;
  },

  /**
   * The Apogee has just been switched on (the active GM's client, after its Initiative moved):
   * if that interrupts the Turn under way, say so on the combat.
   */
  async check(actor) {
    const combat = game.combat;
    if (!combat?.started || !Compat.isActiveGM) return null;
    const mine = [...(combat.combatants ?? [])].find((cb) => cb.actor === actor || cb.actorId === actor?.id);
    const now = combat.combatant;
    if (!mine || !now) return null;
    const by = interruptBy({ ownTurn: now.id === mine.id, held: Conditions.has(HELD, actor), initiative: mine.initiative, current: now.initiative });
    if (!by) return null;
    const flag = { combatantId: mine.id, actorId: actor.id, name: mine.name ?? actor.name, target: now.name ?? "", by, round: combat.round, turn: combat.turn, at: Date.now() };
    await combat.setFlag(MODULE_ID, INTERRUPT_FLAG, flag);
    await Cards.post({ actor, kicker: L(`${LANG}.Interrupt.Kicker`), title: L(`${LANG}.Interrupt.Title`, { name: esc(flag.name), target: esc(flag.target) }), tone: "yellow", body: `<p>${L(`${LANG}.Interrupt.Body.${by}`)}</p>` });
    return flag;
  },

  /** The Sandevistan went off before the Turn ended: the world moves again. */
  dropIfOver() {
    const combat = game.combat;
    const flag = combat?.flags?.[MODULE_ID]?.[INTERRUPT_FLAG];
    if (!flag || !Compat.isActiveGM) return;
    const actor = game.actors?.get(flag.actorId) ?? [...(combat.combatants ?? [])].find((cb) => cb.id === flag.combatantId)?.actor;
    if (actor && Conditions.active(actor).some((c) => c.chrome?.kind === "sandevistan")) return;
    combat.unsetFlag(MODULE_ID, INTERRUPT_FLAG).catch(() => {});
  },

  /** This client: announce a new interrupt once, and let the screen and the carousel catch up. */
  sync(combat) {
    const flag = this.active(combat ?? undefined);
    if (flag && this._shown !== flag.at) {
      this._shown = flag.at;
      this.banner(flag);
    }
    if (!flag) this._shown = null;
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
  },

  /** INTERRUPT across the screen, with who and whom. This client only; takes no clicks. */
  banner(flag) {
    if (typeof document === "undefined" || !Settings.get("fxScreen")) return null;
    document.getElementById(BANNER_ID)?.remove();
    const el = document.createElement("div");
    el.id = BANNER_ID;
    el.className = FX.reduced() ? "is-still" : "";
    el.innerHTML = `<b>${esc(L(`${LANG}.Interrupt.Banner`))}</b><span>${L(`${LANG}.Interrupt.Title`, { name: esc(flag.name), target: esc(flag.target) })}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("is-out"), 2600);
    setTimeout(() => el.remove(), 3400);
    return el;
  }
};
