/**
 * When things happen inside JB2A's clips, pure (tests import it). Automated Animations and
 * Sequencer start a clip and know nothing of what it shows: an arrow is drawn for most of a second
 * before it leaves the bow, a bullet takes longer to cross 30 squares than 3, a sword's swing lands
 * a second in. Sounds and hits are placed by these numbers.
 *
 * Measured frame by frame from JB2A's files (free and Patreon; a look's colours share their
 * timing): the frame the projectile leaves the shooter and the frame its leading edge reaches the
 * target, for each of the five clips a ranged look has. Milliseconds from the clip's start.
 */

/** The clips of a ranged look, nearest first, and the distance in squares each is used from (Sequencer's rule). */
export const RANGE_STEPS = [0, 2, 5, 9, 15];

/** Which of a look's five clips Sequencer plays for a distance in grid squares. */
export function rangeStep(squares) {
  const d = Number(squares) || 0;
  let i = 0;
  for (let k = 0; k < RANGE_STEPS.length; k++) if (d >= RANGE_STEPS[k]) i = k;
  return i;
}

/**
 * Ranged looks: { launch, arrive: [5ft, 15ft, 30ft, 60ft, 90ft clip] }. `launch` is when the round
 * leaves (the shot's sound), `arrive` when it gets there (the hit and its sound).
 */
export const FLIGHT = {
  bullet1: { launch: 0, arrive: [70, 230, 400, 570, 730] },
  bullet2: { launch: 0, arrive: [30, 200, 370, 530, 700] },
  bullet3: { launch: 0, arrive: [30, 300, 470, 630, 800] },
  lasershot: { launch: 0, arrive: [70, 170, 270, 470, 600] },
  // A sniper's shot is a line: it's there at once.
  snipe: { launch: 30, arrive: [30, 70, 70, 70, 70] },
  // Arrows are nocked and drawn first.
  arrow: { launch: 330, arrive: [430, 600, 600, 770, 1100] },
  arrowPhysical: { launch: 750, arrive: [770, 930, 1100, 1270, 1430] },
  // A thrown blade: the wind-up, then the throw (no 5 ft clip: the 15 ft one plays).
  dagger: { launch: 500, arrive: [800, 800, 900, 1070, 1230] },
  // Lobbed: the wind-up is most of it.
  bomb: { launch: 1100, arrive: [1250, 1600, 2000, 2870, 3270] },
  flask: { launch: 1100, arrive: [1270, 1600, 2000, 2870, 3270] },
  grenade: { launch: [1450, 1750, 2000, 2000, 1950], arrive: [1740, 2170, 2570, 3500, 3840] },
  grenadelaunch: { launch: 130, arrive: [230, 570, 1000, 1870, 2270] }
};

/** The FLIGHT key for an AA look ({ animation, variant }) or a Sequencer database path. */
export function flightKey(look) {
  if (typeof look === "string") {
    const p = look.toLowerCase();
    if (p.includes("throw.grenade")) return "grenade";
    if (p.includes("launch.grenade")) return "grenadelaunch";
    if (p.includes("throw.flask")) return "flask";
    if (p.includes("throw.bomb")) return "bomb";
    if (p.includes("lasershot")) return "lasershot";
    if (p.includes("snipe")) return "snipe";
    const b = /bullet\.0?([123])/.exec(p);
    if (b) return `bullet${b[1]}`;
    return p.includes("bullet") ? "bullet1" : null;
  }
  const a = String(look?.animation ?? "");
  if (a === "bullet") return `bullet${Number(look.variant) || 1}`;
  if (a === "arrow") return look.variant === "regular" ? "arrow" : "arrowPhysical";
  return FLIGHT[a] ? a : null;
}

/**
 * When a ranged look's round leaves and arrives over a distance.
 * @param {object|string} look - an AA look or a Sequencer path
 * @param {number} squares - shooter to target, in grid squares
 * @returns {{ launch: number, arrive: number }} ms; zeros for a look that isn't timed
 */
export function flightFor(look, squares) {
  const f = FLIGHT[flightKey(look)];
  if (!f) return { launch: 0, arrive: 0 };
  const i = rangeStep(squares);
  const launch = Array.isArray(f.launch) ? f.launch[i] : f.launch;
  return { launch, arrive: Math.max(launch, f.arrive[i]) };
}

/** Squares between two canvas points. */
export const squaresBetween = (a, b, gridSize) => (a && b && gridSize ? Math.hypot(b.x - a.x, b.y - a.y) / gridSize : 0);

/** Melee looks: when the swing connects. */
export const MELEE_CONTACT = { dagger: 900, sword: 930, greatsword: 1600, club: 1300, warhammer: 1300, lasersword: 1100, unarmedstrike: 700 };

export const contactFor = (look) => MELEE_CONTACT[String(look?.animation ?? "")] ?? 0;

/**
 * How far into a melee sound its hit is (ms): the sound starts that much before the swing lands.
 * A monoblade's hum builds before the cut.
 */
export const SOUND_LEAD = { blade: 90, blunt: 80, monoblade: 600 };

/** An explosion blooms a moment after its clip starts: start it this much before the round lands. */
export const BLOOM_LEAD = 100;
