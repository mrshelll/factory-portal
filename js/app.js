// Portal entry point: session, hash router and the screens (sign in, home with the projects, a project's page, piece, and
// the owner's read-only view of what a person sent).

import { supabase } from "./supabase-client.js";
import { EMAIL_OTP_LENGTH } from "../config.js";
import { h, replaceChildren } from "./dom.js";
import { translate, pickLanguage, formatDate } from "./i18n.js";
import { classifyAuthError, retryAfterSeconds, isNetworkError } from "./auth-errors.js";
import { loadProjects, loadProjectItems, loadOwnerProject, loadOwnerPiece, loadPiece, markPieceOpened, saveDraft, submitResponse, requestChange, isAuthExpired,
  loadDecisionProjects, loadMyDecisions, answerDecision, proposeDecision, markDecisionsOpened } from "./api.js";
import { parseRoute, projectHref, projectRows, personRows, ownerPieceHref } from "./project.js";
import { seedFor, hasUnsentChanges, unsentReference, validRequestText, REQUEST_TEXT_MAX } from "./closure.js";
import { createDraftSaver, trySaveAll, sendNotInDraft } from "./host.js";
import { mountPiece } from "./piece-frame.js";
import { ANSWER_VALUES, needsComment, validateAnswer, markKey, mergeProjectRows } from "./decisions.js";

const root = document.getElementById("app");
const browserLanguage = pickLanguage(navigator.languages && navigator.languages.length ? navigator.languages : navigator.language);

const PENDING_SIGN_IN_KEY = "factory-portal.pending-sign-in";
const PENDING_SIGN_IN_TTL_MS = 60 * 60 * 1000; // a code is useless after an hour
const RESEND_SECONDS = 60; // Supabase allows one email per 60 s
const LEAVE_FLUSH_MS = 1000;
const SIGN_OUT_SAVE_MS = 4000;
const REOPEN_SAVE_WAIT_MS = 3000;
const SUBMIT_SAVE_WAIT_MS = 3000; // a send waits this long for the last draft to land first
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_URL = new URL("../brand/logo.svg", import.meta.url);
const LOGO_TIMEOUT_MS = 3000;

const state = {
  session: null,
  lang: browserLanguage,
  view: "boot",
  viewId: 0,
  cleanup: null,
  signingOut: false,
  savers: new Map(),          // pieceId -> draft saver (outlives the piece screen and a session end)
  localDrafts: new Map(),     // pieceId -> newest storage seen in this tab
  draftOwner: null,           // user id the savers and local drafts above belong to
  resumeSaves: false,         // the session ended with unsaved drafts: save them after signing in again
  setAside: new Map(),        // user id -> { savers, localDrafts } kept unsaved while another account is in
  statusListeners: new Map(), // pieceId -> save status callback of the open piece screen
  lateSend: null,             // { userId, pieceId, requestId }: a send that arrived after the close, said once on reopening
  requestTexts: new Map(),    // `${userId}|${pieceId}` -> a change request being written (kept if the session ends)
};

const t = (key, params) => translate(state.lang, key, params);

// The ninben logo, read once from brand/logo.svg and placed inline (its stroke is var(--signal), so it
// follows light and dark). Without it the masthead still shows the name.
let logoTemplate = null;
async function loadLogo() {
  try {
    const response = await fetch(LOGO_URL, { signal: AbortSignal.timeout(LOGO_TIMEOUT_MS) });
    if (!response.ok) return;
    const svg = new DOMParser().parseFromString(await response.text(), "image/svg+xml").documentElement;
    if (svg.namespaceURI === "http://www.w3.org/2000/svg" && svg.localName === "svg" && !svg.querySelector("parsererror")) logoTemplate = document.importNode(svg, true);
  } catch { /* offline or blocked: the name alone */ }
}
const logo = () => (logoTemplate ? logoTemplate.cloneNode(true) : null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function setLanguage(lang) {
  state.lang = pickLanguage(lang);
  document.documentElement.lang = state.lang;
}
function setTitle(text) { document.title = `${text} · ${t("brand")}`; }

// ---- layout ---------------------------------------------------------------------------------

function visuallyHiddenStatus() {
  return h("p", { class: "visually-hidden", role: "status", "aria-live": "polite" });
}

// The masthead with the ninben brand, the same on every screen (the piece screen included, where it is a
// <div> inside the screen's single <header>).
function masthead(headerActions = [], tag = "header") {
  // The brand is a link home, on every screen after signing in (the logo is the way to «Tus proyectos»); on home itself it is
  // the current page. On the sign-in screens there is no home to go to, so it is the mark alone: tapping it would only wipe
  // the code being typed.
  const mark = [logo(), h("span", {}, t("brand"))];
  const brand = state.view === "sign-in"
    ? h("div", { class: "brand", "data-rol": "marca-producto" }, mark)
    : h("a", { class: "brand", "data-rol": "marca-producto", href: "#/", "aria-label": t("brandHome"),
      "aria-current": ["", "#", "#/"].includes(location.hash) ? "page" : null }, mark);
  return h(tag, { class: "masthead" },
    brand,
    headerActions.length ? h("div", { class: "masthead-actions" }, headerActions) : null);
}

// «← Tus proyectos», «← {project}»: where the screen goes back to. The arrow is not read; the link's name says where.
// Below 672 px the link reads «← Volver», one line whatever the destination's name (MAR-14), and its name still says
// where («Volver a {project}»); from 672 it shows the destination (portal.css).
function backLink({ href, text, label }) {
  return h("a", { class: "back-link", href, "aria-label": label }, h("span", { "aria-hidden": "true" }, "←"),
    h("span", { class: "back-link-long" }, text), h("span", { class: "back-link-short" }, t("backShort")));
}
const homeBack = () => ({ href: "#/", text: t("backToProjects"), label: t("backToProjectsLabel") });

// One frame for every screen: masthead, then inside <main> the title band, the notice zone and
// the body. The frame's box is the .frame (the masthead's too); inside <main>, its data-rol="marco" holds
// the title band, the notices and the body, as the visual manual's anatomy puts them (marco.md). `back`
// ({ href, text, label }) puts the way back first, as the manual's optional «contexto» zone, without a data-rol; only from
// 672 px: the screens that have it (a project's page) go back home, which the brand links to on a phone (portal.css).
function frameLayout({ title, meta = [], headerActions = [], back = null }) {
  const notices = h("div", { class: "notices", "data-rol": "avisos" });
  const body = h("div", { class: "body", "data-rol": "cuerpo" });
  const live = visuallyHiddenStatus();
  replaceChildren(root, h("div", { class: "frame" },
    masthead(headerActions),
    h("main", { id: "main", class: back ? "context-wide" : null },
      h("div", { "data-rol": "marco" },
        back ? h("p", { class: "page-context page-context--wide" }, backLink(back)) : null,
        h("div", { class: "page-head", "data-rol": "cabecera" },
          h("h1", {}, title),
          meta.filter(Boolean).map((line) => h("p", { class: "page-meta" }, line))),
        notices, body, live))));
  return { notices, body, live };
}

// A notice, in the page, until dismissed or the screen changes (no floating toasts).
function noticeElement({ tone = "info", text, actions = [], dismissible = true }) {
  const notice = h("div", { class: `notice notice--${tone}`, role: tone === "error" ? "alert" : "status" },
    h("p", {}, text));
  // An action with `href` is a link (it goes somewhere); one with `onClick`, a button.
  const buttons = actions.map((a) => (a.href ? h("a", { class: "link-button", href: a.href }, a.label)
    : h("button", { type: "button", class: "link-button", onclick: a.onClick }, a.label)));
  if (dismissible) buttons.push(h("button", { type: "button", class: "link-button", onclick: () => notice.remove() }, t("dismiss")));
  if (buttons.length) notice.append(h("div", { class: "notice-actions" }, buttons));
  return notice;
}
// One notice at a time in a zone.
function showNotice(container, options) {
  replaceChildren(container, noticeElement(options));
}
const clearNotice = (container) => replaceChildren(container);

function fieldError(id) { return h("p", { class: "field-error", id, hidden: true }); }
function setFieldError(input, errorEl, text) {
  errorEl.textContent = text || "";
  errorEl.hidden = !text;
  if (text) { input.setAttribute("aria-invalid", "true"); input.focus(); }
  else input.removeAttribute("aria-invalid");
}

// ---- router ---------------------------------------------------------------------------------

async function route() {
  const viewId = ++state.viewId;
  state.view = "routing";
  if (state.cleanup) { const cleanup = state.cleanup; state.cleanup = null; await cleanup(); }
  if (viewId !== state.viewId) return;
  if (!state.session) return showSignIn();
  adoptSession();
  const target = parseRoute(location.hash);
  if (target.name === "piece") return showPiece(target.pieceId, viewId);
  if (target.name === "project") return showProject(target.projectId, viewId);
  if (target.name === "owner-piece") return showOwnerPiece(target, viewId);
  // Anything else is home.
  if (location.hash && location.hash !== "#/") history.replaceState(null, "", `${location.pathname}${location.search}#/`);
  return showHome(viewId);
}

// ---- sign in --------------------------------------------------------------------------------

function readPendingSignIn() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_SIGN_IN_KEY));
    if (value && typeof value.email === "string" && typeof value.sentAt === "number" && Date.now() - value.sentAt < PENDING_SIGN_IN_TTL_MS) return value;
  } catch { /* unreadable: start over */ }
  return null;
}
function writePendingSignIn(email, sentAt) {
  try { localStorage.setItem(PENDING_SIGN_IN_KEY, JSON.stringify({ email, sentAt })); } catch { /* private mode */ }
}
function clearPendingSignIn() {
  try { localStorage.removeItem(PENDING_SIGN_IN_KEY); } catch { /* private mode */ }
}

