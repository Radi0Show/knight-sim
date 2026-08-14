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

// THE ATTACK BAR'S SCHEDULE IS REPLAYED FROM THE ORACLE, for the same reason
// the shuffle is: `my_method == 1` builds it with choose() per bolt plus a
// rejection-sampled character, and the two sides' RNG call orders differ
// (scr_randomtarget draws every turn; Draw events consume too).
//
// Each logged line is `frame,boltframe:boltchar|boltframe:boltchar|...`, one
// per bar, in creation order. Without this the sides run different bolt
// frames, and since the scoring window forgives 15 frames of earliness the
// sim scores bolts the oracle has not reached — which reads as a damage
// divergence and is nothing of the kind.
const boltIdx = argv.indexOf('--bolts');
if (boltIdx >= 0) {
  const text = readFileSync(argv[boltIdx + 1], 'utf8').trim();
  const schedules = text
    ? text.split('\n').map((line) => line.split(',').slice(1).join(',')
        .split('|').map((b) => {
          const [frame, char] = b.split(':').map(Number);
          return { char, frame, alive: true, red: false };
        }))
    : [];
  state.boltSchedules = schedules;
  state.boltIndex = 0;
  console.log(`bolts: replaying ${schedules.length} recorded schedule(s)`);
}

buildPracticeScene(state, { seed: state.seed });

// KEEP THE PARTY ALIVE — and say plainly what that costs.
//
// A scripted input does not dodge, so the party wipes within a turn or two and
// the fight stops; the recording then flatlines and the degeneracy guard
// (rightly) refuses it. verify-fight-order.mjs already faces this and resolves
// it the same way, "refusing to let a survival question decide a turn-order
// question".
//
// THE COST: hp0/hp1/hp2 are pinned at maximum, so THIS RUN DOES NOT VERIFY
// PARTY HP BOOKKEEPING — not the Shadow Mantle's two-hits-in-three targeting,
// not Kris never being the default target, not the swoon scaling. Damage still
// fires and still resets `inv_timer`, so the damage PATH is exercised; only
// the resulting HP is not checked.
//
// That is why this is a flag and not the default: a survivable hand-authored
// run, which keeps the hp columns honest, is the other half of the picture and
// is tracked separately. Reporting a --keep-alive run as whole-fight
// verification without this caveat would overstate it exactly the way the
// one-turn recording did.
const keepAlive = argv.includes('--keep-alive');
if (keepAlive) console.log('keep-alive: party HP pinned — hp columns NOT verified');

// USE THE ROWS `stepFrame` ALREADY WROTE, do not generate them again.
//
// stepFrame does `state.trace.push(traceRow(state)); state.frame += 1;` — the
// row is captured BEFORE the counter advances, so its first row is frame 0,
// matching the oracle's first in-room frame.
//
// Calling traceRow() again after stepFrame returns reads the ALREADY
// INCREMENTED counter, so every row came out numbered one too high. The
// differ joins on the frame column, so that silently compared the sim's
// frame N against the oracle's frame N — which are different moments — and
// showed up as the sim being consistently one frame behind on the menu, the
// bar and everything downstream.
const rows = [traceHeader(state)];
// The refill itself lives INSIDE stepFrame (state.keepAlive), before the
// trace row is captured — the oracle recorder refills before composing its
// row, so a refill done out here, after the row was already pushed, left
// every hit frame showing the drop the oracle never records.
state.keepAlive = keepAlive;
for (let f = 0; f < replay.frames; f++) {
  stepFrame(state, replay.inputAt(f));
}
rows.push(...state.trace);
writeFileSync(out, `${rows.join('\n')}\n`);

console.log(`${replay.frames} frames -> ${out}`);
console.log(`  final: hp ${state.partyHp.join('/')} · knight ${state.knight.hp}`
  + ` · TP ${Math.round(state.tension)} · phase ${state.phaseNum} turn ${state.turnNum}`
  + ` · balloon ${state.dialogue.balloonturn}`);
console.log(`  columns: ${rows[0].split(',').length}`);
