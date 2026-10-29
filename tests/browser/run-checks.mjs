// Browser checks for the portal and the bridge. Dev-only; nothing here is served to users.
//
//   node tests/browser/run-checks.mjs --questions <piece.html> [--flow <piece.html>] [--demo <piece.html>] [--out <dir>]
//                                     [--factory <software factory repo>]
//
// Serves the repo with tests/browser/static-server.mjs (127.0.0.1, a free port), drives system Chrome
// headless with playwright-core and prints one PASS/FAIL line per check. playwright-core is loaded from
// PLAYWRIGHT_CORE_DIR, or from the software factory cache (~/.cache/fabrica-software/playwright-core@1.63.0).
// Chrome is taken from CHROME_PATH or the default macOS / Linux locations.
//
// With --demo, the demo sheet also sends through the app (error, then success: one row), and a replaced
// version opened from an old email shows its fixed notice with a link to the newer one and still sends.
//
// With --questions, the piece closure too (closureChecks): a received piece and a replaced version that was sent, in
// the list and opened read only with «Pedir un cambio»; the change request form; and a send that arrived after the
// close. Screenshots <name>-<width>-<scheme>.png at 320, 768 and 1440, light and dark.
//
// Screen snapshots: the sign-in screens (email step, code step), home (the projects, empty), a project's page, an owned
// project's page with the owner's part (with --flow and --demo too), a project's page with a received piece, and the
// «Decisiones» screens (decisionsScreens: a person's section, its error states, a project with the section only, the owner's
// summary and one point as the owner reads it) are saved to <out>/screens/<screen>.html as the rendered DOM without scripts, next to a copy of css/ and
// brand/, so they look exactly as in the app. With --factory, each one goes through the factory's
// design-system/assets/verifica-pantalla.mjs (the visual manual's checks and axe) at 320, 768 and
// 1440 px, light and dark, and every run is one check. The JSON of each run is in <out>/screens/.
// With --factory, the portal's own frame is also measured with the factory's geometria.mjs (see
// portalGeometryChecks): every screen at 320, 672, 1056 and 1440, light and dark, and the piece screen's
// iframe against the factory's piece-host.mjs.
//
// With --questions, the piece screen on a phone too (phoneFrameChecks, MAR-14), at 320 x 640: in Chromium, and in
// WebKit when playwright-core has its build installed (otherwise a NOTE line says it did not run).

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import os from "node:os";
import { serveDir } from "./static-server.mjs";

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
  const server = await serveDir(root);
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

// Saves the screen as it is now: the rendered DOM without scripts (nothing re-renders it), with the
// same relative links to css/ and brand/. formState: what was chosen and typed (live state, not markup) is written into
// the copy, so it shows as it did on screen.
async function snapshot(page, name, pattern, { formState = false } = {}) {
  const html = await page.evaluate((withForm) => {
    const doc = document.documentElement.cloneNode(true);
    if (withForm) {
      const copies = [...doc.querySelectorAll("input, textarea")];
      [...document.documentElement.querySelectorAll("input, textarea")].forEach((el, i) => {
        const copy = copies[i];
        if (!copy) return;
        if (el.type === "radio" || el.type === "checkbox") copy.toggleAttribute("checked", el.checked);
        else if (el.tagName === "TEXTAREA") copy.textContent = el.value;
        else copy.setAttribute("value", el.value);
      });
    }
    for (const script of doc.querySelectorAll("script")) script.remove();
    return `<!doctype html>\n${doc.outerHTML}\n`;
  }, formState);
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
      // Signed out the brand has nowhere to go: it is the mark without a link (nothing to tap, nothing lost on the code step).
      const bare = await page.evaluate(() => {
        const mark = document.querySelector("[data-rol=marca-producto]"), frame = document.querySelector(".frame");
        return { tag: mark.tagName.toLowerCase(), href: mark.hasAttribute("href"), current: mark.hasAttribute("aria-current"), label: mark.hasAttribute("aria-label"),
          words: mark.textContent, left: Math.round(mark.getBoundingClientRect().left), h1Left: Math.round(document.querySelector("h1").getBoundingClientRect().left), height: Math.round(mark.getBoundingClientRect().height),
          weight: getComputedStyle(mark.querySelector("span")).fontWeight };
      });
      check("brand: on the sign-in screen the brand is not a link (no href, no aria-current), with the brand's look", bare.tag !== "a" && !bare.href && !bare.current &&
        !bare.label && bare.words === "ninben" && Math.abs(bare.left - bare.h1Left) <= 1 && bare.height >= 44 && bare.weight === "600", JSON.stringify(bare));
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
  if (code) {
    // Tapping the brand on the code step used to wipe the code being typed: now it is no link, and nothing is lost.
    await codePage.fill("#code", "123");
    const mark = await codePage.evaluate(() => { const m = document.querySelector("[data-rol=marca-producto]"); return { tag: m.tagName.toLowerCase(), href: m.hasAttribute("href"), current: m.hasAttribute("aria-current") }; });
    await codePage.click("[data-rol=marca-producto]", { force: true });
    const kept = await codePage.inputValue("#code").catch(() => null);
    check("login: on the code step the brand is no link and tapping it keeps the code being typed", mark.tag !== "a" && !mark.href && !mark.current && kept === "123", JSON.stringify({ mark, kept }));
  }
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
// The sent screens' headings. They are compared as a whole line: the demo sheet can also say «Tu revisión
// llegó, pero cambiaste algo…», which must not count as its sent screen.
const QUESTIONS_SENT = "Tus respuestas llegaron";
const FLOW_SENT = "Tu revisión llegó";
const isLine = (line) => (text) => text.trim() === line;
const frameText = (frame) => frame.evaluate(() => document.body.innerText);
// The questions piece: go to "Revisa y envía" and tap its send button (the piece's own).
async function sendQuestions(frame) {
  await frame.evaluate(() => { if (view !== "review") showReview(); });
  await steadyClick(frame.locator("button[data-rol=accion-principal]"));
}
// The portal's page scrolls with the piece (MAR-14), and the piece's iframe runs in its own process: Chrome sends a pointer
// event to the frame that was under it on the last frame it drew. So a control is first brought into view, then the page
// and the piece draw (piecePainted), and only then it is clicked; a click in the same frame as the scroll can land in the
// piece where it was a frame ago. A person never clicks that fast.
async function steadyClick(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await piecePainted(locator.page());
  await locator.click();
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
  check("questions: while the portal has not answered, the piece does not say it was sent", !waiting.split("\n").some(isLine(QUESTIONS_SENT)) && waiting.includes("Enviando"));
  // A result without the nonce (posted by the parent page, but forged) is ignored.
  await page.evaluate((id) => window.harness.frameElement().contentWindow.postMessage({ type: "factory:submit-result", requestId: id, ok: true, nonce: "guess" }, "*"), submitted.requestId);
  await sleep(200);
  check("questions: a submit-result without the mount nonce is ignored", !(await frameText(pieceFrame(page))).split("\n").some(isLine(QUESTIONS_SENT)));
  await page.evaluate((id) => window.harness.respond(id, { ok: true }), submitted.requestId);
  const sentText = await waitFor(async () => { const t = await frameText(pieceFrame(page)); return t.split("\n").some(isLine(QUESTIONS_SENT)) ? t : null; }, 3000);
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
  check("questions: after the timeout the piece shows its error, never its sent screen", timedOut && timedOut.text.includes("No se pudieron enviar") && !timedOut.text.split("\n").some(isLine(QUESTIONS_SENT)));
  await page.evaluate((id) => window.harness.respond(id, { ok: true }), lost.requestId);
  await sleep(300);
  check("questions: a late answer after the timeout is ignored", !(await frameText(pieceFrame(page))).split("\n").some(isLine(QUESTIONS_SENT)));

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

  // A change that does not fit (quota lowered for the test): the piece's write throws, the portal is
  // told once with factory:save-failed, and again only after a change that fits.
  await page.evaluate((h) => window.harness.mount(h, "questions", {}, { quotaChars: 20000 }), html);
  await waitFor(async () => (await events(page, "ready"))[0]);
  const refused = await pieceFrame(page).evaluate(() => {
    responder("q-003", "cambio");
    let threw = null;
    try { localStorage.setItem("probe", "x".repeat(30000)); } catch (e) { threw = e.name; }
    escribir("q-003", "texto", "y".repeat(30000)); // the piece's own save hits the quota too
    const stored = localStorage.getItem("probe");
    return { threw, stored: stored === null ? null : stored.length };
  });
  await sleep(200);
  const failedOnce = await events(page, "save-failed");
  check("questions: a write past the quota throws QuotaExceededError in the piece", refused.threw === "QuotaExceededError" && refused.stored === null, JSON.stringify(refused));
  check("questions: the portal gets factory:save-failed «too-large» once for refusals in a row", failedOnce.length === 1 && failedOnce[0] === "too-large", JSON.stringify(failedOnce));
  await pieceFrame(page).evaluate(() => escribir("q-003", "texto", "Corto"));
  await sleep(100);
  await pieceFrame(page).evaluate(() => escribir("q-003", "texto", "z".repeat(30000)));
  await sleep(200);
  check("questions: after a change that fits, a new refusal is reported again", (await events(page, "save-failed")).length === 2);

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
    failed.text.includes("No se pudo enviar tu revisión") && !failed.text.split("\n").some(isLine(FLOW_SENT)), JSON.stringify({ error: failed.error, sent: failed.sent }));
  const retry = pieceFrame(page).evaluate(() => submitReview());
  const again = await waitFor(async () => (await events(page, "submit"))[1]);
  await page.evaluate((id) => window.harness.respond(id, { ok: true }), again.requestId);
  await retry;
  const ok = await pieceFrame(page).evaluate(() => ({ sent: ST.submittedAt || null, text: document.body.innerText }));
  check("flow: the retry works and the piece shows its sent screen", again && ok.sent && ok.text.split("\n").some(isLine(FLOW_SENT)));
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
// The empty home: its message, and the notice that asks the person to check the email they were invited with.
const EMPTY = {
  body: (email) => `Todavía no hay nada para ${email}.`,
  hint: "Si esperabas algo, revisa con qué correo te invitaron.",
};
const IDS = {
  project: "22222222-2222-4222-8222-222222222222",
  member: "33333333-3333-4333-8333-333333333333",
  questions: "44444444-4444-4444-8444-444444444444",
  flow: "55555555-5555-4555-8555-555555555555",
  demo: "77777777-7777-4777-8777-777777777777",
  replaced: "88888888-8888-4888-8888-888888888888",
  questionsNew: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  replacedDraft: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  // A project the person owns (owner_projects) without anything asked of them, its membership, and one nobody has.
  ownedProject: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  ownerMember: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  unknownProject: "ffffffff-ffff-4fff-8fff-ffffffffffff",
};
// owner_projects() before the project page migration: PostgREST does not know the function.
const NO_FUNCTION = { code: "PGRST202", message: "Could not find the function public.owner_projects without parameters in the schema cache", details: null, hint: null };
const EXPIRED = { code: "PGRST303", message: "JWT expired", details: null, hint: null };
const NOT_OWNER = { code: "42501", message: "owner_project: not the project owner", details: null, hint: null };

function fakeSession(user = USER) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, exp: now + 3600, role: "authenticated", aud: "authenticated" })}.sig`;
  return { access_token: jwt, token_type: "bearer", expires_in: 3600, expires_at: now + 3600, refresh_token: "fake-refresh",
    user: { id: user.id, email: user.email, aud: "authenticated", role: "authenticated" } };
}

// The PostgREST filters the stand-in understands on piece_responses and piece_change_requests: eq, neq and in.(…) on
// any column, then order (column.asc|desc, comma-separated) and limit.
function queryRows(rows, url) {
  let out = rows.filter((row) => [...url.searchParams].every(([key, value]) => {
    if (["select", "order", "limit", "offset"].includes(key)) return true;
    const cell = String(row[key]);
    if (value.startsWith("eq.")) return cell === value.slice(3);
    if (value.startsWith("neq.")) return cell !== value.slice(4);
    if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(cell);
    return true;
  }));
  const order = url.searchParams.get("order");
  if (order) {
    const keys = order.split(",").map((part) => part.split("."));
    out = [...out].sort((a, b) => {
      for (const [key, dir] of keys) {
        const c = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
        if (c) return dir === "desc" ? -c : c;
      }
      return 0;
    });
  }
  const limit = Number(url.searchParams.get("limit"));
  return limit > 0 ? out.slice(0, limit) : out;
}

function tokenSubject(request) {
  const match = /^Bearer\s+([^.]+)\.([^.]+)\./.exec(request.headers().authorization || "");
  try { return match ? JSON.parse(Buffer.from(match[2], "base64url").toString("utf8")).sub || null : null; } catch { return null; }
}

// frameScreen: { width, height } the piece's iframe reads as its screen. Playwright's WebKit emulates the screen of the top
// page only (inside an iframe, window.screen is the computer's: 1440 high), and on a phone an iframe's screen is the phone's,
// so the phone checks in WebKit give the iframes the viewport's.
async function mockedContext(browser, { width = 360, height = 780, locale = "en-US", backend, frameScreen = null }) {
  const context = await browser.newContext({ viewport: { width, height }, locale });
  if (frameScreen) await context.addInitScript((size) => {
    if (window.top === window) return;
    for (const [name, value] of [["width", size.width], ["availWidth", size.width], ["height", size.height], ["availHeight", size.height]]) {
      Object.defineProperty(Screen.prototype, name, { configurable: true, get: () => value });
    }
  }, frameScreen);
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
      case "projects": return json(queryRows(backend.projects, url));
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
        return json(draft ? [{ storage: draft, updated_at: backend.draftUpdatedAt || new Date().toISOString() }] : []);
      }
      case "piece_responses": return json(queryRows(backend.responseRows(), url));
      case "piece_change_requests":
        // The read that tells a late send apart (by id, right after submit_response) can be made to fail.
        if (backend.lateReadFails && url.searchParams.has("id")) return route.abort("internetdisconnected");
        return json(queryRows(backend.changeRequests, url));
      case "rpc/save_draft": {
        if (backend.authExpired) { backend.expiredSaves += 1; return json(EXPIRED, 401); }
        if (backend.saveFails) return route.abort("internetdisconnected");
        const body = request.postDataJSON();
        backend.drafts.push({ ...body, sub });
        if (backend.saveDelayMs) await sleep(backend.saveDelayMs);
        // The server copy changes only when the save completes, and it is the caller's own.
        if (sub && sub !== USER.id) backend.draftBy[sub] = body.p_storage;
        else { backend.draft = body.p_storage; backend.draftUpdatedAt = new Date().toISOString(); }
        return route.fulfill({ status: 204 });
      }
      case "rpc/submit_response":
        if (backend.authExpired) return json(EXPIRED, 401);
        if (backend.submitMode === "network") return route.abort("internetdisconnected");
        if (backend.submitMode === "rejected") return json({ code: "P0001", message: "boom", details: null, hint: null }, 400);
        {
          const body = request.postDataJSON();
          // On a closed assignment the server keeps the send as a late change request (piece closure migration).
          if (backend.closedOnServer(body.p_piece_id)) {
            const id = randomUUID();
            backend.lateSubmits.push(body);
            backend.changeRequests.push({ id, piece_id: body.p_piece_id, member_id: IDS.member, text: null, payload: body.p_payload,
              storage: body.p_storage ?? null, late: true, created_at: new Date().toISOString() });
            return json(id);
          }
          backend.submittedAt = new Date().toISOString();
          backend.submits.push({ ...body, submitted_at: backend.submittedAt });
        }
        return json("66666666-6666-4666-8666-666666666666");
      case "rpc/request_change": {
        if (backend.authExpired) return json(EXPIRED, 401);
        if (backend.requestMode === "network") return route.abort("internetdisconnected");
        if (backend.requestMode === "rejected") return json({ code: "23514", message: "new row violates check constraint", details: null, hint: null }, 400);
        const body = request.postDataJSON();
        backend.requestCalls.push(body);
        if (backend.requestDelayMs) await sleep(backend.requestDelayMs);
        if (!backend.closedOnServer(body.p_piece_id)) return json({ code: "55000", message: "request_change: the piece is not closed", details: null, hint: null }, 400);
        if (!/[^\s]/.test(body.p_text || "")) return json({ code: "22023", message: "request_change: the text is required", details: null, hint: null }, 400);
        const id = randomUUID();
        backend.changeRequests.push({ id, piece_id: body.p_piece_id, member_id: IDS.member, text: body.p_text.trim(), payload: null,
          storage: body.p_storage ?? null, late: false, created_at: new Date().toISOString() });
        return json(id);
      }
      case "rpc/owner_projects":
        if (backend.ownerRpcsMissing) return json(NO_FUNCTION, 404);
        if (backend.ownerRpcsFail) return json({ code: "XX000", message: "boom", details: null, hint: null }, 500);
        return json(backend.ownedProjects);
      // The owner's reads (project page migration): owner_project answers backend.ownerView[projectId] and owner_piece
      // backend.ownerPieces[`${pieceId}|${memberId}`], each only for a project in backend.ownedIds (42501 otherwise, as the
      // server; P0002 when that person has no assignment on that piece). An old database knows neither (PGRST202).
      case "rpc/owner_project": {
        const body = request.postDataJSON();
        backend.ownerCalls.push({ rpc: "owner_project", ...body, sub });
        if (backend.ownerRpcsMissing) return json({ ...NO_FUNCTION, message: "Could not find the function public.owner_project(p_project_id) in the schema cache" }, 404);
        if (!backend.ownedIds.includes(body.p_project_id) || !backend.ownerView[body.p_project_id]) return json(NOT_OWNER, 403);
        return json(backend.ownerView[body.p_project_id]);
      }
      case "rpc/owner_piece": {
        const body = request.postDataJSON();
        backend.ownerCalls.push({ rpc: "owner_piece", ...body, sub });
        if (backend.ownerRpcsMissing) return json({ ...NO_FUNCTION, message: "Could not find the function public.owner_piece(p_member_id, p_piece_id) in the schema cache" }, 404);
        const entry = backend.ownerPieces[`${body.p_piece_id}|${body.p_member_id}`];
        const projectId = entry ? entry.piece.project_id : backend.pieceProject(body.p_piece_id);
        if (!projectId || !backend.ownedIds.includes(projectId)) return json(NOT_OWNER, 403);
        if (!entry) return json({ code: "P0002", message: "owner_piece: not assigned", details: null, hint: null }, 404);
        return json(entry);
      }
      case "rpc/mark_piece_opened": {
        // openedFails: "network" (offline), "missing" (a database without the function) or "expired" (the session ended).
        if (backend.openedFails === "network") return route.abort("internetdisconnected");
        if (backend.openedFails === "missing") return json({ ...NO_FUNCTION, message: "Could not find the function public.mark_piece_opened(p_piece_id) in the schema cache" }, 404);
        if (backend.openedFails === "expired") return json(EXPIRED, 401);
        backend.openedCalls.push({ ...request.postDataJSON(), sub });
        return route.fulfill({ status: 204 });
      }
      // The «Decisiones» section (decisions migration), answered from backend.decisions (decisionsServer): a project
      // there with active points has the person in its list; any other project answers 42501, as the server.
      case "rpc/decision_projects":
      case "rpc/my_decisions":
      case "rpc/answer_decision":
      case "rpc/propose_decision":
      case "rpc/mark_decisions_opened":
      case "rpc/owner_decisions": {
        const rpc = table.slice(4);
        const body = request.method() === "POST" ? request.postDataJSON() || {} : {};
        backend.decisionCalls.push({ rpc, ...body, sub });
        if (rpc === "mark_decisions_opened") {
          if (backend.decisionsOpenedFails === "network") return route.abort("internetdisconnected");
          if (backend.decisionsOpenedFails === "missing") return json({ ...NO_FUNCTION, message: "Could not find the function public.mark_decisions_opened(p_project_id) in the schema cache" }, 404);
          if (backend.decisionsOpenedFails === "expired") return json(EXPIRED, 401);
        }
        if (rpc === "answer_decision") {
          if (backend.answerMode === "network") return route.abort("internetdisconnected");
          const delay = Object.hasOwn(backend.answerDelayByKey, body.p_key) ? backend.answerDelayByKey[body.p_key] : backend.answerDelayMs;
          if (delay) await sleep(delay);
        }
        if (rpc === "my_decisions" && backend.myDecisionsFails) return route.abort("internetdisconnected");
        if (rpc === "my_decisions" && backend.myDecisionsDelayMs) await sleep(backend.myDecisionsDelayMs);
        // ownerDecisionsFails: "error" (the server answers 500) or "network" (it cannot be reached).
        if (rpc === "owner_decisions" && backend.ownerDecisionsFails === "network") return route.abort("internetdisconnected");
        if (rpc === "owner_decisions" && backend.ownerDecisionsFails === "error") return json({ code: "XX000", message: "boom", details: null, hint: null }, 500);
        const answer = decisionsServer(backend, rpc, body, sub);
        if (answer.error) return json(answer.error, answer.status);
        return answer.empty ? route.fulfill({ status: 204 }) : json(answer.data);
      }
      default: return json({ message: `unexpected ${table}` }, 404);
    }
  });
  return context;
}

// The decisions functions as the migration has them (20261028120000_decisions.sql), over backend.decisions[projectId]:
// { audience: [member ids] (decision_audience), opens: { memberId: iso } (decision_opens), members: [{ id, display_name,
// role, created_at }] (the project's project_members, for owner_decisions; the caller's own membership is in
// backend.members), points: [{ key, version, position, title, decided, basis, firstPublishedAt, active }],
// answers: [{ id, member_id, key, version, value, comment, created_at }], proposals: [{ id, member_id, text, created_at }] }.
// As private.audience_member_id, the caller is in the list when their membership of the project (by the session) is in
// the audience and is not an owner's (42501 otherwise); my_decisions works the marks out as the SQL does, from the caller's
// own answers; answer_decision checks the value, the comment, that the point is published (P0002) and that the version is
// the current one (PT409), and keeps every answer as a new row; mark_decisions_opened moves the caller's date;
// owner_decisions (for a project in backend.ownedIds) is worked out from the same rows, as its SQL does.
function decisionsServer(backend, rpc, body, sub) {
  const refuse = (code, message, status) => ({ error: { code, message: `${rpc}: ${message}`, details: null, hint: null }, status });
  const activePoints = (entry) => entry.points.filter((p) => p.active !== false).sort((a, b) => a.position - b.position);
  // created_at, then id: the SQL's order of rows that share a time.
  const byTime = (a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.id).localeCompare(String(b.id));
  const audienceMember = (projectId) => {
    const entry = backend.decisions[projectId];
    const mine = backend.members.find((m) => m.project_id === projectId && sub && m.user_id === sub && m.role !== "owner");
    return entry && mine && entry.audience.includes(mine.id) ? mine.id : null;
  };
  if (rpc === "decision_projects") {
    const rows = Object.entries(backend.decisions).filter(([id, entry]) => audienceMember(id) && activePoints(entry).length).map(([id]) => {
      const project = backend.projects.find((p) => p.id === id) || {};
      return { project_id: id, slug: project.slug, name: project.name };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return { data: rows };
  }
  if (rpc === "owner_decisions") {
    if (!body.p_project_id || !backend.ownedIds.includes(body.p_project_id)) return refuse("42501", "not the project owner", 403);
    const entry = backend.decisions[body.p_project_id] || { audience: [], opens: {}, members: [], points: [], answers: [], proposals: [] };
    const members = [...(entry.members || [])].sort(byTime);
    const inAudience = (memberId) => entry.audience.includes(memberId);
    const answersOf = (memberId, key) => entry.answers.filter((a) => a.member_id === memberId && (key === undefined || a.key === key)).sort(byTime);
    const row = (d) => ({ value: d.value, comment: d.comment, version: d.version, created_at: d.created_at });
    const points = [...entry.points]
      .sort((a, b) => (b.active !== false) - (a.active !== false) || a.position - b.position || a.key.localeCompare(b.key))
      .map((p) => {
        const counts = { yes: 0, change: 0, no: 0, unsure: 0, none: 0 };
        // Each person's newest answer on the point, whatever its version, counts only when it is on the current one: a
        // version that returns to an earlier one never brings back an answer the person later replaced.
        for (const memberId of entry.audience) {
          const latest = answersOf(memberId, p.key).at(-1);
          counts[latest && latest.version === p.version ? latest.value : "none"] += 1;
        }
        const people = members.filter((m) => inAudience(m.id) || answersOf(m.id, p.key).length).map((m) => {
          const history = answersOf(m.id, p.key);
          const latest = history.at(-1);
          return { member_id: m.id, display_name: m.display_name, in_audience: inAudience(m.id),
            latest: latest ? { ...row(latest), current: latest.version === p.version } : null, history: history.map(row) };
        });
        return { key: p.key, version: p.version, title: p.title, decided: p.decided, active: p.active !== false, counts, people };
      });
    const people = members.filter((m) => inAudience(m.id) || answersOf(m.id).length)
      .map((m) => ({ member_id: m.id, display_name: m.display_name, in_audience: inAudience(m.id), last_opened_at: (entry.opens || {})[m.id] || null }));
    const proposals = [...entry.proposals].sort(byTime).flatMap((x) => {
      const m = members.find((y) => y.id === x.member_id);
      return m ? [{ display_name: m.display_name, text: x.text, created_at: x.created_at }] : [];
    });
    return { data: { points, people, proposals } };
  }
  const entry = backend.decisions[body.p_project_id];
  const memberId = audienceMember(body.p_project_id);
  if (!memberId) return refuse("42501", "not in the list of this project", 403);
  const newest = (key) => entry.answers.filter((a) => a.member_id === memberId && a.key === key).sort(byTime).at(-1) || null;
  if (rpc === "my_decisions") {
    const opened = entry.opens[memberId] || null;
    const points = activePoints(entry).map((p) => {
      const mine = newest(p.key);
      const mark = !mine ? (!opened || Date.parse(p.firstPublishedAt) > Date.parse(opened) ? "new" : "none")
        : mine.version !== p.version ? "changed" : mine.value === "yes" ? "confirmed" : "none";
      return { key: p.key, version: p.version, position: p.position, title: p.title, decided: p.decided, basis: p.basis, mark,
        answer: mine ? { value: mine.value, comment: mine.comment, version: mine.version, created_at: mine.created_at } : null };
    });
    return { data: { last_opened_at: opened, points } };
  }
  if (rpc === "mark_decisions_opened") {
    entry.opens[memberId] = new Date().toISOString();
    return { empty: true };
  }
  if (rpc === "answer_decision") {
    const comment = typeof body.p_comment === "string" && /\S/.test(body.p_comment) ? body.p_comment.replace(/^ +| +$/g, "") : null;
    if (!["yes", "change", "no", "unsure"].includes(body.p_value)) return refuse("22023", "unknown value", 400);
    if (body.p_value !== "yes" && !comment) return refuse("22023", "a comment is required unless the answer is yes", 400);
    if (comment && [...comment].length > 4000) return refuse("22023", "the comment is over 4000 characters", 400);
    const point = entry.points.find((p) => p.key === body.p_key);
    if (!point || point.active === false) return refuse("P0002", "the point is not published", 404);
    if (body.p_version !== point.version) return refuse("PT409", "the point changed", 409);
    const answer = { id: randomUUID(), member_id: memberId, key: point.key, version: point.version, value: body.p_value, comment, created_at: new Date().toISOString() };
    entry.answers.push(answer);
    return { data: { id: answer.id, created_at: answer.created_at } };
  }
  if (rpc === "propose_decision") {
    const text = typeof body.p_text === "string" ? body.p_text.replace(/^ +| +$/g, "") : "";
    if (!/\S/.test(text)) return refuse("22023", "the text is required", 400);
    const id = randomUUID();
    entry.proposals.push({ id, member_id: memberId, text, created_at: new Date().toISOString() });
    return { data: id };
  }
  return refuse("42883", "unknown", 404);
}

function newBackend(html, flowHtml, demoHtml) {
  const backend = {
    requests: [], drafts: [], submits: [], draft: null, submittedAt: null, submitMode: "ok", authExpired: false,
    // The piece closure: responses stored before the run (with storage and partial), assignment fields set by hand
    // (patch: pieceId -> { status, updated_at }), more assignments, change requests, and the calls that made them.
    responses: [], patch: {}, extraAssignments: [], changeRequests: [], requestCalls: [], lateSubmits: [], requestMode: "ok", requestDelayMs: 0,
    readsExpired: false, expiredSaves: 0, draftBy: {}, saveFails: false, saveDelayMs: 0, logoutFails: false, draftUpdatedAt: null,
    // The project page: what owner_projects() answers (ownerRpcsMissing: an old database, 404 PGRST202; ownerRpcsFail: a
    // 500), and the mark_piece_opened calls (openedFails makes them fail, see the route).
    ownedProjects: [], ownerRpcsMissing: false, ownerRpcsFail: false, openedCalls: [], openedFails: null,
    // The owner's reads: the projects the session owns, what owner_project and owner_piece answer for them, and the calls.
    ownedIds: [], ownerView: {}, ownerPieces: {}, ownerCalls: [],
    // The «Decisiones» section: projectId -> its rows (decisionsServer); the calls; answerMode "network", answerDelayMs and
    // answerDelayByKey (point key -> ms, over answerDelayMs) for answer_decision; myDecisionsFails (my_decisions offline);
    // decisionsOpenedFails as openedFails.
    decisions: {}, decisionCalls: [], answerMode: "ok", answerDelayMs: 0, answerDelayByKey: {}, myDecisionsFails: false, decisionsOpenedFails: null,
    // The project of a piece, from every piece the stand-in knows (the person's and the owner's views).
    pieceProject(pieceId) {
      const own = backend.pieces.find((p) => p.id === pieceId);
      if (own) return own.project_id;
      return Object.keys(backend.ownerView).find((id) => (backend.ownerView[id].pieces || []).some((p) => p.id === pieceId)) || null;
    },
    members: [{ id: IDS.member, project_id: IDS.project, email: USER.email, user_id: USER.id, role: "client", display_name: "Ana Pérez" }],
    projects: [{ id: IDS.project, slug: "portal-test", name: "Portal de prueba", language: "es" }],
    pieces: [
      { id: IDS.questions, project_id: IDS.project, kind: "questions", title: "Preguntas sobre Biblioteca del barrio", revision: 1, language: "es", created_at: "2026-10-16T15:00:00Z" },
      { id: IDS.flow, project_id: IDS.project, kind: "flow_review", title: "Recorrido de flujos v2", revision: 2, language: "es", created_at: "2026-10-10T15:00:00Z" },
      { id: IDS.demo, project_id: IDS.project, kind: "demo_review", title: "Demo v2", revision: 2, language: "es", created_at: "2026-10-09T15:00:00Z" },
      { id: IDS.replaced, project_id: IDS.project, kind: "demo_review", title: "Demo v1", revision: 1, language: "es", created_at: "2026-10-01T15:00:00Z" },
    ],
    html: { [IDS.questions]: html, [IDS.flow]: flowHtml || "<!doctype html><title>x</title>", [IDS.demo]: demoHtml || "<!doctype html><title>x</title>" },
    // Every response row: the ones stored before the run, then one per send of this run (newest send time last).
    responseRows() {
      return [...backend.responses, ...backend.submits.map((s, i) => ({ id: `r${i + 1}`, piece_id: s.p_piece_id, member_id: IDS.member,
        submitted_at: s.submitted_at || backend.submittedAt, storage: s.p_storage ?? null, partial: false }))];
    },
    // As private.assignment_closed: received, or replaced after a response that is not partial.
    closedOnServer(pieceId) {
      const row = backend.assignments(USER.id).find((a) => a.piece_id === pieceId);
      return Boolean(row) && (row.status === "received" ||
        (row.status === "replaced" && backend.responseRows().some((r) => r.piece_id === pieceId && r.partial === false)));
    },
    assignments() {
      return backend.baseAssignments().concat(backend.extraAssignments).map((a) => (backend.patch[a.piece_id] ? { ...a, ...backend.patch[a.piece_id] } : a));
    },
    baseAssignments() {
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
// Home lists projects: open one (the person's, by default) and wait for its list of what was asked.
async function openProject(page, projectId = IDS.project) {
  await page.waitForSelector(`a[href="#/project/${projectId}"]`, { timeout: 10000 });
  await page.click(`a[href="#/project/${projectId}"]`);
  await page.waitForSelector('.row-link[href^="#/piece/"]', { timeout: 10000 });
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
  const projects = await page.evaluate(() => ({ lang: document.documentElement.lang, h1: document.querySelector("h1")?.textContent }));
  check("app: project language (es) wins over browser (en-US)", projects.lang === "es" && projects.h1 === "Tus proyectos", `${projects.lang} · ${projects.h1}`);
  check("app: home 360px no horizontal scroll", await noHorizontalScroll(page));
  await page.screenshot({ path: join(outDir, "home-360.png"), fullPage: true });
  const projectsAxe = await axeViolations(page);
  if (projectsAxe) check("app: axe on home has no violations", projectsAxe.length === 0, projectsAxe.join(", "));
  // The pieces are on the project's page, one step from home.
  await openProject(page);
  const home = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".row")].map((r) => r.textContent) }));
  check("app: the project page lists the assigned pieces, without the replaced version", home.rows.length === 3 && !home.rows.some((r) => r.includes("Demo v1")), JSON.stringify(home.rows));
  check("app: statuses in words", home.rows[0].includes("Por empezar") && home.rows[1].includes("Enviada"));
  check("app: the three kinds have their label", ["Preguntas", "Revisión de recorridos", "Revisión de la demo"].every((label) => home.rows.some((r) => r.includes(label))), JSON.stringify(home.rows));
  check("app: list query never asks for pieces.html",
    backend.requests.filter((r) => r.includes("/rest/v1/pieces")).every((r) => !decodeURIComponent(r).includes("html")));
  check("app: project page 360px no horizontal scroll", await noHorizontalScroll(page));
  await page.screenshot({ path: join(outDir, "project-360.png"), fullPage: true });
  const homeAxe = await axeViolations(page);
  if (homeAxe) check("app: axe on the project page has no violations", homeAxe.length === 0, homeAxe.join(", "));
  // On its own page: resizing this one breaks clicks into the piece iframe later (headless Chrome).
  const wide = await context.newPage();
  await wide.setViewportSize({ width: 1440, height: 900 });
  await wide.goto(`${base}/`, { waitUntil: "networkidle" });
  await wide.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
  await wide.screenshot({ path: join(outDir, "home-1440.png"), fullPage: true });
  await openProject(wide);
  await wide.screenshot({ path: join(outDir, "project-1440.png"), fullPage: true });
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
  check("app: after the server saved, the piece shows its sent screen", sent && sent.sent && sent.text.split("\n").some(isLine(QUESTIONS_SENT)), sent ? sent.error : "");
  const order = backend.requests.filter((r) => r.includes("rpc/"));
  const saveWithTime = backend.drafts.findIndex((d) => JSON.parse(d.p_storage[QUESTIONS_KEY]).enviada_en === body.p_payload.enviada_en);
  // Position, among all RPC calls, of the save_draft that carried the send time.
  const savePositions = order.map((r, i) => (r === "POST /rest/v1/rpc/save_draft" ? i : -1)).filter((i) => i !== -1);
  check("app: the draft with the send time was saved before submit_response", saveWithTime !== -1 &&
    savePositions[saveWithTime] < order.indexOf("POST /rest/v1/rpc/submit_response"), order.join(" > "));
  // The piece shows its own send date («Enviado el …» on its sent screen): the portal's line does not repeat it.
  await sleep(1200); // the draft with the send time has been saved
  const afterSend = await page.textContent(".piece-status");
  check("app: the status line does not repeat the send date the piece already shows", !afterSend.includes("Enviada"), afterSend);
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
    offline.text.includes("No se pudieron enviar") && !offline.text.split("\n").some(isLine(QUESTIONS_SENT)), offline ? offline.error : "no result");
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
  await steadyClick(page.locator("text=Entrar de nuevo"));
  await page.waitForSelector("#email", { timeout: 10000 });
  backend.authExpired = false;
  await page.fill("#email", USER.email);
  await page.click("button[type=submit]");
  await page.waitForSelector("#code", { timeout: 10000 });
  await page.fill("#code", "1".repeat(await page.evaluate(async () => (await import("./config.js")).EMAIL_OTP_LENGTH)));
  await openProject(page);
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  frame = await appPiece(page);
  const back = frame && await frame.evaluate(() => ({ n: respondidas(), quien: ST.respuestas["q-002"] && ST.respuestas["q-002"].quien }));
  check("app: after signing in again the answers come back from piece_drafts", back && back.n === 2 && back.quien === "Luis", JSON.stringify(back));
  const before = backend.submits.length;
  await sendQuestions(frame);
  const resent = await settledSend(frame);
  check("app: after signing in again, sending works", resent && resent.sent && backend.submits.length === before + 1);
  check("app: no dialogs on the way", dialogs.length === 0, JSON.stringify(dialogs));

  // Back to the project: the list reflects the new status; reopen restores from the server draft.
  await page.click(".back-link");
  await page.waitForSelector('.row-link[href^="#/piece/"]', { timeout: 10000 });
  const rows = await page.$$eval(".row", (els) => els.map((e) => e.textContent));
  check("app: back on the project page shows the piece as sent", rows.every((r) => r.includes("Enviada")), JSON.stringify(rows));
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
  check("app: sign-out with unsaved changes asks before losing them", askOut && askOut.h1 === "Portal de prueba", askOut ? askOut.text : "no notice");
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

  // Empty state: signed in, nothing assigned. The message says nothing is here yet; the notice asks to check the email.
  const emptyBackend = newBackend(html);
  emptyBackend.members = [];
  const emptyContext = await mockedContext(browser, { backend: emptyBackend, width: 320, locale: "es-CO" });
  const emptyPage = await emptyContext.newPage();
  await emptyPage.goto(`${base}/`, { waitUntil: "networkidle" });
  await emptyPage.waitForSelector(".empty", { timeout: 10000 }).catch(() => {});
  const empty = await emptyPage.evaluate(() => ({
    title: document.querySelector(".empty h2")?.textContent,
    action: document.querySelector(".empty [data-rol=accion-principal]")?.textContent,
    otherEmail: [...document.querySelectorAll(".empty .notice .notice-actions button")].map((b) => b.textContent),
  }));
  // accion (home-empty, judges round 5): what to do while nothing has arrived is to look again, so «Actualizar» is the view's
  // main action; signing in with another email is the notice's own action, next to what explains it.
  check("app: empty state explains, its main action is «Actualizar», and its notice offers another email", empty.title === "Aquí verás lo que te compartan" &&
    empty.action === "Actualizar" && JSON.stringify(empty.otherEmail) === JSON.stringify(["Entrar con otro correo"]), JSON.stringify(empty));
  check("app: empty state 320px no horizontal scroll", await noHorizontalScroll(emptyPage));
  await emptyPage.screenshot({ path: join(outDir, "home-empty-320.png"), fullPage: true });
  await snapshot(emptyPage, "home-empty", "lista");
  // anatomia-del-patron and accion (home-empty): the empty home is the list it replaces, with one row. The list's own top
  // rule (the base's .rows), never a rule of the empty state's own; its title, message and notice on the title's edge as
  // every other screen's body. «Entrar con otro correo» lives inside the notice that explains it, as the notice's own
  // action (the base's link action in its .notice-actions); «Actualizar», the page's primary action, comes right after the
  // notice, in the same column and at every width, as on sign-in the action goes under its field: as wide as the body up to
  // the form measure like the sign-in buttons, on the same edge. Nothing of the row sits apart on its right. Both are 44 px
  // targets at every width (FUN-18). The view does not reach FUN-43's 60 %: its exception is in GEOMETRY_EXCEPTIONS.
  for (const width of [320, 768, 1440]) {
    await emptyPage.setViewportSize({ width, height: width < 672 ? 640 : 900 });
    const g = await emptyPage.evaluate(() => {
      const textBox = (el) => { if (!el) return null; const r = document.createRange(); r.selectNodeContents(el); const q = [...r.getClientRects()].filter((x) => x.width > 0);
        return q.length ? { x: Math.round(Math.min(...q.map((x) => x.left))), der: Math.round(Math.max(...q.map((x) => x.right))),
          top: Math.round(Math.min(...q.map((x) => x.top))), bottom: Math.round(Math.max(...q.map((x) => x.bottom))) } : null; };
      const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), der: Math.round(r.right), w: Math.round(r.width), top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
      const body = document.querySelector("[data-rol=cuerpo]");
      const form = document.createElement("div"); form.style.width = "var(--measure-form)"; body.append(form);
      const measure = Math.round(form.getBoundingClientRect().width); form.remove();
      const bodyBox = body.getBoundingClientRect(), cs = getComputedStyle(body);
      const vacio = document.querySelector("[data-rol=vacio]");
      const action = document.querySelector("[data-rol=vacio] [data-rol=accion-principal]");
      const other = [...document.querySelectorAll("[data-rol=vacio] button")].find((b) => b.textContent === "Entrar con otro correo");
      const group = action && action.closest(".empty-actions");
      const ruled = (el) => { const s = getComputedStyle(el); return parseFloat(s.borderTopWidth) > 0 && s.borderTopStyle !== "none"; };
      const list = vacio && (vacio.matches(".rows") ? vacio : vacio.querySelector(".rows"));
      const notice = document.querySelector("[data-rol=vacio] .notice");
      const hint = notice && notice.querySelector(":scope > p");
      return { h1: textBox(document.querySelector("h1"))?.x ?? null, title: textBox(document.querySelector("[data-rol=vacio] h2")),
        message: textBox(document.querySelector("[data-rol=vacio] .row-main > p")), messageText: document.querySelector("[data-rol=vacio] .row-main > p")?.textContent ?? null,
        notice: notice ? { box: box(notice), text: hint ? hint.textContent : null, textBox: textBox(hint), className: notice.className, inMain: Boolean(notice.parentElement && notice.parentElement.matches(".row-main")),
          afterMessage: Boolean(notice.previousElementSibling && notice.previousElementSibling.matches("p")), stripe: getComputedStyle(notice).borderInlineStartWidth,
          accent: getComputedStyle(notice).borderInlineStartColor, muted: (() => { const el = document.createElement("span"); el.style.color = "var(--muted)"; body.append(el);
            const c = getComputedStyle(el).color; el.remove(); return c; })() } : null,
        action: box(action), actionText: action ? action.textContent : null, actionPrimary: Boolean(action && action.matches(".button.button--primary")),
        // «Entrar con otro correo»: the notice's own action, as every notice carries its actions (the base's .notice-actions),
        // drawn as the base's link action, never the primary button.
        other: other ? { box: box(other), inNotice: Boolean(notice && other.closest(".notice-actions") && notice.contains(other)),
          link: other.matches(".link-button") && !other.matches(".button") } : null,
        body: { x: Math.round(bodyBox.left + parseFloat(cs.paddingLeft)), der: Math.round(bodyBox.right - parseFloat(cs.paddingRight)),
          w: Math.round(bodyBox.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) }, measure,
        list: Boolean(list), rows: list ? list.querySelectorAll(":scope > .row").length : 0, listRule: Boolean(list && ruled(list)),
        // The way out: one group, the last thing in the row's main column and right after the notice; no aside in the row.
        afterNotice: Boolean(group && notice && group.parentElement === notice.parentElement && group.previousElementSibling === notice &&
          !group.nextElementSibling && group.parentElement.matches(".row-main") && list && list.contains(group)),
        // The group holds the main action only; the row has no other control outside the notice.
        groupOnly: Boolean(group && group.querySelectorAll("button, a").length === 1),
        loose: vacio ? [...vacio.querySelectorAll("button, a")].filter((el) => el !== action && !(notice && notice.contains(el))).map((el) => el.textContent) : null,
        asides: vacio ? vacio.querySelectorAll(".row-aside").length : null,
        // Only the list draws a top rule: the empty state, the row and what holds its text, none. A control's own border and the
        // base's section notice (its sheet, the component's own) are not rules of the empty state.
        otherRules: vacio ? [vacio, ...vacio.querySelectorAll("*")].filter((el) => el !== list && !el.matches("button, a, input, .notice") && ruled(el))
          .map((el) => el.className || el.tagName) : null };
    });
    const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;
    check(`home-empty ${width}px: the empty home is the list it replaces: one row of the base's list, its top rule the list's, its way out right after the notice in the row's main column, no aside`,
      g.list && g.rows === 1 && g.listRule && g.afterNotice && g.groupOnly && Array.isArray(g.loose) && g.loose.length === 0 && g.asides === 0 &&
      Array.isArray(g.otherRules) && g.otherRules.length === 0,
      JSON.stringify(g));
    check(`home-empty ${width}px: its title and its message start on the title's edge, not centred`,
      g.h1 !== null && g.title && near(g.title.x, g.h1) && g.message && near(g.message.x, g.h1), JSON.stringify(g));
    // aviso-de-seccion: what asks the person to check their email is the base's section notice (information: the grey stripe,
    // never the signal), in the row under the message and on the same edge; the message says only that nothing is here yet.
    check(`home-empty ${width}px: «${EMPTY.hint}» is the base's information notice, in the row under the message, on the title's edge`,
      g.notice && g.notice.text === EMPTY.hint && g.notice.className === "notice" && g.notice.inMain && g.notice.afterMessage &&
      parseFloat(g.notice.stripe) > 1 && g.notice.accent === g.notice.muted && near(g.notice.box.x, g.h1) &&
      g.messageText === EMPTY.body(USER.email) && !g.messageText.includes(EMPTY.hint), JSON.stringify({ notice: g.notice, message: g.messageText }));
    check(`home-empty ${width}px: its main action and the notice's «Entrar con otro correo» are 44 px targets (FUN-18)`,
      g.action && g.action.h >= 44 && g.other && g.other.box.h >= 44, JSON.stringify({ action: g.action, other: g.other }));
    // accion (home-empty, judges round 5): «Actualizar» is the view's primary button, right under the notice, at most a gap
    // of the scale's 16 px, on the title's edge, never on the row's right; «Entrar con otro correo» is the notice's own
    // action, the base's link action inside it, on its text's edge.
    check(`home-empty ${width}px: right under the notice, «Actualizar» is the primary button, as wide as the body up to the form measure as the sign-in buttons are`,
      g.action && g.notice && g.actionText === "Actualizar" && g.actionPrimary && g.action.top >= g.notice.box.bottom &&
      g.action.top - g.notice.box.bottom <= 16 && near(g.action.x, g.h1) && near(g.action.w, Math.min(g.body.w, g.measure)), JSON.stringify(g));
    check(`home-empty ${width}px: «Entrar con otro correo» is the notice's own action, the base's link action, under its text on its edge`,
      g.other && g.other.inNotice && g.other.link && g.notice && g.notice.textBox && near(g.other.box.x, g.notice.textBox.x) &&
      g.other.box.top >= g.notice.textBox.bottom && g.other.box.bottom <= g.notice.box.bottom, JSON.stringify({ other: g.other, notice: g.notice }));
    if (width >= 672) await emptyPage.screenshot({ path: join(outDir, `home-empty-${width}.png`) });
  }
  await emptyContext.close();
}

