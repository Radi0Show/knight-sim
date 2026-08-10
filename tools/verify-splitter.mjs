#!/usr/bin/env node
// Attack 3 acceptance: the box-splitter organism against the real game.
//
//   node tools/verify-splitter.mjs [path-to-oracle-trace]
//
// Full-row cell-exact over rows 4..193 of knight-research/traces/t6-splitter.csv:
// soul, con state machine, timer, distance, the first four teeth (x, y AND
// image_angle), and the running contact count.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runTraceFull } from './run-trace.mjs';
import { T6_WINDOW } from './scenes/oracle-t6.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 't6-splitter.csv');

const { from, to } = T6_WINDOW;
const frames = to - from + 1;

const oracleLines = readFileSync(oraclePath, 'utf8')
  .replace(/\r/g, '').replace(/\n$/, '').split('\n');
const header = oracleLines[0].split(',');
const oracleRows = oracleLines.slice(1 + from, 1 + to + 1);

const { csv, counters } = runTraceFull({ seed: 1, frames, scene: 'oracle-t6' });
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

// 13 teeth alive for ~130 frames must generate a lot of collision work.
if (counters.collisionChecks < 200 || counters.collisionHits < 1) {
  console.log(`EXECUTION ASSERTION FAILED: ${JSON.stringify(counters)}`);
  console.log('  expected collisionChecks >= 200, collisionHits >= 1');
  process.exit(1);
}
console.log(`→ executed: ${counters.collisionChecks} collision checks, ${counters.collisionHits} hits, ${counters.motionSteps} motion steps`);
console.log(`→ traces match through frames ${from}..${to}   OK`);
console.log(`\nPASS  ${frames} frames row-exact against the real game, splitter included`);
