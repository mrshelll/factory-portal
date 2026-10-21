// Browser checks for the portal and the bridge. Dev-only; nothing here is served to users.
//
//   node tests/browser/run-checks.mjs --questions <piece.html> [--flow <piece.html>] [--demo <piece.html>] [--out <dir>]
//                                     [--factory <software factory repo>]
//
// Starts `python3 -m http.server` on the repo, drives system Chrome headless with playwright-core
// and prints one PASS/FAIL line per check. playwright-core is loaded from PLAYWRIGHT_CORE_DIR, or
// from the software factory cache (~/.cache/fabrica-software/playwright-core@1.63.0). Chrome is
// taken from CHROME_PATH or the default macOS / Linux locations.
//
// Screen snapshots: the sign-in screens (email step, code step) and home (with pieces, empty) are
// saved to <out>/screens/<screen>.html as the rendered DOM without scripts, next to a copy of css/ and
// brand/, so they look exactly as in the app. With --factory, each one goes through the factory's
// design-system/assets/verifica-pantalla.mjs (the visual manual's checks and axe) at 320, 768 and
// 1440 px, light and dark, and every run is one check. The JSON of each run is in <out>/screens/.

import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, value, i, all) => (value.startsWith("--") ? [...pairs, [value.slice(2), all[i + 1]]] : pairs), []),
);
const outDir = resolve(args.out || join(os.tmpdir(), "factory-portal-checks"));
mkdirSync(outDir, { recursive: true });
const screensDir = join(outDir, "screens");
rmSync(screensDir, { recursive: true, force: true }); // no stale snapshot from an earlier run
mkdirSync(screensDir, { recursive: true });
cpSync(join(root, "css"), join(screensDir, "css"), { recursive: true });
cpSync(join(root, "brand"), join(screensDir, "brand"), { recursive: true });
// Screen name -> visual manual pattern, filled as the snapshots are taken.
const screens = new Map();

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

