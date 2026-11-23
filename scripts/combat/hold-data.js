/**
 * Holds, pure (tests import it): a Grapple that the map knows about.
 *
 * Whoever wins a Grab holds the other: the held token is carried along when the holder moves,
 * and held up as a Human Shield it takes the ranged attacks aimed at the holder.
 * The held token carries the record (a flag): { id (the holder's token), dx, dy (where it's
 * held, from the holder's corner), shield }.
 */
export const HOLD_FLAG = "heldBy";

/** Near enough to grab: next to each other (a square, a diagonal included). */
export const inReach = (distance, square = 2) => Number(distance) <= Math.max(2, Number(square) || 2);

/** Where the held token goes when its holder stands at (x, y). */
export const carriedTo = (holder, hold) => ({ x: Math.round(holder.x + (Number(hold?.dx) || 0)), y: Math.round(holder.y + (Number(hold?.dy) || 0)) });

/**
 * Ranged attacks at someone behind a Human Shield go to the shield.
 * @param {string[]} ids - the token ids targeted
 * @param {Record<string,string>} shields - holder's token id -> the id of the token held up
 * @returns {{ ids: string[], swapped: {holder: string, shield: string}[] }}
 */
export function redirect(ids = [], shields = {}) {
  const out = [];
  const swapped = [];
  for (const id of ids) {
    const shield = shields[id];
    if (shield) swapped.push({ holder: id, shield });
    const to = shield ?? id;
    if (!out.includes(to)) out.push(to);
  }
  return { ids: out, swapped };
}
