// scripts/sync-brand.mjs copies the ninben brand from the factory repo into brand/. Each test runs a
// copy of the script inside a temporary "portal" (so it writes there, never into this repo), against a
// temporary "factory" source. Both paths contain spaces on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const SCRIPT = new URL("../../scripts/sync-brand.mjs", import.meta.url);

function setup() {
  const base = mkdtempSync(join(os.tmpdir(), "sync brand "));
  const factory = join(base, "fake factory");
  const source = join(factory, "design-system", "assets", "brand");
  mkdirSync(join(source, "fonts"), { recursive: true });
  writeFileSync(join(source, "ninben.css"), '@font-face { font-family: "Inter"; src: url("fonts/Inter-latin.woff2") format("woff2"); }\n:root { --signal: #4137FF; }\n');
  writeFileSync(join(source, "logo.svg"), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M15 3 L6.5 12.5"/></svg>\n');
  writeFileSync(join(source, "ninben-components.css"), ":root { --space-1: 4px; }\n.notice { border-radius: var(--radius); }\n");
  writeFileSync(join(source, "fonts", "Inter-latin.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]));
  writeFileSync(join(source, "fonts", "OFL-Inter.txt"), "SIL Open Font License\n");
  // sync-brand.py lives next to the brand in the factory: it is a tool, not part of the brand.
  writeFileSync(join(source, "sync-brand.py"), "print('not copied')\n");
  const portal = join(base, "portal copy");
  mkdirSync(join(portal, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(portal, "scripts", "sync-brand.mjs"));
  return { base, factory, source, portal, brand: join(portal, "brand") };
}

function run(env, ...args) {
  const r = spawnSync(process.execPath, [join(env.portal, "scripts", "sync-brand.mjs"), ...args], { encoding: "utf8" });
  return { code: r.status, out: r.stdout + r.stderr };
}

test("--check without a copy fails (1) and names what is missing", () => {
  const env = setup();
  try {
    const r = run(env, "--from", env.factory, "--check");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /ninben\.css/);
    assert.match(r.out, /brand\/ninben-components\.css/);
    assert.match(r.out, /fonts\/Inter-latin\.woff2/);
    assert.equal(existsSync(env.brand), false, "--check never writes");
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test("--write copies ninben.css, ninben-components.css, logo.svg and every font file; then --check passes; a second --write changes nothing", () => {
  const env = setup();
  try {
    const w = run(env, "--from", env.factory, "--write");
    assert.equal(w.code, 0, w.out);
    for (const file of ["ninben.css", "ninben-components.css", "logo.svg", "fonts/Inter-latin.woff2", "fonts/OFL-Inter.txt"]) {
      assert.deepEqual(readFileSync(join(env.brand, file)), readFileSync(join(env.source, file)), file);
    }
    assert.equal(existsSync(join(env.brand, "sync-brand.py")), false, "the factory's script is not part of the brand");
    assert.equal(run(env, "--from", env.factory, "--check").code, 0);
    const again = run(env, "--from", env.factory, "--write");
    assert.equal(again.code, 0, again.out);
    assert.match(again.out, /up to date/);
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test("a changed copy or a stale extra file fails --check (1); --write restores the copy and removes the extra", () => {
  const env = setup();
  try {
    assert.equal(run(env, "--from", env.factory, "--write").code, 0);
    writeFileSync(join(env.brand, "logo.svg"), "<svg>edited by hand</svg>");
    writeFileSync(join(env.brand, "fonts", "Old-font.woff2"), "old");
    const c = run(env, "--from", env.factory, "--check");
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /logo\.svg/);
    assert.match(c.out, /fonts\/Old-font\.woff2/);
    assert.equal(run(env, "--from", env.factory, "--write").code, 0);
    assert.deepEqual(readFileSync(join(env.brand, "logo.svg")), readFileSync(join(env.source, "logo.svg")));
    assert.equal(existsSync(join(env.brand, "fonts", "Old-font.woff2")), false);
    assert.equal(run(env, "--from", env.factory, "--check").code, 0);
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test("bad usage exits 2 and writes nothing", () => {
  const env = setup();
  try {
    for (const args of [[], ["--write"], ["--from", env.factory], ["--from", env.factory, "--write", "--check"],
      ["--from"], ["--from", env.factory, "--write", "--to", "x"], ["--from", join(env.base, "nowhere"), "--write"]]) {
      const r = run(env, ...args);
      assert.equal(r.code, 2, `${JSON.stringify(args)}: ${r.out}`);
    }
    assert.equal(existsSync(env.brand), false);
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test("a broken source (a font the CSS names is missing, or logo.svg is gone) exits 2 before writing anything", () => {
  const env = setup();
  try {
    rmSync(join(env.source, "fonts", "Inter-latin.woff2"));
    const r = run(env, "--from", env.factory, "--write");
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /Inter-latin\.woff2/);
    assert.equal(existsSync(env.brand), false);
    writeFileSync(join(env.source, "fonts", "Inter-latin.woff2"), "x");
    rmSync(join(env.source, "logo.svg"));
    assert.equal(run(env, "--from", env.factory, "--check").code, 2);
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test("a source without ninben-components.css exits 2 and names it; nothing is written", () => {
  const env = setup();
  try {
    rmSync(join(env.source, "ninben-components.css"));
    for (const mode of ["--check", "--write"]) {
      const r = run(env, "--from", env.factory, mode);
      assert.equal(r.code, 2, `${mode}: ${r.out}`);
      assert.match(r.out, /ninben-components\.css/);
    }
    assert.equal(existsSync(env.brand), false);
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test("a copy made before the base existed (no brand/ninben-components.css) fails --check (1); --write adds it", () => {
  const env = setup();
  try {
    assert.equal(run(env, "--from", env.factory, "--write").code, 0);
    rmSync(join(env.brand, "ninben-components.css"));
    const c = run(env, "--from", env.factory, "--check");
    assert.equal(c.code, 1, c.out);
    assert.match(c.out, /missing\s+brand\/ninben-components\.css/);
    assert.equal(run(env, "--from", env.factory, "--write").code, 0);
    assert.deepEqual(readFileSync(join(env.brand, "ninben-components.css")), readFileSync(join(env.source, "ninben-components.css")));
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});

test("ninben-components.css that is empty or asks for anything (@import, url()) exits 2 before writing anything", () => {
  const env = setup();
  try {
    for (const css of ["  \n", '@import "other.css";\n.notice { color: red; }\n', ".notice { background: URL(\"x.png\"); }\n"]) {
      writeFileSync(join(env.source, "ninben-components.css"), css);
      const r = run(env, "--from", env.factory, "--write");
      assert.equal(r.code, 2, `${JSON.stringify(css)}: ${r.out}`);
      assert.match(r.out, /ninben-components\.css/);
      assert.equal(existsSync(env.brand), false, JSON.stringify(css));
    }
  } finally { rmSync(env.base, { recursive: true, force: true }); }
});
