import { MODULE_ID, LANG, FLAGS } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Registry } from "../conditions/registry.js";
import { CombatTime } from "./time.js";
import { formatElapsed, L, esc } from "../util.js";

/**
 * Small touches to Foundry's own windows: the sidebar combat tracker gets each combatant's
 * Wound State and the combat clock; Scene configuration gets this module's weather mode; the
 * token HUD leaves out conditions the automation places.
 */
export const TrackerHooks = {
  init() {
    Hooks.on("renderCombatTracker", (app, html) => this.tracker(app, html));
    Hooks.on("renderSceneConfig", (app, html) => this.sceneConfig(app, html));
    Hooks.on("renderTokenHUD", (hud, html) => this.tokenHud(hud, html));
  },

  tracker(app, html) {
    if (!Settings.get("enhanceTracker")) return;
    const root = Compat.element(html);
    const combat = app.viewed ?? game.combat;
    if (!root || !combat) return;
    const header = root.querySelector(".combat-tracker-header, header.combat-tracker-header, .encounter-controls");
    if (header && combat.started && !header.querySelector(".ncm-tracker-clock")) {
      const clock = document.createElement("div");
      clock.className = "ncm-tracker-clock";
      clock.innerHTML = `<i class="fa-regular fa-clock"></i> ${L(`${LANG}.Tracker.Clock`, { elapsed: formatElapsed(CombatTime.elapsed(combat)), seconds: CombatTime.roundSeconds, clock: esc(CombatTime.clock()) })}`;
      header.append(clock);
    }
    for (const li of root.querySelectorAll("[data-combatant-id]")) {
      const cb = combat.combatants.get(li.dataset.combatantId);
      const actor = cb?.actor;
      if (!actor || !CPR.isMeat(actor) || li.querySelector(".ncm-wound")) continue;
      const friendly = actor.hasPlayerOwner || cb.isOwner || game.user.isGM;
      if (!friendly && Settings.get("npcHealth") === "hidden") continue;
      const wound = CPR.woundState(actor);
      const badge = document.createElement("span");
      badge.className = `ncm-wound wound-${wound}`;
      badge.textContent = L(`${LANG}.WoundShort.${wound}`);
      badge.dataset.tooltip = L(`${LANG}.Wound.${wound}`);
      const name = li.querySelector(".token-name h4, .token-name .name, .name");
      (name ?? li).append(badge);
    }
  },

  /** A weather mode select on the Scene's Ambience/Lighting tab. */
  sceneConfig(app, html) {
    const root = Compat.element(html);
    const scene = app.document ?? app.object;
    if (!root || !scene || root.querySelector(".ncm-scene-weather")) return;
    const tab = root.querySelector('.tab[data-tab="ambience"]') ?? root.querySelector('.tab[data-tab="lighting"]') ?? root.querySelector(".tab[data-tab=environment]");
    if (!tab) return;
    const value = scene.getFlag(MODULE_ID, FLAGS.weather) ?? "default";
    const opts = ["default", "outdoor", "indoor", "off"].map((v) => `<option value="${v}" ${v === value ? "selected" : ""}>${L(`${LANG}.SceneWeather.${v}`)}</option>`).join("");
    const group = document.createElement("div");
    group.className = "form-group ncm-scene-weather";
    group.innerHTML = `<label>${L(`${LANG}.SceneWeather.Label`)}</label><div class="form-fields"><select name="flags.${MODULE_ID}.${FLAGS.weather}">${opts}</select></div><p class="hint">${L(`${LANG}.SceneWeather.Hint`)}</p>`;
    tab.append(group);
    app.setPosition?.({ height: "auto" });
  },

  /** Keep automation-only conditions (weather, visibility, Wound States) out of the HUD palette. */
  tokenHud(hud, html) {
    const root = Compat.element(html);
    if (!root) return;
    for (const icon of root.querySelectorAll(".status-effects [data-status-id]")) {
      const c = Registry.get(icon.dataset.statusId);
      if (c && c.hud === false && !icon.classList.contains("active")) icon.remove();
    }
  }
};
