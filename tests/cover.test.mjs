/** Cover: the 2070 Cover HP table on walls and cover pieces, lines of fire, areas, damage and repair. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { makeActor, registerSettings, asGM, chat, root } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
await registerSettings();
const { coverHp, sectionCount, sectionAt, readWallCover, readPieceCover, coverOnLine, hitCover, splitAt, areaPlan, isVehicle, seatOf, readGlassCover, coverFor, pieceWalls, pieceBlocksSight } = await import("../scripts/cover/data.js");
const { Cover, ownWallFilter } = await import("../scripts/cover/cover.js");
const { CPR } = await import("../scripts/cpr.js");
const { readWall } = await import("../scripts/arsenal/xray.js");

// A 100px grid of 2 m/yds squares: a section is one square.
const GRID = { size: 100, distance: 2 };
const wallDoc = (id, c, cover = null, extra = {}) => ({ id, c, door: 0, ds: 0, move: 20, sight: 20, light: 20, sound: 20, flags: cover ? { [M]: { cover } } : {}, ...extra });

/** Foundry's embedded collections iterate their documents. */
class Docs extends Map {
  [Symbol.iterator]() {
    return this.values();
  }
}

/** A scene whose walls and tokens update like Foundry's. */
function scene({ walls = [], tokens = [] } = {}) {
  const s = { id: "s1", grid: { size: 100, distance: 2 }, walls: new Docs(), tokens: new Docs() };
  const wrap = (data) => {
    const doc = {
      ...structuredClone(data),
      parent: s,
      async update(u) {
        for (const [k, v] of Object.entries(u)) {
          const parts = k.split(".");
          const last = parts.pop();
          let at = this;
          for (const p of parts) at = at[p] ??= {};
          if (last.startsWith("-=")) delete at[last.slice(2)];
          else at[last] = structuredClone(v);
        }
        return this;
      },
      async delete() {
        s.walls.delete(this.id);
      },
      toObject() {
        const { parent, update, delete: d, toObject, ...rest } = this;
        return structuredClone({ ...rest, _id: rest.id });
      }
    };
    s.walls.set(doc.id, doc);
    return doc;
  };
  for (const w of walls) wrap(w);
  let n = 0;
  s.createEmbeddedDocuments = async (type, list) => list.map((d) => wrap({ ...d, id: `new${++n}` }));
  s.deleteEmbeddedDocuments = async (type, ids) => ids.forEach((id) => s.walls.delete(id));
  s.updateEmbeddedDocuments = async (type, list) => Promise.all(list.map(({ _id, ...u }) => s.walls.get(_id).update(u)));
  for (const t of tokens) s.tokens.set(t.id, { parent: s, alpha: 1, flags: {}, async update(u) {
    for (const [k, v] of Object.entries(u)) {
      if (k.includes("-=")) delete this.flags[M]?.[k.split("-=")[1]];
      else if (k.startsWith("flags.")) (this.flags[M] ??= {})[k.split(".").at(-1)] = v;
      else this[k] = v;
    }
  }, ...t });
  return s;
}

test("the 2070 Cover HP table, per 2×2m section", () => {
  assert.equal(coverHp("wood", "thin"), 5);
  assert.equal(coverHp("steel", "thick"), 50);
  assert.equal(coverHp("plaster", "thin"), 0, "an office wall stops nothing");
  assert.equal(coverHp("cardboard"), null);
  assert.equal(sectionCount([0, 0, 500, 0], GRID), 5, "10 m: five sections");
  assert.equal(sectionCount([0, 0, 30, 0], GRID), 1, "a short wall is still one section");
  assert.equal(sectionAt([0, 0, 500, 0], { x: 250, y: 0 }, 5), 2);
  assert.equal(sectionAt([0, 0, 500, 0], { x: 499, y: 3 }, 5), 4);
});

