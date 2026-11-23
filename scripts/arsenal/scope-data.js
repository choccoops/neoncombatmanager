/**
 * Scopes, pure (tests import it): how far a scope, a pair of cybereyes or binoculars lets a
 * character see, read from the item's own card.
 *
 * 2070 Item Compendium: a Long Scope sees detail to 100 m; a Sniping Scope and TeleOptics to
 * 800 m/yds; a Gaki Sniping Scope to 1,000 m; Binoculars magnify 2-3×. A card that names its
 * distance ("sees detail out to 1,000m") is taken at its word; one that only says what it is
 * ("A Long Scope that...") takes that kind's.
 */

export const SCOPE_RANGES = { sniping: 800, teleoptics: 800, long: 100 };

const strip = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/**
 * What an item lets its user see through it: { range } (m/yds), { factor } (a magnification of
 * what they already see), or null.
 * @param {{ name: string, description?: string }} item
 */
export function scopeOf(item) {
  const name = String(item?.name ?? "");
  const text = `${name}. ${strip(item?.description)}`;
  const said = /sees? detail (?:out )?to ([\d,]+)\s*m/i.exec(text);
  if (said) return { range: Number(said[1].replace(/,/g, "")) };
  if (/sniping scope/i.test(text)) return { range: SCOPE_RANGES.sniping };
  if (/tele-?optics/i.test(text)) return { range: SCOPE_RANGES.teleoptics };
  if (/\blong scope\b/i.test(text)) return { range: SCOPE_RANGES.long };
  const mag = /(\d+)\s*(?:[–-]\s*(\d+))?\s*[×x] magnification/i.exec(text);
  if (mag) return { factor: Number(mag[2] ?? mag[1]) };
  return null;
}

/** The better of two (the further one; any distance beats a magnification). */
export function better(a, b) {
  if (!a) return b ?? null;
  if (!b) return a;
  if (a.range && b.range) return b.range > a.range ? b : a;
  if (a.range || b.range) return a.range ? a : b;
  return (b.factor ?? 0) > (a.factor ?? 0) ? b : a;
}

/**
 * How far a token sees with a scope up, in the scene's units: the scope's distance (no further
 * than the scene itself, `max`), or its magnification of what the token sees unaided; never
 * less than unaided.
 */
export function scopedRange({ base = 0, scope = null, max = Infinity } = {}) {
  const b = Math.max(0, Number(base) || 0);
  if (!scope) return b;
  const want = scope.range ? Number(scope.range) : b * (Number(scope.factor) || 1);
  const cap = Number.isFinite(max) && max > 0 ? max : Infinity;
  return Math.max(b, Math.round(Math.min(want, cap)));
}

/** "800 m", "×3": a scope as a button says it. */
export const scopeLabel = (scope, unit = "m") => (scope?.range ? `${scope.range} ${unit}` : scope?.factor ? `×${scope.factor}` : "");