// Saves the screen as it is now: the rendered DOM without scripts (nothing re-renders it), with the
// same relative links to css/ and brand/.
async function snapshot(page, name, pattern) {
  const html = await page.evaluate(() => {
    const doc = document.documentElement.cloneNode(true);
    for (const script of doc.querySelectorAll("script")) script.remove();
    return `<!doctype html>\n${doc.outerHTML}\n`;
  });
  writeFileSync(join(screensDir, `${name}.html`), html);
  screens.set(name, pattern);
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
      const brand = await page.evaluate(async () => {
        await document.fonts.ready;
        const mark = document.querySelector("[data-rol=marca-producto]");
        return {
          logo: Boolean(mark && mark.querySelector("svg path")),
          name: mark && mark.textContent,
          stroke: mark && mark.querySelector("svg") && getComputedStyle(mark.querySelector("svg")).stroke,
          signal: getComputedStyle(document.documentElement).getPropertyValue("--signal").trim(),
          inter: [...document.fonts].some((f) => f.family.replace(/"/g, "") === "Inter" && f.status === "loaded"),
          body: getComputedStyle(document.body).fontFamily.split(",")[0].replace(/"/g, ""),
        };
      });
      check("brand: the masthead shows the ninben logo and name", brand.logo && brand.name === "ninben", JSON.stringify(brand));
      check("brand: the logo stroke is the signal colour", brand.stroke === "rgb(65, 55, 255)" && brand.signal === "#4137FF", `${brand.stroke} · ${brand.signal}`);
      check("brand: Inter loads from brand/fonts and is the body font", brand.inter && brand.body === "Inter");
      await snapshot(page, "sign-in-email", "formulario");
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

  // The code step, as after asking for a code (the pending sign-in survives a reload).
  const codeContext = await browser.newContext({ viewport: { width: 360, height: 800 }, locale: "es-CO" });
  await codeContext.addInitScript((email) => {
    localStorage.setItem("factory-portal.pending-sign-in", JSON.stringify({ email, sentAt: Date.now() }));
  }, USER.email);
  const codePage = await codeContext.newPage();
  await codePage.goto(`${base}/`, { waitUntil: "networkidle" });
  const code = await codePage.waitForSelector("#code", { timeout: 10000 }).catch(() => null);
  check("login: a pending sign-in opens on the code step", code);
  if (code) await snapshot(codePage, "sign-in-code", "formulario");
  const codeAxe = await axeViolations(codePage);
  if (codeAxe) check("login: axe on the code step has no violations", codeAxe.length === 0, codeAxe.join(", "));
  await codeContext.close();
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
const QUESTIONS_KEY = "preguntas-portal-test-ronda-1-ana-perez";
const QUESTIONS_SENT = "Listo, tus respuestas llegaron";
const FLOW_SENT = "Listo, tu revisión llegó";
const frameText = (frame) => frame.evaluate(() => document.body.innerText);
// The questions piece: go to "Revisa y envía" and tap its send button (the piece's own).
async function sendQuestions(frame) {
  await frame.evaluate(() => { if (view !== "review") showReview(); });
  await frame.click("button[data-rol=accion-principal]");
}

async function questionsChecks(browser, base, html) {
  const { context, page, errors } = await harnessContext(browser, base);
  let downloads = 0;
  page.on("download", () => { downloads += 1; });
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });

  await page.evaluate((h) => window.harness.mount(h, "questions", {}, { host: { reviewerName: "Ana Pérez" } }), html);
  const ready = await waitFor(async () => (await events(page, "ready"))[0]);
  check("questions: bridge ready", ready);
  check("questions: localStorage replaced by the shim (defineProperty)", ready && ready.persistence === true);
  const frame = pieceFrame(page);
  const host = await frame.evaluate(() => ({ host: globalThis.factoryHost, frozen: Object.isFrozen(globalThis.factoryHost), submit: typeof globalThis.factorySubmit }));
  check("questions: the piece sees factorySubmit and a frozen factoryHost", host.submit === "function" && host.frozen &&
    host.host.persistence === "server" && host.host.reviewerName === "Ana Pérez", JSON.stringify(host));
  const shim = await frame.evaluate(() => ({
    same: typeof localStorage.getItem === "function",
    keys: Object.keys(localStorage),
    session: (() => { sessionStorage.setItem("s", "1"); return sessionStorage.getItem("s"); })(),
  }));
  check("questions: shim is a working Storage", shim.same && shim.session === "1", JSON.stringify(shim.keys));

  await frame.evaluate(() => {
    responder("q-001", "si");
    responder("q-003", "cambio");
    escribir("q-003", "texto", "Prefiero </script> los lunes");
  });
  const drafts = await waitFor(async () => {
    const d = await events(page, "draft");
    const lastDraft = d.at(-1);
    return lastDraft && lastDraft[QUESTIONS_KEY] && JSON.parse(lastDraft[QUESTIONS_KEY]).respuestas["q-003"]?.texto ? d : null;
  }, 4000);
  check("questions: changes reach the parent as factory:draft (debounced)", drafts && drafts.length <= 3, drafts ? `${drafts.length} draft message(s)` : "none");
  const storage = drafts ? drafts.at(-1) : {};

  // Reopen with the saved draft: the piece must restore its state from the shim.
  await page.evaluate(([h, s]) => window.harness.mount(h, "questions", s), [html, storage]);
  await waitFor(async () => (await events(page, "ready"))[0]);
  const restored = await pieceFrame(page).evaluate(() => ({ n: respondidas(), text: ST.respuestas["q-003"].texto }));
  check("questions: reopening with the draft restores answers", restored.n === 2 && restored.text === "Prefiero </script> los lunes", JSON.stringify(restored));
  check("questions: without a reviewer name the piece gets null", (await pieceFrame(page).evaluate(() => factoryHost.reviewerName)) === null);

  // Parent ignores messages that do not come from the iframe.
  await page.evaluate(() => window.postMessage({ type: "factory:submit", requestId: "fake", payload: { formato: "respuestas-fabrica/1", respuestas: [] } }, "*"));
  await sleep(200);
  check("questions: parent ignores messages from other sources", (await events(page, "submit")).length === 0);

  // Send through the piece's own button: it waits for the portal's answer before saying "sent".
  await sendQuestions(pieceFrame(page));
  const submitted = await waitFor(async () => (await events(page, "submit"))[0]);
  const p = submitted && submitted.payload;
  check("questions: the piece's send posts factory:submit with respuestas-fabrica/1", p && p.formato === "respuestas-fabrica/1" && p.proyecto === "portal-test" && p.ronda === 1 && p.para_slug === "ana-perez");
  check("questions: payload has the 2 answers and enviada_en", p && p.respuestas.length === 2 && p.enviada_en &&
    p.respuestas.find((r) => r.id === "q-003").texto === "Prefiero </script> los lunes", p ? JSON.stringify(p.respuestas) : "");
  const sentDraft = (await events(page, "draft")).at(-1);
  check("questions: the draft with the send time was flushed before the send", sentDraft && JSON.parse(sentDraft[QUESTIONS_KEY]).enviada_en === p.enviada_en);
  await sleep(300);
  const waiting = await frameText(pieceFrame(page));
  check("questions: while the portal has not answered, the piece does not say it was sent", !waiting.includes(QUESTIONS_SENT) && waiting.includes("Enviando"));
  // A result without the nonce (posted by the parent page, but forged) is ignored.
  await page.evaluate((id) => window.harness.frameElement().contentWindow.postMessage({ type: "factory:submit-result", requestId: id, ok: true, nonce: "guess" }, "*"), submitted.requestId);
  await sleep(200);
  check("questions: a submit-result without the mount nonce is ignored", !(await frameText(pieceFrame(page))).includes(QUESTIONS_SENT));
  await page.evaluate((id) => window.harness.respond(id, { ok: true }), submitted.requestId);
  const sentText = await waitFor(async () => { const t = await frameText(pieceFrame(page)); return t.includes(QUESTIONS_SENT) ? t : null; }, 3000);
  check("questions: after the portal answers ok, the piece shows its sent screen", sentText);
  check("questions: sending did not trigger a download", downloads === 0, `${downloads} download(s)`);
  check("questions: no dialogs on the way", dialogs.length === 0, JSON.stringify(dialogs));

  // Plan B: the piece's own "Descargar una copia" really downloads (nothing is wrapped any more).
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
    pieceFrame(page).click("text=Descargar una copia"),
  ]);
  let same = false;
  if (download) {
    const file = join(outDir, download.suggestedFilename());
    await download.saveAs(file);
    same = JSON.stringify(JSON.parse(readFileSync(file, "utf8"))) === JSON.stringify(p);
  }
  check("questions: in-piece «Descargar una copia» downloads the file", download && download.suggestedFilename() === "respuestas-portal-test-ronda-1-ana-perez.json", download ? download.suggestedFilename() : "no download");
  check("questions: downloaded JSON equals the submitted payload", same);
  await page.screenshot({ path: join(outDir, "harness-questions-360.png") });

  // A second factorySubmit while one is in flight is the same promise; a payload of another kind is invalid.
  const calls = await pieceFrame(page).evaluate(async () => {
    const a = factorySubmit(resultado()); const b = factorySubmit(resultado());
    return { same: a === b };
  });
  await sleep(200);
  const pending = (await events(page, "submit")).at(-1);
  check("questions: a second factorySubmit in flight returns the same promise and posts once", calls.same && (await events(page, "submit")).length === 2);
  await page.evaluate((id) => window.harness.respond(id, { ok: true }), pending.requestId);
  const invalid = await pieceFrame(page).evaluate(() => factorySubmit({ artefacto: "ux-flows.md", flujos: [] }));
  check("questions: a payload of another kind resolves invalid and is not posted", invalid.ok === false && invalid.error === "invalid" && (await events(page, "submit")).length === 2, JSON.stringify(invalid));

  // (4) A send that never gets an answer: the bridge gives up with "timeout" (timeout shortened for the test).
  await page.evaluate(([h, s]) => window.harness.mount(h, "questions", s, { submitTimeoutMs: 1500 }), [html, storage]);
  await waitFor(async () => (await events(page, "ready"))[0]);
  await sendQuestions(pieceFrame(page));
  const lost = await waitFor(async () => (await events(page, "submit"))[0]);
  const timedOut = await waitFor(async () => pieceFrame(page).evaluate(() => (ST.submitError ? { error: ST.submitError, text: document.body.innerText } : null)), 4000);
  check("questions: no answer from the portal -> factorySubmit resolves timeout", lost && timedOut && timedOut.error === "timeout", timedOut ? timedOut.error : "still waiting");
  check("questions: after the timeout the piece shows its error, never its sent screen", timedOut && timedOut.text.includes("No se pudieron enviar") && !timedOut.text.includes(QUESTIONS_SENT));
  await page.evaluate((id) => window.harness.respond(id, { ok: true }), lost.requestId);
  await sleep(300);
  check("questions: a late answer after the timeout is ignored", !(await frameText(pieceFrame(page))).includes(QUESTIONS_SENT));

  // Flush on demand returns the pending draft before the debounce.
  await page.evaluate((h) => window.harness.mount(h, "questions", {}), html);
  await waitFor(async () => (await events(page, "ready"))[0]);
  await pieceFrame(page).evaluate(() => responder("q-002", "si"));
  const flushed = await page.evaluate(() => window.harness.flush(1000));
  const afterFlush = await events(page, "draft");
  check("questions: flush sends the pending draft immediately", flushed === true && afterFlush.length >= 1);

  // A change is announced at once (no content), before the 800 ms debounced draft.
  await sleep(1000);
  const before = { dirty: (await events(page, "dirty")).length, drafts: (await events(page, "draft")).length };
  await pieceFrame(page).evaluate(() => responder("q-004", "si"));
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
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.evaluate((h) => window.harness.mount(h, "flow_review", {}, { host: { reviewerName: "Ana Pérez" } }), html);
  const ready = await waitFor(async () => (await events(page, "ready"))[0]);
  check("flow: bridge ready with persistence", ready && ready.persistence, JSON.stringify(ready));
  check("flow: the piece sees factoryHost.reviewerName", (await pieceFrame(page).evaluate(() => factoryHost.reviewerName)) === "Ana Pérez");
  // Name the reviewer and finish one flow, as the piece does when the person walks it.
  await pieceFrame(page).evaluate(() => {
    usarRevisor("Ana Pérez");
    const st = fs(IDS[0]); st.veredicto = "ok"; st.estado = "ok"; save(); home();
  });
  const first = pieceFrame(page).evaluate(() => submitReview());
  const submitted = await waitFor(async () => (await events(page, "submit"))[0]);
  const p = submitted && submitted.payload;
  check("flow: the piece's send posts the review JSON", p && p.artefacto === "ux-flows.md" && p.revisor === "Ana Pérez" &&
    p.flujos.some((f) => f.veredicto === "ok"), p ? JSON.stringify(p.resumen) : "");
  // (2) The portal reports a network failure: the piece shows its error and never its sent screen.
  await page.evaluate((id) => window.harness.respond(id, { ok: false, error: "network" }), submitted.requestId);
  await first;
  const failed = await pieceFrame(page).evaluate(() => ({ error: ST.submitError, sent: ST.submittedAt || null, text: document.body.innerText }));
  check("flow: a failed send shows the piece's error, not its sent screen", failed.error === "network" && !failed.sent &&
    failed.text.includes("No se pudo enviar tu revisión") && !failed.text.includes(FLOW_SENT), JSON.stringify({ error: failed.error, sent: failed.sent }));
  const retry = pieceFrame(page).evaluate(() => submitReview());
  const again = await waitFor(async () => (await events(page, "submit"))[1]);
  await page.evaluate((id) => window.harness.respond(id, { ok: true }), again.requestId);
  await retry;
  const ok = await pieceFrame(page).evaluate(() => ({ sent: ST.submittedAt || null, text: document.body.innerText }));
  check("flow: the retry works and the piece shows its sent screen", again && ok.sent && ok.text.includes(FLOW_SENT));
  check("flow: sending did not trigger a download", downloads === 0);
  const drafts = await waitFor(async () => {
    const d = await events(page, "draft");
    return d.length && Object.keys(d.at(-1)).some((k) => k.startsWith(`recorrido-${p.proyecto}-ux-flows-v${p.version_revisada}::ana-perez`)) ? d : null;
  }, 3000);
  check("flow: review progress reaches the parent as factory:draft", drafts);
  check("flow: no dialogs on the way", dialogs.length === 0, JSON.stringify(dialogs));
  await page.screenshot({ path: join(outDir, "harness-flow-360.png") });
  check("flow: no page errors in harness", errors.length === 0, errors.join(" | "));
  await context.close();
}

