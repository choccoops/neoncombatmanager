/**
 * Just enough of Foundry VTT (v12 behaviour) and Cyberpunk RED - CORE to run Neon Combat
 * Manager's logic in Node: documents are plain objects with the methods the module calls, hooks
 * really run, settings really store. Import this before any module script.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import Handlebars from "handlebars";

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const MODULE_ID = "cpr-neon-combat-manager";
export const lang = JSON.parse(readFileSync(path.join(root, "lang", "en.json"), "utf8"));
const lookup = (key) => key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), lang);
export const missingKeys = new Set();
const localize = (key) => {
  const v = lookup(key);
  if (typeof v === "string") return v;
  if (key.startsWith("NEONCOMBAT.")) missingKeys.add(key);
  return key;
};
const format = (key, data = {}) => localize(key).replace(/{(\w+)}/g, (m, p) => (p in data ? String(data[p]) : m));

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const getProperty = (obj, p) => String(p).split(".").reduce((o, k) => (o === null || o === undefined ? undefined : o[k]), obj);
const setProperty = (obj, p, v) => {
  const keys = String(p).split(".");
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k] ??= {};
  const last = keys.at(-1);
  if (last.startsWith("-=")) delete o[last.slice(2)];
  else o[last] = v;
};
const hasProperty = (obj, p) => getProperty(obj, p) !== undefined;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const flattenObject = (obj, prefix = "", out = {}) => {
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (isObj(v) && Object.keys(v).length) flattenObject(v, `${prefix}${k}.`, out);
    else out[`${prefix}${k}`] = v;
  }
  return out;
};
const mergeObject = (a, b, { inplace = true } = {}) => {
  const target = inplace ? a : clone(a);
  for (const [k, v] of Object.entries(b ?? {})) {
    if (isObj(v) && isObj(target[k])) target[k] = mergeObject(target[k], v, { inplace: true });
    else target[k] = clone(v);
  }
  return target;
};
let idCounter = 0;
export const randomID = (n = 16) => `id${String(++idCounter).padStart(n - 2, "0")}`;

class Collection extends Map {
  get contents() {
    return [...this.values()];
  }
  filter(fn) {
    return this.contents.filter(fn);
  }
  find(fn) {
    return this.contents.find(fn);
  }
  map(fn) {
    return this.contents.map(fn);
  }
  some(fn) {
    return this.contents.some(fn);
  }
  [Symbol.iterator]() {
    return this.values();
  }
}

/* ---------------------------------------- */
/*  Hooks                                   */
/* ---------------------------------------- */

const hooks = new Map();
let hookId = 0;
globalThis.Hooks = {
  on(name, fn) {
    if (!hooks.has(name)) hooks.set(name, []);
    fn.hookId = ++hookId;
    hooks.get(name).push(fn);
    return fn.hookId;
  },
  once(name, fn) {
    return this.on(name, fn);
  },
  off(name, id) {
    const list = hooks.get(name) ?? [];
    const i = list.findIndex((fn) => fn === id || fn.hookId === id);
    if (i >= 0) list.splice(i, 1);
  },
  callAll(name, ...args) {
    for (const fn of [...(hooks.get(name) ?? [])]) fn(...args);
    return true;
  },
  call(name, ...args) {
    for (const fn of [...(hooks.get(name) ?? [])]) if (fn(...args) === false) return false;
    return true;
  }
};
export const callHook = (name, ...args) => Hooks.call(name, ...args);

/* ---------------------------------------- */
/*  Globals                                 */
/* ---------------------------------------- */

globalThis.Handlebars = Handlebars;
Handlebars.registerHelper("localize", (key, options) => (options?.hash && Object.keys(options.hash).length ? format(key, options.hash) : localize(key)));
Handlebars.registerHelper("eq", (a, b) => a === b);

