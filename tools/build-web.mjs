#!/usr/bin/env node
// BUILD THE SERVED COPY — mirror the browser-facing tree into `_site/` with
// every comment removed, leaving the source tree untouched.
//
//   node tools/build-web.mjs          build _site/
//   npm run build:web                 the same thing
//
// WHY A BUILD STEP RATHER THAN AN IN-PLACE STRIP
//
// This repo is ~45% comments by line, on purpose. The GML citations, the
// `ORIGINAL BUG:` markers and the "this was tried and reverted" notes in
// `sim/`, `render/` and `input/` are the most valuable thing in the
// project — CLAUDE.md asks for them explicitly, and every one of them is a
// fact about the real game that was expensive to learn. They must NEVER be
// deleted from source.
//
// They are also shipped verbatim to anyone who opens DevTools, where they are
// only noise, and in `sim/` they amount to most of the bytes on the wire. So
// the split is: SOURCE KEEPS EVERY COMMENT, THE SERVED COPY KEEPS NONE. The
// sibling repos solve this by stripping the vendored copy after it is copied;
// this repo is served from its own tree, so the copy has to be made here.
//
// The output directory is gitignored and rebuilt from scratch every run, which
// makes the pass idempotent by construction: strip(copy(source)) is the same
// bytes every time, and nothing about the source can drift.
//
// THIS SCRIPT DOES NOT DEPLOY ANYTHING. `.github/workflows/ci.yml` records that
// the old `pages.yml` — which built and published a `_site` from here — was
// DELETED rather than disabled, so that nothing could quietly start publishing
// again. That posture is unchanged. This is a local build: it writes a
// directory and stops. Wiring it to a host is a separate, deliberate decision.
//
// WHERE THE STRIPPER CAME FROM
//
// `tools/strip-comments.mjs` is a BYTE-IDENTICAL copy of
// `thedevice/tools/strip-comments.mjs` — a verified character scanner, not a
// regex, with 27 adversarial tests that ship alongside it in
// `tools/test-strip-comments.mjs` (`node tools/test-strip-comments.mjs`). It is
// copied rather than imported across repos on purpose: CI checks out THIS repo
// alone, so a `../../thedevice/...` import would fail on every runner and on
// every fresh clone. Because the copy is byte-identical, drift is one command:
//
//   cmp tools/strip-comments.mjs ../thedevice/tools/strip-comments.mjs
//
// Do not edit either copy here, and do not write a second stripper. `//` occurs
// inside strings, URLs and regex literals all over this codebase; a regex that
// looks right will silently eat code somewhere in 1,500 files.
//
// SAFETY POSTURE — a stripper may not be its own witness
//
// Nothing is written stripped until the result has been checked by something
// other than the stripper that produced it:
//
//   .js/.mjs   `node --check` on a temp copy with a `.mjs` extension. The
//              extension matters: `node --check foo.js` parses as CommonJS and
//              rejects `import`, which would fail every module in this repo.
//              The ORIGINAL is checked first, so a file that did not parse
//              before can never be blamed on this tool.
//   .html      `<script`/`</script`/`<style`/`</style`/`<div` counts must be
//              unchanged, and every inline script body that parsed before must
//              still parse after.
//   .css       brace counts must be unchanged.
//
// A file that fails any check is copied VERBATIM instead — the served copy
// keeps its comments rather than being served broken — and the run exits
// non-zero so a build failure is loud instead of silent.
//
// AND THEN THE REAL PROOF. The checks above only say the output still parses.
// What actually matters is that it still BEHAVES, bit for bit. That is proven
// the way everything in this repo is proven — with a trace diff:
//
//   node tools/build-web.mjs
//   # trace the same seed/frames/scene through sim/ and through _site/sim/
//   # and diff them with tools/diff-trace.mjs; the CSVs must be identical.
//
// See docs/BUILD.md for the exact commands. If those traces ever differ, the
// stripper has a bug — fix the stripper, do not work around it here.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripByExt } from './strip-comments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

