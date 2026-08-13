#!/usr/bin/env node
// THE BATTLE MESSAGE — the flavour line above the button row.
//
// No oracle diff: `global.battlemsg[0]` is not in the wide trace yet. What
// this checks is that the table matches the dump exactly and that the three
// rules a summary would lose are actually implemented.
//
// The strings themselves are the ground truth — they were extracted from
// obj_knight_enemy's Step by parsing the phase/phaseturn nesting, not typed
// out by hand, so the risk here is not typos but STRUCTURE: which line plays
// when, and what happens when several fire at once.

import {
  BATTLE_MSG, phase4Msg, downMsg, battleMsgFor, OPENING_MSG,
} from '../sim/battlemsg.js';

const failures = [];
const eq = (got, want, what) => {
  if (got !== want) failures.push(`${what}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
};

// ── the table ─────────────────────────────────────────────────────────────
// Fifteen lines across three phases, five turns each. A missing one would
// leave the previous message on screen, which is silent rather than obvious.
for (const phase of [1, 2, 3]) {
  for (let t = 0; t <= 4; t++) {
    if (!BATTLE_MSG[phase]?.[t]) failures.push(`phase ${phase} turn ${t} has no message`);
  }
}
eq(Object.keys(BATTLE_MSG).length, 3, 'three phases in the table');

// The escalation is the point of the set — the same beat gets worse each
// phase, and getting one of these crossed would be invisible in play.
eq(BATTLE_MSG[1][0], '* You felt lightheaded.&* You saw silver stars...', 'phase 1 opener');
eq(BATTLE_MSG[2][0], '* You felt lightheaded.&* You saw golden stars...', 'phase 2 opener');
eq(BATTLE_MSG[3][0], '* You felt lightheaded.&* You felt a migraine coming on...', 'phase 3 opener');
eq(BATTLE_MSG[1][3], '* Your vision narrows.', 'phase 1 vision');
eq(BATTLE_MSG[2][2], '* Your vision narrows.&* ... Your head is spinning.', 'phase 2 vision');
eq(BATTLE_MSG[3][2], '* Your vision narrows.&* ... The world revolves around you.', 'phase 3 vision');

// ── phase 4, which is gated on more than the turn number ──────────────────
eq(phase4Msg(0, 190, false), '* Your heartbeat becomes twisted.', 'phase4turn 0');
// Susie's line depends on whether she is standing.
eq(phase4Msg(1, 190, false), '* Susie grew pale.', 'phase4turn 1, Susie up');
eq(phase4Msg(1, 0, false), '* Susie struggled to give some kind of warning.', 'phase4turn 1, Susie down');
eq(phase4Msg(2, 190, false), "* The Knight's hands glow a strange color...", 'the charge-up turn');

// `phase4turn > 2` — and its block is `phase == 4 || haveusedroaring`, so it
// keeps showing after ROARING sends `phase` back to 3. That is the game
// telling you to hit it: the end cutscene fires on the next hit that lands.
eq(phase4Msg(4, 190, true), '* The enemy suddenly let down its guard!', 'after ROARING, still prompting');

// `progamer` beats the guard line at exactly phase4turn 3.
eq(phase4Msg(3, 190, true, true),
  '* Kris coughed.&* The enemy slowly tilted its head...', 'the progamer line');
eq(phase4Msg(3, 190, true, false), '* The enemy suddenly let down its guard!', 'without progamer');

// ── the down messages ─────────────────────────────────────────────────────
// ONE-SHOT per character per fight: the *downmessage flags are never cleared,
// so a character who falls, is revived and falls again gets no second line.
{
  const seen = { kris: false, susie: false, ralsei: false };
  eq(downMsg([0, 190, 140], seen), '* Kris kneeled in silence.&', 'Kris falls');
  eq(downMsg([0, 190, 140], seen), null, 'Kris does not fall twice');
  // Revived and downed again — still silent.
  eq(downMsg([160, 190, 140], seen), null, 'revived, nothing');
  eq(downMsg([0, 190, 140], seen), null, 'downed again, still silent');
}

// `downcount == 2` CONCATENATES.
{
  const seen = { kris: false, susie: false, ralsei: false };
  eq(downMsg([0, 0, 140], seen),
    '* Kris kneeled in silence.&* Susie was hurt and beaten.&',
    'two at once are joined');
}

// THREE AT ONCE DOES NOT. The test is `== 2`, not `>= 2`, so a full wipe
// falls through and leaves whatever the last individual assignment set —
// Ralsei's line alone. ORIGINAL BEHAVIOUR, preserved deliberately: an
// equality where a >= was probably meant. Asserting it means a later
// "cleanup" that changes it fails here.
{
  const seen = { kris: false, susie: false, ralsei: false };
  eq(downMsg([0, 0, 0], seen), '* Ralsei became a pile of fluff.&',
    'three at once falls through to Ralsei alone');
}

// ── the dispatcher ────────────────────────────────────────────────────────
eq(battleMsgFor(1, 2, {}), '* Suddenly, the north wind blew fiercely.', 'dispatch, phase 1');
// A knockdown REPLACES the flavour line.
{
  const seen = { kris: false, susie: false, ralsei: false };
  eq(battleMsgFor(1, 2, { partyHp: [0, 190, 140], downSeen: seen }),
    '* Kris kneeled in silence.&', 'a knockdown wins over the flavour line');
}
// Nothing applicable returns null, so the previous line stays up — the game
// never clears global.battlemsg[0].
eq(battleMsgFor(9, 9, {}), null, 'unknown phase leaves the message alone');
eq(OPENING_MSG, '* The Roaring Knight appeared.', 'the encounter opener');

if (failures.length) {
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}

console.log('15 flavour lines across 3 phases, escalating silver -> golden -> migraine');
console.log('phase 4 gated on Susie standing, progamer, and haveusedroaring');
console.log('down messages one-shot per fight; two concatenate, three do NOT');
console.log('\nPASS  the battle message box (no oracle — see header)');
