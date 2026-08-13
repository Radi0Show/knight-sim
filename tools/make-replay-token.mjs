#!/usr/bin/env node
// Generate a replay token that actually plays a fight.
//
//   node tools/make-replay-token.mjs --frames 9000 --seed 9 > /tmp/token.txt
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
//
// The first whole-fight recordings ran ONE turn and then flatlined for 790 of
// their 1200 frames, and the diff reported "exact through frame 21" against
// that — technically true, and it had never compared a second turn, a phase
// transition, a difficulty variant or the phase-4 gate.
//
// The cause was the token: it HELD confirm. `button1_p()` is edge-triggered,
// so a held button is exactly ONE press — enough to get through the first
// turn, never enough to complete a party menu again, so the fight waited
// forever for a menu that could not finish. That is the same edge-vs-level
// distinction that killed the FIGHT bar earlier in this project.
//
// So: CONFIRM IS PULSED, never held. One frame on, one frame off, which is
// the shape `menuInput` in verify-fight-order.mjs has used all along.
//
// ── WHAT THE INPUT DOES ───────────────────────────────────────────────────
//
// It is not trying to play well. It is trying to EXERCISE the fight: keep the
// soul moving so collisions and graze happen, and keep confirming so the menu
// advances and turns keep coming. A token that dodges perfectly would leave
// the damage path untested; one that stands still would leave the soul's
// movement untested.
//
// The walk cycles through the four directions rather than picking randomly,
// so the same seed always yields the same token and a divergence is never a
// question of which input arrived.

import { createRecorder, recordInput, encodeReplay } from '../sim/replay.js';

const argv = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 ? Number(argv[i + 1]) : dflt;
};

// 9000 frames is 5 minutes at 30fps — enough for phase 1 and 2 in full and a
// way into phase 3. 1200 (40s) was barely one turn, which is how the
// degenerate recording happened.
const frames = num('--frames', 9000);
const seed = num('--seed', 9);
// One frame on, one off. NOT a hold — see the header.
const confirmPeriod = num('--confirm-period', 2);
// How long to hold each direction before switching.
const legLength = num('--leg', 40);

const rec = createRecorder({ seed });
const DIRS = ['left', 'down', 'right', 'up'];

for (let f = 0; f < frames; f++) {
  const dir = DIRS[Math.floor(f / legLength) % DIRS.length];
  recordInput(rec, {
    [dir]: true,
    // The pulse. Every other frame, so a menu that needs three confirms gets
    // them within six frames rather than never.
    confirm: f % confirmPeriod === 0,
  });
}

const token = encodeReplay(rec);
console.error(`seed ${seed}, ${frames} frames, confirm pulsed 1-in-${confirmPeriod}`);
console.error(`token is ${token.length} chars`);
console.log(token);
