import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Conditions } from "../conditions/engine.js";
import { HOLD_FLAG, inReach, carriedTo, redirect } from "./hold-data.js";
import { L } from "../util.js";

/**
 * Holds at the table (see hold-data.js): Grab, carry, Human Shield, let go.
 *
 * - **Grab** (Action HUD, with the one you won the Brawling check against targeted and next to
 *   you): you're Grappling, they're Grappled, and their token is yours to carry.
 * - **Carry**: when the holder's token moves, the active GM's client moves the held token with
 *   it, where it was held. That move costs the held one none of its movement.
 * - **Human Shield** (Action HUD, while holding): the held one gets the Human Shield condition,
 *   and a ranged attack aimed at the holder is aimed at them instead; they can't dodge it.
 * - **Let go / Break free**: ends it and takes the conditions off.
 * The hold also ends by itself when the Grappled condition comes off the held one, or either
 * token leaves the scene.
 */
export const Hold = {
  get on() {
    return !!Settings.get("holds");
  },

  init() {
    Socket.on("holdGrab", (d) => this._grab(d));
    Socket.on("holdShield", (d) => this._shield(d));
    Socket.on("holdRelease", (d) => this._release(d));
    Hooks.on("updateToken", (doc, changed, options) => {
      this.onMove(doc, changed, options).catch((err) => console.error(`${MODULE_ID} | hold`, err));
    });
    Hooks.on("deleteToken", (doc) => {
      this.onGone(doc).catch((err) => console.error(`${MODULE_ID} | hold`, err));
    });
  },

  doc: (t) => t?.document ?? t ?? null,

  /** The hold a token is in, as the held one: { id, dx, dy, shield } or null. */
  heldBy(token) {
    const h = this.doc(token)?.flags?.[MODULE_ID]?.[HOLD_FLAG];
    return h?.id ? h : null;
  },

  /** The token (document) a holder has hold of, or null. */
  held(token) {
    const doc = this.doc(token);
    if (!doc?.id) return null;
    return [...(doc.parent?.tokens ?? [])].find((t) => t.flags?.[MODULE_ID]?.[HOLD_FLAG]?.id === doc.id) ?? null;
  },

  /** The token (document) held up as a Human Shield by this one, or null. */
  shieldOf(token) {
    const held = this.on ? this.held(token) : null;
    return held && this.heldBy(held)?.shield ? held : null;
  },

  ids: (token) => ({ scene: (token?.document ?? token)?.parent?.id, token: (token?.document ?? token)?.id }),

  /* ---------------------------------------- */
  /*  What a player asks for                  */
  /* ---------------------------------------- */

  async grab(holder, target) {
    if (!this.on || !holder || !target || this.doc(holder).id === this.doc(target).id) return null;
    if (this.held(holder) || this.heldBy(target)) return null;
    return Socket.request("holdGrab", { scene: this.doc(holder).parent?.id, holder: this.doc(holder).id, target: this.doc(target).id });
  },

  /** Hold the held one up as a Human Shield, or lower them (holder only). */
  async shield(holder, on = null) {
    const held = this.held(holder);
    if (!held) return null;
    return Socket.request("holdShield", { scene: held.parent?.id, held: held.id, on: on ?? !this.heldBy(held).shield });
  },

  /** End a hold: the holder lets go, or the held one breaks free. */
  async release(token) {
    const held = this.heldBy(token) ? this.doc(token) : this.held(token);
    if (!held) return null;
    return Socket.request("holdRelease", { scene: held.parent?.id, held: held.id });
  },

  /* ---------------------------------------- */
  /*  What the GM's client does               */
  /* ---------------------------------------- */

  _scene: (id) => game.scenes?.get?.(id) ?? canvas?.scene ?? null,

  async _grab({ scene, holder, target }) {
    const sc = this._scene(scene);
    const h = sc?.tokens?.get(holder);
    const t = sc?.tokens?.get(target);
    if (!h || !t) return false;
    await t.setFlag(MODULE_ID, HOLD_FLAG, { id: h.id, dx: t.x - h.x, dy: t.y - h.y, shield: false });
    if (h.actor) await Conditions.add(["grappling"], [h.actor]);
    if (t.actor) await Conditions.add(["grappled"], [t.actor]);
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return true;
  },

  async _shield({ scene, held, on }) {
    const t = this._scene(scene)?.tokens?.get(held);
    const hold = this.heldBy(t);
    if (!hold) return false;
    await t.setFlag(MODULE_ID, HOLD_FLAG, { ...hold, shield: !!on });
    if (t.actor) await (on ? Conditions.add(["humanShield"], [t.actor]) : Conditions.remove(["humanShield"], [t.actor]));
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return !!on;
  },

  async _release({ scene, held }, { conditions = true } = {}) {
    const sc = this._scene(scene);
    const t = sc?.tokens?.get(held);
    const hold = this.heldBy(t);
    if (!hold) return false;
    await t.unsetFlag(MODULE_ID, HOLD_FLAG);
    if (conditions) {
      const h = sc.tokens.get(hold.id);
      if (t.actor) await Conditions.remove(["grappled", "humanShield"], [t.actor]);
      if (h?.actor) await Conditions.remove(["grappling"], [h.actor]);
    }
    Hooks.callAll(`${MODULE_ID}.refreshUI`);
    return true;
  },

  /** A token moved: carry who it holds; a held one moved by hand is held where it was put. */
  async onMove(doc, changed, options = {}) {
    if (!this.on || !Compat.isActiveGM || !("x" in (changed ?? {}) || "y" in (changed ?? {}))) return;
    if (options?.[MODULE_ID]?.carried) return;
    const mine = this.heldBy(doc);
    if (mine) {
      const h = doc.parent?.tokens?.get(mine.id);
      if (h) await doc.setFlag(MODULE_ID, HOLD_FLAG, { ...mine, dx: doc.x - h.x, dy: doc.y - h.y });
    }
    const held = this.held(doc);
    if (!held) return;
    // The Grapple was ended on the sheet or the token: nothing left to carry.
    if (held.actor && !Conditions.has("grappled", held.actor)) {
      await this._release({ scene: doc.parent?.id, held: held.id });
      return;
    }
    const to = carriedTo(doc, this.heldBy(held));
    if (to.x === held.x && to.y === held.y) return;
    await held.update(to, { [MODULE_ID]: { free: true, carried: true }, ...(options?.animate === false ? { animate: false } : {}) });
  },

  async onGone(doc) {
    if (!Compat.isActiveGM) return;
    const held = this.held(doc);
    if (held) await this._release({ scene: doc.parent?.id, held: held.id });
    const mine = this.heldBy(doc);
    const h = mine ? doc.parent?.tokens?.get(mine.id) : null;
    if (h?.actor) await Conditions.remove(["grappling"], [h.actor]);
  },

  /* ---------------------------------------- */
  /*  Attacks                                 */
  /* ---------------------------------------- */

  /**
   * The tokens a ranged attack really goes at: anyone behind a Human Shield is swapped for the
   * shield, on the attacker's own targets too (so the damage lands there).
   * @returns {{ targets: Token[], swapped: { holder: string, shield: string }[] }} (names)
   */
  retarget(targets = [], { ranged = true } = {}) {
    if (!this.on || !ranged || !targets.length) return { targets, swapped: [] };
    const shields = {};
    for (const t of targets) {
      const s = this.shieldOf(t);
      if (s) shields[this.doc(t).id] = s.id;
    }
    if (!Object.keys(shields).length) return { targets, swapped: [] };
    const byId = (id) => targets.find((t) => this.doc(t).id === id) ?? canvas?.tokens?.get?.(id) ?? null;
    const r = redirect(targets.map((t) => this.doc(t).id), shields);
    const swapped = [];
    for (const s of r.swapped) {
      const holder = byId(s.holder);
      const shield = byId(s.shield);
      if (!shield) continue;
      try {
        holder?.setTarget?.(false, { releaseOthers: false });
        shield.setTarget?.(true, { releaseOthers: false });
      } catch {
        /* the card still says who takes it */
      }
      swapped.push({ holder: holder?.name ?? "", shield: shield.name ?? "" });
    }
    return { targets: r.ids.map(byId).filter(Boolean), swapped };
  },

  /** Held up as a shield: no dodging what's shot at you. */
  cantDodge(actor) {
    return this.on && !!actor && Conditions.has("humanShield", actor);
  },

  /* ---------------------------------------- */
  /*  The Action HUD                          */
  /* ---------------------------------------- */

  entries(actor, token) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    if (!this.on || !tok) return [];
    const held = this.held(tok);
    if (held) {
      const shield = !!this.heldBy(held).shield;
      return [
        { key: "hold:shield", label: L(`${LANG}.Hold.Shield`), sub: held.name, icon: "fa-solid fa-user-shield", on: shield, alert: shield },
        { key: "hold:release", label: L(`${LANG}.Hold.LetGo`), sub: held.name, icon: "fa-solid fa-hand" }
      ];
    }
    const mine = this.heldBy(tok);
    if (mine) return [{ key: "hold:release", label: L(`${LANG}.Hold.BreakFree`), sub: L(`${LANG}.Hold.AfterCheck`), icon: "fa-solid fa-link-slash" }];
    const targets = [...(game.user?.targets ?? [])].filter((t) => t.id !== tok.id);
    if (targets.length !== 1 || !tok.center || !targets[0].center) return [];
    const t = targets[0];
    const near = inReach(Compat.measure(tok.center, t.center), canvas?.dimensions?.distance) && (Number(tok.document?.elevation) || 0) === (Number(t.document?.elevation) || 0);
    if (!near || this.heldBy(t) || this.held(t)) return [];
    return [{ key: "hold:grab", label: L(`${LANG}.Hold.Grab`, { name: t.name }), sub: L(`${LANG}.Hold.AfterCheck`), icon: "fa-solid fa-hand-fist" }];
  },

  async run(actor, id, { token = null } = {}) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    if (!tok) return null;
    if (id === "grab") {
      const t = [...(game.user?.targets ?? [])].find((x) => x.id !== tok.id);
      return t ? this.grab(tok, t) : null;
    }
    if (id === "shield") return this.shield(tok);
    if (id === "release") return this.release(tok);
    return null;
  }
};
