#!/usr/bin/env node
// WHAT YOUR ATTACKS ARE WORTH — obj_heroparent's Step and scr_spell.
//
// These formulas were carried as "spec-sourced, NOT dump-confirmed" for a
// while. Reading them corrected TWO things, and this suite exists so neither
// can drift back:
//
// 1. THE SWOON SCALING IS KRIS ONLY. The x0.5 / x1 / x2 block sits inside
//    `if (object_index == obj_herokris)`. Applying it party-wide — which is
//    what this project did — roughly doubled the party's output in the common
//    case, since the healthy-party branch HALVES and it was halving everyone.
//
// 2. RUDE BUSTER HAS NO `/ 2`. It is `ceil(damage * (damagereduction + 0.65))`.
//    The spec said `(melee + 0.65) / 2`, which is half the real figure.
//
// The reference formulas, verbatim:
//
//     damage = round(((battleat * points) / 20) - (monsterdf * 3));
//     damage = ceil(damage * damagereduction);
//     [Kris] both down *2 / one down *1 / none round(damage * 0.5)
//
//     spell  = ceil((battlemag * 5 + battleat * 11) - (monsterdf * 3));
//     spell  = ceil(spell * (damagereduction + 0.65));

import {
  createKnight, fightDamage, spellDamage, krisMult, advanceTurn, damageKnight,
  KNIGHT_MAXHP, KNIGHT_AT, KNIGHT_DF, DR_BASE, DR_CAP, DR_PER_TURN,
  DR_OPENING, stepKnightAnim,
  PHASE4_GATE, endCutsceneReached, startEndCutscene,
} from '../sim/knight.js';
import { PARTY, statFor } from '../sim/damage.js';

const failures = [];
const eq = (got, want, what) => {
  if (got !== want) failures.push(`${what}: got ${got}, expected ${want}`);
};

// scr_monstersetup, monstertype 104.
eq(KNIGHT_MAXHP, 7300, 'knight maxhp');
eq(KNIGHT_AT, 40, 'knight at');
eq(KNIGHT_DF, 0, 'knight df');

// NO GEAR. The formula assertions below are about the FORMULAS, so they run
// against bare base stats — otherwise every number here moves whenever the
// default loadout is retuned, and a real regression hides in the churn.
// The equipped build is checked separately, at the bottom.
const BARE = { gear: [{ weapon: 0, armor: [] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }] };
/**
 * A Knight IN THE FIGHT PROPER, which is what every damage figure below is
 * measured at.
 *
 * `createKnight()` now starts at the Create value `damagereduction = 0.04` —
 * the opening near-immunity — and the Knight's first Step raises it to 0.2.
 * Every expectation here is a dr-0.2 number, so the fixture has to take that
 * step; without it `fightDamage` reports the one-frame opening and a perfect
 * three-bolt turn comes out at 13 instead of 56.
 *
 * Stepping rather than assigning 0.2 directly is deliberate: it exercises the
 * transition, so a regression that stops incrementing `damagereductiontimer`
 * (which is exactly what was wrong before — the field existed and nothing ever
 * touched it) fails here rather than passing quietly.
 */
const mk = (hp = [160, 190, 140]) => {
  const st = { partyHp: hp.slice(), knight: createKnight(), loadout: BARE };
  stepKnightAnim(st);
  return st;
};

// The opening frame itself, asserted so the 0.04 is not merely a comment.
{
  const fresh = { partyHp: [160, 190, 140], knight: createKnight(), loadout: BARE };
  eq(fresh.knight.damagereduction, DR_OPENING, 'the Create value is the 0.04 opening');
  // round(18 * 150 / 20) = 135 -> ceil(135 * 0.04) = 6, against 27 at dr 0.2.
  eq(fightDamage(fresh, 1, 150), 6, 'Susie critical during the opening immunity');
  stepKnightAnim(fresh);
  eq(fresh.knight.damagereduction, 0.2, 'the first Step raises it to 0.2');
  stepKnightAnim(fresh);
  eq(fresh.knight.damagereduction, 0.2, 'and it fires exactly once, not per step');
}

// ── The FIGHT formula, computed by hand from the GML ─────────────────────
// Kris at 14, a critical (150), dr 0.2, healthy party:
//   round(14 * 150 / 20) = 105 -> ceil(105 * 0.2) = 21 -> round(21 * 0.5) = 11
eq(fightDamage(mk(), 0, 150), 11, 'Kris critical, healthy party');
// Susie at 18: round(135) = 135 -> ceil(27) = 27, and NO Kris scaling.
eq(fightDamage(mk(), 1, 150), 27, 'Susie critical');
// Ralsei at 12: round(90) = 90 -> ceil(18) = 18.
eq(fightDamage(mk(), 2, 150), 18, 'Ralsei critical');

