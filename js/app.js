// Portal entry point: session, hash router and the three screens (sign in, home, piece).

import { supabase } from "./supabase-client.js";
import { EMAIL_OTP_LENGTH } from "../config.js";
import { h, replaceChildren } from "./dom.js";
import { translate, pickLanguage, formatDate } from "./i18n.js";
import { classifyAuthError, retryAfterSeconds, isNetworkError } from "./auth-errors.js";
import { loadSharedWithMe, loadPiece, saveDraft, submitResponse, isAuthExpired } from "./api.js";
import { createDraftSaver, trySaveAll } from "./host.js";
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

const state = {
  session: null,
  lang: browserLanguage,
  view: "boot",
  viewId: 0,
  cleanup: null,
  signingOut: false,
  savers: new Map(),          // pieceId -> draft saver (outlives the piece screen)
  localDrafts: new Map(),     // pieceId -> newest storage seen in this tab
  statusListeners: new Map(), // pieceId -> save status callback of the open piece screen
};

const t = (key, params) => translate(state.lang, key, params);
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

// One frame for every screen: masthead, then inside <main> the title band, the notice zone and
// the body.
function frameLayout({ title, meta = [], headerActions = [] }) {
  const notices = h("div", { class: "notices", "data-rol": "avisos" });
  const body = h("div", { class: "body", "data-rol": "cuerpo" });
  const live = visuallyHiddenStatus();
  replaceChildren(root, h("div", { class: "frame", "data-rol": "marco" },
    h("header", { class: "masthead" },
      h("p", { class: "brand", "data-rol": "marca-producto" }, t("brand")),
      headerActions.length ? h("div", { class: "masthead-actions" }, headerActions) : null),
    h("main", { id: "main" },
      h("div", { class: "page-head", "data-rol": "cabecera" },
        h("h1", {}, title),
        meta.filter(Boolean).map((line) => h("p", { class: "page-meta" }, line))),
      notices, body, live)));
  return { notices, body, live };
}

// One notice at a time, in the page, until dismissed or the screen changes (no floating toasts).
function showNotice(container, { tone = "info", text, actions = [], dismissible = true }) {
  const notice = h("div", { class: `notice notice--${tone}`, role: tone === "error" ? "alert" : "status" },
    h("p", {}, text));
  const buttons = actions.map((a) => h("button", { type: "button", class: "link-button", onclick: a.onClick }, a.label));
  if (dismissible) buttons.push(h("button", { type: "button", class: "link-button", onclick: () => notice.remove() }, t("dismiss")));
  if (buttons.length) notice.append(h("div", { class: "notice-actions" }, buttons));
  replaceChildren(container, notice);
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
    h("ol", { class: "steps" }, h("li", {}, t("step1")), h("li", {}, t("step2", { length: EMAIL_OTP_LENGTH })), h("li", {}, t("step3"))));
}

// The sign-in screens keep the same composition: the form, then how it works.
function signInBody(body, form) {
  body.append(h("div", { class: "split" }, h("div", { class: "section" }, form), stepsSection()));
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

  signInBody(body, h("form", { class: "form", "data-medida": "formulario", novalidate: true, onsubmit: verify },
    h("div", { class: "field" }, h("label", { for: "code" }, t("codeLabel", { length: EMAIL_OTP_LENGTH })), input, error),
    button,
    h("div", { class: "secondary-actions" }, resendStatus, resendButton, otherEmail)));
  input.focus();
}

// ---- session end ----------------------------------------------------------------------------

function disposeSavers() {
  for (const saver of state.savers.values()) saver.dispose();
  state.savers.clear();
  state.localDrafts.clear();
}

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
  clearPendingSignIn();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  state.viewId += 1;
  if (state.cleanup) { const cleanup = state.cleanup; state.cleanup = null; cleanup(); }
  const offline = error && isNetworkError(error);
  showSignIn({ notice: offline ? () => ({ tone: "info", text: t("signedOutOffline") }) : undefined });
}

function sessionEnded() {
  state.session = null;
  disposeSavers();
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  state.viewId += 1;
  if (state.cleanup) { const cleanup = state.cleanup; state.cleanup = null; cleanup(); }
  showSignIn({ notice: () => ({ tone: "info", text: t("sessionExpired") }) });
}

// ---- home -----------------------------------------------------------------------------------

const STATUS_KEYS = { pending: "statusPending", in_progress: "statusInProgress", submitted: "statusSubmitted" };
const KIND_KEYS = { questions: "kindQuestions", flow_review: "kindFlowReview", demo_review: "kindDemoReview" };

function pieceRow({ piece, assignment }) {
  const status = STATUS_KEYS[assignment.status] ? assignment.status : "pending";
  const dateKey = status === "submitted" ? "sentOn" : status === "in_progress" ? "changedOn" : "sharedOn";
  const iso = status === "pending" ? assignment.assigned_at : assignment.updated_at || assignment.assigned_at;
  const date = formatDate(state.lang, iso);
  const kind = t(KIND_KEYS[piece.kind] || "kindQuestions");
  return h("li", { class: "row" },
    h("a", { class: "row-link", href: `#/piece/${piece.id}` },
      h("span", { class: "row-main" },
        h("span", { class: "row-title" }, piece.title || t("untitled")),
        h("span", { class: "row-meta" }, date ? `${kind} · ${t(dateKey, { date })}` : kind)),
      h("span", { class: `status status--${status}` },
        h("span", { class: "status-dot", "aria-hidden": "true" }), t(STATUS_KEYS[status]))));
}

