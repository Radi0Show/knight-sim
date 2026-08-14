#!/usr/bin/env node
// THE SWOON SYSTEM — scr_dead, scr_revive, scr_heal's revive gate, and the
// two different floors a knocked-out party member lands on.
//
// Every assertion here is a line out of the dump, and the asymmetry in the
// middle is the fight's healing economy:
//
//     scr_damage, chapter 3, i_ex(obj_knight_enemy):
//         target == 0  ->  doomtype 4,  hp = round(-maxhp / 2)   // Kris: -80
//         else         ->  doomtype 12, hp = -999                // allies
//
//     scr_heal(slot, amount):
//         belowzero = (hp <= 0) at entry
//         hp += amount, clamped to maxhp
//         if (belowzero && hp >= 0) { floor at ceil(maxhp / 6); scr_revive() }
//
// So one heal item lifts Kris off -80 and stands him up, and NOTHING short of
// crossing 999 lifts a swooned ally — the heal is absorbed by the hole and
// scr_revive never runs. A sim that clamps either floor to 0, or that revives
// on "hp went up", erases that difference and the fight stops being the fight.
//
// Positive assertions (CLAUDE.md's rule for every new mechanism): this suite
// checks that the machinery RAN — chardead set, charmove/charcantarget
// cleared, isUp() flipped — not merely that nothing threw.

import { createState } from '../sim/index.js';
import {
  PARTY, scrDamage, scrDead, scrRevive, isUp, statusOf, UP, DOWN, SWOON,
} from '../sim/damage.js';
import { scrHealitem } from '../sim/items.js';

let failures = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    failures += 1;
    console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
  } else {
    console.log(`  ok    ${label}`);
  }
};

function fresh() {
  const s = createState({ seed: 1 });
  s.partyHp = PARTY.map((p) => p.maxhp);
  s.damageEnabled = true;
  return s;
}

console.log('scr_dead / scr_revive — the five globals');
{
  const s = fresh();
  scrDead(s, 1);
  check('scr_dead sets all five', [
    s.chardead[1], s.charmove[1], s.charcantarget[1], s.charaction[1], s.charspecial[1],
  ], [1, 0, 0, 0, 0]);
  check('scr_dead leaves the others alone', [s.chardead[0], s.chardead[2]], [0, 0]);
  check('isUp is false once dead', isUp(s, 1), false);

  scrRevive(s, 1);
  check('scr_revive clears THREE, not five', [
    s.chardead[1], s.charmove[1], s.charcantarget[1],
  ], [0, 1, 1]);
  check('isUp is true again', isUp(s, 1), true);
}

console.log('\nthe two floors — Kris DOWNs, allies SWOON');
{
  const s = fresh();
  // A hit big enough to fell whoever it targets, aimed with no redirect.
  scrDamage(s, 9999, 0, { truedamage: true, aoe: true });
  check('Kris lands on round(-maxhp / 2)', s.partyHp[0], Math.round(-PARTY[0].maxhp / 2));
  check('Kris is DOWN, not SWOON', statusOf(s, 0), DOWN);
  check('and scr_dead ran for him', s.chardead[0], 1);

  const t = fresh();
  scrDamage(t, 9999, 1, { truedamage: true, aoe: true });
  check('Susie lands on -999', t.partyHp[1], -999);
  check('Susie is SWOON', statusOf(t, 1), SWOON);
  check('and scr_dead ran for her', t.chardead[1], 1);
}

console.log('\nscr_heal — the revive gate is "did it reach zero"');
{
  // Kris at -80: a 100 heal crosses zero, so he stands up at ceil(maxhp / 6).
  const s = fresh();
  scrDamage(s, 9999, 0, { truedamage: true, aoe: true });
  const dealt = scrHealitem(s, 0, 100);
  check('Kris is standing after a 100 heal', isUp(s, 0), true);
  check('  and floored at ceil(maxhp / 6)', s.partyHp[0], Math.ceil(PARTY[0].maxhp / 6));
  check('  scr_revive cleared chardead', s.chardead[0], 0);
  check('  the number shown is the DELTA', dealt, Math.ceil(PARTY[0].maxhp / 6) - Math.round(-PARTY[0].maxhp / 2));

  // Susie at -999: the same heal is swallowed whole. Still down, MORE HP.
  const t = fresh();
  scrDamage(t, 9999, 1, { truedamage: true, aoe: true });
  const dealt2 = scrHealitem(t, 1, 100);
  check('Susie is STILL down after a 100 heal', isUp(t, 1), false);
  check('  but her HP moved', t.partyHp[1], -899);
  check('  the heal still reports 100', dealt2, 100);
  // THE DOWN/SWOON LABEL IS DERIVED FROM THE FLOOR, and only the floor: it
  // reads `hp <= -999`. A partial heal moves the number off the sentinel, so
  // the label flips to DOWN while the character is still on the ground. That
  // is a limitation of a derived label, not a bug in the swoon system —
  // `chardead` is the authority, and the labels exist for the *downmessage
  // lines, which fire at the instant of felling when the floor is exact.
  check('  the label follows the number (derived, documented)', statusOf(t, 1), DOWN);
  check('  chardead is still the authority', t.chardead[1], 1);
  check('  HEALED BUT STILL DOWN — the state HP alone cannot express',
    [t.partyHp[1] > -999, isUp(t, 1)], [true, false]);
}

console.log('\nthe display reads the raw number');
{
  const s = fresh();
  scrDamage(s, 9999, 1, { truedamage: true, aoe: true });
  // Not an assertion about the renderer (that is DOM), but about what it is
  // handed: the HUD prints state.partyHp directly, so this must stay negative.
  check('partyHp stays negative for the HUD to print', s.partyHp[1] < 0, true);
  check('status is not UP', statusOf(s, 1) === UP, false);
}

console.log('');
if (failures) {
  console.log(`→ FAILURE  ${failures} swoon assertion(s) wrong`);
  process.exit(1);
}
console.log('PASS  the swoon system — scr_dead/scr_revive, both floors, scr_heal\'s gate');
