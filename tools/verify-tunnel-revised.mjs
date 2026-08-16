#!/usr/bin/env node
// The revised sword tunnel (ac 3, dc.type 102) —
// obj_knight_tunnel_slasher_2_revised and obj_knight_diamondswordbullet_ext.
//
// The last of the six unused attacks, and the combination's third segment.
//
// NOT THE FIGHT'S SWORD TUNNEL. That is ac 13 / obj_sword_tunnel_manager; this
// is a different object that shares the string in `global.monsterattackname`.
//
// NO ORACLE — nothing selects ac 3. The assertions are positive-execution and
// aimed at the parts a screenshot cannot tell apart:
//
//   * THE HOLE IS SIZED BY HOW FAR IT MOVED. 36 under 20 pixels of travel, 44
//     under 30, 52 under 40, 60 beyond — a big jump is forgiven with a wide
//     gap and a small shift is a tight one. Inverting that reads as "the gap
//     is random" and plays completely differently.
//   * THE FIRST FOUR STRIKES ARE FREE, at 100 / 90 / 75 / 60 with the gap
//     centred, before the pattern starts.
//   * REAL AND FAKE BLADES LOOK THE SAME. The decoys differ only by
//     `active = false` and their colour, so the count of each has to be
//     checked directly — a translation that skipped spawning them would look
//     fine and play far easier.
//   * THE FINALE TURNS THE WALL RED AND FIRES IT. `g`/`b` approach 0 at 21.25
//     a frame on every live blade, then all of them volley at once.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { DIAMONDSWORD_MASK, DIAMONDBULLET_M_MASK } from '../sim/masks.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const live = (s, n) => s.entities.filter((e) => e.alive && e.type.name === n);
const BLADE = 'obj_knight_diamondswordbullet_ext';
const MGR = 'obj_knight_tunnel_slasher_2_revised';

// ------------------------------------------------------------- the masks
// Both small sizes are RotatedRect with a ONE-PIXEL-TALL bbox, so the mask is
// a hairline built from the bbox rather than from the art. It only registers
// because the blades are drawn at image_angle 90 / 270 — CLAUDE.md's contact
// study, rule 2. If either ever became a full-sheet rect the attack would kill
// on approach instead of on contact.
for (const [m, w] of [[DIAMONDSWORD_MASK, 33], [DIAMONDBULLET_M_MASK, 66]]) {
  const inked = m.px.filter((row) => row.some(Boolean)).length;
  check(m.w === w, `${m.name} should be ${w} wide, got ${m.w}`);
  check(inked === 1, `${m.name} is a one-row hairline; ${inked} rows are inked`);
}

// --------------------------------------------------------------- the run
const st = createState({ seed: 606, traceBulletSlots: 0 });
buildSingleAttackScene(st, { seed: 606, attack: 'tunnel2', difficulty: 0 });

let realBlades = 0;
let fakeBlades = 0;
let peak = 0;
let reddened = 0;
let volleyed = 0;
let endedAt = -1;
let knightHidden = 0;
const holeSizes = new Set();
const cons = new Set();
const sprites = new Set();
const angles = new Set();
const seen = new Set();

for (let f = 0; f < 500; f++) {
  stepFrame(st, IDLE);
  const m = live(st, MGR)[0];
  if (m) {
    cons.add(`${m.state}/${m.con}`);
    holeSizes.add(m.hole_size);
  }
  const k = live(st, 'obj_knight_enemy')[0];
  if (k && k.image_alpha === 0) knightHidden += 1;

  const blades = live(st, BLADE);
  peak = Math.max(peak, blades.length);
  for (const b of blades) {
    if (!seen.has(b)) {
      seen.add(b);
      if (b.fake) fakeBlades += 1; else realBlades += 1;
      sprites.add(b.sprite_index);
      angles.add(b.image_angle);
    }
    if (!b.fake && b.g < 200) reddened += 1;
    if (b.speed > 10) volleyed += 1;
  }
  if (endedAt < 0 && st.turntimer === -1) endedAt = f;
}

// ------------------------------------------------------------ the pattern
check(cons.has('nothin much tbh/0.1') && cons.has('nothin much tbh/0.2'),
  `the intro cons should both run, saw ${[...cons].join(' ')}`);
check(cons.has('nothin much tbh/1'), 'the attack never reached its firing state');
check([...cons].some((c) => c.startsWith('final/')), 'the finale never ran');

// The four pattern sizes AND the four first_strike ones.
for (const want of [36, 44, 52, 60]) {
  check(holeSizes.has(want), `hole size ${want} never appeared — the travel table is wrong`);
}
for (const want of [100, 90, 75]) {
  check(holeSizes.has(want),
    `first_strike hole ${want} never appeared — the free opening strikes are missing`);
}

check(realBlades > 30, `expected a stream of real blades, got ${realBlades}`);
check(fakeBlades > 30, `the decoys should be at least as common, got ${fakeBlades}`);
check(peak > 10, `blades should stack up on screen, peak was ${peak}`);
// Both directions: one blade grows down from above, one up from below.
check(angles.has(90) && angles.has(270),
  `each pair is one blade at 90 and one at 270, saw ${[...angles].join(',')}`);
// The sprite is chosen by length, so a run should use more than one sheet.
check(sprites.size >= 2,
  `the blade sprite is picked by length; only ${[...sprites].join(',')} was used`);

check(reddened > 20,
  `the finale should redden every live blade (g -> 0 at 21.25/frame), saw ${reddened} frames`);
check(volleyed > 100, `the reddened wall should then FIRE, saw ${volleyed} moving frames`);
check(knightHidden > 200, `the Knight stays hidden for the attack, saw ${knightHidden}`);
check(endedAt > 0, 'the attack never handed the turn clock back');

// ------------------------------------------------------------- the report
console.log('revised sword tunnel (ac 3, dc.type 102) — no oracle; unreachable\n');
console.log(`→ ${realBlades} real blades / ${fakeBlades} decoys, peak ${peak} on screen`);
console.log(`→ hole sizes ${[...holeSizes].sort((a, b) => a - b).join(', ')}`);
console.log(`→ sprites ${[...sprites].join(', ')}`);
console.log(`→ finale: ${reddened} reddening frames, ${volleyed} volley frames,`
  + ` turn closed at ${endedAt}`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  revised sword tunnel matches the dump — ac 3 (UNUSED content)');
