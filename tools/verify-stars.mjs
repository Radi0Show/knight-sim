#!/usr/bin/env node
// Attack 5 acceptance: the Stars cone against the real game.
//
//   node tools/verify-stars.mjs [path-to-oracle-trace]
//
// Verifies the attack's dodge-relevant core over rows 91..300 of
// knight-research/traces/t8-stars.csv: the cone's angle easing, its internal
// gt_x, the battle box snapping to round(gt_x), and the soul squeezed against
// the box's right edge.
//
// The stars themselves are not covered yet — see tools/scenes/oracle-t8.js.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runTraceFull } from './run-trace.mjs';
import { T8_WINDOW } from './scenes/oracle-t8.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 't8-stars.csv');
const { from, to } = T8_WINDOW;

const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').replace(/\n$/, '').split('\n');
const oHead = lines[0].split(',');
const oi = Object.fromEntries(oHead.map((h, i) => [h, i]));
const oRows = new Map(lines.slice(1).map((l) => { const c = l.split(','); return [Number(c[0]), c]; }));

const { csv, counters } = runTraceFull({ seed: 1, frames: to + 2, scene: 'oracle-t8' });
const sLines = csv.replace(/\n$/, '').split('\n');
const si = Object.fromEntries(sLines[0].split(',').map((h, i) => [h, i]));
const sRows = new Map(sLines.slice(1).map((l) => { const c = l.split(','); return [Number(c[0]), c]; }));

// Compare at the ORACLE's recorded precision, per value — a fixed epsilon
// would silently accept real divergence in a coarsely-printed column.
function same(a, b) {
  if (a === b) return true;
  const na = Number(a); const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  const dp = (String(a).split('.')[1] ?? '').length;
  return Math.abs(na - nb) <= 0.5 * Math.pow(10, -dp);
}

// Cone mechanics AND soul position over the whole window.
//
// The soul check used to stop at 153, where it stepped 4px with the box wall
// far away. That was not the stars: the knight was dragging the soul out of
// the arena (myattackchoice defaulting to 0 — see CLAUDE.md). With the soul
// correctly placed, the only thing that moves it is the cone's squeeze, and
// that now matches for every frame.
const CONE_COLS = [
  ['angle', 'angle'], ['anglelerp', 'anglelerp'],
  ['gtx_internal', 'gtx_internal'], ['gt_x', 'gt_x'],
];
const SOUL_UNTIL = 300;

console.log(`oracle: ${oraclePath}`);
let fail = 0; let checked = 0;
for (let f = from; f <= to; f++) {
  const o = oRows.get(f); const s = sRows.get(f);
  if (!o || !s) continue;
  checked++;
  const check = f <= SOUL_UNTIL ? [...CONE_COLS, ['soul_x', 'soul_x']] : CONE_COLS;
  for (const [on, sn] of check) {
    if (!same(o[oi[on]], s[si[sn]])) {
      console.log(`→ DIVERGENCE at frame ${f}: ${on}  oracle=${o[oi[on]]}  engine=${s[si[sn]]}`);
      fail = 1; break;
    }
  }
  if (fail) break;
}
if (!fail) {
  console.log(`→ cone mechanics: rows ${from}..${to} match (${checked} frames)   OK`);
  console.log(`→ soul position: rows ${from}..${SOUL_UNTIL} match   OK`);
}

if (!fail) {
  // The push must actually have moved the arena, or this passes vacuously.
  const first = sRows.get(from); const last = sRows.get(to);
  const moved = Number(first[si.gt_x]) - Number(last[si.gt_x]);
  if (moved < 50) {
    console.log(`EXECUTION ASSERTION FAILED: box only moved ${moved}px — the push did not run`);
    fail = 1;
  } else {
    console.log(`→ box pushed ${moved}px left over the window`);
  }
}

console.log('');
if (fail) { console.log('FAIL'); process.exit(1); }
console.log(`PASS  Stars cone verified against the real game (${checked} frames)`);