// THE KRIS-ONLY RULE, stated as its own assertion because it is the one that
// was wrong. Susie's damage must NOT change when the party falls.
const healthy = mk();
const oneDown = mk([160, -999, 140]);
const bothDown = mk([160, -999, -999]);
eq(fightDamage(oneDown, 1, 150), fightDamage(healthy, 1, 150), 'Susie unaffected by a SWOON');
eq(fightDamage(bothDown, 1, 150), fightDamage(healthy, 1, 150), 'Susie unaffected by two SWOONs');
eq(fightDamage(bothDown, 2, 150), fightDamage(healthy, 2, 150), 'Ralsei unaffected by SWOONs');

// Kris IS affected: 21 halved to 11 healthy, 21 flat with one down, 42 with both.
eq(fightDamage(healthy, 0, 150), 11, 'Kris healthy');
eq(fightDamage(oneDown, 0, 150), 21, 'Kris with one ally down');
eq(fightDamage(bothDown, 0, 150), 42, 'Kris with both allies down');

// `< 0`, strictly. A character sitting on exactly 0 is not down for this.
eq(krisMult({ partyHp: [160, 0, 140] }, 0), 0.5, 'an ally at exactly 0 is not down');
eq(krisMult({ partyHp: [160, -1, 140] }, 0), 1, 'an ally at -1 is down');
eq(krisMult({ partyHp: [160, -999, -999] }, 1), 1, 'the scaling does not apply to slot 1');

// A fumbled bar does NOTHING — there is no 1-damage floor on the way out.
eq(fightDamage(mk(), 0, 0), 0, 'accuracy 0');

// ── Rude Buster ──────────────────────────────────────────────────────────
// Susie: ceil(2 * 5 + 18 * 11) = 208 -> ceil(208 * (0.2 + 0.65)) = ceil(176.8) = 177
eq(spellDamage(mk(), 1), 177, 'Rude Buster at the opening reduction');
// The absent `/ 2` is the whole point: with it this would be 89.
if (spellDamage(mk(), 1) < 150) failures.push('Rude Buster looks halved — the spec `/ 2` is not in the dump');
// Healing Prayer's caster, for the AT-over-MAGIC shape: ceil(11*5 + 12*11) = 187.
eq(spellDamage(mk(), 2), Math.ceil(187 * 0.85), 'Ralsei spell');
// A spell is NOT subject to the Kris block — it is in the FIGHT path only.
eq(spellDamage(bothDown, 0), spellDamage(healthy, 0), 'spells ignore the SWOON scaling');

// ── The reduction ramp ───────────────────────────────────────────────────
const k = mk();
eq(k.knight.damagereduction, DR_BASE, 'opening reduction');
for (let i = 0; i < 100; i++) advanceTurn(k);
if (Math.abs(k.knight.damagereduction - DR_CAP) > 1e-9) {
  failures.push(`reduction settled at ${k.knight.damagereduction}, expected ${DR_CAP}`);
}
// The guard is a RANGE, not a clamp: a value already above the band is left
// alone rather than pulled back into it. Phase 4's 0.4 must survive a turn.
const p4 = mk();
p4.knight.damagereduction = 0.4;
advanceTurn(p4);
eq(p4.knight.damagereduction, 0.4, "phase 4's 0.4 survives a turn");
const opening = mk();
opening.knight.damagereduction = 0.04;
advanceTurn(opening);
eq(opening.knight.damagereduction, 0.04, 'the 0.04 opening is not ramped');

// One turn of ramp really does change the damage — otherwise the ramp is
// decorative and nothing here would notice.
const t0 = mk();
const before = fightDamage(t0, 1, 150);
for (let i = 0; i < 15; i++) advanceTurn(t0);
if (fightDamage(t0, 1, 150) <= before) {
  failures.push('15 turns of ramp did not raise Susie damage');
}

// HP floors at 0 and does not go negative.
const dying = mk();
damageKnight(dying, 99999);
eq(dying.knight.hp, 0, 'knight hp floors at 0');

// A full critical turn: the number the wiring test measured end to end.
const turn = mk();
const total = [0, 1, 2].reduce((a, c) => a + fightDamage(turn, c, 150), 0);
eq(total, 56, 'a perfect three-bolt turn');

