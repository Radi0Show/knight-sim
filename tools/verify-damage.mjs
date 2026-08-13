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
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { scrDamageMaxhp } from '../sim/damage.js';
import { knightCatch } from '../sim/knight.js';
import { createHeroes } from '../sim/heroes.js';
import { launchAttack } from '../sim/scenes/fight.js';
import { spawn } from '../sim/entity.js';
import { soul } from '../sim/soul.js';
import { SOUL_START } from '../sim/actors.js';

/**
 * A scene with a soul in it, for the scenarios that launch an attack DIRECTLY
 * rather than driving the director.
 *
 * `buildPracticeScene` no longer creates a soul: obj_heart is delivered per
 * bullet phase by the Knight (scr_moveheart) and does not exist during the
 * party's menu, so the director now spawns it at arena-open. These scenarios
 * skip the director entirely, so nothing delivers one — and the tracking
 * swords, which aim at the soul, return early every frame and never reach the
 * slash. That reads as "no slash spawned in 400 frames", which looks like a
 * damage-inheritance failure and is nothing of the sort.
 *
 * This suite is about what a hit is WORTH, not about when the soul exists, so
 * it supplies one directly.
 */
function sceneWithSoul(seed) {
  const s = createState({ seed, traceBulletSlots: 0 });
  buildPracticeScene(s, { seed });
  s.soul = spawn(s, soul, { ...SOUL_START });
  return s;
}

const NONE = {
  left: false, right: false, up: false, down: false,
  focus: false, confirm: false, cancel: false,
};
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


// ── THE INHERITANCE CHAIN ────────────────────────────────────────────────
//
// `scr_bulletspawner`: `__dc.damage = global.monsterat[myself] * 5;`
//
// The Knight's AT is 40, so every attack's controller carries **200**, and
// `scr_bullet_inherit` copies it all the way down:
//
//     dc.damage = 200 -> manager -> sword -> slash
//
// The last hop is the one that matters: `obj_tracking_sword_slash`'s own
// Create sets `damage = 1`, and its parent OVERWRITES it two lines after
// creating it. That 1 is dead code in the original — and it is exactly what
// this build kept, because it read each object's Create and never modelled
// the inheritance. Six of the seven attacks did one point of damage a hit.
{
  const s = sceneWithSoul(5);
  const owner = launchAttack(s, { ac: 11, difficulty: 0, name: 'Tracking Swords' });
  if (!owner) failures.push('the tracking manager did not launch');
  else if (owner.damage !== 200) {
    failures.push(`the manager carries ${owner.damage}, expected 200 (monsterat 40 x 5)`);
  }
  // And it must REACH the slash, whose own Create says 1.
  let slash = null;
  for (let f = 0; f < 400 && !slash; f++) {
    stepFrame(s, NONE);
    slash = s.entities.find((e) => e.alive && e.type.name === 'obj_tracking_sword_slash');
  }
  if (!slash) failures.push('no slash spawned in 400 frames');
  else if (slash.damage === 1) {
    failures.push("the slash kept its own damage = 1 — the parent's 200 never reached it");
  } else if (slash.damage !== 200) {
    failures.push(`the slash carries ${slash.damage}, expected 200`);
  }
}

// STARS IS THE EXCEPTION, and it is not a bug. `obj_dbulletcontroller` creates
// `obj_knight_pointing_cone` WITHOUT calling scr_bullet_inherit — it sets only
// `difficulty` — so the cone never receives 200 and its stars keep their own
// `damage = 1`. Stars really is chip damage; do not "fix" it to 200.
{
  const s = sceneWithSoul(5);
  const owner = launchAttack(s, { ac: 1, difficulty: 0, name: 'Stars' });
  if (owner && owner.damage === 200) {
    failures.push('the Stars cone inherited 200 — the controller does not pass it');
  }
}


