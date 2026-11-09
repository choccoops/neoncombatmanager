// Write Neon Arsenal's Automated Animations profile as AA menu exports (assets/arsenal): one for
// the free JB2A pack, one for JB2A Patreon. Import either in AA's Global Automatic Recognition
// menu (Menu Manager > Merge) in a world without Neon Combat Manager; with it, the module puts the
// profile in itself. Run with `npm run build:aa` (also part of `npm run build:packs`).
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { buildMenu } = await import(path.join(root, "scripts", "arsenal", "profile.js"));
const version = JSON.parse(readFileSync(path.join(root, "module.json"), "utf8")).version;
const out = path.join(root, "assets", "arsenal");
await mkdir(out, { recursive: true });
for (const patreon of [false, true]) {
  const menu = buildMenu({ patreon, sounds: true, version });
  const file = path.join(out, `neon-arsenal-autorec${patreon ? "-patreon" : ""}.json`);
  await writeFile(file, `${JSON.stringify(menu, null, 2)}\n`);
  console.log(`${path.relative(root, file)}: ${menu.melee.length} melee, ${menu.range.length} range`);
}
