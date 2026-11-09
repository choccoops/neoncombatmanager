// Neon Cover: the cover pieces' token art (assets/cover/*.svg) and their actors
// (packs/_source/cover/*.json). One piece per material and thickness, each one of the 2070 Cover
// HP table's own examples, and a wall section for every material and thickness, drawn top-down for
// the map. Run with `node tools/gen-cover.mjs`.
import { createHash } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const MODULE_ID = "cpr-neon-combat-manager";
const HP = { plaster: [0, 15], wood: [5, 20], concrete: [10, 25], glass: [15, 30], stone: [20, 40], steel: [25, 50] };
const B62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const id = (s) => {
  let h = BigInt(`0x${createHash("sha1").update(`ncm-cover|${s}`).digest("hex")}`);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += B62[Number(h % 62n)];
    h /= 62n;
  }
  return out;
};

const NEON = { pink: "#ff2a6d", cyan: "#05d9e8", yellow: "#f9f871" };
const glow = `<defs><filter id="g" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="6" stdDeviation="6" flood-color="#000" flood-opacity="0.65"/></filter></defs>`;
const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${glow}${body}</svg>\n`;
/** A neon rim around a shape (drawn twice: a soft glow, then the line). */
const rim = (shape, color) => `<g fill="none" stroke="${color}" stroke-width="6" filter="url(#g)" opacity="0.9">${shape}</g>`;

/** Each piece: [material, thickness, name, width, height (squares), art(w, h)]. */
const PIECES = [
  ["plaster", "thin", "Office Partition", 2, 1, (w, h) => {
    const p = `<rect x="18" y="${h / 2 - 22}" width="${w - 36}" height="44" rx="6"/>`;
    const seams = [1, 2, 3].map((i) => `<line x1="${18 + ((w - 36) / 4) * i}" y1="${h / 2 - 22}" x2="${18 + ((w - 36) / 4) * i}" y2="${h / 2 + 22}" stroke="#9aa3b5" stroke-width="3"/>`).join("");
    return `<g filter="url(#s)"><g fill="#e4e6ef" stroke="#7c8396" stroke-width="3">${p}</g>${seams}</g>${rim(p, NEON.cyan)}`;
  }],
  ["plaster", "thick", "Sofa", 2, 1, (w, h) => {
    const back = `<rect x="16" y="40" width="${w - 32}" height="52" rx="22"/>`;
    const seat = `<rect x="16" y="78" width="${w - 32}" height="${h - 110}" rx="26"/>`;
    const cushions = [0, 1, 2].map((i) => `<rect x="${44 + i * ((w - 88) / 3)}" y="98" width="${(w - 88) / 3 - 10}" height="${h - 150}" rx="16" fill="#8a3b6a"/>`).join("");
    const arms = `<rect x="10" y="46" width="44" height="${h - 84}" rx="20"/><rect x="${w - 54}" y="46" width="44" height="${h - 84}" rx="20"/>`;
    return `<g filter="url(#s)" fill="#6d2c55" stroke="#2b0f22" stroke-width="4">${back}${seat}${arms}</g>${cushions}${rim(`<rect x="10" y="40" width="${w - 20}" height="${h - 74}" rx="26"/>`, NEON.pink)}`;
  }],
  ["wood", "thin", "Overturned Table", 1, 1, (w, h) => {
    const top = `<rect x="36" y="70" width="${w - 72}" height="${h - 140}" rx="8"/>`;
    const grain = [0, 1, 2, 3].map((i) => `<path d="M 44 ${96 + i * 22} Q ${w / 2} ${88 + i * 22} ${w - 44} ${98 + i * 22}" stroke="#7a4b22" stroke-width="3" fill="none"/>`).join("");
    const legs = [[52, 52], [w - 52, 52], [52, h - 52], [w - 52, h - 52]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="#5b3415" stroke="#2c1708" stroke-width="3"/>`).join("");
    return `<g filter="url(#s)"><g fill="#b67b3f" stroke="#4a2a10" stroke-width="4">${top}</g>${grain}${legs}</g>${rim(top, NEON.yellow)}`;
  }],
  ["wood", "thick", "Bar Counter", 2, 1, (w, h) => {
    const bar = `<rect x="14" y="56" width="${w - 28}" height="${h - 112}" rx="14"/>`;
    const planks = [1, 2, 3, 4, 5, 6, 7].map((i) => `<line x1="${14 + ((w - 28) / 8) * i}" y1="60" x2="${14 + ((w - 28) / 8) * i}" y2="${h - 60}" stroke="#4a2a10" stroke-width="3"/>`).join("");
    const glasses = [0.2, 0.42, 0.7].map((t) => `<circle cx="${w * t}" cy="${h / 2}" r="12" fill="${NEON.cyan}" opacity="0.55" stroke="#dff" stroke-width="2"/>`).join("");
    return `<g filter="url(#s)"><g fill="#8c5426" stroke="#3a1f0a" stroke-width="5">${bar}</g>${planks}<rect x="14" y="56" width="${w - 28}" height="16" fill="#5b3415"/>${glasses}</g>${rim(bar, NEON.pink)}`;
  }],
  ["concrete", "thin", "Low Brick Wall", 2, 1, (w, h) => {
    const wall = `<rect x="14" y="${h / 2 - 30}" width="${w - 28}" height="60" rx="4"/>`;
    const bricks = [];
    for (let row = 0; row < 3; row++) {
      for (let x = 14 + (row % 2 ? 0 : 30); x < w - 14; x += 60) bricks.push(`<rect x="${x}" y="${h / 2 - 30 + row * 20}" width="56" height="18" fill="#a4553c" stroke="#5a2a1c" stroke-width="2"/>`);
    }
    return `<clipPath id="c">${wall}</clipPath><g filter="url(#s)"><g fill="#7e3d29">${wall}</g><g clip-path="url(#c)">${bricks.join("")}</g></g>${rim(wall, NEON.yellow)}`;
  }],
  ["concrete", "thick", "Dataterm", 1, 1, (w, h) => {
    const body = `<rect x="58" y="44" width="${w - 116}" height="${h - 88}" rx="18"/>`;
    const screen = `<rect x="78" y="66" width="${w - 156}" height="62" rx="6" fill="#071a24" stroke="${NEON.cyan}" stroke-width="3"/>`;
    const lines = [0, 1, 2].map((i) => `<rect x="88" y="${78 + i * 16}" width="${(w - 176) * (1 - i * 0.25)}" height="6" fill="${NEON.cyan}" opacity="0.8"/>`).join("");
    const keys = [0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => `<rect x="${86 + c * 22}" y="${150 + r * 20}" width="16" height="14" rx="2" fill="#4c5560"/>`).join("")).join("");
    return `<g filter="url(#s)"><g fill="#9aa0a6" stroke="#3d4248" stroke-width="5">${body}</g>${screen}${lines}${keys}</g>${rim(body, NEON.cyan)}`;
  }],
  ["glass", "thin", "Teller Glass", 2, 1, (w, h) => {
    const pane = `<rect x="16" y="${h / 2 - 12}" width="${w - 32}" height="24" rx="4"/>`;
    const frame = `<rect x="10" y="${h / 2 - 22}" width="20" height="44" fill="#55606d"/><rect x="${w - 30}" y="${h / 2 - 22}" width="20" height="44" fill="#55606d"/><rect x="${w / 2 - 10}" y="${h / 2 - 22}" width="20" height="44" fill="#55606d"/>`;
    const shine = `<line x1="60" y1="${h / 2 - 6}" x2="140" y2="${h / 2 - 6}" stroke="#fff" stroke-width="3" opacity="0.7"/><line x1="${w - 160}" y1="${h / 2 + 4}" x2="${w - 80}" y2="${h / 2 + 4}" stroke="#fff" stroke-width="3" opacity="0.5"/>`;
    return `<g filter="url(#s)"><g fill="#9ff3ff" fill-opacity="0.45" stroke="#bff" stroke-width="2">${pane}</g>${frame}${shine}</g>${rim(pane, NEON.cyan)}`;
  }],
  ["glass", "thick", "Armored Glass Barrier", 2, 1, (w, h) => {
    const pane = `<rect x="16" y="${h / 2 - 34}" width="${w - 32}" height="68" rx="10"/>`;
    const layers = [0, 1].map((i) => `<rect x="${26 + i * 8}" y="${h / 2 - 26 + i * 8}" width="${w - 52 - i * 16}" height="${52 - i * 16}" rx="8" fill="none" stroke="#dff" stroke-width="2" opacity="0.6"/>`).join("");
    const bolts = [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => `<circle cx="${16 + (w - 32) * t}" cy="${h / 2 - 34}" r="6" fill="#3d4652"/><circle cx="${16 + (w - 32) * t}" cy="${h / 2 + 34}" r="6" fill="#3d4652"/>`).join("");
    return `<g filter="url(#s)"><g fill="#6fe7f5" fill-opacity="0.4" stroke="#2c6f79" stroke-width="5">${pane}</g>${layers}${bolts}</g>${rim(pane, NEON.cyan)}`;
  }],
  ["stone", "thin", "Statue", 1, 1, (w, h) => {
    const plinth = `<rect x="42" y="42" width="${w - 84}" height="${h - 84}" rx="10"/>`;
    const figure = `<circle cx="${w / 2}" cy="${h / 2 - 26}" r="26" fill="#d9d2c0" stroke="#6e6656" stroke-width="3"/><path d="M ${w / 2 - 52} ${h / 2 + 8} Q ${w / 2} ${h / 2 - 22} ${w / 2 + 52} ${h / 2 + 8} L ${w / 2 + 34} ${h / 2 + 60} L ${w / 2 - 34} ${h / 2 + 60} Z" fill="#cfc7b2" stroke="#6e6656" stroke-width="3"/>`;
    return `<g filter="url(#s)"><g fill="#a49b86" stroke="#5c5444" stroke-width="5">${plinth}</g>${figure}</g>${rim(plinth, NEON.yellow)}`;
  }],
  ["stone", "thick", "Boulder", 1, 1, (w, h) => {
    const rock = `<path d="M 62 92 L 104 46 L 168 42 L 214 84 L 222 150 L 186 212 L 112 220 L 52 178 Z"/>`;
    const facets = `<path d="M 104 46 L 128 116 L 214 84 M 128 116 L 112 220 M 128 116 L 52 178 M 128 116 L 222 150" stroke="#6e6656" stroke-width="3" fill="none"/>`;
    return `<g filter="url(#s)"><g fill="#9b937f" stroke="#4d473a" stroke-width="5">${rock}</g>${facets}<path d="M 104 46 L 168 42 L 214 84 L 128 116 Z" fill="#b9b19c" opacity="0.8"/></g>${rim(rock, NEON.pink)}`;
  }],
  ["steel", "thin", "Car Door", 1, 1, (w, h) => {
    const door = `<path d="M 40 70 L 196 58 Q 222 60 222 92 L 222 178 Q 222 200 198 200 L 40 200 Z"/>`;
    const window = `<path d="M 60 80 L 180 72 Q 196 74 196 92 L 196 118 L 60 118 Z" fill="#163847" stroke="${NEON.cyan}" stroke-width="3" opacity="0.9"/>`;
    const handle = `<rect x="150" y="140" width="40" height="10" rx="5" fill="#cfd6df"/>`;
    return `<g filter="url(#s)"><g fill="#c0303f" stroke="#4a0e15" stroke-width="5">${door}</g>${window}${handle}<line x1="40" y1="130" x2="222" y2="130" stroke="#7a1b25" stroke-width="3"/></g>${rim(door, NEON.cyan)}`;
  }],
  ["steel", "thick", "Engine Block", 1, 1, (w, h) => {
    const block = `<rect x="44" y="56" width="${w - 88}" height="${h - 112}" rx="12"/>`;
    const cylinders = [0, 1, 2, 3].map((i) => `<circle cx="${82 + i * 31}" cy="${h / 2}" r="12" fill="#2f353d" stroke="#9aa6b5" stroke-width="3"/>`).join("");
    const pipes = `<path d="M 44 92 Q 20 92 20 120 L 20 170" stroke="#9aa6b5" stroke-width="8" fill="none"/><rect x="62" y="68" width="${w - 124}" height="14" rx="4" fill="#5b6672"/>`;
    return `<g filter="url(#s)"><g fill="#6f7b8a" stroke="#262b31" stroke-width="5">${block}</g>${cylinders}${pipes}</g>${rim(block, NEON.pink)}`;
  }]
];

