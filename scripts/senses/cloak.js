import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { debounce, L, esc } from "../util.js";

/**
 * Cloaks against enhanced sight. Someone under Optical Camo, an FBC's Chameleon Coating or a
 * Ghostsuit (2070 Item Compendium: "from all sight, including LL/IR/UV, unless DV17
 * Perception") doesn't show in Low Light, Infrared or UV until whoever is looking beats that
 * DV17.
 *
 * The roll is the GM's secret. Nobody is asked for anything and nothing shows: when a token
 * with enhanced sight on gets a clear line to someone cloaked, the active GM's client rolls
 * that watcher's Perception itself, tells the GM alone how it went, and only on a success does
 * the cloaked token's outline appear on the watcher's screen. A watcher who fails sees exactly
 * what they'd see if nobody were there.
 *
 * Who has seen through whom is kept on the cloaked token (flag `seenThrough`: watcher token
 * ids), written by the GM, so every client agrees; it goes when the cloak does.
 */
export const CLOAK_DV = 17;
export const SEEN_FLAG = "seenThrough";
/** The conditions that are a cloak running. */
export const CLOAKS = ["chromeOpticalCamo", "chromeCloak"];
/** Perception against someone under Optical Camo is at −4 (its card). */
export const CAMO_PENALTY = -4;

/** Has a watcher's Perception seen through a cloak? It has to beat the DV. Pure. */
export const seesThrough = (total, dv = CLOAK_DV) => Number(total) > Number(dv);

/**
 * When a watcher gets another try at someone cloaked, pure: once a Round in a fight; out of
 * one, once, until the cloak comes off and goes on again (or the GM asks for another).
 * @returns {string} what the try is stamped with: a new stamp means a new try
 */
export const tryStamp = ({ combatId = null, round = 0, started = false } = {}) => (started && combatId ? `${combatId}:${round}` : "idle");