async function requestCode(email) {
  try {
    const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    return error ? { ok: false, error } : { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

function stepsSection() {
  return h("section", { class: "section", "aria-labelledby": "steps-title" },
    h("h2", { id: "steps-title" }, t("stepsTitle")),
    h("ol", { class: "steps" }, [t("step1"), t("step2", { length: EMAIL_OTP_LENGTH }), t("step3")].map((text, i) =>
      // The number is text, so each step starts on the section's edge with it (MAR-10).
      h("li", {}, h("span", { class: "step-number" }, `${i + 1}. `), text))));
}

// The sign-in screens keep the same composition: the form (its primary action last, MAR-06) and what goes
// after it, then how it works.
function signInBody(body, form, after = null) {
  body.append(h("div", { class: "split" }, h("div", { class: "section" }, form, after), stepsSection()));
}

function showSignIn({ notice } = {}) {
  setLanguage(browserLanguage);
  const pending = readPendingSignIn();
  if (pending) showCodeStep(pending, { notice });
  else showEmailStep("", { notice });
}

function showEmailStep(prefill = "", { notice } = {}) {
  state.view = "sign-in";
  setTitle(t("signInPageTitle"));
  const { notices, body } = frameLayout({ title: t("signInTitle"), meta: [t("signInLead")] });
  if (notice) showNotice(notices, notice());
  const input = h("input", {
    id: "email", name: "email", type: "email", autocomplete: "email", inputmode: "email",
    autocapitalize: "none", spellcheck: "false", required: true, "aria-describedby": "email-hint email-error",
  });
  input.value = prefill;
  const error = fieldError("email-error");
  const button = h("button", { type: "submit", class: "button button--primary", "data-rol": "accion-principal" }, t("sendCode"));
  let busy = false;

  async function onSubmit(event) {
    event.preventDefault();
    if (busy) return;
    const email = input.value.trim().toLowerCase();
    if (!email) return setFieldError(input, error, t("emailRequired"));
    if (!EMAIL_PATTERN.test(email)) return setFieldError(input, error, t("emailInvalid"));
    setFieldError(input, error, "");
    clearNotice(notices);
    busy = true;
    button.textContent = t("sending");
    const result = await requestCode(email);
    busy = false;
    button.textContent = t("sendCode");
    if (result.ok) {
      const sentAt = Date.now();
      writePendingSignIn(email, sentAt);
      return showCodeStep({ email, sentAt });
    }
    const kind = classifyAuthError(result.error);
    if (kind === "email-invalid") return setFieldError(input, error, t("emailInvalid"));
    if (kind === "rate-limit") {
      const seconds = retryAfterSeconds(result.error, RESEND_SECONDS);
      return showNotice(notices, {
        tone: "warning", text: t("rateLimitSend", { seconds }),
        actions: [{ label: t("haveCode"), onClick: () => {
          const sentAt = Date.now() - (RESEND_SECONDS - seconds) * 1000;
          writePendingSignIn(email, sentAt);
          showCodeStep({ email, sentAt });
        } }],
      });
    }
    showNotice(notices, { tone: "error", text: kind === "network" ? t("networkError") : t("unknownError") });
  }

  signInBody(body, h("form", { class: "form", "data-medida": "formulario", novalidate: true, onsubmit: onSubmit },
    h("div", { class: "field" },
      h("label", { for: "email" }, t("emailLabel")),
      h("p", { class: "hint", id: "email-hint" }, t("emailHint")),
      input, error),
    button));
}

function showCodeStep(pending, { notice } = {}) {
  state.view = "sign-in";
  setTitle(t("codeTitle"));
  const { notices, body, live } = frameLayout({ title: t("codeTitle"), meta: [t("codeSentTo", { email: pending.email, length: EMAIL_OTP_LENGTH })] });
  if (notice) showNotice(notices, notice());
  const input = h("input", {
    id: "code", name: "code", type: "text", inputmode: "numeric", autocomplete: "one-time-code",
    pattern: "[0-9]*", class: "code-input", required: true, "aria-describedby": "code-error",
  });
  const error = fieldError("code-error");
  const button = h("button", { type: "submit", class: "button button--primary", "data-rol": "accion-principal" }, t("verify"));
  const resendStatus = h("p", { class: "hint" });
  const resendButton = h("button", { type: "button", class: "link-button", hidden: true }, t("resend"));
  const otherEmail = h("button", { type: "button", class: "link-button" }, t("useOtherEmail"));
  let sentAt = pending.sentAt;
  let resent = false;
  let busy = false;
  let resendBusy = false;

  function tick() {
    const left = Math.ceil(RESEND_SECONDS - (Date.now() - sentAt) / 1000);
    const prefix = resent ? `${t("codeResent")} ` : "";
    resendStatus.textContent = left > 0 ? prefix + t("resendIn", { seconds: left }) : prefix.trim();
    resendStatus.hidden = !resendStatus.textContent;
    resendButton.hidden = left > 0;
  }
  const timer = setInterval(tick, 1000);
  tick();
  state.cleanup = () => clearInterval(timer);

  async function verify(event) {
    if (event) event.preventDefault();
    if (busy) return;
    const token = input.value.replace(/\D/g, "");
    if (token.length !== EMAIL_OTP_LENGTH) return setFieldError(input, error, t("codeIncomplete", { length: EMAIL_OTP_LENGTH }));
    busy = true;
    button.textContent = t("verifying");
    clearNotice(notices);
    let result;
    try { result = await supabase.auth.verifyOtp({ email: pending.email, token, type: "email" }); }
    catch (err) { result = { error: err }; }
    busy = false;
    button.textContent = t("verify");
    if (!result.error && result.data && result.data.session) {
      clearPendingSignIn();
      state.session = result.data.session;
      return route();
    }
    const kind = classifyAuthError(result.error);
    if (kind === "code-invalid") { setFieldError(input, error, t("codeInvalid")); input.select(); }
    else if (kind === "rate-limit") showNotice(notices, { tone: "error", text: t("tooManyAttempts") });
    else showNotice(notices, { tone: "error", text: kind === "network" ? t("networkError") : t("unknownError") });
  }

  input.addEventListener("input", () => {
    const digits = input.value.replace(/\D/g, "").slice(0, EMAIL_OTP_LENGTH);
    if (digits !== input.value) input.value = digits;
    if (!error.hidden) setFieldError(input, error, "");
    if (digits.length === EMAIL_OTP_LENGTH) verify();
  });

  resendButton.addEventListener("click", async () => {
    if (resendBusy) return;
    resendBusy = true;
    resendButton.textContent = t("sending");
    clearNotice(notices);
    const result = await requestCode(pending.email);
    resendBusy = false;
    resendButton.textContent = t("resend");
    if (result.ok) {
      sentAt = Date.now();
      resent = true;
      writePendingSignIn(pending.email, sentAt);
      live.textContent = t("codeResent");
      return tick();
    }
    const kind = classifyAuthError(result.error);
    if (kind === "rate-limit") {
      sentAt = Date.now() - (RESEND_SECONDS - retryAfterSeconds(result.error, RESEND_SECONDS)) * 1000;
      return tick();
    }
    showNotice(notices, { tone: "error", text: kind === "network" ? t("networkError") : t("unknownError") });
  });

  otherEmail.addEventListener("click", () => {
    clearInterval(timer);
    state.cleanup = null;
    clearPendingSignIn();
    showEmailStep(pending.email);
  });

  const form = h("form", { class: "form", "data-medida": "formulario", novalidate: true, onsubmit: verify },
    h("div", { class: "field" }, h("label", { for: "code" }, t("codeLabel", { length: EMAIL_OTP_LENGTH })), input, error),
    button);
  signInBody(body, form, h("div", { class: "secondary-actions" }, resendStatus, resendButton, otherEmail));
  input.focus();
}

// ---- session end ----------------------------------------------------------------------------

function disposeSavers() {
  for (const saver of state.savers.values()) saver.dispose();
  state.savers.clear();
  state.localDrafts.clear();
  state.resumeSaves = false;
}

// Drafts the server already confirmed are not needed once the session is over; the others stay in
// the tab (their savers keep them) until the person signs in again.
function keepOnlyUnsaved() {
  for (const [pieceId, saver] of state.savers) {
    if (saver.hasUnsaved()) continue;
    saver.dispose();
    state.savers.delete(pieceId);
    state.localDrafts.delete(pieceId);
  }
  if (state.savers.size) state.resumeSaves = true;
}

// Runs on every screen with a session. When another account signs in on the tab, the drafts the
// previous one could not save are set aside (never sent with this session, never shown to it) and the
// new account starts with its own; when an account comes back, its drafts set aside are restored and
// saved. Kept drafts are only dropped once the server confirmed them or on an explicit sign-out.
function adoptSession() {
  const userId = state.session.user.id;
  if (state.draftOwner !== userId) {
    if (state.draftOwner && state.savers.size) {
      state.setAside.set(state.draftOwner, { savers: state.savers, localDrafts: state.localDrafts });
    } else disposeSavers();
    const own = state.setAside.get(userId);
    state.setAside.delete(userId);
    state.savers = own ? own.savers : new Map();
    state.localDrafts = own ? own.localDrafts : new Map();
    state.draftOwner = userId;
    state.resumeSaves = Boolean(own);
  }
  if (!state.resumeSaves) return;
  state.resumeSaves = false;
  for (const saver of state.savers.values()) saver.retryNow();
}

const hasUnsavedDrafts = () => [state.savers, ...[...state.setAside.values()].map((b) => b.savers)]
  .some((savers) => [...savers.values()].some((s) => s.hasUnsaved()));

// A change request written and not sent yet (signing out clears them all, so any account's counts).
const hasUnsentRequest = () => [...state.requestTexts.values()].some((text) => typeof text === "string" && /\S/.test(text));

// Signing out never drops unsaved drafts nor an unsent change request silently: it first tries to save
// the drafts, and if that is not possible (offline), or a request is still unsent, it asks in the page
// before discarding them.
async function signOut(notices) {
  if (state.signingOut) return;
  state.signingOut = true;
  const saved = await trySaveAll(state.savers.values(), SIGN_OUT_SAVE_MS);
  state.signingOut = false;
  const unsent = hasUnsentRequest();
  if (!saved || unsent) {
    const text = !saved && unsent ? t("unsavedAndRequestSignOut") : saved ? t("unsentRequestSignOut") : t("unsavedSignOut");
    showNotice(notices, {
      tone: "warning", text, dismissible: false,
      actions: [
        { label: saved ? t("signOutLoseRequest") : t("signOutAnyway"), onClick: finishSignOut },
        { label: t("stay"), onClick: () => clearNotice(notices) },
      ],
    });
    return;
  }
  finishSignOut();
}

// With scope "local", auth-js removes the session (and emits SIGNED_OUT) even when the network
// call fails, so the person always lands on a clean sign-in screen.
async function finishSignOut() {
  if (state.signingOut) return;
  state.signingOut = true;
  let error = null;
  try { ({ error } = await supabase.auth.signOut({ scope: "local" })); } catch (err) { error = err; }
  state.signingOut = false;
  state.session = null;
  disposeSavers();
  state.draftOwner = null;
  state.requestTexts.clear(); // a change request being written is the account's, not the next person's on this device
  state.lateSend = null;
  clearPendingSignIn();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  state.viewId += 1;
  if (state.cleanup) { const cleanup = state.cleanup; state.cleanup = null; cleanup(); }
  const offline = error && isNetworkError(error);
  showSignIn({ notice: offline ? () => ({ tone: "info", text: t("signedOutOffline") }) : undefined });
}

// The session ended (expired, or signed out elsewhere). Unsaved drafts are not dropped: the open
// piece hands over its last change first, and whatever the server has not confirmed is saved after
// the person signs in again.
async function sessionEnded() {
  state.session = null;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  state.viewId += 1;
  if (state.cleanup) { const cleanup = state.cleanup; state.cleanup = null; await cleanup(); }
  keepOnlyUnsaved();
  if (state.session) return route(); // signed in again while the piece was handing over its draft
  showSignIn({ notice: () => ({ tone: "info", text: t("sessionExpired") }) });
}

// ---- home -----------------------------------------------------------------------------------

const STATUS_KEYS = { pending: "statusPending", in_progress: "statusInProgress", submitted: "statusSubmitted", received: "statusReceived" };
// The base's status dots (brand/ninben-components.css), one mark per state, the same wherever the state shows (COM-13):
// pending is the plain hollow dot; in progress the ink ring and sent the green ring (portal.css), received the filled
// green. Never the base's ink-filled .status--active: the pieces draw «Con observaciones» with it.
const STATUS_CLASSES = { pending: "status", in_progress: "status status--in-progress", submitted: "status status--sent", received: "status status--done" };
const KIND_KEYS = { questions: "kindQuestions", flow_review: "kindFlowReview", demo_review: "kindDemoReview" };
// Nothing left to answer: sent, received, or a replaced version (the list only keeps the ones the person had sent).
const DONE = new Set(["submitted", "received", "replaced"]);

function pieceRow({ piece, assignment, lastRequestAt }) {
  // A replaced version in the list was sent and is closed: it reads as received, with a newer version.
  const replaced = assignment.status === "replaced";
  const status = replaced ? "received" : STATUS_KEYS[assignment.status] ? assignment.status : "pending";
  const meta = [t(KIND_KEYS[piece.kind] || "kindQuestions")];
  if (status !== "received") {
    const dateKey = status === "submitted" ? "sentOn" : status === "in_progress" ? "changedOn" : "sharedOn";
    const date = formatDate(state.lang, status === "pending" ? assignment.assigned_at : assignment.updated_at || assignment.assigned_at);
    if (date) meta.push(t(dateKey, { date }));
  }
  if (replaced) meta.push(t("newerVersionExists"));
  const requested = formatDate(state.lang, lastRequestAt);
  if (requested) meta.push(t("requestedChangeOn", { date: requested }));
  return h("li", { class: "row" },
    h("a", { class: "row-link", href: `#/piece/${piece.id}` },
      h("span", { class: "row-main" },
        h("span", { class: "row-title" }, piece.title || t("untitled")),
        h("span", { class: "row-meta" }, meta.join(" · "))),
      h("span", { class: STATUS_CLASSES[status] },
        h("span", { class: "status-dot", "aria-hidden": "true" }), t(STATUS_KEYS[status]))));
}

const sortTime = (item) => Date.parse(item.assignment.updated_at || item.assignment.assigned_at) || 0;
const isDone = (item) => DONE.has(item.assignment.status);
const countOf = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);

// A project on home, with the lists' anatomy: its name, and on the row's right what decides there, as a list carries a
// piece's state. For the person, what is left to answer (or that everything was sent); for an owner with nothing to
// answer, that they are the owner. Under the name, for its owner: that they are (when the right says what is left to
// answer), its people and the last response, when there is one; the count is the one its page shows (owner_projects()
// counts as owner_project lists), and a count of 0 is not said. What is left to answer is said once, on the right. A project
// where the person has only the «Decisiones» section (onlyDecisions) says that on the right: nothing was sent there.
function projectRow({ project, toAnswer, owned, summary, onlyDecisions }) {
  const aside = toAnswer > 0 ? t("projectToAnswer", { count: toAnswer }) : owned ? t("projectOwner")
    : onlyDecisions ? t("decisionsTitle") : t("projectAllSent");
  const meta = [];
  if (owned && toAnswer > 0) meta.push(t("projectOwner"));
  if (owned && summary) {
    const people = countOf(summary.people);
    if (people) meta.push(people === 1 ? t("projectPeopleOne") : t("projectPeople", { count: people }));
    const last = formatDate(state.lang, summary.last_response_at);
    if (last) meta.push(t("projectLastResponse", { date: last }));
  }
  return h("li", { class: "row" },
    h("a", { class: "row-link", href: projectHref(project.id) },
      h("span", { class: "row-main" },
        h("span", { class: "row-title" }, project.name || project.slug || t("untitled")),
        meta.length ? h("span", { class: "row-meta" }, meta.join(" · ")) : null),
      h("span", { class: "row-aside" }, aside)));
}

const unsavedWarning = (notices) => {
  if ([...state.savers.values()].some((s) => s.hasUnsaved())) showNotice(notices, { tone: "warning", text: t("unsavedElsewhere") });
};

async function showHome(viewId) {
  state.view = "home";
  const user = state.session.user;
  const signOutButton = () => h("button", { type: "button", class: "button button--secondary", onclick: () => signOut(layout.notices) }, t("signOut"));
  setTitle(t("projectsTitle"));
  let layout = frameLayout({ title: t("projectsTitle"), meta: [t("signedInAs", { email: user.email })], headerActions: [signOutButton()] });
  layout.body.append(h("p", { class: "loading", role: "status" }, t("loadingList")));

  let rows;
  try {
    // The projects with something asked of the person or owned by them, plus those where they are only in the list of the
    // «Decisiones» section (decision_projects), each once.
    const [{ groups, owned }, decisionProjects] = await Promise.all([loadProjects(supabase, user), loadDecisionProjects(supabase)]);
    const withItems = new Set(groups.map((group) => group.project.id));
    rows = mergeProjectRows(projectRows(groups, owned), decisionProjects)
      .map((row) => ({ ...row, onlyDecisions: Boolean(row.decisions) && !row.owned && !withItems.has(row.project.id) }));
  } catch (error) {
    if (viewId !== state.viewId) return;
    if (isAuthExpired(error)) return sessionEnded();
    replaceChildren(layout.body);
    showNotice(layout.notices, { tone: "error", text: t("loadError"), actions: [{ label: t("retry"), onClick: route }], dismissible: false });
    return;
  }
  if (viewId !== state.viewId) return;

  // Text follows the projects' language when they all share one; otherwise the browser's. A project known only from the
  // section's list (decision_projects) carries no language, so it does not count.
  const languages = [...new Set(rows.filter((row) => !row.onlyDecisions).map((row) => pickLanguage(row.project.language)))];
  setLanguage(languages.length === 1 ? languages[0] : browserLanguage);
  setTitle(t("projectsTitle"));
  const count = !rows.length ? null : rows.length === 1 ? t("projectsCountOne") : t("projectsCount", { count: rows.length });
  layout = frameLayout({ title: t("projectsTitle"), meta: [count, t("signedInAs", { email: user.email })], headerActions: [signOutButton()] });
  unsavedWarning(layout.notices);

  if (!rows.length) {
    // An empty state (EST-01) with the shape of the list it replaces: the list (its own top rule) with one row: the message,
    // the base's section notice (information) that asks the person to check the email they were invited with
    // (aviso-de-seccion), carrying its own action, «Entrar con otro correo», as the base's notices do; and, right after it
    // in the same column at every width, the view's primary action, «Actualizar», so nothing of the block follows it
    // (MAR-06). Divs, not a list: there is nothing to enumerate.
    layout.body.append(h("section", { class: "rows empty", "data-rol": "vacio", "aria-labelledby": "empty-title" },
      h("div", { class: "row" }, h("div", { class: "row-item" },
        h("div", { class: "row-main" },
          h("h2", { id: "empty-title", class: "row-title" }, t("emptyTitle")),
          h("p", {}, t("emptyBody", { email: user.email })),
          h("div", { class: "notice" }, h("p", {}, t("emptyHint")),
            h("div", { class: "notice-actions" },
              h("button", { type: "button", class: "link-button", onclick: () => signOut(layout.notices) }, t("emptyAction")))),
          h("div", { class: "empty-actions" },
            h("button", { type: "button", class: "button button--primary", "data-rol": "accion-principal", onclick: route }, t("refresh"))))))));
    return;
  }
  layout.body.append(h("ul", { class: "rows" }, rows.map(projectRow)));
}

// ---- a project's page -----------------------------------------------------------------------

// The owner's part of a project's page: per piece (newest first), its title and kind, then one entry per person assigned
// (personRows: by name, owners after) with the state the owner reads, its date said for what it is (sent, opened, last
// changed or shared) and, said by their date and never by their text, the person's change requests and sends after the
// close. The name is plain text; a send that kept its storage carries its own link next to it, «Ver lo que envió», that
// opens what the person sent, read only (showOwnerPiece), so the link colour only ever means a link. When nobody was
// assigned anything yet, the section says so.
const OWNER_STATUS_KEYS = { pending: "ownerStatusPending", opened: "ownerStatusOpened", in_progress: "ownerStatusInProgress",
  submitted: "ownerStatusSubmitted", received: "ownerStatusReceived", replaced: "ownerStatusReplaced" };
// The base's status dots (COM-13), one mark per state and the same as in the person's list: «Por empezar» hollow grey,
// «La abrió» half filled, «En curso» the ink ring, «Enviada» the green ring, «Recibida» filled green, «Reemplazada» the
// grey ring struck through (the modifiers are in portal.css, with base tokens only). Never the ink-filled dot, which in
// the pieces the owner opens from here means «Con observaciones» or «Pidió un cambio».
const OWNER_STATUS_CLASSES = { pending: "status", opened: "status status--opened", in_progress: "status status--in-progress",
  submitted: "status status--sent", received: "status status--done", replaced: "status status--replaced" };

// The date next to the state, saying which one it is (latestActivityKind).
function activityLine(kind, date) {
  if (kind === "received") return t("ownerReceivedOn", { date });
  if (kind === "sent") return t("ownerSentOn", { date });
  if (kind === "opened") return t("ownerOpenedOn", { date });
  if (kind === "changed") return t("changedOn", { date });
  return t("sharedOn", { date });
}

function ownerEntry(projectId, piece, row, member, requests) {
  const name = row.name && row.name.trim() ? row.name.trim() : (member && member.email) || t("untitled");
  const meta = [];
  const date = formatDate(state.lang, row.at);
  if (date) meta.push(activityLine(row.atKind, date));
  for (const request of requests) {
    const at = formatDate(state.lang, request.created_at);
    if (at) meta.push(t(request.late === true ? "ownerLateSend" : "ownerAskedChange", { date: at }));
  }
  const status = OWNER_STATUS_KEYS[row.status] ? row.status : "pending";
  const open = row.readable
    ? h("a", { class: "owner-open", href: ownerPieceHref(projectId, piece.id, row.memberId),
      "aria-label": t("ownerOpenLabel", { name, piece: piece.title || t("untitled") }) }, h("span", {}, t("ownerOpen")))
    : null;
  return h("li", { class: "row" }, h("div", { class: "row-item" },
    h("span", { class: "row-main" },
      h("span", { class: "owner-name" }, h("span", { class: "row-title" }, name), open),
      meta.length ? h("span", { class: "row-meta" }, meta.join(" · ")) : null),
    h("span", { class: OWNER_STATUS_CLASSES[status] }, h("span", { class: "status-dot", "aria-hidden": "true" }), t(OWNER_STATUS_KEYS[status]))));
}

function ownerPart(projectId, view) {
  const members = new Map(view.members.map((m) => [m.id, m]));
  // A person's change requests on a piece, the newest of each kind (asked, or a send after the close), oldest first.
  const requestsOf = (pieceId, memberId) => {
    const newest = new Map();
    for (const request of view.change_requests) {
      if (request.piece_id !== pieceId || request.member_id !== memberId) continue;
      const kind = request.late === true;
      const at = Date.parse(request.created_at);
      if (Number.isFinite(at) && !(Date.parse(newest.get(kind)?.created_at) >= at)) newest.set(kind, request);
    }
    return [...newest.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  };
  const groups = view.pieces.map((piece) => {
    const rows = personRows(piece, members);
    if (!rows.length) return null;
    return h("div", { class: "owner-piece" },
      h("h3", { class: "owner-piece-title" }, piece.title || t("untitled")),
      h("p", { class: "owner-piece-kind" }, t(KIND_KEYS[piece.kind] || "kindQuestions")),
      h("ul", { class: "rows" }, rows.map((row) => ownerEntry(projectId, piece, row, members.get(row.memberId), requestsOf(piece.id, row.memberId)))));
  }).filter(Boolean);
  return h("section", { class: "section owner-part", "aria-labelledby": "owner-title" },
    h("h2", { id: "owner-title" }, t("ownerSection")),
    h("p", { class: "owner-lead" }, t(groups.length ? "ownerLead" : "ownerEmpty")),
    groups);
}

// The line that says what the project's owner sees, then what was asked of the person in this project (the list home
// used to have), the «Decisiones» section when the person is in its list (decisionsSection) and, for its owner, how it is
// going for everyone. The line is for the people asked: it shows with their own items or the section, and to someone who is not the owner and has nothing here (the page is not left empty); never to an owner
// with nothing asked, whose part opens with its own line (or says nothing was shared yet). It goes first and is short, so on a phone what follows it shows within the first screen however long the
// lists are (FUN-42). A project that is not the person's says it is not available, as a piece does.
async function showProject(projectId, viewId) {
  state.view = "project";
  const user = state.session.user;
  const signOutButton = () => h("button", { type: "button", class: "button button--secondary", onclick: () => signOut(layout.notices) }, t("signOut"));
  setTitle(t("opening"));
  let layout = frameLayout({ title: t("opening"), headerActions: [signOutButton()], back: homeBack() });
  layout.body.append(h("p", { class: "loading", role: "status" }, t("loadingList")));

  let loaded;
  let owner;
  let decisions;
  try {
    let listed;
    [loaded, listed] = await Promise.all([loadProjectItems(supabase, user, projectId), loadDecisionProjects(supabase)]);
    // Only the project's owner asks how it is going for everyone; the server still checks it (null when it refuses).
    owner = loaded.owner ? await loadOwnerProject(supabase, projectId) : null;
    // The «Decisiones» section is for the people in its list, never for the owner: only a project decision_projects() names
    // (the person is in its list and it has points) asks for it, so nobody else gets a refusal. null when the server refuses.
    decisions = !loaded.owner && listed.some((entry) => entry.project_id === projectId) ? await loadMyDecisions(supabase, projectId) : null;
  } catch (error) {
    if (viewId !== state.viewId) return;
    if (isAuthExpired(error)) return sessionEnded();
    setTitle(t("pieceLoadErrorTitle"));
    layout = frameLayout({ title: t("pieceLoadErrorTitle"), headerActions: [signOutButton()], back: homeBack() });
    showNotice(layout.notices, { tone: "error", text: t("pieceLoadError"), actions: [{ label: t("retry"), onClick: route }], dismissible: false });
    return;
  }
  if (viewId !== state.viewId) return;
  const { items } = loaded;
  const project = loaded.project || (owner && owner.project) || null;
  if (!project) {
    setTitle(t("projectNotFoundTitle"));
    layout = frameLayout({ title: t("projectNotFoundTitle"), headerActions: [signOutButton()], back: homeBack() });
    showNotice(layout.notices, { tone: "info", text: t("projectNotFound"), dismissible: false });
    return;
  }

  setLanguage(project.language || browserLanguage);
  const name = project.name || project.slug || t("untitled");
  setTitle(name);
  layout = frameLayout({ title: name, headerActions: [signOutButton()], back: homeBack() });
  unsavedWarning(layout.notices);
  const ownerSection = owner ? ownerPart(projectId, owner) : null;
  // Only once the factory published points for the project: an empty section is of no use to anyone.
  const points = decisions ? decisions.points : [];
  if (items.length || points.length || !owner) layout.body.append(h("p", { class: "page-note" }, t("projectOwnerSees")));
  if (items.length) {
    const sorted = [...items].sort((a, b) => isDone(a) - isDone(b) || sortTime(b) - sortTime(a));
    layout.body.append(h("section", { class: "section", "aria-labelledby": "asked-title" },
      h("h2", { id: "asked-title" }, t("askedOfYou")),
      h("ul", { class: "rows" }, sorted.map(pieceRow))));
  }
  if (points.length) {
    layout.body.append(decisionsSection({ projectId, viewId, points, live: layout.live }));
    // «Abrió la sección», once per visit, after the section was read (the marks «Nuevo» count from the previous opening).
    // Not awaited, and it never throws: the section works whatever happens to that call.
    markDecisionsOpened(supabase, projectId);
  }
  if (ownerSection) layout.body.append(ownerSection);
}

// ---- the «Decisiones» section of a project's page --------------------------------------------
//
// Manual pattern: «formulario» (patrones/formulario.md) inside the project page's «lista»: each point is a group under its
// title (FOR-05) with what was decided, «En qué se apoya» folded (FOR-13) and its mark for this person; its answer is one
// choice of four in one group, «No sé» among them (FOR-11), the comment shown and required only when the choice is not «Va»
// (FOR-05), and the send shown once there is a choice; a point answered on its current version comes back with that answer
// (FOR-12). Each point sends on its own, its button off while sending; the result is the change in the point («Respondiste
// el …», the mark), announced without moving the focus (COM-16), and a failure is said in the point (COM-17); no native
// dialog (COM-18). The proposal form closes the section, always. Every text from the server (points, the person's own
// comments) goes through text nodes (h()), never as markup.

const ANSWER_KEYS = { yes: "answerYes", change: "answerChange", no: "answerNo", unsure: "answerUnsure" };
// The server refuses a comment or a proposal over 4000 characters. A textarea's maxlength counts UTF-16 units, never fewer
// than characters, so with it a text the server would refuse for its length cannot be typed.
const DECISION_TEXT_MAX = 4000;
const SVG_NS = "http://www.w3.org/2000/svg";

// The fold's chevron, as the pieces draw theirs (a «more» fold): it turns when the fold opens.
function chevron() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  for (const [name, value] of [["d", "M6 3l5 5-5 5"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "2"]]) path.setAttribute(name, value);
  svg.append(path);
  return svg;
}

// «En qué se apoya», folded: each item's text and, under it, its literal quote (never the file it comes from). null when
// there is nothing to show.
function basisFold(basis) {
  const parts = (Array.isArray(basis) ? basis : []).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const text = typeof item.text === "string" && item.text.trim() ? h("p", {}, item.text) : null;
    const quote = item.quote && typeof item.quote.text === "string" && item.quote.text.trim()
      ? h("blockquote", {}, h("p", {}, item.quote.text)) : null;
    return [text, quote].filter(Boolean);
  });
  if (!parts.length) return null;
  return h("details", { class: "decision-basis" },
    h("summary", {}, chevron(), h("span", {}, t("basisToggle"))),
    h("div", { class: "decision-basis-body" }, parts));
}

