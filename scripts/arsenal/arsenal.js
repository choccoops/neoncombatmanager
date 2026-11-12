import { MODULE_ID, LANG, SYSTEM_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { Registry, sightKeys } from "../conditions/registry.js";
import { Core } from "../neonfx/core.js";
import { Bridge } from "../roller/bridge.js";
import { shellAutofire, classify, profileKeys, smartBaked } from "./kinds.js";
import { soundPlan } from "./profile.js";
import { Rebuilds, RebuildRegistry, REBUILD_HOOK, traitsOf, attackMods, damageArgs } from "./rebuilds.js";
import { AA, loadedAmmo } from "./aa.js";
import { Cover } from "../cover/cover.js";
import { Blast, damageFromHtml } from "./blast.js";
import { Dv } from "./dv.js";
import { Sound } from "./sound.js";
import { Defense } from "./defense.js";
import { Shots } from "./shots.js";
import { Sync } from "./sync.js";
import { Xray } from "./xray.js";
import { Equipped, improvedSmart } from "./equipped.js";
import { specialsOf, specialMods, moreDice, ruleCrit } from "./specials.js";
import { Stakes } from "../stakes/stakes.js";
import { L, esc } from "../util.js";

/** How long a roll waits for its card. */
const PENDING_MS = 30000;
/** An Improved Smart retry: 14 + 1d10 for a miss by 5 or less (2070 Core Rules Ch07). */
export const SMART_RETRY = { base: 14, within: 5 };

/** The kind of a CPR roll, with or without the roller bridge loaded. */
export function rollKind(roll) {
  if (Bridge.rolls) {
    const k = Bridge.kindOf(roll);
    return k === "attack" || k === "damage" ? k : null;
  }
  const name = String(roll?.constructor?.name ?? "");
  if (/DamageRoll/.test(name)) return "damage";
  if (/(Attack|Autofire|SuppressiveFire)Roll/.test(name)) return "attack";
  return null;
}

/**
 * Does a shot hit each target, pure: [{ name, dv, hit, by, dodge, mult }]. A Check must beat the
 * DV (a tie misses). Autofire's damage is 2d6 times what it beat the DV by, up to the weapon's
 * number (Ch07, Firing Modes). Someone who can dodge bullets (REF 8+, or chrome) may roll Evasion instead.
 * @param {number} total
 * @param {object[]} targets - { name, dv, ref, dodge? }
 */
export function hitLines(total, targets, { autofire = false, cap = 0 } = {}) {
  return (targets ?? []).filter((t) => Number.isFinite(Number(t.dv)) && t.dv !== null).map((t) => {
    const by = Number(total) - Number(t.dv);
    const hit = by > 0;
    return { name: t.name, dv: Number(t.dv), hit, by: hit ? by : 1 - by, dodge: t.dodge ?? Number(t.ref) >= 8, mult: autofire && hit ? Math.min(by, Number(cap) || by) : 0 };
  });
}

/** Can an Improved Smart round try again (a miss by 5 or less)? */
export const smartRetry = (total, dv) => Number.isFinite(Number(dv)) && Number(total) <= Number(dv) && Number(dv) - Number(total) <= SMART_RETRY.within;

/** The penalties on a roll (its negative modifiers, summed): an Improved Smart retry keeps them. */
export function penaltyOf(roll) {
  const mods = Array.isArray(roll?.mods) ? roll.mods : [];
  return mods.reduce((sum, m) => {
    const v = Number(typeof m === "object" && m !== null ? m.value : m);
    return Number.isFinite(v) && v < 0 ? sum + v : sum;
  }, 0);
}

/**
 * Visual obscurement, which Improved Smart rounds ignore (2070 Ch07): every penalty from Low Light,
 * Darkness, Obscured, smoke and pop-ups, and the sight penalties weather puts on.
 */
export function obscures(c, key, sight = new Set(sightKeys())) {
  if (!c) return false;
  if (c.category === "visibility" || c.id === "smoke" || c.id === "qhPopupGeddon") return true;
  return c.category === "weather" && sight.has(key);
}

/**
 * The obscurement penalties among a roll's modifiers (CPR names each one `<key>-<effect id>`).
 * @param {Function} conditionOf - effect id -> condition, or null
 */
export function obscurementMods(mods, conditionOf, sight = new Set(sightKeys())) {
  return (mods ?? []).filter((m) => {
    if (!(Number(m?.value) < 0) || typeof m.id !== "string" || !m.id.includes("-")) return false;
    return obscures(conditionOf(m.id.slice(m.id.lastIndexOf("-") + 1)), m.key ?? m.id.slice(0, m.id.lastIndexOf("-")), sight);
  });
}

/** Did a damage roll come up a Critical Injury (two or more 6s)? */
export function rolledCrit(roll) {
  try {
    if (typeof roll?.wasCritSuccess === "function") return !!roll.wasCritSuccess();
    if (typeof roll?.wasCritical === "function") return !!roll.wasCritical();
  } catch {
    /* not rolled */
  }
  const faces = roll?.faces ?? roll?.terms?.[0]?.results?.map((r) => r.result) ?? [];
  return faces.filter((f) => Number(f) === 6).length >= 2;
}

/** An Improved Smart retry's formula: 14 + 1d10, the first shot's penalties, and any LUCK spent. */
export function retryFormula(penalty = 0, luck = 0) {
  let f = `${SMART_RETRY.base} + 1d10`;
  if (penalty) f += ` - ${Math.abs(penalty)}`;
  if (luck > 0) f += ` + ${luck}`;
  return f;
}

/**
 * Neon Arsenal: Cyberpunk RED's weapons in the 2070s, at the table. Automated Animations' looks
 * (with Diwako's muzzle flashes), sounds, area attacks that place their own template, and the
 * weapon traits a 2070 gun or a Rebuild gives (Power ricochets, Tech charges, Smart's +1,
 * Melee Rebuilds). It all starts where Cyberpunk RED confirms a roll (CPRItem#confirmRoll),
 * which the sheet, the roll card's Damage button, CPR's macros and the Action HUD all go through.
 */
export const Arsenal = {
  pending: null,

  init() {
    Sound.init();
    Defense.init();
    Xray.init();
    Equipped.init();
    AA.init();
    Blast.init();
    Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
      this.tag(message, userId);
      return this.diwakoHit(message, userId);
    });
    Hooks.on("createChatMessage", (message, options, userId) => this.onCard(message, userId).catch((err) => console.error(`${MODULE_ID} | arsenal`, err)));
    Hooks.on(Compat.chatRenderHook, (message, html) => this.decorate(message, html));
    Socket.on("arsenalPush", (data) => this.pushAsGM(data));
    Socket.on("arsenalConditions", (data) => this.conditionsAsGM(data));
  },

  /** Modules add their rebuilds now (Neon At Home: the Melee Rebuilds, the Ricochet Compensator). */
  setup(api) {
    Hooks.callAll(REBUILD_HOOK, api);
  },

  async ready() {
    this.patch();
    Dv.installDisplay();
    // The GM's offer to install the animations comes a few seconds in; nothing waits for the answer.
    AA.ready();
    Equipped.ready();
  },

  /** Wrap CPR's confirmRoll (once): it runs right before the dice, for every way a roll is made. */
  patch() {
    const proto = CONFIG.Item?.documentClass?.prototype;
    if (!proto || typeof proto.confirmRoll !== "function" || proto[`${MODULE_ID}Arsenal`]) return false;
    proto[`${MODULE_ID}Arsenal`] = true;
    const confirm = proto.confirmRoll;
    const self = this;
    // And createRoll: what a Smart gun and its Improved Smart rounds change is on the roll before its dialog opens.
    if (typeof proto.createRoll === "function") {
      const create = proto.createRoll;
      proto.createRoll = function (...args) {
        const roll = create.apply(this, args);
        try {
          if (roll && typeof roll.then !== "function") self.preDialog(this, roll);
        } catch (err) {
          console.error(`${MODULE_ID} | arsenal (before the roll dialog)`, err);
        }
        return roll;
      };
    }
    proto.confirmRoll = async function (cprRoll, ...rest) {
      const out = (await confirm.call(this, cprRoll, ...rest)) ?? cprRoll;
      try {
        await self.preRoll(this, out);
      } catch (err) {
        console.error(`${MODULE_ID} | arsenal (before the dice)`, err);
      }
      return out;
    };
    return true;
  },

  tokenFor(actor) {
    const controlled = (canvas?.tokens?.controlled ?? []).find((t) => t.actor?.id === actor.id);
    return controlled ?? actor.getActiveTokens?.()?.[0] ?? null;
  },

  /** What preDialog did to each roll, for the card: roll -> { unobscured, split }. */
  pre: new WeakMap(),

  /**
   * Before the roll dialog opens, so the player sees it there: a Smart gun's +1 as a line of its
   * own ("Smart weapon"; taken out of the weapon's own modifier where Neon Hub put it), and, with
   * Improved Smart Ammunition loaded, the visual obscurement penalties off the roll (the dialog
   * lists them unticked).
   */
  preDialog(item, roll) {
    const actor = item?.actor;
    if (!actor || rollKind(roll) !== "attack" || !["weapon", "cyberware"].includes(item.type) || !Settings.get("arsenalRebuilds")) return null;
    if (!Array.isArray(roll.mods)) return null;
    const upgrades = Rebuilds.upgradesOf(item, actor);
    const info = classify(item, loadedAmmo(item, actor), upgrades);
    // The weapon's own rules (its card): a flat modifier by name, and what the magazine held before the shot.
    const name = String(roll.constructor?.name ?? "");
    const own = specialMods(specialsOf(item), { aimed: /Aimed/.test(name), autofire: /Autofire/.test(name), name: item.name, moduleId: MODULE_ID });
    for (const m of own) if (!roll.mods.some((x) => x?.id === m.id)) roll.mods.push(m);
    const done = { unobscured: 0, split: false, special: own.length > 0, magazine: Number(item.system?.magazine?.value) };
    this.pre.set(roll, done);
    if (!info.ranged || info.flavor !== "smart") return own.length ? done : null;
    const traits = traitsOf(info.flavor, upgrades);
    const linked = Rebuilds.linked(actor);
    if (traits.attackMod && !roll.mods.some((m) => m?.id === `${MODULE_ID}-smart`)) {
      // Neon Hub's Smart guns hold the +1 in their own attack modifier: it comes out, to be shown by name.
      if (smartBaked(item, upgrades)) {
        const own = roll.mods.find((m) => m && !m.id && m.key === "bonuses.universalAttack" && Number(m.value) >= traits.attackMod);
        if (own) {
          own.value = Number(own.value) - traits.attackMod;
          if (!own.value) roll.mods.splice(roll.mods.indexOf(own), 1);
          done.split = true;
        }
      }
      if ((done.split || !smartBaked(item, upgrades)) && (!traits.needsLink || linked)) {
        roll.mods.push({ id: `${MODULE_ID}-smart`, value: traits.attackMod, source: L(`${LANG}.Arsenal.Mod.smart`), key: "bonuses.ranged", category: "combat" });
      }
    }
    if (improvedSmart(info)) done.unobscured = this.unobscure(actor, roll);
    this.pre.set(roll, done);
    return done;
  },

  /** Take the visual obscurement penalties off a roll (Improved Smart rounds): the sum that came off. */
  unobscure(actor, roll) {
    const off = obscurementMods(roll.mods, (id) => Registry.ofEffect(actor.effects?.get?.(id)));
    for (const m of off) {
      const i = roll.mods.indexOf(m);
      if (i >= 0) roll.mods.splice(i, 1);
    }
    return off.reduce((sum, m) => sum + Number(m.value), 0);
  },

  /** Before the dice: traits on the roll, an area placed, the DV it faces. */
  async preRoll(item, roll) {
    const actor = item?.actor;
    const kind = rollKind(roll);
    if (!actor || !kind || !["weapon", "cyberware"].includes(item.type)) return;
    const ammo = loadedAmmo(item, actor);
    const upgrades = Rebuilds.upgradesOf(item, actor);
    const info = classify(item, ammo, upgrades);
    const traits = traitsOf(info.flavor, upgrades);
    const mode = actor.flags?.[SYSTEM_ID]?.[`firetype-${item.id}`] || "single";
    const state = Rebuilds.state(actor, item);
    const token = this.tokenFor(actor);
    const targets = [...(game.user.targets ?? [])];
    const tag = {
      kind, actorId: actor.id, itemId: item.id, tokenId: token?.id ?? null, mode, weapon: info.kind, flavor: info.flavor,
      ammoType: info.ammoType, ammoVariety: info.ammoVariety, explosive: info.explosive, area: !!info.area, ranged: info.ranged,
      tags: traits.tags, sources: traits.sources, targets: targets.map((t) => t.id), ricochet: false, charged: false, dv: null,
      critBonus: traits.critBonus, smartLink: info.flavor !== "smart" && upgrades.some((u) => /smart ?gun link/i.test(u.name ?? ""))
    };
    const rebuilds = !!Settings.get("arsenalRebuilds");
    // The control group with shells: Autofire is a Shotgun Shell attack (the Autofire Skill, 4 shells, dodged at -3).
    const shell = mode === "autofire" ? shellAutofire(upgrades, info.ammoVariety) : null;
    if (shell) tag.shell = shell;
    if (kind === "damage" && shell) {
      // A shell attack's damage, not Autofire's 2d6 times the multiplier CPR set up for the card's mode.
      roll.isAutofire = false;
      if (typeof item.getWeaponDamage === "function") roll.formula = item.getWeaponDamage();
    }
    if (kind === "attack") {
      const aimed = mode === "aimed" || (Bridge.rolls?.CPRAimedAttackRoll && roll instanceof Bridge.rolls.CPRAimedAttackRoll);
      // The weapon's own rules: a burst is named on the card; fired short, its damage is the card's.
      const sp = specialsOf(item);
      const pre0 = this.pre.get(roll) ?? {};
      if (sp?.burst && info.ranged && (sp.burst.every || !["autofire", "suppressive"].includes(mode))) {
        const had = Number.isFinite(pre0.magazine) ? pre0.magazine : Infinity;
        const short = had < sp.burst.rounds;
        tag.burst = { rounds: short ? Math.max(1, had) : sp.burst.rounds, short, damage: short ? sp.burst.shortDamage : null };
        if (short && sp.burst.shortDamage) await Rebuilds.setState(actor, item, { shortBurst: sp.burst.shortDamage });
        else if (state.shortBurst) await Rebuilds.setState(actor, item, { shortBurst: null });
      }
      if (sp?.autofire && mode === "autofire") tag.autofireRounds = sp.autofire;
      if (pre0.special) tag.specialMod = (roll.mods ?? []).find((m) => m?.id === `${MODULE_ID}-special`)?.value ?? 0;
      if (rebuilds) {
        const ricochet = !!state.ricochet && info.ranged && !info.explosive && !sp?.noRicochet;
        const pre = pre0;
        // The Smart +1 may be on the roll already, by name, since before its dialog (preDialog).
        const mods = attackMods(traits, { ranged: info.ranged, aimed, ricochet, linked: Rebuilds.linked(actor), baked: smartBaked(item, upgrades) && !pre.split })
          .filter((m) => !(roll.mods ?? []).some((x) => x?.id === m.id));
        if (mods.length && typeof roll.addMod === "function") roll.addMod(mods);
        if ((roll.mods ?? []).some((m) => m?.id === `${MODULE_ID}-smart` && Number(m.value) > 0)) tag.smartBonus = traits.attackMod;
        else if (info.ranged && info.flavor === "smart" && traits.needsLink && !Rebuilds.linked(actor)) tag.smartNoLink = true;
        tag.ricochet = ricochet;
        if (state.ricochet) await Rebuilds.setState(actor, item, { ricochet: false });
        // Improved Smart rounds ignore visual obscurement: those penalties come off the roll.
        if (improvedSmart(info)) {
          // Those ticked back on in the dialog come off too: the rounds ignore them.
          const off = (pre.unobscured ?? 0) + this.unobscure(actor, roll);
          if (off) tag.unobscured = off;
        }
        if (traits.active.includes("charge") && Rebuilds.isCharged(actor, item) && !info.explosive) {
          tag.charged = true;
          await Rebuilds.setState(actor, item, { chargedUntil: 0, fired: true });
          this.chargeLook(token, item, false);
        }
      }
      if (info.area && Blast.on && mode !== "suppressive" && mode !== "aimed" && token) {
        await Blast.place({ area: info.area, actor, item, token, info, ammo, dodge: shell?.dodge ?? 0 });
      } else if (targets[0] && token && info.ranged) {
        // The DV each target stands at (a ROF 2 attack can split between two).
        tag.hits = [];
        for (const t of targets) {
          const dv = await Dv.forWeapon(item, Dv.distance(token, t), { autofire: mode === "autofire" });
          // Cover in the way (a charged Tech shot goes through Thin cover): the card says so, and the damage card can hit it.
          const cover = Cover.forShot(token, t, { throughThin: tag.charged });
          tag.hits.push({ name: t.name, dv, ref: CPR.stat(t.actor, "ref"), dodge: Defense.ability(t.actor, { attacker: actor, ricochet: tag.ricochet }).can, ...(cover ? { cover } : {}) });
        }
        tag.dv = tag.hits[0]?.dv ?? null;
        tag.cap = Number(item.system?.fireModes?.autoFire) || 0;
      }
    }
    if (kind === "damage" && info.ranged && !info.area && token && targets.length) {
      const charged = !!Rebuilds.state(actor, item).fired;
      const cover = targets.map((t) => ({ name: t.name, ...Cover.forShot(token, t, { throughThin: charged }) })).filter((c) => c.kind);
      if (cover.length) tag.cover = cover;
    }
    if (kind === "damage") {
      // The weapon's own rules on its damage: more dice on an Aimed Shot, a short burst's damage, SP ablated, its Critical Injury rule.
      const sp = specialsOf(item);
      const extra = (roll.rollCardExtraArgs ??= {});
      if (state.shortBurst) {
        roll.formula = state.shortBurst;
        tag.shortBurst = state.shortBurst;
        await Rebuilds.setState(actor, item, { shortBurst: null });
      } else if (sp?.aimedDice && mode === "aimed" && typeof roll.formula === "string") {
        roll.formula = moreDice(roll.formula, sp.aimedDice);
        tag.aimedDice = sp.aimedDice;
      }
      if (sp?.ablate) {
        const more = state.fired && sp.ablate.charged ? sp.ablate.charged : sp.ablate.extra;
        extra.ablationValue = (Number(extra.ablationValue) || 0) + more;
        tag.ablate = more;
      }
      if (sp?.crit) tag.critRule = { ...sp.crit, aimed: mode === "aimed" };
    }
    if (kind === "damage" && rebuilds) {
      const charged = !!state.fired;
      const extra = (roll.rollCardExtraArgs ??= {});
      const args = damageArgs(traits, { bonusDamage: roll.bonusDamage, ignoreBelowSP: extra.ignoreBelowSP, ignoreArmorPercent: extra.ignoreArmorPercent, charged });
      roll.bonusDamage = args.bonusDamage;
      extra.ignoreBelowSP = args.ignoreBelowSP;
      extra.ignoreArmorPercent = args.ignoreArmorPercent;
      tag.charged = charged;
      tag.push = info.area ? null : traits.push;
      if (charged) await Rebuilds.setState(actor, item, { fired: false });
    }
    this.pending = { tag, roll, at: Date.now() };
  },

  /** The roll's card, about to be posted (the roller's client): it carries what Neon Arsenal saw. */
  tag(message, userId) {
    const p = this.pending;
    if (!p || userId !== game.user.id || Date.now() - p.at > PENDING_MS || !String(message.content ?? "").includes('class="rollcard"')) return;
    this.pending = null;
    const crit = p.tag.kind === "damage" ? rolledCrit(p.roll) : false;
    // Not two 6s, but a Critical Injury by the weapon's own rule (5s count as 6s...).
    if (p.tag.critRule && !crit) {
      const faces = p.roll?.faces ?? p.roll?.terms?.[0]?.results?.map((r) => r.result) ?? [];
      if (ruleCrit({ crit: p.tag.critRule }, faces, { aimed: p.tag.critRule.aimed })) p.tag.ruleCrit = Number(p.roll?.bonusDamage) || 5;
    }
    message.updateSource({ [`flags.${MODULE_ID}.arsenal`]: { ...p.tag, total: Number(p.roll.resultTotal) || 0, penalty: penaltyOf(p.roll), crit, at: Date.now() } });
  },

  /**
   * Diwako's "Does it hit?" message reads "<table> (Autofire)", which the 2070 guns don't have;
   * with Neon Arsenal's own check on the card, it's kept out of the chat (it has no setting).
   */
  diwakoHit(message, userId) {
    if (userId !== game.user.id || !Settings.get("arsenalHitCheck") || !Settings.get("arsenalHideDiwakoHit") || !game.modules.get("diwako-cpred-additions")?.active) return true;
    return !/^<div class="cpr-block" style="padding:10px;background-color:/.test(String(message.content ?? ""));
  },

  /** The card is posted (the roller's client): sounds, the area, pushes. */
  async onCard(message, userId) {
    if (userId !== game.user.id) return;
    const a = message.flags?.[MODULE_ID]?.arsenal;
    if (!a) return;
    if (a.kind === "attack") {
      const keys = profileKeys({ kind: a.weapon, flavor: a.flavor, ammoType: a.ammoType });
      if (a.tags?.[0]) keys.unshift(`${keys.at(-1)} · ${a.tags[0]}`);
      const hit = a.dv !== null && a.dv !== undefined ? a.total > a.dv : false;
      // Each sound at the moment its picture shows it: the shot as the round leaves, the impact
      // as it arrives. Who draws the shot decides the clock.
      const play = (times) => {
        for (const s of soundPlan(keys, { mode: a.mode, ricochet: a.ricochet, hit, ranged: a.ranged, explosive: a.explosive, patreon: AA.patreon, times })) {
          Sound.play(s.key, { delay: s.delay });
        }
      };
      const drawn = Shots.attack(a);
      const placed = a.area && a.explosive ? Blast.find(a.actorId, a.itemId, { states: ["placed"] }) : null;
      if (drawn && drawn.look !== "smartlink") {
        // A ricochet or Smart rounds, drawn here and now.
        play(drawn);
        if (drawn.look === "smart") {
          Sound.play("smartLock");
          Sound.play("smartSeek", { delay: drawn.launch });
        }
      } else if (placed) {
        // A blast: Neon Arsenal throws the round itself, below.
        play(Blast.times(placed));
      } else {
        if (drawn) Sound.play("smartLock");
        // Automated Animations draws it: wait for its first frame (at once if it isn't taking this one).
        const times = AA.flight(a, keys);
        if (AA.active) Sync.when(a.tokenId, () => play(times));
        else play(times);
      }
      if (a.charged && a.flavor === "tech") {
        const bolt = AA.flight(a, keys);
        const draw = () => Shots.charged(a, { arrive: bolt?.arrive });
        if (AA.active) Sync.when(a.tokenId, draw);
        else draw();
      }
      if (this.canRetry(a) && Settings.get("arsenalSmartPrompt")) {
        setTimeout(() => this.promptRetry(message).catch((err) => console.error(`${MODULE_ID} | smart retry`, err)), 1400);
      }
      if (a.area) {
        const doc = Blast.find(a.actorId, a.itemId, { states: ["placed"] });
        if (doc) await Blast.onAttack({ ...a, messageId: message.id }, doc);
      } else await Defense.afterAttack(a, message);
    }
    if (a.kind === "damage") {
      const scene = canvas?.scene?.id;
      if (a.crit && a.critBonus && Shots.powerCrit(a)) Sound.play("impactArmor");
      if (a.push && a.targets?.length) await Socket.request("arsenalPush", { scene, tokens: a.targets, from: a.tokenId, ...a.push });
      if (a.charged && a.ammoVariety === "shotgunSlug" && a.targets?.length) await Socket.request("arsenalConditions", { scene, tokens: a.targets, ids: ["prone"] });
    }
  },

  /* ---------------------------------------- */
  /*  On the cards                            */
  /* ---------------------------------------- */

  /** Notes and buttons under CPR's attack and damage cards. */
  decorate(message, html) {
    const a = message.flags?.[MODULE_ID]?.arsenal;
    const root = Compat.element(html);
    const card = root?.querySelector?.(".rollcard");
    if (!a || !card || root.querySelector(".ncm-arsenal")) return;
    const notes = [];
    const buttons = [];
    if (a.kind === "attack" && a.mode !== "suppressive" && a.hits?.length && Settings.get("arsenalHitCheck")) {
      for (const h of hitLines(a.total, a.hits, { autofire: a.mode === "autofire", cap: a.cap })) {
        let line = L(`${LANG}.Arsenal.HitCheck.${h.hit ? "hit" : "miss"}`, { name: esc(h.name), dv: h.dv, by: h.by });
        if (h.mult) line += ` ${L(`${LANG}.Arsenal.HitCheck.autofire`, { mult: h.mult })}`;
        if (h.dodge) line += ` ${L(`${LANG}.Arsenal.HitCheck.dodge`)}`;
        const cover = a.hits.find((x) => x.name === h.name)?.cover;
        if (cover) line += ` ${L(`${LANG}.Cover.${cover.self ? "Shooting" : "Behind"}`, { cover: esc(cover.label), hp: cover.hp })}`;
        notes.push(`<span class="ncm-hit ${h.hit ? "is-hit" : "is-miss"}">${line}</span>`);
      }
    }
    if (a.kind === "attack" && a.ricochet) notes.push(L(`${LANG}.Arsenal.Note.ricochet`));
    if (a.kind === "attack" && a.charged) notes.push(L(`${LANG}.Arsenal.Note.chargedAttack`));
    if (a.kind === "attack" && a.burst) notes.push(L(`${LANG}.Arsenal.Note.${a.burst.short ? (a.burst.damage ? "burstShortDamage" : "burstShort") : "burst"}`, { rounds: a.burst.rounds, damage: a.burst.damage ?? "" }));
    if (a.kind === "attack" && a.autofireRounds) notes.push(L(`${LANG}.Arsenal.Note.autofireRounds`, { rounds: a.autofireRounds.rounds }));
    if (a.kind === "attack" && a.specialMod) notes.push(L(`${LANG}.Arsenal.Note.specialMod`, { value: a.specialMod > 0 ? `+${a.specialMod}` : a.specialMod }));
    if (a.kind === "damage" && a.shortBurst) notes.push(L(`${LANG}.Arsenal.Note.shortBurstDamage`, { damage: a.shortBurst }));
    if (a.kind === "damage" && a.aimedDice) notes.push(L(`${LANG}.Arsenal.Note.aimedDice`, { dice: a.aimedDice }));
    if (a.kind === "damage" && a.ablate) notes.push(L(`${LANG}.Arsenal.Note.ablate`, { extra: a.ablate }));
    if (a.kind === "damage" && a.ruleCrit) notes.push(L(`${LANG}.Arsenal.Note.ruleCrit`, { face: a.critRule?.face ?? 5, bonus: a.ruleCrit }));
    if (a.kind === "attack" && a.smartBonus) notes.push(L(`${LANG}.Arsenal.Note.smartBonus`, { value: a.smartBonus }));
    if (a.kind === "attack" && a.smartNoLink) notes.push(L(`${LANG}.Arsenal.Note.smartNoLink`));
    if (a.kind === "attack" && a.unobscured) notes.push(L(`${LANG}.Arsenal.Note.unobscured`, { value: a.unobscured }));
    if (a.kind === "damage" && a.crit && a.critBonus) notes.push(L(`${LANG}.Arsenal.Note.powerCrit`));
    if (a.kind === "damage" && a.charged) notes.push(L(`${LANG}.Arsenal.Note.chargedDamage`));
    if (a.kind === "damage" && a.sources?.length && Settings.get("arsenalRebuilds")) notes.push(L(`${LANG}.Arsenal.Note.traits`, { list: esc(a.sources.map((s) => this.sourceLabel(s)).join(", ")) }));
    if (a.kind === "damage" && a.push) notes.push(L(`${LANG}.Arsenal.Note.push`, { metres: a.push.metres }));
    const actor = game.actors.get(a.actorId);
    if (this.canRetry(a) && actor?.isOwner) {
      buttons.push(`<button type="button" data-arsenal="retry"><i class="fa-solid fa-satellite-dish"></i> ${L(`${LANG}.Arsenal.SmartRetry`, { dv: a.dv })}</button>`);
    }
    if (a.kind === "damage" && a.area && game.user.isGM) {
      const doc = Blast.find(a.actorId, a.itemId);
      if (doc) buttons.push(`<button type="button" data-arsenal="apply" data-template="${esc(doc.uuid)}"><i class="fa-solid fa-burst"></i> ${L(`${LANG}.Arsenal.ApplyArea`)}</button>`);
    }
    if (a.kind === "damage" && a.cover?.length && game.user.isGM) {
      a.cover.forEach((c, i) => buttons.push(`<button type="button" data-arsenal="cover" data-i="${i}"><i class="fa-solid fa-shield-halved"></i> ${L(`${LANG}.Cover.HitButton`, { cover: esc(c.label), name: esc(c.name) })}</button>`));
    }
    if (!notes.length && !buttons.length) return;
    const box = document.createElement("div");
    box.className = "ncm-arsenal neon-combat-chat";
    box.innerHTML = `${notes.map((n) => `<p class="ncm-ref">${n}</p>`).join("")}${buttons.length ? `<footer>${buttons.join("")}</footer>` : ""}`;
    card.after(box);
    box.querySelector("[data-arsenal=apply]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      Blast.askAndApply(ev.currentTarget.dataset.template, damageFromHtml(message.content)).catch((err) => ui.notifications.error(err.message));
    });
    for (const btn of box.querySelectorAll("[data-arsenal=cover]")) {
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.currentTarget.disabled = true;
        const c = a.cover[Number(ev.currentTarget.dataset.i)];
        const dmg = damageFromHtml(message.content);
        Cover.damage(c, dmg?.total ?? 0, { explosive: !!a.explosive }).catch((err) => ui.notifications.error(err.message));
      });
    }
    box.querySelector("[data-arsenal=retry]")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.currentTarget.disabled = true;
      this.promptRetry(message).catch((err) => ui.notifications.error(err.message));
    });
  },

  sourceLabel(s) {
    return ["power", "smart", "tech"].includes(s) ? L(`${LANG}.Arsenal.Flavor.${s}`) : s;
  },

  /** Does an attack card offer an Improved Smart retry (a Smart gun's Improved Smart round that missed by 5 or less)? */
  canRetry(a) {
    return a?.kind === "attack" && a.flavor === "smart" && a.ammoType === "smart" && !a.retried && smartRetry(a.total, a.dv);
  },

  /** Ask the shooter whether to take the Improved Smart retry, and how much LUCK to add. */
  async promptRetry(message) {
    const a = message.flags?.[MODULE_ID]?.arsenal;
    const actor = game.actors.get(a?.actorId);
    if (!this.canRetry(a) || !actor?.isOwner || message.flags[MODULE_ID].arsenal.retried) return null;
    const luck = Stakes.luck(actor).value;
    const penalty = Number(a.penalty) || 0;
    const content = `<p>${L(`${LANG}.Arsenal.RetryAsk.Body`, { by: Number(a.dv) - Number(a.total) + 1, dv: a.dv, formula: retryFormula(penalty) })}</p>`
      + (luck > 0 ? `<div class="form-group"><label>${L(`${LANG}.Arsenal.RetryAsk.Luck`, { luck })}</label><input type="number" name="luck" value="0" min="0" max="${luck}" step="1"></div>` : "");
    const spend = await Compat.DialogV2.wait({
      window: { title: L(`${LANG}.Arsenal.RetryAsk.Title`) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      buttons: [
        { action: "retry", label: L(`${LANG}.Arsenal.RetryAsk.Go`), icon: "fa-solid fa-satellite-dish", default: true,
          callback: (event, button) => Math.max(0, Math.min(luck, Math.floor(Number(button.form?.elements?.luck?.value) || 0))) },
        { action: "no", label: L(`${LANG}.Arsenal.RetryAsk.No`), callback: () => null }
      ],
      rejectClose: false
    });
    if (spend === null || spend === undefined || spend === "no") return null;
    return this.smartRetry(message, { luck: Number(spend) || 0 });
  },

  /**
   * Improved Smart Ammunition: a miss by 5 or less tries again at 14 + 1d10 instead of STAT + Skill,
   * the first shot's penalties still applying, plus any LUCK spent (2070 Core Rules Ch07).
   */
  async smartRetry(message, { luck = 0 } = {}) {
    const a = message.flags[MODULE_ID].arsenal;
    if (a.retried) return null;
    const actor = game.actors.get(a.actorId);
    await message.setFlag(MODULE_ID, "arsenal.retried", true).catch(() => null);
    a.retried = true;
    const spent = luck > 0 && actor ? -(await Stakes.setLuck(actor, -luck)) : 0;
    const roll = await new Roll(retryFormula(Number(a.penalty) || 0, spent)).evaluate();
    const hit = roll.total > a.dv;
    Shots.retry(a, hit);
    Sound.play("smartReacquire");
    return roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor }),
      flavor: `${L(`${LANG}.Arsenal.SmartRetryFlavor`)}${spent ? ` · ${L(`${LANG}.Arsenal.RetryLuck`, { luck: spent })}` : ""} · ${L(`${LANG}.Arsenal.${hit ? "Hit" : "Miss"}`, { total: roll.total, dv: a.dv })}`
    });
  },

  /** Card buttons (routed here by Cards): apply an area, roll a save against ammo. */
  async click(message, btn, event, actor) {
    const d = btn.dataset;
    switch (d.ncmAction) {
      case "arsenal-apply":
        if (!game.user.isGM) return null;
        return Blast.askAndApply(d.template);
      case "arsenal-evade":
      case "arsenal-tank":
        return Defense.click(message, btn, event, actor);
      case "arsenal-scatter":
        if (!game.user.isGM) return null;
        btn.disabled = true;
        return Blast.scatter(d.template);
      case "arsenal-save": {
        if (!actor?.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
        const skill = CPR.skill(actor, d.skill);
        const result = await CPR.skillCheck(actor, d.skill, { event, stat: skill?.system?.stat ?? (/cybertech/i.test(d.skill) ? "tech" : "will") });
        if (!result) return null;
        btn.disabled = true;
        // Beat the DV to resist.
        if (result.total > Number(d.dv)) return ui.notifications?.info(L(`${LANG}.Notify.Resisted`, { name: actor.name }));
        const adds = String(d.adds ?? "").split(",").filter(Boolean);
        if (adds.length) await Conditions.add(adds, actor);
        if (d.direct) {
          const r = await new Roll(d.direct).evaluate();
          await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: L(`${LANG}.Arsenal.Direct`, { name: actor.name }) });
          await CPR.damageHP(actor, r.total, { reason: "arsenal" });
        }
        return null;
      }
      default:
        return null;
    }
  },

  /* ---------------------------------------- */
  /*  The switches                            */
  /* ---------------------------------------- */

  traitsFor(item) {
    const actor = item?.actor;
    const upgrades = Rebuilds.upgradesOf(item, actor);
    const info = classify(item, loadedAmmo(item, actor), upgrades);
    return traitsOf(info.flavor, upgrades);
  },

  /** A HUD or macro switch: "ricochet" or "charge". */
  async toggle(actor, item, which, { token = null } = {}) {
    if (!actor?.isOwner || !item) return null;
    const t = token ?? this.tokenFor(actor);
    if (which === "ricochet") {
      const on = await Rebuilds.toggleRicochet(actor, item);
      ui.notifications.info(L(`${LANG}.Arsenal.${on ? "RicochetOn" : "RicochetOff"}`, { weapon: item.name }));
      return on;
    }
    if (which === "charge") {
      const on = await Rebuilds.toggleCharge(actor, item);
      this.chargeLook(t, item, on);
      if (on) {
        Sound.play("techCharge");
        await Cards.post({ actor, kicker: L(`${LANG}.Arsenal.Kicker`), title: L(`${LANG}.Arsenal.ChargeTitle`, { name: esc(actor.name), weapon: esc(item.name) }), tone: "cyan", body: `<p>${L(`${LANG}.Arsenal.ChargeBody`)}</p>` });
      }
      return on;
    }
    return null;
  },

  /** A charged Tech gun crackles on its token until fired. */
  chargeLook(token, item, on) {
    if (!token || !Core.sequencer || !Settings.get("fxEnabled")) return;
    const name = `ncm-arsenal-charge-${token.id}-${item.id}`;
    try {
      if (!on) return Sequencer.EffectManager.endEffects({ name, object: token });
      const file = Core.jb2a(["jb2a.static_electricity.01", "jb2a.static_electricity.02", "jb2a.static_electricity"], ["blue"]);
      if (!file) return null;
      return new Sequence({ moduleName: MODULE_ID, softFail: true }).effect().file(file).attachTo(token).scaleToObject(1.2).opacity(0.55).persist().name(name).fadeIn(400).fadeOut(400).play();
    } catch (err) {
      console.warn(`${MODULE_ID} | charge look`, err);
      return null;
    }
  },

  /** The switches for a character's weapons, as a dialog (the Weapon Rebuilds macro). */
  async menu(actor) {
    actor ??= canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
    if (!actor?.isOwner) return ui.notifications.warn(L(`${LANG}.Arsenal.NoActor`));
    const weapons = [...actor.items].filter((i) => (i.type === "weapon" && i.system?.equipped === "equipped") || (i.type === "cyberware" && i.system?.isWeapon && i.system?.isInstalled));
    const rows = weapons.map((w) => ({ w, buttons: Rebuilds.buttons(actor, w, this.traitsFor(w)) })).filter((r) => r.buttons.length);
    // Whoever the Tech scope shows behind thin cover can be targeted from here.
    const seen = [...Xray.drawn.keys()].map((id) => canvas.tokens?.get(id)).filter(Boolean);
    if (seen.length) rows.push({ w: { name: L(`${LANG}.Arsenal.BehindCover`) }, buttons: seen.map((t) => ({ key: `tgt:${t.id}`, label: t.name, icon: "fa-solid fa-crosshairs", on: game.user.targets?.has?.(t) })) });
    if (!rows.length) return ui.notifications.info(L(`${LANG}.Arsenal.NoSwitches`, { name: actor.name }));
    const content = rows.map((r) => `<p><strong>${esc(r.w.name)}</strong> ${r.buttons.map((b) => `<button type="button" data-key="${b.key}"${b.on ? ' class="active"' : ""}><i class="${b.icon}"></i> ${esc(b.label)}</button>`).join(" ")}</p>`).join("");
    const pick = await Compat.DialogV2.wait({
      window: { title: L(`${LANG}.Arsenal.MenuTitle`, { name: actor.name }) },
      classes: ["neon-combat", "ncm-dialog"],
      content,
      buttons: [{ action: "close", label: L(`${LANG}.Common.Close`), default: true }],
      // v12 hands render (event, html), v13 (event, dialog): the app is the event's target in both.
      render: (event, second) => {
        const app = event?.target;
        const el = app?.element ?? Compat.element(second?.element ?? second);
        el?.querySelectorAll?.("[data-key]").forEach((b) => b.addEventListener("click", () => {
          const [k, id] = b.dataset.key.split(":");
          if (k === "tgt") Compat.setTargets([id]);
          else this.toggle(actor, actor.items.get(id), k === "rico" ? "ricochet" : "charge");
          app?.close?.();
        }));
      },
      rejectClose: false
    });
    return pick;
  },

  /* ---------------------------------------- */
  /*  The GM's side                           */
  /* ---------------------------------------- */

  /** Push targets straight away from the attacker (Propulsion Impact), stopping at walls. */
  async pushAsGM({ scene, tokens = [], from, metres = 2, maxBody = null }) {
    const sc = game.scenes.get(scene);
    const src = sc?.tokens.get(from);
    if (!sc || !src) return 0;
    const grid = Blast.grid(sc);
    const center = { x: src.x + ((Number(src.width) || 1) * grid.size) / 2, y: src.y + ((Number(src.height) || 1) * grid.size) / 2 };
    let n = 0;
    for (const id of tokens) {
      const tok = sc.tokens.get(id);
      const actor = tok?.actor;
      if (!actor || (maxBody && CPR.stat(actor, "body") >= maxBody)) continue;
      const to = Blast.blowTo(tok, center, metres, grid);
      if (!to || (to.x === tok.x && to.y === tok.y)) continue;
      const half = { x: ((Number(tok.width) || 1) * grid.size) / 2, y: ((Number(tok.height) || 1) * grid.size) / 2 };
      const from = { x: tok.x + half.x, y: tok.y + half.y };
      await tok.update({ x: to.x, y: to.y });
      if (sc.id === canvas?.scene?.id) Shots.pushed(from, { x: to.x + half.x, y: to.y + half.y }, { wall: !!to.wall });
      if (to.wall) await Conditions.add("intoTheWall", actor);
      n++;
    }
    return n;
  },

  async conditionsAsGM({ scene, tokens = [], ids = [] }) {
    const sc = game.scenes.get(scene);
    for (const id of tokens) {
      const actor = sc?.tokens.get(id)?.actor;
      if (actor) await Conditions.add(ids, actor);
    }
    return true;
  },

  /** For Roller: a damage roll for an area draws no Tarot card (Ch07). */
  isArea(r) {
    const actor = r?.actorId ? game.actors.get(r.actorId) : null;
    const item = actor?.items?.get(r?.itemId);
    if (!item) return false;
    return !!classify(item, loadedAmmo(item, actor)).area;
  },

  registerRebuild: (def) => RebuildRegistry.register(def)
};