test("a wall read as cover: its material, its sections' HP, doors, open doors, destroyed walls", () => {
  const w = readWallCover(wallDoc("w", [0, 0, 300, 0], { material: "concrete", thickness: "thick", hp: [25, 7] }), GRID);
  assert.deepEqual(w.hp, [25, 7, 25], "untouched sections are at full");
  assert.equal(w.max, 25);
  assert.equal(readWallCover(wallDoc("x", [0, 0, 100, 0]), GRID), null, "untagged: not cover");
  const door = readWallCover(wallDoc("d", [0, 0, 100, 0], null, { door: 1 }), GRID);
  assert.equal(door.material, "wood");
  assert.equal(door.max, 5);
  assert.ok(door.implicit);
  assert.equal(readWallCover(wallDoc("d", [0, 0, 100, 0], null, { door: 1 }), { ...GRID, doorsWood: false }), null);
  assert.equal(readWallCover(wallDoc("o", [0, 0, 100, 0], { material: "steel" }, { door: 1, ds: 1 }), GRID), null, "an open door is no cover");
  assert.deepEqual(readWallCover(wallDoc("b", [0, 0, 100, 0], { material: "wood", thickness: "thin", broken: true }), GRID).hp, [0]);
  assert.deepEqual(readWallCover(wallDoc("c", [0, 0, 100, 0], { material: "wood", thickness: "thin", hp: [20] }), GRID).hp, [5], "never above the material's");
  // Thin cover of any material counts for Tech scopes.
  assert.equal(readWall(wallDoc("t", [0, 0, 100, 0], { material: "steel", thickness: "thin" }), { doorsThin: false }).thin, true);
  assert.equal(readWall(wallDoc("t", [0, 0, 100, 0], { material: "steel", thickness: "thick" }), { doorsThin: false }).thin, false);
});

test("a line of fire meets the nearest intact cover; the shooter's own, Thin cover for a charged Tech shot, and broken sections don't count", () => {
  const near = readWallCover(wallDoc("near", [150, -200, 150, 200], { material: "wood", thickness: "thin" }), GRID);
  const far = readWallCover(wallDoc("far", [600, -200, 600, 200], { material: "concrete", thickness: "thick" }), GRID);
  const from = { x: 50, y: 0 };
  const to = { x: 800, y: 0 };
  assert.deepEqual(coverOnLine(from, to, { walls: [near, far] }).map((h) => h.cover.id), ["near", "far"]);
  assert.deepEqual(coverOnLine(from, to, { walls: [near, far], lean: 120 }).map((h) => h.cover.id), ["far"], "leaning out from the near wall");
  assert.deepEqual(coverOnLine(from, to, { walls: [near, far], throughThin: true }).map((h) => h.cover.id), ["far"]);
  const hit = coverOnLine(from, to, { walls: [far] })[0];
  assert.equal(hit.section, 2, "the middle of a 4-section wall, where the line crosses");
  far.hp[2] = 0;
  assert.equal(coverOnLine(from, to, { walls: [far] }).length, 0, "a destroyed section is a gap");
  assert.equal(coverOnLine(from, { x: 500, y: 0 }, { walls: [far] }).length, 0, "cover past the target doesn't count");
  const piece = { kind: "piece", id: "table", hp: [5], box: { x: 300, y: -50, w: 100, h: 100 }, thickness: "thin" };
  assert.equal(coverOnLine(from, to, { pieces: [piece] })[0].cover.id, "table");
  assert.equal(coverOnLine(from, to, { pieces: [piece], exclude: ["table"] }).length, 0);
});

test("damage to cover: no armor, destroyed at 0 but it soaks the shot, unless an explosive; rockets double it", () => {
  assert.deepEqual(hitCover(25, 10), { before: 25, after: 15, taken: 10, destroyed: false, soaks: true });
  assert.deepEqual(hitCover(5, 18), { before: 5, after: 0, taken: 18, destroyed: true, soaks: true }, "the shot that breaks it is soaked");
  assert.equal(hitCover(5, 18, { explosive: true }).soaks, false, "a blast carries on to whoever is behind");
  assert.equal(hitCover(25, 14, { explosive: true, bunkerBuster: true }).after, 0, "28 against cover");
  assert.equal(hitCover(25, 14, { explosive: true }).soaks, true);
});

