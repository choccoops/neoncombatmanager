import { MODULE_ID } from "./constants.js";

/**
 * Small screen effects shared by the hub and the holocall windows: typed-out text, the reduced-
 * motion check every animation respects, and a per-browser memory of the places a player has
 * opened (so new ones can ping).
 */
export const FX = {
  /** Has the viewer asked their system for less motion? */
  reduced() {
    try {
      return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  },

  /**
   * Type text into an element a few characters at a time, with a blinking cursor while it runs.
   * Reduced motion (or no element) sets it at once.
   * @returns {() => void} stop: finishes the text now
   */
  typeOut(el, text, { speed = 14, cursor = true } = {}) {
    const full = String(text ?? "");
    if (!el) return () => null;
    if (this.reduced() || !full) {
      el.textContent = full;
      return () => null;
    }
    let i = 0;
    let timer = null;
    const caret = cursor ? document.createElement("span") : null;
    if (caret) caret.className = "ncm-fx-cursor";
    const step = () => {
      if (!el.isConnected) return;
      // Bigger bites for long texts, so nothing takes more than a few seconds.
      i = Math.min(full.length, i + Math.max(1, Math.ceil(full.length / 220)));
      el.textContent = full.slice(0, i);
      if (caret) el.appendChild(caret);
      if (i < full.length) timer = setTimeout(step, speed);
      else setTimeout(() => caret?.remove(), 1200);
    };
    step();
    return () => {
      clearTimeout(timer);
      el.textContent = full;
    };
  },

  /** Restart a CSS animation class on an element. */
  replay(el, cls) {
    if (!el || this.reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  },

  /* ---------------------------------------- */
  /*  Places this player has opened           */
  /* ---------------------------------------- */

  _key() {
    return `${MODULE_ID}.hubOpened.${game.world?.id ?? "world"}`;
  },

  opened() {
    try {
      return new Set(JSON.parse(localStorage.getItem(this._key()) ?? "[]"));
    } catch {
      return new Set();
    }
  },

  markOpened(key) {
    try {
      const set = this.opened();
      if (set.has(key)) return false;
      set.add(key);
      localStorage.setItem(this._key(), JSON.stringify([...set]));
      return true;
    } catch {
      return false;
    }
  }
};
