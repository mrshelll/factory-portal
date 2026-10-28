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
  // btrim trims only spaces: a trailing newline counts toward the limit, as in the server
  assert.equal(validateAnswer("no", `${"a".repeat(4000)}\n\n`), "too-long");
  assert.equal(validateAnswer("no", `${"a".repeat(3998)}\n\n`), null);
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
  assert.doesNotMatch(dictionaries.en.projectOwnerSees, /piece/i);
});

const fake = (result) => {
  const calls = [];
  return {
    calls,
    rpc: async (fn, args) => {
      calls.push([fn, args]);
      return typeof result === "function" ? result() : result;
    },
  };
};

test("answerDecision maps the server's codes and calls answer_decision", async () => {
  const ok = fake({ data: { id: "i", created_at: "t" }, error: null });
  assert.deepEqual(await answerDecision(ok, A, "k", "v", "no", "porque"), { ok: true, id: "i", createdAt: "t" });
  assert.deepEqual(ok.calls, [["answer_decision", { p_project_id: A, p_key: "k", p_version: "v", p_value: "no", p_comment: "porque" }]]);
  const noComment = fake({ data: { id: "i", created_at: "t" }, error: null });
  await answerDecision(noComment, A, "k", "v", "yes");
  assert.equal(noComment.calls[0][1].p_comment, null);
  for (const [code, error] of [["PT409", "stale"], ["22023", "invalid"], ["P0002", "gone"], ["42501", "denied"], ["08006", "network"], [undefined, "network"]]) {
    assert.deepEqual(await answerDecision(fake({ data: null, error: { code } }), A, "k", "v", "yes", null), { ok: false, error }, String(code));
  }
  assert.deepEqual(await answerDecision(fake({ data: null, error: null }), A, "k", "v", "yes", null), { ok: false, error: "network" });
  assert.deepEqual(await answerDecision(fake(() => { throw new Error("offline"); }), A, "k", "v", "yes", null), { ok: false, error: "network" });
});

test("proposeDecision and markDecisionsOpened never throw and call their RPCs", async () => {
  const ok = fake({ data: "p1", error: null });
  assert.deepEqual(await proposeDecision(ok, A, "texto"), { ok: true, id: "p1" });
  assert.deepEqual(ok.calls, [["propose_decision", { p_project_id: A, p_text: "texto" }]]);
  assert.deepEqual(await proposeDecision(fake({ data: null, error: { code: "22023" } }), A, ""), { ok: false, error: "invalid" });
  assert.deepEqual(await proposeDecision(fake({ data: null, error: { code: "42501" } }), A, "x"), { ok: false, error: "denied" });
  assert.deepEqual(await proposeDecision(fake({ data: null, error: null }), A, "x"), { ok: false, error: "network" });
  assert.deepEqual(await proposeDecision(fake(() => { throw new Error("offline"); }), A, "x"), { ok: false, error: "network" });
  const opened = fake({ data: null, error: null });
  await markDecisionsOpened(opened, A);
  assert.deepEqual(opened.calls, [["mark_decisions_opened", { p_project_id: A }]]);
  await markDecisionsOpened(fake(() => { throw new Error("offline"); }), A);
});

test("the loaders call their RPCs: not-for-this-person is null or [], other errors throw", async () => {
  const projects = fake({ data: [{ project_id: A }], error: null });
  assert.deepEqual(await loadDecisionProjects(projects), [{ project_id: A }]);
  assert.deepEqual(projects.calls, [["decision_projects", undefined]]);
  assert.deepEqual(await loadDecisionProjects(fake({ data: null, error: { code: "PGRST202" } })), []);
  await assert.rejects(loadDecisionProjects(fake({ data: null, error: { code: "XX000" } })));
  assert.equal(await loadMyDecisions(fake({ data: null, error: { code: "42501" } }), A), null);
  const mine = fake({ data: { last_opened_at: null, points: [{ key: "k" }] }, error: null });
  assert.deepEqual(await loadMyDecisions(mine, A), { last_opened_at: null, points: [{ key: "k" }] });
  assert.deepEqual(mine.calls, [["my_decisions", { p_project_id: A }]]);
  await assert.rejects(loadMyDecisions(fake({ data: null, error: { code: "XX000" } }), A));
  assert.equal(await loadOwnerDecisions(fake({ data: null, error: { code: "42501" } }), A), null);
  const owner = fake({ data: { points: [], people: [], proposals: [{ text: "t" }] }, error: null });
  assert.deepEqual(await loadOwnerDecisions(owner, A), { points: [], people: [], proposals: [{ text: "t" }] });
  assert.deepEqual(owner.calls, [["owner_decisions", { p_project_id: A }]]);
});

test("no Spanish string of the portal says «pieza» (a factory word)", () => {
  for (const [key, value] of Object.entries(dictionaries.es)) assert.doesNotMatch(value, /\bpieza/i, key);
});
