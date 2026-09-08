# The served build

```
npm run build:web        # -> _site/
```

`_site/` is the copy a browser gets: the same tree, with every comment removed.
It is gitignored and rebuilt from scratch on every run. **The source is never
modified.**

## Why there is a build step at all

This repo is ~45% comments by line, deliberately. The GML citations, the
`ORIGINAL BUG:` markers and the "tried and reverted" notes in `sim/`,
`render/` and `input/` are the most valuable thing in the project — CLAUDE.md
asks for them, and each one is a fact about the real game that cost something to
learn. They must never be deleted from source.

They are also handed verbatim to anyone who opens DevTools, where they are only
noise, and in `sim/` they are most of the bytes on the wire. So:

> **Source keeps every comment. The served copy keeps none.**

The sibling repos strip the *vendored* copy after copying it. This repo is served
from its own tree, so the copy has to be made here.

Current result (2026-09-08, without the kaizo lane): **112 files stripped,
13,532 comment/blank lines removed, 1.67 MB → 0.71 MB of text, 57.5% smaller.**

## What goes in

`web/ sim/ render/ input/ assets/`, mirrored exactly — every import in
here is relative (`../sim/`, `../../sim/`), so the layout cannot be flattened.
These are the same five directories the hub's vendor script copies.

Left out: `tools/`, `*.md`, dotfiles, and anything the publish gate withholds.

## The publish gate

`_site/` is the directory someone would upload, so it answers the same question
the repo already answers: may this file leave the machine?

The answer is already written down, in git: `.gitignore` is what keeps
extracted game data and any art that may not be redistributed out of the public
tree (the kaizo lane's 446 gated mod sprites were the case that made this a
gate; that lane is its own repo now).

The build asks `git check-ignore` rather than keeping its own copy of that list,
and **stops** if git is unavailable. A publish gate that fails open is not a gate.

Withholding them is not a degradation: those files are gitignored, so a fresh
clone does not have them either, and the renderer's documented fallback covers it
— a missing sprite draws from its collision mask instead.

## What the build verifies on its own

A stripper may not be its own witness, so nothing is written stripped until
something else has checked it:

| kind | check |
|---|---|
| `.js` `.mjs` | `node --check` on a temp `.mjs` copy. The extension matters — `node --check foo.js` parses as CommonJS and rejects `import`. The **original** is checked first, so a file that did not parse before can never be blamed on this tool. |
| `.html` | `<script>` / `<style>` / `<div>` counts unchanged, and every inline script body that parsed before still parses after. |
| `.css` | brace counts unchanged. |
| the whole tree | every relative import in the output resolves **inside** the output. |

That last one is the guard on the served set itself. `node --check` proves a file
parses; it says nothing about whether the file next to it got copied, and this
build leaves things out on purpose. A missing module is a 404 and a blank page in
the browser, and no suite in this repo would see it — they all run against the
source tree, where the file is there.

A file that fails a check is **copied verbatim** — commented but working, never
broken — and the run exits non-zero.

Mirrored files carry the **source mtime**. Not cosmetic: `verify-fullfight`
refuses a cached sim trace older than the newest `.js` under `sim/`, and a plain
copy would stamp the whole tree with the build time and turn that suite red for a
reason unrelated to the code.

Two consecutive builds produce a byte-identical tree.

## The real proof: the traces must not move

The checks above only say the output still *parses*. What matters is that it
still *behaves*, bit for bit — so prove it the way everything else here is
proven, with a trace diff. Trace the same seed, scene and frame count through
`sim/` and through `_site/sim/`, and diff with `tools/diff-trace.mjs`. The CSVs
must be identical.

`tools/*.mjs` all import `../sim/`, so the way to point them at the stripped tree
is to put a copy of `tools/` inside the build, where the relative paths land on
`_site/sim/` instead:

```bash
npm run build:web
cp -r tools _site/__verify          # __verify/x.mjs sees ../sim -> _site/sim

node _site/__verify/verify-all.mjs  # the whole suite, against the stripped tree

# the whole-fight diff, both trees, into scratch dirs
mkdir -p /tmp/ff-src /tmp/ff-site
KNIGHT_SIM_OUT=/tmp/ff-src  node tools/regen-fullfight.mjs
KNIGHT_SIM_OUT=/tmp/ff-site node _site/__verify/regen-fullfight.mjs
diff -r /tmp/ff-src /tmp/ff-site

rm -rf _site/__verify               # leave the build as the build
```

Last measured (2026-08-31), stripped vs source:

- **all 60 suites green** against `_site/`, `verify-fullfight` included
- **50 trace pairs byte-identical** — 10 scenes × 5 seeds × 1200 frames, 60,000
  frames, matched by `diff-trace.mjs` and by SHA-256
- **24 whole-fight traces byte-identical** — 6 recorded fights, 346,008 frames,
  86 MB, including the render-layer draw-call traces

**If those ever differ, the stripper has a bug. Fix the stripper — do not work
around it in the build.**

Prove the comparison is not vacuous before believing it. Changing one constant in
`_site/sim/rng.js` (`0x6d2b79f5` → `...f6`) makes the differ report a divergence
at frame 0; if it does not, the harness is comparing the source tree with itself.

## The stripper

`tools/strip-comments.mjs` is a **byte-identical copy** of
`thedevice/tools/strip-comments.mjs` — a verified character scanner (not a
regex), shipped with its 27 adversarial tests:

```
npm run test:strip
```

It is copied rather than imported across repos because CI checks out *this* repo
alone, so a `../../thedevice/...` import would fail on every runner and every
fresh clone. Because the copy is byte-identical, drift is one command:

```bash
cmp tools/strip-comments.mjs ../thedevice/tools/strip-comments.mjs
```

Do not edit either copy, and do not write a second stripper. `//` appears inside
strings, URLs and regex literals throughout this codebase, and a regex that looks
right will silently eat code somewhere in 1,900 files.

## This does not deploy anything

`.github/workflows/ci.yml` records that the old `pages.yml` — which built and
published a `_site` from here — was **deleted rather than disabled**, so that
nothing could quietly start publishing again. That posture is unchanged.
`build:web` writes a directory and stops. Wiring it to a host is a separate,
deliberate decision, and it would have to reckon with the publish gate above.
