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
 *   heldPenalty  "Without BODY 10+ or paired cyberarms, −1 DEX and MOVE while held": a condition on
 *                whoever holds it without the BODY for it
 *   (own rounds) "Loads only its own Armor-Piercing rounds, which ablate 1 extra SP...": the
 *                rounds' rules count as the gun's (ap, ablate, effect, throughCover)
 *   check        "must beat DV17 Resist Torture/Drugs or ...": the card's sentence on the damage card
 *   area         "Its grenades burst in a 6×6m area": the size of its template
 *   crit "firstDamage" / "firstRound"   "Its first damage roll each fight counts 5s as 6s"
 *   memo         "If it Autofired last Round, ...", "ROF2 if it fired last Round", "If it caused a
 *                Critical Injury last Round, ...": the card's sentence, on the card when it applies
 *   critLastMod / critLastBonus   Excellent Quality (+1) or more Bonus Damage the Round after a crit
 *   aimedStreakDice   more Aimed Shot dice the Round after an Aimed Shot's damage
 *   autoLimit    "Autofire it more than twice in a row and it's Destroyed Beyond Repair"
 *   wounded      what changes while the wielder is Seriously or Mortally Wounded
 *   remind       one-off rules as reminders: the card's sentence on the Autofire attack ("On
 *                Autofire, ..."), on the damage card ("Against a target ...", "A kill ..."), or on a
 *                Critical Injury ("Each Critical Injury ...", "A Head Critical Injury ...")
 *   table        "Each Critical Injury also rolls 1d6: 1 ...; 2 ...": a button that rolls it
 *   twin         a sister weapon whose Critical Injuries count as this one's (Nehan and Satori)
 *   blindBox / chaos / netRounds / mixed   the R.N.Geezus!, Chaos, Gris Gris and magazines of
 *                several ammo types (scripts/arsenal/iconics.js)
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
  // Too heavy to hold: stat penalties while it's in hand, for someone without the BODY (or the cyberarms).
  const held = t.match(/(?:[Ww]ithout BODY (\d+)\+((?:,| or) paired cyberarms)?(?: or a mount)?,|BODY (\d+)\+ or)?\s*[−-](\d) ((?:REF, )?(?:DEX and )?MOVE) while (?:held|you hold it)(?: \(min (\d+)\))?( and (Torn Muscle|Broken Arm) when fired)?/);
  if (held) {
    const body = held[1] ?? held[3] ?? null;
    out.heldPenalty = { body: body ? Number(body) : null, arms: held[2] ? 2 : 0, value: -Number(held[4]), stats: held[5].replace("and ", "").split(/,? /).map((x) => x.toLowerCase()) };
    // "(min 4)": the penalty never takes the stat below that (someone already under it loses nothing).
    if (held[6]) out.heldPenalty.min = Number(held[6]);
    if (held[8] && body && !out.recoil) out.recoil = { body: Number(body), arms: held[2] ? 2 : 99, injury: INJ[held[8].toLowerCase()] };
  }
  // A gun that loads only its own rounds: what those rounds do is the gun's rule.
  const ownRounds = t.match(/(?:Loads|Fires) (?:only )?its own [^.]*/i)?.[0] ?? t.match(/Its own Armor-Piercing rounds[^.]*/i)?.[0];
  if (ownRounds) {
    if (/Armor-Piercing/i.test(ownRounds)) out.ap = true;
    const more = ownRounds.match(/ablate (\d+) extra SP/i);
    if (more && !out.ablate) out.ablate = { extra: Number(more[1]), charged: null };
    const burn = ownRounds.match(/set targets (Mildly|Strongly|Deadly) On Fire/i);
    if (burn && !out.effect) out.effect = { id: { mildly: "onFireMild", strongly: "onFireStrong", deadly: "onFireDeadly" }[burn[1].toLowerCase()] };
    if (/carry(?:ing)? damage (?:past destroyed|through) cover/i.test(ownRounds)) out.throughCover = true;
  }
  // A check the target makes, worded for this weapon: the card's own sentence goes on the damage card,
  // with a button where what follows is a condition the module has.
  const chk = t.match(/[^.;:]*(?:must (?:also )?beat|forces|makes|rolls) DV(\d+) ([A-Z][A-Za-z/]+(?: [A-Z][A-Za-z/]+)*),? or ([^.;]+)[.;]/);
  if (chk && !out.effect?.dv) {
    out.check = { dv: Number(chk[1]), skill: chk[2], text: chk[0].trim() };
    const then = chk[3];
    const id = /\bProne\b/.test(then) ? "prone" : /Damaged Ear/.test(then) ? "damagedEar" : /Unconscious/.test(then) ? "unconscious" : null;
    if (id && !out.effect) out.effect = { id, dv: Number(chk[1]), skill: chk[2], own: true };
  }
  // Explosives that burst in an area of their own.
  const area = t.match(/(?:explosives|grenades|rockets) burst in a (\d+)×\1m area/i);
  if (area) out.area = Number(area[1]);
  // Rules that remember the fight: what the weapon did last Round, the first roll of a fight, a streak.
  const firstDmg = t.match(/Its first (damage roll each fight|attack each Round) counts (\d)s as 6s/i);
  if (firstDmg && !out.crit) out.crit = { face: Number(firstDmg[2]), when: /fight/i.test(firstDmg[1]) ? "firstDamage" : "firstRound" };
  const memo = [];
  for (const sentence of t.split(/(?<=[.;])\s+/)) {
    const when = /^If it Autofired last Round/i.test(sentence) ? "auto" : /if it fired last Round/i.test(sentence) ? "fired"
      : /Critical Injury last Round/i.test(sentence) && /^If (?:it|this)/i.test(sentence) ? "crit" : null;
    if (when) memo.push({ when, text: sentence.replace(/[;]$/, ".") });
  }
  if (memo.length) out.memo = memo;
  if (/Excellent Quality this Round/i.test(t) && memo.some((m) => m.when === "crit")) out.critLastMod = 1;
  const critLast = t.match(/Critical Injury last Round, its next one deals \+(\d+) Bonus Damage/i);
  if (critLast) out.critLastBonus = Number(critLast[1]);
  const streak = t.match(/Aimed Shots deal \+\d+d6 \(\d+d6\), or \+(\d+)d6 \(\d+d6\) if an Aimed Shot from it dealt damage last Round/i);
  if (streak) out.aimedStreakDice = Number(streak[1]);
  if (/Autofire it more than twice in a row/i.test(t)) out.autoLimit = 2;
  // Rules for a wounded wielder (Seriously or Mortally Wounded).
  const wAimed = t.match(/Seriously or Mortally Wounded it overclocks: Aimed Shots deal \+(\d+)d6/i);
  const wLess = t.match(/Aimed Shots deal \+\d+d6 \(\d+d6\), or \+(\d+)d6 \(\d+d6\) while you're Seriously or Mortally Wounded/i);
  const wHit = t.match(/Seriously or Mortally Wounded, it overclocks: \+(\d+) to hit/i);
  if (wAimed || wLess || wHit) out.wounded = { aimedDice: wAimed ? Number(wAimed[1]) : null, aimedDiceInstead: wLess ? Number(wLess[1]) : null, attackMod: wHit ? Number(wHit[1]) : 0 };
  if (wAimed && out.aimedDice === Number(wAimed[1]) && !new RegExp(`${START}Aimed Shots deal`).test(t)) delete out.aimedDice;
  // One-off rules the module can't run, but can bring up at the right moment: the card's own
  // sentence, on the card of the roll that triggers it.
  const remind = [];
  for (const sentence of t.split(/(?<=[.;])\s+(?=[A-Z])/)) {
    if (/^(?:Its )?Critical Injuries deal \+\d+ Bonus Damage \(\d+\)\.$/.test(sentence) || /^Head Critical Injuries deal \+\d+ Bonus Damage\.$/.test(sentence)) continue;
    const on = /^On (?:its )?Autofire/.test(sentence) ? "autofire"
      : /^(?:A |Each |Its |Head )?(?:Head |random )?Critical Injur/.test(sentence) ? (/^A Head|^Head/.test(sentence) ? "headCrit" : "crit")
        : /^(?:A kill|Kill a target|Dropping a target|Taking a target|Each living target)/.test(sentence) ? "kill"
          : /^Against a target/.test(sentence) ? "target" : null;
    if (on) remind.push({ on, text: sentence });
  }
  if (remind.length) out.remind = remind;
  // A table of the weapon's own, rolled on each Critical Injury ("Each Critical Injury also rolls 1d6: 1 ...; 2 ...").
  const tbl = t.match(/Each Critical Injury also rolls 1d(\d+):\s*(.+?)(?:\.\s+[A-Z]|\.$)/);
  if (tbl) {
    const entries = {};
    for (const m of tbl[2].matchAll(/(?:^|;\s*)(\d+)\s+(.+?)(?=;\s*\d+\s|$)/g)) entries[m[1]] = m[2].trim();
    if (Object.keys(entries).length >= 2) out.table = { die: Number(tbl[1]), entries };
  }
  // Two weapons that count each other's Critical Injuries ("If this blade or Satori gave...").
  const twin = t.match(/If this (?:blade|sword) or ([A-Z][a-z]+) gave/);
  if (twin) out.twin = twin[1];
  // Weapons with rules of their own kind (scripts/arsenal/iconics.js).
  if (/Blind Box Magazines/i.test(t)) out.blindBox = true;
  if (/Every reload, reroll its stats/i.test(t)) out.chaos = true;
  if (/NET-linked rounds/i.test(t)) out.netRounds = true;
  const mixed = t.match(/(?:holds|[Ll]oads) up to (\d+) ammo types|up to (\d+) ammo types loaded at once/);
  if (mixed) out.mixed = Number(mixed[1] ?? mixed[2]);
  else if (/two barrels can hold a different ammo type/i.test(t)) out.mixed = 2;
  else if (/any number of ammo types/i.test(t)) out.mixed = 99;
  if (new RegExp(`${START}No Aimed Shots[.,]`).test(t)) out.noAimed = true;
  if (/Power Rebuild can't ricochet/i.test(t)) out.noRicochet = true;
  return Object.keys(out).length ? out : null;
}

/** A weapon's rules (from its card), or null. */
export const specialsOf = (item) => parseSpecials(item?.system?.description?.value);

/** The modifiers a weapon's rules put on an attack roll: [{ id, value, source }]. */
export function specialMods(sp, { aimed = false, autofire = false, twoHands = false, firstShot = false, wounded = false, critLast = false, name = "", moduleId = "ncm" } = {}) {
  if (!sp) return [];
  let value = (wounded ? sp.wounded?.attackMod || 0 : 0) + (critLast ? sp.critLastMod || 0 : 0) + (sp.attackMod || 0) + (aimed ? sp.aimedMod || 0 : 0) + (autofire ? sp.autofireMod || 0 : 0);
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
export function ruleCrit(sp, faces = [], { aimed = false, head = false, distance = null, first = false } = {}) {
  const c = sp?.crit;
  if (c && ["firstDamage", "firstRound"].includes(c.when) && !first) return false;
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

/**
 * The stat penalties a character takes for the weapons they hold without the BODY (or the paired
 * cyberarms) for them: { ref, dex, move } with the worst of each, or null.
 * @param {object[]} rules - each weapon's heldPenalty
 * @param {object} who - { body, cyberarms, stats: { ref, dex, move } as they are without this strain }
 */
export function strainOf(rules = [], { body = 0, cyberarms = 0, stats = {} } = {}) {
  const out = {};
  for (const r of rules) {
    if (!r) continue;
    if (r.body !== null && (body >= r.body || (r.arms && cyberarms >= r.arms))) continue;
    for (const st of r.stats) {
      // A floor on the card: only as much of the penalty as keeps the stat (without it) at the floor or above.
      const base = Number(stats[st]);
      const value = Number.isFinite(r.min) && Number.isFinite(base) ? Math.max(r.value, Math.min(0, r.min - base)) : r.value;
      out[st] = Math.min(out[st] ?? 0, value);
    }
  }
  for (const st of Object.keys(out)) if (!out[st]) delete out[st];
  return Object.keys(out).length ? out : null;
}

/**
 * What a weapon remembers of the fight, moved on by one roll, pure. Memory belongs to one combat
 * (a new one starts it clean) and counts in its Rounds.
 * @param {object} mem - { combat, firedRound, autoRound, autoStreak, aimedDamageRound, critRound, damageRolls, damageRound }
 * @param {object} now - { combat, round, kind: "attack"|"damage"|"crit", autofire, aimed }
 */
export function remember(mem = {}, { combat = null, round = 0, kind = "attack", autofire = false, aimed = false } = {}) {
  const m = mem?.combat === combat ? { ...mem } : { combat };
  if (kind === "attack") {
    m.firedRound = round;
    m.autoStreak = autofire ? (m.autoStreak || 0) + 1 : 0;
    if (autofire) m.autoRound = round;
  } else if (kind === "damage") {
    m.damageRolls = (m.damageRolls || 0) + 1;
    m.damageRound = round;
    if (aimed) m.aimedDamageRound = round;
  } else if (kind === "crit") m.critRound = round;
  return m;
}

/** What the weapon did last Round, from its memory: { auto, fired, crit, aimedDamage }. */
export function lastRound(mem = {}, { combat = null, round = 0 } = {}) {
  const ok = !!combat && mem?.combat === combat && round > 0;
  const was = (r) => ok && Number.isFinite(r) && r === round - 1;
  return { auto: was(mem.autoRound), fired: was(mem.firedRound), crit: was(mem.critRound), aimedDamage: was(mem.aimedDamageRound) };
}
