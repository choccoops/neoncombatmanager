import { MODULE_ID, FLAGS, HOOKS, NEON_HUB_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { clockTime, formatElapsed, L, esc } from "../util.js";

/**
 * Combat time: a Cyberpunk RED Round is about 3 seconds (core p.126, p.168), so each new Round
 * moves Foundry's world time on by that much.
 *
 * Foundry does the moving itself: Combat#nextRound/previousRound pass CONFIG.time.roundTime
 * (plus CONFIG.time.turnTime for each Turn skipped) to the server as a world time change, so
 * setting CONFIG.time from this module's settings is all it takes. Everything that runs on world
 * time follows: SmallTime's clock and its darkness, Neon Hub's calendars (which change day at
 * midnight), timed conditions here, Neon At Home's EMP and malfunction timers.
 *
 * As a safety net the active GM checks that the world time really moved after a new Round, and
 * moves it if nothing did (another module's combat class, an older core).
 */
export const CombatTime = {
  /** World time changes seen recently: [{ delta, at }]. */
  _recent: [],
  _pending: new Map(),

  init() {
    this.apply();
    Hooks.on(`${MODULE_ID}.timeConfig`, () => this.apply());
    Hooks.on("updateWorldTime", (worldTime, delta) => this._seen(delta));
    Hooks.on("updateCombat", (combat, changed, options) => this._check(combat, changed, options));
  },

  get roundSeconds() {
    return Math.max(0, Number(Settings.get("roundSeconds")) || 0);
  },

  get turnSeconds() {
    return Math.max(0, Number(Settings.get("turnSeconds")) || 0);
  },

  /** Make Foundry's combat clock Cyberpunk RED's. */
  apply() {
    if (!CONFIG.time) return;
    CONFIG.time.roundTime = this.roundSeconds;
    CONFIG.time.turnTime = this.turnSeconds;
  },

  /** Rounds in a span of seconds (1 minute = 20 Rounds). */
  toRounds(seconds) {
    return this.roundSeconds ? Math.ceil((Number(seconds) || 0) / this.roundSeconds) : 0;
  },

  toSeconds(rounds) {
    return (Number(rounds) || 0) * this.roundSeconds;
  },

  /** Seconds since a combat began (world time), or from its Round count. */
  elapsed(combat) {
    if (!combat?.started) return 0;
    const start = combat.getFlag?.(MODULE_ID, FLAGS.started);
    if (Number.isFinite(start)) return Math.max(0, game.time.worldTime - start);
    return Math.max(0, (combat.round - 1) * this.roundSeconds);
  },

  /** The time of day: Neon Hub's (SmallTime's) clock when installed, else world time. */
  clock() {
    const hub = game.modules.get(NEON_HUB_ID);
    try {
      if (hub?.active && typeof hub.api?.time === "function") return hub.api.time().time;
    } catch {
      /* fall back */
    }
    return clockTime(game.time.worldTime);
  },

  /** The combat's start, stamped by the active GM when it begins. */
  async stampStart(combat) {
    if (!Compat.isActiveGM || !combat?.started || Number.isFinite(combat.getFlag(MODULE_ID, FLAGS.started))) return;
    // The first Round's time hasn't passed yet: it started now.
    await combat.setFlag(MODULE_ID, FLAGS.started, game.time.worldTime);
  },

  _seen(delta) {
    const now = Date.now();
    this._recent = this._recent.filter((r) => now - r.at < 5000);
    this._recent.push({ delta: Number(delta) || 0, at: now });
    for (const [key, p] of this._pending) {
      if (p.delta === Number(delta)) {
        clearTimeout(p.timer);
        this._pending.delete(key);
      }
    }
  },

  /** After a Round changes: did world time move? If not, move it (active GM). */
  _check(combat, changed, options) {
    if (!Compat.isActiveGM || !("round" in (changed ?? {}))) return;
    // Round changes from next/previous Round carry the world time change; starting a combat doesn't.
    const delta = Number(options?.worldTime?.delta);
    if (!Number.isFinite(delta) || !delta) return;
    Hooks.callAll(HOOKS.roundTime, combat, delta);
    const now = Date.now();
    const seen = this._recent.findIndex((r) => r.delta === delta && now - r.at < 4000);
    if (seen >= 0) {
      this._recent.splice(seen, 1);
      return;
    }
    const key = `${combat.id}.${combat.round}`;
    clearTimeout(this._pending.get(key)?.timer);
    const timer = setTimeout(() => {
      this._pending.delete(key);
      console.warn(`${MODULE_ID} | Round ${combat.round} didn't move world time; moving it ${delta}s`);
      game.time.advance(delta);
    }, 3000);
    this._pending.set(key, { delta, timer });
  },

  /** Combat ended: post how long it took in the world (active GM, setting). */
  async summary(combat) {
    if (!Compat.isActiveGM || !Settings.get("combatSummary") || !combat?.started) return;
    const seconds = this.elapsed(combat);
    const { Cards } = await import("./cards.js");
    await Cards.post({
      kicker: L(`${LANG}.Card.CombatOverKicker`),
      title: L(`${LANG}.Card.CombatOver`, { rounds: combat.round }),
      body: `<p>${L(`${LANG}.Card.CombatOverBody`, { elapsed: formatElapsed(seconds), clock: esc(this.clock()) })}</p>`,
      tone: "cyan",
      whisper: null
    });
  }
};
