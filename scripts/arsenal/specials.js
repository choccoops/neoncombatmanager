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
  const all = t.match(new RegExp(`${START}([−-]\\d+) to every attack`));
  if (all) out.attackMod = num(all[1]);
  const am = t.match(new RegExp(`${START}\\+(\\d+) to Aimed Shots( and Autofire)?\\.`));
  if (am) {
    out.aimedMod = Number(am[1]);
    if (am[2]) out.autofireMod = Number(am[1]);
  }
  if (new RegExp(`${START}No Aimed Shots[.,]`).test(t)) out.noAimed = true;
  if (/Power Rebuild can't ricochet/i.test(t)) out.noRicochet = true;
  return Object.keys(out).length ? out : null;
}

/** A weapon's rules (from its card), or null. */
export const specialsOf = (item) => parseSpecials(item?.system?.description?.value);

/** The modifiers a weapon's rules put on an attack roll: [{ id, value, source }]. */
export function specialMods(sp, { aimed = false, autofire = false, name = "", moduleId = "ncm" } = {}) {
  if (!sp) return [];
  const value = (sp.attackMod || 0) + (aimed ? sp.aimedMod || 0 : 0) + (autofire ? sp.autofireMod || 0 : 0);
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
export function ruleCrit(sp, faces = [], { aimed = false } = {}) {
  const c = sp?.crit;
  if (!c || (c.when === "aimed" && !aimed)) return false;
  const list = faces.map(Number);
  if (list.filter((f) => f === 6).length >= 2) return false;
  return list.filter((f) => f === 6 || f === c.face).length >= 2;
}
