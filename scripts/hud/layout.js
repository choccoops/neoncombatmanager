/**
 * The Action HUD's layout, pure (tests import it): which groups a player sees, in what order, and
 * which actions are in each.
 *
 * A layout is { v, groups: [{ id, source, name, icon, picks, hidden }] }:
 *   source - where its actions come from (SOURCES); null for a group of the player's own, which
 *            picks from every source
 *   picks  - action keys in the order shown ("skill:evasion", "weapon:militechcrusher"), or null
 *            for everything the source has (a custom group always has picks)
 *   name   - the player's own name for it ("" for the built-in name)
 * Keys are names, not ids, so a layout carries over to a player's other characters.
 */

export const SOURCES = ["turn", "weapons", "skills", "role", "net", "status", "utility", "stats", "gear"];

/** The template every player starts from: what a character reaches for in a fight. */
export const TEMPLATE = {
  v: 1,
  groups: [
    { id: "turn", source: "turn", picks: null },
    { id: "weapons", source: "weapons", picks: null },
    { id: "skills", source: "skills", picks: ["skill:evasion", "skill:perception", "skill:brawling", "skill:meleeweapon", "skill:athletics", "skill:stealth", "skill:firstaid"] },
    { id: "role", source: "role", picks: null },
    { id: "net", source: "net", picks: null },
    { id: "status", source: "status", picks: ["cond:prone", "cond:cover", "cond:hidden", "cond:readiedAction", "cond:grappled", "cond:suppressed"] },
    { id: "utility", source: "utility", picks: null },
    { id: "stats", source: "stats", picks: null, hidden: true },
    { id: "gear", source: "gear", picks: null, hidden: true }
  ]
};

const clone = (x) => JSON.parse(JSON.stringify(x));

/** A fresh copy of the template. */
export const template = () => normalize(TEMPLATE);

/**
 * A layout made safe to use: every group has its fields, unknown sources are dropped, ids are
 * unique, and built-in groups the layout predates are added at the end (hidden).
 */
export function normalize(layout) {
  const src = Array.isArray(layout?.groups) ? layout.groups : TEMPLATE.groups;
  const seen = new Set();
  const groups = [];
  for (const g of src) {
    if (!g || typeof g !== "object") continue;
    const source = SOURCES.includes(g.source) ? g.source : null;
    const id = String(g.id ?? "");
    if (!id || seen.has(id) || (g.source && !source)) continue;
    seen.add(id);
    let picks = Array.isArray(g.picks) ? [...new Set(g.picks.map(String).filter(Boolean))] : null;
    if (!source && !picks) picks = [];
    groups.push({ id, source, name: String(g.name ?? ""), icon: String(g.icon ?? ""), picks, hidden: !!g.hidden });
  }
  for (const t of TEMPLATE.groups) {
    if (!groups.some((g) => g.source === t.source && g.id === t.id) && !seen.has(t.id)) {
      groups.push({ ...clone(t), name: "", icon: "", hidden: true });
    }
  }
  return { v: 1, groups };
}

/**
 * What the HUD shows: the layout's visible groups with their entries, in order. A group with
 * nothing to show (a character with no cyberdeck has no Netrunning) is left out.
 * @param {object} layout
 * @param {object} catalog - { [source]: entry[] }, each entry { key, ... }
 * @returns {{ id, source, name, icon, entries }[]}
 */
export function resolve(layout, catalog) {
  const all = new Map();
  for (const source of SOURCES) for (const e of catalog?.[source] ?? []) all.set(e.key, e);
  const out = [];
  for (const g of normalize(layout).groups) {
    if (g.hidden) continue;
    const pool = g.source ? catalog?.[g.source] ?? [] : [...all.values()];
    const entries = g.picks ? g.picks.map((k) => (g.source ? pool.find((e) => e.key === k) : all.get(k))).filter(Boolean) : pool;
    if (entries.length) out.push({ id: g.id, source: g.source, name: g.name, icon: g.icon, entries });
  }
  return out;
}

/* -------------------------------------------- */
/*  Editing (each returns a new layout)          */
/* -------------------------------------------- */

const edit = (layout, fn) => {
  const next = normalize(clone(layout));
  fn(next);
  return normalize(next);
};
const find = (layout, id) => layout.groups.find((g) => g.id === id);

/** Move a group up (-1) or down (+1). */
export const moveGroup = (layout, id, dir) => edit(layout, (l) => {
  const i = l.groups.findIndex((g) => g.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= l.groups.length) return;
  [l.groups[i], l.groups[j]] = [l.groups[j], l.groups[i]];
});

/** Change a group's fields: { name, icon, hidden }. */
export const setGroup = (layout, id, changes) => edit(layout, (l) => {
  const g = find(l, id);
  if (!g) return;
  for (const k of ["name", "icon", "hidden"]) if (k in changes) g[k] = changes[k];
});

/**
 * A group's actions: automatic (everything its source has) or chosen. Turning automatic off
 * starts from what it shows now.
 * @param {string[]} [current] - the keys the group shows now
 */
export const setAuto = (layout, id, auto, current = []) => edit(layout, (l) => {
  const g = find(l, id);
  if (!g || !g.source) return;
  g.picks = auto ? null : [...current];
});

/** Add an action to a group (at the end). */
export const addPick = (layout, id, key) => edit(layout, (l) => {
  const g = find(l, id);
  if (!g || !key) return;
  g.picks = [...(g.picks ?? []).filter((k) => k !== key), key];
});

export const removePick = (layout, id, key) => edit(layout, (l) => {
  const g = find(l, id);
  if (g?.picks) g.picks = g.picks.filter((k) => k !== key);
});

/** Move an action left (-1) or right (+1) within its group. */
export const movePick = (layout, id, key, dir) => edit(layout, (l) => {
  const p = find(l, id)?.picks;
  const i = p?.indexOf(key) ?? -1;
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.length) return;
  [p[i], p[j]] = [p[j], p[i]];
});

/** A group of the player's own, picking from every source. */
export const addGroup = (layout, name, id = `own${Date.now().toString(36)}`) => edit(layout, (l) => {
  l.groups.push({ id, source: null, name: String(name ?? ""), icon: "fa-solid fa-star", picks: [], hidden: false });
});

/** Remove a group of the player's own (built-in groups are hidden instead). */
export const removeGroup = (layout, id) => edit(layout, (l) => {
  const g = find(l, id);
  if (!g) return;
  if (g.source) g.hidden = true;
  else l.groups = l.groups.filter((x) => x.id !== id);
});