test("a wall split around a destroyed section keeps each part's HP", () => {
  const p = splitAt([0, 0, 500, 0], 2, 5, [25, 20, 0, 25, 3]);
  assert.deepEqual(p.before, { c: [0, 0, 200, 0], hp: [25, 20] });
  assert.deepEqual(p.section.c, [200, 0, 300, 0]);
  assert.deepEqual(p.after, { c: [300, 0, 500, 0], hp: [25, 3] });
  assert.equal(splitAt([0, 0, 200, 0], 0, 2, [0, 25]).before, null);
});

test("an area: cover between the blast and each person takes it once; destroyed by an explosive, it lets the blast through; a shell's cover always soaks", () => {
  const wall = readWallCover(wallDoc("w", [300, -100, 300, 100], { material: "wood", thickness: "thin" }), GRID);
  const people = [{ id: "a", center: { x: 400, y: 0 } }, { id: "b", center: { x: 400, y: 40 } }, { id: "c", center: { x: 0, y: 300 } }];
  let plan = areaPlan({ origin: { x: 100, y: 0 }, people, walls: [wall], damage: 18, explosive: true });
  assert.equal(plan.cover.length, 1, "one section, hit once for both behind it");
  assert.equal(plan.hit.a.hit, true, "18 breaks 5 HP of wood: the blast goes through");
  assert.equal(plan.hit.c.hit, true);
  assert.equal(plan.hit.c.behind, null);
  plan = areaPlan({ origin: { x: 100, y: 0 }, people, walls: [readWallCover(wallDoc("w", [300, -100, 300, 100], { material: "steel", thickness: "thick" }), GRID)], damage: 18, explosive: true });
  assert.equal(plan.hit.a.hit, false, "steel holds: shielded");
  plan = areaPlan({ origin: { x: 100, y: 0 }, people, walls: [wall], damage: 18, explosive: false });
  assert.equal(plan.hit.a.hit, false, "a shell's spread stops at cover even when it breaks it");
  const crate = { kind: "piece", id: "crate", hp: [20], box: { x: 900, y: 900, w: 100, h: 100 }, thickness: "thick" };
  plan = areaPlan({ origin: { x: 100, y: 0 }, people: [], pieces: [crate], piecesInside: [crate], damage: 10 });
  assert.equal(plan.cover[0].result.after, 10, "a piece inside the area takes it");
});

test("a cover piece: an actor flagged as cover, its HP the piece's; a ride's SP and SDP; not a person", () => {
  const table = makeActor({ name: "Overturned Table", type: "mook", system: { derivedStats: { hp: { value: 5, max: 5 } } } });
  table.flags[M] = { cover: { material: "wood", thickness: "thin" } };
  const piece = readPieceCover({ id: "t1", x: 300, y: 0, width: 1, height: 1, actor: table }, GRID);
  assert.deepEqual(piece.box, { x: 300, y: 0, w: 100, h: 100 });
  assert.equal(piece.hp[0], 5);
  assert.equal(CPR.isMeat(table), false, "no Wound States, no Biomon, no death saves");
  const van = makeActor({ name: "Van", type: "mook", system: { derivedStats: { hp: { value: 50, max: 50 } } } });
  van.flags["mmutons-cyberpunk-red-vas"] = { positions: [] };
  assert.equal(readPieceCover({ id: "v", x: 0, y: 0, width: 2, height: 2, actor: van }, GRID).kind, "vehicle");
  assert.equal(readPieceCover({ id: "p", x: 0, y: 0, actor: makeActor({ name: "Rico" }) }, GRID), null);
});

