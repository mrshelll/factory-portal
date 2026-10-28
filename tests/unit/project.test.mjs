import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRoute, projectHref, ownerPieceHref, ownerDecisionHref, ownerStatus, latestActivity, latestActivityKind, personRows, projectRows, DONE } from "../../js/project.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

test("parseRoute: the routes, ids lowercased", () => {
  assert.deepEqual(parseRoute("#/"), { name: "home" });
  assert.deepEqual(parseRoute(`#/project/${A}`), { name: "project", projectId: A });
  assert.deepEqual(parseRoute(`#/piece/${B}`), { name: "piece", pieceId: B });
  assert.deepEqual(parseRoute(`#/project/${A}/piece/${B}/person/${C}`), { name: "owner-piece", projectId: A, pieceId: B, memberId: C });
});

test("parseRoute: upper-case ids are lowercased; junk goes home", () => {
  assert.deepEqual(parseRoute(`#/project/${A.toUpperCase()}`), { name: "project", projectId: A });
  assert.deepEqual(parseRoute(`#/project/${A}/piece/${B.toUpperCase()}/person/${C.toUpperCase()}`),
    { name: "owner-piece", projectId: A, pieceId: B, memberId: C });
  for (const junk of ["", "#", "#/nope", "#/project/", "#/project/abc", `#/project/${A}/piece/${B}`, `#/piece/${B}/x`, `#/project/${A}/extra`, null, undefined, 5, {}]) {
    assert.deepEqual(parseRoute(junk), { name: "home" }, String(junk));
  }
});

test("hrefs round trip through parseRoute", () => {
  assert.equal(projectHref(A), `#/project/${A}`);
  assert.equal(ownerPieceHref(A, B, C), `#/project/${A}/piece/${B}/person/${C}`);
  assert.deepEqual(parseRoute(projectHref(A)), { name: "project", projectId: A });
  assert.deepEqual(parseRoute(ownerPieceHref(A, B, C)), { name: "owner-piece", projectId: A, pieceId: B, memberId: C });
  assert.equal(ownerDecisionHref(A, "0123456789ab"), `#/project/${A}/decisions/0123456789ab`);
  assert.deepEqual(parseRoute(ownerDecisionHref(A, "0123456789ab")), { name: "owner-decision", projectId: A, key: "0123456789ab" });
});

test("parseRoute: the owner's view of one decision point, key of 12 hex digits lowercased", () => {
  assert.deepEqual(parseRoute("#/project/p/decisions/0123456789ab"), { name: "home" }); // the project must be a uuid
  assert.deepEqual(parseRoute(`#/project/${A}/decisions/0123456789ab`), { name: "owner-decision", projectId: A, key: "0123456789ab" });
  assert.deepEqual(parseRoute(`#/project/${A.toUpperCase()}/decisions/0123456789AB`), { name: "owner-decision", projectId: A, key: "0123456789ab" });
  for (const junk of [`#/project/${A}/decisions/`, `#/project/${A}/decisions/0123456789a`, `#/project/${A}/decisions/0123456789abc`,
    `#/project/${A}/decisions/0123456789ag`, `#/project/${A}/decisions/0123456789ab/x`, `#/project/${A}/decision/0123456789ab`]) {
    assert.deepEqual(parseRoute(junk), { name: "home" }, junk);
  }
});

test("ownerStatus: opened only for pending with a readable opening date", () => {
  assert.equal(ownerStatus({ status: "pending", first_opened_at: "2026-10-20T10:00:00Z" }), "opened");
  assert.equal(ownerStatus({ status: "pending", first_opened_at: null }), "pending");
  assert.equal(ownerStatus({ status: "pending", first_opened_at: "not a date" }), "pending");
  assert.equal(ownerStatus({ status: "in_progress", first_opened_at: "2026-10-20T10:00:00Z" }), "in_progress");
  for (const status of ["submitted", "received", "replaced"]) assert.equal(ownerStatus({ status }), status);
  assert.equal(ownerStatus({ status: "weird" }), "pending");
  assert.equal(ownerStatus(null), "pending");
  assert.equal(ownerStatus(undefined), "pending");
});

