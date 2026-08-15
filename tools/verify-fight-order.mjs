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
];
// PHASE 4 IS DELIBERATELY ABSENT, because it is not reached by playing turns.
// The gate is `monsterhp <= maxhp * 0.8` at the end of ANY turn, so a party
// that deals no damage loops phase 3 forever — which is what the real fight
// does, and what the removed `turnsRun >= 15` fallback used to paper over.
// Phase 4 gets its own scenario at the bottom, where the Knight's HP is
// actually driven down and the gate has something to fire on.

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

// ---------------------------------------------------------------------------
// PHASE 4, which is reached by DAMAGE and not by counting turns.
//
// Four things the selector does here that a table cannot express, and that the
// previous version of this suite got wrong in all four:
//
//   1. the gate fires at the end of ANY turn, not at a phase boundary
//   2. `phase4turn == 1` is SKIPPED when `rotatingslash3used` is set, so a
//      fight that finished a phase-3 loop opens on the CHARGE-UP
//   3. the charge-up turn (`myattackchoice == -1`) puts NOTHING on screen —
//      no arena, no bullets — so the "every turn spawns bullets" rule above
//      genuinely does not apply to it
//   4. ROARING sets `phase = 3`, so the fight falls back into the phase-3
//      loop rather than ending or restarting
// ---------------------------------------------------------------------------

const g = createState({ seed: 12345, traceBulletSlots: 0 });
buildPracticeScene(g, { seed: 12345 });

const gateFailures = [];
const seen = [];
let prev = null;
let gated = false;

for (let f = 0; f < 30000 && seen.length < 24; f++) {
  stepFrame(g, menuInput(g));
  g.partyHp = freshParty();
  g.gameOver = false;

  // Drive the Knight to the gate once the fight is properly under way, which
  // is what the party's own damage does over a real fight. Held one point
  // ABOVE the threshold until then, so the gate cannot fire early and the
  // test is measuring the gate rather than the starting HP.
  if (!gated && seen.length >= 6) {
    g.knight.hp = 5840;
    gated = true;
  } else if (!gated) {
    g.knight.hp = 5841;
  }

  if (g.phase !== prev) {
    seen.push(g.phase);
    prev = g.phase;
  }
}

const idx4 = seen.findIndex((t) => t.startsWith('phase 4'));
if (idx4 < 0) {
  gateFailures.push(`phase 4 never opened after HP hit 5840 (saw: ${seen.slice(-6).join(' | ')})`);
} else {
  // rotatingslash3used is false here — the gate trips during phase 1/2, long
  // before phase 3's turn 5 — so phase 4 must open on the ROTATING SLASH.
  if (!seen[idx4].endsWith('Rotating Slash')) {
    gateFailures.push(`phase 4 opened on "${seen[idx4]}", wanted the Rotating Slash `
      + '(rotatingslash3used is false when the gate trips this early)');
  }
  if (!seen[idx4 + 1]?.endsWith('Charge-up')) {
    gateFailures.push(`phase 4 turn 2 was "${seen[idx4 + 1]}", wanted the Charge-up`);
  }
  if (!seen[idx4 + 2]?.endsWith('ROARING')) {
    gateFailures.push(`phase 4 turn 3 was "${seen[idx4 + 2]}", wanted ROARING`);
  }
  // `phase = 3` inside the ROARING branch.
  if (seen[idx4 + 3] && !seen[idx4 + 3].startsWith('phase 3')) {
    gateFailures.push(`after ROARING the fight went to "${seen[idx4 + 3]}", wanted phase 3`);
  }
  // AND THE SCHEDULE RESUMES, IT DOES NOT REWIND. The selector's first line
  // is `if (phase != 4) { turn++; phaseturn++; }`, so phaseturn FREEZES
  // through phase 4 and ROARING's `phase = 3` does not reset it. The gate
  // trips here at the end of phase 2's first turn (frozen phaseturn 1), so
  // the post-ROARING turn is phase 3's ROW 2 — Flurry, difficulty 3 — not a
  // restart at Stars. Restarting at Stars is exactly the bug that made
  // Flurry d3 unseeable in play: the fight ends on the first hit after
  // ROARING, which always landed during the spurious Stars turn.
  if (seen[idx4 + 3] && !seen[idx4 + 3].endsWith('Flurry')) {
    gateFailures.push(`after ROARING the fight resumed on "${seen[idx4 + 3]}", `
      + 'wanted phase 3 turn 2 (Flurry d3) — the frozen phaseturn, one on');
  }
}

// The gate is ONE-SHOT: `haveusedroaring == false` is part of it, so the loop
// back into phase 3 must not re-enter phase 4 even though HP is still under
// the threshold. Without that term the fight ends up in a ROARING loop.
if (idx4 >= 0 && seen.slice(idx4 + 3).some((t) => t.startsWith('phase 4'))) {
  gateFailures.push('phase 4 was entered TWICE — the haveusedroaring guard is not holding');
}

if (gateFailures.length) {
  for (const f of gateFailures) console.log(`→ FAILURE  ${f}`);
  console.log(`\n  turns seen: ${seen.join(' | ')}`);
  process.exit(1);
}

console.log(`→ phase 4 opened on the HP gate at turn ${idx4 + 1}, ran `
  + 'Rotating Slash → Charge-up → ROARING, then fell back to phase 3');
console.log('→ the gate is one-shot: no second phase 4 despite HP staying under 5840');
console.log('\nPASS  the playable scene runs the real fight order end to end');
