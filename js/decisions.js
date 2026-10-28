// The «Decisiones» section (spec 2026-10-28 decisiones del equipo): what a person may answer, how a point is marked,
// the owner's counts line and the project list with the projects that only have the section. Pure module (no DOM, no
// Supabase), unit tested.

export const ANSWER_VALUES = ["yes", "change", "no", "unsure"];

// The server refuses a comment over this many characters (answer_decision, 22023).
const COMMENT_MAX = 4000;

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// Every answer but «va» needs a comment: what the person would change, or why it does not go.
export function needsComment(value) {
  return value !== "yes";
}

// null when the answer can be sent, else why not. Checked in the server's order; the comment counts trimmed and by
// characters, as the server stores it.
export function validateAnswer(value, comment) {
  if (!ANSWER_VALUES.includes(value)) return "invalid-value";
  const text = typeof comment === "string" ? comment.trim() : "";
  if (needsComment(value) && !text) return "comment-required";
  if ([...text].length > COMMENT_MAX) return "too-long";
  return null;
}

const MARK_KEYS = { new: "markNew", changed: "markChanged", confirmed: "markConfirmed" };

// The i18n key that says a point's mark (my_decisions), or null when it has none.
export function markKey(mark) {
  return Object.hasOwn(MARK_KEYS, mark) ? MARK_KEYS[mark] : null;
}

const COUNT_KEYS = [["yes", "answerYes"], ["change", "answerChange"], ["no", "answerNo"], ["unsure", "answerUnsure"], ["none", "ownerNoAnswer"]];

// The owner's counts for one point (owner_decisions: { yes, change, no, unsure, none }) -> [{ key (i18n), n }], zero
// segments left out.
export function countsLine(counts) {
  if (!isPlainObject(counts)) return [];
  return COUNT_KEYS
    .map(([field, key]) => ({ key, n: Number(counts[field]) }))
    .filter((segment) => Number.isFinite(segment.n) && segment.n > 0);
}

// The project rows (projectRows) plus the projects whose list has the person but that have no pieces for them
// (decision_projects(): [{ project_id, slug, name }]), as rows of the same shape. Every row of a project with the
// section carries decisions: true. A project is never twice.
export function mergeProjectRows(rows, decisionProjects) {
  const merged = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isPlainObject(row) && isPlainObject(row.project)) merged.set(row.project.id, row);
  }
  for (const entry of Array.isArray(decisionProjects) ? decisionProjects : []) {
    if (!isPlainObject(entry) || !entry.project_id) continue;
    const existing = merged.get(entry.project_id);
    if (existing) {
      merged.set(entry.project_id, { ...existing, decisions: true });
    } else {
      merged.set(entry.project_id, {
        project: { id: entry.project_id, slug: entry.slug, name: entry.name },
        toAnswer: 0, owned: false, summary: null, decisions: true,
      });
    }
  }
  return [...merged.values()].sort((a, b) => String(a.project.name || "").localeCompare(String(b.project.name || "")));
}
