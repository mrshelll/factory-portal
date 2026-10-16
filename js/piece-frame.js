// Mounts a piece in a sandboxed iframe and speaks the bridge protocol with it.
// Used by the portal (js/app.js) and by the local test harness (tests/harness.html).

import { injectBridge } from "./bridge.js";
import { parseBridgeMessage } from "./host.js";

// No allow-same-origin: the piece runs in an opaque origin and cannot reach the portal's storage.
export const SANDBOX = "allow-scripts allow-downloads allow-modals allow-forms";

export function mountPiece({ container, html, kind, storage, title, onReady, onDraft, onSubmit, onSubmitError, onRejected }) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", SANDBOX);
  iframe.setAttribute("title", title);
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.className = "piece-frame";
  let flushWaiters = [];
  let destroyed = false;

  function onMessage(event) {
    if (destroyed || !iframe.contentWindow || event.source !== iframe.contentWindow) return;
    const parsed = parseBridgeMessage(event.data, kind);
    if (!parsed.ok) { if (onRejected) onRejected(parsed.reason); return; }
    const message = parsed.message;
    if (message.type === "factory:ready" && onReady) onReady(message);
    else if (message.type === "factory:draft" && onDraft) onDraft(message.storage);
    else if (message.type === "factory:submit" && onSubmit) onSubmit(message);
    else if (message.type === "factory:submit-error" && onSubmitError) onSubmitError(message);
    else if (message.type === "factory:flushed") { const w = flushWaiters; flushWaiters = []; w.forEach((r) => r(true)); }
  }

  // The child has an opaque origin, so the parent can only target "*"; it sends no secrets.
  function post(message) {
    if (!destroyed && iframe.contentWindow) iframe.contentWindow.postMessage(message, "*");
  }

  window.addEventListener("message", onMessage);
  iframe.srcdoc = injectBridge(html, { parentOrigin: window.location.origin, kind, storage });
  container.append(iframe);

  return {
    iframe,
    collect(requestId) { post({ type: "factory:collect", requestId }); },
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
}
