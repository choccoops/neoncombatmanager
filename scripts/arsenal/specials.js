/**
 * A weapon's own rules, read from its card (2070 Item Compendium, Weapons and Iconics): the lines
 * the catalog words the same way on every weapon that has them. Read from the item's text, so a
 * weapon already on a sheet counts without being replaced, and one a GM writes in the same words
 * does too. Pure: everything here takes text and returns data.
 *
 * What's read (and what Neon Arsenal does with it):
 *   burst        "Single Shot fires a 3-round burst" / "Every shot is a 3-round burst": a line on
 *                the attack card; fired short, "empties the magazine for 2d6" sets that damage
 *                (the rounds are spent by Neon Hub)
 *   autofire     "Autofire uses 6 rounds instead of 10": a line on the card (spent by Neon Hub)
 *   aimedDice    "Aimed Shots deal +1d6": that many more dice on an Aimed Shot's damage
 *   ablate       "Ablates 1 extra SP" (and "(3 charged)"): added to the damage card's ablation
 *   crit         "5s count as 6s for Critical Injuries" (always, or "On an Aimed Shot, ..."): the
 *                damage card says when the dice make one by that rule
 *   attackMod    "−2 to every attack"; aimedMod / autofireMod: "+1 to Aimed Shots (and Autofire)"
 *   aimedRounds  "An Aimed Shot fires 2 rounds for +1d6": the dice here, the rounds by Neon Hub
 *   critBonus    "Critical Injuries deal +3 Bonus Damage": added to the damage roll's Bonus Damage
 *   firstShot    "+1 to hit on its first Single Shot of a fight": once per combat
 *   ap           "every round also counts as Armor-Piercing": ablates 2 SP like Armor-Piercing
 *   twoHanded    "Excellent Quality two-handed" (+1) / "Two-handed: +1 to Aimed Shots and Autofire":
 *                with the weapon's Two hands switch on (the Action HUD)
 *   autoOnly / noAutofire / chargedAutoOnly   fire modes the Action HUD leaves out
 *   noThrough    a charged shot that can't pass cover; scopeThick: a scope that sees through one
 *                layer of Thick cover too
 *   crit "head" / "within"   the same rule on a head Aimed Shot only, or within a range
 *   critBonusHead  "Head Critical Injuries deal +5 Bonus Damage": on a head Aimed Shot's damage
 *   aimedDrop / autofireDrop   dice that drop the lowest, as a formula ("6d6dl1")
 *   chargeCost   a Tech charge that's free or costs half the MOVE: the charge card says so
 *   aimedDodge   "Dodging its Aimed Shots takes −2": on the target's Evade
 *   effect       "Sets what it damages Strongly On Fire", "Anyone it hits must beat DV15 Athletics
 *                or go Prone": a button on the damage card that puts the condition on the targets
 *   bodyReq      "BODY 11+ unless mounted" (and its Prone / cyberarm variants): a warning on the card
 *   recoil / recoilAuto   "Without BODY 8+ or a cyberarm, firing gives you Torn Muscle": the
 *                injury goes on the shooter
 *   ammoOnly     "Improved Smart Ammunition only", "Armor-Piercing only": a warning with other ammo
 *   noCapacity   "No capacity attachments": a warning when one is fitted
 *   reload       "Reloading takes two Reload Actions", "reload by giving up your Move Action": said on reload
 *   throughCover "Its rounds carry damage through cover like an Explosive"
 *   noAimed      "No Aimed Shots."
 *   noRicochet   "Its Power Rebuild can't ricochet."
 */

const START = "(?:^|[.;]\\s+)";
const num = (s) => Number(String(s).replace("−", "-"));

/** An item card's rule text: tags and entities out, and only what comes before its stat lines. */
export function ruleText(html) {
  const t = String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
  return t.split(/\s(?:Class:|Based on:|Category •|Item Compendium)/)[0].trim();
}