test("the GM damages a wall section; destroying one in the middle opens a gap tokens walk and see through", async () => {
  asGM();
  const s = scene({ walls: [wallDoc("w", [0, 0, 500, 0], { material: "wood", thickness: "thick" })] });
  game.scenes.set("s1", s);
  const before = chat.length;
  let r = await Cover.damageAsGM({ scene: "s1", kind: "wall", id: "w", section: 2, amount: 12 });
  assert.equal(r.after, 8);
  assert.deepEqual(s.walls.get("w").flags[M].cover.hp, [20, 20, 8, 20, 20]);
  assert.equal(chat.length, before + 1, "a card says what the cover took");
  r = await Cover.damageAsGM({ scene: "s1", kind: "wall", id: "w", section: 2, amount: 9, quiet: true });
  assert.ok(r.destroyed);
  const walls = [...s.walls.values()];
  assert.equal(walls.length, 3, "before, the gap, after");
  assert.deepEqual(s.walls.get("w").c, [0, 0, 200, 0]);
  assert.deepEqual(s.walls.get("w").flags[M].cover.hp, [20, 20]);
  const gap = walls.find((w) => w.flags[M].cover.broken);
  assert.deepEqual(gap.c, [200, 0, 300, 0]);
  assert.deepEqual([gap.move, gap.sight, gap.light, gap.sound], [0, 0, 0, 0], "walk, see and shoot through it");
  assert.equal(gap.flags[M].cover.restore.move, 20);
  const after = walls.find((w) => w !== gap && w.id !== "w");
  assert.deepEqual(after.c, [300, 0, 500, 0]);
  assert.deepEqual(after.flags[M].cover.hp, [20, 20]);
  // Repair: the gap blocks again, every section back to full.
  const n = await Cover.repairAsGM({ scene: "s1" });
  assert.equal(n, 1, "the gap: the rest of the wall was never hit");
  assert.deepEqual([gap.move, gap.sight], [20, 20]);
  assert.equal(gap.flags[M].cover.broken, undefined);
  assert.equal(s.walls.get("w").flags[M].cover.hp, undefined);
  assert.equal(s.walls.get("w").flags[M].cover.material, "wood");
  game.scenes.delete("s1");
});

test("a one-section wall, or a door, destroyed: the wall itself stops blocking until repaired", async () => {
  asGM();
  const s = scene({ walls: [wallDoc("d", [0, 0, 100, 0], null, { door: 1 })] });
  game.scenes.set("s1", s);
  const r = await Cover.damageAsGM({ scene: "s1", kind: "wall", id: "d", section: 0, amount: 6, quiet: true });
  assert.ok(r.destroyed, "a door is Wood (Thin): 5 HP");
  const d = s.walls.get("d");
  assert.deepEqual([d.move, d.sight, d.door], [0, 0, 0]);
  await Cover.repairAsGM({ scene: "s1" });
  assert.deepEqual([d.move, d.sight, d.door], [20, 20, 1], "the door is back");
  game.scenes.delete("s1");
});

test("a cover piece takes the damage on its HP and fades when destroyed; repair brings it back", async () => {
  asGM();
  const table = makeActor({ name: "Overturned Table", type: "mook", system: { derivedStats: { hp: { value: 5, max: 5 } } } });
  table.flags[M] = { cover: { material: "wood", thickness: "thin" } };
  const s = scene({ tokens: [{ id: "t1", name: "Overturned Table", x: 0, y: 0, width: 1, height: 1, actor: table }] });
  game.scenes.set("s1", s);
  const r = await Cover.damageAsGM({ scene: "s1", kind: "piece", id: "t1", amount: 9, quiet: true });
  assert.ok(r.destroyed);
  assert.equal(table.system.derivedStats.hp.value, 0);
  assert.equal(s.tokens.get("t1").alpha, 0.35);
  await Cover.repairAsGM({ scene: "s1" });
  assert.equal(table.system.derivedStats.hp.value, 5);
  assert.equal(s.tokens.get("t1").alpha, 1);
  game.scenes.delete("s1");
});