// (5) The demo sheet opens the prototype with target="_blank": the sandbox lets it open a new tab,
// and that tab is a normal page (it escaped the sandbox).
async function demoChecks(browser, base, html) {
  const { context, page, errors } = await harnessContext(browser, base);
  await context.route("https://example.com/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>prototype</title><p>prototype</p>" }));
  await page.evaluate((h) => window.harness.mount(h, "demo_review", {}), html);
  const ready = await waitFor(async () => (await events(page, "ready"))[0]);
  check("demo: bridge ready with persistence", ready && ready.persistence, JSON.stringify(ready));
  const link = await waitFor(async () => {
    const f = pieceFrame(page);
    return f && (await f.$("a[target=_blank]"));
  }, 5000);
  const href = link ? await link.getAttribute("href") : null;
  const [popup] = await Promise.all([
    context.waitForEvent("page", { timeout: 5000 }).catch(() => null),
    link ? link.click() : Promise.resolve(),
  ]);
  if (popup) await popup.waitForLoadState("load").catch(() => {});
  const popupInfo = popup ? await popup.evaluate(() => {
    let storage = false;
    try { localStorage.setItem("probe", "1"); storage = localStorage.getItem("probe") === "1"; } catch { storage = false; }
    return { url: location.href, storage, opener: window.opener === null };
  }).catch((e) => ({ error: String(e) })) : null;
  check("demo: a target=_blank link opens a new tab", popup && popupInfo && popupInfo.url === href, popupInfo ? JSON.stringify(popupInfo) : "no new tab");
  check("demo: the new tab is not sandboxed and has no opener", popupInfo && popupInfo.storage && popupInfo.opener, JSON.stringify(popupInfo));
  check("demo: the piece stays open in the portal", await page.evaluate(() => Boolean(document.querySelector("iframe.piece-frame"))));
  check("demo: no page errors in harness", errors.length === 0, errors.join(" | "));
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
  demo: "77777777-7777-4777-8777-777777777777",
  replaced: "88888888-8888-4888-8888-888888888888",
};
const EXPIRED = { code: "PGRST303", message: "JWT expired", details: null, hint: null };