globalThis.foundry = {
  utils: { getProperty, setProperty, hasProperty, deepClone: clone, mergeObject, flattenObject, randomID, saveDataToFile() {} },
  applications: {
    api: {
      ApplicationV2: class {
        constructor(options = {}) {
          this.options = options;
        }
        render() {
          return this;
        }
        close() {}
      },
      HandlebarsApplicationMixin: (Base) => class extends Base {},
      DialogV2: { wait: async () => null, confirm: async () => true }
    },
    handlebars: {
      renderTemplate: async (p, data) => Handlebars.compile(readFileSync(path.join(root, p.replace(`modules/${MODULE_ID}/`, "")), "utf8"))(data),
      loadTemplates: async () => true
    }
  }
};

globalThis.CONST = { ACTIVE_EFFECT_MODES: { CUSTOM: 0, MULTIPLY: 1, ADD: 2, OVERRIDE: 5 }, TOKEN_DISPLAY_MODES: { NONE: 0, CONTROL: 10, OWNER_HOVER: 20, HOVER: 30, OWNER: 40, ALWAYS: 50 } };
export const notes = [];
globalThis.ui = { notifications: { info: (m) => notes.push(["info", m]), warn: (m) => notes.push(["warn", m]), error: (m) => notes.push(["error", m]) } };
globalThis.CONFIG = {
  statusEffects: [
    { id: "dead", name: "EFFECT.StatusDead", img: "icons/svg/skull.svg" },
    { id: "unconscious", name: "EFFECT.StatusUnconscious", img: "icons/svg/unconscious.svg" },
    { id: "bless", name: "EFFECT.StatusBlessed", img: "icons/svg/angel.svg" },
    { id: "neonhomeEncumbered", name: "Encumbered", img: "modules/cpr-neon-at-home/assets/encumbered.svg" }
  ],
  specialStatusEffects: { DEFEATED: "dead", INVISIBLE: "invisible", BLIND: "blind" },
  time: { roundTime: 6, turnTime: 0 }
};

globalThis.canvas = null;

/** uuid -> document */
export const registry = new Map();
globalThis.fromUuidSync = (uuid) => registry.get(uuid) ?? null;
globalThis.fromUuid = async (uuid) => registry.get(uuid) ?? null;

export const chat = [];
globalThis.ChatMessage = {
  create: async (data) => {
    const msg = { ...data, flags: data.flags ?? {} };
    msg.getFlag = (scope, key) => msg.flags?.[scope]?.[key];
    chat.push(msg);
    return msg;
  },
  getSpeaker: ({ actor } = {}) => ({ alias: actor?.name ?? "" })
};

/** Rolls: dice come from a queue tests can fill (default: always the die's maximum, halved). */
export const dice = [];
globalThis.Roll = class Roll {
  constructor(formula) {
    this.formula = formula;
  }
  _do() {
    this.total = this.formula.replace(/(\d+)d(\d+)/g, (m, n, d) => {
      let sum = 0;
      for (let i = 0; i < Number(n); i++) sum += dice.length ? dice.shift() : Math.ceil(Number(d) / 2);
      return String(sum);
    }).split(/(?=[+-])/).reduce((a, b) => a + Number(b), 0);
    return this;
  }
  evaluateSync() {
    return this._do();
  }
  async evaluate() {
    return this._do();
  }
};

/* ---------------------------------------- */
/*  Settings, users, game                   */
/* ---------------------------------------- */

const store = new Map();
const defs = new Map();
const gm = { id: "gm1", name: "GM", isGM: true, active: true, targets: new Set() };
const player = { id: "pl1", name: "Player", isGM: false, active: true, targets: new Set() };
const users = new Collection([[gm.id, gm], [player.id, player]]);
Object.defineProperty(users, "activeGM", { get: () => (gm.active ? gm : null) });

const modules = new Map([[MODULE_ID, { id: MODULE_ID, active: true, version: "test" }]]);

