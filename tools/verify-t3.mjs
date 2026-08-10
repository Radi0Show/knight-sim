#!/usr/bin/env node
// T3 acceptance: the sim's soul movement against the real game.
//
//   node tools/verify-t3.mjs [path-to-oracle-trace]
//
// Two claims, each cell-exact against knight-research/traces/t3-hold-right.csv
// (see tools/scenes/oracle-t3.js for the window rationale):
//
//   1. rows 4..49   ALL columns  — until the tester's dummy enemy lands its
//                                  first bullet (inv reset, out of T3 scope)
//   2. rows 4..193  soul_x/soul_y — position through wall arrival and 176
//                                  frames pinned at x=374, bullet-independent

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { runTrace } from './run-trace.mjs';
import { T3_WINDOW } from './scenes/oracle-t3.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 't3-hold-right.csv');

const { from, fullRowTo, to } = T3_WINDOW;
const frames = to - from + 1;

// GameMaker's file_text_writeln emits CRLF; normalise before comparing.
const oracleLines = readFileSync(oraclePath, 'utf8')
  .replace(/\r/g, '')
  .replace(/\n$/, '')
  .split('\n');
const header = oracleLines[0].split(',');
const oracleRows = oracleLines.slice(1 + from, 1 + to + 1);

const simCsv = runTrace({ seed: 1, frames, scene: 'oracle-t3' }).replace(/\n$/, '').split('\n');
const simRows = simCsv.slice(1);

console.log(`oracle: ${oraclePath}`);

if (simCsv[0] !== oracleLines[0]) {
  console.log(`HEADER MISMATCH\n  oracle: ${oracleLines[0]}\n  engine: ${simCsv[0]}`);
  process.exit(1);
}

let failed = false;

function compare(label, lastRow, cols) {
  for (let i = 0; i <= lastRow - from; i++) {
    const oc = oracleRows[i].split(',');
    const sc = simRows[i].split(',');
    for (const c of cols) {
      if (oc[c] !== sc[c]) {
        console.log(
          `→ DIVERGENCE at frame ${from + i}: ${header[c]}  oracle=${oc[c]}  engine=${sc[c]}`,
        );
        failed = true;
        return;
      }
    }
  }
  console.log(`→ ${label}: rows ${from}..${lastRow} match   OK`);
}

compare('full rows (pre-bullet)', fullRowTo, [0, 1, 2, 3, 4, 5]);
compare('soul position (full window)', to, [0, 1, 2]);

console.log('');
if (failed) {
  console.log('FAIL');
  process.exit(1);
}
console.log(
  `PASS  frames ${from}..${fullRowTo} row-exact, ${from}..${to} position-exact ` +
    `against the real game`,
);
