#!/usr/bin/env node
// ROARING's soul pull, against knight-research/traces/roaring2.csv.
//
// `player_suck` and `intensity` are compared EXACTLY. The soul's position goes
// through point_direction + lengthdir every frame, so it carries the usual
// sub-pixel trig residue and is compared under a fixed pixel bound with the
// worst case printed.
//
// This is the dodge mechanic of the finale: the soul is dragged toward the
// knight until (x + 10, y + 10) sits on the target, and the recording parks it
// at (310, 133.3) against a target of (320, 143).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState, stepFrame } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { real } from '../sim/trace.js';
import {
  buildOracleRoaringPullScene,
  ORACLE_PULL_INPUT,
  PULL_WINDOW,
  RING_WINDOW,
  SOUL_WINDOW,
  STAR_POS_WINDOW,
  START_FRAME,
} from './scenes/oracle-roaring-pull.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 'roaring2.csv');

const POSITION_TOLERANCE = 1e-3;
let slack = 0;
let maxDelta = 0;

function agree(o, s) {
  if (o === s) return true;
  const d = Math.abs(Number(o) - Number(s));
  if (d < POSITION_TOLERANCE) {
    slack += 1;
    if (d > maxDelta) maxDelta = d;
    return true;
  }
  return false;
}

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
const hearts = new Map();
const view = new Map();
const ctrl = new Map();
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (c[1] === 'obj_heart') hearts.set(Number(c[0]), c);
  else if (c[1] === 'obj_knight_roaring2') ctrl.set(Number(c[0]), parseVars(c[20]));
  else if (c[1] === '__global') {
    const v = parseVars(c[20]);
    view.set(Number(c[0]), { x: Number(v.viewx), y: Number(v.viewy) });
  }
}

const { from, to } = PULL_WINDOW;
const state = createState({ seed: 1, traceBulletSlots: 0 });
buildOracleRoaringPullScene(state);
const inputAt = makeInputTable(ORACLE_PULL_INPUT);

let checked = 0;
let pulled = 0;
let shakenFrames = 0;
// `ball_darkness` is the alpha the Draw composites the whole vortex at, and it
// is the ONLY thing standing between "every layer computed" and "every layer
// visible". It shipped stuck at 0 — the tiled flow, the six rings, the per-row
// ripple and the cycling HSV hue were all built every frame and then drawn at
// zero opacity, so the roar played out on a black screen. No suite could see
// that: the sim was correct everywhere the sim was checked, and the missing
// piece was one `if (timer == 118)` in the Step.
let ballDarknessPeak = 0;
let ballDarknessEarly = 0;
// The wind-up is the part that was dark, and it is most of the attack. There
// is a SECOND setter — `ball_darkness = 1` at roaring_timer 9, the roar itself
// — so peaking at 1 proves nothing: with the Step's cue missing, the vortex
// still lit up for the last stretch and stayed black through the two hundred
// frames before it. Count the frames that are lit BEFORE the roar.
let litWindupFrames = 0;
const failures = [];
const startY = 155.5500030518;

