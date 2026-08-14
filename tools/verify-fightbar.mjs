#!/usr/bin/env node
// THE ATTACK BAR — `obj_attackpress`, `scr_boltcheck`, `scr_boltcheck_onebutton`.
//
// No oracle: no recording covers a player turn. What this pins is everything
// that is not guessable from playing it, and three of those were WRONG in the
// first pass because I wrote the module before reading the Draw event.
//
//     window   close < 15 && close > -5    early is forgiven, late is not
//     p == 0   150   p == 1  120   p == 2  110   p >= 3  100 - 2p
//     schedule RANDOM, first bolt on frame 29 (lastbolt starts at -1)
//     default  ONE BUTTON — a press scans every character's bolts
//
// It also cross-checks the one number corroborated from outside the dump:
// FIGHT grants `round(points / 10)` TP and a critical is famously +15. 150/10
// is 15, so the top of the scale and the TP rule agree independently.

import {
  createFightBar, boltCheck, boltCheckOneButton, stepFightBar, fightTp,
  BOLT_SPEED, boltScreenX,
} from '../sim/fightbar.js';
import { createRng } from '../sim/rng.js';

const failures = [];
const rng = () => createRng(4242);

/** A three-button bar with one Kris bolt on frame 30, wound to `close`. */
function at(close) {
  const bar = createFightBar(rng(), [0], false);
  bar.bolts = [{ char: 0, frame: 30, alive: true, red: false }];
  bar.boltx = 30 - close;
  return bar;
}

const scale = [[0, 150], [1, 120], [2, 110], [3, 94], [5, 90], [10, 80], [14, 72]];
for (const [close, want] of scale) {
  const got = boltCheck(at(close), 0);
  if (got !== want) failures.push(`close ${close}: scored ${got}, expected ${want}`);
}

// THE WINDOW. 15 early does NOT qualify (`close < 15`), 14 does. 5 late does
// not (`close > -5`), 4 does. Early is forgiven roughly three times as far.
if (boltCheck(at(15), 0) !== 0) failures.push('close 15 scored — the window is `< 15`');
if (boltCheck(at(14), 0) === 0) failures.push('close 14 missed — it should qualify');
if (boltCheck(at(-5), 0) !== 0) failures.push('close -5 scored — the window is `> -5`');
if (boltCheck(at(-4), 0) === 0) failures.push('close -4 missed — a late press still counts');

// ── ONE BUTTON IS THE DEFAULT ────────────────────────────────────────────
// `global.flag[13] == 0` routes every press through scr_boltcheck_onebutton,
// which scans ALL characters' bolts. A press must be able to score a bolt
// belonging to someone other than slot 0 — the three-button path cannot.
const one = createFightBar(rng(), [0, 1, 2], true);
one.bolts = [{ char: 2, frame: 30, alive: true, red: false }];
one.boltx = 30;
boltCheckOneButton(one);
if (one.points[2] !== 150) {
  failures.push(`one-button did not score Ralsei's bolt (${one.points[2]})`);
}

// DUALBOLT: two bolts on the SAME frame are both scored by one press. The gap
// generator really can emit 0, so this is reachable, not theoretical.
const dual = createFightBar(rng(), [0, 1], true);
dual.bolts = [
  { char: 0, frame: 30, alive: true, red: true },
  { char: 1, frame: 30, alive: true, red: false },
];
dual.boltx = 30;
boltCheckOneButton(dual);
if (dual.points[0] !== 150 || dual.points[1] !== 150) {
  failures.push(`dualbolt scored ${dual.points[0]}/${dual.points[1]}, expected 150/150`);
}

// ── EDGE-TRIGGERED, and the direction that broke FIGHT entirely ──────────
// `button1_p()` fires once per press. Holding must score nothing but the frame
// it went down, so a held button through a later bolt misses.
const held = createFightBar(rng(), [0], true);
held.bolts = [{ char: 0, frame: 30, alive: true, red: false }];
for (let f = 0; f < 40; f++) stepFightBar(held, true);
if (held.points[0] !== 0) failures.push('a held button scored a later bolt — it fires once');

// But a fresh press ON the line must score. A once-per-BAR latch swallowed
// this: the first press always lands while the bolts are 30 frames out, so
// nothing could ever score and FIGHT dealt zero damage for a whole session.
const tap = createFightBar(rng(), [0], true);
tap.bolts = [{ char: 0, frame: 30, alive: true, red: false }];
for (let f = 0; f < 40; f++) stepFightBar(tap, tap.boltx === 30);
if (tap.points[0] !== 150) failures.push(`a press on the line scored ${tap.points[0]}, expected 150`);

// A scored bolt dies, so mashing cannot score it twice.
const twice = at(0);
boltCheck(twice, 0);
if (boltCheck(twice, 0) !== 0) failures.push('the same bolt scored twice');

