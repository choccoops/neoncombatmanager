import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { Registry } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { L } from "../util.js";
import { Compat } from "../compat.js";
import { Core, FX_FLAG } from "./core.js";
import { RECIPES, recipeFor, LAYERED, JB2A, Once } from "./recipes.js";
import { Motion, MODES } from "./motion.js";
import { Trail } from "./sandevistan.js";
import { Landing } from "./landing.js";
import { Chrome, tintOf } from "./chrome.js";
import { Tactile } from "./tactile.js";
import { Switches } from "./switches.js";
import { Screen } from "./screen.js";
import { HackFx } from "../hack/fx.js";

/** The effects a token can have switched on by hand (the macros), as token flags. */
export const SWITCHES = ["psycho", "sandevistan", "berserk", "kerenzikov"];
/** The macros the first Neon FX (1.13.0) installed: a world that has those gets only the newer ones. */
const FIRST_MACROS = ["Sandevistan", "Psycho", "Extreme", "Clear"];
/** How long the switch loops (the cyberpsycho's static, the Sandevistan's hum) play before fading. */
const LOOP_MS = 20000;
/** Sequencer brings back saved effects when a scene loads; let it finish before we tidy up. */
const SETTLE_MS = 2000;

/**
 * Neon FX: Sequencer visuals for Neon Conditions, and the Cyberpsychosis and Sandevistan
 * switches.
 *
 * Who draws what:
 * - Persistent looks (a condition's layers, a switch's layers) are Sequencer effects named
 *   `ncm-fx-<key>-<tokenId>`, made and ended by one writer (the active GM, else whoever acted), so
 *   Sequencer shares them with everyone and brings them back after a reload.
 * - One-offs, sounds, the Sandevistan trail and token motion happen on each client by itself, from
 *   what each client sees: no network traffic, each player's own volume and motion settings.
 */