function fakeSession(user = USER) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, exp: now + 3600, role: "authenticated", aud: "authenticated" })}.sig`;
  return { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "fake-refresh",
    user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated" } };
}

function tokenSubject(request) {
  const match = /^Bearer\s+([^.]+)\.([^.]+)\./.exec(request.headers().authorization || "");
  try { return match ? JSON.parse(Buffer.from(match[2], "base64url").toString("utf8")).sub || null : null; } catch { return null; }
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
    const sub = tokenSubject(request); // whose session made the request (null without one)
    if (backend.readsExpired && request.method() === "GET" && url.pathname.startsWith("/rest/v1/")) return json(EXPIRED, 401);
    if (url.pathname.endsWith("/logout")) return backend.logoutFails ? route.abort("internetdisconnected") : route.fulfill({ status: 204 });
    if (url.pathname.endsWith("/verify")) return json(fakeSession(backend.signInAs || USER)); // signing in again with a code
    if (url.pathname.startsWith("/auth/v1/")) return json(fakeSession().user);
    const table = url.pathname.replace("/rest/v1/", "");
    const select = url.searchParams.get("select") || "";
    switch (table) {
      case "project_members": return json(backend.members);
      case "projects": return json(backend.projects);
      case "piece_assignments": {
        const eq = url.searchParams.get("piece_id");
        const rows = backend.assignments(sub);
        return json(eq ? rows.filter((a) => `eq.${a.piece_id}` === eq) : rows);
      }
      case "pieces": {
        const eq = url.searchParams.get("id");
        if (select.includes("html")) return json(backend.pieces.filter((p) => `eq.${p.id}` === eq).map((p) => ({ ...p, html: backend.html[p.id] })));
        return json(backend.pieces);
      }
      case "piece_drafts": {
        const draft = sub && sub !== USER.id ? backend.draftBy[sub] : backend.draft;
        return json(draft ? [{ storage: draft, updated_at: new Date().toISOString() }] : []);
      }
      case "piece_responses": return json(backend.submits.length ? [{ id: "r1", submitted_at: backend.submittedAt }] : []);
      case "rpc/save_draft": {
        if (backend.authExpired) { backend.expiredSaves += 1; return json(EXPIRED, 401); }
        if (backend.saveFails) return route.abort("internetdisconnected");
        const body = request.postDataJSON();
        backend.drafts.push({ ...body, sub });
        if (backend.saveDelayMs) await sleep(backend.saveDelayMs);
        // The server copy changes only when the save completes, and it is the caller's own.
        if (sub && sub !== USER.id) backend.draftBy[sub] = body.p_storage;
        else backend.draft = body.p_storage;
        return route.fulfill({ status: 204 });
      }
      case "rpc/submit_response":
        if (backend.authExpired) return json(EXPIRED, 401);
        if (backend.submitMode === "network") return route.abort("internetdisconnected");
        if (backend.submitMode === "rejected") return json({ code: "P0001", message: "boom", details: null, hint: null }, 400);
        backend.submits.push(request.postDataJSON()); backend.submittedAt = new Date().toISOString();
        return json("66666666-6666-4666-8666-666666666666");
      default: return json({ message: `unexpected ${table}` }, 404);
    }
  });
  return context;
}

function newBackend(html, flowHtml, demoHtml) {
  const backend = {
    requests: [], drafts: [], submits: [], draft: null, submittedAt: null, submitMode: "ok", authExpired: false,
    readsExpired: false, expiredSaves: 0, draftBy: {}, saveFails: false, saveDelayMs: 0, logoutFails: false,
    members: [{ id: IDS.member, project_id: IDS.project, email: USER.email, user_id: USER.id, role: "client", display_name: "Ana Pérez" }],
    projects: [{ id: IDS.project, slug: "portal-test", name: "Portal de prueba", language: "es" }],
    pieces: [
      { id: IDS.questions, project_id: IDS.project, kind: "questions", title: "Preguntas · ronda 1", revision: 1, language: "es", created_at: "2026-10-16T15:00:00Z" },
      { id: IDS.flow, project_id: IDS.project, kind: "flow_review", title: "Recorrido de flujos v2", revision: 2, language: "es", created_at: "2026-10-10T15:00:00Z" },
      { id: IDS.demo, project_id: IDS.project, kind: "demo_review", title: "Demo v2", revision: 2, language: "es", created_at: "2026-10-09T15:00:00Z" },
      { id: IDS.replaced, project_id: IDS.project, kind: "demo_review", title: "Demo v1", revision: 1, language: "es", created_at: "2026-10-01T15:00:00Z" },
    ],
    html: { [IDS.questions]: html, [IDS.flow]: flowHtml || "<!doctype html><title>x</title>", [IDS.demo]: demoHtml || "<!doctype html><title>x</title>" },
    assignments() {
      return [
        { piece_id: IDS.questions, member_id: IDS.member, status: backend.submits.length ? "submitted" : backend.draft ? "in_progress" : "pending", assigned_at: "2026-10-16T15:00:00Z", updated_at: "2026-10-16T15:00:00Z" },
        { piece_id: IDS.flow, member_id: IDS.member, status: "submitted", assigned_at: "2026-10-10T15:00:00Z", updated_at: "2026-10-12T15:00:00Z" },
        { piece_id: IDS.demo, member_id: IDS.member, status: "submitted", assigned_at: "2026-10-09T15:00:00Z", updated_at: "2026-10-11T15:00:00Z" },
        { piece_id: IDS.replaced, member_id: IDS.member, status: "replaced", assigned_at: "2026-10-01T15:00:00Z", updated_at: "2026-10-09T15:00:00Z" },
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

// The questions piece inside the app, once its script runs.
async function appPiece(page, timeout = 10000) {
  return waitFor(async () => { const f = pieceFrame(page); return f && (await f.evaluate(() => typeof respondidas === "function").catch(() => false)) ? f : null; }, timeout);
}
const pieceState = (frame) => frame.evaluate(() => ({ error: ST.submitError || null, sent: isSent(), text: document.body.innerText }));
async function settledSend(frame, timeout = 10000) {
  return waitFor(async () => { const s = await pieceState(frame).catch(() => null); return s && !s.text.includes("Enviando…") && (s.error || s.sent) ? s : null; }, timeout);
}

async function mockedAppChecks(browser, base, html, flowHtml, demoHtml) {
  const backend = newBackend(html, flowHtml, demoHtml);
  const context = await mockedContext(browser, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  let downloads = 0;
  page.on("download", () => { downloads += 1; });

  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
  const home = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    h1: document.querySelector("h1")?.textContent,
    rows: [...document.querySelectorAll(".row")].map((r) => r.textContent),
  }));
  check("app: home lists the assigned pieces, without the replaced version", home.rows.length === 3 && !home.rows.some((r) => r.includes("Demo v1")), JSON.stringify(home.rows));
  check("app: project language (es) wins over browser (en-US)", home.lang === "es" && home.h1 === "Lo que te compartimos", `${home.lang} · ${home.h1}`);
  check("app: statuses in words", home.rows[0].includes("Por empezar") && home.rows[1].includes("Enviada"));
  check("app: the three kinds have their label", ["Preguntas", "Revisión de recorridos", "Revisión de la demo"].every((label) => home.rows.some((r) => r.includes(label))), JSON.stringify(home.rows));
  check("app: list query never asks for pieces.html",
    backend.requests.filter((r) => r.includes("/rest/v1/pieces")).every((r) => !decodeURIComponent(r).includes("html")));
  check("app: home 360px no horizontal scroll", await noHorizontalScroll(page));
  await page.screenshot({ path: join(outDir, "home-360.png"), fullPage: true });
  await snapshot(page, "home-pieces", "lista");
  const homeAxe = await axeViolations(page);
  if (homeAxe) check("app: axe on home has no violations", homeAxe.length === 0, homeAxe.join(", "));
  // On its own page: resizing this one breaks clicks into the piece iframe later (headless Chrome).
  const wide = await context.newPage();
  await wide.setViewportSize({ width: 1440, height: 900 });
  await wide.goto(`${base}/`, { waitUntil: "networkidle" });
  await wide.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
  await wide.screenshot({ path: join(outDir, "home-1440.png"), fullPage: true });
  await wide.close();

  // Open the questions piece, answer, autosave.
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  await page.waitForSelector("iframe.piece-frame", { timeout: 10000 });
  const pieceRequests = backend.requests.filter((r) => r.includes("/rest/v1/pieces") && decodeURIComponent(r).includes("html"));
  check("app: html fetched only when the piece opens", pieceRequests.length === 1, pieceRequests.join(" | "));
  const sandbox = await page.getAttribute("iframe.piece-frame", "sandbox");
  check("app: iframe sandbox allows popups, never allow-same-origin",
    sandbox === "allow-scripts allow-downloads allow-modals allow-forms allow-popups allow-popups-to-escape-sandbox", sandbox);
  check("app: the portal has no send button of its own", (await page.$$(".piece-bar button, .piece-bar [data-rol=accion-principal]")).length === 0);
  let frame = await appPiece(page);
  check("app: the piece gets the member's display name as reviewerName", (await frame.evaluate(() => factoryHost.reviewerName)) === "Ana Pérez");
  await frame.evaluate(() => { responder("q-001", "si"); responder("q-002", "no_se"); escribir("q-002", "quien", "Luis"); });
  const saved = await waitFor(async () => backend.drafts.length && (await page.textContent(".piece-status")).includes("Guardado"), 5000);
  check("app: autosave calls save_draft and shows «Guardado»", saved, `${backend.drafts.length} save_draft call(s)`);
  const lastDraft = backend.drafts.at(-1);
  check("app: save_draft carries the piece localStorage", lastDraft && lastDraft.p_piece_id === IDS.questions &&
    JSON.parse(lastDraft.p_storage[QUESTIONS_KEY]).respuestas["q-002"].quien === "Luis");
  check("app: piece 360px no horizontal scroll", await noHorizontalScroll(page));
  const pieceAxe = await axeViolations(page);
  if (pieceAxe) check("app: axe on the piece screen (portal chrome) has no violations", pieceAxe.length === 0, pieceAxe.join(", "));

  // (1) The piece sends through factorySubmit; submit_response answers ok.
  await sendQuestions(frame);
  const sent = await settledSend(frame);
  const body = backend.submits[0];
  check("app: the piece's send calls submit_response once with respuestas-fabrica/1", sent && backend.submits.length === 1 && body.p_piece_id === IDS.questions &&
    body.p_payload.formato === "respuestas-fabrica/1" && body.p_payload.respuestas.length === 2, body ? JSON.stringify(body.p_payload.respuestas.map((r) => r.tipo)) : "no call");
  check("app: after the server saved, the piece shows its sent screen", sent && sent.sent && sent.text.includes(QUESTIONS_SENT), sent ? sent.error : "");
  const order = backend.requests.filter((r) => r.includes("rpc/"));
  const saveWithTime = backend.drafts.findIndex((d) => JSON.parse(d.p_storage[QUESTIONS_KEY]).enviada_en === body.p_payload.enviada_en);
  // Position, among all RPC calls, of the save_draft that carried the send time.
  const savePositions = order.map((r, i) => (r === "POST /rest/v1/rpc/save_draft" ? i : -1)).filter((i) => i !== -1);
  check("app: the draft with the send time was saved before submit_response", saveWithTime !== -1 &&
    savePositions[saveWithTime] < order.indexOf("POST /rest/v1/rpc/submit_response"), order.join(" > "));
  check("app: the status line shows «Enviada el…»", await waitFor(async () => (await page.textContent(".piece-status")).includes("Enviada el"), 3000));
  check("app: sending did not trigger a download", downloads === 0);
  await page.screenshot({ path: join(outDir, "piece-sent-360.png") });
  check("app: no console errors up to here", errors.length === 0, errors.join(" | "));
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  // (2) Network failure: the piece shows its error, never its sent screen; a retry with the server back works.
  await frame.evaluate(() => editar());
  backend.submitMode = "network";
  await sendQuestions(frame);
  const offline = await settledSend(frame);
  check("app: network failure -> the piece gets «network» and shows its error", offline && offline.error === "network" && !offline.sent &&
    offline.text.includes("No se pudieron enviar") && !offline.text.includes(QUESTIONS_SENT), offline ? offline.error : "no result");
  check("app: nothing reached piece_responses", backend.submits.length === 1);
  await page.screenshot({ path: join(outDir, "piece-error-360.png") });
  backend.submitMode = "ok";
  await frame.click("button[data-rol=accion-principal]"); // «Reintentar»
  const retried = await settledSend(frame);
  check("app: the retry with the server back works", retried && retried.sent && backend.submits.length === 2, `${backend.submits.length} row(s)`);

  // A rejection from the server is «rejected».
  await frame.evaluate(() => editar());
  backend.submitMode = "rejected";
  await sendQuestions(frame);
  const refused = await settledSend(frame);
  check("app: a server rejection -> the piece gets «rejected»", refused && refused.error === "rejected" && !refused.sent, refused ? refused.error : "");
  backend.submitMode = "ok";

  // (3) The session expired: «session-expired», the portal asks to sign in again, the draft stays on the server.
  backend.authExpired = true;
  await frame.click("button[data-rol=accion-principal]"); // «Reintentar»
  const expired = await settledSend(frame);
  check("app: expired session -> the piece gets «session-expired»", expired && expired.error === "session-expired" && !expired.sent, expired ? expired.error : "");
  const ask = await waitFor(async () => page.evaluate(() => {
    const n = document.querySelector("[data-rol=avisos] .notice[role=alert]");
    return n && n.textContent.includes("Tu sesión terminó") ? { text: n.textContent, pos: getComputedStyle(n).position } : null;
  }), 5000);
  check("app: the portal shows its in-page sign-in-again notice", ask && ask.pos === "static" && ask.text.includes("Entrar de nuevo"), ask ? ask.text : "none");
  const kept = backend.draft && JSON.parse(backend.draft[QUESTIONS_KEY]).respuestas["q-002"]?.quien === "Luis";
  check("app: the draft is still in piece_drafts", kept);
  await page.click("text=Entrar de nuevo");
  await page.waitForSelector("#email", { timeout: 10000 });
  backend.authExpired = false;
  await page.fill("#email", USER.email);
  await page.click("button[type=submit]");
  await page.waitForSelector("#code", { timeout: 10000 });
  await page.fill("#code", "1".repeat(await page.evaluate(async () => (await import("./config.js")).EMAIL_OTP_LENGTH)));
  await page.waitForSelector(`a[href="#/piece/${IDS.questions}"]`, { timeout: 10000 });
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  frame = await appPiece(page);
  const back = frame && await frame.evaluate(() => ({ n: respondidas(), quien: ST.respuestas["q-002"] && ST.respuestas["q-002"].quien }));
  check("app: after signing in again the answers come back from piece_drafts", back && back.n === 2 && back.quien === "Luis", JSON.stringify(back));
  const before = backend.submits.length;
  await sendQuestions(frame);
  const resent = await settledSend(frame);
  check("app: after signing in again, sending works", resent && resent.sent && backend.submits.length === before + 1);
  check("app: no dialogs on the way", dialogs.length === 0, JSON.stringify(dialogs));

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
  await pieceFrame(page).evaluate(() => { responder("q-004", "cambio"); escribir("q-004", "texto", "carrera"); });
  await waitFor(async () => backend.drafts.length > savesBefore, 5000);
  await page.click(".back-link");
  await page.waitForSelector(`a[href="#/piece/${IDS.questions}"]`, { timeout: 10000 });
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  const raced = await waitFor(async () => {
    const f = pieceFrame(page);
    return f && (await f.evaluate(() => typeof ST === "object" && ST.respuestas["q-004"] ? ST.respuestas["q-004"].texto : null).catch(() => null));
  }, 10000);
  check("app: reopening during an in-flight save keeps the newest answers", raced === "carrera", String(raced));
  backend.saveDelayMs = 0;

  // Sign out offline with unsaved changes: ask in the page; confirming lands on a clean sign-in.
  backend.saveFails = true;
  backend.logoutFails = true;
  await pieceFrame(page).evaluate(() => responder("q-001", "no_se"));
  await page.click(".back-link");
  await page.waitForSelector(".masthead .button--secondary", { timeout: 10000 });
  await page.click(".masthead .button--secondary");
  const askOut = await waitFor(async () => page.evaluate(() => {
    const n = document.querySelector("[data-rol=avisos] .notice");
    return n && n.textContent.includes("se perderán") ? { h1: document.querySelector("h1").textContent, text: n.textContent } : null;
  }), 10000);
  check("app: sign-out with unsaved changes asks before losing them", askOut && askOut.h1 === "Lo que te compartimos", askOut ? askOut.text : "no notice");
  const stillSignedIn = await page.evaluate((k) => Boolean(localStorage.getItem(k)), STORAGE_KEY);
  check("app: nothing is discarded until the person confirms", stillSignedIn && !(await page.$("#email")));
  await page.click("text=Salir y perder los cambios");
  const signedOut = await waitFor(async () => page.evaluate((k) => {
    const notice = document.querySelector("[data-rol=avisos] .notice");
    return document.querySelector("#email") ? { session: localStorage.getItem(k), notice: notice && notice.textContent } : null;
  }, STORAGE_KEY), 10000);
  check("app: offline sign-out still lands on a clean sign-in screen", signedOut && !signedOut.session && signedOut.notice && signedOut.notice.includes("You signed out on this device"), // sign-in follows the browser (en-US here)
    signedOut ? JSON.stringify(signedOut) : "no sign-in screen");

  check("app: no page errors after the forced failures", pageErrors.length === 0, pageErrors.join(" | "));
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
  await snapshot(emptyPage, "home-empty", "lista");
  await emptyContext.close();
}

// Signs in through the real screens (mocked /otp and /verify), from the email step.
async function signInThroughScreens(page) {
  await page.waitForSelector("#email", { timeout: 10000 });
  await page.fill("#email", USER.email);
  await page.click("button[type=submit]");
  await page.waitForSelector("#code", { timeout: 10000 });
  await page.fill("#code", "1".repeat(await page.evaluate(async () => (await import("./config.js")).EMAIL_OTP_LENGTH)));
}

// A change the server never confirmed survives the end of the session: it stays in the tab and is
// saved after the person signs in again (with the same account).
async function sessionEndDraftChecks(browser, base, html) {
  for (const other of [false, true]) await sessionEndDraftRun(browser, base, html, other);
}

// other = true: after the session ends, someone else (B) signs in on the same tab. Nothing of A's is
// sent with B's session or shown to B; when A signs in again, A's kept change is saved.
const OTHER = { id: "99999999-9999-4999-8999-999999999999", email: "luis@example.com", member: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
async function sessionEndDraftRun(browser, base, html, other) {
  const tag = other ? "session end, another account" : "session end";
  const backend = newBackend(html);
  if (other) {
    backend.signInAs = OTHER;
    backend.members.push({ id: OTHER.member, project_id: IDS.project, email: OTHER.email, user_id: OTHER.id, role: "client", display_name: "Luis Gómez" });
    const ownRows = backend.assignments;
    backend.assignments = (sub) => (sub === OTHER.id
      ? [{ piece_id: IDS.questions, member_id: OTHER.member, status: "pending", assigned_at: "2026-10-16T15:00:00Z", updated_at: "2026-10-16T15:00:00Z" }]
      : ownRows());
  }
  const context = await mockedContext(browser, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(`a[href="#/piece/${IDS.questions}"]`, { timeout: 10000 });
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  let frame = await appPiece(page);
  await frame.evaluate(() => responder("q-001", "si"));
  await waitFor(async () => backend.draft && (await page.textContent(".piece-status")).includes("Guardado"), 5000);

  // The session expires; the next change cannot be saved.
  backend.authExpired = true;
  backend.readsExpired = true;
  await frame.evaluate(() => { responder("q-003", "cambio"); escribir("q-003", "texto", "Escrito al final de la sesión"); });
  const refused = await waitFor(() => backend.expiredSaves > 0, 5000);
  const edited = (storage) => {
    try { return JSON.parse(storage[QUESTIONS_KEY]).respuestas["q-003"]?.texto === "Escrito al final de la sesión"; } catch { return false; }
  };
  check(`${tag}: the change made after the session expired was refused by the server`, refused && !edited(backend.draft));
  // Going home finds the session over (401) and lands on the sign-in screen.
  await page.click(".back-link");
  const ended = await waitFor(async () => page.evaluate(() => {
    const n = document.querySelector("[data-rol=avisos] .notice");
    return document.querySelector("#email") && n && n.textContent.includes("Your session ended"); // sign-in follows the browser (en-US)
  }).catch(() => false), 10000);
  check(`${tag}: the portal asks to sign in again`, ended);

  backend.authExpired = false;
  backend.readsExpired = false;
  await signInThroughScreens(page);
  await page.waitForSelector(".row-link, .empty", { timeout: 10000 }); // the other account has nothing shared
  if (other) {
    await sleep(3500); // longer than the first retry (3 s) of the kept draft
    check(`${tag}: nothing of A's is sent with B's session`, !backend.drafts.some((d) => d.sub === OTHER.id || edited(d.p_storage)),
      JSON.stringify(backend.drafts.map((d) => d.sub)));
    const homeB = await page.evaluate(() => ({ notice: document.querySelector("[data-rol=avisos] .notice")?.textContent || null, rows: document.querySelectorAll(".row").length }));
    check(`${tag}: B's home does not warn about A's unsaved changes`, homeB.rows === 1 && !homeB.notice, JSON.stringify(homeB));
    await page.click(`a[href="#/piece/${IDS.questions}"]`);
    frame = await appPiece(page);
    const seenByB = frame && await frame.evaluate(() => ({ answered: respondidas(), q1: ST.respuestas["q-001"] || null, q3: ST.respuestas["q-003"] || null }));
    check(`${tag}: B opens the same piece and sees none of A's answers`, seenByB && seenByB.answered === 0 && !seenByB.q1 && !seenByB.q3, JSON.stringify(seenByB));
    // B leaves and signs out (nothing unsaved: a clean sign-out); then A signs in again on the tab.
    await page.click(".back-link");
    await page.waitForSelector(".masthead .button--secondary", { timeout: 10000 });
    await page.click(".masthead .button--secondary");
    backend.signInAs = USER;
    await signInThroughScreens(page);
    await page.waitForSelector(`a[href="#/piece/${IDS.questions}"]`, { timeout: 10000 });
  }
  const reached = await waitFor(() => backend.draft && edited(backend.draft), 8000);
  check(`${tag}: after ${other ? "A signs" : "signing"} in again, the unsaved change reaches piece_drafts`, reached,
    backend.draft ? JSON.stringify(JSON.parse(backend.draft[QUESTIONS_KEY]).respuestas) : "no server draft");
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  frame = await appPiece(page);
  const shown = frame && await frame.evaluate(() => ({ q1: ST.respuestas["q-001"]?.tipo, q3: ST.respuestas["q-003"]?.texto }));
  check(`${tag}: the piece shows the change after signing in again`, shown && shown.q1 === "si" && shown.q3 === "Escrito al final de la sesión", JSON.stringify(shown));
  if (other) check(`${tag}: every save of A's change went with A's session`, backend.drafts.filter((d) => edited(d.p_storage)).every((d) => d.sub === USER.id),
    JSON.stringify(backend.drafts.map((d) => d.sub)));
  check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
  await context.close();
}

