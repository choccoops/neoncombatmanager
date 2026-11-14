import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { Registry } from "../conditions/registry.js";
import { L, esc } from "../util.js";

/**
 * What switching chrome on asks of the table besides its numbers (2070 Item Compendium, the
 * Sandevistan, Berserk and their Operating Systems): Humanity Loss each time it starts, a
 * cooldown and what starting again inside it costs, a Solo's free Combat Awareness, a choice
 * each Turn, HP back as it stops. A card in chat says so as the chrome starts, with a button
 * for each thing that's a roll or a choice; the rest of the rule is the condition's own text.
 *
 * Rules by Operating System key (the bare chrome by its kind), pure:
 *   humanity   Humanity Loss each time it starts, unless the body carries it (an FBC or Cyberspine)
 *   cooldown   seconds before it can start again (a Round is 3 seconds)
 *   early      Humanity Loss for starting again inside the cooldown: the first time, the second, ...
 *   awareness  a Solo reassigns Combat Awareness for free on every Aimed Shot, alternate firing
 *              mode or Martial Arts Special Move while it runs
 *   turn       a choice at the start of each of their Turns: condition ids
 *   heal       HP back as it stops
 *   start      what switching it on takes: "free", "half" (half of a ROF2 Action) or "action"
 *   dodge      dodges bullets whatever their REF while it runs
 *   soak       "half": all HP damage halved, rounded up; "first": the first damage each Round
 *              is less by half their BODY
 *   half       things that can each be half of a ROF2 Action while it runs (a reminder each Turn)
 */
const HOUR = 3600;
export const OS_RULES = {
  sandevistan: { start: "action", cooldown: HOUR },
  apogee: { start: "free", humanity: "1d6", cooldown: 60, early: [3, 6, 9], awareness: true, dodge: true },
  professional: { start: "half", cooldown: HOUR, awareness: true },
  warpdancer: { start: "half", cooldown: HOUR, early: [2, 4, 6], half: true },
  falcon: { start: "free", humanity: "1d6", cooldown: HOUR, early: [3, 6, 9], turn: ["chromeFalconMove", "chromeFalconEvasion"], dodge: true },
  reflexplus: { start: "half", cooldown: HOUR, early: [2, 4, 6] },
  berserk: { start: "action", cooldown: HOUR },
  berserker: { start: "action", cooldown: HOUR, half: true },
  baldur: { start: "free", humanity: "1d6", cooldown: HOUR, early: [3, 6, 9], heal: 5, soak: "half", half: true },
  matterhorn: { start: "half", cooldown: HOUR, soak: "first" },
  brawler: { start: "half", cooldown: HOUR, early: [3, 6, 9] }
};

/**
 * What running chrome takes off a loss of HP, pure.
 * @param {object} o - loss (HP about to go); soak: the rule; body: their BODY; first: is this the
 *   first damage this Round?
 * @returns {number} the HP that goes
 */
export function soaked({ loss = 0, soak = null, body = 0, first = true } = {}) {
  const n = Math.max(0, Math.round(Number(loss) || 0));
  if (!n) return 0;
  if (soak === "half") return Math.ceil(n / 2);
  if (soak === "first" && first) return Math.max(0, n - Math.ceil((Number(body) || 0) / 2));
  return n;
}

/** The rules of a Chrome running condition's chrome ({ kind, os }). */
export const rulesOf = (chrome) => OS_RULES[chrome?.os ?? chrome?.kind] ?? {};

/** Does the body carry the load (a Full Body Conversion or a Cyberspine)? items: [{ name, type, installed }] */
export const framed = (items = []) => items.some((i) => i.type === "cyberware" && i.installed && /cyberspine|\bfbc\b|full[- ]body con/i.test(i.name ?? ""));

/**
 * What starting it costs right now, pure.
 * @param {object} o - rules; framed; solo; now (world time, seconds); cool: { until, early } as last kept
 * @returns {{ humanity: string|null, early: number|null, left: number, blocked: boolean, awareness: boolean, keep: number }}
 *   left: seconds of cooldown still to run; blocked: inside it with no way to start early (the GM's call);
 *   keep: how many early starts this cooldown has seen, counting this one
 */
export function startPlan({ rules = {}, framed: carried = false, solo = false, now = 0, cool = null } = {}) {
  const left = cool && Number(cool.until) > now ? Number(cool.until) - now : 0;
  const n = left ? Number(cool.early) || 0 : 0;
  const steps = rules.early ?? [];
  return {
    humanity: rules.humanity && !carried ? rules.humanity : null,
    early: left && steps.length ? steps[Math.min(n, steps.length - 1)] : null,
    left,
    blocked: left > 0 && !steps.length,
    awareness: !!rules.awareness && !!solo,
    keep: left ? n + 1 : 0
  };
}

