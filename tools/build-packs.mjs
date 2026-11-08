// Compile the compendium sources in packs/_source/<pack>/*.json into Foundry's LevelDB
// packs at packs/<pack>, using Foundry's own CLI. Run with `npm run build:packs`.
// The release workflows run this before zipping; the compiled packs aren't committed.
import { compilePack } from "@foundryvtt/foundryvtt-cli";
import { readdir, rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sources = path.join(root, "packs", "_source");

for (const entry of await readdir(sources, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const dest = path.join(root, "packs", entry.name);
  await rm(dest, { recursive: true, force: true });
  await compilePack(path.join(sources, entry.name), dest, { log: false });
  console.log(`packed ${entry.name}`);
}
