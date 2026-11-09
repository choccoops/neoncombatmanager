import { MODULE_ID } from "../constants.js";
import { segmentsCross } from "../arsenal/xray.js";

/**
 * Cover, pure (2070 Core Rules Ch07, Cover, Shields & Armor): what a wall or a cover piece is
 * made of, its HP per 2×2m section, which section a line of fire meets, and what an attack does
 * to it. Everything here reads plain data, so the tests need no canvas.
 */

/** Cover HP per 2×2m section: [Thin, Thick]. */
export const COVER_HP = {
  plaster: [0, 15],
  wood: [5, 20],
  concrete: [10, 25],
  glass: [15, 30],
  stone: [20, 40],
  steel: [25, 50]
};
export const MATERIALS = Object.keys(COVER_HP);
export const THICKNESS = ["thin", "thick"];
/** One section of a wall, along its length. */
export const SECTION_METRES = 2;
/** Cover within this of the shooter is what they lean out from, not what they shoot through. */
export const LEAN_METRES = 2;

/** HP of one section, or null for something that isn't cover. */
export function coverHp(material, thickness = "thick") {
  const row = COVER_HP[material];
  if (!row) return null;
  return thickness === "thin" ? row[0] : row[1];
}

const flagOf = (doc) => doc?.flags?.[MODULE_ID]?.cover ?? null;
const len = (c) => Math.hypot(c[2] - c[0], c[3] - c[1]);

/** How many 2m sections a wall of these pixel coordinates has. */
export function sectionCount(c, { size = 100, distance = 2 } = {}) {
  const metres = (len(c) / (size || 100)) * (distance || 2);
  return Math.max(1, Math.round(metres / SECTION_METRES));
}

/** The section a point on (or near) a wall falls in. */
export function sectionAt(c, point, n) {
  const dx = c[2] - c[0];
  const dy = c[3] - c[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((point.x - c[0]) * dx + (point.y - c[1]) * dy) / l2));
  return Math.min(n - 1, Math.floor(t * n));
}

/** A section's own coordinates. */
export function sectionCoords(c, i, n) {
  const at = (t) => [c[0] + (c[2] - c[0]) * t, c[1] + (c[3] - c[1]) * t];
  return [...at(i / n), ...at((i + 1) / n)];
}

/**
 * A wall, read as cover: { kind: "wall", id, material, thickness, max, n, hp: [per section],
 * broken, c, implicit } or null. A door with no cover of its own is Wood (Thin) when `doorsWood`;
 * an open door is no cover at all. A section that's destroyed has 0 HP; a wall made of one broken
 * piece is `broken`.
 */
export function readWallCover(doc, { doorsWood = true, size = 100, distance = 2 } = {}) {
  if (!doc) return null;
  const door = Number(doc.door) || 0;
  if (door > 0 && Number(doc.ds) === 1) return null;
  let flag = flagOf(doc);
  let implicit = false;
  if (!flag?.material && door > 0 && doorsWood) {
    flag = { ...(flag ?? {}), material: "wood", thickness: "thin" };
    implicit = true;
  }
  const max = coverHp(flag?.material, flag?.thickness);
  if (max === null) return null;
  const c = doc.c ?? [0, 0, 0, 0];
  const n = sectionCount(c, { size, distance });
  const broken = !!flag.broken;
  // A section's HP never tops the material's (it may have been changed since the wall was hit).
  const hp = Array.from({ length: n }, (_, i) => (broken ? 0 : Math.max(0, Math.min(max, Number(flag.hp?.[i] ?? max)))));
  return { kind: "wall", id: doc.id, material: flag.material, thickness: flag.thickness ?? "thick", max, n, hp, broken, c, implicit };
}

export const VAS = "mmutons-cyberpunk-red-vas";

/**
 * Is this actor a ride: MMuton's vehicle sheet (its seats, or the sheet itself), or one of Neon Hub's
 * 2070s vehicles? Cyberpets and people aren't.
 */
export function isVehicle(actor) {
  if (!actor) return false;
  const f = actor.flags ?? {};
  return Array.isArray(f[VAS]?.positions) || String(f.core?.sheetClass ?? "").startsWith(`${VAS}.`) || !!f["cpr-neon-hub"]?.vehicle2070;
}

/**
 * A token, read as cover: a cover piece (an actor flagged as cover, its HP the piece's) or a ride
 * (HOUSE RULE, Your ride as cover: its SP and SDP: `sp`, and its SDP as `hp`). { kind, id, material,
 * thickness, max, hp: [value], sp, box, name } or null.
 * @param {number} [sp] - the ride's SP (its body armor), read by the caller
 */
