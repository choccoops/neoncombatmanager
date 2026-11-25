import { MODULE_ID, LANG, HOOKS } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Stairs } from "./stairs.js";
import { Levels } from "./levels.js";
import { NeonRuler } from "../ruler/ruler.js";
import { Turns } from "../combat/turns.js";
import { STAIRS_FLAG, KIND_ICON, landing } from "./stairs-data.js";
import { stacked, onto } from "./levels-data.js";
import { inShapes, boundsOf } from "./far-data.js";
import { CLIMB_FLAG, WALL_FLAG, GAP, LEAP_DV, CATCH_DV, factorOf, stretch, aheadOf, heightAt, across, toSegment, elevationAfter, d10Total, within, inFront, beats, leapTo, fallDice, fanLayout, FALL_FLAG, FALL_PER_TURN, BROKEN_LEG_DV, DFA_DV, fallPlan, fallStep, deathFromAbove, besideStep } from "./climb-data.js";
import { Conditions } from "../conditions/engine.js";
import { Cards } from "../combat/cards.js";
import { Dv } from "../arsenal/dv.js";
import { L, esc, debounce } from "../util.js";

/**
 * Climbing at the table (see climb-data.js for the rules).
 *
 * - **Ladders with a height**: linking two tiles as a ladder asks how high it is. A token on the
 *   foot is offered "Climb"; it goes up as far as its movement allows this Turn (2 for 1, or 1 for
 *   1 with Grip Feet or a grapple line) and stays there, its elevation raised, until it climbs on.
 *   At the top it's put on the head tile. From the head it's offered the climb down.
 * - **Climbable walls**: the GM selects walls and presses the ladder button in the wall controls,
 *   giving a height and whether it's climbed over (a fence: up and down the far side) or onto (a
 *   ledge or roof). A token next to one is offered the climb.
 * - **Height** is the token's elevation while it climbs, so Foundry shows it and attack distances
 *   count it. A gauge beside the ladder shows everyone on it, in order.
 * - **Several climbers** on one ladder go single file, a body's length apart; the one in front
 *   sets the pace. Walls are climbed side by side.
 * - Out of combat, or off its own Turn, a token climbs the whole way at once.
 * The GM's client does the climbing for whoever may move the token.
 */
