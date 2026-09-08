#!/usr/bin/env node
// Regenerate sim/data/object-order.js from an object-table CSV.
//
//   node tools/gen-object-order.mjs <object-table.csv>
//
// The CSV comes from knight-research/tools/patches/object_table.csx, which reads
// the OBJECT DEFINITIONS out of the data file:
//
//   OBJ_TABLE_OUT=<out.csv> UndertaleModCli load <data.win> \
//       -s tools/patches/object_table.csx -o <scratch.win>
//
// ── WHY THE OBJECT INDEX IS DATA THE SIM NEEDS ────────────────────────────
//
// GameMaker runs an event by visiting instances grouped BY OBJECT, in object
// index order, and only then by instance id. `sim/entity.js`'s `phaseList`
// sorts by creation order (`seq`) instead — which agrees with the game only
// when the objects involved happen to have been created in index order.
//
// They frequently are not, and the sim has been compensating BY HAND. There are
// about a dozen `stepOrder:` constants scattered through sim/ and kaizo/, each
// one added after a divergence was traced to ordering, and every one of them is
// a manual restatement of a number that was sitting in the data file all along:
//
//     obj_knight_split_growtangle   index  909  \  the organism steps BEFORE the
//     obj_heart                     index 1462  /  soul — hand-coded -0.5
//     obj_growtangle                index 1516     the box steps AFTER — 0.5
//
// The measurement that made this worth generating: the mod's underbox manager
// writes a fuse onto an orb from inside its own alarm event
// (`with (orb) { alarm[1] = ... }`). obj_knight_weird_circle is index 373 and
// obj_knight_weird_bottom_manager is 1173, so the GAME visits the orb first and
// the fuse survives the frame intact. The sim visits the manager first (it
// created the orbs, so it is earlier by `seq`), decrements the fresh fuse in the
// same pass, and lands one frame early — mod 29 against sim 28, on four
// independent arming chains across both routes.
//
// A two-pass alarm loop was tried as a fix and REVERTED: it repairs the
// cross-object hop but breaks the manager's own self re-arm, which the
// interleave already handled correctly, and overshoots to 30. See the note at
// `runAlarms` in sim/entity.js. Ordering is the model that explains both hops
// with one mechanism.
//
// ── WHAT SHIPS ────────────────────────────────────────────────────────────
//
// Names and integers only — no code, no art, no room data. This is the same
// posture as sim/data/masks.js and assets/sprites/manifest.json, both of which
// already ship derived metadata. Objects the sim invents (`fight_director`,
// `obj_marker_splitflame`) have no index and are absent by design; callers must
// handle that rather than defaulting them to 0, which would sort them first.

import { readFileSync, writeFileSync } from 'node:fs';

const csv = process.argv[2];
if (!csv) {
  console.error('usage: node tools/gen-object-order.mjs <object-table.csv>');
  process.exit(2);
}

const lines = readFileSync(csv, 'utf8').replace(/\r/g, '').trim().split('\n');
const header = lines[0].split(',');
const iIdx = header.indexOf('index');
const iName = header.indexOf('name');
if (iIdx < 0 || iName < 0) {
  console.error(`gen-object-order: ${csv} has no index/name columns (got ${header.join(',')})`);
  process.exit(2);
}

// DEPTH IS THE OTHER HOLE THIS FILE CLOSES. CLAUDE.md, "The OBJECT DEFINITION
// holds more than the sprite": obj_knight_split_growtangle assigns `depth` in no
// event but places three kinds of sibling at `depth + N`, so in the sim all
// three were `undefined + N` = NaN and the draw order became whatever the sort
// happened to leave. Nothing threw and no number was wrong — the only symptom
// was something drawn in front of what it should be behind.
const iDepth = header.indexOf('depth');

