/**
 * When things happen inside the JB2A clips the quickhack looks use, pure (tests import it).
 * Measured frame by frame from JB2A's files, as scripts/arsenal/timing.js is; milliseconds from
 * the clip's start. A look's colours share their timing.
 */
import { rangeStep } from "../arsenal/timing.js";

/**
 * jb2a.energy_strands.range.standard (the pulse that runs up the link): when it leaves the
 * Netrunner and when its head reaches the target, for the 05/15/30/60/90 ft clips.
 */
export const STRAND = { launch: [170, 100, 70, 130, 100], arrive: [430, 500, 500, 1030, 1270], gone: [800, 800, 800, 1630, 1900] };

/** The pulse over a distance in grid squares: { launch, arrive, gone }. */
export function strandFor(squares) {
  const i = rangeStep(squares);
  return { launch: STRAND.launch[i], arrive: STRAND.arrive[i], gone: STRAND.gone[i] };
}

/** With no JB2A the pulse is the module's own tracer, sliding along the link at this speed. */
export const TRACER_MS_PER_SQUARE = 40;
export const tracerFor = (squares) => {
  const arrive = Math.round(Math.max(250, Math.min(1200, (Number(squares) || 0) * TRACER_MS_PER_SQUARE)));
  return { launch: 0, arrive, gone: arrive + 150 };
};

/** jb2a.shield.01.intro: the shield flares up, holds, and has faded. */
export const SHIELD_INTRO = { up: 270, gone: 1400 };

/**
 * jb2a.shield.01.outro_explode: the shield stands from `up`, bursts at `burst`, is gone by `gone`.
 * Played from `skip` so it's already standing when the pulse arrives.
 */
export const SHIELD_EXPLODE = { up: 270, burst: 1030, gone: 1300, skip: 400 };

/** jb2a.energy_beam.normal: a steady beam from its first frame, this long. */
export const BEAM = { length: 3000 };

/** On-token clips: when each is at its fullest, and when it has faded. */
export const TOKEN_CLIPS = {
  static: { peak: 170, gone: 2580 }, // jb2a.static_electricity.03
  impact: { peak: 100, gone: 970 }, // jb2a.impact.004
  shimmer: { peak: 210, gone: 380 }, // jb2a.shimmer.01
  outpulse: { peak: 800, gone: 1200 }, // jb2a.extras.tmfx.outpulse.circle.01
  inpulse: { peak: 370, gone: 1070 }, // jb2a.extras.tmfx.inpulse.circle.01
  radar: { peak: 330, gone: 2830 }, // jb2a.extras.tmfx.radar.circle.pulse.01
  marker: { peak: 600, gone: 4930 } // jb2a.markers_scifi.001.complete.001
};