// THE SERVED SET. `web/` is the page and its entry module; the rest is
// everything that module reaches — the same five directories the hub's
// vendor script copies. Directory layout is mirrored exactly, because every
// import in here is relative (`../sim/`, `../../sim/`) and flattening would
// break all of them. (The kaizo recreation used to be a second page here; it
// lives in its own repo since 2026-09-02 and builds its own tree.)
const SERVED = ['web', 'sim', 'render', 'input', 'assets'];

// Text a browser is handed and a human can read in DevTools. Everything else —
// sprites, audio, fonts, .json data — is copied byte for byte.
const STRIP_EXT = new Set(['.js', '.mjs', '.css', '.html', '.htm']);

// Never descend into these. `tools/` is verification machinery that no
// browser ever requests; `oracle/` is captured ground truth from the real
// game, where a `//` is content and not a comment.
const SKIP_DIRS = new Set(['tools', 'oracle', 'node_modules', '.git', 'traces']);

// Notes and dotfiles are not served either, and shipping them just leaks the
// working notes into the build.
const skipFile = (name) => name.startsWith('.') || name.toLowerCase().endsWith('.md');

function parseArgs(argv) {
  const opts = { out: path.join(REPO_ROOT, '_site'), dryRun: false, json: false, check: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-check') opts.check = false;
    else if (a === '--out') opts.out = path.resolve(argv[++i]);
    else if (a.startsWith('--out=')) opts.out = path.resolve(a.slice(6));
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`build-web: unknown argument ${a}`); process.exit(2); }
  }
  return opts;
}

function printHelp() {
  console.log(`build-web.mjs -- mirror the served tree into _site/ with comments stripped

  --out <dir>    output directory (default: <repo>/_site)
  --dry-run, -n  report what would be written; write nothing
  --no-check     skip the per-file syntax verification (NOT recommended)
  --json         print a machine-readable summary after the report
  --help, -h     this text

Served set: ${SERVED.join(', ')}
Stripped:   ${[...STRIP_EXT].join(', ')} -- everything else is copied byte for byte
Source is never modified.`);
}

// ---- independent verification -------------------------------------------

// One temp dir per run. `node --check` needs a real file on disk, and the
// extension has to be `.mjs` or the parser uses the CommonJS goal.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'knight-build-'));
let tmpSeq = 0;

function parses(source) {
  const file = path.join(TMP, `check-${tmpSeq++}.mjs`);
  fs.writeFileSync(file, source, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return { ok: true, error: null };
  } catch (err) {
    const text = String(err.stderr || err.message || '').trim().split('\n').slice(0, 4).join(' | ');
    return { ok: false, error: text };
  } finally {
    try { fs.unlinkSync(file); } catch { /* best effort */ }
  }
}