// The section: its title and lead, the points (my_decisions, by position) and the proposal form. What the person chose and
// typed and has not sent is kept per point (drafts) while the page is open, so a reload of the section never loses it. A
// point the server refused because it changed while she read it (PT409) shows as changed for the rest of the visit, until
// she answers it again.
function decisionsSection({ projectId, viewId, points, live }) {
  const drafts = new Map(); // point key -> { value, comment }
  const stale = new Set();  // point keys refused as changed on this visit
  const list = h("ol", { class: "rows decisions-points" });

  // The section again as the server has it. false when it could not be read (the caller says so in the point); a person no
  // longer in the list, or a section left without points, gets the page as it is now.
  async function reload(focusKey = null) {
    let next;
    try {
      next = await loadMyDecisions(supabase, projectId);
    } catch (error) {
      if (viewId !== state.viewId) return true;
      if (isAuthExpired(error)) { sessionEnded(); return true; }
      return false;
    }
    if (viewId !== state.viewId) return true;
    if (!next || !next.points.length) { route(); return true; }
    render(next.points);
    if (focusKey) {
      const title = [...list.querySelectorAll(".decision")].find((el) => el.dataset.key === focusKey)?.querySelector(".decision-title");
      if (title) title.focus();
    }
    return true;
  }

  function render(rows) {
    replaceChildren(list, rows.filter((p) => typeof p.key === "string" && p.key && typeof p.version === "string" && p.version)
      .map((point, index) => decisionPoint(point, index)));
  }

  function decisionPoint(point, index) {
    const key = point.key;
    const id = `decision-${index}`;
    const title = typeof point.title === "string" && point.title.trim() ? point.title : t("untitled");
    // Her answer on the version shown comes back chosen (FOR-12); one on an older version does not: the text changed.
    const current = point.answer && point.answer.version === point.version ? point.answer : null;
    const draft = drafts.get(key);
    let chosen = draft ? draft.value : current ? current.value : null;

    const mark = h("p", { class: "decision-mark" });
    const answered = h("p", { class: "decision-answered" });
    function showStatus(markValue, answer) {
      const markText = markKey(markValue) ? t(markKey(markValue)) : "";
      mark.textContent = markText;
      mark.hidden = !markText;
      const date = answer ? formatDate(state.lang, answer.created_at) : "";
      answered.textContent = date ? t("answerSent", { date }) : "";
      answered.hidden = !date;
    }
    showStatus(stale.has(key) ? "changed" : point.mark, point.answer);

    const radios = ANSWER_VALUES.map((value) => h("input", { type: "radio", id: `${id}-${value}`, name: `${id}-answer`, value, checked: chosen === value }));
    const comment = h("textarea", { id: `${id}-comment`, name: `${id}-comment`, rows: "3", maxlength: String(DECISION_TEXT_MAX),
      "aria-describedby": `${id}-comment-error` });
    comment.value = draft ? draft.comment : current && typeof current.comment === "string" ? current.comment : "";
    const commentError = fieldError(`${id}-comment-error`);
    const commentField = h("div", { class: "field" }, h("label", { for: comment.id }, t("commentLabel")), comment, commentError);
    const failure = h("div", { class: "decision-notice" });
    const button = h("button", { type: "submit", class: "button button--secondary" }, t("sendAnswer"));
    if (stale.has(key)) showNotice(failure, { tone: "warning", text: t("answerStale"), dismissible: false });
    const showFailure = (text) => showNotice(failure, { tone: "error", text, dismissible: false });

    // The comment only once the choice needs it, and the send only once there is a choice (FOR-05).
    function reveal() {
      commentField.hidden = !chosen || !needsComment(chosen);
      button.hidden = !chosen;
    }
    const remember = () => drafts.set(key, { value: chosen, comment: comment.value });
    for (const radio of radios) {
      radio.addEventListener("change", () => {
        chosen = radio.value;
        remember();
        if (!commentError.hidden) setFieldError(comment, commentError, "");
        reveal();
      });
    }
    comment.addEventListener("input", () => {
      remember();
      if (!commentError.hidden) setFieldError(comment, commentError, "");
    });

    let busy = false;
    async function onSubmit(event) {
      event.preventDefault();
      if (busy || !chosen) return;
      const value = chosen;
      // A hidden comment (she chose «Va» after typing one) is not sent: only what she sees goes.
      const text = needsComment(value) ? comment.value : null;
      const problem = validateAnswer(value, text);
      if (problem === "comment-required") return setFieldError(comment, commentError, t("commentRequired"));
      if (problem) return showFailure(t("unknownError"));
      setFieldError(comment, commentError, "");
      clearNotice(failure);
      busy = true;
      button.disabled = true;
      button.textContent = t("sending");
      const result = await answerDecision(supabase, projectId, key, point.version, value, text);
      busy = false;
      button.disabled = false;
      button.textContent = t("sendAnswer");
      if (viewId !== state.viewId) return;
      if (result.ok) {
        stale.delete(key);
        drafts.delete(key);
        point.answer = { value, comment: text, version: point.version, created_at: result.createdAt || new Date().toISOString() };
        point.mark = value === "yes" ? "confirmed" : "none";
        // The section was read again while this was sent: read it once more, so it shows this answer.
        if (!item.isConnected) { reload(); return; }
        showStatus(point.mark, point.answer);
        live.textContent = answered.textContent;
        // The button was off while sending, which drops the focus: give it back where it was.
        if (!document.activeElement || document.activeElement === document.body) button.focus();
        return;
      }
      // The point changed while she read it: the section again, the point marked as changed, her choice and comment kept.
      if (result.error === "stale") {
        stale.add(key);
        remember();
        if (await reload(key)) live.textContent = t("answerStale");
        else showFailure(t("networkError"));
        return;
      }
      // The point is no longer published: the section again, without it.
      if (result.error === "gone") {
        drafts.delete(key);
        if (!(await reload())) showFailure(t("networkError"));
        return;
      }
      // She is no longer in the list: the page as it is now.
      if (result.error === "denied") { route(); return; }
      showFailure(t(result.error === "invalid" ? "unknownError" : "networkError"));
    }

    const item = h("li", { class: "row decision", "data-key": key },
      h("h3", { id: `${id}-title`, class: "decision-title", tabindex: "-1" }, title),
      mark,
      h("p", { class: "decision-decided" }, typeof point.decided === "string" ? point.decided : ""),
      basisFold(point.basis),
      answered,
      h("form", { class: "form decision-form", "data-medida": "formulario", novalidate: true, onsubmit: onSubmit },
        h("fieldset", { class: "choices" },
          h("legend", { class: "visually-hidden" }, title),
          radios.map((radio) => h("div", { class: "choice" }, radio, h("label", { for: radio.id }, t(ANSWER_KEYS[radio.value]))))),
        commentField, failure, button));
    reveal();
    return item;
  }

  // «¿Falta algo?»: what the person would add and is in no point. Always at the end of the section. Sent, the form empties
  // and says it arrived (COM-16); it stays for another one.
  function proposeForm() {
    const input = h("textarea", { id: "decisions-propose-text", name: "proposal", rows: "4", maxlength: String(DECISION_TEXT_MAX),
      "aria-describedby": "decisions-propose-error" });
    const error = fieldError("decisions-propose-error");
    const failure = h("div", { class: "decision-notice" });
    const button = h("button", { type: "submit", class: "button button--secondary" }, t("proposeSend"));
    const sent = h("p", { class: "decisions-propose-sent", hidden: true }, t("proposeSent"));
    let busy = false;
    input.addEventListener("input", () => { if (!error.hidden) setFieldError(input, error, ""); });

    async function onSubmit(event) {
      event.preventDefault();
      if (busy) return;
      const text = input.value.trim();
      if (!text) return setFieldError(input, error, t("proposeEmpty"));
      setFieldError(input, error, "");
      clearNotice(failure);
      busy = true;
      button.disabled = true;
      button.textContent = t("sending");
      const result = await proposeDecision(supabase, projectId, text);
      busy = false;
      button.disabled = false;
      button.textContent = t("proposeSend");
      if (viewId !== state.viewId) return;
      if (result.ok) {
        // What she typed after sending stays.
        if (input.value.trim() === text) input.value = "";
        sent.hidden = false;
        live.textContent = t("proposeSent");
        if (!document.activeElement || document.activeElement === document.body) button.focus();
        return;
      }
      if (result.error === "denied") { route(); return; }
      if (result.error === "invalid") return setFieldError(input, error, t("proposeEmpty"));
      showNotice(failure, { tone: "error", text: t("networkError"), dismissible: false });
    }

    return h("div", { class: "decisions-propose" },
      h("h3", { id: "decisions-propose-title" }, t("proposeTitle")),
      h("form", { class: "form", "data-medida": "formulario", novalidate: true, onsubmit: onSubmit, "aria-labelledby": "decisions-propose-title" },
        h("div", { class: "field" }, h("label", { for: input.id }, t("proposeLead")), input, error),
        failure, button),
      sent);
  }

  render(points);
  return h("section", { class: "section decisions", "aria-labelledby": "decisions-title" },
    h("h2", { id: "decisions-title" }, t("decisionsTitle")),
    h("p", { class: "decisions-lead" }, t("decisionsLead")),
    list,
    proposeForm());
}

