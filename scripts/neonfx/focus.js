import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { debounce } from "../util.js";
import { Core } from "./core.js";

/**
 * "Chrome looks only on tokens I've selected" (each user's own setting, off by default). A GM
 * runs many tokens at once: a Sandevistan here, a Kerenzikov there, each with its look, all on
 * screen together. With this on, this client shows running chrome's looks (the persistent look,
 * the Sandevistan's afterimages, its motion) only on the tokens it has selected. Nothing changes
 * for anyone else: the effects are still there, this client just doesn't draw them.
 */

/** The looks this covers: running chrome. Conditions and Cyberpsychosis always show. */
export const FOCUS_KEYS = ["sandevistan", "berserk", "kerenzikov"];

/** Is a look left undrawn here? Pure. */
export const focusHides = ({ enabled = false, key = null, controlled = false } = {}) => !!enabled && FOCUS_KEYS.includes(key) && !controlled;

export const Focus = {
  /** Sequencer effects this client is keeping undrawn. */
  _hidden: new Set(),
  _ticking: false,

  get enabled() {
    return !!Settings.get("fxFocus");
  },

  init() {
    const soon = debounce(() => this.apply(), 60);
    this.soon = soon;
    for (const h of ["controlToken", "canvasReady", "createSequencerEffect", "endedSequencerEffect", "sequencerEffectManagerReady", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
  },

  /** Does this client leave a token's look of a kind undrawn? */
  hides(token, key) {
    return focusHides({ enabled: this.enabled, key, controlled: !!token?.controlled });
  },

  /** Go through the scene's chrome looks: draw the selected tokens', leave the rest. */
  apply() {
    if (!Core.sequencer || !canvas?.ready) return 0;
    const keep = new Set();
    for (const token of canvas.tokens?.placeables ?? []) {
      for (const e of Sequencer.EffectManager.getEffects({ object: token }) ?? []) {
        const key = Core.keyOf(e?.data?.name, token);
        if (key && this.hides(token, key)) keep.add(e);
      }
    }
    for (const e of this._hidden) {
      if (keep.has(e)) continue;
      this._hidden.delete(e);
      if (!e.destroyed) e.renderable = true;
    }
    for (const e of keep) {
      this._hidden.add(e);
      e.renderable = false;
    }
    this._tick();
    return this._hidden.size;
  },

  /**
   * Sequencer sets an effect's own visibility as it goes (a token's, a fade): hold ours each
   * frame, after it, for as long as anything is hidden.
   */
  _tick() {
    const ticker = canvas?.app?.ticker;
    if (!ticker) return;
    if (this._hidden.size && !this._ticking) {
      this._ticking = true;
      this._fn = () => {
        for (const e of this._hidden) {
          if (e.destroyed) this._hidden.delete(e);
          else if (e.renderable) e.renderable = false;
        }
        if (!this._hidden.size) this._tick();
      };
      ticker.add(this._fn, this, typeof PIXI !== "undefined" ? PIXI.UPDATE_PRIORITY.LOW : -25);
    } else if (!this._hidden.size && this._ticking) {
      this._ticking = false;
      ticker.remove(this._fn, this);
    }
  }
};
