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

// The piece's <html>: only what the bridge touches.
function fakeRoot() {
  const attributes = {};
  return { attributes, setAttribute(name, value) { attributes[name] = String(value); } };
}

// Runs the built bridge script in a context that plays the piece window. Returns the window, the
// messages the bridge posted to its parent and a way to post messages back as the parent.
// env.window and env.document add what a test needs on top (layout, ResizeObserver, Element, scrollTo).
function runBridge(overrides = {}, env = {}) {
  const cfg = { parentOrigin: ORIGIN, kind: "questions", storage: {}, nonce: "n-1", host: { reviewerName: null }, ...overrides };
  const script = buildBridgeScript(cfg);
  const source = script.slice("<script>".length, -"</script>".length);
  const posted = [];
  const listeners = {};
  const docListeners = {};
  const parent = { postMessage(message, origin) { posted.push({ message: structuredClone(message), origin }); } };
  const win = {
    parent, setTimeout, clearTimeout, TextEncoder, structuredClone,
    document: {
      readyState: overrides.readyState || "complete", visibilityState: "visible",
      addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
      documentElement: overrides.documentElement === undefined ? fakeRoot() : overrides.documentElement,
    },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  Object.assign(win, env.window || {});
  Object.assign(win.document, env.document || {});
  win.window = win;
  win.dispatchPagehide = () => (listeners.pagehide || []).forEach((fn) => fn());
  // Dispatches an event on the window (where click and focusin end their bubbling).
  win.dispatch = (type, event = {}) => (listeners[type] || []).forEach((fn) => fn(event));
  vm.createContext(win);
  vm.runInContext(source, win);
  const fromParent = (data, { origin = ORIGIN, source: src = parent } = {}) =>
    (listeners.message || []).forEach((fn) => fn({ source: src, origin, data }));
  const of = (type) => posted.filter((p) => p.message.type === type).map((p) => p.message);
  // The piece's document finished parsing (only meaningful with readyState "loading").
  const parsed = () => (docListeners.DOMContentLoaded || []).forEach((fn) => fn());
  return { win, posted, of, fromParent, parsed };
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

test("the bridge marks the piece's <html> with data-factory-host=portal before the piece runs", () => {
  const { win } = runBridge();
  assert.equal(win.document.documentElement.attributes["data-factory-host"], "portal");
});

test("without a documentElement the bridge still defines factorySubmit", () => {
  const { win } = runBridge({ documentElement: null });
  assert.equal(typeof win.factorySubmit, "function");
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

// ---- a write past the storage quota ---------------------------------------------------------

test("the storage quota can be lowered for tests and defaults to STORAGE_QUOTA_CHARS", async () => {
  const { STORAGE_QUOTA_CHARS } = await import("../../js/bridge.js");
  assert.ok(buildBridgeScript(config).includes(`"quotaChars":${STORAGE_QUOTA_CHARS}`));
  assert.ok(buildBridgeScript({ ...config, quotaChars: 100 }).includes('"quotaChars":100'));
  for (const bad of [0, -1, NaN, "100", null]) {
    assert.ok(buildBridgeScript({ ...config, quotaChars: bad }).includes(`"quotaChars":${STORAGE_QUOTA_CHARS}`), String(bad));
  }
});

test("a write past the quota throws QuotaExceededError and tells the parent once, with the nonce", () => {
  const { win, of } = runBridge({ quotaChars: 100 });
  assert.throws(() => win.localStorage.setItem("k", "x".repeat(200)), (e) => e.name === "QuotaExceededError");
  const failed = of("factory:save-failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0].reason, "too-large");
  assert.equal(failed[0].nonce, "n-1");
  assert.equal(win.localStorage.getItem("k"), null, "nothing was stored");
  assert.throws(() => win.localStorage.setItem("k", "y".repeat(200)), (e) => e.name === "QuotaExceededError");
  assert.throws(() => { win.localStorage.big = "z".repeat(200); }, (e) => e.name === "QuotaExceededError");
  assert.equal(of("factory:save-failed").length, 1, "a second failure in a row does not post again");
  assert.equal(of("factory:dirty").length, 0, "a refused write is not a change");
});

test("after a write that fits, a new failure posts again", () => {
  const { win, of } = runBridge({ quotaChars: 100 });
  assert.throws(() => win.localStorage.setItem("k", "x".repeat(200)));
  win.localStorage.setItem("k", "short");
  assert.equal(of("factory:save-failed").length, 1);
  assert.throws(() => win.localStorage.setItem("k", "x".repeat(200)));
  assert.equal(of("factory:save-failed").length, 2);
  assert.equal(win.localStorage.getItem("k"), "short", "the last write that fit stays");
});

test("on a failure the pending draft goes first, so any later draft has a change made after it", () => {
  const { win, posted } = runBridge({ quotaChars: 100 });
  win.localStorage.setItem("a", "1"); // debounced: no draft yet
  assert.throws(() => win.localStorage.setItem("b", "x".repeat(200)));
  const types = posted.map((p) => p.message.type);
  assert.deepEqual(types.slice(-2), ["factory:draft", "factory:save-failed"], types.join(","));
  assert.deepEqual({ ...posted.at(-2).message.storage }, { a: "1" });
});

test("sessionStorage past the quota throws but does not report a failed save", () => {
  const { win, of } = runBridge({ quotaChars: 100 });
  assert.throws(() => win.sessionStorage.setItem("k", "x".repeat(200)), (e) => e.name === "QuotaExceededError");
  assert.equal(of("factory:save-failed").length, 0);
});

test("after a refusal, re-writing the value already stored unlocks and sends a draft", async () => {
  const { win, of } = runBridge({ quotaChars: 100 });
  win.localStorage.setItem("k", "saved");
  win.dispatchPagehide(); // "saved" went out as a draft
  assert.throws(() => win.localStorage.setItem("k", "x".repeat(200)));
  const afterRefusal = of("factory:draft").length; // the pending draft went first
  win.localStorage.setItem("k", "saved"); // the person undid the paste: same value as stored
  assert.equal(of("factory:dirty").length, 2, "the identical write counts as a change after the refusal");
  win.dispatchPagehide();
  assert.equal(of("factory:draft").length, afterRefusal + 1, "a draft goes out");
  assert.deepEqual({ ...of("factory:draft").at(-1).storage }, { k: "saved" });
  assert.throws(() => win.localStorage.setItem("k", "x".repeat(200)));
  assert.equal(of("factory:save-failed").length, 2, "unlocked: a new refusal posts again");
});

test("without a refusal, re-writing the stored value is still not a change", () => {
  const { win, of } = runBridge();
  win.localStorage.setItem("k", "v");
  win.dispatchPagehide();
  const drafts = of("factory:draft").length;
  win.localStorage.setItem("k", "v");
  win.dispatchPagehide();
  assert.equal(of("factory:dirty").length, 1);
  assert.equal(of("factory:draft").length, drafts);
});

// The piece's own start-up writes (restoring, stamping the opening time, probing the storage) are not the
// person's doing: they post nothing and travel with the first change made after the piece opened.
test("writes made while the piece opens post nothing, not even on flush or pagehide", async () => {
  const { win, posted, fromParent, parsed } = runBridge({ readyState: "loading" });
  win.localStorage.setItem("opened", "t0");
  win.localStorage.setItem("probe", "1"); win.localStorage.removeItem("probe");
  parsed();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready"]);
  win.dispatchPagehide();
  fromParent({ type: "factory:flush", nonce: "n-1" });
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready", "factory:flushed"]);
});

test("factory:ready comes once the opening is over, and the first change after it carries the opening writes", async () => {
  const { win, of, parsed } = runBridge({ readyState: "loading" });
  win.localStorage.setItem("opened", "t0");
  parsed();
  assert.equal(of("factory:ready").length, 0, "not before the piece's start-up code has run");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(of("factory:ready").length, 1);
  win.localStorage.setItem("answer", "yes");
  assert.equal(of("factory:dirty").length, 1);
  win.dispatchPagehide();
  assert.deepEqual(await plain(of("factory:draft").at(-1).storage), { opened: "t0", answer: "yes" });
});

// ---- a closed piece (received or replaced): read-only, no drafts ------------------------------

test("factoryHost carries closed and sentAt", () => {
  const { win } = runBridge({ host: { reviewerName: "Ana", closed: "received", sentAt: "2026-10-22T15:00:00Z" } });
  assert.ok(Object.isFrozen(win.factoryHost));
  assert.equal(win.factoryHost.closed, "received");
  assert.equal(win.factoryHost.sentAt, "2026-10-22T15:00:00Z");
  assert.equal(runBridge({ host: { closed: "replaced", sentAt: "2026-10-22T15:00:00.123456+00:00" } }).win.factoryHost.closed, "replaced");
  const open = runBridge().win.factoryHost;
  assert.equal(open.closed, null, "an open piece has closed null");
  assert.equal(open.sentAt, null);
  assert.deepEqual(Object.keys(open).sort(), ["closed", "observer", "persistence", "reviewerName", "sentAt"]);
});

test("closed accepts only received or replaced", () => {
  for (const closed of [undefined, null, "", "submitted", "pending", "RECEIVED", " received", true, 1, {}, ["received"]]) {
    assert.equal(runBridge({ host: { closed } }).win.factoryHost.closed, null, String(JSON.stringify(closed)));
  }
  for (const host of [undefined, null, "received"]) {
    assert.equal(runBridge({ host }).win.factoryHost.closed, null, String(JSON.stringify(host)));
  }
  const script = buildBridgeScript({ ...config, host: { closed: "</script><!--" } });
  assert.equal(script.match(/<\/script/gi).length, 1, "only the final closing tag");
});

test("invalid sentAt becomes null", () => {
  for (const sentAt of [undefined, null, "", "   ", "ayer", "2026-13-45T99:00:00Z", 1761145200000, {}, "</script>"]) {
    assert.equal(runBridge({ host: { closed: "received", sentAt } }).win.factoryHost.sentAt, null, String(JSON.stringify(sentAt)));
  }
});

test("closed bridge posts no draft nor dirty", async () => {
  const { win, posted, of, fromParent } = runBridge({ host: { closed: "received", sentAt: "2026-10-22T15:00:00Z" }, storage: { k: "sent" }, quotaChars: 100 });
  win.localStorage.setItem("k", "changed");
  win.localStorage.other = "x";
  win.localStorage.removeItem("other");
  assert.equal(win.localStorage.getItem("k"), "changed", "writes still work in memory");
  assert.throws(() => win.localStorage.setItem("big", "x".repeat(200)), (e) => e.name === "QuotaExceededError");
  win.dispatchPagehide();
  fromParent({ type: "factory:flush", nonce: "n-1" });
  await new Promise((r) => setTimeout(r, 900)); // past the draft debounce
  assert.equal(of("factory:draft").length, 0);
  assert.equal(of("factory:dirty").length, 0);
  assert.equal(of("factory:save-failed").length, 0, "nothing is saved, so nothing fails to save");
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready", "factory:flushed"]);
});

test("closed bridge still answers flush and submit", async () => {
  const { win, of, fromParent } = runBridge({ host: { closed: "replaced", sentAt: null } });
  win.localStorage.setItem("k", "v");
  fromParent({ type: "factory:flush", nonce: "n-1" });
  assert.equal(of("factory:flushed").length, 1);
  const result = win.factorySubmit(questions());
  const [submit] = of("factory:submit");
  assert.deepEqual(submit.payload, questions());
  assert.equal(submit.nonce, "n-1");
  assert.equal(of("factory:draft").length, 0, "submit does not flush a draft either");
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: submit.requestId, ok: true });
  assert.deepEqual(await plain(result), { ok: true });
});

// ---- observer: the project owner is reading the piece -----------------------------------------

test("observer is true only with closed", () => {
  const read = (host) => runBridge({ host }).win.factoryHost.observer;
  assert.equal(read({ closed: "received", observer: true }), true);
  assert.equal(read({ closed: "replaced", observer: true }), true);
  assert.equal(read({ observer: true }), false, "an open piece is never observed");
  assert.equal(read({ closed: "bogus", observer: true }), false);
  for (const observer of ["true", 1, {}, ["x"], null, false]) {
    assert.equal(read({ closed: "received", observer }), false, String(JSON.stringify(observer)));
  }
});

test("observer is false by default", () => {
  assert.equal(runBridge().win.factoryHost.observer, false);
  assert.equal(runBridge({ host: { closed: "received" } }).win.factoryHost.observer, false);
  assert.ok(Object.isFrozen(runBridge({ host: { closed: "received", observer: true } }).win.factoryHost));
});

test("observer never posts drafts", async () => {
  const { win, posted, of, fromParent } = runBridge({ host: { closed: "received", observer: true, sentAt: "2026-10-22T15:00:00Z" }, storage: { k: "sent" } });
  win.localStorage.setItem("k", "changed");
  win.dispatchPagehide();
  fromParent({ type: "factory:flush", nonce: "n-1" });
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(of("factory:draft").length, 0);
  assert.equal(of("factory:dirty").length, 0);
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready", "factory:flushed"]);
});

test("observer never posts submit", async () => {
  const { win, of } = runBridge({ host: { closed: "received", observer: true } });
  assert.deepEqual(await plain(win.factorySubmit(questions())), { ok: false, error: "rejected" });
  assert.equal(of("factory:submit").length, 0);
});

// ---- size and scrolling: the portal sizes the iframe to the piece and scrolls its own page --------------

// A piece with layout: the root's height, elements with a box, a ResizeObserver the test fires by hand, and the
// window's scrollTo / scroll and Element.prototype.scrollIntoView, which record their calls (the piece still scrolls).
function layout({ height = 640, innerHeight = 150, innerWidth = 320 } = {}) {
  const calls = [];
  const observers = [];
  const root = {
    attributes: {}, height,
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getBoundingClientRect() { return { top: 0, bottom: this.height, height: this.height }; },
  };
  const L = {};
  const locationWrites = [];
  let hash = "";
  // Records every write, so a test can tell the bridge never touched it.
  const location = {
    get hash() { return hash; }, set hash(value) { locationWrites.push(["hash", value]); hash = String(value); },
    assign(url) { locationWrites.push(["assign", url]); }, replace(url) { locationWrites.push(["replace", url]); },
  };
  // What a browser focuses without a tabindex (enough for these tests).
  const NATIVELY_FOCUSABLE = ["INPUT", "SELECT", "TEXTAREA", "BUTTON"];
  class FakeElement {
    constructor({ top = 0, height = 40, tag = "DIV", attrs = {}, parent = null } = {}) { Object.assign(this, { top, height, tagName: tag, attrs, parent }); }
    getBoundingClientRect() { return { top: this.top, bottom: this.top + this.height, height: this.height }; }
    getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
    hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    // Like a browser: only a focusable element takes focus, and focusin bubbles to the window.
    focus(options) {
      const focusable = NATIVELY_FOCUSABLE.includes(this.tagName) || (this.tagName === "A" && this.hasAttribute("href")) || this.hasAttribute("tabindex");
      if (!focusable) return;
      this.focusOptions = options;
      env.document.activeElement = this;
      if (L.win) { L.win.document.activeElement = this; L.win.dispatch("focusin", { target: this }); }
    }
    closest(selector) { // only what the bridge asks for
      assert.equal(selector, "a[href]");
      for (let el = this; el; el = el.parent) if (el.tagName === "A" && el.hasAttribute("href")) return el;
      return null;
    }
  }
  FakeElement.prototype.scrollIntoView = function (arg) { calls.push({ scrollIntoView: arg, element: this }); };
  class FakeResizeObserver {
    constructor(fn) { this.fn = fn; this.targets = []; observers.push(this); }
    observe(target) { this.targets.push(target); }
  }
  const mutationObservers = [];
  class FakeMutationObserver {
    constructor(fn) { this.fn = fn; this.targets = []; mutationObservers.push(this); }
    observe(target, options) { this.targets.push({ target, options }); }
  }
  const ids = {};
  const env = {
    window: {
      innerHeight, innerWidth, scrollY: 0, location, Element: FakeElement, ResizeObserver: FakeResizeObserver, MutationObserver: FakeMutationObserver,
      scrollTo(...args) { calls.push({ scrollTo: args }); },
      scroll(...args) { calls.push({ scroll: args }); },
    },
    document: { documentElement: root, body: new FakeElement({ tag: "BODY" }), activeElement: null, getElementById: (id) => ids[id] || null, getElementsByName: () => [] },
  };
  // The browser's layout pass: every observer gets its callback.
  const resized = () => observers.forEach((o) => o.fn([]));
  // The piece changed its DOM: every mutation observer gets its callback.
  const mutated = () => mutationObservers.forEach((o) => o.fn([{ type: "childList" }]));
  // bind(win): focus() then dispatches focusin on that bridge's window.
  return Object.assign(L, { env, root, calls, ids, observers, mutationObservers, FakeElement, resized, mutated, locationWrites, bind(win) { L.win = win; return win; } });
}
const heights = (of) => of("factory:height").map((m) => m.height);
// A plain primary click on target.
const click = (target, extra = {}) => ({
  type: "click", target, button: 0, defaultPrevented: false,
  preventDefault() { this.defaultPrevented = true; }, ...extra,
});

test("at open the bridge posts factory:height right after factory:ready, with the root's height in whole px", () => {
  const L = layout({ height: 640.2 });
  const { posted } = runBridge({}, L.env);
  assert.deepEqual(posted.map((p) => p.message), [
    { type: "factory:ready", persistence: true, nonce: "n-1" },
    { type: "factory:height", height: 641, nonce: "n-1" },
  ]);
  assert.equal(L.observers.length, 1);
  assert.deepEqual(L.observers[0].targets, [L.root], "the root is observed");
});

test("while the piece opens no height goes out; the first one follows factory:ready", async () => {
  const L = layout();
  const { posted, parsed } = runBridge({ readyState: "loading" }, L.env);
  L.resized();
  assert.deepEqual(posted, []);
  parsed();
  await tick();
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready", "factory:height"]);
});

test("a change of height posts another, and the same height is never posted twice in a row", () => {
  const L = layout({ height: 640 });
  const { of } = runBridge({}, L.env);
  L.root.height = 900; L.resized();
  L.resized();
  L.root.height = 899.5; L.resized(); // rounds up to the same 900
  assert.deepEqual(heights(of), [640, 900]);
  L.root.height = 400; L.resized(); // a shorter step: the frame shrinks too
  assert.deepEqual(heights(of), [640, 900, 400]);
});

test("a height of 0 (the frame has no size yet, so no layout) is not posted; the real one follows", () => {
  const L = layout({ height: 0 });
  const { posted, of } = runBridge({}, L.env);
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready"]);
  L.root.height = 520; L.resized();
  L.root.height = 0; L.resized();
  assert.deepEqual(heights(of), [520]);
});

test("without ResizeObserver the window's load posts the height; with it, load does not measure again", () => {
  const L = layout({ height: 640 });
  const { win, of } = runBridge({}, { ...L.env, window: { ...L.env.window, ResizeObserver: undefined } });
  L.root.height = 1200; win.dispatch("load"); // late images
  assert.deepEqual(heights(of), [640, 1200]);
  const W = layout({ height: 640 });
  const withObserver = runBridge({}, W.env);
  W.root.height = 1200; withObserver.win.dispatch("load"); // the observer reports it in its frame, where the loop guard is
  assert.deepEqual(heights(withObserver.of), [640]);
});

test("a growth that only follows the iframe's own growth is not posted (no feedback loop)", async () => {
  // A piece as tall as its frame plus 16 px (100vh + a margin): each new frame height would make it taller again.
  const L = layout({ height: 166, innerHeight: 150 });
  const { win, of } = runBridge({}, L.env);
  assert.deepEqual(heights(of), [166]);
  // The portal sizes the iframe to 166: in that same frame the piece grows by as much.
  win.innerHeight = 166; win.dispatch("resize");
  L.root.height = 182; L.resized();
  assert.deepEqual(heights(of), [166], "the growth followed the frame: not posted");
  await tick();
  // A change of the piece's own, in a later frame, goes out as usual.
  L.root.height = 300; L.resized();
  assert.deepEqual(heights(of), [166, 300]);
});

test("a change of the piece's own in the same frame as the iframe's resize is posted once that frame is over", async () => {
  // The piece is 1000 px; while the portal gives the iframe those 1000 px, the piece adds 200 px of its own (its DOM changes).
  const L = layout({ height: 1000, innerHeight: 462 });
  const { win, of } = runBridge({}, L.env);
  assert.deepEqual(L.mutationObservers.map((o) => o.targets.map((t) => [t.target === L.root, t.options.subtree])), [[[true, true]]]);
  win.innerHeight = 1000; win.dispatch("resize");
  L.mutated(); L.root.height = 1200; L.resized();
  assert.deepEqual(heights(of), [1000], "held back in that frame, like a growth that follows the frame");
  await tick();
  assert.deepEqual(heights(of), [1000, 1200], "measured again after the frame: the piece's own growth goes out");
});

test("a piece that changes its DOM and grows with its frame on every resize grows one step at most, then a change of its own goes out", async () => {
  // 100vh + 16 px, and the piece also touches its DOM on each resize (as a piece that recomputes something there).
  const L = layout({ height: 166, innerHeight: 150 });
  const { win, of } = runBridge({}, L.env);
  win.innerHeight = 166; win.dispatch("resize");
  L.mutated(); L.root.height = 182; L.resized();
  await tick();
  assert.deepEqual(heights(of), [166, 182], "one second measure");
  win.innerHeight = 182; win.dispatch("resize");
  L.mutated(); L.root.height = 198; L.resized();
  await tick();
  assert.deepEqual(heights(of), [166, 182], "not a second one in a row: no loop");
  // A change of the piece's own, outside a resize of its frame, goes out, and a held-back change may be measured again after it.
  L.mutated(); L.root.height = 400; L.resized();
  win.innerHeight = 400; win.dispatch("resize");
  L.mutated(); L.root.height = 420; L.resized();
  await tick();
  assert.deepEqual(heights(of), [166, 182, 400, 420]);
});

test("the loop guard holds when the frame got its first size without a resize event (Chrome, at open)", () => {
  // The frame has no size when the bridge starts; Chrome may lay it out at 390 x 150 without firing resize.
  const L = layout({ height: 300, innerHeight: 0, innerWidth: 0 });
  const { win, of } = runBridge({}, L.env);
  win.innerWidth = 390; win.innerHeight = 150;
  L.resized(); // the first layout: the same 300, nothing new to post
  assert.deepEqual(heights(of), [300]);
  // The portal sizes the frame to 300 (same width): a piece of 200vh follows it to 600 in that frame.
  win.innerHeight = 300; win.dispatch("resize");
  L.root.height = 600; L.resized();
  assert.deepEqual(heights(of), [300], "the growth followed the frame: not posted");
});

test("the loop guard lets through a shrink while the frame grows, and a change that comes with a new width", async () => {
  const L = layout({ height: 640, innerHeight: 150, innerWidth: 320 });
  const { win, of } = runBridge({}, L.env);
  win.innerHeight = 640; win.dispatch("resize");
  L.root.height = 500; L.resized(); // the frame grew, the piece shrank: not a loop
  assert.deepEqual(heights(of), [640, 500]);
  await tick();
  // The phone turned: a new width reflows the piece, whatever the frame's height did.
  win.innerWidth = 568; win.innerHeight = 700; win.dispatch("resize");
  L.root.height = 720; L.resized();
  assert.deepEqual(heights(of), [640, 500, 720]);
});

test("without layout (no ResizeObserver, no box) the bridge posts no height and still opens", () => {
  const { posted, win } = runBridge();
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready"]);
  assert.equal(typeof win.factorySubmit, "function");
});

test("scrollTo(0, 0) and scroll(...) ask the portal with factory:scroll and still scroll the piece", () => {
  const L = layout();
  const { win, of } = runBridge({}, L.env);
  win.scrollTo(0, 0);
  win.scroll({ top: 120.6, behavior: "smooth" });
  win.scrollTo({ left: 10 }); // sideways only: nothing for the portal
  win.scrollTo(0, -50);
  win.scrollTo(0, NaN); // a browser treats it as 0
  assert.deepEqual(of("factory:scroll"), [
    { type: "factory:scroll", top: 0, nonce: "n-1" },
    { type: "factory:scroll", top: 121, nonce: "n-1" },
    { type: "factory:scroll", top: 0, nonce: "n-1" },
    { type: "factory:scroll", top: 0, nonce: "n-1" },
  ]);
  assert.deepEqual(L.calls.map((c) => c.scrollTo || c.scroll), [[0, 0], [{ top: 120.6, behavior: "smooth" }], [{ left: 10 }], [0, -50], [0, NaN]]);
});

test("scrollIntoView on an element at 900 px asks the portal for top 900; block nearest asks only if needed", () => {
  const L = layout();
  const { win, of } = runBridge({}, L.env);
  const el = new L.FakeElement({ top: 900, height: 60 });
  el.scrollIntoView();
  assert.equal(L.calls.at(-1).element, el, "the piece's own scrollIntoView still runs");
  win.scrollY = 100; // a piece that scrolled inside anyway: the position is from the piece's top
  new L.FakeElement({ top: 800, height: 60 }).scrollIntoView({ block: "nearest" });
  assert.deepEqual(of("factory:scroll"), [
    { type: "factory:scroll", top: 900, nonce: "n-1" },
    { type: "factory:scroll", top: 900, bottom: 960, ifNeeded: true, nonce: "n-1" },
  ]);
});

test("a click on a link to #x of the piece asks for the position of #x and does not navigate", () => {
  const L = layout();
  const { win, of } = runBridge({}, L.env);
  L.ids.x = new L.FakeElement({ top: 1200 });
  const link = new L.FakeElement({ tag: "A", attrs: { href: "#x" } });
  const event = click(new L.FakeElement({ tag: "SPAN", parent: link }));
  win.dispatch("click", event);
  assert.equal(event.defaultPrevented, true, "no in-frame navigation");
  assert.deepEqual(L.locationWrites, [], "the iframe's location (and its hash) is never written");
  assert.deepEqual(of("factory:scroll"), [{ type: "factory:scroll", top: 1200, nonce: "n-1" }]);
});

test("after an anchor click focus moves to the target without scrolling, as a browser's fragment navigation does", () => {
  const L = layout();
  const { win, of } = runBridge({}, L.env);
  L.bind(win);
  const go = (href) => win.dispatch("click", click(new L.FakeElement({ tag: "A", attrs: { href } })));
  // A heading (not focusable): it gets tabindex -1 so it can take focus, keyboard and screen reader users land there.
  L.ids.group = new L.FakeElement({ tag: "H2", top: 800 });
  go("#group");
  assert.equal(win.document.activeElement, L.ids.group);
  assert.equal(L.ids.group.getAttribute("tabindex"), "-1");
  assert.equal(L.ids.group.focusOptions.preventScroll, true, "the portal scrolls, not the focus");
  // A control keeps its own tabindex behaviour: no tabindex added.
  L.ids.field = new L.FakeElement({ tag: "INPUT", top: 900 });
  go("#field");
  assert.equal(win.document.activeElement, L.ids.field);
  assert.equal(L.ids.field.hasAttribute("tabindex"), false);
  // An element with a tabindex of its own keeps it.
  L.ids.card = new L.FakeElement({ top: 1000, attrs: { tabindex: "0" } });
  go("#card");
  assert.equal(win.document.activeElement, L.ids.card);
  assert.equal(L.ids.card.getAttribute("tabindex"), "0");
  // The focus the bridge moves asks for no second scroll: one factory:scroll per click.
  assert.deepEqual(of("factory:scroll"), [
    { type: "factory:scroll", top: 800, nonce: "n-1" },
    { type: "factory:scroll", top: 900, nonce: "n-1" },
    { type: "factory:scroll", top: 1000, nonce: "n-1" },
  ]);
  // A focus the person makes afterwards still asks as usual.
  new L.FakeElement({ tag: "BUTTON", top: 50 }).focus();
  assert.deepEqual(of("factory:scroll").at(-1), { type: "factory:scroll", top: 50, bottom: 90, ifNeeded: true, nonce: "n-1" });
});

test("#, #top and a missing anchor move no focus", () => {
  const L = layout();
  const { win } = runBridge({}, L.env);
  L.bind(win);
  for (const href of ["#", "#top", "#missing"]) win.dispatch("click", click(new L.FakeElement({ tag: "A", attrs: { href } })));
  assert.equal(win.document.activeElement, null);
});

test("#, #top and an encoded id work; a missing anchor does not navigate nor scroll; other links are left alone", () => {
  const L = layout();
  const { win, of } = runBridge({}, L.env);
  L.ids["paso 2"] = new L.FakeElement({ top: 300 });
  const link = (attrs) => new L.FakeElement({ tag: "A", attrs });
  for (const href of ["#", "#top", "#paso%202", "#missing"]) {
    const event = click(link({ href }));
    win.dispatch("click", event);
    assert.equal(event.defaultPrevented, true, href);
  }
  assert.deepEqual(of("factory:scroll").map((m) => m.top), [0, 0, 300]);
  L.ids.x = new L.FakeElement({ top: 50 });
  const untouched = [
    click(link({ href: "https://example.test/a" })),
    click(link({ href: "#x", target: "_blank" })),
    click(link({ href: "#x", download: "" })),
    click(link({ href: "#x" }), { metaKey: true }),
    click(link({ href: "#x" }), { ctrlKey: true }),
    click(link({ href: "#x" }), { shiftKey: true }),
    click(link({ href: "#x" }), { button: 1 }),
    click(new L.FakeElement({ tag: "BUTTON" })),
    click(null),
  ];
  for (const event of untouched) win.dispatch("click", event);
  assert.ok(untouched.every((e) => !e.defaultPrevented));
  const prevented = click(link({ href: "#x" }), { defaultPrevented: true }); // the piece handled it itself
  win.dispatch("click", prevented);
  assert.equal(of("factory:scroll").length, 3);
});

test("focusin on a control asks the portal to show it only if needed", () => {
  const L = layout();
  const { win, of } = runBridge({}, L.env);
  win.dispatch("focusin", { target: new L.FakeElement({ tag: "INPUT", top: 700.4, height: 44 }) });
  win.dispatch("focusin", { target: win.document.body });
  win.dispatch("focusin", { target: win.document.documentElement });
  win.dispatch("focusin", { target: null });
  assert.deepEqual(of("factory:scroll"), [{ type: "factory:scroll", top: 700, bottom: 744, ifNeeded: true, nonce: "n-1" }]);
});

test("scroll requests made while the piece opens stay inside (the portal does not jump on open)", async () => {
  const L = layout();
  const { win, posted, parsed } = runBridge({ readyState: "loading" }, L.env);
  win.scrollTo(0, 0);
  new L.FakeElement({ top: 300 }).scrollIntoView();
  win.dispatch("focusin", { target: new L.FakeElement({ tag: "INPUT", top: 400 }) });
  assert.deepEqual(posted, []);
  assert.equal(L.calls.length, 2, "the piece still scrolled itself");
  parsed();
  await tick();
  win.scrollTo(0, 0);
  assert.deepEqual(posted.map((p) => p.message.type), ["factory:ready", "factory:height", "factory:scroll"]);
});

test("a closed or observed piece still tells its height and where to scroll", () => {
  for (const host of [{ closed: "received", sentAt: "2026-10-22T15:00:00Z" }, { closed: "received", observer: true }]) {
    const L = layout({ height: 500 });
    const { win, of } = runBridge({ host }, L.env);
    win.scrollTo(0, 0);
    assert.deepEqual(heights(of), [500], JSON.stringify(host));
    assert.equal(of("factory:scroll").length, 1, JSON.stringify(host));
  }
});

test("every message the bridge posts carries the nonce, and only to the portal's origin", async () => {
  const L = layout();
  const { win, posted, fromParent } = runBridge({}, L.env);
  L.root.height = 800; L.resized();
  win.scrollTo(0, 0);
  new L.FakeElement({ top: 900 }).scrollIntoView();
  L.ids.x = new L.FakeElement({ top: 10 });
  win.dispatch("click", click(new L.FakeElement({ tag: "A", attrs: { href: "#x" } })));
  win.dispatch("focusin", { target: new L.FakeElement({ tag: "SELECT", top: 20 }) });
  win.localStorage.setItem("k", "v");
  fromParent({ type: "factory:flush", nonce: "n-1" });
  win.factorySubmit(questions());
  const submit = posted.find((p) => p.message.type === "factory:submit").message;
  fromParent({ type: "factory:submit-result", nonce: "n-1", requestId: submit.requestId, ok: true }); // no 45 s timer left behind
  const types = new Set(posted.map((p) => p.message.type));
  for (const type of ["factory:ready", "factory:height", "factory:scroll", "factory:dirty", "factory:draft", "factory:flushed", "factory:submit"]) {
    assert.ok(types.has(type), type);
  }
  assert.ok(posted.every((p) => p.message.nonce === "n-1" && p.origin === ORIGIN));
});

test("the built script with the size and scroll code still has no </script nor <!--", () => {
  const script = buildBridgeScript(config);
  assert.ok(script.includes("factory:height") && script.includes("factory:scroll"));
  assert.equal(script.match(/<\/script/gi).length, 1, "only the final closing tag");
  assert.equal(script.match(/<!--/g), null);
});
