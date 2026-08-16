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
import { stepMenu, openMenu, createMenu, bagOf, BUTTONS } from '../sim/menu.js';
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

// ---- AND IT STAYS GONE AFTER THE TURN COMMITS ------------------------------
//
// The check above spends an item through `useItem`, which edits the inventory
// directly. The GAME does not: a selection removes the item from that
// character's `tempitem` SNAPSHOT, and only `scr_endturn` writes a snapshot
// back to `global.item`. Everything between is recoverable with cancel.
//
// Which means the direct test cannot see the bug that shipped: `scr_endturn`
// is called from inside `scr_nexthero`, while `global.charturn` is still the
// character who just acted, and this sim zeroed `charturn` first and committed
// a frame later — so it wrote KRIS's snapshot every time. Kris rarely eats
// anything, so his snapshot is the untouched bag and every item Susie or
// Ralsei used came back. Reported from play as Spincake never leaving the
// inventory. One of the five turn-end paths (the ITEM/MAGIC list) did not even
// raise the commit flag.
//
// So this drives the real menu, with the item spent by a character who is NOT
// slot 0.
{
  const st = fresh();
  st.menu = createMenu();
  st.inventory = freshInventory();
  st.partyHp = [100, 100, 100];
  openMenu(st);
  const before = st.inventory.length;
  const spincakeAt = st.inventory.indexOf(7);

  const NO = {
    left: false, right: false, up: false, down: false, confirm: false, cancel: false,
  };
  const tap = (key) => { stepMenu(st, { ...NO, [key]: true }); stepMenu(st, { ...NO }); };
  // BUTTONS[].name is a string for most rows and a FUNCTION for the one that
  // is ACT for Kris and MAGIC for everyone else, so it cannot be indexed by a
  // plain indexOf on the name.
  const button = (want, c) => BUTTONS.findIndex(
    (b) => (typeof b.name === 'function' ? b.name(c) : b.name) === want,
  );

  // Kris: plain DEFEND, so slot 0's snapshot keeps the whole bag — which is
  // exactly the condition that hid the bug.
  st.menu.selected[0] = button('DEFEND', 0);
  tap('confirm');
  if (st.menu.charturn !== 1) failures.push(`Kris's DEFEND left charturn at ${st.menu.charturn}`);

  // Susie: ITEM -> Spincake.
  st.menu.selected[1] = button('ITEM', 1);
  tap('confirm');
  if (st.menu.submenu !== 'item') failures.push(`ITEM opened "${st.menu.submenu}"`);
  st.menu.gridIndex = spincakeAt;
  tap('confirm');
  if (bagOf(st).includes(7)) failures.push("Spincake survived Susie's own snapshot");
  if (st.inventory.length !== before) {
    failures.push('the real inventory changed before the turn committed — cancel would not restore it');
  }

  // Ralsei: DEFEND, which ends the turn and is where scr_endturn runs.
  st.menu.selected[2] = button('DEFEND', 2);
  tap('confirm');

  if (st.menu.open) failures.push('the menu stayed open after the last character acted');
  if (st.inventory.length !== before - 1) {
    failures.push(
      `after the turn the bag holds ${st.inventory.length} items, expected ${before - 1}`
      + ' — the used item came back',
    );
  }
  if (st.inventory.includes(7)) failures.push('Spincake came back after being eaten');
  for (let i = 0; i < 3; i++) {
    if ((st.menu.tempitem[i] ?? []).includes(7)) {
      failures.push(`snapshot ${i} still holds Spincake after the commit`);
    }
  }
}

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
