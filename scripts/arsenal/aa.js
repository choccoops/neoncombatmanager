import { MODULE_ID, LANG, SYSTEM_ID, DF_LIGHTS_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { classify, profileKeys, NO_FLASH } from "./kinds.js";
import { ROWS, buildMenu, mergeSection, isOurs, isUuidv4, uuidv4, AUTOREC_VERSION, rowFor, lookOf, hitOf, hitSize } from "./profile.js";
import { flightFor, contactFor, squaresBetween, BLOOM_LEAD } from "./timing.js";
import { Sync } from "./sync.js";
import { Core } from "../neonfx/core.js";
import { Rebuilds, traitsOf } from "./rebuilds.js";
import { DIWAKO_ID } from "./dv.js";
import { Shots } from "./shots.js";
import { Blast } from "./blast.js";
import { L } from "../util.js";

export const AA_ID = "autoanimations";
const MENUS = ["melee", "range", "ontoken", "templatefx", "aura", "preset", "aefx"];
/** Diwako's muzzle flash colour, and ours for a Tech gun's magnetic flash. */
const DIWAKO_FLASH = "#943400";
const TECH_FLASH = "#2a9dff";

/** The ammo loaded in a weapon, as CPR 0.92 keeps it (installed items), else older fields. */
export function loadedAmmo(weapon, actor = weapon?.actor) {
  try {
    const [ammo] = weapon?.getInstalledItems?.("ammo") ?? [];
    if (ammo) return ammo;
  } catch {
    /* not loadable */
  }
  const s = weapon?.system ?? {};
  for (const id of s.installedItems?.list ?? []) {
    const it = actor?.items?.get(id);
    if (it?.type === "ammo") return it;
  }
  const legacy = String(s.magazine?.ammoId || s.magazine?.ammoData?.uuid || "").split(".").at(-1);
  const it = legacy ? actor?.items?.get(legacy) : null;
  return it?.type === "ammo" ? it : null;
}

/**
 * Automated Animations, for Cyberpunk RED in the 2070s. The profile (scripts/arsenal/profile.js)
 * is installed into AA's Global Automatic Recognition menu; at each attack, Neon Arsenal picks its
 * entry from what the weapon is rather than its name, the way the CPR fork of AA reads the ammo
 * (installed items, CPR 0.92), and hands AA the fire mode and whether it hit.
 */
export const AA = {
  /** When this client last sent a Tech shot, so the GM's flash for it can be tinted. */
  tech: 0,

  get active() {
    return !!game.modules.get(AA_ID)?.active;
  },

  init() {
    Hooks.on("AutomatedAnimations-WorkflowStart", (data, animation) => {
      try {
        this.onWorkflowStart(data, animation);
      } catch (err) {
        console.error(`${MODULE_ID} | Automated Animations`, err);
      }
    });
    // AA's first frame for an attack: what's timed against the shot starts counting here.
    Hooks.on("aa.animationStart", (source) => Sync.started(source?.id ?? source?.document?.id ?? null));
    Socket.on("event:arsenalFlash", (data) => this.flashAsGM(data));
    Socket.on("event:arsenalReload", (data, from) => this.reloadAsked(from));
    // Diwako's muzzle flash is an Active Light the GM creates; a Tech gun's flashes blue.
    Hooks.on("preCreateAmbientLight", (doc, data) => {
      if (!this.tech || Date.now() - this.tech > 2500) return;
      if (data.config?.color === DIWAKO_FLASH && data.flags?.[DF_LIGHTS_ID]?.anims) doc.updateSource({ "config.color": TECH_FLASH });
    });
  },

  /* ---------------------------------------- */
  /*  The profile                             */
  /* ---------------------------------------- */

  get patreon() {
    return !!game.modules.get("jb2a_patreon")?.active;
  },

  menus() {
    const out = {};
    for (const m of MENUS) {
      try {
        out[m] = game.settings.get(AA_ID, `aaAutorec-${m}`) ?? [];
      } catch {
        out[m] = [];
      }
    }
    return out;
  },

  /**
   * Which of our entries AA has: { count, version, whole } (version: our module's when installed;
   * whole: every entry is there, each with an id AA's menu keeps).
   */
  installed() {
    const ours = Object.values(this.menus()).flat().filter(isOurs);
    const whole = ours.length === ROWS.length && ours.every((e) => isUuidv4(e.id));
    return { count: ours.length, version: ours[0]?.metaData?.moduleVersion ?? null, whole };
  },

  /**
   * Put Neon Arsenal's entries into AA's menus (GM). The world's own entries stay; ours are
   * replaced with the current ones, for the JB2A pack installed (free or Patreon).
   */
  async install({ quiet = false } = {}) {
    if (!this.active || !game.user.isGM) return false;
    const version = game.modules.get(MODULE_ID)?.version ?? "";
    const menu = buildMenu({ patreon: this.patreon, sounds: false, hits: false, id: uuidv4, version });
    const current = this.menus();
    // Entries with ids AA's menu won't take stopped AA's start-up on every client that loaded them.
    const broken = Object.values(current).flat().filter(isOurs).some((e) => !isUuidv4(e.id));
    for (const m of ["melee", "range"]) await game.settings.set(AA_ID, `aaAutorec-${m}`, mergeSection(current[m], menu[m]));
    try {
      const meta = game.settings.get(AA_ID, "aaAutorec");
      if (!meta?.version) await game.settings.set(AA_ID, "aaAutorec", { ...(meta ?? {}), version: AUTOREC_VERSION });
    } catch {
      /* AA keeps its own version */
    }
    await Settings.set("arsenalProfile", version);
    if (!quiet) ui.notifications.info(L(`${LANG}.Arsenal.Installed`, { count: menu.melee.length + menu.range.length, pack: this.patreon ? "JB2A Patreon" : "JB2A" }));
    if (broken && !quiet) await this.askReload();
    return true;
  },

  /**
   * After a repair (GM): Automated Animations stopped loading partway on every client that loaded
   * the old entries, and won't start again until it reloads. Reload everyone, just this client, or later.
   */
  async askReload() {
    const choice = await Compat.DialogV2.wait({
      window: { title: L(`${LANG}.Arsenal.Reload.Title`) },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<p>${L(`${LANG}.Arsenal.Reload.Body`)}</p>`,
      buttons: [
        { action: "all", label: L(`${LANG}.Arsenal.Reload.All`), icon: "fa-solid fa-rotate", default: true },
        { action: "me", label: L(`${LANG}.Arsenal.Reload.Me`) },
        { action: "later", label: L(`${LANG}.Arsenal.Reload.Later`) }
      ],
      rejectClose: false
    });
    if (choice === "all") Socket.broadcast("arsenalReload", {});
    if (choice === "all" || choice === "me") this.reload();
    return choice ?? null;
  },

  /** A player, when the GM asks everyone to reload: their choice, not a forced reload. */
  async reloadAsked(from) {
    if (!game.users?.get(from)?.isGM) return null;
    const ok = await Compat.DialogV2.wait({
      window: { title: L(`${LANG}.Arsenal.Reload.Title`) },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<p>${L(`${LANG}.Arsenal.Reload.PlayerBody`)}</p>`,
      buttons: [
        { action: "reload", label: L(`${LANG}.Arsenal.Reload.Now`), icon: "fa-solid fa-rotate", default: true },
        { action: "later", label: L(`${LANG}.Arsenal.Reload.Later`) }
      ],
      rejectClose: false
    });
    if (ok === "reload") this.reload();
    return ok ?? null;
  },

  reload() {
    globalThis.location?.reload();
  },

  /** Take our entries out of AA's menus (GM). */
  async uninstall() {
    if (!this.active || !game.user.isGM) return false;
    const current = this.menus();
    for (const m of ["melee", "range"]) await game.settings.set(AA_ID, `aaAutorec-${m}`, mergeSection(current[m], []));
    await Settings.set("arsenalProfile", "");
    return true;
  },

  /** The menu as AA exports it, for a world without this module (sounds included, low). */
  exportJson() {
    const version = game.modules.get(MODULE_ID)?.version ?? "";
    const menu = buildMenu({ patreon: this.patreon, sounds: true, version });
    const save = foundry.utils.saveDataToFile ?? globalThis.saveDataToFile;
    save(JSON.stringify(menu, null, 2), "text/json", `neon-arsenal-autorec${this.patreon ? "-patreon" : ""}.json`);
  },

  /**
   * When the GM loads the world, a few seconds in (once AA has loaded its own menus): if Neon
   * Arsenal's animations aren't in AA's menu, or are from an older version, offer to put them in.
   */
  ready(delay = 4000) {
    if (!this.active || !Compat.isActiveGM || !Settings.get("arsenalAutoInstall")) return null;
    return new Promise((resolve) => setTimeout(() => this.offer().then(resolve, (err) => {
      console.error(`${MODULE_ID} | Automated Animations profile`, err);
      resolve(null);
    }), delay));
  },

  /** Does AA's menu hold this version's whole profile? */
  current() {
    const version = game.modules.get(MODULE_ID)?.version ?? "";
    const { whole, version: have } = this.installed();
    return whole && have === version;
  },

  /** Ask the GM: Install now, Not now (asked again next time), Don't ask again. */
  async offer() {
    if (!this.active || !game.user.isGM || this.current()) return null;
    const { count, whole } = this.installed();
    const why = !count ? "Missing" : whole ? "Outdated" : "Damaged";
    const choice = await Compat.DialogV2.wait({
      window: { title: L(`${LANG}.Arsenal.Offer.Title`) },
      classes: ["neon-combat", "ncm-dialog"],
      content: `<p>${L(`${LANG}.Arsenal.Offer.${why}`)}</p><p class="ncm-ref">${L(`${LANG}.Arsenal.Offer.Later`)}</p>`,
      buttons: [
        { action: "install", label: L(`${LANG}.Arsenal.Offer.Install`), icon: "fa-solid fa-download", default: true },
        { action: "later", label: L(`${LANG}.Arsenal.Offer.NotNow`) },
        { action: "never", label: L(`${LANG}.Arsenal.Offer.Never`) }
      ],
      rejectClose: false
    });
    if (choice === "install") await this.install();
    else if (choice === "never") await Settings.set("arsenalAutoInstall", false);
    return choice ?? null;
  },

  /** Our installed entry for the most specific of these labels. */
  entryFor(keys) {
    const all = Object.values(this.menus()).flat().filter(isOurs);
    for (const k of keys) {
      const e = all.find((x) => x.label === k);
      if (e) return e;
    }
    return null;
  },

  /* ---------------------------------------- */
  /*  Each attack                             */
  /* ---------------------------------------- */

  /**
   * AA has found (or not found) an animation for an attack: swap in ours for what the weapon is,
   * give AA the ammo the way the CPR fork does (Diwako's muzzle flash reads it), the fire mode,
   * and the hit or miss by the 2070 range tables. A blast placed by Neon Arsenal draws itself.
   */
  onWorkflowStart(data, animation) {
    if (data?.[`${MODULE_ID}Relay`]) return;
    const item = data?.item;
    const actor = data?.token?.actor ?? item?.actor;
    if (!item || !actor || !["weapon", "cyberware"].includes(item.type)) return;
    // AA has taken this attack up: its sounds wait for the first frame (see sync.js).
    const tokenId = data.token?.id ?? data.token?.document?.id ?? null;
    Sync.seen(tokenId);
    if (!Settings.get("arsenalAnimations")) return;
    const ammo = loadedAmmo(item, actor);
    const upgrades = Rebuilds.upgradesOf(item, actor);
    const info = classify(item, ammo, upgrades);
    const traits = traitsOf(info.flavor, upgrades);

    // Arrows, paintballs, grenades and rockets throw no muzzle flash (and match no bullet look).
    if (ammo && !NO_FLASH.includes(info.ammoVariety)) data.ammoItem ??= ammo;
    else if (data.ammoItem && NO_FLASH.includes(data.ammoItem.system?.variety)) data.ammoItem = null;

    if (info.explosive && Blast.find(actor.id, item.id)) {
      data.stopWorkflow = true;
      Sync.dropped(tokenId);
      return;
    }

    // A ricochet or a Smart gun's rounds are drawn by Neon Arsenal itself (shots.js).
    if (["ricochet", "smart"].includes(Shots.lookFor(data.workflow?.flags?.[MODULE_ID]?.arsenal))) {
      data.stopWorkflow = true;
      Sync.dropped(tokenId);
      return;
    }

    const tag = traits.tags[0] ?? null;
    const keys = profileKeys({ kind: info.kind, flavor: info.flavor, ammoType: info.ammoType });
    if (tag) keys.unshift(`${keys.at(-1)} · ${tag}`);
    const entry = this.entryFor(keys);
    if (entry) {
      const ours = foundry.utils.deepClone(entry);
      if (animation && typeof animation === "object") {
        for (const k of Object.keys(animation)) delete animation[k];
        Object.assign(animation, ours);
      } else {
        data.overrideNames = [ours.label];
        data.recheckAnimation = true;
      }
    }

    const mode = actor.flags?.[SYSTEM_ID]?.[`firetype-${item.id}`] ?? "single";
    if (mode === "autofire") data.overrideRepeat = 5;
    if (mode === "suppressive") {
      data.overrideRepeat = 8;
      data.forceMiss = true;
    }
    // A hit or a miss, by the 2070 tables (when AA is set to show misses).
    const r = data.workflow?.flags?.[MODULE_ID]?.arsenal;
    let canMiss = false;
    try {
      canMiss = !!game.settings.get(AA_ID, "canMissTarget");
    } catch {
      canMiss = false;
    }
    if (canMiss && info.ranged && mode !== "suppressive" && r?.dv !== undefined && r.dv !== null) data.forceMiss = !(Number(r.total) > Number(r.dv));

    if (entry) this.planHits(data, rowFor(keys), tokenId);

    // Diwako's muzzle flash only lights for the GM's own attacks; a player's goes to the GM.
    if (info.flavor === "tech") this.tech = Date.now();
    if (!game.user.isGM && info.ranged && data.ammoItem && this.flashes) {
      Socket.broadcast("arsenalFlash", {
        item: item.uuid, token: data.token?.document?.uuid ?? data.token?.uuid, ammo: data.ammoItem.uuid,
        targets: [...(data.targets ?? [])].map((t) => t.document?.uuid ?? t.uuid).filter(Boolean),
        repeat: data.overrideRepeat ?? null, tech: info.flavor === "tech",
        options: { delay: animation?.primary?.options?.delay ?? 0, repeat: animation?.primary?.options?.repeat ?? 1, repeatDelay: animation?.primary?.options?.repeatDelay ?? 250 }
      });
    }
  },

  /** The JB2A files for a hit look (an AA look: impact, explosion, fireball), as Sequencer paths. */
  hitFiles(hit) {
    const color = hit?.color ?? "orange";
    let paths = [];
    if (hit?.animation === "impact") paths = ["001", "002", "003", "004", "005", "007", "008", "009", "010"].map((n) => `jb2a.impact.${n}.${color}`);
    else if (hit?.animation === "explosion") paths = ["01", "02", "04"].map((n) => `jb2a.explosion.${n}.${color}`);
    else if (hit?.animation === "fireball") paths = [`jb2a.fireball.loop_no_debris.${color}`, `jb2a.fireball.explosion.${color}`];
    paths = paths.filter((p) => Core.dbHas(p));
    if (hit?.animation === "fireball") paths = paths.slice(0, 1);
    if (paths.length) return paths;
    const any = Core.jb2a(hit?.animation === "explosion" ? ["jb2a.explosion.01", "jb2a.explosion"] : ["jb2a.impact.004", "jb2a.impact"], [color]);
    return any ? [any] : [];
  },

  /**
   * What an attack does to its targets, drawn when it gets there: AA can only start an entry's
   * secondary with the shot or a fixed time after it, and a round's flight depends on the distance
   * (a swing's contact on the weapon). Waits for AA's first frame; a shot that's shown missing
   * (Suppressive Fire, a miss with AA's misses on) hits nothing.
   */
  planHits(data, row, tokenId) {
    const hit = row ? hitOf(row, this.patreon) : null;
    if (!hit || data.forceMiss || !Core.sequencer) return false;
    const from = data.token?.center ?? data.token?.object?.center;
    const targets = [...(data.targets ?? [])].map((t) => t?.object ?? t).filter((t) => t?.center);
    if (!from || !targets.length) return false;
    const look = lookOf(row, this.patreon);
    const melee = row.menu === "melee";
    const gs = canvas.grid.size;
    const plan = targets.map((t) => ({ target: t, delay: melee ? contactFor(look) : flightFor(look, squaresBetween(from, t.center, gs)).arrive }));
    const repeat = Number(data.overrideRepeat) > 1 ? Number(data.overrideRepeat) : 1;
    Sync.when(tokenId, (started) => {
      if (started) this.drawHits(plan, { hit, size: hitSize(row), repeat, repeatDelay: row.repeatDelay ?? 250 });
    }, { limit: 5000 });
    return plan;
  },

  drawHits(plan, { hit, size = 1, repeat = 1, repeatDelay = 250 }) {
    const files = this.hitFiles(hit);
    if (!files.length) return false;
    const lead = hit.animation === "explosion" ? BLOOM_LEAD : 0;
    try {
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      for (const { target, delay } of plan) {
        const fx = seq.effect().file(files).atLocation(target).size(size, { gridUnits: true }).opacity(0.9).fadeOut(300).delay(Math.max(0, delay - lead)).zIndex(1);
        // A fire that catches burns a moment, not its whole five-second loop.
        if (hit.animation === "fireball") fx.duration(1500);
        if (repeat > 1) fx.repeats(repeat, repeatDelay);
      }
      seq.play();
      return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | hit effect`, err);
      return false;
    }
  },

  /**
   * When an attack's round leaves and arrives, for its sounds: by the look its profile entry
   * plays and the distance to its first target.
   * @param {object} a - the attack card's tag ({ tokenId, targets })
   * @param {string[]} keys - profile labels, most specific first
   */
  flight(a, keys) {
    const row = rowFor(keys);
    const from = canvas?.tokens?.get(a?.tokenId)?.center;
    const to = canvas?.tokens?.get(a?.targets?.[0])?.center;
    if (!row || row.menu === "melee" || !from || !to) return null;
    return flightFor(lookOf(row, this.patreon), squaresBetween(from, to, canvas.grid.size));
  },

  /** Diwako's muzzle flash is on (with DF Active Lights) in this world. */
  get flashes() {
    if (!game.modules.get(DIWAKO_ID)?.active || !game.modules.get(DF_LIGHTS_ID)?.active || !Settings.get("arsenalPlayerFlashes")) return false;
    try {
      return game.settings.get(DIWAKO_ID, "dfAmbientLights-enable") !== false;
    } catch {
      return false;
    }
  },

  /**
   * A player's shot, on the GM's client: Diwako's own handler makes the flash, given the same data
   * AA would have handed it (the GM's canvas must show the scene, as for the GM's own shots).
   */
  async flashAsGM(d) {
    if (!Compat.isActiveGM || !this.flashes) return;
    const token = await fromUuid(d.token);
    if (!token || token.parent?.id !== canvas?.scene?.id) return;
    const item = await fromUuid(d.item);
    const ammoItem = await fromUuid(d.ammo);
    const targets = (await Promise.all((d.targets ?? []).map((u) => fromUuid(u)))).map((t) => t?.object).filter(Boolean);
    if (!item || !ammoItem) return;
    if (d.tech) this.tech = Date.now();
    const data = { [`${MODULE_ID}Relay`]: true, item, token, ammoItem, targets, overrideRepeat: d.repeat ?? undefined };
    const animation = { primary: { options: { ...d.options }, sound: { delay: 0 } }, secondary: { options: { delay: 0 }, sound: { delay: 0 } } };
    Hooks.callAll("AutomatedAnimations-WorkflowStart", data, animation);
  },

  /** For the console and docs: which entry an equipped weapon would get. */
  explain(item) {
    const actor = item?.actor;
    const ammo = loadedAmmo(item, actor);
    const upgrades = Rebuilds.upgradesOf(item, actor);
    const info = classify(item, ammo, upgrades);
    const traits = traitsOf(info.flavor, upgrades);
    const keys = profileKeys({ kind: info.kind, flavor: info.flavor, ammoType: info.ammoType });
    if (traits.tags[0]) keys.unshift(`${keys.at(-1)} · ${traits.tags[0]}`);
    return { ...info, traits, keys, entry: this.entryFor(keys)?.label ?? null, dvTable: item?.system?.dvTable ?? "" };
  }
};
