import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The email Supabase Auth sends with the sign-in code (COR-10 to COR-13 of the factory's manual): HTML only, the code
// first and as real text, no links, no images. The subject lives in its own file, pasted in the panel next to the body.
const html = readFileSync(new URL("../../supabase/templates/otp-code.html", import.meta.url), "utf8");
const subject = readFileSync(new URL("../../supabase/templates/otp-code.subject.txt", import.meta.url), "utf8").trim();
const body = html.replace(/<!--[\s\S]*?-->/g, "");
const text = body.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n").split("\n").map((l) => l.trim()).filter(Boolean);

test("the body has the code variable exactly once, alone on its line", () => {
  assert.equal(body.split("{{ .Token }}").length - 1, 1);
  assert.equal(text.filter((l) => l.includes("{{")).length, 1);
  assert.equal(text.find((l) => l.includes("{{")), "{{ .Token }}");
});

test("the code is the first text of the email, large, in a fixed-width font, and not split", () => {
  assert.equal(text[0], "{{ .Token }}");
  const tag = body.match(/<[^>]*style="[^"]*"[^>]*>\s*\{\{ \.Token \}\}/)[0];
  const size = Number(tag.match(/font-size:\s*(\d+)px/)[1]);
  assert.ok(size >= 24, `font-size ${size}`);
  assert.match(tag, /monospace/);
});

test("no links, no images, no buttons, no scripts, no web fonts", () => {
  assert.doesNotMatch(body, /<img/i);
  assert.doesNotMatch(body, /href\s*=/i);
  assert.doesNotMatch(body, /<a[\s>]/i);
  assert.doesNotMatch(body, /<button/i);
  assert.doesNotMatch(body, /<script/i);
  assert.doesNotMatch(body, /https?:|@font-face|url\(/i);
  assert.doesNotMatch(body, /\{\{\s*\.(ConfirmationURL|SiteURL|RedirectTo|TokenHash)/);
});

test("it says how long the code lasts and what to do if it was not asked for, in plain text", () => {
  const all = text.join(" ");
  assert.match(all, /Vale 1 hora\./);
  assert.match(all, /Si no lo pediste, ignora este correo\./);
  assert.doesNotMatch(all, /urgente|alerta|peligro|hackeo|!/i);
});

test("styles are inline (no <style> sheet), a column of 600 px at most, 16 px text, system fonts", () => {
  assert.doesNotMatch(body, /<style/i);
  assert.match(body, /max-width:\s*600px/);
  assert.match(body, /font-size:\s*16px/);
  assert.doesNotMatch(body, /#000(000)?\b|#fff(fff)?\b|background(-color)?:\s*(white|black)/i);
  for (const size of body.match(/font-size:\s*\d+px/g)) assert.ok(Number(size.match(/\d+/)[0]) >= 14, size);
});

test("every colored text declares its color and its background together", () => {
  for (const [, style] of body.matchAll(/style="([^"]*)"/g)) {
    if (/(^|;)\s*color:/.test(style)) assert.match(style, /background-color:/, style);
  }
});

test("the subject names the product, has no code, no alarm and is fifty characters or fewer", () => {
  assert.equal(subject, "Tu código para entrar a ninben");
  assert.ok(subject.length <= 50);
  assert.doesNotMatch(subject, /\{\{|\d|!|[A-ZÁÉÍÓÚ]{3,}/);
});