const { chromium } = loadPlaywright();
const { child, base } = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const read = (path) => (path ? readFileSync(path, "utf8") : null);
try {
  if (!args["skip-portal"]) await portalChecks(browser, base);
  if (args.questions) await questionsChecks(browser, base, read(args.questions));
  if (args.flow) await flowChecks(browser, base, read(args.flow));
  if (args.demo) await demoChecks(browser, base, read(args.demo));
  if (args.questions) await mockedAppChecks(browser, base, read(args.questions), read(args.flow), read(args.demo));
  if (args.questions) await sessionEndDraftChecks(browser, base, read(args.questions));
} finally {
  await browser.close();
  child.kill();
}
// Every snapshot through the factory's verifier, at the three review widths, light and dark.
if (args.factory) {
  const verifier = join(resolve(args.factory), "design-system", "assets", "verifica-pantalla.mjs");
  if (!existsSync(verifier)) check("manual: verifica-pantalla.mjs found", false, verifier);
  else {
    check("manual: the four screens were captured", ["sign-in-email", "sign-in-code", "home-pieces", "home-empty"].every((n) => screens.has(n)), [...screens.keys()].join(", "));
    for (const [name, pattern] of screens) {
      for (const width of [320, 768, 1440]) {
        for (const scheme of ["light", "dark"]) {
          const out = join(screensDir, `${name}-${width}-${scheme}.json`);
          const run = spawnSync(process.execPath, [verifier, "--html", join(screensDir, `${name}.html`), "--patron", pattern,
            "--ancho", String(width), "--color-scheme", scheme, "--salida", out], { encoding: "utf8" });
          const failing = `${run.stdout}${run.stderr}`.split("\n").filter((line) => line.startsWith("✗") || line.startsWith("verifica-pantalla: ") && run.status !== 0);
          check(`manual: ${name} (${pattern}) ${width}px ${scheme}: verifica-pantalla rc=${run.status}`, run.status === 0, failing.join(" | "));
        }
      }
    }
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed · screenshots in ${outDir}`);
process.exit(failed ? 1 : 0);
