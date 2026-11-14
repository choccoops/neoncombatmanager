/**
 * The movement ruler's rules, pure (tests import it): how far a character can go this Turn, and
 * which band each metre of a path falls in.
 *
 * 2070 Core Rules Ch07 (Movement, Actions): a Move Action is MOVE × 2 m/yds; Run is a second Move
 * Action, taken with the Action, only after the first. Prone, you can't move until you Get Up; a
 * Grappled defender can't use their Move Action. Climbing and swimming cost double (the GM's call).
 */

export const BANDS = ["move", "run", "over"];

/** The ruler's colours (the module's palette): within the Move Action, with a Run, out of reach. */
export const COLORS = { move: 0x05d9e8, run: 0xf3e600, over: 0xff2a6d, history: 0x7a7a8c };

/**
 * How far a character gets this Turn, in m/yds: { move, run, why }.
 * @param {number} MOVE - the character's MOVE now (conditions included)
 * @param {object} [ctx] - { prone, grappled, noMove } (noMove: a lost Move Action, e.g. Damaged Ear)
 */
export function reach(MOVE, { prone = false, grappled = false, noMove = false } = {}) {
  const step = Math.max(0, Number(MOVE) || 0) * 2;
  if (prone) return { move: 0, run: 0, why: "prone" };
  if (grappled) return { move: 0, run: 0, why: "grappled" };
  // A lost Move Action leaves the Run (the Action) as the only way to move.
  if (noMove) return { move: 0, run: step, why: "noMove" };
  return { move: step, run: step * 2, why: null };
}

/**
 * May a token make this move, pure: { ok, left, over, why }.
 * Movement is held to what the character can cover this Turn (Move Action plus a Run) while it
 * is their Turn in a fight; out of their Turn, out of a fight, and for a GM, nothing is held.
 * @param {object} o - walked: metres already walked this Turn; step: this move's metres;
 *   r: reach ({ move, run, why }); mode: "off" | "warn" | "block"; gm; ownTurn
 * @returns {{ ok: boolean, warn: boolean, left: number, over: number, why: string|null }}
 *   left: metres still to go before this move; over: how far past them this move ends
 */
export function moveCheck({ walked = 0, step = 0, r = { move: Infinity, run: Infinity, why: null }, mode = "block", gm = false, ownTurn = false } = {}) {
  const left = Math.max(0, r.run - (Number(walked) || 0));
  const over = Math.max(0, (Number(walked) || 0) + (Number(step) || 0) - r.run);
  const past = ownTurn && mode !== "off" && over > 1e-6 && Number.isFinite(r.run);
  return { ok: !past || gm || mode === "warn", warn: past, left, over, why: r.why ?? null };
}

/** The combatant flag a Run is taken on: { round } (the Round it was taken in). */
export const RUN_FLAG = "run";

/** Has this combatant taken a Run this Turn, pure: the flag says this Round. */
export const ranThisTurn = (flag, round) => !!flag && Number(flag.round) === Number(round);

/**
 * What a character can cover until they take a Run, pure: the Move Action only. A Run is a
 * second Move Action taken with the Action, so its distance opens once it's taken (the Action
 * HUD's Run button). With no Move Action this Turn, nothing until the Run.
 */
export function reachTaken(r, ran) {
  return ran ? r : { ...r, run: r.move };
}

/** The band a distance falls in. */
export function bandOf(distance, r) {
  const d = Number(distance) || 0;
  if (d <= r.move + 1e-6) return "move";
  if (d <= r.run + 1e-6) return "run";
  return "over";
}

/**
 * A path's legs with running totals: [{ from, to, distance, start, end, band }], where start and
 * end are the metres walked before and after the leg (history included), and band is the leg's
 * end. `measure(a, b)` is the grid's distance between two points.
 * @param {object[]} points - the path, history first: [{ x, y }]
 * @param {number} already - metres walked before the first point
 */
export function legs(points, measure, r, already = 0) {
  const out = [];
  let total = Number(already) || 0;
  for (let i = 1; i < points.length; i++) {
    const distance = measure(points[i - 1], points[i]);
    out.push({ from: points[i - 1], to: points[i], distance, start: total, end: total + distance, band: bandOf(total + distance, r) });
    total += distance;
  }
  return out;
}

/**
 * The grid squares a path crosses, in order, with the distance walked at each and its band:
 * [{ x, y, distance, band }] (x, y: the square's centre). Squares are sampled along each leg, so
 * a diagonal leg lights the squares it passes, as Drag Ruler's did.
 * @param {object} grid - { size } in pixels
 */
export function squaresAlong(points, measure, r, grid, already = 0) {
  const seen = new Set();
  const out = [];
  const centre = (p) => ({ x: (Math.floor(p.x / grid.size) + 0.5) * grid.size, y: (Math.floor(p.y / grid.size) + 0.5) * grid.size });
  let walked = Number(already) || 0;
  let last = points[0] ? centre(points[0]) : null;
  if (last) seen.add(`${last.x},${last.y}`);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (grid.size / 4)));
    for (let s = 1; s <= steps; s++) {
      const c = centre({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps });
      const key = `${c.x},${c.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      walked += measure(last, c);
      last = c;
      out.push({ ...c, distance: walked, band: bandOf(walked, r) });
    }
  }
  return out;
}

/** The ruler's label: "6 m · Move", "14 m · Run", "22 m · out of reach (16 m)". */
export function label(distance, r, { unit = "m", words = { move: "Move", run: "Run", over: "out of reach" } } = {}) {
  const d = Math.round((Number(distance) || 0) * 10) / 10;
  const band = bandOf(d, r);
  const max = Math.max(r.move, r.run);
  return band === "over" ? `${d} ${unit} · ${words.over} (${max} ${unit})` : `${d} ${unit} · ${words[band]}`;
}
