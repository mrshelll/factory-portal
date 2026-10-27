// Data access. Plain single-table queries joined here instead of PostgREST embeds, so the portal
// does not depend on foreign-key names. Row Level Security decides what each user can read.
// The `pieces.html` column is only fetched when one piece is opened (it can weigh ~200 KB).

import { closedState } from "./closure.js";

const PIECE_LIST_COLUMNS = "id, project_id, kind, title, revision, language, created_at";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

const lower = (value) => String(value || "").trim().toLowerCase();
const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const assignmentKey = (row) => `${row.piece_id}|${row.member_id}`;

// The user's own memberships. RLS may let an owner see other members, so filter to this user.
async function myMemberships(client, user) {
  const rows = unwrap(await client.from("project_members").select("id, project_id, email, user_id, role, display_name"));
  return (rows || []).filter((m) => m.user_id === user.id || (user.email && lower(m.email) === lower(user.email)));
}

const byId = (rows) => new Map((rows || []).map((row) => [row.id, row]));

// -> [{ project, items: [{ piece, assignment, lastRequestAt }] }] ordered by project name. A replaced piece
// version stays only when the person had sent it (a response that is not partial): it is closed and still opens
// with what was sent. The other replaced ones are left out (the newer version has its own assignment).
// lastRequestAt: when the person last asked for a change on it (or a late send became one), or null.
export async function loadSharedWithMe(client, user) {
  const members = await myMemberships(client, user);
  if (!members.length) return [];
  const memberIds = members.map((m) => m.id);
  const projectIds = [...new Set(members.map((m) => m.project_id))];
  const [assignments, projects, requests] = await Promise.all([
    client.from("piece_assignments").select("piece_id, member_id, status, assigned_at, updated_at").in("member_id", memberIds).then(unwrap),
    client.from("projects").select("id, slug, name, language").in("id", projectIds).then(unwrap),
    client.from("piece_change_requests").select("piece_id, member_id, created_at").in("member_id", memberIds).then(unwrap),
  ]);
  const replacedIds = [...new Set((assignments || []).filter((a) => a.status === "replaced").map((a) => a.piece_id))];
  const sentReplaced = replacedIds.length
    ? unwrap(await client.from("piece_responses").select("piece_id, member_id, partial")
      .in("piece_id", replacedIds).in("member_id", memberIds).eq("partial", false))
    : [];
  const sentKeys = new Set((sentReplaced || []).filter((r) => r.partial === false).map(assignmentKey));
  const current = (assignments || []).filter((a) => a.status !== "replaced" || sentKeys.has(assignmentKey(a)));
  const lastRequestAt = new Map();
  for (const request of requests || []) {
    const key = assignmentKey(request);
    const at = Date.parse(request.created_at);
    if (Number.isFinite(at) && !(Date.parse(lastRequestAt.get(key)) >= at)) lastRequestAt.set(key, request.created_at);
  }
  const pieceIds = [...new Set(current.map((a) => a.piece_id))];
  const pieces = pieceIds.length
    ? unwrap(await client.from("pieces").select(PIECE_LIST_COLUMNS).in("id", pieceIds))
    : [];
  const piecesById = byId(pieces);
  const groups = new Map();
  for (const project of projects || []) groups.set(project.id, { project, items: [] });
  for (const assignment of current) {
    const piece = piecesById.get(assignment.piece_id);
    const group = piece && groups.get(piece.project_id);
    if (group) group.items.push({ piece, assignment, lastRequestAt: lastRequestAt.get(assignmentKey(assignment)) || null });
  }
  return [...groups.values()]
    .filter((g) => g.items.length)
    .sort((a, b) => String(a.project.name).localeCompare(String(b.project.name)));
}

// The person's projects: the groups of what was asked of them (loadSharedWithMe) and the projects they own
// (owner_projects(): [{ id, slug, name, language, people, last_response_at }]). owned is [] on a database
// without that function (PGRST202); any other error throws, as the groups' do. -> { groups, owned }
export async function loadProjects(client, user) {
  const [groups, owned] = await Promise.all([loadSharedWithMe(client, user), ownedProjects(client)]);
  return { groups, owned };
}

async function ownedProjects(client) {
  const { data, error } = await client.rpc("owner_projects");
  if (error) {
    if (error.code === "PGRST202") return [];
    throw error;
  }
  return Array.isArray(data) ? data : [];
}

// One project's page: the project as the person can read it (RLS lets its members read it), or null when it is not
// theirs or does not exist; the person's own items in it, as loadSharedWithMe gives them; and whether the person's own
// membership in it is the owner's (only then the page asks owner_project, so nobody else gets a refusal).
// -> { project, items, owner }
export async function loadProjectItems(client, user, projectId) {
  const [groups, project, members] = await Promise.all([
    loadSharedWithMe(client, user),
    client.from("projects").select("id, slug, name, language").eq("id", projectId).maybeSingle().then(unwrap),
    myMemberships(client, user),
  ]);
  const group = groups.find((g) => g.project.id === projectId);
  const owner = members.some((m) => m.project_id === projectId && m.role === "owner");
  return { project: project || null, items: group ? group.items : [], owner };
}

