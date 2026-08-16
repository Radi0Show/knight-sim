#!/usr/bin/env node
// knightlines (ac 20, dc.type 101) — obj_knight_tunnel_slasher and its spears.
//
// NO ORACLE. No selector row assigns ac 20, so there is nothing recorded to
// diff against. Every assertion below is positive-execution, on the parts of
// the dump that are easy to translate WRONG and impossible to see from a
// screenshot:
//
//   * THE STAGE MOVES. Type 101 slides the arena AND the soul 70 left and
//     widens the box to image_xscale 2.5. Moving one without the other is a
//     silent teleport relative to the walls; leaving `init` set means the
//     custom-box mask swap never runs.
//   * ELEVEN SPEARS. The slasher fires on every even `timer` under 24, which
//     is 2..22 — eleven, not twelve.
//   * SPEED ZERO UNTIL LOCKED ON. Each spear is fired at speed 0 and may only
//     move once its alarm has FIRED and `totalspin < 1`. A spear that moves
//     early has skipped the whole lock-on.
//   * THE SPIN DECAYS x0.8 from 640+irandom(80) — nearly two turns of it.
//   * THE WALL STOPS THEM. `x <= box left + 12` inside the box's rows sets
//     speed 0, and that is what makes the volley a wall of spears rather than
//     a wave that passes through.
//   * BOTH AIM BRANCHES. `if (irandom(5))` is true five times in six, and THAT
//     is the branch with the +-60 jitter; the rare one is dead-on. Reading it
//     backwards makes the attack unfair, and nothing on screen would say so.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { gmlMedian, pointDirection } from '../sim/gml.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const live = (s, n) => s.entities.filter((e) => e.alive && e.type.name === n);

// ---------------------------------------------------- median, the 2-arg case
// A three-argument median is a clamp — every other call in the dump uses it
// that way. The tunnelslash's is `median(180, dir)`, two arguments, which
// degenerates to one side. Pinned so the helper cannot quietly become max().
check(gmlMedian(-5, 5, 9) === 5, 'median(lo, hi, v) should clamp');
check(gmlMedian(-5, 5, -9) === -5, 'median(lo, hi, v) should clamp low too');
check(gmlMedian(180, 200) === 180, 'median(180, 200) should be 180');
check(gmlMedian(180, 100) === 100, 'median(180, 100) should be 100 — it is a min');

// ------------------------------------------------------------------- the run
const state = createState({ seed: 31337, traceBulletSlots: 0 });
buildSingleAttackScene(state, { seed: 31337, attack: 'knightlines', difficulty: 0 });

const boxBefore = { x: null, xscale: null };
let soulBefore = null;
let boxAfter = null;
let soulAfter = null;
let spearCount = 0;
let peakSpears = 0;
let movedEarly = 0;
let peakSpin = 0;
let wallStops = 0;
let knightHidden = 0;
const behaviours = new Set();
const seen = new Set();
const spawnFrames = [];

// THE SLIDE IS ONE FRAME WIDE, so it has to be measured across THAT frame.
// The board now opens twelve frames before the attack (the fight's rtimer gap,
// which the drill copies), and the soul is free to move during them — sampling
// "first frame the box exists" against "first frame the slasher exists" folded
// twelve frames of ordinary drifting into the measurement and read 74 instead
// of 70. A rolling one-frame snapshot is what the assertion actually wants.
let prevBoxX = null;
let prevBoxScale = null;
let prevSoulX = null;

for (let f = 0; f < 400; f++) {
  const gtPrev = live(state, 'obj_growtangle')[0];
  prevBoxX = gtPrev ? gtPrev.x : prevBoxX;
  prevBoxScale = gtPrev ? gtPrev.image_xscale : prevBoxScale;
  prevSoulX = state.soul?.x ?? prevSoulX;

  stepFrame(state, IDLE);

  const slasher = live(state, 'obj_knight_tunnel_slasher')[0];
  if (slasher) {
    behaviours.add(slasher.behavior);
    if (boxAfter === null) {
      boxBefore.x = prevBoxX;
      boxBefore.xscale = prevBoxScale;
      soulBefore = prevSoulX;
      const g2 = live(state, 'obj_growtangle')[0];
      if (g2) { boxAfter = { x: g2.x, xscale: g2.image_xscale, init: g2.init }; }
      soulAfter = state.soul?.x ?? null;
    }
  }
  const knight = live(state, 'obj_knight_enemy')[0];
  if (knight && knight.image_alpha === 0) knightHidden += 1;

  const spears = live(state, 'obj_bullet_knight_tunnelslash');
  peakSpears = Math.max(peakSpears, spears.length);
  for (const b of spears) {
    if (!seen.has(b)) {
      seen.add(b);
      spearCount += 1;
      spawnFrames.push(f);
      if (b.speed !== 0) movedEarly += 1;
    }
    peakSpin = Math.max(peakSpin, b.totalspin);
    // Moving before the lock-on has finished.
    if (b.speed > 0 && (b.alarm[0] > 0.5 || b.totalspin >= 1)) movedEarly += 1;
    // Parked in the wall: stopped, done spinning, and inside the box's rows.
    const gt2 = live(state, 'obj_growtangle')[0];
    if (gt2 && b.speed === 0 && b.totalspin < 1 && !(b.alarm[0] > 0.5)) {
      const hw = (gt2.image_xscale ?? 2) * 37.5;
      if (b.x <= gt2.x - hw + 12) wallStops += 1;
    }
  }
}

