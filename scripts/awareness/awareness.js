import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Cards } from "../combat/cards.js";
import { ABILITIES, keyOf, normalize, check, same, abilityEffect, assignMode } from "./rules.js";
import { L, esc } from "../util.js";

/**
 * Combat Awareness at the table: read a Solo's points off their Cyberpunk RED role item, and
 * write a new split back (the system applies the bonuses). In a combat under way it's the
 * Solo's Action for the Turn: a card says so and their carousel card shows it spent.
 */
export const Awareness = {
  init() {
    game.keybindings.register(MODULE_ID, "openAwareness", {
      name: `${LANG}.Awareness.Title`,
      hint: `${LANG}.Awareness.KeyHint`,
      editable: [],
      onDown: () => {
        this.open();
        return true;
      }
    });
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-awareness", title: `${LANG}.Awareness.Title`, icon: "fa-solid fa-crosshairs", order: 111, onClick: () => this.open() }
    ]));
    // "/awareness" (or "/ca") opens the window.
    Hooks.on("chatMessage", (log, message) => {
      if (!/^\/(awareness|ca)\s*$/i.test(String(message ?? ""))) return true;
      this.open();
      return false;
    });
    const refresh = () => this.app?.rendered && this.app.render();
    for (const h of ["updateItem", "updateCombat", "updateCombatant", "createCombatant", "deleteCombat"]) Hooks.on(h, refresh);
  },

  /** The open Combat Awareness window, if any. */
  app: null,

  async open(actor = null) {
    const { AwarenessApp } = await import("./awareness-app.js");
    this.app = AwarenessApp.open(actor);
    return this.app;
  },

  /** The Solo role item (the one whose Role Ability is Combat Awareness). */
  role(actor) {
    return (actor?.items ?? []).find((i) => i.type === "role" && String(i.system?.mainRoleAbility ?? "").toLowerCase() === "combat awareness") ?? null;
  },

  isSolo(actor) {
    return !!this.role(actor);
  },

  rank(actor) {
    return Number(this.role(actor)?.system?.rank) || 0;
  },

  /** The points as they stand: { initiativeReaction: 2, ... }. */
  current(actor) {
    const alloc = {};
    for (const ab of this.role(actor)?.system?.abilities ?? []) {
      const key = keyOf(ab.name);
      if (key) alloc[key] = Number(ab.rank) || 0;
    }
    return normalize(alloc);
  },

  /** The actor's combatant in the current combat, if any. */
  combatant(actor, combat = game.combat) {
    return combat?.combatants?.find((c) => c.actor === actor || (c.actorId === actor?.id && c.token?.actorLink)) ?? null;
  },

  /** What reassigning costs right now: "free", "action", "wait" (not their Turn) or "gm". */
  mode(actor, combat = game.combat) {
    const cb = this.combatant(actor, combat);
    return assignMode({
      inCombat: !!cb && !!combat?.started,
      rolled: cb?.initiative !== null && cb?.initiative !== undefined,
      myTurn: !!cb && combat?.combatant?.id === cb.id,
      gm: game.user.isGM
    });
  },

  /** Has this Solo already spent this Round's Action on it? */
  spent(actor, combat = game.combat) {
    const cb = this.combatant(actor, combat);
    const f = cb?.flags?.[MODULE_ID]?.awareness;
    return !!f && !!combat?.started && f.round === combat.round;
  },

  /** One line per ability with points: "Precision Attack 6 (+2 to attacks)". */
  lines(alloc) {
    const a = normalize(alloc);
    return ABILITIES.filter(({ key }) => a[key] > 0).map(({ key, name }) => ({ key, name, points: a[key], effect: this.effectText(key, a[key]) }));
  },

  effectText(key, points) {
    const e = abilityEffect(key, points);
    if (!e && key !== "fumbleRecovery") return L(`${LANG}.Awareness.Effect.${Number(points) > 0 ? "notYet" : "none"}`);
    if (key === "fumbleRecovery") return L(`${LANG}.Awareness.Effect.${e ? "fumbleRecoveryOn" : "fumbleRecoveryOff"}`);
    return L(`${LANG}.Awareness.Effect.${key}`, { n: e });
  },

  /** Short summary for tooltips: "Init +2 · Precision +1 · Spot +1". */
  summary(actor) {
    const lines = this.lines(this.current(actor));
    return lines.length ? lines.map((l) => `${l.name} ${l.points}`).join(" · ") : L(`${LANG}.Awareness.Unassigned`);
  },

  /**
   * Assign the points.
   * @param {Actor} actor - a Solo
   * @param {object} alloc - points by ability key
   * @returns {Promise<"free"|"action"|"gm"|null>} how it went in, or null when nothing changed
   */
  async assign(actor, alloc, combat = game.combat) {
    const role = this.role(actor);
    if (!role) throw new Error(L(`${LANG}.Awareness.NotSolo`, { name: actor?.name ?? "" }));
    if (!actor.isOwner) throw new Error(L(`${LANG}.Error.NotOwner`));
    const next = normalize(alloc);
    const c = check(next, this.rank(actor));
    if (!c.ok) throw new Error(L(`${LANG}.Awareness.TooMany`, { total: c.total, rank: this.rank(actor) }));
    const mode = this.mode(actor, combat);
    if (mode === "wait") throw new Error(L(`${LANG}.Awareness.NotYourTurn`, { name: actor.name }));
    const before = this.current(actor);
    if (same(before, next)) return null;

    const abilities = (role.toObject().system.abilities ?? []).map((ab) => {
      const key = keyOf(ab.name);
      return key ? { ...ab, rank: next[key] } : ab;
    });
    await role.update({ "system.abilities": abilities });

    const cb = this.combatant(actor, combat);
    if (mode === "action" && cb?.isOwner) await cb.setFlag(MODULE_ID, "awareness", { round: combat.round, turn: combat.turn });
    await this.card(actor, next, mode);
    Hooks.callAll(`${MODULE_ID}.awarenessAssigned`, actor, next, mode);
    return mode;
  },

  card(actor, alloc, mode) {
    const lines = this.lines(alloc);
    const list = lines.length
      ? `<ul class="ncm-ca-list">${lines.map((l) => `<li><b>${esc(l.name)}</b> <span>${l.points}</span> <em>${esc(l.effect)}</em></li>`).join("")}</ul>`
      : `<p>${L(`${LANG}.Awareness.Unassigned`)}</p>`;
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Awareness.Mode.${mode}`),
      title: L(`${LANG}.Awareness.Assigned`, { name: esc(actor.name) }),
      img: actor.img,
      body: list,
      tone: mode === "action" ? "pink" : "cyan"
    });
  }
};
