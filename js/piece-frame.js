// Mounts a piece in a sandboxed iframe and speaks the bridge protocol with it.
// Used by the portal (js/app.js) and by the local test harness (tests/harness.html).

import { injectBridge } from "./bridge.js";
import { parseBridgeMessage } from "./host.js";

// No allow-same-origin: the piece runs in an opaque origin and cannot reach the portal's storage.
// allow-popups (+ escape-sandbox) lets a piece open a link with target="_blank" (the demo sheet
// opens the prototype in a new tab) as a normal, unsandboxed page.
export const SANDBOX = "allow-scripts allow-downloads allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox";

export function randomNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// host: { reviewerName } for globalThis.factoryHost inside the piece. onSubmit({ requestId, payload })
// must end with respond(requestId, { ok: true } | { ok: false, error }). onNavigatedAway: the iframe
// loaded a second document (the piece navigated or reloaded); the frame is already destroyed when it
// is called. onSaveFailed(reason): the piece tried to keep a change that does not fit ("too-large");
// the change was not stored. submitTimeoutMs and quotaChars only change in tests.
export function mountPiece({ container, html, kind, storage, title, host, submitTimeoutMs, quotaChars, onReady, onDirty, onDraft, onSaveFailed, onSubmit, onRejected, onNavigatedAway }) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", SANDBOX);
  iframe.setAttribute("title", title);
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.className = "piece-frame";
  let flushWaiters = [];
  let destroyed = false;
  let loads = 0;
  const nonce = randomNonce();

  function onMessage(event) {
    if (destroyed || !iframe.contentWindow || event.source !== iframe.contentWindow) return;
    const parsed = parseBridgeMessage(event.data, kind, nonce);
    if (!parsed.ok) { if (onRejected) onRejected(parsed.reason); return; }
    const message = parsed.message;
    if (message.type === "factory:ready" && onReady) onReady(message);
    else if (message.type === "factory:dirty" && onDirty) onDirty();
    else if (message.type === "factory:draft" && onDraft) onDraft(message.storage);
    else if (message.type === "factory:save-failed" && onSaveFailed) onSaveFailed(message.reason);
    else if (message.type === "factory:submit" && onSubmit) onSubmit(message);
    else if (message.type === "factory:flushed") { const w = flushWaiters; flushWaiters = []; w.forEach((r) => r(true)); }
  }

  // The child has an opaque origin, so the parent can only target "*"; it sends no secrets.
  function post(message) {
    if (!destroyed && iframe.contentWindow) iframe.contentWindow.postMessage({ ...message, nonce }, "*");
  }

  window.addEventListener("message", onMessage);
  iframe.addEventListener("load", () => {
    loads += 1;
    if (loads > 1 && !destroyed) {
      api.destroy();
      if (onNavigatedAway) onNavigatedAway();
    }
  });
  iframe.srcdoc = injectBridge(html, { parentOrigin: window.location.origin, kind, storage, nonce, host, submitTimeoutMs, quotaChars });
  container.append(iframe);

  const api = {
    iframe,
    // Answers a factory:submit. Anything but { ok: true } is a failure; the bridge maps an unknown
    // error to "rejected".
    respond(requestId, result) {
      const ok = Boolean(result && result.ok === true);
      post(ok ? { type: "factory:submit-result", requestId, ok }
        : { type: "factory:submit-result", requestId, ok, error: String(result && result.error || "rejected") });
    },
    // Asks the piece to send its pending draft now; resolves true when it answered, false on timeout.
    flush(timeoutMs = 1500) {
      if (destroyed) return Promise.resolve(false);
      return new Promise((resolve) => {
        const timer = setTimeout(() => { flushWaiters = flushWaiters.filter((w) => w !== done); resolve(false); }, timeoutMs);
        const done = (value) => { clearTimeout(timer); resolve(value); };
        flushWaiters.push(done);
        post({ type: "factory:flush" });
      });
    },
    destroy() {
      destroyed = true;
      window.removeEventListener("message", onMessage);
      const w = flushWaiters; flushWaiters = []; w.forEach((r) => r(false));
      iframe.remove();
    },
  };
  return api;
}
