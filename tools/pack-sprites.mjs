#!/usr/bin/env node
// Build assets/sprites/ from a raw sprite dump plus the metadata JSON.
//
//   node tools/pack-sprites.mjs <names.txt> [dumpDir] [metaJson]
//
// Produce the two inputs from the PRIVATE research repo (neither is ever
// committed):
//
//   UndertaleModCli dump <game.ios> --sprites -o /tmp/sprdump
//   UndertaleModCli load <game.ios> -s tools/patches/sprite_meta.csx -o /tmp/x.ios
//
// WHY THE METADATA MATTERS. GameMaker positions every draw relative to a
// sprite's ORIGIN, and the dump has no origins in it. Art packed without them
// sits offset from the physics — the sprite/hitbox mismatch this project
// exists to avoid. manifest.json carries origin, size, frame count and bbox.
//
// Frame counts come from the metadata, never from globbing: `spr_rk_quickslash`
// and `spr_rk_quickslash_lower` share a filename prefix, so a glob would fold
// one into the other.

import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'assets', 'sprites');

const namesFile = process.argv[2] ?? '/tmp/sprlist.txt';
const dumpDir = join(process.argv[3] ?? '/tmp/sprdump', 'Sprites');
const metaFile = process.argv[4] ?? '/tmp/sprite_meta.json';

const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
const names = readFileSync(namesFile, 'utf8')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

mkdirSync(OUT, { recursive: true });

// THIS SCRIPT REBUILDS THE PACK FROM SCRATCH — it deletes every PNG and copies
// back only what `namesFile` lists. That is right for a full rebuild and
// catastrophic for the thing it kept getting used for: adding two sprites.
//
// Running it with a two-name list deleted 745 PNGs and left a manifest with
// two entries in it. The suites all stayed green, because sim/ does not read
// sprites — the loss only showed as a browser rendering nothing, one round
// trip later. The PNGs are gitignored, so there was no `git checkout` back.
//
// So: refuse to shrink the pack by more than half unless asked. `--replace`
// is the full-rebuild path and says so at the call site.
const manifestPath = join(OUT, 'manifest.json');
const replace = process.argv.includes('--replace');
if (!replace && existsSync(manifestPath)) {
  const prev = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const prevCount = Object.keys(prev.sprites ?? prev).length;
  if (prevCount > 0 && names.length < prevCount / 2) {
    console.error(
      `refusing to shrink the pack from ${prevCount} sprites to ${names.length}.\n` +
      'This rebuilds from scratch — it does not merge. To ADD a sprite, append\n' +
      "its name to the full list and re-run; to rebuild anyway, pass --replace.",
    );
    process.exit(1);
  }
}

for (const f of readdirSync(OUT)) {
  if (f.endsWith('.png')) unlinkSync(join(OUT, f));
}

const manifest = {};
const missing = [];
let copied = 0;

for (const name of [...new Set(names)].sort()) {
  const m = meta[name];
  if (!m) {
    missing.push(`${name} (not a sprite in this build)`);
    continue;
  }

  const files = [];
  for (let i = 0; i < m.frames; i++) {
    const file = `${name}_${i}.png`;
    const src = join(dumpDir, file);
    if (!existsSync(src)) {
      missing.push(`${file} (metadata says ${m.frames} frames)`);
      continue;
    }
    copyFileSync(src, join(OUT, file));
    files.push(file);
    copied += 1;
  }
  if (!files.length) continue;

  manifest[name] = {
    w: m.w,
    h: m.h,
    ox: m.ox,
    oy: m.oy,
    frames: files.length,
    bbox: m.bbox,
    sepmasks: m.sepmasks,
    // GameMaker multiplies image_speed by the SPRITE's own playback rate.
    playback: m.playback,
    playbacktype: m.playbacktype,
    files,
  };
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);

console.log(`packed ${Object.keys(manifest).length} sprites, ${copied} frames -> assets/sprites`);
if (missing.length) {
  console.log(`\n${missing.length} missing:`);
  for (const s of missing.slice(0, 20)) console.log(`  ${s}`);
  if (missing.length > 20) console.log(`  ... and ${missing.length - 20} more`);
}
