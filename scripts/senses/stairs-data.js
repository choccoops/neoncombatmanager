/**
 * Ways, pure (tests import it): stairs, ladders and doors.
 *
 * Two Tiles linked as the two ends of a way between two places: the foot of a staircase on one
 * floor and its head on the next, a ladder and the roof it reaches, a door and the room behind
 * it drawn elsewhere on the map. A token standing on one end can be put on the other. Each tile
 * carries the link as a flag: { to: the other tile's id, kind }.
 */
export const STAIRS_FLAG = "stairs";
export const KINDS = ["stairs", "ladder", "door"];
export const KIND_ICON = { stairs: "fa-solid fa-stairs", ladder: "fa-solid fa-water-ladder", door: "fa-solid fa-door-open" };
export const kindOf = (k) => (KINDS.includes(k) ? k : "stairs");

/**
 * Is a token on a tile (its rectangle; rotation isn't counted)? Its middle is on the tile, or,
 * for a tile smaller than the token (a ladder, a hatch, a tile set off the grid), the tile's
 * middle is under the token.
 * @param {object} tile - { x, y, width, height }
 * @param {{x,y}} p - the token's middle
 * @param {{w,h}} [size] - the token's size in px
 */
export function onTile(tile, p, size = null) {
  if (!tile || !p) return false;
  if (p.x >= tile.x && p.x <= tile.x + tile.width && p.y >= tile.y && p.y <= tile.y + tile.height) return true;
  if (!size) return false;
  const cx = tile.x + tile.width / 2;
  const cy = tile.y + tile.height / 2;
  return Math.abs(cx - p.x) <= size.w / 2 && Math.abs(cy - p.y) <= size.h / 2;
}

/**
 * The way a token standing here can take: the linked tile it's on (the nearest, with several)
 * and its far end. Null when it stands on none, or the far end is gone.
 * @param {object[]} tiles - [{ id, x, y, width, height, to, kind }]
 * @param {{x,y}} p - the token's middle
 * @param {{w,h}} [size] - the token's size in px
 * @returns {{ from: object, to: object }|null}
 */
export function wayAt(tiles = [], p, size = null) {
  const mid = (t) => Math.hypot(t.x + t.width / 2 - p.x, t.y + t.height / 2 - p.y);
  const on = tiles.filter((t) => t.to && onTile(t, p, size)).sort((a, b) => mid(a) - mid(b));
  for (const t of on) {
    const far = tiles.find((x) => x.id === t.to);
    if (far) return { from: t, to: far };
  }
  return null;
}

/**
 * The way a move takes by itself (the automatic mode): the linked tile it steps onto, coming
 * from off it. Null when the move stays on the same tile, leaves it, or the far end is gone.
 * @param {{x,y}|null} from - where the token's middle was (null: unknown, taken as off any tile)
 * @param {{x,y}} to - where it is now
 */
export function wayTaken(tiles = [], from, to, size = null) {
  for (const t of tiles) {
    if (!t.to || !onTile(t, to, size) || (from && onTile(t, from, size))) continue;
    const far = tiles.find((x) => x.id === t.to);
    if (far) return { from: t, to: far };
  }
  return null;
}

/** Where a token (w × h px) is put so that it stands in the middle of a tile. */
export const landing = (tile, w, h) => ({ x: Math.round(tile.x + tile.width / 2 - w / 2), y: Math.round(tile.y + tile.height / 2 - h / 2) });
