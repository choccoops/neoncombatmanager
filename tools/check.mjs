// Pre-release checks (`npm run check`, also run by CI and the release workflow):
// every script parses, every JSON file is valid, every NEONCOMBAT.* key the code and templates
// use exists in lang/en.json, every icon a condition names exists, and no file outside
// scripts/compat.js touches a Foundry global that moved in v13 (the v13 migration guard).
import { execFileSync } from "node:child_process";
import { readFile, readdir, access } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
let failed = 0;
const fail = (msg) => {
  failed++;
  console.error(`✗ ${msg}`);
};

async function files(dir, ext) {
  const out = [];
  for (const e of await readdir(path.join(root, dir), { withFileTypes: true, recursive: true })) {
    if (e.isFile() && e.name.endsWith(ext)) out.push(path.join(e.parentPath ?? e.path, e.name));
  }
  return out;
}

// Scripts parse
const scripts = await files("scripts", ".js");
for (const file of scripts) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (err) {
    fail(`${path.relative(root, file)}: ${err.stderr?.toString().trim()}`);
  }
}

// JSON is valid
const json = [path.join(root, "module.json"), path.join(root, "package.json"), ...(await files("lang", ".json"))];
for (const file of json) {
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    fail(`${path.relative(root, file)}: ${err.message}`);
  }
}

// Localization keys used are defined (keys built at runtime end in "." or "${" and are skipped)
const flat = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${prefix}${k}.`) : [`${prefix}${k}`]));
const defined = new Set(flat(JSON.parse(await readFile(path.join(root, "lang", "en.json"), "utf8"))));
const used = new Set();
const templates = await files("templates", ".hbs");
for (const file of [...scripts, ...templates]) {
  const text = await readFile(file, "utf8");
  for (const m of text.matchAll(/NEONCOMBAT\.[A-Za-z0-9_.]*[A-Za-z0-9_]/g)) used.add(m[0]);
  // `${LANG}.Card.Gains` in scripts; a key followed by `${` is built at runtime and only its prefix is checked.
  for (const m of text.matchAll(/\$\{LANG\}\.([A-Za-z0-9_.]*[A-Za-z0-9_])(\.?\$\{)?/g)) used.add(`NEONCOMBAT.${m[1]}`);
}
for (const key of used) {
  const isPrefix = [...defined].some((d) => d.startsWith(`${key}.`));
  if (!defined.has(key) && !isPrefix) fail(`lang/en.json is missing ${key}`);
}

// Every built-in condition has a name and hint, and its module icon exists
const data = await readFile(path.join(root, "scripts", "conditions", "data.js"), "utf8");
const ids = [...data.matchAll(/\{ id: "([A-Za-z0-9]+)"/g)].map((m) => m[1]);
for (const id of ids) {
  if (!defined.has(`NEONCOMBAT.Condition.${id}.name`)) fail(`lang/en.json has no name for condition ${id}`);
  if (!defined.has(`NEONCOMBAT.Condition.${id}.hint`)) fail(`lang/en.json has no hint for condition ${id}`);
}
for (const m of data.matchAll(/\$\{A\}\/([a-z0-9-]+\.svg)/g)) {
  try {
    await access(path.join(root, "assets", "icons", m[1]));
  } catch {
    fail(`assets/icons/${m[1]} is missing`);
  }
}

// v13 guard: these moved under foundry.* in v13 and lose their globals later. Only compat.js may name them.
const MOVED = [/\brenderTemplate\(/, /\bloadTemplates\(/, /\bnew FilePicker\b/, /\bTextEditor\./, /\bmergeObject\(/, /\bduplicate\(/, /\bFormDataExtended\b/];
for (const file of scripts) {
  if (file.endsWith(`${path.sep}compat.js`)) continue;
  const text = await readFile(file, "utf8");
  for (const re of MOVED) {
    const m = text.match(re);
    if (m && !/foundry\.utils\.|Compat\.|const \{[^}]*\} = foundry\.utils/.test(text.slice(Math.max(0, m.index - 40), m.index + m[0].length))) {
      fail(`${path.relative(root, file)} uses ${m[0]} outside compat.js (v13 moved it)`);
    }
  }
}

console.log(`${scripts.length} scripts, ${json.length} JSON files, ${templates.length} templates, ${used.size} localization keys, ${ids.length} conditions checked`);
if (failed) {
  console.error(`${failed} problem(s)`);
  process.exit(1);
}
