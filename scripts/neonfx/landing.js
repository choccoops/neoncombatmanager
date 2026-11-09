import { MODULE_ID, LANG } from "../constants.js";
import { L, esc } from "../util.js";
import { Compat } from "../compat.js";
import { Core, img, FX_FLAG, PREFIX } from "./core.js";
import { Flight, planFlight } from "./flight.js";

/**
 * AV landings: a holo warning zone on the ground (a rectangular grav field with a hazard-striped
 * pad, a scan bar running its length, a pulsing frame, corner brackets and warning beacons), and an
 * AV token flying in and setting down on it.
 *
 * Who draws what:
 * - The zone is a set of persistent Sequencer effects named `ncm-fx-avzone-<id>-<w>x<h>` (grid
 *   squares; the pad itself ends in `-pad`), made by whoever placed it, so everyone sees it and it
 *   survives a reload.
 * - A landing is one token update (straight onto the pad, no animation) carrying a `landing` token
 *   flag. Every client draws the flight, shadow, downwash and sound itself from that, at its own
 *   volume and motion settings. The writer (the active GM, else the pilot) puts the zone away after.
 */
export const ZONE = `${PREFIX}-avzone`;
const ZONE_RE = /^ncm-fx-avzone-([A-Za-z0-9]+)-(\d+)x(\d+)(-pad)?$/;

/** How long a new zone's warning beeps before it goes quiet. */
const BEEP_MS = 20000;
/** A zone effect younger than this is new (not one Sequencer brought back with the scene). */
const NEW_MS = 4000;

const AMBER = 0xffb020;
const BEACON = 0xff5a1f;

/** JB2A entries to look for, most specific first: the dust the AV blows out as it sets down. */
export const AV_JB2A = {
  dust: ["jb2a.smoke.puff.ring", "jb2a.smoke.puff.centered", "jb2a.smoke.puff.side", "jb2a.smoke.puff"]
};

export const zoneName = (id, w, h, pad = false) => `${ZONE}-${id}-${w}x${h}${pad ? "-pad" : ""}`;

/** { id, w, h, pad } from one of our zone effect names, or null. */
export function parseZone(name) {
  const m = typeof name === "string" ? ZONE_RE.exec(name) : null;
  return m ? { id: m[1], w: Number(m[2]), h: Number(m[3]), pad: !!m[4] } : null;
}

/**
 * The zone's size in grid squares { w, h } for a vehicle token (default: a 1x1): a square's margin
 * all round, and long, half as long again as it is wide, along the token's longer side. The
 * margins keep the token's own odd/even so it sits square on the grid in the middle.
 */
export function zoneSize(doc) {
  const tw = Math.max(1, Math.ceil(Number(doc?.width) || 1));
  const th = Math.max(1, Math.ceil(Number(doc?.height) || 1));
  let w = tw + 2;
  let h = th + 2;
  if (h >= w) {
    h = Math.max(h, Math.round(w * 1.5));
    if ((h - th) % 2) h += 1;
  } else {
    w = Math.max(w, Math.round(h * 1.5));
    if ((w - tw) % 2) w += 1;
  }
  return { w, h };
}

/** Top-left that puts a token's centre on `centre`. */
export function landingSpot(doc, centre, gs) {
  return { x: Math.round(centre.x - (doc.width * gs) / 2), y: Math.round(centre.y - (doc.height * gs) / 2) };
}

/* ---------------------------------------- */
/*  Drawing                                 */
/* ---------------------------------------- */

/**
 * The zone's persistent layers at a centre point, w x h grid squares. The art is drawn long side
 * up; a zone wider than tall turns it a quarter.
 */
