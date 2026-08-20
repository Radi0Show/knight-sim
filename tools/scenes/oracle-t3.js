// T3 oracle-comparison scene: the steady-state window of the collected trace
// knight-research/traces/t3-hold-right.csv.
//
// The oracle scenario (room_bullettest_new): obj_growtangle at (320,170)
// grows over 15 frames to scale 2; obj_heart spawns at (314,162); the patched
// input holds right forever. Its trace: one free step to 318, THEN a 3-frame
// stall while the tiny growing box's ring mask pins the soul, then free run
// at 4px/frame to the wall, resting at x=374.
//
// This scene starts INSIDE the steady window, at trace frame 4:
//   soul at (318,162)   — its position after the stall
//   box at scale 2      — fully grown; contact cannot occur before frame 17,
//                         so skipping the grow animation changes nothing in
//                         this window (verified: soul x stays >= 322, ring
//                         interior at scale 2 spans 250..391)
//   frame counter = 4, global.inv = -4 (one decrement per elapsed frame)
//
// Frames 0-3 are excluded from acceptance: the grow-in uses fractional-scale
// rotated precise masks whose rasterization we cannot yet reproduce. See
// CLAUDE.md, "growth window".
//
// Comparison window: rows 4..193. Row 194 is the battle controller's turn
// reset (obj_returnheart) — turn machinery, out of T3 scope.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';

// Window bounds:
//   from 4        — after the grow-in stall (see above)
//   fullRowTo 49  — at frame 50 the tester's dummy enemy lands its first
//                   bullet hit and global.inv resets to 30 (then every ~40
//                   frames after). Bullet damage is attack behaviour, out of
//                   T3 scope, so full-row equality is only claimed before it.
//   to 193        — soul position is bullet-independent (hits never move it;
//                   verified across the trace), so x/y stay in-window until
//                   the turn reset at 194.
export const T3_WINDOW = { from: 4, fullRowTo: 49, to: 193 };

export function buildOracleT3Scene(state) {
  state.hp = 0;
  state.invTimer = -4; // global.inv, decremented once per frame since spawn
  state.phase = 'oracle';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.frame = T3_WINDOW.from;

  // Creation order matches the tester: box before heart.
  // The tester room's box rests the soul at 374 (its recording's own east
  // wall) — the stored [2..72] mask, unlike the fight's boxes. See
  // BATTLEBG_FIGHT_MASK in sim/masks.js for both measurements.
  state.testerBoxMask = true;
  settleBox(spawn(state, battlebox, { x: 320, y: 170 }));
  state.soul = spawn(state, soul, { x: 318, y: 162 });
  return state;
}

export const ORACLE_T3_INPUT = [{ from: 0, right: true }];
