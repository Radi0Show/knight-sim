#!/usr/bin/env node
// The playable scene runs THE REAL FIGHT, start to finish, without hanging.
//
// Not an oracle diff — there is no recording of a whole fight, and the turn
// system this walks is explicitly a stand-in (sim/scenes/fight.js header). What
// it does check is everything that would be embarrassing to get wrong in the
// shipped build:
//
//   * every turn of the selector's table is visited, in order, with the right
//     difficulty — the table is the one thing here that IS ground truth
//   * each attack actually puts bullets on screen, so a turn cannot "pass" by
//     launching nothing
//   * the arena is moved and rescaled per attack, which three of them do
//   * no turn hangs
//
// The last one has teeth. Waiting for the arena to empty hung the Stars turn
// for 1,500 frames, because its 96 starchildren home in on the soul and hover
// there rather than leaving the screen.

import { createState, stepFrame } from '../sim/index.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { FIGHT_TABLE } from '../sim/scenes/fight.js';
import { freshParty } from '../sim/damage.js';

const EXPECTED = [
  ...FIGHT_TABLE[1].map((t) => ({ phase: 1, ...t })),
  ...FIGHT_TABLE[2].map((t) => ({ phase: 2, ...t })),
  ...FIGHT_TABLE[3].map((t) => ({ phase: 3, ...t })),
  ...FIGHT_TABLE[4].map((t) => ({ phase: 4, ...t })),
];

const MAX_FRAMES = 20000;
/**
 * No single turn may take longer than this.
 *
 * ROARING is the long one at ~950 frames, and legitimately so: controller type
 * 107 sets `global.turntimer = 999999` and the attack ends its own turn at
 * roaring_timer 375. Rotating slash does the same. Every other turn is 288-485.
 * The limit exists to catch a turn that HANGS, not to police length.
 */
const TURN_LIMIT = 1400;

const state = createState({ seed: 12345, traceBulletSlots: 0 });
buildPracticeScene(state, { seed: 12345 });
const idle = { left: false, right: false, up: false, down: false, focus: false };

/**
 * THE MENU IS PART OF THE TURN NOW, so the fight cannot advance on idle input:
 * each of the three party members has to confirm before the enemy attacks.
 *
 * `confirm` is edge-triggered — a held key must not skip three characters in
 * three frames — so this pulses it, pressed on even frames and released on
 * odd. That also exercises the edge detection: a version that read the key
 * level-triggered would blow through the whole menu on the first frame and
 * this suite would stop proving the menu runs at all.
 */
let confirmPulse = false;
function menuInput(state) {
  if (!state.menu?.open) return idle;
  confirmPulse = !confirmPulse;
  return { ...idle, confirm: confirmPulse };
}

const visited = [];
const failures = [];
let last = null;
let turnStart = 0;
let peakBullets = 0;
let bulletsThisTurn = 0;
const arenas = new Set();

for (let f = 0; f < MAX_FRAMES && visited.length <= EXPECTED.length; f++) {
  stepFrame(state, menuInput(state));

  // KEPT ALIVE ON PURPOSE. This suite checks the SELECTOR'S ORDER, and an idle
  // party now dies partway through phase 1 — rotating slash alone wipes it.
  // Topping HP up each frame is not pretending damage does not happen
  // (verify-damage.mjs asserts that it does); it is refusing to let a survival
  // question decide a turn-order question.
  state.partyHp = freshParty();
  state.gameOver = false;

  const live = state.entities.filter(
    (e) => e.alive && e.isBullet && e.type.name !== 'obj_heart',
  ).length;
  if (live > peakBullets) peakBullets = live;
  if (live > bulletsThisTurn) bulletsThisTurn = live;

  const gt = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
  if (gt) arenas.add(`${gt.x},${gt.y},${gt.image_xscale},${gt.image_yscale}`);

  if (state.phase !== last) {
    if (last !== null) {
      const took = f - turnStart;
      if (took > TURN_LIMIT) {
        failures.push(`turn "${last}" took ${took} frames (limit ${TURN_LIMIT})`);
      }
      if (bulletsThisTurn === 0) {
        failures.push(`turn "${last}" put NOTHING on screen`);
      }
    }
    visited.push(state.phase);
    last = state.phase;
    turnStart = f;
    bulletsThisTurn = 0;
  }
}

// ---- compare against the selector's table ---------------------------------

for (let i = 0; i < Math.min(visited.length, EXPECTED.length); i++) {
  const want = EXPECTED[i];
  const got = visited[i];
  const expectText = `phase ${want.phase} · turn ${(i % 5) + 1} · ${want.name}`;
  if (!got.startsWith(`phase ${want.phase} ·`) || !got.endsWith(want.name)) {
    failures.push(`turn ${i + 1}: expected "${expectText}", got "${got}"`);
    break;
  }
}

if (visited.length < EXPECTED.length) {
  failures.push(
    `only ${visited.length} of ${EXPECTED.length} turns ran within ${MAX_FRAMES} frames`,
  );
}

console.log(`turns: ${visited.length} of ${EXPECTED.length}\n`);

if (failures.length) {
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}

// Three attacks move or resize the arena (Stars, tracking swords, sword
// tunnel). If the scheduler stopped applying the per-attack arena setup this
// would collapse toward one entry.
if (arenas.size < 4 || peakBullets < 20) {
  console.log(`EXECUTION ASSERTION FAILED: arenas=${arenas.size} peakBullets=${peakBullets}`);
  console.log('  expected >= 4 distinct arena setups and >= 20 bullets at once');
  process.exit(1);
}

console.log(`→ all ${EXPECTED.length} turns in the selector's order, none over ${TURN_LIMIT} frames`);
console.log(`→ ${arenas.size} distinct arena setups, peak ${peakBullets} bullets alive`);
console.log('\nPASS  the playable scene runs the real fight order end to end');
