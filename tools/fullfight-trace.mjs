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

import { writeFileSync, readFileSync } from 'node:fs';
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
state.traceWide = true;

// THE SHUFFLE IS REPLAYED FROM THE ORACLE, not reproduced.
//
// `ds_list_shuffle`'s algorithm is unsolved (CLAUDE.md), so the sim cannot
// derive a given seed's ordering — and rotating slash runs in every phase, so
// without this the whole-fight diff would fail on every one of them for a
// reason that is not a bug in the fight.
//
// oracle_fullfight.csx logs each shuffled `slash_list` as it is built; this
// feeds them back in build order through the hook rotating-slash.js already
// has for oracle_t7. The real shuffle still runs in the game and still burns
// its draws, so nothing downstream of it is falsified.
//
// This used to set `state.pinnedShuffle = true`, WHICH NOTHING READ. The flag
// was invented here and never wired to anything — the same write-only-variable
// failure CLAUDE.md records for `state.inv` and the original's
// `destroy_on_hit`. It read as "the shuffle is handled" while the sim quietly
// rolled its own order.
const shIdx = argv.indexOf('--shuffle');
if (shIdx >= 0) {
  const text = readFileSync(argv[shIdx + 1], 'utf8').trim();
  const lists = text
    ? text.split('\n').map((line) => line.split(',').slice(1).join(',')
        .split('|').map(Number))
    : [];
  state.fixedSlashOrder = true;
  state.angleLists = lists;
  state.angleIndex = 0;
  console.log(`shuffle: replaying ${lists.length} recorded list(s)`);
}

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