const countTag = (html, tag) => (html.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length;
const countClose = (html, tag) => (html.match(new RegExp(`</${tag}\\b`, 'gi')) || []).length;
const countChar = (text, ch) => {
  let n = 0;
  for (const c of text) if (c === ch) n++;
  return n;
};

// Inline script bodies, minus external `src=` scripts (empty bodies) and JSON
// payloads (data, never parsed as code -- the stripper leaves those alone).
function inlineScripts(html) {
  const bodies = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["']?(application\/json|application\/ld\+json)/i.test(attrs)) continue;
    if (m[2].trim() === '') continue;
    bodies.push(m[2]);
  }
  return bodies;
}

// Returns { ok, checks, error }. `checks` is what can honestly be claimed for
// this file, so the report states it rather than implying it.
function verify(ext, before, after) {
  if (ext === '.js' || ext === '.mjs') {
    const was = parses(before);
    if (!was.ok) return { ok: false, checks: [], error: `original does not parse; refusing to strip (${was.error})` };
    const now = parses(after);
    if (!now.ok) return { ok: false, checks: [], error: `node --check failed after stripping: ${now.error}` };
    return { ok: true, checks: ['node --check'], error: null };
  }

  if (ext === '.html' || ext === '.htm') {
    for (const tag of ['script', 'style', 'div']) {
      if (countTag(before, tag) !== countTag(after, tag)) {
        return { ok: false, checks: [], error: `<${tag}> count changed (${countTag(before, tag)} -> ${countTag(after, tag)})` };
      }
    }
    for (const tag of ['script', 'style']) {
      if (countClose(before, tag) !== countClose(after, tag)) {
        return { ok: false, checks: [], error: `</${tag}> count changed` };
      }
    }
    const wasBodies = inlineScripts(before);
    const nowBodies = inlineScripts(after);
    if (wasBodies.length !== nowBodies.length) {
      return { ok: false, checks: [], error: `inline script count changed (${wasBodies.length} -> ${nowBodies.length})` };
    }
    for (let i = 0; i < nowBodies.length; i++) {
      if (!parses(wasBodies[i]).ok) continue; // not ours to break
      const now = parses(nowBodies[i]);
      if (!now.ok) return { ok: false, checks: [], error: `inline script #${i + 1} no longer parses: ${now.error}` };
    }
    const checks = ['tag counts'];
    if (nowBodies.length) checks.push(`${nowBodies.length} inline script(s) node --check`);
    return { ok: true, checks, error: null };
  }

  if (ext === '.css') {
    for (const ch of ['{', '}']) {
      if (countChar(before, ch) !== countChar(after, ch)) {
        return { ok: false, checks: [], error: `'${ch}' count changed` };
      }
    }
    return { ok: true, checks: ['brace counts'], error: null };
  }

  return { ok: true, checks: [], error: null };
}

// ---- the build -----------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));

// Refuse to point the output at anything but a dedicated directory. This
// deletes its target before writing, and a mistyped --out should not be able to
// take the source tree with it.
if (opts.out === REPO_ROOT || SERVED.some((d) => opts.out === path.join(REPO_ROOT, d))) {
  console.error(`build-web: refusing to build into ${opts.out} -- that is source`);
  process.exit(2);
}

const stats = {
  out: opts.out,
  copied: 0,
  stripped: 0,
  unchanged: 0,
  gated: 0,
  bytesIn: 0,
  bytesOut: 0,
  linesIn: 0,
  linesOut: 0,
};
const failures = [];

// ---- the publish gate ----------------------------------------------------
//
// `_site/` IS THE DIRECTORY SOMEONE WOULD UPLOAD. So it has to answer the same
// question the repo already answers: is this file allowed to leave the machine?
//
// It is, and the answer is already written down — in git. `.gitignore` is
// what keeps extracted game data and any art that may not be redistributed
// out of the public tree (the kaizo lane's 446 gated mod sprites were the
// case that made this a gate). A build that mirrors the tree blindly walks
// straight through it.
//
// So the gate is consulted rather than reimplemented: git is asked, once, which
// of the candidate files it refuses to track, and those are withheld. Encoding
// the list here instead would be a second copy of a policy that already exists,
// and second copies go stale exactly when it matters.
//
// Withholding these is not a degradation. Those files are gitignored, so a
// fresh clone does not have them either, and the renderer's documented fallback
// covers it: "any entity whose sprite is missing draws from its COLLISION MASK
// instead" (CLAUDE.md, Sprites).
//
// If git is not available the build STOPS rather than guessing. A publish gate
// that fails open is not a gate.
function gatedSet(relPaths) {
  if (!relPaths.length) return new Set();
  try {
    const out = execFileSync('git', ['check-ignore', '--stdin'], {
      cwd: REPO_ROOT,
      input: relPaths.join('\n'),
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return new Set(out.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch (err) {
    // exit 1 means "nothing matched", which is a legitimate empty answer.
    if (err.status === 1) return new Set(String(err.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean));
    console.error('build-web: could not consult git for the publish gate.');
    console.error('  .gitignore is what keeps unpublishable files out of the tree;');
    console.error('  refusing to build one that might carry them. Install git, or');
    console.error('  build with an explicit --out and review the result by hand.');
    console.error(`  git said: ${String(err.stderr || err.message).trim().split('\n')[0]}`);
    process.exit(3);
  }
}

// Everything the walk would otherwise write, gathered first so git is asked once.
function collect(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(p, out);
    } else if (entry.isFile() && !skipFile(entry.name)) {
      out.push(path.relative(REPO_ROOT, p).split(path.sep).join('/'));
    }
  }
  return out;
}

const candidates = [];
for (const dir of SERVED) {
  const src = path.join(REPO_ROOT, dir);
  if (fs.existsSync(src)) collect(src, candidates);
}
const GATED = gatedSet(candidates);

const lineCount = (s) => s.split('\n').length;

// CARRY THE SOURCE MTIME ONTO EVERY MIRRORED FILE.
//
// Not cosmetic. `tools/verify-fullfight.mjs` refuses a cached sim trace older
// than the newest `.js` under `sim/` — a stale trace is not evidence — and a
// plain copy stamps every file with the time of the BUILD, which makes the
// whole tree look freshly edited and turns that suite red for a reason that has
// nothing to do with the code. A mirror should be faithful in its metadata as
// well as its bytes: `_site/sim/knight.js` is derived from a specific revision
// of `sim/knight.js` and should date from it.
//
// It also makes the build idempotent as the filesystem sees it: two runs over
// an unchanged source tree produce identical content AND identical timestamps.
function stampFrom(src, dst) {
  const st = fs.statSync(src);
  fs.utimesSync(dst, st.atime, st.mtime);
}

function build(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      build(src, dst);
      continue;
    }
    if (!entry.isFile()) continue;
    if (skipFile(entry.name)) continue;

    const ext = path.extname(entry.name).toLowerCase();
    const rel = path.relative(REPO_ROOT, src).split(path.sep).join('/');

    if (GATED.has(rel)) { stats.gated++; continue; }

    if (!STRIP_EXT.has(ext)) {
      if (!opts.dryRun) { fs.copyFileSync(src, dst); stampFrom(src, dst); }
      stats.copied++;
      continue;
    }

    const before = fs.readFileSync(src, 'utf8');
    let after;
    try {
      after = stripByExt(before, ext);
    } catch (e) {
      failures.push(`${rel}: stripper threw: ${e.message}`);
      if (!opts.dryRun) { fs.copyFileSync(src, dst); stampFrom(src, dst); }
      stats.copied++;
      continue;
    }

    if (after === before) {
      if (!opts.dryRun) { fs.copyFileSync(src, dst); stampFrom(src, dst); }
      stats.unchanged++;
      continue;
    }

    if (opts.check) {
      const v = verify(ext, before, after);
      if (!v.ok) {
        failures.push(`${rel}: ${v.error}`);
        // ship it commented, never broken
        if (!opts.dryRun) { fs.copyFileSync(src, dst); stampFrom(src, dst); }
        stats.copied++;
        continue;
      }
    }

    if (!opts.dryRun) { fs.writeFileSync(dst, after, 'utf8'); stampFrom(src, dst); }
    stats.stripped++;
    stats.bytesIn += Buffer.byteLength(before);
    stats.bytesOut += Buffer.byteLength(after);
    stats.linesIn += lineCount(before);
    stats.linesOut += lineCount(after);
  }
}

if (!opts.dryRun) fs.rmSync(opts.out, { recursive: true, force: true });

for (const dir of SERVED) {
  const src = path.join(REPO_ROOT, dir);
  if (!fs.existsSync(src)) {
    failures.push(`${dir}/: not found in ${REPO_ROOT}`);
    continue;
  }
  build(src, path.join(opts.out, dir));
}

fs.rmSync(TMP, { recursive: true, force: true });

// ---- every import must land inside the build -----------------------------
//
// THE ONE FAILURE MODE A SERVED SET CAN HAVE. `node --check` proves each file
// still parses; it says nothing about whether the file NEXT to it got copied.
// This build deliberately leaves things out — `*.md`, dotfiles, whatever git
// ignores — and every omission is a chance to have cut something
// a module actually imports. In the browser that is a 404 and a blank page, and
// it would not show up in any suite here, because the suites run against the
// source tree where the file is present.
//
// So: resolve every relative import in the OUTPUT against the output itself.
// Bare specifiers are skipped (there are none, and if any appear they are a
// bundler's problem, not a missing file). Dynamic `import(expr)` with a
// non-literal argument cannot be checked statically and is not pretended to be.
function checkLinks(root) {
  const broken = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (ext !== '.js' && ext !== '.mjs') continue;
      const text = fs.readFileSync(p, 'utf8');
      const specs = new Set();
      const re = /(?:\bfrom\s*|\bimport\s*|\bexport\s+\*\s+from\s*)['"]([^'"]+)['"]/g;
      let m;
      while ((m = re.exec(text)) !== null) specs.add(m[1]);
      for (const spec of specs) {
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(p), spec);
        if (!fs.existsSync(target)) {
          broken.push(`${path.relative(root, p).split(path.sep).join('/')} -> ${spec}`);
        }
      }
    }
  };
  walk(root);
  return broken;
}