// ---- piece ----------------------------------------------------------------------------------

function saverFor(pieceId) {
  if (!state.savers.has(pieceId)) {
    const owner = state.draftOwner;
    const own = () => Boolean(owner) && state.session?.user?.id === owner;
    state.savers.set(pieceId, createDraftSaver({
      // Only with its owner's session: signed out, or with another account in, the save fails at once
      // without a request and the saver keeps the data for later.
      save: (storage) => (own() ? saveDraft(supabase, pieceId, storage) : Promise.reject(new Error("not the draft owner's session"))),
      onStatus: (status) => {
        if (state.draftOwner !== owner) return;
        const listener = state.statusListeners.get(pieceId);
        if (listener) listener(status);
      },
    }));
  }
  return state.savers.get(pieceId);
}

// The frame of the piece screen: the same masthead as every screen, then the way back (to the piece's project, or home
// until it is known) and the title band on the same left edge, the notices, and the piece below (it drops its own brand
// bar in the portal). The line next to the title (whether the draft was saved; on the owner's screen «Lo que envió … el …»)
// goes beside «Volver» on a phone (portal.css), so the title band stays short with a title of two lines.
function pieceLayout(titleText, back = homeBack()) {
  // A notice that stays for the whole visit (a replaced version); the zone below takes the passing ones.
  const pinned = h("div", { class: "notices", "data-rol": "aviso-fijo" });
  const notices = h("div", { class: "notices", "data-rol": "avisos" });
  const title = h("h1", { class: "piece-title" }, titleText);
  const status = h("p", { class: "piece-status" });
  const main = h("main", { id: "main", class: "piece-main", "data-rol": "cuerpo" });
  const live = visuallyHiddenStatus();
  main.append(live);
  replaceChildren(root, h("div", { class: "piece-layout" },
    h("div", { class: "frame", "data-rol": "marco" },
      h("header", {},
        masthead([], "div"),
        h("div", { class: "piece-bar" },
          backLink(back),
          // The space parts the title and the save line on one line, and goes at a line break (portal.css).
          h("div", { class: "piece-heading", "data-rol": "cabecera" }, title, " ", status))),
      pinned, notices),
    main));
  return { pinned, notices, title, status, main, live };
}

