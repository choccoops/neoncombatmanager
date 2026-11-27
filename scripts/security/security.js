import { MODULE_ID, LANG, HOOKS } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Conditions } from "../conditions/engine.js";
import { Cards } from "../combat/cards.js";
import { Core } from "../neonfx/core.js";
import { Dv } from "../arsenal/dv.js";
import { Hack } from "../hack/hack.js";
import { Ladder } from "../roller/ladder.js";
import { Stairs } from "../senses/stairs.js";
import { Climb } from "../senses/climb.js";
import { L, esc, debounce } from "../util.js";
import { SECURITY_FLAG, KINDS, KIND_IDS, WEAPONS, COMBAT_NUMBER, cleanDevice, working, friendly, hasAccess, inCone, conePoints, centreOf, notices, beats, effectOf, weaponOf, label } from "./security-data.js";

const ART = `modules/${MODULE_ID}/assets/security`;
const SOURCE_ID = `${MODULE_ID}.camera`;
const SLOW_FLAG = "securitySlow";
/** How near a character has to be to work on a device by hand, and to reach its node with a deck, in m/yds. */
const REACH = 3;
const NET_REACH = 20;
const SEARCH_REACH = 12;
const COLORS = { camera: 0x05d9e8, turret: 0xff4d4d, melee: 0xff4d4d, seen: 0xf3e600, mine: 0x39ff88, off: 0x6c6f85 };

/**
 * Security systems on the map (corebook pg. 213-215; 2070 Compendium, Security Systems): cameras,
 * turrets and the floor, wall and room defenses, each a Tile the GM places.
 *
 * - **Cameras, turrets and automated blades** watch a field of view from their Tile, turned with
 *   the Tile and stopped by walls. It's drawn for the GM, and for players once they can see the
 *   device. A camera that sees someone without a pass reports it; a turret or a blade attacks
 *   with its Combat Number.
 * - **The rest** go off when someone without a pass steps on (or near) their Tile. A Check the
 *   book gives them is a button on a chat card for their player; what follows is applied to the
 *   character.
 * - **Hidden** devices are hidden Tiles: a Perception search finds the ones a character beats.
 * - **By hand**, next to one: Electronics/Security Tech against its DV puts it out of action.
 *   **With a deck**, within reach of its Control Node: Interface against the node's DV takes it.
 *   Whoever holds a pass or the node can switch it and, for a camera, look through it.
 *
 * The GM's client does everything that changes a Tile or a character.
 */
