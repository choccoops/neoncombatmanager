/** Cover: the 2070 Cover HP table on walls and cover pieces, lines of fire, areas, damage and repair. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { makeActor, registerSettings, asGM, chat, root } from "./helpers/foundry.mjs";

const M = "cpr-neon-combat-manager";
await registerSettings();
const { coverHp, sectionCount, sectionAt, readWallCover, readPieceCover, coverOnLine, hitCover, splitAt, areaPlan } = await import("../scripts/cover/data.js");
const { Cover } = await import("../scripts/cover/cover.js");
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