// The owner's errors that mean «not for this person» rather than a failure: not the project's owner (42501), that person
// has no assignment on that piece (P0002), or a database without the owner's functions yet (PGRST202).
const NOT_OWNER_CODES = new Set(["42501", "P0002", "PGRST202"]);

// How a project the person owns is going (owner_project): { project, members, pieces: [{ id, kind, title, revision,
// created_at, assignments }], change_requests }, newest piece first, without drafts. null when the person is not its owner
// or the database does not have the function yet: the page then shows only what was asked of the person. Any other error
// throws, as the page's other reads do.
export async function loadOwnerProject(client, projectId) {
  const { data, error } = await client.rpc("owner_project", { p_project_id: projectId });
  if (error) {
    if (error.code === "42501" || error.code === "PGRST202") return null;
    throw error;
  }
  if (!isPlainObject(data)) return null;
  const list = (value) => (Array.isArray(value) ? value.filter(isPlainObject) : []);
  return {
    project: isPlainObject(data.project) ? data.project : null,
    members: list(data.members),
    pieces: list(data.pieces),
    change_requests: list(data.change_requests),
  };
}

// One person's piece in a project the person owns, to read it closed (owner_piece): { piece (with its html), member: { id,
// display_name }, status, response: { id, submitted_at, storage } | null, project }. response is that person's newest send
// only when it kept its storage (never a draft nor a partial response); null otherwise, and then there is nothing to open.
// display_name is trimmed, as loadPiece gives it to the person (a piece keys what it stores by it). project is the project
// as the owner reads it (its name for the way back), or null. -> null when the person is not the owner, that person has
// no assignment there, or the piece is not of `projectId`.
export async function loadOwnerPiece(client, projectId, pieceId, memberId) {
  const [{ data, error }, project] = await Promise.all([
    client.rpc("owner_piece", { p_piece_id: pieceId, p_member_id: memberId }),
    // Only the way back's name: a failure here does not stop the piece.
    client.from("projects").select("id, slug, name, language").eq("id", projectId).maybeSingle().then(unwrap).catch(() => null),
  ]);
  if (error) {
    if (NOT_OWNER_CODES.has(error.code)) return null;
    throw error;
  }
  if (!isPlainObject(data) || !isPlainObject(data.piece) || data.piece.project_id !== projectId) return null;
  const member = isPlainObject(data.member) ? data.member : {};
  if (member.id !== undefined && member.id !== memberId) return null;
  const name = typeof member.display_name === "string" ? member.display_name.trim() : "";
  const sent = isPlainObject(data.response) && isPlainObject(data.response.storage) ? data.response : null;
  return {
    piece: data.piece,
    member: { id: memberId, display_name: name || null },
    status: typeof data.status === "string" ? data.status : null,
    response: sent ? { id: sent.id, submitted_at: sent.submitted_at, storage: sent.storage } : null,
    project: isPlainObject(project) && project.id === projectId ? project : null,
  };
}

// «La abrió»: the person opened this piece in the portal (the server keeps only the first time). Never throws: offline,
// an ended session or a database without the function must not stop the piece.
export async function markPieceOpened(client, pieceId) {
  try {
    await client.rpc("mark_piece_opened", { p_piece_id: pieceId });
  } catch {
    /* the piece opens anyway */
  }
}

// A replaced version's newer one: the newest piece of the same kind in the same project that this person
// has a current (not replaced) assignment for. null when there is none or it cannot be read.
async function newerVersion(client, members, piece) {
  try {
    const memberIds = members.filter((m) => m.project_id === piece.project_id).map((m) => m.id);
    if (!memberIds.length) return null;
    const rows = unwrap(await client.from("piece_assignments").select("piece_id, member_id, status")
      .in("member_id", memberIds).neq("status", "replaced"));
    const ids = new Set((rows || []).filter((a) => a.status !== "replaced" && memberIds.includes(a.member_id) && a.piece_id !== piece.id)
      .map((a) => a.piece_id));
    if (!ids.size) return null;
    const pieces = unwrap(await client.from("pieces").select("id, project_id, kind, created_at")
      .in("id", [...ids]).eq("project_id", piece.project_id).eq("kind", piece.kind));
    const after = Date.parse(piece.created_at) || 0;
    const newer = (pieces || [])
      .filter((p) => ids.has(p.id) && p.project_id === piece.project_id && p.kind === piece.kind && (Date.parse(p.created_at) || 0) > after)
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
    return newer ? newer.id : null;
  } catch {
    return null; // the notice then points to the list, where the newer version is
  }
}

