import { test } from "node:test";
import assert from "node:assert/strict";
import { dictionaries, pickLanguage, translate } from "../../js/i18n.js";

test("es and en dictionaries have exactly the same keys and no empty strings", () => {
  const es = Object.keys(dictionaries.es).sort();
  const en = Object.keys(dictionaries.en).sort();
  assert.deepEqual(es, en);
  for (const lang of ["es", "en"]) {
    for (const [key, value] of Object.entries(dictionaries[lang])) {
      assert.ok(typeof value === "string" && value.trim(), `${lang}.${key}`);
    }
  }
});

test("pickLanguage prefers a supported language and defaults to es", () => {
  assert.equal(pickLanguage("en"), "en");
  assert.equal(pickLanguage("en-US"), "en");
  assert.equal(pickLanguage("ES-co"), "es");
  assert.equal(pickLanguage("fr-FR"), "es");
  assert.equal(pickLanguage(undefined), "es");
  assert.equal(pickLanguage(["fr", "en-GB"]), "en");
});

test("translate fills placeholders and falls back to es", () => {
  assert.equal(translate("en", "codeSentTo", { email: "a@b.co" }).includes("a@b.co"), true);
  assert.equal(translate("xx", "signInTitle"), dictionaries.es.signInTitle);
});

test("every key the app uses exists in the dictionaries", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../../js/app.js", import.meta.url), "utf8");
  const used = new Set([...source.matchAll(/\bt\(\s*"([A-Za-z]+)"/g)].map((m) => m[1]));
  // keys picked through lookup tables
  for (const m of source.matchAll(/:\s*"((?:status|kind)[A-Z][A-Za-z]*|saving|saved|saveError)"/g)) used.add(m[1]);
  const missing = [...used].filter((key) => !(key in dictionaries.es) || !(key in dictionaries.en));
  assert.deepEqual(missing, []);
});
