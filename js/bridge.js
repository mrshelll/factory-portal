// Bridge between the portal (parent) and a factory piece running in a sandboxed iframe.
//
// The piece is loaded with `srcdoc` and `sandbox` WITHOUT `allow-same-origin`, so it runs in an
// opaque origin: it cannot read the portal's storage (where the Supabase session lives), and its
// own `localStorage` / `sessionStorage` throw a SecurityError. The bridge script is injected as
// the first element of the piece's <head>, so it runs before any piece code, and it:
//
// 1. Persistence: replaces `window.localStorage` with an in-memory Storage shim seeded from
//    `piece_drafts.storage`. Method: `Object.defineProperty(window, "localStorage", { value,
//    configurable: true })`. On Window, `localStorage` is a configurable own accessor property, so
//    redefining it as a data property makes the bare identifier `localStorage` (which resolves
//    through the global object) return the shim. The bridge checks `window.localStorage === shim`
//    afterwards and reports the result in `factory:ready` (`persistence`). Every change posts
//    `{ type: "factory:draft", storage }` to the parent, debounced. `sessionStorage` gets the same
//    shim without persistence (session semantics).
//
//    The first change after each draft also posts `{ type: "factory:dirty" }` at once, so the
//    parent knows there is unsaved work during the debounce. Writes the piece makes while it opens
//    (before one task after DOMContentLoaded, when `factory:ready` is posted) post nothing on their
//    own: they are not the person's doing, and they travel with the first later change. Every message carries a per-mount
//    nonce, and the bridge ignores parent messages without it.
//
//    A write that would take the shim past its quota throws QuotaExceededError (as a real
//    localStorage does) and nothing is stored. The bridge then sends the pending draft and posts
//    `{ type: "factory:save-failed", reason: "too-large" }`, once: further refused writes stay
//    quiet until a write that fits, after which a new refusal posts again. A write that fits counts
//    even when it equals the stored value (the person undid a paste back to what was saved): it
//    sends a draft, so the parent learns the storage is fine again. Because the pending draft goes
//    first, any draft the parent gets after factory:save-failed holds a write made after the
//    refusal.
//
// 2. Submit: defines `globalThis.factorySubmit(payload)`, the piece's single way to send. It checks
//    the payload against the shape of the piece kind, flushes the pending draft, posts
//    `{ type: "factory:submit", requestId, payload }` and resolves with the parent's
//    `{ type: "factory:submit-result", requestId, ok, error? }`: `{ ok: true }` only after the
//    server saved, `{ ok: false, error }` otherwise ("invalid", "too-large", "timeout", "network",
//    "session-expired", "rejected"). A second call while one is in flight returns the same
//    promise. Downloads are not touched, so the piece's own "Download a copy" works as usual.
//
// 3. Host: defines a frozen `globalThis.factoryHost = { persistence, reviewerName, closed, observer, sentAt }`.
//    `persistence` is "server" when the localStorage shim took, "none" otherwise. `closed` is
//    "received" or "replaced" when the piece is closed (read-only: the factory already collected it,
//    or a newer version replaced it), null otherwise; `sentAt` is when the person sent it (an ISO
//    string) or null. `observer` is true when the project owner is reading the piece (the portal
//    passes it only with `closed`; false otherwise, so a piece can hide its send controls). With `closed` set the bridge posts no factory:draft, factory:dirty nor
//    factory:save-failed: the piece may still write the shim (in memory), but nothing leaves the
//    iframe, so the server draft keeps the person's unsent changes. factory:flush still answers
//    factory:flushed and factorySubmit still sends (the server turns it into a late change
//    request). The fields are sanitized in the parent before injection. It also sets
//    `data-factory-host="portal"` on the piece's <html> before any of the piece is parsed, so the
//    piece's CSS can drop its own brand bar inside the portal without a flash.
//
// `bridgeRuntime` is serialized with Function.prototype.toString, so it must stay self-contained
// (no references to module scope) and must never contain the character sequences "</script" or
// "<!--" (the unit tests check the built script).

import { PAYLOAD_SHAPES, SUBMIT_ERRORS } from "./host.js";

