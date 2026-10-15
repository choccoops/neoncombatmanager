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

/** Time of day "HH:MM" from world time in seconds (Foundry's world time starts at midnight). */
export function clockTime(worldTime) {
  const day = 86400;
  const t = ((Math.floor(Number(worldTime) || 0) % day) + day) % day;
  return `${pad(t / 3600)}:${pad((t % 3600) / 60)}`;
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