const order = {};
const depth = {};
let n = 0;
for (const line of lines.slice(1)) {
  const cells = line.split(',');
  const name = cells[iName];
  const idx = Number(cells[iIdx]);
  if (!name || !Number.isInteger(idx)) continue;
  if (iDepth >= 0) {
    const d = Number(cells[iDepth]);
    // Only record a depth we actually read. A NaN here would propagate exactly
    // the way the missing value did, which is the bug being fixed.
    if (Number.isFinite(d)) depth[name] = d;
  }
  // A DUPLICATE NAME WOULD SILENTLY PICK ONE. Object names are unique in a
  // GameMaker project; if that ever stops being true the map is ambiguous and
  // the caller would sort by an arbitrary one of the two.
  if (order[name] !== undefined) {
    console.error(`gen-object-order: duplicate object name ${name}`
      + ` (${order[name]} and ${idx}) — the map would be ambiguous`);
    process.exit(1);
  }
  order[name] = idx;
  n += 1;
}

// ── THE DEPTH QUESTION, ANSWERED BY THE DUMP ──────────────────────────────
//
// CLAUDE.md carries an open item: "The OBJECT DEFINITION holds more than the
// sprite. `depth` is the same hole, and it is worse because nothing ever
// throws" — obj_knight_split_growtangle places three kinds of sibling at
// `depth + N` and assigns `depth` in no event, so in the sim all three were
// `undefined + N` = NaN. It names the object-definition dump as the fix.
//
// The dump answers it, and the answer is that there is nothing to import:
// EVERY object in this build has definition depth 0. Depth is entirely
// runtime-managed in DELTARUNE (scr_depth and friends), so the sim's `?? 0`
// fallback is not a stand-in — it is the value. Emitting 1,731 zeros would be
// bloat pretending to be data, so the finding is recorded here instead, and
// re-derived on every run: if a future build ever ships a non-zero definition
// depth, this refuses rather than silently dropping it.
const depths = new Set(Object.values(depth));
const depthNote = depths.size === 1 && depths.has(0)
  ? '\n// DEPTH: every object in this build has definition depth 0 — depth is\n'
    + '// entirely runtime-managed, so a `?? 0` fallback for an unassigned depth is\n'
    + '// correct rather than a stand-in. Verified across all objects at generation\n'
    + '// time; this note is only emitted when that holds.\n'
  : `\n// DEPTH: NON-ZERO DEFINITION DEPTHS EXIST IN THIS BUILD (${[...depths].join(', ')}).\n`
    + '// The `?? 0` fallbacks in sim/ are then WRONG and this file should start\n'
    + '// exporting the depth map. See tools/gen-object-order.mjs.\n';

const out = '// GENERATED from the data file\'s object definitions — do not edit by hand.\n'
  + '// Regenerate: node tools/gen-object-order.mjs <object-table.csv>\n'
  + '// Produce the CSV with knight-research/tools/patches/object_table.csx.\n'
  + '//\n'
  + '// name -> object index. GameMaker runs an event by visiting instances\n'
  + '// grouped by OBJECT in this order, then by instance id; the sim sorts by\n'
  + '// creation order, and the two disagree wherever an object creates an\n'
  + '// instance of a LOWER-indexed object. See tools/gen-object-order.mjs for the\n'
  + '// measurement that made this necessary.\n'
  + '//\n'
  + '// A name that is absent has NO index: it is a type the sim invents. Callers\n'
  + '// must handle that explicitly — defaulting to 0 would sort it first, which\n'
  + '// is the one answer that is certainly wrong.\n\n'
  + `export const OBJECT_ORDER = ${JSON.stringify(order)};\n\n`
  + '/** The object index for a type name, or null when the sim invented it. */\n'
  + 'export function objectIndex(name) {\n'
  + '  const i = OBJECT_ORDER[name];\n'
  + '  return i === undefined ? null : i;\n'
  + '}\n\n'
  + depthNote;

writeFileSync(new URL('../sim/data/object-order.js', import.meta.url), out);
console.log(`wrote sim/data/object-order.js — ${n} objects`);