test("tagging: the selected walls, every untagged one, or untagging", async () => {
  asGM();
  const s = scene({ walls: [wallDoc("a", [0, 0, 100, 0]), wallDoc("b", [0, 0, 100, 0], { material: "steel", thickness: "thick" }), wallDoc("c", [0, 0, 100, 0])] });
  game.scenes.set("s1", s);
  assert.equal(await Cover.tagAsGM({ scene: "s1", scope: "selected", ids: ["a"], material: "concrete", thickness: "thin" }), 1);
  assert.deepEqual(s.walls.get("a").flags[M].cover, { material: "concrete", thickness: "thin" });
  assert.equal(await Cover.tagAsGM({ scene: "s1", scope: "untagged", material: "wood", thickness: "thick" }), 1, "only c");
  assert.equal(s.walls.get("b").flags[M].cover.material, "steel");
  assert.equal(await Cover.tagAsGM({ scene: "s1", scope: "all", material: "" }), 3);
  assert.equal(s.walls.get("b").flags[M].cover, undefined);
  game.scenes.delete("s1");
});

test("shooting a cover piece itself: the piece takes the shot", () => {
  const crate = makeActor({ name: "Crate", type: "mook", system: { derivedStats: { hp: { value: 20, max: 20 } } } });
  crate.flags[M] = { cover: { material: "wood", thickness: "thick" } };
  const s = scene({ tokens: [{ id: "c1", name: "Crate", x: 300, y: 0, width: 1, height: 1, actor: crate }] });
  const ref = Cover.forShot({ x: 0, y: 0, width: 1, height: 1, id: "me", parent: s }, s.tokens.get("c1"));
  assert.equal(ref.kind, "piece");
  assert.ok(ref.self);
  assert.equal(ref.hp, 20);
});

test("the Cover compendium: a piece and a wall section for every material and thickness, at the book's HP, each with its token art", () => {
  const dir = path.join(root, "packs", "_source", "cover");
  const actors = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(path.join(dir, f), "utf8")));
  assert.equal(actors.length, 20);
  assert.equal(new Set(actors.map((a) => a._id)).size, 20, "ids are unique");
  for (const material of ["plaster", "wood", "concrete", "glass", "stone", "steel"]) {
    for (const thickness of ["thin", "thick"]) {
      const of = actors.filter((a) => a.flags[M].cover.material === material && a.flags[M].cover.thickness === thickness);
      assert.ok(of.length >= 1, `${material} ${thickness}`);
      assert.ok(of.some((a) => a.prototypeToken.width === 2 && a.prototypeToken.height === 1), `${material} ${thickness}: a 2-square wall section`);
      for (const a of of) {
        assert.equal(a.system.derivedStats.hp.max, coverHp(material, thickness), a.name);
        assert.equal(a.type, "mook");
        assert.equal(a.prototypeToken.bar1.attribute, "derivedStats.hp");
        assert.ok(existsSync(path.join(root, a.img.replace(`modules/${M}/`, ""))), `${a.name}: ${a.img}`);
        assert.equal(a.prototypeToken.texture.src, a.img);
      }
    }
  }
});

/* ---------------------------------------- */
/*  Your ride as cover (HOUSE RULE)         */
/* ---------------------------------------- */

const VAS = "mmutons-cyberpunk-red-vas";
const seats = (glass = 15) => [
  { id: "drv", name: "Driver's Seat", occupants: ["Actor.rico"], bulletproofGlass: glass > 0, glassHpMax: glass, glassHp: glass },
  { id: "back", name: "Back Seat", occupants: ["Actor.vee"], bulletproofGlass: false, glassHpMax: 0 }
];

