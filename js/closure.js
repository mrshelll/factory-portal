// The piece closure (spec 2026-10-22 cierre de piezas): when a piece is closed, what it opens with, whether the
// person left changes unsent, and what a change request may say. Pure module (no DOM, no Supabase), unit tested.

// A draft saved this long after the send is still the send's own (the piece saves its «sent» mark right after it).
export const UNSENT_GRACE_MS = 5000;
// The longest change request the database keeps (piece_change_requests_text_check), in characters.
export const REQUEST_TEXT_MAX = 4000;

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

// "received" (the factory collected it), "replaced" (a newer version replaced it after the person sent it, with a
// response that is not partial), or null (open). As private.assignment_closed in the database.
export function closedState(assignment, hasSentResponse) {
  const status = assignment && assignment.status;
  if (status === "received") return "received";
  if (status === "replaced" && hasSentResponse) return "replaced";
  return null;
}

// A closed piece opens with what was sent; an open one, or a send stored without its storage (sent before the
// closure existed), with the draft.
export function seedFor(closed, lastResponse, draftStorage) {
  if (closed && lastResponse && isPlainObject(lastResponse.storage)) return lastResponse.storage;
  return draftStorage;
}

// True when the draft was saved more than UNSENT_GRACE_MS after the last send: the person changed something and did
// not send it again. No draft: nothing unsent. A draft and no send: the draft was never sent.
export function hasUnsentChanges(draftUpdatedAt, lastSubmittedAt) {
  const saved = Date.parse(draftUpdatedAt);
  if (!Number.isFinite(saved)) return false;
  const sent = Date.parse(lastSubmittedAt);
  if (!Number.isFinite(sent)) return true;
  return saved - sent > UNSENT_GRACE_MS;
}

// 1 to REQUEST_TEXT_MAX characters once trimmed (characters as the database counts them, not UTF-16 units).
export function validRequestText(text) {
  if (typeof text !== "string") return false;
  const length = [...text.trim()].length;
  return length >= 1 && length <= REQUEST_TEXT_MAX;
}
