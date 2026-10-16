import { MODULE_ID, FLAGS, HOOKS, LANG, NEON_HUB_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Registry, sightChanges } from "../conditions/registry.js";
import { Conditions } from "../conditions/engine.js";
import { Cards } from "../combat/cards.js";
import { Sources } from "./sources.js";
import { weatherFor, HAZARDS, WEATHER_CONDITION } from "./weather-data.js";
import { sightPenalty, worse } from "./visibility-data.js";
import { debounce, L, esc } from "../util.js";

const ENV = "env";

/**
 * The environment, put on the characters in the encounter: Night City weather as conditions
 * (with each character's gear taken into account) and a visibility condition from the light
 * where they are, or where their target is, and the weather's obscurement. Low Light/Infrared/UV
 * cybereyes cancel both. Run by the active GM; everyone sees the conditions on the tokens, the
 * carousel and the Biomon Link, and CPR's roll dialog shows each penalty as a situational modifier.
 */
export const Environment = {
  /** Actors carrying environment effects (uuid), to clean up when they leave the encounter. */
  touched: new Set(),
  /** Seconds of exposure per combat and weather key, for timed hazards. */
  exposure: new Map(),
  /** What the last refresh found, for the Environment window: { weather, rows }. */
  state: { weather: null, rows: [] },

  init() {
    const soon = debounce(() => this.refresh(), 350);
    this.soon = soon;
    const tokenKeys = ["x", "y", "elevation", "light", "hidden", "width", "height"];
    Hooks.on("canvasReady", () => this.sweep().then(() => soon()));
    Hooks.on("updateScene", (scene, changed) => {
      if (scene.id !== canvas?.scene?.id) return;
      const flat = Object.keys(foundry.utils.flattenObject(changed));
      if (flat.some((k) => k.startsWith("environment") || k.startsWith("darkness") || k.startsWith(`flags.${MODULE_ID}`))) soon();
    });
    Hooks.on("updateToken", (doc, changed) => {
      if (Object.keys(changed).some((k) => tokenKeys.includes(k))) soon();
    });
    for (const h of ["createToken", "deleteToken", "createCombatant", "deleteCombatant", "createCombat", "targetToken", "controlToken",
      "createAmbientLight", "updateAmbientLight", "deleteAmbientLight", "createRegion", "updateRegion", "deleteRegion",
      "lightingRefresh", `${MODULE_ID}.environmentConfig`, `${NEON_HUB_ID}.weatherChanged`, `${NEON_HUB_ID}.calendarChanged`]) {
      Hooks.on(h, () => soon());
    }
    Hooks.on("updateCombat", (combat, changed) => {
      if ("round" in changed || "turn" in changed || "active" in changed) soon();
    });
    Hooks.on("deleteCombat", (combat) => {
      this.exposure.delete(combat.id);
      soon();
    });
    Hooks.on("updateWorldTime", (worldTime, delta) => {
      soon();
      this.tick(delta).catch((err) => console.error(`${MODULE_ID} | weather hazards`, err));
    });
    // Gear changes (a mask put on, cybereyes installed) change what weather does.
    for (const h of ["createItem", "updateItem", "deleteItem"]) {
      Hooks.on(h, (item) => {
        if (item.parent && this.touched.has(item.parent.uuid)) soon();
      });
    }
  },

  /** Tokens the environment applies to: combatants in the scene's combat (and, by setting, every player token). */
  scope() {
    const scene = canvas?.scene;
    if (!scene) return [];
    const docs = new Map();
    const combat = game.combats?.find((c) => c.active && (!c.scene || c.scene.id === scene.id)) ?? null;
    for (const cb of combat?.combatants ?? []) {
      if (cb.token && cb.token.parent?.id === scene.id) docs.set(cb.token.id, cb.token);
    }
    if (Settings.get("envOutsideCombat")) {
      for (const t of scene.tokens) if (t.actor?.hasPlayerOwner) docs.set(t.id, t);
    }
    return [...docs.values()].filter((d) => d.actor && CPR.isMeat(d.actor));
  },

  /** The tokens a token's controller is looking at: their targets. */
  targetsOf(doc) {
    const actor = doc.actor;
    const players = game.users.filter((u) => !u.isGM && u.active && actor?.testUserPermission(u, "OWNER"));
    let targets = players.flatMap((u) => [...u.targets]);
    // NPCs: the GM's targets while the GM has that token selected.
    if (!targets.length && doc.object?.controlled) targets = [...game.user.targets];
    return targets.map((t) => t.document ?? t).filter((t) => t?.parent?.id === doc.parent?.id && t.id !== doc.id);
  },

  /** Light level that counts for a token's checks. */
  levelFor(doc) {
    const own = Sources.lightAt(doc);
    if (Settings.get("visibilityFrom") !== "target") return own;
    const targets = this.targetsOf(doc);
    if (!targets.length) return own;
    return targets.map((t) => Sources.lightAt(t)).reduce((a, b) => worse(a, b), "bright");
  },

  /**
   * What the environment does to one token's character.
   * @returns {{ desired: Map<string, {changes, name}>, row: object, hazards: string[] }}
   */
  evaluate(doc, weather) {
    const actor = doc.actor;
    const mode = Sources.sceneMode(doc.parent);
    const outdoors = mode === "outdoor" && !Sources.sheltered(doc);
    const gear = Sources.gear(actor);
    const w = outdoors && weather.keys.length ? weatherFor(weather.keys, gear, { armorPenalty: CPR.armorPenalty(actor) }) : { conditions: [], sight: 0, extra: [], hazards: [] };
    const level = Settings.get("visibilityEnabled") && canvas?.ready ? this.levelFor(doc) : "bright";
    const sp = sightPenalty({ level, weather: w.sight, vision: gear.vision, cap: Number(Settings.get("visibilityCap")) || 0 });

    const desired = new Map();
    for (const c of w.conditions) desired.set(c.id, { changes: c.changes });
    for (const id of w.extra) desired.set(id, { changes: null });
    if (sp.condition) {
      const c = Registry.get(sp.condition);
      // Weather alone (no darkness) follows the "on by default" setting; darkness always counts.
      const changes = sightChanges(sp.total).map((ch) => ({ ...ch, onByDefault: sp.darkness < 0 || !!Settings.get("weatherOnByDefault") }));
      desired.set(sp.condition, { changes, name: `${c?.name ?? sp.condition} (${sp.total})` });
    }
    const row = {
      token: doc,
      name: doc.name,
      img: doc.texture?.src ?? actor.img,
      outdoors,
      level,
      sight: sp.total,
      vision: gear.vision,
      gear,
      conditions: [...desired.keys()].map((id) => Registry.get(id)).filter(Boolean)
    };
    return { desired, row, hazards: w.hazards };
  },

  /** Recompute and write every character's environment conditions (active GM). */
  async refresh() {
    // GMs only: players see the results on the tokens; the carousel reads the weather itself.
    if (!game.user.isGM) return;
    if (this._busy) {
      this._again = true;
      return;
    }
    this._busy = true;
    try {
      const weather = Sources.weather();
      const rows = [];
      const inScope = new Set();
      const hazards = new Map();
      const write = Compat.isActiveGM;
      for (const doc of this.scope()) {
        const actor = doc.actor;
        const { desired, row, hazards: hz } = this.evaluate(doc, weather);
        rows.push(row);
        hazards.set(actor.uuid, hz);
        inScope.add(actor.uuid);
        if (write) await this.apply(actor, desired);
      }
      if (write) {
        for (const uuid of [...this.touched]) {
          if (inScope.has(uuid)) continue;
          const actor = fromUuidSync(uuid);
          if (actor) await this.apply(actor, new Map());
          this.touched.delete(uuid);
        }
      }
      this.state = { weather, rows, hazards };
      Hooks.callAll(HOOKS.environmentChanged, this.state);
    } catch (err) {
      console.error(`${MODULE_ID} | environment refresh failed`, err);
    } finally {
      this._busy = false;
      if (this._again) {
        this._again = false;
        this.soon();
      }
    }
  },

  /** Make an actor's environment effects match what's wanted. The GM's own effects are left alone. */
  async apply(actor, desired) {
    const mine = actor.effects.filter((e) => e.getFlag(MODULE_ID, FLAGS.managed) === ENV);
    const stale = mine.filter((e) => !desired.has(Registry.ofEffect(e)?.id));
    if (stale.length) await actor.deleteEmbeddedDocuments("ActiveEffect", stale.map((e) => e.id), { [MODULE_ID]: { quiet: true } });
    for (const [id, spec] of desired) {
      const c = Registry.get(id);
      if (!c || c.disabled) continue;
      // The GM placed this (or another of its group, like Darkness by hand): theirs wins.
      const handPlaced = actor.effects.some((e) => {
        const ec = Registry.ofEffect(e);
        return ec && (ec.id === id || (c.group && ec.group === c.group)) && e.getFlag(MODULE_ID, FLAGS.managed) !== ENV;
      });
      if (handPlaced) continue;
      await Conditions.add(id, actor, { managed: ENV, changes: spec.changes ?? undefined, name: spec.name ?? undefined });
    }
    if (desired.size) this.touched.add(actor.uuid);
  },

  /** On load: remove environment effects from anyone outside the encounter (active GM). */
  async sweep() {
    if (!Compat.isActiveGM) return;
    const scope = new Set(this.scope().map((d) => d.actor.uuid));
    for (const actor of Conditions._actorsInPlay()) {
      if (scope.has(actor.uuid)) {
        this.touched.add(actor.uuid);
        continue;
      }
      if (actor.effects.some((e) => e.getFlag(MODULE_ID, FLAGS.managed) === ENV)) await this.apply(actor, new Map());
    }
  },

  /* ---------------------------------------- */
  /*  Timed hazards                           */
  /* ---------------------------------------- */

  /**
   * World time moved during a combat: count exposure to each hazardous weather and post the GM
   * a card when a check comes due (acid ablating armor each minute, smog after a minute...).
   */
  async tick(delta) {
    if (!Compat.isActiveGM || !Settings.get("weatherHazardCards") || !(delta > 0)) return;
    const combat = game.combats?.find((c) => c.active && c.started);
    if (!combat) return;
    const weather = this.state.weather ?? Sources.weather();
    const counts = this.exposure.get(combat.id) ?? {};
    for (const key of weather.keys) {
      const hz = HAZARDS[key];
      if (!hz) continue;
      const before = counts[key] ?? 0;
      const after = before + delta;
      counts[key] = after;
      const due = (hz.every && Math.floor(after / hz.every) > Math.floor(before / hz.every)) || (hz.after && before < hz.after && after >= hz.after);
      if (!due) continue;
      const exposed = [...(this.state.hazards ?? new Map()).entries()].filter(([, list]) => list.includes(key)).map(([uuid]) => fromUuidSync(uuid)).filter(Boolean);
      if (exposed.length) await this.hazardCard(key, exposed);
    }
    this.exposure.set(combat.id, counts);
  },

  async hazardCard(key, actors) {
    const name = L(`${LANG}.Weather.${key}`);
    const buttons = [];
    let body = L(`${LANG}.Hazard.${key}`);
    let kind = key;
    if (key === "bloodRain") {
      const roll = await new Roll("1d6").evaluate();
      kind = roll.total <= 3 ? "acidRain" : "bloodRainToxic";
      body = L(`${LANG}.Hazard.bloodRainRoll`, { roll: roll.total }) + " " + L(`${LANG}.Hazard.${kind}`);
    }
    if (key === "deadlyThunderstorm") {
      const roll = await new Roll("1d6").evaluate();
      body = L(`${LANG}.Hazard.${roll.total >= 4 ? "lightningStrikes" : "lightningFar"}`, { roll: roll.total });
    }
    for (const actor of actors) {
      const who = esc(actor.name);
      if (kind === "acidRain") buttons.push({ action: "ablate", label: L(`${LANG}.Hazard.Ablate`, { name: who }), icon: "fa-solid fa-shield-halved", data: { actor: actor.uuid, amount: 1 }, gm: true });
      if (kind === "bloodRainToxic") buttons.push({ action: "exposure", label: L(`${LANG}.Hazard.Resist`, { name: who, dv: 15 }), icon: "fa-solid fa-biohazard", data: { actor: actor.uuid, dv: 15, damage: "3d6" } });
      if (kind === "ashStorm") buttons.push({ action: "exposure", label: L(`${LANG}.Hazard.Resist`, { name: who, dv: 13 }), icon: "fa-solid fa-lungs", data: { actor: actor.uuid, dv: 13, damage: "2d6", condition: "foreignObject" } });
      if (kind === "inversionSmog") buttons.push({ action: "exposure", label: L(`${LANG}.Hazard.Resist`, { name: who, dv: 13 }), icon: "fa-solid fa-smog", data: { actor: actor.uuid, dv: 13, damage: "2d6" } });
      if (kind === "dustStorm") buttons.push({ action: "addCondition", label: L(`${LANG}.Hazard.ForeignObject`, { name: who }), icon: "fa-solid fa-wind", data: { actor: actor.uuid, condition: "foreignObject" }, gm: true });
    }
    await Cards.post({
      kicker: L(`${LANG}.Hazard.Kicker`),
      title: name,
      img: Registry.get(WEATHER_CONDITION[key])?.img ?? null,
      body: `<p>${body}</p><p class="ncm-ref">${esc(actors.map((a) => a.name).join(", "))}</p>`,
      tone: "yellow",
      buttons,
      whisper: Cards.gms()
    });
  }
};
