#!/usr/bin/env node
// Copies the ninben brand from the software factory repo into brand/ (next to this script's folder).
// The factory keeps the single source in design-system/assets/brand/: ninben.css (tokens and
// @font-face with url("fonts/<file>")), ninben-components.css (the scale tokens, the frame and the
// shared components; self-contained: no @import, no url()), logo.svg and fonts/* (the woff2 files and
// their licences).
// brand/ is generated: never edit it by hand, run --write again.
//
//   node scripts/sync-brand.mjs --from <factory repo> --write   copy what differs, remove stale files
//   node scripts/sync-brand.mjs --from <factory repo> --check   compare only
//
// Exit codes: 0 the copy matches (after --write, or on --check); 1 (--check) something differs, each
// file is named; 2 bad usage, or a source that is missing or broken (nothing is written then).
// Every source file is read and validated before the first write, and each write is atomic (temp file
// in the same folder, then rename), so a failure never leaves a half-written file. Dotfiles (.DS_Store,
// leftover temp files) are ignored on both sides.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const USAGE = "usage: node scripts/sync-brand.mjs --from <factory repo> (--write | --check)";
const TARGET = resolve(dirname(fileURLToPath(import.meta.url)), "..", "brand");
const FONT_URL = /url\(\s*["']?fonts\/([^"')]+)["']?\s*\)/g;

class UsageError extends Error {}

function parseArgs(argv) {
  let from = null;
  const modes = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--from") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) throw new UsageError("--from needs the factory repo path");
      if (from !== null) throw new UsageError("--from given twice");
      from = value;
      i += 1;
    } else if (arg === "--write" || arg === "--check") {
      modes.push(arg.slice(2));
    } else {
      throw new UsageError(`unknown argument ${JSON.stringify(arg)}`);
    }
  }
  if (from === null) throw new UsageError("--from is required");
  if (modes.length !== 1) throw new UsageError("give exactly one of --write or --check");
  return { from, mode: modes[0] };
}

const visible = (name) => !name.startsWith(".");

// Every regular file under dir, as paths relative to it with "/" separators.
function listFiles(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!visible(entry.name)) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

// The brand files, read into memory: ninben.css, ninben-components.css, logo.svg and fonts/*. Throws
// UsageError if broken.
function readSource(from) {
  const source = join(resolve(from), "design-system", "assets", "brand");
  const need = (path, what) => {
    if (!existsSync(path)) throw new UsageError(`${what} not found: ${path}`);
  };
  need(join(source, "ninben.css"), "ninben.css");
  need(join(source, "ninben-components.css"), "ninben-components.css");
  need(join(source, "logo.svg"), "logo.svg");
  need(join(source, "fonts"), "fonts folder");
  if (!statSync(join(source, "fonts")).isDirectory()) throw new UsageError(`not a folder: ${join(source, "fonts")}`);

  const files = new Map();
  files.set("ninben.css", readFileSync(join(source, "ninben.css")));
  files.set("ninben-components.css", readFileSync(join(source, "ninben-components.css")));
  files.set("logo.svg", readFileSync(join(source, "logo.svg")));
  for (const rel of listFiles(join(source, "fonts"))) files.set(`fonts/${rel}`, readFileSync(join(source, "fonts", ...rel.split("/"))));

  const css = files.get("ninben.css").toString("utf8");
  for (const [, font] of css.matchAll(FONT_URL)) {
    if (!files.has(`fonts/${font}`)) throw new UsageError(`ninben.css names fonts/${font}, which is not in ${join(source, "fonts")}`);
  }
  // The components must not ask the network (or a sibling file) for anything, as in the factory's sync-brand.py.
  const components = files.get("ninben-components.css").toString("utf8");
  const where = join(source, "ninben-components.css");
  if (!components.trim()) throw new UsageError(`${where}: the components source is empty`);
  for (const [pattern, what] of [[/@import/i, "@import"], [/url\(/i, "url()"]]) {
    if (pattern.test(components)) throw new UsageError(`${where}: ${what} is not allowed (the components must be self-contained)`);
  }
  const svg = files.get("logo.svg").toString("utf8").trim();
  if (!svg.startsWith("<svg") || !svg.endsWith("</svg>")) throw new UsageError(`${join(source, "logo.svg")}: expected a single <svg>…</svg> element`);
  return files;
}

// What differs between the source files and brand/: missing, changed and extra (stale) files.
function compare(files) {
  if (existsSync(TARGET) && !statSync(TARGET).isDirectory()) throw new UsageError(`${TARGET} exists and is not a folder`);
  const present = existsSync(TARGET) ? new Set(listFiles(TARGET)) : new Set();
  const missing = [], changed = [];
  for (const [rel, bytes] of files) {
    if (!present.has(rel)) missing.push(rel);
    else if (!readFileSync(join(TARGET, ...rel.split("/"))).equals(bytes)) changed.push(rel);
  }
  const extra = [...present].filter((rel) => !files.has(rel));
  return { missing, changed, extra };
}

function writeAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temp = join(dirname(path), `.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(temp, bytes);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function main() {
  let args, files, diff;
  try {
    args = parseArgs(process.argv.slice(2));
    files = readSource(args.from);
    diff = compare(files);
  } catch (error) {
    console.error(error instanceof UsageError ? `sync-brand: ${error.message}\n${USAGE}` : `sync-brand: ${error.message}`);
    return 2;
  }
  const show = (rel) => `brand/${rel}`;
  const count = diff.missing.length + diff.changed.length + diff.extra.length;
  if (count === 0) {
    console.log(`sync-brand: brand/ is up to date (${files.size} files)`);
    return 0;
  }
  if (args.mode === "check") {
    for (const rel of diff.missing) console.log(`missing  ${show(rel)}`);
    for (const rel of diff.changed) console.log(`differs  ${show(rel)}`);
    for (const rel of diff.extra) console.log(`extra    ${show(rel)}`);
    console.log(`sync-brand: ${count} difference(s); run with --write`);
    return 1;
  }
  try {
    for (const rel of [...diff.missing, ...diff.changed]) {
      writeAtomic(join(TARGET, ...rel.split("/")), files.get(rel));
      console.log(`wrote    ${show(rel)}`);
    }
    for (const rel of diff.extra) {
      const path = join(TARGET, ...rel.split("/"));
      if (!resolve(path).startsWith(TARGET + sep)) throw new Error(`refusing to remove ${path}`);
      rmSync(path);
      console.log(`removed  ${show(rel)}`);
    }
  } catch (error) {
    console.error(`sync-brand: ${error.message}`);
    return 2;
  }
  console.log(`sync-brand: brand/ updated from ${relative(process.cwd(), resolve(args.from)) || "."}`);
  return 0;
}

process.exit(main());
