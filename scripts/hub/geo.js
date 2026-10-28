/**
 * The City & NCART hub's map rules, pure (tests import them): where a point is, how far, how long
 * (the 2070 Core Rules' Travel Times, Ch.11), rush hour, and NCART routes.
 *
 * Positions are in the city map's world grid (1294 x 2000; see data.js).
 */
import { NC2070 } from "./data.js";

/** World units per km: Night City is about 20 km from Northside to the Occupied Zone. */
export const UNITS_PER_KM = 60;
/** Streets wind: a trip on foot or wheels is longer than the straight line. */
export const WINDING = 1.3;

/* -------------------------------------------- */
/*  Where                                       */
/* -------------------------------------------- */

export function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The district (or the land outside them) at a point: a district from data.js, or
 * { code: null, name: "Laguna Bend" | "The Badlands", ...its NCZTA-70 entry }.
 * Earlier districts win where hand-drawn shapes overlap, as on the map.
 */
export function districtAt(x, y, data = NC2070) {
  const d = data.districts.find((dd) => inPoly(x, y, dd.poly));
  if (d) return d;
  const lake = data.laguna;
  const out = Math.hypot(x - lake.x, y - lake.y) <= lake.r ? "Laguna Bend" : "The Badlands";
  return { code: null, ...data.outside.find((o) => o.name === out) };
}

export function districtByCode(code, data = NC2070) {
  return data.districts.find((d) => d.code === code) ?? null;
}

/** km between two world points, as the crow flies. */
export function km(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y) / UNITS_PER_KM;
}

