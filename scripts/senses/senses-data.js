/**
 * Enhanced sight and torches, pure (tests import it).
 *
 * The three ways of seeing do different jobs here:
 *   Low Light  an image intensifier: the scene as it is, amplified. Who's out in the dark shows
 *              as themselves, in its green.
 *   Infrared   heat: living bodies burn bright, a Full Body Conversion reads cold, and what has
 *              no heat doesn't show.
 *   UV         reflected ultraviolet: no heat, but traces. Who's out in the dark shows in its
 *              violet; blood fluoresces on the badly wounded and the dead; and drawings and
 *              tiles the GM marks "UV only" (a tag, a tripwire, writing in invisible ink)
 *              appear for whoever looks in UV, and for nobody else.
 *
 * 2070 Item Compendium: Low Light / Infrared / UV (cybereyes, or built into glasses, a helmet or
 * a Smart Scope) drops darkness, smoke and fog penalties to 0 and tells warm bodies from cold
 * metal; an Infrared Nightvision Scope does the same through the gun. A Full Body Conversion
 * reads cold unless Realskinn Plating covers it; Thermal Damping on running Optical Camo hides
 * its wearer from thermal sight altogether. A Flashlight throws a 100 m/yd beam.
 */

/** The three ways of seeing, in the order they're offered: each its own look on the screen. */
export const MODES = ["lowlight", "infrared", "uv"];
/** Which of them show heat. Infrared reads what a body gives off; UV reads what light bounces back. */
export const HEAT_MODES = ["infrared"];
/** Each mode's colour (the screen's wash, the HUD's light). */
export const MODE_TINT = { lowlight: "#39ff14", infrared: "#ff7a1a", uv: "#b26bff" };
/** What a warm body and a cold one look like in each heat mode: fill colours. */
export const HEAT_TINT = {
  infrared: { warm: 0xff5a1f, cold: 0x2f7dff }
};
/** What fluoresces under UV: blood, and whatever the GM has marked as UV-only. */
export const UV_GLOW = 0xf2e6ff;

/**
 * Does someone show blood under UV, pure: wounded badly enough to be bleeding, or dead.
 * (UV shows no heat: it shows traces. Fresh blood fluoresces.)
 */
export const bleeds = (wound) => ["seriouslyWounded", "mortallyWounded", "dead"].includes(String(wound ?? ""));

const strip = (html) => String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

/**
 * The ways of seeing an item gives, read from its name and card: a subset of MODES, in order.
 * "Low Light / Infrared / UV" gives all three; an "Infrared Nightvision Scope" infrared alone.
 */
export function modesOf(item) {
  const text = `${item?.name ?? ""}. ${strip(item?.description)}`;
  const out = new Set();
  if (/low[- ]?light/i.test(text)) out.add("lowlight");
  if (/infra-?red|thermograph|\bIR\b(?!\/UV Laser)/i.test(text)) out.add("infrared");
  if (/ultra-?violet|\bUV\b(?! Laser)/i.test(text)) out.add("uv");
  // A sight that only works with such eyes isn't such eyes.
  if (/laser sight/i.test(String(item?.name ?? ""))) return [];
  return MODES.filter((m) => out.has(m));
}

/** Is this chrome a Full Body Conversion (or a part only one has)? */
export const isBorgPart = (name) => /\bfbc\b|full[- ]body (?:conversion|cyborg|replacement)/i.test(String(name ?? ""));

/**
 * How a body reads to heat sight: "warm", "cold", or null (nothing to see).
 * @param {object} o - meat: a person or animal (not a vehicle, a drone, cover); borg: a Full Body
 *   Conversion; skinned: Realskinn Plating (a borg that doesn't read cold); damped: Thermal
 *   Damping with Optical Camo running (hidden from thermal sight); dead
 */
export function heatOf({ meat = false, borg = false, skinned = false, damped = false, dead = false } = {}) {
  if (!meat || damped) return null;
  if (dead) return "cold";
  if (borg && !skinned) return "cold";
  return "warm";
}

/** A light an item throws as a torch: { range } (m/yds), or null. A card that names its beam is taken at its word. */
export function torchOf(item) {
  const name = String(item?.name ?? "");
  const text = `${name}. ${strip(item?.description)}`;
  if (!/flashlight|torch(?!\w)|\blamp\b|\bglow ?stick\b/i.test(text) || /thermo/i.test(name)) return null;
  const beam = /([\d,]+)\s*m(?:\/yds?)?\s+beam/i.exec(text);
  return { range: beam ? Number(beam[1].replace(/,/g, "")) : 20 };
}

/**
 * The token light a torch makes: a cone the way the token faces. Bright for the near part of
 * the beam, dim to its end, no further than the scene.
 */
export function torchLight({ range = 20, angle = 60, max = Infinity } = {}) {
  const cap = Number.isFinite(max) && max > 0 ? max : Infinity;
  const dim = Math.max(1, Math.round(Math.min(Number(range) || 20, cap)));
  return { dim, bright: Math.max(1, Math.round(dim / 4)), angle: Math.max(10, Math.min(360, Number(angle) || 60)), color: "#fff1c9", alpha: 0.35, luminosity: 0.5, attenuation: 0.6 };
}
