import { test } from "node:test";
import assert from "node:assert/strict";
import { ANSWER_VALUES, needsComment, validateAnswer, markKey, countsLine, mergeProjectRows } from "../../js/decisions.js";
import { projectRows } from "../../js/project.js";
import { answerDecision, proposeDecision, markDecisionsOpened, loadDecisionProjects, loadMyDecisions, loadOwnerDecisions } from "../../js/api.js";
import { dictionaries } from "../../js/i18n.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("ANSWER_VALUES and needsComment: only «va» goes without a comment", () => {
  assert.deepEqual(ANSWER_VALUES, ["yes", "change", "no", "unsure"]);
  assert.equal(needsComment("yes"), false);
  for (const value of ["change", "no", "unsure"]) assert.equal(needsComment(value), true, value);
});

test("validateAnswer: every case", () => {
  assert.equal(validateAnswer("yes", ""), null);
  assert.equal(validateAnswer("yes", null), null);
  assert.equal(validateAnswer("yes", "algo"), null);
  assert.equal(validateAnswer("change", "porque sí"), null);
  assert.equal(validateAnswer("change", ""), "comment-required");
  assert.equal(validateAnswer("no", "   \n "), "comment-required");
  assert.equal(validateAnswer("unsure", undefined), "comment-required");
  for (const value of ["", "maybe", null, undefined, "YES"]) assert.equal(validateAnswer(value, "x"), "invalid-value", String(value));
  assert.equal(validateAnswer("no", "a".repeat(4000)), null);
  assert.equal(validateAnswer("no", "a".repeat(4001)), "too-long");
  assert.equal(validateAnswer("yes", "a".repeat(4001)), "too-long");
  assert.equal(validateAnswer("no", `  ${"a".repeat(4000)}  `), null);
  assert.equal(validateAnswer("no", "😀".repeat(4000)), null);
});

test("markKey: the four marks", () => {
  assert.equal(markKey("new"), "markNew");
  assert.equal(markKey("changed"), "markChanged");
  assert.equal(markKey("confirmed"), "markConfirmed");
  assert.equal(markKey("none"), null);
  assert.equal(markKey("toString"), null);
  assert.equal(markKey(undefined), null);
});

test("countsLine leaves out zero segments", () => {
  assert.deepEqual(countsLine({ yes: 3, change: 0, no: 1, unsure: 0, none: 2 }),
    [{ key: "answerYes", n: 3 }, { key: "answerNo", n: 1 }, { key: "ownerNoAnswer", n: 2 }]);
  assert.deepEqual(countsLine({ yes: 0, change: 0, no: 0, unsure: 0, none: 0 }), []);
  assert.deepEqual(countsLine(null), []);
  assert.deepEqual(countsLine({ unsure: 1 }), [{ key: "answerUnsure", n: 1 }]);
});

test("mergeProjectRows adds an audience-only project once and never duplicates one with pieces", () => {
  const rows = projectRows([{ project: { id: B, slug: "b", name: "Beta" }, items: [] }], []);
  const merged = mergeProjectRows(rows, [
    { project_id: A, slug: "a", name: "Alfa" },
    { project_id: A, slug: "a", name: "Alfa" },
    { project_id: B, slug: "b", name: "Beta" },
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], { project: { id: A, slug: "a", name: "Alfa" }, toAnswer: 0, owned: false, summary: null, decisions: true });
  assert.equal(merged[1].project.id, B);
  assert.equal(merged[1].decisions, true);
  assert.equal(merged[1].owned, false);
  assert.equal(rows[0].decisions, undefined);
  assert.deepEqual(mergeProjectRows(rows, []), rows);
  assert.deepEqual(mergeProjectRows(undefined, undefined), []);
});

test("the new i18n keys exist in es and en", () => {
  const keys = ["decisionsTitle", "decisionsLead", "answerYes", "answerChange", "answerNo", "answerUnsure", "commentLabel",
    "commentRequired", "basisToggle", "markNew", "markChanged", "markConfirmed", "sendAnswer", "answerSent", "answerStale",
    "proposeTitle", "proposeLead", "proposeSend", "proposeSent", "ownerDecisionsTitle", "ownerNoAnswer", "ownerOlderVersion",
    "ownerLeftList", "ownerOpenedSection"];
  for (const key of keys) for (const lang of ["es", "en"]) assert.ok(dictionaries[lang][key], `${lang}.${key}`);
  assert.match(dictionaries.es.projectOwnerSees, /esta sección/);
});

const fake = (result) => ({ rpc: async () => (typeof result === "function" ? result() : result) });

test("answerDecision maps the server's codes", async () => {
  assert.deepEqual(await answerDecision(fake({ data: { id: "i", created_at: "t" }, error: null }), A, "k", "v", "yes", null),
    { ok: true, id: "i", createdAt: "t" });
  for (const [code, error] of [["PT409", "stale"], ["22023", "invalid"], ["P0002", "gone"], ["42501", "denied"], ["08006", "network"], [undefined, "network"]]) {
    assert.deepEqual(await answerDecision(fake({ data: null, error: { code } }), A, "k", "v", "yes", null), { ok: false, error }, String(code));
  }
  assert.deepEqual(await answerDecision(fake(() => { throw new Error("offline"); }), A, "k", "v", "yes", null), { ok: false, error: "network" });
});

test("proposeDecision and markDecisionsOpened never throw", async () => {
  assert.deepEqual(await proposeDecision(fake({ data: "p1", error: null }), A, "texto"), { ok: true, id: "p1" });
  assert.deepEqual(await proposeDecision(fake({ data: null, error: { code: "22023" } }), A, ""), { ok: false, error: "invalid" });
  assert.deepEqual(await proposeDecision(fake(() => { throw new Error("offline"); }), A, "x"), { ok: false, error: "network" });
  await markDecisionsOpened(fake(() => { throw new Error("offline"); }), A);
});

test("the loaders: not-for-this-person is null or [], other errors throw", async () => {
  assert.deepEqual(await loadDecisionProjects(fake({ data: [{ project_id: A }], error: null })), [{ project_id: A }]);
  assert.deepEqual(await loadDecisionProjects(fake({ data: null, error: { code: "PGRST202" } })), []);
  await assert.rejects(loadDecisionProjects(fake({ data: null, error: { code: "XX000" } })));
  assert.equal(await loadMyDecisions(fake({ data: null, error: { code: "42501" } }), A), null);
  assert.deepEqual(await loadMyDecisions(fake({ data: { last_opened_at: null, points: [{ key: "k" }] }, error: null }), A),
    { last_opened_at: null, points: [{ key: "k" }] });
  await assert.rejects(loadMyDecisions(fake({ data: null, error: { code: "XX000" } }), A));
  assert.equal(await loadOwnerDecisions(fake({ data: null, error: { code: "42501" } }), A), null);
  assert.deepEqual(await loadOwnerDecisions(fake({ data: { points: [], people: [], proposals: [{ text: "t" }] }, error: null }), A),
    { points: [], people: [], proposals: [{ text: "t" }] });
});