export const Cloak = {
  /** `${watcherTokenId}:${cloakedTokenId}` -> the stamp of the last try. The active GM's client. */
  tried: new Map(),

  get mode() {
    const m = Settings.get("cloakCheck");
    return ["auto", "gm", "off"].includes(m) ? m : "auto";
  },

  init() {
    const soon = debounce(() => this.sweep().catch((err) => console.error(`${MODULE_ID} | cloak`, err)), 400);
    for (const h of ["updateToken", "createActiveEffect", "deleteActiveEffect", "canvasReady", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    Hooks.on("updateCombat", (combat, changes) => ("round" in changes || "turn" in changes) && soon());
  },

  /** Is this character under a cloak now? */
  cloaked(actor) {
    return !!actor && CLOAKS.some((id) => Conditions.has(id, actor));
  },

  /** Has a watcher's token seen through a cloaked token's cloak? */
  seen(cloakedToken, watcherToken) {
    const doc = cloakedToken?.document ?? cloakedToken;
    return !!doc?.flags?.[MODULE_ID]?.[SEEN_FLAG]?.[watcherToken?.id];
  },

  /** Does a cloaked token stay out of a watcher's enhanced sight? Not cloaked: never. */
  hides(cloakedToken, watcherToken) {
    if (this.mode === "off" || !this.cloaked(cloakedToken?.actor)) return false;
    return !this.seen(cloakedToken, watcherToken);
  },

  /** A character's Perception before the die: INT + the Skill's level. */
  perception(actor) {
    const skill = [...(actor?.items ?? [])].find((i) => i.type === "skill" && /^perception$/i.test(i.name ?? ""));
    return CPR.stat(actor, "int") + (Number(skill?.system?.level) || 0);
  },

  _stamp() {
    const c = game.combat;
    return tryStamp({ combatId: c?.id, round: c?.round, started: !!c?.started });
  },

  /** Watchers (tokens with enhanced sight on) and the cloaked tokens each has a clear line to: [{ watcher, target }]. */
  async pairs() {
    const { Senses } = await import("./senses.js");
    const { readWall, clearSight } = await import("../arsenal/xray.js");
    const tokens = canvas?.tokens?.placeables ?? [];
    const walls = (canvas?.walls?.placeables ?? []).map((w) => readWall(w.document));
    const out = [];
    for (const w of tokens) {
      if (!w.actor || !Senses.vision(w)) continue;
      for (const t of tokens) {
        if (t === w || !t.actor || t.document?.hidden || !this.cloaked(t.actor)) continue;
        if (clearSight(w.center, t.center, walls)) out.push({ watcher: w, target: t });
      }
    }
    return out;
  },

  /**
   * The GM's client, quietly: every watcher with a clear line to someone cloaked gets their try
   * (if they haven't had this one), and cloaks that have come off are forgotten.
   */
  async sweep({ force = false, only = null } = {}) {
    if (!Compat.isActiveGM || !canvas?.ready || this.mode === "off") return [];
    // A cloak that's off: nobody has seen through it any more, and the next one is a fresh start.
    for (const t of canvas.tokens?.placeables ?? []) {
      if (t.document?.flags?.[MODULE_ID]?.[SEEN_FLAG] && !this.cloaked(t.actor)) {
        await t.document.update({ [`flags.${MODULE_ID}.-=${SEEN_FLAG}`]: null });
        for (const k of [...this.tried.keys()]) if (k.endsWith(`:${t.id}`)) this.tried.delete(k);
      }
    }
    if (this.mode !== "auto" && !force) return [];
    const stamp = this._stamp();
    const done = [];
    for (const { watcher, target } of await this.pairs()) {
      if (only && target !== only && watcher !== only) continue;
      const key = `${watcher.id}:${target.id}`;
      if (this.seen(target, watcher)) continue;
      if (!force && this.tried.get(key) === stamp) continue;
      this.tried.set(key, stamp);
      done.push(await this.check(watcher, target));
    }
    return done;
  },

  /** One watcher's secret try against one cloak: rolled here, told to the GM alone. */
  async check(watcher, target) {
    const camo = Conditions.has("chromeOpticalCamo", target.actor);
    const base = this.perception(watcher.actor) + (camo ? CAMO_PENALTY : 0);
    const { total: die } = await Conditions.roll("1d10", watcher.actor);
    const total = base + die;
    const through = seesThrough(total);
    if (through) await target.document.update({ [`flags.${MODULE_ID}.${SEEN_FLAG}.${watcher.id}`]: true });
    await Cards.post({
      actor: watcher.actor,
      kicker: L(`${LANG}.Cloak.Kicker`),
      title: L(`${LANG}.Cloak.Title`, { watcher: esc(watcher.name), target: esc(target.name) }),
      body: `<p>${L(`${LANG}.Cloak.${through ? "Through" : "Nothing"}`, { total, die, base, dv: CLOAK_DV })}${camo ? ` ${L(`${LANG}.Cloak.Camo`)}` : ""}</p><p class="ncm-ref">${L(`${LANG}.Cloak.Secret`)}</p>`,
      tone: through ? "yellow" : "cyan",
      whisper: Cards.gms(),
      buttons: through
        ? [{ action: "cloak-forget", label: L(`${LANG}.Cloak.Forget`), icon: "fa-solid fa-eye-slash", gm: true, data: { watcher: watcher.id, target: target.id } }]
        : [{ action: "cloak-again", label: L(`${LANG}.Cloak.Again`), icon: "fa-solid fa-dice-d10", gm: true, data: { watcher: watcher.id, target: target.id } }]
    });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return { watcher: watcher.id, target: target.id, total, through };
  },

  /** The GM asks for it: every watcher with a line to this cloaked token (or from this watcher) tries again now. */
  async ask(token = null) {
    if (!game.user?.isGM) return [];
    const done = await this.sweep({ force: true, only: token });
    if (!done.length) ui.notifications?.info(L(`${LANG}.Cloak.NoOne`));
    return done;
  },

  /** A GM's card button. */
  async click(message, btn) {
    if (!game.user?.isGM) return null;
    const d = btn.dataset;
    const watcher = canvas?.tokens?.get?.(d.watcher);
    const target = canvas?.tokens?.get?.(d.target);
    if (!watcher || !target) return null;
    btn.disabled = true;
    if (d.ncmAction === "cloak-forget") {
      await target.document.update({ [`flags.${MODULE_ID}.${SEEN_FLAG}.-=${watcher.id}`]: null });
      // They don't get it back for free: this try is spent.
      this.tried.set(`${watcher.id}:${target.id}`, this._stamp());
      Hooks.callAll(`${MODULE_ID}.fxChanged`);
      return false;
    }
    return this.check(watcher, target);
  }
};