export const NeonFX = {
  /** tokenId -> Set of keys this client has asked Sequencer for (until they show in its list). */
  _made: new Map(),
  /** tokenId -> Promise: one sync at a time per token. */
  _queue: new Map(),
  /** tokenId -> the switches as this client last saw them, to tell what an update flipped. */
  _seen: new Map(),

  init() {
    Hooks.on("createActiveEffect", (effect, options, userId) => this._onEffect(effect, userId, true));
    Hooks.on("deleteActiveEffect", (effect, options, userId) => this._onEffect(effect, userId, false));
    Hooks.on("updateToken", (doc, changes, options, userId) => this._onUpdateToken(doc, changes, userId));
    Hooks.on("createToken", (doc, options, userId) => setTimeout(() => {
      if (doc.object) this._remember(doc.object);
      this.refresh(doc.object, userId);
    }, 300));
    Hooks.on("deleteToken", (doc) => {
      this._made.delete(doc.id);
      this._seen.delete(doc.id);
      Trail.forget(doc.id);
    });
    Hooks.on("refreshToken", (token) => Trail.onRefresh(token));
    Hooks.on("canvasReady", () => this.refreshScene({ settle: true }));
    Hooks.on("canvasTearDown", () => {
      Motion.clear();
      Trail.clear();
      this._made.clear();
      this._seen.clear();
    });
    Hooks.on(`${MODULE_ID}.fxChanged`, () => this.refreshScene());
    Landing.init();
    Chrome.init();
    Tactile.init();
    Switches.init();
    Screen.init();
  },

  async ready() {
    if (canvas?.ready) this.refreshScene({ settle: true });
    Switches.ready();
    Screen.refresh();
    const fresh = this._newMacros();
    if (Core.sequencer && Settings.get("fxMacros") && fresh.length && game.user.isGM) {
      await this.installMacros({ quiet: true, keys: fresh }).catch((err) => console.error(`${MODULE_ID} | Neon FX macros`, err));
    }
  },

  /* ---------------------------------------- */
  /*  What a token should show                */
  /* ---------------------------------------- */

  /** Conditions on a token's actor that Neon FX draws (none for the dead, none when switched off). */
  _conditions(token) {
    if (!Core.on || !Settings.get("fxConditions") || !token?.actor) return [];
    const active = Conditions.active(token.actor);
    if (active.some((c) => c.id === "dead")) return [];
    return active;
  },

  /** Keys of the persistent looks a token should carry. */
  desired(token) {
    const keys = new Set();
    if (!Core.on || !token) return keys;
    for (const c of this._conditions(token)) if (LAYERED.has(c.id)) keys.add(c.id);
    if (Conditions.has("dead", token.actor)) return keys;
    const state = Core.state(token);
    for (const k of SWITCHES) if (state[k]) keys.add(k);
    return keys;
  },

  /** The strongest motion a token should have, or null. */
  motionFor(token) {
    if (!Core.on || !Core.motion || !token) return null;
    const modes = new Set();
    for (const c of this._conditions(token)) {
      const m = recipeFor(c)?.motion;
      if (m) modes.add(m);
    }
    if (!Conditions.has("dead", token.actor)) {
      const state = Core.state(token);
      for (const k of SWITCHES) if (state[k] && RECIPES[k].motion) modes.add(RECIPES[k].motion);
    }
    return MODES.find((m) => modes.has(m)) ?? null;
  },

  /* ---------------------------------------- */
  /*  Drawing                                 */
  /* ---------------------------------------- */

  /** Bring a token up to date: its motion here, and (for the writer) its persistent looks. */
  refresh(token, userId = game.user.id) {
    if (!token?.id) return;
    Motion.set(token, this.motionFor(token));
    if (Core.sequencer && Core.writes(userId)) this.sync(token);
  },

  /** Every token on the scene. settle: wait for Sequencer to bring back saved effects first. */
  refreshScene({ settle = false } = {}) {
    const tokens = canvas?.tokens?.placeables ?? [];
    for (const t of tokens) {
      this._remember(t);
      Motion.set(t, this.motionFor(t));
    }
    // Only the active GM rebuilds a whole scene: without one, each player would draw everything.
    if (!Core.sequencer || !Compat.isActiveGM) return;
    const run = () => {
      this._made.clear();
      for (const t of canvas?.tokens?.placeables ?? []) this.sync(t);
    };
    if (settle) setTimeout(run, SETTLE_MS);
    else run();
  },

  /** Make the persistent looks a token is missing and end the ones it shouldn't have. One at a time per token. */
  sync(token) {
    const prev = this._queue.get(token.id) ?? Promise.resolve();
    const next = prev.then(() => this._sync(token)).catch((err) => console.error(`${MODULE_ID} | Neon FX on ${token.name}`, err));
    this._queue.set(token.id, next);
    return next;
  },

  /** The keys of our effects Sequencer has on a token, plus those we've asked for. */
  have(token) {
    const keys = new Set(this._made.get(token.id) ?? []);
    for (const e of Sequencer.EffectManager.getEffects({ object: token }) ?? []) {
      const k = Core.keyOf(e?.data?.name, token);
      if (k) keys.add(k);
    }
    return keys;
  },

  async _sync(token) {
    if (!token?.document || token.destroyed) return;
    const want = this.desired(token);
    const have = this.have(token);
    const made = this._made.get(token.id) ?? new Set();
    for (const k of have) {
      if (want.has(k)) continue;
      made.delete(k);
      await Sequencer.EffectManager.endEffects({ name: Core.name(k, token), object: token });
    }
    const add = [...want].filter((k) => !have.has(k));
    if (add.length) {
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      for (const k of add) {
        for (const layer of RECIPES[k]?.layers ?? []) layer(seq, token, Core.name(k, token));
        made.add(k);
      }
      seq.play(); // persistent effects never "finish", so this doesn't resolve: don't wait on it
    }
    this._made.set(token.id, made);
  },

  /** A one-off look and sound for a condition just added (this client only). */
  _flourish(token, c) {
    if (!Core.on || !Settings.get("fxConditions") || !token?.visible) return;
    const recipe = recipeFor(c);
    if (!recipe) return;
    if (recipe.once?.length) {
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      for (const once of recipe.once) once(seq, token);
      seq.play();
    }
    if (recipe.sound) Core.sound(recipe.sound);
  },

  /* ---------------------------------------- */
  /*  Hooks                                   */
  /* ---------------------------------------- */

  _onEffect(effect, userId, added) {
    const c = Registry.ofEffect(effect);
    const actor = effect?.parent;
    if (!c || actor?.documentName !== "Actor" || !Core.sequencer) return;
    for (const token of Core.tokensOf(actor)) {
      if (added) this._flourish(token, c);
      // A quickhack's condition ending, however it ends: the system comes back up.
      else if (c.category === "quickhack" && Settings.get("fxConditions")) HackFx.conditionEnded(token);
      this.refresh(token, userId);
    }
  },

  _onUpdateToken(doc, changes, userId) {
    const token = doc?.object;
    const flags = changes?.flags;
    if (!token || !flags || !(MODULE_ID in flags || `-=${MODULE_ID}` in flags)) return;
    Landing.onUpdate(doc, changes, userId);
    const state = Core.state(doc);
    const before = this._seen.get(token.id) ?? {};
    const flipped = SWITCHES.filter((k) => !!state[k] !== !!before[k]);
    this._remember(token);
    if (!flipped.length) return;
    if (Core.on && token.visible) {
      for (const k of flipped) {
        this._switchSound(token, k, !!state[k]);
        this._switchBurst(token, k, state[k]);
      }
      if (flipped.includes("sandevistan")) Trail.pop(token);
    }
    if (!state.sandevistan) Trail.forget(token.id);
    this.refresh(token, userId);
  },

  _remember(token) {
    const state = Core.state(token);
    this._seen.set(token.id, Object.fromEntries(SWITCHES.map((k) => [k, !!state[k]])));
  },

  _switchSound(token, key, on) {
    const loop = `${Core.name(key, token)}-loop`;
    if (key === "psycho") {
      if (on) {
        Core.sound("psychoSting");
        Core.sound("psychoLoop", { name: loop, duration: LOOP_MS });
      } else Core.endSound(loop);
    } else if (key === "sandevistan") {
      if (on) {
        Core.sound("sandeOn");
        Core.sound("sandeLoop", { name: loop, duration: LOOP_MS });
      } else {
        Core.endSound(loop);
        Core.sound("sandeOff");
      }
    } else if (key === "kerenzikov") {
      // Speedware kicking in: a quick rush, no hum.
      if (on) Core.sound("kerenOn");
    } else if (key === "berserk") Core.sound(on ? "berserkOn" : "berserkOff");
  },

  /** Chrome switching on or off: a burst in its colour (its Operating System's, when one runs). This client only. */
  _switchBurst(token, key, value) {
    if (key === "psycho") return;
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    for (const once of value ? Once.activate(key, tintOf(key, value)) : Once.deactivate()) once(seq, token);
    seq.play();
  },

  /* ---------------------------------------- */
  /*  The switches (the macros call these)    */
  /* ---------------------------------------- */

  /** Tokens to act on: the given ones, else the controlled ones. Only those you own. */
  _targets(tokens) {
    let list = tokens ?? canvas?.tokens?.controlled ?? [];
    if (!Array.isArray(list)) list = [list];
    return list.map((t) => t?.object ?? t).filter((t) => t?.document?.isOwner);
  },

  /**
   * Switch Cyberpsychosis glitch or Sandevistan on or off for tokens (default: selected).
   * on: true / false, or null to flip each token.
   */
  async toggle(key, tokens = null, on = null) {
    if (!SWITCHES.includes(key)) throw new Error(`${MODULE_ID} | no Neon FX switch "${key}"`);
    if (!Core.sequencer) {
      ui.notifications.warn(L(`${LANG}.FX.NoSequencer`));
      return [];
    }
    const list = this._targets(tokens);
    if (!list.length) {
      ui.notifications.warn(L(`${LANG}.FX.SelectToken`));
      return [];
    }
    for (const token of list) {
      const value = on ?? !Core.state(token)[key];
      if (value) await token.document.setFlag(MODULE_ID, `${FX_FLAG}.${key}`, true);
      else await token.document.unsetFlag(MODULE_ID, `${FX_FLAG}.${key}`);
    }
    return list;
  },

  /**
   * Switch a Sandevistan or Berserk on or off for tokens (default: selected), as the rules run it:
   * the Chrome running condition (their Operating System's, when they have one), which holds the
   * token's look on. With the chrome conditions switched off in the settings, the look alone.
   */
  async activate(kind, tokens = null, on = null) {
    if (!["sandevistan", "berserk"].includes(kind)) throw new Error(`${MODULE_ID} | no chrome "${kind}"`);
    if (!Chrome.on) return this.toggle(kind, tokens, on);
    const list = this._targets(tokens);
    if (!list.length) {
      ui.notifications.warn(L(`${LANG}.FX.SelectToken`));
      return [];
    }
    return Chrome.activate(kind, list, on);
  },

  /** Switch off both switches on tokens (default: selected). Conditions are left alone. */
  async clear(tokens = null) {
    const list = this._targets(tokens);
    for (const token of list) {
      for (const k of SWITCHES) if (Core.state(token)[k]) await token.document.unsetFlag(MODULE_ID, `${FX_FLAG}.${k}`);
    }
    return list;
  },

  /* ---------------------------------------- */
  /*  Macros                                  */
  /* ---------------------------------------- */

  /** The macros Neon FX ships: name key, icon, command. */
  macros() {
    const api = `game.modules.get("${MODULE_ID}").api`;
    return [
      { key: "Sandevistan", img: `modules/${MODULE_ID}/assets/icons/sandevistan.svg`, command: `${api}.fx.activate("sandevistan");` },
      { key: "Berserk", img: `modules/${MODULE_ID}/assets/icons/berserk.svg`, command: `${api}.fx.activate("berserk");` },
      { key: "Speedware", img: `modules/${MODULE_ID}/assets/icons/qh-speedware.svg`, command: `${api}.fx.kerenzikov();` },
      { key: "Psycho", img: `modules/${MODULE_ID}/assets/icons/qh-cyberpsychosis.svg`, command: `${api}.fx.psycho();` },
      { key: "Extreme", img: `modules/${MODULE_ID}/assets/icons/extreme-cyberpsychosis.svg`, command: `${api}.conditions.toggle("extremeCyberpsychosis");` },
      { key: "Clear", img: "icons/svg/cancel.svg", command: `${api}.fx.clear();` },
      { key: "LandingZone", img: `modules/${MODULE_ID}/assets/icons/av-landing-zone.svg`, command: `${api}.fx.landingZone();` },
      { key: "Land", img: `modules/${MODULE_ID}/assets/icons/av-land.svg`, command: `${api}.fx.land();` }
    ];
  },

  /** Keys of the macros this world hasn't been given yet (once each: a deleted macro stays deleted). */
  _newMacros() {
    const known = new Set(Settings.get("fxMacrosKnown") ?? []);
    if (Settings.get("fxMacrosInstalled")) for (const k of FIRST_MACROS) known.add(k);
    return this.macros().map((m) => m.key).filter((k) => !known.has(k));
  },

  /** Put the Neon FX macros (or just `keys`) in a "Neon FX" macro folder, skipping any already there. GM. */
  async installMacros({ quiet = false, keys = null } = {}) {
    if (!game.user.isGM) return [];
    const folderName = L(`${LANG}.FX.Folder`);
    let folder = game.folders?.find?.((f) => f.type === "Macro" && f.name === folderName);
    folder ??= await Folder.create({ name: folderName, type: "Macro", color: "#ff3864" });
    const made = [];
    for (const m of this.macros()) {
      if (keys && !keys.includes(m.key)) continue;
      const name = L(`${LANG}.FX.Macro.${m.key}`);
      if (game.macros?.find?.((x) => x.name === name && x.folder?.id === folder?.id)) continue;
      made.push({ name, type: "script", img: m.img, command: m.command, folder: folder?.id ?? null });
    }
    const docs = made.length ? await Macro.createDocuments(made) : [];
    await Settings.set("fxMacrosInstalled", true);
    await Settings.set("fxMacrosKnown", this.macros().map((m) => m.key));
    if (!quiet || docs.length) ui.notifications.info(L(`${LANG}.FX.Installed`, { count: docs.length, folder: folderName }));
    return docs;
  },

  /* ---------------------------------------- */
  /*  Diagnostics                             */
  /* ---------------------------------------- */

  /** Which JB2A file (or fallback) each look resolves to here. For the console. */
  report() {
    const rows = [];
    for (const [key, recipe] of Object.entries(RECIPES)) rows.push({ key, layers: recipe.layers?.length ?? 0, motion: recipe.motion ?? "", sound: recipe.sound ?? "" });
    const jb2a = Object.fromEntries(Object.entries(JB2A).map(([k, bases]) => [k, Core.sequencer ? Core.jb2a(bases) ?? "(Neon FX fallback)" : "(no Sequencer)"]));
    return { sequencer: Core.sequencer, on: Core.on, jb2a, recipes: rows };
  }
};