globalThis.game = {
  release: { generation: 12 },
  system: { id: "cyberpunk-red-core" },
  world: { id: "test" },
  i18n: { localize, format, has: (k) => typeof lookup(k) === "string" },
  settings: {
    settings: defs,
    register(scope, key, data) {
      defs.set(`${scope}.${key}`, data);
      if (!store.has(`${scope}.${key}`)) store.set(`${scope}.${key}`, clone(data.default));
    },
    registerMenu() {},
    get(scope, key) {
      if (!defs.has(`${scope}.${key}`)) throw new Error(`setting ${scope}.${key} not registered`);
      return clone(store.get(`${scope}.${key}`));
    },
    async set(scope, key, value) {
      store.set(`${scope}.${key}`, clone(value));
      defs.get(`${scope}.${key}`)?.onChange?.(value);
      return value;
    },
    storage: { get: () => worldSettings }
  },
  user: gm,
  users,
  time: {
    worldTime: 0,
    async advance(s) {
      const before = this.worldTime;
      this.worldTime += s;
      Hooks.callAll("updateWorldTime", this.worldTime, this.worldTime - before);
    }
  },
  modules,
  combats: new Collection(),
  actors: new Collection(),
  scenes: new Collection(),
  packs: new Map(),
  socket: { on() {}, emit() {} },
  combat: null
};

/** World settings of modules that aren't running (Condition Lab & Triggler's saved map). */
export const worldSettings = new Collection();

export function asGM(on = true) {
  game.user = on ? gm : player;
}

/* ---------------------------------------- */
/*  Documents                               */
/* ---------------------------------------- */

function flagApi(doc) {
  doc.getFlag = (scope, key) => getProperty(doc.flags?.[scope], key);
  doc.setFlag = async (scope, key, value) => doc.update({ [`flags.${scope}.${key}`]: value });
  doc.unsetFlag = async (scope, key) => doc.update({ [`flags.${scope}.-=${key}`]: null });
}

function makeEffect(actor, data) {
  const e = {
    documentName: "ActiveEffect",
    id: data._id ?? randomID(),
    name: data.name,
    img: data.img,
    description: data.description ?? "",
    changes: clone(data.changes ?? []),
    statuses: new Set(data.statuses ?? []),
    flags: clone(data.flags ?? {}),
    duration: clone(data.duration ?? {}),
    disabled: !!data.disabled,
    parent: actor,
    updateSource(u) {
      for (const [k, v] of Object.entries(u)) setProperty(this, k, clone(v));
    },
    async update(u, options = {}) {
      for (const [k, v] of Object.entries(u)) {
        if (k === "statuses") this.statuses = new Set(v);
        else setProperty(this, k, clone(v));
      }
      Hooks.callAll("updateActiveEffect", this, u, options, game.user.id);
      return this;
    },
    async delete(options = {}) {
      return actor.deleteEmbeddedDocuments("ActiveEffect", [this.id], options);
    }
  };
  e._id = e.id;
  flagApi(e);
  return e;
}

function makeItem(actor, data) {
  const item = { documentName: "Item", id: data._id ?? randomID(), name: data.name, type: data.type, system: clone(data.system ?? {}), flags: clone(data.flags ?? {}), parent: actor };
  item._id = item.id;
  flagApi(item);
  item.update = async (u) => {
    for (const [k, v] of Object.entries(u)) setProperty(item, k, clone(v));
    return item;
  };
  return item;
}

/**
 * A Cyberpunk RED character (or other actor type).
 * @param {object} data - { name, type, system } merged over a default character
 * @param {object[]} items - item data
 */
