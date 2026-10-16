// Data access. Plain single-table queries joined here instead of PostgREST embeds, so the portal
// does not depend on foreign-key names. Row Level Security decides what each user can read.
// The `pieces.html` column is only fetched when one piece is opened (it can weigh ~200 KB).

const PIECE_LIST_COLUMNS = "id, project_id, kind, title, revision, language, created_at";

function unwrap({ data, error }) {
  if (error) throw error;
  return data;
}

const lower = (value) => String(value || "").trim().toLowerCase();

// The user's own memberships. RLS may let an owner see other members, so filter to this user.
async function myMemberships(client, user) {
  const rows = unwrap(await client.from("project_members").select("id, project_id, email, user_id, role"));
  return (rows || []).filter((m) => m.user_id === user.id || (user.email && lower(m.email) === lower(user.email)));
}

const byId = (rows) => new Map((rows || []).map((row) => [row.id, row]));

// -> [{ project, items: [{ piece, assignment }] }] ordered by project name.
export async function loadSharedWithMe(client, user) {
  const members = await myMemberships(client, user);
  if (!members.length) return [];
  const memberIds = members.map((m) => m.id);
  const projectIds = [...new Set(members.map((m) => m.project_id))];
  const [assignments, projects] = await Promise.all([
    client.from("piece_assignments").select("piece_id, member_id, status, assigned_at, updated_at").in("member_id", memberIds).then(unwrap),
    client.from("projects").select("id, slug, name, language").in("id", projectIds).then(unwrap),
  ]);
  const pieceIds = [...new Set((assignments || []).map((a) => a.piece_id))];
  const pieces = pieceIds.length
    ? unwrap(await client.from("pieces").select(PIECE_LIST_COLUMNS).in("id", pieceIds))
    : [];
  const piecesById = byId(pieces);
  const groups = new Map();
  for (const project of projects || []) groups.set(project.id, { project, items: [] });
  for (const assignment of assignments || []) {
    const piece = piecesById.get(assignment.piece_id);
    const group = piece && groups.get(piece.project_id);
    if (group) group.items.push({ piece, assignment });
  }
  return [...groups.values()]
    .filter((g) => g.items.length)
    .sort((a, b) => String(a.project.name).localeCompare(String(b.project.name)));
}

// -> null when the piece is not assigned to this user (or does not exist).
export async function loadPiece(client, user, pieceId) {
  const members = await myMemberships(client, user);
  if (!members.length) return null;
  const assignments = unwrap(await client.from("piece_assignments")
    .select("piece_id, member_id, status, assigned_at, updated_at")
    .eq("piece_id", pieceId).in("member_id", members.map((m) => m.id)).limit(1));
  const assignment = assignments && assignments[0];
  if (!assignment) return null;
  const [piece, draft, responses] = await Promise.all([
    client.from("pieces").select(`${PIECE_LIST_COLUMNS}, html`).eq("id", pieceId).maybeSingle().then(unwrap),
    client.from("piece_drafts").select("storage, updated_at").eq("piece_id", pieceId).eq("member_id", assignment.member_id).maybeSingle().then(unwrap),
    client.from("piece_responses").select("id, submitted_at").eq("piece_id", pieceId).eq("member_id", assignment.member_id)
      .order("submitted_at", { ascending: false }).limit(1).then(unwrap),
  ]);
  if (!piece) return null;
  const project = unwrap(await client.from("projects").select("id, slug, name, language").eq("id", piece.project_id).maybeSingle());
  return {
    piece,
    project,
    assignment,
    draftStorage: draft && draft.storage && typeof draft.storage === "object" && !Array.isArray(draft.storage) ? draft.storage : {},
    lastSubmittedAt: responses && responses[0] ? responses[0].submitted_at : null,
  };
}

export async function saveDraft(client, pieceId, storage) {
  unwrap(await client.rpc("save_draft", { p_piece_id: pieceId, p_storage: storage }));
}

export async function submitResponse(client, pieceId, payload) {
  return unwrap(await client.rpc("submit_response", { p_piece_id: pieceId, p_payload: payload }));
}

// PostgREST / RPC errors that mean the session is gone.
export function isAuthExpired(error) {
  if (!error) return false;
  return error.status === 401 || error.code === "PGRST301" || error.code === "PGRST303" || /jwt expired|invalid jwt/i.test(String(error.message || ""));
}