export const DRAFT_DEBOUNCE_MS = 800;
// The shim refuses to grow past this many characters (keys + values), well under the 1 MB
// message limit enforced by the parent.
export const STORAGE_QUOTA_CHARS = 900000;
// A submitted payload must stay under this many UTF-8 bytes, also under the parent's 1 MB limit.
export const SUBMIT_MAX_BYTES = 900000;
// factorySubmit gives up after this long without an answer from the parent.
export const SUBMIT_TIMEOUT_MS = 45000;

function bridgeRuntime(cfg) {
  "use strict";
  var parentOrigin = cfg.parentOrigin;
  var nonce = cfg.nonce;
  var debounceMs = cfg.debounceMs;
  var quota = cfg.quotaChars;
  var closed = cfg.closed; // "received" | "replaced" | null: a closed piece saves no drafts

  // The bridge runs first in <head>, before the piece's styles and body are parsed, so the piece's CSS
  // can hide what the portal already shows (its own brand bar) from the first paint.
  try { document.documentElement.setAttribute("data-factory-host", "portal"); } catch (e) { /* no root: leave it */ }

  // Every message carries this mount's nonce; a page the iframe navigates to never sees it.
  function post(message) {
    message.nonce = nonce;
    try { window.parent.postMessage(message, parentOrigin); } catch (e) { /* parent gone */ }
  }

  function quotaError() {
    try { return new DOMException("The quota has been exceeded.", "QuotaExceededError"); }
    catch (e) { var err = new Error("QuotaExceededError"); err.name = "QuotaExceededError"; return err; }
  }

  // onQuota runs when a write is refused for the quota, just before it throws; onSame when a write
  // fits but equals the stored value (no change).
  function makeStorage(seed, onChange, onQuota, onSame) {
    var data = new Map();
    var size = 0;
    if (seed && typeof seed === "object" && !Array.isArray(seed)) {
      Object.keys(seed).forEach(function (k) {
        if (typeof seed[k] === "string") { data.set(k, seed[k]); size += k.length + seed[k].length; }
      });
    }
    function changed() { if (onChange) onChange(); }
    // Methods live on a prototype so that, like a real Storage, own keys are only the items.
    var proto = {
      getItem: function (key) { key = String(key); return data.has(key) ? data.get(key) : null; },
      setItem: function (key, value) {
        key = String(key); value = String(value);
        var old = data.has(key) ? key.length + data.get(key).length : 0;
        var next = size - old + key.length + value.length;
        if (next > quota) { if (onQuota) onQuota(); throw quotaError(); }
        if (data.get(key) === value) { if (onSame) onSame(); return; }
        data.set(key, value); size = next; changed();
      },
      removeItem: function (key) {
        key = String(key);
        if (!data.has(key)) return;
        size -= key.length + data.get(key).length; data.delete(key); changed();
      },
      clear: function () { if (!data.size) return; data.clear(); size = 0; changed(); },
      key: function (index) {
        var keys = Array.from(data.keys());
        var i = Math.floor(Number(index));
        return i >= 0 && i < keys.length ? keys[i] : null;
      },
    };
    Object.defineProperty(proto, "length", { get: function () { return data.size; } });
    var target = Object.create(proto);
    var snapshot = function () {
      var out = {};
      data.forEach(function (v, k) { out[k] = v; });
      return out;
    };
    if (typeof Proxy !== "function") return { api: target, snapshot: snapshot };
    // Proxy so that property-style access (localStorage.foo = "x") also behaves like Storage.
    var proxy = new Proxy(target, {
      get: function (t, p) {
        if (typeof p === "symbol" || p in t) return t[p];
        return data.has(p) ? data.get(p) : undefined;
      },
      set: function (t, p, v) {
        if (typeof p === "symbol" || p in t) return true;
        proto.setItem(p, v); return true;
      },
      has: function (t, p) { return p in t || data.has(p); },
      deleteProperty: function (t, p) { if (typeof p === "string") proto.removeItem(p); return true; },
      ownKeys: function () { return Array.from(data.keys()); },
      getOwnPropertyDescriptor: function (t, p) {
        if (typeof p === "string" && data.has(p)) {
          return { value: data.get(p), writable: true, enumerable: true, configurable: true };
        }
        return undefined;
      },
    });
    return { api: proxy, snapshot: snapshot };
  }

  // ---- persistence -------------------------------------------------------------------------
  var timer = null;
  var dirty = false;
  var refused = false; // a write was refused for the quota and no write has fit since
  // What the piece writes while it opens (restoring, stamping the opening time, probing the storage) is
  // not the person's doing: it posts nothing (no dirty, no draft, not even on flush or pagehide), so the
  // portal never says «Guardando…» for it, and it travels with the first change made after that. The
  // opening ends one task after DOMContentLoaded, once the piece's start-up code has run.
  var opening = true;
  function onLocalChange() {
    refused = false;
    if (opening || closed) return;
    // Tell the parent right away (without the content) so it knows there is unsaved work
    // during the debounce, e.g. for its beforeunload warning.
    if (!dirty) post({ type: "factory:dirty" });
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(sendDraft, debounceMs);
  }
  var local = makeStorage(cfg.storage, onLocalChange, function () {
    if (refused || closed) return;
    refused = true;
    sendDraft(); // what fit before the refusal goes first
    post({ type: "factory:save-failed", reason: "too-large" });
  }, function () {
    if (refused) onLocalChange(); // back to a value that fits: tell the parent with a draft
  });
  var session = makeStorage(null, null);

  function sendDraft() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty || closed) return;
    dirty = false;
    post({ type: "factory:draft", storage: local.snapshot() });
  }

  function install(name, value) {
    try { Object.defineProperty(window, name, { value: value, configurable: true, enumerable: true, writable: false }); }
    catch (e) { /* fall through to the check */ }
    try { return window[name] === value; } catch (e) { return false; }
  }
  var persistence = install("localStorage", local.api);
  install("sessionStorage", session.api);

  function define(name, value) {
    try { Object.defineProperty(window, name, { value: value, configurable: false, enumerable: true, writable: false }); }
    catch (e) { /* already defined by someone else: leave it */ }
  }

  // ---- submit ------------------------------------------------------------------------------
  var shape = cfg.payloadShape;
  var errors = cfg.submitErrors;
  var inflight = null; // { requestId, promise, resolve, timer }
  var counter = 0;

  function byteLength(text) {
    if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
    return text.length * 3;
  }

  function finish(result) {
    var current = inflight;
    if (!current) return;
    inflight = null;
    clearTimeout(current.timer);
    current.resolve(result);
  }

  function factorySubmit(payload) {
    if (inflight) return inflight.promise;
    var json;
    try { json = JSON.stringify(payload); } catch (e) { json = undefined; }
    var clean = null;
    if (typeof json === "string") { try { clean = JSON.parse(json); } catch (e) { clean = null; } }
    var valid = !!shape && !!clean && typeof clean === "object" && !Array.isArray(clean) &&
      clean[shape.field] === shape.value && Array.isArray(clean[shape.list]);
    if (!valid) return Promise.resolve({ ok: false, error: "invalid" });
    if (byteLength(json) >= cfg.submitMaxBytes) return Promise.resolve({ ok: false, error: "too-large" });
    counter += 1;
    var current = { requestId: "submit-" + counter + "-" + Date.now().toString(36), timer: null, resolve: null };
    current.promise = new Promise(function (resolve) { current.resolve = resolve; });
    inflight = current;
    current.timer = setTimeout(function () { if (inflight === current) finish({ ok: false, error: "timeout" }); }, cfg.submitTimeoutMs);
    sendDraft(); // the piece usually writes its "sent at" just before sending
    post({ type: "factory:submit", requestId: current.requestId, payload: clean });
    return current.promise;
  }

  function onSubmitResult(data) {
    if (!inflight || data.requestId !== inflight.requestId) return; // late (after a timeout) or not ours
    if (data.ok === true) return finish({ ok: true });
    finish({ ok: false, error: errors.indexOf(data.error) !== -1 ? data.error : "rejected" });
  }

  define("factorySubmit", factorySubmit);
  define("factoryHost", Object.freeze({
    persistence: persistence ? "server" : "none",
    reviewerName: cfg.reviewerName,
    closed: closed,
    observer: cfg.observer,
    sentAt: cfg.sentAt,
  }));

  // ---- messages from the parent ------------------------------------------------------------
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.nonce !== nonce) return;
    if (data.type === "factory:flush") { sendDraft(); post({ type: "factory:flushed" }); }
    else if (data.type === "factory:submit-result" && typeof data.requestId === "string") onSubmitResult(data);
  });
  window.addEventListener("pagehide", sendDraft);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") sendDraft(); });

  function opened() { opening = false; post({ type: "factory:ready", persistence: persistence }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(opened, 0); });
  else opened();
}

