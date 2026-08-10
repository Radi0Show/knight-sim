#!/usr/bin/env node
// Stars: spawn cadence and star lifecycle, against the real game.
//
//   node tools/verify-star-population.mjs
//
// Verifies STAR COUNT over rows 95..169 of knight-research/traces/t9-star.csv
// — the accumulation phase. That pins the controller's spawn cadence
// ((made && btimer>=4) || btimer>=45), the star's Create, and its offscreen
// cull, all of which would move the population curve if wrong.
//
// The window ends at 169 for a stated reason: each real star gets an
// RNG-derived direction and speed, so they exit the view at different times.
// This scene launches them uniformly (see oracle-t9.js), so from ~f170 the
// count drifts by the stars that would have left early. Verifying past that
// needs every star's spawn parameters recorded, not a fixed launch.
//
// Fire-phase behaviour (knockback shoving the box at f197 onward) is NOT
// claimed — see STATUS.md.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { runTraceFull } from './run-trace.mjs';

const oraclePath = process.argv[2]
  ?? join(homedir(), 'knight-research', 'traces', 't9-star.csv');
const FROM = 95;
const TO = 169;

const o = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').trim().split('\n');
const oi = Object.fromEntries(o[0].split(',').map((h, i) => [h, i]));
const oRows = new Map(o.slice(1).map((l) => { const c = l.split(','); return [Number(c[0]), c]; }));

const { csv } = runTraceFull({ seed: 1, frames: TO + 5, scene: 'oracle-t9' });
const s = csv.trim().split('\n');
const si = Object.fromEntries(s[0].split(',').map((h, i) => [h, i]));
const sRows = new Map(s.slice(1).map((l) => { const c = l.split(','); return [Number(c[0]), c]; }));

console.log(`oracle: ${oraclePath}`);
let checked = 0;
let peak = 0;
for (let f = FROM; f <= TO; f++) {
  const a = oRows.get(f); const b = sRows.get(f);
  if (!a || !b || a[oi.stars] === '') continue;
  checked++;
  peak = Math.max(peak, Number(b[si.stars]));
  if (Number(a[oi.stars]) !== Number(b[si.stars])) {
    console.log(`→ DIVERGENCE at frame ${f}: stars  oracle=${a[oi.stars]}  engine=${b[si.stars]}`);
    process.exit(1);
  }
}

if (peak < 10) {
  console.log(`EXECUTION ASSERTION FAILED: only ${peak} stars ever alive — spawning did not run`);
  process.exit(1);
}

console.log(`→ star count: rows ${FROM}..${TO} match (${checked} frames, peak ${peak} alive)   OK`);
console.log(`\nPASS  Stars spawn cadence and lifecycle verified against the real game`);
