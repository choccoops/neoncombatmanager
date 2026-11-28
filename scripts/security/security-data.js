/**
 * Security systems, pure: the devices (corebook pg. 213-215; 2070 Compendium, Security Systems),
 * what each one watches, and what it does to whoever sets it off. No Foundry in here.
 *
 * A device is a Tile carrying the SECURITY_FLAG:
 *   { kind, name, on, hp, range, angle, node, weapon, depth, spikes, passes: [actor ids],
 *     controllers: [actor ids], spent }
 * Its facing is the Tile's rotation (0 looks down the map, as a token's does).
 */

export const SECURITY_FLAG = "security";

/** A turret's gun: what it rolls for damage, its range table, and what else a hit does. */
export const WEAPONS = {
  assaultRifle: { damage: "5d6", table: "DV Assault Rifle", sound: "secTurretFire" },
  heavySmg: { damage: "3d6", table: "DV SMG", sound: "secTurretFire" },
  vhPistol: { damage: "4d6", table: "DV Pistol", sound: "secTurretFire", ap: true },
  flamethrower: { damage: "3d6", table: "DV Shotgun", sound: "secFlame", fire: true },
  dartgun: { damage: "", table: "DV Pistol", sound: "secDart", poison: true }
};

/** The Combat Number an Emplaced Defense attacks with when nobody runs it (plus 1d10). */
export const COMBAT_NUMBER = 14;

/**
 * Every device. watch: how it notices someone ("cone": a field of view from the tile; "step": on
 * the tile; "near": within `range` of the tile). act: what happens then. counter: the
 * traverse: the arc (°, centred on where it rests) a swivel mount turns through to follow whoever
 * it has in view (0: fixed). counter: the Electronics/Security Tech DV and the minutes to put it out of action by hand. spot: the
 * Perception DV to find it when it's hidden (0: in plain sight). node: the Control Node DV a
 * Netrunner beats to take it.
 */
export const KINDS = {
  camera: { group: "environmental", watch: "cone", act: "report", hp: 5, range: 20, angle: 90, spot: 17, counter: { dv: 9, min: 1 }, node: 8 },
  turret: { group: "emplaced", watch: "cone", act: "shoot", hp: 25, range: 30, angle: 90, traverse: 180, spot: 0, counter: { dv: 17, min: 5 }, node: 10, weapon: "assaultRifle" },
  melee: { group: "emplaced", watch: "cone", act: "slash", hp: 25, range: 4, angle: 180, spot: 0, counter: { dv: 17, min: 5 }, node: 10 },
  bloodSwarm: { group: "emplaced", watch: "step", act: "swarm", hp: 0, spot: 0, counter: { dv: 21, min: 5 }, node: 10, once: true },
  tanglefoot: { group: "environmental", watch: "step", act: "tangle", hp: 20, spot: 17, counter: { dv: 13, min: 1 }, node: 8, slow: "1d6" },
  electric: { group: "environmental", watch: "step", act: "shock", hp: 20, spot: 17, counter: { dv: 13, min: 1 }, node: 8, damage: "6d6", repeats: true },
  laser: { group: "environmental", watch: "step", act: "laser", hp: 0, spot: 17, counter: { dv: 17, min: 5 }, node: 8, damage: "4d6", dodge: { skill: "Contortionist", dv: 17 } },
  tipFloor: { group: "environmental", watch: "step", act: "pit", hp: 0, spot: 17, counter: { dv: 13, min: 1 }, node: 8, depth: 6, damage: "6d6" },
  goop: { group: "environmental", watch: "step", act: "tangle", hp: 10, spot: 17, counter: { dv: 13, min: 1 }, node: 8, slow: "2d6" },
  punchers: { group: "environmental", watch: "step", act: "punch", hp: 20, spot: 17, counter: { dv: 13, min: 5 }, node: 8, damage: "6d6" },
  slipFloor: { group: "environmental", watch: "step", act: "slip", hp: 10, spot: 17, counter: { dv: 13, min: 1 }, node: 8 },
  stunPanel: { group: "environmental", watch: "near", act: "stun", hp: 5, range: 2, spot: 17, counter: { dv: 13, min: 1 }, node: 8 },
  sleepGas: { group: "environmental", watch: "step", act: "gas", hp: 60, spot: 17, counter: { dv: 17, min: 5 }, node: 10, repeats: true }
};

