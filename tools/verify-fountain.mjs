#!/usr/bin/env node
// Fountain-bullet acceptance: moving bullets end to end against the real game.
//
//   node tools/verify-fountain.mjs [path-to-oracle-trace]
//
// Full-row cell-exact comparison over rows 4..193 of
// knight-research/traces/t5-fountain.csv: frozen soul, two ramping fountain
// bullets, one wall-destroyed offscreen, one contacting the heart (inv reset
// + destroyonhit). Verifies built-in motion, float32 position storage, the
// inherited bullet base, and the default damage path.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runTraceFull } from './run-trace.mjs';
import { T5_WINDOW } from './scenes/oracle-t5.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 't5-fountain.csv');

const { from, to } = T5_WINDOW;
const frames = to - from + 1;

const oracleLines = readFileSync(oraclePath, 'utf8')
  .replace(/\r/g, '')
  .replace(/\n$/, '')
  .split('\n');
const header = oracleLines[0].split(',');
const oracleRows = oracleLines.slice(1 + from, 1 + to + 1);

const { csv, counters } = runTraceFull({ seed: 1, frames, scene: 'oracle-t5' });
const simCsv = csv.replace(/\n$/, '').split('\n');
const simRows = simCsv.slice(1);

console.log(`oracle: ${oraclePath}`);
console.log(`window: rows ${from}..${to}, all columns\n`);

if (simCsv[0] !== oracleLines[0]) {
  console.log(`HEADER MISMATCH\n  oracle: ${oracleLines[0]}\n  engine: ${simCsv[0]}`);
  process.exit(1);
}

for (let i = 0; i < frames; i++) {
  if (oracleRows[i] === simRows[i]) continue;
  const oc = oracleRows[i].split(',');
  const sc = simRows[i].split(',');
  for (let c = 0; c < Math.max(oc.length, sc.length); c++) {
    if (oc[c] !== sc[c]) {
      console.log(
        `→ DIVERGENCE at frame ${from + i}: ${header[c] ?? `col${c}`}  ` +
          `oracle=${oc[c] ?? '<missing>'}  engine=${sc[c] ?? '<missing>'}`,
      );
      process.exit(1);
    }
  }
}

// Positive execution assertions: two bullets moving for ~130 frames, one
// contact. If any counter is off, a mechanism silently stopped executing.
if (counters.motionSteps < 100 || counters.collisionChecks < 20 || counters.collisionHits !== 1) {
  console.log(`EXECUTION ASSERTION FAILED: ${JSON.stringify(counters)}`);
  console.log('  expected motionSteps >= 100, collisionChecks >= 20, collisionHits == 1');
  process.exit(1);
}
console.log(`→ executed: ${counters.motionSteps} motion steps, ${counters.collisionChecks} collision checks, ${counters.collisionHits} hit`);
console.log(`→ traces match through frames ${from}..${to}   OK`);
console.log(`\nPASS  ${frames} frames row-exact against the real game, bullets included`);