for (let frame = 0; frame <= to; frame++) {
  // THE CAMERA IS NOW AN OUTPUT, and it is compared exactly.
  //
  // It used to be the reason this window stopped at 191. The pull aims at
  // `camerax() + fake_x`, so a shaking camera drags the soul somewhere else —
  // but neither phase of the recorded view reproduced it (feeding frame f
  // broke 191, feeding f-1 broke 192 in the wrong direction). That looked like
  // a phase mystery. It was not: `obj_shake` (sim/shake.js) generates the
  // whole sequence from one create, and the apparent phase inconsistency is
  // just its event order. Its alarm fires BEFORE Step, so from the second
  // frame on every reader sees that frame's value; on the FIRST frame there is
  // no alarm yet, only the shake's own Step, and roaring2 is the older
  // instance so it steps first and still sees 0.
  //
  // Only the CREATE frames are replayed (SHAKE_FRAMES, derived from the
  // recorded view). The 4, -4, 3, -2, 0 is computed, and comparing view.x/y
  // exactly here is what proves it.

  stepFrame(state, inputAt(frame));
  if (frame < from) continue;

  const h = hearts.get(frame);
  const c = ctrl.get(frame);
  const r = state.entities.find((e) => e.alive && e.type.name === 'obj_knight_roaring2');
  if (!h || !c || !r) continue;

  if (Math.abs(state.soul.y - startY) > 1) pulled += 1;

  ballDarknessPeak = Math.max(ballDarknessPeak, r.ball_darkness ?? 0);
  // 134 is the cue (timer 118 + a 16-frame delay), 166 the end of its
  // 32-frame lerp; `roaring_timer < 1` is "the roar has not happened yet".
  if ((r.timer ?? 0) > 166 && (r.roaring_timer ?? 0) < 1 && r.ball_darkness >= 1) {
    litWindupFrames += 1;
  }
  // It must not be up BEFORE its cue: the lerp starts at timer 118 + 16.
  if ((r.timer ?? 0) < 134) {
    ballDarknessEarly = Math.max(ballDarknessEarly, r.ball_darkness ?? 0);
  }

  const v = view.get(frame);
  const exact = [
    ['player_suck', c.player_suck, real(r.player_suck)],
    ['intensity', c.intensity, real(r.intensity)],
    // The vortex's compositing alpha, compared against the recording rather
    // than merely asserted non-zero — the trace carries the column, so the
    // whole 32-frame ease_out curve is checked frame by frame.
    ['ball_darkness', c.ball_darkness, real(r.ball_darkness)],
    ['roaring_timer', c.roaring_timer, real(r.roaring_timer)],
  ];
  if (v) {
    // Integers on both sides, so these are compared as numbers rather than
    // through the 10-decimal formatter the recorder used.
    exact.push(['view.x', v.x, state.view.x], ['view.y', v.y, state.view.y]);
    if (v.x !== 0 || v.y !== 0) shakenFrames += 1;
  }
  // THE RESTING PLACE, compared exactly even though the frames in between
  // cannot be. The roar shoves the soul into the bottom-right corner and the
  // boundary clamps hold it there, so where it comes to rest does NOT depend
  // on which escape ray it took — the two rays converge on the same corner.
  //
  // This is the only thing guarding `obj_heart.boundaryup = 160` (roaring2's
  // Create). Without it the soul is caught at y 300 instead of 460 and ends
  // somewhere else entirely, and the sub-462 soul window would never notice.
  if (frame === to) {
    exact.push(['heart.x@rest', h[3], real(state.soul.x)], ['heart.y@rest', h[4], real(state.soul.y)]);
  }

  const loose =
    frame <= SOUL_WINDOW.to
      ? [
          ['heart.x', h[3], real(state.soul.x)],
          ['heart.y', h[4], real(state.soul.y)],
        ]
      : [];

  let bad = null;
  for (const [n, o, s2] of exact) {
    if (o === undefined) continue;
    checked += 1;
    if (String(o) !== String(s2)) {
      bad = `${n}  oracle=${o}  engine=${s2}`;
      break;
    }
  }
  if (!bad) {
    for (const [n, o, s2] of loose) {
      checked += 1;
      if (!agree(String(o), String(s2))) {
        bad = `${n}  oracle=${o}  engine=${s2}`;
        break;
      }
    }
  }
  if (bad) {
    failures.push(`frame ${frame}: ${bad}`);
    break;
  }
}

// ---- the star rings -------------------------------------------------------
//
// A SECOND, LONGER PASS. The rings are checked on their own run because their
// window reaches to 461 while the pull's stops at 191, and because what is
// provable about each differs:
//
//   * ring CADENCE — which frames fire and how many stars each — is compared
//     EXACTLY. It comes from the controller's counters alone.
//   * star COUNT is compared exactly across the whole window.
//   * star POSITIONS carry the same trig residue as the soul and are bounded
//     to STAR_POS_WINDOW, with the worst case printed, not asserted equal.
//
// The count divergence that used to appear at 192 is GONE: it was the screen
// shake moving the point the stars fall toward, the same cause as the soul
// kick. Both closed together.

