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
//    parent knows there is unsaved work during the debounce. Every message carries a per-mount
//    nonce, and the bridge ignores parent messages without it.
//
// 2. Submit: when the parent asks (`factory:collect`), the bridge arms a one-shot capture, calls
//    the piece's own export function (the one behind its "Download" button), intercepts the JSON
//    Blob that the function hands to a temporary `<a download>` (by wrapping
//    `URL.createObjectURL` and `HTMLAnchorElement.prototype.click`, plus a capture-phase click
//    listener), suppresses that download, and posts `{ type: "factory:submit", payload }`.
//    Outside a capture, downloads behave as usual, so the piece's own "Download" stays as a
//    fallback.
//
// `bridgeRuntime` is serialized with Function.prototype.toString, so it must stay self-contained
// (no references to module scope) and must never contain the character sequences "</script" or
// "<!--" (the unit tests check the built script).

export const DRAFT_DEBOUNCE_MS = 800;
// The shim refuses to grow past this many characters (keys + values), well under the 1 MB
// message limit enforced by the parent.
export const STORAGE_QUOTA_CHARS = 900000;

function bridgeRuntime(cfg) {
  "use strict";
  var parentOrigin = cfg.parentOrigin;
  var kind = cfg.kind;
  var nonce = cfg.nonce;
  var debounceMs = cfg.debounceMs;
  var quota = cfg.quotaChars;
  var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

  // Every message carries this mount's nonce; a page the iframe navigates to never sees it.
  function post(message) {
    message.nonce = nonce;
    try { window.parent.postMessage(message, parentOrigin); } catch (e) { /* parent gone */ }
  }

  function quotaError() {
    try { return new DOMException("The quota has been exceeded.", "QuotaExceededError"); }
    catch (e) { var err = new Error("QuotaExceededError"); err.name = "QuotaExceededError"; return err; }
  }

  function makeStorage(seed, onChange) {
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
        if (next > quota) throw quotaError();
        if (data.get(key) === value) return;
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
  var local = makeStorage(cfg.storage, function () {
    // Tell the parent right away (without the content) so it knows there is unsaved work
    // during the debounce, e.g. for its beforeunload warning.
    if (!dirty) post({ type: "factory:dirty" });
    dirty = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(sendDraft, debounceMs);
  });
  var session = makeStorage(null, null);

  function sendDraft() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!dirty) return;
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

  // ---- export capture ----------------------------------------------------------------------
  var blobs = new Map();
  var capture = { armed: false, blob: null };
  var originalCreate = URL.createObjectURL;
  var originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = function (obj) {
    var url = originalCreate.apply(URL, arguments);
    if (typeof Blob !== "undefined" && obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) { blobs.delete(url); return originalRevoke.apply(URL, arguments); };

  function exportedBlob(anchor) {
    if (!anchor || !anchor.hasAttribute || !anchor.hasAttribute("download")) return null;
    var blob = blobs.get(anchor.href);
    if (!blob) return null;
    var isJson = /json/i.test(blob.type || "") || /\.json$/i.test(anchor.getAttribute("download") || "");
    return isJson ? blob : null;
  }
  var originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (capture.armed) {
      var blob = exportedBlob(this);
      if (blob) { capture.blob = blob; return undefined; }
    }
    return originalClick.apply(this, arguments);
  };
  window.addEventListener("click", function (event) {
    if (!capture.armed) return;
    var target = event.target;
    var anchor = target && target.closest ? target.closest("a[download]") : null;
    var blob = exportedBlob(anchor);
    if (blob) { event.preventDefault(); capture.blob = blob; }
  }, true);

  // Each adapter calls the same functions the piece's own buttons call.
  var adapters = {
    // factory-orchestrator/assets/preguntas.template.html: "Enviar respuestas" -> enviar(),
    // then "Descargar el archivo" -> descargar(), which builds resultado() into a JSON Blob.
    questions: {
      available: function () {
        return typeof window.enviar === "function" && typeof window.descargar === "function" &&
          typeof window.resultado === "function";
      },
      run: function () {
        var r = window.resultado();
        if (!r || !Array.isArray(r.respuestas) || !r.respuestas.length) return "empty";
        if (!r.enviada_en) {
          window.enviar(); // may ask "send only the answered ones?" with confirm()
          r = window.resultado();
          if (!r || !r.enviada_en) return "cancelled";
        }
        window.descargar();
        return "ok";
      },
      valid: function (p) { return !!p && p.formato === "respuestas-fabrica/1" && Array.isArray(p.respuestas); },
    },
    // ux-flows/assets/recorrido-flujos.template.html: "Descargar mi revisión" -> downloadReview(),
    // which may prompt() for the reviewer name or alert() that nothing was reviewed yet.
    flow_review: {
      available: function () { return typeof window.downloadReview === "function"; },
      run: function () { window.downloadReview(); return "ok"; },
      valid: function (p) { return !!p && p.artefacto === "ux-flows.md" && Array.isArray(p.flujos); },
    },
  };

  function readBlob(blob) {
    if (blob.text) return blob.text();
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(blob);
    });
  }

  var collecting = false;
  function collect(requestId) {
    var fail = function (reason) { post({ type: "factory:submit-error", requestId: requestId, reason: reason }); };
    var adapter = hasOwn(adapters, kind) ? adapters[kind] : null;
    if (!adapter || !adapter.available()) return fail("unsupported");
    if (collecting) return fail("busy");
    collecting = true;
    capture.armed = true; capture.blob = null;
    var outcome = "error";
    try { outcome = adapter.run(); } catch (e) { outcome = "error"; }
    finally { capture.armed = false; }
    var blob = capture.blob;
    capture.blob = null;
    if (!blob) { collecting = false; return fail(outcome === "ok" ? "empty" : outcome); }
    if (blob.size >= quota) { collecting = false; return fail("too-large"); }
    readBlob(blob).then(function (text) {
      var payload;
      try { payload = JSON.parse(text); } catch (e) { return fail("invalid"); }
      if (!adapter.valid(payload)) return fail("invalid");
      sendDraft(); // the export may have touched storage (e.g. the "sent at" time)
      post({ type: "factory:submit", requestId: requestId, payload: payload });
    }, function () { fail("error"); }).then(function () { collecting = false; });
  }

  // ---- messages from the parent ------------------------------------------------------------
  window.addEventListener("message", function (event) {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    var data = event.data;
    if (!data || typeof data !== "object" || data.nonce !== nonce) return;
    if (data.type === "factory:flush") { sendDraft(); post({ type: "factory:flushed" }); }
    else if (data.type === "factory:collect" && typeof data.requestId === "string") collect(data.requestId);
  });
  window.addEventListener("pagehide", sendDraft);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") sendDraft(); });

  function ready() {
    var adapter = hasOwn(adapters, kind) ? adapters[kind] : null;
    post({ type: "factory:ready", persistence: persistence, canSubmit: !!(adapter && adapter.available()) });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
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

export function buildBridgeScript({ parentOrigin, kind, storage, nonce }) {
  if (typeof nonce !== "string" || !nonce) throw new Error("buildBridgeScript needs a nonce");
  const cfg = {
    parentOrigin: String(parentOrigin),
    kind: String(kind),
    nonce,
    storage: cleanStorage(storage),
    debounceMs: DRAFT_DEBOUNCE_MS,
    quotaChars: STORAGE_QUOTA_CHARS,
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
