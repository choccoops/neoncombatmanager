import { MODULE_ID, LANG } from "../constants.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { Compat } from "../compat.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { Registry } from "../conditions/registry.js";
import { L, esc, slug } from "../util.js";
import { squaresBetween } from "../arsenal/timing.js";
import * as Rules from "./rules.js";
import { arrival } from "./fx-plan.js";
import { HackFx } from "./fx.js";

/** Actor flag (under the module scope): { links: { <target token id>: link }, cooldowns: { <item id>: cd }, lockouts: { <token id>: until } }. */
export const HACK_FLAG = "hack";
const PATH = `flags.${MODULE_ID}.${HACK_FLAG}`;
const ICON = `modules/${MODULE_ID}/assets/icons/netrunning.svg`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Quickhacking in the field (Core Rules ch.10, Part 1), from the Action HUD: Jack In (or Ghost
 * Jack In) to the token you target, Breach its Passwalls, run the quickhacks slotted in your deck,
 * Jack Out; the target can try to kick you out. Each step rolls, posts a card and plays its
 * animation (fx.js) by what the roll decided.
 *
 * Who's in whose Neuroport lives on the Netrunner's actor (the HACK_FLAG), so their player writes
 * it; what happens to the target (conditions, damage) and a target kicking them out goes through
 * the GM.
 *
 * Left to the table: range and line of sight, counting NET Actions, a quickhack's Needs, vehicles,
 * a Cybersuite's built-in quickhacks, Pathfinder bonuses, and Self-ICE: Defender's uses an hour.
 */