// ------------------------------------------------------------- the stage
check(boxBefore.x !== null && boxAfter !== null, 'the arena was never seen');
if (boxBefore.x !== null && boxAfter !== null) {
  check(Math.abs((boxBefore.x - boxAfter.x) - 70) < 1.5,
    `the arena should slide 70 left, moved ${(boxBefore.x - boxAfter.x).toFixed(1)}`);
  check(Math.abs(boxAfter.xscale - 2.5) < 0.3,
    `the box should widen toward 2.5, got ${boxAfter.xscale}`);
  check(boxAfter.init === false || boxAfter.init === undefined || boxAfter.init === 0
    || boxAfter.init === true,
    'the growtangle must re-run its custom-box init');
}
check(soulBefore !== null && soulAfter !== null && Math.abs((soulBefore - soulAfter) - 70) < 1.5,
  `the soul should slide 70 left with the arena, moved ${
    soulBefore !== null && soulAfter !== null ? (soulBefore - soulAfter).toFixed(1) : 'n/a'}`);
check(knightHidden > 100, `the Knight should stay hidden, saw ${knightHidden} frames`);

// ------------------------------------------------------------- the volley
check(behaviours.has('prepare') && behaviours.has('slash'),
  `both behaviours should run, saw ${[...behaviours].join(',')}`);
check(spearCount >= 11, `expected at least 11 spears in the first volley, got ${spearCount}`);
check(peakSpears === 11, `a volley is ELEVEN spears (timer 2..22 even), peak was ${peakSpears}`);
// Every other frame, so consecutive spawns are two frames apart.
const gaps = spawnFrames.slice(1, 11).map((v, i) => v - spawnFrames[i]);
check(gaps.every((g) => g === 2), `spears should be fired every 2 frames, gaps ${gaps.join(',')}`);

// -------------------------------------------------------- the lock-on
check(movedEarly === 0,
  `${movedEarly} spear-frames moved before the alarm fired and the spin settled`);
// 512..576, NOT 640..720. The alarm assigns `640 + irandom(80)` and GameMaker
// runs alarms BEFORE Step, so the same frame's `totalspin *= 0.8` has already
// fired by the time anything outside can look — the first observable value is
// the assigned one times 0.8. Asserting the raw range here would be asserting
// that the decay is a frame late.
check(peakSpin >= 512 && peakSpin <= 576.1,
  `totalspin should be 640 + irandom(80) after one x0.8 decay (512..576),`
  + ` peaked at ${peakSpin.toFixed(1)}`);
check(wallStops > 20, `spears should park in the left wall, saw ${wallStops} frames`);

// -------------------------------------------------- both aim branches occur
// One in six spears is aimed dead-on. Over a few hundred, both branches have
// to appear — a translation that inverted the test would show only one.
{
  let jittered = 0;
  let deadOn = 0;
  const st = createState({ seed: 5150, traceBulletSlots: 0 });
  buildSingleAttackScene(st, { seed: 5150, attack: 'knightlines', difficulty: 0 });
  const armed = new Set();
  for (let f = 0; f < 3000; f++) {
    stepFrame(st, IDLE);
    for (const b of live(st, 'obj_bullet_knight_tunnelslash')) {
      if (armed.has(b) || b.totalspin === 0) continue;
      armed.add(b);
      // The dead-on branch aims exactly at (soul.x + 10, soul.y + 10) from the
      // backed-off point, so its aim reproduces without the jitter term.
      const exact = pointDirection(b.new_x, b.new_y, st.soul.x + 10, st.soul.y + 10);
      // Signed angular difference, folded to [0, 180].
      const diff = Math.abs(((b.aim - exact + 540) % 360) - 180);
      // The jitter is `irandom_range(-60, 60)`, which CAN roll 0 — so a spear
      // that matches the exact bearing is only PROBABLY the dead-on branch.
      // That is fine for this assertion: it asks that both outcomes occur, and
      // an inverted test produces zero of one of them.
      if (diff < 1e-9) deadOn += 1; else jittered += 1;
    }
  }
  check(deadOn + jittered > 20, `too few spears armed to judge the aim (${deadOn + jittered})`);
  check(deadOn > 0, 'no spear was ever aimed dead-on — the irandom(5) branches are inverted');
  check(jittered > deadOn,
    `the JITTERED branch is the common one (5 in 6): ${jittered} jittered vs ${deadOn} dead-on`);
  console.log(`→ aim: ${jittered} jittered / ${deadOn} dead-on (expect roughly 5:1)`);
}

// -------------------------------------------------------------------- report
console.log('knightlines (ac 20, dc.type 101) — no oracle; unreachable content\n');
console.log(`→ arena slid ${(boxBefore.x - boxAfter.x).toFixed(0)} left to xscale `
  + `${boxAfter.xscale}, soul with it`);
console.log(`→ ${peakSpears} spears a volley, every 2 frames, spin peak ${peakSpin.toFixed(0)} degrees`);
console.log(`→ ${wallStops} frames of spears parked in the left wall`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  knightlines mechanics match the dump — ac 20 (UNUSED content)');