// ── THE FIGHT'S END CONDITION ────────────────────────────────────────────
// THREE terms, not two. The condition sits inside `if (state == 3 &&
// hurttimer >= 0)` in obj_knight_enemy's Draw, and `state = 3` is assigned by
// `scr_damage_enemy` — so THE KNIGHT MUST BE MID-HIT.
//
// Dropping that outer test is not a subtle inaccuracy. `haveusedroaring` is
// set by the same selector line that launches ROARING, and the HP gate is
// already satisfied by then (it is what opened phase 4), so a two-term
// condition fires on ROARING's own launch frame and the finale never plays.
// The real fight ends on the NEXT HIT THE PARTY LANDS after ROARING.
{
  const hurt = (s) => { s.knight.animState = 3; s.knight.hurttimer = 30; return s; };

  const k = hurt(mk());
  k.knight.hp = 1;
  if (endCutsceneReached(k)) failures.push('low HP alone ended the fight');
  const r = hurt(mk());
  r.knight.haveusedroaring = true;
  if (endCutsceneReached(r)) failures.push('Roaring alone at full HP ended the fight');

  // Both terms, but the Knight is NOT being hit — the state after ROARING
  // resolves and before the party's next attack lands.
  const idle = mk();
  idle.knight.haveusedroaring = true;
  idle.knight.hp = PHASE4_GATE;
  if (endCutsceneReached(idle)) {
    failures.push('the fight ended without the Knight being hit — ROARING would be cut off');
  }

  const both = hurt(mk());
  both.knight.haveusedroaring = true;
  both.knight.hp = PHASE4_GATE;
  if (!endCutsceneReached(both)) failures.push('Roaring at exactly 5840 did not end the fight');

  // `endcon != 1` is the re-entry guard, separate from end_cutscene_version.
  const again = hurt(mk());
  again.knight.haveusedroaring = true;
  again.knight.hp = PHASE4_GATE;
  again.knight.endcon = 1;
  if (endCutsceneReached(again)) failures.push('endcon did not block re-entry');
  // `<=`, so the gate itself counts.
  startEndCutscene(both);
  if (both.knight.endCutscene !== 1) failures.push('the end cutscene did not start');
  // `endcon` is the original's re-entry guard — it must not fire twice.
  if (startEndCutscene(both)) failures.push('the end cutscene started a second time');
  if (endCutsceneReached(both)) failures.push('the end condition still reads true after firing');
  // The ending's strobe is 999, not an ordinary hit's 30.
  if (both.knight.hurttimer !== 999) failures.push(`ending hurttimer ${both.knight.hurttimer}, expected 999`);
}

// ── THE EQUIPPED BUILD ───────────────────────────────────────────────────
// The default loadout is the spec's Taunt-Kris build. These are the numbers a
// player actually sees, and they exist so a gear change that halves the
// party's output cannot pass unnoticed.
{
  const g = { partyHp: [160, 190, 140], knight: createKnight() };  // default gear
  const kris = statFor(g, 0);
  const susie = statFor(g, 1);
  const ralsei = statFor(g, 2);
  if (kris.at !== 20) failures.push(`equipped Kris AT ${kris.at}, expected 20 (14 + Saber10 6)`);
  if (susie.at !== 25) failures.push(`equipped Susie AT ${susie.at}, expected 25`);
  if (susie.magic !== 9) failures.push(`equipped Susie MAG ${susie.magic}, expected 9`);
  if (ralsei.magic !== 19) failures.push(`equipped Ralsei MAG ${ralsei.magic}, expected 19`);
  if (!kris.mantle) failures.push('the mantle is not on Kris in the default build');
  if (susie.rudeBusterCost !== 100) failures.push("Devilsknife did not cut Rude Buster's cost");
  if (ralsei.healRibbons !== 1) failures.push('BlueRibbon Heal+ is not on Ralsei');
  const rb = spellDamage(g, 1);
  console.log(`equipped: Kris AT ${kris.at} · Susie AT ${susie.at} MAG ${susie.magic} · `
    + `Ralsei MAG ${ralsei.magic} heal +ceil/8 x${ralsei.healRibbons} · Rude Buster ${rb} for ${susie.rudeBusterCost} TP`);
}

console.log(`knight 7300 HP / AT ${KNIGHT_AT} / DF ${KNIGHT_DF}, reduction ${DR_BASE} +${DR_PER_TURN}/turn to ${DR_CAP}`);
console.log(`critical FIGHT: Kris ${fightDamage(mk(), 0, 150)}  Susie ${fightDamage(mk(), 1, 150)}  Ralsei ${fightDamage(mk(), 2, 150)}  = ${total}`);
console.log(`Kris scaling: healthy x0.5 (${fightDamage(healthy, 0, 150)})  one down x1 (${fightDamage(oneDown, 0, 150)})  both down x2 (${fightDamage(bothDown, 0, 150)})`);
console.log(`Rude Buster ${spellDamage(mk(), 1)} — x(dr + 0.65), no /2`);
console.log(`5840 is the phase-4 gate, battleprog == 1, AND the end condition`);
console.log(`party AT ${PARTY.map((p) => p.at).join('/')}  MAGIC ${PARTY.map((p) => p.magic).join('/')}`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  knight damage — FIGHT, spells, and the reduction ramp');