// A bolt more than 5 past the line dies unhit — that is the miss.
const missed = createFightBar(rng(), [0], true);
missed.bolts = [{ char: 0, frame: 30, alive: true, red: false }];
for (let i = 0; i < 40; i++) stepFightBar(missed, false);
if (missed.bolts[0].alive) failures.push('a bolt far past the line stayed alive');
if (missed.points[0] !== 0) failures.push('a missed bolt scored');
if (!missed.done) failures.push('the bar did not finish once every bolt was gone');

// ── THE SCHEDULE ─────────────────────────────────────────────────────────
// `boltxoff += lastbolt` runs BEFORE the frame is set and `lastbolt` starts at
// -1, so the first bolt lands on 29. Off by one, in the original, and the whole
// scoring window is measured in single frames.
let sawGap0 = false;
const charCounts = [0, 0, 0];
for (let seed = 0; seed < 400; seed++) {
  const bar = createFightBar(createRng(seed), [0, 1, 2], true);
  if (bar.bolts.length !== 3) {
    failures.push(`seed ${seed}: ${bar.bolts.length} bolts for 3 fighters`);
    break;
  }
  if (bar.bolts[0].frame !== 29) {
    failures.push(`seed ${seed}: first bolt on ${bar.bolts[0].frame}, expected 29`);
    break;
  }
  // Every fighter gets exactly one bolt — the rejection sampler guarantees it.
  const per = [0, 0, 0];
  for (const b of bar.bolts) per[b.char] += 1;
  if (per.some((n) => n !== 1)) {
    failures.push(`seed ${seed}: bolts per character ${per.join('/')}, expected 1/1/1`);
    break;
  }
  charCounts[bar.bolts[0].char] += 1;
  // Gaps come from choose(0, 12, 18) / choose(12, 18) — nothing else.
  for (let i = 1; i < bar.bolts.length; i++) {
    const gap = bar.bolts[i].frame - bar.bolts[i - 1].frame;
    if (![0, 12, 18].includes(gap)) {
      failures.push(`seed ${seed}: gap ${gap} is not one of 0/12/18`);
      break;
    }
    if (gap === 0) sawGap0 = true;
  }
}
// A zero gap must actually occur, or the dualbolt path above is unreachable in
// practice and testing it proves nothing.
if (!sawGap0) failures.push('no seed produced a 0 gap — the dualbolt path is unreachable');
// And the ORDER must be random: if the first bolt were always Kris's, the
// rejection sampler would be broken in a way the per-character count misses.
if (charCounts.some((n) => n < 50)) {
  failures.push(`lead bolt distribution ${charCounts.join('/')} — not random`);
}

// Geometry: 8px a frame, on the line at close 0.
const geo = at(0);
if (boltScreenX(geo, geo.bolts[0], 0) !== 80) failures.push('a bolt at close 0 is off the line');
const geo3 = at(3);
if (boltScreenX(geo3, geo3.bolts[0], 0) !== 80 + 3 * BOLT_SPEED) {
  failures.push('bolt spacing is not boltspeed per frame');
}

// A BAR NOBODY PRESSES MUST STILL END. `boltalive[i] = 0` at
// `boltframe - boltx < -5` is what retires a missed bolt, and `attacked[i]`
// latches when a character has no live bolts left — scored or swept past.
// Without the expiry an unpressed bolt stayed alive, `done` never flipped and
// the bar hung until something else ended the turn: the "the fight is
// buffered too long, it takes like 10 seconds" report, worse later in the
// fight because more bolts mean a likelier miss.
{
  const idle = createFightBar({ havechar: [1, 1, 1], seed: 7 });
  let f = 0;
  while (!idle.holdDone && f < 2000) { stepFightBar(idle, false); f += 1; }
  if (!idle.holdDone) failures.push('a bar with no presses never finished (missed bolts never expire)');
  const lastBolt = Math.max(...idle.bolts.map((b) => b.frame));
  // last bolt + 5 frames of grace + the 50-frame posttimer (> 50, so 51).
  const want = lastBolt + 5 + 51;
  if (Math.abs(f - want) > 2) {
    failures.push(`unpressed bar ended at ${f}, expected ~${want} (last bolt ${lastBolt} + 5 + 51)`);
  }
}

// The corroboration. `round`, not a bare divide.
if (fightTp(150) !== 15) failures.push(`a critical gives ${fightTp(150)} TP, expected 15`);
if (fightTp(94) !== 9) failures.push(`fightTp(94) = ${fightTp(94)}, expected round(9.4) = 9`);

console.log('accuracy: ' + scale.map(([c, w]) => `${c}->${w}`).join('  '));
console.log('window: close in (-5, 15) — 15 frames early hits, 5 late does not');
console.log(`schedule: first bolt frame 29, gaps from {0, 12, 18}, lead bolt ${charCounts.join('/')} over 400 seeds`);
console.log(`one button scans all rows; dualbolt scores both; critical = ${fightTp(150)} TP`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  the attack bar (no oracle — see header)');