export const Climb = {
  layer: null,

  get on() {
    return Stairs.on && Settings.get("climbing") !== false;
  },

  init() {
    const soon = debounce(() => this.draw(), 120);
    Socket.on("climbGo", (data, userId) => this._go(data, userId));
    Socket.on("climbContest", (data, userId) => this._contest(data, userId));
    Socket.on("climbStep", (data, userId) => this._step(data, userId));
    Socket.on("climbDrop", (data, userId) => this._drop(data, userId));
    Socket.on("climbDive", (data, userId) => this._dive(data, userId));
    // A climber dragged off the climb is held where it is, and whoever moved it is asked first.
    Hooks.on("preUpdateToken", (doc, changes, options, userId) => this.hold(doc, changes, options, userId));
    // Falling characters fall at the end of their own Turn; a fight that ends lands them.
    Hooks.on(HOOKS.turnEnd, (combat, combatant) => {
      if (Compat.isActiveGM) this.fallOn(combatant?.token ?? null).catch((err) => console.error(`${MODULE_ID} | fall`, err));
    });
    Hooks.on("deleteCombat", (combat) => {
      if (!Compat.isActiveGM) return;
      for (const c of combat?.combatants ?? []) if (this.falling(c.token)) this.fallOn(c.token, { all: true }).catch((err) => console.error(`${MODULE_ID} | fall`, err));
    });
    Hooks.on("refreshToken", (token) => this.fan(token));
    Hooks.on("targetToken", () => soon());
    Stairs.providers.push((token) => this.promptFor(token));
    Hooks.on("getSceneControlButtons", (controls) => Compat.addSceneTools(controls, [
      { name: "ncm-climb-wall", title: `${LANG}.Climb.WallTool`, icon: "fa-solid fa-water-ladder", order: 120, visible: !!game.user?.isGM, onClick: () => this.markWalls() }
    ], "walls"));
    for (const h of ["canvasReady", "updateToken", "deleteToken", "createTile", "updateTile", "deleteTile", "updateWall", "deleteWall", "updateScene", `${MODULE_ID}.fxChanged`]) Hooks.on(h, () => soon());
    Hooks.on("canvasTearDown", () => this.clear());
    Hooks.on("updateToken", (doc, changed, options) => {
      this.onMove(doc, changed, options).catch((err) => console.error(`${MODULE_ID} | climb`, err));
    });
  },

  doc: (t) => t?.document ?? t ?? null,
  state(token) {
    const st = this.doc(token)?.flags?.[MODULE_ID]?.[CLIMB_FLAG];
    return st?.id ? st : null;
  },

  /** Grip Feet: no penalty for climbing, anywhere. */
  sure: (actor) => !!actor && CPR.hasGear(actor, ["Grip Foot", "Grip Feet"]),
  /** A Grapple Hand or a Grapple Gun: no penalty when it's their line that's climbed. */
  hasLine: (actor) => !!actor && CPR.hasGear(actor, ["Grapple Hand", "Grapple Gun"]),

  floorAt(point, scene) {
    return Levels.on ? Levels.place(point, scene)?.floor?.height ?? 0 : 0;
  },

  /* ---------------------------------------- */
  /*  What can be climbed from here           */
  /* ---------------------------------------- */

  /** The ladder (with a height) a token stands at an end of: { id (the foot tile), foot, head, height, end }. */
  ladderFor(token) {
    const doc = this.doc(token);
    const way = Stairs.wayFor(doc);
    if (!way || way.from.kind !== "ladder" || !(way.from.rise > 0)) return null;
    const atFoot = way.from.end !== "head";
    const foot = atFoot ? way.from : way.to;
    const head = atFoot ? way.to : way.from;
    return { id: foot.id, foot, head, height: way.from.rise, end: atFoot ? "foot" : "head" };
  },

  walls(scene = canvas?.scene) {
    return [...(scene?.walls ?? [])].filter((w) => Number(w.flags?.[MODULE_ID]?.[WALL_FLAG]?.height) > 0).map((w) => {
      const c = w.c ?? [];
      return { id: w.id, a: { x: c[0], y: c[1] }, b: { x: c[2], y: c[3] }, height: Number(w.flags[MODULE_ID][WALL_FLAG].height), over: !!w.flags[MODULE_ID][WALL_FLAG].over };
    });
  },

  /** The climbable wall a token stands against (the nearest within reach), or null. */
  wallFor(token) {
    const doc = this.doc(token);
    if (!doc?.parent) return null;
    const size = Stairs.sizeOf(doc);
    const p = Stairs.centre(doc);
    const reach = Math.max(size.w, size.h) / 2 + Stairs.grid(doc) * 0.6;
    return this.walls(doc.parent).map((w) => ({ ...w, d: toSegment(p, w.a, w.b) })).filter((w) => w.d <= reach).sort((x, y) => x.d - y.d)[0] ?? null;
  },

  /** Is a token standing at the top of a wall (so the climb on offer is down)? */
  upAt(doc, wall) {
    if (wall.over) return false;
    const here = Stairs.centre(doc);
    const there = across(here, wall.a, wall.b);
    const mine = this.floorAt(here, doc.parent) + (Number(doc.elevation) || 0);
    return mine - this.floorAt(there, doc.parent) >= wall.height - 0.5;
  },

  /** What a token can do about climbing where it stands: [{ dir, label, sub }] with what's being climbed. */
  choices(token) {
    const doc = this.doc(token);
    if (!this.on || !doc?.parent) return null;
    const st = this.state(doc);
    if (st) {
      const what = L(`${LANG}.Climb.${st.kind === "wall" ? "Wall" : "Ladder"}`);
      return { icon: KIND_ICON.ladder, text: L(`${LANG}.Climb.On`, { what, at: st.at, total: st.total, unit: this.unit(doc) }), options: [{ dir: "up", label: L(`${LANG}.Climb.${st.over ? "Onward" : "Up"}`) }, { dir: "down", label: L(`${LANG}.Climb.${st.over ? "Back" : "Down"}`) }] };
    }
    const ladder = this.ladderFor(doc);
    if (ladder) {
      const dir = ladder.end === "foot" ? "up" : "down";
      return { icon: KIND_ICON.ladder, text: L(`${LANG}.Climb.Offer`, { what: L(`${LANG}.Climb.Ladder`), height: ladder.height, unit: this.unit(doc) }), options: [{ dir, label: L(`${LANG}.Climb.${dir === "up" ? "Up" : "Down"}`) }] };
    }
    const wall = this.wallFor(doc);
    if (wall) {
      const dir = this.upAt(doc, wall) ? "down" : "up";
      return { icon: KIND_ICON.ladder, text: L(`${LANG}.Climb.Offer`, { what: L(`${LANG}.Climb.${wall.over ? "Fence" : "Wall"}`), height: wall.height, unit: this.unit(doc) }), options: [{ dir, label: L(`${LANG}.Climb.${wall.over ? "Over" : dir === "up" ? "Up" : "Down"}`) }] };
    }
    return null;
  },

  unit: (doc) => doc?.parent?.grid?.units || canvas?.scene?.grid?.units || "m",

  /** The prompt at the foot of the screen (through Stairs.offer). */
  promptFor(token) {
    const c = this.choices(token);
    if (!c) return null;
    const doc = this.doc(token);
    const st = this.state(doc);
    const line = !this.sure(token.actor) && this.hasLine(token.actor);
    const buttons = c.options.map((o) => ({ label: o.label, run: () => this.go(token, { dir: o.dir }) }));
    if (line) buttons.push(...c.options.map((o) => ({ label: L(`${LANG}.Climb.ByLine`, { dir: o.label }), quiet: true, run: () => this.go(token, { dir: o.dir, line: true }) })));
    // On a ladder with someone within reach: throw them off, or leap past the one in front.
    for (const m of this.moves(token)) buttons.push({ label: m.label, quiet: true, run: () => this.contest(token, m.kind, m.target) });
    return { key: `climb:${doc.id}:${st?.id ?? ""}:${st?.at ?? ""}:${doc.x}:${doc.y}`, icon: c.icon, name: token.name ?? doc.name ?? "", text: c.text, buttons };
  },

  /** The Action HUD's Turn section: one Climb entry with a button for each thing to do, and Death From Above when it's on. */
  entries(actor, token) {
    const tok = token?.object ?? token ?? actor?.getActiveTokens?.()[0] ?? null;
    if (!tok) return [];
    const out = [];
    const c = this.choices(tok);
    if (c) {
      const icons = { up: "fa-solid fa-arrow-up", down: "fa-solid fa-arrow-down", throw: "fa-solid fa-hand-fist", leap: "fa-solid fa-person-running" };
      out.push({
        key: "climb:menu", label: L(`${LANG}.Climb.Hud`), sub: c.text, icon: c.icon, alert: true,
        buttons: [
          ...c.options.map((o) => ({ key: `climb:${o.dir}`, label: o.label, icon: icons[o.dir] })),
          ...this.moves(tok).map((m) => ({ key: `climb:${m.kind}:${m.target ?? ""}`, label: `${m.label} (${m.sub})`, icon: icons[m.kind] }))
        ]
      });
    }
    const dive = this.diveFor(tok);
    if (dive) out.push({ key: "climb:dive", run: `climb:dive:${dive.target.id}`, label: L(`${LANG}.Climb.Dfa.Action`), sub: L(`${LANG}.Climb.Dfa.Sub`, { target: dive.target.name ?? "", height: dive.up, unit: this.unit(this.doc(tok)) }), icon: "fa-solid fa-meteor", alert: true });
    return out;
  },

  /** An Action HUD key: "up", "down", "throw:<token id>", "leap", "dive:<token id>". */
  act(token, key) {
    const [, what, target] = String(key).split(":");
    if (what === "throw" || what === "leap") return this.contest(token, what, target || null);
    if (what === "dive") return this.dive(token, target || null);
    if (what === "menu") return null;
    return this.go(token, { dir: what });
  },

  /* ---------------------------------------- */
  /*  Chases: throwing off, leaping past      */
  /* ---------------------------------------- */

  /** Everyone else on the same ladder: [{ id, at, name }]. */
  rivals(token) {
    const doc = this.doc(token);
    const st = this.state(doc);
    if (!st || st.kind !== "tile") return [];
    return [...(doc.parent?.tokens ?? [])].filter((t) => t.id !== doc.id && this.state(t)?.id === st.id).map((t) => ({ id: t.id, at: this.state(t).at, name: t.name ?? "" }));
  },

  /** What a climber can try on the others: [{ kind: "throw"|"leap", target, label, sub }]. */
  moves(token) {
    const st = this.state(token);
    if (!this.on || !st || st.kind !== "tile" || Settings.get("climbContests") === false) return [];
    const rivals = this.rivals(token);
    const out = within(st.at, rivals).map((r) => ({ kind: "throw", target: r.id, label: L(`${LANG}.Climb.Throw`, { name: r.name }), sub: L(`${LANG}.Climb.ThrowSub`) }));
    const front = inFront(st.at, rivals);
    if (front && leapTo({ front: front.at, total: st.total, others: rivals.map((r) => r.at) })) out.push({ kind: "leap", target: front.id, label: L(`${LANG}.Climb.Leap`, { name: front.name }), sub: L(`${LANG}.Climb.LeapSub`, { dv: LEAP_DV }) });
    return out;
  },

  /**
   * A throw or a leap. Whoever tries it rolls their own Check here (Cyberpunk RED's roll: its
   * dialog, LUCK, its card); the GM's client takes it from there, a card at a time.
   */
  async contest(token, kind, target = null, event = null) {
    const doc = this.doc(token);
    if (!doc?.parent || !doc.actor) return null;
    const move = this.moves(doc).find((m) => m.kind === kind && (!target || m.target === target));
    if (!move) return null;
    const mine = await this.rollFor(doc.actor, kind === "throw" ? "Brawling" : "Athletics", event);
    if (!mine) return null;
    const r = await Socket.request("climbContest", { scene: doc.parent.id, token: doc.id, kind, target: move.target, total: mine.total });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return r;
  },

  /**
   * A character's own Check: Cyberpunk RED's roll for the skill where the sheet can make one,
   * else DEX + the skill + 1d10 rolled here. { total }, or null when they cancel.
   */
  async rollFor(actor, skillName, event = null) {
    const skill = CPR.skill(actor, skillName);
    if (typeof skill?.createRoll === "function" || typeof actor?.createRoll === "function") return CPR.skillCheck(actor, skillName, { event, stat: "dex" });
    return this.check(actor, "dex", skill ?? skillName);
  },

  /** A button on one of the climb's cards: the character it calls on rolls, and the GM's client carries on. */
  async click(message, btn, event, actor) {
    if (!actor?.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
    const d = { ...btn.dataset };
    const skill = { "climb-hold": "Brawling", "climb-catch": "Athletics", "climb-leg": "Athletics", "climb-dfa": this.panzer(actor)?.name }[d.ncmAction];
    if (!skill) return null;
    btn.disabled = true;
    const mine = await this.rollFor(actor, skill, event);
    if (!mine) {
      btn.disabled = false;
      return null;
    }
    const r = await Socket.request("climbStep", { ...d, action: d.ncmAction, total: mine.total, message: message?.id ?? null });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return r;
  },

  /** One card's button, for whoever is to roll: [{ action, label, icon, owner, data }]. */
  ask(action, label, data) {
    return [{ action, label: L(`${LANG}.Climb.Roll.${label}`), icon: "fa-solid fa-dice-d10", owner: true, data }];
  },

  /**
   * GM's client: a Check called for by a card has been rolled. Each card is answered once.
   * hold: the one being thrown off (Brawling against the throw). catch: their grab at the ladder.
   * leg: the landing. dfa: Death From Above.
   */
  async _step(data, userId) {
    const sc = game.scenes?.get?.(data.scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(data.token);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!doc?.actor || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return null;
    const msg = data.message ? game.messages?.get?.(data.message) : null;
    if (msg?.getFlag?.(MODULE_ID, "done")) return null;
    if (msg?.setFlag) await msg.setFlag(MODULE_ID, "done", true);
    const total = Number(data.total) || 0;
    const name = esc(doc.name ?? "");
    const actor = doc.actor;
    switch (data.action) {
      case "climb-hold": {
        const st = this.state(doc);
        const by = esc(sc.tokens.get(data.by)?.name ?? "");
        if (!st) return null;
        const body = `<p>${L(`${LANG}.Climb.Card.Scores`, { name: by, attack: data.attack, other: name, total })}</p>`;
        if (!beats(data.attack, total)) {
          await Cards.post({ actor, title: L(`${LANG}.Climb.Card.ThrowTitle`), kicker: L(`${LANG}.Climb.Card.Held`), body: `${body}<p>${L(`${LANG}.Climb.Card.HeldText`, { other: name })}</p>`, tone: "cyan" });
          return { won: false };
        }
        if (this.hasLine(actor)) {
          await Cards.post({ actor, title: L(`${LANG}.Climb.Card.ThrowTitle`), kicker: L(`${LANG}.Climb.Card.Caught`), body: `${body}<p>${L(`${LANG}.Climb.Card.Grapple`, { other: name })}</p>`, tone: "cyan" });
          return { won: true, fell: false };
        }
        await Cards.post({ actor, title: L(`${LANG}.Climb.Card.ThrowTitle`), kicker: L(`${LANG}.Climb.Card.Off`), body: `${body}<p>${L(`${LANG}.Climb.Card.CatchAsk`, { other: name, dv: CATCH_DV })}</p>`, tone: "pink", buttons: this.ask("climb-catch", "Catch", { scene: sc.id, token: doc.id, by: data.by }) });
        return { won: true, pending: "catch" };
      }
      case "climb-catch": {
        const st = this.state(doc);
        if (!st) return null;
        const by = esc(sc.tokens.get(data.by)?.name ?? "");
        const body = `<p>${L(`${LANG}.Climb.Card.Catch`, { other: name, dv: CATCH_DV, roll: total })}</p>`;
        if (beats(total, CATCH_DV)) {
          await Cards.post({ actor, title: L(`${LANG}.Climb.Card.ThrowTitle`), kicker: L(`${LANG}.Climb.Card.Caught`), body: `${body}<p>${L(`${LANG}.Climb.Card.CaughtText`, { other: name })}</p>`, tone: "cyan" });
          return { fell: false };
        }
        await this.fall(doc, st, { why: `${body}${L(`${LANG}.Climb.Card.ThrownText`, { name: by, other: name })}` });
        return { fell: true };
      }
      case "climb-leg": {
        const ok = beats(total, BROKEN_LEG_DV);
        if (!ok) await Conditions.add("brokenLeg", actor);
        await Cards.post({ actor, title: L(`${LANG}.Climb.Fall.Title`), kicker: L(`${LANG}.Climb.Fall.${ok ? "OnFeet" : "Broken"}`), body: `<p>${L(`${LANG}.Climb.Fall.Leg`, { dv: BROKEN_LEG_DV, roll: total })} ${L(`${LANG}.Climb.Fall.${ok ? "LegOk" : "LegBroken"}`, { name })}</p>`, tone: ok ? "cyan" : "red" });
        return { broken: !ok };
      }
      case "climb-dfa": {
        const damage = Number(data.damage) || 0;
        const under = sc.tokens.get(data.target);
        const tname = esc(under?.name ?? "");
        let body = `<p>${L(`${LANG}.Climb.Dfa.Check`, { target: tname, dv: DFA_DV, roll: total })}</p>`;
        if (!under?.actor || !beats(total, DFA_DV)) {
          // An ordinary landing after all.
          const took = await this.hurt(actor, damage, { armor: true });
          await Cards.post({ actor, title: L(`${LANG}.Climb.Fall.Title`), kicker: L(`${LANG}.Climb.Fall.Landed`), body: `${body}<p>${L(`${LANG}.Climb.Dfa.Miss`)} ${L(`${LANG}.Climb.Fall.Took`, { name, total: damage, took })}</p><p>${L(`${LANG}.Climb.Fall.LegAsk`, { name, dv: BROKEN_LEG_DV })}</p>`, tone: "pink", buttons: this.ask("climb-leg", "Leg", { scene: sc.id, token: doc.id }) });
          return { hit: false, damage };
        }
        const bodyStat = CPR.stat(actor, "body");
        const sp = CPR.armor(actor).body;
        const { dealt, taken } = deathFromAbove({ damage, body: bodyStat, sp });
        const person = !/vehicle/i.test(under.actor.type ?? "");
        if (dealt) await this.hurt(under.actor, dealt);
        if (person) await Conditions.add("prone", under.actor);
        if (taken) await this.hurt(actor, taken);
        body += `<p>${L(`${LANG}.Climb.Dfa.Hit`, { name, target: tname, body: bodyStat, sp, dealt, taken, prone: person ? L(`${LANG}.Climb.Dfa.Prone`) : "" })}</p>`;
        body += `<p>${taken ? L(`${LANG}.Climb.Fall.LegAsk`, { name, dv: BROKEN_LEG_DV }) : L(`${LANG}.Climb.Dfa.Clean`)}</p>`;
        await Cards.post({ actor, title: L(`${LANG}.Climb.Fall.Title`), kicker: L(`${LANG}.Climb.Fall.Dfa`), body, tone: "pink", buttons: taken ? this.ask("climb-leg", "Leg", { scene: sc.id, token: doc.id }) : [] });
        return { hit: true, dealt, taken };
      }
      default:
        return null;
    }
  },

  /**
   * Damage, applied now. With armor: through Cyberpunk RED's own damage (body armor soaks it; a
   * fall wears no armor away). Without: straight to HP. What got through, where that's known.
   */
  async hurt(actor, amount, { armor = false } = {}) {
    const n = Math.max(0, Math.round(Number(amount) || 0));
    if (!n || !actor) return 0;
    const before = CPR.hp(actor).value;
    if (armor && typeof actor._applyDamage === "function") {
      await actor._applyDamage(n, 0, "body", 0, "", 0, 0, true, { damageReductionRole: false, damageReductionAE: false, useShield: false, brainDamageReduction: false });
    } else await CPR.damageHP(actor, armor ? Math.max(0, n - CPR.armor(actor).body) : n, { reason: L(`${LANG}.Climb.Fall.Title`) });
    return Math.max(0, before - CPR.hp(actor).value);
  },

  /** STAT + Skill + 1d10 (a 10 or a 1 rolls on), rolled here: { total, base, die, text }. */
  async check(actor, stat, skillName) {
    const level = Number((typeof skillName === "string" ? CPR.skill(actor, skillName) : skillName)?.system?.level) || 0;
    const base = (Number(CPR.stat(actor, stat)) || 0) + level;
    const first = (await Conditions.roll("1d10", actor)).total;
    const second = first === 10 || first === 1 ? (await Conditions.roll("1d10", actor)).total : 0;
    const die = d10Total(first, second);
    return { total: base + die, base, die, text: `${base} + ${second ? `${first}${first === 10 ? "+" : "−"}${second}` : first} = ${base + die}` };
  },

  /* ---------------------------------------- */
  /*  Falling (corebook pg. 181)              */
  /* ---------------------------------------- */

  /** Two Cyberlegs (two of them, or a pair sold as one): a fall's damage and its Broken Leg don't land, up to 30 m/yds. */
  legs(actor) {
    let n = 0;
    for (const i of actor?.items ?? []) {
      if (i.type !== "cyberware" || !CPR.inUse(i)) continue;
      const name = String(i.name ?? "");
      if (/cyberlegs\b|skydrivers?\b/i.test(name)) n += 2;
      else if (/cyberleg\b/i.test(name)) n += 1;
    }
    return n >= 2;
  },

  /** What gear takes off a fall, in m/yds: Skydrivers, 4 (the 2070 rules). */
  shorter: (actor) => (actor && CPR.hasGear(actor, ["Skydrivers", "Skydriver"]) ? 4 : 0),

  /** The PanzerFaust skill of a character in a Full Body Conversion (Death From Above is theirs), or null. */
  panzer(actor) {
    if (!actor || !CPR.isBorg(actor)) return null;
    return [...(actor.items ?? [])].find((i) => i.type === "skill" && /panzer\s*faust/i.test(i.name ?? "")) ?? null;
  },

  falling(token) {
    const f = this.doc(token)?.flags?.[MODULE_ID]?.[FALL_FLAG];
    return f && Number(f.total) > 0 ? f : null;
  },

  /**
   * GM's client: someone is off what they stood on or held. In a fight they fall 40 m/yds at the
   * end of each of their Turns and stay up there till then; out of one they land at once.
   * @param {object} st - a climb's state, or { drop: height, base: elevation on the ground }
   * @param {object} [o] - why: a line for the card; target: the id of the token they come down on
   */
  async fall(doc, st, { why = "", target = null } = {}) {
    const height = Math.round((Number(st.drop) || heightAt(st)) * 10) / 10;
    const base = Number(st.base) || 0;
    if (this.state(doc)) await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
    const cb = doc.actor && height > 0 ? NeonRuler.combatantOf(doc) : null;
    if (!cb) {
      await this.land(doc, { total: height, base, target, why });
      return height;
    }
    await doc.setFlag(MODULE_ID, FALL_FLAG, { total: height, left: height, base, target });
    await doc.update({ elevation: Math.round((base + height) * 10) / 10 }, this.opts());
    const unit = this.unit(doc);
    await Cards.post({ actor: doc.actor, title: L(`${LANG}.Climb.Fall.Title`), kicker: L(`${LANG}.Climb.Fall.InAir`), body: `${why ? `<p>${why}</p>` : ""}<p>${L(`${LANG}.Climb.Fall.Falling`, { name: esc(doc.name ?? ""), height, per: FALL_PER_TURN, unit })}</p>`, tone: "pink" });
    return height;
  },

  /** GM's client: the end of a falling character's Turn (or, with all, of the fight): down 40 m/yds, and onto the ground if that's all of it. */
  async fallOn(token, { all = false } = {}) {
    const doc = this.doc(token);
    const f = this.falling(doc);
    if (!doc || !f) return null;
    const step = all ? { fell: f.left, left: 0 } : fallStep(f.left);
    if (step.left > 0) {
      await doc.setFlag(MODULE_ID, FALL_FLAG, { ...f, left: step.left });
      await doc.update({ elevation: Math.round((f.base + step.left) * 10) / 10 }, this.opts());
      await Cards.post({ actor: doc.actor ?? null, title: L(`${LANG}.Climb.Fall.Title`), kicker: L(`${LANG}.Climb.Fall.InAir`), body: `<p>${L(`${LANG}.Climb.Fall.Still`, { name: esc(doc.name ?? ""), fell: step.fell, left: step.left, unit: this.unit(doc) })}</p>`, tone: "pink" });
      return { landed: false, left: step.left };
    }
    await this.land(doc, { total: f.total, base: f.base, target: f.target });
    return { landed: true, left: 0 };
  },

  /**
   * GM's client: the ground. Under 10 m/yds nothing; else 2d6 for every 10, soaked by body armor,
   * and a DV15 Athletics Check or a Broken Leg. Two Cyberlegs take neither, up to 30. A borg with
   * PanzerFaust coming down on someone tries Death From Above first.
   */
  async land(doc, { total = 0, base = 0, target = null, why = "" } = {}) {
    if (this.falling(doc)) await doc.unsetFlag(MODULE_ID, FALL_FLAG);
    await doc.update({ elevation: base }, this.opts());
    const actor = doc.actor ?? null;
    const unit = this.unit(doc);
    const name = esc(doc.name ?? "");
    const plan = fallPlan({ height: total, legs: this.legs(actor), shorter: this.shorter(actor) });
    const post = (body, buttons = null) => Cards.post({ actor, title: L(`${LANG}.Climb.Fall.Title`), kicker: L(`${LANG}.Climb.Fall.Landed`), body, tone: "pink", buttons: buttons ?? (plan.dice && actor ? this.ask("climb-leg", "Leg", { scene: doc.parent?.id, token: doc.id }) : []) });
    let body = why ? `<p>${why}</p>` : "";
    if (plan.counted !== total) body += `<p>${L(`${LANG}.Climb.Fall.Shorter`, { shorter: Math.round((total - plan.counted) * 10) / 10, counted: plan.counted, unit })}</p>`;
    if (!plan.dice || !actor) {
      await post(`${body}<p>${L(`${LANG}.Climb.Fall.${plan.spared === "legs" ? "Legs" : "Short"}`, { name, height: total, unit })}</p>`);
      return { damage: 0 };
    }
    const roll = await Conditions.roll(plan.dice, actor);
    body += `<p>${L(`${LANG}.Climb.Fall.Hurt`, { name, height: total, unit })}</p><p>${L(`${LANG}.Climb.Fall.Damage`, { dice: plan.dice, total: roll.total })}</p>`;
    const ids = { scene: doc.parent?.id, token: doc.id };
    // Death From Above: theirs to roll first; the damage waits on it.
    const under = target ? doc.parent?.tokens?.get(target) : null;
    if (under?.actor && this.panzer(actor)) {
      body += `<p>${L(`${LANG}.Climb.Dfa.Ask`, { name, target: esc(under.name ?? ""), dv: DFA_DV })}</p>`;
      await Cards.post({ actor, title: L(`${LANG}.Climb.Fall.Title`), kicker: L(`${LANG}.Climb.Fall.Dfa`), body, tone: "pink", buttons: this.ask("climb-dfa", "Dfa", { ...ids, target: under.id, damage: roll.total }) });
      return { damage: roll.total, pending: "dfa" };
    }
    // Applied now, body armor soaking it; the landing's Check is theirs to roll.
    const took = await this.hurt(actor, roll.total, { armor: true });
    body += `<p>${L(`${LANG}.Climb.Fall.Took`, { name, total: roll.total, took })}</p><p>${L(`${LANG}.Climb.Fall.LegAsk`, { name, dv: BROKEN_LEG_DV })}</p>`;
    await post(body);
    return { damage: roll.total, pending: "leg" };
  },

  /* ---------------------------------------- */
  /*  Letting go, and dropping on someone     */
  /* ---------------------------------------- */

  /**
   * A climber above the ground is moved off the climb by hand: the move is stopped, and whoever
   * made it is told they'd fall that way and asked. (Climbing itself, and being carried, go on.)
   */
  hold(doc, changes, options = {}, userId = null) {
    if (!("x" in (changes ?? {}) || "y" in (changes ?? {}))) return true;
    const o = options?.[MODULE_ID];
    if (o?.climb || o?.carried || options?.isUndo) return true;
    if (userId && game.user?.id && userId !== game.user.id) return true;
    const st = this.on ? this.state(doc) : null;
    const to = { x: changes.x ?? doc.x, y: changes.y ?? doc.y };
    if (!st) {
      // Off the edge of a floor with a height, or into an opening in it: asked first, too.
      if (o?.free || o?.stairs || o?.ledge || this.falling(doc)) return true;
      const edge = this.ledge(doc, to);
      if (!edge) return true;
      this.askLedge(doc, to, edge).catch((err) => console.error(`${MODULE_ID} | fall`, err));
      return false;
    }
    const height = heightAt(st);
    if (!(height > 0)) return true;
    this.askDrop(doc, to, height).catch((err) => console.error(`${MODULE_ID} | climb`, err));
    return false;
  },

  /**
   * Would a move take a token off its floor and down? Into an opening of its building: onto the
   * floor below, at the same spot of that floor's plan. Off the floor's edge onto the map or a
   * lower place: there. (Another floor of the same building drawn beside it is a reposition, and
   * a step down of under 3 m/yds is just a step.)
   * @returns {{ drop: number, land: {x, y}, opening: boolean }|null}
   */
  ledge(doc, to) {
    if (!Levels.on || Settings.get("levelsFalls") === false || !doc?.parent || Number(doc.elevation)) return null;
    const sc = doc.parent;
    const size = Stairs.sizeOf(doc);
    const here = Levels.place(doc, sc);
    const mid = { x: to.x + size.w / 2, y: to.y + size.h / 2 };
    const there = Levels.place(mid, sc);
    const top = here?.floor?.height ?? 0;
    if (!(top > 0) || !there) return null;
    if (there.floor?.region === here.floor.region && here.floor.stack && here.corner) {
      const hole = Levels.openings(sc).find((o) => o.stack === here.floor.stack && inShapes(o.shapes, onto(mid, here.corner, o.corner)));
      if (!hole || inShapes(hole.shapes, onto(here.point, here.corner, hole.corner))) return null;
      const lower = Levels.floors(sc).filter((f) => f.stack === here.floor.stack && f.height < top).sort((a, b) => b.height - a.height)[0];
      const box = lower ? boundsOf([...(sc.regions ?? [])].find((r) => r.id === lower.region)?.shapes ?? []) : null;
      if (!box) return null;
      const down = onto(mid, here.corner, { x: box.x, y: box.y });
      return { drop: Math.round((top - lower.height) * 10) / 10, land: { x: down.x - size.w / 2, y: down.y - size.h / 2 }, opening: true };
    }
    if (there.floor?.region === here.floor.region || stacked(here.floor, there.floor)) return null;
    const drop = Math.round((top - (there.floor?.height ?? 0)) * 10) / 10;
    return drop >= 3 ? { drop, land: { x: to.x, y: to.y }, opening: false } : null;
  },

  /** Fall, move without falling (a bridge, a ramp, the GM setting the table), or stay. */
  async askLedge(doc, to, edge) {
    if (this._asking) return null;
    this._asking = true;
    try {
      const unit = this.unit(doc);
      const pick = await Compat.DialogV2.wait({
        window: { title: L(`${LANG}.Climb.Edge.Title`) },
        content: `<p>${L(`${LANG}.Climb.Edge.${edge.opening ? "Opening" : "Text"}`, { name: esc(doc.name ?? ""), drop: edge.drop, unit })}</p>`,
        buttons: [
          { action: "fall", label: L(`${LANG}.Climb.Edge.Fall`), icon: "fa-solid fa-person-falling" },
          { action: "move", label: L(`${LANG}.Climb.Edge.Move`), icon: "fa-solid fa-shoe-prints" },
          { action: "stay", label: L(`${LANG}.Climb.Edge.Stay`), default: true }
        ],
        rejectClose: false
      });
      if (pick === "move") return await doc.update(to, { [MODULE_ID]: { ledge: true } });
      if (pick !== "fall") return null;
      const r = await Socket.request("climbDrop", { scene: doc.parent.id, token: doc.id, x: to.x, y: to.y });
      Hooks.callAll(`${MODULE_ID}.fxChanged`);
      return r;
    } finally {
      this._asking = false;
    }
  },

  async askDrop(doc, to, height) {
    if (this._asking) return null;
    this._asking = true;
    try {
      const unit = this.unit(doc);
      const yes = await Compat.DialogV2.confirm({
        window: { title: L(`${LANG}.Climb.Warn.Title`) },
        content: `<p>${L(`${LANG}.Climb.Warn.Text`, { name: esc(doc.name ?? ""), at: Math.round(height * 10) / 10, unit })}</p>`,
        yes: { label: L(`${LANG}.Climb.Warn.Yes`), icon: "fa-solid fa-person-falling" },
        no: { label: L(`${LANG}.Climb.Warn.No`), default: true },
        rejectClose: false
      });
      if (!yes) return null;
      return await this.drop(doc, to);
    } finally {
      this._asking = false;
    }
  },

  /** Let go and fall toward a spot (through the GM's client). */
  async drop(token, to) {
    const doc = this.doc(token);
    if (!doc?.parent) return null;
    const r = await Socket.request("climbDrop", { scene: doc.parent.id, token: doc.id, x: to.x, y: to.y });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return r;
  },

  /** Who a faller comes down on at a spot: whoever its mover targeted there, else whoever stands on it. */
  under(doc, at, user) {
    const size = Stairs.sizeOf(doc);
    const mid = { x: at.x + size.w / 2, y: at.y + size.h / 2 };
    const grid = Stairs.grid(doc);
    const near = [...(doc.parent?.tokens ?? [])].filter((t) => t.id !== doc.id && t.actor && !t.hidden).map((t) => ({ t, c: Stairs.centre(t), s: Stairs.sizeOf(t) }));
    const aimed = new Set([...(user?.targets ?? [])].map((t) => t.id ?? t.document?.id));
    const close = near.filter((n) => Math.hypot(n.c.x - mid.x, n.c.y - mid.y) <= grid * 1.5 + Math.max(n.s.w, n.s.h) / 2 - grid / 2);
    return (close.find((n) => aimed.has(n.t.id)) ?? near.find((n) => Math.abs(n.c.x - mid.x) < n.s.w / 2 && Math.abs(n.c.y - mid.y) < n.s.h / 2))?.t ?? null;
  },

  /** GM's client: a climber lets go, falling toward where it was moved. */
  async _drop({ scene, token, x, y }, userId) {
    const sc = game.scenes?.get?.(scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(token);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!this.on || !doc || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return null;
    const st = this.state(doc);
    const to = { x: Number.isFinite(Number(x)) ? Number(x) : doc.x, y: Number.isFinite(Number(y)) ? Number(y) : doc.y };
    if (!st) {
      // Off a floor's edge, or into an opening in it.
      const edge = this.falling(doc) ? null : this.ledge(doc, to);
      if (!edge) return null;
      const under = this.under(doc, edge.land, user)?.id ?? null;
      await doc.update({ ...edge.land, elevation: edge.drop }, this.opts());
      const fell = await this.fall(doc, { drop: edge.drop, base: 0 }, { why: L(`${LANG}.Climb.Edge.${edge.opening ? "WentIn" : "WentOff"}`, { name: esc(doc.name ?? "") }), target: under });
      return { height: fell };
    }
    const target = this.under(doc, to, user)?.id ?? null;
    await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
    await doc.update(to, this.opts());
    const height = await this.fall(doc, { drop: heightAt(st), base: st.base }, { why: L(`${LANG}.Climb.Fall.LetGo`, { name: esc(doc.name ?? "") }), target });
    return { height };
  },

  /**
   * How far below a token another is, and how far off across the plan: { up, across, reach, from, to }.
   * Floors of one building drawn side by side are measured on the one plan.
   */
  below(token, target) {
    const doc = this.doc(token);
    const tdoc = this.doc(target);
    if (!doc?.parent || !tdoc || doc.parent !== tdoc.parent) return null;
    const pa = Levels.place(doc, doc.parent);
    const pb = Levels.place(tdoc, doc.parent);
    if (!pa || !pb) return null;
    const from = stacked(pa.floor, pb.floor) && pa.corner && pb.corner ? onto(pa.point, pa.corner, pb.corner) : pa.point;
    const per = doc.parent.grid?.distance ?? canvas?.dimensions?.distance ?? 2;
    return { up: Math.round((pa.height - pb.height) * 10) / 10, across: Compat.measure(from, pb.point), reach: (CPR.stat(doc.actor, "move") || 0) * per, from, to: pb.point };
  },

  /** Death From Above on offer: a borg with PanzerFaust, one target 10 m/yds or more below, no further off than their MOVE. */
  diveFor(token) {
    const doc = this.doc(token);
    if (!this.on || !doc?.actor || this.falling(doc) || !this.panzer(doc.actor)) return null;
    const targets = [...(game.user?.targets ?? [])].filter((t) => (t.document ?? t).id !== doc.id);
    if (targets.length !== 1) return null;
    const target = targets[0].document ?? targets[0];
    const b = this.below(doc, target);
    if (!b || b.up < 10 || b.across > b.reach) return null;
    return { target, ...b };
  },

  async dive(token, target) {
    const doc = this.doc(token);
    if (!doc?.parent || !target) return null;
    const r = await Socket.request("climbDive", { scene: doc.parent.id, token: doc.id, target });
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return r;
  },

  /** GM's client: off the height and down beside the target, on the side they came from. */
  async _dive({ scene, token, target }, userId) {
    const sc = game.scenes?.get?.(scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(token);
    const tdoc = sc?.tokens?.get(target);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!this.on || !doc?.actor || !tdoc || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return null;
    const b = this.below(doc, tdoc);
    if (!b || b.up < 10 || b.across > b.reach || !this.panzer(doc.actor) || this.falling(doc)) return null;
    const step = besideStep(b.from, b.to);
    const mine = Stairs.sizeOf(doc);
    const theirs = Stairs.sizeOf(tdoc);
    const x = step.x > 0 ? tdoc.x + theirs.w : step.x < 0 ? tdoc.x - mine.w : tdoc.x;
    const y = step.y > 0 ? tdoc.y + theirs.h : step.y < 0 ? tdoc.y - mine.h : tdoc.y;
    const base = Number(tdoc.elevation) || 0;
    if (this.state(doc)) await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
    await doc.update({ x, y, elevation: Math.round((base + b.up) * 10) / 10 }, this.opts());
    const height = await this.fall(doc, { drop: b.up, base }, { why: L(`${LANG}.Climb.Dfa.Dive`, { name: esc(doc.name ?? ""), target: esc(tdoc.name ?? ""), height: b.up, unit: this.unit(doc) }), target: tdoc.id });
    return { height };
  },

  /**
   * GM's client: a throw or a leap, with the Check its maker rolled. A throw calls on the one
   * being thrown off to roll (a card with their button); a leap is settled here.
   */
  async _contest({ scene, token, kind, target = null, total = 0 }, userId) {
    const sc = game.scenes?.get?.(scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(token);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!this.on || !doc?.actor || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return null;
    const st = this.state(doc);
    const moves = this.moves(doc);
    const move = moves.find((m) => m.kind === kind && (!target || m.target === target));
    if (!st || !move) return null;
    const other = sc.tokens.get(move.target);
    const ost = this.state(other);
    const name = esc(doc.name ?? "");
    const oname = esc(other?.name ?? "");
    const a = { total: Number(total) || 0, text: String(Number(total) || 0) };
    if (kind === "throw") {
      if (!other?.actor || !ost) return null;
      await Cards.post({
        actor: other.actor, title: L(`${LANG}.Climb.Card.ThrowTitle`), kicker: L(`${LANG}.Climb.Ladder`), tone: "pink",
        body: `<p>${L(`${LANG}.Climb.Card.Throw`, { name, other: oname })}</p><p>${L(`${LANG}.Climb.Card.HoldAsk`, { name, attack: a.total, other: oname })}</p>`,
        buttons: this.ask("climb-hold", "Hold", { scene: sc.id, token: other.id, by: doc.id, attack: a.total })
      });
      return { kind, pending: "hold" };
    }
    if (kind === "leap") {
      if (!ost) return null;
      const land = leapTo({ front: ost.at, total: st.total, others: this.rivals(doc).map((r) => r.at) });
      if (!land) return null;
      const made = beats(a.total, LEAP_DV);
      const body = `<p>${L(`${LANG}.Climb.Card.Leap`, { name, other: oname, dv: LEAP_DV })}</p><p><b>${name}</b>: ${a.text}</p>`;
      if (!made && this.hasLine(doc.actor)) {
        // Off the rungs with a Grapple Hand or Gun: no Check needed to stay on (corebook pg. 181).
        await Cards.post({ actor: doc.actor, title: L(`${LANG}.Climb.Card.LeapTitle`), kicker: L(`${LANG}.Climb.Card.Caught`), body: `${body}<p>${L(`${LANG}.Climb.Card.GrappleLeap`, { name })}</p>`, tone: "cyan" });
        return { kind, won: false, fell: false };
      }
      if (!made) {
        await Cards.post({ actor: doc.actor, title: L(`${LANG}.Climb.Card.LeapTitle`), kicker: L(`${LANG}.Climb.Card.Missed`), body, tone: "pink" });
        await this.fall(doc, st, { why: L(`${LANG}.Climb.Card.MissedText`, { name }) });
        return { kind, won: false, fell: true };
      }
      await Cards.post({ actor: doc.actor, title: L(`${LANG}.Climb.Card.LeapTitle`), kicker: L(`${LANG}.Climb.Card.Past`), body: `${body}<p>${L(`${LANG}.Climb.Card.PastText`, { name, other: oname })}</p>`, tone: "cyan" });
      if (land.done) {
        const size = Stairs.sizeOf(doc);
        const head = sc.tiles?.get(st.to);
        const foot = sc.tiles?.get(st.id);
        await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
        await doc.update({ ...(head ? landing(head, size.w, size.h) : {}), elevation: elevationAfter({ base: st.base, height: st.height, floorFrom: foot ? this.floorAt(this.mid(foot), sc) : 0, floorTo: head ? this.floorAt(this.mid(head), sc) : 0 }) }, this.opts());
      } else {
        await doc.setFlag(MODULE_ID, CLIMB_FLAG, { ...st, at: land.at });
        await doc.update({ elevation: Math.round((st.base + land.at) * 10) / 10 }, this.opts());
      }
      return { kind, won: true, at: land.at, done: land.done };
    }
    return null;
  },

  /* ---------------------------------------- */
  /*  Climbers that share a square            */
  /* ---------------------------------------- */

  /** A climber's place in the line on its ladder, from the lowest (0) up. */
  rankOf(token) {
    const doc = this.doc(token);
    const st = this.state(doc);
    if (!st || st.kind !== "tile") return 0;
    return this.rivals(doc).filter((r) => r.at < st.at || (r.at === st.at && r.id < doc.id)).length;
  },

  /**
   * Several climbers on a ladder stand on the same square. Each one above the lowest is drawn a
   * step further up the map, to alternate sides, so every token can be seen, clicked and targeted;
   * from three climbers on they're drawn smaller too. Only where and how big it's drawn: the token
   * is still on the ladder's square, at its own size.
   */
  fan(token) {
    try {
      if (!token || token.isPreview) return;
      const doc = token.document;
      const w = token.w ?? 100;
      const h = token.h ?? 100;
      const st = this.on ? this.state(token) : null;
      const count = st?.kind === "tile" ? this.rivals(doc).length + 1 : 1;
      const lay = st ? fanLayout(this.rankOf(token), count, w, h) : { scale: 1, dx: 0, dy: 0 };
      const was = token._ncmFan;
      if (lay.scale === 1 && !lay.dx && !lay.dy) {
        if (!was) return;
        // Off the ladder, or alone on it again: back to its own place and size.
        delete token._ncmFan;
        token.scale?.set?.(1);
        this.meshScale(token, was, 1);
        token.position.set(doc.x, doc.y);
        token.mesh?.position?.set(doc.x + w / 2, doc.y + h / 2);
        return;
      }
      const x = doc.x + lay.dx;
      const y = doc.y + lay.dy;
      token.scale?.set?.(lay.scale);
      token.position.set(x, y);
      token._ncmFan = this.meshScale(token, was, lay.scale);
      token.mesh?.position?.set(x + (w * lay.scale) / 2, y + (h * lay.scale) / 2);
    } catch {
      /* drawn where it stands */
    }
  },

  /**
   * The token's picture, at a share of the size Foundry gave it. Foundry only sets that size now
   * and then, so what we last set is remembered: a picture still at our size is scaled from the
   * size it had before, not shrunk again.
   * @returns {{ bx, by, ax, ay }} the size it had (b) and the size it's drawn at (a).
   */
  meshScale(token, was, scale) {
    const m = token.mesh?.scale;
    if (!m) return { bx: 1, by: 1, ax: scale, ay: scale };
    const ours = was && Math.abs(m.x - was.ax) < 1e-6 && Math.abs(m.y - was.ay) < 1e-6;
    const bx = ours ? was.bx : m.x;
    const by = ours ? was.by : m.y;
    m.set(bx * scale, by * scale);
    return { bx, by, ax: bx * scale, ay: by * scale };
  },

  /* ---------------------------------------- */
  /*  Climbing                                */
  /* ---------------------------------------- */

  /** Climb a stretch (through the GM's client), and tell this player how it went. */
  async go(token, { dir = "up", line = false } = {}) {
    const doc = this.doc(token);
    if (!doc?.parent) return null;
    const r = await Socket.request("climbGo", { scene: doc.parent.id, token: doc.id, dir, line });
    if (r?.note) ui.notifications?.info(r.note);
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return r;
  },

  /** The movement a token has left to climb with: counted on its own Turn in a running combat, else unlimited. */
  budget(doc) {
    if (!Settings.get("trackMovement")) return { left: Infinity, cb: null };
    const combat = game.combats?.find?.((c) => c.started && c.combatant?.tokenId === doc.id && (!c.scene || c.scene.id === doc.parent?.id));
    const cb = combat?.combatant ?? null;
    if (!cb) return { left: Infinity, cb: null };
    const left = NeonRuler.leftFor(cb, combat)?.left;
    return { left: Number.isFinite(left) ? left : Infinity, cb };
  },

  /** Where everyone else on the same one-lane climb is. */
  othersOn(doc, st) {
    if (st.kind !== "tile") return [];
    return [...(doc.parent?.tokens ?? [])].filter((t) => t.id !== doc.id && this.state(t)?.id === st.id).map((t) => this.state(t).at);
  },

  opts: () => ({ animate: false, [MODULE_ID]: { free: true, stairs: true, climb: true } }),

  /** GM's client: one stretch of climbing for a token, for whoever may move it. */
  async _go({ scene, token, dir = "up", line = false }, userId) {
    const sc = game.scenes?.get?.(scene) ?? canvas?.scene;
    const doc = sc?.tokens?.get(token);
    const user = game.users?.get?.(userId) ?? game.user;
    if (!this.on || !doc || !(user?.isGM || doc.testUserPermission?.(user, "OWNER") || doc.isOwner)) return null;
    const size = Stairs.sizeOf(doc);
    let st = this.state(doc);
    // Starting: onto the ladder or the wall.
    if (!st) {
      const elevation = Number(doc.elevation) || 0;
      const ladder = this.ladderFor(doc);
      const wall = ladder ? null : this.wallFor(doc);
      if (ladder) {
        const floorFoot = this.floorAt(this.mid(ladder.foot), sc);
        const floorHead = this.floorAt(this.mid(ladder.head), sc);
        if (ladder.end === "foot") st = { kind: "tile", id: ladder.id, at: 0, height: ladder.height, total: ladder.height, base: elevation, to: ladder.head.id };
        else {
          // From the head: onto the ladder at its top, which is drawn at its foot.
          st = { kind: "tile", id: ladder.id, at: ladder.height, height: ladder.height, total: ladder.height, base: Math.round((elevation + (floorHead - floorFoot) - ladder.height) * 10) / 10, to: ladder.head.id };
          await doc.update({ ...landing(ladder.foot, size.w, size.h), elevation: st.base + st.at }, this.opts());
        }
      } else if (wall) {
        const here = Stairs.centre(doc);
        const there = across(here, wall.a, wall.b);
        if (this.upAt(doc, wall)) {
          const base = Math.round((elevation + (this.floorAt(here, sc) - this.floorAt(there, sc)) - wall.height) * 10) / 10;
          st = { kind: "wall", id: wall.id, at: wall.height, height: wall.height, total: wall.height, base, over: false, crossed: true, from: here };
          await doc.update({ x: there.x - size.w / 2, y: there.y - size.h / 2, elevation: base + wall.height }, this.opts());
        } else st = { kind: "wall", id: wall.id, at: 0, height: wall.height, total: wall.over ? wall.height * 2 : wall.height, base: elevation, over: wall.over, crossed: false, to: there };
      } else return null;
    }
    const { left, cb } = this.budget(doc);
    const factor = factorOf({ sure: this.sure(doc.actor), line: !!line && this.hasLine(doc.actor) });
    const ahead = aheadOf(st.at, this.othersOn(doc, st), dir);
    const res = stretch({ at: st.at, total: st.total, dir, left, factor, ahead });
    if (cb && res.cost > 0) await Turns.spend(cb, res.cost);
    const next = { ...st, at: res.at };
    const unit = this.unit(doc);
    const name = doc.name ?? "";
    // A wall climbed over: across the top to the far side.
    if (st.kind === "wall" && st.over && !st.crossed && res.at >= st.height && st.to) {
      next.crossed = true;
      await doc.update({ x: st.to.x - size.w / 2, y: st.to.y - size.h / 2 }, this.opts());
    } else if (st.kind === "wall" && st.over && st.crossed && res.at < st.height && dir === "down") {
      // And back again, for someone who turns round on the far side.
      const back = across(Stairs.centre(doc), ...this.wallEnds(sc, st.id));
      next.crossed = false;
      await doc.update({ x: back.x - size.w / 2, y: back.y - size.h / 2 }, this.opts());
    }
    const atTop = dir !== "down" && res.done;
    const atFoot = dir === "down" && res.done;
    if (atTop || atFoot) {
      await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
      if (atFoot || st.over) await doc.update({ elevation: st.base }, this.opts());
      else if (st.kind === "tile") {
        const head = sc.tiles?.get(st.to);
        const foot = sc.tiles?.get(st.id);
        const elevation = elevationAfter({ base: st.base, height: st.height, floorFrom: foot ? this.floorAt(this.mid(foot), sc) : 0, floorTo: head ? this.floorAt(this.mid(head), sc) : 0 });
        await doc.update({ ...(head ? landing(head, size.w, size.h) : {}), elevation }, this.opts());
      } else {
        const here = Stairs.centre(doc);
        const there = st.to ?? across(here, ...this.wallEnds(sc, st.id));
        const elevation = elevationAfter({ base: st.base, height: st.height, floorFrom: this.floorAt(here, sc), floorTo: this.floorAt(there, sc) });
        await doc.update({ x: there.x - size.w / 2, y: there.y - size.h / 2, elevation }, this.opts());
      }
      return { at: res.at, total: st.total, done: true, cost: res.cost, note: L(`${LANG}.Climb.Note.${atTop ? "top" : "foot"}`, { name: esc(name), cost: res.cost, unit }) };
    }
    await doc.setFlag(MODULE_ID, CLIMB_FLAG, next);
    await doc.update({ elevation: Math.round((st.base + heightAt(next)) * 10) / 10 }, this.opts());
    const why = res.stopped === "climber" ? "climber" : res.stopped === "movement" ? "movement" : "part";
    return { at: res.at, total: st.total, done: false, stopped: res.stopped, cost: res.cost, note: L(`${LANG}.Climb.Note.${why}`, { name: esc(name), at: res.at, total: st.total, cost: res.cost, unit }) };
  },

  mid: (t) => ({ x: t.x + t.width / 2, y: t.y + t.height / 2 }),

  wallEnds(scene, id) {
    const c = scene?.walls?.get?.(id)?.c ?? [0, 0, 0, 0];
    return [{ x: c[0], y: c[1] }, { x: c[2], y: c[3] }];
  },

  /** A climber's token was moved by hand: they've let go. The fall is the GM's to rule on. */
  async onMove(doc, changed, options = {}) {
    if (!Compat.isActiveGM || !("x" in (changed ?? {}) || "y" in (changed ?? {}))) return;
    const st = this.state(doc);
    if (!st || options?.[MODULE_ID]?.climb || options?.[MODULE_ID]?.carried) return;
    const height = heightAt(st);
    await doc.unsetFlag(MODULE_ID, CLIMB_FLAG);
    await doc.update({ elevation: st.base }, this.opts());
    if (height > 0) ui.notifications?.warn(L(`${LANG}.Climb.Note.letGo`, { name: esc(doc.name ?? ""), at: height, unit: this.unit(doc) }));
  },

  /* ---------------------------------------- */
  /*  The GM's walls                          */
  /* ---------------------------------------- */

  /** GM: make walls climbable ({ height, over }), or (height 0) plain again. */
  async setWalls(walls, { height = 0, over = false } = {}) {
    if (!game.user?.isGM) return 0;
    let n = 0;
    for (const w of walls ?? []) {
      const doc = w?.document ?? w;
      if (!doc?.id) continue;
      if (Number(height) > 0) await doc.setFlag(MODULE_ID, WALL_FLAG, { height: Math.round(Number(height) * 10) / 10, over: !!over });
      else await doc.unsetFlag(MODULE_ID, WALL_FLAG);
      n += 1;
    }
    Hooks.callAll(`${MODULE_ID}.fxChanged`);
    return n;
  },

  async markWalls() {
    if (!game.user?.isGM) return null;
    const picked = canvas?.walls?.controlled ?? [];
    if (!picked.length) {
      ui.notifications?.info(L(`${LANG}.Climb.PickWalls`));
      return null;
    }
    const now = (picked[0].document ?? picked[0]).flags?.[MODULE_ID]?.[WALL_FLAG] ?? {};
    const unit = esc(canvas.scene?.grid?.units || "m");
    const content = `<div class="ncm-levels"><p class="ncm-hint">${L(`${LANG}.Climb.WallHint`, { count: picked.length })}</p><div class="ncm-grid">`
      + `<label>${L(`${LANG}.Climb.Height`, { unit })}<input type="number" name="height" min="0" step="0.5" value="${Number(now.height) || ""}" placeholder="0"></label>`
      + `<label class="ncm-check"><input type="checkbox" name="over" ${now.over ? "checked" : ""}> ${L(`${LANG}.Climb.OverTick`)}</label></div></div>`;
    const got = await Compat.DialogV2.prompt({
      window: { title: L(`${LANG}.Climb.WallTool`) }, classes: ["neon-combat", "ncm-dialog"], content,
      ok: { label: L(`${LANG}.Levels.Save`), callback: (event, button) => ({ height: Number(button.form.elements.height.value) || 0, over: button.form.elements.over.checked }) },
      rejectClose: false
    }).catch(() => null);
    if (!got) return null;
    return this.setWalls(picked, got);
  },

  /* ---------------------------------------- */
  /*  What's drawn                            */
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

  /**
   * This client's drawing: for everyone, a gauge beside each ladder or wall with someone on it;
   * for the GM, a badge on every linked tile and climbable wall saying what it is.
   */
  draw() {
    // A climber's click area goes with the old drawing: so does a hover it was holding.
    for (const pad of this._pads ?? []) {
      try {
        if (pad.token?.hover && !pad.token.destroyed) pad.token._onHoverOut?.({ buttons: 0 });
      } catch {
        /* no hover to drop */
      }
    }
    this._pads = [];
    this.clear();
    if (!canvas?.ready || typeof PIXI === "undefined" || !Stairs.on) return 0;
    const scene = canvas.scene;
    const layer = new PIXI.Container();
    layer.eventMode = "passive";
    let n = 0;
    const unit = scene?.grid?.units || "m";
    if (game.user?.isGM && Settings.get("stairsMarks") !== false) {
      const tiles = Stairs.tiles(scene);
      const seen = new Set();
      for (const t of tiles) {
        const far = tiles.find((x) => x.id === t.to);
        if (far && !seen.has(far.id)) {
          const line = new PIXI.Graphics();
          line.lineStyle(2, 0x05d9e8, 0.28).moveTo(...Object.values(this.mid(t))).lineTo(...Object.values(this.mid(far)));
          layer.addChild(line);
        }
        seen.add(t.id);
        const to = far ? Stairs.toward({ from: t, to: far }, scene) : "";
        const words = [L(`${LANG}.Stairs.Kind.${t.kind}`), t.rise > 0 ? `${t.rise} ${unit}${t.end === "head" ? " ▼" : " ▲"}` : "", to ? `→ ${to}` : ""].filter(Boolean).join(" · ");
        layer.addChild(this.badge(this.mid(t), t.kind, words));
        n += 1;
      }
      for (const w of this.walls(scene)) {
        layer.addChild(this.badge({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, "ladder", `${L(`${LANG}.Climb.${w.over ? "Fence" : "Wall"}`)} · ${w.height} ${unit}`, 0xf3e600));
        n += 1;
      }
    }
    if (this.on) {
      const groups = new Map();
      for (const t of canvas.tokens?.placeables ?? []) {
        const st = this.state(t);
        if (!st || t.document?.hidden) continue;
        const key = st.kind === "tile" ? st.id : `${st.id}:${t.id}`;
        if (!groups.has(key)) groups.set(key, { st, tokens: [] });
        groups.get(key).tokens.push(t);
      }
      for (const g of groups.values()) {
        layer.addChild(this.gauge(g, unit));
        n += 1;
        // The line may have changed: draw each climber in its place again.
        for (const t of g.tokens) t.renderFlags?.set?.({ refreshPosition: true });
      }
    }
    // Someone falling: a warning on the square they come down on, and how far up they still are beside it.
    for (const t of canvas.tokens?.placeables ?? []) {
      const f = this.falling(t);
      if (!f || !Stairs.on || t.visible === false || (t.document?.hidden && !game.user?.isGM)) continue;
      layer.addChild(this.warning(t));
      layer.addChild(this.gauge({ st: { total: f.total }, tokens: [t] }, unit, { color: 0xff4d4d }));
      n += 1;
    }
    // Climbers drawn apart get a clickable area of their own, where each is drawn.
    for (const pad of this.pads()) {
      const hit = new PIXI.Container();
      hit.eventMode = "static";
      hit.cursor = "pointer";
      hit.hitArea = new PIXI.Rectangle(pad.x, pad.y, pad.w, pad.h);
      hit.on("pointerdown", (ev) => {
        ev.stopPropagation?.();
        this.press(pad.token, ev);
      });
      hit.on("pointerover", (ev) => this.hover(pad, true, ev));
      hit.on("pointerout", (ev) => this.hover(pad, false, ev));
      layer.addChild(hit);
      n += 1;
    }
    this._pads = this.pads();
    // And whoever has left a ladder: back to their own place and size.
    for (const t of canvas.tokens?.placeables ?? []) if (t._ncmFan && !this.state(t)) t.renderFlags?.set?.({ refreshPosition: true });
    if (!n) {
      layer.destroy();
      return 0;
    }
    (canvas.interface ?? canvas.stage).addChild(layer);
    this.layer = layer;
    this.tips = new Map();
    // The DVs to a climber drawn apart, beside where it's drawn: for the ones this player has targeted.
    const aimed = new Set([...(game.user?.targets ?? [])]);
    for (const pad of this._pads ?? []) if (aimed.has(pad.token)) this.tip(pad, true);
    return n;
  },

  /** A round badge with a drawn sign (stairs, a ladder, a door) and a line of words under it. */
  badge(at, kind, words, color = 0x05d9e8) {
    const box = new PIXI.Container();
    box.position.set(at.x, at.y);
    box.eventMode = "none";
    const g = new PIXI.Graphics();
    g.beginFill(0x07070b, 0.85).lineStyle(2, color, 0.95).drawCircle(0, 0, 18).endFill();
    g.lineStyle(2.5, color, 1);
    if (kind === "stairs") g.moveTo(-10, 8).lineTo(-4, 8).lineTo(-4, 2).lineTo(2, 2).lineTo(2, -4).lineTo(8, -4).lineTo(8, -10);
    else if (kind === "door") {
      g.drawRect(-6, -10, 12, 20);
      g.beginFill(color, 1).lineStyle(0).drawCircle(3, 1, 1.6).endFill();
    } else {
      g.moveTo(-5, -11).lineTo(-5, 11).moveTo(5, -11).lineTo(5, 11);
      for (const y of [-7, -1, 5]) g.moveTo(-5, y).lineTo(5, y);
    }
    box.addChild(g);
    if (words) {
      const text = new PIXI.Text(words, { fontFamily: globalThis.CONFIG?.canvasTextStyle?.fontFamily ?? "Signika", fontSize: 13, fontWeight: "bold", fill: color, stroke: 0x000000, strokeThickness: 4, align: "center" });
      text.anchor.set(0.5, 0);
      text.position.set(0, 22);
      box.addChild(text);
    }
    return box;
  },

  /**
   * Where each climber drawn apart from the others is drawn, lowest first: [{ token, x, y, w, h }].
   * Only ladders with two or more on them this player can see; a climber alone is clicked as ever.
   */
  pads() {
    if (!this.on) return [];
    const out = [];
    for (const t of canvas?.tokens?.placeables ?? []) {
      const st = this.state(t);
      if (!st || st.kind !== "tile" || t.visible === false || (t.document?.hidden && !game.user?.isGM)) continue;
      const count = this.rivals(t.document).length + 1;
      if (count < 2) continue;
      const w = t.w ?? 100;
      const h = t.h ?? 100;
      const rank = this.rankOf(t);
      const lay = fanLayout(rank, count, w, h);
      out.push({ token: t, rank, x: t.document.x + lay.dx, y: t.document.y + lay.dy, w: w * lay.scale, h: h * lay.scale });
    }
    return out.sort((a, b) => a.rank - b.rank);
  },

  /**
   * A click on a climber drawn apart. Left: select it (yours) or target it (anyone's), Alt to
   * target your own, Shift to add; twice quickly opens its sheet. Right: its Token HUD (yours),
   * or target it.
   */
  press(token, ev) {
    const add = !!ev?.shiftKey;
    const mine = !!(token.isOwner || game.user?.isGM);
    if (ev?.button === 2) {
      if (!mine) return this.pick(token, { target: true, add });
      const hud = canvas?.hud?.token;
      if (hud?.object === token && hud.rendered) return hud.clear?.();
      if (!token.controlled) token.control?.({ releaseOthers: !add });
      return hud?.bind?.(token);
    }
    const now = Date.now();
    const twice = this._pressed?.token === token && now - this._pressed.at < 400;
    this._pressed = { token, at: now };
    if (twice && !ev?.altKey && token.actor?.testUserPermission?.(game.user, "LIMITED")) return token.actor.sheet?.render?.(true);
    return this.pick(token, { target: !!ev?.altKey, add });
  },

  /**
   * The pointer over a climber drawn apart: Foundry's own hover, so its border shows and the
   * Target key finds it, and the DVs to it beside where it's drawn (they stay while it's targeted).
   */
  hover(pad, on, ev) {
    const token = pad.token;
    try {
      if (on) token._onHoverIn?.(ev, { hoverOutOthers: true });
      else token._onHoverOut?.(ev);
    } catch {
      /* no hover */
    }
    const aimed = [...(game.user?.targets ?? [])].includes(token);
    this.tip(pad, on || aimed);
  },

  /**
   * The DV display for a climber drawn apart: Diwako's words and settings, our distances, drawn
   * on the map beside the shrunk token, not inside it. on: false takes it away.
   */
  async tip(pad, on) {
    const id = pad.token.id ?? pad.token.document?.id;
    const layer = this.layer;
    const drop = () => {
      const old = this.tips?.get(id);
      if (old) {
        this.tips.delete(id);
        if (!old.destroyed) old.destroy();
      }
    };
    if (!on || !layer || !Dv.diwako || !Settings.get("arsenalDvDisplay")) return drop();
    let info = null;
    try {
      info = await Dv.textFor(pad.token);
    } catch (err) {
      console.warn(`${MODULE_ID} | DV display`, err);
    }
    // The map may have been drawn again while the tables were read.
    if (this.layer !== layer) return null;
    drop();
    if (!info) return null;
    const style = CONFIG.canvasTextStyle.clone();
    style.align = info.right ? "left" : "right";
    const label = new Compat.PreciseText(info.text, style);
    label.eventMode = "none";
    label.anchor.set(info.right ? 0 : 1, 0);
    label.position.set(info.right ? pad.x + pad.w + 12 : pad.x - 12, pad.y);
    layer.addChild(label);
    this.tips.set(id, label);
    return info;
  },

  /** A face on the gauge was clicked: select the token (yours) or target it (anyone's). */
  pick(token, { target = false, add = false } = {}) {
    const mine = (token.isOwner || game.user?.isGM) && !target;
    if (mine) return token.control?.({ releaseOthers: !add });
    const on = ![...(game.user?.targets ?? [])].includes(token);
    return token.setTarget?.(on, { releaseOthers: !add });
  },

  /** Where a falling token comes down: hazard stripes round its square and a warning sign in the corner. Never in the way of a click. */
  warning(token) {
    const doc = token.document;
    const w = token.w ?? 100;
    const h = token.h ?? 100;
    const box = new PIXI.Container();
    box.eventMode = "none";
    box.position.set(doc.x, doc.y);
    const g = new PIXI.Graphics();
    g.beginFill(0xff4d4d, 0.12).drawRect(0, 0, w, h).endFill();
    // Stripes along the edges, yellow on black.
    g.lineStyle(6, 0x07070b, 0.9).drawRect(3, 3, w - 6, h - 6);
    const dash = 14;
    g.lineStyle(6, 0xf3e600, 0.95);
    for (let x = 3; x < w - 3; x += dash * 2) {
      g.moveTo(x, 3).lineTo(Math.min(x + dash, w - 3), 3);
      g.moveTo(x, h - 3).lineTo(Math.min(x + dash, w - 3), h - 3);
    }
    for (let y = 3; y < h - 3; y += dash * 2) {
      g.moveTo(3, y).lineTo(3, Math.min(y + dash, h - 3));
      g.moveTo(w - 3, y).lineTo(w - 3, Math.min(y + dash, h - 3));
    }
    // The sign: a triangle with a mark in it, top left.
    g.lineStyle(2, 0x07070b, 1).beginFill(0xf3e600, 1).drawPolygon([14, 4, 26, 24, 2, 24]).endFill();
    g.lineStyle(2.5, 0x07070b, 1).moveTo(14, 11).lineTo(14, 17).moveTo(14, 20).lineTo(14, 21);
    box.addChild(g);
    return box;
  },

  /** What a pip on a gauge shows for a token: its place on the climb, or how far up it still is as it falls. */
  gaugeState(token) {
    const st = this.state(token);
    if (st) return st;
    const f = this.falling(token);
    return f ? { at: f.left, total: f.total } : { at: 0, total: 1 };
  },

  /**
   * A ladder drawn beside the climb, as long as the climb is high, with everyone on it where they
   * are. For someone falling, the same in red: how far up they still are.
   */
  gauge({ st, tokens }, unit, { color = 0x05d9e8 } = {}) {
    const first = tokens[0];
    const size = canvas.dimensions?.size ?? 100;
    const perMetre = size / (canvas.dimensions?.distance || 2);
    const len = Math.max(size * 1.5, Math.min(size * 5, st.total * perMetre));
    const box = new PIXI.Container();
    box.eventMode = "passive";
    // Beside the square they stand on, not beside where the first of them happens to be drawn.
    box.position.set((first.document?.x ?? first.x) + (first.w ?? size) + 14, (first.document?.y ?? first.y) + (first.h ?? size));
    const g = new PIXI.Graphics();
    g.beginFill(0x07070b, 0.7).lineStyle(1, 0x36364f, 1).drawRect(-6, -len - 10, 44, len + 20).endFill();
    g.lineStyle(2, color, 0.9).moveTo(4, 0).lineTo(4, -len).moveTo(28, 0).lineTo(28, -len);
    const rungs = Math.max(2, Math.min(24, Math.round(st.total)));
    for (let i = 0; i <= rungs; i += 1) g.lineStyle(1.5, color, 0.55).moveTo(4, -(len * i) / rungs).lineTo(28, -(len * i) / rungs);
    box.addChild(g);
    const style = { fontFamily: globalThis.CONFIG?.canvasTextStyle?.fontFamily ?? "Signika", fontSize: 12, fontWeight: "bold", fill: 0xd8dbec, stroke: 0x000000, strokeThickness: 3 };
    const top = new PIXI.Text(`${st.total} ${unit}`, style);
    top.anchor.set(0.5, 1);
    top.position.set(16, -len - 12);
    box.addChild(top);
    for (const t of [...tokens].sort((a, b) => this.gaugeState(a).at - this.gaugeState(b).at)) {
      const s = this.gaugeState(t);
      const y = -(len * s.at) / (s.total || 1);
      const pip = new PIXI.Container();
      pip.position.set(16, y);
      const ring = new PIXI.Graphics();
      const aimed = [...(game.user?.targets ?? [])].includes(t);
      ring.beginFill(0x07070b, 1).lineStyle(aimed ? 4 : 2, aimed ? 0xff4d4d : t.controlled ? 0xf3e600 : color, 1).drawCircle(0, 0, 13).endFill();
      if (aimed) for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ring.lineStyle(3, 0xff4d4d, 1).moveTo(ax * 9, ay * 9).lineTo(ax * 19, ay * 19);
      pip.addChild(ring);
      const texture = t.mesh?.texture ?? t.texture ?? null;
      if (texture) {
        const pic = new PIXI.Sprite(texture);
        pic.anchor.set(0.5);
        pic.width = 22;
        pic.height = 22;
        const mask = new PIXI.Graphics();
        mask.beginFill(0xffffff).drawCircle(0, 0, 11).endFill();
        pip.addChild(mask);
        pic.mask = mask;
        pip.addChild(pic);
      }
      const label = new PIXI.Text(`${t.name ?? ""} · ${s.at} ${unit}`, style);
      label.anchor.set(0, 0.5);
      label.position.set(18, 0);
      pip.addChild(label);
      // Climbers share a square. A face here stands for its token: click to target it (your own: to select it;
      // Alt-click or right-click targets those too). Shift adds to what's selected or targeted.
      pip.eventMode = "static";
      pip.cursor = "pointer";
      pip.hitArea = new PIXI.Rectangle(-15, -15, 150, 30);
      pip.on("pointerdown", (ev) => {
        ev.stopPropagation?.();
        this.pick(t, { target: !!ev.altKey || ev.button === 2, add: !!ev.shiftKey });
      });
      box.addChild(pip);
    }
    return box;
  }
};
