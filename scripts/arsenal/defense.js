import { MODULE_ID, LANG } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { Socket } from "../socket.js";
import { CPR } from "../cpr.js";
import { Cards } from "../combat/cards.js";
import { Conditions } from "../conditions/engine.js";
import { escapeSquare } from "./area.js";
import { OS as OsRules } from "../neonfx/os.js";
import { L, esc } from "../util.js";

/**
 * Chrome that lets you dodge bullets whatever your REF: its card says so ("dodge bullets
 * regardless of REF", "dodge ranged attacks whatever your REF": the Reflex Co-Processor, Corgo's
 * Kerenzikov, the Militech 'Apogee' and 'Falcon' Sandevistan OS).
 */
export const DODGE_TEXT = /dodge (?:bullets|ranged attacks)[^.]{0,20}?(?:regardless of|whatever)(?: your)? REF/i;

/**
 * What lets someone follow a ricochet's bounce (2070 Ch07, Ricochets in Play): speedware such as a
 * Kerenzikov or a running Sandevistan; or low-light, infrared or UV optics while it's dark.
 */
export const TRACK_CHROME = /\b(kerenzikov|sandevistan|speedware)\b/i;
export const TRACK_OPTICS = /\b(low[- ]?light|infra-?red|ultra-?violet|night ?vision|thermo-?graph\w*|thermal|IR|UV)\b/i;
/** The penalty to dodge a ricochet you can track. */
export const RICOCHET_DODGE = -4;

const strip = (html) => String(html ?? "").replace(/<[^>]+>/g, " ");
const isActiveEffect = (e) => /\(active\)\s*$/i.test(String(e?.name ?? ""));

/**
 * Who can dodge bullets, pure: { can, why, blocked }.
 * why: "ref" (REF 8+), or the name of the chrome that lets them; blocked: why they can't now.
 * An item with an "(active)" effect (Neon Hub's switch for speedware and its OS) only counts
 * while that effect is on: the Sandevistan's OS lets you dodge bullets while it runs.
 * A ricochet can't be dodged unless the target can track it (`tracks`); then it's at -4 (penalty).
 * @param {object} c - { ref, items: [{ name, installed, description, effects: [{ name, disabled }] }],
 *   blind, attackerHidden, ricochet, tracks }
 */
export function dodgeAbility({ ref = 0, items = [], blind = false, attackerHidden = false, ricochet = false, tracks = false, chrome = null } = {}) {
  // `chrome`: a running condition that lets them (an Apogee or Falcon), whatever items say.
  let why = Number(ref) >= 8 ? "ref" : chrome || null;
  if (!why) {
    for (const i of items) {
      if (!i.installed || !DODGE_TEXT.test(strip(i.description))) continue;
      const switches = (i.effects ?? []).filter(isActiveEffect);
      if (switches.length && switches.every((e) => e.disabled)) continue;
      why = i.name;
      break;
    }
  }
  // 2070 Core Rules: no dodging a shooter you don't know is there (Ch06), nor a ricochet (Ch07),
  // nor bullets with all-chrome eyes shut down.
  const blocked = attackerHidden ? "hidden" : ricochet && !tracks ? "ricochet" : blind ? "blind" : null;
  const out = { can: !!why && !blocked, why, blocked };
  if (ricochet && tracks && !blocked) out.penalty = RICOCHET_DODGE;
  return out;
}

/**
 * Can someone track a ricochet: speedware that's on (an item with an "(active)" switch only while
 * it runs), or low-light/IR/UV optics while they're in the dark. Pure.
 * @param {object[]} items - as dodgeAbility takes them
 * @param {boolean} dark - Low Light, Darkness or Obscured on them
 */
export function tracksRicochet(items = [], dark = false) {
  return items.some((i) => {
    if (!i.installed) return false;
    const on = !(i.effects ?? []).filter(isActiveEffect).length || (i.effects ?? []).filter(isActiveEffect).some((e) => !e.disabled);
    if (TRACK_CHROME.test(i.name ?? "")) return on;
    return dark && TRACK_OPTICS.test(i.name ?? "");
  });
}

/** An Evasion roll against an attack: "dodged" or "hit". A tie goes to the defender (the attacker must beat it). */
export function defenseOutcome(attack, evasion, { tiesToDefender = true } = {}) {
  const a = Number(attack) || 0;
  const e = Number(evasion) || 0;
  return e > a || (tiesToDefender && e === a) ? "dodged" : "hit";
}

/**
 * The defense step, the way Vec's Cyberpunk RED Evasion Workflow runs it, in Neon Combat Manager's
 * cards and without its socketlib: after an attack, each target who can dodge picks **Evade** (roll
 * DEX + Evasion + 1d10 against the attack) or **Tank** (the range DV stands); a melee attack is
 * always an opposed Evasion roll. Anyone in an area who dodges out is left out when the GM applies it.
 */
