/**
 * Linked areas, pure (tests import it).
 *
 * One map often has to hold places that are far apart: the rooftop a sniper lies on, drawn beside
 * the plaza it overlooks 300 m away. The GM marks each place as a Region and links two of them
 * with the distance that really lies between them. From then on:
 *   - someone in one, looking through a scope that sees that far, sees into the other;
 *   - an attack from one into the other is made at the linked distance, not at however many
 *     squares apart the two were drawn.
 *
 * A link: { id, a, b, distance, both } (a, b: Region ids; both: it works from b to a too).
 */

/** Is a point inside a Region's shapes (holes cut out)? Rectangles, ellipses, circles, polygons. */
export function inShapes(shapes = [], p) {
  let inside = false;
  for (const s of shapes ?? []) {
    let hit = false;
    if (s.type === "rectangle") hit = p.x >= s.x && p.x <= s.x + s.width && p.y >= s.y && p.y <= s.y + s.height;
    else if (s.type === "ellipse") hit = s.radiusX > 0 && s.radiusY > 0 && ((p.x - s.x) / s.radiusX) ** 2 + ((p.y - s.y) / s.radiusY) ** 2 <= 1;
    else if (s.type === "circle") hit = Math.hypot(p.x - s.x, p.y - s.y) <= s.radius;
    else if (s.type === "polygon") {
      const pts = s.points ?? [];
      for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
        const [xi, yi, xj, yj] = [pts[i], pts[i + 1], pts[j], pts[j + 1]];
        if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) hit = !hit;
      }
    }
    if (!hit) continue;
    if (s.hole) return false;
    inside = true;
  }
  return inside;
}

/** The box around a Region's shapes: { x, y, width, height, cx, cy, r } (r: from its middle to a corner). Null with none. */
export function boundsOf(shapes = []) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const grow = (x, y) => {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  };
  for (const s of shapes ?? []) {
    if (s.hole) continue;
    if (s.type === "rectangle") {
      grow(s.x, s.y);
      grow(s.x + s.width, s.y + s.height);
    } else if (s.type === "ellipse") {
      grow(s.x - s.radiusX, s.y - s.radiusY);
      grow(s.x + s.radiusX, s.y + s.radiusY);
    } else if (s.type === "circle") {
      grow(s.x - s.radius, s.y - s.radius);
      grow(s.x + s.radius, s.y + s.radius);
    } else if (s.type === "polygon") for (let i = 0; i + 1 < (s.points ?? []).length; i += 2) grow(s.points[i], s.points[i + 1]);
  }
  if (!Number.isFinite(x0)) return null;
  const width = x1 - x0;
  const height = y1 - y0;
  return { x: x0, y: y0, width, height, cx: x0 + width / 2, cy: y0 + height / 2, r: Math.hypot(width, height) / 2 };
}

/**
 * The links that lead out of the areas someone stands in: [{ link, from, to }] (Region ids).
 * A two-way link leads out of either end.
 */
export function linksFrom(links = [], here = []) {
  const out = [];
  for (const l of links ?? []) {
    if (here.includes(l.a)) out.push({ link: l, from: l.a, to: l.b });
    else if (l.both && here.includes(l.b)) out.push({ link: l, from: l.b, to: l.a });
  }
  return out;
}

/** The link between where one stands and where another does (the shortest, with several), or null. */
export function linkBetween(links = [], here = [], there = []) {
  const found = linksFrom(links, here).filter((x) => there.includes(x.to));
  if (!found.length) return null;
  return found.sort((x, y) => x.link.distance - y.link.distance)[0];
}

/** Does someone see across a link: as far as their eyes reach unaided, or their scope does. */
export const seesAcross = ({ distance = 0, eye = 50, scope = 0 } = {}) => Math.max(Number(eye) || 0, Number(scope) || 0) >= Number(distance);

/** A link as the GM gave it, tidied: null when it isn't one. */
export function cleanLink(l) {
  const distance = Math.round(Number(l?.distance));
  if (!l?.a || !l?.b || l.a === l.b || !(distance > 0)) return null;
  return { id: String(l.id ?? `${l.a}:${l.b}`), a: String(l.a), b: String(l.b), distance, both: l.both !== false };
}