// The piece screen has one frame: the portal's masthead with the brand on top, then «Volver» and the
// title band in the same container and on the same left edge, and the piece's content on that edge too
// (keeping its reading measure); the piece hides its own brand bar inside the portal (the bridge marks
// its <html> before it is parsed), and shows it when opened on its own. Opening a piece says nothing
// about saving until the person changes something. Checked at the review widths (320, 768, 1440, light
// and dark; at 1440 the frame is at its cap) and at the verification widths 672 (where the margin changes)
// and 1056 (where the pieces add their side column).
async function pieceViewChecks(browser, base, html, flowHtml, demoHtml) {
  const layoutOf = (page) => page.evaluate(() => {
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, bottom: r.bottom }; };
    const marks = [...document.querySelectorAll("[data-rol=marca-producto]")].filter(visible);
    const frame = document.querySelector("[data-rol=marco]");
    const back = document.querySelector(".back-link");
    // The frame's right edge (its content box): where a piece's side column ends.
    const frameRight = frame ? frame.getBoundingClientRect().right - parseFloat(getComputedStyle(frame).paddingRight) : null;
    return {
      marks: marks.length, name: marks[0] && marks[0].textContent, logo: Boolean(marks[0] && marks[0].querySelector("svg")),
      brand: marks[0] ? { ...box(marks[0]), frameRight } : null, back: box(back), title: box(document.querySelector("h1.piece-title")),
      sameFrame: Boolean(frame && marks[0] && back && frame.contains(marks[0]) && frame.contains(back)),
      scroll: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  // Inside the piece: is its own bar (and anything saying «ninben») on screen?
  const pieceBar = (frame) => frame.evaluate(() => {
    const bar = document.querySelector("header.bar");
    const shown = (el) => Boolean(el) && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
    const home = document.getElementById("homeBtn");
    return { host: document.documentElement.getAttribute("data-factory-host"), bar: shown(bar),
      brand: shown(document.querySelector("header.bar .brand")), where: [...document.querySelectorAll("header.bar .where")].some(shown),
      homeButton: shown(home), ninben: document.body.innerText.includes("ninben") };
  });
  // Where the piece's content starts, in the portal page's coordinates: every visible top-level block of the
  // screen (the children of the piece's body and of its columns: main, #app, #view, .frame, .view, .layout, .main-col)
  // must start on the brand's edge, but a side column (the .layout's <aside>, from 1056), which starts on its own
  // column's edge (MAR-10) and ends on the frame's right edge (MAR-13); plus the «Ver todos los flujos» link and the width of three texts the person reads:
  // the questions' (the first paragraph of the sheet's body, .flow > p), the sentence in the flows' title band
  // (.heading > p: how many flows, steps and minutes, or what is left) and the text of a step (.step-intro > p).
  // null when there is no piece to measure (it did not open, or its frame went away): the check that reads it fails, the
  // run goes on.
  const contentOf = async (page, frame) => {
    if (!frame) return null;
    const offset = await page.evaluate(() => { const f = document.querySelector("iframe.piece-frame"); return f ? f.getBoundingClientRect().left + f.clientLeft : null; });
    if (offset === null) return null;
    const inner = await frame.evaluate(() => {
      const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(el).visibility !== "hidden"; };
      const containers = [...document.querySelectorAll("main, main #app, main #view, main .frame, main .view, main .layout, main .main-col")].filter(shown);
      const blocks = [...new Set(containers.flatMap((c) => [...c.children]))].filter((el) => shown(el) && el.tagName !== "NOSCRIPT");
      const name = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.classList.length ? "." + [...el.classList].join(".") : ""}`;
      const reading = [...document.querySelectorAll("main .flow > p")].find(shown);
      const flowReading = [...document.querySelectorAll("main .view .heading > p")].find(shown);
      const stepReading = [...document.querySelectorAll("main .step-intro > p")].find(shown);
      const home = document.getElementById("homeBtn");
      return { blocks: blocks.map((el) => ({ name: name(el), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right,
          side: el.matches(".layout > aside") })),
        home: home && shown(home) ? home.getBoundingClientRect().left : null, flowReading: flowReading ? flowReading.getBoundingClientRect().width : null,
        stepReading: stepReading ? stepReading.getBoundingClientRect().width : null,
        reading: reading ? reading.getBoundingClientRect().width : null };
    }).catch(() => null);
    if (!inner) return null;
    const blocks = inner.blocks.map((b) => ({ ...b, left: b.left + offset, right: b.right + offset }));
    return { blocks, home: inner.home === null ? null : inner.home + offset, flowReading: inner.flowReading, stepReading: inner.stepReading, reading: inner.reading };
  };
  // Every top-level block on the brand's edge (±1 px), and a side column ending on the frame's right edge; the
  // detail names the ones that are not. With no brand on screen or no piece measured, this one check fails.
  const onEdge = (tag, what, content, brand) => {
    if (!brand || !content) {
      check(`${tag}: ${what}: every top-level block starts on the brand's left edge`, false, JSON.stringify({ brand: Boolean(brand), content: Boolean(content) }));
      return;
    }
    const off = content.blocks.filter((b) => (b.side ? Math.abs(b.right - brand.frameRight) > 1 : Math.abs(b.left - brand.left) > 1));
    const sides = content.blocks.filter((b) => b.side).length;
    check(`${tag}: ${what}: every top-level block starts on the brand's left edge${sides ? " and the side column ends on the frame's right edge" : ""}`,
      content.blocks.some((b) => !b.side) && off.length === 0,
      JSON.stringify({ brand: brand.left, frameRight: brand.frameRight, blocks: content.blocks.length, sides, off: off.slice(0, 4) }));
  };
  const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;
  // Opened and left alone: no «Guardando…» (nor any save line) and nothing sent to save_draft.
  const quietOpen = async (tag, page, backend) => {
    await sleep(2000); // longer than the draft debounce (800 ms) and a save
    const line = await page.evaluate(() => { const s = document.querySelector(".piece-status"); return s && !s.hidden ? s.textContent : ""; });
    check(`${tag}: opened and left alone, the portal says nothing about saving and saves nothing`, line === "" && backend.drafts.length === 0,
      `«${line}» · ${backend.drafts.length} save_draft call(s)`);
  };
  async function openInApp(width, scheme, pieceId, ready) {
    const backend = newBackend(html, flowHtml, demoHtml);
    // A phone is 640 px high (MAR-14), so the judge's captures at 320 are 320 x 640.
    const context = await mockedContext(browser, { backend, width, height: width < 672 ? PHONE.height : 780, locale: "es-CO" });
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/#/piece/${pieceId}`, { waitUntil: "networkidle" });
    const frame = await waitFor(async () => { const f = pieceFrame(page); return f && (await f.evaluate(ready).catch(() => false)) ? f : null; }, 10000);
    return { backend, context, page, frame, errors };
  }
  const runs = [[320, "light"], [320, "dark"], [672, "light"], [768, "light"], [768, "dark"], [1056, "light"], [1440, "light"], [1440, "dark"]];
  // The piece's start view inside the real portal (the portal's bar, «← Volver», the title band and the piece's top
  // edge), at the review widths in light: the input of the factory's `marco-del-anfitrion` judge (docs/releasing.md).
  const hostShot = (page, piece, width, scheme) => (scheme === "light" && [320, 768, 1440].includes(width)
    ? page.screenshot({ path: join(outDir, `host-${piece}-w${width}-light.png`) }) : null);

  for (const [width, scheme] of runs) {
    const tag = `piece view ${width}px ${scheme}`;
    const { backend, context, page, frame, errors } = await openInApp(width, scheme, IDS.questions, () => typeof respondidas === "function");
    const layout = await layoutOf(page);
    check(`${tag}: one brand on screen, the portal's (logo and «ninben»)`, layout.marks === 1 && layout.name === "ninben" && layout.logo, JSON.stringify(layout));
    check(`${tag}: the brand is above «Volver», and «Volver» above the title`, layout.brand && layout.back && layout.title &&
      layout.brand.bottom <= layout.back.top && layout.back.bottom <= layout.title.top, JSON.stringify([layout.brand, layout.back, layout.title]));
    check(`${tag}: brand, «Volver» and the title share the left edge, in the same container`, layout.sameFrame &&
      near(layout.brand?.left, layout.back?.left) && near(layout.brand?.left, layout.title?.left), JSON.stringify([layout.brand?.left, layout.back?.left, layout.title?.left]));
    check(`${tag}: no horizontal scroll`, layout.scroll);
    const bar = frame ? await pieceBar(frame) : null;
    check(`${tag}: the piece's own brand bar is not shown inside the portal`, bar && bar.host === "portal" && !bar.bar && !bar.ninben, JSON.stringify(bar));
    const content = frame && await contentOf(page, frame);
    onEdge(tag, "start", content, layout.brand);
    // A missing reading text fails: a null width is not a measure.
    check(`${tag}: the questions keep their reading measure (680 px at most)`, content && typeof content.reading === "number" && content.reading <= 680,
      JSON.stringify(content && content.reading));
    if (width === 320 || width === 1440) await page.screenshot({ path: join(outDir, `piece-view-${width}-${scheme}.png`) });
    await hostShot(page, "questions", width, scheme);
    await quietOpen(tag, page, backend);
    // The first change the person makes is saved, with what the piece wrote while it opened.
    if (frame) await frame.evaluate(() => responder("q-001", "si"));
    const saved = frame && await waitFor(async () => (await page.textContent(".piece-status")).includes("Guardado"), 5000);
    const opened = backend.draft && JSON.parse(backend.draft[QUESTIONS_KEY]).abierta_en;
    check(`${tag}: the first change says «Guardado» and carries the opening time the piece wrote`, saved && opened, String(opened));
    if (frame) await frame.evaluate(() => showReview());
    onEdge(tag, "review", await contentOf(page, frame), layout.brand);
    if (frame) await sendQuestions(frame);
    const sentShown = frame && await waitFor(async () => (await frameText(frame)).split("\n").some(isLine(QUESTIONS_SENT)), 8000);
    check(`${tag}: the piece sends and shows its sent screen`, sentShown);
    onEdge(tag, "sent", await contentOf(page, frame), layout.brand);
    check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // The flow review in the portal: no brand bar at the list of flows; inside a flow only «Ver todos los
  // flujos» stays (without the logo or the «where»), on the brand's edge, and it goes back to the list.
  if (flowHtml) {
    for (const [width, scheme] of runs) {
      const tag = `flow in the portal ${width}px ${scheme}`;
      const { backend, context, page, frame, errors } = await openInApp(width, scheme, IDS.flow, () => typeof openFlow === "function");
      const brand = (await layoutOf(page)).brand;
      const atList = frame && await pieceBar(frame);
      check(`${tag}: the list of flows shows no brand bar`, atList && atList.host === "portal" && !atList.bar && !atList.ninben, JSON.stringify(atList));
      const list = frame && await contentOf(page, frame);
      onEdge(tag, "list of flows", list, brand);
      // A missing reading text fails: a null width is not a measure.
      check(`${tag}: the sentence of the flows' title band keeps its reading measure (680 px at most)`,
        list && typeof list.flowReading === "number" && list.flowReading <= 680, JSON.stringify(list && list.flowReading));
      if (scheme === "light" && (width === 768 || width === 1440)) await page.screenshot({ path: join(outDir, `piece-view-flow-start-${width}.png`) });
      await hostShot(page, "flow", width, scheme);
      await quietOpen(tag, page, backend);
      if (frame) await frame.evaluate(() => openFlow(IDS[0]));
      const inFlow = frame && await pieceBar(frame);
      check(`${tag}: inside a flow only «Ver todos los flujos» stays, without logo or «where»`,
        inFlow && inFlow.homeButton && !inFlow.brand && !inFlow.where && !inFlow.ninben, JSON.stringify(inFlow));
      const banners = frame ? await frame.getByRole("banner").count() : -1;
      check(`${tag}: inside a flow the piece has no banner of its own (the portal's masthead is the one)`, banners === 0, `${banners} banner(s)`);
      const walk = frame && await contentOf(page, frame);
      // A missing step text fails too: a null width is not a measure.
      check(`${tag}: inside a flow, the text of the step keeps its reading measure (680 px at most)`,
        walk && typeof walk.stepReading === "number" && walk.stepReading <= 680, JSON.stringify(walk && walk.stepReading));
      check(`${tag}: inside a flow, «Ver todos los flujos» starts on the brand's left edge`, walk && near(walk.home, brand?.left), JSON.stringify({ brand: brand?.left, home: walk && walk.home }));
      onEdge(tag, "inside a flow", walk, brand);
      if (width === 320 && scheme === "light") await page.screenshot({ path: join(outDir, "piece-view-flow-320.png") });
      if (width === 1440) await page.screenshot({ path: join(outDir, `piece-view-flow-1440-${scheme}.png`) });
      if (frame) {
        // The screen with a note being written on the sketch.
        await frame.getByRole("button", { name: "Anotar una observación", exact: true }).click();
        await sleep(300);
        onEdge(tag, "writing a note", await contentOf(page, frame), brand);
        if (width === 1440 && scheme === "light") await page.screenshot({ path: join(outDir, "piece-view-flow-note-1440.png") });
      }
      if (frame) await frame.click("#homeBtn");
      const back = frame && await waitFor(async () => { const s = await pieceBar(frame); return !s.homeButton && !s.bar ? s : null; }, 3000);
      check(`${tag}: «Ver todos los flujos» goes back to the list`, back, JSON.stringify(back));
      // Every flow reviewed: the final screen (the notes per flow before sending), then the sent screen.
      if (frame) await frame.evaluate(() => { usarRevisor("Ana Pérez"); for (const id of IDS) { const st = fs(id); st.veredicto = "ok"; st.estado = "ok"; } save(); home(); });
      const final = frame && await frame.evaluate(() => Boolean(document.querySelector('[data-view="summary"]')));
      check(`${tag}: the final screen opens`, final);
      onEdge(tag, "final screen", frame && await contentOf(page, frame), brand);
      if (scheme === "light" && (width === 768 || width === 1440)) await page.screenshot({ path: join(outDir, `piece-view-flow-final-${width}.png`) });
      if (frame) await frame.evaluate(() => submitReview());
      const flowSent = frame && await waitFor(async () => (await frameText(frame)).split("\n").some(isLine(FLOW_SENT)), 8000);
      check(`${tag}: the review is sent and the piece shows its sent screen`, flowSent);
      onEdge(tag, "sent", frame && await contentOf(page, frame), brand);
      check(`${tag}: one brand on screen, the portal's`, (await layoutOf(page)).marks === 1);
      check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }

  // The demo sheet in the portal: no brand bar, its content on the brand's edge.
  if (demoHtml) {
    for (const [width, scheme] of runs) {
      const tag = `demo in the portal ${width}px ${scheme}`;
      const { backend, context, page, frame, errors } = await openInApp(width, scheme, IDS.demo, () => Boolean(document.querySelector("#app h1")));
      const brand = (await layoutOf(page)).brand;
      const bar = frame && await pieceBar(frame);
      check(`${tag}: the sheet shows no brand bar`, bar && bar.host === "portal" && !bar.bar && !bar.ninben, JSON.stringify(bar));
      onEdge(tag, "the sheet", frame && await contentOf(page, frame), brand);
      // The opening text of the sheet (what to do with the demo) keeps the reading measure; a missing text fails: a null
      // width is not a measure.
      const opening = frame && await frame.evaluate(() => {
        const p = [...document.querySelectorAll("main .intro > p")].find((el) => el.getBoundingClientRect().width > 1);
        return p ? p.getBoundingClientRect().width : null;
      });
      check(`${tag}: the sheet's opening text keeps its reading measure (680 px at most)`, typeof opening === "number" && opening <= 680, JSON.stringify(opening));
      if (width === 1440) await page.screenshot({ path: join(outDir, `piece-view-demo-1440-${scheme}.png`) });
      await hostShot(page, "demo", width, scheme);
      await quietOpen(tag, page, backend);
      if (frame) await sendButton(frame).click();
      const demoSent = frame && await waitFor(async () => (await frameText(frame)).split("\n").some(isLine(DEMO_SENT)), 8000);
      check(`${tag}: the sheet sends and shows its sent screen`, demoSent);
      onEdge(tag, "sent", frame && await contentOf(page, frame), brand);
      check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }

  // Each piece opened on its own (a downloaded or loose file): its brand bar is there, as before.
  const alone = [["questions", html], ["flow", flowHtml], ["demo", demoHtml]].filter(([, h]) => h);
  for (const [name, pieceHtml] of alone) {
    const context = await browser.newContext({ viewport: { width: 320, height: 780 } });
    const page = await context.newPage();
    await page.setContent(pieceHtml, { waitUntil: "load" });
    const own = await pieceBar(page.mainFrame());
    check(`${name} on its own: no portal mark, and its brand bar shows the logo and «ninben»`, own.host === null && own.bar && own.brand && own.ninben, JSON.stringify(own));
    if (name === "flow") {
      await page.evaluate(() => openFlow(IDS[0]));
      const inFlow = await pieceBar(page.mainFrame());
      check("flow on its own: inside a flow the bar keeps the brand and «Ver todos los flujos»", inFlow.bar && inFlow.brand && inFlow.homeButton, JSON.stringify(inFlow));
      check("flow on its own: its bar is still the page's banner", (await page.getByRole("banner").count()) === 1);
    }
    await context.close();
  }
}

// ---- the piece screen on a phone (MAR-14) ------------------------------------------------------
//
// Below 672 px the piece's content scrolls with the page: the portal sizes the iframe to the piece's height (the bridge's
// factory:height) and scrolls its own page when the piece asks (factory:scroll). At 320 x 640, with a project of a long
// name: at rest the title band ends at 160 px or less (with a title of TITLE_MAX characters too), «← Volver» is one line
// named «Volver a <project>»; the iframe is as tall as the piece (no scrolling of its own) and the page is taller than the
// screen; one screen down nothing fixed or sticky is on top; «Siguiente» at the bottom of the sheet shows the new step's
// title, a link of the flows' index its group, a focused field is inside the window, and an opened <details> grows the
// iframe. A piece that grows again in the same rendering frame as its iframe's resize still ends with the right height,
// and there the resize event comes before the ResizeObserver (the bridge's loop guard counts on it). Run in every engine
// given (Chromium; WebKit when playwright-core has it installed).
const PHONE = { width: 320, height: 640 };
const PHONE_FRAME_MAX = 160; // a quarter of a 640 px screen (MAR-14)
const LONG_PROJECT = "Biblioteca del barrio San Martín de Porres: préstamos, socios y avisos para los vecinos";
// The longest piece title the factory's publisher lets through (its portal_publish.py pins the same number): what fits
// in two lines of the piece's title at 320 px. Measured on this screen at 320 x 640 (Inter 600 16/20.8 px, 288 px wide):
// normal Spanish running-text titles take a third line from 66 to 74 characters on, title-case ones from 65; 60 keeps
// a margin for an unlucky break. The check's title is the earliest-breaking of those, at exactly TITLE_MAX characters.
const TITLE_MAX = 60;
// A project name of two lines of running text at 320 px (24 px type); PROJECT_TITLE_MAX is the longest that keeps two lines.
const PROJECT_TWO_LINES = "Tienda virtual de artesanías";
const TITLE_AT_MAX = "Demo de la tienda virtual de artesanías: catálogo y compras.";
if (TITLE_AT_MAX.length !== TITLE_MAX) throw new Error(`TITLE_AT_MAX is ${TITLE_AT_MAX.length} characters, not ${TITLE_MAX}`);
// The longest title of a «Decisiones» point the factory publishes (its decisions.py pins the same number): the pieces' TITLE_MAX,
// because on a phone the owner's point takes the piece screen's title band (16 px, the same 288 px at 320), at exactly that.
const DECISION_TITLE_MAX = TITLE_MAX;
const DECISION_TITLE_AT_MAX = "Un viaje cuenta cuando quien conduce y quien viaja confirman";
if (DECISION_TITLE_AT_MAX.length !== DECISION_TITLE_MAX) throw new Error(`DECISION_TITLE_AT_MAX is ${DECISION_TITLE_AT_MAX.length} characters, not ${DECISION_TITLE_MAX}`);
// A piece of 1000 px that grows 200 px from inside the resize event of its iframe reaching 1000 px: its growth comes in
// the same rendering frame as the portal's resize, in the same direction. It records the order of the frame's resize
// events and of its ResizeObserver.
const GROWS_ON_RESIZE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Crece al cambiar de alto</title>
<style>body { margin: 0; } .block { height: 1000px; }</style></head><body><main><div class="block"></div></main><script>
window.order = [];
let grown = false;
new ResizeObserver(() => order.push("ro:" + Math.round(document.documentElement.getBoundingClientRect().height))).observe(document.documentElement);
addEventListener("resize", () => {
  order.push("resize:" + innerHeight);
  if (!grown && innerHeight >= 1000) { grown = true; const more = document.createElement("div"); more.style.height = "200px"; document.body.append(more); }
});
</script></body></html>`;

async function phoneFrameChecks(engine, engineName, base, html, flowHtml) {
  const frameScreen = engineName === "webkit" ? { width: PHONE.width, height: PHONE.height } : null;
  const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;
  async function openPhone(pieceId, ready, setup = () => {}) {
    const backend = newBackend(html, flowHtml);
    backend.projects[0].name = LONG_PROJECT;
    setup(backend);
    const context = await mockedContext(engine, { backend, width: PHONE.width, height: PHONE.height, locale: "es-CO", frameScreen });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/#/piece/${pieceId}`, { waitUntil: "networkidle" });
    const frame = await waitFor(async () => { const f = pieceFrame(page); return f && (await f.evaluate(ready).catch(() => false)) ? f : null; }, 10000);
    if (frame) await settled(page, frame);
    return { backend, context, page, frame, errors };
  }
  // The iframe against the piece's content: its height, the piece's (its <html> box) and whether the piece scrolls inside.
  const fitOf = async (page, frame) => {
    const outer = await page.evaluate(() => { const f = document.querySelector("iframe.piece-frame"); return f ? f.getBoundingClientRect().height : null; });
    const inner = frame && await frame.evaluate(() => ({ content: document.documentElement.getBoundingClientRect().height,
      scroll: document.documentElement.scrollHeight, view: window.innerHeight })).catch(() => null);
    return { outer, ...(inner || {}) };
  };
  const fits = (m) => Boolean(m) && near(m.outer, m.content) && m.scroll <= m.view + 1;
  async function settled(page, frame) {
    return (await waitFor(async () => { const m = await fitOf(page, frame); return fits(m) ? m : null; }, 3000)) || fitOf(page, frame);
  }
  // Where an element of the piece is in the portal's window (px from its top), and whether all of it is inside.
  const inWindow = async (page, frame, selector) => {
    const offset = await page.evaluate(() => { const f = document.querySelector("iframe.piece-frame"); return f ? f.getBoundingClientRect().top : null; });
    const box = frame && await frame.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }, selector).catch(() => null);
    const vh = await page.evaluate(() => window.innerHeight);
    if (offset === null || !box) return { selector, found: false };
    const top = Math.round(box.top + offset), bottom = Math.round(box.bottom + offset);
    return { selector, top, bottom, vh, inside: top >= 0 && bottom <= vh };
  };
  // The frame at rest: the title band's bottom (what its items reach: «Volver», the title and the line next to it when it
  // shows; on a phone the heading gives its box up to the bar's grid, so its own box is not the band), the title's, and
  // «Volver» (its lines, its text and its name).
  const restOf = (page) => page.evaluate(() => {
    window.scrollTo(0, 0);
    const bottom = (s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().bottom) : null; };
    const back = document.querySelector(".back-link");
    const range = document.createRange();
    if (back) range.selectNodeContents(back);
    const rects = back ? [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0) : [];
    const status = document.querySelector(".piece-status");
    const band = [back, document.querySelector("h1.piece-title"), status && !status.hidden ? status : null].filter(Boolean)
      .map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => Math.round(r.bottom));
    return { heading: band.length ? Math.max(...band) : null, title: bottom("h1.piece-title"), titleText: document.querySelector("h1.piece-title")?.textContent,
      back: back && { lines: rects.length && rects.every((r) => Math.abs(r.top - rects[0].top) < r.height / 2) ? 1 : rects.length,
        text: back.innerText.trim(), label: back.getAttribute("aria-label") } };
  });
  // One screen down: what is fixed or sticky on screen, and where the masthead went.
  const stuckOf = (page) => page.evaluate(() => {
    window.scrollTo(0, window.innerHeight);
    const stuck = [...document.querySelectorAll("body *")].filter((el) => {
      const p = getComputedStyle(el).position;
      if (p !== "fixed" && p !== "sticky") return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight;
    }).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")}`);
    return { scrollY: Math.round(window.scrollY), stuck, masthead: Math.round(document.querySelector(".masthead").getBoundingClientRect().bottom) };
  });
  const pageHeight = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, vh: window.innerHeight }));
  const rest = async (tag, page, { name = LONG_PROJECT, title } = {}) => {
    const at = await restOf(page);
    check(`${tag}: at rest the title band ends at ${PHONE_FRAME_MAX} px or less`, at.heading !== null && at.heading <= PHONE_FRAME_MAX &&
      (!title || at.titleText === title), JSON.stringify(at));
    const named = await page.getByRole("link", { name: `Volver a ${name}`, exact: true }).count();
    check(`${tag}: «← Volver» is one line and its name is «Volver a ${name.length > 30 ? name.slice(0, 30) + "…" : name}»`,
      at.back && at.back.lines === 1 && at.back.text.replace(/\s+/g, " ") === "← Volver" && at.back.label === `Volver a ${name}` && named === 1, JSON.stringify({ ...at.back, named }));
  };
  // The line next to the title on a phone: in the row of «← Volver», on its right and ending on the bar's right edge (the
  // title's box), above the title; the title's bottom and the whole band's, with the line showing. text: what it must say.
  const lineOf = (page, text) => page.evaluate((text) => {
    window.scrollTo(0, 0);
    const s = document.querySelector(".piece-status"), t = document.querySelector("h1.piece-title"), back = document.querySelector(".back-link");
    if (!s || s.hidden || !s.textContent.includes(text) || !t || !back) return null;
    // The words' right edge, not the box's: the line is set to the row's end.
    const range = document.createRange(); range.selectNodeContents(s);
    const words = [...range.getClientRects()].filter((r) => r.width > 0);
    const box = s.getBoundingClientRect(), title = t.getBoundingClientRect(), b = back.getBoundingClientRect();
    const round = (r) => ({ top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) });
    return { status: round(box), wordsRight: Math.round(Math.max(...words.map((r) => r.right))), lines: new Set(words.map((r) => Math.round(r.top))).size,
      back: round(b), title: round(title), band: Math.round(Math.max(box.bottom, title.bottom, b.bottom)), text: s.textContent };
  }, text);
  const inBackRow = (m) => Boolean(m) && m.status.left >= m.back.right && Math.abs(m.wordsRight - m.title.right) <= 1 &&
    m.status.top >= m.back.top - 2 && m.status.bottom <= m.title.top + 1 &&
    Math.abs((m.status.top + m.status.bottom) / 2 - (m.back.top + m.back.bottom) / 2) <= 2;
  // The first change makes the portal say «Guardado»: in the row of «← Volver», on its right, so it never takes a line of its
  // own under the title, and the band (the title included) still ends at PHONE_FRAME_MAX px or less.
  const savedLine = async (tag, page, frame) => {
    if (frame) await frame.evaluate(() => responder("q-001", "si"));
    const saved = await waitFor(() => lineOf(page, "Guardado"), 5000);
    check(`${tag}: «Guardado» goes in the row of «← Volver», on its right and set to the row's end, above the title`, inBackRow(saved), JSON.stringify(saved));
    check(`${tag}: with «Guardado» showing, the h1 and the whole title band end at ${PHONE_FRAME_MAX} px or less`,
      saved && saved.title.bottom <= PHONE_FRAME_MAX && saved.band <= PHONE_FRAME_MAX, JSON.stringify(saved));
    return saved;
  };
  const fitCheck = async (tag, what, page, frame) => {
    const m = frame ? await settled(page, frame) : null;
    check(`${tag}: ${what}: the iframe is as tall as the piece and the piece does not scroll inside`, fits(m), JSON.stringify(m));
    return m;
  };

  // The questions sheet.
  {
    const tag = `phone ${engineName}: questions`;
    const { context, page, frame, errors } = await openPhone(IDS.questions, () => typeof respondidas === "function");
    await rest(tag, page);
    await fitCheck(tag, "open", page, frame);
    const tall = await pageHeight(page);
    check(`${tag}: the portal's page is taller than the screen`, tall.scroll > tall.vh, JSON.stringify(tall));
    const down = await stuckOf(page);
    check(`${tag}: one screen down nothing fixed or sticky is on screen, and the masthead went up`, down.scrollY > PHONE_FRAME_MAX &&
      down.stuck.length === 0 && down.masthead <= 0, JSON.stringify(down));
    // The first change: «Guardado» right below the title (its one line is full).
    await savedLine(tag, page, frame);
    // A step of the sheet, the page scrolled to its bottom: «Siguiente» shows the next step's title.
    const steps = frame && await frame.evaluate(() => (paged() ? steps().length : 0)).catch(() => 0);
    if (frame && steps > 1) {
      await frame.evaluate(() => goToStep(0));
      await settled(page, frame);
      const before = await frame.evaluate(() => document.getElementById("view-title")?.textContent);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await steadyClick(frame.locator("button[data-rol=accion-principal]"));
      await settled(page, frame);
      await sleep(200);
      const after = await frame.evaluate(() => document.getElementById("view-title")?.textContent);
      const title = await inWindow(page, frame, "#view-title");
      check(`${tag}: at the bottom of a step, «Siguiente» shows the new step's title in the window`, before !== after && title.inside,
        JSON.stringify({ before, after, title }));
      // The last field of the step, focused with the page at its top: it is inside the window.
      await page.evaluate(() => window.scrollTo(0, 0));
      const last = await frame.evaluate(() => {
        const fields = [...document.querySelectorAll("main input, main textarea, main select")].filter((el) => {
          const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
        });
        const el = fields[fields.length - 1];
        if (!el) return null;
        el.setAttribute("data-check", "last-field");
        el.focus();
        return el.id || el.name;
      });
      await sleep(300);
      const field = await inWindow(page, frame, "[data-check=last-field]");
      check(`${tag}: the step's last field, focused, is inside the window`, last && field.inside, JSON.stringify({ last, field }));
    } else check(`${tag}: the sheet has steps to walk through`, false, `${steps} step(s)`);
    // «Cambiaría algo» on the step's first question: its text field appears, and the iframe grows with it, nothing cut.
    const grows = frame && await frame.evaluate(() => {
      const id = steps()[currentStep()].questionIds[0];
      return id ? { id, before: document.documentElement.getBoundingClientRect().height } : null;
    }).catch(() => null);
    const beforeFit = frame && await settled(page, frame);
    if (grows) await frame.evaluate((id) => responder(id, "cambio"), grows.id);
    const afterFit = frame && await settled(page, frame);
    check(`${tag}: the field «Cambiaría algo» opens grows the iframe, and nothing is cut`, grows && fits(afterFit) && afterFit.outer > beforeFit.outer,
      JSON.stringify({ grows, before: beforeFit, after: afterFit }));
    check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // A title of TITLE_MAX characters still ends the title band at 160 px or less.
  {
    const tag = `phone ${engineName}: a title of ${TITLE_MAX} characters`;
    const { backend, context, page, frame } = await openPhone(IDS.questions, () => typeof respondidas === "function", (b) => { b.pieces[0].title = TITLE_AT_MAX; });
    await rest(tag, page, { title: TITLE_AT_MAX });
    await savedLine(tag, page, frame);
    // The save fails (no connection): its line wraps inside the row of «← Volver», the h1 still ends at PHONE_FRAME_MAX px
    // or less, and the live region still says it.
    backend.saveFails = true;
    if (frame) await frame.evaluate(() => responder("q-001", "no_se"));
    const failed = await waitFor(() => lineOf(page, "Sin guardar"), 8000);
    check(`${tag}: a failed save says so in the row of «← Volver», on its right, above the title`, inBackRow(failed) && failed.text === SAVE_ERROR_ES,
      JSON.stringify(failed));
    check(`${tag}: with the failed save showing, the h1 ends at ${PHONE_FRAME_MAX} px or less`, failed && failed.title.bottom <= PHONE_FRAME_MAX, JSON.stringify(failed));
    const live = await page.textContent("#main > [role=status]");
    check(`${tag}: the live region announces the failed save`, live === SAVE_ERROR_ES, live);
    // A change too long to keep: its line too goes in that row and the h1 still ends at PHONE_FRAME_MAX px or less.
    const quota = await page.evaluate(async () => (await import("./js/bridge.js")).STORAGE_QUOTA_CHARS);
    if (frame) await frame.evaluate((n) => { responder("q-003", "cambio"); escribir("q-003", "texto", "x".repeat(n)); }, quota);
    const tooLarge = await waitFor(() => lineOf(page, TOO_LARGE_ES), 5000);
    check(`${tag}: a change too long to save says so in the row of «← Volver», on its right, above the title`, inBackRow(tooLarge), JSON.stringify(tooLarge));
    check(`${tag}: with «${TOO_LARGE_ES}» showing, the h1 ends at ${PHONE_FRAME_MAX} px or less`, tooLarge && tooLarge.title.bottom <= PHONE_FRAME_MAX,
      JSON.stringify(tooLarge));
    await context.close();
  }

  // A scroll request past the piece's last height (the piece grew and asked to go into what it added before its new height
  // went out) is done once that height arrives: the page ends where the piece asked, not clamped to the old bottom.
  {
    const tag = `phone ${engineName}: a scroll request below the piece's last height`;
    const { context, page, frame } = await openPhone(IDS.questions, () => typeof respondidas === "function");
    const asked = frame && await frame.evaluate(() => {
      const before = Math.ceil(document.documentElement.getBoundingClientRect().height);
      const more = document.createElement("div");
      more.style.height = "2000px";
      document.body.append(more);
      window.scrollTo(0, before + 1000); // posted at once; the new height follows in the next rendering frame
      return before;
    }).catch(() => null);
    const pend = asked && await waitFor(() => page.evaluate((top) => {
      const f = document.querySelector("iframe.piece-frame");
      const start = Math.round(f.getBoundingClientRect().top + window.scrollY);
      const y = Math.round(window.scrollY);
      return Math.abs(y - (start + top)) <= 2 ? { y, start, top } : null;
    }, asked + 1000), 3000);
    const where = await page.evaluate(() => ({ y: Math.round(window.scrollY),
      start: Math.round(document.querySelector("iframe.piece-frame").getBoundingClientRect().top + window.scrollY),
      frame: Math.round(document.querySelector("iframe.piece-frame").getBoundingClientRect().height) }));
    check(`${tag}: is done when the new height arrives (the page at the piece's ${asked} + 1000 px)`, Boolean(pend), JSON.stringify({ asked, ...where }));
    await context.close();
  }

  // A short piece: its box fills the screen under the frame (the container's own fill, with no floor of its own), and the
  // page does not scroll.
  {
    const tag = `phone ${engineName}: a short piece`;
    const short = '<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Corta</title></head><body><main><p>Una línea.</p></main></body></html>';
    const { context, page, frame } = await openPhone(IDS.questions, () => document.readyState === "complete", (b) => { b.html[IDS.questions] = short; });
    const m = frame && await fitCheck(tag, "open", page, frame);
    const box = await page.evaluate(() => ({ main: Math.round(document.querySelector(".piece-main").getBoundingClientRect().bottom),
      frame: Math.round(document.querySelector("iframe.piece-frame").getBoundingClientRect().bottom),
      vh: window.innerHeight, scroll: document.documentElement.scrollHeight }));
    check(`${tag}: the piece's box ends at the screen's bottom and the page does not scroll`, Boolean(m) && Math.abs(box.main - box.vh) <= 1 &&
      box.scroll <= box.vh + 1 && box.frame < box.vh, JSON.stringify(box));
    await context.close();
  }

  // A short title: «Guardado» still goes in the row of «← Volver» (one place for it, whatever the title).
  {
    const tag = `phone ${engineName}: a short title`;
    const { context, page, frame } = await openPhone(IDS.questions, () => typeof respondidas === "function", (b) => { b.pieces[0].title = "Preguntas del proyecto"; });
    await savedLine(tag, page, frame);
    await context.close();
  }

  // The project's page and the owner's screens (MAR-14 too): «← Volver» in one line named after where it goes, and the
  // title band short at rest, with nothing cut. The owner's piece screen has the longest title and its permanent line
  // «Lo que envió … el …» under it.
  {
    const bandOf = (page, headSelector) => page.evaluate((sel) => {
      window.scrollTo(0, 0);
      const bottom = (s) => { const el = document.querySelector(s); return el ? Math.round(el.getBoundingClientRect().bottom) : null; };
      const back = document.querySelector(".back-link");
      const range = document.createRange();
      if (back) range.selectNodeContents(back);
      const rects = back ? [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0) : [];
      const h1 = document.querySelector("h1");
      const style = h1 && getComputedStyle(h1);
      // The band: what its elements reach (the owner's heading gives its box up to the grid, so the title and the line count).
      const band = Math.max(...sel.split(",").map((one) => bottom(one.trim()) ?? 0));
      return { h1: bottom("h1"), band, h1Text: h1 && h1.textContent, h1Lines: h1 && Math.round(h1.getBoundingClientRect().height / parseFloat(style.lineHeight)),
        back: back && { lines: rects.length && rects.every((r) => Math.abs(r.top - rects[0].top) < r.height / 2) ? 1 : rects.length,
          text: back.innerText.trim().replace(/\s+/g, " "), label: back.getAttribute("aria-label"), height: Math.round(back.getBoundingClientRect().height) } };
    }, headSelector);
    // noBack: the project's page has no «volver» on a phone (its destination is home, which the brand links to).
    // backText, brandLabel: the link's words and the brand's name in the screen's language (Spanish unless said).
    const phoneScreen = async (tag, backend, hash, headSelector, label, ready, { noBack = false, backText = "← Volver", brandLabel = "ninben, ir a Tus proyectos" } = {}) => {
      const context = await mockedContext(engine, { backend, width: PHONE.width, height: PHONE.height, locale: "es-CO", frameScreen });
      const page = await context.newPage();
      await page.goto(`${base}/${hash}`, { waitUntil: "networkidle" });
      await waitFor(() => page.evaluate(ready).catch(() => false), 10000);
      await sleep(200);
      const at = await bandOf(page, headSelector);
      check(`${tag}: at rest the h1 and the title band end at ${PHONE_FRAME_MAX} px or less`, at.h1 !== null && at.h1 <= PHONE_FRAME_MAX && at.band > 0 && at.band <= PHONE_FRAME_MAX, JSON.stringify(at));
      if (noBack) {
        const shown = await page.evaluate(() => [...document.querySelectorAll(".back-link")].filter((el) => el.getBoundingClientRect().height > 0).length);
        check(`${tag}: there is no «volver» on a phone`, shown === 0, String(shown));
      } else {
        check(`${tag}: «${backText}» is one line, at least 44 px high, and its name is «${label}»`, at.back && at.back.lines === 1 && at.back.height >= 44 &&
          at.back.text === backText && at.back.label === label, JSON.stringify(at.back));
      }
      // The brand is the link home, on every screen: its name says where, it is a 44 px target, its words keep the brand's type.
      const brand = await page.evaluate(() => {
        const a = document.querySelector("[data-rol=marca-producto]");
        if (!a) return null;
        const box = a.getBoundingClientRect(), text = a.querySelector("span");
        return { tag: a.tagName.toLowerCase(), href: a.getAttribute("href"), label: a.getAttribute("aria-label"), height: Math.round(box.height),
          edge: Math.round(box.left) - Math.round(document.querySelector("h1").getBoundingClientRect().left),
          words: text && text.textContent, weight: text && getComputedStyle(text).fontWeight, svg: Boolean(a.querySelector("svg")) };
      });
      check(`${tag}: the brand is a link home named «${brandLabel}», 44 px high, in the brand's type`, brand && brand.tag === "a" && brand.href === "#/" &&
        brand.label === brandLabel && Math.abs(brand.edge) <= 1 && brand.height >= 44 && brand.words === "ninben" && brand.weight === "600", JSON.stringify(brand));
      const fixed = await stuckOf(page);
      check(`${tag}: nothing fixed or sticky is on screen one screen down`, fixed.stuck.length === 0, JSON.stringify(fixed));
      return { context, page, at };
    };
    const projectReady = () => document.querySelector(".page-head h1")?.textContent.length > 0;
    // The project's page, the person's and the owner's, with a name that fits one line, two lines of running text, and two
    // lines of wide letters: the h1 ends at 160 px or less and no «volver» shows.
    const WIDE_NAME = "WWWWW WWWWW WWWWW";
    for (const [what, name] of [["a short name", null], ["a name of two lines", PROJECT_TWO_LINES], ["a name of two lines of wide letters", WIDE_NAME]]) {
      const person = ownerBackend(html);
      if (name) person.projects.find((p) => p.id === IDS.project).name = name;
      const personName = name || PROJECT.name;
      let screen = await phoneScreen(`phone ${engineName}: project page, ${what}`, person, `#/project/${IDS.project}`, ".page-head", "", projectReady, { noBack: true });
      check(`phone ${engineName}: project page, ${what}: the name is whole`, screen.at.h1Text === personName, JSON.stringify(screen.at));
      if (name) check(`phone ${engineName}: project page, ${what}: it wraps to ${screen.at.h1Lines} lines (two)`, screen.at.h1Lines === 2, JSON.stringify(screen.at));
      await screen.context.close();
      const owner = ownerBackend(html);
      if (name) { owner.ownerView[IDS.ownedProject].project.name = name; owner.projects.find((p) => p.id === IDS.ownedProject).name = name; }
      screen = await phoneScreen(`phone ${engineName}: owner's project page, ${what}`, owner, `#/project/${IDS.ownedProject}`, ".page-head", "", projectReady, { noBack: true });
      check(`phone ${engineName}: owner's project page, ${what}: the name is whole`, screen.at.h1Text === (name || PROJECT.owned), JSON.stringify(screen.at));
      await screen.context.close();
    }
    // The owner's piece screen keeps «← Volver» (it goes back to the project): a short title, a title of TITLE_MAX characters,
    // and a send by a person of ~60 characters of name: the band, with its line «Lo que envió … el …», ends at 160 px or less.
    const LONG_NAME = "María de los Ángeles Fernández de la Vega y Rodríguez Pérez";
    const savedTitle = OWNED_TITLES[OWNED.questions], savedName = PEOPLE.luis.name;
    try {
      for (const [what, title, person] of [["a short title", savedTitle, savedName], [`a title of ${TITLE_MAX} characters`, TITLE_AT_MAX, savedName],
        [`a sender of ${LONG_NAME.length} characters`, savedTitle, LONG_NAME], [`a title of ${TITLE_MAX} characters and a sender of ${LONG_NAME.length}`, TITLE_AT_MAX, LONG_NAME]]) {
        // The owner's backend takes the title and the name when it is built.
        OWNED_TITLES[OWNED.questions] = title;
        PEOPLE.luis.name = person;
        const b = ownerViewBackend(html, null, null, {});
        const tag = `phone ${engineName}: owner's piece with ${what}`;
        const screen = await phoneScreen(tag, b, ownerHref(IDS.ownedProject, OWNED.questions, PEOPLE.luis), "h1.piece-title, .piece-status", `Volver a ${PROJECT.owned}`,
          () => document.querySelector("h1.piece-title") && document.querySelector(".piece-status")?.textContent.startsWith("Lo que envió"));
        const line = await screen.page.evaluate(() => document.querySelector(".piece-status")?.textContent);
        check(`${tag}: the title is whole (${title.length} characters, never cut) and the line says whose send it is`, screen.at.h1Text === title &&
          line.startsWith(`Lo que envió ${person} el `) && /\d/.test(line.slice(`Lo que envió ${person} el `.length)), JSON.stringify({ at: screen.at, line }));
        await screen.context.close();
      }
    } finally { OWNED_TITLES[OWNED.questions] = savedTitle; PEOPLE.luis.name = savedName; }
    // One point of «Decisiones» as the owner reads it keeps «← Volver» too: it goes back to the project, not home (the
    // brand's destination). Then its band reads as every list's: «← Volver» on its own row, the h1 (the point's title), and the
    // counts under it as the list's data line, at the h1's x. The h1 takes the largest step of the type scale with which a
    // title of DECISION_TITLE_MAX characters still ends at 160 px or less: the lists' 24 px does not (the check measures it),
    // 16 px does. Cases: the fixture's title, one of DECISION_TITLE_MAX characters, the pieces' earliest-breaking title of
    // that length, and that title in English with the five kinds of answer counted in two digits (the longest counts line).
    const englishWorst = (b) => {
      const entry = b.decisions[IDS.ownedProject];
      for (const project of [b.ownerView[IDS.ownedProject].project, ...b.projects.filter((x) => x.id === IDS.ownedProject)]) project.language = "en";
      ["yes", "change", "no", "unsure", "none"].forEach((value, k) => {
        for (let i = 0; i < 12; i += 1) {
          const id = `f${k}${String(i).padStart(2, "0")}0000-0000-4000-8000-000000000000`;
          entry.members.push({ id, display_name: `Person ${k}-${i}`, role: "stakeholder", created_at: `2026-10-0${(k % 7) + 2}T13:${String(i).padStart(2, "0")}:00.000Z` });
          entry.audience.push(id);
          if (value !== "none") entry.answers.push({ id: randomUUID(), member_id: id, key: OKEY.trips, version: entry.points[0].version, value,
            comment: value === "yes" ? null : "Ok.", created_at: OAT.first });
        }
      });
    };
    for (const [what, title, setup] of [["the screens' title", OTITLE.trips, null], [`a title of ${DECISION_TITLE_MAX} characters`, DECISION_TITLE_AT_MAX, null],
      [`the earliest-breaking title of ${DECISION_TITLE_MAX} characters`, TITLE_AT_MAX, null],
      [`the earliest-breaking title of ${DECISION_TITLE_MAX} characters, in English, five kinds of answer in two digits`, TITLE_AT_MAX, englishWorst]]) {
      const b = ownerDecisionsBackend(html);
      b.decisions[IDS.ownedProject].points[0].title = title;
      if (setup) setup(b);
      const english = Boolean(setup);
      const tag = `phone ${engineName}: owner's point of «Decisiones» with ${what}`;
      const screen = await phoneScreen(tag, b, `#/project/${IDS.ownedProject}/decisions/${OKEY.trips}`, ".page-head h1", english ? `Back to ${PROJECT.owned}` : `Volver a ${PROJECT.owned}`,
        () => document.querySelector(".page-head h1")?.textContent.length > 0 && document.querySelectorAll(".owner-answer").length > 0,
        english ? { backText: "← Back", brandLabel: "ninben, go to Your projects" } : {});
      check(`${tag}: the title is whole (${title.length} characters, never cut)`, screen.at.h1Text === title, JSON.stringify(screen.at));
      if (title.length === DECISION_TITLE_MAX) check(`${tag}: it wraps to ${screen.at.h1Lines} lines (two at most)`, screen.at.h1Lines <= 2, JSON.stringify(screen.at));
      const head = await screen.page.evaluate(() => {
        window.scrollTo(0, 0);
        const box = (s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r && { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) }; };
        const h1 = document.querySelector(".page-head h1"), cs = getComputedStyle(h1);
        // The lists' title size, tried on this h1: where it would end.
        const size = cs.fontSize, lineHeight = cs.lineHeight;
        h1.style.fontSize = getComputedStyle(document.documentElement).getPropertyValue("--text-title").trim();
        h1.style.lineHeight = "1.25";
        const atTitleSize = Math.round(h1.getBoundingClientRect().bottom);
        h1.style.fontSize = ""; h1.style.lineHeight = "";
        return { back: box("[data-rol=marco] .back-link"), h1: box(".page-head h1"), meta: box(".page-meta"), text: document.querySelector(".page-meta")?.textContent,
          type: `${size} ${cs.fontWeight}`, lineHeight, atTitleSize };
      });
      check(`${tag}: the h1 is in 16px 600, the largest step of the type scale that keeps a title of ${DECISION_TITLE_MAX} characters within ${PHONE_FRAME_MAX} px (at the lists' 24 px it would end at ${head.atTitleSize} px)`,
        head.type === "16px 600" && (title.length !== DECISION_TITLE_MAX || head.atTitleSize > PHONE_FRAME_MAX), JSON.stringify(head));
      const counts = english ? "Works: 13 · I would change it: 12 · Does not work: 13 · Not sure: 12 · No answer: 13" : "Va: 1 · No va: 1 · Sin respuesta: 1";
      check(`${tag}: «← Volver» on its own row, then the h1, then the counts under it as the list's data line, at the h1's x`, head.back && head.h1 && head.meta &&
        head.back.bottom <= head.h1.top && head.h1.bottom <= head.meta.top && Math.abs(head.meta.left - head.h1.left) <= 1 && head.text === counts, JSON.stringify(head));
      // Where the counts wrap, they wrap between two counts, never inside one («Sin respuesta:» on a line and its number on the next).
      const split = await screen.page.evaluate(() => {
        const meta = document.querySelector(".page-meta");
        if (!meta) return null;
        const nodes = [];
        const walker = document.createTreeWalker(meta, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(), at = 0; n; at += n.textContent.length, n = walker.nextNode()) nodes.push({ n, at });
        const point = (offset) => { const x = nodes.findLast((e) => e.at <= offset); return [x.n, offset - x.at]; };
        const text = meta.textContent, out = [];
        let from = 0;
        for (const part of text.split(" · ")) {
          const range = document.createRange();
          range.setStart(...point(from)); range.setEnd(...point(from + part.length));
          const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          if (tops.size > 1) out.push(part);
          from += part.length + 3;
        }
        return out;
      });
      check(`${tag}: no count is split across two lines`, Array.isArray(split) && split.length === 0, JSON.stringify(split));
      await screen.context.close();
    }
  }

  // The flows' review: its index takes the page to the group.
  if (flowHtml) {
    const tag = `phone ${engineName}: flows`;
    const { context, page, frame, errors } = await openPhone(IDS.flow, () => typeof openFlow === "function");
    await rest(tag, page);
    await fitCheck(tag, "open", page, frame);
    // The index shows when the list is longer than three screens (DET-04): the portal's screens, not the iframe's.
    const index = frame && await frame.evaluate(() => {
      const fold = document.getElementById("indexFold");
      const links = fold ? [...fold.querySelectorAll("a[href^='#act-']")] : [];
      return { shown: Boolean(fold) && fold.getBoundingClientRect().height > 0, link: links.length ? links[links.length - 1].getAttribute("href") : null,
        page: document.documentElement.scrollHeight, frame: window.innerHeight };
    }).catch(() => null);
    check(`${tag}: the list of flows shows its index (it is longer than three screens)`, index && index.shown, JSON.stringify(index));
    // Its last link takes the page to that group (the index made visible if it is not: this is the portal's part).
    if (index && index.link) {
      // (it would hide it again at the next resize of its iframe)
      if (!index.shown) await frame.evaluate(() => { ajustarIndice = () => {}; document.getElementById("indice").hidden = false; });
      await settled(page, frame);
      await frame.click("#indexFold > summary", { timeout: 3000 }).catch(() => {});
      await frame.click(`#indexFold a[href="${index.link}"]`, { timeout: 3000 }).catch(() => {});
      await settled(page, frame);
      await sleep(200);
      const group = await inWindow(page, frame, `${index.link} > h2`);
      check(`${tag}: a link of the index shows its group's title in the window`, group.inside, JSON.stringify(group));
    } else check(`${tag}: a link of the index shows its group's title in the window`, false, "no index in the list of flows");
    // Inside a flow, a fold opened (the first flow that has one, «¿Qué pasa si no?»): the iframe grows and nothing is cut.
    const fold = frame && await frame.evaluate(() => {
      const find = () => [...document.querySelectorAll("main details:not([open])")].find((el) => el.getBoundingClientRect().height > 0);
      for (const id of IDS) { openFlow(id); if (find()) break; }
      const d = find();
      if (d) d.setAttribute("data-check", "fold");
      return Boolean(d);
    }).catch(() => false);
    const closedFit = frame && await settled(page, frame);
    if (fold) await frame.click("[data-check=fold] > summary");
    const openFit = frame && await settled(page, frame);
    check(`${tag}: inside a flow, an opened <details> grows the iframe, and nothing is cut`, fold && fits(openFit) && openFit.outer > closedFit.outer,
      JSON.stringify({ fold, before: closedFit, after: openFit }));
    check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // A piece that grows in the same rendering frame as the portal's resize of its iframe.
  {
    const tag = `phone ${engineName}: a piece that grows again while its iframe is resized`;
    const { context, page, frame } = await openPhone(IDS.questions, () => Array.isArray(window.order), (b) => { b.html[IDS.questions] = GROWS_ON_RESIZE; });
    const grown = frame && await waitFor(() => frame.evaluate(() => (window.order.some((e) => e.startsWith("ro:12")) ? true : null)).catch(() => null), 3000);
    const m = frame ? await settled(page, frame) : null;
    check(`${tag}: it ends with the iframe as tall as the piece`, grown && fits(m) && near(m.content, 1200), JSON.stringify(m));
    const order = frame ? await frame.evaluate(() => window.order).catch(() => []) : [];
    const resizeAt = order.indexOf("resize:1000"), roAt = order.findIndex((e) => e.startsWith("ro:12"));
    check(`${tag}: the iframe's resize event comes before the ResizeObserver of the same frame`, resizeAt >= 0 && roAt > resizeAt, JSON.stringify(order));
    await context.close();
  }
}

