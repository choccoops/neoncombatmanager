import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const dir = path.join(root, "packs", "_source", "macros");
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

test("the Macros compendium: every macro parses, calls the API and has its icon", async () => {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  assert.ok(files.length >= 5);
  const manifest = JSON.parse(await readFile(path.join(root, "module.json"), "utf8"));
  assert.ok(manifest.packs.some((p) => p.name === "macros" && p.type === "Macro"));
  const names = new Set();
  for (const f of files) {
    const doc = JSON.parse(await readFile(path.join(dir, f), "utf8"));
    assert.equal(doc._key, `!macros!${doc._id}`);
    assert.equal(doc.type, "script");
    assert.ok(!names.has(doc.name), `${doc.name} once`);
    names.add(doc.name);
    // Foundry runs a script macro as an async function of (speaker, actor, token, character, ...).
    assert.doesNotThrow(() => new AsyncFunction("speaker", "actor", "token", "character", "scope", doc.command), doc.name);
    assert.match(doc.command, /game\.modules\.get\("cpr-neon-combat-manager"\)\?\.api/);
    await access(path.join(root, doc.img.replace("modules/cpr-neon-combat-manager/", "")));
  }
  assert.ok(names.has("Neon Combat: Holocall"));
});
