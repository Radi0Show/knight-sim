#!/usr/bin/env node
// GETTING HIT TAKES HP OFF, on every attack in the fight.
//
// No oracle: the recordings carry an `inv` column but no party HP, and the
// harness that made them deliberately disables damage so the teeth cannot kill
// the party and lose the trace to a Game Over (CLAUDE.md). So this asserts the
// chain's ARITHMETIC against values computed by hand from the dump, and asserts
// that every attack's contact path actually reaches it.
//
// THE SECOND PART IS THE ONE THAT EARNS ITS KEEP. Wiring damage up the first
// time left two attacks dealing exactly zero across dozens of registered hits:
//
//   * obj_roaringknight_slash has its OWN Other_15, which was still the
//     "party hp is out of scope" stub — so rotating slash, the attack that
//     closes every phase, was harmless.
//   * the sword tunnel's swept probe counted `tunnelHits` and returned without
//     calling Other_15 at all, and once it did call it the handler's
//     `active == 1` gate threw the hit away, because the GML sets `active`
//     inside the sub-step loop and the translation had dropped it.
//
// Both looked exactly like "the player dodged well". Only a per-attack floor
// on damage tells the difference.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene, ATTACK_MENU } from '../sim/scenes/single.js';
import {
  PARTY, scrDamageCalculation, battleDf, scrDamageSingle, ACTION_DEFEND,
} from '../sim/damage.js';

const idle = { left: false, right: false, up: false, down: false, focus: false };
const failures = [];

// ---- the arithmetic, hand-computed from the dump ---------------------------
//
// Kris: df 2 (scr_gamestart) + weapon 0 + AmberCard 1 + ShadowMantle 3 = 6.
if (battleDf(0, true) !== 6) failures.push(`Kris battledf ${battleDf(0, true)}, expected 6`);
if (battleDf(0, false) !== 5) failures.push(`Kris unmantled battledf ${battleDf(0, false)}, expected 5`);

// maxhp 160 -> thresholds 32 and 20. A 1-damage bullet is under both, so all
// six defence steps take 1 each: 1 - 6 = -5, which the caller clamps to 1.
if (scrDamageCalculation(1, 0, true) !== -5) {
  failures.push(`calc(1) = ${scrDamageCalculation(1, 0, true)}, expected -5`);
}
// A 206-damage slash stays above 32 for all six steps: 206 - 18 = 188.
if (scrDamageCalculation(206, 0, true) !== 188) {
  failures.push(`calc(206) = ${scrDamageCalculation(206, 0, true)}, expected 188`);
}
// 30 sits between the thresholds, so steps take 2 — until the value REACHES
// 20, where `> b` is false and the last step takes 1: 28, 26, 24, 22, 20, 19.
// The boundary is exclusive, and assuming otherwise gives 18.
if (scrDamageCalculation(30, 0, true) !== 19) {
  failures.push(`calc(30) = ${scrDamageCalculation(30, 0, true)}, expected 19`);
}

// ---- every attack reaches the chain ----------------------------------------
const results = [];
for (const m of ATTACK_MENU) {
  const state = createState({ seed: 12345, traceBulletSlots: 0 });
  buildSingleAttackScene(state, { seed: 12345, attack: m.id, difficulty: m.difficulties[0] });
  // CUMULATIVE, not the final reading. Practice mode refills the party between
  // runs, so sampling HP at frame 600 lands wherever the refill left it — the
  // first version of this suite reported flurry and rotating slash as dealing
  // zero when they had in fact killed the party and been reset.
  let total = 0;
  let prev = [...state.partyHp];
  for (let f = 0; f < 600; f++) {
    stepFrame(state, idle);
    for (let i = 0; i < 3; i++) {
      if (state.partyHp[i] < prev[i]) total += prev[i] - state.partyHp[i];
    }
    prev = [...state.partyHp];
  }
  results.push([m.id, state.partyHp.join('/'), total]);
  if (total <= 0) {
    failures.push(`${m.id}: an idle party took NO damage in 600 frames`);
  }
}

// ---- DEFEND is the one button the scope can honour -------------------------
//
// Tested on the CHAIN, not through a turn: every bullet in the fight that hits
// an idle party lands at the 1-damage floor, and `ceil(2 * 1 / 3)` is still 1,
// so DEFEND is invisible at that size. It only shows on a real hit — the
// slash's 206.
function dealt(damage, action) {
  const state = createState({ seed: 1, traceBulletSlots: 0 });
  state.invTimer = -1;
  state.charaction = [action, 0, 0];
  return scrDamageSingle(state, damage, 0, {});
}
const plain = dealt(206, 0);
const defending = dealt(206, ACTION_DEFEND);
if (!(defending < plain)) {
  failures.push(`DEFEND took ${defending} where undefended took ${plain} — should be less`);
}
if (defending !== Math.ceil((2 * plain) / 3)) {
  failures.push(`DEFEND took ${defending}, expected ceil(2 * ${plain} / 3)`);
}

for (const [id, hp, total] of results) {
  console.log(`${id.padEnd(12)} ${hp.padEnd(18)} ${total} HP lost`);
}
console.log(`\nDEFEND: a 206 slash deals ${defending} vs ${plain} undefended`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  damage lands on every attack (no oracle — see header)');
