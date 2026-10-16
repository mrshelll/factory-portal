// Browser checks for the portal and the bridge. Dev-only; nothing here is served to users.
//
//   node tests/browser/run-checks.mjs --questions <piece.html> [--flow <piece.html>] [--out <dir>]
//
// Starts `python3 -m http.server` on the repo, drives system Chrome headless with playwright-core
// and prints one PASS/FAIL line per check. playwright-core is loaded from PLAYWRIGHT_CORE_DIR, or
// from the software factory cache (~/.cache/fabrica-software/playwright-core@1.63.0). Chrome is
// taken from CHROME_PATH or the default macOS / Linux locations.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []),
);
const outDir = resolve(args.out || join(os.tmpdir(), "factory-portal-checks"));
mkdirSync(outDir, { recursive: true });

function loadPlaywright() {
  const dir = process.env.PLAYWRIGHT_CORE_DIR || join(os.homedir(), ".cache", "fabrica-software", "playwright-core@1.63.0");
  return createRequire(join(dir, "noop.js"))("playwright-core");
}
function chromePath() {
  const candidates = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome not found; set CHROME_PATH");
  return found;
}

async function startServer() {
  for (let attempt = 0; attempt < 10; attempt++) {
    const port = 8700 + Math.floor(Math.random() * 200);
    const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const ok = await new Promise((done) => {
      const timer = setTimeout(() => done(true), 800);
      child.once("exit", () => { clearTimeout(timer); done(false); });
    });
    if (ok) return { child, base: `http://127.0.0.1:${port}` };
  }
  throw new Error("could not start http.server");
}

const results = [];
function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(50);
  }
  return null;
}

async function portalChecks(browser, base) {
  for (const width of [320, 360, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 800 }, locale: "es-CO" });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("#email", { timeout: 10000 }).catch(() => {});
    const info = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      h1: document.querySelector("h1") && document.querySelector("h1").textContent,
      lang: document.documentElement.lang,
      email: Boolean(document.querySelector("#email[type=email][autocomplete=email]")),
    }));
    await page.screenshot({ path: join(outDir, `login-${width}.png`), fullPage: true });
    check(`login ${width}px: no console errors`, errors.length === 0, errors.join(" | "));
    check(`login ${width}px: no horizontal scroll`, info.scrollWidth <= info.innerWidth, `${info.scrollWidth} <= ${info.innerWidth}`);
    if (width === 360) {
      const violations = await axeViolations(page);
      if (violations) check("login: axe has no violations", violations.length === 0, violations.join(", "));
      check("login: h1 and email field rendered", info.h1 && info.email, info.h1);
      check("login: browser language es-CO picks es", info.lang === "es", info.lang);
    }
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: "en-US" });
  const page = await context.newPage();
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector("#email", { timeout: 10000 }).catch(() => {});
  check("login: browser language en-US picks en", (await page.evaluate(() => document.documentElement.lang)) === "en");
  // Empty email shows a field error, not a network call.
  await page.click("button[type=submit]");
  const fieldError = await page.evaluate(() => {
    const input = document.querySelector("#email");
    const describedBy = input.getAttribute("aria-describedby") || "";
    return input.getAttribute("aria-invalid") === "true" && describedBy.split(" ").some((id) => document.getElementById(id)?.textContent.trim());
  });
  check("login: empty email shows an inline error", fieldError);
  await context.close();
}

