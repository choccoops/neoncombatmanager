import { MODULE_ID, SYSTEM_ID, NEON_HUB_ID } from "../constants.js";
import { Compat } from "../compat.js";
import { Settings } from "../settings.js";
import { autofireTable } from "./kinds.js";

export const DIWAKO_ID = "diwako-cpred-additions";
/** Neon Hub's 2070 range tables (2070 Core Rules Ch07). */
export const HUB_DV_PACK = `${NEON_HUB_ID}.dv-tables-2070`;

/**
 * The DV a range table gives at a distance, pure: the result whose range holds it, as a number;
 * null past the table's end or when the result isn't a number.
 * @param {object[]} results - [{ range: [lo, hi], text|description|name }]
 */
export function dvFromResults(results, distance) {
  const d = Math.max(0, Math.round(Number(distance) || 0));
  const r = (results ?? []).find((x) => Array.isArray(x.range) && d >= x.range[0] && d <= x.range[1]);
  if (!r) return null;
  const n = parseInt(String(r.description ?? r.text ?? r.name ?? "").replace(/<[^>]+>/g, ""), 10);
  return Number.isFinite(n) ? n : null;
}

/** CPR's words for weapon types (what Diwako's display shows with weapon names off). */
const TYPE_KEYS = {
  assaultRifle: "assaultRifle", bow: "bowsAndCrossbows", grenadeLauncher: "grenadeLauncher", heavyMelee: "heavyMeleeWeapon",
  heavyPistol: "heavyPistol", heavySmg: "heavySmg", lightMelee: "lightMeleeWeapon", martialArts: "martialArts", medMelee: "mediumMeleeWeapon",
  medPistol: "mediumPistol", rocketLauncher: "rocketLauncher", shotgun: "shotgun", smg: "smg", sniperRifle: "sniperRifle",
  thrownWeapon: "thrownWeapon", unarmed: "unarmed", vHeavyMelee: "veryHeavyMeleeWeapon", vHeavyPistol: "veryHeavyPistol"
};

/**
 * The lines of a DV display, pure: each ranged weapon's DV at this distance, its underbarrel
 * weapons, and its Autofire table when it can fire one. One line per name (or per type, with
 * names off), as Diwako's display has it.
 * @param {object[]} weapons - { name, weaponType, table, autofire, upgrades: [same] }
 * @param {(table: string) => number|null} dvAt - the DV of a table at this distance
 */
