#!/usr/bin/env node
// Contact-model acceptance: masksOverlap against every measured data point.
//
//   node tools/verify-contact.mjs
//
// Replays the oracle contact study (knight-research/traces/t4-contact-hits.csv
// plus the sub-pixel sweep and the T3 grow-in stall) through the engine's
// collision test. 47 data points; every one must agree.
//
// Positions for the recorded hits are the exact ones from the hits file.
// Positions for the axis-aligned misses use representative integers — those
// cases are translation-invariant (slash spawns relative to the heart, and
// the sub-pixel band either contains an integer row or it does not).

import { HEART_MASK, BATTLEBG_MASK, masksOverlap } from '../sim/masks.js';

// The slash's mask, identical to the one in sim/attacks/roaringknight-slash.js.
const SLASH_MASK = {
  w: 250,
  h: 46,
  originX: 125,
  originY: 23,
  bbox: [0, 22, 249, 22],
  px: Array.from({ length: 46 }, (_, y) =>
    y === 22 ? new Array(250).fill(true) : new Array(250).fill(false),
  ),
};

let pass = 0;
let fail = 0;

function check(label, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else {
    fail++;
    console.log(`  WRONG  ${label}: model=${got ? 'hit' : 'miss'} oracle=${want ? 'hit' : 'miss'}`);
  }
}

// --- yscale ramp, angle 0, xscale 2, slash at heart+(10,10) ---------------
const ramp = [
  [0.1, false], [0.2, false], [0.3, false], [0.4, false], [0.5, false],
  [0.6, false], [0.7, false], [0.8, false], [0.9, false],
  [1.0, true], [1.2, true], [1.5, true], [2.0, true], [3.0, true], [5.0, true],
];
for (const [ys, want] of ramp) {
  const got = masksOverlap(HEART_MASK, 310, 162, SLASH_MASK, 320, 172, 2, ys, 0);
  check(`yscale ${ys} angle 0`, got, want);
}

// --- angles at yscale 0.1, recorded positions -----------------------------
const angles = [
  [30, 311, 158, 321, 168, true],
  [45, 311, 158, 321, 168, true],
  [60, 311, 161, 321, 171, true],
  [90, 311, 161, 321, 171, false],
  [135, 311, 161, 321, 171, true],
];
for (const [ang, hx, hy, sx, sy, want] of angles) {
  const got = masksOverlap(HEART_MASK, hx, hy, SLASH_MASK, sx, sy, 2, 0.1, ang);
  check(`angle ${ang} yscale 0.1`, got, want);
}

// --- sub-pixel y sweep, angle 0, yscale 0.1, xscale 1: 20/20 missed -------
for (let k = 0; k < 20; k++) {
  const got = masksOverlap(HEART_MASK, 310, 162, SLASH_MASK, 320, 172 + k * 0.05, 1, 0.1, 0);
  check(`sub-pixel k=${k}`, got, false);
}

// --- T3 grow-in stall: rotating fractional-scale box ----------------------
// Box state live during the heart's Step of trace row r is timer=r:
// scale 2*(t/15), angle 180+180*(t/15). Oracle: row0 free (heart moved
// 314->318), rows 1-3 fully blocked, row 4 free.
const grow = [
  [0, 318, false], // heart moving into 318, timer 0: scale 0, no mask
  [1, 322, true],
  [2, 322, true],
  [3, 322, true],
  [4, 322, false],
];
for (const [t, tryX, want] of grow) {
  const s = 2 * (t / 15);
  const got =
    s === 0
      ? false
      : masksOverlap(HEART_MASK, tryX, 162, BATTLEBG_MASK, 320, 170, s, s, 180 + 180 * (t / 15));
  check(`grow t=${t}`, got, want);
}
// Rows 1-3 the soul was frozen entirely — the walk-back to its own resting
// position must ALSO collide, or the Step would slide it.
for (const t of [1, 2, 3]) {
  const s = 2 * (t / 15);
  const got = masksOverlap(HEART_MASK, 318, 162, BATTLEBG_MASK, 320, 170, s, s, 180 + 180 * (t / 15));
  check(`grow t=${t} rest`, got, true);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} contact data points reproduced`);
process.exit(fail === 0 ? 0 : 1);