/** "20 Rounds", "1 hour", "12 minutes": a stretch of seconds as the table says it. */
export function span(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s >= HOUR) return L(`${LANG}.Chrome.Span.hours`, { n: Math.round((s / HOUR) * 10) / 10 });
  if (s > 90) return L(`${LANG}.Chrome.Span.minutes`, { n: Math.ceil(s / 60) });
  return L(`${LANG}.Chrome.Span.rounds`, { n: Math.ceil(s / 3) });
}

/** Attack modes that let a Solo reassign Combat Awareness for free under an Apogee or Professional. */
export const AWARENESS_MODES = ["aimed", "autofire", "suppressive"];

const COOL_FLAG = "chromeCooldown";
const HIT_FLAG = "chromeHit";
const HP = "system.derivedStats.hp.value";
/** The Round under way, as a mark: the fight's, else three seconds of the world clock. */
const roundMark = () => (game.combat?.started ? `${game.combat.id}:${game.combat.round}` : `t:${Math.floor((Number(game.time?.worldTime) || 0) / 3)}`);
const now = () => Number(game.time?.worldTime) || 0;
const items = (actor) => [...(actor?.items ?? [])].map((i) => ({ name: i.name, type: i.type, installed: !!i.system?.isInstalled }));
const running = (actor, test) => Conditions.active(actor).find((c) => c.chrome?.kind && test(rulesOf(c.chrome), c)) ?? null;