/** The rules a card's text gives, or null when it has none of them. */
export function parseSpecials(html) {
  const t = ruleText(html);
  if (!t) return null;
  const out = {};
  const b = t.match(/(Single Shot fires|Every shot is) an? (\d+)-round burst([^.]*)\.(?:\s*With fewer than \d+ left, it empties the magazine for (\d+d\d+))?/i);
  if (b && Number(b[2]) > 1) {
    const dmg = b[4] ?? b[3].match(/empties the magazine for (\d+d\d+)/i)?.[1] ?? null;
    out.burst = { rounds: Number(b[2]), every: /every/i.test(b[1]), short: /won't fire/i.test(b[3]) ? "refuse" : "empty", shortDamage: dmg };
  }
  const af = t.match(/Autofire uses (\d+) (rounds|shells)/i);
  if (af) out.autofire = { rounds: Number(af[1]), shells: /shells/i.test(af[2]) };
  const aimed = t.match(new RegExp(`${START}Aimed Shots deal \\+(\\d+)d6`));
  if (aimed) out.aimedDice = Number(aimed[1]);
  const abl = t.match(new RegExp(`${START}Ablates (\\d+) extra SP(?: \\((\\d+) charged\\))?`));
  if (abl) out.ablate = { extra: Number(abl[1]), charged: abl[2] ? Number(abl[2]) : null };
  const crit = t.match(new RegExp(`${START}(On an Aimed Shot, )?(\\d)s count as 6s for Critical Injuries`));
  if (crit) out.crit = { face: Number(crit[2]), when: crit[1] ? "aimed" : "always" };
  // The same rule tied to the head, or to a range.
  const headCrit = t.match(new RegExp(`${START}(?:On a head Aimed Shot,|[Hh]ead Aimed Shots count) (\\d)s (?:count )?as 6s for Critical Injuries`));
  if (headCrit && !out.crit) out.crit = { face: Number(headCrit[1]), when: "head" };
  const near = t.match(new RegExp(`${START}Within (\\d+)m, (\\d)s count as 6s for Critical Injuries`));
  if (near && !out.crit) out.crit = { face: Number(near[2]), when: "within", range: Number(near[1]) };
  const headBonus = t.match(new RegExp(`${START}Head Critical Injuries deal \\+(\\d+) Bonus Damage`));
  if (headBonus) out.critBonusHead = Number(headBonus[1]);
  // Dice that drop the lowest: an Aimed Shot's, or the Autofire damage roll's.
  const dropAimed = t.match(new RegExp(`${START}Aimed Shots deal (\\d+)d6, dropping the lowest`));
  if (dropAimed) out.aimedDrop = `${dropAimed[1]}d6dl1`;
  const dropAuto = t.match(/Autofire damage: roll (\d+)d6, drop the lowest, then multiply/i);
  if (dropAuto) out.autofireDrop = `${dropAuto[1]}d6dl1`;
  // What a Tech charge costs: nothing, or half the MOVE, in place of the Move Action.
  if (/charges without a Move Action/i.test(t)) out.chargeCost = "free";
  else if (/Charg(?:ing takes only|es with) half your MOVE/i.test(t)) out.chargeCost = "half";
  const dodge = t.match(/Dodging its Aimed Shots[^.]*takes ([−-]\d+)/i);
  if (dodge) out.aimedDodge = num(dodge[1]);
  const all = t.match(new RegExp(`${START}([−-]\\d+) to every attack`));
  if (all) out.attackMod = num(all[1]);
  const am = t.match(new RegExp(`${START}\\+(\\d+) to Aimed Shots( and Autofire)?\\.`));
  if (am) {
    out.aimedMod = Number(am[1]);
    if (am[2]) out.autofireMod = Number(am[1]);
  }
  const ar = t.match(new RegExp(`${START}An Aimed Shot fires (\\d+) rounds for \\+(\\d+)d6`));
  if (ar) {
    out.aimedRounds = Number(ar[1]);
    out.aimedDice = Number(ar[2]);
  }
  const cb = t.match(new RegExp(`${START}(?:Its )?Critical Injuries deal \\+(\\d+) Bonus Damage`));
  if (cb) out.critBonus = Number(cb[1]);
  const first = t.match(new RegExp(`${START}\\+(\\d+) to hit on its first Single Shot of a fight`));
  if (first) out.firstShot = Number(first[1]);
  if (/every round also counts as Armor-Piercing|burst that counts as Armor-Piercing/i.test(t)) out.ap = true;
  const two = t.match(/Two-handed: \+(\d+) to Aimed Shots( and Autofire)?/);
  const fine = /Excellent Quality (?:two-handed|when held in two hands)/i.test(t);
  if (two || fine) out.twoHanded = { attack: fine ? 1 : 0, aimed: two ? Number(two[1]) : 0, autofire: two?.[2] ? Number(two[1]) : 0 };
  if (new RegExp(`${START}Autofire and Suppressive Fire only`).test(t)) out.autoOnly = true;
  if (new RegExp(`${START}No Autofire\\.`).test(t)) out.noAutofire = true;
  if (/charged[^.]*can only Autofire/i.test(t)) out.chargedAutoOnly = true;
  if (/can't see or fire through cover/i.test(t)) out.noThrough = true;
  if (/scope sees outlines through one layer of Thin or Thick cover/i.test(t)) out.scopeThick = true;
  // What it does to whoever it damages.
  const fire = t.match(/Sets (?:what|anything) it damages (Mildly|Strongly|Deadly) On Fire/i);
  if (fire) out.effect = { id: { mildly: "onFireMild", strongly: "onFireStrong", deadly: "onFireDeadly" }[fire[1].toLowerCase()] };
  const prone = t.match(/Anyone it hits must beat DV(\d+) ([A-Z][A-Za-z/ ]*?) or go Prone/);
  if (prone && !out.effect) out.effect = { id: "prone", dv: Number(prone[1]), skill: prone[2] };
  // What it asks of whoever fires it.
  const req = t.match(new RegExp(`${START}(?:Requires |Needs )?BODY (\\d+)\\+(?: \\(or (\\d+)\\+ (?:and )?Prone\\))?( or Prone)?( or a cyberarm)?(?: unless mounted| or a mount)?[.;]`));
  if (req) out.bodyReq = { body: Number(req[1]), proneBody: req[2] ? Number(req[2]) : null, prone: !!req[3], cyberarm: !!req[4] };
  const INJ = { "broken arm": "brokenArm", "torn muscle": "tornMuscle" };
  const rec = t.match(/(?:Without BODY (\d+)\+ or (a cyberarm|paired cyberarms), firing (?:it )?gives you|Fire it without BODY (\d+)\+ or (a cyberarm|paired cyberarms) and you suffer) (?:a )?(Broken Arm|Torn Muscle)/i);
  if (rec) out.recoil = { body: Number(rec[1] ?? rec[3]), arms: /paired/i.test(rec[2] ?? rec[4]) ? 2 : 1, injury: INJ[rec[5].toLowerCase()] };
  const recAuto = t.match(/on Autofire without BODY (\d+)\+ or (a cyberarm|paired cyberarms), (?:a )?(Broken Arm|Torn Muscle)/i);
  if (recAuto) out.recoilAuto = { body: Number(recAuto[1]), arms: /paired/i.test(recAuto[2]) ? 2 : 1, injury: INJ[recAuto[3].toLowerCase()] };
  // Ammo, attachments and reloading.
  if (/Improved Smart Ammunition only/i.test(t)) out.ammoOnly = "smart";
  else if (/Armor-Piercing only/i.test(t)) out.ammoOnly = "armorPiercing";
  else if (/Loads only Expansive ammo/i.test(t)) out.ammoOnly = "expansive";
  if (/No capacity attachments/i.test(t)) out.noCapacity = true;
  const WORDS = { two: 2, three: 3, four: 4 };
  const rl = t.match(/Reloading takes (two|three|four|\d+) (?:Reload )?Actions|(Two|Three|Four) Reload Actions to reload/i);
  const rlMove = /reload by giving up your Move Action/i.test(t);
  if (rl || rlMove) {
    const w = (rl?.[1] ?? rl?.[2] ?? "").toLowerCase();
    out.reload = { actions: rl ? WORDS[w] ?? Number(w) : 1, move: rlMove ? (/Held two-handed, reload/i.test(t) ? "twoHanded" : /one hand free/i.test(t) ? "oneHand" : "always") : null };
  }
  if (/carry damage through cover like an Explosive/i.test(t)) out.throughCover = true;
  if (new RegExp(`${START}No Aimed Shots[.,]`).test(t)) out.noAimed = true;
  if (/Power Rebuild can't ricochet/i.test(t)) out.noRicochet = true;
  return Object.keys(out).length ? out : null;
}

/** A weapon's rules (from its card), or null. */
export const specialsOf = (item) => parseSpecials(item?.system?.description?.value);

/** The modifiers a weapon's rules put on an attack roll: [{ id, value, source }]. */
export function specialMods(sp, { aimed = false, autofire = false, twoHands = false, firstShot = false, name = "", moduleId = "ncm" } = {}) {
  if (!sp) return [];
  let value = (sp.attackMod || 0) + (aimed ? sp.aimedMod || 0 : 0) + (autofire ? sp.autofireMod || 0 : 0);
  // Held in two hands (the shooter's switch): Excellent Quality's +1, or the card's own bonus.
  if (twoHands && sp.twoHanded) value += sp.twoHanded.attack + (aimed ? sp.twoHanded.aimed : 0) + (autofire ? sp.twoHanded.autofire : 0);
  if (firstShot && !aimed && !autofire) value += sp.firstShot || 0;
  return value ? [{ id: `${moduleId}-special`, value, source: name, key: "bonuses.universalAttack", category: "combat" }] : [];
}

/** More dice on a damage formula's first XdY: "5d6" and 1 -> "6d6". */
export function moreDice(formula, extra) {
  if (!extra) return formula;
  return String(formula ?? "").replace(/(\d+)d(\d+)/, (m, n, d) => `${Number(n) + extra}d${d}`);
}

/**
 * Do the dice make a Critical Injury by the weapon's own rule when the plain rule (two 6s) says no?
 * Two or more dice showing a 6 or the face that counts as one.
 */
export function ruleCrit(sp, faces = [], { aimed = false, head = false, distance = null } = {}) {
  const c = sp?.crit;
  if (!c || (c.when === "aimed" && !aimed) || (c.when === "head" && !(aimed && head))) return false;
  if (c.when === "within" && !(Number.isFinite(distance) && distance <= c.range)) return false;
  const list = faces.map(Number);
  if (list.filter((f) => f === 6).length >= 2) return false;
  return list.filter((f) => f === 6 || f === c.face).length >= 2;
}

/** Can the weapon make Single and Aimed Shots now? Not one that only Autofires, or only does while charged. */
export const singleShots = (sp, charged = false) => !(sp?.autoOnly || (sp?.chargedAutoOnly && charged));

/**
 * Can this shooter fire the weapon as its card asks? { short: { need, have } | null, injury: id | null }.
 * `short`: under its BODY requirement (a mount is the table's call); `injury`: what firing it does
 * to someone without the BODY or the cyberarms.
 * @param {object} who - { body, cyberarms, prone }
 */
export function wielderCheck(sp, { body = 0, cyberarms = 0, prone = false } = {}, { autofire = false } = {}) {
  const out = { short: null, injury: null };
  const r = sp?.bodyReq;
  if (r) {
    const need = prone && r.proneBody ? r.proneBody : r.body;
    const ok = body >= need || (r.prone && prone) || (r.cyberarm && cyberarms >= 1);
    if (!ok) out.short = { need, have: body };
  }
  for (const rule of [autofire ? sp?.recoilAuto : null, sp?.recoil]) {
    if (!rule || out.injury) continue;
    if (body < rule.body && cyberarms < rule.arms) out.injury = rule.injury;
  }
  return out;
}

/** Attachments a weapon with "No capacity attachments" can't take. */
export const CAPACITY = /\b(extended|drum) magazine\b/i;
