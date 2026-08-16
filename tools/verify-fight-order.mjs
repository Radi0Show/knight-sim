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
const msgs = [];
let prev = null;
let gated = false;

// NO CONTACT EVER LANDS, so `progamer` stays true and this doubles as the
// FLAWLESS-RUN scenario. The phase order under test does not depend on the
// party taking damage, and the payoff is that the phase-4 message track —
// whose gating value only exists on a no-damage run — is checked end to end.
g.damageEnabled = false;

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
    // The line ON SCREEN as this turn opens — written at the end of the one
    // before it, exactly as the game writes `global.battlemsg[0]`.
    msgs.push(g.battlemsg);
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

// THE PHASE-4 MESSAGE TRACK, which is 1-BASED and was fed the 0-based row
// index — so every line arrived a turn late and `phase4turn == 3` was never
// reached. That value is the only thing the no-damage line hangs off:
//
//     if (phase4turn == 3 && progamer == true)
//         "* Kris coughed.&* The enemy slowly tilted its head..."
//
// Asserted from a RUN rather than by calling phase4Msg directly, because the
// pure function was always right — the call site was not, and a unit test on
// the function could never have caught it.
const PROGAMER = '* Kris coughed.&* The enemy slowly tilted its head...';
if (idx4 >= 0) {
  // The charge-up telegraph is up DURING ROARING (set at the charge-up's
  // end). A late track shows "Susie grew pale." here instead.
  if (msgs[idx4 + 2] !== "* The Knight's hands glow a strange color...") {
    gateFailures.push(`the ROARING turn read ${JSON.stringify(msgs[idx4 + 2])}, `
      + 'wanted the charge-up telegraph — the phase-4 message track is off by a turn');
  }
  // Nothing has touched the party, so progamer is intact and the finale line
  // replaces "The enemy suddenly let down its guard!".
  if (msgs[idx4 + 3] !== PROGAMER) {
    gateFailures.push(`after ROARING a flawless run read ${JSON.stringify(msgs[idx4 + 3])}, `
      + 'wanted the progamer line');
  }
  // And it STAYS up: phase4turn freezes at 3 and haveusedroaring keeps the
  // block alive, so the phase-3 flavour lines must not take the box back.
  if (msgs[idx4 + 4] !== undefined && msgs[idx4 + 4] !== PROGAMER) {
    gateFailures.push(`the turn after that read ${JSON.stringify(msgs[idx4 + 4])}, `
      + 'wanted the line to persist while the guard is down');
  }
  if (!g.knight.progamer) {
    gateFailures.push('progamer was cleared in a run where no contact was enabled');
  }
}

if (gateFailures.length) {
  for (const f of gateFailures) console.log(`→ FAILURE  ${f}`);
  console.log(`\n  turns seen: ${seen.join(' | ')}`);
  process.exit(1);
}

console.log(`→ phase 4 opened on the HP gate at turn ${idx4 + 1}, ran `
  + 'Rotating Slash → Charge-up → ROARING, then fell back to phase 3');
console.log('→ the gate is one-shot: no second phase 4 despite HP staying under 5840');
console.log('→ the flawless run earns "Kris coughed." on the guard drop, and it stays up');
// ── THE ORDER IS NOT RANDOM, AND THAT IS CHECKABLE ────────────────────────
//
// Issue #8 reports the opposite: "attack order is randomized, so the knight
// seems to pick from a pool of attacks that is randomized by phase markers".
// obj_knight_enemy's Other_10 — the selector, and the only thing that assigns
// `myattackchoice` — is 145 lines with no `random`, `choose`, `irandom` or
// `shuffle` anywhere in it: a flat run of `if (phaseturn == N)` branches with
// literal attack numbers. There is nothing in it to randomize.
//
// What DOES vary between runs, and is almost certainly what was seen:
//
//   * PHASE 3 LOOPS. Its `phaseturn == 5` sets `phaseturn = 0` and leaves
//     `phase` alone, so it repeats until the fight ends.
//   * PHASE 4 INTERRUPTS ON DAMAGE, not on a turn count — `monsterhp <= maxhp
//     * 0.8`, tested at the end of ANY turn — so where it cuts in depends on
//     how hard you have been hitting, which differs every run.
//   * ROARING then sets `phase = 3`, dropping you back into that loop, and
//     phase 4's own turn 1 is skipped when `rotatingslash3used` is set.
//
// So the same fixed table produces a different-looking sequence each time.
// The reporter's own observation that it always opens with Stars is what a
// fixed table predicts and a randomized pool does not.
//
// Asserted by construction: run the selector under several different seeds and
// require the order to be IDENTICAL. If randomness is ever introduced — by a
// translation slip or by "fixing" this report — these diverge immediately.
{
  const orders = [];
  for (const seed of [1, 12345, 777, 20260816]) {
    const st = createState({ seed, traceBulletSlots: 0 });
    buildPracticeScene(st, { seed });
    // `state.phase` is the director's own label — "phase N · turn M · Name" —
    // so recording it whenever it changes captures the sequence exactly as a
    // player would read it off the screen. THE MENU HAS TO BE DRIVEN, with the
    // same pulsed confirm the main loop uses: on idle input the party never
    // acts, the turn never ends, and the sweep sits on turn 1 forever. And the
    // party is topped up for the same reason as above — this is a turn-ORDER
    // question, not a survival one.
    const order = [];
    let last = null;
    let pulse = false;
    for (let f = 0; f < MAX_FRAMES && order.length < EXPECTED.length; f++) {
      let input = idle;
      if (st.menu?.open) { pulse = !pulse; input = { ...idle, confirm: pulse }; }
      stepFrame(st, input);
      st.partyHp = freshParty();
      st.gameOver = false;
      const label = String(st.phase ?? '');
      if (!label || label === last) continue;
      last = label;
      order.push(label);
    }
    orders.push(order.join(' | '));
  }
  const first = orders[0];
  const differing = orders.filter((o) => o !== first).length;
  if (differing > 0) {
    failures.push(
      `the attack order differs between seeds (${differing} of ${orders.length}`
      + ' runs diverged) — the selector has no RNG and must be identical',
    );
  }
  const turns = first ? first.split('|').length : 0;
  if (turns < EXPECTED.length) {
    failures.push(`the seed sweep only reached ${turns} of ${EXPECTED.length} turns`);
  }
  console.log(`→ ${turns} turns, identical across ${orders.length} seeds`
    + ' — the selector has no RNG (issue #8)');
}

if (failures.length) {
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}

console.log('\nPASS  the playable scene runs the real fight order end to end');
