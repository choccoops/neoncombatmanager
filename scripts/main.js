import { MODULE_ID, TEMPLATE_PATH, HOOKS, FLAGS, LANG } from "./constants.js";
import { Compat } from "./compat.js";
import { Settings } from "./settings.js";
import { Socket } from "./socket.js";
import { CPR } from "./cpr.js";
import { SettingsMenu } from "./apps/settings-menu.js";
import { Registry } from "./conditions/registry.js";
import { Conditions } from "./conditions/engine.js";
import { Triggers } from "./conditions/triggers.js";
import { CLT } from "./conditions/clt.js";
import { Cards } from "./combat/cards.js";
import { CombatTime } from "./combat/time.js";
import { Turns } from "./combat/turns.js";
import { Carousel } from "./combat/carousel.js";
import { TrackerHooks } from "./combat/tracker.js";
import { Comms } from "./comms/comms.js";
import { Links } from "./comms/links.js";
import { Calls } from "./comms/calls.js";
import { Environment } from "./environment/environment.js";
import { Sources } from "./environment/sources.js";
import { Stakes } from "./stakes/stakes.js";
import { Awareness } from "./awareness/awareness.js";
import { Hub } from "./hub/hub.js";
import { debounce, L } from "./util.js";

/** Neon Combat Manager's public API: game.modules.get("cpr-neon-combat-manager").api */
const api = {
  /** Neon Conditions (also at game.neonConditions). See docs/API.md. */
  conditions: {
    list: () => Registry.all(),
    get: (idOrName) => Registry.get(idOrName),
    has: (idOrName, entity) => Conditions.has(idOrName, entity),
    active: (entity) => Conditions.active(entity),
    effects: (entity, idOrName = null) => Conditions.actorsOf(entity).flatMap((a) => Conditions.effects(a, idOrName)),
    add: (ids, entities, options) => Conditions.add(ids, entities, options),
    remove: (ids, entities, options) => Conditions.remove(ids, entities, options),
    toggle: (idOrName, entities, options) => Conditions.toggle(idOrName, entities, options),
    removeAll: (entities, options) => Conditions.removeAll(entities, options),
    /** Register a condition from another module (during init/setup or the registerConditions hook). */
    register: (def) => Registry.register(def),
    openLab: async () => (await import("./conditions/lab-app.js")).ConditionLab.open()
  },
  /** Combat time: a Round is 3 seconds by default. */
  time: {
    get roundSeconds() {
      return CombatTime.roundSeconds;
    },
    elapsed: (combat = game.combat) => CombatTime.elapsed(combat),
    toRounds: (seconds) => CombatTime.toRounds(seconds),
    toSeconds: (rounds) => CombatTime.toSeconds(rounds),
    clock: () => CombatTime.clock()
  },
  /** Weather and visibility. */
  environment: {
    weather: () => Sources.weather(),
    get state() {
      return Environment.state;
    },
    refresh: () => Environment.refresh(),
    lightAt: (token) => Sources.lightAt(token?.document ?? token),
    gear: (actor) => Sources.gear(actor),
    open: async () => (await import("./environment/environment-app.js")).EnvironmentApp.open()
  },
  ui: {
    renderCarousel: () => Carousel.render()
  },
  /** Biomon Link: linked characters' vitals. */
  biomon: {
    open: () => Comms.openBiomon(),
    links: () => Links.all(),
    linkOf: (actor) => Links.of(actor),
    vitals: (actor) => Links.vitals(actor),
    create: (name, actor) => Links.create(name, actor),
    join: (linkId, actor) => Links.join(linkId, actor),
    leave: (actor) => Links.leave(actor)
  },
  /** Holocalls. */
  holocall: {
    open: () => Comms.openHolocall(),
    calls: () => Calls.live(),
    /** Ring people: from { actorId } (or GM: a messenger directory contact); targets { actorId } or contacts. */
    place: (from, targets) => Calls.place(from, targets),
    /** Keep a call's log in Night City Messenger (each player character's inbox). */
    saveLog: (callId, actorIds) => Calls.saveLog(callId, actorIds),
    /** Open the dialer: { from: "actor:<id>", targets: ["actor:<id>"] }. */
    dial: (options) => Comms.openHolocall(options),
    say: (callId, participantId, text) => Calls.say(callId, participantId, text),
    hangUp: (callId) => Calls.hangUp(callId),
    end: (callId) => Calls.end(callId)
  },
  /** The City & NCART hub: Night City 2070. */
  hub: {
    open: (options) => Hub.open(options),
    close: () => Hub.app?.close(),
    get state() {
      return Hub.state;
    },
    setCrew: (point, label) => Hub.setCrew(point, label),
    setPin: (actor, point) => Hub.setPin(actor, point),
    places: () => Hub.places(),
    visiblePlaces: (user) => Hub.visiblePlaces(user),
    reveal: (keys, options) => Hub.setSeen(keys, true, options),
    hide: (keys) => Hub.setSeen(keys, false),
    addPlace: (data, options) => Hub.addPlace(data, options),
    updatePlace: (key, data) => Hub.updatePlace(key, data),
    resetPlace: (key) => Hub.resetPlace(key),
    removePlace: (key) => Hub.removePlace(key),
    travel: (from, to, mode, options) => Hub.travel(from, to, mode, options),
    noSignal: (actor) => Hub.noSignal(actor),
    whereIs: (actor) => Hub.whereIs(actor)
  },
  /** Raising the Stakes: the Plot Die (2070 Core Rules). */
  stakes: {
    open: (actor) => Stakes.open(actor),
    /** GM: Raise the Stakes on a character's Check (posts the card their player rolls from). */
    raise: (actor, options) => Stakes.raise(actor, options),
    /** Roll the Plot Die for a character now and post the result. */
    roll: (actor, options) => Stakes.roll(actor, options),
    ask: (actor, reason) => Stakes.ask(actor, reason),
    luck: (actor) => Stakes.luck(actor),
    options: (actor) => Stakes.options(actor),
    newSession: () => Stakes.newSession()
  },
  /** Combat Awareness: a Solo's points. */
  awareness: {
    open: (actor) => Awareness.open(actor),
    isSolo: (actor) => Awareness.isSolo(actor),
    rank: (actor) => Awareness.rank(actor),
    current: (actor) => Awareness.current(actor),
    /** Assign points ({ precisionAttack: 3, ... }); in a started combat it's the Solo's Action on their Turn. */
    assign: (actor, alloc) => Awareness.assign(actor, alloc),
    mode: (actor) => Awareness.mode(actor)
  },
  cpr: CPR,
  hooks: HOOKS
};