/** A row of irregular stones along a wall, seeded so they come out the same every run. */
const stones = (w, h, { rows, top, height, seed, fill, line }) => {
  let r = seed;
  const rand = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  const out = [];
  const rh = height / rows;
  for (let row = 0; row < rows; row++) {
    let x = 18 + (row % 2) * 14;
    while (x < w - 30) {
      const sw = Math.min(w - 18 - x, 34 + rand() * 40);
      const y = top + row * rh;
      out.push(`<rect x="${x + 2}" y="${y + 2}" width="${sw - 4}" height="${rh - 4}" rx="${8 + rand() * 8}" fill="${fill[Math.floor(rand() * fill.length)]}" stroke="${line}" stroke-width="2"/>`);
      x += sw;
    }
  }
  return out.join("");
};

/**
 * Wall sections, one for each material and thickness the pieces above don't already draw as a wall
 * (the Office Partition, Low Brick Wall, Teller Glass and Armored Glass Barrier are walls already):
 * a 2-square stretch to drop along a line, or to stand in for a wall you haven't drawn.
 */
const WALLS = [
  ["plaster", "thick", "Interior Wall", 2, 1, (w, h) => {
    const wall = `<rect x="14" y="${h / 2 - 34}" width="${w - 28}" height="68" rx="4"/>`;
    const seams = [1, 2, 3].map((i) => `<line x1="${14 + ((w - 28) / 4) * i}" y1="${h / 2 - 34}" x2="${14 + ((w - 28) / 4) * i}" y2="${h / 2 + 34}" stroke="#a7adbd" stroke-width="2" stroke-dasharray="6 5"/>`).join("");
    const paint = `<rect x="14" y="${h / 2 - 34}" width="${w - 28}" height="10" fill="#7e5bd6" opacity="0.85"/><rect x="14" y="${h / 2 + 24}" width="${w - 28}" height="10" fill="#7e5bd6" opacity="0.85"/>`;
    return `<g filter="url(#s)"><g fill="#eceef4" stroke="#6f7486" stroke-width="3">${wall}</g>${seams}${paint}</g>${rim(wall, NEON.cyan)}`;
  }],
  ["wood", "thin", "Wooden Fence", 2, 1, (w, h) => {
    const planks = [];
    for (let x = 18; x < w - 18; x += 26) planks.push(`<rect x="${x}" y="${h / 2 - 16}" width="22" height="32" rx="3" fill="${(x / 26) % 2 < 1 ? "#b9814a" : "#a8733f"}" stroke="#4a2a10" stroke-width="2"/>`);
    const rails = `<rect x="14" y="${h / 2 - 6}" width="${w - 28}" height="12" fill="#6b3f19"/>`;
    const posts = [16, w / 2 - 9, w - 34].map((x) => `<rect x="${x}" y="${h / 2 - 22}" width="18" height="44" rx="3" fill="#5b3415" stroke="#2c1708" stroke-width="2"/>`).join("");
    const box = `<rect x="14" y="${h / 2 - 22}" width="${w - 28}" height="44" rx="4"/>`;
    return `<g filter="url(#s)">${rails}${planks.join("")}${posts}</g>${rim(box, NEON.yellow)}`;
  }],
  ["wood", "thick", "Timber Wall", 2, 1, (w, h) => {
    const box = `<rect x="14" y="${h / 2 - 40}" width="${w - 28}" height="80" rx="10"/>`;
    const logs = [0, 1, 2].map((i) => {
      const y = h / 2 - 40 + i * 27;
      return `<rect x="18" y="${y + 2}" width="${w - 36}" height="23" rx="11" fill="${i % 2 ? "#9a6232" : "#8a5428"}" stroke="#3a1f0a" stroke-width="3"/>`
        + `<circle cx="30" cy="${y + 13}" r="9" fill="#d3a46b" stroke="#6b3f19" stroke-width="2"/><circle cx="${w - 30}" cy="${y + 13}" r="9" fill="#d3a46b" stroke="#6b3f19" stroke-width="2"/>`
        + `<path d="M 60 ${y + 10} Q ${w / 2} ${y + 6} ${w - 60} ${y + 12}" stroke="#5b3415" stroke-width="2" fill="none"/>`;
    }).join("");
    return `<g filter="url(#s)">${logs}</g>${rim(box, NEON.pink)}`;
  }],
  ["concrete", "thick", "Concrete Barrier", 2, 1, (w, h) => {
    const wall = `<rect x="14" y="${h / 2 - 36}" width="${w - 28}" height="72" rx="8"/>`;
    const joints = [1, 2].map((i) => `<line x1="${14 + ((w - 28) / 3) * i}" y1="${h / 2 - 36}" x2="${14 + ((w - 28) / 3) * i}" y2="${h / 2 + 36}" stroke="#4d5359" stroke-width="5"/>`).join("");
    const top = `<rect x="22" y="${h / 2 - 12}" width="${w - 44}" height="24" rx="6" fill="#b4b9bf"/>`;
    const hazard = [22, w - 58].map((x) => `<g transform="translate(${x} ${h / 2 - 30})">${[0, 1, 2].map((k) => `<path d="M ${k * 12} 0 l 10 0 l -10 60 l -10 0 Z" fill="${NEON.yellow}" opacity="0.85"/>`).join("")}</g>`).join("");
    return `<g filter="url(#s)"><g fill="#8c9298" stroke="#3d4248" stroke-width="5">${wall}</g>${top}${joints}${hazard}</g>${rim(wall, NEON.yellow)}`;
  }],
  ["stone", "thin", "Low Stone Wall", 2, 1, (w, h) => {
    const box = `<rect x="14" y="${h / 2 - 24}" width="${w - 28}" height="48" rx="14"/>`;
    return `<g filter="url(#s)"><g fill="#7a725f">${box}</g>${stones(w, h, { rows: 2, top: h / 2 - 24, height: 48, seed: 7, fill: ["#b5ad98", "#a39b85", "#c4bca7"], line: "#5c5444" })}</g>${rim(box, NEON.yellow)}`;
  }],
  ["stone", "thick", "Fieldstone Wall", 2, 1, (w, h) => {
    const box = `<rect x="14" y="${h / 2 - 42}" width="${w - 28}" height="84" rx="16"/>`;
    return `<g filter="url(#s)"><g fill="#5f584a">${box}</g>${stones(w, h, { rows: 3, top: h / 2 - 42, height: 84, seed: 23, fill: ["#9b937f", "#8a8270", "#b0a790", "#a39b85"], line: "#4d473a" })}</g>${rim(box, NEON.pink)}`;
  }],
  ["steel", "thin", "Corrugated Fence", 2, 1, (w, h) => {
    const sheet = `<rect x="14" y="${h / 2 - 14}" width="${w - 28}" height="28" rx="2"/>`;
    const ribs = [];
    for (let x = 22; x < w - 18; x += 14) ribs.push(`<line x1="${x}" y1="${h / 2 - 14}" x2="${x}" y2="${h / 2 + 14}" stroke="${(x / 14) % 2 < 1 ? "#c8d1dc" : "#6d7887"}" stroke-width="5"/>`);
    const posts = [10, w / 2 - 10, w - 30].map((x) => `<rect x="${x}" y="${h / 2 - 22}" width="20" height="44" rx="4" fill="#3a414b" stroke="#16191d" stroke-width="2"/>`).join("");
    const rust = `<circle cx="${w * 0.3}" cy="${h / 2 + 6}" r="9" fill="#9c4a1f" opacity="0.6"/><circle cx="${w * 0.72}" cy="${h / 2 - 4}" r="7" fill="#9c4a1f" opacity="0.5"/>`;
    return `<g filter="url(#s)"><g fill="#8f9aa8" stroke="#3a414b" stroke-width="3">${sheet}</g>${ribs.join("")}${rust}${posts}</g>${rim(sheet, NEON.cyan)}`;
  }],
  ["steel", "thick", "Blast Wall", 2, 1, (w, h) => {
    const wall = `<rect x="14" y="${h / 2 - 40}" width="${w - 28}" height="80" rx="6"/>`;
    const plates = [0, 1, 2, 3].map((i) => `<rect x="${20 + i * ((w - 40) / 4)}" y="${h / 2 - 34}" width="${(w - 40) / 4 - 6}" height="68" rx="3" fill="#5d6876" stroke="#262b31" stroke-width="3"/>`).join("");
    const rivets = [0, 1, 2, 3].map((i) => [0, 1].map((j) => `<circle cx="${30 + i * ((w - 40) / 4)}" cy="${h / 2 - 24 + j * 48}" r="4" fill="#b7c2cf"/><circle cx="${14 + (i + 1) * ((w - 40) / 4) - 4}" cy="${h / 2 - 24 + j * 48}" r="4" fill="#b7c2cf"/>`).join("")).join("");
    const stripe = `<rect x="${w / 2 - 70}" y="${h / 2 - 6}" width="140" height="12" fill="${NEON.pink}" opacity="0.8"/>`;
    return `<g filter="url(#s)"><g fill="#3f4752" stroke="#16191d" stroke-width="5">${wall}</g>${plates}${rivets}${stripe}</g>${rim(wall, NEON.pink)}`;
  }]
];