export function readPieceCover(tok, { size = 100, sp = 0 } = {}) {
  const actor = tok?.actor;
  if (!actor) return null;
  const flag = flagOf(actor);
  const vehicle = !flag && isVehicle(actor);
  if (!flag && !vehicle) return null;
  const hp = actor.system?.derivedStats?.hp ?? {};
  const box = { x: Number(tok.x) || 0, y: Number(tok.y) || 0, w: (Number(tok.width) || 1) * size, h: (Number(tok.height) || 1) * size };
  return {
    kind: vehicle ? "vehicle" : "piece", id: tok.id, name: tok.name ?? actor.name, material: flag?.material ?? null, thickness: flag?.thickness ?? "thick",
    max: Number(hp.max) || 0, hp: [Math.max(0, Number(hp.value) || 0)], sp: vehicle ? Math.max(0, Number(sp) || 0) : 0, box, actorId: actor.id
  };
}

/**
 * The seat someone rides in, on MMuton's vehicle sheet: { position, index } or null. Seats list
 * their occupants by actor UUID.
 */
export function seatOf(positions, actorUuid) {
  const list = Array.isArray(positions) ? positions : [];
  const index = list.findIndex((p) => (p?.occupants ?? []).includes(actorUuid));
  return index < 0 ? null : { position: list[index], index };
}

/**
 * Inside a ride, normal cover rules apply (HOUSE RULE): windows aren't cover, but a seat with
 * Bulletproof Glass is, Thin (15 HP) or Thick (30 HP) by its glass. Cover for someone in that seat,
 * or null when the glass isn't there or is broken.
 */
export function readGlassCover(tok, seat) {
  const p = seat?.position;
  if (!tok || !p?.bulletproofGlass) return null;
  const max = Number(p.glassHpMax) || 0;
  const hp = Math.max(0, Number(p.glassHp ?? max) || 0);
  if (!max || !(hp > 0)) return null;
  return { kind: "glass", id: tok.id, seat: p.id, name: `${tok.name}: ${p.name}`, material: "glass", thickness: max >= 30 ? "thick" : "thin", max, hp: [hp] };
}

/** Where segment ab meets segment cd, or null. */
export function crossing(a, b, c, d) {
  if (!segmentsCross(a, b, c, d)) return null;
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (!den) return { x: c.x, y: c.y };
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Where a segment first enters a box, or null when it misses. */
export function enterBox(a, b, box) {
  const inside = (p) => p.x > box.x && p.x < box.x + box.w && p.y > box.y && p.y < box.y + box.h;
  if (inside(a)) return { x: a.x, y: a.y };
  const edges = [
    [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }],
    [{ x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }],
    [{ x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }],
    [{ x: box.x, y: box.y + box.h }, { x: box.x, y: box.y }]
  ];
  let best = null;
  for (const [c, d] of edges) {
    const p = crossing(a, b, c, d);
    if (p && (!best || Math.hypot(p.x - a.x, p.y - a.y) < Math.hypot(best.x - a.x, best.y - a.y))) best = p;
  }
  return best;
}

/**
 * The intact cover a line of fire meets, nearest the shooter first: [{ cover, section, point,
 * dist }]. Cover within `lean` pixels of the shooter is what they lean out from and doesn't count;
 * the target's own token and the shooter's never count. `throughThin` skips Thin cover (a charged
 * Tech shot fires through it).
 */
export function coverOnLine(from, to, { walls = [], pieces = [], lean = 0, exclude = [], throughThin = false } = {}) {
  const out = [];
  const far = Math.hypot(to.x - from.x, to.y - from.y);
  for (const w of walls) {
    if (!w || (throughThin && w.thickness === "thin")) continue;
    const p = crossing(from, to, { x: w.c[0], y: w.c[1] }, { x: w.c[2], y: w.c[3] });
    if (!p) continue;
    const dist = Math.hypot(p.x - from.x, p.y - from.y);
    if (dist < lean || dist >= far) continue;
    const section = sectionAt(w.c, p, w.n);
    if (!(w.hp[section] > 0)) continue;
    out.push({ cover: w, section, point: p, dist });
  }
  for (const piece of pieces) {
    if (!piece || exclude.includes(piece.id) || (throughThin && piece.thickness === "thin")) continue;
    if (!(piece.hp[0] > 0)) continue;
    const p = enterBox(from, to, piece.box);
    if (!p) continue;
    const dist = Math.hypot(p.x - from.x, p.y - from.y);
    if (dist < lean || dist >= far) continue;
    out.push({ cover: piece, section: 0, point: p, dist });
  }
  return out.sort((a, b) => a.dist - b.dist);
}

/**
 * The cover a line of fire meets first, for someone who may be riding in a vehicle: `ride` is the
 * token id of the ride they sit in, `glass` their seat's glass cover (readGlassCover). The ride
 * isn't their cover (Inside it, normal cover rules apply); cover out past it still is; else their
 * seat's bulletproof glass, else nothing (windows aren't cover). { cover, section, dist } or null.
 */