async function harnessContext(browser, base) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/tests/harness.html`, { waitUntil: "load" });
  return { context, page, errors };
}
const pieceFrame = (page) => page.frames().find((f) => f !== page.mainFrame());
const events = (page, type) => page.evaluate((t) => window.harness.events.filter((e) => e.type === t).map((e) => e.detail), type);

async function questionsChecks(browser, base, html) {
  const { context, page, errors } = await harnessContext(browser, base);
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  let dialogAnswer = "dismiss";
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); dialogAnswer === "accept" ? d.accept() : d.dismiss(); });

  await page.evaluate((h) => window.harness.mount(h, "questions", {}), html);
  const ready = await waitFor(async () => (await events(page, "ready"))[0]);
  check("questions: bridge ready", ready);
  check("questions: localStorage replaced by the shim (defineProperty)", ready && ready.persistence === true);
  check("questions: piece exposes its export (canSubmit)", ready && ready.canSubmit === true);
  const frame = pieceFrame(page);
  const shim = await frame.evaluate(() => ({
    same: typeof localStorage.getItem === "function",
    keys: Object.keys(localStorage),
    session: (() => { sessionStorage.setItem("s", "1"); return sessionStorage.getItem("s"); })(),
  }));
  check("questions: shim is a working Storage", shim.same && shim.session === "1", JSON.stringify(shim.keys));

  await page.evaluate(() => window.harness.mount.length); // keep page alive
  await frame.evaluate(() => {
    responder("Q-001", "si");
    responder("Q-003", "cambio");
    escribir("Q-003", "texto", "Prefiero </script> los lunes");
  });
  const drafts = await waitFor(async () => {
    const d = await events(page, "draft");
    const key = "preguntas-portal-test-ronda-1-ana-perez";
    const lastDraft = d.at(-1);
    return lastDraft && lastDraft[key] && JSON.parse(lastDraft[key]).respuestas["Q-003"]?.texto ? d : null;
  }, 4000);
  check("questions: changes reach the parent as factory:draft (debounced)", drafts && drafts.length <= 2, drafts ? `${drafts.length} draft message(s)` : "none");
  const storage = drafts ? drafts.at(-1) : {};

  // Reopen with the saved draft: the piece must restore its state from the shim.
  await page.evaluate(([h, s]) => window.harness.mount(h, "questions", s), [html, storage]);
  await waitFor(async () => (await events(page, "ready"))[0]);
  const restored = await pieceFrame(page).evaluate(() => ({ n: respondidas(), text: ST.respuestas["Q-003"].texto }));
  check("questions: reopening with the draft restores answers", restored.n === 2 && restored.text === "Prefiero </script> los lunes", JSON.stringify(restored));

  // Parent ignores messages that do not come from the iframe.
  await page.evaluate(() => window.postMessage({ type: "factory:submit", requestId: "fake", payload: { formato: "respuestas-fabrica/1", respuestas: [] } }, "*"));
  await sleep(200);
  check("questions: parent ignores messages from other sources", (await events(page, "submit")).length === 0);

  // Send: first cancel the "only the answered ones?" confirm, then accept it.
  dialogAnswer = "dismiss";
  await page.evaluate(() => window.harness.submit());
  const cancelled = await waitFor(async () => (await events(page, "submit-error"))[0]);
  check("questions: cancelling the confirm sends nothing", cancelled && cancelled.reason === "cancelled", JSON.stringify(cancelled));
  dialogAnswer = "accept";
  await page.evaluate(() => window.harness.submit());
  const submitted = await waitFor(async () => (await events(page, "submit"))[0]);
  const p = submitted && submitted.payload;
  check("questions: factory:submit carries respuestas-fabrica/1", p && p.formato === "respuestas-fabrica/1" && p.proyecto === "portal-test" && p.ronda === 1 && p.para_slug === "ana-perez");
  check("questions: payload has the 2 answers and enviada_en", p && p.respuestas.length === 2 && p.enviada_en &&
    p.respuestas.find((r) => r.id === "Q-003").texto === "Prefiero </script> los lunes", p ? JSON.stringify(p.respuestas) : "");
  check("questions: capture suppressed the file download", downloads === 0, `${downloads} download(s)`);
  check("questions: the piece's own confirm was shown", dialogs.length === 2, JSON.stringify(dialogs));

  // Backup: the piece's own "Descargar el archivo" still downloads the same JSON.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
    pieceFrame(page).click("text=Descargar el archivo"),
  ]);
  let same = false;
  if (download) {
    const file = join(outDir, download.suggestedFilename());
    await download.saveAs(file);
    same = JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) === JSON.stringify(p);
  }
  check("questions: in-piece download still works (fallback)", download && download.suggestedFilename() === "respuestas-portal-test-ronda-1-ana-perez.json", download ? download.suggestedFilename() : "no download");
  check("questions: downloaded JSON equals the submitted payload", same);
  await page.screenshot({ path: join(outDir, "harness-questions-360.png") });

  // Nothing answered yet: nothing to send.
  await page.evaluate((h) => window.harness.mount(h, "questions", {}), html);
  await waitFor(async () => (await events(page, "ready"))[0]);
  await page.evaluate(() => window.harness.submit());
  const empty = await waitFor(async () => (await events(page, "submit-error"))[0]);
  check("questions: no answers -> submit-error empty", empty && empty.reason === "empty", JSON.stringify(empty));

  // Flush on demand returns the pending draft before the debounce.
  await pieceFrame(page).evaluate(() => responder("Q-002", "si"));
  const flushed = await page.evaluate(() => window.harness.flush(1000));
  const afterFlush = await events(page, "draft");
  check("questions: flush sends the pending draft immediately", flushed === true && afterFlush.length >= 1);

  // A change is announced at once (no content), before the 800 ms debounced draft.
  const before = { dirty: (await events(page, "dirty")).length, drafts: (await events(page, "draft")).length };
  await pieceFrame(page).evaluate(() => responder("Q-004", "si"));
  await sleep(150);
  const soon = { dirty: (await events(page, "dirty")).length, drafts: (await events(page, "draft")).length };
  check("questions: factory:dirty arrives before the debounced draft", soon.dirty === before.dirty + 1 && soon.drafts === before.drafts, JSON.stringify({ before, soon }));

  // If the iframe navigates away, the new page cannot speak for the piece.
  await context.route("**/__forged__", (route) => route.fulfill({ contentType: "text/html", body:
    `<script>
      parent.postMessage({ type: "factory:submit", requestId: "req-1", nonce: "guess",
        payload: { formato: "respuestas-fabrica/1", proyecto: "x", respuestas: [] } }, "*");
      parent.postMessage({ type: "factory:draft", storage: { forged: "yes" } }, "*");
    </script>` }));
  await pieceFrame(page).evaluate((url) => { location.href = url; }, `${base}/__forged__`);
  const navigated = await waitFor(async () => (await events(page, "navigated")).length > 0, 5000);
  await sleep(300);
  const forgedSubmit = (await events(page, "submit")).length;
  const forgedDraft = (await events(page, "draft")).some((d) => d.forged);
  const rejected = (await events(page, "rejected")).length;
  const iframeGone = await page.evaluate(() => !document.querySelector("iframe.piece-frame"));
  check("questions: navigating away destroys the iframe and notifies", navigated && iframeGone);
  check("questions: forged factory:submit/draft without the nonce are rejected", forgedSubmit === 0 && !forgedDraft,
    `submits ${forgedSubmit}, forged draft ${forgedDraft}, rejected ${rejected}`);

  check("questions: no page errors in harness", errors.length === 0, errors.join(" | "));
  await context.close();
}

async function flowChecks(browser, base, html) {
  const { context, page, errors } = await harnessContext(browser, base);
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Ana Pérez") : d.accept()));
  await page.evaluate((h) => window.harness.mount(h, "flow_review", {}), html);
  const ready = await waitFor(async () => (await events(page, "ready"))[0]);
  check("flow: bridge ready with persistence and canSubmit", ready && ready.persistence && ready.canSubmit, JSON.stringify(ready));
  await page.evaluate(() => window.harness.submit());
  const empty = await waitFor(async () => (await events(page, "submit-error"))[0]);
  check("flow: nothing reviewed -> submit-error empty", empty && empty.reason === "empty", JSON.stringify(empty));
  await pieceFrame(page).evaluate(() => { openFlow(IDS[0]); setVerdict("ok"); });
  await page.evaluate(() => window.harness.submit());
  const submitted = await waitFor(async () => (await events(page, "submit"))[0]);
  const p = submitted && submitted.payload;
  check("flow: factory:submit carries the review JSON", p && p.artefacto === "ux-flows.md" && p.proyecto === "portal-test" && p.revisor === "Ana Pérez" &&
    p.flujos.some((f) => f.veredicto === "ok"), p ? JSON.stringify(p.resumen) : "");
  check("flow: capture suppressed the file download", downloads === 0);
  const drafts = await waitFor(async () => {
    const d = await events(page, "draft");
    return d.length && Object.keys(d.at(-1)).some((k) => k.startsWith("recorrido-portal-test-ux-flows-v2::ana-perez")) ? d : null;
  }, 3000);
  check("flow: review progress reaches the parent as factory:draft", drafts);
  await page.screenshot({ path: join(outDir, "harness-flow-360.png") });
  check("flow: no page errors in harness", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---- the app against a mocked Supabase -----------------------------------------------------
// A fake (unsigned) session goes into localStorage and every Supabase request is answered by
// page.route, so home, piece, autosave and submit run end to end without a real account.

const SUPABASE_HOST = "lonzcppgdbsatwjgwozb.supabase.co";
const STORAGE_KEY = "sb-lonzcppgdbsatwjgwozb-auth-token";
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "ana@example.com" };
const IDS = {
  project: "22222222-2222-4222-8222-222222222222",
  member: "33333333-3333-4333-8333-333333333333",
  questions: "44444444-4444-4444-8444-444444444444",
  flow: "55555555-5555-4555-8555-555555555555",
};

function fakeSession() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, email: USER.email, exp: now + 3600, role: "authenticated", aud: "authenticated" })}.sig`;
  return { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "fake-refresh",
    user: { id: USER.id, email: USER.email, aud: "authenticated", role: "authenticated" } };
}