// The piece is as tall as its content and the portal's page scrolls, never the piece (MAR-14): the iframe takes exactly
// the last height the bridge posted (factory:height; until the first one, what is left of the screen under the frame,
// portal.css), and the piece's scroll requests (factory:scroll, px from the piece's top) move the page. The bridge's loop
// guard counts on the iframe's height being that height and nothing else (no min-height of the screen's). A request is
// kept inside the piece's last height; one past it (the piece grew and its new height has not arrived yet) is done again
// when that height arrives, within a second. The page scrolls at once (it has no smooth scrolling), so a request right
// after another (a step's scrollTo(0, 0) and then its title's focus) is judged where the first one left the page: no
// second jump. iframeOf: the mounted iframe, or null once the piece is gone.
const PENDING_SCROLL_MS = 1000;
function followPiece(iframeOf) {
  let height = null;
  let pending = null;
  function show({ top, bottom, ifNeeded }) {
    const iframe = iframeOf();
    if (!iframe || !iframe.isConnected) return;
    const frameBox = iframe.getBoundingClientRect();
    const limit = height === null ? frameBox.height : height;
    pending = top > limit ? { request: { top, bottom, ifNeeded }, at: Date.now() } : null;
    const from = Math.min(Math.max(top, 0), limit);
    const to = Math.min(Math.max(bottom ?? from, from), limit);
    // The piece's top in the page, and the part of the page on screen (the visual viewport: a phone's keyboard hides
    // the rest).
    const start = frameBox.top + iframe.clientTop + window.scrollY;
    const view = window.visualViewport;
    const offset = view ? view.offsetTop : 0;
    const viewTop = window.scrollY + offset;
    const viewHeight = view ? view.height : window.innerHeight;
    let y = start + from;
    if (ifNeeded) {
      if (start + from >= viewTop && start + to <= viewTop + viewHeight) return; // already in view
      // Below the window and not taller than it: its bottom at the window's bottom; otherwise its top at the top.
      if (start + from > viewTop && to - from <= viewHeight) y = start + to - viewHeight;
    }
    window.scrollTo(window.scrollX, Math.max(0, Math.round(y - offset)));
  }
  return {
    onHeight(next) {
      const iframe = iframeOf();
      if (!iframe) return;
      height = next;
      iframe.style.height = `${next}px`;
      iframe.dataset.sized = "true";
      const waiting = pending;
      pending = null;
      if (waiting && Date.now() - waiting.at <= PENDING_SCROLL_MS && waiting.request.top <= next) show(waiting.request);
    },
    onScroll: show,
  };
}

