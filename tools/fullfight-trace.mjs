#!/usr/bin/env node
// THE SIM HALF of whole-fight verification (docs/VERIFICATION.md).
//
//   node tools/fullfight-trace.mjs <token> --out sim.csv
//
// Replays a token through the real fight scene and writes the WIDE row —
// everything that accumulates across a fight, not just one attack's bullets.
// The oracle half drives the patched game from the SAME token and writes the
// same columns; `tools/diff-trace.mjs` then compares them as exact text.
//
// The token is the linchpin and it already exists: `verify-replay` proves it
// reproduces a live run exactly, which is the property that lets one recording
// stand in for a fight forever.

import { writeFileSync } from 'node:fs';
import { createState, stepFrame, traceHeader, traceRow } from '../sim/index.js';
import { decodeReplay } from '../sim/replay.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';

const argv = process.argv.slice(2);
const token = argv.find((a) => a.startsWith('K1.'));
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : 'traces/fullfight-sim.csv';
const slots = Number(argv[argv.indexOf('--slots') + 1]) || 16;

if (!token) {
  console.error('usage: node tools/fullfight-trace.mjs <K1....token> [--out f.csv] [--slots N]');
  process.exit(2);
}

const replay = decodeReplay(token);
const state = createState({ seed: replay.meta.seed, traceBulletSlots: slots });
// The wide row, and the shuffle pinned — see docs/VERIFICATION.md. Both sides
// must agree on the order or rotating slash diverges for a reason that is not
// a bug.
state.traceWide = true;
state.pinnedShuffle = true;
buildPracticeScene(state, { seed: state.seed });

const rows = [traceHeader(state)];
for (let f = 0; f < replay.frames; f++) {
  stepFrame(state, replay.inputAt(f));
  rows.push(traceRow(state));
}
writeFileSync(out, `${rows.join('\n')}\n`);

console.log(`${replay.frames} frames -> ${out}`);
console.log(`  final: hp ${state.partyHp.join('/')} · knight ${state.knight.hp}`
  + ` · TP ${Math.round(state.tension)} · phase ${state.phaseNum} turn ${state.turnNum}`
  + ` · balloon ${state.dialogue.balloonturn}`);
console.log(`  columns: ${rows[0].split(',').length}`);