export function coverFor(from, to, { walls = [], pieces = [], lean = 0, exclude = [], throughThin = false, ride = null, glass = null } = {}) {
  const own = ride ? pieces.find((p) => p.id === ride) : null;
  const [first] = coverOnLine(from, to, { walls, pieces, lean, throughThin, exclude: own ? [...exclude, own.id] : exclude });
  if (!own) return first ?? null;
  const door = enterBox(from, to, own.box);
  const doorDist = door ? Math.hypot(door.x - from.x, door.y - from.y) : Infinity;
  if (first && first.dist < doorDist) return first;
  if (glass && !(throughThin && glass.thickness === "thin")) return { cover: glass, section: 0, dist: doorDist };
  return null;
}

/**
 * What an attack's damage does to one piece of cover. Cover has no armor: the section takes it all,
 * and at 0 it's destroyed but still soaks the whole attack, except an explosive's, which carries
 * on to whoever is behind (Ch07). Rocket launchers' Bunker Buster doubles it against cover. A ride
 * (`sp`) takes it as a vehicle does: its SP first, then its SDP.
 * @returns {{ before, after, taken, destroyed, soaks }}
 */
export function hitCover(hp, damage, { explosive = false, bunkerBuster = false, sp = 0 } = {}) {
  const before = Math.max(0, Number(hp) || 0);
  // A ride's SP stops its share first; a rocket's double counts once the damage gets through it (Bunker Buster).
  const taken = Math.max(0, (Number(damage) || 0) - (Number(sp) || 0)) * (bunkerBuster ? 2 : 1);
  const after = Math.max(0, before - taken);
  const destroyed = after === 0 && taken > 0;
  return { before, after, taken, destroyed, soaks: !(destroyed && explosive) };
}

/**
 * A wall split around a destroyed section: the coordinates and per-section HP of the piece before
 * it, the section itself, and the piece after it (null where there's nothing).
 */
export function splitAt(c, i, n, hp) {
  const piece = (from, to) => (to > from ? { c: [...sectionCoords(c, from, n).slice(0, 2), ...sectionCoords(c, to - 1, n).slice(2)], hp: hp.slice(from, to) } : null);
  return { before: piece(0, i), section: { c: sectionCoords(c, i, n), hp: [0] }, after: piece(i + 1, n) };
}

/** A key for a piece of cover (one wall section, or one token). */
export const coverKey = (cover, section = 0) => `${cover.kind}:${cover.id}:${cover.kind === "wall" ? section : cover.kind === "glass" ? cover.seat : 0}`;

/**
 * An area attack's cover, pure. For each person in it, the first intact cover between the
 * origin (the blast's centre, or a shell's shooter) and them; every such piece once, with the
 * damage it takes; whether each person is still hit. An explosive that destroys the cover hits
 * whoever is behind it; a Shotgun Shell's cover always soaks it. Cover pieces inside the area
 * take the damage too.
 * @param {object[]} people - { id, center, ride?: the ride's token id they sit in, glass?: its seat's glass cover }
 * @param {object[]} piecesInside - cover pieces (from readPieceCover) inside the area
 * @returns {{ cover: [{ key, cover, section, result }], hit: { [id]: { hit, behind } } }}
 */
export function areaPlan({ origin, people = [], walls = [], pieces = [], piecesInside = [], damage = 0, explosive = true, bunkerBuster = false, exclude = [] }) {
  const hits = new Map();
  const add = (cover, section) => {
    const key = coverKey(cover, section);
    if (!hits.has(key)) hits.set(key, { key, cover, section, result: hitCover(cover.hp[section], damage, { explosive, bunkerBuster, sp: cover.sp ?? 0 }) });
    return hits.get(key);
  };
  for (const p of piecesInside) add(p, 0);
  const hit = {};
  for (const person of people) {
    const first = coverFor(origin, person.center, { walls, pieces, exclude: [...exclude, person.id], ride: person.ride, glass: person.glass });
    if (!first) {
      hit[person.id] = { hit: true, behind: null };
      continue;
    }
    const h = add(first.cover, first.section);
    hit[person.id] = { hit: !h.result.soaks, behind: h.key };
  }
  return { cover: [...hits.values()], hit };
}

/** A cover's label: "Concrete (Thick)", or a token's name. */
export function coverLabel(cover, L = (k) => k) {
  if (cover.kind === "vehicle") return `${cover.name} (SP ${cover.sp ?? 0})`;
  if (cover.kind !== "wall" && cover.name) return cover.name;
  return `${L(`Material.${cover.material}`)} (${L(`Thickness.${cover.thickness}`)})`;
}