test("what's a ride: MMuton's vehicle sheet, or a Neon Hub 2070s vehicle; not a cyberpet or a person", () => {
  assert.ok(isVehicle({ flags: { [VAS]: { positions: [] } } }));
  assert.ok(isVehicle({ flags: { core: { sheetClass: `${VAS}.VehicleSheet` } } }));
  assert.ok(isVehicle({ flags: { "cpr-neon-hub": { vehicle2070: { kind: "land" } } } }));
  assert.equal(isVehicle({ flags: { "cpr-neon-hub": { pet2070: true } } }), false);
  assert.equal(isVehicle(makeActor({ name: "Rico" })), false);
});

test("a ride takes it as a vehicle does: its SP first, then its SDP; a rocket's double counts past the SP", () => {
  assert.deepEqual(hitCover(50, 20, { sp: 13 }), { before: 50, after: 43, taken: 7, destroyed: false, soaks: true });
  assert.equal(hitCover(50, 12, { sp: 13 }).taken, 0, "under its SP: nothing gets through");
  assert.equal(hitCover(50, 20, { sp: 13, bunkerBuster: true }).taken, 14, "Bunker Buster: double what gets past the SP");
  assert.equal(hitCover(5, 40, { sp: 13, explosive: true }).soaks, false, "a blast that wrecks it hits whoever's behind");
  const van = makeActor({ name: "Van", type: "mook", system: { derivedStats: { hp: { value: 50, max: 50 } } } });
  van.flags[VAS] = { positions: [] };
  const cover = readPieceCover({ id: "v", name: "Van", x: 0, y: 0, width: 2, height: 2, actor: van }, { ...GRID, sp: 13 });
  assert.equal(cover.sp, 13);
  assert.equal(cover.hp[0], 50);
});

test("inside a ride, normal cover rules: the seat's bulletproof glass, Thin or Thick; no glass, no cover", () => {
  assert.equal(seatOf(seats(), "Actor.rico").position.id, "drv");
  assert.equal(seatOf(seats(), "Actor.nobody"), null);
  const tok = { id: "v", name: "Kaukaz" };
  const glass = readGlassCover(tok, seatOf(seats(), "Actor.rico"));
  assert.deepEqual([glass.kind, glass.seat, glass.thickness, glass.hp[0]], ["glass", "drv", "thin", 15]);
  assert.equal(readGlassCover(tok, seatOf(seats(30), "Actor.rico")).thickness, "thick", "two installs: Thick, 30 HP");
  assert.equal(readGlassCover(tok, seatOf(seats(), "Actor.vee")), null, "the back seat's windows are no cover");
  assert.equal(readGlassCover(tok, { position: { ...seats()[0], glassHp: 0 } }), null, "shot out");
});

test("the line of fire with rides: behind one, its SP and SDP; in one, the seat's glass; cover out past it still counts", () => {
  const van = { kind: "vehicle", id: "van", name: "Van", sp: 13, hp: [50], max: 50, box: { x: 400, y: -100, w: 200, h: 200 } };
  const from = { x: 0, y: 0 };
  assert.equal(coverFor(from, { x: 800, y: 0 }, { pieces: [van] }).cover.id, "van", "crouched behind it");
  const glass = { kind: "glass", id: "van", seat: "drv", thickness: "thin", hp: [15], max: 15 };
  assert.equal(coverFor(from, { x: 500, y: 0 }, { pieces: [van], ride: "van", glass }).cover.kind, "glass", "in the driver's seat");
  assert.equal(coverFor(from, { x: 500, y: 0 }, { pieces: [van], ride: "van" }), null, "in the back seat: windows aren't cover");
  assert.equal(coverFor(from, { x: 500, y: 0 }, { pieces: [van], ride: "van", glass, throughThin: true }), null, "a charged Tech shot goes through Thin glass");
  const wall = readWallCover(wallDoc("w", [200, -200, 200, 200], { material: "concrete", thickness: "thick" }), GRID);
  assert.equal(coverFor(from, { x: 500, y: 0 }, { walls: [wall], pieces: [van], ride: "van", glass }).cover.id, "w", "a wall before the van comes first");
  const plan = areaPlan({ origin: from, people: [{ id: "rico", center: { x: 500, y: 0 }, ride: "van", glass }], pieces: [van], damage: 10, explosive: true });
  assert.equal(plan.hit.rico.hit, false, "the glass takes 10 of 15");
  assert.equal(plan.cover[0].cover.kind, "glass");
});

