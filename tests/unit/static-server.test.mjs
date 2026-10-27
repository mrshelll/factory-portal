// tests/browser/static-server.mjs serves the portal to the browser checks. It has to take the suite's parallel load
// without resetting a connection, answer with the right content types, and never read outside its folder. The
// temporary root has a space in its path on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { join } from "node:path";
import os from "node:os";
import { serveDir } from "../browser/static-server.mjs";

const SERVER = new URL("../browser/static-server.mjs", import.meta.url);

async function withServer(fn) {
  const base = mkdtempSync(join(os.tmpdir(), "static server "));
  const root = join(base, "the root");
  mkdirSync(join(root, "css"), { recursive: true });
  mkdirSync(join(root, "sub dir"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<!doctype html><title>home</title>\n");
  writeFileSync(join(root, "css", "portal.css"), "body { margin: 0; }\n");
  writeFileSync(join(root, "sub dir", "index.html"), "<p>sub</p>\n");
  writeFileSync(join(root, "sub dir", "a b.js"), "export {};\n");
  writeFileSync(join(base, "secret.txt"), "outside the root\n");
  const server = await serveDir(root);
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(origin);
  } finally {
    await new Promise((done) => server.close(done));
    rmSync(base, { recursive: true, force: true });
  }
}

// A raw request, so the path reaches the server as written (fetch would resolve "..").
function raw(origin, path, method = "GET") {
  const { hostname, port } = new URL(origin);
  return new Promise((done, fail) => {
    const req = request({ hostname, port, path, method }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => done({ status: res.statusCode, type: res.headers["content-type"], body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", fail);
    req.end();
  });
}

test("binds 127.0.0.1 on a free port", () => withServer(async (origin) => {
  const { hostname, port } = new URL(origin);
  assert.equal(hostname, "127.0.0.1");
  assert.ok(Number(port) > 0);
}));

test("serves index.html for / and for a folder, and a file by its path", () => withServer(async (origin) => {
  const home = await fetch(`${origin}/`);
  assert.equal(home.status, 200);
  assert.equal(home.headers.get("content-type"), "text/html; charset=utf-8");
  assert.match(await home.text(), /<title>home<\/title>/);
  const css = await fetch(`${origin}/css/portal.css?v=1#x`);
  assert.equal(css.status, 200);
  assert.equal(css.headers.get("content-type"), "text/css; charset=utf-8");
  assert.equal(await css.text(), "body { margin: 0; }\n");
  const sub = await fetch(`${origin}/sub%20dir/`);
  assert.equal(sub.status, 200);
  assert.equal(await sub.text(), "<p>sub</p>\n");
}));

test("decodes spaces in the path and types JavaScript as such", () => withServer(async (origin) => {
  const js = await fetch(`${origin}/sub%20dir/a%20b.js`);
  assert.equal(js.status, 200);
  assert.equal(js.headers.get("content-type"), "text/javascript; charset=utf-8");
}));

test("answers 404 for a missing file and for a malformed path, and keeps serving", () => withServer(async (origin) => {
  assert.equal((await fetch(`${origin}/nope.html`)).status, 404);
  assert.equal((await fetch(`${origin}/css/`)).status, 404); // a folder without index.html: no listing
  assert.equal((await raw(origin, "/%E0%A4%A")).status, 404);
  assert.equal((await raw(origin, "/a%00b")).status, 404);
  assert.equal((await fetch(`${origin}/`)).status, 200);
}));

test("never serves a file outside its folder", () => withServer(async (origin) => {
  for (const path of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/css/..%2f..%2fsecret.txt", "/%2e%2e%5csecret.txt"]) {
    const res = await raw(origin, path);
    assert.notEqual(res.status, 200, path);
    assert.doesNotMatch(res.body, /outside the root/, path);
  }
}));

test("HEAD answers without a body; other methods are refused", () => withServer(async (origin) => {
  const head = await raw(origin, "/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal((await raw(origin, "/", "POST")).status, 405);
}));

// The server runs in its own process, as it does for Chrome: in this process the 200 connects would all be queued before
// the server gets a turn to accept them, and macOS caps that queue at 128 (kern.ipc.somaxconn).
test("takes 40 and 200 parallel requests from another process without an error", async () => {
  const root = mkdtempSync(join(os.tmpdir(), "static server child "));
  writeFileSync(join(root, "index.html"), "<p>home</p>\n");
  mkdirSync(join(root, "css"));
  writeFileSync(join(root, "css", "portal.css"), "body { margin: 0; }\n");
  const child = spawn(process.execPath, ["--input-type=module", "-e",
    `const { serveDir } = await import(${JSON.stringify(SERVER.href)}); const s = await serveDir(process.argv[1]); console.log(s.address().port);`, root],
    { stdio: ["ignore", "pipe", "inherit"] });
  try {
    const [line] = await once(child.stdout, "data");
    const origin = `http://127.0.0.1:${String(line).trim()}`;
    const paths = ["/", "/css/portal.css", "/nope.html"];
    for (const n of [40, 200]) {
      const results = await Promise.allSettled(Array.from({ length: n }, (_, i) =>
        fetch(`${origin}${paths[i % paths.length]}`).then(async (r) => { await r.arrayBuffer(); return r.status; })));
      const failed = results.filter((r) => r.status === "rejected").map((r) => String(r.reason?.cause?.code || r.reason));
      assert.deepEqual(failed, [], `${n} parallel`);
      assert.deepEqual([...new Set(results.map((r) => r.value))].sort(), [200, 404], `${n} parallel`);
    }
  } finally {
    child.kill();
    rmSync(root, { recursive: true, force: true });
  }
});
