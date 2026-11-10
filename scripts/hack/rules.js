/**
 * Quickhacking in the field (Cyberpunk: The Unification Era, Core Rules ch.10, Part 1), pure
 * (tests import it): Jack In, Breach, the quickhack's own Check, Ghost runs, getting kicked out.
 * A Check must beat what it's against; a tie fails.
 */

/** Neon At Home flags its quickhack Programs: flags["cpr-neon-at-home"].quickhack. */
export const HOME_ID = "cpr-neon-at-home";

/** Ejected (or booted any way but your own Jack Out): no hacking that person for an hour. */
export const LOCKOUT_SECONDS = 3600;

/** A name as a key: "Q-KRASH" and "q krash" are the same quickhack. */
export const hackKey = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** What a quickhack that lands leaves on the target: this module's condition, by quickhack. */
export const HACK_CONDITIONS = {
  commsjam: "qhCommsJam",
  vitalsspoof: "qhVitalsSpoof",
  popupgeddon: "qhPopupGeddon",
  impairmovement: "qhImpairMovement",
  slow: "qhSlow",
  shortcircuit: "qhShortCircuit",
  cyberwaremalfunction: "qhCyberwareMalfunction",
  rebootoptics: "qhRebootOptics",
  cripplemovement: "qhCrippleMovement",
  weaponglitch: "qhWeaponGlitch",
  limbseize: "qhLimbSeize",
  speedwarecrash: "qhSpeedwareCrash",
  sonicshock: "qhSonicShock",
  framelock: "qhFrameLock",
  qkrash: "qhQKrash",
  systemreset: "qhSystemReset",
  puppet: "qhPuppet",
  cyberpsychosis: "qhCyberpsychosis",
  // On Fire, 4 a Turn
  overheat: "onFireStrong"
};

/** Quickhacks that go straight to HP (no armor, no ablation). */
export const HACK_DAMAGE = { synapseburnout: "3d6", contagion: "1d6", totalsystemkill: "6d6" };

/** Self-ICE: Defender takes this off a quickhack's damage. */
export const DEFENDER_SOAK = 4;

const FAMILIES = ["intel", "covert", "control", "combat", "ultimate", "vehicle"];

/**
 * A quickhack Program as the flow needs it, from a Neon At Home item (or null).
 * @returns {{ id, name, key, family, dv, cooldown, quiet, needs, vehicle, condition, damage }|null}
 */
export function quickhackOf(item) {
  const f = item?.flags?.[HOME_ID]?.quickhack;
  if (!f || item.type !== "program") return null;
  const key = hackKey(item.name);
  const family = FAMILIES.includes(String(f.type ?? "").toLowerCase()) ? String(f.type).toLowerCase() : f.vehicle ? "vehicle" : "control";
  return {
    id: item.id,
    name: item.name,
    key,
    family,
    dv: Number(f.dv) || 0,
    cooldown: f.cooldown ?? 0,
    quiet: !!f.quiet,
    needs: f.needs ?? "",
    vehicle: !!f.vehicle,
    condition: HACK_CONDITIONS[key] ?? null,
    damage: HACK_DAMAGE[key] ?? null
  };
}

/** NET Actions a Turn by Interface rank. */
export const netActions = (rank) => (rank >= 10 ? 5 : rank >= 7 ? 4 : rank >= 4 ? 3 : 2);

/** The basic firewall: Interface 1-2 beats DV6 before the Jack In; Interface 3+ walks through (null). */
export const firewallDv = (rank) => (Number(rank) >= 3 ? null : 6);

const installed = (i) => i?.type === "cyberware" && !!(i.installed ?? i.system?.isInstalled);
const isDefender = (i) => /self.?ice\W*defender/i.test(i?.name ?? "");

/** Passwalls on a Neuroport: one per Self-ICE installed (Self-ICE: Defender is no Passwall). */
export function passwalls(items = []) {
  return [...items].filter((i) => installed(i) && /self.?ice/i.test(i.name ?? "") && !isDefender(i)).length;
}