const oracleFirstSeen = new Map();
const oracleStars = new Map();
const oracleRings = new Map();
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (c[1] !== 'obj_knight_roaring_star') continue;
  const f = Number(c[0]);
  if (!oracleFirstSeen.has(c[2])) {
    oracleFirstSeen.set(c[2], f);
    if (f > START_FRAME) oracleRings.set(f, (oracleRings.get(f) ?? 0) + 1);
  }
  if (!oracleStars.has(f)) oracleStars.set(f, []);
  oracleStars.get(f).push({ x: Number(c[3]), y: Number(c[4]) });
}

const rs = createState({ seed: 1, traceBulletSlots: 0 });
buildOracleRoaringPullScene(rs);
const ringInput = makeInputTable(ORACLE_PULL_INPUT);
const engineRings = new Map();
const knownStars = new WeakSet();
let ringStars = 0;
let released = 0;
const promoted = new WeakSet();
const burstSeen = new WeakSet();
let burst = 0;
let starFrames = 0;
let worstStar = 0;

for (let frame = 0; frame <= RING_WINDOW.to; frame++) {
  stepFrame(rs, ringInput(frame));

  const live = rs.entities.filter(
    (e) => e.alive && e.type.name === 'obj_knight_roaring_star',
  );
  for (const e of live) {
    if (knownStars.has(e)) continue;
    knownStars.add(e);
    if (frame > START_FRAME) {
      engineRings.set(frame, (engineRings.get(frame) ?? 0) + 1);
      ringStars += 1;
    }
  }

  // THE FINALE'S RELEASE, now verified rather than merely counted. From
  // roaring_timer 182 the controller promotes one caught star per frame to
  // con 1; each takes 45 frames to brake, reverse, burst into six children and
  // destroy itself. The window reaches the end of the recording, so every one
  // of those arcs is inside it — counts exact each frame, positions within
  // 0.006 px.
  //
  // It was 44 frames here, and that single frame was the whole f679+
  // divergence: the stars die one per frame, so every one dying a frame early
  // showed up as a constant deficit of exactly one star for the rest of the
  // run. The cause was step order — see roaring-star.js `stepOrder: -1`.
  //
  // Sabotage-checked: deleting the promotion leaves every other assertion here
  // passing, so the burst count below is what stops it being dead code.
  for (const e of live) {
    if (e.con >= 1 && !promoted.has(e)) {
      promoted.add(e);
      released += 1;
    }
    if (e.con === 3 && !burstSeen.has(e)) {
      burstSeen.add(e);
      burst += 1;
    }
  }

  if (frame < RING_WINDOW.from) continue;
  const want = oracleStars.get(frame) ?? [];
  if (want.length !== live.length) {
    failures.push(
      `frame ${frame}: live stars  oracle=${want.length}  engine=${live.length}`,
    );
    break;
  }
  starFrames += 1;
  if (frame > STAR_POS_WINDOW.to) continue;
  for (const m of live) {
    let best = Infinity;
    for (const o of want) best = Math.min(best, Math.hypot(o.x - m.x, o.y - m.y));
    if (best > worstStar) worstStar = best;
  }
}

const ringFrames = [...new Set([...oracleRings.keys(), ...engineRings.keys()])]
  .filter((f) => f >= RING_WINDOW.from && f <= RING_WINDOW.to)
  .sort((a, b) => a - b);
for (const f of ringFrames) {
  const o = oracleRings.get(f);
  const s = engineRings.get(f);
  if (o !== s) {
    failures.push(`frame ${f}: ring fired  oracle=${o ?? 0} stars  engine=${s ?? 0}`);
    break;
  }
}