export function makeActor(data = {}, items = []) {
  const id = data._id ?? randomID();
  const actor = {
    documentName: "Actor",
    id,
    uuid: `Actor.${id}`,
    name: data.name ?? "Choom",
    type: data.type ?? "character",
    img: data.img ?? "icons/svg/mystery-man.svg",
    isOwner: true,
    hasPlayerOwner: data.hasPlayerOwner ?? true,
    flags: {},
    system: mergeObject(
      {
        stats: { body: { value: 6 }, will: { value: 5 }, ref: { value: 7 }, dex: { value: 6 }, move: { value: 5 }, int: { value: 5 }, luck: { value: 5, max: 5 }, emp: { value: 5, max: 5 } },
        derivedStats: { hp: { value: 40, max: 40 }, seriouslyWounded: 20, deathSave: { value: 6, penalty: 0, basePenalty: 0 }, humanity: { value: 50, max: 50 }, currentWoundState: "notWounded" },
        externalData: { currentArmorHead: { value: 11 }, currentArmorBody: { value: 11 } }
      },
      data.system ?? {},
      { inplace: false }
    ),
    effects: new Collection(),
    items: new Collection(),
    get statuses() {
      return new Set(this.effects.contents.flatMap((e) => [...e.statuses]));
    },
    get temporaryEffects() {
      return this.effects.contents.filter((e) => e.statuses.size || e.duration?.seconds);
    },
    testUserPermission: (user) => user.isGM || !!data.owners?.includes?.(user.id),
    getActiveTokens: () => [],
    async update(u, options = {}) {
      for (const [k, v] of Object.entries(u)) setProperty(this, k, clone(v));
      this._setWoundState();
      Hooks.callAll("updateActor", this, u, options, game.user.id);
      return this;
    },
    _setWoundState() {
      const ds = this.system.derivedStats;
      ds.currentWoundState = ds.hp.value < 1 ? "mortallyWounded" : ds.hp.value < ds.seriouslyWounded ? "seriouslyWounded" : ds.hp.value < ds.hp.max ? "lightlyWounded" : "notWounded";
    },
    async createEmbeddedDocuments(type, list, options = {}) {
      const made = [];
      for (const d of list) {
        if (type === "ActiveEffect") {
          const e = makeEffect(this, d);
          if (Hooks.call("preCreateActiveEffect", e, d, options, game.user.id) === false) continue;
          this.effects.set(e.id, e);
          made.push(e);
          Hooks.callAll("createActiveEffect", e, options, game.user.id);
        } else {
          const item = makeItem(this, d);
          this.items.set(item.id, item);
          made.push(item);
          Hooks.callAll("createItem", item, options, game.user.id);
        }
      }
      await settle();
      return made;
    },
    async deleteEmbeddedDocuments(type, ids, options = {}) {
      const col = type === "ActiveEffect" ? this.effects : this.items;
      const gone = [];
      for (const id of ids) {
        const doc = col.get(id);
        if (!doc) continue;
        col.delete(id);
        gone.push(doc);
        Hooks.callAll(type === "ActiveEffect" ? "deleteActiveEffect" : "deleteItem", doc, options, game.user.id);
      }
      await settle();
      return gone;
    },
    async updateEmbeddedDocuments(type, updates, options = {}) {
      const col = type === "ActiveEffect" ? this.effects : this.items;
      for (const u of updates) {
        const doc = col.get(u._id);
        const { _id, ...rest } = u;
        await doc?.update(rest, options);
      }
      return updates;
    }
  };
  actor._setWoundState();
  for (const i of items) actor.items.set(i._id ?? randomID(), makeItem(actor, i));
  registry.set(actor.uuid, actor);
  game.actors.set(actor.id, actor);
  return actor;
}

/** Let fire-and-forget hook work (side effects started from hooks) finish. */
export async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * A started combat with these actors, in order; the first one's Turn.
 * @returns combat with combatants (each with .actor, .token = null)
 */
export function makeCombat(actors, { round = 1, turn = 0 } = {}) {
  const id = randomID();
  const combatants = new Collection();
  const turns = actors.map((actor, i) => {
    const cb = { id: `cb${i}${id}`, actor, actorId: actor.id, name: actor.name, img: actor.img, initiative: 20 - i, hidden: false, defeated: false, token: null, tokenId: null, isOwner: true,
      async update(u) {
        Object.assign(cb, u);
        return cb;
      } };
    combatants.set(cb.id, cb);
    return cb;
  });
  const combat = {
    id, round, turn, flags: {}, combatants, turns, scene: null, active: true,
    get started() {
      return this.round > 0;
    },
    get combatant() {
      return this.turns[this.turn] ?? null;
    },
    getFlag(s, k) {
      return this.flags?.[s]?.[k];
    },
    async setFlag(s, k, v) {
      this.flags[s] ??= {};
      this.flags[s][k] = v;
    }
  };
  game.combats.set(id, combat);
  return combat;
}

/** Register the module's settings, as its init does. */
export async function registerSettings() {
  const { Settings } = await import("../../scripts/settings.js");
  Settings.register();
  return Settings;
}