Hooks.once("init", () => {
  Settings.register(SettingsMenu);
  Compat.loadTemplates([
    `${TEMPLATE_PATH}/carousel.hbs`,
    `${TEMPLATE_PATH}/biomon.hbs`,
    `${TEMPLATE_PATH}/holocall.hbs`,
    `${TEMPLATE_PATH}/incoming-call.hbs`,
    `${TEMPLATE_PATH}/chat-card.hbs`,
    `${TEMPLATE_PATH}/lab.hbs`,
    `${TEMPLATE_PATH}/lab-edit.hbs`,
    `${TEMPLATE_PATH}/triggers.hbs`,
    `${TEMPLATE_PATH}/environment.hbs`,
    `${TEMPLATE_PATH}/settings-menu.hbs`,
    `${TEMPLATE_PATH}/stakes.hbs`,
    `${TEMPLATE_PATH}/awareness.hbs`,
    `${TEMPLATE_PATH}/hub.hbs`,
    `${TEMPLATE_PATH}/hub-panel.hbs`,
    `${TEMPLATE_PATH}/hub-route.hbs`
  ]);

  // Conditions: the same handling whether placed through the API, the token HUD or a macro.
  Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => Conditions.onPreCreate(effect, data, options, userId));
  Hooks.on("createActiveEffect", (effect, options, userId) => Conditions.onCreate(effect, options, userId));
  Hooks.on("deleteActiveEffect", (effect, options, userId) => Conditions.onDelete(effect, options, userId));
  Hooks.on("preUpdateActiveEffect", (effect, changes, options, userId) => Conditions.onPreUpdate(effect, changes, options, userId));
  Hooks.on("createItem", (item, options, userId) => Conditions.onCreateItem(item, options, userId));
  Hooks.on("deleteItem", (item, options, userId) => Conditions.onDeleteItem(item, options, userId));
  Hooks.on(`${MODULE_ID}.conditionsChanged`, () => Registry.refresh());

  // Triggers and Wound States follow the actor's data (active GM).
  const pending = new Map();
  Hooks.on("updateActor", (actor, changes) => {
    if (!Compat.isActiveGM || !Triggers.watched(changes)) return;
    clearTimeout(pending.get(actor.uuid));
    pending.set(actor.uuid, setTimeout(() => {
      pending.delete(actor.uuid);
      Triggers.evaluate(actor).catch((err) => console.error(`${MODULE_ID} | triggers for ${actor.name}`, err));
    }, 100));
  });

  // Timed conditions end as world time passes (combat Rounds, SmallTime, Neon Hub skips).
  const expire = debounce(() => Conditions.expire().catch((err) => console.error(`${MODULE_ID} | expiring conditions`, err)), 200);
  Hooks.on("updateWorldTime", () => expire());

  // Combat bookkeeping.
  Hooks.on("updateCombat", (combat, changed) => {
    if ("round" in changed && combat.started) CombatTime.stampStart(combat);
  });
  Hooks.on("deleteCombat", (combat) => CombatTime.summary(combat));

  Hooks.on(Compat.chatRenderHook, (message, html) => Cards.activate(message, html));

  CombatTime.init();
  Turns.init();
  Environment.init();
  Carousel.init();
  Comms.init();
  Stakes.init();
  Awareness.init();
  Hub.init();
  TrackerHooks.init();

  game.modules.get(MODULE_ID).api = api;
});

Hooks.once("setup", () => {
  // Other modules add their conditions now (or call api.conditions.register during init).
  Hooks.callAll(HOOKS.registerConditions, api.conditions);
  Registry.refresh();
  CLT.install();
  game.neonConditions = api.conditions;
  Socket.init();
  Conditions.registerSocket();
  Links.registerSocket();
  Calls.registerSocket();
  Stakes.registerSocket();
  Hub.registerSocket();
});

Hooks.once("ready", async () => {
  CombatTime.apply();
  Carousel.render();
  if (Compat.isActiveGM) {
    try {
      // Wound States for everyone who might be on screen.
      const players = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
      const actors = new Set([...players, ...(game.combat?.combatants ?? []).map((c) => c.actor).filter(Boolean)]);
      for (const actor of actors) await Triggers.syncWound(actor);
      for (const combat of game.combats ?? []) await CombatTime.stampStart(combat);
      await Conditions.expire();
      if (CLT.pending && !CLT.active) ui.notifications.info(L(`${LANG}.Notify.CltFound`), { permanent: true });
    } catch (err) {
      console.error(`${MODULE_ID} | ready`, err);
    }
  }
  await Comms.ready().catch((err) => console.error(`${MODULE_ID} | comms`, err));
  Hooks.callAll(HOOKS.ready, api);
});

export { api, FLAGS };
