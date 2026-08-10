#!/usr/bin/env node
// T4 acceptance: obj_roaringknight_slash end to end against the real game.
//
//   node tools/verify-t4.mjs [path-to-oracle-trace]
//
// Full-row cell-exact comparison over rows 4..193 of
// knight-research/traces/t4-slash.csv — every column, including the box
// position through the jitter frames and the slash width through its whole
// life. The tester's dummy bullets are sterilized in this oracle run, so
// unlike T3 there is no bullet-noise exclusion; the only actors are the
// soul, the box, and the slash.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runTrace } from './run-trace.mjs';
import { T4_WINDOW } from './scenes/oracle-t4.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 't4-slash.csv');

const { from, to } = T4_WINDOW;
const frames = to - from + 1;

const oracleLines = readFileSync(oraclePath, 'utf8')
  .replace(/\r/g, '')
  .replace(/\n$/, '')
  .split('\n');
const header = oracleLines[0].split(',');
const oracleRows = oracleLines.slice(1 + from, 1 + to + 1);

const simCsv = runTrace({ seed: 1, frames, scene: 'oracle-t4' }).replace(/\n$/, '').split('\n');
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

console.log(`→ traces match through frames ${from}..${to}   OK`);
console.log(`\nPASS  ${frames} frames row-exact against the real game, slash included`);
