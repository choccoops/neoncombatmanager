import { LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { L, esc } from "../util.js";
import { NCM_ID } from "./phone.js";

/** How long the screen holds, in ms (the CSS animation runs as long). */
export const NO_SIGNAL_MS = 3200;

/**
 * "No signal": as a player's view lands in a Night City Messenger dead zone (a scene changes, or
 * the GM kills the signal where they are), the screen glitches, the signal bars drop one by one,
 * "NO SIGNAL" holds a moment, and it all fades away. Night City Messenger plays its own sound; this
 * is only the picture. Players only (the GM moves between scenes all evening), and each player can
 * turn it off.
 */
export const NoSignal = {
  /** Whether the scene this client is viewing was dead, last we looked (undefined: not yet). */
  dead: undefined,

  init() {
    Hooks.on("canvasReady", (canvas) => this.check(canvas?.scene));
    Hooks.on("updateScene", (scene, changes) => {
      if (scene.id !== globalThis.canvas?.scene?.id || changes?.flags?.[NCM_ID] === undefined) return;
      this.check(scene);
    });
  },

  /** Is a scene one of Night City Messenger's dead zones? */
  isDead(scene) {
    return !!game.modules.get(NCM_ID)?.active && !!scene?.flags?.[NCM_ID]?.deadZone;
  },

  /** The viewed scene may have changed: play when signal goes from some to none. */
  check(scene) {
    const dead = this.isDead(scene);
    const was = this.dead;
    this.dead = dead;
    if (dead && !was && !game.user?.isGM && Settings.get("noSignalFx")) this.play(scene);
    return dead && !was;
  },

  /** Play it (anyone can, from the API, to see it). */
  play(scene = globalThis.canvas?.scene) {
    if (typeof document === "undefined") return null;
    document.getElementById("ncm-no-signal")?.remove();
    const place = scene?.navName || scene?.name || "";
    const el = document.createElement("div");
    el.id = "ncm-no-signal";
    el.className = "neon-combat ncm-no-signal";
    el.setAttribute("role", "status");
    el.innerHTML = `<div class="ncm-ns-static"></div>
      <div class="ncm-ns-plate">
        <div class="ncm-ns-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <div class="ncm-ns-title" data-text="${esc(L(`${LANG}.Holocall.NoSignalFx.Title`))}">${esc(L(`${LANG}.Holocall.NoSignalFx.Title`))}</div>
        <div class="ncm-ns-sub">// ${esc(place ? L(`${LANG}.Holocall.NoSignalFx.SubAt`, { place }) : L(`${LANG}.Holocall.NoSignalFx.Sub`))}</div>
      </div>`;
    document.body.append(el);
    setTimeout(() => el.remove(), NO_SIGNAL_MS + 100);
    return el;
  }
};