const sortTime = (item) => Date.parse(item.assignment.updated_at || item.assignment.assigned_at) || 0;

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
  const toAnswer = items.filter((i) => i.assignment.status !== "submitted").length;
  const count = !items.length ? null : toAnswer === 0 ? t("countAllSent") : toAnswer === 1 ? t("countOneToAnswer") : t("countToAnswer", { count: toAnswer });
  layout = frameLayout({ title: t("homeTitle"), meta: [count, t("signedInAs", { email: user.email })], headerActions: [signOutButton()] });
  if ([...state.savers.values()].some((s) => s.hasUnsaved())) showNotice(layout.notices, { tone: "warning", text: t("unsavedElsewhere") });

  if (!items.length) {
    layout.body.append(h("section", { class: "section empty", "aria-labelledby": "empty-title" },
      h("h2", { id: "empty-title" }, t("emptyTitle")),
      h("p", {}, t("emptyBody", { email: user.email })),
      h("div", { class: "actions" },
        h("button", { type: "button", class: "button button--primary", "data-rol": "accion-principal", onclick: () => signOut(layout.notices) }, t("emptyAction")),
        h("button", { type: "button", class: "link-button", onclick: route }, t("refresh")))));
    return;
  }
  for (const { project, items: projectItems } of groups) {
    const sorted = [...projectItems].sort((a, b) =>
      (a.assignment.status === "submitted") - (b.assignment.status === "submitted") || sortTime(b) - sortTime(a));
    const headingId = `project-${project.id}`;
    layout.body.append(h("section", { class: "section", "aria-labelledby": headingId },
      h("h2", { id: headingId }, project.name || project.slug),
      h("ul", { class: "rows" }, sorted.map(pieceRow))));
  }
}

// ---- piece ----------------------------------------------------------------------------------

function saverFor(pieceId) {
  if (!state.savers.has(pieceId)) {
    state.savers.set(pieceId, createDraftSaver({
      save: (storage) => saveDraft(supabase, pieceId, storage),
      onStatus: (status) => { const listener = state.statusListeners.get(pieceId); if (listener) listener(status); },
    }));
  }
  return state.savers.get(pieceId);
}

function pieceLayout(titleText) {
  const notices = h("div", { class: "notices", "data-rol": "avisos" });
  const title = h("h1", { class: "piece-title" }, titleText);
  const status = h("p", { class: "piece-status" });
  const main = h("main", { id: "main", class: "piece-main", "data-rol": "cuerpo" });
  const live = visuallyHiddenStatus();
  main.append(live);
  replaceChildren(root, h("div", { class: "piece-layout" },
    h("div", { class: "frame", "data-rol": "marco" },
      h("header", { class: "piece-bar", "data-rol": "cabecera" },
        h("a", { class: "back-link", href: "#/", "aria-label": t("backLabel") }, h("span", { "aria-hidden": "true" }, "←"), t("back")),
        h("div", { class: "piece-heading" }, title, status)),
      notices),
    main));
  return { notices, title, status, main, live };
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
  const { notices, status, main, live } = layout;

  const saver = saverFor(pieceId);
  let saveStatus = saver.hasUnsaved() ? "error" : "idle";
  let lastSubmittedAt = context.lastSubmittedAt;
  const handled = new Set();

  function render() {
    const parts = [];
    if (saveStatus !== "idle") parts.push(t({ saving: "saving", saved: "saved", error: "saveError" }[saveStatus]));
    if (lastSubmittedAt) parts.push(t("sentAt", { date: formatDate(state.lang, lastSubmittedAt, { withTime: true }) }));
    status.textContent = parts.join(" · ");
    status.hidden = !parts.length;
  }
  state.statusListeners.set(pieceId, (next) => {
    if (next === "error" && saveStatus !== "error") live.textContent = t("saveError");
    saveStatus = next;
    render();
  });

  // The newest storage this tab saw is never older than the server copy it sent, so it wins.
  const seed = state.localDrafts.has(pieceId) ? state.localDrafts.get(pieceId) : context.draftStorage;

  // The piece sent through globalThis.factorySubmit; it only says "sent" when this answers ok, and
  // this answers ok only after submit_response saved on the server.
  async function onSubmit({ requestId, payload }) {
    if (handled.has(requestId)) return;
    handled.add(requestId);
    const answeringFrame = frame;
    // Let the draft the bridge flushed just before the send land first.
    await Promise.race([saver.idle(), sleep(SUBMIT_SAVE_WAIT_MS)]);
    let result;
    try {
      await submitResponse(supabase, pieceId, payload);
      result = { ok: true };
      lastSubmittedAt = new Date().toISOString();
      clearNotice(notices);
      live.textContent = t("sentAt", { date: formatDate(state.lang, lastSubmittedAt, { withTime: true }) });
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
  }

  frame = mountPiece({
    container: main, html: piece.html, kind: piece.kind, storage: seed, title: pieceTitle,
    host: { reviewerName: context.memberDisplayName },
    onReady: (ready) => { if (!ready.persistence) showNotice(notices, { tone: "warning", text: t("noPersistence") }); },
    onDirty: () => saver.markPending(),
    onDraft: (storage) => { state.localDrafts.set(pieceId, storage); saver.push(storage); },
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
  if ([...state.savers.values()].some((s) => s.hasUnsaved())) { event.preventDefault(); event.returnValue = ""; }
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
const { data } = await supabase.auth.getSession();
state.session = data.session;
route();
