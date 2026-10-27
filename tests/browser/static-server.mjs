// A static file server for the browser checks, on 127.0.0.1 and a free port. Dev-only; nothing here is served to users.
// It takes the suite's parallel load (python3 -m http.server reset most of 40 parallel requests), types the files the
// portal and the emitted pieces use, serves index.html for a folder, answers 404 for anything missing and never reads
// outside `dir`.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const isFile = (path) => stat(path).then((s) => s.isFile(), () => false);

// The file `urlPath` names inside `dir`, or null: a malformed or escaping path, a missing file, a folder without index.html.
async function fileFor(dir, urlPath) {
  let path;
  try { path = normalize(join(dir, decodeURIComponent(urlPath))); } catch { return null; }
  if (path.includes("\0") || (path !== dir && !path.startsWith(dir + sep))) return null;
  if (await isFile(path)) return path;
  const index = join(path, "index.html");
  return (await stat(path).then((s) => s.isDirectory(), () => false)) && (await isFile(index)) ? index : null;
}

// Resolves to the listening http.Server; its port is server.address().port. Close it with server.close().
export function serveDir(folder) {
  const dir = resolve(folder);
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405, { allow: "GET, HEAD" }); res.end(); return; }
      const path = await fileFor(dir, new URL(req.url, "http://x").pathname);
      if (!path) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); res.end("not found\n"); return; }
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path).toLowerCase()] || "application/octet-stream",
        "content-length": body.length, "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => { server.off("error", fail); done(server); });
  });
}