// A closed piece (received, or a replaced version the person had sent) shows what was sent, read only. In its pinned
// zone: a send that arrived after the close (said once), the notice that says why it cannot change here, with the
// newer version's link when there is one and «Pedir un cambio» (COM-15, EST-05); the earlier requests; and the
// request form, opened below them on demand. The person's request text is a third party's: it only ever goes
// through text nodes. unsentStorage: the draft with changes left unsent (it goes with the request), or null.
function showClosedPanel({ pinned, notices, live, context, pieceId, viewId, late, unsentStorage: unsentAtOpen }) {
  const userKey = `${state.session.user.id}|${pieceId}`;
  const requestLine = (iso) => h("p", { class: "hint" }, t("requestedChangeLine", { date: formatDate(state.lang, iso) }));
  const lines = h("div", { class: "change-request-lines" },
    context.changeRequests.filter((r) => !late || r.id !== late.requestId).map((r) => requestLine(r.created_at)));
  const slot = h("div", { class: "change-request-slot" });
  let form = null;          // the open form's textarea, or null
  let confirmedAt = null;   // when the last request arrived, while its line is shown where the form was
  let actionButton = null;
  let unsentStorage = unsentAtOpen; // once a request carried it, the next one does not carry it again

  function closeForm() {
    replaceChildren(slot);
    form = null;
    if (actionButton) actionButton.focus();
  }

  function openForm() {
    if (form) { form.focus(); return; }
    // Asking again: the request that arrived becomes one more line, and a new form opens in its place.
    if (confirmedAt) { lines.append(requestLine(confirmedAt)); confirmedAt = null; }
    const input = h("textarea", {
      id: "change-request-text", name: "change-request", rows: "4", maxlength: String(REQUEST_TEXT_MAX),
      "aria-describedby": ["change-request-hint", unsentStorage ? "change-request-unsent" : null, "change-request-error"].filter(Boolean).join(" "),
    });
    input.value = state.requestTexts.get(userKey) || "";
    const error = fieldError("change-request-error");
    const failure = h("div", { hidden: true });
    const button = h("button", { type: "submit", class: "button button--primary", "data-rol": "accion-principal" }, t("sendChangeRequest"));
    // Closing the form keeps the text (state.requestTexts) for when it opens again.
    const cancel = h("button", { type: "button", class: "link-button", onclick: () => { if (!busy) closeForm(); } }, t("cancel"));
    let busy = false;
    input.addEventListener("input", () => {
      state.requestTexts.set(userKey, input.value);
      if (!error.hidden) setFieldError(input, error, "");
    });
    const showFailure = (text) => { failure.hidden = !text; if (text) showNotice(failure, { tone: "error", text, dismissible: false }); else clearNotice(failure); };

    async function onSubmit(event) {
      event.preventDefault();
      if (busy) return;
      const text = input.value;
      if (!validRequestText(text)) return setFieldError(input, error, text.trim() ? t("changeRequestTooLong", { max: REQUEST_TEXT_MAX }) : t("changeRequestEmpty"));
      setFieldError(input, error, "");
      showFailure("");
      busy = true;
      button.disabled = true;
      button.textContent = t("sending");
      try {
        await requestChange(supabase, pieceId, text.trim(), unsentStorage);
      } catch (err) {
        busy = false;
        button.disabled = false;
        button.textContent = t("sendChangeRequest");
        if (viewId !== state.viewId) return;
        // The factory reopened the piece meanwhile (55000: not closed): open it again as it is now; the text stays.
        if (err && err.code === "55000") { route(); return; }
        if (isAuthExpired(err)) {
          showNotice(notices, { tone: "error", text: t("sessionExpired"), actions: [{ label: t("signInAgain"), onClick: sessionEnded }] });
          return;
        }
        showFailure(t("changeRequestFailed"));
        return;
      }
      if (state.requestTexts.get(userKey) === input.value) state.requestTexts.delete(userKey);
      unsentStorage = null;
      if (viewId !== state.viewId) return;
      // The confirmation is the change (COM-16): the form becomes the line that says the request arrived, announced
      // without reading it twice; the focus goes back to «Pedir un cambio», next to it.
      const at = new Date().toISOString();
      const said = t("changeRequestSent", { date: formatDate(state.lang, at, { withTime: true }) });
      replaceChildren(slot, h("p", { class: "change-request-sent" }, said));
      form = null;
      confirmedAt = at;
      clearNotice(notices);
      live.textContent = said;
      if (actionButton) actionButton.focus();
    }

    // The form's primary action is its last control; «Cancelar» goes after it, as on the sign-in screens (MAR-06, FUN-08).
    replaceChildren(slot, h("form", { class: "form", "data-medida": "formulario", novalidate: true, onsubmit: onSubmit },
      h("div", { class: "field" },
        h("label", { for: "change-request-text" }, t("changeRequestLabel")),
        h("p", { class: "hint", id: "change-request-hint" }, t("changeRequestHint")),
        unsentStorage ? h("p", { class: "hint", id: "change-request-unsent" }, t("changeRequestUnsent")) : null,
        input, error),
      failure, button), h("div", { class: "secondary-actions" }, cancel));
    form = input;
    input.focus();
  }

  const why = context.closed === "received"
    ? t("receivedNotice", { date: formatDate(state.lang, context.assignment.updated_at || (context.lastResponse && context.lastResponse.submitted_at)) })
    : t("closedReplacedNotice");
  const links = context.closed === "replaced"
    ? [context.newerPieceId ? { label: t("openNewer"), href: `#/piece/${context.newerPieceId}` } : { label: t("openList"), href: projectHref(context.piece.project_id) }]
    : [];
  const notice = noticeElement({ tone: "info", text: why, dismissible: false, actions: [...links, { label: t("requestChange"), onClick: openForm }] });
  actionButton = notice.querySelector(".notice-actions button");
  // A region named by its action, so the earlier requests and the form sit in a landmark like the rest of the page.
  replaceChildren(pinned, h("section", { class: "closure", "aria-label": t("requestChange") },
    late ? noticeElement({ tone: "info", text: t("lateSendNotice"), dismissible: false }) : null,
    notice, lines, slot));
}

