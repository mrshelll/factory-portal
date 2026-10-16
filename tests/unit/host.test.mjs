import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBridgeMessage, isValidPayload, createDraftSaver, MAX_MESSAGE_BYTES } from "../../js/host.js";

const questionsPayload = { formato: "respuestas-fabrica/1", proyecto: "portal-test", respuestas: [] };
const flowPayload = { proyecto: "portal-test", artefacto: "ux-flows.md", flujos: [] };

test("parseBridgeMessage rejects unknown or malformed messages", () => {
  for (const data of [null, "x", 1, [], {}, { type: 1 }, { type: "factory:nope" }]) {
    assert.equal(parseBridgeMessage(data, "questions").ok, false, JSON.stringify(data));
  }
});

test("parseBridgeMessage accepts a draft of string values only", () => {
  assert.equal(parseBridgeMessage({ type: "factory:draft", storage: { a: "1" } }, "questions").ok, true);
  assert.equal(parseBridgeMessage({ type: "factory:draft", storage: { a: 1 } }, "questions").ok, false);
  assert.equal(parseBridgeMessage({ type: "factory:draft", storage: ["a"] }, "questions").ok, false);
  assert.equal(parseBridgeMessage({ type: "factory:draft" }, "questions").ok, false);
});

test("parseBridgeMessage rejects messages of 1 MB or more", () => {
  const big = "x".repeat(MAX_MESSAGE_BYTES);
  assert.equal(parseBridgeMessage({ type: "factory:draft", storage: { a: big } }, "questions").ok, false);
  const payload = { ...questionsPayload, extra: big };
  assert.equal(parseBridgeMessage({ type: "factory:submit", requestId: "r1", payload }, "questions").ok, false);
});

test("parseBridgeMessage checks the submit payload shape for the piece kind", () => {
  assert.equal(parseBridgeMessage({ type: "factory:submit", requestId: "r1", payload: questionsPayload }, "questions").ok, true);
  assert.equal(parseBridgeMessage({ type: "factory:submit", requestId: "r1", payload: flowPayload }, "questions").ok, false);
  assert.equal(parseBridgeMessage({ type: "factory:submit", requestId: "r1", payload: flowPayload }, "flow_review").ok, true);
  assert.equal(parseBridgeMessage({ type: "factory:submit", payload: questionsPayload }, "questions").ok, false, "needs requestId");
});

test("parseBridgeMessage validates ready, flushed and submit-error", () => {
  assert.equal(parseBridgeMessage({ type: "factory:ready", persistence: true, canSubmit: false }, "questions").ok, true);
  assert.equal(parseBridgeMessage({ type: "factory:ready", persistence: "yes" }, "questions").ok, false);
  assert.equal(parseBridgeMessage({ type: "factory:flushed" }, "questions").ok, true);
  assert.equal(parseBridgeMessage({ type: "factory:submit-error", requestId: "r", reason: "empty" }, "questions").ok, true);
  assert.equal(parseBridgeMessage({ type: "factory:submit-error", requestId: "r", reason: "whatever" }, "questions").ok, false);
});

test("isValidPayload rejects unknown kinds", () => {
  assert.equal(isValidPayload("other", questionsPayload), false);
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
