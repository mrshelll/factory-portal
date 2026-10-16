// Parent-side helpers for hosting a piece: message validation and the draft save queue.
// Pure module (no DOM, no Supabase) so it can be unit tested with node --test.

export const MAX_MESSAGE_BYTES = 1000000;

export const SUBMIT_ERROR_REASONS = ["unsupported", "busy", "empty", "cancelled", "too-large", "invalid", "error"];

const encoder = new TextEncoder();

export function byteLength(value) {
  try { return encoder.encode(JSON.stringify(value)).length; } catch { return Infinity; }
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isValidPayload(kind, payload) {
  if (!isPlainObject(payload)) return false;
  if (kind === "questions") return payload.formato === "respuestas-fabrica/1" && Array.isArray(payload.respuestas);
  if (kind === "flow_review") return payload.artefacto === "ux-flows.md" && Array.isArray(payload.flujos);
  return false;
}

// Returns { ok: true, message } or { ok: false, reason }. The caller has already checked that
// event.source is the piece iframe; this checks type, shape and size.
export function parseBridgeMessage(data, kind) {
  const no = (reason) => ({ ok: false, reason });
  if (!isPlainObject(data) || typeof data.type !== "string") return no("shape");
  if (byteLength(data) >= MAX_MESSAGE_BYTES) return no("too-large");
  switch (data.type) {
    case "factory:ready":
      if (typeof data.persistence !== "boolean" || typeof data.canSubmit !== "boolean") return no("shape");
      return { ok: true, message: { type: data.type, persistence: data.persistence, canSubmit: data.canSubmit } };
    case "factory:flushed":
      return { ok: true, message: { type: data.type } };
    case "factory:draft": {
      if (!isPlainObject(data.storage)) return no("shape");
      if (!Object.values(data.storage).every((v) => typeof v === "string")) return no("shape");
      return { ok: true, message: { type: data.type, storage: data.storage } };
    }
    case "factory:submit":
      if (typeof data.requestId !== "string") return no("shape");
      if (!isValidPayload(kind, data.payload)) return no("payload");
      return { ok: true, message: { type: data.type, requestId: data.requestId, payload: data.payload } };
    case "factory:submit-error":
      if (typeof data.requestId !== "string" || !SUBMIT_ERROR_REASONS.includes(data.reason)) return no("shape");
      return { ok: true, message: { type: data.type, requestId: data.requestId, reason: data.reason } };
    default:
      return no("type");
  }
}

// Serializes draft saves: one request in flight, only the newest storage is sent next, identical
// storage is skipped, and a failed save keeps the data and retries with backoff (or on retryNow()).
// Status: "saving" | "saved" | "error".
export function createDraftSaver({ save, onStatus, retryDelays = [3000, 10000, 30000] }) {
  let latest = null;       // newest storage not yet sent
  let lastSaved = null;    // JSON of the last storage the server accepted
  let inflight = null;     // promise of the running save
  let retryTimer = null;
  let failures = 0;
  let disposed = false;
  const waiters = [];

  const settle = () => {
    if (inflight || latest || retryTimer) return;
    while (waiters.length) waiters.shift()();
  };

  async function run() {
    if (disposed || inflight || !latest) return;
    const storage = latest;
    latest = null;
    const json = JSON.stringify(storage);
    if (json === lastSaved) { onStatus("saved"); settle(); return; }
    onStatus("saving");
    inflight = (async () => {
      try {
        await save(storage);
        lastSaved = json;
        failures = 0;
        if (!latest) onStatus("saved");
      } catch {
        if (!latest) latest = storage; // keep the newest unsaved data
        onStatus("error");
        const delay = retryDelays[Math.min(failures, retryDelays.length - 1)];
        failures += 1;
        if (!disposed) retryTimer = setTimeout(() => { retryTimer = null; run(); }, delay);
      }
    })();
    await inflight;
    inflight = null;
    if (latest && !retryTimer) run();
    else settle();
  }

  return {
    push(storage) {
      latest = storage;
      if (retryTimer) return; // the scheduled retry will send it
      run();
    },
    retryNow() {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      run();
    },
    hasUnsaved() { return Boolean(latest || inflight); },
    // Resolves when nothing is pending (a scheduled retry counts as pending).
    idle() {
      if (!inflight && !latest && !retryTimer) return Promise.resolve();
      return new Promise((resolve) => waiters.push(resolve));
    },
    dispose() {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      while (waiters.length) waiters.shift()();
    },
  };
}