export const KIND_IDS = Object.keys(KINDS);
export const kindOf = (k) => (KINDS[k] ? k : "camera");

const num = (v, fallback, { min = 0, max = Infinity } = {}) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const ids = (list) => [...new Set((Array.isArray(list) ? list : []).map(String).filter(Boolean))];

/** A device as stored, with everything its kind leaves unsaid filled in. Null for no device. */
export function cleanDevice(raw) {
  if (!raw || !KINDS[raw.kind]) return null;
  const k = KINDS[raw.kind];
  const hpMax = num(raw.hpMax, k.hp);
  return {
    kind: raw.kind,
    name: String(raw.name ?? "").trim(),
    on: raw.on !== false,
    hpMax,
    hp: num(raw.hp, hpMax, { max: hpMax || Infinity }),
    range: num(raw.range, k.range ?? 0),
    angle: num(raw.angle, k.angle ?? 360, { min: 5, max: 360 }),
    traverse: k.watch === "cone" ? num(raw.traverse, k.traverse ?? 0, { max: 360 }) : 0,
    // While it follows someone: where it rests (the Tile's rotation is where it points now) and who.
    home: raw.home === null || raw.home === undefined || !Number.isFinite(Number(raw.home)) ? null : Number(raw.home),
    lock: String(raw.lock ?? ""),
    node: num(raw.node, k.node),
    weapon: WEAPONS[raw.weapon] ? raw.weapon : k.weapon ?? "",
    depth: num(raw.depth, k.depth ?? 0),
    spikes: !!raw.spikes,
    passes: ids(raw.passes),
    controllers: ids(raw.controllers),
    spent: !!raw.spent
  };
}

/** Is a device doing its job: switched on, not destroyed, not a one-shot already fired? */
export const working = (d) => !!d && d.on && !(d.hpMax > 0 && d.hp <= 0) && !d.spent;

/** Does it leave this character alone: they carry a pass, or have taken its Control Node? */
export const friendly = (d, actorId) => !!actorId && (d.passes.includes(String(actorId)) || d.controllers.includes(String(actorId)));

/** May this character look through it or switch it: they carry a pass or run its node. */
export const hasAccess = friendly;

/* ---------------------------------------- */
/*  Geometry                                */
/* ---------------------------------------- */

/** The unit vector a rotation looks along. 0 looks down the map (as a token's), turning clockwise. */
export function facing(rotation = 0) {
  const a = ((Number(rotation) || 0) + 90) * (Math.PI / 180);
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** Is a point inside a field of view from an origin (walls aside)? */
export function inCone(origin, rotation, angle, radius, p) {
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist > radius) return false;
  if (angle >= 360 || dist === 0) return true;
  const f = facing(rotation);
  const cos = (dx * f.x + dy * f.y) / dist;
  return cos >= Math.cos((angle / 2) * (Math.PI / 180)) - 1e-9;
}

/** The outline of a field of view, for drawing where no wall-aware one is to be had: [x0, y0, x1, y1, ...]. */
export function conePoints(origin, rotation, angle, radius, steps = 24) {
  const mid = ((Number(rotation) || 0) + 90) * (Math.PI / 180);
  const half = (Math.min(360, angle) / 2) * (Math.PI / 180);
  const pts = angle >= 360 ? [] : [origin.x, origin.y];
  for (let i = 0; i <= steps; i += 1) {
    const a = mid - half + (2 * half * i) / steps;
    pts.push(origin.x + Math.cos(a) * radius, origin.y + Math.sin(a) * radius);
  }
  return pts;
}

/** An angle as -180..180, and as 0..360. */
export const signed = (deg) => ((((Number(deg) || 0) + 180) % 360) + 360) % 360 - 180;
export const wrap = (deg) => (((Number(deg) || 0) % 360) + 360) % 360;