export const OS = {
  get on() {
    return !!Settings.get("chromeCards");
  },

  init() {
    // The start of a Turn under a Falcon: +2 MOVE or +4 on one Evasion Check, theirs to pick.
    Hooks.on("updateCombat", (combat, changes) => {
      if (!("turn" in changes || "round" in changes) || !Compat.isActiveGM || !this.on) return;
      this.turn(combat).catch((err) => console.error(`${MODULE_ID} | chrome turn`, err));
    });
    // HP about to go from someone whose chrome soaks damage: less goes (whoever makes the change).
    Hooks.on("preUpdateActor", (actor, changes, options) => this.soak(actor, changes, options));
    // An unlinked token's character changes through its delta.
    Hooks.on("preUpdateActorDelta", (delta, changes, options) => (delta?.syntheticActor ? this.soak(delta.syntheticActor, changes, options) : null));
  },

  framed(actor) {
    return framed(items(actor));
  },

  /** The chrome that lets someone dodge bullets whatever their REF right now: its condition's name, or null. */
  dodges(actor) {
    return running(actor, (r) => !!r.dodge)?.name ?? null;
  },

  /**
   * A loss of HP on its way in (preUpdateActor): a Baldur halves it; a Matterhorn takes half
   * their BODY off the first each Round. The change itself is made smaller, so everything after
   * it (Wound States, cards) sees what really went.
   */
  soak(actor, changes, options = {}) {
    if (!this.on || options?.[MODULE_ID]?.soaked) return null;
    const next = foundry.utils.getProperty(changes ?? {}, HP);
    const have = Number(actor?.system?.derivedStats?.hp?.value);
    if (next === undefined || !Number.isFinite(have) || !(Number(next) < have)) return null;
    const c = running(actor, (r) => !!r.soak);
    if (!c) return null;
    const rule = rulesOf(c.chrome).soak;
    const mark = roundMark();
    const first = actor.flags?.[MODULE_ID]?.[HIT_FLAG] !== mark;
    const loss = have - Number(next);
    const goes = soaked({ loss, soak: rule, body: CPR.stat(actor, "body"), first });
    if (rule === "first" && first) foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${HIT_FLAG}`, mark);
    if (goes === loss) return null;
    foundry.utils.setProperty(changes, HP, have - goes);
    options[MODULE_ID] = { ...(options[MODULE_ID] ?? {}), soaked: true };
    Cards.note(actor, `<p>${L(`${LANG}.Chrome.Card.Soaked.${rule}`, { name: esc(actor.name), chrome: esc(c.name), from: loss, to: goes })}</p>`).catch(() => {});
    return { from: loss, to: goes };
  },

  cool(actor, kind) {
    return actor?.flags?.[MODULE_ID]?.[COOL_FLAG]?.[kind] ?? null;
  },

  async _keep(actor, kind, value) {
    if (!actor?.isOwner) return;
    const all = actor.flags?.[MODULE_ID]?.[COOL_FLAG] ?? {};
    await actor.setFlag(MODULE_ID, COOL_FLAG, { ...all, [kind]: value });
  },

  /** Chrome has just started (the active GM's client): the card, and the count of early starts. */
  async started(actor, c) {
    if (!this.on || !c?.chrome) return null;
    const { kind } = c.chrome;
    const rules = rulesOf(c.chrome);
    const { Awareness } = await import("../awareness/awareness.js");
    const cool = this.cool(actor, kind);
    const plan = startPlan({ rules, framed: this.framed(actor), solo: Awareness.isSolo(actor), now: now(), cool });
    if (cool || plan.keep) await this._keep(actor, kind, { until: Number(cool?.until) || 0, early: plan.keep });

    const lines = [];
    const buttons = [];
    if (plan.humanity) {
      lines.push(L(`${LANG}.Chrome.Card.Humanity`, { formula: plan.humanity }));
      buttons.push({ action: "chrome-humanity", label: L(`${LANG}.Chrome.Card.RollHumanity`, { formula: plan.humanity }), icon: "fa-solid fa-brain", owner: true, data: { formula: plan.humanity, key: "start" } });
    } else if (rules.humanity) lines.push(L(`${LANG}.Chrome.Card.Carried`));
    if (plan.early) {
      lines.push(L(`${LANG}.Chrome.Card.Early`, { left: span(plan.left), n: plan.early }));
      buttons.push({ action: "chrome-humanity", label: L(`${LANG}.Chrome.Card.TakeHumanity`, { n: plan.early }), icon: "fa-solid fa-brain", owner: true, data: { formula: String(plan.early), key: "early" } });
    } else if (plan.blocked) lines.push(L(`${LANG}.Chrome.Card.Cooling`, { left: span(plan.left) }));
    if (plan.awareness) {
      lines.push(L(`${LANG}.Chrome.Card.Awareness`));
      buttons.push({ action: "chrome-awareness", label: L(`${LANG}.Chrome.Card.Reassign`), icon: "fa-solid fa-crosshairs", owner: true });
    }
    if (rules.turn) lines.push(L(`${LANG}.Chrome.Card.EachTurn`));
    if (rules.start) lines.unshift(L(`${LANG}.Chrome.Card.Start.${rules.start}`));
    if (rules.cooldown) lines.push(L(`${LANG}.Chrome.Card.Cooldown`, { span: span(rules.cooldown) }));
    return Cards.post({
      actor,
      kicker: L(`${LANG}.Chrome.Card.Kicker`),
      title: L(`${LANG}.Chrome.Card.On`, { name: esc(actor.name), chrome: esc(c.name) }),
      img: c.img,
      body: `${c.hint ? `<p>${esc(c.hint)}</p>` : ""}${lines.length ? `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>` : ""}`,
      tone: plan.blocked ? "yellow" : "cyan",
      buttons
    });
  },

  /** Chrome has just stopped (the active GM's client): the cooldown starts, and what stopping gives. */
  async ended(actor, c) {
    if (!this.on || !c?.chrome) return;
    const { kind } = c.chrome;
    const rules = rulesOf(c.chrome);
    for (const id of rules.turn ?? []) if (Conditions.has(id, actor)) await Conditions.remove(id, actor);
    if (rules.cooldown) await this._keep(actor, kind, { until: now() + rules.cooldown, early: Number(this.cool(actor, kind)?.early) || 0 });
    const lines = [];
    if (rules.heal && CPR.woundState(actor) !== "dead") {
      const healed = await CPR.healHP(actor, rules.heal);
      if (healed) lines.push(L(`${LANG}.Chrome.Card.Healed`, { n: healed }));
    }
    if (rules.cooldown) lines.push(L(`${LANG}.Chrome.Card.CoolingNow`, { span: span(rules.cooldown) }) + (rules.early?.length ? ` ${L(`${LANG}.Chrome.Card.EarlyNext`, { n: rules.early[Math.min(Number(this.cool(actor, kind)?.early) || 0, rules.early.length - 1)] })}` : ""));
    if (lines.length) await Cards.note(actor, `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`, { title: L(`${LANG}.Chrome.Card.Off`, { name: esc(actor.name), chrome: esc(c.name) }) });
  },

  /** The Turn has moved on: whoever's up, with a choice to make each Turn, gets asked. */
  async turn(combat) {
    const actor = combat?.started ? combat.combatant?.actor : null;
    if (!actor) return null;
    // What can be half of a ROF2 Action while it runs: a reminder, theirs alone.
    const h = running(actor, (r) => !!r.half);
    if (h) await Cards.note(actor, `<p>${L(`${LANG}.Chrome.Card.Half.${h.chrome.os}`)}</p>`, { title: L(`${LANG}.Chrome.Card.HalfTitle`, { chrome: esc(h.name) }) });
    const c = running(actor, (r) => !!r.turn);
    if (!c) return null;
    const ids = rulesOf(c.chrome).turn;
    for (const id of ids) if (Conditions.has(id, actor)) await Conditions.remove(id, actor);
    return Cards.post({
      actor,
      kicker: esc(c.name),
      title: L(`${LANG}.Chrome.Card.TurnTitle`, { name: esc(actor.name) }),
      img: c.img,
      body: `<p>${L(`${LANG}.Chrome.Card.TurnBody`)}</p>`,
      tone: "cyan",
      buttons: ids.map((id) => ({ action: "chrome-pick", label: esc(Registry.get(id)?.name ?? id), icon: "fa-solid fa-bolt", owner: true, data: { condition: id, others: ids.filter((x) => x !== id).join(",") } })),
      whisper: Cards.owners(actor)
    });
  },

  /**
   * An attack went out (the roller's client): a Solo under an Apogee or Professional who took an
   * Aimed Shot or an alternate firing mode can reassign Combat Awareness for free.
   */
  async afterAttack(a) {
    if (!this.on || !AWARENESS_MODES.includes(a?.mode)) return null;
    const actor = canvas?.tokens?.get?.(a.tokenId)?.actor ?? game.actors?.get?.(a.actorId) ?? null;
    if (!actor) return null;
    const c = running(actor, (r) => !!r.awareness);
    if (!c) return null;
    const { Awareness } = await import("../awareness/awareness.js");
    if (!Awareness.isSolo(actor)) return null;
    return Cards.post({
      actor,
      kicker: esc(c.name),
      title: L(`${LANG}.Chrome.Card.AwarenessTitle`),
      body: `<p>${L(`${LANG}.Chrome.Card.AwarenessBody`, { name: esc(actor.name) })}</p>`,
      tone: "cyan",
      buttons: [{ action: "chrome-awareness", label: L(`${LANG}.Chrome.Card.Reassign`), icon: "fa-solid fa-crosshairs", owner: true }],
      whisper: Cards.owners(actor)
    });
  },

  /** A card's button. */
  async click(message, btn, event, actor) {
    const d = btn.dataset;
    if (!actor?.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
    switch (d.ncmAction) {
      case "chrome-humanity": {
        // Once a card: whoever can write to the message keeps the mark; the result's own card says it was taken.
        const done = message.getFlag?.(MODULE_ID, "chromeDone") ?? {};
        if (done[d.key]) return ui.notifications?.info(L(`${LANG}.Chrome.Card.AlreadyTaken`));
        btn.disabled = true;
        const { total, roll } = Conditions.formula(d.formula, actor);
        const have = Number(actor.system?.derivedStats?.humanity?.value);
        if (!Number.isFinite(have) || !(total > 0)) return;
        await actor.update({ "system.derivedStats.humanity.value": have - total });
        if (message.isOwner) await message.setFlag(MODULE_ID, "chromeDone", { ...done, [d.key]: true });
        const dice = /d/i.test(d.formula) ? ` <span class="ncm-roll">(${esc(roll?.formula ?? d.formula)})</span>` : "";
        await Cards.note(actor, `<p>${L(`${LANG}.Chrome.Card.LostHumanity`, { name: esc(actor.name), n: total, now: have - total })}${dice}</p>`, { tone: "red", whisper: [] });
        return;
      }
      case "chrome-awareness": {
        const { Awareness } = await import("../awareness/awareness.js");
        if (!Awareness.isSolo(actor)) return ui.notifications?.warn(L(`${LANG}.Awareness.NotSolo`, { name: actor.name }));
        if (!running(actor, (r) => !!r.awareness)) return ui.notifications?.info(L(`${LANG}.Chrome.Card.NotRunning`, { name: actor.name }));
        Awareness.pass(actor);
        return Awareness.open(actor);
      }
      case "chrome-pick": {
        for (const id of String(d.others ?? "").split(",").filter(Boolean)) if (Conditions.has(id, actor)) await Conditions.remove(id, actor);
        await Conditions.add(d.condition, actor);
        return;
      }
      default:
    }
  }
};
