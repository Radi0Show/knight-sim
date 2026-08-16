#!/usr/bin/env node
// The underbox attack (ac 6, dc.type 106) — obj_knight_weird_bottom_manager.
//
// NO ORACLE. Nothing in the selector can reach ac 6, so there is no recording
// to diff against and there never will be one without a debug build. What this
// pins instead is every claim sim/attacks/underbox.js makes about the dump,
// each in a form that fails if the translation drifts:
//
//   * the ELLIPSE — the vertical term of the orbit is a QUARTER of the
//     horizontal (`lengthdir_y(distance * 0.25, ...)`), which is the whole
//     reason the ring reads as being under the arena. A plain circle would
//     put orbs level with the soul.
//   * the VOLLEY — eleven bullets, one big and two fans, with the second fan's
//     middle two SKIPPED. The `continue` is a one-line difference between a
//     pattern with an answer and a wall.
//   * the ACCELERATION — `gravity_direction = direction` means the big shot
//     speeds up along its own line rather than arcing. Gravity applied on the
//     default downward direction looks nearly identical for the first dozen
//     frames and completely wrong after.
//   * the RE-ARMED GRAZE — `if ((timer % 3) == 0) grazed = 0`, so the big shot
//     pays repeatedly. Without it the attack's TP falls to a third.
//   * the SPIN LURCH — obj_lerpvar's "inout" arm, which THREW until this
//     attack needed it. A silent revert to the old behaviour would be an
//     exception, but a wrong easing curve would not, so the curve is checked
//     directly as well.
//   * the HANDBACK — the Knight is warped out by the controller and only the
//     manager's destroy gives him his alpha and the turn clock back.
//
// Positive-execution rule (CLAUDE.md): each assertion below counts something
// that must have happened, not merely the absence of a divergence.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { scrEaseInout, scrEaseOut, scrEaseIn } from '../sim/gml.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const live = (s, n) => s.entities.filter((e) => e.alive && e.type.name === n);

// ---------------------------------------------------------------- the easing
// scr_ease_inout curve 2 = the generic split: 0.5 * ease_in on the first half,
// 0.5 * (ease_out + 1) on the second. Endpoints and the midpoint are exact,
// and the quarter point must NOT be linear — that is what separates it from
// easetype 0, which is the value the old code effectively produced by
// throwing before anything could use it.
check(scrEaseInout(0, 2) === 0, 'scr_ease_inout(0, 2) should be 0');
check(scrEaseInout(1, 2) === 1, 'scr_ease_inout(1, 2) should be 1');
check(scrEaseInout(0.5, 2) === 0.5, 'scr_ease_inout(0.5, 2) should be 0.5');
check(Math.abs(scrEaseInout(0.25, 2) - 0.125) < 1e-12,
  'scr_ease_inout(0.25, 2) should be 0.5 * ease_in(0.5, 2) = 0.125');
check(Math.abs(scrEaseInout(0.75, 2) - 0.875) < 1e-12,
  'scr_ease_inout(0.75, 2) should be 0.5 * (ease_out(0.5, 2) + 1) = 0.875');
check(scrEaseInout(0.25, 2) !== 0.25, 'curve 2 inout must not be linear');
// Out of range returns the input untouched, same guard as its two siblings.
check(scrEaseInout(0.4, 9) === 0.4, 'scr_ease_inout out-of-range should pass through');
check(scrEaseIn(0.5, 2) === 0.25 && scrEaseOut(0.5, 2) === 0.75,
  'the two halves it is built from should be unchanged');

// ------------------------------------------------------------------- the run
const state = createState({ seed: 20260816, traceBulletSlots: 0 });
buildSingleAttackScene(state, { seed: 20260816, attack: 'underbox', difficulty: 0 });

let maxOrbs = 0;
let maxDx = 0;
let maxDy = 0;
let volleys = 0;
let bigShots = 0;
let fanShots = 0;
let spinPeak = 0;
let inoutTweens = 0;
let bigSpeedStart = null;
let bigSpeedLate = null;
let knightHiddenFrames = 0;
let managerFrames = 0;
let turnReleasedAt = -1;
const fanDirections = new Set();
let prevBullets = 0;