// ── scr_damage_maxhp — THE SECOND DAMAGE ENTRY POINT ─────────────────────
//
// Flurry's slash calls `scr_damage_maxhp(0.66, false, true)`, and almost
// every rule differs from scr_damage: it is a FRACTION OF MAX HP, DF does
// nothing to it, the ShadowMantle halves the FRACTION rather than the result,
// and it can never fell you.
{
  const BARE = [{ weapon: 0, armor: [] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }];
  const mk = (gear) => {
    const s = createState({ seed: 1 });
    s.heroes = createHeroes();
    s.partyHp = [160, 190, 140];
    s.invTimer = -1;
    s.invc = 0.4;
    s.loadout = { gear };
    return s;
  };
  const pick = { target: 1, choose: (...x) => x[0] };

  // ceil(190 * 0.66) = 126, and DF does NOT reduce it.
  let s = mk(BARE);
  let d = scrDamageMaxhp(s, 0.66, false, true, pick);
  if (d !== 126) failures.push(`the 66% slash dealt ${d} to Susie, expected 126`);

  // THE MANTLE HALVES THE FRACTION: 0.66 -> 0.33, so ceil(190 * 0.33) = 63.
  // Halving the RESULT instead would give 63 too on this number — so check a
  // case where they differ: ceil(190*0.33)=63 vs ceil(ceil(190*0.66)/2)=63.
  // Use Kris's 160: ceil(160*0.33)=53 vs ceil(ceil(160*0.66)/2)=ceil(106/2)=53.
  // They agree; assert the value and the halving, which is what matters.
  s = mk([{ weapon: 0, armor: [] }, { weapon: 0, armor: [23] }, { weapon: 0, armor: [] }]);
  d = scrDamageMaxhp(s, 0.66, false, true, pick);
  if (d !== 63) failures.push(`the mantled 66% slash dealt ${d}, expected 63`);

  // IT CANNOT FELL. `clamp(tdamage, 1, hp - 1)` leaves at least 1 HP.
  s = mk(BARE);
  s.partyHp[1] = 20;
  d = scrDamageMaxhp(s, 0.66, false, true, pick);
  if (s.partyHp[1] !== 1) failures.push(`a 66% slash on 20 HP left ${s.partyHp[1]}, expected 1`);
  if (d !== 19) failures.push(`it dealt ${d}, expected 19`);

  // Without the cannotFell flag it CAN, which is what makes the flag load-bearing.
  s = mk(BARE);
  s.partyHp[1] = 20;
  scrDamageMaxhp(s, 0.66, false, false, pick);
  if (s.partyHp[1] > 0) failures.push('without cannotFell it should have felled Susie');

  // DEFEND is `/1.5`, not the `ceil(2t/3)` the ordinary path uses.
  s = mk(BARE);
  s.charaction[1] = ACTION_DEFEND;
  d = scrDamageMaxhp(s, 0.66, false, true, pick);
  if (d !== Math.ceil(126 / 1.5)) failures.push(`defending took ${d}, expected ${Math.ceil(126 / 1.5)}`);
  // ...and `ignoreDefend` skips it, which is how the Roaring finale ignores DEFEND.
  s = mk(BARE);
  s.charaction[1] = ACTION_DEFEND;
  d = scrDamageMaxhp(s, 0.66, true, true, pick);
  if (d !== 126) failures.push(`ignoreDefend still applied the reduction (${d})`);
}


// ── THE ROARING CATCH — obj_knight_enemy's event_user(2) ─────────────────
//
// A roaring star that touches you during the roar fires this instead of its
// own 206: 40 to every living member, clamped to `hp - 1` between 2 and 40.
{
  const BARE = [{ weapon: 0, armor: [] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }];
  const mk = (hp) => {
    const s = createState({ seed: 1 });
    s.heroes = createHeroes();
    s.partyHp = hp.slice();
    s.invTimer = -1;
    s.invc = 1;
    s.loadout = { gear: BARE };
    return s;
  };

  // It hits ALL THREE, not one — the generic handler hit one for 206.
  let s = mk([160, 190, 140]);
  knightCatch(s);
  if (s.partyHp.some((h, i) => h === [160, 190, 140][i])) {
    failures.push('the catch did not hit every member');
  }
  if (s.partyHp.some((h) => h <= 0)) failures.push('the catch felled a healthy party');

  // The clamp keeps 2..40 alive.
  s = mk([30, 5, 2]);
  knightCatch(s);
  if (s.partyHp.some((h) => h <= 0)) {
    failures.push(`the catch felled someone in the 2-40 band: ${s.partyHp.join('/')}`);
  }

  // AND IT DOES NOT COVER 1 HP. `hp > 1` is false there, so the full 40 lands.
  // Asserted because "cannot fell anyone" is the obvious reading of the clamp
  // and it is wrong at exactly the value where it matters.
  s = mk([1, 1, 1]);
  knightCatch(s);
  if (s.partyHp.every((h) => h > 0)) {
    failures.push('a party on 1 HP survived the catch — the clamp starts at 2');
  }

  // The fallen are skipped, not revived or re-hit.
  s = mk([160, -999, 140]);
  knightCatch(s);
  if (s.partyHp[1] !== -999) failures.push(`the catch touched a fallen member (${s.partyHp[1]})`);
}

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  damage lands on every attack (no oracle — see header)');