export const Hack = {
  /** Tests shorten the wait for the upload to arrive. */
  wait,

  get on() {
    return !!Settings.get("hackFlow");
  },

  init() {
    HackFx.init();
    Socket.on("hackState", async ({ actor, update }) => {
      const doc = await fromUuid(actor);
      const safe = Object.fromEntries(Object.entries(update ?? {}).filter(([k]) => k.startsWith(`${PATH}.`)));
      if (doc && Object.keys(safe).length) await doc.update(safe);
      return true;
    });
    Socket.on("hackDamage", async ({ actor, amount }) => {
      const doc = await fromUuid(actor);
      return doc ? CPR.damageHP(doc, amount, { reason: "quickhack" }) : 0;
    });
    // A target that leaves the scene takes its links with it.
    Hooks.on("deleteToken", (doc) => {
      if (!Compat.isActiveGM) return;
      for (const t of canvas?.tokens?.placeables ?? []) {
        if (t.actor && this.state(t.actor).links[doc.id]) this._write(t.actor, { [`${PATH}.links.-=${doc.id}`]: null });
      }
    });
  },

  /* ---------------------------------------- */
  /*  State                                   */
  /* ---------------------------------------- */

  state(actor) {
    const f = actor?.flags?.[MODULE_ID]?.[HACK_FLAG] ?? {};
    return { links: f.links ?? {}, cooldowns: f.cooldowns ?? {}, lockouts: f.lockouts ?? {} };
  },

  async _write(actor, update) {
    if (actor.isOwner) return actor.update(update);
    return Socket.request("hackState", { actor: actor.uuid, update });
  },

  now() {
    const c = game.combat?.started ? game.combat : null;
    return { combat: c?.id ?? null, round: c?.round ?? 0, turn: c?.turn ?? 0, time: game.time.worldTime, roundSeconds: Number(Settings.get("roundSeconds")) || 3 };
  },

  /** The Netrunner's rig: the deck they run, their Netrunner role and Interface, the quickhacks slotted. */
  rig(actor) {
    const items = [...(actor?.items ?? [])];
    const deck = items.find((i) => i.type === "cyberdeck" && (i.system?.equipped === "equipped" || i.system?.isInstalled)) ?? null;
    const role = items.find((i) => i.type === "role" && i.id === actor?.system?.roleInfo?.activeNetRole)
      ?? items.find((i) => i.type === "role" && /netrunner/i.test(i.name ?? "")) ?? null;
    const slotted = deck ? (deck.system?.installedItems?.list ?? []).map((id) => actor.items.get(id)).filter(Boolean) : [];
    return { deck, role, rank: Number(role?.system?.rank) || 0, hacks: slotted.map((i) => Rules.quickhackOf(i)).filter(Boolean) };
  },

  /** The tokens whose Neuroport this character is in (on this scene): [{ id, token, link }]. */
  links(actor) {
    return Object.entries(this.state(actor).links)
      .map(([id, link]) => ({ id, link, token: canvas?.tokens?.get?.(id) ?? null }))
      .filter((l) => l.link && l.token);
  },

  /** Netrunners in this token's Neuroport that its owner knows about: [{ runner (token), link }]. */
  intruders(token) {
    if (!token?.id) return [];
    return (canvas?.tokens?.placeables ?? [])
      .map((t) => ({ runner: t, link: t.actor ? this.state(t.actor).links[token.id] : null }))
      .filter((x) => x.link && x.link.aware && !x.link.ghost);
  },

  _token(actor, token) {
    return token?.object ?? token ?? tokensOf(actor)[0] ?? null;
  },

  _squares(a, b) {
    return a && b ? squaresBetween(a.center, b.center, canvas.grid.size) : 0;
  },

  /* ---------------------------------------- */
  /*  Rolls                                   */
  /* ---------------------------------------- */

  /** A d10 as Cyberpunk RED rolls it: a 10 adds another d10, a 1 takes one away. */
  async d10() {
    const roll = async () => Number((await new Roll("1d10").evaluate()).total) || 0;
    const first = await roll();
    if (first === 10) return first + (await roll());
    if (first === 1) return first - (await roll());
    return first;
  },

  /**
   * The Netrunner's Interface Check, through Cyberpunk RED's own roll on their deck (its dialog,
   * modifiers, LUCK and criticals; Cloak for a Ghost) when it's there; else Interface + 1d10.
   * @returns {Promise<number|null>} the total; null when the dialog was closed
   */
  async interfaceCheck(actor, rig, { title, ability = "backdoor", event = null } = {}) {
    let roll = null;
    try {
      if (rig.deck && rig.role && typeof rig.deck.createRoll === "function") {
        roll = rig.deck.createRoll("interfaceAbility", actor, { interfaceAbility: ability, cyberdeck: rig.deck, netRoleItem: rig.role });
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | Interface roll`, err);
    }
    if (!roll || typeof roll.roll !== "function") return rig.rank + (await this.d10());
    roll.rollTitle = title;
    const ev = event ?? { type: "click", ctrlKey: false, metaKey: false };
    if (typeof roll.handleRollDialog === "function" && !(await roll.handleRollDialog(ev, actor, rig.deck))) return null;
    await roll.roll();
    const luck = Number(roll.luck);
    if (Number.isInteger(luck) && luck > 0) {
      const have = CPR.stat(actor, "luck");
      await actor.update({ "system.stats.luck.value": have - Math.min(luck, have) });
    }
    return Number(roll.resultTotal) || 0;
  },

  /** What a target rolls against a Jack In or a rattled port: WILL + 1d10; a Netrunner against a Ghost, Interface + 1d10. */
  async resist(target, { ghost = false } = {}) {
    const rank = this.rig(target).rank;
    const base = ghost && rank ? rank : CPR.stat(target, "will");
    return { total: base + (await this.d10()), netrunner: ghost && !!rank };
  },

  /* ---------------------------------------- */
  /*  Cards                                   */
  /* ---------------------------------------- */

  /** A card for a step. Ghosted and unnoticed: only the GM and the Netrunner's players get it. */
  card(actor, { title, lines = [], tone = "cyan", secret = false, buttons = [], img = ICON }) {
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Hack.Kicker`),
      title,
      img,
      tone,
      body: lines.filter(Boolean).map((l) => `<p>${l}</p>`).join(""),
      buttons,
      whisper: secret ? Cards.owners(actor) : null,
      flags: { hack: true }
    });
  },

  _ejectButton(runnerToken, target) {
    return { action: "hack-eject", label: L(`${LANG}.Hack.Card.EjectButton`), icon: "fa-solid fa-user-slash", owner: true, data: { actor: target.uuid, runner: runnerToken?.id ?? "" } };
  },

  /* ---------------------------------------- */
  /*  The steps                               */
  /* ---------------------------------------- */

  /** The one token the user targets, as the Neuroport to act on. */
  _targeted() {
    const targets = [...(game.user.targets ?? [])];
    return targets.length === 1 ? targets[0] : null;
  },

  _fail(key, data) {
    ui.notifications?.warn(L(`${LANG}.Hack.Error.${key}`, data));
    return null;
  },

  /**
   * Jack In (or Ghost Jack In) to the targeted token.
   * @returns {Promise<object|null>} { won, aware, ghosted, walls } or null when it didn't happen
   */
  async jackIn(actor, { token = null, ghost = false, event = null, target = null } = {}) {
    const rig = this.rig(actor);
    if (!rig.deck) return this._fail("NoDeck", { name: esc(actor.name) });
    const tt = target ?? this._targeted();
    const victim = tt?.actor;
    if (!victim) return this._fail("NoTarget");
    const me = this._token(actor, token);
    if (victim === actor || tt.id === me?.id) return this._fail("Self");
    const st = this.state(actor);
    if (st.links[tt.id]) return this._fail("AlreadyIn", { target: esc(tt.name) });
    const now = this.now();
    const locked = Number(st.lockouts[tt.id]) || 0;
    if (locked > now.time) return this._fail("LockedOut", { target: esc(tt.name), minutes: Math.ceil((locked - now.time) / 60) });
    const names = { name: esc(actor.name), target: esc(tt.name) };

    // The basic firewall: Interface 1-2 has to beat DV6 first; failing doesn't alert them.
    const fw = Rules.firewallDv(rig.rank);
    if (fw !== null) {
      const total = await this.interfaceCheck(actor, rig, { title: L(`${LANG}.Hack.Roll.Firewall`), event });
      if (total === null) return null;
      if (!(total > fw)) {
        await this.card(actor, { title: L(`${LANG}.Hack.Card.Firewall`, names), lines: [L(`${LANG}.Hack.Card.VsDv`, { total, dv: fw }), L(`${LANG}.Hack.Card.FirewallHint`)], tone: "pink", secret: true });
        return null;
      }
    }

    const attack = await this.interfaceCheck(actor, rig, { title: L(`${LANG}.Hack.Roll.${ghost ? "Ghost" : "JackIn"}`), ability: ghost ? "cloak" : "backdoor", event });
    if (attack === null) return null;
    const defense = await this.resist(victim, { ghost });
    const out = Rules.jackIn({ attack, defense: defense.total, ghost });
    const walls = Rules.passwalls(victim.items);
    const link = { scene: canvas?.scene?.id ?? null, name: tt.name, ghost: out.ghosted, aware: out.aware, walls, total: walls, at: null };
    await this._write(actor, { [`${PATH}.links.${tt.id}`]: link });

    const key = ghost ? (out.ghosted ? "Ghosted" : "GhostFail") : out.won ? "JackedIn" : "JackedInKnown";
    await this.card(actor, {
      title: L(`${LANG}.Hack.Card.${key}`, names),
      lines: [
        L(`${LANG}.Hack.Card.${defense.netrunner ? "VsInterface" : "VsWill"}`, { attack, defense: defense.total }),
        L(`${LANG}.Hack.Card.Cost`, { n: ghost ? 2 : 1 }),
        walls ? L(`${LANG}.Hack.Card.Walls`, { n: walls, dv: Rules.breachDv(walls) }) : L(`${LANG}.Hack.Card.NoWalls`),
        ghost && !out.ghosted ? L(`${LANG}.Hack.Card.LadderStep`) : null
      ],
      tone: out.aware ? "red" : "cyan",
      secret: out.ghosted,
      buttons: out.aware ? [this._ejectButton(me, victim)] : []
    });
    HackFx.send("jackIn", { runner: me?.id, target: tt.id, aware: out.aware, ghosted: out.ghosted });
    return { ...out, walls };
  },

  /** The link to act on: the one named, the only one, or the one whose token is targeted. */
  _link(actor, targetId = null) {
    const links = this.links(actor);
    if (!links.length) return this._fail("NoLink");
    const hit = targetId ? links.find((l) => l.id === targetId) : links.length === 1 ? links[0] : links.find((l) => l.id === this._targeted()?.id);
    return hit ?? this._fail("PickLink");
  },

  /** A target finds out (a loud hack, a broken Ghost): the link says so and the alert plays. */
  async _reveal(actor, me, l) {
    await this._write(actor, { [`${PATH}.links.${l.id}.ghost`]: false, [`${PATH}.links.${l.id}.aware`]: true });
    HackFx.send("detect", { runner: me?.id, target: l.id, trace: true });
  },

  /** A rattled port while Ghosted: the target's roll against the Netrunner's Interface + Cloak. */
  async _rattle(actor, rig, victim, event) {
    const runner = await this.interfaceCheck(actor, rig, { title: L(`${LANG}.Hack.Roll.StayGhosted`), ability: "cloak", event });
    const target = await this.resist(victim, { ghost: true });
    const total = runner ?? rig.rank;
    return { runner: total, target: target.total, holds: Rules.ghostHolds({ runner: total, target: target.total }) };
  },

  /** Breach one Passwall on a Neuroport you're in. */
  async breach(actor, targetId = null, { token = null, event = null } = {}) {
    const rig = this.rig(actor);
    const l = this._link(actor, targetId);
    if (!l) return null;
    const names = { name: esc(actor.name), target: esc(l.token.name) };
    if (!(l.link.walls > 0)) return this._fail("NoWalls", names);
    const me = this._token(actor, token);
    const dv = Rules.breachDv(l.link.total ?? l.link.walls);
    const total = await this.interfaceCheck(actor, rig, { title: L(`${LANG}.Hack.Roll.Breach`), event });
    if (total === null) return null;
    const { down } = Rules.breach({ total, dv });
    const ghosted = !!l.link.ghost;
    const lines = [L(`${LANG}.Hack.Card.VsDv`, { total, dv })];
    let broken = false;
    if (down) {
      // (the link read above is the actor's own data: the write changes it under us)
      const left = l.link.walls - 1;
      await this._write(actor, { [`${PATH}.links.${l.id}.walls`]: left });
      lines.push(L(`${LANG}.Hack.Card.WallsLeft`, { n: left }));
    } else if (ghosted) {
      const r = await this._rattle(actor, rig, l.token.actor, event);
      broken = !r.holds;
      lines.push(L(`${LANG}.Hack.Card.Rattle`, { target: r.target, runner: r.runner }), L(`${LANG}.Hack.Card.${broken ? "GhostBroken" : "GhostHolds"}`));
    }
    HackFx.send("breach", { runner: me?.id, target: l.id, down, ghosted });
    await this.card(actor, {
      title: L(`${LANG}.Hack.Card.${down ? "Breached" : "IceHolds"}`, names),
      lines,
      tone: down ? "cyan" : "pink",
      secret: ghosted && !broken,
      buttons: broken ? [this._ejectButton(me, l.token.actor)] : []
    });
    if (broken) {
      await Hack.wait(arrival(this._squares(me, l.token), HackFx.jb2a) + 400);
      await this._reveal(actor, me, l);
    }
    return { down, broken };
  },

  /** Run a slotted quickhack on a Neuroport you're in. */
  async quickhack(actor, itemId, targetId = null, { token = null, event = null } = {}) {
    const rig = this.rig(actor);
    const q = rig.hacks.find((h) => h.id === itemId);
    if (!q) return this._fail("NotSlotted");
    const l = this._link(actor, targetId);
    if (!l) return null;
    const names = { name: esc(actor.name), target: esc(l.token.name), hack: esc(q.name) };
    const now = this.now();
    const left = Rules.cooldownLeft(this.state(actor).cooldowns[q.id], now);
    if (left === Infinity) return this._fail("Burned", names);
    if (left > 0) return this._fail(now.combat ? "Cooldown" : "CooldownTime", { ...names, n: now.combat ? left : Math.ceil(left / 60) });
    if (l.link.walls > 0) return this._fail("WallsUp", { ...names, n: l.link.walls });
    if (Rules.hackedThisTurn(l.link, now)) return this._fail("ThisTurn", names);

    const me = this._token(actor, token);
    const victim = l.token.actor;
    const total = await this.interfaceCheck(actor, rig, { title: q.name, event });
    if (total === null) return null;
    const ghosted = !!l.link.ghost;
    const wasAware = !!l.link.aware;
    const out = Rules.quickhack({ total, dv: q.dv, quiet: q.quiet, ghosted, targetNetrunner: !!this.rig(victim).rank });

    // The Cooldown runs hit or miss, and that's this target's quickhack for the Turn.
    await this._write(actor, {
      [`${PATH}.cooldowns.${q.id}`]: Rules.startCooldown(q.cooldown, now),
      [`${PATH}.links.${l.id}.at`]: now.combat ? { combat: now.combat, round: now.round, turn: now.turn } : null
    });

    const lines = [L(`${LANG}.Hack.Card.VsDv`, { total, dv: q.dv })];
    let broken = out.ghostBroken;
    const condition = out.hit && q.condition ? Registry.get(q.condition) : null;
    let damage = 0;
    if (out.hit) {
      if (condition) lines.push(L(`${LANG}.Hack.Card.Gains`, { target: names.target, condition: esc(condition.name) }));
      if (q.damage) {
        const rolled = Number((await new Roll(q.damage).evaluate()).total) || 0;
        const defender = Rules.hasDefender(victim.items);
        damage = Rules.soaked(rolled, defender);
        lines.push(L(`${LANG}.Hack.Card.Damage`, { amount: damage, formula: q.damage }));
        if (defender) lines.push(L(`${LANG}.Hack.Card.Defender`, { n: Rules.DEFENDER_SOAK }));
      }
      if (!condition && !q.damage) lines.push(L(`${LANG}.Hack.Card.ByHand`));
      if (out.noticeRoll) {
        const r = await this._rattle(actor, rig, victim, event);
        broken = !r.holds;
        lines.push(L(`${LANG}.Hack.Card.Rattle`, { target: r.target, runner: r.runner }), L(`${LANG}.Hack.Card.${broken ? "GhostBroken" : "GhostHolds"}`));
      } else if (ghosted) lines.push(L(`${LANG}.Hack.Card.${out.ghostBroken ? "GhostBroken" : "QuietGlitch"}`));
    }
    if (q.needs) lines.push(L(`${LANG}.Hack.Card.Needs`, { needs: esc(q.needs) }));
    lines.push(L(`${LANG}.Hack.Card.Cooldown`, { cooldown: esc(typeof q.cooldown === "number" ? L(`${LANG}.Hack.Rounds`, { n: q.cooldown }) : q.cooldown) }));

    const unseen = ghosted && !broken;
    HackFx.send("upload", { runner: me?.id, target: l.id, hit: out.hit, family: q.family, key: q.key, ghosted: unseen, condition: !!condition });
    const known = out.hit && (out.aware || broken);
    await this.card(actor, {
      title: L(`${LANG}.Hack.Card.${out.hit ? "Hit" : "Miss"}`, names),
      lines,
      tone: out.hit ? (q.family === "combat" || q.family === "ultimate" ? "red" : "cyan") : "pink",
      secret: unseen,
      buttons: known && !wasAware ? [this._ejectButton(me, victim)] : []
    });

    if (out.hit) {
      // What it does lands as the upload arrives.
      await Hack.wait(arrival(this._squares(me, l.token), HackFx.jb2a));
      if (condition) await Conditions.add(condition.id, victim);
      if (damage > 0) {
        if (victim.isOwner) await CPR.damageHP(victim, damage, { reason: "quickhack" });
        else await Socket.request("hackDamage", { actor: victim.uuid, amount: damage });
      }
      if (known && (!wasAware || ghosted)) {
        await Hack.wait(350);
        await this._reveal(actor, me, l);
      }
    }
    return { ...out, broken, damage, condition: condition?.id ?? null };
  },

  /** Jack Out of one Neuroport (or all of them): a safe disconnect. */
  async jackOut(actor, targetId = null, { token = null } = {}) {
    const me = this._token(actor, token);
    const links = this.links(actor).filter((l) => !targetId || l.id === targetId);
    const stale = Object.keys(this.state(actor).links).filter((id) => (!targetId || id === targetId) && !links.some((l) => l.id === id));
    if (!links.length && !stale.length) return this._fail("NoLink");
    for (const l of links) HackFx.send("jackOut", { runner: me?.id, target: l.id, ghosted: !!l.link.ghost });
    await this._write(actor, Object.fromEntries([...links.map((l) => l.id), ...stale].map((id) => [`${PATH}.links.-=${id}`, null])));
    for (const l of links) {
      await this.card(actor, { title: L(`${LANG}.Hack.Card.JackedOut`, { name: esc(actor.name), target: esc(l.token.name) }), secret: !!l.link.ghost });
    }
    return links.length;
  },

  /**
   * The target tries to kick a Netrunner out (an Action): WILL + Concentration + 1d10 against the
   * Netrunner's Interface + 1d10. Out that way is an unsafe Jack Out, and an hour's lockout.
   */
  async eject(target, runnerTokenId, { token = null, event = null } = {}) {
    if (!target?.isOwner) return this._fail("NotYours");
    const mine = this._token(target, token);
    const found = this.intruders(mine).find((x) => !runnerTokenId || x.runner.id === runnerTokenId);
    if (!found) return this._fail("NoIntruder");
    const runner = found.runner;
    const check = await CPR.skillCheck(target, "Concentration", { event, stat: "will" });
    if (!check) return null;
    const mineTotal = Number(check.total ?? check.resultTotal) || 0;
    const theirs = this.rig(runner.actor).rank + (await this.d10());
    const { ejected } = Rules.eject({ target: mineTotal, runner: theirs });
    const names = { name: esc(runner.name), target: esc(target.name) };
    if (ejected) {
      HackFx.send("eject", { runner: runner.id, target: mine.id });
      await this._write(runner.actor, {
        [`${PATH}.links.-=${mine.id}`]: null,
        [`${PATH}.lockouts.${mine.id}`]: game.time.worldTime + Rules.LOCKOUT_SECONDS
      });
    }
    await this.card(target, {
      title: L(`${LANG}.Hack.Card.${ejected ? "Ejected" : "EjectFail"}`, names),
      lines: [L(`${LANG}.Hack.Card.VsEject`, { target: mineTotal, runner: theirs }), ejected ? L(`${LANG}.Hack.Card.Lockout`) : null],
      tone: ejected ? "cyan" : "pink"
    });
    return { ejected };
  },

  /* ---------------------------------------- */
  /*  The Action HUD and cards                */
  /* ---------------------------------------- */

  /** The Netrunning entries for the Action HUD. */
  entries(actor, token = null) {
    const out = [];
    if (!this.on || !actor) return out;
    const rig = this.rig(actor);
    if (rig.deck) {
      const now = this.now();
      const links = this.links(actor);
      const cds = this.state(actor).cooldowns;
      out.push(
        { key: "hack:jackIn", label: L(`${LANG}.Hack.Hud.JackIn`), icon: "fa-solid fa-plug", sub: L(`${LANG}.Hack.Hud.NetActions`, { n: Rules.netActions(rig.rank) }) },
        { key: "hack:ghost", label: L(`${LANG}.Hack.Hud.Ghost`), icon: "fa-solid fa-ghost" }
      );
      for (const l of links) {
        const name = l.token.name;
        if (l.link.walls > 0) {
          out.push({ key: "hack:breach", run: `hack:breach:${l.id}`, label: L(`${LANG}.Hack.Hud.Breach`, { target: name }), icon: "fa-solid fa-shield-halved", sub: `DV${Rules.breachDv(l.link.total ?? l.link.walls)} ×${l.link.walls}`, alert: true });
        }
        out.push({ key: "hack:out", run: `hack:out:${l.id}`, label: L(`${LANG}.Hack.Hud.JackOut`, { target: name }), icon: "fa-solid fa-plug-circle-xmark", sub: l.link.ghost ? L(`${LANG}.Hack.Hud.Ghosted`) : "" });
      }
      const ready = links.some((l) => !(l.link.walls > 0));
      for (const q of rig.hacks) {
        const left = Rules.cooldownLeft(cds[q.id], now);
        const sub = left === Infinity ? L(`${LANG}.Hack.Hud.Burned`) : left > 0 ? (now.combat ? L(`${LANG}.Hack.Hud.Cooling`, { n: left }) : L(`${LANG}.Hack.Hud.CoolingTime`, { n: Math.ceil(left / 60) })) : `DV${q.dv}${q.quiet ? " ◆" : ""}`;
        out.push({ key: `qh:${slug(q.name)}`, run: `hack:run:${q.id}`, label: q.name, img: actor.items.get(q.id)?.img, sub, off: left > 0 || !ready });
      }
    }
    for (const x of this.intruders(this._token(actor, token))) {
      out.push({ key: "hack:eject", run: `hack:eject:${x.runner.id}`, label: L(`${LANG}.Hack.Hud.Eject`, { name: x.runner.name }), icon: "fa-solid fa-user-slash", alert: true });
    }
    return out;
  },

  /** Run an Action HUD entry: "hack:<what>[:<id>]". */
  run(actor, [what, id], ctx = {}) {
    if (!this.on) return null;
    switch (what) {
      case "jackIn":
        return this.jackIn(actor, ctx);
      case "ghost":
        return this.jackIn(actor, { ...ctx, ghost: true });
      case "breach":
        return this.breach(actor, id, ctx);
      case "run":
        return this.quickhack(actor, id, null, ctx);
      case "out":
        return this.jackOut(actor, id, ctx);
      case "eject":
        return this.eject(actor, id, ctx);
      default:
        return null;
    }
  },

  /** A card's button (the target's Eject). */
  async click(message, btn, event, actor) {
    if (btn.dataset.ncmAction === "hack-eject") return this.eject(actor, btn.dataset.runner || null, { event });
    return null;
  }
};

/** An actor's tokens on the scene being viewed. */
function tokensOf(actor) {
  try {
    return actor?.getActiveTokens?.() ?? [];
  } catch {
    return [];
  }
}