async function mockedContext(browser, { width = 360, locale = "en-US", backend }) {
  const context = await browser.newContext({ viewport: { width, height: 780 }, locale });
  await context.addInitScript(([key, value]) => {
    if (window.top !== window) return; // never touch the sandboxed piece
    try { if (!localStorage.getItem(key)) localStorage.setItem(key, value); } catch { /* ignore */ }
  }, [STORAGE_KEY, JSON.stringify(fakeSession())]);
  await context.route((url) => url.hostname === SUPABASE_HOST, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    backend.requests.push(`${request.method()} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith("/logout")) return backend.logoutFails ? route.abort("internetdisconnected") : route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/auth/v1/")) return json(fakeSession().user);
    const table = url.pathname.replace("/rest/v1/", "");
    const select = url.searchParams.get("select") || "";
    switch (table) {
      case "project_members": return json(backend.members);
      case "projects": return json(backend.projects);
      case "piece_assignments": {
        const eq = url.searchParams.get("piece_id");
        const rows = backend.assignments();
        return json(eq ? rows.filter((a) => `eq.${a.piece_id}` === eq) : rows);
      }
      case "pieces": {
        const eq = url.searchParams.get("id");
        if (select.includes("html")) return json(backend.pieces.filter((p) => `eq.${p.id}` === eq).map((p) => ({ ...p, html: backend.html[p.id] })));
        return json(backend.pieces);
      }
      case "piece_drafts": return json(backend.draft ? [{ storage: backend.draft, updated_at: new Date().toISOString() }] : []);
      case "piece_responses": return json(backend.submits.length ? [{ id: "r1", submitted_at: backend.submittedAt }] : []);
      case "rpc/save_draft": {
        if (backend.saveFails) return route.abort("internetdisconnected");
        const body = request.postDataJSON();
        backend.drafts.push(body);
        if (backend.saveDelayMs) await sleep(backend.saveDelayMs);
        backend.draft = body.p_storage; // the server copy changes only when the save completes
        return route.fulfill({ status: 204 });
      }
      case "rpc/submit_response":
        if (backend.submitFails) return json({ code: "P0001", message: "boom", details: null, hint: null }, 400);
        backend.submits.push(request.postDataJSON()); backend.submittedAt = new Date().toISOString();
        return json("66666666-6666-4666-8666-666666666666");
      default: return json({ message: `unexpected ${table}` }, 404);
    }
  });
  return context;
}

function newBackend(html, flowHtml) {
  const backend = {
    requests: [], drafts: [], submits: [], draft: null, submittedAt: null, submitFails: false,
    saveFails: false, saveDelayMs: 0, logoutFails: false,
    members: [{ id: IDS.member, project_id: IDS.project, email: USER.email, user_id: USER.id, role: "client" }],
    projects: [{ id: IDS.project, slug: "portal-test", name: "Portal de prueba", language: "es" }],
    pieces: [
      { id: IDS.questions, project_id: IDS.project, kind: "questions", title: "Preguntas · ronda 1", revision: 1, language: "es", created_at: "2026-10-16T15:00:00Z" },
      { id: IDS.flow, project_id: IDS.project, kind: "flow_review", title: "Recorrido de flujos v2", revision: 2, language: "es", created_at: "2026-10-10T15:00:00Z" },
    ],
    html: { [IDS.questions]: html, [IDS.flow]: flowHtml || "<!doctype html><title>x</title>" },
    assignments() {
      return [
        { piece_id: IDS.questions, member_id: IDS.member, status: backend.submits.length ? "submitted" : backend.draft ? "in_progress" : "pending", assigned_at: "2026-10-16T15:00:00Z", updated_at: "2026-10-16T15:00:00Z" },
        { piece_id: IDS.flow, member_id: IDS.member, status: "submitted", assigned_at: "2026-10-10T15:00:00Z", updated_at: "2026-10-12T15:00:00Z" },
      ];
    },
  };
  return backend;
}

const AXE = join(os.homedir(), ".cache", "fabrica-software", "axe-core@4.13.0", "node_modules", "axe-core", "axe.min.js");
async function axeViolations(page) {
  if (!existsSync(AXE)) return null;
  await page.addScriptTag({ content: readFileSync(AXE, "utf8") });
  return page.evaluate(async () => {
    const r = await window.axe.run(document, { iframes: false, resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id}(${v.nodes.length})`);
  });
}
async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function mockedAppChecks(browser, base, html, flowHtml) {
  const backend = newBackend(html, flowHtml);
  const context = await mockedContext(browser, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("dialog", (d) => d.accept());
  let downloads = 0;
  page.on("download", () => { downloads += 1; });

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
  const home = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    h1: document.querySelector("h1")?.textContent,
    rows: [...document.querySelectorAll(".row")].map((r) => r.textContent),
  }));
  check("app: home lists the assigned pieces", home.rows.length === 2, JSON.stringify(home.rows));
  check("app: project language (es) wins over browser (en-US)", home.lang === "es" && home.h1 === "Lo que te compartimos", `${home.lang} · ${home.h1}`);
  check("app: statuses in words", home.rows[0].includes("Por empezar") && home.rows[1].includes("Enviada"));
  check("app: list query never asks for pieces.html",
    backend.requests.filter((r) => r.includes("/rest/v1/pieces")).every((r) => !decodeURIComponent(r).includes("html")));
  check("app: home 360px no horizontal scroll", await noHorizontalScroll(page));
  await page.screenshot({ path: join(outDir, "home-360.png"), fullPage: true });
  const homeAxe = await axeViolations(page);
  if (homeAxe) check("app: axe on home has no violations", homeAxe.length === 0, homeAxe.join(", "));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: join(outDir, "home-1440.png"), fullPage: true });
  await page.setViewportSize({ width: 360, height: 780 });

  // Open the questions piece, answer, autosave.
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  await page.waitForSelector("iframe.piece-frame", { timeout: 10000 });
  const pieceRequests = backend.requests.filter((r) => r.includes("/rest/v1/pieces") && decodeURIComponent(r).includes("html"));
  check("app: html fetched only when the piece opens", pieceRequests.length === 1, pieceRequests.join(" | "));
  const sandbox = await page.getAttribute("iframe.piece-frame", "sandbox");
  check("app: iframe sandbox has no allow-same-origin", sandbox === "allow-scripts allow-downloads allow-modals allow-forms", sandbox);
  const frame = await waitFor(async () => { const f = pieceFrame(page); return f && (await f.evaluate(() => typeof responder === "function").catch(() => false)) ? f : null; });
  await frame.evaluate(() => { responder("Q-001", "si"); responder("Q-002", "no_se"); escribir("Q-002", "quien", "Luis"); });
  const saved = await waitFor(async () => backend.drafts.length && (await page.textContent(".piece-status")).includes("Guardado"), 5000);
  check("app: autosave calls save_draft and shows «Guardado»", saved, `${backend.drafts.length} save_draft call(s)`);
  const lastDraft = backend.drafts.at(-1);
  check("app: save_draft carries the piece localStorage", lastDraft && lastDraft.p_piece_id === IDS.questions &&
    JSON.parse(lastDraft.p_storage["preguntas-portal-test-ronda-1-ana-perez"]).respuestas["Q-002"].quien === "Luis");
  check("app: piece 360px no horizontal scroll", await noHorizontalScroll(page));
  const pieceAxe = await axeViolations(page);
  if (pieceAxe) check("app: axe on the piece screen (portal chrome) has no violations", pieceAxe.length === 0, pieceAxe.join(", "));

  // Send.
  await page.click("[data-rol=accion-principal]");
  const sent = await waitFor(async () => backend.submits.length && (await page.textContent(".piece-status")).includes("Enviada el"), 8000);
  const body = backend.submits[0];
  check("app: Enviar calls submit_response with respuestas-fabrica/1", sent && body.p_piece_id === IDS.questions && body.p_payload.formato === "respuestas-fabrica/1" && body.p_payload.respuestas.length === 2,
    body ? JSON.stringify(body.p_payload.respuestas.map((r) => r.tipo)) : "no call");
  check("app: the change confirms (button «Enviar otra vez», status «Enviada el…»)", (await page.textContent("[data-rol=accion-principal]")) === "Enviar otra vez");
  check("app: submit did not trigger a download", downloads === 0);
  await page.screenshot({ path: join(outDir, "piece-360.png") });

  check("app: no console errors up to here", errors.length === 0, errors.join(" | "));
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // A failing submit explains itself in the page and keeps the answers (the 400 below is on purpose).
  backend.submitFails = true;
  await page.click("[data-rol=accion-principal]");
  const notice = await waitFor(async () => page.evaluate(() => {
    const n = document.querySelector("[data-rol=avisos] .notice[role=alert]");
    if (!n) return null;
    const pos = getComputedStyle(n).position;
    return { text: n.textContent, inFrame: Boolean(n.closest("[data-rol=marco]")), pos };
  }), 8000);
  check("app: failed submit shows an in-page alert (not floating)", notice && notice.inFrame && notice.pos === "static" && notice.text.includes("No se pudo enviar"), notice ? notice.text : "none");
  await page.screenshot({ path: join(outDir, "piece-error-360.png") });
  backend.submitFails = false;

  // Back home: the list reflects the new status; reopen restores from the server draft.
  await page.click(".back-link");
  await page.waitForSelector(".row-link", { timeout: 10000 });
  const rows = await page.$$eval(".row", (els) => els.map((e) => e.textContent));
  check("app: back home shows the piece as sent", rows.every((r) => r.includes("Enviada")), JSON.stringify(rows));
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  const reopened = await waitFor(async () => { const f = pieceFrame(page); return f && (await f.evaluate(() => typeof respondidas === "function" && respondidas()).catch(() => 0)); }, 8000);
  check("app: reopening restores the answers from piece_drafts", reopened === 2, String(reopened));

  // Reopen while the save is still in flight: the tab's newest copy must win over the old server copy.
  backend.saveDelayMs = 2500;
  const savesBefore = backend.drafts.length;
  await pieceFrame(page).evaluate(() => { responder("Q-004", "cambio"); escribir("Q-004", "texto", "carrera"); });
  await waitFor(async () => backend.drafts.length > savesBefore, 5000);
  await page.click(".back-link");
  await page.waitForSelector(`a[href="#/piece/${IDS.questions}"]`, { timeout: 10000 });
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  const raced = await waitFor(async () => {
    const f = pieceFrame(page);
    return f && (await f.evaluate(() => typeof ST === "object" && ST.respuestas["Q-004"] ? ST.respuestas["Q-004"].texto : null).catch(() => null));
  }, 10000);
  check("app: reopening during an in-flight save keeps the newest answers", raced === "carrera", String(raced));
  backend.saveDelayMs = 0;

  // Sign out offline with unsaved changes: ask in the page; confirming lands on a clean sign-in.
  backend.saveFails = true;
  backend.logoutFails = true;
  await pieceFrame(page).evaluate(() => responder("Q-001", "no_se"));
  await page.click(".back-link");
  await page.waitForSelector(".masthead .button--secondary", { timeout: 10000 });
  await page.click(".masthead .button--secondary");
  const ask = await waitFor(async () => page.evaluate(() => {
    const n = document.querySelector("[data-rol=avisos] .notice");
    return n && n.textContent.includes("se perderán") ? { h1: document.querySelector("h1").textContent, text: n.textContent } : null;
  }), 10000);
  check("app: sign-out with unsaved changes asks before losing them", ask && ask.h1 === "Lo que te compartimos", ask ? ask.text : "no notice");
  const stillSignedIn = await page.evaluate((k) => Boolean(localStorage.getItem(k)), STORAGE_KEY);
  check("app: nothing is discarded until the person confirms", stillSignedIn && !(await page.$("#email")));
  await page.click("text=Salir y perder los cambios");
  const signedOut = await waitFor(async () => page.evaluate((k) => {
    const notice = document.querySelector("[data-rol=avisos] .notice");
    return document.querySelector("#email") ? { session: localStorage.getItem(k), notice: notice && notice.textContent } : null;
  }, STORAGE_KEY), 10000);
  check("app: offline sign-out still lands on a clean sign-in screen", signedOut && !signedOut.session && signedOut.notice && signedOut.notice.includes("You signed out on this device"), // sign-in follows the browser (en-US here)
    signedOut ? JSON.stringify(signedOut) : "no sign-in screen");

  check("app: no page errors after the forced failure", pageErrors.length === 0, pageErrors.join(" | "));
  await context.close();

  // Empty state: signed in, nothing assigned.
  const emptyBackend = newBackend(html);
  emptyBackend.members = [];
  const emptyContext = await mockedContext(browser, { backend: emptyBackend, width: 320, locale: "es-CO" });
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto(`${base}/`, { waitUntil: "networkidle" });
  await emptyPage.waitForSelector(".empty", { timeout: 10000 }).catch(() => {});
  const empty = await emptyPage.evaluate(() => ({
    title: document.querySelector(".empty h2")?.textContent,
    action: document.querySelector(".empty [data-rol=accion-principal]")?.textContent,
  }));
  check("app: empty state explains and offers another email", empty.title === "Aquí verás lo que te compartan" && empty.action === "Entrar con otro correo", JSON.stringify(empty));
  check("app: empty state 320px no horizontal scroll", await noHorizontalScroll(emptyPage));
  await emptyPage.screenshot({ path: join(outDir, "home-empty-320.png"), fullPage: true });
  await emptyContext.close();
}

const { chromium } = loadPlaywright();
const { child, base } = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
try {
  if (!args["skip-portal"]) await portalChecks(browser, base);
  if (args.questions) await questionsChecks(browser, base, readFileSync(args.questions, "utf8"));
  if (args.flow) await flowChecks(browser, base, readFileSync(args.flow, "utf8"));
  if (args.questions) await mockedAppChecks(browser, base, readFileSync(args.questions, "utf8"), args.flow ? readFileSync(args.flow, "utf8") : null);
} finally {
  await browser.close();
  child.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${outDir}`);
process.exit(failed ? 1 : 0);