// `existsSync` guard: if every served directory was missing, the output was
// never created, and crashing on a missing scandir would bury the real message
// (which is already in `failures`) under a stack trace.
const brokenLinks = (!opts.dryRun && fs.existsSync(opts.out)) ? checkLinks(opts.out) : [];
for (const b of brokenLinks) failures.push(`BROKEN IMPORT  ${b}`);

const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const linesGone = stats.linesIn - stats.linesOut;

console.log(`build-web -> ${opts.out}${opts.dryRun ? '  (dry run, nothing written)' : ''}`);
console.log(`  served set: ${SERVED.join(' ')}`);
console.log(
  `  ${stats.stripped} stripped, ${stats.unchanged} already clean, ${stats.copied} copied verbatim`,
);
console.log(
  `  ${stats.gated} file(s) WITHHELD by the publish gate (git-ignored; see the gate note above)`,
);
console.log(
  `  ${linesGone} comment/blank lines removed  (${kib(stats.bytesIn)} -> ${kib(stats.bytesOut)}, ` +
  `${kib(stats.bytesIn - stats.bytesOut)} saved, ${((1 - stats.bytesOut / stats.bytesIn) * 100).toFixed(1)}%)`,
);
console.log(`  verification: ${opts.check ? 'node --check / structural, per file' : 'SKIPPED (--no-check)'}`);
if (!opts.dryRun) {
  console.log(`  imports: ${brokenLinks.length ? `${brokenLinks.length} BROKEN` : 'every relative import resolves inside the build'}`);
}

if (failures.length) {
  console.log('');
  for (const f of failures) console.error(`  !! ${f}`);
  // Two different kinds of failure share the list, and they mean different
  // things: a strip failure left one file commented but working, a broken
  // import means the build is INCOMPLETE. Say which happened rather than
  // reporting one count under the other's headline.
  const stripFails = failures.length - brokenLinks.length;
  if (stripFails > 0) {
    console.error(`  ${stripFails} file(s) COPIED WITH COMMENTS INTACT rather than stripped.`);
  }
  if (brokenLinks.length) {
    console.error(`  ${brokenLinks.length} import(s) point outside the build — the served set is INCOMPLETE.`);
  }
}

if (opts.json) {
  console.log(JSON.stringify({ ...stats, linesRemoved: linesGone, failures }, null, 2));
}

process.exit(failures.length ? 1 : 0);