const assets = path.join(root, "assets", "cover");
const pack = path.join(root, "packs", "_source", "cover");
await mkdir(assets, { recursive: true });
await rm(pack, { recursive: true, force: true });
await mkdir(pack, { recursive: true });
for (const f of await readdir(assets)) if (f.endsWith(".svg")) await rm(path.join(assets, f));

let sort = 0;
const ALL = [...PIECES.map((p) => [...p, false]), ...WALLS.map((p) => [...p, true])];
for (const [material, thickness, name, width, height, art, wall] of ALL) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const file = `${material}-${thickness}-${slug}.svg`;
  await writeFile(path.join(assets, file), svg(256 * width, 256 * height, art(256 * width, 256 * height)));
  const hp = HP[material][thickness === "thin" ? 0 : 1];
  // The first piece of each kind keeps its id; the wall sections get their own.
  const _id = id(wall ? `${material}|${thickness}|wall` : `${material}|${thickness}`);
  const img = `modules/${MODULE_ID}/assets/cover/${file}`;
  const label = `${name} (${material[0].toUpperCase()}${material.slice(1)}, ${thickness === "thin" ? "Thin" : "Thick"})`;
  const actor = {
    _id, _key: `!actors!${_id}`, name: label, type: "mook", img,
    system: {
      derivedStats: { hp: { value: hp, max: hp } },
      information: { description: `<p>Cover: ${material}, ${thickness}. ${hp} HP per 2×2 m/yds section (2070 Core Rules, Ch07, Cover HP). Drop it on the map as cover; Neon Combat Manager puts attacks' damage on it and Repair cover sets it back to full.</p>`, notes: "", alias: "", history: "" }
    },
    prototypeToken: {
      name, width, height, texture: { src: img }, actorLink: false, disposition: 0, displayName: 30, displayBars: 20,
      bar1: { attribute: "derivedStats.hp" }, bar2: { attribute: null }, sight: { enabled: false }, lockRotation: false
    },
    items: [], effects: [], folder: null, sort: (sort += 100),
    flags: { [MODULE_ID]: { cover: { material, thickness } } },
    ownership: { default: 0 }
  };
  await writeFile(path.join(pack, `actor_${slug}_${_id}.json`), `${JSON.stringify(actor, null, 2)}\n`);
}
console.log(`${ALL.length} cover pieces (${WALLS.length} wall sections)`);