function drawZone(seq, id, at, w, h) {
  const name = zoneName(id, w, h);
  const turned = w > h;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  const gs = canvas.grid.size;
  const layer = (z, nm = name) => {
    const e = seq.effect().name(nm).atLocation(at).persist().belowTokens().zIndex(z).fadeIn(500).fadeOut(900);
    return turned ? e.rotate(90) : e;
  };
  const sized = (kw, kh = kw) => [{ width: short * kw, height: long * kh }, { gridUnits: true }];

  // The grav field: a soft rectangle of light, breathing.
  layer(0).file(img("av-field.webp")).size(...sized(1.3, 1.2)).tint(AMBER)
    .loopProperty("sprite", "alpha", { values: [0.3, 0.62], duration: 1600, pingPong: true, absolute: true });
  // A frame rolling out from the middle.
  layer(1).file(img("av-frame.webp")).size(...sized(1)).tint(AMBER)
    .loopProperty("spriteContainer", "scale.x", { values: [0.6, 1.14], duration: 1800 })
    .loopProperty("spriteContainer", "scale.y", { values: [0.6, 1.14], duration: 1800 })
    .loopProperty("sprite", "alpha", { values: [0.7, 0], duration: 1800, absolute: true });
  // The pad, with the odd holo flicker.
  layer(2, zoneName(id, w, h, true)).file(img("av-pad.webp")).size(...sized(1))
    .scaleIn(0.4, 700, { ease: "easeOutBack" })
    .loopProperty("sprite", "alpha", { values: [1, 1, 1, 1, 0.65, 1, 1, 0.85, 1, 1, 1, 1, 1, 1], duration: 110, absolute: true });
  // A scan bar running the length of it.
  layer(3).file(img("av-scanbar.webp")).size({ width: short * 0.92, height: 0.6 }, { gridUnits: true }).tint(AMBER).opacity(0.85)
    .loopProperty("sprite", "position.y", { from: -long * gs * 0.45, to: long * gs * 0.45, duration: 2400 });
  // Corner brackets breathing in and out.
  layer(4).file(img("av-brackets.webp")).size(...sized(1.12, 1.08))
    .loopProperty("spriteContainer", "scale.x", { values: [1, 1.04], duration: 900, pingPong: true })
    .loopProperty("spriteContainer", "scale.y", { values: [1, 1.04], duration: 900, pingPong: true });
  // Warning beacons at the four corners, blinking in turn.
  const rx = w * gs * 0.56;
  const ry = h * gs * 0.56;
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy], i) => {
    seq.effect().name(name).atLocation({ x: at.x + sx * rx, y: at.y + sy * ry }).persist().belowTokens().zIndex(5).fadeIn(500).fadeOut(900)
      .file(img("glow-soft.webp")).size(0.55, { gridUnits: true }).tint(BEACON)
      .loopProperty("sprite", "alpha", { values: i % 2 ? [0.08, 1] : [1, 0.08], duration: 520, absolute: true });
  });
}

/** This client's look of a landing: the shadow coming in under the AV, the pad flaring, the downwash. */
function drawLanding(seq, token, at, plan, zone = null) {
  const gs = canvas.grid.size;
  const size = Core.artSize(token);
  // The shadow is cast down and to one side while it's high, and meets the AV as it lands.
  const alt = { x: gs * 0.35, y: gs * 0.5 };
  const shadow = seq.effect().copySprite(token).atLocation(at).size(size).rotate(-(token.document.rotation ?? 0)).belowTokens().zIndex(6)
    .tint(0x000000).opacity(0.5).duration(plan.total + 400).fadeIn(300).fadeOut(400)
    .animateProperty("spriteContainer", "scale.x", { from: 0.8, to: 1, duration: plan.total, ease: "easeInCubic" })
    .animateProperty("spriteContainer", "scale.y", { from: 0.8, to: 1, duration: plan.total, ease: "easeInCubic" });
  for (const axis of ["x", "y"]) {
    const d = axis === "x" ? plan.dx : plan.dy;
    if (plan.cruise) shadow.animateProperty("spriteContainer", `position.${axis}`, { from: d + alt[axis], to: alt[axis], duration: plan.cruise, ease: "easeInOutCubic" });
    shadow.animateProperty("spriteContainer", `position.${axis}`, { from: alt[axis], to: 0, duration: plan.descent, delay: plan.cruise, ease: "easeOutCubic" });
  }
  // The pad flares as the AV comes over it.
  const { w, h } = zone ?? zoneSize(token.document);
  seq.effect().file(img("av-frame.webp")).atLocation(at).belowTokens().zIndex(7).tint(AMBER)
    .size({ width: Math.min(w, h), height: Math.max(w, h) }, { gridUnits: true }).rotate(w > h ? 90 : 0)
    .delay(plan.cruise).duration(900).repeats(3, 650)
    .animateProperty("spriteContainer", "scale.x", { from: 0.5, to: 1.35, duration: 900 })
    .animateProperty("spriteContainer", "scale.y", { from: 0.5, to: 1.35, duration: 900 })
    .animateProperty("sprite", "alpha", { from: 0.85, to: 0, duration: 900, absolute: true });
  // Downwash: dust blown out from under it as it sets down.
  const across = Math.max(token.document.width, token.document.height) * 2.2;
  const dust = Core.jb2a(AV_JB2A.dust, ["grey", "white"]);
  const wash = seq.effect().atLocation(at).belowTokens().zIndex(8).delay(plan.cruise + Math.round(plan.descent * 0.55));
  if (dust) wash.file(dust).size(across, { gridUnits: true }).opacity(0.75);
  else {
    wash.file(img("ring-pulse.webp")).size(across, { gridUnits: true }).tint(0xb8b2a6).duration(1400)
      .animateProperty("spriteContainer", "scale.x", { from: 0.4, to: 1.2, duration: 1400, ease: "easeOutCubic" })
      .animateProperty("spriteContainer", "scale.y", { from: 0.4, to: 1.2, duration: 1400, ease: "easeOutCubic" })
      .animateProperty("sprite", "alpha", { from: 0.8, to: 0, duration: 1400, absolute: true });
  }
  if (Core.motion) seq.canvasPan().delay(plan.total).shake({ duration: 350, strength: 3, frequency: 12, rotation: false });
}

