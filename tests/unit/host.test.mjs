import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBridgeMessage, isValidPayload, createDraftSaver, trySaveAll, MAX_MESSAGE_BYTES } from "../../js/host.js";

const N = "nonce-1";
const questionsPayload = { formato: "respuestas-fabrica/1", proyecto: "portal-test", respuestas: [] };
const flowPayload = { proyecto: "portal-test", artefacto: "ux-flows.md", flujos: [] };

test("parseBridgeMessage rejects unknown or malformed messages", () => {
  for (const data of [null, "x", 1, [], {}, { type: 1 }, { type: "factory:nope" }]) {
    assert.equal(parseBridgeMessage(data, "questions", N).ok, false, JSON.stringify(data));
  }
});

test("parseBridgeMessage accepts a draft of string values only", () => {
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:draft", storage: { a: "1" } }, "questions", N).ok, true);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:draft", storage: { a: 1 } }, "questions", N).ok, false);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:draft", storage: ["a"] }, "questions", N).ok, false);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:draft" }, "questions", N).ok, false);
});

test("parseBridgeMessage rejects messages of 1 MB or more", () => {
  const big = "x".repeat(MAX_MESSAGE_BYTES);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:draft", storage: { a: big } }, "questions", N).ok, false);
  const payload = { ...questionsPayload, extra: big };
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:submit", requestId: "r1", payload }, "questions", N).ok, false);
});

test("parseBridgeMessage checks the submit payload shape for the piece kind", () => {
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:submit", requestId: "r1", payload: questionsPayload }, "questions", N).ok, true);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:submit", requestId: "r1", payload: flowPayload }, "questions", N).ok, false);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:submit", requestId: "r1", payload: flowPayload }, "flow_review", N).ok, true);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:submit", payload: questionsPayload }, "questions", N).ok, false, "needs requestId");
});

test("parseBridgeMessage validates ready and flushed", () => {
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:ready", persistence: true }, "questions", N).ok, true);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:ready", persistence: "yes" }, "questions", N).ok, false);
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:flushed" }, "questions", N).ok, true);
});

test("parseBridgeMessage rejects the retired factory:submit-error with type", () => {
  const parsed = parseBridgeMessage({ nonce: N, type: "factory:submit-error", requestId: "r", reason: "empty" }, "questions", N);
  assert.deepEqual(parsed, { ok: false, reason: "type" });
});

test("isValidPayload rejects unknown kinds", () => {
  assert.equal(isValidPayload("other", questionsPayload), false);
});

test("isValidPayload accepts a demo review (revision-demo/1) only with that schema", () => {
  assert.equal(isValidPayload("demo_review", { esquema: "revision-demo/1", flujos: [] }), true);
  assert.equal(isValidPayload("demo_review", { esquema: "revision-demo/2", flujos: [] }), false);
  assert.equal(isValidPayload("demo_review", { esquema: "revision-demo/1" }), false);
  assert.equal(isValidPayload("demo_review", questionsPayload), false);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

test("draft saver sends only the latest storage while a save is in flight", async () => {
  const calls = [];
  const pending = [];
  const saver = createDraftSaver({
    save: (s) => { calls.push(s); const d = deferred(); pending.push(d); return d.promise; },
    onStatus: () => {},
    retryDelays: [10],
  });
  saver.push({ a: "1" });
  saver.push({ a: "2" });
  saver.push({ a: "3" });
  assert.equal(calls.length, 1);
  pending[0].resolve();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.length, 2, "second save starts once the first ends");
  assert.equal(saver.hasUnsaved(), true);
  pending[1].resolve();
  await saver.idle();
  assert.deepEqual(calls, [{ a: "1" }, { a: "3" }]);
  assert.equal(saver.hasUnsaved(), false);
});

test("draft saver skips storage identical to the last saved one", async () => {
  const calls = [];
  const saver = createDraftSaver({ save: async (s) => { calls.push(s); }, onStatus: () => {}, retryDelays: [10] });
  saver.push({ a: "1" });
  await saver.idle();
  saver.push({ a: "1" });
  await saver.idle();
  assert.equal(calls.length, 1);
});

test("draft saver keeps unsaved data on failure and retries", async () => {
  let fail = true;
  const calls = [];
  const statuses = [];
  const saver = createDraftSaver({
    save: async (s) => { calls.push(s); if (fail) throw new Error("offline"); },
    onStatus: (s) => statuses.push(s),
    retryDelays: [5],
  });
  saver.push({ a: "1" });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(saver.hasUnsaved(), true);
  assert.ok(statuses.includes("error"));
  fail = false;
  await new Promise((r) => setTimeout(r, 30));
  await saver.idle();
  assert.equal(saver.hasUnsaved(), false);
  assert.equal(statuses.at(-1), "saved");
  assert.ok(calls.length >= 2);
  saver.dispose();
});

test("parseBridgeMessage requires the nonce of the mounted piece", () => {
  const draft = { type: "factory:draft", storage: { a: "1" } };
  assert.equal(parseBridgeMessage({ ...draft, nonce: N }, "questions", N).ok, true);
  assert.equal(parseBridgeMessage(draft, "questions", N).ok, false, "missing nonce");
  assert.equal(parseBridgeMessage({ ...draft, nonce: "other" }, "questions", N).ok, false, "wrong nonce");
  assert.equal(parseBridgeMessage({ ...draft, nonce: undefined }, "questions", undefined).ok, false, "no expected nonce");
});

test("parseBridgeMessage accepts factory:dirty", () => {
  assert.equal(parseBridgeMessage({ nonce: N, type: "factory:dirty" }, "questions", N).ok, true);
});

test("markPending counts as unsaved until the draft arrives and is saved", async () => {
  const statuses = [];
  const saver = createDraftSaver({ save: async () => {}, onStatus: (s) => statuses.push(s), retryDelays: [10] });
  saver.markPending();
  assert.equal(saver.hasUnsaved(), true);
  assert.equal(statuses.at(-1), "saving");
  saver.push({ a: "1" });
  await saver.idle();
  assert.equal(saver.hasUnsaved(), false);
});

test("trySaveAll reports whether every saver could save", async () => {
  let online = false;
  const saver = createDraftSaver({ save: async () => { if (!online) throw new Error("offline"); }, onStatus: () => {}, retryDelays: [1000] });
  saver.push({ a: "1" });
  assert.equal(await trySaveAll([saver], 50), false, "offline: cannot save");
  online = true;
  assert.equal(await trySaveAll([saver], 500), true, "back online: saved");
  assert.equal(await trySaveAll([], 50), true, "nothing to save");
  saver.dispose();
});

test("parseBridgeMessage accepts factory:save-failed only with reason too-large", () => {
  assert.deepEqual(parseBridgeMessage({ nonce: N, type: "factory:save-failed", reason: "too-large" }, "questions", N),
    { ok: true, message: { type: "factory:save-failed", reason: "too-large" } });
  for (const reason of [undefined, "", "network", "TOO-LARGE", 1, null]) {
    assert.deepEqual(parseBridgeMessage({ nonce: N, type: "factory:save-failed", reason }, "questions", N), { ok: false, reason: "shape" }, String(reason));
  }
  assert.equal(parseBridgeMessage({ type: "factory:save-failed", reason: "too-large" }, "questions", N).ok, false, "needs the nonce");
  assert.equal(parseBridgeMessage({ nonce: "other", type: "factory:save-failed", reason: "too-large" }, "questions", N).ok, false);
});
