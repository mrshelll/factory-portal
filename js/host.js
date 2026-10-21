// Parent-side helpers for hosting a piece: message validation and the draft save queue.
// Pure module (no DOM, no Supabase) so it can be unit tested with node --test.

export const MAX_MESSAGE_BYTES = 1000000;

// What globalThis.factorySubmit can resolve with in the piece: { ok: false, error: one of these }.
export const SUBMIT_ERRORS = ["invalid", "too-large", "timeout", "network", "session-expired", "rejected"];

// Why the bridge could not keep a change (factory:save-failed): the storage quota was exceeded.
export const SAVE_FAILED_REASONS = ["too-large"];

// The shape a submitted payload must have for each piece kind: `field` must equal `value`, and
// `list` must be an array. The bridge gets the shape of its kind and checks it before posting.
export const PAYLOAD_SHAPES = {
  questions: { field: "formato", value: "respuestas-fabrica/1", list: "respuestas" },
  flow_review: { field: "artefacto", value: "ux-flows.md", list: "flujos" },
  demo_review: { field: "esquema", value: "revision-demo/1", list: "flujos" },
};

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
  if (!isPlainObject(payload) || !Object.hasOwn(PAYLOAD_SHAPES, kind)) return false;
  const shape = PAYLOAD_SHAPES[kind];
  return payload[shape.field] === shape.value && Array.isArray(payload[shape.list]);
}

// Returns { ok: true, message } or { ok: false, reason }. The caller has already checked that
// event.source is the piece iframe; this checks the per-mount nonce (so a page the iframe navigated
// to cannot speak for the piece), then type, shape and size.
export function parseBridgeMessage(data, kind, nonce) {
  const no = (reason) => ({ ok: false, reason });
  if (!isPlainObject(data) || typeof data.type !== "string") return no("shape");
  if (typeof nonce !== "string" || !nonce || data.nonce !== nonce) return no("nonce");
  if (byteLength(data) >= MAX_MESSAGE_BYTES) return no("too-large");
  switch (data.type) {
    case "factory:dirty":
      return { ok: true, message: { type: data.type } };
    case "factory:ready":
      if (typeof data.persistence !== "boolean") return no("shape");
      return { ok: true, message: { type: data.type, persistence: data.persistence } };
    case "factory:flushed":
      return { ok: true, message: { type: data.type } };
    case "factory:save-failed":
      if (!SAVE_FAILED_REASONS.includes(data.reason)) return no("shape");
      return { ok: true, message: { type: data.type, reason: data.reason } };
    case "factory:draft": {
      if (!isPlainObject(data.storage)) return no("shape");
      if (!Object.values(data.storage).every((v) => typeof v === "string")) return no("shape");
      return { ok: true, message: { type: data.type, storage: data.storage } };
    }
    case "factory:submit":
      if (typeof data.requestId !== "string" || !data.requestId || data.requestId.length > 100) return no("shape");
      if (!isValidPayload(kind, data.payload)) return no("payload");
      return { ok: true, message: { type: data.type, requestId: data.requestId, payload: data.payload } };
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
  let pending = false;     // the piece changed something and its draft is on the way
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
    // Called as soon as the piece reports a change, before its debounced draft arrives.
    markPending() {
      if (pending) return;
      pending = true;
      onStatus("saving");
    },
    push(storage) {
      pending = false;
      latest = storage;
      if (retryTimer) return; // the scheduled retry will send it
      run();
    },
    retryNow() {
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      run();
    },
    hasUnsaved() { return Boolean(pending || latest || inflight); },
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

// Retries every saver now and waits up to timeoutMs. True when nothing is left unsaved.
export async function trySaveAll(savers, timeoutMs) {
  const list = [...savers];
  for (const saver of list) saver.retryNow();
  let timer;
  await Promise.race([
    Promise.all(list.map((saver) => saver.idle())),
    new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
  ]);
  clearTimeout(timer);
  return !list.some((saver) => saver.hasUnsaved());
}
