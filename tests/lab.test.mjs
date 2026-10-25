/** The Condition Lab editor: what the form shows and saves back, through the real template and Save action. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerSettings } from "./helpers/foundry.mjs";

await registerSettings();
const { Registry } = await import("../scripts/conditions/registry.js");
const { ConditionEditor, summary } = await import("../scripts/conditions/lab-app.js");
const { Compat } = await import("../scripts/compat.js");

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;
const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The fields in a piece of rendered HTML, as the browser would hold them (inputs, selects, textareas). */
function fields(html) {
  const out = new Map();
  for (const [tag] of html.matchAll(/<input\b[^>]*>/g)) {
    const name = attr(tag, "name");
    if (!name) continue;
    const type = attr(tag, "type") ?? "text";
    let value = unescape(attr(tag, "value") ?? "");
    // A number input can't hold text: the browser shows it empty.
    if (type === "number" && value !== "" && !Number.isFinite(Number(value))) value = "";
    out.set(name, { value, checked: /\schecked\b/.test(tag) });
  }
  for (const [, name, body] of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const selected = body.match(/<option value="([^"]*)"[^>]*selected/) ?? body.match(/<option value="([^"]*)"/);
    out.set(name, { value: unescape(selected?.[1] ?? "") });
  }
  for (const [, name, body] of html.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g)) out.set(name, { value: unescape(body) });
  return out;
}

/** Enough of the editor's form element for its _read(): querySelector by [name], and the change rows. */
function formElement(html) {
  const pick = (map) => (sel) => map.get(sel.match(/\[name="?([^"\]]+)"?\]/)?.[1]) ?? null;
  const rows = [...html.matchAll(/<li data-change="\d+">([\s\S]*?)<\/li>/g)].map(([, body]) => ({ querySelector: pick(fields(body)) }));
  const outside = html.replace(/<ol class="ncm-changes">[\s\S]*?<\/ol>/, "");
  return { querySelector: pick(fields(outside)), querySelectorAll: (sel) => (sel === "[data-change]" ? rows : []) };
}

/** Open the editor on a condition, render it, and press Save without touching anything. */
async function saveUnchanged(id) {
  const editor = new ConditionEditor({ conditionId: id });
  const html = await Compat.renderTemplate("modules/cpr-neon-combat-manager/templates/lab-edit.hbs", await editor._prepareContext());
  editor.element = formElement(html);
  await ConditionEditor.DEFAULT_OPTIONS.actions.saveCondition.call(editor);
  return html;
}

// Neon At Home's encumbrance condition, registered the way it does (a CUSTOM change its own hook resolves).
const encumbered = { key: "system.stats.move.value", mode: 0, value: "cpr-neon-at-home.half", priority: 100 };
Registry.register({ id: "neonhomeEncumbered", name: "Encumbered", img: "modules/cpr-neon-at-home/assets/encumbered.svg", category: "situation", changes: [encumbered] }, "cpr-neon-at-home");
Registry.refresh();

test("saving another module's CUSTOM change in the Lab keeps its mode, value and priority", async () => {
  const html = await saveUnchanged("neonhomeEncumbered");
  assert.ok(html.includes("cpr-neon-at-home.half"), "the form shows the change's value");
  const c = Registry.get("neonhomeEncumbered");
  assert.equal(c.override, true, "saved as an override");
  const [change] = Registry.effectData(c).changes;
  assert.deepEqual(change, { key: encumbered.key, mode: 0, value: "cpr-neon-at-home.half", priority: 100 });
  assert.deepEqual(CONFIG.statusEffects.find((s) => s.id === "neonhomeEncumbered").changes, [change]);
});

test("saving an ordinary condition unchanged keeps its numbers, situational flags and ADD mode", async () => {
  await saveUnchanged("ironGrip");
  assert.deepEqual(Registry.effectData(Registry.get("ironGrip")).changes, [{ key: "bonuses.brawling", mode: 2, value: "-2", priority: null }]);
  assert.deepEqual(Registry.get("ironGrip").rawChanges[0].situational, true);
  await saveUnchanged("brokenLeg");
  assert.deepEqual(Registry.effectData(Registry.get("brokenLeg")).changes, [
    { key: "system.stats.move.value", mode: 2, value: "-4", priority: null },
    { key: "bonuses.evasion", mode: 2, value: "-2", priority: null }
  ]);
});

test("the Lab's summary shows a CUSTOM change as what it is, not NaN", () => {
  const line = summary(Registry.get("neonhomeEncumbered"));
  assert.ok(!line.includes("NaN"), line);
  assert.ok(line.includes("cpr-neon-at-home.half"), line);
});

test("a change row reads back: numbers as numbers, text as text, ADD by default", async () => {
  const { changeFromRow } = await import("../scripts/conditions/lab-app.js");
  const row = (values) => (n) => (n in values ? { value: values[n], checked: values[n] === true } : null);
  assert.deepEqual(changeFromRow(row({ key: "bonuses.melee", value: "-2", mode: "", priority: "" })), { key: "bonuses.melee", value: -2, mode: 2, situational: false, onByDefault: false });
  assert.deepEqual(changeFromRow(row({ key: "bonuses.melee", value: "", mode: "2" })).value, 0, "an emptied ADD value is 0");
  assert.deepEqual(changeFromRow(row({ key: "system.stats.move.value", value: "cpr-neon-at-home.one", mode: "0", priority: "100" })),
    { key: "system.stats.move.value", value: "cpr-neon-at-home.one", mode: 0, situational: false, onByDefault: false, priority: 100 });
  assert.equal(changeFromRow(row({ key: "x", value: "3", mode: "5", situational: true })).mode, 5, "OVERRIDE stays OVERRIDE");
});