// The release must actually COMPLETE, not just start. Only the CAUGHT stars
// burst — the ring stars are destroyed at the centre long before, which is why
// this is ~16 and not the 298 total deaths in the recording. Requiring most of
// them distinguishes "the arc ran" from "the arc began and stalled", which the
// count check alone cannot do.
if (burst < 15) {
  failures.push(`only ${burst} stars completed the burst arc (expected ~16)`);
}

const STAR_TOLERANCE = 1e-2;
if (worstStar > STAR_TOLERANCE) {
  failures.push(
    `star position drift ${worstStar.toExponential(2)} px exceeds ${STAR_TOLERANCE}`,
  );
}

console.log(`oracle: ${oraclePath}`);
console.log(`window: frames ${from}..${to}\n`);

if (failures.length) {
  for (const f of failures) console.log(`→ DIVERGENCE  ${f}`);
  process.exit(1);
}

// Sized to the 42-frame window, not padded: 168 comparisons and 41 frames on
// which the soul is measurably away from where it started. The point is that
// an empty or inert run cannot pass.
if (checked < 150 || pulled < 30) {
  console.log(`EXECUTION ASSERTION FAILED: checked=${checked} framesPulled=${pulled}`);
  console.log('  expected checked >= 150 and the soul to actually be dragged');
  process.exit(1);
}

// The rings need their own positive assertion for the same reason everything
// else here does: comparing two empty ring tables would pass. 69 rings and 194
// stars over 150..461, and the frames on which stars are actually alive to
// compare, are the measured counts — a translation that stopped firing would
// not reach them.
if (ballDarknessPeak < 1 || ballDarknessEarly > 0 || litWindupFrames < 100) {
  console.log(
    `EXECUTION ASSERTION FAILED: ball_darkness peaked at ${ballDarknessPeak}`
    + ` (early ${ballDarknessEarly}), lit for ${litWindupFrames} wind-up frames`,
  );
  console.log('  expected 0 until timer 134, a lerp to a full 1, and >= 100'
    + ' frames of a LIT wind-up — the vortex is composited at this alpha and'
    + ' 0 means the roar builds on a black screen');
  process.exit(1);
}

if (engineRings.size < 69 || ringStars < 194 || starFrames < 40 || shakenFrames < 32 || released < 16) {
  console.log(
    `EXECUTION ASSERTION FAILED: rings=${engineRings.size} stars=${ringStars} starFrames=${starFrames} shaken=${shakenFrames} released=${released}`,
  );
  console.log(
    '  expected >= 69 rings, >= 194 stars fired, >= 40 frames of live stars, >= 32 shaken frames, >= 16 stars released to con 1',
  );
  process.exit(1);
}

console.log(`→ ${checked} comparisons, soul dragged on ${pulled} frames`);
console.log(
  slack === 0
    ? '→ every position exact'
    : `→ ${slack} positions inexact, worst ${maxDelta.toExponential(2)} px (bound ${POSITION_TOLERANCE})`,
);
console.log(
  `→ ${engineRings.size} rings / ${ringStars} stars, every ring frame and count exact (${RING_WINDOW.from}..${RING_WINDOW.to})`,
);
console.log(
  `→ star population exact ${RING_WINDOW.from}..${RING_WINDOW.to}, positions within ${worstStar.toExponential(2)} px to ${STAR_POS_WINDOW.to} (bound ${STAR_TOLERANCE})`,
);
console.log(`→ ${released} stars released, ${burst} completed the full burst arc (release fires)`);
console.log(`→ camera exact on every frame, ${shakenFrames} of them shaken (obj_shake computed)`);
console.log(`→ ball_darkness 0 -> ${ballDarknessPeak}, lit for ${litWindupFrames} wind-up frames`);
console.log(`\nPASS  frames ${from}..${to} — roaring soul pull + star rings + screen shake (ac 9)`);
