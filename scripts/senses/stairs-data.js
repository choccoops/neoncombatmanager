/**
 * Stairs and ladders, pure (tests import it).
 *
 * Two Tiles linked as a way between two places: the foot of a staircase on one floor and its
 * head on the next, a ladder and the roof it reaches. A token that steps onto one is put on the
 * other. Each tile carries the link as a flag: { to: the other tile's id }.
 */
export const STAIRS_FLAG = "stairs";

/** Is a point on a tile (its rectangle; rotation isn't counted)? */
export const onTile = (tile, p) => !!tile && !!p && p.x >= tile.x && p.x <= tile.x + tile.width && p.y >= tile.y && p.y <= tile.y + tile.height;

/**
 * The way a move takes: the linked tile it steps onto, coming from off it. Null when the move
 * stays on the same tile, leaves it, or the far end is gone.
 * @param {object[]} tiles - [{ id, x, y, width, height, to }] (to: the linked tile's id, or null)
 * @param {{x,y}|null} from - where the token's middle was (null: unknown, taken as off any tile)
 * @param {{x,y}} to - where it is now
 * @returns {{ from: object, to: object }|null}
 */
export function wayTaken(tiles = [], from, to) {
  for (const t of tiles) {
    if (!t.to || !onTile(t, to) || (from && onTile(t, from))) continue;
    const far = tiles.find((x) => x.id === t.to);
    if (far) return { from: t, to: far };
  }
  return null;
}

/** Where a token (w × h px) is put so that it stands in the middle of a tile. */
export const landing = (tile, w, h) => ({ x: Math.round(tile.x + tile.width / 2 - w / 2), y: Math.round(tile.y + tile.height / 2 - h / 2) });