export const Security = {
  layer: null,
  /** "<tile id>:<token id>" for everyone a device has in view or on it now (GM's client). */
  inside: new Set(),
  /** "<tile id>:<token id>" -> the round (or second) a turret last attacked them. */
  fired: new Map(),
  polys: new Map(),
  feed: null,

  get on() {
    return Settings.get("security") !== false;
  },

  init() {
    const soon = debounce(() => this.draw(), 120);
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-security", title: `${LANG}.Security.Tool`, icon: "fa-solid fa-video", order: 125, visible: !!game.user?.isGM, onClick: () => this.open() }
    ], "tiles"));
    for (const [action, fn] of Object.entries({ secStep: "_step", secSearch: "_search", secCounter: "_counter", secControl: "_control", secToggle: "_toggle" })) Socket.on(action, (data, userId) => this[fn](data, userId));
    Socket.on("event:secFx", (data) => this.fxLocal(data));
    for (const h of ["canvasReady", "createTile", "updateTile", "deleteTile", "updateToken", "deleteToken", "controlToken", "sightRefresh", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    for (const h of ["createWall", "updateWall", "deleteWall", "canvasReady"]) Hooks.on(h, () => this.polys.clear());
    Hooks.on("canvasTearDown", () => {
      this.clear();
      this.stopView();
      this.inside.clear();
    });
    Hooks.on("updateToken", (doc, changed) => {
      if (!Compat.isActiveGM || !("x" in (changed ?? {}) || "y" in (changed ?? {}))) return;
      Stairs.walked(doc).then(() => this.sweep(doc, { moved: true })).catch((err) => console.error(`${MODULE_ID} | security`, err));
    });
    Hooks.on("deleteToken", (doc) => {
      if (Compat.isActiveGM) this.gone(doc).catch(() => null);
    });
    // Every Turn someone starts in a turret's view or on a live floor, it goes again.
    Hooks.on(HOOKS.turnStart, (combat, combatant) => {
      if (Compat.isActiveGM && combatant?.token) this.sweep(combatant.token, { turn: true }).catch((err) => console.error(`${MODULE_ID} | security`, err));
    });
    // A sealed room's gas acts at the top of the Round.
    Hooks.on("updateCombat", (combat, changed) => {
      if (Compat.isActiveGM && "round" in (changed ?? {})) this.round(combat).catch((err) => console.error(`${MODULE_ID} | security`, err));
    });
  },

  /* ---------------------------------------- */
  /*  The devices                             */
  /* ---------------------------------------- */

  grid: (scene = canvas?.scene) => ({ size: Number(scene?.grid?.size ?? canvas?.dimensions?.size) || 100, distance: Number(scene?.grid?.distance ?? canvas?.dimensions?.distance) || 2 }),
  unit: (scene = canvas?.scene) => scene?.grid?.units || "m",

  /** Every device on a scene: [{ id, doc, tile: { x, y, width, height, rotation, hidden }, d, name }]. */
  devices(scene = canvas?.scene) {
    const out = [];
    const count = {};
    for (const doc of scene?.tiles ?? []) {
      const d = cleanDevice(doc.flags?.[MODULE_ID]?.[SECURITY_FLAG]);
      if (!d) continue;
      count[d.kind] = (count[d.kind] ?? 0) + 1;
      out.push({ id: doc.id, doc, tile: { x: doc.x, y: doc.y, width: doc.width, height: doc.height, rotation: doc.rotation ?? 0, hidden: !!doc.hidden }, d, name: label(d, count[d.kind] - 1) || L(`${LANG}.Security.Kind.${d.kind}`) });
    }
    return out;
  },

  device(scene, id) {
    return this.devices(scene).find((x) => x.id === id) ?? null;
  },

  async save(doc, d) {
    await doc.setFlag(MODULE_ID, SECURITY_FLAG, d);
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
  },

  /** The middle of a token, in px. */
  mid: (doc) => Stairs.centre(doc),

  /**
   * A field of view that walls stop: Foundry's own sight polygon from the device, kept until a
   * wall or the device changes. Without one (no canvas), the plain cone.
   */
  poly(dev) {
    const g = this.grid(dev.doc?.parent);
    const origin = centreOf(dev.tile);
    const radius = (dev.d.range / g.distance) * g.size;
    const key = `${dev.id}:${origin.x}:${origin.y}:${dev.tile.rotation}:${dev.d.angle}:${radius}`;
    if (this.polys.has(key)) return this.polys.get(key);
    let poly = null;
    try {
      const backend = CONFIG?.Canvas?.polygonBackends?.sight;
      if (backend && canvas?.ready && dev.doc?.parent === canvas.scene) poly = backend.create(origin, { type: "sight", radius, angle: dev.d.angle, rotation: dev.tile.rotation, density: 24 });
    } catch (err) {
      console.warn(`${MODULE_ID} | security: no field of view`, err);
    }
    this.polys.set(key, poly);
    return poly;
  },

  /** Does a device have a point in view? */
  sees(dev, p) {
    const g = this.grid(dev.doc?.parent);
    const origin = centreOf(dev.tile);
    const radius = (dev.d.range / g.distance) * g.size;
    if (!inCone(origin, dev.tile.rotation, dev.d.angle, radius, p)) return false;
    const poly = this.poly(dev);
    return poly ? !!poly.contains(p.x, p.y) : true;
  },

  /** Does a device notice whoever stands where this token does? */
  noticed(dev, doc) {
    return notices(dev.tile, dev.d, this.mid(doc), this.grid(doc.parent), () => this.sees(dev, this.mid(doc)));
  },

  /* ---------------------------------------- */
  /*  Setting off                             */
  /* ---------------------------------------- */

  /**
   * GM's client: a token has moved (or starts its Turn). Every working device that notices it and
   * isn't its friend goes off: on the way in, again where its kind repeats (a live floor or a gun
   * each Turn, a laser grid or a slick floor on every move inside it).
   */
  async sweep(token, { moved = false, turn = false } = {}) {
    const doc = token?.document ?? token;
    if (!this.on || !doc?.parent || !doc.actor || doc.actor.flags?.[MODULE_ID]?.cover) return [];
    const went = [];
    for (const dev of this.devices(doc.parent)) {
      const key = `${dev.id}:${doc.id}`;
      const was = this.inside.has(key);
      const now = working(dev.d) && !friendly(dev.d, doc.actor.id) && this.noticed(dev, doc);
      if (!now) {
        if (was) {
          this.inside.delete(key);
          await this.left(dev, doc);
        }
        continue;
      }
      this.inside.add(key);
      const k = KINDS[dev.d.kind];
      const again = (turn && (k.repeats || k.act === "shoot" || k.act === "slash") && k.act !== "gas") || (moved && was && (k.act === "laser" || k.act === "slip"));
      if (was && !again) continue;
      went.push(dev.id);
      await this.trigger(dev, doc);
    }
    if (went.length) Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return went;
  },

  /** A token is gone from the scene: forgotten by every device, and free of what held it. */
  async gone(doc) {
    for (const key of [...this.inside]) if (key.endsWith(`:${doc.id}`)) this.inside.delete(key);
  },

  /** Off the carpet: whatever it slowed them by comes off. */
  async left(dev, doc) {
    const fx = [...(doc.actor?.effects ?? [])].filter((e) => e.flags?.[MODULE_ID]?.[SLOW_FLAG] === dev.id);
    if (fx.length) await doc.actor.deleteEmbeddedDocuments("ActiveEffect", fx.map((e) => e.id));
  },

  /** The top of a Round: a gas room's Check for everyone still in it. */
  async round(combat) {
    for (const dev of this.devices(combat?.scene ?? canvas?.scene)) {
      if (KINDS[dev.d.kind].act !== "gas" || !working(dev.d)) continue;
      for (const doc of dev.doc.parent?.tokens ?? []) if (this.inside.has(`${dev.id}:${doc.id}`)) await this.hazard(dev, doc);
    }
  },

  async trigger(dev, doc) {
    const act = KINDS[dev.d.kind].act;
    if (act === "report") return this.report(dev, doc);
    if (act === "shoot" || act === "slash") return this.attack(dev, doc);
    return this.hazard(dev, doc);
  },

  /** Who hears about a device: the GMs, and the players of whoever has a pass to it or runs its node. */
  watchers(dev) {
    const actors = [...dev.d.passes, ...dev.d.controllers].map((id) => game.actors?.get?.(id)).filter(Boolean);
    return [...new Set([...Cards.gms(), ...actors.flatMap((a) => Cards.owners(a))])];
  },

  /** A camera sees someone: it tells whoever watches it, and (in an encounter) the Ladder climbs a step. */
  async report(dev, doc) {
    this.fx({ kind: "spot", tile: dev.id, token: doc.id, sound: "secCamAlert" });
    const combat = game.combat?.started ? game.combat : null;
    let climbed = "";
    try {
      if (combat && Settings.get("awarenessLadder") && Settings.get("securityLadder") !== false && !dev.d.controllers.length) {
        const before = Ladder.level(combat);
        await Ladder.step(combat, 1);
        const after = Ladder.level(combat);
        if (after !== before) climbed = `<p>${L(`${LANG}.Security.Card.Ladder`, { level: L(`${LANG}.Ladder.${after}`) })}</p>`;
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | security: the Ladder`, err);
    }
    return Cards.post({ actor: null, title: L(`${LANG}.Security.Card.Spotted`, { device: esc(dev.name), name: esc(doc.name ?? "") }), kicker: L(`${LANG}.Security.Kind.camera`), img: `${ART}/camera.svg`, tone: "yellow", body: `<p>${L(`${LANG}.Security.Card.SpottedText`)}</p>${climbed}`, whisper: this.watchers(dev) });
  },

  stamp() {
    const c = game.combat?.started ? game.combat : null;
    return c ? `r${c.round}:${c.turn}` : `t${Math.floor(Date.now() / 3000)}`;
  },

  /** A turret or a blade attacks: its Combat Number + 1d10 against the range's DV, or the target's Evasion if they can and will. Once a Turn each. */
  async attack(dev, doc) {
    const key = `${dev.id}:${doc.id}`;
    const stamp = this.stamp();
    if (this.fired.get(key) === stamp) return null;
    this.fired.set(key, stamp);
    const melee = KINDS[dev.d.kind].act === "slash";
    const dist = Compat.measure(centreOf(dev.tile), this.mid(doc));
    const gun = weaponOf(dev.d);
    const dv = melee ? null : await Dv.at(gun.table, dist);
    if (!melee && (dv === null || dv < 0)) return null;
    const die = (await Conditions.roll("1d10", doc.actor)).total;
    const total = COMBAT_NUMBER + die;
    this.fx({ kind: melee ? "slash" : dev.d.weapon === "flamethrower" ? "flame" : "shot", tile: dev.id, token: doc.id, sound: melee ? "secBlade" : gun.sound, voice: "secTurretLock" });
    const name = esc(doc.name ?? "");
    const line = L(`${LANG}.Security.Card.${melee ? "Slash" : "Shot"}`, { device: esc(dev.name), name, number: COMBAT_NUMBER, die, total, weapon: L(`${LANG}.Security.Weapon.${melee ? "blade" : dev.d.weapon}`), dv: dv ?? "" });
    const data = { scene: doc.parent.id, tile: dev.id, token: doc.id, attack: total, dv: dv ?? "" };
    const dodges = melee || CPR.stat(doc.actor, "ref") >= 8;
    if (!dodges) return this.resolve(dev, doc, { attack: total, dv, lead: `<p>${line}</p>` });
    const buttons = [{ action: "sec-evade", label: L(`${LANG}.Security.Roll.Evade`), icon: "fa-solid fa-person-running", owner: true, data }];
    if (!melee) buttons.push({ action: "sec-tank", label: L(`${LANG}.Security.Roll.Tank`, { dv }), icon: "fa-solid fa-shield", owner: true, data });
    return Cards.post({ actor: doc.actor, title: L(`${LANG}.Security.Card.AttackTitle`, { device: esc(dev.name) }), kicker: L(`${LANG}.Security.Kind.${dev.d.kind}`), img: `${ART}/${dev.d.kind}.svg`, tone: "pink", body: `<p>${line}</p><p>${L(`${LANG}.Security.Card.${melee ? "EvadeMelee" : "EvadeOrTank"}`, { name })}</p>`, buttons });
  },

  /** The attack against what stood in its way: a miss, or the gun's damage applied (armor soaking it) and what its ammunition adds. */
  async resolve(dev, doc, { attack, dv = null, evasion = null, lead = "" }) {
    const name = esc(doc.name ?? "");
    const against = evasion ?? dv;
    const hit = beats(attack, against);
    const how = L(`${LANG}.Security.Card.${evasion === null ? "VsDv" : "VsEvasion"}`, { attack, against });
    const melee = KINDS[dev.d.kind].act === "slash";
    const post = (body, tone, buttons = []) => Cards.post({ actor: doc.actor, title: L(`${LANG}.Security.Card.${hit ? "Hit" : "Miss"}`, { device: esc(dev.name), name }), kicker: L(`${LANG}.Security.Kind.${dev.d.kind}`), img: `${ART}/${dev.d.kind}.svg`, tone, body, buttons });
    if (!hit) {
      await post(`${lead}<p>${how}</p>`, "cyan");
      return { hit: false };
    }
    const gun = melee ? { damage: "4d6" } : weaponOf(dev.d);
    let body = `${lead}<p>${how}</p>`;
    let took = 0;
    if (gun.damage) {
      const roll = await Conditions.roll(gun.damage, doc.actor);
      took = await this.hurt(doc.actor, roll.total, { armor: true, ablation: gun.ap ? 2 : 1 });
      body += `<p>${L(`${LANG}.Security.Card.Damage`, { dice: gun.damage, total: roll.total, took, name })}</p>`;
    }
    if (gun.fire) {
      await Conditions.add("onFireMild", doc.actor);
      body += `<p>${L(`${LANG}.Security.Card.Fire`, { name })}</p>`;
    }
    const buttons = gun.poison ? [{ action: "sec-poison", label: L(`${LANG}.Security.Roll.Resist`, { dv: 13 }), icon: "fa-solid fa-dice-d10", owner: true, data: { scene: doc.parent.id, tile: dev.id, token: doc.id } }] : [];
    if (gun.poison) body += `<p>${L(`${LANG}.Security.Card.Poison`, { name })}</p>`;
    await post(body, "pink", buttons);
    return { hit: true, took };
  },

  /** A floor, wall or room defense goes off under someone: a card with their Check if the book gives one, else what it does, now. */
  async hazard(dev, doc) {
    const d = dev.d;
    const actor = doc.actor;
    const e = effectOf(d, { grapple: Climb.hasLine(actor), meat: CPR.isMeat(actor) });
    this.fx({ kind: d.kind, tile: dev.id, token: doc.id, sound: `sec${d.kind[0].toUpperCase()}${d.kind.slice(1)}` });
    const name = esc(doc.name ?? "");
    const title = L(`${LANG}.Security.Card.Tripped`, { device: esc(dev.name), name });
    const base = { actor, title, kicker: L(`${LANG}.Security.Kind.${d.kind}`), img: `${ART}/${d.kind}.svg` };
    const what = `<p>${L(`${LANG}.Security.What.${d.kind}`, { name })}</p>`;
    if (KINDS[d.kind].once && !d.spent) await this.save(dev.doc, { ...d, spent: true });
    if (e.saved) return Cards.post({ ...base, tone: "cyan", body: `${what}<p>${L(`${LANG}.Security.Card.Saved.${e.saved}`, { name })}</p>` });
    if (e.check) {
      return Cards.post({ ...base, tone: "pink", body: `${what}<p>${L(`${LANG}.Security.Card.CheckAsk`, { name, skill: esc(e.check.skill), dv: e.check.dv })}</p>`, buttons: [{ action: "sec-check", label: L(`${LANG}.Security.Roll.Check`, { skill: esc(e.check.skill), dv: e.check.dv }), icon: "fa-solid fa-dice-d10", owner: true, data: { scene: doc.parent.id, tile: dev.id, token: doc.id } }] });
    }
    const did = await this.apply(dev, doc, e);
    return Cards.post({ ...base, tone: "pink", body: `${what}${did}` });
  },

  /** What a device does to a character, done: damage, a slowed MOVE, conditions, a drop. The lines for the card. */
  async apply(dev, doc, e) {
    const actor = doc.actor;
    const name = esc(doc.name ?? "");
    let out = "";
    if (e.damage) {
      const roll = await Conditions.roll(e.damage, actor);
      const took = e.direct ? await this.hurt(actor, roll.total) : await this.hurt(actor, roll.total, { armor: true, ablation: e.ablate ? 1 : 0 });
      out += `<p>${L(`${LANG}.Security.Card.${e.direct ? "Direct" : e.ablate ? "Damage" : "DamageKept"}`, { dice: e.damage, total: roll.total, took, name })}</p>`;
    }
    if (e.slow) {
      const roll = await Conditions.roll(e.slow, actor);
      await this.left(dev, doc);
      await actor.createEmbeddedDocuments("ActiveEffect", [{
        name: L(`${LANG}.Security.Slowed`, { device: dev.name }), img: `${ART}/${dev.d.kind}.svg`,
        changes: [{ key: "system.stats.move.value", mode: 2, value: String(-roll.total) }],
        flags: { [MODULE_ID]: { [SLOW_FLAG]: dev.id }, "cyberpunk-red-core": { changes: { cats: { 0: "stat" }, situational: { 0: { isSituational: false, onByDefault: true } } } } }
      }]);
      out += `<p>${L(`${LANG}.Security.Card.Slow`, { dice: e.slow, total: roll.total, name })}</p>`;
    }
    for (const c of e.conditions ?? []) await Conditions.add(c, actor);
    if (e.conditions?.length) out += `<p>${L(`${LANG}.Security.Card.Conditions.${dev.d.kind}`, { name })}</p>`;
    if (e.fall >= 10) await Climb.land(doc, { total: e.fall, base: Number(doc.elevation) || 0 });
    return out;
  },

  /**
   * Damage, applied now. With armor: through Cyberpunk RED's own damage, body armor soaking it and
   * worn away by `ablation` when any gets through. Without: straight to HP. What got through.
   */
  async hurt(actor, amount, { armor = false, ablation = 1 } = {}) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    if (!n || !actor) return 0;
    const before = CPR.hp(actor).value;
    if (armor && typeof actor._applyDamage === "function") {
      await actor._applyDamage(n, 0, "body", ablation, "", 0, 0, true, { damageReductionRole: false, damageReductionAE: false, useShield: false, brainDamageReduction: false });
    } else if (armor) {
      const through = Math.max(0, n - CPR.armor(actor).body);
      await CPR.damageHP(actor, through, { reason: L(`${LANG}.Security.Title`) });
      if (through > 0 && ablation > 0) await CPR.ablate(actor, "body", ablation);
    } else await CPR.damageHP(actor, n, { reason: L(`${LANG}.Security.Title`) });
    return Math.max(0, before - CPR.hp(actor).value);
  },

  /* ---------------------------------------- */
  /*  The cards' buttons                      */
  /* ---------------------------------------- */

  /** A button on one of the security cards: the character it calls on rolls, and the GM's client carries on. */
  async click(message, btn, event, actor) {
    if (!actor?.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
    const d = { ...btn.dataset };
    const dev = this.device(game.scenes?.get?.(d.scene) ?? canvas?.scene, d.tile);
    let skill = null;
    if (d.ncmAction === "sec-evade") skill = "Evasion";
    else if (d.ncmAction === "sec-poison") skill = "Resist Torture/Drugs";
    else if (d.ncmAction === "sec-check" && dev) skill = effectOf(dev.d).check?.skill ?? null;
    btn.disabled = true;
    let total = null;
    if (skill) {
      const mine = await Climb.rollFor(actor, skill, event);
      if (!mine) {
        btn.disabled = false;
        return null;
      }
      total = mine.total;
    }
    return Socket.request("secStep", { ...d, action: d.ncmAction, total, message: message?.id ?? null });
  },

  /** GM's client: a card's Check has been rolled (or the DV taken). Each card is answered once. */
  async _step(data, userId) {
    const sc = game.scenes?.get?.(data.scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(data.token);
    const dev = this.device(sc, data.tile);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!doc?.actor || !dev || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return null;
    const msg = data.message ? game.messages?.get?.(data.message) : null;
    if (msg?.getFlag?.(MODULE_ID, "done")) return null;
    if (msg?.setFlag) await msg.setFlag(MODULE_ID, "done", true);
    const total = Number(data.total) || 0;
    const name = esc(doc.name ?? "");
    switch (data.action) {
      case "sec-evade":
        return this.resolve(dev, doc, { attack: Number(data.attack), evasion: total });
      case "sec-tank":
        return this.resolve(dev, doc, { attack: Number(data.attack), dv: Number(data.dv) });
      case "sec-poison": {
        const ok = beats(total, 13);
        let body = `<p>${L(`${LANG}.Security.Card.Rolled`, { name, skill: "Resist Torture/Drugs", dv: 13, total })}</p>`;
        if (!ok) {
          const roll = await Conditions.roll("2d6", doc.actor);
          const took = await this.hurt(doc.actor, roll.total);
          body += `<p>${L(`${LANG}.Security.Card.Direct`, { dice: "2d6", total: roll.total, took, name })}</p>`;
        }
        await Cards.post({ actor: doc.actor, title: L(`${LANG}.Security.Card.${ok ? "Resisted" : "Poisoned"}`, { name }), kicker: L(`${LANG}.Security.Kind.turret`), img: `${ART}/turret.svg`, tone: ok ? "cyan" : "pink", body });
        return { ok };
      }
      case "sec-check": {
        const e = effectOf(dev.d, { grapple: Climb.hasLine(doc.actor), meat: CPR.isMeat(doc.actor) });
        if (!e.check) return null;
        const ok = beats(total, e.check.dv);
        let body = `<p>${L(`${LANG}.Security.Card.Rolled`, { name, skill: esc(e.check.skill), dv: e.check.dv, total })}</p>`;
        if (!ok) body += await this.apply(dev, doc, e);
        await Cards.post({ actor: doc.actor, title: L(`${LANG}.Security.Card.${ok ? "Passed" : "Failed"}.${dev.d.kind}`, { name }), kicker: L(`${LANG}.Security.Kind.${dev.d.kind}`), img: `${ART}/${dev.d.kind}.svg`, tone: ok ? "cyan" : "pink", body });
        return { ok };
      }
      default:
        return null;
    }
  },

  /* ---------------------------------------- */
  /*  Finding, disabling, taking              */
  /* ---------------------------------------- */

  /** How far a token is from a device, in m/yds. */
  distance(dev, doc) {
    return Compat.measure(centreOf(dev.tile), this.mid(doc));
  },

  /** Is there a wall between a token and a device? */
  blocked(dev, doc) {
    try {
      return !!CONFIG?.Canvas?.polygonBackends?.sight?.testCollision?.(this.mid(doc), centreOf(dev.tile), { type: "sight", mode: "any" });
    } catch {
      return false;
    }
  },

  /** The devices a character can do something about: the ones they can see, with what's on offer. */
  options(token) {
    const doc = token?.document ?? token;
    if (!this.on || !doc?.actor || !doc.parent) return [];
    const rig = Hack.rig(doc.actor);
    const out = [];
    for (const dev of this.devices(doc.parent)) {
      if (dev.tile.hidden && !game.user?.isGM) continue;
      const dist = this.distance(dev, doc);
      const access = hasAccess(dev.d, doc.actor.id);
      const alive = !(dev.d.hpMax > 0 && dev.d.hp <= 0);
      const can = [];
      if (access && dev.d.kind === "camera" && working(dev.d)) can.push("view");
      if (access && alive) can.push("toggle");
      if (!access && alive && dist <= REACH) can.push("counter");
      if (!access && alive && rig.deck && dist <= NET_REACH) can.push("control");
      if (can.length) out.push({ dev, dist, can });
    }
    return out.sort((a, b) => a.dist - b.dist);
  },

  /** The Action HUD: a search for hidden security, and each device in reach with its buttons. */
  entries(actor, token) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    if (!this.on || !tok) return [];
    const icons = { view: "fa-solid fa-eye", toggle: "fa-solid fa-power-off", counter: "fa-solid fa-screwdriver-wrench", control: "fa-solid fa-network-wired" };
    const unit = this.unit(tok.document?.parent);
    const out = [{ key: "sec:search", label: L(`${LANG}.Security.Hud.Search`), sub: L(`${LANG}.Security.Hud.SearchSub`), icon: "fa-solid fa-magnifying-glass" }];
    for (const o of this.options(tok).slice(0, 6)) {
      out.push({
        key: `sec:device:${o.dev.id}`, label: o.dev.name, img: `${ART}/${o.dev.d.kind}.svg`, sub: `${L(`${LANG}.Security.Kind.${o.dev.d.kind}`)} · ${Math.round(o.dist)} ${unit}${working(o.dev.d) ? "" : ` · ${L(`${LANG}.Security.Off`)}`}`,
        buttons: o.can.map((c) => ({ key: `sec:${c}:${o.dev.id}`, label: L(`${LANG}.Security.Hud.${c}`, { dv: c === "counter" ? KINDS[o.dev.d.kind].counter.dv : o.dev.d.node, min: KINDS[o.dev.d.kind].counter.min, state: L(`${LANG}.Security.${o.dev.d.on ? "SwitchOff" : "SwitchOn"}`) }), icon: icons[c] }))
      });
    }
    return out;
  },

  /** An Action HUD key: "search", "view:<tile>", "toggle:<tile>", "counter:<tile>", "control:<tile>". */
  async act(token, key, event = null) {
    const doc = token?.document ?? token;
    const [, what, id] = String(key).split(":");
    if (!doc?.actor || !doc.parent) return null;
    const ids = { scene: doc.parent.id, token: doc.id, tile: id };
    if (what === "search") {
      const r = await CPR.skillCheck(doc.actor, "Perception", { event, stat: "int" });
      return r ? Socket.request("secSearch", { ...ids, total: r.total }) : null;
    }
    if (what === "view") return this.view(id);
    if (what === "toggle") return Socket.request("secToggle", ids);
    if (what === "counter") {
      const r = await CPR.skillCheck(doc.actor, "Electronics/Security Tech", { event, stat: "tech" });
      return r ? Socket.request("secCounter", { ...ids, total: r.total }) : null;
    }
    if (what === "control") {
      const dev = this.device(doc.parent, id);
      const total = dev ? await Hack.interfaceCheck(doc.actor, Hack.rig(doc.actor), { title: L(`${LANG}.Security.Hud.ControlTitle`, { device: dev.name }), ability: "control", event }) : null;
      return total === null || total === undefined ? null : Socket.request("secControl", { ...ids, total });
    }
    return null;
  },

  who(data, userId) {
    const sc = game.scenes?.get?.(data.scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(data.token);
    const user = game.users?.get?.(userId) ?? game.user;
    const ok = !!doc?.actor && (user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner);
    return { sc, doc: ok ? doc : null, dev: data.tile ? this.device(sc, data.tile) : null };
  },

  /** GM's client: a Perception search. Hidden devices in reach, with nothing in the way, whose DV it beats are found. */
  async _search(data, userId) {
    const { sc, doc } = this.who(data, userId);
    if (!doc) return null;
    const found = [];
    for (const dev of this.devices(sc)) {
      if (!dev.tile.hidden || this.distance(dev, doc) > SEARCH_REACH || this.blocked(dev, doc)) continue;
      if (!beats(data.total, KINDS[dev.d.kind].spot)) continue;
      await dev.doc.update({ hidden: false });
      found.push(dev);
    }
    const name = esc(doc.name ?? "");
    await Cards.post({ actor: doc.actor, title: L(`${LANG}.Security.Card.${found.length ? "Found" : "FoundNone"}`, { name }), kicker: L(`${LANG}.Security.Title`), tone: found.length ? "yellow" : "cyan", body: found.length ? `<p>${found.map((f) => `<b>${esc(f.name)}</b> (${L(`${LANG}.Security.Kind.${f.d.kind}`)})`).join(", ")}</p>` : "", whisper: Cards.owners(doc.actor) });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return { found: found.map((f) => f.id) };
  },

  /** GM's client: Electronics/Security Tech against the device's DV. Beaten, it's out of action. */
  async _counter(data, userId) {
    const { doc, dev } = this.who(data, userId);
    if (!doc || !dev || this.distance(dev, doc) > REACH) return null;
    const k = KINDS[dev.d.kind].counter;
    const ok = beats(data.total, k.dv);
    if (ok) await this.save(dev.doc, { ...dev.d, on: false });
    if (ok) this.fx({ kind: "off", tile: dev.id, sound: "secOff" });
    await Cards.post({ actor: doc.actor, title: L(`${LANG}.Security.Card.${ok ? "Countered" : "CounterFail"}`, { name: esc(doc.name ?? ""), device: esc(dev.name) }), kicker: L(`${LANG}.Security.Kind.${dev.d.kind}`), img: `${ART}/${dev.d.kind}.svg`, tone: ok ? "cyan" : "pink", body: `<p>${L(`${LANG}.Security.Card.CounterText`, { total: data.total, dv: k.dv, min: k.min })}</p>` });
    return { ok };
  },

  /** GM's client: Interface against the Control Node's DV. Beaten, the device is theirs till they give it up. */
  async _control(data, userId) {
    const { doc, dev } = this.who(data, userId);
    if (!doc || !dev || this.distance(dev, doc) > NET_REACH) return null;
    const ok = beats(data.total, dev.d.node);
    if (ok) await this.save(dev.doc, { ...dev.d, controllers: [...new Set([...dev.d.controllers, doc.actor.id])] });
    if (ok) this.fx({ kind: "hacked", tile: dev.id, sound: "secHacked" });
    await Cards.post({ actor: doc.actor, title: L(`${LANG}.Security.Card.${ok ? "Controlled" : "ControlFail"}`, { name: esc(doc.name ?? ""), device: esc(dev.name) }), kicker: L(`${LANG}.Security.Kind.${dev.d.kind}`), img: `${ART}/${dev.d.kind}.svg`, tone: ok ? "cyan" : "pink", body: `<p>${L(`${LANG}.Security.Card.ControlText`, { total: data.total, dv: dev.d.node })}</p>`, whisper: ok ? Cards.owners(doc.actor) : null });
    return { ok };
  },

  /** GM's client: whoever holds a pass or the node switches a device on or off. */
  async _toggle(data, userId) {
    const { doc, dev } = this.who(data, userId);
    if (!doc || !dev || !hasAccess(dev.d, doc.actor.id)) return null;
    await this.save(dev.doc, { ...dev.d, on: !dev.d.on });
    this.fx({ kind: "off", tile: dev.id, sound: dev.d.on ? "secOff" : "secOn" });
    return { on: !dev.d.on };
  },

  /* ---------------------------------------- */
  /*  Looking through a camera                */
  /* ---------------------------------------- */

  /** The cameras this player may look through: the GM all of them, a player the ones a character of theirs has a pass to or runs. */
  cameras(scene = canvas?.scene) {
    const mine = (game.actors ?? []).filter((a) => a.isOwner).map((a) => a.id);
    return this.devices(scene).filter((dev) => dev.d.kind === "camera" && working(dev.d) && (game.user?.isGM || mine.some((id) => hasAccess(dev.d, id))));
  },

  /** Look through a camera: its field of view lit up as this player's own, the view moved to it, a frame over the screen. */
  view(id = null) {
    const cams = this.cameras();
    const dev = cams.find((c) => c.id === id) ?? cams[0];
    if (!dev) return false;
    this.dropSource();
    const g = this.grid();
    const origin = centreOf(dev.tile);
    const back = this.feed?.back ?? { ...(canvas.scene?._viewPosition ?? {}) };
    const viewer = canvas.tokens?.controlled?.[0] ?? canvas.tokens?.placeables?.find((t) => t.isOwner) ?? null;
    const Cls = foundry?.canvas?.sources?.PointVisionSource ?? CONFIG?.Canvas?.visionSourceClass;
    if (viewer && Cls) {
      try {
        const src = new Cls({ sourceId: SOURCE_ID, object: viewer });
        src.initialize({ x: origin.x, y: origin.y, elevation: viewer.document?.elevation ?? 0, radius: (dev.d.range / g.distance) * g.size, externalRadius: 0, angle: dev.d.angle, rotation: dev.tile.rotation, visionMode: "basic", blinded: false, disabled: false });
        if (typeof src.add === "function") src.add();
        else canvas.effects?.visionSources?.set?.(SOURCE_ID, src);
        this._source = src;
        canvas.perception?.update?.({ refreshVision: true, refreshLighting: true });
      } catch (err) {
        console.warn(`${MODULE_ID} | security: no view through the camera`, err);
      }
    }
    this.feed = { id: dev.id, back };
    canvas.animatePan?.({ x: origin.x, y: origin.y, duration: 450 });
    Core.sound("secCamOn");
    this.frame(dev, cams);
    this.draw();
    return true;
  },

  dropSource() {
    const s = this._source;
    this._source = null;
    if (!s) return;
    try {
      (s.remove ?? s.destroy)?.call(s);
      canvas?.effects?.visionSources?.delete?.(SOURCE_ID);
      canvas?.perception?.update?.({ refreshVision: true, refreshLighting: true });
    } catch {
      /* gone with the canvas */
    }
  },

  stopView() {
    const feed = this.feed;
    this.feed = null;
    this.dropSource();
    globalThis.document?.getElementById?.("ncm-cam")?.remove();
    if (feed?.back && Number.isFinite(feed.back.x)) canvas?.animatePan?.({ x: feed.back.x, y: feed.back.y, scale: feed.back.scale, duration: 350 });
    if (feed) this.draw();
  },

  /** The frame over the screen while looking through a camera: its name, a REC light, and the way to the next one or out. */
  frame(dev, cams) {
    const root = globalThis.document;
    if (!root?.body) return;
    root.getElementById("ncm-cam")?.remove();
    const el = root.createElement("div");
    el.id = "ncm-cam";
    const i = cams.findIndex((c) => c.id === dev.id);
    el.innerHTML = `<div class="ncm-cam-scan"></div><div class="ncm-cam-top"><span class="ncm-cam-rec"></span> REC <b>${esc(dev.name)}</b><small>${i + 1}/${cams.length}</small></div>
      <div class="ncm-cam-bar"><button type="button" data-cam="prev"><i class="fa-solid fa-chevron-left"></i></button><button type="button" data-cam="exit"><i class="fa-solid fa-xmark"></i> ${L(`${LANG}.Security.Cam.Exit`)}</button><button type="button" data-cam="next"><i class="fa-solid fa-chevron-right"></i></button></div>`;
    el.addEventListener("click", (ev) => {
      const what = ev.target?.closest?.("[data-cam]")?.dataset?.cam;
      if (what === "exit") this.stopView();
      else if (what) this.view(cams[(i + (what === "next" ? 1 : cams.length - 1)) % cams.length]?.id);
    });
    root.body.appendChild(el);
  },

  /* ---------------------------------------- */
  /*  Effects                                 */
  /* ---------------------------------------- */

  /** Play a device's effect on every client. */
  fx(data) {
    const full = { ...data, scene: canvas?.scene?.id };
    Socket.broadcast("secFx", full);
    this.fxLocal(full);
  },

  /** JB2A pieces by what happened; each falls back to nothing when it isn't installed. */
  fxLocal({ kind, tile, token, sound, voice, scene }) {
    try {
      if (!this.on || (scene && scene !== canvas?.scene?.id)) return;
      if (voice && Settings.get("securityVoices") !== false) Core.sound(voice);
      if (sound) setTimeout(() => Core.sound(sound), voice ? 500 : 0);
      if (!Core.on || !Core.sequencer) return;
      const dev = this.device(canvas.scene, tile);
      const tok = token ? canvas.tokens?.get?.(token) : null;
      if (!dev || (dev.tile.hidden && !game.user?.isGM && kind === "spot")) return;
      const at = centreOf(dev.tile);
      const pick = (bases, wanted = []) => Core.jb2a(bases, wanted);
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      const beam = (file, o = {}) => file && tok && seq.effect().file(file).atLocation(at).stretchTo(tok).delay(o.delay ?? 0).repeats(o.repeats ?? 1, o.gap ?? 120);
      const burst = (file, where, scale = 1, o = {}) => file && seq.effect().file(file).atLocation(where).scaleToObject?.(scale).opacity(o.opacity ?? 1).belowTokens(!!o.below).delay(o.delay ?? 0);
      const on = tok ?? at;
      switch (kind) {
        case "spot":
          burst(pick(["jb2a.ui.indicator", "jb2a.markers.02", "jb2a.impact.004"], ["yellow", "bluewhite", "blue"]), on, 1.5);
          break;
        case "shot":
          beam(pick(["jb2a.bullet.01", "jb2a.bullet.Snipe", "jb2a.lasershot"], ["orange", "blue", "green"]), { delay: 500, repeats: 3 });
          break;
        case "flame":
          beam(pick(["jb2a.breath_weapons.fire.line", "jb2a.burning_hands.01", "jb2a.fire_bolt"], ["orange"]), { delay: 400 });
          break;
        case "slash":
          burst(pick(["jb2a.melee_generic.slashing.one_handed", "jb2a.melee_generic.slash", "jb2a.sword.melee.01"], ["white", "blue"]), on, 2, { delay: 300 });
          break;
        case "electric":
          burst(pick(["jb2a.static_electricity.03", "jb2a.static_electricity.01", "jb2a.chain_lightning.secondary"], ["blue"]), on, 1.6);
          break;
        case "laser":
          burst(pick(["jb2a.impact.011", "jb2a.impact.004"], ["red", "orange"]), on, 1.4);
          break;
        case "punchers":
          burst(pick(["jb2a.impact.ground_crack", "jb2a.impact.008", "jb2a.impact.004"], ["orange", "white", "blue"]), on, 2);
          break;
        case "tipFloor":
          burst(pick(["jb2a.impact.ground_crack.still_frame", "jb2a.impact.ground_crack", "jb2a.smoke.puff.centered"], ["grey", "orange"]), at, 1.2, { below: true });
          break;
        case "stunPanel":
          burst(pick(["jb2a.impact.003", "jb2a.explosion.01", "jb2a.impact.004"], ["blue", "bluewhite", "orange"]), at, 5);
          break;
        case "sleepGas":
        case "bloodSwarm":
          burst(pick(["jb2a.fog_cloud.01", "jb2a.fog_cloud.1", "jb2a.smoke.puff.centered"], kind === "bloodSwarm" ? ["red", "white"] : ["green", "white"]), at, 1, { opacity: 0.75 });
          break;
        case "goop":
        case "tanglefoot":
        case "slipFloor":
          burst(pick(["jb2a.liquid.splash", "jb2a.grease", "jb2a.smoke.puff.centered"], ["green", "blue", "grey"]), on, 1.5, { below: true });
          break;
        case "hacked":
          burst(pick(["jb2a.static_electricity.02", "jb2a.token_border.circle.static", "jb2a.impact.004"], ["blue", "green"]), at, 1.5);
          break;
        case "off":
          burst(pick(["jb2a.smoke.puff.centered", "jb2a.static_electricity.01"], ["grey", "blue"]), at, 1.2);
          break;
        default:
      }
      seq.play();
    } catch (err) {
      console.warn(`${MODULE_ID} | security effect ${kind}`, err);
    }
  },

  /* ---------------------------------------- */
  /*  Drawn on the map                        */
  /* ---------------------------------------- */

  clear() {
    const l = this.layer;
    this.layer = null;
    try {
      l?.parent?.removeChild(l);
      l?.destroy({ children: true });
    } catch {
      /* gone with the canvas */
    }
  },

  /** Each device this player can see: its field of view (who's in it turns it yellow), and for the GM its name and state. */
  draw() {
    this.clear();
    if (!this.on || !canvas?.ready || typeof PIXI === "undefined") return 0;
    const gm = !!game.user?.isGM;
    const mine = (game.actors ?? []).filter((a) => a.isOwner).map((a) => a.id);
    const layer = new PIXI.Container();
    layer.eventMode = "none";
    let n = 0;
    const g = this.grid();
    for (const dev of this.devices()) {
      if (dev.tile.hidden && !gm) continue;
      const k = KINDS[dev.d.kind];
      const at = centreOf(dev.tile);
      const live = working(dev.d);
      const own = mine.some((id) => hasAccess(dev.d, id));
      if (k.watch === "cone" && live) {
        const seen = (canvas.tokens?.placeables ?? []).some((t) => t.actor && t.visible !== false && !friendly(dev.d, t.actor.id) && this.noticed(dev, t.document));
        const color = seen ? COLORS.seen : own ? COLORS.mine : COLORS[dev.d.kind] ?? COLORS.camera;
        const poly = this.poly(dev);
        const pts = poly?.points?.length ? poly.points : conePoints(at, dev.tile.rotation, dev.d.angle, (dev.d.range / g.distance) * g.size);
        const cone = new PIXI.Graphics();
        const watching = this.feed?.id === dev.id;
        cone.beginFill(color, watching ? 0.05 : seen ? 0.2 : 0.11).lineStyle(2, color, 0.55).drawPolygon(pts).endFill();
        layer.addChild(cone);
        n += 1;
      }
      if (gm || own) {
        const state = !dev.d.on ? L(`${LANG}.Security.Off`) : dev.d.hpMax > 0 && dev.d.hp <= 0 ? L(`${LANG}.Security.Destroyed`) : dev.d.spent ? L(`${LANG}.Security.Spent`) : "";
        const words = [dev.name, gm && dev.d.hpMax > 0 ? `${dev.d.hp}/${dev.d.hpMax}` : "", state, gm && dev.tile.hidden ? L(`${LANG}.Security.Hidden`) : "", dev.d.controllers.length ? "⛓" : ""].filter(Boolean).join(" · ");
        const text = new PIXI.Text(words, { fontFamily: globalThis.CONFIG?.canvasTextStyle?.fontFamily ?? "Signika", fontSize: 13, fontWeight: "bold", fill: live ? (own && !gm ? COLORS.mine : COLORS.camera) : COLORS.off, stroke: 0x000000, strokeThickness: 4, align: "center" });
        text.anchor.set(0.5, 0);
        text.position.set(at.x, dev.tile.y + dev.tile.height + 2);
        layer.addChild(text);
        n += 1;
      }
    }
    if (!n) {
      layer.destroy();
      return 0;
    }
    (canvas.interface ?? canvas.stage).addChild(layer);
    this.layer = layer;
    return n;
  },

  /* ---------------------------------------- */
  /*  The GM's tools                          */
  /* ---------------------------------------- */

  /** GM: put a new device on the map (in the middle of the view), on a Tile with its own art. */
  async place(kind, { x = null, y = null, hidden = null } = {}) {
    if (!game.user?.isGM || !canvas?.scene || !KINDS[kind]) return null;
    const k = KINDS[kind];
    const g = this.grid();
    const squares = k.watch === "cone" || kind === "stunPanel" ? 1 : 2;
    const size = g.size * squares;
    const mid = { x: x ?? canvas.stage?.pivot?.x ?? canvas.dimensions.width / 2, y: y ?? canvas.stage?.pivot?.y ?? canvas.dimensions.height / 2 };
    const snap = (v) => Math.round((v - size / 2) / g.size) * g.size;
    const [doc] = await canvas.scene.createEmbeddedDocuments("Tile", [{
      x: snap(mid.x), y: snap(mid.y), width: size, height: size, rotation: 0, hidden: hidden ?? k.spot > 0,
      texture: { src: `${ART}/${kind}.svg` },
      flags: { [MODULE_ID]: { [SECURITY_FLAG]: cleanDevice({ kind }) } }
    }]);
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return doc ?? null;
  },

  /**
   * GM: the Security window. With a device's Tile selected: its settings. Otherwise: pick a kind
   * and it's put on the map; a plain Tile selected becomes that device and keeps its own art.
   */
  async open() {
    if (!game.user?.isGM || !canvas?.scene) return null;
    const picked = canvas.tiles?.controlled?.[0]?.document ?? null;
    const now = picked ? cleanDevice(picked.flags?.[MODULE_ID]?.[SECURITY_FLAG]) : null;
    const d = now ?? cleanDevice({ kind: "camera" });
    const unit = this.unit();
    const sel = (name, options, value) => `<select name="${name}">${options.map(([v, text]) => `<option value="${v}"${v === value ? " selected" : ""}>${esc(text)}</option>`).join("")}</select>`;
    const row = (key, input, hint = "") => `<div class="form-group"><label>${L(`${LANG}.Security.Form.${key}`, { unit })}</label><div class="form-fields">${input}</div>${hint ? `<p class="hint">${hint}</p>` : ""}</div>`;
    const actors = (game.actors ?? []).filter((a) => a.hasPlayerOwner && (a.type === "character" || a.type === "mook"));
    const content = `<div class="ncm-levels ncm-security-form">
      <p class="hint">${L(`${LANG}.Security.Form.${now ? "IntroEdit" : picked ? "IntroTile" : "IntroNew"}`)}</p>
      ${row("Kind", sel("kind", KIND_IDS.map((k) => [k, `${L(`${LANG}.Security.Kind.${k}`)} (${L(`${LANG}.Security.Group.${KINDS[k].group}`)})`]), d.kind))}
      ${row("Name", `<input type="text" name="name" value="${esc(d.name)}" placeholder="CAM 01">`)}
      ${row("On", `<input type="checkbox" name="on"${d.on ? " checked" : ""}>`)}
      ${row("Hp", `<input type="number" name="hp" value="${now ? d.hp : ""}" min="0" step="1" placeholder="${L(`${LANG}.Security.Form.ByKind`)}">`, L(`${LANG}.Security.Form.HpHint`))}
      ${row("Range", `<input type="number" name="range" value="${now ? d.range : ""}" min="0" step="1" placeholder="${L(`${LANG}.Security.Form.ByKind`)}">`, L(`${LANG}.Security.Form.RangeHint`))}
      ${row("Angle", `<input type="number" name="angle" value="${now ? d.angle : ""}" min="5" max="360" step="5" placeholder="${L(`${LANG}.Security.Form.ByKind`)}">`, L(`${LANG}.Security.Form.AngleHint`))}
      ${row("Node", `<input type="number" name="node" value="${now ? d.node : ""}" min="1" step="1" placeholder="${L(`${LANG}.Security.Form.ByKind`)}">`, L(`${LANG}.Security.Form.NodeHint`))}
      ${row("Weapon", sel("weapon", Object.keys(WEAPONS).map((w) => [w, L(`${LANG}.Security.Weapon.${w}`)]), d.weapon || "assaultRifle"), L(`${LANG}.Security.Form.WeaponHint`))}
      ${row("Depth", `<input type="number" name="depth" value="${now ? d.depth : ""}" min="0" step="1" placeholder="6"> <label class="checkbox"><input type="checkbox" name="spikes"${d.spikes ? " checked" : ""}> ${L(`${LANG}.Security.Form.Spikes`)}</label>`, L(`${LANG}.Security.Form.DepthHint`))}
      <fieldset><legend>${L(`${LANG}.Security.Form.Passes`)}</legend><p class="hint">${L(`${LANG}.Security.Form.PassesHint`)}</p>
        ${actors.map((a) => `<label class="checkbox"><input type="checkbox" name="pass" value="${a.id}"${d.passes.includes(a.id) ? " checked" : ""}> ${esc(a.name)}</label>`).join(" ") || `<em>${L(`${LANG}.Security.Form.NoActors`)}</em>`}
      </fieldset>
      ${now ? `<p><label class="checkbox"><input type="checkbox" name="rearm"> ${L(`${LANG}.Security.Form.Rearm`)}</label> <label class="checkbox"><input type="checkbox" name="remove"> ${L(`${LANG}.Security.Form.Remove`)}</label></p>` : ""}
    </div>`;
    const got = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Security.Tool`) },
      position: { width: 520 },
      content,
      ok: {
        label: L(`${LANG}.Levels.Save`),
        callback: (event, button) => {
          const f = button.form.elements;
          const opt = (name) => (f[name].value === "" ? undefined : Number(f[name].value));
          const passes = [...button.form.querySelectorAll("input[name=pass]:checked")].map((i) => i.value);
          return { kind: f.kind.value, name: f.name.value, on: f.on.checked, hp: opt("hp"), range: opt("range"), angle: opt("angle"), node: opt("node"), weapon: f.weapon.value, depth: opt("depth"), spikes: f.spikes.checked, passes, rearm: !!f.rearm?.checked, remove: !!f.remove?.checked };
        }
      },
      rejectClose: false
    });
    if (!got) return null;
    if (now && got.remove) {
      await picked.unsetFlag(MODULE_ID, SECURITY_FLAG);
      Hooks.callAll(`${MODULE_ID}.fxChanged`);
      return null;
    }
    const sameKind = now && now.kind === got.kind;
    const given = Object.fromEntries(Object.entries(got).filter(([k, v]) => v !== undefined && k !== "rearm" && k !== "remove"));
    // HP typed above what it had: that's its new full HP. Rearmed: full again, nobody on its node, ready to fire.
    const full = Math.max(sameKind ? now.hpMax : KINDS[got.kind].hp, got.hp ?? 0);
    const next = cleanDevice({ ...(sameKind ? now : {}), ...given, hpMax: full, ...(got.rearm ? { hp: got.hp ?? full, controllers: [], spent: false } : {}) });
    if (picked) {
      await this.save(picked, next);
      return picked;
    }
    const doc = await this.place(got.kind);
    if (doc) await this.save(doc, next);
    return doc;
  }
};
