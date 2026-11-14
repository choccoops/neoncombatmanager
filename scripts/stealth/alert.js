import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { Compat } from "../compat.js";
import { FX } from "../fx.js";
import { Conditions } from "../conditions/engine.js";
import { Ladder } from "../roller/ladder.js";
import { Core } from "../neonfx/core.js";
import { C } from "../neonfx/recipes.js";
import { L, esc, debounce } from "../util.js";
import * as Rules from "./alert-rules.js";

const OUT = ["dead", "unconscious", "sleep"];
const MANAGED = "ladder";
const TIMER_ID = "ncm-alert-timer";
const BANNER_ID = "ncm-alert-banner";

/**
 * The Awareness Ladder on the map (2070 Core Rules ch.06).
 *
 * - Each enemy in the encounter carries the Ladder's step as a Neon Condition (an Active Effect
 *   with a status icon), placed and removed by the GM's client as the Ladder moves.
 * - Reaching Alert: a mark jumps over each enemy, the screen flashes ALERT with a quiet sting,
 *   and a countdown to the security response being called appears for everyone. It runs on the
 *   game clock (Rounds in a fight or stealth segment), and the GM can wave it away.
 * - The Alert is kept until something is done about it: with every enemy dead or out before the
 *   response is called, it clears. At zero the response is called and the Alert stays.
 *
 * The Alert lives on the combat (flags[MODULE].alert), written by the active GM; every client
 * draws from it.
 */