async function showPiece(pieceId, viewId) {
  state.view = "piece";
  const user = state.session.user;
  let frame = null;
  state.cleanup = async () => {
    state.statusListeners.delete(pieceId);
    if (frame) { await frame.flush(LEAVE_FLUSH_MS); frame.destroy(); }
  };
  setTitle(t("opening"));
  let layout = pieceLayout(t("opening"));
  // A save of this piece may still be in flight; let it land before reading the server copy.
  if (state.savers.has(pieceId)) await Promise.race([state.savers.get(pieceId).idle(), sleep(REOPEN_SAVE_WAIT_MS)]);
  if (viewId !== state.viewId) return;

  let context;
  try {
    context = await loadPiece(supabase, user, pieceId);
  } catch (error) {
    if (viewId !== state.viewId) return;
    if (isAuthExpired(error)) return sessionEnded();
    layout.title.textContent = t("pieceLoadErrorTitle");
    setTitle(t("pieceLoadErrorTitle"));
    showNotice(layout.notices, { tone: "error", text: t("pieceLoadError"), actions: [{ label: t("retry"), onClick: route }], dismissible: false });
    return;
  }
  if (viewId !== state.viewId) return;
  if (!context) {
    layout.title.textContent = t("pieceNotFoundTitle");
    setTitle(t("pieceNotFoundTitle"));
    showNotice(layout.notices, { tone: "info", text: t("pieceNotFound"), dismissible: false });
    return;
  }

  const { piece, project } = context;
  setLanguage((project && project.language) || piece.language || browserLanguage);
  const pieceTitle = piece.title || t("untitled");
  setTitle(pieceTitle);
  // Back to the piece's project, by its name; home when the project cannot be read.
  const projectName = project && (project.name || project.slug);
  layout = pieceLayout(pieceTitle, projectName
    ? { href: projectHref(piece.project_id), text: projectName, label: t("backTo", { name: projectName }) }
    : homeBack());
  // «La abrió»: an open piece records that the person opened it here (the server keeps the first time). Not awaited,
  // and it never throws: the piece opens whatever happens to that call.
  if (context.closed === null) markPieceOpened(supabase, pieceId);
  const { pinned, notices, status, main, live } = layout;

  const saver = saverFor(pieceId);
  const localDrafts = state.localDrafts; // this account's, even if the maps are swapped later
  let saveStatus = saver.hasUnsaved() ? "error" : "idle";
  // The piece's last change did not fit in its storage, so it was not kept (factory:save-failed).
  // The line says so until a later change that fits has been through the saver: a save of a draft
  // from before the refusal must not bring back «Guardado».
  let tooLarge = false;
  let draftSinceTooLarge = false;
  let lastSubmittedAt = context.lastSubmittedAt;
  const { closed } = context;
  // The newest storage this tab saw is never older than the server copy it sent, so it wins.
  const seededHere = state.localDrafts.has(pieceId);
  const draftSeed = seededHere ? state.localDrafts.get(pieceId) : context.draftStorage;
  // A closed piece opens with what was sent, never with the draft (seedFor).
  const seed = seedFor(closed, context.lastResponse, draftSeed);
  // A send the server has but the piece's saved draft cannot show (it did not get to save its «sent» mark):
  // only then the line says «Enviada el …». A copy from this tab was taken after the piece wrote its mark.
  // The person's first change or a new send here leaves it to the piece again. A closed piece says it itself.
  let sendUnshown = !closed && !seededHere && sendNotInDraft(context);
  const handled = new Set();
  // A send of this piece that arrived after the close: said once, now.
  const late = state.lateSend && state.lateSend.pieceId === pieceId && state.lateSend.userId === user.id ? state.lateSend : null;
  if (late) state.lateSend = null;
  if (closed) {
    // A change request made after the draft was saved (a late send too) already carried it.
    const unsent = hasUnsentChanges(context.draftUpdatedAt, unsentReference(context.lastSubmittedAt, context.changeRequests));
    showClosedPanel({ pinned, notices, live, context, pieceId, viewId, late,
      unsentStorage: unsent ? draftSeed : null });
  }
  // A version replaced by a newer one (opened from an old email, say) that the person never sent: what is saved
  // here is never picked up on its own, only what is sent. The notice says so and points to the newer version.
  const replaced = context.assignment.status === "replaced" && !closed;
  if (replaced) {
    showNotice(pinned, {
      tone: "warning", text: t("replacedNotice"), dismissible: false,
      actions: [context.newerPieceId ? { label: t("openNewer"), href: `#/piece/${context.newerPieceId}` } : { label: t("openList"), href: projectHref(context.piece.project_id) }],
    });
  }

  // The line next to the title says whether the draft was saved (EST-08). It does not repeat the send
  // date: every piece shows its own («Enviado el …» on its sent screen) and says when a change needs a new
  // send; only a send its saved draft cannot show (sendUnshown) is said here.
  function render() {
    // On a replaced version a saved draft has not reached anyone: the line says so until it is sent.
    const savedKey = replaced && !lastSubmittedAt ? "savedNotSent" : "saved";
    const line = tooLarge ? t("saveTooLarge")
      : saveStatus !== "idle" ? t({ saving: "saving", saved: savedKey, error: "saveError" }[saveStatus]) : "";
    const sent = sendUnshown ? t("sentAt", { date: formatDate(state.lang, lastSubmittedAt, { withTime: true }) }) : "";
    const text = [line, sent].filter(Boolean).join(" · ");
    status.textContent = text;
    status.hidden = !text;
  }
  state.statusListeners.set(pieceId, (next) => {
    // "saved" or "error" after a draft that fit: the newest change is no longer too large.
    if (tooLarge && draftSinceTooLarge && next !== "saving") { tooLarge = false; draftSinceTooLarge = false; }
    if (next === "error" && saveStatus !== "error" && !tooLarge) live.textContent = t("saveError");
    saveStatus = next;
    render();
  });
  function onSaveFailed() {
    tooLarge = true;
    draftSinceTooLarge = false;
    live.textContent = t("saveTooLarge");
    render();
  }


  // The piece sent through globalThis.factorySubmit; it only says "sent" when this answers ok, and
  // this answers ok only after submit_response saved on the server.
  async function onSubmit({ requestId, payload }) {
    if (handled.has(requestId)) return;
    handled.add(requestId);
    const answeringFrame = frame;
    // Let the draft the bridge flushed just before the send land first.
    await Promise.race([saver.idle(), sleep(SUBMIT_SAVE_WAIT_MS)]);
    let result;
    let lateSend = null;
    let reopen = false;
    try {
      const sent = await submitResponse(supabase, pieceId, payload, localDrafts.get(pieceId) || seed);
      result = { ok: true };
      // The piece was closed meanwhile: the server kept the send as a change request. The piece hears ok (nothing
      // was lost), and the piece opens again, closed, saying so.
      if (sent.late) lateSend = { userId: user.id, pieceId, requestId: sent.id };
      // The server stored it, but whether as a response or as a late request could not be read: the piece hears ok
      // and opens again as the server has it (closed or not), without guessing.
      reopen = Boolean(lateSend) || sent.late === null;
      // The piece moves focus to its own sent screen, which says it; the portal does not announce it again.
      lastSubmittedAt = new Date().toISOString();
      sendUnshown = false;
      clearNotice(notices);
    } catch (error) {
      if (isAuthExpired(error)) {
        result = { ok: false, error: "session-expired" };
        showNotice(notices, { tone: "error", text: t("sessionExpired"), actions: [{ label: t("signInAgain"), onClick: sessionEnded }] });
      } else {
        result = { ok: false, error: isNetworkError(error) ? "network" : "rejected" };
      }
    }
    render();
    if (answeringFrame) answeringFrame.respond(requestId, result);
    if (lateSend) state.lateSend = lateSend;
    if (reopen && viewId === state.viewId) route();
  }

  const follow = followPiece(() => (frame ? frame.iframe : null));
  frame = mountPiece({
    container: main, html: piece.html, kind: piece.kind, storage: seed, title: pieceTitle,
    onHeight: follow.onHeight, onScroll: follow.onScroll,
    host: { reviewerName: context.memberDisplayName, closed, sentAt: closed && context.lastResponse ? context.lastResponse.submitted_at : null },
    onReady: (ready) => { if (!ready.persistence) showNotice(notices, { tone: "warning", text: t("noPersistence") }); },
    onDirty: () => saver.markPending(),
    onDraft: (storage) => {
      if (tooLarge) draftSinceTooLarge = true; // the bridge sends what fit before a refusal ahead of it
      if (sendUnshown) { sendUnshown = false; render(); } // the person changed something: the piece speaks for it now
      localDrafts.set(pieceId, storage);
      saver.push(storage);
    },
    onSaveFailed,
    onNavigatedAway: () => {
      frame = null;
      showNotice(notices, { tone: "warning", text: t("pieceNavigated"), dismissible: false, actions: [{ label: t("reopen"), onClick: route }] });
    },
    onSubmit,
  });
  render();
}

