/** Small helpers shared by the module. Pure where possible (tests import them). */

/** Localize a key, formatting it when data is given. */
export const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** HTML-escape text for templates built in code. */
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Run fn once calls stop for `wait` ms. */
export function debounce(fn, wait = 250) {
  let timer = null;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

const pad = (n) => String(Math.floor(n)).padStart(2, "0");

/** Seconds as "MM:SS", or "H:MM:SS" past an hour. Negative counts as zero. */
export function formatElapsed(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/**
 * Time of day from world time in seconds (Foundry's world time starts at midnight), the way Neon
 * Hub's calendar shows it: "19:05", or "7:05 PM" on a 12-hour clock.
 */
export function clockTime(worldTime, hour12 = false) {
  const day = 86400;
  const t = ((Math.floor(Number(worldTime) || 0) % day) + day) % day;
  return formatMinutes(Math.floor(t / 60), hour12);
}

/** Minutes after midnight as "19:05" or "7:05 PM". */
export function formatMinutes(minutes, hour12 = false) {
  const total = ((Math.floor(Number(minutes) || 0) % 1440) + 1440) % 1440;
  const h = Math.floor(total / 60);
  const m = pad(total % 60);
  if (!hour12) return `${pad(h)}:${m}`;
  return `${h % 12 || 12}:${m} ${h < 12 ? "AM" : "PM"}`;
}

/** A duration in seconds in plain words: "1 min", "4 h", "24 h", "7 d", "20 s". */
export function shortDuration(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (s <= 0) return "";
  if (s % 86400 === 0) return `${s / 86400} d`;
  if (s % 3600 === 0) return `${s / 3600} h`;
  if (s % 60 === 0) return `${s / 60} min`;
  return `${s} s`;
}

/** Clamp a number. */
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Normalize a name for loose matching: lower case, letters and digits only. */
export const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