/** The rotation that looks from an origin straight at a point. */
export function bearing(origin, p) {
  return wrap(Math.atan2(p.y - origin.y, p.x - origin.x) * (180 / Math.PI) - 90);
}

/** As near a wanted rotation as a mount gets: within half its traverse either side of where it rests. */
export function swing(home, want, traverse) {
  if (traverse >= 360) return wrap(want);
  const half = Math.max(0, Number(traverse) || 0) / 2;
  return wrap(home + Math.min(half, Math.max(-half, signed(want - home))));
}

/** A tile's middle. */
export const centreOf = (t) => ({ x: t.x + t.width / 2, y: t.y + t.height / 2 });

/** Is a point on a tile, or within a margin (px) of it? */
export function onPad(tile, p, margin = 0) {
  return p.x >= tile.x - margin && p.x <= tile.x + tile.width + margin && p.y >= tile.y - margin && p.y <= tile.y + tile.height + margin;
}

/**
 * Does a device notice someone standing at a point? "cone" kinds are asked through `sees`, which
 * knows the walls (the caller's); the rest by where the point is.
 * @param {object} tile - { x, y, width, height, rotation }
 * @param {object} d - the clean device
 * @param {{x,y}} p - the token's middle
 * @param {object} grid - { size (px a square), distance (m a square) }
 * @param {(origin, rotation, angle, radius, p) => boolean} [sees]
 */
export function notices(tile, d, p, grid, sees = inCone) {
  const k = KINDS[d.kind];
  const px = (m) => (m / (grid.distance || 2)) * (grid.size || 100);
  if (k.watch === "cone") return sees(centreOf(tile), tile.rotation ?? 0, d.angle, px(d.range), p);
  if (k.watch === "near") return onPad(tile, p, px(d.range));
  return onPad(tile, p);
}

/* ---------------------------------------- */
/*  What happens                            */
/* ---------------------------------------- */

/** An attack against a DV or a defence roll: the attacker has to beat it. */
export const beats = (attack, defence) => Number(attack) > Number(defence);

/**
 * What a device's act asks of whoever set it off, before anything is applied:
 *   { check: { skill, dv } | null (they roll it from the card), auto: true (no roll to make),
 *     damage, armor, ablate, direct, slow, conditions, fail }
 * A check passed means nothing happens, unless `always` says what happens anyway.
 */
export function effectOf(d, { grapple = false, meat = true } = {}) {
  const k = KINDS[d.kind];
  switch (k.act) {
    case "tangle":
      return { slow: k.slow };
    case "shock":
      // 2070: armor takes it down but isn't worn away by it.
      return { damage: k.damage, armor: true, ablate: false };
    case "punch":
      return { damage: k.damage, armor: true, ablate: true };
    case "laser":
      return { check: { ...k.dodge }, damage: k.damage, armor: true, ablate: true };
    case "pit":
      return grapple ? { saved: "grapple" } : { check: { skill: "Athletics", dv: 15 }, fall: d.depth, damage: d.spikes ? k.damage : "", armor: true, ablate: true, conditions: ["prone"] };
    case "slip":
      return { check: { skill: "Athletics", dv: 15 }, conditions: ["prone"] };
    case "stun":
      return { check: { skill: "Resist Torture/Drugs", dv: 15 }, conditions: ["damagedEye", "damagedEar"], minutes: 1 };
    case "swarm":
      return meat ? { check: { skill: "Resist Torture/Drugs", dv: 15 }, damage: "3d6", direct: true } : { saved: "chrome" };
    case "gas":
      return { check: { skill: "Resist Torture/Drugs", dv: 13 }, conditions: ["unconscious"] };
    default:
      return {};
  }
}

/** The DV a turret's shot faces: its gun's range table at that distance, by the caller's lookup (null: out of range). */
export const weaponOf = (d) => WEAPONS[d.weapon] ?? WEAPONS.assaultRifle;

/** The names cameras and turrets go by when the GM gave none: "CAM 02". */
export function label(d, index = 0) {
  if (d.name) return d.name;
  const short = { camera: "CAM", turret: "TUR", melee: "BLADE" }[d.kind];
  return short ? `${short} ${String(index + 1).padStart(2, "0")}` : "";
}
