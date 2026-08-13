#!/usr/bin/env node
// THE TRACKING SWORDS' ANTI-REPEAT WHEEL (task #8).
//
// `obj_tracking_swords_manager` picks each sword's heading with
// `choose(0, 45, ..., 315)` and then runs it past the last eight:
//
//     repeat (8)
//         for (i = 0; i < 8; i++)
//             if (inst.direction == directionprev[i]) inst.direction += 45;
//
// then records it and FORGETS the three slots ahead. That is what stops the
// same corner firing twice running, and it is the difference between an attack
// that is hard and one that is unfair.
//
// WHY THIS SUITE EXISTS AND WHAT IT CANNOT DO. The oracle recordings replay
// POST-wheel headings (tools/scenes/oracle-tracking.js), so no trace diff can
// see this mechanism at all — it could be deleted entirely and every other
// suite would stay green. There is no recording to diff against, so this
// asserts the wheel's OBSERVABLE GUARANTEE and its execution instead, and says
// so rather than claiming an oracle result.
//
// The statistical bound is the load-bearing one: with eight headings chosen
// uniformly, immediate repeats would land at 12.5%. The wheel drops them to
// under 1%. That gap cannot be produced by a wheel that is not running.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';

const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const idle = { left: false, right: false, up: false, down: false, focus: false };

const dirs = [];
let nudges = 0;

for (let seed = 1; seed <= 6; seed++) {
  const state = createState({ seed, traceBulletSlots: 0 });
  buildSingleAttackScene(state, { seed, attack: 'tracking11', difficulty: 0 });
  const seen = new Set();
  // ACCUMULATED PER MANAGER, DURING the run. Reading `wheelNudges` off
  // whichever manager exists at the end samples a single instance — and
  // practice mode relaunches the attack, so a run that happens to end just
  // after a respawn reports zero. That is exactly what happened when grazing
  // started subtracting `timepoints` from the turn clock: turns got shorter,
  // the cycle shifted, and all six seeds landed on a fresh manager.
  const nudgesByManager = new Map();
  for (let f = 0; f < 3000; f++) {
    stepFrame(state, idle);
    for (const s of state.entities) {
      if (s.alive && s.type.name === 'obj_tracking_sword1' && !seen.has(s)) {
        seen.add(s);
        dirs.push(s.direction);
      }
      if (s.type.name === 'obj_tracking_swords_manager') {
        nudgesByManager.set(s, s.wheelNudges ?? 0);
      }
    }
  }
  for (const n of nudgesByManager.values()) nudges += n;
}

const failures = [];

// 1. EVERY heading is one of the eight. This is the assertion that catches the
//    missing [0,360) wrap on `direction`: without it `315 + 45` stores 360
//    instead of 0, which matches nothing in the history, so the wheel stops
//    nudging on that heading AND the sword flies at an angle the game cannot
//    produce. Sabotage-checked by removing ANGLE_BUILTINS from sim/entity.js.
const bad = [...new Set(dirs.filter((d) => !HEADINGS.includes(d)))];
if (bad.length) failures.push(`headings outside the eight: ${bad.join(', ')}`);

// 2. All eight get used — a wheel that jams would collapse the range.
const used = new Set(dirs);
if (used.size !== 8) failures.push(`only ${used.size} of 8 headings ever used`);

// 3. The wheel RAN. Positive execution assertion.
if (nudges < 50) failures.push(`the wheel nudged only ${nudges} times (expected many)`);

// 4. Its guarantee. Uniform choice gives 12.5% immediate repeats.
let repeats = 0;
for (let i = 1; i < dirs.length; i++) if (dirs[i] === dirs[i - 1]) repeats += 1;
const rate = repeats / (dirs.length - 1);
if (rate > 0.03) {
  failures.push(
    `immediate repeats ${(rate * 100).toFixed(1)}% — chance is 12.5%, the wheel should be under 3%`,
  );
}

console.log(`${dirs.length} swords over 6 seeds, ${nudges} wheel nudges`);
console.log(`immediate repeats: ${repeats} (${(rate * 100).toFixed(2)}%), chance would be 12.5%`);
console.log(`headings used: ${[...used].sort((a, b) => a - b).join(' ')}`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}

console.log('\nPASS  the anti-repeat wheel runs and holds (no oracle — see header)');
