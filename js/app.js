// Portal entry point: session, hash router and the three screens (sign in, home, piece).

import { supabase } from "./supabase-client.js";
import { EMAIL_OTP_LENGTH } from "../config.js";
import { h, replaceChildren } from "./dom.js";
import { translate, pickLanguage, formatDate } from "./i18n.js";
import { classifyAuthError, retryAfterSeconds, isNetworkError } from "./auth-errors.js";
import { loadSharedWithMe, loadPiece, saveDraft, submitResponse, requestChange, isAuthExpired } from "./api.js";
import { seedFor, hasUnsentChanges, unsentReference, validRequestText, REQUEST_TEXT_MAX } from "./closure.js";
import { createDraftSaver, trySaveAll, sendNotInDraft } from "./host.js";
import { mountPiece } from "./piece-frame.js";

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
const PIECE_ROUTE = /^#\/piece\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
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
  return h(tag, { class: "masthead" },
    h("p", { class: "brand", "data-rol": "marca-producto" }, logo(), h("span", {}, t("brand"))),
    headerActions.length ? h("div", { class: "masthead-actions" }, headerActions) : null);
}

// One frame for every screen: masthead, then inside <main> the title band, the notice zone and
// the body. The frame's box is the .frame (the masthead's too); inside <main>, its data-rol="marco" holds
// the title band, the notices and the body, as the visual manual's anatomy puts them (marco.md).
function frameLayout({ title, meta = [], headerActions = [] }) {
  const notices = h("div", { class: "notices", "data-rol": "avisos" });
  const body = h("div", { class: "body", "data-rol": "cuerpo" });
  const live = visuallyHiddenStatus();
  replaceChildren(root, h("div", { class: "frame" },
    masthead(headerActions),
    h("main", { id: "main" },
      h("div", { "data-rol": "marco" },
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
  const match = PIECE_ROUTE.exec(location.hash);
  if (match) return showPiece(match[1].toLowerCase(), viewId);
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

// Signing out never drops unsaved drafts silently: it first tries to save them, and if that is not
// possible (offline) it asks in the page before discarding them.
async function signOut(notices) {
  if (state.signingOut) return;
  state.signingOut = true;
  const saved = await trySaveAll(state.savers.values(), SIGN_OUT_SAVE_MS);
  state.signingOut = false;
  if (!saved) {
    showNotice(notices, {
      tone: "warning", text: t("unsavedSignOut"), dismissible: false,
      actions: [
        { label: t("signOutAnyway"), onClick: finishSignOut },
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
// The base's status modifiers (brand/ninben-components.css): pending is the plain hollow dot.
const STATUS_CLASSES = { pending: "status", in_progress: "status status--active", submitted: "status status--done", received: "status status--done" };
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

async function showHome(viewId) {
  state.view = "home";
  const user = state.session.user;
  const signOutButton = () => h("button", { type: "button", class: "button button--secondary", onclick: () => signOut(layout.notices) }, t("signOut"));
  setTitle(t("homePageTitle"));
  let layout = frameLayout({ title: t("homeTitle"), meta: [t("signedInAs", { email: user.email })], headerActions: [signOutButton()] });
  layout.body.append(h("p", { class: "loading", role: "status" }, t("loadingList")));

  let groups;
  try {
    groups = await loadSharedWithMe(supabase, user);
  } catch (error) {
    if (viewId !== state.viewId) return;
    if (isAuthExpired(error)) return sessionEnded();
    replaceChildren(layout.body);
    showNotice(layout.notices, { tone: "error", text: t("loadError"), actions: [{ label: t("retry"), onClick: route }], dismissible: false });
    return;
  }
  if (viewId !== state.viewId) return;

  // Text follows the projects' language when they all share one; otherwise the browser's.
  const languages = [...new Set(groups.map((g) => pickLanguage(g.project.language)))];
  setLanguage(languages.length === 1 ? languages[0] : browserLanguage);
  setTitle(t("homePageTitle"));
  const items = groups.flatMap((g) => g.items);
  const toAnswer = items.filter((i) => !isDone(i)).length;
  const count = !items.length ? null : toAnswer === 0 ? t("countAllSent") : toAnswer === 1 ? t("countOneToAnswer") : t("countToAnswer", { count: toAnswer });
  layout = frameLayout({ title: t("homeTitle"), meta: [count, t("signedInAs", { email: user.email })], headerActions: [signOutButton()] });
  if ([...state.savers.values()].some((s) => s.hasUnsaved())) showNotice(layout.notices, { tone: "warning", text: t("unsavedElsewhere") });

  if (!items.length) {
    // An empty state (EST-01): its message, then its direct way out, the view's primary action, at the end of the block
    // (MAR-06).
    layout.body.append(h("section", { class: "section empty", "data-rol": "vacio", "aria-labelledby": "empty-title" },
      h("h2", { id: "empty-title" }, t("emptyTitle")),
      h("p", {}, t("emptyBody", { email: user.email })),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "button button--primary", "data-rol": "accion-principal", onclick: () => signOut(layout.notices) }, t("emptyAction")),
        h("button", { type: "button", class: "link-button", onclick: route }, t("refresh")))));
    return;
  }
  for (const { project, items: projectItems } of groups) {
    const sorted = [...projectItems].sort((a, b) =>
      isDone(a) - isDone(b) || sortTime(b) - sortTime(a));
    const headingId = `project-${project.id}`;
    layout.body.append(h("section", { class: "section", "aria-labelledby": headingId },
      h("h2", { id: headingId }, project.name || project.slug),
      h("ul", { class: "rows" }, sorted.map(pieceRow))));
  }
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

// The frame of the piece screen: the same masthead as every screen, then «Volver» and the title band
// on the same left edge, the notices, and the piece below (it drops its own brand bar in the portal).
function pieceLayout(titleText) {
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
          h("a", { class: "back-link", href: "#/", "aria-label": t("backLabel") }, h("span", { "aria-hidden": "true" }, "←"), t("back")),
          h("div", { class: "piece-heading", "data-rol": "cabecera" }, title, status))),
      pinned, notices),
    main));
  return { pinned, notices, title, status, main, live };
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
    ? [context.newerPieceId ? { label: t("openNewer"), href: `#/piece/${context.newerPieceId}` } : { label: t("openList"), href: "#/" }]
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
  layout = pieceLayout(pieceTitle);
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
      actions: [context.newerPieceId ? { label: t("openNewer"), href: `#/piece/${context.newerPieceId}` } : { label: t("openList"), href: "#/" }],
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
    try {
      const sent = await submitResponse(supabase, pieceId, payload, localDrafts.get(pieceId) || seed);
      result = { ok: true };
      // The piece was closed meanwhile: the server kept the send as a change request. The piece hears ok (nothing
      // was lost), and the piece opens again, closed, saying so.
      if (sent.late) lateSend = { userId: user.id, pieceId, requestId: sent.id };
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
    if (lateSend) {
      state.lateSend = lateSend;
      if (viewId === state.viewId) route();
    }
  }

  frame = mountPiece({
    container: main, html: piece.html, kind: piece.kind, storage: seed, title: pieceTitle,
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