export const Defense = {
  init() {
    Socket.on("arsenalDefend", (data) => this.defendAsGM(data));
    Socket.on("arsenalDodged", (data) => this.dodgedAsGM(data));
  },

  get on() {
    return !!Settings.get("arsenalDefense");
  },

  /** An actor's chrome, as dodgeAbility reads it. */
  itemsOf(actor) {
    return [...(actor?.items ?? [])].filter((i) => i.type === "cyberware" || i.type === "itemUpgrade").map((i) => ({
      name: i.name,
      installed: i.type === "cyberware" ? i.system?.isInstalled !== false : i.system?.isInstalled !== false,
      description: i.system?.description?.value ?? "",
      effects: [...(i.effects ?? [])].map((e) => ({ name: e.name, disabled: !!e.disabled }))
    }));
  },

  /** Can this target dodge this ranged attack now? */
  ability(target, { attacker = null, ricochet = false } = {}) {
    const items = this.itemsOf(target);
    const dark = ["lowLight", "darkness", "obscured"].some((id) => Conditions.has(id, target));
    return dodgeAbility({
      ref: CPR.stat(target, "ref"),
      items,
      chrome: OsRules.dodges(target),
      blind: Conditions.has("blind", target) || Conditions.has("qhRebootOptics", target),
      attackerHidden: !!attacker && Conditions.has("hidden", attacker),
      ricochet,
      tracks: ricochet && !!Settings.get("arsenalRicochetDodge") && tracksRicochet(items, dark)
    });
  },

  /**
   * After an attack card (the attacker's client): a prompt for each target who can dodge, an
   * automatic opposed roll for a melee attack. Areas prompt through promptArea.
   * @param {object} a - the card's Neon Arsenal flags
   */
  async afterAttack(a, message) {
    if (!this.on || a.area || a.mode === "suppressive" || !a.targets?.length) return;
    const attacker = game.actors.get(a.actorId);
    const weapon = attacker?.items?.get(a.itemId);
    const scene = canvas?.scene;
    for (const id of a.targets) {
      const tok = scene?.tokens?.get(id);
      const target = tok?.actor;
      if (!target) continue;
      const base = { attack: a.total, attacker: attacker?.name ?? "", weapon: weapon?.name ?? "", target: tok.uuid, message: message?.id ?? "" };
      if (!a.ranged) {
        const mode = Settings.get("arsenalDefenseMelee");
        if (mode === "auto") await Socket.request("arsenalDefend", { ...base, melee: true });
        else await this.prompt(target, tok, { ...base, melee: true });
        continue;
      }
      const dv = a.hits?.find((h) => h.name === tok.name)?.dv ?? a.dv ?? null;
      const ab = this.ability(target, { attacker, ricochet: a.ricochet });
      // The weapon's own rule (its card): its Aimed Shots are harder to dodge.
      const pen = ab.penalty ? { penalty: ab.penalty } : a.dodgePenalty ? { penalty: a.dodgePenalty, penaltyKey: "WeaponDodge" } : {};
      if (ab.can) await this.prompt(target, tok, { ...base, dv, why: ab.why, ...pen });
    }
  },

  /** Everyone in a landed area who can dodge it gets the choice (Ch07: dodging out of the blast). */
  async promptArea(doc, total) {
    if (!this.on) return;
    const b = doc.flags?.[MODULE_ID]?.blast;
    if (!b) return;
    const { tokensIn } = await import("./blast.js");
    const attacker = game.actors.get(b.actorId);
    const weapon = attacker?.items?.get(b.itemId);
    for (const tok of tokensIn(doc, doc.parent, { exclude: b.area?.shape === "cone" ? b.tokenId : null })) {
      const target = tok.actor;
      if (!target) continue;
      const ab = this.ability(target, { attacker });
      if (!ab.can) continue;
      const shell = Number(b.dodge) || 0;
      await this.prompt(target, tok, {
        attack: total, attacker: attacker?.name ?? "", weapon: weapon?.name ?? "", target: tok.uuid, template: doc.uuid, why: ab.why,
        ...(shell ? { penalty: shell, penaltyKey: "ShellDodge" } : {})
      });
    }
  },

  /** The choice, for the target's player (and the GM): Evade or Tank. */
  prompt(target, tok, data) {
    const why = data.why && data.why !== "ref" ? L(`${LANG}.Arsenal.Defense.WhyChrome`, { chrome: esc(data.why) }) : "";
    const buttons = [{ action: "arsenal-evade", label: L(`${LANG}.Arsenal.Defense.Evade`), icon: "fa-solid fa-person-running", owner: true, data: { ...data } }];
    if (!data.melee) buttons.push({ action: "arsenal-tank", label: L(`${LANG}.Arsenal.Defense.Tank`), icon: "fa-solid fa-shield", owner: true, data: { ...data } });
    return Cards.post({
      actor: target,
      kicker: L(`${LANG}.Arsenal.Defense.Kicker`),
      title: L(`${LANG}.Arsenal.Defense.${data.melee ? "MeleeTitle" : data.template ? "AreaTitle" : "Title"}`, { name: esc(tok.name), attacker: esc(data.attacker), weapon: esc(data.weapon) }),
      tone: "cyan",
      body: `<p>${L(`${LANG}.Arsenal.Defense.${data.melee ? "MeleeBody" : "Body"}`)}${why ? ` ${why}` : ""}${data.penalty ? ` ${L(`${LANG}.Arsenal.Defense.${data.penaltyKey ?? "RicochetDodge"}`, { penalty: data.penalty })}` : ""}</p>`,
      buttons,
      whisper: Cards.owners(target),
      flags: { defense: true }
    });
  },

  /** Evade (the target's player): CPR's own Evasion roll against the attack. */
  async evade(message, btn, event, target) {
    const d = btn.dataset;
    const result = await CPR.skillCheck(target, "Evasion", { event, stat: "dex" });
    if (!result) return null;
    // Tracking a ricochet's bounce takes the same -4 as the shot; the control group's shell attack -3.
    return this.resolve(message, { ...d, evasion: result.total + (Number(d.penalty) || 0) });
  },

  /** Tank: the range DV stands (in an area, they stay in it). */
  async tank(message, btn) {
    return this.resolve(message, { ...btn.dataset, tank: true });
  },

  /** A melee defense rolled for the target (the GM's client; CPR's roll, no dialog). */
  async defendAsGM(data) {
    const tok = await fromUuid(data.target);
    const target = tok?.actor;
    if (!target) return null;
    const result = await CPR.skillCheck(target, "Evasion", { event: { type: "click", ctrlKey: true, metaKey: false }, stat: "dex" });
    if (!result) return null;
    return this.resolve(null, { ...data, evasion: result.total });
  },

  /** Post what happened; a dodge out of an area is remembered for the GM's apply window. */
  async resolve(message, d) {
    const tok = await fromUuid(d.target);
    const name = tok?.name ?? "";
    let key;
    let outcome;
    if (d.tank || d.tank === "true") {
      const dv = d.dv === undefined || d.dv === "" || d.dv === "null" ? null : Number(d.dv);
      outcome = d.template ? "stays" : dv === null ? "tank" : Number(d.attack) > dv ? "hit" : "missed";
      key = `tank.${outcome}`;
    } else {
      outcome = defenseOutcome(d.attack, d.evasion, { tiesToDefender: Settings.get("arsenalDefenseTies") });
      key = `evade.${d.template && outcome === "dodged" ? "out" : outcome}`;
      if (d.template && outcome === "dodged") await Socket.request("arsenalDodged", { template: d.template, token: tok?.id });
    }
    if (message?.isOwner) await message.setFlag(MODULE_ID, "done", true).catch(() => null);
    await Cards.post({
      actor: tok?.actor ?? null,
      kicker: L(`${LANG}.Arsenal.Defense.Kicker`),
      title: L(`${LANG}.Arsenal.Defense.Result.${key}`, { name: esc(name), attacker: esc(d.attacker ?? ""), attack: d.attack, evasion: d.evasion ?? "", dv: d.dv ?? "" }),
      tone: outcome === "dodged" || outcome === "missed" ? "cyan" : "pink",
      whisper: Settings.get("arsenalDefenseVisibility") === "gm" ? [...new Set([...Cards.gms(), ...Cards.owners(tok?.actor)])] : null
    });
    return outcome;
  },

  /**
   * Someone dodged out of an area (the GM; the template is the attacker's): they're remembered for
   * the apply window, and their token goes to the nearest open square outside it.
   */
  async dodgedAsGM({ template, token }) {
    const doc = await fromUuid(template);
    const b = doc?.flags?.[MODULE_ID]?.blast;
    if (!b || !token) return false;
    const dodged = [...new Set([...(b.dodged ?? []), token])];
    await doc.update({ [`flags.${MODULE_ID}.blast.dodged`]: dodged });
    const tok = doc.parent?.tokens?.get(token);
    if (!tok) return true;
    const size = Number(doc.parent?.grid?.size ?? canvas?.grid?.size) || 100;
    const distance = Number(doc.parent?.grid?.distance ?? canvas?.dimensions?.distance) || 2;
    const t = { t: doc.t, x: doc.x, y: doc.y, distance: doc.distance, direction: doc.direction, angle: doc.angle, side: doc.t === "rect" ? b.area?.size : undefined };
    const to = escapeSquare(t, tok, { size, distance }, (a, c) => !!Compat.moveBlocked(a, c));
    if (to) await tok.update({ x: to.x, y: to.y }, { [MODULE_ID]: { free: true } }); // dodging out isn't their Move
    return to ?? true;
  },

  /** Route a card button (Arsenal.click). */
  click(message, btn, event, actor) {
    if (!actor?.isOwner) return ui.notifications?.warn(L(`${LANG}.Error.NotOwner`));
    btn.disabled = true;
    return btn.dataset.ncmAction === "arsenal-tank" ? this.tank(message, btn) : this.evade(message, btn, event, actor);
  }
};