export const Alert = {
  /** combat id -> Ladder level as the GM's client last saw it. */
  _levels: new Map(),
  /** combat id -> { id, called } of the Alert this client last showed. */
  _shown: new Map(),
  _tween: null,

  init() {
    const check = debounce(() => this.check(), 150);
    Hooks.on("updateCombat", (combat, changed) => {
      const flags = changed?.flags?.[MODULE_ID] ?? {};
      const keys = Object.keys(foundry.utils.flattenObject(changed ?? {}));
      const touched = (name) => name in flags || keys.some((k) => k.includes(`flags.${MODULE_ID}.${name}`) || k.includes(`flags.${MODULE_ID}.-=${name}`));
      if (touched("ladder")) this._onLadder(combat).catch((err) => console.error(`${MODULE_ID} | awareness`, err));
      if (touched("alert")) this._onAlert(combat);
      if ("round" in (changed ?? {}) || "turn" in (changed ?? {})) {
        check();
        this.render();
      }
    });
    Hooks.on("updateWorldTime", () => {
      check();
      this.render();
    });
    Hooks.on("deleteCombat", (combat) => {
      this._levels.delete(combat.id);
      this._shown.delete(combat.id);
      if (Compat.isActiveGM) this._strip(combat).catch((err) => console.error(`${MODULE_ID} | awareness`, err));
      this.render();
    });
    // An enemy going down (or getting back up) can end an Alert, and changes who carries it.
    for (const h of ["createActiveEffect", "deleteActiveEffect", "updateCombatant", "createCombatant", "deleteCombatant"]) Hooks.on(h, () => check());
    Hooks.on(`${MODULE_ID}.refreshUI`, () => this.render());
    Hooks.on(`${MODULE_ID}.awarenessChanged`, () => check());
  },

  ready() {
    for (const combat of game.combats ?? []) {
      this._levels.set(combat.id, Ladder.level(combat));
      const a = this.of(combat);
      if (a) this._shown.set(combat.id, { id: a.id, called: !!a.called });
    }
    this.render();
  },

  get on() {
    return !!Settings.get("awarenessLadder");
  },

  get tokenMode() {
    const m = Settings.get("awarenessTokens");
    return Rules.TOKEN_MODES.includes(m) ? m : "alert";
  },

  of(combat) {
    return combat?.flags?.[MODULE_ID]?.alert ?? null;
  },

  now(combat) {
    return { time: game.time.worldTime, round: combat?.round ?? 0, roundSeconds: Number(Settings.get("roundSeconds")) || 0 };
  },

  /* ---------------------------------------- */
  /*  Who's who                               */
  /* ---------------------------------------- */

  /** The encounter's enemies: [{ cb, actor, out }]. */
  enemies(combat) {
    const list = [];
    for (const cb of combat?.combatants ?? []) {
      const actor = cb.actor;
      if (!actor || actor.hasPlayerOwner) continue;
      list.push({ cb, actor, out: !!cb.defeated || OUT.some((id) => Conditions.has(id, actor)) });
    }
    return list;
  },

  tally(combat) {
    return Rules.tally(this.enemies(combat).map((e) => ({ player: false, defeated: false, out: e.out })));
  },

  /* ---------------------------------------- */
  /*  The GM's side                           */
  /* ---------------------------------------- */

  /** The Ladder moved: the enemies' conditions follow; climbing to Alert starts one, dropping below ends it. */
  async _onLadder(combat) {
    const level = Ladder.level(combat);
    const was = this._levels.get(combat.id) ?? "unaware";
    this._levels.set(combat.id, level);
    if (!this.on) return;
    // Below what the tokens show, the GM still gets a mark over each enemy.
    if (level !== was && game.user.isGM && !Rules.conditionAt(level, this.tokenMode) && level !== "unaware") this.mark(combat, level, [game.user.id]);
    if (!Compat.isActiveGM) return;
    await this.syncConditions(combat);
    if (Rules.raised(was, level) && !this.of(combat)) {
      await combat.setFlag(MODULE_ID, "alert", Rules.startAlert(this.now(combat), Number(Settings.get("alertTimer")) || 0));
    } else if (!Rules.isAlert(level) && this.of(combat)) await combat.unsetFlag(MODULE_ID, "alert");
  },

  /** combat id -> the sync under way. */
  _syncing: new Map(),

  /**
   * Each enemy still up carries the Ladder's step as a condition (by the setting); the rest lose
   * it. One at a time for a combat: the Ladder moving, the mode switching and the clock all ask
   * for this, and two at once each found no condition yet and each placed one (they stacked).
   */
  syncConditions(combat) {
    const id = combat?.id ?? "";
    const next = (this._syncing.get(id) ?? Promise.resolve()).then(() => this._syncConditions(combat)).catch((err) => console.error(`${MODULE_ID} | awareness`, err));
    this._syncing.set(id, next);
    next.then(() => {
      if (this._syncing.get(id) === next) this._syncing.delete(id);
    });
    return next;
  },

  async _syncConditions(combat) {
    const level = this.on ? Ladder.level(combat) : "unaware";
    const want = Rules.conditionAt(level, this.tokenMode);
    const all = Object.values(Rules.AWARE_CONDITIONS);
    for (const { actor, out } of this.enemies(combat)) {
      const mine = !out ? want : null;
      const drop = all.filter((id) => id !== mine && Conditions.effects(actor, id).some((e) => e.getFlag?.(MODULE_ID, "managed") === MANAGED));
      if (drop.length) await Conditions.remove(drop, actor, { managed: MANAGED });
      if (mine && !Conditions.has(mine, actor)) await Conditions.add(mine, actor, { managed: MANAGED });
      // Any that did stack (an older version, two GMs): one stays.
      const twins = mine ? Conditions.effects(actor, mine).filter((e) => e.getFlag?.(MODULE_ID, "managed") === MANAGED).slice(1) : [];
      if (twins.length && actor.isOwner) await actor.deleteEmbeddedDocuments("ActiveEffect", twins.map((e) => e.id));
    }
  },

  async _strip(combat) {
    for (const { actor } of this.enemies(combat)) await Conditions.remove(Object.values(Rules.AWARE_CONDITIONS), actor, { managed: MANAGED });
  },

  /** Has the Alert come to something: every enemy down (it clears), or the countdown at zero (the response is called)? */
  async check() {
    if (!Compat.isActiveGM || !this.on) return;
    for (const combat of game.combats ?? []) {
      if (!combat.started) continue;
      await this.syncConditions(combat);
      const alert = this.of(combat);
      if (!alert) continue;
      const { enemies, awake } = this.tally(combat);
      const what = Rules.outcome(alert, { enemies, awake, left: Rules.remaining(alert, this.now(combat)), clears: !!Settings.get("alertClears") });
      if (what === "clear") await this.clear(combat);
      else if (what === "call") await this.call(combat);
    }
  },

  /** Nobody left to raise the alarm: the Ladder goes back down and the Alert ends. */
  async clear(combat) {
    const { Cards } = await import("../combat/cards.js");
    await Ladder.set(combat, "unaware");
    await Cards.post({ kicker: L(`${LANG}.Alert.Kicker`), title: L(`${LANG}.Alert.Card.Cleared`), body: `<p>${L(`${LANG}.Alert.Card.ClearedBody`)}</p>`, tone: "cyan" });
  },

  /** The countdown ran out: the response is called. The Alert stays. */
  async call(combat) {
    const { Cards } = await import("../combat/cards.js");
    await combat.setFlag(MODULE_ID, "alert", { ...this.of(combat), called: true });
    await Cards.post({ kicker: L(`${LANG}.Alert.Kicker`), title: L(`${LANG}.Alert.Card.Called`), body: `<p>${L(`${LANG}.Alert.Card.CalledBody`)}</p>`, tone: "red", whisper: Cards.gms() });
  },

  /** GM: wave the countdown away (the Alert stays; no response is called by the clock). */
  async dismiss(combat = game.combat) {
    const alert = this.of(combat);
    if (!game.user.isGM || !alert) return;
    await combat.setFlag(MODULE_ID, "alert", { ...alert, dismissed: true });
  },

  /** GM: start the countdown again from now (something new set them off), for `rounds` Rounds. */
  async restart(combat = game.combat, rounds = Number(Settings.get("alertTimer")) || 0) {
    if (!game.user.isGM || !combat || !Rules.isAlert(Ladder.level(combat))) return;
    const fresh = Rules.startAlert(this.now(combat), rounds);
    // The same Alert, its clock wound back: no second banner.
    await combat.setFlag(MODULE_ID, "alert", { ...fresh, id: this.of(combat)?.id ?? fresh.id });
  },

  /* ---------------------------------------- */
  /*  Every client                            */
  /* ---------------------------------------- */

  /** The combat's Alert changed: a new one flashes and sounds, a called one says so, one that ended stands down. */
  _onAlert(combat) {
    const alert = this.of(combat);
    const shown = this._shown.get(combat.id) ?? null;
    if (alert && (!shown || shown.id !== alert.id)) {
      this._shown.set(combat.id, { id: alert.id, called: !!alert.called });
      this.banner("alert");
      Core.sound("alertSting");
      this.mark(combat, Ladder.level(combat));
    } else if (alert && alert.called && !shown?.called) {
      this._shown.set(combat.id, { id: alert.id, called: true });
      this.banner("called");
      Core.sound("alertResponse");
    } else if (!alert && shown) {
      this._shown.delete(combat.id);
      if (!shown.called) {
        this.banner("clear");
        Core.sound("alertClear");
      }
    }
    this.render();
  },

  /** A mark jumping over each enemy still up: "!" at Alert, "?" below. For everyone, or only `users`. */
  mark(combat, level, users = null) {
    if (!Core.on || !Settings.get("fxConditions") || !canvas?.ready) return;
    const text = Rules.isAlert(level) ? (level === "spotted" ? "!!" : "!") : "?";
    const colour = Rules.isAlert(level) ? "#ff1744" : "#ffb300";
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    let any = false;
    for (const { actor, out } of this.enemies(combat)) {
      if (out) continue;
      for (const token of Core.tokensOf(actor)) {
        if (!token.visible) continue;
        const gs = canvas.grid.size;
        const e = seq.effect().atLocation(token, { offset: { y: -0.75 * gs } }).locally()
          .text(text, { fill: colour, fontFamily: "Orbitron, Signika, sans-serif", fontSize: Math.round(gs * 0.7), fontWeight: "900", stroke: "#07070b", strokeThickness: 6 })
          .animateProperty("sprite", "position.y", { from: gs * 0.35, to: 0, duration: 180, ease: "easeOutBack" })
          .animateProperty("sprite", "scale.x", { from: 0.4, to: 1, duration: 180, ease: "easeOutBack" })
          .animateProperty("sprite", "scale.y", { from: 0.4, to: 1, duration: 180, ease: "easeOutBack" })
          .fadeOut(350).duration(1500);
        if (users) e.forUsers(users);
        if (Rules.isAlert(level)) {
          seq.effect().atLocation(token).locally().file(`modules/${MODULE_ID}/assets/fx/img/ring-pulse.webp`).scaleToObject(1).tint(C.red)
            .animateProperty("spriteContainer", "scale.x", { from: 0.6, to: 2.4, duration: 600 })
            .animateProperty("spriteContainer", "scale.y", { from: 0.6, to: 2.4, duration: 600 })
            .fadeOut(420).duration(600);
        }
        any = true;
      }
    }
    if (any) seq.play();
    return any;
  },

  /** The words across the screen: ALERT, RESPONSE CALLED, ALERT CLEARED. This client only. */
  banner(kind) {
    if (typeof document === "undefined" || !Settings.get("alertBanner")) return null;
    document.getElementById(BANNER_ID)?.remove();
    const el = document.createElement("div");
    el.id = BANNER_ID;
    el.className = `ncm-alert-banner is-${kind}${FX.reduced() ? " is-still" : ""}`;
    el.innerHTML = `<span class="ncm-alert-mark">${kind === "clear" ? "" : "!"}</span><b>${esc(L(`${LANG}.Alert.Banner.${kind}`))}</b>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add("is-out"), 2200);
    setTimeout(() => el.remove(), 3000);
    return el;
  },

  /** The combat whose Alert this client shows: the one being viewed, if it has one. */
  current() {
    const combat = game.combat;
    return combat?.started && this.of(combat) ? combat : null;
  },

  /** What the timer shows now: null with nothing to show. */
  context(combat = this.current()) {
    const alert = this.of(combat);
    if (!alert || !this.on || !Rules.isAlert(Ladder.level(combat))) return null;
    const left = Rules.remaining(alert, this.now(combat));
    const ticking = Rules.ticking(alert);
    if (!ticking && !alert.called) return null;
    return {
      called: !!alert.called,
      ticking,
      left,
      total: alert.total,
      share: alert.total ? left / alert.total : 0,
      clock: Rules.clock(left),
      label: L(`${LANG}.Alert.${alert.called ? "Called" : "Label"}`),
      hint: L(`${LANG}.Alert.${alert.called ? "CalledHint" : "Hint"}`),
      gm: game.user.isGM
    };
  },

  /** Draw (or take away) the countdown. */
  render() {
    if (typeof document === "undefined") return;
    const ctx = Settings.get("alertBanner") ? this.context() : null;
    let el = document.getElementById(TIMER_ID);
    if (!ctx) {
      el?.remove();
      this._last = null;
      return;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = TIMER_ID;
      el.innerHTML = `<div class="ncm-alert-head"><span class="ncm-alert-label"></span><button type="button" class="ncm-alert-x" aria-label="×"><i class="fa-solid fa-xmark"></i></button></div><div class="ncm-alert-clock"></div><div class="ncm-alert-bar"><i></i></div>`;
      el.querySelector(".ncm-alert-x").addEventListener("click", () => this.dismiss().catch((err) => ui.notifications?.error(err.message)));
      document.body.appendChild(el);
    }
    el.classList.toggle("is-called", ctx.called);
    el.classList.toggle("is-low", ctx.ticking && ctx.share <= 0.25);
    el.dataset.tooltip = ctx.hint;
    el.querySelector(".ncm-alert-label").textContent = ctx.label;
    const x = el.querySelector(".ncm-alert-x");
    x.hidden = !ctx.gm || ctx.called;
    x.dataset.tooltip = L(`${LANG}.Alert.Dismiss`);
    el.querySelector(".ncm-alert-bar i").style.width = `${Math.round(ctx.share * 1000) / 10}%`;
    this._count(el.querySelector(".ncm-alert-clock"), ctx);
  },

  /** Run the counter down to its new value (the clock moves a Round at a time; the digits spin between). */
  _count(node, ctx) {
    if (this._tween) cancelAnimationFrame(this._tween);
    const from = this._last ?? ctx.left;
    this._last = ctx.left;
    if (ctx.called) {
      node.textContent = Rules.clock(0);
      return;
    }
    if (FX.reduced() || from === ctx.left || typeof requestAnimationFrame !== "function") {
      node.textContent = ctx.clock;
      return;
    }
    const start = performance.now();
    const life = 700;
    const step = (t) => {
      const k = Math.min(1, (t - start) / life);
      node.textContent = Rules.clock(from + (ctx.left - from) * k);
      this._tween = k < 1 ? requestAnimationFrame(step) : null;
    };
    this._tween = requestAnimationFrame(step);
  }
};
