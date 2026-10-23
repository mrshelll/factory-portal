import { test } from "node:test";
import assert from "node:assert/strict";
import { closedState, seedFor, hasUnsentChanges, validRequestText, UNSENT_GRACE_MS, REQUEST_TEXT_MAX } from "../../js/closure.js";

test("closedState: received is closed; replaced only with a sent (non-partial) response", () => {
  assert.equal(closedState({ status: "received" }, false), "received");
  assert.equal(closedState({ status: "received" }, true), "received");
  assert.equal(closedState({ status: "replaced" }, true), "replaced");
  assert.equal(closedState({ status: "replaced" }, false), null);
  for (const status of ["pending", "in_progress", "submitted", "other"]) {
    assert.equal(closedState({ status }, true), null, status);
    assert.equal(closedState({ status }, false), null, status);
  }
  assert.equal(closedState(null, true), null);
  assert.equal(closedState(undefined, false), null);
  assert.equal(closedState({}, true), null);
});

test("seedFor: a closed piece opens with what was sent; otherwise, and without a stored send, the draft", () => {
  const sent = { k: "sent" };
  const draft = { k: "draft" };
  assert.equal(seedFor("received", { storage: sent }, draft), sent);
  assert.equal(seedFor("replaced", { storage: sent }, draft), sent);
  assert.equal(seedFor(null, { storage: sent }, draft), draft);
  // An older response sent without its storage, or none at all: the draft is the only copy there is.
  assert.equal(seedFor("received", { storage: null }, draft), draft);
  assert.equal(seedFor("received", null, draft), draft);
  assert.equal(seedFor("received", { storage: ["x"] }, draft), draft);
  assert.equal(seedFor("received", { storage: "x" }, draft), draft);
});

test("hasUnsentChanges: only a draft newer than the send by more than the grace", () => {
  assert.equal(UNSENT_GRACE_MS, 5000);
  const sent = "2026-10-23T10:00:00.000Z";
  const at = (ms) => new Date(Date.parse(sent) + ms).toISOString();
  assert.equal(hasUnsentChanges(at(5000), sent), false);
  assert.equal(hasUnsentChanges(at(5001), sent), true);
  assert.equal(hasUnsentChanges(at(0), sent), false);
  assert.equal(hasUnsentChanges(at(-60000), sent), false);
  assert.equal(hasUnsentChanges(at(600000), sent), true);
  // Server timestamps with microseconds and an offset.
  assert.equal(hasUnsentChanges("2026-10-23T10:00:06.123456+00:00", "2026-10-23T10:00:00.000001+00:00"), true);
  // No draft: nothing unsent. A draft but no send: the draft was never sent.
  assert.equal(hasUnsentChanges(null, sent), false);
  assert.equal(hasUnsentChanges("not a date", sent), false);
  assert.equal(hasUnsentChanges(at(1), null), true);
  assert.equal(hasUnsentChanges(at(1), "ayer"), true);
});

test("validRequestText: trimmed, 1 to 4000 characters", () => {
  assert.equal(REQUEST_TEXT_MAX, 4000);
  assert.equal(validRequestText("Cambiar la fecha"), true);
  assert.equal(validRequestText("  a  "), true);
  assert.equal(validRequestText(""), false);
  assert.equal(validRequestText("   "), false);
  assert.equal(validRequestText("\n\t "), false);
  assert.equal(validRequestText(null), false);
  assert.equal(validRequestText(undefined), false);
  assert.equal(validRequestText(42), false);
  assert.equal(validRequestText("a".repeat(4000)), true);
  assert.equal(validRequestText("a".repeat(4001)), false);
  assert.equal(validRequestText(`  ${"a".repeat(4000)}\n`), true);
  // Characters, as the database counts them: 4000 emoji are 8000 UTF-16 units but 4000 characters.
  assert.equal(validRequestText("😀".repeat(4000)), true);
  assert.equal(validRequestText("😀".repeat(4001)), false);
});