test("the GM's damage to a ride goes through CPR's own (a rocket hands it SP plus double the rest); to its glass, onto the seat", async () => {
  asGM();
  const van = makeActor({ name: "Kaukaz", type: "mook", system: { derivedStats: { hp: { value: 50, max: 50 } }, externalData: { currentArmorBody: { value: 13 } } } });
  van.flags[VAS] = { positions: seats() };
  const handed = [];
  van._applyDamage = async (amount) => {
    handed.push(amount);
    van.system.derivedStats.hp.value -= Math.max(0, amount - 13);
  };
  const rico = makeActor({ _id: "rico", name: "Rico" });
  const s = scene({ tokens: [{ id: "v", name: "Kaukaz", x: 400, y: -100, width: 2, height: 2, actor: van }, { id: "r", name: "Rico", x: 450, y: -50, width: 1, height: 1, actor: rico }] });
  game.scenes.set("s1", s);
  let r = await Cover.damageAsGM({ scene: "s1", kind: "vehicle", id: "v", amount: 20, quiet: true });
  assert.deepEqual(handed, [20]);
  assert.equal(r.after, 43);
  assert.equal(r.label, "Kaukaz (SP 13)");
  await Cover.damageAsGM({ scene: "s1", kind: "vehicle", id: "v", amount: 20, bunkerBuster: true, quiet: true });
  assert.deepEqual(handed, [20, 27], "13 + 2 × 7");
  assert.deepEqual(Cover.riding(s.tokens.get("r"), s), { ride: "v", glass: readGlassCover(s.tokens.get("v"), seatOf(seats(), "Actor.rico")) });
  r = await Cover.damageAsGM({ scene: "s1", kind: "glass", id: "v", section: "drv", amount: 9, quiet: true });
  assert.equal(r.after, 6);
  assert.equal(van.flags[VAS].positions.find((p) => p.id === "drv").glassHp, 6);
  assert.equal(van.flags[VAS].positions.find((p) => p.id === "back").occupants[0], "Actor.vee", "the other seats untouched");
  game.scenes.delete("s1");
});

/* ---------------------------------------- */
/*  Cover pieces as barriers                */
/* ---------------------------------------- */

const pieceActor = (name, material, thickness, hp = 20) => {
  const a = makeActor({ name, type: "mook", system: { derivedStats: { hp: { value: hp, max: hp } } } });
  a.flags[M] = { cover: { material, thickness } };
  return a;
};