/** Stations nearest a point, open ones only unless asked: [{ id, station, km }]. */
export function nearestStations(p, { count = 2, open = true, data = NC2070 } = {}) {
  return Object.entries(data.stations)
    .filter(([, s]) => !open || !s.status)
    .map(([id, s]) => ({ id, station: s, km: km(p, s) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, count);
}

/* -------------------------------------------- */
/*  How long (Core Ch.11, How It Takes)         */
/* -------------------------------------------- */

/**
 * Door-to-door minutes by trip length, from the Travel Times table (in-city averages, normal
 * traffic). Between the rows the time is interpolated; past the last row it carries on at that
 * row's pace.
 */
export const TRAVEL = {
  walk: [[1.5, 20], [4, 60], [8, 120], [20, 270]],
  skates: [[1.5, 10], [4, 25], [8, 45], [20, 90]],
  bike: [[1.5, 5], [4, 15], [8, 30], [20, 75], [30, 120]],
  car: [[1.5, 10], [4, 15], [8, 25], [20, 45], [30, 60]],
  av: [[1.5, 5], [4, 5], [8, 10], [20, 15], [30, 20]]
};
export const MODES = ["walk", "skates", "bike", "ncart", "car", "av"];

export function interp(table, x) {
  // A short hop still takes a third of the shortest row (getting going, parking).
  if (x <= table[0][0]) return Math.max(table[0][1] / 3, (table[0][1] * x) / table[0][0]);
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  const [x0, y0] = table.at(-2);
  const [x1, y1] = table.at(-1);
  return y1 + ((y1 - y0) / (x1 - x0)) * (x - x1);
}

/** Rush hour (Core Ch.11): 07-09 and 17-19, plus Arroyo's shift changes at 06, 14 and 22. */
export function rushHour(hour, { arroyo = false } = {}) {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  if ((h >= 7 && h < 9) || (h >= 17 && h < 19)) return true;
  return arroyo && [6, 14, 22].includes(h);
}

/**
 * Minutes for a trip of `distance` km (road distance) by a mode. Cars double in rush hour (a
 * motorcycle filters through: x1.5); a jam doubles, gridlock triples.
 * @param {object} o - rush, moto, jam ("jam"|"gridlock"), storm (doubles everything on the ground)
 */
export function travelMinutes(mode, distance, { rush = false, moto = false, jam = null, storm = false } = {}) {
  if (!TRAVEL[mode]) return null;
  let m = interp(TRAVEL[mode], distance);
  if (mode === "car") {
    if (rush) m *= moto ? 1.5 : 2;
    if (jam === "gridlock") m *= 3;
    else if (jam === "jam") m *= 2;
  }
  if (storm && mode !== "av") m *= 2;
  return Math.max(1, Math.round(m));
}

/** "45 min", "1 h 20 min", "6 h". */
export function formatMinutes(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/* -------------------------------------------- */
/*  NCART                                       */
/* -------------------------------------------- */

/** Minutes on NCART: the wait for the first train, each stop, each change of line. */
export const NCART = { wait: 5, stop: 3, transfer: 5 };

/** In-service track: { station: [{ to, line }] }. Closed, planned, suspended and unbuilt track is left out. */
export function ncartGraph(data = NC2070) {
  const g = {};
  const add = (a, b, line) => {
    (g[a] ??= []).push({ to: b, line });
    (g[b] ??= []).push({ to: a, line });
  };
  for (const [lid, line] of Object.entries(data.lines)) {
    for (const seg of line.segs ?? []) for (let i = 1; i < seg.length; i++) add(seg[i - 1], seg[i], lid);
  }
  return g;
}

/**
 * The quickest NCART ride between two stations (Dijkstra over [station, line] states).
 * @returns {{ minutes, stops, legs: [{ line, from, to, stations: [] }], transfers } | null}
 */
export function ncartRoute(from, to, data = NC2070) {
  const g = ncartGraph(data);
  if (!g[from] || !g[to]) return null;
  if (from === to) return { minutes: 0, stops: 0, legs: [], transfers: 0 };
  const key = (s, l) => `${s}|${l}`;
  const dist = new Map();
  const prev = new Map();
  const queue = [];
  for (const e of g[from]) {
    const k = key(e.to, e.line);
    const t = NCART.wait + NCART.stop;
    if (t < (dist.get(k) ?? Infinity)) {
      dist.set(k, t);
      prev.set(k, key(from, e.line));
      queue.push([t, e.to, e.line]);
    }
  }
  let best = null;
  while (queue.length) {
    queue.sort((a, b) => a[0] - b[0]);
    const [t, s, l] = queue.shift();
    if (t > (dist.get(key(s, l)) ?? Infinity)) continue;
    if (s === to) {
      best = key(s, l);
      break;
    }
    for (const e of g[s]) {
      const nt = t + NCART.stop + (e.line === l ? 0 : NCART.transfer);
      const k = key(e.to, e.line);
      if (nt < (dist.get(k) ?? Infinity)) {
        dist.set(k, nt);
        prev.set(k, key(s, l));
        queue.push([nt, e.to, e.line]);
      }
    }
  }
  if (!best) return null;
  // Walk back: [station, line] pairs from the end.
  const path = [];
  for (let k = best; k; k = prev.get(k)) {
    const [s, l] = k.split("|");
    path.unshift({ station: s, line: l === "null" ? null : l });
    if (s === from) break;
  }
  const legs = [];
  for (let i = 1; i < path.length; i++) {
    const { station, line } = path[i];
    const last = legs.at(-1);
    if (last && last.line === line) {
      last.to = station;
      last.stations.push(station);
    } else legs.push({ line, from: path[i - 1].station, to: station, stations: [path[i - 1].station, station] });
  }
  const stops = legs.reduce((n, l) => n + l.stations.length - 1, 0);
  return { minutes: Math.round(dist.get(best)), stops, legs, transfers: Math.max(0, legs.length - 1) };
}

/**
 * A door-to-door NCART trip between two points: walk to the best nearby station, ride, walk on.
 * @returns {{ minutes, ride, board, alight, walkIn, walkOut } | null} null when walking is quicker
 *   or no station is in reach
 */
export function ncartTrip(a, b, data = NC2070) {
  let best = null;
  for (const s1 of nearestStations(a, { count: 3, data })) {
    for (const s2 of nearestStations(b, { count: 3, data })) {
      const ride = ncartRoute(s1.id, s2.id, data);
      if (!ride || !ride.legs.length) continue;
      const walkIn = travelMinutes("walk", s1.km * WINDING);
      const walkOut = travelMinutes("walk", s2.km * WINDING);
      const minutes = walkIn + ride.minutes + walkOut;
      if (!best || minutes < best.minutes) best = { minutes, ride, board: s1.id, alight: s2.id, walkIn, walkOut };
    }
  }
  if (!best) return null;
  const walk = travelMinutes("walk", km(a, b) * WINDING);
  return best.minutes < walk ? best : null;
}

/* -------------------------------------------- */
/*  A trip                                      */
/* -------------------------------------------- */

/** Ratings a route warns about. */
export const DANGER = ["combat", "extraterritorial", "occupied"];

/**
 * Districts a straight route passes through, in order (sampled), each once.
 * @returns {object[]} districts (or outside areas)
 */
export function districtsAlong(a, b, data = NC2070, samples = 40) {
  const out = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const d = districtAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, data);
    const id = d.code ?? d.name;
    if (!out.some((x) => (x.code ?? x.name) === id)) out.push(d);
  }
  return out;
}

/**
 * Everything about a trip from a to b: distance, minutes by mode, NCART, and the dangerous ground
 * on the way.
 * @param {object} o - hour (world time hour, for rush hour), storm
 */
export function plan(a, b, { hour = 12, storm = false, data = NC2070 } = {}) {
  const straight = km(a, b);
  const road = straight * WINDING;
  const along = districtsAlong(a, b, data);
  const rush = rushHour(hour, { arroyo: along.some((d) => d.code === "M") });
  const times = {};
  for (const mode of ["walk", "skates", "bike", "car", "av"]) times[mode] = travelMinutes(mode, road, { rush, storm });
  times.moto = travelMinutes("car", road, { rush, moto: true, storm });
  const ncart = ncartTrip(a, b, data);
  times.ncart = ncart?.minutes ?? null;
  const danger = along.filter((d) => DANGER.includes(d.rating) || DANGER.includes(d.second));
  return { km: Math.round(road * 10) / 10, straight: Math.round(straight * 10) / 10, rush, storm, times, ncart, along, danger };
}

/* -------------------------------------------- */
/*  Signal                                      */
/* -------------------------------------------- */

/**
 * Is there a signal at a point? Ground whose Utility Code is at or above `utility` (9: "assume
 * nothing works") is a dead zone, and so are the districts or areas named in `extra`
 * ("Q", "Laguna Bend").
 */
export function deadAt(x, y, { utility = 9, extra = [], data = NC2070 } = {}) {
  const d = districtAt(x, y, data);
  const names = extra.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  if (names.includes(String(d.code ?? "").toLowerCase()) || names.includes(String(d.name).toLowerCase())) return true;
  return !!utility && Number(d.uc) >= utility;
}
