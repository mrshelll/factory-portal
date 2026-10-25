// The portal's routes and the states the project owner sees (spec 2026-10-25 página del proyecto, part 1): which
// screen a hash opens, how an assignment reads to the owner, and the project list of a person. Pure module (no DOM,
// no Supabase), unit tested.

// Statuses that count as answered, as DONE in app.js.
export const DONE = new Set(["submitted", "received", "replaced"]);

const STATUSES = new Set(["pending", "in_progress", "submitted", "received", "replaced"]);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PROJECT_ROUTE = new RegExp(`^#/project/(${UUID})$`, "i");
const PIECE_ROUTE = new RegExp(`^#/piece/(${UUID})$`, "i");
const OWNER_PIECE_ROUTE = new RegExp(`^#/project/(${UUID})/piece/(${UUID})/person/(${UUID})$`, "i");

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

// The screen a location hash opens. Anything that is not one of the four routes is home.
export function parseRoute(hash) {
  if (typeof hash !== "string") return { name: "home" };
  let match = OWNER_PIECE_ROUTE.exec(hash);
  if (match) return { name: "owner-piece", projectId: match[1].toLowerCase(), pieceId: match[2].toLowerCase(), memberId: match[3].toLowerCase() };
  match = PROJECT_ROUTE.exec(hash);
  if (match) return { name: "project", projectId: match[1].toLowerCase() };
  match = PIECE_ROUTE.exec(hash);
  if (match) return { name: "piece", pieceId: match[1].toLowerCase() };
  return { name: "home" };
}

export function projectHref(projectId) {
  return `#/project/${projectId}`;
}

export function ownerPieceHref(projectId, pieceId, memberId) {
  return `#/project/${projectId}/piece/${pieceId}/person/${memberId}`;
}

// The state the owner reads: the assignment's status, with «opened» (la abrió) for a pending one whose person
// already opened it. An unknown status reads as pending.
export function ownerStatus(assignment) {
  const status = isPlainObject(assignment) ? assignment.status : null;
  if (!STATUSES.has(status)) return "pending";
  if (status === "pending" && isDate(assignment.first_opened_at)) return "opened";
  return status;
}

// The date shown next to the state, or null when there is none.
export function latestActivity(assignment) {
  if (!isPlainObject(assignment)) return null;
  const state = ownerStatus(assignment);
  if (DONE.has(state) && isDate(assignment.sent_at)) return assignment.sent_at;
  if (state === "in_progress" && isDate(assignment.updated_at)) return assignment.updated_at;
  if (state === "opened") return assignment.first_opened_at;
  return isDate(assignment.assigned_at) ? assignment.assigned_at : null;
}

// One row per person assigned to a piece: people by name first, owners after. membersById is a Map or a plain object.
export function personRows(piece, membersById) {
  const assignments = isPlainObject(piece) && Array.isArray(piece.assignments) ? piece.assignments : [];
  const lookup = (id) => {
    if (membersById instanceof Map) return membersById.get(id);
    return isPlainObject(membersById) ? membersById[id] : undefined;
  };
  const rows = [];
  for (const assignment of assignments) {
    if (!isPlainObject(assignment)) continue;
    const member = lookup(assignment.member_id);
    const known = isPlainObject(member);
    rows.push({
      row: {
        memberId: assignment.member_id,
        name: known && typeof member.display_name === "string" ? member.display_name : null,
        status: ownerStatus(assignment),
        at: latestActivity(assignment),
        readable: assignment.readable === true,
      },
      owner: known && member.role === "owner",
    });
  }
  rows.sort((a, b) => (a.owner - b.owner) || (a.row.name || "").localeCompare(b.row.name || ""));
  return rows.map((entry) => entry.row);
}

// One row per project the person belongs to (groups from loadSharedWithMe) or owns (owner_projects()), by name.
export function projectRows(groups, ownedProjects) {
  const byId = new Map();
  for (const group of Array.isArray(groups) ? groups : []) {
    if (!isPlainObject(group) || !isPlainObject(group.project)) continue;
    const items = Array.isArray(group.items) ? group.items : [];
    const toAnswer = items.filter((item) => !(isPlainObject(item) && isPlainObject(item.assignment) && DONE.has(item.assignment.status))).length;
    byId.set(group.project.id, { project: group.project, toAnswer, owned: false, summary: null });
  }
  for (const summary of Array.isArray(ownedProjects) ? ownedProjects : []) {
    if (!isPlainObject(summary)) continue;
    const existing = byId.get(summary.id);
    if (existing) {
      existing.owned = true;
      existing.summary = summary;
    } else {
      byId.set(summary.id, { project: summary, toAnswer: 0, owned: true, summary });
    }
  }
  return [...byId.values()].sort((a, b) => String(a.project.name || "").localeCompare(String(b.project.name || "")));
}