export function dvLines(weapons, dvAt, { names = true, typeLabel = (t) => t, autofireLabel = "(Autofire)" } = {}) {
  const seen = new Set();
  const out = [];
  const add = (w, table, auto = false) => {
    if (!table) return;
    const dv = dvAt(table);
    if (dv === null || dv === undefined || dv < 0) return;
    let label = names ? w.name : typeLabel(w.weaponType);
    const key = `${names ? w.name : w.weaponType}${auto ? "|auto" : ""}`;
    if (auto) label = `${label} ${autofireLabel}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ label, dv });
  };
  for (const w of weapons) {
    add(w, w.table);
    for (const u of w.upgrades ?? []) add(u, u.table);
    if (w.autofire) add(w, w.autofire, true);
  }
  return out;
}

/**
 * DV tables, read the way Cyberpunk RED reads them (a world table by name first, then the
 * compendium set in CPR's settings), with Neon Hub's 2070 tables and CPR's own as fallbacks.
 * Diwako's DV display gets its numbers from here, so it shows the 2070 tables, and each gun's own
 * Autofire table (a 2070 card names it: "Autofire (Machine Pistol 4)").
 */
export const Dv = {
  cache: new Map(),

  packs() {
    let configured = null;
    try {
      configured = game.settings.get(SYSTEM_ID, "dvRollTableCompendium");
    } catch {
      /* not this system */
    }
    return [configured, HUB_DV_PACK, `${SYSTEM_ID}.internal_dv-tables`, `${SYSTEM_ID}.dv-tables`].filter(Boolean).map((id) => game.packs?.get(id)).filter(Boolean);
  },

  /** A table's results by name (cached; cleared when tables or CPR's settings change). */
  async results(name) {
    if (!name) return null;
    if (this.cache.has(name)) return this.cache.get(name);
    let table = game.tables?.getName?.(name) ?? null;
    if (!table) {
      for (const pack of this.packs()) {
        const id = pack.index?.getName?.(name)?._id ?? [...(pack.index ?? [])].find((e) => e.name === name)?._id;
        if (!id) continue;
        table = await pack.getDocument(id);
        if (table) break;
      }
    }
    const results = table ? [...(table.results ?? [])].map((r) => ({ range: r.range, text: r.text, description: r.description, name: r.name })) : null;
    this.cache.set(name, results);
    return results;
  },

  async at(name, distance) {
    return dvFromResults(await this.results(name), distance);
  },

  /** Metres between two tokens, as CPR measures for range tables. */
  distance(a, b) {
    const ca = a?.center ?? a;
    const cb = b?.center ?? b;
    if (!ca || !cb) return 0;
    return Compat.measure(ca, cb);
  },

  /** The DV a weapon's attack faces at a distance (Autofire uses its Autofire table). */
  async forWeapon(weapon, distance, { autofire = false } = {}) {
    const table = autofire ? autofireTable(weapon) : String(weapon?.system?.dvTable ?? "");
    let dv = await this.at(table, distance);
    if ((dv === null || dv < 0) && autofire) dv = await this.at(String(weapon?.system?.dvTable ?? ""), distance);
    return dv;
  },

  clear() {
    this.cache.clear();
  },

  /* ---------------------------------------- */
  /*  Diwako's DV display                     */
  /* ---------------------------------------- */

  get diwako() {
    return !!game.modules.get(DIWAKO_ID)?.active;
  },

  diwakoSetting(key, fallback) {
    try {
      return game.settings.get(DIWAKO_ID, key);
    } catch {
      return fallback;
    }
  },

  /**
   * Hand Diwako's DV display our numbers: its hover text, its settings and its place beside the
   * token stay Diwako's. The display is a Token method Diwako adds at init (showDVDisplay).
   */
  installDisplay() {
    if (!this.diwako || !Settings.get("arsenalDvDisplay")) return false;
    const proto = CONFIG.Token?.objectClass?.prototype;
    if (!proto || typeof proto.showDVDisplay !== "function" || proto.showDVDisplay[`${MODULE_ID}DV`]) return false;
    const original = proto.showDVDisplay;
    const self = this;
    const show = async function () {
      try {
        return await self.showOn(this, original);
      } catch (err) {
        console.warn(`${MODULE_ID} | DV display`, err);
        return original.call(this);
      }
    };
    show[`${MODULE_ID}DV`] = true;
    proto.showDVDisplay = show;
    for (const h of ["createRollTable", "updateRollTable", "deleteRollTable", "updateSetting"]) Hooks.on(h, () => this.clear());
    return true;
  },

  /** What one weapon shows: { name, weaponType, table, autofire, upgrades }. */
  rowOf(item, actor) {
    const s = item.system ?? {};
    const upgrades = [...(s.upgrades ?? [])]
      .map((u) => actor.items.get(u._id ?? u.id))
      .filter((u) => u?.system?.isRanged && u.system?.isInstalled && u.system?.dvTable)
      .map((u) => ({ name: u.name, weaponType: u.system.weaponType, table: u.system.dvTable }));
    const af = Number(s.fireModes?.autoFire) > 0 || !!s.fireModes?.suppressiveFire;
    return { name: item.name, weaponType: s.weaponType, table: s.dvTable, autofire: af ? autofireTable(item) : "", upgrades };
  },

  async showOn(token, original) {
    if (!this.diwakoSetting("showDVDisplay", true)) return null;
    if (this.diwakoSetting("dvDisplayOnlyInCombat", true) && !game.combat?.started) return null;
    const box = token.dvDisplay;
    if (!box) return original.call(token);
    if (!box.parent) token.addChild(box);
    const from = canvas.tokens?.controlled?.[0];
    if (!from || from === token || !from.actor) return null;
    const dist = this.distance(from, token);
    const items = [...(from.actor.items ?? [])].filter((i) => i.system?.isRanged && i.system?.dvTable
      && (i.system.equipped === "equipped" || (i.type === "cyberware" && i.system.isInstalled)));
    const rows = items.map((i) => this.rowOf(i, from.actor));
    const tables = new Set(rows.flatMap((r) => [r.table, r.autofire, ...r.upgrades.map((u) => u.table)]).filter(Boolean));
    const dvs = new Map();
    for (const t of tables) dvs.set(t, await this.at(t, dist));
    const names = this.diwakoSetting("showWeaponNamesInDvDisplay", true) !== false;
    const lines = dvLines(rows, (t) => dvs.get(t), {
      names,
      typeLabel: (t) => game.i18n.localize(`CPR.global.weaponType.${TYPE_KEYS[t] ?? t}`),
      autofireLabel: "(Autofire)"
    });
    box.removeChildren().forEach((c) => c.destroy());
    if (!lines.length) return null;
    const text = lines.map((l) => game.i18n.format(`${DIWAKO_ID}.dv-display.dv-text`, { "weapon-name": l.label, "dv-value": l.dv })).join("");
    const right = this.diwakoSetting("dvDisplayPosition", "left") === "right";
    const style = CONFIG.canvasTextStyle.clone();
    style.align = right ? "left" : "right";
    const label = new Compat.PreciseText(text, style);
    label.anchor.set(1, 0);
    box.addChild(label);
    if (right) box.position.set(token.w + box.width + 15, 0);
    else box.position.set(-15, 0);
    return lines;
  }
};