/* ---------------------------------------- */
/*  The API                                 */
/* ---------------------------------------- */

export const Landing = {
  init() {
    Hooks.on("createSequencerEffect", (effect) => this._onZoneEffect(effect, true));
    Hooks.on("endedSequencerEffect", (effect) => this._onZoneEffect(effect, false));
    Hooks.on("canvasTearDown", () => Flight.clear());
  },

  /** The landing zones on a scene (default: the one being viewed): { id, w, h, x, y } (grid squares, centre). */
  zones(sceneId = canvas?.scene?.id) {
    if (!Core.sequencer || !sceneId) return [];
    let effects = [];
    try {
      effects = Sequencer.EffectManager.getEffects({ sceneId }) ?? [];
    } catch {
      return [];
    }
    const out = [];
    for (const e of effects) {
      const z = parseZone(e?.data?.name);
      if (!z?.pad || out.some((o) => o.id === z.id)) continue;
      const at = e.sourcePosition ?? e.data?.source;
      if (Number.isFinite(at?.x) && Number.isFinite(at?.y)) out.push({ id: z.id, w: z.w, h: z.h, x: at.x, y: at.y });
    }
    return out;
  },

  /** The zone nearest a point, or null. */
  nearest(point, sceneId) {
    let best = null;
    for (const z of this.zones(sceneId)) {
      const d = Math.hypot(z.x - point.x, z.y - point.y);
      if (!best || d < best.d) best = { ...z, d };
    }
    if (best) delete best.d;
    return best;
  },

  /**
   * Put a landing zone down. at: its centre (else pick it on the map); size: { w, h } in grid
   * squares (else sized to the selected token, or 3x5). Cancelling the pick on a scene that has
   * zones offers to take them away.
   */
  async placeZone({ at = null, size = null, token = null } = {}) {
    if (!this._ready()) return null;
    token ??= canvas.tokens?.controlled?.[0] ?? null;
    const fit = zoneSize(token?.document);
    const w = Math.max(1, Math.round(Number(size?.w) || fit.w));
    const h = Math.max(1, Math.round(Number(size?.h) || fit.h));
    at ??= await this._pick(w, h, L(`${LANG}.FX.Landing.PickZone`));
    if (!at) {
      if (this.zones().length && (await this._confirmClear())) await this.clearZones();
      return null;
    }
    const id = foundry.utils.randomID(10);
    const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
    drawZone(seq, id, { x: Math.round(at.x), y: Math.round(at.y) }, w, h);
    seq.play(); // persistent: never resolves, don't wait on it
    return { id, w, h, x: Math.round(at.x), y: Math.round(at.y) };
  },

  /** Take a zone away (fades out). */
  async endZone(id, sceneId = canvas?.scene?.id) {
    if (!Core.sequencer || !id || !sceneId) return;
    const names = new Set();
    try {
      for (const e of Sequencer.EffectManager.getEffects({ sceneId }) ?? []) if (parseZone(e?.data?.name)?.id === id) names.add(e.data.name);
      for (const name of names) await Sequencer.EffectManager.endEffects({ name, sceneId });
    } catch (err) {
      console.warn(`${MODULE_ID} | AV landing zone`, err);
    }
  },

  /** Take every landing zone off a scene (default: the one being viewed). */
  async clearZones(sceneId = canvas?.scene?.id) {
    for (const z of this.zones(sceneId)) await this.endZone(z.id, sceneId);
  },

  /**
   * Land an AV (default: the selected token you own) on a zone: the given one, else the nearest
   * on the scene, else a spot you pick. A hidden token comes in from off the map and is revealed.
   * keepZone: leave the zone lit after touchdown.
   */
  async land(tokens = null, { zone = null, keepZone = false } = {}) {
    if (!this._ready()) return null;
    let list = tokens ?? canvas.tokens?.controlled ?? [];
    if (!Array.isArray(list)) list = [list];
    const token = list.map((t) => t?.object ?? t).find((t) => t?.document?.isOwner);
    if (!token) {
      ui.notifications.warn(L(`${LANG}.FX.SelectToken`));
      return null;
    }
    const doc = token.document;
    const gs = canvas.grid.size;
    const here = { x: doc.x + (doc.width * gs) / 2, y: doc.y + (doc.height * gs) / 2 };
    const pad = zone ? this.zones().find((z) => z.id === zone) ?? null : this.nearest(here);
    const fit = zoneSize(doc);
    const at = pad ? { x: pad.x, y: pad.y } : await this._pick(fit.w, fit.h, L(`${LANG}.FX.Landing.PickSpot`));
    if (!at) return null;
    const from = doc.hidden ? { x: at.x - gs * 5, y: at.y - gs * 9 } : here;
    const landing = { id: foundry.utils.randomID(8), fx: Math.round(from.x), fy: Math.round(from.y), airborne: !!doc.hidden, zone: pad?.id ?? null, w: pad?.w ?? fit.w, h: pad?.h ?? fit.h, keep: !!keepZone };
    const data = { ...landingSpot(doc, at, gs), [`flags.${MODULE_ID}.${FX_FLAG}.landing`]: landing };
    if (doc.hidden && game.user.isGM) data.hidden = false;
    await doc.update(data, { animate: false });
    return landing;
  },

  /* ---------------------------------------- */
  /*  On every client                         */
  /* ---------------------------------------- */

  /** A token update carrying a landing: fly it in here, and (the writer) put the zone away after. */
  onUpdate(doc, changes, userId) {
    const landing = foundry.utils.getProperty(changes ?? {}, `flags.${MODULE_ID}.${FX_FLAG}.landing`);
    const token = doc?.object;
    if (!landing?.id || !token) return false;
    const gs = canvas.grid.size;
    const at = { x: doc.x + (doc.width * gs) / 2, y: doc.y + (doc.height * gs) / 2 };
    const plan = planFlight({ from: { x: landing.fx, y: landing.fy }, to: at, gs, airborne: landing.airborne });
    if (Core.on) {
      if (Core.motion) Flight.start(token, plan);
      const seq = new Sequence({ moduleName: MODULE_ID, softFail: true });
      drawLanding(seq, token, at, plan, landing.w && landing.h ? { w: landing.w, h: landing.h } : null);
      seq.play();
      const engines = `${ZONE}-approach-${token.id}`;
      Core.sound("avApproach", { name: engines });
      setTimeout(() => {
        Core.sound("avTouchdown");
        setTimeout(() => Core.endSound(engines), 300);
      }, Math.max(0, plan.total - 120));
    }
    if (landing.zone && !landing.keep && Core.writes(userId)) {
      const sceneId = doc.parent?.id ?? canvas.scene?.id;
      setTimeout(() => this.endZone(landing.zone, sceneId), plan.total + 1500);
    }
    return true;
  },

  /** A zone's pad appearing (newly, not brought back with the scene) or going: its sound here. */
  _onZoneEffect(effect, created) {
    const z = parseZone(effect?.data?.name);
    if (!z?.pad) return;
    const loop = `${zoneName(z.id, z.w, z.h)}-beep`;
    if (!created) return Core.endSound(loop);
    if (!Core.on || Date.now() - (effect.data.creationTimestamp ?? 0) > NEW_MS) return;
    Core.sound("avZoneOn");
    Core.sound("avZoneLoop", { name: loop, duration: BEEP_MS });
  },

  /* ---------------------------------------- */
  /*  Helpers                                 */
  /* ---------------------------------------- */

  _ready() {
    if (!Core.sequencer) {
      ui.notifications.warn(L(`${LANG}.FX.NoSequencer`));
      return false;
    }
    if (!canvas?.ready || !canvas.scene) return false;
    return true;
  },

  /**
   * Pick a zone's centre on the map with Sequencer's crosshair, then square it on the grid: on a
   * square's middle along an odd side, on a grid line along an even one.
   */
  async _pick(w, h, label) {
    if (typeof Sequencer?.Crosshair?.show !== "function") return null;
    const placed = await Sequencer.Crosshair.show({
      distance: (canvas.dimensions.distance * Math.min(w, h)) / 2,
      icon: { texture: img("av-pad.webp"), borderVisible: false },
      label: { text: label },
      gridHighlight: false
    });
    if (!placed) return null;
    const p = { x: placed.x, y: placed.y };
    const c = Compat.snapCenter(p);
    const half = canvas.grid.size / 2;
    return {
      x: w % 2 ? c.x : c.x + (p.x >= c.x ? half : -half),
      y: h % 2 ? c.y : c.y + (p.y >= c.y ? half : -half)
    };
  },

  async _confirmClear() {
    return Compat.DialogV2.confirm({
      window: { title: L(`${LANG}.FX.Macro.LandingZone`) },
      content: `<p>${esc(L(`${LANG}.FX.Landing.ClearAsk`, { count: this.zones().length }))}</p>`,
      rejectClose: false
    });
  }
};