for (let f = 0; f < 420; f++) {
  stepFrame(state, IDLE);

  const mgr = live(state, 'obj_knight_weird_bottom_manager')[0];
  const orbs = live(state, 'obj_knight_weird_circle');
  const bigs = live(state, 'obj_knight_weird_circle_bullet');
  const fans = live(state, 'obj_knight_weird_fan');
  const knight = live(state, 'obj_knight_enemy')[0];

  if (mgr) {
    managerFrames += 1;
    maxOrbs = Math.max(maxOrbs, orbs.length);
    spinPeak = Math.max(spinPeak, Math.abs(mgr.spin));
    for (const o of orbs) {
      maxDx = Math.max(maxDx, Math.abs(o.x - mgr.center_x));
      maxDy = Math.max(maxDy, Math.abs(o.y - mgr.center_y));
    }
  }
  if (knight && knight.image_alpha === 0) knightHiddenFrames += 1;

  // POSITIVE EXECUTION ASSERTION for obj_lerpvar's newly translated arm: the
  // spin lurch must really be running through `easeinout === "inout"`, not
  // quietly falling into the default "out". Both reach +-12, so the peak
  // above cannot tell them apart.
  for (const t of live(state, 'obj_lerpvar')) {
    if (t.easeinout === 'inout' && t.varname === 'spin') inoutTweens += 1;
  }

  // A volley is the frame the bullet count jumps — the whole fan spawns in one
  // alarm, so this counts alarms, not bullets that happen to coexist.
  const total = bigs.length + fans.length;
  if (total - prevBullets >= 8) volleys += 1;
  prevBullets = total;

  for (const b of fans) fanDirections.add(Math.round(b.direction * 100) / 100);
  bigShots = Math.max(bigShots, bigs.length);
  fanShots = Math.max(fanShots, fans.length);

  // The big shot's speed, sampled on the same instance twice.
  const youngest = bigs[bigs.length - 1];
  if (youngest && youngest.timer === 1) bigSpeedStart = youngest.speed;
  if (youngest && youngest.timer === 20) bigSpeedLate = youngest.speed;

  if (turnReleasedAt < 0 && state.turntimer === -1 && managerFrames > 0) {
    turnReleasedAt = f;
  }
}

// --------------------------------------------------------------- the ellipse
check(maxOrbs === 5, `the ring should hold five orbs, saw ${maxOrbs}`);
check(Math.abs(maxDx - 120) < 1.5,
  `the orbit's horizontal reach should be circle_distance 120, saw ${maxDx.toFixed(2)}`);
check(Math.abs(maxDy - 30) < 1.5,
  `the orbit's vertical reach should be 120 * 0.25 = 30, saw ${maxDy.toFixed(2)}`);
check(maxDy < maxDx / 3,
  'the orbit must be FLATTENED — a round one puts the orbs level with the soul');

// ---------------------------------------------------------------- the volley
check(volleys >= 8, `expected at least 8 volleys in 420 frames, counted ${volleys}`);
check(bigShots >= 1, 'the big spr_knight_weird_shape shot never spawned');
check(fanShots >= 8, `expected the fans to stack up, peak was ${fanShots}`);

// The five-wide fan at 27.5 + 31.25a, and the three FIRED of the four-wide at
// 40 + 33.33a — a == 1 (73.33) and a == 2 (106.67) are skipped.
for (let a = 0; a < 5; a++) {
  const d = Math.round((27.5 + 31.25 * a) * 100) / 100;
  check(fanDirections.has(d), `the first fan should include direction ${d}`);
}
for (const a of [0, 3]) {
  const d = Math.round((40 + 33.333333333333336 * a) * 100) / 100;
  check(fanDirections.has(d), `the second fan should include direction ${d}`);
}
for (const a of [1, 2]) {
  const d = Math.round((40 + 33.333333333333336 * a) * 100) / 100;
  check(!fanDirections.has(d),
    `direction ${d} is SKIPPED by the second fan's continue — the gap is the answer`);
}

// ---------------------------------------------------------- the acceleration
check(bigSpeedStart !== null && bigSpeedLate !== null,
  'never sampled the big shot at timer 1 and timer 20');
