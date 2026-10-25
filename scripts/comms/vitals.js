/**
 * Biomonitor vitals: what a character's Biomonitor broadcasts over a link. Cyberpunk RED's
 * Biomonitor is fashionware "showing vitals readouts" that "can be linked to your Agent"; the
 * readout here follows the character's Wound State (core p.186), Death Save penalty, Critical
 * Injuries and the conditions that matter to someone watching (out cold, burning, drowning).
 * Pure: give it plain numbers and condition ids, get a readout back.
 */

/** Readout states, best to worst (out cold is better than dying). */
export const STATES = ["stable", "light", "serious", "down", "critical", "flatline"];

/** Heart rate shown on the ECG (beats per minute) and how fast the trace runs. */
const BPM = { stable: 72, light: 88, serious: 112, critical: 138, down: 48, flatline: 0 };

/** Conditions a vitals readout calls out, worst first. */
const CALL_OUTS = ["dead", "unconscious", "sleep", "onFireDeadly", "onFireStrong", "onFireMild", "drowning", "asphyxiating", "electrocuted", "radiationHigh", "stabilized"];

/**
 * A readout.
 * @param {object} v
 * @param {number} v.hp - current HP
 * @param {number} v.max - maximum HP
 * @param {string} v.wound - CPR Wound State (notWounded, lightlyWounded, seriouslyWounded, mortallyWounded)
 * @param {number} [v.deathSave] - Death Save penalty
 * @param {string[]} [v.conditions] - condition ids on the character
 * @param {string[]} [v.criticals] - names of their Critical Injuries
 * @param {string|null} [v.implant] - the implant broadcasting the vitals ("Neuroport", "Biomonitor"), if any
 * @param {boolean} [v.signal] - false when there's no implant to broadcast them: no readings at all
 * @returns {{ state, bpm, pct, hp, max, deathSave, alerts: string[], criticals: string[], implant, signal, rank: number, spoofed? }}
 */
export function readout({ hp = 0, max = 0, wound = "notWounded", deathSave = 0, conditions = [], criticals = [], implant = null, signal = true }) {
  if (!signal) {
    return { state: "nosignal", bpm: 0, pct: 0, hp: null, max: null, deathSave: null, alerts: [], criticals: [], implant: null, signal: false, rank: -1 };
  }
  const has = new Set(conditions);
  // Vitals Spoof (a quickhack): calm, normal vitals, whatever is really happening.
  if (has.has("qhVitalsSpoof")) {
    return { state: "stable", bpm: BPM.stable, pct: 100, hp: max, max, deathSave: null, alerts: [], criticals: [], implant: implant || null, signal: true, rank: 0, spoofed: true };
  }
  let state = { lightlyWounded: "light", seriouslyWounded: "serious", mortallyWounded: "critical" }[wound] ?? "stable";
  if (has.has("unconscious") || has.has("sleep")) state = state === "critical" ? "critical" : "down";
  if (has.has("dead")) state = "flatline";
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((hp / max) * 100))) : 0;
  return {
    state,
    bpm: BPM[state],
    pct,
    hp,
    max,
    deathSave: state === "critical" ? Number(deathSave) || 0 : null,
    alerts: CALL_OUTS.filter((id) => has.has(id) && id !== "dead"),
    criticals: [...criticals],
    implant: implant || null,
    signal: true,
    rank: STATES.indexOf(state)
  };
}

/**
 * Did a character's readout just get worse in a way the link should hear about?
 * @returns {string|null} the new state when it's critical, down or flatline and wasn't before
 */
export function alarm(before, after) {
  if (!after?.signal || before?.signal === false) return null;
  const loud = ["critical", "down", "flatline"];
  if (!loud.includes(after.state)) return null;
  if (before && before.state === after.state) return null;
  if (before && STATES.indexOf(after.state) < STATES.indexOf(before.state) && after.state !== "flatline") return null;
  return after.state;
}

/** SVG path of one ECG trace across a 120x32 box for a state (flat for a flatline). */
export function ecgPath(state) {
  if (state === "flatline" || state === "nosignal") return "M0 16 H120";
  const beats = state === "critical" ? 4 : state === "serious" ? 3 : 2;
  const amp = state === "down" ? 6 : state === "critical" ? 9 : 12;
  const seg = 120 / beats;
  let d = "M0 16";
  for (let i = 0; i < beats; i++) {
    const x = i * seg;
    d += ` H${(x + seg * 0.35).toFixed(1)} l${(seg * 0.06).toFixed(1)} -3 l${(seg * 0.06).toFixed(1)} 3`
      + ` l${(seg * 0.05).toFixed(1)} ${amp} l${(seg * 0.06).toFixed(1)} -${amp * 2} l${(seg * 0.06).toFixed(1)} ${amp} H${(x + seg).toFixed(1)}`;
  }
  return d;
}
