import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { FX } from "../fx.js";
import { Conditions } from "../conditions/engine.js";
import { debounce } from "../util.js";
import { Chrome, CHROME_TINT } from "./chrome.js";
import { KERENZIKOV } from "./switches.js";

/**
 * What running chrome does to its owner's view. While your character's Sandevistan or Berserk
 * runs, your screen (and nobody else's) shows it: the world drained and edged in the Operating
 * System's colour with streaks at the rim for a Sandevistan; a red, beating rim for Berserk. A
 * Kerenzikov, always on, cools the picture very slightly, as if everything else ran a touch slow.
 * It's a layer over the map that never takes a click and hides nothing; each player can switch it
 * off (and it holds still for anyone who asked for reduced motion).
 */
export const SCREEN_ID = "ncm-screen-fx";
/** Strongest first: what shows when several run at once. */
export const SCREEN_ORDER = ["berserk", "sandevistan", "kerenzikov"];

const hex = (n) => `#${Number(n).toString(16).padStart(6, "0")}`;

/**
 * The look for a client, pure: { kind, tint } or null.
 * @param {object[]} mine - this user's characters in play: [{ sandevistan, berserk, kerenzikov }], each
 *   the running Operating System's key, true, or falsy
 */
export function screenLook(mine = [], { enabled = true } = {}) {
  if (!enabled) return null;
  for (const kind of SCREEN_ORDER) {
    const hit = mine.find((m) => m?.[kind]);
    if (hit) return { kind, tint: hex(CHROME_TINT[typeof hit[kind] === "string" ? hit[kind] : kind] ?? CHROME_TINT[kind]) };
  }
  return null;
}

/**
 * Whose eyes this client looks through, pure: the user's own character, and the tokens they have
 * selected and own. A GM owns every token, so an NPC shows on the GM's screen while (and only
 * while) its token is selected.
 */
export function viewpoints({ character = null, controlled = [], isGM = false } = {}) {
  const out = new Map();
  if (character) out.set(character.id, character);
  for (const a of controlled) if (a && (isGM || a.isOwner)) out.set(a.id, a);
  return [...out.values()];
}

export const Screen = {
  init() {
    const soon = debounce(() => this.refresh(), 120);
    for (const h of ["createActiveEffect", "deleteActiveEffect", "updateActiveEffect", "controlToken", "canvasReady", `${MODULE_ID}.fxChanged`, `${MODULE_ID}.refreshUI`]) Hooks.on(h, () => soon());
  },

  /** What this client's characters have running. */
  state() {
    const actors = viewpoints({
      character: game.user?.character ?? null,
      controlled: (canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean),
      isGM: !!game.user?.isGM
    });
    return actors.map((a) => {
      const run = (kind) => {
        const c = Chrome.running(a, kind);
        return c ? (c.chrome?.os ?? true) : false;
      };
      return { sandevistan: run("sandevistan"), berserk: run("berserk"), kerenzikov: Conditions.has(KERENZIKOV, a) };
    });
  },

  look() {
    return screenLook(this.state(), { enabled: !!Settings.get("fxScreen") && !!Settings.get("fxEnabled") && Chrome.on });
  },

  /** Put the layer up, change it or take it down (this client only). */
  refresh() {
    if (typeof document === "undefined") return null;
    const look = this.look();
    let el = document.getElementById(SCREEN_ID);
    if (!look) {
      el?.remove();
      return null;
    }
    if (!el) {
      el = document.createElement("div");
      el.id = SCREEN_ID;
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = '<div class="ncm-screen-tone"></div><div class="ncm-screen-rim"></div><div class="ncm-screen-streaks"></div>';
      document.body.append(el);
    }
    el.dataset.kind = look.kind;
    el.style.setProperty("--ncm-screen-tint", look.tint);
    el.classList.toggle("still", !Settings.get("fxMotion") || FX.reduced());
    return look;
  }
};
