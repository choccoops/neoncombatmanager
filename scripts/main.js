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
import { Phone } from "./comms/phone.js";
import { Hud } from "./hud/hud.js";
import { Chat } from "./chat/chat.js";
import { Commands } from "./chat/commands.js";
import { format } from "./chat/format.js";
import { Stage } from "./chat/stage.js";
import { AdventureLog } from "./chat/log.js";
import { Environment } from "./environment/environment.js";
import { Sources } from "./environment/sources.js";
import { Stakes } from "./stakes/stakes.js";
import { Awareness } from "./awareness/awareness.js";
import { Hub } from "./hub/hub.js";
import { Roller } from "./roller/roller.js";
import { Ladder } from "./roller/ladder.js";
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
  /** Neon Chat: formatting, commands, the adventure log and the stage. */
  chat: {
    /** Discord-style formatting, as HTML. */
    format: (text) => format(text),
    /** Register a chat command (Chat Commander's shape; with Chat Commander running, it goes there). */
    register: (data, override) => Commands.register(data, override),
    unregister: (name) => Commands.unregister(name),
    commands: () => [...Commands.list.values()],
    log: (text, options) => AdventureLog.event(text, options),
    quote: (source, text, options) => AdventureLog.quote(source, text, options),
    narrate: (text) => Chat.narrate(text),
    stage: {
      get cast() {
        return Stage.cast;
      },
      add: (actors) => Stage.add(actors),
      remove: (actorId) => Stage.remove(actorId),
      mood: (mood, actorId) => Stage.mood(mood, actorId),
      speakAs: (actorId) => Stage.speakAs(actorId),
      clear: () => Stage.clear(),
      /** GM: stage mode (the table dims, other interface steps out) on, off or toggled. */
      focus: (value) => Stage.setFocus(value),
      director: () => Stage.openDirector(),
      editMoods: (actor) => Stage.editMoods(actor)
    }
  },
  /** The Action HUD: the controlled token's actions, laid out by each player. */
  hud: {
    render: () => Hud.render(),
    /** The layout a character gets for this user (theirs, else the user's, else the template). */
    layoutFor: (actor) => Hud.layoutFor(actor),
    saveLayout: (layout, actor) => Hud.saveLayout(layout, actor),
    clearLayout: (actor) => Hud.clearLayout(actor),
    customize: async (actor) => (await import("./hud/hud-editor.js")).HudEditor.open(actor),
    resetPosition: () => Hud.resetPosition()
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
  /** Holocalls, through Night City Messenger's phone. */
  holocall: {
    get available() {
      return Phone.on;
    },
    /** Call a character: as { as: actor } (one you own), else your selected token or character. */
    call: (actor, options) => Phone.call(actor, options),
    /** Open a character's phone (NCM's Agent, at its Calls tab). */
    open: (actor) => Phone.open(actor),
    numberOf: (actor) => Phone.numberOf(actor),
    /** Why a character can't call out (Comms Jam, dead ground on the map), or "". */
    blocked: (actor) => Phone.blocked(actor)
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
    /** A place's doorway ({ scene, tile, tag, open }), and walking through it as a character you own. */
    doorOf: (key) => Hub.doorOf(key),
    setDoor: (key, door) => Hub.setNote(key, door),
    go: (key, actorId) => Hub.go(key, actorId),
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
    `${TEMPLATE_PATH}/action-hud.hbs`,
    `${TEMPLATE_PATH}/action-hud-editor.hbs`,
    `${TEMPLATE_PATH}/stage-director.hbs`,
    `${TEMPLATE_PATH}/biomon.hbs`,
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
    `${TEMPLATE_PATH}/hub-route.hbs`,
    `${TEMPLATE_PATH}/hub-dossier.hbs`
  ]);

  // Conditions: the same handling whether placed through the API, the token HUD or a macro.
  Hooks.on("preCreateActiveEffect", (effect, data, options, userId) => Conditions.onPreCreate(effect, data, options, userId));
  Hooks.on("createActiveEffect", (effect, options, userId) => Conditions.onCreate(effect, options, userId));
  Hooks.on("deleteActiveEffect", (effect, options, userId) => Conditions.onDelete(effect, options, userId));
  Hooks.on("preUpdateActiveEffect", (effect, changes, options, userId) => Conditions.onPreUpdate(effect, changes, options, userId));
  Hooks.on("createItem", (item, options, userId) => Conditions.onCreateItem(item, options, userId));
  Hooks.on("deleteItem", (item, options, userId) => Conditions.onDeleteItem(item, options, userId));
  Hooks.on(`${MODULE_ID}.conditionsChanged`, () => Registry.refresh());

  // Triggers and Wound States follow the actor's data (active GM). A hit (HP going down) wakes
  // the unconscious: the HP before the change rides along in the update's options.
  Hooks.on("preUpdateActor", (actor, changes, options) => {
    const hp = foundry.utils.getProperty(changes, "system.derivedStats.hp.value");
    if (hp !== undefined) options[`${MODULE_ID}HpBefore`] = Number(actor.system?.derivedStats?.hp?.value);
  });
  Hooks.on("updateActor", (actor, changes, options) => {
    const before = options?.[`${MODULE_ID}HpBefore`];
    const after = Number(actor.system?.derivedStats?.hp?.value);
    if (Compat.isActiveGM && Number.isFinite(before) && after < before) {
      Conditions.onDamaged(actor).catch((err) => console.error(`${MODULE_ID} | waking ${actor.name}`, err));
    }
  });
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
  Hud.init();
  Chat.init();
  Comms.init();
  Stakes.init();
  Awareness.init();
  Hub.init();
  Roller.init();
  Ladder.init();
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
  Stakes.registerSocket();
  Hub.registerSocket();
  Chat.registerSocket();
});

Hooks.once("ready", async () => {
  CombatTime.apply();
  Carousel.render();
  Hud.render();
  Chat.ready();
  if (Compat.isActiveGM) {
    try {
      // Wound States for everyone who might be on screen.
      const players = game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
      const actors = new Set([...players, ...(game.combat?.combatants ?? []).map((c) => c.actor).filter(Boolean)]);
      for (const actor of actors) await Triggers.syncWound(actor);
      for (const combat of game.combats ?? []) await CombatTime.stampStart(combat);
      await Conditions.expire();
      await Hub.migratePins();
      if (CLT.pending && !CLT.active) ui.notifications.info(L(`${LANG}.Notify.CltFound`), { permanent: true });
    } catch (err) {
      console.error(`${MODULE_ID} | ready`, err);
    }
  }
  Comms.ready();
  await Roller.ready().catch((err) => console.error(`${MODULE_ID} | roller`, err));
  Hooks.callAll(HOOKS.ready, api);
});

export { api, FLAGS };