if (bigSpeedStart !== null && bigSpeedLate !== null) {
  check(bigSpeedLate > bigSpeedStart + 3,
    `gravity_direction = direction should ACCELERATE the big shot along its `
    + `own line: ${bigSpeedStart} -> ${bigSpeedLate} after 19 frames`);
}

// ------------------------------------------------------------- the re-arming
// A fresh run with the soul parked in the fan's path: the big shot's graze
// must pay more than once, which only the `timer % 3` reset allows.
const g = createState({ seed: 20260816, traceBulletSlots: 0 });
buildSingleAttackScene(g, { seed: 20260816, attack: 'underbox', difficulty: 0 });
//
// The measurement has to be a 1 -> 0 TRANSITION on a bullet that has already
// grazed. An earlier version counted frames where `grazed === 0` on a multiple
// of 3, which is true of every bullet that has never been grazed at all — it
// stayed green with the re-arm deleted, i.e. it measured nothing. Nothing else
// in the engine clears `grazed` (sim/tension.js sets it and never unsets it;
// scr_bullet_inherit only touches it at spawn), so a transition here can only
// come from this bullet's own `timer % 3` line.
let grazeStarts = 0;
let grazeResets = 0;
let sawArmed = false;
const wasGrazed = new Map();
for (let f = 0; f < 420; f++) {
  // Drift so the soul actually meets bullets; a parked soul earns nothing.
  stepFrame(g, { ...IDLE, left: (f % 60) < 30 ? 1 : 0, right: (f % 60) < 30 ? 0 : 1 });
  for (const b of live(g, 'obj_knight_weird_circle_bullet')) {
    const before = wasGrazed.get(b) ?? 0;
    if (before && !b.grazed) grazeResets += 1;
    if (!before && b.grazed) grazeStarts += 1;
    wasGrazed.set(b, b.grazed);
    if (b.grazepoints === 12) sawArmed = true;
  }
}
check(grazeStarts >= 2,
  `the soul should graze the big shot at least twice, saw ${grazeStarts}`);
check(grazeResets >= 2,
  `the big shot should re-arm its graze (1 -> 0) every third frame, saw ${grazeResets}`);
check(sawArmed, 'the big shot should carry grazepoints 12');

// ---------------------------------------------------------------- the lurch
check(spinPeak > 8,
  `spin should lurch out toward choose(-12, 12); peak |spin| was ${spinPeak.toFixed(2)}`);
check(inoutTweens > 40,
  `the spin lerps should run on obj_lerpvar's "inout" arm; counted `
  + `${inoutTweens} live tween-frames`);

// -------------------------------------------------------------- the handback
check(knightHiddenFrames > 250,
  `the Knight should stay warped out for the whole attack, hidden ${knightHiddenFrames} frames`);
check(turnReleasedAt > 0,
  'the manager Destroy never set global.turntimer back to -1 — the turn would never end');
const finalKnight = live(state, 'obj_knight_enemy')[0];
check(finalKnight && finalKnight.image_alpha === 1,
  'the Knight never got his alpha back; obj_knight_warp event_user(1) does not restore it');
check(live(state, 'obj_knight_weird_circle').length === 0,
  'orbs outlived the attack');

// --------------------------------------------------------------------- report
console.log('underbox (ac 6, dc.type 106) — no oracle; unreachable content\n');
console.log(`→ ring: ${maxOrbs} orbs, reach ${maxDx.toFixed(1)} x ${maxDy.toFixed(1)} (ellipse 4:1)`);
console.log(`→ ${volleys} volleys, peak ${fanShots} fan bullets, ${fanDirections.size} distinct directions`);
console.log(`→ big shot ${bigSpeedStart} -> ${bigSpeedLate} over 19 frames, `
  + `${grazeStarts} grazes / ${grazeResets} re-arms`);
console.log(`→ spin peak ${spinPeak.toFixed(2)} over ${inoutTweens} "inout" tween-frames, `
  + `turn released at frame ${turnReleasedAt}`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  underbox mechanics match the dump — ac 6 (UNUSED content)');