/** Self-ICE: Defender installed? */
export const hasDefender = (items = []) => [...items].some((i) => installed(i) && isDefender(i));

/** A Breach's DV by how many Passwalls the port has: 6, 8, 10. null with none. */
export function breachDv(walls) {
  const n = Number(walls) || 0;
  return n <= 0 ? null : n === 1 ? 6 : n === 2 ? 8 : 10;
}

/**
 * Jack In: you get in either way. Lose (or tie) and they know. A Ghost Jack In that wins leaves
 * you Ghosted.
 */
export function jackIn({ attack, defense, ghost = false }) {
  const won = Number(attack) > Number(defense);
  return { won, aware: !won, ghosted: !!ghost && won };
}

/** A Breach: beat the DV and that Passwall is down. */
export const breach = ({ total, dv }) => ({ down: Number(total) > Number(dv) });

/** A rattled port (a failed Breach, or a Netrunner feeling a Quiet hack): they win, the Ghost is broken. */
export const ghostHolds = ({ runner, target }) => Number(target) <= Number(runner);

/**
 * A quickhack's Check and what the target knows after it.
 * - a miss changes nothing (and tells them nothing)
 * - a hit makes them aware, unless it's Quiet and you're Ghosted: then only a Netrunner gets a roll
 * - any other hit breaks the Ghost
 */
export function quickhack({ total, dv, quiet = false, ghosted = false, targetNetrunner = false }) {
  const hit = Number(total) > Number(dv);
  if (!hit) return { hit, aware: false, ghostBroken: false, noticeRoll: false };
  const stays = ghosted && quiet;
  return { hit, aware: !stays, ghostBroken: ghosted && !stays, noticeRoll: stays && targetNetrunner };
}

/** Getting kicked out: WILL + Concentration + 1d10 against Interface + 1d10. */
export const eject = ({ target, runner }) => ({ ejected: Number(target) > Number(runner) });

/**
 * A Cooldown as stored when the quickhack runs (hit or miss).
 * @param {number|string} cooldown - Rounds, "1 hour", "single use"
 * @param {object} now - { combat: id|null, round, time: world seconds, roundSeconds }
 * @returns {{ combat, round, until, burned }}
 */
export function startCooldown(cooldown, { combat = null, round = 0, time = 0, roundSeconds = 3 } = {}) {
  if (typeof cooldown === "number") {
    return { combat, round: (Number(round) || 0) + cooldown, until: time + cooldown * (Number(roundSeconds) || 3), burned: false };
  }
  const text = String(cooldown).toLowerCase();
  if (/single/.test(text)) return { combat: null, round: 0, until: null, burned: true };
  const hours = /(\d+)\s*hour/.exec(text);
  const minutes = /(\d+)\s*min/.exec(text);
  const seconds = hours ? Number(hours[1]) * 3600 : minutes ? Number(minutes[1]) * 60 : 0;
  return { combat: null, round: 0, until: time + seconds, burned: false };
}

/** Rounds (or seconds, outside that fight) a Cooldown still has; 0 when the quickhack can run. Infinity once burned out. */
export function cooldownLeft(cd, { combat = null, round = 0, time = 0 } = {}) {
  if (!cd) return 0;
  if (cd.burned) return Infinity;
  if (cd.combat && cd.combat === combat) return Math.max(0, cd.round - (Number(round) || 0));
  return cd.until !== null && time < cd.until ? Math.max(1, Math.ceil(cd.until - time)) : 0;
}

/** One quickhack per target per Turn: was this link hacked in this very Turn? */
export function hackedThisTurn(link, { combat = null, round = 0, turn = 0 } = {}) {
  const at = link?.at;
  return !!combat && !!at && at.combat === combat && at.round === round && at.turn === turn;
}

/** Damage after Self-ICE: Defender. */
export const soaked = (amount, defender) => Math.max(0, (Number(amount) || 0) - (defender ? DEFENDER_SOAK : 0));