// -> null when the piece is not assigned to this user (or does not exist). A replaced version still
// opens: a tab left open on it, or an old email, can still send; `newerPieceId` names its newer version.
// lastResponse: the newest response the person sent ({ id, submitted_at, storage }; storage null when it was sent
// without it), never a partial one (a draft the factory collected); hasSentResponse: there is one. closed:
// "received" | "replaced" | null (closedState). changeRequests: the person's own, newest first.
export async function loadPiece(client, user, pieceId) {
  const members = await myMemberships(client, user);
  if (!members.length) return null;
  const assignments = unwrap(await client.from("piece_assignments")
    .select("piece_id, member_id, status, assigned_at, updated_at")
    .eq("piece_id", pieceId).in("member_id", members.map((m) => m.id)).limit(1));
  const assignment = assignments && assignments[0];
  if (!assignment) return null;
  const [piece, draft, responses, requests] = await Promise.all([
    client.from("pieces").select(`${PIECE_LIST_COLUMNS}, html`).eq("id", pieceId).maybeSingle().then(unwrap),
    client.from("piece_drafts").select("storage, updated_at").eq("piece_id", pieceId).eq("member_id", assignment.member_id).maybeSingle().then(unwrap),
    client.from("piece_responses").select("id, submitted_at, storage, partial").eq("piece_id", pieceId).eq("member_id", assignment.member_id)
      .eq("partial", false).order("submitted_at", { ascending: false }).order("id", { ascending: false }).limit(1).then(unwrap),
    client.from("piece_change_requests").select("id, created_at, late").eq("piece_id", pieceId).eq("member_id", assignment.member_id)
      .order("created_at", { ascending: false }).then(unwrap),
  ]);
  if (!piece) return null;
  const project = unwrap(await client.from("projects").select("id, slug, name, language").eq("id", piece.project_id).maybeSingle());
  const member = members.find((m) => m.id === assignment.member_id);
  const displayName = member && typeof member.display_name === "string" ? member.display_name.trim() : "";
  const newerPieceId = assignment.status === "replaced" ? await newerVersion(client, members, piece) : null;
  const sent = (responses || []).find((r) => r && r.partial === false) || null;
  const lastResponse = sent ? { id: sent.id, submitted_at: sent.submitted_at, storage: isPlainObject(sent.storage) ? sent.storage : null } : null;
  const changeRequests = (requests || [])
    .map((r) => ({ id: r.id, created_at: r.created_at, late: r.late === true }))
    .sort((a, b) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0));
  return {
    piece,
    project,
    assignment,
    draftStorage: draft && draft.storage && typeof draft.storage === "object" && !Array.isArray(draft.storage) ? draft.storage : {},
    draftUpdatedAt: draft && typeof draft.updated_at === "string" ? draft.updated_at : null,
    lastSubmittedAt: lastResponse ? lastResponse.submitted_at : null,
    lastResponse,
    hasSentResponse: Boolean(lastResponse),
    changeRequests,
    closed: closedState(assignment, Boolean(lastResponse)),
    memberDisplayName: displayName || null,
    newerPieceId,
  };
}

export async function saveDraft(client, pieceId, storage) {
  unwrap(await client.rpc("save_draft", { p_piece_id: pieceId, p_storage: storage }));
}

// Sends the response with the piece's storage (null when it is not a plain object). -> { id, late }: late is true when
// the piece was already closed, so the server kept the send as a change request (the id is one of
// piece_change_requests), false when it is a response, and null when that check could not be read. The send is stored
// either way; with null the caller does not know which, so it opens the piece again as the server has it.
export async function submitResponse(client, pieceId, payload, storage) {
  const id = unwrap(await client.rpc("submit_response", {
    p_piece_id: pieceId, p_payload: payload, p_storage: isPlainObject(storage) ? storage : null,
  }));
  let late = false;
  if (typeof id === "string" && id) {
    try {
      const rows = unwrap(await client.from("piece_change_requests").select("id").eq("id", id).limit(1));
      late = Array.isArray(rows) && rows.some((row) => row && row.id === id);
    } catch {
      late = null;
    }
  }
  return { id, late };
}

// A change request on a closed piece of this person; storage (the draft with changes left unsent) or null. -> its id.
export async function requestChange(client, pieceId, text, storage) {
  return unwrap(await client.rpc("request_change", {
    p_piece_id: pieceId, p_text: text, p_storage: isPlainObject(storage) ? storage : null,
  }));
}

// PostgREST / RPC errors that mean the session is gone.
export function isAuthExpired(error) {
  if (!error) return false;
  return error.status === 401 || error.code === "PGRST301" || error.code === "PGRST303" || /jwt expired|invalid jwt/i.test(String(error.message || ""));
}