// JSON that is safe inside an inline <script>: every "<", ">" and "&" travels as a \u escape
// (covers "</script" and "<!--"), and U+2028 / U+2029 are escaped too. JS reads the same value.
export function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function cleanStorage(storage) {
  const out = {};
  if (storage && typeof storage === "object" && !Array.isArray(storage)) {
    for (const [key, value] of Object.entries(storage)) {
      if (typeof value === "string") out[key] = value;
    }
  }
  return out;
}

function cleanReviewerName(host) {
  const name = host && typeof host.reviewerName === "string" ? host.reviewerName.trim() : "";
  return name || null;
}

const CLOSED_STATES = ["received", "replaced"];

function cleanClosed(host) {
  return host && CLOSED_STATES.includes(host.closed) ? host.closed : null;
}

// True only when the owner is reading (host.observer === true) a closed piece; anything else is false.
function cleanObserver(host) {
  return cleanClosed(host) !== null && host.observer === true;
}

// Any string Date.parse accepts (the portal passes the response's submitted_at); anything else is null.
function cleanSentAt(host) {
  const value = host && typeof host.sentAt === "string" ? host.sentAt.trim() : "";
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
}

const positiveOr = (value, fallback) => (Number.isFinite(value) && value > 0 ? value : fallback);

// host: { reviewerName, closed, observer, sentAt } for globalThis.factoryHost. submitTimeoutMs and quotaChars only change in tests.
export function buildBridgeScript({ parentOrigin, kind, storage, nonce, host, submitTimeoutMs = SUBMIT_TIMEOUT_MS, quotaChars = STORAGE_QUOTA_CHARS }) {
  if (typeof nonce !== "string" || !nonce) throw new Error("buildBridgeScript needs a nonce");
  const cfg = {
    parentOrigin: String(parentOrigin),
    nonce,
    storage: cleanStorage(storage),
    debounceMs: DRAFT_DEBOUNCE_MS,
    quotaChars: positiveOr(quotaChars, STORAGE_QUOTA_CHARS),
    payloadShape: Object.hasOwn(PAYLOAD_SHAPES, kind) ? PAYLOAD_SHAPES[kind] : null,
    submitErrors: SUBMIT_ERRORS,
    submitMaxBytes: SUBMIT_MAX_BYTES,
    submitTimeoutMs: positiveOr(submitTimeoutMs, SUBMIT_TIMEOUT_MS),
    reviewerName: cleanReviewerName(host),
    closed: cleanClosed(host),
    observer: cleanObserver(host),
    sentAt: cleanSentAt(host),
  };
  return `<script>(${bridgeRuntime.toString()})(${serializeForScript(cfg)});</script>`;
}

// Inserts the bridge as the first thing inside <head>. Without <head>, a <head> is created right
// after <html> or the doctype; the doctype must stay first or the piece falls into quirks mode.
export function injectBridge(html, config) {
  const source = typeof html === "string" ? html : "";
  const script = buildBridgeScript(config);
  const head = /<head(?:\s[^>]*)?>/i.exec(source);
  if (head) {
    const at = head.index + head[0].length;
    return source.slice(0, at) + script + source.slice(at);
  }
  const opener = /<html(?:\s[^>]*)?>/i.exec(source) || /^\s*<!doctype[^>]*>/i.exec(source);
  const at = opener ? opener.index + opener[0].length : 0;
  return source.slice(0, at) + "<head>" + script + "</head>" + source.slice(at);
}
