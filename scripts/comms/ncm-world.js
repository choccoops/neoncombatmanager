import { MODULE_ID } from "../constants.js";
import { Settings } from "../settings.js";
import { Hub } from "../hub/hub.js";
import { deadAt } from "../hub/geo.js";
import { debounce } from "../util.js";
import { NCM_ID } from "./phone.js";
import { SPAM_2070, CORPS_2070, DISTRICTS_2070 } from "./spam-2070.js";

/* -------------------------------------------- */
/*  Spam                                        */
/* -------------------------------------------- */

/**
 * What Night City Messenger's spam pool should hold: "2070" (ours only), "mix" (both), or "off"
 * (its own, set in 2045). Pure (tests use it).
 * @param {{ templates, corps, districts }} own - its own pools, as shipped
 */
export function spamPools(own, mode = "2070") {
  if (mode === "off") return { templates: [...own.templates], corps: [...own.corps], districts: [...own.districts] };
  if (mode === "mix") {
    return {
      templates: [...own.templates, ...SPAM_2070],
      corps: [...new Set([...own.corps, ...CORPS_2070])],
      districts: [...new Set([...DISTRICTS_2070, ...own.districts])]
    };
  }
  return { templates: [...SPAM_2070], corps: [...CORPS_2070], districts: [...DISTRICTS_2070] };
}

/** Swap an array's contents in place (its importers keep the same array). */
const fill = (arr, items) => arr.splice(0, arr.length, ...items);

/**
 * Night City Messenger's built-in spam is set in 2045 and has no setting to change it, so this
 * swaps its pools for 2070 ones in place: the template list and the {{randomCorpo}} and
 * {{randomDistrict}} names it draws from. Its own templates are kept to put back. The GM's custom
 * templates aren't touched.
 */
export const NcmSpam = {
  mod: null,
  own: null,

  /** NCM's spam-templates.js, the same module instance NCM imported (by its own script's URL). */
  async load() {
    const script = [...document.querySelectorAll("script[src]")].find((s) => /\/night-city-messenger\/scripts\/main\.js/.test(s.src));
    const base = script?.src ?? new URL(`${globalThis.ROUTE_PREFIX ? `/${globalThis.ROUTE_PREFIX}` : ""}/modules/${NCM_ID}/scripts/main.js`, location.origin).href;
    return import(new URL("./data/spam-templates.js", base).href);
  },

  async apply() {
    if (!game.modules.get(NCM_ID)?.active) return false;
    try {
      this.mod ??= await this.load();
    } catch (err) {
      console.warn(`${MODULE_ID} | couldn't reach Night City Messenger's spam templates`, err);
      return false;
    }
    const m = this.mod;
    if (!Array.isArray(m?.BUILTIN_SPAM_TEMPLATES) || !Array.isArray(m.RANDOM_CORPOS) || !Array.isArray(m.RANDOM_DISTRICTS)) return false;
    this.own ??= { templates: [...m.BUILTIN_SPAM_TEMPLATES], corps: [...m.RANDOM_CORPOS], districts: [...m.RANDOM_DISTRICTS] };
    const pools = spamPools(this.own, Settings.get("ncmSpam"));
    fill(m.BUILTIN_SPAM_TEMPLATES, pools.templates);
    fill(m.RANDOM_CORPOS, pools.corps);
    fill(m.RANDOM_DISTRICTS, pools.districts);
    // A copy of the file loaded from another address wouldn't be the one NCM reads: say so.
    const live = game.nightcity?.spamService?.getTemplates?.();
    if (Array.isArray(live) && Settings.get("ncmSpam") !== "off" && !live.some((t) => String(t.id).startsWith("ncm2070-"))) {
      console.warn(`${MODULE_ID} | Night City Messenger's spam didn't take the 2070 templates (its scripts load from somewhere unexpected)`);
      return false;
    }
    return true;
  }
};

/* -------------------------------------------- */
/*  Dead zones                                  */
/* -------------------------------------------- */

/**
 * Which scenes should be Night City Messenger dead zones: the scenes the city map's places open
 * into (their doorways), where the place stands on dead ground. Pure (tests use it).
 * @param {{ x, y, scene }[]} doors - each place with a doorway: where it is, the scene it opens into
 * @returns {Map<string, boolean>} sceneId -> dead (dead if any place opening into it is)
 */
export function deadScenes(doors, { extra = [] } = {}) {
  const out = new Map();
  for (const d of doors) {
    if (!d?.scene || !Number.isFinite(d.x) || !Number.isFinite(d.y)) continue;
    out.set(d.scene, (out.get(d.scene) ?? false) || deadAt(d.x, d.y, { extra }));
  }
  return out;
}

/**
 * The map's dead ground carried into Night City Messenger: a scene a place on dead ground opens
 * into (Utility Code 9+, or a district in "More dead zones") becomes one of NCM's dead zones, so
 * no messages or calls in or out while you're there. This module marks the scenes it switched,
 * and only ever switches those back: a dead zone the GM set in NCM is left alone, and a scene the
 * GM switched back on by hand stays on until its place changes.
 */
export const SceneSignal = {
  get on() {
    return !!Settings.get("hubSignal") && !!Settings.get("hubSignalScenes") && !!game.modules.get(NCM_ID)?.active;
  },

  /** What should be dead now. */
  plan() {
    if (!this.on) return new Map();
    const notes = Hub.state.notes ?? {};
    const doors = Object.entries(notes)
      .filter(([, n]) => n?.scene)
      .map(([key, n]) => ({ ...(Hub.place(key) ?? {}), scene: n.scene }));
    return deadScenes(doors, { extra: Settings.list("hubDeadZones") });
  },

  /** GM: bring every scene in line with the map. */
  async sync() {
    if (!game.user?.isGM || !game.modules.get(NCM_ID)?.active) return [];
    const plan = this.plan();
    const changed = [];
    for (const scene of game.scenes ?? []) {
      const want = plan.get(scene.id) ?? false;
      const ours = !!scene.flags?.[MODULE_ID]?.ncmDead;
      const dead = !!scene.flags?.[NCM_ID]?.deadZone;
      if (want && !ours && !dead) {
        await this.setDead(scene, true);
        await scene.update({ [`flags.${MODULE_ID}.ncmDead`]: true });
        changed.push([scene.id, true]);
      } else if (!want && ours) {
        if (dead) await this.setDead(scene, false);
        await scene.update({ [`flags.${MODULE_ID}.-=ncmDead`]: null });
        changed.push([scene.id, false]);
      }
    }
    return changed;
  },

  /** Through NCM's own switch (it tells everyone viewing the scene), else its scene flag. */
  async setDead(scene, dead) {
    const toggle = game.nightcity?.messenger?.toggleDeadZone;
    if (typeof toggle === "function") {
      const r = await toggle(scene.id, dead);
      if (r?.success !== false) return;
    }
    await scene.update({ [`flags.${NCM_ID}.deadZone`]: dead });
  },

  init() {
    const later = debounce(() => this.sync().catch((err) => console.error(`${MODULE_ID} | dead zones`, err)), 500);
    this._later = later;
    Hooks.on(`${MODULE_ID}.hubChanged`, later);
    Hooks.on(`${MODULE_ID}.signalChanged`, later);
  }
};