// The server has a send the piece's saved draft does not reflect (the piece did not get to save its «sent»
// mark): only then the portal's line says «Enviada el …», until the person changes something. When the draft
// was saved after the send (the usual case), the piece says it and the portal does not repeat it.
async function sentLineChecks(browser, base, html) {
  for (const draftAfterSend of [false, true]) {
    const tag = draftAfterSend ? "sent, draft saved after it" : "sent, draft older than the send";
    const backend = newBackend(html);
    backend.submits.push({ p_piece_id: IDS.questions, p_payload: {} });
    backend.submittedAt = new Date(Date.now() - 60000).toISOString();
    backend.draft = { other: "x" };
    backend.draftUpdatedAt = new Date(Date.now() + (draftAfterSend ? 0 : -120000)).toISOString();
    const context = await mockedContext(browser, { backend });
    const page = await context.newPage();
    await page.goto(`${base}/#/piece/${IDS.questions}`, { waitUntil: "networkidle" });
    const frame = await appPiece(page);
    await sleep(300);
    const line = await page.textContent(".piece-status");
    const pieceSays = frame && (await frameText(frame)).split("\n").some(isLine(QUESTIONS_SENT));
    if (!draftAfterSend) {
      check(`${tag}: the piece cannot show it, so the portal's line says «Enviada el …»`, !pieceSays && line.includes("Enviada el"), line);
      await frame.evaluate(() => responder("q-001", "si"));
      const after = await waitFor(async () => { const t = await page.textContent(".piece-status"); return t.includes("Guardado") ? t : null; }, 5000);
      check(`${tag}: after the person's first change the line only says the save`, after && !after.includes("Enviada"), String(after));
    } else {
      check(`${tag}: the portal's line does not say «Enviada»`, !line.includes("Enviada"), line);
    }
    await context.close();
  }
}

