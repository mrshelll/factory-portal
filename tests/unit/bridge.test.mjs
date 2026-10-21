import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeForScript, buildBridgeScript, injectBridge } from "../../js/bridge.js";

const config = { parentOrigin: "https://example.test", kind: "questions", storage: {}, nonce: "abc123" };

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

test("buildBridgeScript embeds the nonce and refuses to build without one", () => {
  assert.ok(buildBridgeScript(config).includes('"nonce":"abc123"'));
  assert.throws(() => buildBridgeScript({ ...config, nonce: "" }));
});

// ---- the runtime inside a fake window (node:vm) ---------------------------------------------

import vm from "node:vm";

const ORIGIN = "https://portal.test";
const questions = (extra = {}) => ({ formato: "respuestas-fabrica/1", respuestas: [{ id: "Q-1", tipo: "si" }], ...extra });

// Runs the built bridge script in a context that plays the piece window. Returns the window, the
// messages the bridge posted to its parent and a way to post messages back as the parent.
function runBridge(overrides = {}) {
  const cfg = { parentOrigin: ORIGIN, kind: "questions", storage: {}, nonce: "n-1", host: { reviewerName: null }, ...overrides };
  const script = buildBridgeScript(cfg);
  const source = script.slice("<script>".length, -"</script>".length);
  const posted = [];
  const listeners = {};
  const parent = { postMessage(message, origin) { posted.push({ message: structuredClone(message), origin }); } };
  const win = {
    parent, setTimeout, clearTimeout, TextEncoder, structuredClone,
    document: { readyState: "complete", visibilityState: "visible", addEventListener() {} },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(source, win);
  const fromParent = (data, { origin = ORIGIN, source: src = parent } = {}) =>
    (listeners.message || []).forEach((fn) => fn({ source: src, origin, data }));
  const of = (type) => posted.filter((p) => p.message.type === type).map((p) => p.message);
  return { win, posted, of, fromParent };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
// Objects made inside the vm context have that realm's prototypes; compare them as plain data.
const plain = async (value) => JSON.parse(JSON.stringify(await value));

test("the injected script defines factorySubmit and a frozen factoryHost", () => {
  const { win } = runBridge({ host: { reviewerName: "Ana Pérez" } });
  assert.equal(typeof win.factorySubmit, "function");
  assert.ok(Object.isFrozen(win.factoryHost));
  assert.equal(win.factoryHost.persistence, "server");
  assert.equal(win.factoryHost.reviewerName, "Ana Pérez");
});

test("reviewerName travels escaped: </script><b> does not break the script", () => {
  const name = "</script><b>";
  const script = buildBridgeScript({ ...config, host: { reviewerName: name } });
  assert.equal(script.match(/<\/script/gi).length, 1, "only the final closing tag");
  assert.ok(!script.includes("<b>"));
  const { win } = runBridge({ host: { reviewerName: name } });
  assert.equal(win.factoryHost.reviewerName, name);
});

test("reviewerName is null when missing, blank or not a string", () => {
  for (const host of [undefined, null, {}, { reviewerName: "   " }, { reviewerName: 42 }]) {
    assert.equal(runBridge({ host }).win.factoryHost.reviewerName, null, JSON.stringify(host));
  }
});

test("factorySubmit flushes the draft, posts factory:submit with the nonce and resolves on the parent's result", async () => {
  const { win, posted, of, fromParent } = runBridge();
  win.localStorage.setItem("k", "v");
  const result = win.factorySubmit(questions());
  const types = posted.map((p) => p.message.type);
  assert.ok(types.indexOf("factory:draft") !== -1 && types.indexOf("factory:draft") < types.indexOf("factory:submit"), types.join(","));
  const [submit] = of("factory:submit");
  assert.equal(submit.nonce, "n-1");
  assert.equal(typeof submit.requestId, "string");
  assert.deepEqual(submit.payload, questions());
  assert.ok(posted.every((p) => p.origin === ORIGIN));
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: submit.requestId, ok: true });
  assert.deepEqual(await plain(result), { ok: true });
});