test("latestActivity: the date next to the state", () => {
  const base = { assigned_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", first_opened_at: "2026-10-02T00:00:00Z", sent_at: "2026-10-04T00:00:00Z" };
  for (const status of ["submitted", "replaced"]) assert.equal(latestActivity({ ...base, status }), base.sent_at, status);
  // A received one: when it was received (the factory's close sets status and updated_at together).
  assert.equal(latestActivity({ ...base, status: "received" }), base.updated_at);
  assert.equal(latestActivity({ ...base, status: "submitted", sent_at: null }), base.assigned_at);
  assert.equal(latestActivity({ ...base, status: "in_progress" }), base.updated_at);
  assert.equal(latestActivity({ ...base, status: "pending" }), base.first_opened_at);
  assert.equal(latestActivity({ ...base, status: "pending", first_opened_at: null }), base.assigned_at);
  assert.equal(latestActivity({ status: "pending" }), null);
  assert.equal(latestActivity(null), null);
});

test("latestActivityKind: which date latestActivity gave, so the page can say what it is", () => {
  const base = { assigned_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-05T00:00:00Z", first_opened_at: "2026-10-02T00:00:00Z", sent_at: "2026-10-04T00:00:00Z" };
  for (const status of ["submitted", "replaced"]) assert.equal(latestActivityKind({ ...base, status }), "sent", status);
  // Received: the date it was received, so «Recibida» and «Enviada» never show the same line. Without a receipt date that
  // follows the send (missing, unreadable or older than it), the send's date, said as a send.
  assert.equal(latestActivityKind({ ...base, status: "received" }), "received");
  assert.equal(latestActivityKind({ ...base, status: "received", updated_at: null }), "sent");
  assert.equal(latestActivityKind({ ...base, status: "received", updated_at: "x" }), "sent");
  assert.equal(latestActivityKind({ ...base, status: "received", updated_at: "2026-10-03T00:00:00Z" }), "sent");
  assert.equal(latestActivityKind({ ...base, status: "received", sent_at: null }), "received");
  assert.equal(latestActivityKind({ ...base, status: "received", sent_at: null, updated_at: null }), "assigned");
  // A send that is not on record falls back to the date it was shared, and says so.
  assert.equal(latestActivityKind({ ...base, status: "replaced", sent_at: null }), "assigned");
  assert.equal(latestActivityKind({ ...base, status: "in_progress" }), "changed");
  assert.equal(latestActivityKind({ ...base, status: "in_progress", updated_at: null }), "assigned");
  assert.equal(latestActivityKind({ ...base, status: "pending" }), "opened");
  assert.equal(latestActivityKind({ ...base, status: "pending", first_opened_at: null }), "assigned");
  assert.equal(latestActivityKind({ ...base, status: "bogus", first_opened_at: null }), "assigned");
  assert.equal(latestActivityKind({ status: "pending" }), null);
  assert.equal(latestActivityKind(null), null);
  // Always the same date as latestActivity.
  for (const a of [{ ...base, status: "received" }, { ...base, status: "received", updated_at: null }, { ...base, status: "submitted" },
    { ...base, status: "in_progress", updated_at: "x" }, { ...base, status: "pending" }]) {
    const kind = latestActivityKind(a);
    const field = { sent: "sent_at", received: "updated_at", changed: "updated_at", opened: "first_opened_at", assigned: "assigned_at" }[kind];
    assert.equal(latestActivity(a), a[field]);
  }
});

test("personRows: people first by name, owners last, a missing member keeps its row", () => {
  const members = new Map([
    [A, { id: A, display_name: "Zoe", role: "stakeholder" }],
    [B, { id: B, display_name: "Ana", role: "client" }],
    [C, { id: C, display_name: "Aaron", role: "owner" }],
  ]);
  const gone = "44444444-4444-4444-8444-444444444444";
  const piece = {
    assignments: [
      { member_id: C, status: "pending", assigned_at: "2026-10-01T00:00:00Z" },
      { member_id: A, status: "submitted", sent_at: "2026-10-03T00:00:00Z", readable: true },
      { member_id: gone, status: "pending", assigned_at: "2026-10-02T00:00:00Z" },
      { member_id: B, status: "in_progress", updated_at: "2026-10-04T00:00:00Z" },
    ],
  };
  const rows = personRows(piece, members);
  // A row without a known name sorts as an empty name: first among the non-owners.
  assert.deepEqual(rows.map((r) => r.memberId), [gone, B, A, C]);
  assert.deepEqual(rows.map((r) => r.name), [null, "Ana", "Zoe", "Aaron"]);
  const zoe = rows.find((r) => r.memberId === A);
  assert.deepEqual(zoe, { memberId: A, name: "Zoe", status: "submitted", at: "2026-10-03T00:00:00Z", atKind: "sent", readable: true });
  assert.equal(rows.find((r) => r.memberId === B).atKind, "changed");
  assert.equal(rows.find((r) => r.memberId === C).atKind, "assigned");
  const missing = rows.find((r) => r.memberId === gone);
  assert.equal(missing.name, null);
  assert.equal(missing.status, "pending");
  assert.equal(missing.readable, false);
});

test("personRows: plain-object members and bad input do not throw", () => {
  const rows = personRows({ assignments: [{ member_id: A, status: "pending" }] }, { [A]: { id: A, display_name: "Ana", role: "client" } });
  assert.equal(rows[0].name, "Ana");
  assert.deepEqual(personRows(null, null), []);
  assert.deepEqual(personRows({}, {}), []);
});

test("projectRows: owned only, shared only, both merged, ordered by name", () => {
  const groups = [
    { project: { id: B, name: "Beta" }, items: [
      { assignment: { status: "pending" } }, { assignment: { status: "in_progress" } },
      { assignment: { status: "submitted" } }, { assignment: { status: "received" } }, { assignment: { status: "replaced" } },
    ] },
    { project: { id: C, name: "Gamma" }, items: [{ assignment: { status: "pending" } }] },
  ];
  const owned = [{ id: A, name: "alfa", people: 2 }, { id: C, name: "Gamma", people: 3 }];
  const rows = projectRows(groups, owned);
  assert.deepEqual(rows.map((r) => r.project.id), [A, B, C]);
  assert.deepEqual(rows.map((r) => r.owned), [true, false, true]);
  assert.deepEqual(rows.map((r) => r.toAnswer), [0, 2, 1]);
  assert.equal(rows[0].summary, owned[0]);
  assert.equal(rows[1].summary, null);
  assert.equal(rows[2].summary, owned[1]);
  assert.deepEqual(projectRows(null, undefined), []);
  assert.deepEqual([...DONE].sort(), ["received", "replaced", "submitted"]);
});