// A change too long for the piece's storage (the real quota): the status line says it was not saved,
// a save of the draft from before the refusal does not bring back «Guardado», and a shorter text does.
const SAVE_ERROR_ES = "Sin guardar: no hay conexión. Lo intentamos de nuevo solos.";
const TOO_LARGE_ES = "Sin guardar: texto muy largo. Acórtalo o descarga una copia.";
async function tooLargeAppChecks(browser, base, html) {
  const backend = newBackend(html);
  backend.saveDelayMs = 600; // the draft from before the refusal lands after it
  const context = await mockedContext(browser, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/#/piece/${IDS.questions}`, { waitUntil: "networkidle" });
  const frame = await appPiece(page);
  const statusText = () => page.textContent(".piece-status");
  await frame.evaluate(() => responder("q-001", "si"));
  check("too large: a change that fits shows «Guardado» first", await waitFor(async () => (await statusText()).includes("Guardado"), 5000));
  const savesBefore = backend.drafts.length;
  const quota = await page.evaluate(async () => (await import("./js/bridge.js")).STORAGE_QUOTA_CHARS);
  // A fitting change still in the debounce, then a text past the quota.
  await frame.evaluate((n) => { responder("q-003", "cambio"); escribir("q-003", "texto", "x".repeat(n)); }, quota);
  const told = await waitFor(async () => ((await statusText()) === TOO_LARGE_ES ? true : null), 3000);
  check("too large: the status line says the change was not saved", told, await statusText());
  const live = await page.textContent("#main > [role=status]");
  check("too large: the live region announces it", live === TOO_LARGE_ES, live);
  await waitFor(async () => backend.drafts.length > savesBefore, 3000);
  await sleep(1500); // the earlier draft's save has landed
  const after = await statusText();
  check("too large: a save of the draft from before does not bring back «Guardado»",
    backend.drafts.length > savesBefore && after === TOO_LARGE_ES && !after.includes("Guardado"), `${backend.drafts.length - savesBefore} save(s) · ${after}`);
  check("too large: the long text never reached save_draft", backend.drafts.every((d) => !JSON.stringify(d.p_storage).includes("x".repeat(1000))));
  await frame.evaluate(() => escribir("q-003", "texto", "Más corto"));
  const back = await waitFor(async () => ((await statusText()).includes("Guardado") ? statusText() : null), 5000);
  check("too large: a shorter text is saved and the line says «Guardado» again", back && back !== TOO_LARGE_ES &&
    JSON.parse(backend.draft[QUESTIONS_KEY]).respuestas["q-003"].texto === "Más corto", back || await statusText());
  const savedValue = await frame.evaluate((k) => localStorage.getItem(k), QUESTIONS_KEY);
  await frame.evaluate((n) => escribir("q-003", "texto", "w".repeat(n)), quota);
  check("too large: a new long text is reported again", await waitFor(async () => (await statusText()) === TOO_LARGE_ES, 3000));
  // Undoing the paste brings back exactly the state already saved (this piece stamps each answer with
  // a time, so the write is done by hand, as a piece without that stamp would): the line must leave «too large».
  await frame.evaluate(([k, v]) => localStorage.setItem(k, v), [QUESTIONS_KEY, savedValue]);
  const undone = await waitFor(async () => ((await statusText()).includes("Guardado") ? statusText() : null), 5000);
  check("too large: going back to the saved text says «Guardado» again", undone && undone !== TOO_LARGE_ES, undone || await statusText());
  check("too large: no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
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
  await openProject(page);
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
  // Going back to the project finds the session over (401) and lands on the sign-in screen.
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
    await openProject(page);
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
    await page.waitForSelector(`a[href="#/project/${IDS.project}"]`, { timeout: 10000 });
  }
  const reached = await waitFor(() => backend.draft && edited(backend.draft), 8000);
  check(`${tag}: after ${other ? "A signs" : "signing"} in again, the unsaved change reaches piece_drafts`, reached,
    backend.draft ? JSON.stringify(JSON.parse(backend.draft[QUESTIONS_KEY]).respuestas) : "no server draft");
  await openProject(page);
  await page.click(`a[href="#/piece/${IDS.questions}"]`);
  frame = await appPiece(page);
  const shown = frame && await frame.evaluate(() => ({ q1: ST.respuestas["q-001"]?.tipo, q3: ST.respuestas["q-003"]?.texto }));
  check(`${tag}: the piece shows the change after signing in again`, shown && shown.q1 === "si" && shown.q3 === "Escrito al final de la sesión", JSON.stringify(shown));
  if (other) check(`${tag}: every save of A's change went with A's session`, backend.drafts.filter((d) => edited(d.p_storage)).every((d) => d.sub === USER.id),
    JSON.stringify(backend.drafts.map((d) => d.sub)));
  check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---- the demo sheet and a replaced version, in the app ----------------------------------------

const DEMO_SENT = "Tu revisión llegó";
// The demo sheet inside the app, once it rendered.
async function appSheet(page, timeout = 10000) {
  return waitFor(async () => { const f = pieceFrame(page); return f && (await f.$("#app h1").catch(() => null)) ? f : null; }, timeout);
}
const sendsOf = (backend, pieceId) => backend.submits.filter((b) => b.p_piece_id === pieceId);
const sendButton = (frame) => frame.getByRole("button", { name: "Enviar revisión", exact: true });

// R1: the demo sheet sends through the portal. A failure shows its error and never «Tu revisión llegó»;
// the retry arrives once and the sheet says «Tu revisión llegó».
async function demoAppChecks(browser, base, html, flowHtml, demoHtml) {
  const backend = newBackend(html, flowHtml, demoHtml);
  const context = await mockedContext(browser, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/#/piece/${IDS.demo}`, { waitUntil: "networkidle" });
  const frame = await appSheet(page);
  check("demo in app: the sheet opens inside the portal", frame);
  if (!frame) { await context.close(); return; }
  backend.submitMode = "network";
  await sendButton(frame).click();
  const failed = await waitFor(async () => { const t = await frameText(frame); return t.includes("No se pudo enviar tu revisión") ? t : null; }, 8000);
  check("demo in app: a failed send shows the sheet's error, never «Tu revisión llegó»", failed && !failed.split("\n").some(isLine(DEMO_SENT)) && sendsOf(backend, IDS.demo).length === 0,
    failed ? "" : (await frameText(frame)).slice(0, 200));
  check("demo in app: after the failure the portal does not say «Enviada»", !(await page.textContent(".piece-status")).includes("Enviada"), await page.textContent(".piece-status"));
  backend.submitMode = "ok";
  await frame.getByRole("button", { name: "Reintentar", exact: true }).click();
  const done = await waitFor(async () => ((await frameText(frame)).split("\n").some(isLine(DEMO_SENT)) ? true : null), 8000);
  await sleep(500); // nothing else arrives afterwards
  const rows = sendsOf(backend, IDS.demo);
  check("demo in app: the retry shows «Tu revisión llegó» and the row arrives once", done && rows.length === 1 &&
    rows[0].p_payload.esquema === "revision-demo/1" && rows[0].p_payload.revisor === "Ana Pérez", `${rows.length} row(s)`);
  await sleep(1200);
  const afterSend = await page.textContent(".piece-status");
  check("demo in app: the status line does not repeat the send date the sheet already shows", !afterSend.includes("Enviada"), afterSend);
  check("demo in app: no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

// The pinned notice of the piece screen, as the person sees it.
const pinnedNotice = (page) => page.evaluate(() => {
  const n = document.querySelector("[data-rol=aviso-fijo] .notice");
  if (!n) return null;
  const link = n.querySelector("a");
  return { text: n.querySelector("p").textContent, href: link && link.getAttribute("href"), label: link && link.textContent,
    dismiss: [...n.querySelectorAll("button")].some((b) => b.textContent === "Cerrar aviso"), visible: n.getBoundingClientRect().height > 0 };
});

// R11: a replaced version opened from an old email says so in a fixed notice, with a link to the newer
// version; its status line never makes a draft look sent; and sending it still works.
async function replacedAppChecks(browser, base, html, flowHtml, demoHtml) {
  for (const withNewer of [true, false]) {
    const tag = withNewer ? "replaced version" : "replaced version, no newer one found";
    const backend = newBackend(html, flowHtml, demoHtml);
    backend.html[IDS.replaced] = demoHtml;
    if (!withNewer) { const rows = backend.assignments; backend.assignments = (sub) => rows(sub).filter((a) => a.piece_id !== IDS.demo); }
    const context = await mockedContext(browser, { backend });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/#/piece/${IDS.replaced}`, { waitUntil: "networkidle" });
    const frame = await appSheet(page);
    const notice = await waitFor(() => pinnedNotice(page), 5000);
    check(`${tag}: a fixed notice says there is a newer version and that sending this one still reaches`, notice && notice.visible && !notice.dismiss &&
      notice.text.includes("Hay una versión más nueva") && notice.text.includes("le llega a quien te la compartió"), JSON.stringify(notice));
    check(`${tag}: the notice links to ${withNewer ? "the newer version" : "the list"}`, notice &&
      notice.href === (withNewer ? `#/piece/${IDS.demo}` : `#/project/${IDS.project}`) && notice.label === (withNewer ? "Abrir la versión nueva" : "Ver lo que te compartimos"), JSON.stringify(notice));
    if (!withNewer || !frame) { await context.close(); continue; }
    await page.screenshot({ path: join(outDir, "piece-replaced-360.png") });
    const axe = await axeViolations(page);
    if (axe) check(`${tag}: axe on the piece screen with the notice has no violations`, axe.length === 0, axe.join(", "));
    // The approve control of the first flow, by its role and name; a sheet without it fails here, it does not pass.
    const approve = frame.getByRole("button", { name: "Aprobar este flujo", exact: true }).first();
    const hasApprove = (await approve.count()) > 0;
    check(`${tag}: the sheet has an «Aprobar este flujo» control to change`, hasApprove);
    if (hasApprove) await approve.click();
    const saved = await waitFor(async () => { const t = await page.textContent(".piece-status"); return backend.drafts.length && t && !t.includes("…") ? t : null; }, 5000);
    check(`${tag}: a saved draft reads «Guardado aquí, sin enviar», never just «Guardado»`, saved === "Guardado aquí, sin enviar", String(saved));
    await sendButton(frame).click();
    const sent = await waitFor(async () => ((await frameText(frame)).split("\n").some(isLine(DEMO_SENT)) ? true : null), 8000);
    check(`${tag}: sending it still works (one row for this version)`, sent && sendsOf(backend, IDS.replaced).length === 1, `${sendsOf(backend, IDS.replaced).length} row(s)`);
    const afterSend = await waitFor(async () => { const line = await page.textContent(".piece-status"); return line.includes("sin enviar") ? null : { line }; }, 3000);
    check(`${tag}: once sent, the status line no longer says «sin enviar» and does not repeat the send date`, afterSend && !afterSend.line.includes("Enviada"), JSON.stringify(afterSend));
    if (notice) await page.click("[data-rol=aviso-fijo] a");
    const opened = await waitFor(async () => (await page.evaluate(() => location.hash)) === `#/piece/${IDS.demo}` &&
      (await page.textContent("h1.piece-title").catch(() => "")) === "Demo v2", 8000);
    check(`${tag}: the link opens the newer version`, opened, await page.evaluate(() => location.hash));
    check(`${tag}: the newer version shows no such notice`, !(await pinnedNotice(page)));
    check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// A session that comes back while the piece is handing over its last draft (the session ended, the
// cleanup is still waiting for the piece): the portal must not be left on an empty screen.
async function sessionReturnsChecks(browser, base, html) {
  const backend = newBackend(html);
  const context = await mockedContext(browser, { backend });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${base}/#/piece/${IDS.questions}`, { waitUntil: "networkidle" });
  const frame = await appPiece(page);
  // Keep the piece busy so the hand-over waits (up to its 1 s limit), then end the session and start it again.
  frame.evaluate(() => { const t = Date.now(); while (Date.now() - t < 1500) { /* busy */ } }).catch(() => {});
  await sleep(100);
  await page.evaluate(async (s) => {
    const { supabase } = await import("./js/supabase-client.js");
    await supabase.auth.signOut({ scope: "local" });
    await new Promise((r) => setTimeout(r, 50));
    await supabase.auth.setSession({ access_token: s.access_token, refresh_token: s.refresh_token });
  }, fakeSession());
  await sleep(2500); // the hand-over has ended (its limit is 1 s after the piece is free again)
  const ended = await page.evaluate((id) => location.hash !== `#/piece/${id}`, IDS.questions); // the session end ran
  const home = await waitFor(() => page.evaluate(() => Boolean(document.querySelector(".row-link"))), 3000);
  check("session returns during the hand-over: the portal shows home, never an empty piece screen", ended && home,
    await page.evaluate(() => `hash «${location.hash}» · h1 «${document.querySelector("h1")?.textContent}» · iframe ${Boolean(document.querySelector("iframe.piece-frame"))}`));
  check("session returns during the hand-over: no page errors", errors.length === 0, errors.join(" | "));
  await context.close();
}

// ---- the piece closure, in the app ----------------------------------------------------------------
// A received piece (the factory collected it) opens read only with what was sent, a pinned notice that says why it
// cannot change and «Pedir un cambio»; a replaced version the person had sent, the same with today's notice and its
// link; the list says «Recibida»; and a send from a tab left open after the close comes back as a change request,
// which the re-opened piece says above its notice (spec 2026-10-22 cierre de piezas §3.2-§3.4, §3.6). At 320, 768 and
// 1440, light and dark, with screenshots <name>-<width>-<scheme>.png in <out>.
const CLOSURE = {
  received: (date) => `La recibimos el ${date} y ya la estamos usando, así que aquí no se puede cambiar. Si necesitas cambiar algo, pide un cambio.`,
  // A replaced version the person sent (closed), and today's notice for one never sent (open).
  replaced: "Hay una versión más nueva de esto. Lo que enviaste en esta ya le llegó a quien te la compartió, así que aquí no se puede cambiar. Si necesitas cambiar algo, pide un cambio o responde la versión nueva.",
  replacedOpen: "Hay una versión más nueva de esto. Lo que marques aquí se guarda solo en esta página y no le llega a nadie hasta que lo envíes. Lo mejor es responder la versión nueva; si ya terminaste esta, envíala y también le llega a quien te la compartió.",
  cancel: "Cancelar",
  late: "Ya la habíamos recibido cuando la enviaste, así que tu envío llegó como pedido de cambio. Quien lleva el proyecto lo revisa.",
  action: "Pedir un cambio",
  label: "Qué quieres cambiar y por qué",
  hint: "Quien lleva el proyecto lo lee y decide. Lo que enviaste no cambia.",
  send: "Enviar el pedido",
  unsent: "Tenías cambios sin enviar: se guardaron y van con tu pedido.",
  empty: "Escribe qué quieres cambiar.",
  sending: "Enviando…",
  sentPrefix: "Tu pedido de cambio llegó el ",
  failed: "No se pudo enviar el pedido. Revisa tu conexión y vuelve a intentarlo.",
  earlier: (date) => `Pediste un cambio el ${date}.`,
  listReceived: "Recibida",
  listNewer: "Hay una versión más nueva",
  listRequested: (date) => `Pediste un cambio el ${date}`,
  signOutUnsent: "Escribiste un pedido de cambio que todavía no enviaste. Si sales, se perderá.",
  signOutLose: "Salir y perder el pedido",
  stay: "Quedarme",
};
const SENT_AT = "2026-10-17T15:00:00.000Z";
const RECEIVED_AT = "2026-10-18T15:00:00.000Z";
const REQUESTED_AT = "2026-10-20T12:00:00.000Z";
const isPlain = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const answersIn = (storage) => { try { return JSON.parse(storage[QUESTIONS_KEY]).respuestas || {}; } catch { return {}; } };
const formatIn = (page, iso, withTime = false) => page.evaluate(async ([value, time]) => (await import("./js/i18n.js")).formatDate("es", value, { withTime: time }), [iso, withTime]);
const pinnedNotices = (page) => page.evaluate(() => [...document.querySelectorAll("[data-rol=aviso-fijo] .notice")].map((n) => ({
  text: n.querySelector("p").textContent, tone: [...n.classList].find((c) => c.startsWith("notice--")) || null,
  links: [...n.querySelectorAll("a")].map((a) => ({ label: a.textContent, href: a.getAttribute("href") })),
  buttons: [...n.querySelectorAll("button")].map((b) => b.textContent) })));
const pinnedText = (page) => page.evaluate(() => document.querySelector("[data-rol=aviso-fijo]")?.innerText || "");
// The change request form, as the person sees it: its label, what describes the field (hint, unsent line, error), the
// field and its one button.
const requestForm = (page) => page.evaluate(() => {
  const area = document.getElementById("change-request-text");
  if (!area) return null;
  const form = area.closest("form");
  const label = document.querySelector('label[for="change-request-text"]');
  const described = (area.getAttribute("aria-describedby") || "").split(" ").filter(Boolean).map((id) => document.getElementById(id))
    .filter((el) => el && !el.hidden).map((el) => el.textContent);
  const button = form && form.querySelector("button[type=submit]");
  return { label: label && label.textContent, described, maxlength: area.getAttribute("maxlength"), tag: area.tagName, value: area.value,
    invalid: area.getAttribute("aria-invalid"), focused: document.activeElement === area, text: form ? form.innerText : "",
    alert: form && form.querySelector("[role=alert]") ? form.querySelector("[role=alert]").textContent : null,
    button: button && { text: button.textContent, disabled: button.disabled, primary: button.classList.contains("button--primary") },
    inPinned: Boolean(area.closest("[data-rol=aviso-fijo]")), buttons: form ? form.querySelectorAll("button").length : 0 };
});
const pieceHost = (frame) => frame.evaluate(() => ({ closed: factoryHost.closed, sentAt: factoryHost.sentAt,
  h1: document.querySelector("h1") && document.querySelector("h1").textContent, text: document.body.innerText,
  answers: Object.keys(ST.respuestas || {}).sort(), quien: ST.respuestas["q-002"] ? ST.respuestas["q-002"].quien || null : null,
  sendButton: [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Enviar respuestas") }));
const requestButton = (page) => page.getByRole("button", { name: CLOSURE.action, exact: true });
const sendRequestButton = (page) => page.locator("#change-request-text").locator("xpath=ancestor::form").locator("button[type=submit]");
// A control that is not there fails its check, it does not stop the run. Before the click, brought into view (the page
// scrolls, not the piece) and two of the page's animation frames: the piece's iframe runs in its own process, and Chrome sends a pointer event to the frame that was under it on
// the last frame it drew. A click right after the layout moved (the request form just opened above the piece) can land in
// the piece where it was a frame ago, though the page's DOM already has the button there (Playwright's own target check
// passes), and the form is never sent.
const tap = async (locator) => {
  await locator.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await locator.page().evaluate(nextFrames).catch(() => {});
  await locator.click({ timeout: 3000 }).catch(() => {});
};
const typeRequest = (page, text) => page.fill("#change-request-text", text, { timeout: 3000 }).catch(() => {});
// The piece is a sandboxed iframe, so Chrome runs it in its own process and does not paint it while it is out of view.
// Scrolled into view, it paints on its next frames: wait for two of its animation frames, then one of the page's,
// before a capture (without this, the capture shows the iframe's box blank).
const nextFrames = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))));
async function piecePainted(page) {
  const frame = pieceFrame(page);
  if (frame) await Promise.race([frame.evaluate(nextFrames).catch(() => false), sleep(3000)]);
  await page.evaluate(nextFrames);
}
// How many colours a viewport capture holds inside `box` (CSS px of the viewport), decoded in the page: a blank area
// is one colour.
const coloursIn = (page, png, box) => page.evaluate(async ([b64, area]) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const scale = img.width / window.innerWidth;
  const [x, y, w, h] = [area.x, area.y, area.width, area.height].map((v) => Math.max(1, Math.round(v * scale)));
  const canvas = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height });
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(x, y, w, h).data;
  const seen = new Set();
  for (let i = 0; i < data.length; i += 4) seen.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
  return seen.size;
}, [png.toString("base64"), box]);
const requestCallCount = (backend) => backend.requests.filter((r) => r === "POST /rest/v1/rpc/request_change").length;

// What the questions piece stores when the person sends (the storage a response carries): two answers, sent through the
// app. It also checks that a send passes that storage to submit_response.
async function sentQuestionsStorage(browser, base, html, { checked = true } = {}) {
  const backend = newBackend(html);
  const context = await mockedContext(browser, { backend });
  const page = await context.newPage();
  await page.goto(`${base}/#/piece/${IDS.questions}`, { waitUntil: "networkidle" });
  const frame = await appPiece(page);
  await frame.evaluate(() => { responder("q-001", "si"); responder("q-002", "no_se"); escribir("q-002", "quien", "Luis"); });
  await sendQuestions(frame);
  const sent = await settledSend(frame);
  const body = backend.submits[0];
  if (checked) check("closure: a send passes the piece's storage to submit_response as p_storage", sent && sent.sent && body && isPlain(body.p_storage) &&
    answersIn(body.p_storage)["q-002"]?.quien === "Luis", body ? JSON.stringify(Object.keys(body)) : "no call");
  await sleep(1200); // the draft with the sent mark has been saved
  const storage = body && isPlain(body.p_storage) ? body.p_storage : backend.draft;
  await context.close();
  return storage;
}

// A questions piece the factory received: sent on SENT_AT with `storage`, closed on RECEIVED_AT; the server draft is
// the same, saved a second after the send (within the grace: nothing unsent).
function closedBackend(html, storage, status = "received") {
  const backend = newBackend(html);
  backend.patch[IDS.questions] = { status, updated_at: RECEIVED_AT };
  backend.responses.push({ id: "r-sent", piece_id: IDS.questions, member_id: IDS.member, submitted_at: SENT_AT, storage, partial: false });
  backend.draft = storage;
  backend.draftUpdatedAt = "2026-10-17T15:00:01.000Z";
  return backend;
}
const earlierRequest = (pieceId) => ({ id: randomUUID(), piece_id: pieceId, member_id: IDS.member, text: "Otra cosa", payload: null, storage: null,
  late: false, created_at: REQUESTED_AT });
function newerQuestions(backend, html) {
  backend.pieces.push({ id: IDS.questionsNew, project_id: IDS.project, kind: "questions", title: "Preguntas sobre Biblioteca del barrio, ronda 2",
    revision: 2, language: "es", created_at: "2026-10-20T15:00:00Z" });
  backend.extraAssignments.push({ piece_id: IDS.questionsNew, member_id: IDS.member, status: "pending", assigned_at: "2026-10-20T15:00:00Z", updated_at: "2026-10-20T15:00:00Z" });
  backend.html[IDS.questionsNew] = html;
}

async function closureChecks(browser, base, html) {
  const storage = await sentQuestionsStorage(browser, base, html);
  if (!isPlain(storage) || !answersIn(storage)["q-001"]) { check("closure: the sent storage of the questions piece was captured", false); return; }
  async function open(backend, width, scheme, hash) {
    const context = await mockedContext(browser, { backend, width, locale: "es-CO" });
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // The failures these checks force (offline, a 400, a 401) log their failed request; anything else is an error.
    page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
    await page.goto(`${base}/${hash}`, { waitUntil: "networkidle" });
    return { context, page, errors };
  }
  // The piece screens as the viewport shows them: a full-page capture leaves the piece's iframe blank when part of it
  // is below the fold (it runs in its own process and is not painted out of view; a person scrolling does see it, see
  // piecePainted). The list is captured whole.
  const shot = (page, name, width, scheme, fullPage = false) => page.screenshot({ path: join(outDir, `${name}-${width}-${scheme}.png`), fullPage });
  const runs = [[320, "light"], [320, "dark"], [768, "light"], [768, "dark"], [1440, "light"], [1440, "dark"]];

  for (const [width, scheme] of runs) {
    const tag = `closure ${width}px ${scheme}`;
    const first = width === 320 && scheme === "light";

    // list-received: a received piece, a closed replaced version and a change request, in the list.
    {
      const backend = closedBackend(html, storage);
      backend.changeRequests.push(earlierRequest(IDS.questions));
      backend.responses.push({ id: "r-v1", piece_id: IDS.replaced, member_id: IDS.member, submitted_at: "2026-10-05T15:00:00.000Z", storage: null, partial: false });
      backend.pieces.push({ id: IDS.replacedDraft, project_id: IDS.project, kind: "flow_review", title: "Recorrido de flujos v1", revision: 1, language: "es", created_at: "2026-10-02T15:00:00Z" });
      backend.extraAssignments.push({ piece_id: IDS.replacedDraft, member_id: IDS.member, status: "replaced", assigned_at: "2026-10-02T15:00:00Z", updated_at: "2026-10-10T15:00:00Z" });
      backend.responses.push({ id: "r-partial", piece_id: IDS.replacedDraft, member_id: IDS.member, submitted_at: "2026-10-10T15:00:00.000Z", storage: null, partial: true });
      backend.patch[IDS.demo] = { status: "pending" };
      const { context, page, errors } = await open(backend, width, scheme, "");
      // «por responder» is said on home, in the project's row; the list itself is on the project page.
      await page.waitForSelector(`a[href="#/project/${IDS.project}"]`, { timeout: 10000 }).catch(() => {});
      const meta = await page.$$eval(`a[href="#/project/${IDS.project}"] .row-aside`, (els) => els.map((e) => e.textContent));
      await openProject(page).catch(() => {});
      const rows = await page.$$eval(".row", (els) => els.map((e) => ({ text: e.textContent, status: e.querySelector(".status")?.className || "" })));
      const row = (title) => rows.find((r) => r.text.includes(title));
      const received = row("Preguntas sobre Biblioteca del barrio");
      const requested = CLOSURE.listRequested(await formatIn(page, REQUESTED_AT));
      check(`${tag}: list: a received piece says «Recibida» with the done style`, received && received.text.includes(CLOSURE.listReceived) &&
        received.status.includes("status--done") && !received.text.includes("Enviada"), JSON.stringify(received));
      check(`${tag}: list: the piece with a change request says «${requested}»`, received && received.text.includes(requested), JSON.stringify(received));
      const old = row("Demo v1");
      check(`${tag}: list: a replaced version that was sent shows as «Recibida» with «${CLOSURE.listNewer}»`, old && old.text.includes(CLOSURE.listReceived) &&
        old.text.includes(CLOSURE.listNewer) && old.status.includes("status--done"), JSON.stringify(old));
      check(`${tag}: list: a replaced version with only a collected draft stays out`, !row("Recorrido de flujos v1") && rows.length === 4, JSON.stringify(rows.map((r) => r.text)));
      check(`${tag}: list: «por responder» leaves out the sent and the received pieces`, meta.some((m) => m.split(" · ").includes("1 por responder")), JSON.stringify(meta));
      check(`${tag}: list: no horizontal scroll`, await noHorizontalScroll(page));
      await shot(page, "list-received", width, scheme, true);
      if (first) await snapshot(page, "project-received", "lista");
      check(`${tag}: list: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // closed-received, then request-empty-error and request-sent on the same screen.
    {
      const backend = closedBackend(html, storage);
      // A newer partial response (a draft the factory collected) never counts as what was sent.
      backend.responses.push({ id: "r-partial", piece_id: IDS.questions, member_id: IDS.member, submitted_at: "2026-10-19T15:00:00.000Z",
        storage: { [QUESTIONS_KEY]: "{}" }, partial: true });
      backend.changeRequests.push(earlierRequest(IDS.questions));
      const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
      const frame = await appPiece(page);
      const notices = await waitFor(async () => { const n = await pinnedNotices(page); return n.length ? n : null; }, 5000) || [];
      const receivedText = CLOSURE.received(await formatIn(page, RECEIVED_AT));
      check(`${tag}: closed: one pinned notice says it was received and is in use, with «${CLOSURE.action}» and no «Cerrar aviso»`,
        notices.length === 1 && notices[0].text === receivedText && notices[0].tone === "notice--info" && notices[0].buttons.includes(CLOSURE.action) &&
        !notices[0].buttons.includes("Cerrar aviso"), JSON.stringify(notices));
      const earlier = CLOSURE.earlier(await formatIn(page, REQUESTED_AT));
      check(`${tag}: closed: an earlier request shows as «${earlier}» under the notice`, (await pinnedText(page)).includes(earlier), await pinnedText(page));
      const host = frame && await pieceHost(frame);
      check(`${tag}: closed: the piece is mounted closed ("received") with the send time`, host && host.closed === "received" && host.sentAt === SENT_AT, JSON.stringify(host && { closed: host.closed, sentAt: host.sentAt }));
      check(`${tag}: closed: the piece shows what was sent, read only («Lo que enviaste», no «Enviar respuestas»)`, host && host.h1 === "Lo que enviaste" &&
        !host.sendButton && host.quien === "Luis" && host.text.includes("Luis"), JSON.stringify(host && { h1: host.h1, answers: host.answers, quien: host.quien }));
      check(`${tag}: closed: no request form until the person asks for it`, !(await requestForm(page)));
      const line = await page.evaluate(() => { const s = document.querySelector(".piece-status"); return s && !s.hidden ? s.textContent : ""; });
      check(`${tag}: closed: the status line says nothing (the piece says when it was sent)`, line === "", line);
      check(`${tag}: closed: no horizontal scroll`, await noHorizontalScroll(page));
      await shot(page, "closed-received", width, scheme);

      await tap(requestButton(page));
      const form = await waitFor(() => requestForm(page), 3000);
      check(`${tag}: request: the form opens below the notice with its label, hint, a 4000-character field and «${CLOSURE.send}»`, form && form.inPinned &&
        form.label === CLOSURE.label && form.described.includes(CLOSURE.hint) && form.tag === "TEXTAREA" && form.maxlength === "4000" &&
        form.button && form.button.text === CLOSURE.send && form.button.primary && form.buttons === 1, JSON.stringify(form));
      check(`${tag}: request: without changes left unsent, no line about them`, form && !form.text.includes(CLOSURE.unsent), form && form.text);
      await tap(sendRequestButton(page));
      const empty = await waitFor(async () => { const f = await requestForm(page); return f && f.described.includes(CLOSURE.empty) ? f : null; }, 3000);
      check(`${tag}: request: sent empty, the field says «${CLOSURE.empty}», is marked invalid and takes the focus`, empty && empty.invalid === "true" && empty.focused &&
        requestCallCount(backend) === 0, JSON.stringify(empty));
      await typeRequest(page, "   \n ");
      await tap(sendRequestButton(page));
      await sleep(200);
      const blank = await requestForm(page);
      check(`${tag}: request: only spaces is empty too, and nothing is sent`, blank && blank.described.includes(CLOSURE.empty) && requestCallCount(backend) === 0, JSON.stringify(blank));
      if (scheme === "light") {
        const axe = await axeViolations(page);
        if (axe) check(`${tag}: request: axe on the closed piece with the form has no violations`, axe.length === 0, axe.join(", "));
      }
      check(`${tag}: request: no horizontal scroll with the form open`, await noHorizontalScroll(page));
      await shot(page, "request-empty-error", width, scheme);
      // «Cancelar» closes the form, keeps what was typed and gives the focus back to «Pedir un cambio».
      const cancel = page.getByRole("button", { name: CLOSURE.cancel, exact: true });
      const cancelInfo = await page.evaluate(([label]) => {
        const button = [...document.querySelectorAll("[data-rol=aviso-fijo] button")].find((b) => b.textContent === label);
        const primaries = document.querySelectorAll("[data-rol=aviso-fijo] .button--primary").length;
        return button ? { primary: button.classList.contains("button--primary"), primaries } : null;
      }, [CLOSURE.cancel]);
      check(`${tag}: request: the form has a secondary «${CLOSURE.cancel}» and «${CLOSURE.send}» stays the only primary`, cancelInfo && !cancelInfo.primary && cancelInfo.primaries === 1, JSON.stringify(cancelInfo));
      await typeRequest(page, "Lo pienso mejor");
      await tap(cancel);
      const closedForm = await page.evaluate(([label]) => ({ open: Boolean(document.getElementById("change-request-text")),
        focus: document.activeElement && document.activeElement.textContent === label }), [CLOSURE.action]);
      check(`${tag}: request: «${CLOSURE.cancel}» closes the form and the focus goes back to «${CLOSURE.action}»`, !closedForm.open && closedForm.focus && requestCallCount(backend) === 0, JSON.stringify(closedForm));
      await tap(requestButton(page));
      const reopenedForm = await waitFor(() => requestForm(page), 3000);
      check(`${tag}: request: opening it again brings back what was typed`, reopenedForm && reopenedForm.value === "Lo pienso mejor", JSON.stringify(reopenedForm && reopenedForm.value));

      // A failure keeps the form, the text and an error in the page.
      await typeRequest(page, "  Quiero cambiar la fecha de entrega.  ");
      backend.requestMode = "network";
      await tap(sendRequestButton(page));
      const failed = await waitFor(async () => { const f = await requestForm(page); return f && f.alert === CLOSURE.failed && f.button.text === CLOSURE.send ? f : null; }, 5000);
      check(`${tag}: request: a network failure says «${CLOSURE.failed}» in the form and keeps the text`, failed && failed.value.includes("Quiero cambiar la fecha") &&
        !failed.button.disabled && failed.invalid !== "true", JSON.stringify(failed));
      backend.requestMode = "rejected";
      const before = requestCallCount(backend);
      await tap(sendRequestButton(page));
      const rejected = await waitFor(async () => { const f = await requestForm(page); return requestCallCount(backend) > before && f && f.alert === CLOSURE.failed && f.button.text === CLOSURE.send ? f : null; }, 5000);
      check(`${tag}: request: a rejection from the server (23514) says the same, and the form stays`, rejected, JSON.stringify(rejected));
      if (first) {
        backend.authExpired = true;
        await tap(sendRequestButton(page));
        const ask = await waitFor(async () => page.evaluate(() => {
          const n = document.querySelector("[data-rol=avisos] .notice[role=alert]");
          return n && n.textContent.includes("Tu sesión terminó") && n.textContent.includes("Entrar de nuevo") ? n.textContent : null;
        }), 5000);
        const kept = await requestForm(page);
        check(`${tag}: request: a session that ended asks to sign in again, as a send does, and keeps the text`, ask && kept && kept.value.includes("Quiero cambiar la fecha"), String(ask));
        backend.authExpired = false;
      }
      backend.requestMode = "ok";
      backend.requestDelayMs = 800;
      await tap(sendRequestButton(page));
      const busy = await waitFor(async () => { const f = await requestForm(page); return f && f.button.disabled && f.button.text === CLOSURE.sending ? f : null; }, 3000);
      check(`${tag}: request: while sending, the button is off and says «${CLOSURE.sending}»`, busy, JSON.stringify(busy));
      const done = await waitFor(async () => { const t = await pinnedText(page); return t.includes(CLOSURE.sentPrefix) && !(await requestForm(page)) ? t : null; }, 5000);
      const call = backend.requestCalls.at(-1);
      check(`${tag}: request: request_change gets the trimmed text and no storage (nothing unsent)`, call && call.p_piece_id === IDS.questions &&
        call.p_text === "Quiero cambiar la fecha de entrega." && call.p_storage === null && backend.changeRequests.filter((r) => !r.late).length === 2, JSON.stringify(call));
      const confirmation = done && done.split("\n").find((l) => l.startsWith(CLOSURE.sentPrefix));
      check(`${tag}: request: the form is replaced in place by «${CLOSURE.sentPrefix}<fecha y hora>.»`, confirmation && /\d:\d\d/.test(confirmation) && confirmation.endsWith("."), String(confirmation || done));
      const live = await page.textContent("#main > [role=status]");
      check(`${tag}: request: the live region announces it`, confirmation && live === confirmation, live);
      check(`${tag}: request: no error is left in the page`, !(await page.$("[data-rol=aviso-fijo] [role=alert], [data-rol=avisos] .notice")), await page.evaluate(() => document.querySelector("[data-rol=avisos]").innerText));
      await shot(page, "request-sent", width, scheme);
      // Another request: the confirmation becomes one more «Pediste un cambio el …» line, and a new empty form opens.
      await tap(requestButton(page));
      const again = await waitFor(() => requestForm(page), 3000);
      const lines = (await pinnedText(page)).split("\n").filter((l) => l.startsWith("Pediste un cambio el "));
      check(`${tag}: request: asking again keeps the first one as a line and opens an empty form`, again && again.value === "" && lines.length === 2 &&
        !(await pinnedText(page)).includes(CLOSURE.sentPrefix), JSON.stringify({ lines, value: again && again.value }));
      check(`${tag}: closed: nothing was saved as a draft`, backend.drafts.length === 0, `${backend.drafts.length} save_draft call(s)`);
      check(`${tag}: closed: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // closed-replaced: a version the person had sent, replaced by a newer one.
    {
      const backend = closedBackend(html, storage, "replaced");
      newerQuestions(backend, html);
      const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
      const frame = await appPiece(page);
      const notices = await waitFor(async () => { const n = await pinnedNotices(page); return n.length ? n : null; }, 5000) || [];
      const actionTops = await page.evaluate(() => [...document.querySelectorAll("[data-rol=aviso-fijo] .notice-actions > *")].map((el) => {
        const range = document.createRange(); range.selectNodeContents(el); return Math.round(range.getBoundingClientRect().top); }));
      check(`${tag}: replaced: the link and «${CLOSURE.action}» in the notice share a line when side by side`, actionTops.length === 2 &&
        (Math.abs(actionTops[0] - actionTops[1]) <= 1 || Math.abs(actionTops[0] - actionTops[1]) >= 30), JSON.stringify(actionTops));
      check(`${tag}: replaced: the pinned notice says what was sent already arrived, with the link to the newer version and «${CLOSURE.action}»`, notices.length === 1 &&
        notices[0].text === CLOSURE.replaced && notices[0].links.length === 1 && notices[0].links[0].href === `#/piece/${IDS.questionsNew}` &&
        notices[0].links[0].label === "Abrir la versión nueva" && notices[0].buttons.includes(CLOSURE.action) && !notices[0].buttons.includes("Cerrar aviso"), JSON.stringify(notices));
      const host = frame && await pieceHost(frame);
      check(`${tag}: replaced: the piece is mounted closed ("replaced") and shows what was sent`, host && host.closed === "replaced" && host.sentAt === SENT_AT &&
        host.h1 === "Lo que enviaste" && !host.sendButton && host.quien === "Luis", JSON.stringify(host && { closed: host.closed, h1: host.h1 }));
      await shot(page, "closed-replaced", width, scheme);
      await tap(requestButton(page));
      await waitFor(() => requestForm(page), 3000);
      await typeRequest(page, "Cambia mi respuesta de la primera pregunta");
      await tap(sendRequestButton(page));
      const done = await waitFor(async () => ((await pinnedText(page)).includes(CLOSURE.sentPrefix) ? true : null), 5000);
      check(`${tag}: replaced: a change request reaches request_change`, done && backend.requestCalls.length === 1 && backend.requestCalls[0].p_piece_id === IDS.questions, JSON.stringify(backend.requestCalls));
      check(`${tag}: replaced: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // closed-replaced, no newer version found: the link goes to the project (the list of what was shared), not to home.
    {
      const backend = closedBackend(html, storage, "replaced");
      const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
      await appPiece(page);
      const notices = await waitFor(async () => { const n = await pinnedNotices(page); return n.length ? n : null; }, 5000) || [];
      check(`${tag}: replaced, no newer one: the link goes to the project`, notices.length === 1 && notices[0].links.length === 1 &&
        notices[0].links[0].href === `#/project/${IDS.project}` && notices[0].links[0].label === "Ver lo que te compartimos", JSON.stringify(notices));
      check(`${tag}: replaced, no newer one: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // request-with-unsent: the draft is newer than the send by more than the grace.
    {
      const backend = closedBackend(html, storage);
      const state = JSON.parse(storage[QUESTIONS_KEY]);
      state.respuestas = { ...state.respuestas, "q-004": { ...state.respuestas["q-001"] } };
      const draft = { ...storage, [QUESTIONS_KEY]: JSON.stringify(state) };
      backend.draft = draft;
      backend.draftUpdatedAt = "2026-10-17T15:01:00.000Z";
      const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
      const frame = await appPiece(page);
      const host = frame && await pieceHost(frame);
      check(`${tag}: unsent: the piece shows what was sent, not the newer draft`, host && host.closed === "received" && !host.answers.includes("q-004") &&
        host.answers.includes("q-001"), JSON.stringify(host && host.answers));
      await tap(requestButton(page));
      const form = await waitFor(() => requestForm(page), 3000);
      check(`${tag}: unsent: the form says «${CLOSURE.unsent}»`, form && form.described.includes(CLOSURE.unsent) && form.text.includes(CLOSURE.unsent), JSON.stringify(form));
      await typeRequest(page, "Me faltó la cuarta pregunta");
      await shot(page, "request-with-unsent", width, scheme);
      await tap(sendRequestButton(page));
      await waitFor(async () => ((await pinnedText(page)).includes(CLOSURE.sentPrefix) ? true : null), 5000);
      const call = backend.requestCalls[0];
      check(`${tag}: unsent: the draft goes with the request as p_storage`, call && JSON.stringify(call.p_storage) === JSON.stringify(draft), JSON.stringify(call && Object.keys(call.p_storage || {})));
      check(`${tag}: unsent: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // late-send: a tab left open on a sent piece; the factory receives it; the person changes something and sends.
    {
      const backend = closedBackend(html, storage, "submitted");
      const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
      const frame = await appPiece(page);
      const hostBefore = frame && await pieceHost(frame);
      check(`${tag}: late: before the close the piece opens as today (not closed)`, hostBefore && hostBefore.closed === null, JSON.stringify(hostBefore && hostBefore.closed));
      await frame.evaluate(() => { if (isSent()) editar(); responder("q-004", "si"); });
      await waitFor(() => backend.drafts.length > 0, 5000);
      const closedAt = new Date().toISOString();
      backend.patch[IDS.questions] = { status: "received", updated_at: closedAt };
      await sendQuestions(frame);
      await waitFor(() => backend.lateSubmits.length > 0, 8000);
      const late = backend.lateSubmits[0];
      check(`${tag}: late: the send on the closed piece reaches submit_response with p_storage`, late && isPlain(late.p_storage) && answersIn(late.p_storage)["q-004"] &&
        late.p_payload && late.p_payload.formato === "respuestas-fabrica/1" && backend.submits.length === 0, JSON.stringify(late && Object.keys(late)));
      const notices = await waitFor(async () => { const n = await pinnedNotices(page); return n.length === 2 ? n : null; }, 8000) || await pinnedNotices(page);
      const receivedText = CLOSURE.received(await formatIn(page, closedAt));
      check(`${tag}: late: the re-opened piece says the send arrived as a change request, pinned above the received notice`, notices.length === 2 &&
        notices[0].text === CLOSURE.late && !notices[0].buttons.includes(CLOSURE.action) && notices[1].text === receivedText &&
        notices[1].buttons.includes(CLOSURE.action), JSON.stringify(notices));
      const reopened = await appPiece(page);
      const host = reopened && await pieceHost(reopened);
      check(`${tag}: late: the re-opened piece is closed and shows what was sent`, host && host.closed === "received" && !host.answers.includes("q-004"), JSON.stringify(host && { closed: host.closed, answers: host.answers }));
      await shot(page, "late-send", width, scheme);
      // The late send already carried the draft: the form does not offer it again.
      await tap(requestButton(page));
      const lateForm = await waitFor(() => requestForm(page), 3000);
      check(`${tag}: late: the form does not say «${CLOSURE.unsent}» (the late send carried the draft)`, lateForm && !lateForm.text.includes(CLOSURE.unsent) &&
        !lateForm.described.includes(CLOSURE.unsent), JSON.stringify(lateForm && lateForm.described));
      await typeRequest(page, "Y una cosa más");
      await tap(sendRequestButton(page));
      await waitFor(async () => (backend.requestCalls.length && (await pinnedText(page)).includes(CLOSURE.sentPrefix) ? true : null), 8000);
      const lateCall = backend.requestCalls[0];
      check(`${tag}: late: a request after it goes without p_storage`, lateCall && lateCall.p_storage === null,
        JSON.stringify(lateCall ? Object.keys(lateCall) : { rpc: backend.requests.filter((r) => r.includes("rpc/")), form: await requestForm(page), pinned: await pinnedText(page) }));
      if (first) {
        await page.click(".back-link");
        await page.waitForSelector(`a[href="#/piece/${IDS.questions}"]`, { timeout: 10000 });
        await page.click(`a[href="#/piece/${IDS.questions}"]`);
        await appPiece(page);
        const again = await waitFor(async () => { const n = await pinnedNotices(page); return n.length ? n : null; }, 5000) || [];
        check(`${tag}: late: the notice about the late send shows once`, again.length === 1 && again[0].text === receivedText, JSON.stringify(again));
      }
      check(`${tag}: late: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // A phone (320 x 640) with the late notice, the received notice and the form open: the page scrolls as one (MAR-14),
    // the iframe as tall as the piece, and both the form and the piece's start can be reached. Then the piece is reopened
    // by the factory while the person writes: request_change answers 55000 and the portal opens the piece again (open),
    // never the network error.
    if (first) {
      const backend = closedBackend(html, storage);
      backend.changeRequests.push(earlierRequest(IDS.questions));
      const context = await mockedContext(browser, { backend, width: 320, height: 640, locale: "es-CO" });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(`${base}/#/piece/${IDS.questions}`, { waitUntil: "networkidle" });
      const closedFrame = await appPiece(page);
      await tap(requestButton(page));
      await waitFor(() => requestForm(page), 3000);
      const sizeOf = async () => ({ ...(await page.evaluate(() => ({ iframe: document.querySelector("iframe.piece-frame").getBoundingClientRect().height,
        vh: window.innerHeight, scroll: document.documentElement.scrollHeight }))),
        piece: closedFrame && await closedFrame.evaluate(() => document.documentElement.getBoundingClientRect().height).catch(() => null) });
      const sizes = (await waitFor(async () => { const s = await sizeOf(); return Math.abs(s.iframe - s.piece) <= 1 ? s : null; }, 3000)) || await sizeOf();
      const field = await page.evaluate(() => { const r = document.getElementById("change-request-text").getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; });
      check(`${tag}: short phone: with the form open the page scrolls, the iframe as tall as the piece, and the form is in the window`,
        sizes.scroll > sizes.vh && Math.abs(sizes.iframe - sizes.piece) <= 1 && field.top >= 0 && field.bottom <= sizes.vh, JSON.stringify({ sizes, field }));
      await shot(page, "request-short-phone", 320, "light");
      // The piece, scrolled into view once it has painted (a full-page capture leaves an iframe below the fold blank):
      // its heading inside the screen and painted in that capture.
      await page.evaluate(() => document.querySelector("iframe.piece-frame").scrollIntoView());
      await piecePainted(page);
      const scrolledShot = await page.screenshot({ path: join(outDir, "request-short-phone-320-light-scrolled.png") });
      const heading = pieceFrame(page)?.getByRole("heading", { name: "Lo que enviaste", exact: true });
      const headingBox = heading && await heading.boundingBox().catch(() => null);
      const inView = Boolean(headingBox) && headingBox.height > 0 && headingBox.y >= 0 && headingBox.y + headingBox.height <= sizes.vh;
      const headingColours = inView ? await coloursIn(page, scrolledShot, headingBox) : 0;
      check(`${tag}: short phone: scrolled to the piece's start, its «Lo que enviaste» is inside the screen and painted in the capture`,
        inView && headingColours > 1, JSON.stringify({ headingBox, vh: sizes.vh, headingColours }));
      await typeRequest(page, "Quiero cambiar algo");
      backend.patch[IDS.questions] = { status: "submitted", updated_at: new Date().toISOString() };
      await tap(sendRequestButton(page));
      const reopened = await waitFor(async () => {
        const f = pieceFrame(page);
        const host = f && await f.evaluate(() => (typeof factoryHost === "object" ? factoryHost.closed : "none")).catch(() => "none");
        return host === null && !(await page.$("#change-request-text")) ? true : null;
      }, 8000);
      const pinnedNow = await pinnedText(page);
      check(`${tag}: reopened meanwhile: request_change answers 55000 and the piece opens again, open, without the network error`,
        reopened && !pinnedNow.includes(CLOSURE.failed) && !(await page.evaluate(() => document.body.innerText)).includes(CLOSURE.failed) &&
        backend.requestCalls.length === 1 && backend.changeRequests.filter((r) => r.text === "Quiero cambiar algo").length === 0, JSON.stringify({ reopened, pinnedNow }));
      check(`${tag}: short phone: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // The read that tells a late send apart fails (M-3): the piece hears ok, since the server stored the send, and it
    // opens again as the server has it — closed after a late send, open after a normal one — never as a guess.
    if (first) {
      for (const lateOnServer of [true, false]) {
        const what = lateOnServer ? "a late send" : "a normal send";
        const backend = closedBackend(html, storage, "submitted");
        const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
        const frame = await appPiece(page);
        await frame.evaluate(() => { if (isSent()) editar(); responder("q-004", "si"); });
        await waitFor(() => backend.drafts.length > 0, 5000);
        const closedAt = new Date().toISOString();
        if (lateOnServer) backend.patch[IDS.questions] = { status: "received", updated_at: closedAt };
        backend.lateReadFails = true;
        const mounts = () => backend.requests.filter((r) => r.startsWith("GET /rest/v1/pieces") && r.includes("html")).length;
        const before = mounts();
        await sendQuestions(frame);
        const stored = await waitFor(() => (lateOnServer ? backend.lateSubmits.length : backend.submits.length) > 0 || null, 8000);
        const failedRead = backend.requests.some((r) => r.startsWith("GET /rest/v1/piece_change_requests") && r.includes("id=eq."));
        const reopened = await waitFor(async () => (mounts() > before && await appPiece(page, 2000) ? true : null), 8000);
        const host = reopened && await pieceHost(await appPiece(page));
        const notices = await pinnedNotices(page);
        const bodyText = await page.evaluate(() => document.body.innerText);
        const receivedText = CLOSURE.received(await formatIn(page, closedAt));
        check(`${tag}: late read fails, ${what}: stored once and the piece opens again as the server has it`,
          stored && failedRead && reopened && host && (lateOnServer
            ? host.closed === "received" && notices.length === 1 && notices[0].text === receivedText && backend.submits.length === 0
            : host.closed === null && notices.length === 0 && backend.lateSubmits.length === 0),
          JSON.stringify({ stored, failedRead, reopened, closed: host && host.closed, notices }));
        check(`${tag}: late read fails, ${what}: no error in the page`, !bodyText.includes(CLOSURE.failed) &&
          !bodyText.includes("No se pudo enviar") && !bodyText.includes("No hay conexión"), bodyText.slice(0, 300));
        check(`${tag}: late read fails, ${what}: no page errors`, errors.length === 0, errors.join(" | "));
        await context.close();
      }
    }

    // Signing out with a change request written and not sent (M-5): the portal asks in the page, as with unsaved
    // drafts; staying keeps the text; confirming signs out.
    if (first) {
      const backend = closedBackend(html, storage);
      const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
      await appPiece(page);
      await tap(requestButton(page));
      await waitFor(() => requestForm(page), 3000);
      await typeRequest(page, "Quiero cambiar la fecha");
      await page.click(".back-link", { timeout: 5000 }).catch(() => {});
      await page.waitForSelector(".masthead .button--secondary", { timeout: 10000 }).catch(() => {});
      await page.click(".masthead .button--secondary", { timeout: 3000 }).catch(() => {});
      const asked = await waitFor(async () => page.evaluate((text) => {
        const n = document.querySelector("[data-rol=avisos] .notice");
        return n && n.textContent.includes(text) ? { buttons: [...n.querySelectorAll("button")].map((b) => b.textContent) } : null;
      }, CLOSURE.signOutUnsent), 8000);
      const stillIn = await page.evaluate((k) => Boolean(localStorage.getItem(k)), STORAGE_KEY) && !(await page.$("#email"));
      check(`${tag}: sign-out with an unsent request asks «${CLOSURE.signOutUnsent}» and signs nothing out yet`,
        asked && asked.buttons.includes(CLOSURE.signOutLose) && asked.buttons.includes(CLOSURE.stay) && stillIn, JSON.stringify({ asked, stillIn }));
      await page.click(`text=${CLOSURE.stay}`, { timeout: 3000 }).catch(() => {});
      await page.waitForSelector(`a[href="#/piece/${IDS.questions}"]`, { timeout: 10000 }).catch(() => {});
      await page.click(`a[href="#/piece/${IDS.questions}"]`, { timeout: 3000 }).catch(() => {});
      await appPiece(page);
      await tap(requestButton(page));
      const kept = await waitFor(() => requestForm(page), 3000);
      check(`${tag}: staying keeps the request text`, kept && kept.value === "Quiero cambiar la fecha", JSON.stringify(kept && kept.value));
      await page.click(".back-link", { timeout: 5000 }).catch(() => {});
      await page.waitForSelector(".masthead .button--secondary", { timeout: 10000 }).catch(() => {});
      await page.click(".masthead .button--secondary", { timeout: 3000 }).catch(() => {});
      await page.click(`text=${CLOSURE.signOutLose}`, { timeout: 8000 }).catch(() => {});
      const out = await waitFor(async () => page.evaluate((k) => (document.querySelector("#email") ? { session: localStorage.getItem(k) } : null), STORAGE_KEY), 10000);
      check(`${tag}: confirming signs out to a clean sign-in`, out && !out.session, JSON.stringify(out));
      check(`${tag}: sign-out with a request: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }

    // A replaced version with only a collected draft (partial) is not closed: it opens as today (R3).
    if (first) {
      const backend = newBackend(html);
      backend.patch[IDS.questions] = { status: "replaced" };
      backend.responses.push({ id: "r-partial", piece_id: IDS.questions, member_id: IDS.member, submitted_at: SENT_AT, storage: storage, partial: true });
      newerQuestions(backend, html);
      const { context, page, errors } = await open(backend, width, scheme, `#/piece/${IDS.questions}`);
      const frame = await appPiece(page);
      const notices = await waitFor(async () => { const n = await pinnedNotices(page); return n.length ? n : null; }, 5000) || [];
      const host = frame && await pieceHost(frame);
      check(`${tag}: partial only: a replaced version whose only response is a collected draft opens as today, without «${CLOSURE.action}»`,
        notices.length === 1 && notices[0].text === CLOSURE.replacedOpen && !notices[0].buttons.includes(CLOSURE.action) && host && host.closed === null,
        JSON.stringify({ notices, closed: host && host.closed }));
      check(`${tag}: partial only: no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
  }
}

// ---- the projects home and the project page ---------------------------------------------------------------
// Home lists the person's projects (the ones with something asked of them, and the ones they own: owner_projects()),
// each row linking to its page and saying what decides there; a project's page lists what was asked of the person and
// ends saying what the owner sees; the piece screen goes back to its project; an old email's #/piece/<id> still opens
// the piece; and opening an open piece records «la abrió» (mark_piece_opened) once per open, never for a closed one,
// and a call that fails never stops the piece (spec 2026-10-25 página del proyecto §4.1, §4.5).
const PROJECT = {
  title: "Tus proyectos",
  name: "Portal de prueba",
  owned: "Biblioteca del barrio",
  askedOfYou: "Lo que se te pidió",
  ownerSees: "El responsable del proyecto ve cuándo abres lo que te compartimos o esta sección, y lo que envías.",
  back: "Tus proyectos",
  notFoundTitle: "No está disponible",
  notFound: "No encontramos este proyecto entre los tuyos. Puede que ya no esté disponible.",
};
// What owner_projects() answers for a project, worked out from what owner_project answers for it, as the SQL does: its
// people (the distinct members with at least one assignment, the owner included: the ones the owner's part lists) and
// its newest send. No count is written by hand, so home and the project's page always speak of the same project.
function ownerSummary(view) {
  const assignments = view.pieces.flatMap((p) => p.assignments);
  const sends = assignments.map((a) => a.sent_at).filter(Boolean).sort();
  return { ...view.project, people: new Set(assignments.map((a) => a.member_id)).size,
    last_response_at: sends.at(-1) || null };
}
// The person (Ana) also owns a second project, «Biblioteca del barrio» (ownedView), where nothing is asked of her.
function ownerBackend(html) {
  const backend = newBackend(html);
  const view = ownedView();
  backend.members.push({ id: IDS.ownerMember, project_id: IDS.ownedProject, email: USER.email, user_id: USER.id, role: "owner", display_name: "Ana Pérez" });
  backend.projects.push(view.project);
  backend.ownedIds = [IDS.ownedProject];
  backend.ownerView[IDS.ownedProject] = view;
  backend.ownedProjects = [ownerSummary(view)];
  return backend;
}
const projectRowsOf = (page) => page.$$eval(".row-link", (els) => els.map((a) => ({ href: a.getAttribute("href"),
  title: a.querySelector(".row-title")?.textContent || null, meta: a.querySelector(".row-meta")?.textContent || null,
  aside: a.querySelector(".row-aside")?.textContent || null })));
// The page as the person sees it: its title, the back link above it, its sections and the last line of its body.
const projectView = (page) => page.evaluate(() => {
  const back = document.querySelector("[data-rol=marco] .back-link");
  const body = document.querySelector("[data-rol=cuerpo]");
  return {
    hash: location.hash, h1: document.querySelector("h1")?.textContent || null,
    back: back ? { href: back.getAttribute("href"), text: back.textContent, label: back.getAttribute("aria-label"),
      beforeTitle: Boolean(back.compareDocumentPosition(document.querySelector("h1")) & Node.DOCUMENT_POSITION_FOLLOWING) } : null,
    sections: [...document.querySelectorAll("[data-rol=cuerpo] section h2")].map((h) => h.textContent),
    pieces: [...document.querySelectorAll('[data-rol=cuerpo] .row-link[href^="#/piece/"]')].map((a) => a.getAttribute("href")),
    first: body && body.firstElementChild ? body.firstElementChild.textContent : null,
    notices: [...document.querySelectorAll("[data-rol=avisos] .notice")].map((n) => ({ text: n.querySelector("p")?.textContent, role: n.getAttribute("role") })),
  };
});
// What home says of an owned project, worked out from what its page shows: its people (the names in the owner's part) and
// the last send; a count of 0 is not said. ownerFirst: «Eres responsable» goes first, when the row's right says what is
// left to answer (askedToAnswer: the page's «Lo que se te pidió» entries not yet sent).
function homeMetaFrom(part, lastSent, { ownerFirst = false } = {}) {
  const people = new Set(part.pieces.flatMap((p) => p.people.map((x) => x.name))).size;
  const segments = ownerFirst ? ["Eres responsable"] : [];
  if (people) segments.push(people === 1 ? "1 persona" : `${people} personas`);
  if (lastSent) segments.push(`última respuesta el ${lastSent}`);
  return segments.length ? segments.join(" · ") : null;
}
// What the row's right on home counts, read on the project's page: the entries of «Lo que se te pidió» not yet sent (not
// «Enviada» nor «Recibida»); 0 when the page has no such section.
const askedToAnswer = (page) => page.evaluate((asked) => {
  const section = [...document.querySelectorAll("[data-rol=cuerpo] section")].find((el) => el.querySelector("h2")?.textContent === asked);
  if (!section) return 0;
  return [...section.querySelectorAll(".row-link .status")].filter((el) => !["Enviada", "Recibida"].includes(el.textContent.trim())).length;
}, PROJECT.askedOfYou);
const asideFrom = (toAnswer) => (toAnswer > 0 ? `${toAnswer} por responder` : "Eres responsable");
const openedCalls = (backend) => backend.requests.filter((r) => r === "POST /rest/v1/rpc/mark_piece_opened").length;

async function projectPageChecks(browser, base, html) {
  async function open(backend, hash = "", width = 360) {
    const context = await mockedContext(browser, { backend, width, locale: "es-CO" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    // The failures these checks force (offline, a 404, a 401) log their failed request; anything else is an error.
    page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
    await page.goto(`${base}/${hash}`, { waitUntil: "networkidle" });
    return { context, page, errors };
  }
  const goHash = async (page, hash, ready) => {
    await page.evaluate((h) => { location.hash = h; }, hash);
    return waitFor(ready, 10000);
  };

  // home-projects, project-page, piece-back-to-project and opened-once, on one visit.
  {
    const backend = ownerBackend(html);
    const { context, page, errors } = await open(backend);
    await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
    const view = await page.evaluate(() => ({ h1: document.querySelector("h1")?.textContent, lang: document.documentElement.lang,
      meta: [...document.querySelectorAll(".page-meta")].map((p) => p.textContent) }));
    const rows = await projectRowsOf(page);
    const last = await formatIn(page, AT.sent);
    check("home-projects: the title is «Tus proyectos», with how many projects and who is signed in", view.h1 === PROJECT.title && view.lang === "es" &&
      view.meta[0] === "2 proyectos" && view.meta[1] === `Entraste como ${USER.email}`, JSON.stringify(view));
    check("home-projects: one row per project, by name, each linking to #/project/…, and no piece on home", rows.length === 2 &&
      rows[0].href === `#/project/${IDS.ownedProject}` && rows[1].href === `#/project/${IDS.project}` && !(await page.$('a[href^="#/piece/"]')), JSON.stringify(rows));
    check("home-projects: the person's project says what is left to answer, on the row's right like a list's state", rows[1] && rows[1].title === PROJECT.name &&
      rows[1].aside === "1 por responder" && !rows[1].meta, JSON.stringify(rows[1]));
    check("home-projects: an owned project says so on the right, and its people and the last response under its name", rows[0] &&
      rows[0].title === PROJECT.owned && rows[0].aside === "Eres responsable" &&
      rows[0].meta === `4 personas · última respuesta el ${last}`, JSON.stringify(rows[0]));
    check("home-projects: 360px no horizontal scroll", await noHorizontalScroll(page));
    // Below 1056 a row keeps its label on the row's right edge, as the project lists carry the state; from 1056 the rows are
    // columns (listColumnChecks, on every list screen).
    await page.setViewportSize({ width: 672, height: 900 });
    const wide = await page.$$eval(".rows .row-link", (els) => els.map((a) => {
      const aside = a.querySelector(".row-aside");
      return aside ? Math.abs(a.getBoundingClientRect().right - aside.getBoundingClientRect().right) : null;
    }));
    check("home-projects: at 672 every row carries its label on the right edge, as the project lists carry the state",
      wide.length === 2 && wide.every((gap) => gap !== null && gap <= 1), JSON.stringify(wide));
    // A list in which no row has a meta line (every project another person's) has two equal columns, title · state, at 1056 and up.
    await page.setViewportSize({ width: 1056, height: 900 });
    await page.evaluate(() => document.querySelectorAll(".rows .row-meta").forEach((el) => el.remove()));
    listColumnChecks("home-projects (no meta line in any row)", 1056, "light", await listColumns(page));
    await page.reload({ waitUntil: "networkidle" });
    await page.setViewportSize({ width: 360, height: 780 });
    await page.screenshot({ path: join(outDir, "home-projects-360.png"), fullPage: true });
    await snapshot(page, "home-projects", "lista");
    const homeAxe = await axeViolations(page);
    if (homeAxe) check("home-projects: axe has no violations", homeAxe.length === 0, homeAxe.join(", "));

    await openProject(page).catch(() => {});
    const project = await projectView(page);
    check("project-page: the title is the project's name, under «← Tus proyectos», which goes home", project.hash === `#/project/${IDS.project}` &&
      project.h1 === PROJECT.name && project.back && project.back.href === "#/" && project.back.text.includes(PROJECT.back) && project.back.beforeTitle,
      JSON.stringify(project));
    check(`project-page: «${PROJECT.askedOfYou}» lists the person's pieces, each opening it`, project.sections[0] === PROJECT.askedOfYou &&
      project.pieces.length === 3 && [IDS.questions, IDS.flow, IDS.demo].every((id) => project.pieces.includes(`#/piece/${id}`)), JSON.stringify(project));
    // First in the body: on a phone what follows it shows within the first screen, however long the list (FUN-42).
    check("project-page: it starts with the line that says what the owner sees", project.first === PROJECT.ownerSees, JSON.stringify(project.first));
    check("project-page: 360px no horizontal scroll", await noHorizontalScroll(page));
    await page.screenshot({ path: join(outDir, "project-page-360.png"), fullPage: true });
    await snapshot(page, "project-page", "lista");
    const projectAxe = await axeViolations(page);
    if (projectAxe) check("project-page: axe has no violations", projectAxe.length === 0, projectAxe.join(", "));
    check("project-page: opening the list records no opening", openedCalls(backend) === 0, String(openedCalls(backend)));

    // The piece screen goes back to its project, with its name.
    await page.click(`a[href="#/piece/${IDS.questions}"]`).catch(() => {});
    await appPiece(page);
    const back = await page.evaluate(() => { const a = document.querySelector(".back-link"); return a && { href: a.getAttribute("href"), text: a.textContent, label: a.getAttribute("aria-label") }; });
    check("piece-back-to-project: the piece's back link goes to its project, named", back && back.href === `#/project/${IDS.project}` &&
      back.text.includes(PROJECT.name), JSON.stringify(back));
    check("opened-once: opening an open piece calls mark_piece_opened once, for that piece", await waitFor(() => backend.openedCalls.length === 1, 3000) &&
      backend.openedCalls[0].p_piece_id === IDS.questions && backend.openedCalls[0].sub === USER.id, JSON.stringify(backend.openedCalls));
    await page.click(".back-link").catch(() => {});
    const returned = await waitFor(async () => { const v = await projectView(page); return v.h1 === PROJECT.name && v.pieces.length ? v : null; }, 10000);
    check("piece-back-to-project: it lands on the project's page", returned && returned.hash === `#/project/${IDS.project}`, JSON.stringify(returned));
    await page.click(`a[href="#/piece/${IDS.questions}"]`).catch(() => {});
    await appPiece(page);
    await sleep(500);
    check("opened-once: opening it again calls it once more (the server keeps the first date)", backend.openedCalls.length === 2, JSON.stringify(backend.openedCalls));
    // A closed piece (received) records nothing.
    backend.patch[IDS.demo] = { status: "received", updated_at: RECEIVED_AT };
    backend.responses.push({ id: "r-demo", piece_id: IDS.demo, member_id: IDS.member, submitted_at: SENT_AT, storage: null, partial: false });
    await goHash(page, `#/piece/${IDS.demo}`, async () => (await page.$("iframe.piece-frame")) && (await page.textContent("h1.piece-title").catch(() => "")) === "Demo v2");
    await sleep(1000);
    check("opened-once: a closed piece records no opening", backend.openedCalls.length === 2 && openedCalls(backend) === 2, JSON.stringify(backend.openedCalls));

    // An owned project with nothing asked of the person: its page, without «Lo que se te pidió».
    const owned = await goHash(page, `#/project/${IDS.ownedProject}`, async () => { const v = await projectView(page); return v.h1 === PROJECT.owned ? v : null; });
    check(`project-page: an owned project with nothing asked of the person has no «${PROJECT.askedOfYou}»`, owned && !owned.sections.includes(PROJECT.askedOfYou) &&
      owned.pieces.length === 0 && owned.back && owned.back.href === "#/", JSON.stringify(owned));
    // A project that is not the person's: the not-found notice, as a piece.
    const unknown = await goHash(page, `#/project/${IDS.unknownProject}`, async () => { const v = await projectView(page); return v.h1 === PROJECT.notFoundTitle ? v : null; });
    check("project-page: a project that is not the person's says it is not available", unknown && unknown.notices.length === 1 &&
      unknown.notices[0].text === PROJECT.notFound && unknown.pieces.length === 0, JSON.stringify(unknown));
    check("home-projects / project-page: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // An owned project where nothing was shared yet (owner_project lists no pieces), and nothing asked of its owner: home
  // says no count of 0, and the page has the owner's own line, never the line for the people asked.
  {
    const backend = ownerBackend(html);
    backend.ownerView[IDS.ownedProject].pieces = [];
    backend.ownerView[IDS.ownedProject].change_requests = [];
    backend.ownedProjects = [ownerSummary(backend.ownerView[IDS.ownedProject])];
    const { context, page, errors } = await open(backend);
    await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
    const row = (await projectRowsOf(page)).find((r) => r.href === `#/project/${IDS.ownedProject}`);
    check("home-projects: an owned project with nothing shared yet says it is the owner's, without a count of 0", row && row.aside === "Eres responsable" &&
      !row.meta, JSON.stringify(row));
    const owned = await goHash(page, `#/project/${IDS.ownedProject}`, async () => { const v = await projectView(page); return v.h1 === PROJECT.owned ? v : null; });
    const body = await page.evaluate(() => [...document.querySelector("[data-rol=cuerpo]").children].map((el) => ({ cls: el.className, text: el.innerText })));
    check(`project-page: an owned project with nothing shared yet nor asked shows the owner's line «${OWNER.empty}», not «${PROJECT.ownerSees}»`, owned &&
      !owned.sections.includes(PROJECT.askedOfYou) && owned.pieces.length === 0 && body.length === 1 && body[0].text.includes(OWNER.empty) &&
      !body.some((b) => b.text.includes(PROJECT.ownerSees)), JSON.stringify(body));
    check("project-page: nothing shared yet: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // D: an owned project where nobody is waiting (every send in): home says its people and last send, the same as always.
  {
    const backend = ownerBackend(html);
    const view = backend.ownerView[IDS.ownedProject];
    for (const piece of view.pieces) for (const a of piece.assignments) {
      if (a.status === "pending" || a.status === "in_progress") Object.assign(a, { status: "submitted", sent_at: AT.sent, readable: true, updated_at: AT.sent });
    }
    backend.ownedProjects = [ownerSummary(view)];
    const { context, page, errors } = await open(backend);
    await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
    const row = (await projectRowsOf(page)).find((r) => r.href === `#/project/${IDS.ownedProject}`);
    const last = await formatIn(page, AT.sent);
    await page.click(`a[href="#/project/${IDS.ownedProject}"]`).catch(() => {});
    const part = await waitFor(() => ownerPart(page), 10000);
    check("home-projects: with nobody waiting, an owned project says its people and last send, and no count of 0", row && part &&
      row.meta === `4 personas · última respuesta el ${last}` && row.meta === homeMetaFrom(part, last) && !/(^| )0 /.test(row.meta), JSON.stringify({ row, expected: part && homeMetaFrom(part, last) }));
    check("home-projects: nobody waiting: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // An owner with something left to answer in their own project: both are said on its row.
  {
    const backend = ownerBackend(html);
    // Her own project, «Portal de prueba»: Ana has the questions to answer and Luis has them in progress; nothing sent yet.
    backend.ownedProjects.push(ownerSummary({ project: backend.projects[0], members: [], change_requests: [], pieces: [
      { id: IDS.questions, assignments: [ownerAssignment({ id: IDS.member }, "pending"), ownerAssignment(PEOPLE.luis, "in_progress")] }] }));
    const { context, page, errors } = await open(backend);
    await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
    const rows = await projectRowsOf(page);
    check("home-projects: an owned project with something to answer says both, without a last response it does not have",
      rows[1] && rows[1].aside === "1 por responder" && rows[1].meta === "Eres responsable · 2 personas", JSON.stringify(rows[1]));
    check("home-projects: owner and something to answer: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // An old database (no owner_projects): home still lists the person's projects; everything sent says so.
  {
    const backend = ownerBackend(html);
    backend.ownerRpcsMissing = true;
    backend.submits.push({ p_piece_id: IDS.questions, p_payload: {}, submitted_at: SENT_AT });
    const { context, page, errors } = await open(backend);
    await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
    const rows = await projectRowsOf(page);
    const notices = await page.$$eval("[data-rol=avisos] .notice", (els) => els.map((n) => n.textContent));
    check("home-projects: without owner_projects (an old database) home lists the person's projects, without a notice",
      rows.length === 1 && rows[0].href === `#/project/${IDS.project}` && rows[0].aside === "Todo enviado" && !rows[0].meta && notices.length === 0 &&
      backend.requests.some((r) => r.startsWith("POST /rest/v1/rpc/owner_projects")), JSON.stringify({ rows, notices }));
    check("home-projects: an old database: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // owner_projects fails otherwise: the list cannot be trusted, so home says it could not load, with «Reintentar».
  {
    const backend = ownerBackend(html);
    backend.ownerRpcsFail = true;
    const { context, page } = await open(backend);
    const alert = await waitFor(() => page.evaluate(() => document.querySelector("[data-rol=avisos] .notice[role=alert]")?.textContent || null), 8000);
    check("home-projects: another owner_projects error shows the load error with «Reintentar»", alert && alert.includes("No pudimos cargar") &&
      alert.includes("Reintentar") && !(await page.$(".row-link")), String(alert));
    await context.close();
  }

  // opened-call-fails: offline, a database without the function, an ended session: the piece opens and saves anyway.
  for (const mode of ["network", "missing", "expired"]) {
    const backend = newBackend(html);
    backend.openedFails = mode;
    const { context, page, errors } = await open(backend, `#/piece/${IDS.questions}`);
    const frame = await appPiece(page);
    const tried = await waitFor(() => openedCalls(backend) === 1, 3000);
    if (frame) await frame.evaluate(() => responder("q-001", "si"));
    const saved = frame && await waitFor(async () => backend.drafts.length && (await page.textContent(".piece-status")).includes("Guardado"), 5000);
    const alerts = await page.$$eval("[data-rol=avisos] .notice", (els) => els.map((n) => n.textContent));
    check(`opened-call-fails (${mode}): the piece mounts and a change still saves, with no notice`, tried && frame && saved && alerts.length === 0,
      JSON.stringify({ tried, frame: Boolean(frame), saved, alerts }));
    check(`opened-call-fails (${mode}): no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // old-email-link: #/piece/<id> from an email opens the piece, which goes back to its project.
  {
    const backend = newBackend(html);
    const { context, page, errors } = await open(backend, `#/piece/${IDS.questions}`);
    const frame = await appPiece(page);
    const state = await page.evaluate(() => ({ hash: location.hash, title: document.querySelector("h1.piece-title")?.textContent,
      back: document.querySelector(".back-link")?.getAttribute("href") }));
    check("old-email-link: #/piece/<id> still opens the piece, which goes back to its project", frame && state.hash === `#/piece/${IDS.questions}` &&
      state.title === "Preguntas sobre Biblioteca del barrio" && state.back === `#/project/${IDS.project}`, JSON.stringify(state));
    check("old-email-link: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // color-con-un-significado (judges, round 5): in the person's own list a piece with a saved draft reads «En curso» with the
  // same mark as in the owner's part, the ink ring, never the ink-filled dot the pieces keep for «Con observaciones».
  {
    const backend = newBackend(html);
    backend.draft = { other: "x" };
    const { context, page } = await open(backend, `#/project/${IDS.project}`);
    await page.waitForSelector(`a[href="#/piece/${IDS.questions}"] .status`, { timeout: 10000 }).catch(() => {});
    const drawn = await portalDots(page);
    check("project-page: a piece in progress in the person's list is «En curso» with the ink ring (hollow, its border the ink)",
      drawn.dots.some((d) => d.word === "En curso") && drawn.rings.length === 1 && drawn.rings[0], JSON.stringify(drawn));
    check("project-page: no state of the person's list is drawn with the ink-filled dot", drawn.dots.length > 0 && drawn.inkFilled.length === 0,
      JSON.stringify(drawn));
    await context.close();
  }
}

// ---- the owner's part of the project page and the owner's read-only piece ----------------------------------
// The owner of a project sees on its page, per piece, every person assigned with their state («Por empezar», «La abrió»,
// «En curso», «Enviada», «Recibida», «Reemplazada») and date; a send that kept its storage opens the same piece closed and
// read only (observer), with whose send it is in the title band. A change request is said by its date, never its text.
// The owner's screens save, send, ask and record nothing, and never read a draft (spec 2026-10-25 página del proyecto §4.5).
const OWNER = {
  section: "Avance de lo que compartiste",
  states: { pending: "Por empezar", opened: "La abrió", in_progress: "En curso", submitted: "Enviada", received: "Recibida", replaced: "Reemplazada" },
  askedChange: (date) => `pidió un cambio el ${date}`,
  // A send after the close comes after the line's own date (when it was received): it says «sent again» once.
  lateSend: (date) => `la reenvió el ${date}`,
  sentBy: (name, date) => `Lo que envió ${name} el ${date}`,
  lead: "Aquí ves cuándo cada persona lo abre y lo envía.",
  // Each date says what it is: when the person sent, when it was received (a «Recibida» one), when they opened it or last
  // changed it, or when it was shared.
  sentOn: (date) => `Envió el ${date}`,
  receivedOn: (date) => `Recibida el ${date}`,
  openedOn: (date) => `La abrió el ${date}`,
  changedOn: (date) => `Último cambio el ${date}`,
  sharedOn: (date) => `Compartida el ${date}`,
  // A readable send carries this link next to the person's name; the name itself is never a link.
  open: "Ver lo que envió",
  empty: "Todavía no compartiste nada en este proyecto.",
  requestText: "Quiero cambiar el orden de las pantallas",
};
const PEOPLE = {
  luis: { id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", name: "Luis Gómez", email: "luis@example.com" },
  marta: { id: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2", name: "Marta Ruiz", email: "marta@example.com" },
  pedro: { id: "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3", name: "Pedro Díaz", email: "pedro@example.com" },
  sofia: { id: "a4a4a4a4-a4a4-4a4a-8a4a-a4a4a4a4a4a4", name: "Sofía Rey", email: "sofia@example.com" },
};
const OWNED = {
  questions: "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
  flow: "b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2",
  demo: "b3b3b3b3-b3b3-4b3b-8b3b-b3b3b3b3b3b3",
  demoOld: "b4b4b4b4-b4b4-4b4b-8b4b-b4b4b4b4b4b4",
  old: "b5b5b5b5-b5b5-4b5b-8b5b-b5b5b5b5b5b5",
};
const OWNED_TITLES = { [OWNED.questions]: "Preguntas para el equipo", [OWNED.flow]: "Recorrido de flujos", [OWNED.demo]: "Demo de la biblioteca",
  [OWNED.demoOld]: "Demo de la biblioteca v1", [OWNED.old]: "Preguntas de antes" };
const AT = { assigned: "2026-10-15T15:00:00.000Z", opened: "2026-10-16T15:00:00.000Z", changed: "2026-10-17T15:00:00.000Z",
  sent: "2026-10-19T15:00:00.000Z", received: "2026-10-20T15:00:00.000Z", requested: "2026-10-22T15:00:00.000Z", late: "2026-10-23T15:00:00.000Z" };
const ownerHref = (projectId, pieceId, person) => `#/project/${projectId}/piece/${pieceId}/person/${person.id}`;
// An assignment as owner_project gives it: sent_at is the newest send that is not partial, readable whether it kept its storage.
const ownerAssignment = (person, status, { opened = null, sent = null, readable = false, updated = AT.changed } = {}) => ({
  member_id: person.id, status, assigned_at: AT.assigned, updated_at: updated, first_opened_at: opened, sent_at: sent, readable });
// The owned project «Biblioteca del barrio»: four people on four pieces, every state the owner can read, a send kept without
// its storage (Marta's flow review), a replaced version with only a partial response (Marta's first demo), a change
// request (Luis) and a send after the close (Sofía).
function ownedView() {
  const { luis, marta, pedro, sofia } = PEOPLE;
  return {
    project: { id: IDS.ownedProject, slug: "biblioteca", name: PROJECT.owned, language: "es" },
    members: [{ id: IDS.ownerMember, display_name: "Ana Pérez", email: USER.email, role: "owner" },
      ...[luis, marta, pedro, sofia].map((p) => ({ id: p.id, display_name: p.name, email: p.email, role: "client" }))],
    pieces: [
      { id: OWNED.questions, kind: "questions", title: OWNED_TITLES[OWNED.questions], revision: 1, created_at: "2026-10-15T15:00:00Z", assignments: [
        ownerAssignment(pedro, "pending"),
        ownerAssignment(luis, "received", { opened: AT.opened, sent: AT.sent, readable: true, updated: AT.received }),
        ownerAssignment(sofia, "in_progress", { opened: AT.opened }),
        ownerAssignment(marta, "pending", { opened: AT.opened }),
      ] },
      { id: OWNED.flow, kind: "flow_review", title: OWNED_TITLES[OWNED.flow], revision: 1, created_at: "2026-10-14T15:00:00Z", assignments: [
        ownerAssignment(luis, "submitted", { opened: AT.opened, sent: AT.sent, readable: true, updated: AT.sent }),
        ownerAssignment(marta, "submitted", { opened: AT.opened, sent: AT.sent, readable: false, updated: AT.sent }),
      ] },
      { id: OWNED.demo, kind: "demo_review", title: OWNED_TITLES[OWNED.demo], revision: 2, created_at: "2026-10-13T15:00:00Z", assignments: [
        ownerAssignment(luis, "received", { opened: AT.opened, sent: AT.sent, readable: true, updated: AT.received }),
        ownerAssignment(sofia, "received", { opened: AT.opened, sent: AT.sent, readable: true, updated: AT.received }),
      ] },
      { id: OWNED.demoOld, kind: "demo_review", title: OWNED_TITLES[OWNED.demoOld], revision: 1, created_at: "2026-10-05T15:00:00Z", assignments: [
        ownerAssignment(marta, "replaced", { opened: AT.opened }),
      ] },
    ],
    change_requests: [
      { piece_id: OWNED.demo, member_id: luis.id, text: OWNER.requestText, late: false, created_at: AT.requested },
      { piece_id: OWNED.demo, member_id: sofia.id, text: null, late: true, created_at: AT.late },
    ],
  };
}
// What owner_piece answers: the piece with its html, the person, the status and the newest send when it kept its storage.
const ownerPieceEntry = ({ pieceId, kind, html, person, status, response, projectId = IDS.ownedProject }) => ({
  piece: { id: pieceId, project_id: projectId, kind, title: OWNED_TITLES[pieceId], revision: 1, language: "es", created_at: "2026-10-15T15:00:00Z", html },
  member: { id: person.id, display_name: person.name }, status, response });
// A piece stored before observer existed: it reads factoryHost.closed (if anything), keeps a change and sends on its own,
// and also forges the bridge's own messages with the nonce read from the injected script, as a hostile piece could.
const OLD_PIECE = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Preguntas de antes</title></head>
<body><main><h1>Preguntas de antes</h1><p id="seed"></p></main><script>
window.old = { seed: localStorage.getItem("vieja"), closed: window.factoryHost ? factoryHost.closed : null, submit: null, forged: null };
document.getElementById("seed").textContent = window.old.seed || "";
localStorage.setItem("vieja", JSON.stringify({ a: 2 }));
factorySubmit({ formato: "respuestas-fabrica/1", respuestas: [] }).then(function (r) { window.old.submit = r; });
var nonce = (/"nonce":"([0-9a-f]+)"/.exec(document.head.innerHTML) || [])[1] || null;
window.old.nonce = Boolean(nonce);
addEventListener("message", function (e) { if (e.data && e.data.type === "factory:submit-result" && e.data.requestId === "forged-1") window.old.forged = e.data; });
parent.postMessage({ type: "factory:dirty", nonce: nonce }, "*");
parent.postMessage({ type: "factory:draft", storage: { vieja: "3" }, nonce: nonce }, "*");
parent.postMessage({ type: "factory:submit", requestId: "forged-1", payload: { formato: "respuestas-fabrica/1", respuestas: [] }, nonce: nonce }, "*");
</script></body></html>`;

// Ana owns «Biblioteca del barrio» (owner_project and owner_piece answer for it) and is asked things in «Portal de prueba».
function ownerViewBackend(html, flowHtml, demoHtml, storage) {
  const backend = ownerBackend(html);
  const { luis, marta } = PEOPLE;
  const response = (s) => ({ id: randomUUID(), submitted_at: AT.sent, storage: s });
  for (const entry of [
    ownerPieceEntry({ pieceId: OWNED.questions, kind: "questions", html, person: luis, status: "received", response: response(storage) }),
    ownerPieceEntry({ pieceId: OWNED.flow, kind: "flow_review", html: flowHtml, person: luis, status: "submitted", response: response({}) }),
    ownerPieceEntry({ pieceId: OWNED.demo, kind: "demo_review", html: demoHtml, person: luis, status: "received", response: response({}) }),
    // Kept without its storage, and only partial: owner_piece answers no response.
    ownerPieceEntry({ pieceId: OWNED.flow, kind: "flow_review", html: flowHtml, person: marta, status: "submitted", response: null }),
    ownerPieceEntry({ pieceId: OWNED.demoOld, kind: "demo_review", html: demoHtml, person: marta, status: "replaced", response: null }),
    ownerPieceEntry({ pieceId: OWNED.old, kind: "questions", html: OLD_PIECE, person: luis, status: "received", response: response({ vieja: "1" }) }),
  ]) backend.ownerPieces[`${entry.piece.id}|${entry.member.id}`] = entry;
  return backend;
}

// The owner's part of the page as the owner reads it: its title, then per piece its title, its kind and one entry per person.
const ownerPart = (page, title = OWNER.section) => page.evaluate((heading) => {
  const section = [...document.querySelectorAll("[data-rol=cuerpo] section")].find((s) => s.querySelector("h2")?.textContent === heading);
  if (!section) return null;
  return {
    pieces: [...section.querySelectorAll("h3")].map((h) => {
      const group = h.closest(".owner-piece") || h.parentElement;
      return {
        title: h.textContent, kind: group.querySelector(".owner-piece-kind")?.textContent || null,
        people: [...group.querySelectorAll("li")].map((li) => {
          const status = li.querySelector(".status");
          return { name: li.querySelector(".row-title")?.textContent || null, meta: li.querySelector(".row-meta")?.textContent || "",
            state: status ? status.textContent : null, dot: status ? status.className : null, hasDot: Boolean(status && status.querySelector(".status-dot")),
            href: li.querySelector("a")?.getAttribute("href") || null, links: li.querySelectorAll("a").length,
            linkText: li.querySelector("a")?.textContent || null, nameInLink: Boolean(li.querySelector("a .row-title, a.row-title")) };
        }),
      };
    }),
    text: section.innerText,
    lead: section.querySelector("h2 + p")?.textContent || null,
  };
}, title);
// What the eye weighs, squinting: size and weight of the section's title, a piece's title and every person's name; and the
// colours: every name's, every link's in the entries, and the page's ink and link colours (read off probes in the body).
const ownerWeights = (page) => page.evaluate(() => {
  const w = (el) => { if (!el) return null; const cs = getComputedStyle(el); return { size: parseFloat(cs.fontSize), weight: Number(cs.fontWeight), color: cs.color }; };
  const section = [...document.querySelectorAll("[data-rol=cuerpo] section")].find((s) => s.querySelector(".owner-piece"));
  if (!section) return null;
  const probe = (css) => { const el = document.createElement("span"); el.style.color = css; section.append(el); const c = getComputedStyle(el).color; el.remove(); return c; };
  const first = section.firstElementChild;
  return { h2: w(section.querySelector("h2")), h3: w(section.querySelector("h3")),
    // The section's place: its heading first in the owner part, its lead line right after it, then the pieces.
    place: { headingFirst: Boolean(first && first.matches("h2")), leadNext: Boolean(first && first.nextElementSibling && first.nextElementSibling.matches("p.owner-lead")),
      piecesAfter: [...section.querySelectorAll(".owner-piece")].every((g) => first && (first.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING)) },
    names: [...section.querySelectorAll(".owner-piece .row-title")].map((el) => ({ text: el.textContent, ...w(el) })),
    links: [...section.querySelectorAll(".owner-piece li a")].map((el) => ({ text: el.textContent, ...w(el) })),
    ink: probe("var(--ink)"), signal: probe("var(--signal)") };
});
// Each state word's dot as drawn: its border colour and style and its fill (colour and image).
const ownerDots = (page) => page.evaluate(() => Object.fromEntries([...document.querySelectorAll("[data-rol=cuerpo] .owner-piece .status")].map((s) => {
  const cs = getComputedStyle(s.querySelector(".status-dot"));
  return [s.textContent, [cs.borderTopColor, cs.borderTopStyle, cs.backgroundColor, cs.backgroundImage].join(" | ")];
})));
// Every state dot in the body as drawn, by its word (the person's list and the owner's part alike), and the page's ink and
// muted colours read off probes. An ink-filled dot is one whose fill is the ink: the pieces' mark for «Con observaciones» and
// «Pidió un cambio», so the portal never draws a state with it (one colour, one meaning along the owner's path).
const portalDots = (page) => page.evaluate(() => {
  const body = document.querySelector("[data-rol=cuerpo]");
  const probe = (css) => { const el = document.createElement("span"); el.style.color = css; body.append(el); const c = getComputedStyle(el).color; el.remove(); return c; };
  const ink = probe("var(--ink)"), muted = probe("var(--muted)");
  const dots = [...body.querySelectorAll(".status")].map((s) => {
    const cs = getComputedStyle(s.querySelector(".status-dot"));
    return { word: s.textContent.trim(), border: cs.borderTopColor, style: cs.borderTopStyle, width: parseFloat(cs.borderTopWidth),
      fill: cs.backgroundColor, image: cs.backgroundImage };
  });
  const clear = (d) => d.fill === "rgba(0, 0, 0, 0)" && d.image === "none";
  return { ink, muted, dots, inkFilled: dots.filter((d) => d.fill === ink).map((d) => d.word),
    // «En curso»: the ink ring, hollow (no fill at all), its border the ink.
    rings: dots.filter((d) => d.word === "En curso").map((d) => d.border === ink && d.style === "solid" && d.width > 0 && clear(d)) };
});
// Each entry of the owner's part as laid out: its name line (name and link), its state word, its date line, the link's box,
// the line heights and the row's content height (without its padding).
const ownerEntries = (page) => page.evaluate(() => [...document.querySelectorAll("[data-rol=cuerpo] .owner-piece li.row")].map((li) => {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return { x: Math.round(r.left), der: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height),
      mid: Math.round(r.top + r.height / 2) }; };
  const item = li.querySelector(".row-item"), cs = getComputedStyle(item);
  const lineHeight = (el) => { const c = getComputedStyle(el); return parseFloat(c.lineHeight) || parseFloat(c.fontSize) * 1.5; };
  const name = li.querySelector(".row-title"), meta = li.querySelector(".row-meta");
  return { name: name?.textContent || null, line: box(li.querySelector(".owner-name")), state: box(li.querySelector(".status")), meta: box(meta),
    metaText: meta?.textContent || "",
    link: box(li.querySelector("a.owner-open")), lh: Math.round(lineHeight(name)), metaLh: meta ? Math.round(lineHeight(meta)) : 0,
    gap: Math.round(parseFloat(cs.rowGap) || 0), content: Math.round(item.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) };
}));
// What a tap hits on each «Ver lo que envió»: brought into view, its box sampled every pixel row at its left edge, its centre
// and its right edge with elementFromPoint; a miss is any sample that is not the link nor inside it.
const ownerLinkHits = (page) => page.evaluate(async () => {
  const out = [];
  for (const link of document.querySelectorAll("[data-rol=cuerpo] .owner-piece a.owner-open")) {
    link.scrollIntoView({ block: "center" });
    await new Promise((r) => requestAnimationFrame(() => r()));
    const r = link.getBoundingClientRect(), misses = [];
    let samples = 0;
    for (let y = Math.ceil(r.top); y < r.bottom; y += 1) {
      for (const x of [r.left + 1, r.left + r.width / 2, r.right - 1]) {
        samples += 1;
        const el = document.elementFromPoint(x, y);
        if (!(el && (el === link || link.contains(el)))) misses.push([Math.round(x - r.left), Math.round(y - r.top), el ? el.className || el.tagName : null]);
      }
    }
    out.push({ name: link.closest("li").querySelector(".row-title")?.textContent || null, h: Math.round(r.height), samples, misses });
  }
  return out;
});
// The first «Ver lo que envió» focused as the keyboard focuses it: whether a ring shows (on the link or its text) and how far
// down it reaches, against the top of the date text under it.
const ownerLinkRing = async (page) => {
  await page.evaluate(() => { const a = document.querySelector("[data-rol=cuerpo] .owner-piece a.owner-open"); a.scrollIntoView({ block: "center" });
    const prev = [...document.querySelectorAll("a, button")]; const i = prev.indexOf(a); (prev[i - 1] || document.body).focus(); });
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || !a.matches("a.owner-open")) return { focused: a ? a.className || a.tagName : null };
    const ringOf = (el) => { const cs = getComputedStyle(el); const w = parseFloat(cs.outlineWidth) || 0;
      const r = el.getBoundingClientRect(), out = (parseFloat(cs.outlineOffset) || 0) + w;
      return cs.outlineStyle !== "none" && w > 0 ? { el: el.className || el.tagName, bottom: r.bottom + out, top: r.top - out, left: r.left - out, right: r.right + out } : null; };
    const rings = [a, ...a.querySelectorAll("*")].map(ringOf).filter(Boolean);
    const meta = a.closest("li").querySelector(".row-meta");
    const rg = document.createRange(); rg.selectNodeContents(meta);
    const metaRects = [...rg.getClientRects()].filter((x) => x.width > 0);
    const metaTop = Math.min(...metaRects.map((x) => x.top));
    const round = (v) => Math.round(v * 10) / 10;
    const ring = { visible: rings.length > 0, rings, bottom: rings.length ? round(Math.max(...rings.map((x) => x.bottom))) : null, metaTop: round(metaTop),
      // The ring's box (the outline around its element) against every rect of the date text: it never crosses any of them,
      // whether the date line is under the link (below 1056) or beside it (the columns from 1056).
      crosses: rings.some((x) => metaRects.some((m) => x.left < m.right && x.right > m.left && x.top < m.bottom && x.bottom > m.top)) };
    a.blur();
    return ring;
  });
};
// The owner's piece screen: its title band, the way back, the pinned zone and the change request form (none of which it has).
const ownerBand = (page) => page.evaluate(() => {
  const status = document.querySelector(".piece-status");
  const back = document.querySelector(".back-link");
  return { title: document.querySelector("h1.piece-title")?.textContent || null, status: status && !status.hidden ? status.textContent : null,
    back: back ? { href: back.getAttribute("href"), text: back.textContent } : null,
    pinned: document.querySelector("[data-rol=aviso-fijo]")?.innerText || "", form: Boolean(document.getElementById("change-request-text")),
    requestButton: [...document.querySelectorAll("button")].some((b) => b.textContent === "Pedir un cambio"),
    iframes: document.querySelectorAll("iframe").length,
    notices: [...document.querySelectorAll("[data-rol=avisos] .notice")].map((n) => n.querySelector("p")?.textContent) };
});
// The piece the owner reads, once it shows its heading (or, for the old piece, once its script ran). The piece heads its
// read view itself («Respuestas», «Revisión»); the portal's band says whose send it is.
async function ownerFrame(page, ready = () => typeof factoryHost === "object" &&
  [...document.querySelectorAll("h1")].some((h) => h.getBoundingClientRect().height > 0 && h.textContent.trim())) {
  return waitFor(async () => { const f = pieceFrame(page); return f && (await f.evaluate(ready).catch(() => false)) ? f : null; }, 10000);
}
const hostOf = (frame) => frame.evaluate(() => ({ observer: factoryHost.observer, closed: factoryHost.closed, reviewerName: factoryHost.reviewerName,
  sentAt: factoryHost.sentAt, h1: [...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().height > 0).map((h) => h.textContent.trim()),
  repeats: document.body.innerText.includes("Lo que envió") }));
// The writes the owner must never make, and the draft reads.
const WRITES = ["rpc/save_draft", "rpc/submit_response", "rpc/request_change", "rpc/mark_piece_opened"];
const writesIn = (requests) => requests.filter((r) => WRITES.some((w) => r.includes(`/rest/v1/${w}`)));
const draftReadsIn = (requests) => requests.filter((r) => r.includes("/rest/v1/piece_drafts"));

async function openMocked(browser, base, backend, hash = "", width = 360) {
  const context = await mockedContext(browser, { backend, width, locale: "es-CO" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The 403 and 404 the owner's reads answer log their failed request; anything else is an error.
  page.on("console", (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text()); });
  await page.goto(`${base}/${hash}`, { waitUntil: "networkidle" });
  return { context, page, errors };
}
const goTo = async (page, hash, ready) => {
  await page.evaluate((h) => { location.hash = h; }, hash);
  return waitFor(ready, 10000);
};

async function ownerViewChecks(browser, base, html, flowHtml, demoHtml) {
  const storage = await sentQuestionsStorage(browser, base, html, { checked: false });
  const { luis, marta, pedro, sofia } = PEOPLE;

  // owner-project, owner-piece-readonly (the three kinds), owner-no-readable-send and owner-no-drafts, on one visit.
  {
    const backend = ownerViewBackend(html, flowHtml, demoHtml, storage);
    const { context, page, errors } = await openMocked(browser, base, backend, "");
    await page.waitForSelector(`a[href="#/project/${IDS.ownedProject}"]`, { timeout: 10000 }).catch(() => {});
    const homeRow = (await projectRowsOf(page)).find((r) => r.href === `#/project/${IDS.ownedProject}`);
    await page.click(`a[href="#/project/${IDS.ownedProject}"]`).catch(() => {});
    const part = await waitFor(() => ownerPart(page), 10000);
    const view = await projectView(page);
    const d = Object.fromEntries(await Promise.all(Object.entries(AT).map(async ([k, v]) => [k, await formatIn(page, v)])));
    const S = OWNER.states;
    const href = (pieceId, person) => ownerHref(IDS.ownedProject, pieceId, person);
    const expected = [
      { title: OWNED_TITLES[OWNED.questions], kind: "Preguntas", people: [
        { name: luis.name, state: S.received, meta: OWNER.receivedOn(d.received), href: href(OWNED.questions, luis) },
        { name: marta.name, state: S.opened, meta: OWNER.openedOn(d.opened), href: null },
        { name: pedro.name, state: S.pending, meta: OWNER.sharedOn(d.assigned), href: null },
        { name: sofia.name, state: S.in_progress, meta: OWNER.changedOn(d.changed), href: null }] },
      { title: OWNED_TITLES[OWNED.flow], kind: "Revisión de recorridos", people: [
        { name: luis.name, state: S.submitted, meta: OWNER.sentOn(d.sent), href: href(OWNED.flow, luis) },
        { name: marta.name, state: S.submitted, meta: OWNER.sentOn(d.sent), href: null }] },
      { title: OWNED_TITLES[OWNED.demo], kind: "Revisión de la demo", people: [
        { name: luis.name, state: S.received, meta: `${OWNER.receivedOn(d.received)} · ${OWNER.askedChange(d.requested)}`, href: href(OWNED.demo, luis) },
        { name: sofia.name, state: S.received, meta: `${OWNER.receivedOn(d.received)} · ${OWNER.lateSend(d.late)}`, href: href(OWNED.demo, sofia) }] },
      { title: OWNED_TITLES[OWNED.demoOld], kind: "Revisión de la demo", people: [
        { name: marta.name, state: S.replaced, meta: OWNER.sharedOn(d.assigned), href: null }] },
    ];
    const got = part && part.pieces.map((p) => ({ title: p.title, kind: p.kind, people: p.people.map(({ name, state, meta, href: h }) => ({ name, state, meta, href: h })) }));
    check(`owner-project: the owned project's page has «${OWNER.section}», and no «${PROJECT.askedOfYou}» when nothing was asked of the owner`,
      part && view.h1 === PROJECT.owned && view.sections.includes(OWNER.section) && !view.sections.includes(PROJECT.askedOfYou), JSON.stringify(view));
    check("owner-project: each piece with its title and kind, newest first", got && JSON.stringify(got.map(({ title, kind }) => ({ title, kind }))) ===
      JSON.stringify(expected.map(({ title, kind }) => ({ title, kind }))), JSON.stringify(got && got.map(({ title, kind }) => ({ title, kind }))));
    check("owner-project: one entry per person, by name, with the state word and its date, each date saying what it is", got && JSON.stringify(got.map((p) => p.people.map(({ name, state, meta }) => ({ name, state, meta })))) ===
      JSON.stringify(expected.map((p) => p.people.map(({ name, state, meta }) => ({ name, state, meta })))), JSON.stringify(got && got.map((p) => p.people)));
    const people = part ? part.pieces.flatMap((p) => p.people) : [];
    // se-entiende-a-la-primera: «Recibida» and «Enviada» never share a date line: each names its own event, and no line says
    // «envió» twice (a send after the close reads once, as a later send).
    const firstEvent = (p) => p.meta.split(" · ")[0].replace(/ el .*$/, "");
    const byState = (state) => new Set(people.filter((p) => p.state === state).map(firstEvent));
    check("owner-project: «Recibida» and «Enviada» each name their own event on the date line, and no line says «envió» twice",
      people.length === 9 && [...byState(S.received)].join() === "Recibida" && [...byState(S.submitted)].join() === "Envió" &&
      people.every((p) => (p.meta.match(/envi[oó]/gi) || []).length <= 1), JSON.stringify(people.map((p) => [p.state, p.meta])));
    const opened = people.find((p) => p.state === S.opened), pending = people.find((p) => p.state === S.pending);
    check("owner-project: «La abrió» is its own state, with its own dot", opened && pending && opened.name === marta.name && opened.hasDot &&
      opened.dot !== pending.dot, JSON.stringify({ opened, pending }));
    check("owner-project: every state is said in words next to the base's status dot (COM-13)", people.length === 9 &&
      people.every((p) => p.hasDot && /(^| )status( |$)/.test(p.dot) && Object.values(S).includes(p.state)), JSON.stringify(people.map((p) => [p.state, p.dot])));
    check("owner-project: a readable send links to what the person sent; one that is not readable does not",
      got && JSON.stringify(got.map((p) => p.people.map((x) => x.href))) === JSON.stringify(expected.map((p) => p.people.map((x) => x.href))),
      JSON.stringify(got && got.map((p) => p.people.map((x) => x.href))));
    check("owner-project: a change request and a send after the close are said by their date, never by their text",
      part && !part.text.includes(OWNER.requestText) && !(await page.evaluate((t) => document.body.innerText.includes(t), OWNER.requestText)), part && part.text);
    const marta2 = got && [got[1].people[1], got[3].people[0]];
    check("owner-no-readable-send: a send kept without its storage and a replaced version with only a partial response show their state and date, without a link",
      marta2 && marta2[0].state === S.submitted && marta2[0].meta === OWNER.sentOn(d.sent) && !marta2[0].href && marta2[1].state === S.replaced && marta2[1].meta === OWNER.sharedOn(d.assigned) && !marta2[1].href,
      JSON.stringify(marta2));
    // conteo-coherente: what home says of this project is what its page shows: under its name, its people and the last send;
    // on its right, what is left to answer in «Lo que se te pidió» (nothing here, so «Eres responsable»).
    const shownPeople = new Set(people.map((p) => p.name)).size;
    const toAnswer = await askedToAnswer(page);
    const counted = part && homeMetaFrom(part, d.sent);
    check("owner-project: home counts what the page shows (its people and the last send under its name, what is left to answer on its right)", homeRow &&
      homeRow.meta === counted && homeRow.meta.startsWith("4 personas · ") && shownPeople === 4 && toAnswer === 0 && homeRow.aside === asideFrom(toAnswer),
      JSON.stringify({ homeRow, counted, toAnswer }));
    check(`owner-project: the owner's part opens with its own line, and the page has no line for the people asked («${PROJECT.ownerSees}»)`, part &&
      part.lead === OWNER.lead && !(await page.$("[data-rol=cuerpo] > .page-note")), JSON.stringify({ lead: part && part.lead, first: view.first }));
    const weights = await ownerWeights(page);
    const mass = (x) => x && x.size * x.weight;
    // tipografia (project-owner): section ≥ piece > person. The section and a piece's title may share the type (both are
    // section titles in the base's scale, FUN-02); the section is told apart by its place: its heading first in the owner part,
    // its lead line next. A piece's title outweighs every name by a step of the scale in size and in weight, never by
    // weight alone.
    check("owner-project: squinting, section ≥ piece > person (the piece above every name in size and in weight), the section's heading first with its lead; no name is bold",
      weights && weights.names.length === 9 && mass(weights.h2) >= mass(weights.h3) &&
      weights.names.every((n) => mass(weights.h3) > mass(n) && weights.h3.size > n.size && weights.h3.weight > n.weight && n.weight <= 400) &&
      weights.place.headingFirst && weights.place.leadNext && weights.place.piecesAfter,
      JSON.stringify(weights && { h2: weights.h2, h3: weights.h3, place: weights.place, names: weights.names.map((n) => [n.text, n.size, n.weight]) }));
    // color-con-un-significado: the link colour means «you can open this». No name is in it; a readable send carries its own
    // link «Ver lo que envió» next to the name, in the link colour, and an entry with nothing to open has no link at all.
    const readable = people.filter((p) => p.href);
    check(`owner-project: every name is in the text colour, never the link's; a readable send carries «${OWNER.open}» next to the name, in the link colour`,
      weights && weights.ink !== weights.signal && weights.names.length === 9 && weights.names.every((n) => n.color === weights.ink) &&
      readable.length === 4 && readable.every((p) => p.links === 1 && p.linkText === OWNER.open && !p.nameInLink) &&
      people.filter((p) => !p.href).every((p) => p.links === 0) &&
      weights.links.length === 4 && weights.links.every((l) => l.text === OWNER.open && l.color === weights.signal),
      JSON.stringify(weights && { ink: weights.ink, signal: weights.signal, names: weights.names.map((n) => [n.text, n.color]), links: weights.links.map((l) => [l.text, l.color]),
        entries: people.map((p) => [p.name, p.links, p.linkText, p.nameInLink]) }));
    const dots = await ownerDots(page);
    const marks = Object.values(S).map((word) => dots[word]);
    check("owner-project: each state has its own dot (no two states drawn alike), in the base's dot family", marks.every(Boolean) &&
      new Set(marks).size === marks.length, JSON.stringify(dots));
    // color-con-un-significado (judges, round 5): inside the pieces the ink-filled dot means «Con observaciones» or «Pidió un
    // cambio»; the portal's «En curso» is the ink ring instead, hollow, apart from «Por empezar»'s grey ring and «La abrió»'s
    // half fill, and no state of the owner's part is ink-filled.
    const drawn = await portalDots(page);
    const mark = (word) => dots[word] || null;
    check("owner-project: «En curso» is the ink ring (hollow, its border the ink), not «Por empezar»'s grey ring nor «La abrió»'s half fill",
      drawn.rings.length === 1 && drawn.rings[0] && mark(S.in_progress) !== mark(S.pending) && mark(S.in_progress) !== mark(S.opened),
      JSON.stringify({ ink: drawn.ink, muted: drawn.muted, dots }));
    check("owner-project: no state of the owner's part is drawn with the ink-filled dot (the pieces' «Con observaciones» and «Pidió un cambio»)",
      drawn.dots.length > 0 && drawn.inkFilled.length === 0, JSON.stringify(drawn));
    check("owner-project: the page reads the owner's part through owner_project, for this project", backend.ownerCalls.some((c) => c.rpc === "owner_project" &&
      c.p_project_id === IDS.ownedProject && c.sub === USER.id), JSON.stringify(backend.ownerCalls));
    check("owner-project: 360px no horizontal scroll", await noHorizontalScroll(page));
    await page.screenshot({ path: join(outDir, "project-owner-360.png"), fullPage: true });
    await snapshot(page, "project-owner", "lista");
    const ownerAxe = await axeViolations(page);
    if (ownerAxe) check("owner-project: axe has no violations", ownerAxe.length === 0, ownerAxe.join(", "));
    // densidad (project-owner at 320): each entry is two lines: the name, with its «Ver lo que envió» and the state word on
    // the right as a list row carries it, and the date line under them. Only an entry with two events (received or sent,
    // then a change asked or a send after the close) may run its date line onto a third line (controller's ruling). The link
    // stays a 44 px target (FUN-18) by its own padding, which does not grow the line nor the row.
    await page.setViewportSize({ width: 320, height: 640 });
    const entries = await ownerEntries(page);
    const oneLine = (box, lh) => box && box.h <= lh + 1;
    // Two events, exactly: its own date (received or sent), then one later event (a change asked or a send after the close).
    const prefix = (fn) => fn("\u0000").split("\u0000")[0];
    const twoEvents = (text) => { const parts = text.split(" · ");
      return parts.length === 2 && [OWNER.receivedOn, OWNER.sentOn].some((fn) => parts[0].startsWith(prefix(fn))) &&
        [OWNER.askedChange, OWNER.lateSend].some((fn) => parts[1].startsWith(prefix(fn))); };
    check("owner-project 320px: each entry is two lines, the name with the state word on its right, then the date line", entries.length === 9 &&
      entries.every((e) => oneLine(e.line, e.lh) && (oneLine(e.meta, e.metaLh) || twoEvents(e.metaText)) && e.state.x >= e.line.der && e.state.mid > e.line.top && e.state.mid < e.line.bottom &&
        e.meta.top >= e.line.bottom - 1 && e.content <= e.line.h + e.gap + e.meta.h + 1),
      JSON.stringify(entries.map((e) => ({ name: e.name, line: e.line && e.line.h, meta: e.meta && e.meta.h, metaText: e.metaText, lh: e.lh, state: e.state, content: e.content }))));
    check("owner-project 320px: «Ver lo que envió» is a 44 px target without growing its line", entries.filter((e) => e.link).length === 4 &&
      entries.filter((e) => e.link).every((e) => e.link.h >= 44 && e.link.w >= 44 && oneLine(e.line, e.lh)),
      JSON.stringify(entries.filter((e) => e.link).map((e) => ({ name: e.name, link: e.link, line: e.line.h }))));
    check("owner-project 320px: no horizontal scroll", await noHorizontalScroll(page));
    await page.screenshot({ path: join(outDir, "project-owner-320.png"), fullPage: true });
    // FUN-18 as it is touched: down the link's whole box (every pixel row, at its left edge, its centre and its right edge),
    // what the browser hits is the link, never the date line under it. And its focus ring stays off the date text.
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: width < 672 ? 640 : 900 });
      const hits = await ownerLinkHits(page);
      check(`owner-project ${width}px: «${OWNER.open}» answers a tap on its whole 44 px target, the date line under it never takes it (FUN-18)`,
        hits.length === 4 && hits.every((x) => x.h >= 44 && x.samples >= 3 * x.h && x.misses.length === 0),
        JSON.stringify(hits.map((x) => ({ name: x.name, h: x.h, samples: x.samples, misses: x.misses.slice(0, 6) }))));
      const ring = await ownerLinkRing(page);
      check(`owner-project ${width}px: «${OWNER.open}»'s focus ring stays off the date line`, ring && ring.visible && ring.crosses === false &&
        (width >= 1056 || ring.bottom <= ring.metaTop),
        JSON.stringify(ring));
    }
    await page.setViewportSize({ width: 360, height: 800 });

    // owner-piece-readonly: Luis's questions (from the page's link), flow review and demo sheet, each closed and read only.
    for (const [kind, pieceId] of [["questions", OWNED.questions], ["flow_review", OWNED.flow], ["demo_review", OWNED.demo]]) {
      const tag = `owner-piece-readonly (${kind})`;
      const before = backend.requests.length;
      if (kind === "questions") {
        await page.click(`a[href="${href(pieceId, luis)}"]`).catch(() => {});
      } else {
        await page.evaluate((h) => { location.hash = h; }, href(pieceId, luis));
      }
      const frame = await ownerFrame(page);
      const host = frame ? await hostOf(frame) : null;
      await sleep(2000); // longer than the draft debounce: anything the piece would post has been posted
      const band = await ownerBand(page);
      const calls = backend.requests.slice(before);
      check(`${tag}: the piece opens closed, with observer, as Luis's send (reviewerName is his display_name)`, host && host.observer === true &&
        host.closed === "received" && host.reviewerName === luis.name && host.sentAt === AT.sent, JSON.stringify(host));
      // marco-del-anfitrion: the band says «Lo que envió … el …» (checked below); the piece heads its read view and does not repeat it.
      check(`${tag}: the piece heads its own read view and does not repeat the band's «Lo que envió»`, host && host.h1.length > 0 &&
        host.h1.every((t) => !t.startsWith("Lo que envió")) && !host.repeats, JSON.stringify(host && { h1: host.h1, repeats: host.repeats }));
      check(`${tag}: the title band is the piece's title and «${OWNER.sentBy(luis.name, d.sent)}», back to the project`, band.title === OWNED_TITLES[pieceId] &&
        band.status === OWNER.sentBy(luis.name, d.sent) && band.back && band.back.href === `#/project/${IDS.ownedProject}` && band.back.text.includes(PROJECT.owned),
        JSON.stringify(band));
      check(`${tag}: no closed panel, no «Pedir un cambio» and no change request form`, band.pinned === "" && !band.requestButton && !band.form && band.iframes === 1,
        JSON.stringify(band));
      check(`${tag}: no save_draft, submit_response, request_change nor mark_piece_opened during the visit`, frame && writesIn(calls).length === 0,
        JSON.stringify(writesIn(calls)));
      check(`${tag}: the screen reads the piece through owner_piece, for Luis`, backend.ownerCalls.some((c) => c.rpc === "owner_piece" && c.p_piece_id === pieceId &&
        c.p_member_id === luis.id && Object.keys(c).sort().join() === "p_member_id,p_piece_id,rpc,sub"), JSON.stringify(backend.ownerCalls.filter((c) => c.rpc === "owner_piece")));
      if (kind === "questions") {
        const seeded = frame && await frame.evaluate(() => ({ quien: ST.respuestas["q-002"] ? ST.respuestas["q-002"].quien || null : null,
          answers: Object.keys(ST.respuestas || {}).sort() })).catch(() => null);
        check(`${tag}: it shows what Luis sent, seeded with the send's storage`, seeded && seeded.quien === "Luis" && seeded.answers.join() === "q-001,q-002",
          JSON.stringify(seeded));
        const result = frame && await frame.evaluate(() => factorySubmit({ formato: "respuestas-fabrica/1", respuestas: [] })).catch(() => null);
        await sleep(500);
        check(`${tag}: a send from inside the piece is refused and reaches nobody`, result && result.ok === false && result.error === "rejected" &&
          writesIn(backend.requests.slice(before)).length === 0, JSON.stringify(result));
        await page.screenshot({ path: join(outDir, "owner-piece-360.png"), fullPage: true });
      }
    }

    // owner-no-readable-send: opened by its address, a send without a readable storage is not available, and nothing is mounted.
    for (const [pieceId, what] of [[OWNED.flow, "a send kept without its storage"], [OWNED.demoOld, "a replaced version with only a partial response"]]) {
      const before = backend.requests.length;
      const callsBefore = backend.ownerCalls.length;
      const band = await goTo(page, href(pieceId, marta), async () => { const b = await ownerBand(page); return b.title === "No está disponible" ? b : null; });
      check(`owner-no-readable-send: ${what}, opened by its address, says it is not available, with no piece`, band && band.iframes === 0 &&
        band.notices.length === 1 && backend.ownerCalls.slice(callsBefore).some((c) => c.rpc === "owner_piece" && c.p_member_id === marta.id), JSON.stringify(band));
      check(`owner-no-readable-send: ${what}: nothing read from the drafts nor written`, draftReadsIn(backend.requests.slice(before)).length === 0 &&
        writesIn(backend.requests.slice(before)).length === 0, JSON.stringify(backend.requests.slice(before)));
    }
    check("owner-no-drafts: no request to piece_drafts on the owner's page nor on the owner's pieces", draftReadsIn(backend.requests).length === 0,
      JSON.stringify(draftReadsIn(backend.requests)));
    check("owner-project / owner-piece: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // owner-old-piece: a piece whose stored HTML predates observer opens closed, read only, says whose send it is, and posts nothing.
  {
    const backend = ownerViewBackend(html, flowHtml, demoHtml, storage);
    const { context, page, errors } = await openMocked(browser, base, backend, ownerHref(IDS.ownedProject, OWNED.old, PEOPLE.luis));
    const frame = await ownerFrame(page, () => Boolean(window.old && window.old.submit));
    await sleep(2000);
    const old = frame ? await frame.evaluate(() => window.old) : null;
    const band = await ownerBand(page);
    const d = await formatIn(page, AT.sent);
    check("owner-old-piece: it opens closed and seeded with the send's storage", old && old.closed === "received" && old.seed === "1", JSON.stringify(old));
    check("owner-old-piece: the title band says whose send it is", band.title === OWNED_TITLES[OWNED.old] && band.status === OWNER.sentBy(PEOPLE.luis.name, d) &&
      band.pinned === "" && !band.form, JSON.stringify(band));
    check("owner-old-piece: its own send is refused, and a send forged with the bridge's nonce is answered rejected", old && old.submit && old.submit.ok === false &&
      old.submit.error === "rejected" && old.nonce && old.forged && old.forged.ok === false && old.forged.error === "rejected", JSON.stringify(old));
    check("owner-old-piece: no draft, send, change request nor opening reached the server, and no draft was read", writesIn(backend.requests).length === 0 &&
      draftReadsIn(backend.requests).length === 0, JSON.stringify(backend.requests.filter((r) => r.includes("rpc/") || r.includes("piece_drafts"))));
    check("owner-old-piece: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // owner-and-stakeholder: Ana owns one project and is asked things in another. The other shows only her own pieces, as
  // before; the owner's reads answer only for the owned one.
  {
    const backend = ownerViewBackend(html, flowHtml, demoHtml, storage);
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.project}`);
    const other = await waitFor(async () => { const v = await projectView(page); return v.h1 === PROJECT.name && v.pieces.length ? v : null; }, 10000);
    await sleep(500);
    check("owner-and-stakeholder: the project where she is asked things shows only her pieces and the line that says what the owner sees, as before", other &&
      JSON.stringify(other.sections) === JSON.stringify([PROJECT.askedOfYou]) && other.pieces.length === 3 && other.first === PROJECT.ownerSees &&
      other.notices.length === 0 && !(await ownerPart(page)), JSON.stringify(other));
    check("owner-and-stakeholder: the project where she is not the owner never asks owner_project", !backend.ownerCalls.some((c) => c.p_project_id === IDS.project),
      JSON.stringify(backend.ownerCalls));
    const owned = await goTo(page, `#/project/${IDS.ownedProject}`, () => ownerPart(page));
    check("owner-and-stakeholder: the project she owns shows the owner's part", owned && owned.pieces.length === 4, JSON.stringify(owned && owned.pieces.map((p) => p.title)));
    // A person's piece in the project she does not own, and an owned piece under the other project's address: not available.
    for (const [hash, what] of [[ownerHref(IDS.project, IDS.questions, { id: IDS.member }), "a piece of the project she does not own"],
      [ownerHref(IDS.project, OWNED.questions, PEOPLE.luis), "an owned piece under another project's address"]]) {
      const band = await goTo(page, hash, async () => { const b = await ownerBand(page); return b.title === "No está disponible" ? b : null; });
      check(`owner-and-stakeholder: ${what} is not available, with no piece`, band && band.iframes === 0 && band.notices.length === 1, JSON.stringify(band));
    }
    check("owner-and-stakeholder: nothing written and no draft read", writesIn(backend.requests).length === 0 && draftReadsIn(backend.requests).length === 0,
      JSON.stringify(writesIn(backend.requests)));
    check("owner-and-stakeholder: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // owner-and-stakeholder: her membership says owner but the server does not agree (42501): the page shows only her part.
  {
    const backend = ownerViewBackend(html, flowHtml, demoHtml, storage);
    backend.members[0].role = "owner";
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.project}`);
    const view = await waitFor(async () => { const v = await projectView(page); return v.h1 === PROJECT.name && v.pieces.length ? v : null; }, 10000);
    await sleep(500);
    check("owner-and-stakeholder: refused by owner_project (42501), the page shows only her pieces and the line that says what the owner sees, without a notice", view &&
      backend.ownerCalls.some((c) => c.rpc === "owner_project" && c.p_project_id === IDS.project) && JSON.stringify(view.sections) === JSON.stringify([PROJECT.askedOfYou]) &&
      view.first === PROJECT.ownerSees && view.notices.length === 0, JSON.stringify(view));
    check("owner-and-stakeholder: refused: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // owner-with-own-piece: Ana owns «Portal de prueba» and is also asked things in it: the page shows both, and her own piece
  // opens as always (draft, «la abrió»).
  {
    const backend = newBackend(html, flowHtml, demoHtml);
    backend.members[0].role = "owner";
    backend.ownedIds = [IDS.project];
    const ana = { id: IDS.member, name: "Ana Pérez" };
    backend.ownerView[IDS.project] = {
      project: { id: IDS.project, slug: "portal-test", name: PROJECT.name, language: "es" },
      members: [{ id: IDS.member, display_name: "Ana Pérez", email: USER.email, role: "owner" },
        { id: PEOPLE.luis.id, display_name: PEOPLE.luis.name, email: PEOPLE.luis.email, role: "client" }],
      pieces: [{ id: IDS.questions, kind: "questions", title: "Preguntas sobre Biblioteca del barrio", revision: 1, created_at: "2026-10-16T15:00:00Z", assignments: [
        ownerAssignment(ana, "pending"), ownerAssignment(PEOPLE.luis, "submitted", { sent: AT.sent, readable: true, updated: AT.sent })] }],
      change_requests: [],
    };
    backend.ownedProjects = [ownerSummary(backend.ownerView[IDS.project])];
    const { context, page, errors } = await openMocked(browser, base, backend, "");
    await page.waitForSelector(`a[href="#/project/${IDS.project}"]`, { timeout: 10000 }).catch(() => {});
    const homeRow = (await projectRowsOf(page)).find((r) => r.href === `#/project/${IDS.project}`);
    const lastSent = await formatIn(page, AT.sent);
    await page.click(`a[href="#/project/${IDS.project}"]`).catch(() => {});
    const part = await waitFor(() => ownerPart(page), 10000);
    const view = await projectView(page);
    const toAnswer = await askedToAnswer(page);
    check("owner-with-own-piece: home counts what the page shows, her own entry included (2 personas), and on its right what «Lo que se te pidió» leaves to answer", homeRow && part &&
      toAnswer === 1 && homeRow.aside === asideFrom(toAnswer) && homeRow.meta === homeMetaFrom(part, lastSent, { ownerFirst: true }) && homeRow.meta.includes("2 personas"),
      JSON.stringify({ homeRow, toAnswer, expected: part && homeMetaFrom(part, lastSent, { ownerFirst: true }) }));
    const order = await page.evaluate(() => [...document.querySelector("[data-rol=cuerpo]").children].map((el) => el.querySelector("h2")?.textContent || el.className));
    check(`owner-with-own-piece: the page shows the line that says what the owner sees, «${PROJECT.askedOfYou}», then the owner's part`, part &&
      JSON.stringify(order) === JSON.stringify(["page-note", PROJECT.askedOfYou, OWNER.section]) && view.pieces.length === 3, JSON.stringify(order));
    const people = part ? part.pieces[0].people : [];
    check("owner-with-own-piece: her own entry goes after the people's, with her state", people.length === 2 && people[0].name === PEOPLE.luis.name &&
      people[1].name === "Ana Pérez" && people[1].state === OWNER.states.pending, JSON.stringify(people));
    await page.click(`a[href="#/piece/${IDS.questions}"]`).catch(() => {});
    const frame = await appPiece(page);
    const host = frame && await frame.evaluate(() => ({ observer: factoryHost.observer, closed: factoryHost.closed }));
    check("owner-with-own-piece: her own piece opens as a person's, open and without observer", host && host.observer === false && host.closed === null, JSON.stringify(host));
    check("owner-with-own-piece: opening it records her own «la abrió»", await waitFor(() => backend.openedCalls.length === 1, 3000) &&
      backend.openedCalls[0].p_piece_id === IDS.questions && backend.openedCalls[0].sub === USER.id, JSON.stringify(backend.openedCalls));
    if (frame) await frame.evaluate(() => responder("q-001", "si"));
    const saved = frame && await waitFor(async () => backend.drafts.length && (await page.textContent(".piece-status")).includes("Guardado"), 5000);
    check("owner-with-own-piece: a change on it is saved as her draft", saved && backend.drafts.every((x) => x.p_piece_id === IDS.questions && x.sub === USER.id),
      JSON.stringify(backend.drafts.map((x) => ({ piece: x.p_piece_id, sub: x.sub }))));
    check("owner-with-own-piece: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---- the portal's own frame, measured with the factory's geometry ----------------------------------------
// The visual manual's frame rules (marco.md: one frame, one page margin on both sides from 672 px and the frame not
// cut before 1440, MAR-11; sections side by side in equal parts, MAR-12; the body not left half empty from 1056,
// FUN-43; and the rest that geometria.mjs measures on the factory's pieces), on every portal screen at the factory's
// verification widths 320, 672 and 1056 and its widest review width, 1440, light and dark:
// - the screen snapshots of PORTAL_SCREENS (sign-in email and code steps, home with the projects and empty, a project's page, an owned
//   project's page with the owner's part, a project's page with a received piece, and the «Decisiones» screens) through
//   the factory's design-system/assets/geometria.mjs: MEDIR_GEOMETRIA and evaluaAncho at each width, evaluaConjunto between them all
//   (the same frame on every screen, MAR-02), and revisaMedia on the portal's CSS (cuts on the grid, MAR-08);
// - the piece screen and the owner's read-only piece screen, whose body is the piece's iframe: its frame on the same edges as the other screens', and the
//   iframe as wide as the factory's design-system/assets/piece-host.mjs says (widthInPortal), so the factory measures
//   its pieces at the width the person sees them; also at 1600, past the frame's cap.
// ---- the «Decisiones» section of a project's page ----------------------------------------------------------
// A person in the section's list sees, after «Lo que se te pidió», the points the factory published for the project, each
// with its mark (new, changed since their answer, already confirmed, or none) and «En qué se apoya» folded; answers one of
// four (va, lo cambiaría, no va, no sé), with a comment required for all but «va», point by point, on the version the
// page showed; and writes what is missing at the end. Opening the page records the opening once per visit (spec
// 2026-10-25 página del proyecto §4.1–4.3).
const DECISIONS = {
  title: "Decisiones",
  lead: "Esto ya se decidió. Dinos si va, si lo cambiarías o si no va. Si no respondes, la decisión sigue como está.",
  choices: ["Va", "Lo cambiaría", "No va", "No sé"],
  marks: { new: "Nuevo", changed: "Cambió desde tu respuesta", confirmed: "Ya lo confirmaste" },
  basis: "En qué se apoya",
  commentLabel: "Comentario",
  commentRequired: "Cuéntanos qué cambiarías y por qué.",
  commentRequiredNo: "Cuéntanos por qué no va.",
  commentRequiredUnsure: "Cuéntanos qué te falta para decidir.",
  send: "Enviar respuesta",
  sending: "Enviando…",
  answered: (date) => `Respondiste el ${date}`,
  stale: "Este punto cambió mientras lo leías. Míralo de nuevo.",
  network: "No hay conexión. Revisa tu internet y vuelve a intentarlo.",
  proposeTitle: "¿Falta algo?",
  proposeLabel: "Si algo debería estar aquí y no está, escríbelo.",
  proposeSend: "Enviar",
  proposeSent: "Gracias. Lo recibimos.",
  proposeEmpty: "Escribe qué falta.",
  onlyName: "Huerta del barrio",
};
const DIDS = { project: "12121212-1212-4212-8212-121212121212", member: "13131313-1313-4313-8313-131313131313" };
const DKEY = { a: "0a0a0a0a0a0a", b: "0b0b0b0b0b0b", c: "0c0c0c0c0c0c", d: "0d0d0d0d0d0d" };
const DAT = { oldPublish: "2026-10-10T12:00:00.000Z", answered: "2026-10-12T12:00:00.000Z", opened: "2026-10-20T12:00:00.000Z", newPublish: "2026-10-25T12:00:00.000Z" };
const QUOTE = "Un viaje se confirma entre los dos";
// Four points, one per mark: a, published after the person last opened the section and never answered (new); b, answered
// «va» on an older version (changed); c, «va» on the current version (confirmed); d, published before the last opening and
// never answered (none). d's text carries markup, which must read as text. memberId: the person's membership in the project.
function decisionsFixture(memberId = IDS.member) {
  return {
    audience: [memberId],
    opens: { [memberId]: DAT.opened },
    points: [
      { key: DKEY.a, version: "a00000000001", position: 1, title: "Un viaje cuenta cuando las dos personas lo confirman",
        decided: "El viaje se registra solo cuando quien conduce y quien viaja dicen que ocurrió.",
        basis: [{ text: "Así quedó escrito al definir el proyecto.", quote: { file: "01-discovery/vision-brief.md", text: QUOTE } }],
        firstPublishedAt: DAT.newPublish },
      { key: DKEY.b, version: "b00000000002", position: 2, title: "En la prueba piloto no hay plata de por medio",
        decided: "Nadie paga ni cobra durante la prueba.", basis: [], firstPublishedAt: DAT.oldPublish },
      { key: DKEY.c, version: "c00000000001", position: 3, title: "La empresa ve números, nunca nombres",
        decided: "La empresa recibe totales por semana, sin datos de cada persona.", basis: [{ text: "Lo pidió el área de personas." }],
        firstPublishedAt: DAT.oldPublish },
      { key: DKEY.d, version: "d00000000001", position: 4, title: "La app funciona primero en teléfonos",
        decided: "La primera versión es para teléfonos <b>solamente</b>; la web viene después.", basis: [], firstPublishedAt: DAT.oldPublish },
    ],
    answers: [
      { id: randomUUID(), member_id: memberId, key: DKEY.b, version: "b00000000001", value: "yes", comment: null, created_at: DAT.answered },
      { id: randomUUID(), member_id: memberId, key: DKEY.c, version: "c00000000001", value: "yes", comment: null, created_at: DAT.answered },
    ],
    proposals: [],
  };
}
function decisionsBackend(html) {
  const backend = newBackend(html);
  backend.decisions[IDS.project] = decisionsFixture();
  return backend;
}
// Ana is also in the list of a second project, «Huerta del barrio», where nothing was asked of her.
function withAudienceOnly(backend) {
  backend.members.push({ id: DIDS.member, project_id: DIDS.project, email: USER.email, user_id: USER.id, role: "stakeholder", display_name: "Ana Pérez" });
  backend.projects.push({ id: DIDS.project, slug: "huerta", name: DECISIONS.onlyName, language: "es" });
  backend.decisions[DIDS.project] = decisionsFixture(DIDS.member);
  return backend;
}
// The section as the person sees it (only what is shown), or null when the page has none.
const decisionsSection = (page) => page.evaluate((title) => {
  const section = [...document.querySelectorAll("[data-rol=cuerpo] section")].find((s) => s.querySelector("h2")?.textContent === title);
  if (!section) return null;
  const shown = (el) => Boolean(el) && el.getClientRects().length > 0;
  const text = (el) => (shown(el) ? el.textContent : null);
  const field = (el) => (shown(el) ? { value: el.value, invalid: el.getAttribute("aria-invalid") === "true", focused: document.activeElement === el,
    label: el.labels && el.labels[0] ? el.labels[0].textContent : null } : null);
  const button = (el) => (shown(el) ? { text: el.textContent, disabled: el.disabled } : null);
  const propose = section.querySelector(".decisions-propose");
  return {
    lead: section.querySelector(".decisions-lead")?.textContent || null,
    last: section.lastElementChild?.querySelector("h3")?.textContent || null,
    points: [...section.querySelectorAll(".decision")].map((el) => {
      const basis = el.querySelector("details");
      const group = el.querySelector("fieldset");
      return {
        key: el.dataset.key, title: el.querySelector("h3")?.textContent || null, decided: el.querySelector(".decision-decided")?.textContent || null,
        markup: el.querySelectorAll(".decision-decided *").length,
        mark: text(el.querySelector(".decision-mark")), answered: text(el.querySelector(".decision-answered")),
        group: group ? { name: group.querySelector("legend")?.textContent || null, radios: group.querySelectorAll("input[type=radio]").length,
          names: new Set([...group.querySelectorAll("input[type=radio]")].map((r) => r.name)).size } : null,
        choices: [...el.querySelectorAll("input[type=radio]")].map((r) => (r.labels && r.labels[0] ? r.labels[0].textContent : null)),
        checked: el.querySelector("input[type=radio]:checked")?.value || null,
        comment: field(el.querySelector("textarea")), error: text(el.querySelector(".field-error")), notice: text(el.querySelector(".notice p")),
        button: button(el.querySelector("button[type=submit]")),
        basis: basis ? { summary: basis.querySelector("summary")?.textContent || null, open: basis.open, text: basis.textContent } : null,
      };
    }),
    propose: propose ? { title: propose.querySelector("h3")?.textContent || null, field: field(propose.querySelector("textarea")),
      error: text(propose.querySelector(".field-error")), sent: text(propose.querySelector(".decisions-propose-sent")),
      notice: text(propose.querySelector(".notice p")), button: button(propose.querySelector("button[type=submit]")) } : null,
  };
}, DECISIONS.title);
const pointOf = (section, key) => (section ? section.points.find((p) => p.key === key) || null : null);
const radioSel = (key, value) => `.decision[data-key="${key}"] input[type=radio][value="${value}"]`;
const commentSel = (key) => `.decision[data-key="${key}"] textarea`;
const sendSel = (key) => `.decision[data-key="${key}"] button[type=submit]`;
const decisionCalls = (backend, rpc) => backend.decisionCalls.filter((c) => c.rpc === rpc);
const liveText = (page) => page.evaluate(() => document.querySelector("[data-rol=marco] .visually-hidden[role=status]")?.textContent || "");

async function decisionsChecks(browser, base, html) {
  const sectionShown = (page) => waitFor(async () => { const s = await decisionsSection(page); return s && s.points.length ? s : null; }, 10000);

  // section-after-pieces, owner-sees-line, the marks, the choices, comment-required-for-change, answer-sent-confirmed-in-page,
  // propose-always-available and opened-once-per-visit, on one visit.
  {
    const backend = decisionsBackend(html);
    backend.answerDelayMs = 600;
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.project}`);
    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.type()); d.dismiss().catch(() => {}); });
    const section = await sectionShown(page);
    const view = await projectView(page);
    check("decisions: section-after-pieces: «Decisiones» comes after «Lo que se te pidió», with its lead", section && view.pieces.length === 3 &&
      JSON.stringify(view.sections) === JSON.stringify([PROJECT.askedOfYou, DECISIONS.title]) && section.lead === DECISIONS.lead, JSON.stringify({ sections: view.sections, lead: section && section.lead }));
    check("decisions: owner-sees-line: the page starts with the line that says the owner sees when she opens what was shared or this section",
      view.first === PROJECT.ownerSees, JSON.stringify(view.first));
    const marks = section && section.points.map((p) => [p.key, p.mark]);
    check("decisions: marks-new-changed-confirmed-none: each point by position with its mark (new, changed since her answer, confirmed, none)", section &&
      JSON.stringify(marks) === JSON.stringify([[DKEY.a, DECISIONS.marks.new], [DKEY.b, DECISIONS.marks.changed], [DKEY.c, DECISIONS.marks.confirmed], [DKEY.d, null]]),
      JSON.stringify(marks));
    const answeredOn = DECISIONS.answered(await formatIn(page, DAT.answered));
    const [a, b, c, d] = section ? section.points : [];
    check("decisions: marks-new-changed-confirmed-none: a point she answered says when; the confirmed one comes back with «Va» chosen and the changed one with nothing chosen (FOR-12)",
      a && !a.answered && !a.checked && b.answered === answeredOn && !b.checked && c.answered === answeredOn && c.checked === "yes" && c.button && !d.answered && !d.checked,
      JSON.stringify(section && section.points.map(({ key, answered, checked }) => ({ key, answered, checked }))));
    check("decisions: each point is one radio group named by its title, of four choices with «No sé» among them (FOR-11)", section &&
      section.points.every((p) => JSON.stringify(p.choices) === JSON.stringify(DECISIONS.choices) && p.group && p.group.radios === 4 && p.group.names === 1 &&
        p.group.name === p.title), JSON.stringify(section && section.points.map((p) => ({ choices: p.choices, group: p.group, title: p.title }))));
    // FUN-18, as the pieces' options: the whole row of a choice is what a tap hits, its mark included, at least 44 × 44.
    const targets = await page.$$eval(`.decision[data-key="${DKEY.a}"] .choice`, (rows) => rows.map((row) => {
      row.scrollIntoView({ block: "center" }); // elementFromPoint sees only what is on the screen
      const r = row.getBoundingClientRect(), mark = row.querySelector(".choice-mark").getBoundingClientRect();
      const hit = (x, y) => document.elementFromPoint(x, y) === row.querySelector("input[type=radio]");
      return { w: Math.round(r.width), h: Math.round(r.height), mark: hit(mark.left + mark.width / 2, mark.top + mark.height / 2),
        edges: hit(r.left + 1, r.top + 1) && hit(r.right - 1, r.bottom - 1) && hit(r.right - 1, r.top + r.height / 2) };
    }));
    check("decisions: each choice is one row a tap anywhere on chooses, mark and words, at least 44 × 44 (FUN-18)", targets.length === 4 &&
      targets.every((x) => x.w >= 44 && x.h >= 44 && x.mark && x.edges), JSON.stringify(targets));
    check("decisions: «En qué se apoya» is folded, with the quote inside; a point without it has no fold (FOR-13)", a && a.basis && !a.basis.open &&
      a.basis.summary === DECISIONS.basis && a.basis.text.includes(QUOTE) && !a.basis.text.includes("vision-brief") && b.basis === null && c.basis && !c.basis.open,
      JSON.stringify({ a: a && a.basis, b: b && b.basis }));
    check("decisions: a point's text is shown as text, never as markup", d && d.decided.includes("<b>solamente</b>") && d.markup === 0, JSON.stringify(d && d.decided));
    check("decisions: before a choice there is no comment and no send (FOR-05)", a && !a.comment && !a.button && d && !d.comment && !d.button,
      JSON.stringify({ a: a && [a.comment, a.button], d: d && [d.comment, d.button] }));
    check("decisions: opened-once-per-visit: opening the page records the opening once, for that project, after the section was read",
      await waitFor(() => decisionCalls(backend, "mark_decisions_opened").length === 1, 3000) &&
      decisionCalls(backend, "mark_decisions_opened")[0].p_project_id === IDS.project &&
      backend.decisionCalls.findIndex((x) => x.rpc === "my_decisions") < backend.decisionCalls.findIndex((x) => x.rpc === "mark_decisions_opened"),
      JSON.stringify(backend.decisionCalls.map((x) => x.rpc)));
    check("decisions: 360px no horizontal scroll", await noHorizontalScroll(page));
    const axe = await axeViolations(page);
    if (axe) check("decisions: axe has no violations", axe.length === 0, axe.join(", "));
    await page.screenshot({ path: join(outDir, "decisions-360.png"), fullPage: true });

    // comment-required-for-change: «Lo cambiaría» shows the comment; sent empty, it says why and takes the focus; «Va» hides it.
    await page.check(radioSel(DKEY.a, "change")).catch(() => {});
    let p = pointOf(await decisionsSection(page), DKEY.a);
    check("decisions: comment-required-for-change: «Lo cambiaría» shows the comment, labelled, and the send", p && p.comment && p.comment.label === DECISIONS.commentLabel &&
      p.button && p.button.text === DECISIONS.send && !p.button.disabled, JSON.stringify(p));
    await page.click(sendSel(DKEY.a)).catch(() => {});
    p = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.a); return q && q.error ? q : null; }, 3000);
    check("decisions: comment-required-for-change: without a comment nothing is sent; the error says why next to it and the comment takes the focus",
      p && p.error === DECISIONS.commentRequired && p.comment.invalid && p.comment.focused && decisionCalls(backend, "answer_decision").length === 0, JSON.stringify(p));
    // Each asks for what fits its answer: why it does not go, or what is missing to decide.
    for (const [value, label, prompt] of [["no", "No va", DECISIONS.commentRequiredNo], ["unsure", "No sé", DECISIONS.commentRequiredUnsure]]) {
      await page.check(radioSel(DKEY.a, value)).catch(() => {});
      await page.click(sendSel(DKEY.a)).catch(() => {});
      p = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.a); return q && q.error ? q : null; }, 3000);
      check(`decisions: comment-required-for-change: «${label}» needs it too, and asks «${prompt}»`, p && p.error === prompt && p.comment.invalid &&
        decisionCalls(backend, "answer_decision").length === 0, JSON.stringify(p));
    }
    await page.check(radioSel(DKEY.a, "yes")).catch(() => {});
    p = pointOf(await decisionsSection(page), DKEY.a);
    check("decisions: comment-required-for-change: «Va» needs no comment and hides it", p && !p.comment && p.button && !p.error, JSON.stringify(p));

    // answer-sent-confirmed-in-page: «No va» with its comment; the button is off while sending, then the point says when she answered.
    const typed = "Basta con que <b>una</b> persona lo confirme.";
    await page.check(radioSel(DKEY.a, "no")).catch(() => {});
    await page.fill(commentSel(DKEY.a), typed).catch(() => {});
    await page.click(sendSel(DKEY.a)).catch(() => {});
    const busy = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.a); return q && q.button && q.button.disabled && q.button.text === DECISIONS.sending ? q : null; }, 2000);
    check("decisions: answer-sent-confirmed-in-page: while it is sent the button is off and says so", busy, JSON.stringify(busy));
    const done = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.a); return q && q.answered ? q : null; }, 5000);
    const today = DECISIONS.answered(await formatIn(page, new Date().toISOString()));
    const call = decisionCalls(backend, "answer_decision")[0];
    check("decisions: answer-sent-confirmed-in-page: the point says «Respondiste el …» in place, announced, keeps her answer, and no dialog opened (COM-16, COM-18)",
      done && done.answered === today && (await liveText(page)) === today && done.checked === "no" && done.comment && done.comment.value === typed &&
      done.button && !done.button.disabled && done.mark === null && dialogs.length === 0, JSON.stringify({ done, live: await liveText(page), dialogs }));
    check("decisions: answer-sent-confirmed-in-page: it went once, with the point's key, the version the page showed, the value and the comment",
      decisionCalls(backend, "answer_decision").length === 1 && call && call.p_project_id === IDS.project && call.p_key === DKEY.a &&
      call.p_version === "a00000000001" && call.p_value === "no" && call.p_comment === typed, JSON.stringify(decisionCalls(backend, "answer_decision")));
    await page.check(radioSel(DKEY.d, "yes")).catch(() => {});
    await page.click(sendSel(DKEY.d)).catch(() => {});
    p = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.d); return q && q.mark === DECISIONS.marks.confirmed ? q : null; }, 5000);
    check("decisions: answer-sent-confirmed-in-page: «Va» marks the point «Ya lo confirmaste» in place", p && p.answered === today &&
      decisionCalls(backend, "answer_decision").at(-1).p_comment === null, JSON.stringify(p));

    // propose-always-available: last in the section; empty, it says why; sent, it says so and stays for another.
    let s = await decisionsSection(page);
    check("decisions: propose-always-available: «¿Falta algo?» closes the section, with its field and its send", s && s.last === DECISIONS.proposeTitle &&
      s.propose.field && s.propose.field.label === DECISIONS.proposeLabel && s.propose.button && s.propose.button.text === DECISIONS.proposeSend, JSON.stringify(s && s.propose));
    await page.click(".decisions-propose button[type=submit]").catch(() => {});
    s = await decisionsSection(page);
    check("decisions: propose-always-available: empty, nothing is sent; the error says why and the field takes the focus", s && s.propose.error === DECISIONS.proposeEmpty &&
      s.propose.field.invalid && s.propose.field.focused && decisionCalls(backend, "propose_decision").length === 0, JSON.stringify(s && s.propose));
    const proposal = "Falta decir quién responde si algo sale mal.";
    await page.fill(".decisions-propose textarea", `  ${proposal}  `).catch(() => {});
    await page.click(".decisions-propose button[type=submit]").catch(() => {});
    s = await waitFor(async () => { const t = await decisionsSection(page); return t && t.propose.sent ? t : null; }, 5000);
    check("decisions: propose-always-available: sent, the section says so in place, announced, and the empty form stays for another",
      s && s.propose.sent === DECISIONS.proposeSent && s.propose.field && s.propose.field.value === "" && !s.propose.error && s.last === DECISIONS.proposeTitle &&
      (await liveText(page)) === DECISIONS.proposeSent && decisionCalls(backend, "propose_decision").length === 1 &&
      decisionCalls(backend, "propose_decision")[0].p_text === proposal && dialogs.length === 0, JSON.stringify({ propose: s && s.propose, calls: decisionCalls(backend, "propose_decision") }));

    // opened-once-per-visit: answering and proposing record nothing more; coming back is a new visit.
    check("decisions: opened-once-per-visit: answering and proposing record no other opening", decisionCalls(backend, "mark_decisions_opened").length === 1,
      String(decisionCalls(backend, "mark_decisions_opened").length));
    await goTo(page, "#/", () => page.$(`a[href="#/project/${IDS.project}"]`));
    await page.click(`a[href="#/project/${IDS.project}"]`).catch(() => {});
    const again = await sectionShown(page);
    await sleep(300);
    check("decisions: opened-once-per-visit: coming back is another visit, with one more opening; the points she answered come back answered",
      again && decisionCalls(backend, "mark_decisions_opened").length === 2 && pointOf(again, DKEY.a).mark === null && pointOf(again, DKEY.a).checked === "no" &&
      pointOf(again, DKEY.d).mark === DECISIONS.marks.confirmed, JSON.stringify({ calls: decisionCalls(backend, "mark_decisions_opened").length, marks: again && again.points.map((x) => x.mark) }));
    check("decisions: one visit: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // decisions-stale-version: the point changes on the server while she reads it. Her answer is refused (PT409): the section
  // reloads, the point shows it changed, with its new text, and what she chose and typed stays, there and on the other points.
  {
    const backend = decisionsBackend(html);
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.project}`);
    await sectionShown(page);
    await page.check(radioSel(DKEY.d, "unsure")).catch(() => {});
    await page.fill(commentSel(DKEY.d), "No conozco ese caso.").catch(() => {});
    const point = backend.decisions[IDS.project].points.find((x) => x.key === DKEY.a);
    point.version = "a00000000002";
    point.decided = "El viaje se registra cuando las dos personas lo confirman en la app.";
    const typed = "Una sola confirmación basta.";
    await page.check(radioSel(DKEY.a, "no")).catch(() => {});
    await page.fill(commentSel(DKEY.a), typed).catch(() => {});
    const loadsBefore = decisionCalls(backend, "my_decisions").length;
    await page.click(sendSel(DKEY.a)).catch(() => {});
    const after = await waitFor(async () => { const s = await decisionsSection(page); const q = pointOf(s, DKEY.a); return q && q.notice === DECISIONS.stale ? s : null; }, 5000);
    const a = pointOf(after, DKEY.a), d = pointOf(after, DKEY.d);
    check("decisions: decisions-stale-version: refused (PT409), the section reloads and the point shows it changed, with its new text",
      a && a.mark === DECISIONS.marks.changed && a.decided === point.decided && decisionCalls(backend, "my_decisions").length === loadsBefore + 1 &&
      backend.decisions[IDS.project].answers.every((x) => x.key !== DKEY.a), JSON.stringify({ a, loads: decisionCalls(backend, "my_decisions").length - loadsBefore }));
    check("decisions: decisions-stale-version: the typed comment and the choice are kept, on that point and on the others",
      a && a.checked === "no" && a.comment && a.comment.value === typed && d && d.checked === "unsure" && d.comment && d.comment.value === "No conozco ese caso.",
      JSON.stringify({ a, d }));
    check("decisions: decisions-stale-version: the reload records no other opening", decisionCalls(backend, "mark_decisions_opened").length === 1,
      String(decisionCalls(backend, "mark_decisions_opened").length));
    await page.click(sendSel(DKEY.a)).catch(() => {});
    const sent = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.a); return q && q.answered ? q : null; }, 5000);
    check("decisions: decisions-stale-version: sent again, it goes with the version the page now shows", sent && !sent.notice &&
      decisionCalls(backend, "answer_decision").at(-1).p_version === "a00000000002" && backend.decisions[IDS.project].answers.some((x) => x.key === DKEY.a && x.version === "a00000000002"),
      JSON.stringify({ sent, calls: decisionCalls(backend, "answer_decision") }));
    // Offline, the point says so where she acted and keeps her answer.
    backend.answerMode = "network";
    await page.click(sendSel(DKEY.d)).catch(() => {});
    const offline = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.d); return q && q.notice ? q : null; }, 5000);
    check("decisions: offline, the point says so in place and keeps the answer, ready to send again", offline && offline.notice === DECISIONS.network &&
      offline.checked === "unsure" && offline.comment.value === "No conozco ese caso." && offline.button && !offline.button.disabled && !offline.answered, JSON.stringify(offline));
    check("decisions: stale and offline: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // section-absent-before-publish: not in any list (my_decisions 42501), in a list with nothing published, and the owner's page.
  {
    const notListed = newBackend(html);
    const empty = newBackend(html);
    empty.decisions[IDS.project] = { audience: [IDS.member], opens: {}, points: [], answers: [], proposals: [] };
    for (const [backend, what] of [[notListed, "not in the list"], [empty, "in the list, nothing published"]]) {
      const { context, page, errors } = await openMocked(browser, base, backend, "");
      const refusals = [];
      page.on("response", (r) => { if (r.url().includes("/rest/v1/rpc/") && r.status() >= 400) refusals.push(`${r.status()} ${r.url()}`); });
      await page.waitForSelector(".row-link", { timeout: 10000 }).catch(() => {});
      const rows = await projectRowsOf(page);
      await openProject(page).catch(() => {});
      await sleep(400);
      const view = await projectView(page);
      // The page asks decision_projects() and, the project not being there, never asks for the section: no refusal is logged.
      check(`decisions: section-absent-before-publish (${what}): home has only the project with her pieces, and its page no «Decisiones», no opening and no refusal`,
        rows.length === 1 && rows[0].href === `#/project/${IDS.project}` && JSON.stringify(view.sections) === JSON.stringify([PROJECT.askedOfYou]) &&
        decisionCalls(backend, "decision_projects").length === 2 && decisionCalls(backend, "my_decisions").length === 0 &&
        decisionCalls(backend, "mark_decisions_opened").length === 0 && view.notices.length === 0 && refusals.length === 0,
        JSON.stringify({ rows, sections: view.sections, calls: backend.decisionCalls.map((x) => x.rpc), refusals }));
      check(`decisions: section-absent-before-publish (${what}): no page errors`, errors.length === 0, errors.join(" | "));
      await context.close();
    }
    const owner = ownerBackend(html);
    const { context, page, errors } = await openMocked(browser, base, owner, `#/project/${IDS.ownedProject}`);
    await waitFor(() => ownerPart(page), 10000);
    await sleep(300);
    const view = await projectView(page);
    check("decisions: section-absent-before-publish: the owner's page never asks for the section nor shows it (the owner never answers)",
      !view.sections.includes(DECISIONS.title) && !decisionCalls(owner, "my_decisions").some((x) => x.p_project_id === IDS.ownedProject) &&
      decisionCalls(owner, "mark_decisions_opened").length === 0, JSON.stringify({ sections: view.sections, calls: owner.decisionCalls }));
    check("decisions: section-absent-before-publish: owner: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // audience-only-project-listed: home lists the project where she has the section and no pieces; its page has the section only.
  {
    const backend = withAudienceOnly(decisionsBackend(html));
    const { context, page, errors } = await openMocked(browser, base, backend, "");
    await page.waitForSelector(`a[href="#/project/${DIDS.project}"]`, { timeout: 10000 }).catch(() => {});
    const rows = await projectRowsOf(page);
    check("decisions: audience-only-project-listed: home lists the project where she only has the section, by name, saying so on the row's right",
      rows.length === 2 && rows[0].href === `#/project/${DIDS.project}` && rows[0].title === DECISIONS.onlyName && rows[0].aside === DECISIONS.title &&
      rows[1].href === `#/project/${IDS.project}` && rows[1].aside === "1 por responder", JSON.stringify(rows));
    await page.click(`a[href="#/project/${DIDS.project}"]`).catch(() => {});
    const section = await sectionShown(page);
    const view = await projectView(page);
    check("decisions: audience-only-project-listed: its page has the line that says what the owner sees, then the section only",
      section && view.h1 === DECISIONS.onlyName && JSON.stringify(view.sections) === JSON.stringify([DECISIONS.title]) && view.pieces.length === 0 &&
      view.first === PROJECT.ownerSees && section.points.length === 4, JSON.stringify(view));
    await page.check(radioSel(DKEY.b, "yes")).catch(() => {});
    await page.click(sendSel(DKEY.b)).catch(() => {});
    const p = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.b); return q && q.mark === DECISIONS.marks.confirmed ? q : null; }, 5000);
    check("decisions: audience-only-project-listed: she answers there, in that project", p && decisionCalls(backend, "answer_decision").at(-1).p_project_id === DIDS.project &&
      decisionCalls(backend, "mark_decisions_opened").at(-1).p_project_id === DIDS.project, JSON.stringify(backend.decisionCalls.filter((x) => x.rpc !== "decision_projects")));
    check("decisions: audience-only-project-listed: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // opened-call-fails: offline, a database without the function, an ended session: the section shows and answers go anyway.
  for (const mode of ["network", "missing", "expired"]) {
    const backend = decisionsBackend(html);
    backend.decisionsOpenedFails = mode;
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.project}`);
    const section = await sectionShown(page);
    const tried = await waitFor(() => decisionCalls(backend, "mark_decisions_opened").length === 1, 3000);
    await page.check(radioSel(DKEY.d, "yes")).catch(() => {});
    await page.click(sendSel(DKEY.d)).catch(() => {});
    const p = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.d); return q && q.mark === DECISIONS.marks.confirmed ? q : null; }, 5000);
    const notices = await page.$$eval("[data-rol=avisos] .notice", (els) => els.map((n) => n.textContent));
    check(`decisions: opened-call-fails (${mode}): the section shows and an answer still goes, with no notice`, section && tried && p && notices.length === 0,
      JSON.stringify({ section: Boolean(section), tried, p, notices }));
    check(`decisions: opened-call-fails (${mode}): no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // in-flight-send-survives-reload: point d's answer is on its way (slow) when point a's is refused as changed (PT409) and
  // the section reloads. d keeps its send off and saying so, and a second send of its form does not go.
  // confirm-when-reload-fails: the same, then the section can no longer be read (offline): d's answer lands, the reload
  // after it fails, and d says in place that it was answered anyway (COM-16).
  async function sendingWhileReloaded() {
    const backend = decisionsBackend(html);
    backend.answerDelayByKey = { [DKEY.d]: 3000 };
    const opened = await openMocked(browser, base, backend, `#/project/${IDS.project}`);
    const { page } = opened;
    await sectionShown(page);
    await page.check(radioSel(DKEY.d, "yes")).catch(() => {});
    await page.click(sendSel(DKEY.d)).catch(() => {});
    await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.d); return q && q.button && q.button.disabled; }, 2000);
    const point = backend.decisions[IDS.project].points.find((x) => x.key === DKEY.a);
    point.version = "a00000000002";
    await page.check(radioSel(DKEY.a, "yes")).catch(() => {});
    await page.click(sendSel(DKEY.a)).catch(() => {});
    const reloaded = await waitFor(async () => { const s = await decisionsSection(page); return pointOf(s, DKEY.a)?.notice === DECISIONS.stale ? s : null; }, 2500);
    return { ...opened, backend, reloaded };
  }
  {
    const { context, page, errors, backend, reloaded } = await sendingWhileReloaded();
    const d = pointOf(reloaded, DKEY.d);
    check("decisions: in-flight-send-survives-reload: the section reloaded while d was sending, and d's send stays off and says so",
      d && d.button && d.button.disabled && d.button.text === DECISIONS.sending && d.checked === "yes" &&
      decisionCalls(backend, "my_decisions").length === 2, JSON.stringify({ d, loads: decisionCalls(backend, "my_decisions").length }));
    // Sending d's form again (as Enter would) while its answer is on its way sends nothing more.
    await page.$eval(`.decision[data-key="${DKEY.d}"] form`, (form) => form.requestSubmit()).catch(() => {});
    const landed = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.d); return q && q.answered ? q : null; }, 6000);
    await sleep(500);
    const sends = decisionCalls(backend, "answer_decision").filter((c) => c.p_key === DKEY.d);
    const today = DECISIONS.answered(await formatIn(page, new Date().toISOString()));
    check("decisions: in-flight-send-survives-reload: d's answer went exactly once; the section read again after it, and d says it was answered, announced",
      landed && sends.length === 1 && backend.decisions[IDS.project].answers.filter((x) => x.key === DKEY.d).length === 1 &&
      landed.mark === DECISIONS.marks.confirmed && landed.answered === today && (await liveText(page)) === today &&
      decisionCalls(backend, "my_decisions").length === 3, JSON.stringify({ sends, landed, live: await liveText(page), loads: decisionCalls(backend, "my_decisions").length }));
    check("decisions: in-flight-send-survives-reload: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  // no-second-send-while-reading-again: d's answer lands after the section was drawn again, so the page reads the section
  // once more (slow here). Until that read and the confirmation are done, d's send stays off: a second send of its form in
  // that window does not go.
  {
    const { context, page, errors, backend } = await sendingWhileReloaded();
    backend.myDecisionsDelayMs = 1500;
    const reading = await waitFor(() => decisionCalls(backend, "my_decisions").length === 3, 6000);
    await sleep(200);
    const during = pointOf(await decisionsSection(page), DKEY.d);
    await page.$eval(`.decision[data-key="${DKEY.d}"] form`, (form) => form.requestSubmit()).catch(() => {});
    const landed = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.d); return q && q.answered && q.button && !q.button.disabled ? q : null; }, 6000);
    await sleep(500);
    const sends = decisionCalls(backend, "answer_decision").filter((c) => c.p_key === DKEY.d);
    check("decisions: no-second-send-while-reading-again: while the section is read again after d's answer landed, d's send stays off and says so",
      reading && during && during.button && during.button.disabled && during.button.text === DECISIONS.sending, JSON.stringify({ reading, during }));
    check("decisions: no-second-send-while-reading-again: a second send of d's form in that window does not go; d is confirmed once the read is done",
      landed && landed.mark === DECISIONS.marks.confirmed && landed.button.text === DECISIONS.send && sends.length === 1 &&
      backend.decisions[IDS.project].answers.filter((x) => x.key === DKEY.d).length === 1, JSON.stringify({ landed, sends }));
    check("decisions: no-second-send-while-reading-again: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const { context, page, errors, backend } = await sendingWhileReloaded();
    backend.myDecisionsFails = true;
    const today = DECISIONS.answered(await formatIn(page, new Date().toISOString()));
    const landed = await waitFor(async () => { const q = pointOf(await decisionsSection(page), DKEY.d); return q && q.answered ? q : null; }, 6000);
    await sleep(300);
    check("decisions: confirm-when-reload-fails: the reload after d's send could not read the section, and d says in place that it was answered, announced",
      landed && landed.answered === today && landed.mark === DECISIONS.marks.confirmed && (await liveText(page)) === today &&
      landed.button && !landed.button.disabled && landed.button.text === DECISIONS.send && !landed.notice &&
      decisionCalls(backend, "my_decisions").length === 3 && decisionCalls(backend, "answer_decision").filter((c) => c.p_key === DKEY.d).length === 1,
      JSON.stringify({ landed, live: await liveText(page), loads: decisionCalls(backend, "my_decisions").length }));
    check("decisions: confirm-when-reload-fails: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---- the «Decisiones» screens for the visual manual --------------------------------------------------------------
// Snapshots of the section's screens (PORTAL_SCREENS), each in the state the manual measures and the judges look at, with
// plain texts: the markup-as-text of the checks above stays in the checks. All «lista», the project page's pattern (the
// section's forms inside it are marked data-medida="formulario"):
// - project-decisions: a person's project page, her pieces and the section with the four marks (new, changed since her
//   answer, confirmed, none), «Lo cambiaría» chosen on the first point with its comment open and typed;
// - project-decisions-errors: the same section in its error states: a point that changed while she read it, a send that
//   could not go, a comment missing and an empty proposal;
// - project-decisions-only: a project where she only has the section, no pieces;
// - project-owner-decisions: the owner's page, the pieces' part and then the section's counts and what people proposed;
// - owner-decision: one point as the owner reads it: disagreement, silence, an answer on an older version and a person
//   no longer on the list.
const PLAIN = {
  decidedD: "La primera versión es solo para teléfonos; la web viene después.",
  comment: "Que baste con que lo confirme quien conduce.",
  martaComment: "Prefiero que cuente con una sola confirmación.",
  proposal: "Falta decir quién responde si algo sale mal.",
  tomas: { id: "a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6", name: "Tomás León" },
};
async function decisionsScreens(browser, base, html) {
  const sectionShown = (page) => waitFor(async () => { const s = await decisionsSection(page); return s && s.points.length ? s : null; }, 10000);
  const plain = (entry) => { entry.points.find((p) => p.key === DKEY.d).decided = PLAIN.decidedD; return entry; };
  {
    const backend = decisionsBackend(html);
    plain(backend.decisions[IDS.project]);
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.project}`);
    await sectionShown(page);
    await page.check(radioSel(DKEY.a, "change")).catch(() => {});
    await page.fill(commentSel(DKEY.a), PLAIN.comment).catch(() => {});
    let s = await decisionsSection(page);
    check("screens: project-decisions: the four marks, and the first point with «Lo cambiaría» and its comment open", s &&
      JSON.stringify(s.points.map((p) => p.mark)) === JSON.stringify([DECISIONS.marks.new, DECISIONS.marks.changed, DECISIONS.marks.confirmed, null]) &&
      s.points[0].checked === "change" && s.points[0].comment && s.points[0].comment.value === PLAIN.comment, JSON.stringify(s && s.points.map(({ mark, checked, comment }) => ({ mark, checked, comment }))));
    await snapshot(page, "project-decisions", "lista", { formState: true });

    // The errors: b changed on the server while she read it (PT409, the section reloads); d's send cannot go (offline); a,
    // «No va» without its comment; and the proposal sent empty.
    backend.decisions[IDS.project].points.find((p) => p.key === DKEY.b).version = "b00000000003";
    await page.check(radioSel(DKEY.b, "yes")).catch(() => {});
    await page.click(sendSel(DKEY.b)).catch(() => {});
    await waitFor(async () => pointOf(await decisionsSection(page), DKEY.b)?.notice === DECISIONS.stale, 5000);
    backend.answerMode = "network";
    await page.check(radioSel(DKEY.d, "yes")).catch(() => {});
    await page.click(sendSel(DKEY.d)).catch(() => {});
    await waitFor(async () => pointOf(await decisionsSection(page), DKEY.d)?.notice === DECISIONS.network, 5000);
    await page.check(radioSel(DKEY.a, "no")).catch(() => {});
    await page.fill(commentSel(DKEY.a), "").catch(() => {});
    await page.click(sendSel(DKEY.a)).catch(() => {});
    await page.click(".decisions-propose button[type=submit]").catch(() => {});
    s = await waitFor(async () => { const t = await decisionsSection(page); return t && pointOf(t, DKEY.a)?.error && t.propose.error ? t : null; }, 3000);
    check("screens: project-decisions-errors: changed while read, offline, a comment missing and an empty proposal, each said where it happened", s &&
      pointOf(s, DKEY.b).notice === DECISIONS.stale && pointOf(s, DKEY.d).notice === DECISIONS.network && pointOf(s, DKEY.a).error === DECISIONS.commentRequiredNo &&
      s.propose.error === DECISIONS.proposeEmpty, JSON.stringify(s && { points: s.points.map(({ key, notice, error }) => ({ key, notice, error })), propose: s.propose }));
    await snapshot(page, "project-decisions-errors", "lista", { formState: true });
    check("screens: project-decisions: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const backend = withAudienceOnly(decisionsBackend(html));
    plain(backend.decisions[DIDS.project]);
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${DIDS.project}`);
    const s = await sectionShown(page);
    const view = await projectView(page);
    check("screens: project-decisions-only: the section only, no pieces", s && view.h1 === DECISIONS.onlyName && view.pieces.length === 0 &&
      JSON.stringify(view.sections) === JSON.stringify([DECISIONS.title]), JSON.stringify(view));
    await snapshot(page, "project-decisions-only", "lista", { formState: true });
    check("screens: project-decisions-only: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    const backend = ownerDecisionsBackend(html);
    const entry = backend.decisions[IDS.ownedProject];
    entry.answers.find((a) => a.comment === HTML_COMMENT).comment = PLAIN.martaComment;
    entry.proposals.find((x) => x.text === HTML_PROPOSAL).text = PLAIN.proposal;
    // Tomás answered «trips» before it changed.
    entry.members.push({ id: PLAIN.tomas.id, display_name: PLAIN.tomas.name, role: "stakeholder", created_at: "2026-10-07T12:00:00.000Z" });
    entry.audience.push(PLAIN.tomas.id);
    entry.answers.push({ id: randomUUID(), member_id: PLAIN.tomas.id, key: OKEY.trips, version: "e10000000000", value: "yes", comment: null, created_at: OAT.before });
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.ownedProject}`);
    const summary = await waitFor(async () => { const x = await ownerDecisionsSummary(page); return x && x.points.length ? x : null; }, 10000);
    check("screens: project-owner-decisions: the pieces' part, then the section's counts and the proposals", summary && summary.points.length === 3 &&
      summary.proposals.length === 2 && JSON.stringify((await projectView(page)).sections) === JSON.stringify([OWNER.section, DECISIONS.title]), JSON.stringify(summary));
    await snapshot(page, "project-owner-decisions", "lista");
    await page.click(`a[href="#/project/${IDS.ownedProject}/decisions/${OKEY.trips}"]`).catch(() => {});
    const point = await waitFor(async () => { const v = await ownerDecisionView(page); return v.h1 === OTITLE.trips && v.people.length ? v : null; }, 10000);
    const said = point ? Object.fromEntries(point.people.map((x) => [x.name, x])) : {};
    check("screens: owner-decision: disagreement («Va», «No va»), silence, an answer on an older version and a person no longer on the list", point &&
      said[PEOPLE.luis.name]?.answer === "Va" && said[PEOPLE.marta.name]?.answer === "No va" && said[PEOPLE.pedro.name]?.answer === OWNER_DECISIONS.noAnswer &&
      said[PLAIN.tomas.name]?.meta === OWNER_DECISIONS.older && said[PEOPLE.sofia.name]?.meta?.includes(OWNER_DECISIONS.left), JSON.stringify(point && point.people));
    await snapshot(page, "owner-decision", "lista");
    check("screens: owner decisions: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

// ---- the owner's view of the «Decisiones» section -------------------------------------------------------------
// The owner of a project sees, on its page after the pieces' part, every point of the section with how many people
// answered each way, silence said as «Sin respuesta» and never counted as «Va», and what the people proposed; «Ver
// respuestas» opens one point: its text, then each person with their latest answer and comment, «Sin respuesta» for
// silence, «Respondió antes de que cambiara» for an answer on an older version, «Ya no está en la lista» for a person
// removed from the list, their earlier answers, and when they last opened the section. Read only: nothing answers, sends
// or records (spec 2026-10-25 página del proyecto §4.3, §4.5).
const OWNER_DECISIONS = {
  lead: "Cuántas personas respondieron cada punto. Abre uno para ver qué dijo cada una.",
  below: "Más abajo, en Decisiones, ves cómo respondió cada persona a lo que ya se decidió.",
  see: "Ver respuestas",
  seeLabel: (title) => `Ver respuestas sobre ${title}`,
  peopleTitle: "Cómo respondió cada persona",
  noAnswer: "Sin respuesta",
  older: "Respondió antes de que cambiara",
  left: "Ya no está en la lista",
  answeredOn: (date) => `Respondió el ${date}`,
  openedOn: (date) => `Abrió la sección el ${date}`,
  history: "Respuestas anteriores",
  proposalsTitle: "Lo que propusieron agregar",
  proposalBy: (name, date) => `${name}, el ${date}`,
};
const OKEY = { trips: "e1e1e1e1e1e1", pilot: "e2e2e2e2e2e2", removed: "e3e3e3e3e3e3", phones: "e4e4e4e4e4e4" };
const OAT = { member: "2026-10-01T12:00:00.000Z", before: "2026-10-10T12:00:00.000Z", first: "2026-10-12T12:00:00.000Z", second: "2026-10-14T12:00:00.000Z",
  third: "2026-10-16T12:00:00.000Z", luisOpened: "2026-10-21T12:00:00.000Z", martaOpened: "2026-10-22T12:00:00.000Z", proposed: "2026-10-23T12:00:00.000Z" };
const HTML_COMMENT = '<img src=x onerror="window.__x=1">';
const HTML_PROPOSAL = "<script>window.__y=1</script>Falta decir quién responde si algo sale mal.";
const OTITLE = { trips: "Un viaje cuenta cuando las dos personas lo confirman", pilot: "En la prueba piloto no hay plata de por medio",
  removed: "Un punto que ya no se publica", phones: "La app funciona primero en teléfonos" };
// Ana owns «Biblioteca del barrio». Its section went to Luis, Marta and Pedro; Sofía answered and was then removed from the
// list. «trips»: Luis «Va», Marta «No va» with a comment that is markup, Pedro silent, Sofía «Lo cambiaría». «pilot»
// changed after Luis's «Va»; Marta said «No sé», then «Va». «removed» is no longer published. Nobody answered «phones».
function ownerDecisionsBackend(html) {
  const backend = ownerBackend(html);
  const { luis, marta, pedro, sofia } = PEOPLE;
  const answer = (person, key, version, value, comment, at) => ({ id: randomUUID(), member_id: person.id, key, version, value, comment, created_at: at });
  backend.decisions[IDS.ownedProject] = {
    audience: [luis.id, marta.id, pedro.id],
    opens: { [luis.id]: OAT.luisOpened, [marta.id]: OAT.martaOpened },
    members: [{ id: IDS.ownerMember, display_name: "Ana Pérez", role: "owner", created_at: OAT.member },
      ...[luis, marta, pedro, sofia].map((p, i) => ({ id: p.id, display_name: p.name, role: "stakeholder", created_at: `2026-10-0${i + 2}T12:00:00.000Z` }))],
    points: [
      { key: OKEY.trips, version: "e10000000001", position: 1, title: OTITLE.trips, decided: "El viaje se registra solo cuando quien conduce y quien viaja dicen que ocurrió.",
        basis: [], firstPublishedAt: OAT.before },
      { key: OKEY.pilot, version: "e20000000002", position: 2, title: OTITLE.pilot, decided: "Nadie paga ni cobra durante la prueba.", basis: [], firstPublishedAt: OAT.before },
      { key: OKEY.removed, version: "e30000000001", position: 3, title: OTITLE.removed, decided: "Ya no está en la sección.", basis: [], firstPublishedAt: OAT.before, active: false },
      { key: OKEY.phones, version: "e40000000001", position: 4, title: OTITLE.phones, decided: "La primera versión es para teléfonos; la web viene después.", basis: [], firstPublishedAt: OAT.before },
    ],
    answers: [
      answer(luis, OKEY.trips, "e10000000001", "yes", null, OAT.first),
      answer(marta, OKEY.trips, "e10000000001", "no", HTML_COMMENT, OAT.second),
      answer(sofia, OKEY.trips, "e10000000001", "change", "Que lo confirme solo quien conduce.", OAT.first),
      answer(luis, OKEY.pilot, "e20000000001", "yes", null, OAT.before),
      answer(marta, OKEY.pilot, "e20000000002", "unsure", "No sé si la empresa pone algo.", OAT.first),
      answer(marta, OKEY.pilot, "e20000000002", "yes", null, OAT.third),
      answer(luis, OKEY.removed, "e30000000001", "no", "No hace falta.", OAT.first),
    ],
    proposals: [
      { id: randomUUID(), member_id: pedro.id, text: HTML_PROPOSAL, created_at: OAT.proposed },
      { id: randomUUID(), member_id: sofia.id, text: "Que se pueda usar en la web.", created_at: OAT.first },
    ],
  };
  return backend;
}
// The owner's «Decisiones» on the project's page, or null.
const ownerDecisionsSummary = (page) => page.evaluate((title) => {
  const section = [...document.querySelectorAll("[data-rol=cuerpo] section")].find((s) => s.querySelector("h2")?.textContent === title);
  if (!section) return null;
  return {
    lead: section.querySelector(".owner-lead")?.textContent || null,
    points: [...section.querySelectorAll(".owner-decision-row")].map((li) => {
      const a = li.querySelector("a");
      return { title: li.querySelector(".row-title")?.textContent || null, counts: li.querySelector(".row-meta")?.textContent || null,
        link: a ? { href: a.getAttribute("href"), text: a.textContent, label: a.getAttribute("aria-label") } : null };
    }),
    proposalsTitle: section.querySelector(".owner-proposals h3")?.textContent || null,
    proposals: [...section.querySelectorAll(".owner-proposal")].map((el) => ({ by: el.querySelector(".row-meta")?.textContent || null,
      text: el.querySelector(".owner-proposal-text")?.textContent || null })),
    markup: section.querySelectorAll(".owner-proposal-text *, script, img").length,
    controls: section.querySelectorAll("button, input, textarea, select, form").length,
  };
}, DECISIONS.title);
// One point as the owner reads it (#/project/<id>/decisions/<key>).
const ownerDecisionView = (page) => page.evaluate(() => {
  const main = document.querySelector("main");
  const back = document.querySelector("[data-rol=marco] .back-link");
  const text = (el) => (el ? el.textContent : null);
  return {
    h1: text(document.querySelector("h1")),
    meta: [...document.querySelectorAll(".page-meta")].map((el) => el.textContent),
    // The link's words from 672 px (where it goes), without its arrow (not read), and its name.
    back: back ? { href: back.getAttribute("href"), text: back.querySelector(".back-link-long")?.textContent ?? null, label: back.getAttribute("aria-label") } : null,
    decided: text(document.querySelector(".owner-decision-decided")),
    peopleTitle: text(document.querySelector("[data-rol=cuerpo] section h2")),
    people: [...document.querySelectorAll(".owner-answer")].map((el) => {
      const fold = el.querySelector("details");
      return { name: text(el.querySelector(".row-title")), answer: text(el.querySelector(".owner-answer-value")), meta: text(el.querySelector(":scope > .row-meta")),
        comment: text(el.querySelector(":scope > .owner-answer-comment")),
        history: fold ? { summary: text(fold.querySelector("summary")), open: fold.open,
          entries: [...fold.querySelectorAll("li")].map((li) => ({ line: text(li.querySelector(".owner-history-line")), comment: text(li.querySelector(".owner-answer-comment")) })) } : null };
    }),
    notices: [...document.querySelectorAll("[data-rol=avisos] .notice")].map((n) => n.querySelector("p")?.textContent || null),
    controls: main ? main.querySelectorAll("button, input, textarea, select, form, [contenteditable]").length : -1,
    markup: main ? main.querySelectorAll("img, script, .owner-answer-comment *").length : -1,
    x: window.__x, y: window.__y,
  };
});
const OWNER_WRITES = ["answer_decision", "propose_decision", "mark_decisions_opened", "my_decisions"];

async function ownerDecisionsChecks(browser, base, html) {
  const { luis, marta, pedro, sofia } = PEOPLE;
  const detailHref = (key, projectId = IDS.ownedProject) => `#/project/${projectId}/decisions/${key}`;
  const detailShown = (page, title) => waitFor(async () => { const v = await ownerDecisionView(page); return v.h1 === title && v.people.length ? v : null; }, 10000);

  // owner-decisions-counts, -disagreement, -history, -removed-person, -html-comment and -no-controls, on one visit.
  {
    const backend = ownerDecisionsBackend(html);
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.ownedProject}`);
    const summary = await waitFor(async () => { const s = await ownerDecisionsSummary(page); return s && s.points.length ? s : null; }, 10000);
    const view = await projectView(page);
    const d = Object.fromEntries(await Promise.all(Object.entries(OAT).map(async ([k, v]) => [k, await formatIn(page, v)])));
    check("owner-decisions: the owner's page shows «Decisiones» after the pieces' part, with its lead", summary &&
      JSON.stringify(view.sections) === JSON.stringify([OWNER.section, DECISIONS.title]) && summary.lead === OWNER_DECISIONS.lead, JSON.stringify({ sections: view.sections, lead: summary && summary.lead }));
    check("owner-decisions: the page opens with a short line that says «Decisiones» is further down (FUN-42: on a phone the pieces' part shows under it)",
      view.first === OWNER_DECISIONS.below, JSON.stringify(view.first));
    check("owner-decisions-counts: each published point in order, with how many answered each way; silence is «Sin respuesta», never «Va»; a removed point is not listed",
      summary && JSON.stringify(summary.points.map(({ title, counts }) => ({ title, counts }))) === JSON.stringify([
        { title: OTITLE.trips, counts: "Va: 1 · No va: 1 · Sin respuesta: 1" },
        { title: OTITLE.pilot, counts: "Va: 1 · Sin respuesta: 2" },
        { title: OTITLE.phones, counts: "Sin respuesta: 3" }]), JSON.stringify(summary && summary.points));
    check("owner-decisions: each point links to its answers, the link naming the point", summary && summary.points.every((p, i) => p.link &&
      p.link.href === detailHref([OKEY.trips, OKEY.pilot, OKEY.phones][i]) && p.link.text === OWNER_DECISIONS.see && p.link.label === OWNER_DECISIONS.seeLabel(p.title)),
      JSON.stringify(summary && summary.points.map((p) => p.link)));
    check("owner-decisions: what people proposed, oldest first, by name and date, as text", summary && summary.proposalsTitle === OWNER_DECISIONS.proposalsTitle &&
      JSON.stringify(summary.proposals) === JSON.stringify([{ by: OWNER_DECISIONS.proposalBy(sofia.name, d.first), text: "Que se pueda usar en la web." },
        { by: OWNER_DECISIONS.proposalBy(pedro.name, d.proposed), text: HTML_PROPOSAL }]) && summary.markup === 0, JSON.stringify(summary && summary.proposals));
    check("owner-decisions-no-controls: the summary has no control that answers or sends", summary && summary.controls === 0, String(summary && summary.controls));
    check("owner-decisions: the owner's page reads owner_decisions for this project and never the person's section", decisionCalls(backend, "owner_decisions").length === 1 &&
      decisionCalls(backend, "owner_decisions")[0].p_project_id === IDS.ownedProject && !backend.decisionCalls.some((c) => OWNER_WRITES.includes(c.rpc)),
      JSON.stringify(backend.decisionCalls.map((c) => c.rpc)));
    check("owner-decisions: 360px no horizontal scroll", await noHorizontalScroll(page));
    const axe = await axeViolations(page);
    if (axe) check("owner-decisions: axe has no violations", axe.length === 0, axe.join(", "));
    await page.screenshot({ path: join(outDir, "owner-decisions-360.png"), fullPage: true });

    // One point: «trips».
    await page.click(`a[href="${detailHref(OKEY.trips)}"]`).catch(() => {});
    let point = await detailShown(page, OTITLE.trips);
    await sleep(300);
    point = await ownerDecisionView(page);
    check("owner-decisions: a point opens with its title, its counts, the way back to the project and what was decided", point.h1 === OTITLE.trips &&
      JSON.stringify(point.meta) === JSON.stringify(["Va: 1 · No va: 1 · Sin respuesta: 1"]) && point.back && point.back.href === `#/project/${IDS.ownedProject}` &&
      point.back.text === PROJECT.owned && point.back.label === `Volver a ${PROJECT.owned}` && point.decided === backend.decisions[IDS.ownedProject].points[0].decided && point.peopleTitle === OWNER_DECISIONS.peopleTitle,
      JSON.stringify(point));
    const byName = (v, name) => v.people.find((x) => x.name === name) || null;
    check("owner-decisions-disagreement: two people, «Va» and «No va», both shown with their own answer", byName(point, luis.name)?.answer === "Va" &&
      byName(point, marta.name)?.answer === "No va" && JSON.stringify(point.people.map((x) => x.name)) === JSON.stringify([luis.name, marta.name, pedro.name, sofia.name]),
      JSON.stringify(point.people));
    check("owner-decisions-counts: the person who never answered reads «Sin respuesta», with no date nor comment", JSON.stringify(byName(point, pedro.name)) ===
      JSON.stringify({ name: pedro.name, answer: OWNER_DECISIONS.noAnswer, meta: null, comment: null, history: null }), JSON.stringify(byName(point, pedro.name)));
    check("owner-decisions: each answer says when it was given, and when the person last opened the section",
      byName(point, luis.name)?.meta === `${OWNER_DECISIONS.answeredOn(d.first)} · ${OWNER_DECISIONS.openedOn(d.luisOpened)}` &&
      byName(point, marta.name)?.meta === `${OWNER_DECISIONS.answeredOn(d.second)} · ${OWNER_DECISIONS.openedOn(d.martaOpened)}`, JSON.stringify(point.people));
    check("owner-decisions-removed-person: Sofía, removed after answering, shows her answer and comment and that she is no longer on the list",
      JSON.stringify(byName(point, sofia.name)) === JSON.stringify({ name: sofia.name, answer: "Lo cambiaría",
        meta: `${OWNER_DECISIONS.answeredOn(d.first)} · ${OWNER_DECISIONS.left}`, comment: "Que lo confirme solo quien conduce.", history: null }), JSON.stringify(byName(point, sofia.name)));
    await sleep(300);
    point = await ownerDecisionView(page);
    check("owner-decisions-html-comment: a comment that is markup is shown as its literal text and never runs", byName(point, marta.name)?.comment === HTML_COMMENT &&
      point.markup === 0 && point.x === undefined, JSON.stringify({ comment: byName(point, marta.name)?.comment, markup: point.markup, x: point.x }));
    check("owner-decisions-html-comment: a proposal that is markup never ran either", point.y === undefined, String(point.y));
    check("owner-decisions-no-controls: no button, choice, field or form on the point: the owner reads, never answers", point.controls === 0, String(point.controls));
    check("owner-decisions: 360px no horizontal scroll on a point", await noHorizontalScroll(page));
    const pointAxe = await axeViolations(page);
    if (pointAxe) check("owner-decisions: a point: axe has no violations", pointAxe.length === 0, pointAxe.join(", "));
    await page.screenshot({ path: join(outDir, "owner-decision-360.png"), fullPage: true });

    // «pilot»: Luis answered before it changed; Marta changed her mind.
    point = await goTo(page, detailHref(OKEY.pilot), () => detailShown(page, OTITLE.pilot));
    check("owner-decisions: an answer on an older version reads «Sin respuesta» for this version, says it was given before the change, and keeps it in the history",
      point && JSON.stringify(byName(point, luis.name)) === JSON.stringify({ name: luis.name, answer: OWNER_DECISIONS.noAnswer,
        meta: `${OWNER_DECISIONS.older} · ${OWNER_DECISIONS.openedOn(d.luisOpened)}`, comment: null,
        history: { summary: OWNER_DECISIONS.history, open: false, entries: [{ line: `Va · ${d.before} · ${OWNER_DECISIONS.older}`, comment: null }] } }),
      JSON.stringify(point && byName(point, luis.name)));
    check("owner-decisions-history: the latest answer first, the earlier ones folded, each with its date and comment", point &&
      JSON.stringify(byName(point, marta.name)) === JSON.stringify({ name: marta.name, answer: "Va", meta: `${OWNER_DECISIONS.answeredOn(d.third)} · ${OWNER_DECISIONS.openedOn(d.martaOpened)}`,
        comment: null, history: { summary: OWNER_DECISIONS.history, open: false, entries: [{ line: `No sé · ${d.first}`, comment: "No sé si la empresa pone algo." }] } }) &&
      JSON.stringify(point.people.map((x) => x.name)) === JSON.stringify([luis.name, marta.name, pedro.name]), JSON.stringify(point && point.people));
    point = await goTo(page, detailHref(OKEY.phones), () => detailShown(page, OTITLE.phones));
    check("owner-decisions-counts: a point nobody answered: everyone «Sin respuesta», none counted as «Va»", point &&
      JSON.stringify(point.meta) === JSON.stringify(["Sin respuesta: 3"]) && point.people.length === 3 && point.people.every((x) => x.answer === OWNER_DECISIONS.noAnswer),
      JSON.stringify(point));
    check("owner-decisions-no-controls: reading the section and its points answered, proposed, recorded nothing and never read the person's section",
      !backend.decisionCalls.some((c) => OWNER_WRITES.includes(c.rpc)) && backend.decisions[IDS.ownedProject].answers.length === 7 && writesIn(backend.requests).length === 0,
      JSON.stringify(backend.decisionCalls.map((c) => c.rpc)));
    check("owner-decisions: one visit: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // 320 px: a point and the summary keep within the screen.
  {
    const backend = ownerDecisionsBackend(html);
    const { context, page, errors } = await openMocked(browser, base, backend, detailHref(OKEY.trips), 320);
    await detailShown(page, OTITLE.trips);
    check("owner-decisions 320px: a point has no horizontal scroll", await noHorizontalScroll(page));
    await goTo(page, `#/project/${IDS.ownedProject}`, async () => { const s = await ownerDecisionsSummary(page); return s && s.points.length ? s : null; });
    check("owner-decisions 320px: the summary has no horizontal scroll", await noHorizontalScroll(page));
    check("owner-decisions 320px: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // owner-decisions-version-returns: «phones» went to another version and came back to this one. Pedro said «Va» on this
  // version, then «No va» on the other: his newest answer is not on the version shown, so he counts as «Sin respuesta»,
  // never as his older «Va», as his own entry says.
  {
    const backend = ownerDecisionsBackend(html);
    backend.decisions[IDS.ownedProject].answers.push(
      { id: randomUUID(), member_id: pedro.id, key: OKEY.phones, version: "e40000000001", value: "yes", comment: null, created_at: OAT.before },
      { id: randomUUID(), member_id: pedro.id, key: OKEY.phones, version: "e40000000002", value: "no", comment: "Mejor la web primero.", created_at: OAT.first });
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.ownedProject}`);
    const summary = await waitFor(async () => { const s = await ownerDecisionsSummary(page); return s && s.points.length ? s : null; }, 10000);
    const phones = summary && summary.points.find((x) => x.title === OTITLE.phones);
    const point = await goTo(page, detailHref(OKEY.phones), () => detailShown(page, OTITLE.phones));
    const entry = point && point.people.find((x) => x.name === pedro.name);
    check("owner-decisions-version-returns: back on an earlier version, the counts take Pedro's newest answer (on another version) as «Sin respuesta», never his older «Va», as his entry says",
      phones && phones.counts === "Sin respuesta: 3" && point && JSON.stringify(point.meta) === JSON.stringify(["Sin respuesta: 3"]) && entry &&
      entry.answer === OWNER_DECISIONS.noAnswer && entry.meta === OWNER_DECISIONS.older && entry.history && entry.history.entries.length === 2,
      JSON.stringify({ phones, meta: point && point.meta, entry }));
    check("owner-decisions-version-returns: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // owner-decisions-fails: owner_decisions answers an error (500) or cannot be reached. The owner's page still shows the
  // pieces' part; only the «Decisiones» part is left out, with no error page.
  for (const mode of ["error", "network"]) {
    const backend = ownerDecisionsBackend(html);
    backend.ownerDecisionsFails = mode;
    const { context, page, errors } = await openMocked(browser, base, backend, `#/project/${IDS.ownedProject}`);
    const part = await waitFor(() => ownerPart(page), 10000);
    await sleep(300);
    const view = await projectView(page);
    check(`owner-decisions-fails (${mode}): the page shows the pieces' part, leaves out only «Decisiones», and shows no error`, part && view.h1 === PROJECT.owned &&
      JSON.stringify(view.sections) === JSON.stringify([OWNER.section]) && view.notices.length === 0 && decisionCalls(backend, "owner_decisions").length === 1,
      JSON.stringify({ view, calls: backend.decisionCalls.map((c) => c.rpc) }));
    check(`owner-decisions-fails (${mode}): no page errors`, errors.length === 0, errors.join(" | "));
    await context.close();
  }

  // owner-decisions-denied: a person who is not the owner, the server refusing a membership that says owner, a point that
  // is no longer published and a key that is not there: the not-available notice, with nothing of the section.
  {
    const notAvailable = (page) => waitFor(async () => { const v = await ownerDecisionView(page); return v.h1 === "No está disponible" ? v : null; }, 10000);
    const backend = ownerDecisionsBackend(html);
    backend.decisions[IDS.project] = decisionsFixture();
    const { context, page, errors } = await openMocked(browser, base, backend, detailHref(DKEY.a, IDS.project));
    let v = await notAvailable(page);
    check("owner-decisions-denied: a person who is not the project's owner, on a point's address, gets the not-available notice and nothing of the section",
      v && v.notices.length === 1 && v.notices[0] === "No encontramos esto entre lo que te compartieron. Puede que ya no esté disponible." && v.people.length === 0 && !v.decided,
      JSON.stringify(v));
    check("owner-decisions-denied: the page does not even ask owner_decisions for a project the person does not own, and records nothing",
      !decisionCalls(backend, "owner_decisions").some((c) => c.p_project_id === IDS.project) && !backend.decisionCalls.some((c) => OWNER_WRITES.includes(c.rpc)),
      JSON.stringify(backend.decisionCalls.map((c) => c.rpc)));
    for (const [key, what] of [[OKEY.removed, "a point no longer published"], ["0123456789ab", "a key that is not in the section"]]) {
      v = await goTo(page, detailHref(key), () => notAvailable(page));
      check(`owner-decisions-denied: ${what}, on the owner's own project, is not available`, v && v.notices.length === 1 && v.people.length === 0 &&
        v.back && v.back.href === `#/project/${IDS.ownedProject}`, JSON.stringify(v));
    }
    check("owner-decisions-denied: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
  {
    // Her membership says owner, but the server does not agree (42501).
    const backend = ownerDecisionsBackend(html);
    backend.members[0].role = "owner";
    const { context, page, errors } = await openMocked(browser, base, backend, detailHref(OKEY.trips, IDS.project));
    const v = await waitFor(async () => { const x = await ownerDecisionView(page); return x.h1 === "No está disponible" ? x : null; }, 10000);
    check("owner-decisions-denied: refused by owner_decisions (42501), the not-available notice", v && v.notices.length === 1 && v.people.length === 0 &&
      decisionCalls(backend, "owner_decisions").some((c) => c.p_project_id === IDS.project), JSON.stringify(v));
    check("owner-decisions-denied: refused: no page errors", errors.length === 0, errors.join(" | "));
    await context.close();
  }
}

const GEOMETRY_WIDTHS = [320, 672, 1056, 1440];
// The screens every run captures and measures: the sign-in steps, home (the projects, and empty), a project's page, an
// owned project's page with the owner's part (captured with --flow and --demo too), a project's page with a received
// piece, a replaced version that was sent and a change request (the piece closure), and the «Decisiones» screens
// (decisionsScreens).
const PORTAL_SCREENS = ["sign-in-email", "sign-in-code", "home-projects", "project-page", "home-empty", "project-owner", "project-received",
  "project-decisions", "project-decisions-errors", "project-decisions-only", "project-owner-decisions", "owner-decision"];
const GRID_CUTS = [320, 672, 1056, 1312, 1584];
// A screen's exceptions, by rule code, each with its reason in the rule's own words.
const GEOMETRY_EXCEPTIONS = {
  // Controller's ruling (design judges, round 4): FUN-43 lets an empty view that is «un vacío centrado con un mensaje
  // angosto» stay under 60 %; the ruling applies that intent to this empty view, which is start-aligned instead of centred.
  "home-empty": { "FUN-43": "vista vacía (todavía no hay proyectos): un mensaje angosto con su aviso y su salida justo debajo, "
    + "alineado al inicio como el resto del conjunto en vez de centrado; fallo del controlador que aplica la excepción del vacío "
    + "centrado de FUN-43 a un vacío alineado al inicio" },
};
// densidad (the lists at 1056 and up, FUN-43 «el grupo tabular como tabla»): every list row of a screen as laid out, its
// row box (the link or the entry, without its padding), and the text of its three parts: the title (a person's name with
// its «Ver lo que envió» in the owner's part), the meta line (people, dates) and the state or the aside. Text boxes are the
// text's own rects, never a padded box.
const LIST_SCREENS = ["home-projects", "project-page", "project-owner", "project-received"];
const listColumns = (page) => page.evaluate(() => {
  const textBox = (el) => {
    if (!el) return null;
    const rects = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      rects.push(...[...r.getClientRects()].filter((x) => x.width > 0));
    }
    return rects.length ? { x: Math.round(Math.min(...rects.map((x) => x.left))), der: Math.round(Math.max(...rects.map((x) => x.right))),
      top: Math.round(Math.min(...rects.map((x) => x.top))), bottom: Math.round(Math.max(...rects.map((x) => x.bottom))) } : null;
  };
  const boxOf = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), der: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
  return [...document.querySelectorAll("[data-rol=cuerpo] ul.rows > li.row")].map((li) => {
    const row = li.querySelector(":scope > .row-link, :scope > .row-item");
    const main = row && row.querySelector(":scope > .row-main");
    const state = row && row.querySelector(":scope > .row-aside, :scope > .status");
    const title = main && main.firstElementChild;
    return { text: title ? title.textContent : null, row: row ? boxOf(row) : null, gap: row ? Math.round(parseFloat(getComputedStyle(row).columnGap) || 0) : null,
      title: textBox(title),
      meta: textBox(main && main.querySelector(":scope > .row-meta")), state: state ? boxOf(state) : null };
  });
});
// From 1056 the rows are columns, title · meta · state, each column on the same x down every list of the screen, in that
// order and on one line, so the eye crosses the row in short steps: the row's width is shared in three equal columns, so
// the state starts two thirds into the row, not on its far edge. Below 1056 a row is as it was: at 672 the title on the row's left and the state on its right
// edge, the meta under the title; at 320, everything stacked on the title's edge (the owner's entries keep their two lines,
// checked in ownerViewChecks).
function listColumnChecks(name, width, scheme, rows) {
  const tag = `densidad: ${name} ${width}px ${scheme}`;
  const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;
  const same = (xs) => xs.length > 0 && xs.every((x) => near(x, xs[0]));
  const ok = rows.length > 0 && rows.every((r) => r.row && r.title && r.state);
  const detail = JSON.stringify(rows.map((r) => [r.text, r.row && [r.row.x, r.row.der], r.title && [r.title.x, r.title.der, r.title.top],
    r.meta && [r.meta.x, r.meta.der, r.meta.top], r.state && [r.state.x, r.state.der, r.state.top]]));
  if (width >= 1056) {
    const metas = rows.filter((r) => r.meta);
    // The columns are decided by the list: with a meta line in any row the list has three columns and every state falls on the
    // same x, a row without a meta line leaving that cell empty (a mixed list, like home with an owned project and another's);
    // with none, two equal columns, title · state.
    check(`${tag}: the rows are columns, title · meta · state, each column aligned down the list`, ok && same(rows.map((r) => r.title.x)) &&
      (!metas.length || same(metas.map((r) => r.meta.x))) && same(rows.map((r) => r.state.x)) &&
      rows.every((r) => near(r.title.x, r.row.x) && (!r.meta || r.meta.x > r.title.der) && r.state.x > (r.meta ? r.meta.der : r.title.der) &&
        r.state.top < r.title.bottom && (!r.meta || r.meta.top < r.title.bottom)), detail);
    // Equal columns: three when any row has a meta line (from the title to the meta, from the meta to the state and from the state
    // to the row's end, plus the gap, the same step: a third of the row and one gap), two when none has (the state half way in).
    const parts = metas.length ? 3 : 2;
    check(`${tag}: the row's width is shared in ${parts} equal columns, the state ${metas.length ? "two thirds" : "half way"} into the row, not on its far edge`, ok &&
      rows.every((r) => { const step = (r.row.der - r.row.x + r.gap) / parts;
        return Math.abs(r.state.x - r.title.x - step * (parts - 1)) <= 2 && Math.abs(r.row.der + r.gap - r.state.x - step) <= 2 &&
          (!r.meta || Math.abs(r.meta.x - r.title.x - step) <= 2); }),
      JSON.stringify({ parts, gap: rows[0] && rows[0].gap, rows: JSON.parse(detail) }));
  } else if (width >= 672) {
    check(`${tag}: as before the columns, the title on the row's left, the meta under it, the state on the row's right edge`, ok &&
      rows.every((r) => near(r.title.x, r.row.x) && near(r.state.der, r.row.der) && (!r.meta || (near(r.meta.x, r.row.x) && r.meta.top >= r.title.bottom - 1))), detail);
  } else if (name !== "project-owner") {
    check(`${tag}: as before the columns, the title, the meta and the state one under another on the title's edge`, ok &&
      rows.every((r) => near(r.title.x, r.row.x) && near(r.state.x, r.row.x) && r.state.top >= (r.meta || r.title).bottom - 1 &&
        (!r.meta || (near(r.meta.x, r.row.x) && r.meta.top >= r.title.bottom - 1))), detail);
  }
}
async function portalGeometryChecks(browser, base, html, factory) {
  const assets = join(resolve(factory), "design-system", "assets");
  const { MEDIR_GEOMETRIA, evaluaAncho, evaluaConjunto, revisaMedia } = await import(pathToFileURL(join(assets, "geometria.mjs")).href);
  const { widthInPortal } = await import(pathToFileURL(join(assets, "piece-host.mjs")).href);
  const passes = (r) => r.ok || Boolean(r.exceptuada);
  const named = (r) => `${r.regla} (${r.codigos.join(", ")}): ${r.detalle}`;
  const names = PORTAL_SCREENS;
  check(`geometry: the ${names.length} screens were captured`, names.every((n) => screens.has(n)), [...screens.keys()].join(", "));
  const server = await serveDir(screensDir);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const frames = {}; // `${width}-${scheme}` -> the frame's content box on home, the projects (the other screens' reference)
  try {
    for (const scheme of ["light", "dark"]) {
      const records = [], byScreen = new Map();
      for (const name of names.filter((n) => screens.has(n))) for (const width of GEOMETRY_WIDTHS) {
        const page = await browser.newPage({ viewport: { width, height: width < 672 ? 640 : 900 }, colorScheme: scheme });
        await page.goto(`${origin}/${name}.html`, { waitUntil: "networkidle" });
        await page.evaluate(() => document.fonts.ready);
        const m = await page.evaluate(MEDIR_GEOMETRIA, {});
        if (LIST_SCREENS.includes(name)) listColumnChecks(name, width, scheme, await listColumns(page));
        await page.close();
        records.push({ pantalla: name, recorrido: "portal", paso: 0, w: width, m });
        if (name === "home-projects" && m.contenedor) frames[`${width}-${scheme}`] = m.contenedor;
        byScreen.set(`${name}|${width}`, evaluaAncho(m, { patron: screens.get(name), angosto: false, admiteCompleto: false, marca: null,
          excepciones: GEOMETRY_EXCEPTIONS[name] || {} }));
      }
      const between = evaluaConjunto(records, { grupoDe: () => "portal", modelos: { portal: "home-projects" }, patronDe: (n) => screens.get(n),
        excepcionesDe: (n) => GEOMETRY_EXCEPTIONS[n] || {} });
      for (const r of between) byScreen.get(`${r.pantalla}|${r.w}`).push(r);
      for (const [key, rules] of byScreen) {
        const [name, width] = key.split("|");
        const failing = rules.filter((r) => !passes(r));
        const excepted = rules.filter((r) => !r.ok && r.exceptuada).map((r) => `${r.regla} exceptuada: ${r.exceptuada}`);
        check(`geometry: ${name} (${screens.get(name)}) ${width}px ${scheme}: the frame rules pass (${rules.length - failing.length}/${rules.length})`,
          failing.length === 0, [...failing.map(named), ...excepted].join(" | "));
      }
    }
  } finally { server.close(); }
  const css = Object.fromEntries(["css/portal.css", "brand/ninben-components.css"].map((f) => [f, readFileSync(join(root, f), "utf8")]));
  const media = revisaMedia(css, GRID_CUTS);
  const offGrid = media.filter((x) => !x.ok);
  check(`geometry: every @media of the portal's CSS is a cut of the grid (${GRID_CUTS.join(", ")})`, media.length > 0 && offGrid.length === 0,
    offGrid.map((x) => `${x.archivo}: @media ${x.condicion} — ${x.detalle}`).join("; "));

  // The piece screen: its frame (the brand's edge) where every other screen has it, at the page margin from both sides
  // from 672 (MAR-02, MAR-11); and the piece's iframe over the frame's box, margins included, as wide as widthInPortal.
  const near = (a, b) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1;
  const pieceScreens = [
    { name: "piece screen", backend: () => newBackend(html), hash: `#/piece/${IDS.questions}` },
    // The owner reading Luis's send of the questions, closed with observer.
    { name: "owner piece screen", backend: () => ownerViewBackend(html, null, null, {}), hash: ownerHref(IDS.ownedProject, OWNED.questions, PEOPLE.luis) },
  ];
  for (const screen of pieceScreens) for (const scheme of ["light", "dark"]) for (const width of [...GEOMETRY_WIDTHS, 1600]) {
    const tag = `geometry: ${screen.name} ${width}px ${scheme}`;
    const backend = screen.backend();
    const context = await mockedContext(browser, { backend, width, locale: "es-CO" });
    const page = await context.newPage();
    await page.setViewportSize({ width, height: width < 672 ? 640 : 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${base}/${screen.hash}`, { waitUntil: "networkidle" });
    await waitFor(async () => { const f = pieceFrame(page); return f && (await f.evaluate(() => typeof respondidas === "function").catch(() => false)); }, 10000);
    const box = await page.evaluate(() => {
      const frame = document.querySelector(".piece-layout > .frame"), iframe = document.querySelector("iframe.piece-frame");
      if (!frame || !iframe) return null;
      const f = frame.getBoundingClientRect(), cs = getComputedStyle(frame), i = iframe.getBoundingClientRect();
      return { vw: document.documentElement.clientWidth, margin: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--margin-page")),
        outer: { x: Math.round(f.left), der: Math.round(f.right) },
        content: { x: Math.round(f.left + parseFloat(cs.paddingLeft)), der: Math.round(f.right - parseFloat(cs.paddingRight)) },
        iframe: { x: Math.round(i.left), der: Math.round(i.right), width: iframe.clientWidth } };
    });
    await context.close();
    const expected = widthInPortal(width);
    check(`${tag}: the piece's iframe covers the frame's box, margins included, and is ${expected} px wide (piece-host.mjs widthInPortal)`,
      box && near(box.iframe.x, box.outer.x) && near(box.iframe.der, box.outer.der) && box.iframe.width === expected, JSON.stringify(box && { ...box.iframe, frame: box.outer }));
    if (width === 1600) {
      check(`${tag}: past its cap the frame is centred`, box && near(box.outer.x, box.vw - box.outer.der), JSON.stringify(box && box.outer));
      continue;
    }
    const home = frames[`${width}-${scheme}`];
    check(`${tag}: the frame is the other screens' (MAR-02)`, box && home && near(box.content.x, home.x) && near(box.content.der, home.der),
      JSON.stringify({ piece: box && box.content, home }));
    if (width >= 672) check(`${tag}: the same page margin on both sides (MAR-11)`, box && near(box.content.x, box.margin) && near(box.vw - box.content.der, box.margin),
      JSON.stringify(box && { left: box.content.x, right: box.vw - box.content.der, margin: box.margin }));
  }
}

const { chromium, webkit: webkitType } = loadPlaywright();
const { server, base } = await startServer();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const read = (path) => (path ? readFileSync(path, "utf8") : null);
try {
  if (!args["skip-portal"]) await portalChecks(browser, base);
  if (args.questions) await questionsChecks(browser, base, read(args.questions));
  if (args.flow) await flowChecks(browser, base, read(args.flow));
  if (args.demo) await demoChecks(browser, base, read(args.demo));
  if (args.questions) await projectPageChecks(browser, base, read(args.questions));
  if (args.questions && args.flow && args.demo) await ownerViewChecks(browser, base, read(args.questions), read(args.flow), read(args.demo));
  if (args.questions) await decisionsChecks(browser, base, read(args.questions));
  if (args.questions) await ownerDecisionsChecks(browser, base, read(args.questions));
  if (args.questions) await decisionsScreens(browser, base, read(args.questions));
  if (args.questions) await mockedAppChecks(browser, base, read(args.questions), read(args.flow), read(args.demo));
  if (args.questions) await sessionEndDraftChecks(browser, base, read(args.questions));
  if (args.questions) await tooLargeAppChecks(browser, base, read(args.questions));
  if (args.questions) await sessionReturnsChecks(browser, base, read(args.questions));
  if (args.questions) await pieceViewChecks(browser, base, read(args.questions), read(args.flow), read(args.demo));
  if (args.questions) await phoneFrameChecks(browser, "chromium", base, read(args.questions), read(args.flow));
  if (args.questions) {
    // WebKit only when playwright-core has its build installed (npx playwright install webkit); without it, a note.
    let webkit = null;
    try { webkit = await webkitType.launch({ headless: true }); } catch (error) {
      console.log(`NOTE  phone checks: WebKit is not installed for playwright-core, they ran in Chromium only (${String(error).split("\n")[0]})`);
    }
    if (webkit) { try { await phoneFrameChecks(webkit, "webkit", base, read(args.questions), read(args.flow)); } finally { await webkit.close(); } }
  }
  if (args.questions) await sentLineChecks(browser, base, read(args.questions));
  if (args.questions && args.demo) await demoAppChecks(browser, base, read(args.questions), read(args.flow), read(args.demo));
  if (args.questions && args.demo) await replacedAppChecks(browser, base, read(args.questions), read(args.flow), read(args.demo));
  if (args.questions) await closureChecks(browser, base, read(args.questions));
  if (args.questions && args.factory) await portalGeometryChecks(browser, base, read(args.questions), args.factory);
} finally {
  await browser.close();
  server.close();
}
// Every snapshot through the factory's verifier, at the three review widths, light and dark.
if (args.factory) {
  const verifier = join(resolve(args.factory), "design-system", "assets", "verifica-pantalla.mjs");
  if (!existsSync(verifier)) check("manual: verifica-pantalla.mjs found", false, verifier);
  else {
    check(`manual: the ${PORTAL_SCREENS.length} screens were captured`, PORTAL_SCREENS.every((n) => screens.has(n)), [...screens.keys()].join(", "));
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