// ---- the owner's read-only piece ------------------------------------------------------------

// The owner reads what a person sent: the same piece, closed and with observer, seeded only with that person's newest send
// that kept its storage (owner_piece). The owner never answers, saves or sends for anyone: no draft saver, no draft or
// dirty handler, no closed panel nor change request, no «la abrió»; a send the piece posts anyway (an old piece, or one
// that forges it) is answered rejected, and the server refuses it too. Without such a send there is nothing to open.
async function showOwnerPiece({ projectId, pieceId, memberId }, viewId) {
  state.view = "owner-piece";
  let frame = null;
  state.cleanup = () => { if (frame) { frame.destroy(); frame = null; } };
  setTitle(t("opening"));
  let layout = pieceLayout(t("opening"));

  let context;
  try {
    context = await loadOwnerPiece(supabase, projectId, pieceId, memberId);
  } catch (error) {
    if (viewId !== state.viewId) return;
    if (isAuthExpired(error)) return sessionEnded();
    layout.title.textContent = t("pieceLoadErrorTitle");
    setTitle(t("pieceLoadErrorTitle"));
    showNotice(layout.notices, { tone: "error", text: t("pieceLoadError"), actions: [{ label: t("retry"), onClick: route }], dismissible: false });
    return;
  }
  if (viewId !== state.viewId) return;
  if (!context || !context.response) {
    layout.title.textContent = t("pieceNotFoundTitle");
    setTitle(t("pieceNotFoundTitle"));
    showNotice(layout.notices, { tone: "info", text: t("pieceNotFound"), dismissible: false });
    return;
  }

  const { piece, project, member, response } = context;
  setLanguage((project && project.language) || piece.language || browserLanguage);
  const pieceTitle = piece.title || t("untitled");
  setTitle(pieceTitle);
  const projectName = project && (project.name || project.slug);
  layout = pieceLayout(pieceTitle, projectName
    ? { href: projectHref(projectId), text: projectName, label: t("backTo", { name: projectName }) }
    : homeBack());
  const date = formatDate(state.lang, response.submitted_at);
  layout.status.textContent = member.display_name ? t("ownerSentBy", { name: member.display_name, date }) : t("ownerSentByNoName", { date });
  const follow = followPiece(() => (frame ? frame.iframe : null));
  frame = mountPiece({
    container: layout.main, html: piece.html, kind: piece.kind, storage: response.storage, title: pieceTitle,
    onHeight: follow.onHeight, onScroll: follow.onScroll,
    // reviewerName exactly as loadPiece gives it to the person: a piece keys what it stores by it.
    host: { reviewerName: member.display_name, closed: "received", sentAt: response.submitted_at, observer: true },
    onSubmit: ({ requestId }) => { if (frame) frame.respond(requestId, { ok: false, error: "rejected" }); },
    onNavigatedAway: () => {
      frame = null;
      showNotice(layout.notices, { tone: "warning", text: t("pieceNavigated"), dismissible: false, actions: [{ label: t("reopen"), onClick: route }] });
    },
  });
}

// ---- boot -----------------------------------------------------------------------------------

window.addEventListener("hashchange", route);
window.addEventListener("online", () => { for (const saver of state.savers.values()) saver.retryNow(); });
window.addEventListener("beforeunload", (event) => {
  if (hasUnsavedDrafts()) { event.preventDefault(); event.returnValue = ""; }
});

supabase.auth.onAuthStateChange((event, session) => {
  const hadSession = Boolean(state.session);
  state.session = session;
  // Defer: supabase-js advises against calling it again from inside this callback.
  if (event === "SIGNED_OUT" && hadSession && !state.signingOut) setTimeout(sessionEnded, 0);
  else if (event === "SIGNED_IN" && !hadSession) setTimeout(() => { if (state.view === "sign-in") route(); }, 0);
});

// The module graph (supabase-js included) loaded: the boot fallback in index.html can stand down.
document.documentElement.dataset.ready = "true";
const [{ data }] = await Promise.all([supabase.auth.getSession(), loadLogo()]);
state.session = data.session;
route();
