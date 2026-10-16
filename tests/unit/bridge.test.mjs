import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeForScript, buildBridgeScript, injectBridge } from "../../js/bridge.js";

const config = { parentOrigin: "https://example.test", kind: "questions", storage: {} };

test("serializeForScript escapes sequences that could close or comment out the script", () => {
  const out = serializeForScript({ a: "</script><!-- & \u2028\u2029 >" });
  assert.ok(!out.includes("</script"), "no closing script tag");
  assert.ok(!out.includes("<!--"), "no html comment opener");
  assert.ok(!out.includes("<"), "no raw <");
  assert.ok(!out.includes("\u2028") && !out.includes("\u2029"), "no raw line separators");
  assert.deepEqual(JSON.parse(out), { a: "</script><!-- & \u2028\u2029 >" });
});

test("buildBridgeScript yields exactly one script element and embeds the config safely", () => {
  const script = buildBridgeScript({ ...config, storage: { k: "</script><!--x" } });
  assert.ok(script.startsWith("<script>"));
  assert.ok(script.endsWith("</script>"));
  assert.equal(script.match(/<\/script/gi).length, 1, "only the final closing tag");
  assert.equal(script.match(/<!--/g), null);
});

test("injectBridge puts the bridge first inside <head>", () => {
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><script>var x=1</script></head><body></body></html>';
  const out = injectBridge(html, config);
  const headAt = out.indexOf("<head>");
  const bridgeAt = out.indexOf("<script>(function");
  assert.ok(bridgeAt === headAt + "<head>".length, "bridge right after <head>");
  assert.ok(out.startsWith("<!doctype html>"), "doctype stays first");
});

test("injectBridge handles <head> with attributes and does not confuse <header>", () => {
  const html = '<!DOCTYPE html><html><header>x</header><HEAD data-a="1"><title>t</title></HEAD><body></body></html>';
  const out = injectBridge(html, config);
  assert.ok(out.indexOf('<HEAD data-a="1"><script>(function') !== -1);
  assert.ok(out.indexOf("<header>x</header>") < out.indexOf("<script>(function"));
});

test("injectBridge without <head> inserts after <html>, and without <html> after the doctype", () => {
  const a = injectBridge("<!doctype html><html lang='en'><body>hi</body></html>", config);
  assert.ok(a.startsWith("<!doctype html><html lang='en'><head><script>(function"));
  const b = injectBridge("<!doctype html><p>hi</p>", config);
  assert.ok(b.startsWith("<!doctype html><head><script>(function"));
  const c = injectBridge("<p>hi</p>", config);
  assert.ok(c.startsWith("<head><script>(function"));
});

test("injectBridge tolerates empty or non-string html", () => {
  for (const value of ["", null, undefined, 42]) {
    const out = injectBridge(value, config);
    assert.ok(out.includes("<script>(function"));
  }
});

test("injectBridge drops non-string seed values and non-object seeds", () => {
  const out = injectBridge("<head></head>", { ...config, storage: { ok: "v", bad: 3, nested: { a: 1 } } });
  assert.ok(out.includes('"ok":"v"'));
  assert.ok(!out.includes('"bad"'));
  assert.ok(!out.includes('"nested"'));
  const arr = injectBridge("<head></head>", { ...config, storage: ["x"] });
  assert.ok(arr.includes('"storage":{}'));
});
