#!/usr/bin/env node
// Attack 4 acceptance: obj_knight_rotating_slash against the real game.
//
//   node tools/verify-rotating.mjs [path-to-oracle-trace]
//
// Two claims over knight-research/traces/t7-rotating.csv:
//
//   1. rows 62..300, ALL attack columns — state, timer, aim_direction,
//      rotation, slash_number, aim_x/aim_y, and live slash count. This is the
//      attack's whole mechanical surface: state timing, spin, lock-on, fan
//      geometry, and spawn cadence.
//   2. rows 62..106, soul position — up to the first slash landing. After
//      that the slash's box jitter draws choose() from a stream position we
//      do not reproduce (the recorded-table/gmlRng split, see the attack
//      header), so the soul's exact path is not claimed. The slash's own
//      behaviour is already verified row-exact by verify-t4.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runTraceFull } from './run-trace.mjs';
import { T7_WINDOW } from './scenes/oracle-t7.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 't7-rotating.csv');

const { from, to } = T7_WINDOW;
const SOUL_UNTIL = 106;

const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').replace(/\n$/, '').split('\n');
const oHead = lines[0].split(',');
const oRows = new Map();
for (const l of lines.slice(1)) {
  const c = l.split(',');
  oRows.set(Number(c[0]), c);
}

const { csv, counters } = runTraceFull({ seed: 1, frames: to + 2, scene: 'oracle-t7' });
const sLines = csv.replace(/\n$/, '').split('\n');
const sHead = sLines[0].split(',');
const sRows = new Map();
for (const l of sLines.slice(1)) {
  const c = l.split(',');
  sRows.set(Number(c[0]), c);
}

// Oracle column -> sim column, by name. The two traces carry different
// layouts (the oracle also logs spin/offset/list), so compare by header name.
const pairs = [
  ['state', 'state'], ['rtimer', 'rtimer'], ['aimdir', 'aimdir'],
  ['rotation', 'rotation'], ['slashnum', 'slashnum'],
  ['aimx', 'aimx'], ['aimy', 'aimy'], ['slashes', 'slashes'],
];
const oi = Object.fromEntries(oHead.map((h, i) => [h, i]));
const si = Object.fromEntries(sHead.map((h, i) => [h, i]));

// The oracle prints different columns at different precision (4 dp for
// positions, 6 dp for angles) while the sim always prints 10. Compare at
// whatever precision the ORACLE recorded, derived per value — never a fixed
// epsilon, which would silently accept a real divergence in a coarse column.
function same(a, b) {
  if (a === b) return true;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  const dp = (String(a).split('.')[1] ?? '').length;
  return Math.abs(na - nb) <= 0.5 * Math.pow(10, -dp);
}

console.log(`oracle: ${oraclePath}`);
let fail = 0;
let checked = 0;

for (let f = from; f <= to; f++) {
  const o = oRows.get(f);
  const s = sRows.get(f);
  if (!o || !s) continue;
  checked++;
  for (const [on, sn] of pairs) {
    if (!same(o[oi[on]], s[si[sn]])) {
      console.log(`→ DIVERGENCE at frame ${f}: ${on}  oracle=${o[oi[on]]}  engine=${s[si[sn]]}`);
      fail = 1;
      break;
    }
  }
  if (fail) break;
}
if (!fail) console.log(`→ attack state: rows ${from}..${to} match (${checked} frames)   OK`);

let soulFail = 0;
if (!fail) {
  for (let f = from; f <= SOUL_UNTIL; f++) {
    const o = oRows.get(f);
    const s = sRows.get(f);
    if (!o || !s) continue;
    if (!same(o[oi.soul_x], s[si.soul_x]) || !same(o[oi.soul_y], s[si.soul_y])) {
      console.log(`→ DIVERGENCE at frame ${f}: soul  oracle=(${o[oi.soul_x]},${o[oi.soul_y]})  engine=(${s[si.soul_x]},${s[si.soul_y]})`);
      soulFail = 1;
      break;
    }
  }
  if (!soulFail) console.log(`→ soul position: rows ${from}..${SOUL_UNTIL} match   OK`);
}

if (counters.alarmFires < 2) {
  console.log(`EXECUTION ASSERTION FAILED: ${JSON.stringify(counters)} — slashes never armed their alarms`);
  fail = 1;
}

console.log('');
if (fail || soulFail) { console.log('FAIL'); process.exit(1); }
console.log(`PASS  rotating slash verified against the real game (${checked} frames of attack state)`);
