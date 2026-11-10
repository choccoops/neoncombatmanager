/**
 * One clock for an attack's picture and sound. Automated Animations takes a moment between the
 * roll's card and its first frame (finding the entry, loading the clip), and that moment varies:
 * sounds and hits timed from the card would run ahead of the shot. So what's timed against the
 * shot waits here until AA says it has started (its aa.animationStart hook).
 *
 * - seen(token): AA has taken up an attack by this token (it will start, or be stopped)
 * - started(token): AA's first frame
 * - when(token, fn): run fn(true) at AA's start; fn(false) if AA never takes it up (after `grace`)
 *   or never starts (after `limit`)
 */
export const Sync = {
  flows: new Map(),
  /** Injected in tests. */
  timers: { set: (fn, ms) => setTimeout(fn, ms), clear: (id) => clearTimeout(id), now: () => Date.now() },

  flow(tokenId) {
    if (!this.flows.has(tokenId)) this.flows.set(tokenId, { seen: 0, started: 0, waiters: new Set() });
    return this.flows.get(tokenId);
  },

  seen(tokenId) {
    if (!tokenId) return;
    this.flow(tokenId).seen = this.timers.now();
  },

  /** AA was stopped for this attack (Neon Arsenal draws it itself): nothing to wait for. */
  dropped(tokenId) {
    if (!tokenId) return;
    const f = this.flow(tokenId);
    f.seen = 0;
    for (const w of [...f.waiters]) w.fire(false);
  },

  started(tokenId) {
    if (!tokenId) return;
    const f = this.flow(tokenId);
    f.started = this.timers.now();
    for (const w of [...f.waiters]) w.fire(true);
  },

  /**
   * @param {string} tokenId - the attacker's token
   * @param {(started: boolean) => void} fn
   * @param {object} [o] - grace: how long to wait for AA to take the attack up; limit: for its start
   */
  when(tokenId, fn, { grace = 300, limit = 3000 } = {}) {
    if (!tokenId) return fn(false);
    const f = this.flow(tokenId);
    const now = this.timers.now();
    // The card came second: AA has just started this attack (and hasn't taken up another since).
    if (f.started > f.seen && now - f.started < 250) return fn(true);
    const w = {
      done: false,
      timer: null,
      fire: (started) => {
        if (w.done) return;
        w.done = true;
        this.timers.clear(w.timer);
        f.waiters.delete(w);
        try {
          fn(started);
        } catch (err) {
          console.error("cpr-neon-combat-manager | attack timing", err);
        }
      }
    };
    f.waiters.add(w);
    // Taken up, and not yet started: an attack AA is still getting ready.
    const taken = () => f.seen > f.started && this.timers.now() - f.seen < 2000;
    if (taken()) w.timer = this.timers.set(() => w.fire(false), limit);
    else {
      w.timer = this.timers.set(() => {
        if (!taken()) return w.fire(false);
        w.timer = this.timers.set(() => w.fire(false), Math.max(0, limit - grace));
      }, grace);
    }
    return w;
  }
};
