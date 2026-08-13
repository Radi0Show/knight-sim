#!/usr/bin/env node
// THE TWELVE SLOTS, and that each item does what scr_itemuse says it does.
//
// No oracle — the recordings carry no inventory. What this pins is the CHAPTER
// 3 numbers, which is where these are easy to get wrong: Spincake heals 80 in
// chapter 1, 140 in 2, 150 in 3 and 160 in 4, all in one switch case, and
// grabbing the wrong branch is a silent 10-point error.

import { createState } from '../sim/index.js';
import {
  ITEMS, useItem, freshInventory, INVENTORY_SIZE, applyHeal,
} from '../sim/items.js';
import { PARTY } from '../sim/damage.js';
import { MAX_TENSION } from '../sim/tension.js';

const failures = [];

// THE NAMES ARE THE DUMP'S, character for character. It is `Spincake`, with a
// lowercase c — this file asserted "SpinCake" for a while because that is how
// it reads in English, and the renderer now draws these strings with the real
// font, so a wrong one is visible to the player.
const NAMES = {
  2: 'ReviveMint', 7: 'Spincake', 29: 'TensionMax',
  30: 'ReviveDust', 38: 'ExecBuffet', 39: 'DeluxeDinner',
};
for (const [id, want] of Object.entries(NAMES)) {
  if (ITEMS[id].name !== want) failures.push(`item ${id} is named "${ITEMS[id].name}", expected "${want}"`);
  // Every item needs a description: it is drawn beside the list and an
  // undefined one renders as a blank column, not as an error.
  if (!ITEMS[id].desc) failures.push(`item ${id} (${want}) has no description`);
}
const fresh = () => createState({ seed: 1, traceBulletSlots: 0 });

// ---- the loadout ------------------------------------------------------------
const bag = freshInventory();
const count = {};
for (const id of bag) count[ITEMS[id].name] = (count[ITEMS[id].name] ?? 0) + 1;
const want = {
  Spincake: 1, ExecBuffet: 1, ReviveMint: 6, ReviveDust: 1, TensionMax: 1, DeluxeDinner: 2,
};
if (bag.length !== INVENTORY_SIZE) failures.push(`bag has ${bag.length} slots, expected 12`);
for (const [n, c] of Object.entries(want)) {
  if (count[n] !== c) failures.push(`${n}: ${count[n] ?? 0} in the bag, expected ${c}`);
}

// ---- effects, at the chapter 3 values ---------------------------------------
let s = fresh();
s.partyHp = [10, 10, 10];
useItem(s, s.inventory.indexOf(7)); // Spincake, heal all 150
if (s.partyHp.join() !== '160,160,140') {
  failures.push(`Spincake gave ${s.partyHp.join('/')}, expected 160/160/140 (heal all 150, clamped)`);
}

// A HEAL LANDS ON A FALLEN ALLY — scr_heal adds to the negative number rather
// than refusing. From -999 a 150 party heal leaves -849: still down, but the
// healing counted. This module used to skip anyone at or below zero.
s = fresh();
s.partyHp = [160, -999, 140];
useItem(s, s.inventory.indexOf(7));
if (s.partyHp[1] !== -849) {
  failures.push(`Spincake left a SWOONed Susie at ${s.partyHp[1]}, expected -849`);
}

// CROSSING ZERO SNAPS UP to ceil(maxhp / 6) — scr_heal's floor, so a revive
// never lands you on 1 HP. Ralsei at -10 healed 12 would be 2; the floor makes
// it 24.
s = fresh();
s.partyHp = [160, 190, -10];
applyHeal(s, 2, 12);
if (s.partyHp[2] !== Math.ceil(PARTY[2].maxhp / 6)) {
  failures.push(`crossing zero gave ${s.partyHp[2]}, expected the ceil(maxhp/6) floor of ${Math.ceil(PARTY[2].maxhp / 6)}`);
}

s = fresh();
s.partyHp = [10, 10, 10];
useItem(s, s.inventory.indexOf(38)); // ExecBuffet, heal all 100
if (s.partyHp.join() !== '110,110,110') {
  failures.push(`ExecBuffet gave ${s.partyHp.join('/')}, expected 110/110/110`);
}

s = fresh();
s.partyHp = [10, 10, 10];
useItem(s, s.inventory.indexOf(39), 1); // DeluxeDinner, heal ONE 140
if (s.partyHp.join() !== '10,150,10') {
  failures.push(`DeluxeDinner gave ${s.partyHp.join('/')}, expected 10/150/10 (single target)`);
}

// ReviveMint: ceil(maxhp / 2) on a DOWNED character, and nothing on a living one.
// ReviveMint on a SWOONed ally is a heal of `maxhp - hp` — full. See the
// UNRESOLVED note in items.js: this follows the handoff spec, not the dump.
s = fresh();
s.partyHp = [160, -999, 140];
useItem(s, s.inventory.indexOf(2), 1);
if (s.partyHp[1] !== PARTY[1].maxhp) {
  failures.push(`ReviveMint gave Susie ${s.partyHp[1]}, expected full (${PARTY[1].maxhp})`);
}
s = fresh();
const before = s.inventory.length;
if (useItem(s, s.inventory.indexOf(2), 1) !== null || s.inventory.length !== before) {
  failures.push('ReviveMint on a healthy party consumed the item');
}

// ReviveDust brings back EVERYONE; healing does not touch the dead.
// ReviveDust brings everyone to a QUARTER of max, not to full.
s = fresh();
s.partyHp = [-80, -999, -999];
useItem(s, s.inventory.indexOf(30));
const quarters = PARTY.map((p) => Math.floor(p.maxhp * 0.25));
if (s.partyHp.some((h, i) => h !== quarters[i])) {
  failures.push(`ReviveDust gave ${s.partyHp.join('/')}, expected ${quarters.join('/')}`);
}

// TensionMax fills the bar.
s = fresh();
s.tension = 40;
useItem(s, s.inventory.indexOf(29));
if (s.tension !== MAX_TENSION) failures.push(`TensionMax gave ${s.tension}, expected ${MAX_TENSION}`);

// ---- the bag shrinks --------------------------------------------------------
s = fresh();
s.partyHp = [10, 10, 10];
const n0 = s.inventory.length;
useItem(s, s.inventory.indexOf(7));
if (s.inventory.length !== n0 - 1) failures.push('a used item stayed in the bag');

console.log(`bag: ${Object.entries(count).map(([k, v]) => `${k} x${v}`).join(', ')}`);
console.log('Spincake 150 all · ExecBuffet 100 all · DeluxeDinner 140 one');
console.log('ReviveMint -> full · ReviveDust -> quarter max · TensionMax fills TP');
console.log('heals reach the FALLEN; crossing zero floors at ceil(maxhp/6)');

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  12 slots, chapter 3 values (no oracle — see header)');
