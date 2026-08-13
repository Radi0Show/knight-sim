#!/usr/bin/env node
// EVERY ATTACK CAN BE GRAZED, and grazing shortens the turn.
//
// No oracle — the recordings have no tension column. What this pins is that the
// graze box can SEE each attack's bullets, which is where it kept failing:
//
//   * obj_tracking_sword1 never set `isBullet`, so the sword you spend the
//     whole attack manoeuvring around was invisible to both the graze pass and
//     the collision phase.
//   * obj_roaringknight_slash sets no `mask` — its own hit test names SLASH_MASK
//     directly — so the 640px wedge that IS rotating slash paid nothing.
//   * and the first graze test compared axis-aligned bounding boxes, which for
//     the tracking slash (a 900x1 bar drawn at 45 degrees) is a horizontal strip
//     that never meets the soul.
//
// All three read as "this attack just does not graze much". The floor below is
// what tells them apart.
//
// THE SOUL HAS TO MOVE. The graze is gated on `global.inv < 0`, so a stationary
// soul being hit continuously earns almost nothing — an idle run reports zero
// for the very attacks that hit hardest, which is faithful and useless as a
// test. This walks a square.

import * as TRACKING from '../sim/attacks/tracking-swords.js';
import { spawn } from '../sim/entity.js';
import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene, ATTACK_MENU } from '../sim/scenes/single.js';
import { MAX_TENSION } from '../sim/tension.js';

let tick = 0;
function dodge() {
  tick += 1;
  const p = Math.floor(tick / 18) % 4;
  return { left: p === 0, up: p === 1, right: p === 2, down: p === 3, focus: false };
}

const failures = [];
const rows = [];

for (const m of ATTACK_MENU) {
  tick = 0;
  const state = createState({ seed: 12345, traceBulletSlots: 0 });
  buildSingleAttackScene(state, { seed: 12345, attack: m.id, difficulty: m.difficulties[0] });

  let peak = 0;
  let flashed = 0;
  for (let f = 0; f < 600; f++) {
    stepFrame(state, dodge());
    if (state.tension > peak) peak = state.tension;
    if (state.grazeTimer > 0) flashed += 1;
  }

  rows.push([m.id, Math.round(peak), state.grazeCount, flashed]);
  if (state.grazeCount === 0) {
    failures.push(`${m.id}: NOTHING grazed in 600 frames — the box cannot see this attack`);
  }
  if (peak <= 0) failures.push(`${m.id}: no TP earned`);
  if (flashed === 0) failures.push(`${m.id}: the graze ring never appeared`);
}

// GRAZING SHORTENS THE TURN — `global.turntimer -= timepoints`. That is the
// mechanic, not the TP.
//
// Measured against the CLOCK ITSELF rather than against a still soul: standing
// still in the vortex grazes MORE than moving does (bullets sweep through the
// box while you sit in their path), so "still" is not a control — the first
// version of this check asserted the wrong direction and failed.
//
// The turn clock ticks down exactly 1 a frame on its own, so anything beyond
// `frames` came from timepoints.
tick = 0;
const g = createState({ seed: 7, traceBulletSlots: 0 });
buildSingleAttackScene(g, { seed: 7, attack: 'vortex', difficulty: 0 });
let clockStart = null;
const FRAMES = 200;
for (let f = 0; f < FRAMES; f++) {
  stepFrame(g, dodge());
  if (clockStart === null && g.turntimer > 0) clockStart = g.turntimer + f + 1;
}
const spent = clockStart - g.turntimer;
if (!(spent > FRAMES)) {
  failures.push(
    `the turn clock lost ${spent.toFixed(1)} over ${FRAMES} frames — grazing subtracted nothing`,
  );
}

for (const [id, tp, n, flash] of rows) {
  console.log(`${id.padEnd(13)} TP ${String(tp).padStart(3)}/${MAX_TENSION}  ${String(n).padStart(3)} grazes  ring up ${flash} frames`);
}
console.log(`\nturn clock: ${spent.toFixed(1)} spent over ${FRAMES} frames — ${(spent - FRAMES).toFixed(1)} of it from grazing`);


// ── GRAZEPOINTS ARE HALVED DURING THE VORTEX TURN ────────────────────────
//
// obj_tracking_sword_slash's Create:
//
//     grazepoints = 4;
//     if (i_ex(obj_sword_vortex_manager)) grazepoints = 2;
//     if (i_ex(obj_tracking_swords_manager) && variant == 1) grazepoints = 2;
//
// ac 15 chains the vortex and the tracking swords, so the vortex manager is
// alive while the slashes spawn and every one pays HALF. This build hardcoded
// the un-halved 4, which double-counted TP for the whole of phase 2 turn 9 —
// and a 900px bar sweeping the arena is a lot of graze frames to double.
{
  const slash = Object.values(TRACKING).find(
    (v) => v && v.name === 'obj_tracking_sword_slash',
  );
  const fresh = () => createState({ seed: 1 });

  let s = fresh();
  let e = spawn(s, slash, { x: 0, y: 0 });
  if (e.grazepoints !== 4) failures.push(`a lone slash pays ${e.grazepoints}, expected 4`);

  s = fresh();
  spawn(s, { name: 'obj_sword_vortex_manager', create() {} }, { x: 0, y: 0 });
  e = spawn(s, slash, { x: 0, y: 0 });
  if (e.grazepoints !== 2) failures.push(`during ac 15 the slash pays ${e.grazepoints}, expected 2`);

  s = fresh();
  spawn(s, { name: 'obj_tracking_swords_manager', create(x) { x.variant = 1; } }, { x: 0, y: 0 });
  e = spawn(s, slash, { x: 0, y: 0 });
  if (e.grazepoints !== 2) failures.push(`at variant 1 the slash pays ${e.grazepoints}, expected 2`);
}

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  every attack can be grazed (no oracle — see header)');