test("a cover piece's walls: its outline stops movement only; a tall piece adds a sight line down its length; none when destroyed", () => {
  const table = { id: "t", x: 100, y: 100, width: 1, height: 1, rotation: 0, actor: pieceActor("Overturned Table", "wood", "thin", 5) };
  const walls = pieceWalls(table, GRID);
  assert.equal(walls.length, 4, "a low piece: the outline only");
  assert.ok(walls.every((w) => w.move === 20 && w.sight === 0 && w.light === 0), "you see over a table");
  assert.deepEqual(walls[0].c, [110, 110, 190, 110], "pulled in a tenth of a square, so its corners can be passed");
  // Someone walking from the square on its left into it crosses the outline; someone walking past doesn't.
  const crosses = (a, b) => walls.some((w) => coverOnLine(a, b, { walls: [{ c: w.c, n: 1, hp: [1], thickness: "thick" }] }).length);
  assert.ok(crosses({ x: 50, y: 150 }, { x: 150, y: 150 }));
  assert.ok(!crosses({ x: 50, y: 150 }, { x: 50, y: 250 }));
  assert.ok(!crosses({ x: 50, y: 150 }, { x: 150, y: 50 }), "a diagonal step past its corner");

  const fence = { id: "f", x: 0, y: 0, width: 2, height: 1, rotation: 0, actor: pieceActor("Wooden Fence", "wood", "thin", 5) };
  const tall = pieceWalls(fence, GRID);
  assert.equal(tall.length, 5);
  assert.deepEqual(tall[4], { c: [10, 50, 190, 50], move: 0, sight: 20, light: 20, sound: 0, thin: true }, "sight and light, marked thin for Tech scopes");
  assert.deepEqual(pieceWalls({ ...fence, rotation: 90 }, GRID)[4].c, [100, -40, 100, 140], "turned with the token");
  assert.ok(readWall({ c: tall[4].c, sight: 20, flags: { [M]: { thinCover: true } } }).thin);

  assert.ok(!pieceBlocksSight(pieceActor("Armored Glass Barrier", "glass", "thick")), "glass is seen through");
  const flagged = pieceActor("Crate", "wood", "thick");
  flagged.flags[M].cover.sight = true;
  assert.ok(pieceBlocksSight(flagged), "a piece's own flag wins");
  assert.deepEqual(pieceWalls({ ...table, flags: { [M]: { coverDestroyed: true } } }, GRID), []);
  assert.deepEqual(pieceWalls({ id: "p", x: 0, y: 0, actor: makeActor({ name: "V" }) }, GRID), [], "a person is no barrier");
});

test("the GM keeps each piece's walls in step: placed, moved, destroyed (opens), repaired, removed", async () => {
  asGM();
  const table = pieceActor("Overturned Table", "wood", "thin", 5);
  const s = scene({ walls: [wallDoc("w", [0, 0, 100, 0])], tokens: [{ id: "t1", name: "Overturned Table", x: 0, y: 0, width: 1, height: 1, actor: table }] });
  game.scenes.set("s1", s);
  const mine = () => [...s.walls].filter((w) => w.flags?.[M]?.piece);
  assert.equal(await Cover.syncPiecesNow(s), 4);
  assert.equal(mine().length, 4);
  assert.ok(mine().every((w) => w.move === 20 && w.sight === 0 && w.flags[M].piece.token === "t1"));
  assert.equal(await Cover.syncPiecesNow(s), 0, "nothing to do twice");
  s.tokens.get("t1").x = 200;
  assert.equal(await Cover.syncPiecesNow(s), 4, "moved with the token");
  assert.deepEqual(mine().find((w) => w.flags[M].piece.i === 0).c, [210, 10, 290, 10]);
  assert.equal(await Cover.tagAsGM({ scene: "s1", scope: "all", material: "steel" }), 1, "a piece's walls are never tagged as cover");
  await Cover.damageAsGM({ scene: "s1", kind: "piece", id: "t1", amount: 9, quiet: true });
  await Cover.syncPiecesNow(s);
  assert.equal(mine().length, 0, "destroyed: people walk through");
  await Cover.repairAsGM({ scene: "s1" });
  await Cover.syncPiecesNow(s);
  assert.equal(mine().length, 4, "repaired: a barrier again");
  s.tokens.delete("t1");
  await Cover.syncPiecesNow(s);
  assert.equal(mine().length, 0);
  assert.equal(s.walls.size, 1, "the map's own walls are left alone");
  game.scenes.delete("s1");
});

test("a piece being dragged isn't stopped by its own walls, only by others", () => {
  const edge = (token) => ({ object: token ? { document: { flags: { [M]: { piece: { token, i: 0 } } } } } : { document: { flags: {} } } });
  const tokenOf = (e) => Cover.pieceOf(e.object)?.token;
  const hits = [{ edges: new Set([edge("t1")]) }, { edges: new Set([edge(null)]) }, { edges: new Set([edge("t2")]) }];
  assert.equal(ownWallFilter(hits, "t1", tokenOf).length, 2, "the map's wall and another piece's still stop it");
  assert.equal(ownWallFilter([hits[0]], "t1", tokenOf).length, 0);
});