test("a second factorySubmit while one is in flight returns the same promise and posts once", async () => {
  const { win, of, fromParent } = runBridge();
  const a = win.factorySubmit(questions());
  const b = win.factorySubmit(questions({ otra: 1 }));
  assert.equal(a, b);
  assert.equal(of("factory:submit").length, 1);
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: of("factory:submit")[0].requestId, ok: false, error: "network" });
  assert.deepEqual(await plain(a), { ok: false, error: "network" });
  const c = win.factorySubmit(questions());
  assert.notEqual(c, a, "after it settles, a new call sends again");
  assert.equal(of("factory:submit").length, 2);
});

test("factory:submit-result needs the nonce, the parent origin, the parent source and the current requestId", async () => {
  const { win, of, fromParent } = runBridge();
  const result = win.factorySubmit(questions());
  const id = of("factory:submit")[0].requestId;
  let settled = false;
  result.then(() => { settled = true; });
  fromParent({ type: "factory:submit-result", requestId: id, ok: true });
  fromParent({ type: "factory:submit-result", nonce: "wrong", requestId: id, ok: true });
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: id, ok: true }, { origin: "https://evil.test" });
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: id, ok: true }, { source: {} });
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: "other", ok: true });
  await tick();
  assert.equal(settled, false);
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: id, ok: false, error: "made-up" });
  assert.deepEqual(await plain(result), { ok: false, error: "rejected" }, "an unknown error becomes rejected");
});

test("factorySubmit refuses payloads that are not of the piece kind, or too large, without posting", async () => {
  const { win, of } = runBridge();
  for (const bad of [null, "x", [], 42, { formato: "otro", respuestas: [] }, { formato: "respuestas-fabrica/1" }]) {
    assert.deepEqual(await plain(win.factorySubmit(bad)), { ok: false, error: "invalid" }, JSON.stringify(bad));
  }
  const cyclic = questions(); cyclic.self = cyclic;
  assert.deepEqual(await plain(win.factorySubmit(cyclic)), { ok: false, error: "invalid" });
  assert.deepEqual(await plain(win.factorySubmit(questions({ big: "é".repeat(500000) }))), { ok: false, error: "too-large" });
  assert.equal(of("factory:submit").length, 0);
  const flow = runBridge({ kind: "flow_review" });
  assert.deepEqual(await plain(flow.win.factorySubmit(questions())), { ok: false, error: "invalid" });
  const demo = runBridge({ kind: "demo_review" });
  demo.win.factorySubmit({ esquema: "revision-demo/1", flujos: [] });
  assert.equal(demo.of("factory:submit").length, 1);
});

test("factorySubmit gives up with timeout and ignores a late result", async () => {
  const { win, of, fromParent } = runBridge({ submitTimeoutMs: 30 });
  const result = await win.factorySubmit(questions());
  assert.deepEqual(await plain(result), { ok: false, error: "timeout" });
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: of("factory:submit")[0].requestId, ok: true });
  const again = win.factorySubmit(questions());
  assert.equal(of("factory:submit").length, 2, "a retry sends again");
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: of("factory:submit")[1].requestId, ok: true });
  assert.deepEqual(await plain(again), { ok: true });
});

test("the default submit timeout is 45 s", async () => {
  const { SUBMIT_TIMEOUT_MS } = await import("../../js/bridge.js");
  assert.equal(SUBMIT_TIMEOUT_MS, 45000);
  assert.ok(buildBridgeScript(config).includes('"submitTimeoutMs":45000'));
});

test("the bridge no longer wraps downloads", () => {
  const script = buildBridgeScript(config);
  assert.ok(!script.includes("createObjectURL"));
  assert.ok(!script.includes("HTMLAnchorElement"));
  assert.ok(!script.includes("factory:collect"));
});
