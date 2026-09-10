#!/usr/bin/env node
// THE ITEM MENU's navigation — obj_battlecontroller's Step, `bmenuno == 4`.
//
// No oracle. What this pins is the SHAPE of the grid, which the first version
// of this menu got wrong in four ways at once because it was written from an
// idea of how an item menu works rather than from the event:
//
//   * TWELVE SLOTS ACROSS TWO PAGES of six, not one twelve-slot list. The
//     renderer showed all twelve at once, crammed into a 34px panel.
//   * The cursor is ONE 0..11 index. Page, row and column are all derived
//     from it — nothing else is stored.
//   * LEFT AND RIGHT DO THE SAME THING. With two columns a toggle is its own
//     inverse and the original writes the branch out twice.
//   * NAVIGATION IS CLAMPED, NOT WRAPPED. `down` refuses at `coord >= 10`,
//     `up` refuses at `coord <= 1`. Wrapping also breaks the page arrow, which
//     is supposed to mean "there is more below".
//
// It also pins the item NAMES, because the renderer now draws them with the
// real font and a wrong one is visible to the player.

import { createState } from '../sim/index.js';
import { stepMenu, openMenu, createMenu, bagOf } from '../sim/menu.js';
import { ITEMS, applyItem, freshInventory, INVENTORY_SIZE } from '../sim/items.js';

const failures = [];
const NONE = { left: false, right: false, up: false, down: false, confirm: false, cancel: false };

function fresh() {
  const st = createState({ seed: 1 });
  // `state.menu` is built by the SCENE, not by createState — the verifier has
  // no scene, so it stands one up itself.
  st.menu = createMenu();
  st.inventory = freshInventory();
  openMenu(st);          // seeds tempitem[] from the inventory
  st.menu.submenu = 'item';
  st.menu.gridIndex = 0;
  return st;
}

/** One EDGE press: the menu reads `pressed()`, so it needs a released frame. */
// A TAP RELEASES UNTIL THE INPUT BUFFER LETS THE NEXT ONE THROUGH.
// obj_battlecontroller gates every confirm on `onebuffer < 0` and the four
// GRID confirms set it to 2 (Step_0:636 MAGIC, :780 battlespell, :937 ITEM,
// :1140 ACT) where every other confirm sets 1 — so after choosing something
// off a grid the game ignores button1 for two frames. A fixed press/release
// pair is one frame short of that, and every press after it in a script
// would be swallowed; waiting is what a player does and it keeps these
// tests measuring the menu rather than the buffer.
function tap(st, key) {
  stepMenu(st, { ...NONE, [key]: true });
  stepMenu(st, { ...NONE });
  for (let g = 0; g < 4 && (st.menu?.onebuffer ?? -1) >= 0; g++) stepMenu(st, { ...NONE });
}

if (freshInventory().length !== INVENTORY_SIZE) {
  failures.push(`the bag holds ${freshInventory().length} slots, expected ${INVENTORY_SIZE}`);
}

// ── The grid ─────────────────────────────────────────────────────────────
// RIGHT from an even slot goes to its odd partner; RIGHT again comes BACK.
// A cursor that advanced would walk the list and never reach the second page.
let st = fresh();
tap(st, 'right');
if (st.menu.gridIndex !== 1) failures.push(`right from 0 went to ${st.menu.gridIndex}, expected 1`);
tap(st, 'right');
if (st.menu.gridIndex !== 0) failures.push(`right from 1 went to ${st.menu.gridIndex}, expected 0 — it toggles`);

// LEFT is the same toggle, not the inverse of right.
st = fresh();
tap(st, 'left');
if (st.menu.gridIndex !== 1) failures.push(`left from 0 went to ${st.menu.gridIndex}, expected 1`);

// DOWN steps by TWO — one visual row, both columns.
st = fresh();
tap(st, 'down');
if (st.menu.gridIndex !== 2) failures.push(`down from 0 went to ${st.menu.gridIndex}, expected 2`);
tap(st, 'down');
tap(st, 'down');
if (st.menu.gridIndex !== 6) failures.push(`three downs reached ${st.menu.gridIndex}, expected 6 (page 1)`);

// UP steps back by two and REFUSES at the top row rather than wrapping.
tap(st, 'up');
if (st.menu.gridIndex !== 4) failures.push(`up from 6 went to ${st.menu.gridIndex}, expected 4`);
st = fresh();
tap(st, 'up');
if (st.menu.gridIndex !== 0) failures.push(`up from 0 moved to ${st.menu.gridIndex} — the top must refuse`);
st = fresh();
st.menu.gridIndex = 1;
tap(st, 'up');
if (st.menu.gridIndex !== 1) failures.push('up from slot 1 moved — coord <= 1 must refuse');

// DOWN refuses off the bottom of a FULL bag: `coord >= 10` cannot descend.
st = fresh();
st.menu.gridIndex = 10;
tap(st, 'down');
if (st.menu.gridIndex !== 10) failures.push(`down from 10 went to ${st.menu.gridIndex} — it must refuse`);
st = fresh();
st.menu.gridIndex = 11;
tap(st, 'down');
if (st.menu.gridIndex !== 11) failures.push('down from 11 moved — it must refuse');

// And it refuses to land on an EMPTY slot, which is the case a clamp alone
// misses: a short bag has holes below the cursor, not just past the end.
st = fresh();
st.menu.tempitem[0] = st.menu.tempitem[0].slice(0, 5);
st.menu.gridIndex = 3;
tap(st, 'down');
if (st.menu.gridIndex !== 3) failures.push(`down onto an empty slot moved to ${st.menu.gridIndex}`);
st = fresh();
st.menu.tempitem[0] = st.menu.tempitem[0].slice(0, 3);
st.menu.gridIndex = 2;
tap(st, 'right');
if (st.menu.gridIndex !== 2) failures.push('right onto an empty slot moved');

// ── The page split ───────────────────────────────────────────────────────
// Six per page, and `page = coord > 5`. Asserted as the renderer computes it,
// so a change to one and not the other is caught.
for (const [coord, page, local] of [[0, 0, 0], [5, 0, 5], [6, 1, 0], [11, 1, 5]]) {
  const p = coord > 5 ? 1 : 0;
  if (p !== page || coord - p * 6 !== local) {
    failures.push(`coord ${coord} maps to page ${p} slot ${coord - p * 6}, expected ${page}/${local}`);
  }
}

// ── Using an item ────────────────────────────────────────────────────────
// The bag SHRINKS, and the cursor must not be left pointing past the end.
st = fresh();
st.partyHp = [10, 10, 10];
st.menu.gridIndex = 11;
const before = st.menu.tempitem[0].length;
// Slot 11 is a DeluxeDinner — `target: 'one'` — so confirming opens the TARGET
// PICKER rather than using it. That is the point of the picker: a single-target
// heal must be aimable at a fallen ally, not silently applied to whoever is
// acting. A second confirm commits it.
tap(st, 'confirm');
if (st.menu.submenu !== 'target') failures.push('a single-target item did not open the picker');
if (st.menu.tempitem[0].length !== before) failures.push('the item was spent before a target was picked');
if (st.menu.targetIndex !== 0) failures.push('the picker did not default to the acting character');
tap(st, 'confirm');
// The item leaves the CHARACTER'S SNAPSHOT now; `state.inventory` is untouched
// until the turn commits, which is what makes cancel able to give it back.
if (st.menu.tempitem[0].length !== before - 1) {
  failures.push(`using an item left ${st.menu.tempitem[0].length} slots, expected ${before - 1}`);
}
if (st.inventory.length !== INVENTORY_SIZE) {
  failures.push('the base inventory changed before the turn committed');
}

// CANCEL FROM THE PICKER goes back to the LIST, not to the button row — one
// step per press — and the item is still there.
st = fresh();
st.partyHp = [10, 10, 10];
st.menu.gridIndex = 11;
tap(st, 'confirm');
tap(st, 'cancel');
if (st.menu.submenu !== 'item') failures.push(`picker cancel went to ${st.menu.submenu}, expected the list`);
if (st.menu.tempitem[0].length !== INVENTORY_SIZE) failures.push('picker cancel spent the item');

// THE PICKER MUST OFFER THE FALLEN. A DeluxeDinner on a SWOONed ally is the
// whole reason to carry single-target heals — scr_heal adds to the negative
// number — so a picker that skipped downed members would make ReviveMint
// unusable.
st = fresh();
st.partyHp = [100, -999, 140];
st.menu.gridIndex = 2;   // a ReviveMint
tap(st, 'confirm');
if (st.menu.submenu !== 'target') failures.push('ReviveMint did not open the picker');
tap(st, 'right');
if (st.menu.targetIndex !== 1) failures.push('the picker skipped the fallen ally');
tap(st, 'confirm');

// ITEMS DO NOT RESOLVE ON SELECTION — they are queued and fire in the resolve
// phase, at `maxdelaytimer == spelldelay[c]`, alongside the spells.
//
// This asserted the opposite until it was reported from play: applying on
// selection let a Revive land during the COMMAND phase, so the revived ally
// could still take their turn. They cannot — by the time the item resolves
// the menu is closed and their turn is spent.
//
// The two halves happen at different times, and both matter:
//   * the item leaves the snapshot NOW (that is what cancel restores)
//   * the effect waits
if (st.partyHp[1] > 0) {
  failures.push('ReviveMint healed during the command phase — items resolve '
    + 'with the turn, not on selection');
}
if (!st.pendingItem?.[st.menu.charturn] && !st.pendingItem?.[0]) {
  failures.push('ReviveMint was not queued for the resolve phase');
}
// The bag lost it immediately even though the effect has not landed.
//
// Check the snapshot of the character who USED it — `bagOf` returns the
// CURRENT character's list, and confirming has already advanced the turn to
// the next one, whose 12 slots are untouched. `tempitem` is per-character,
// which is the whole point of it.
{
  const used = st.menu.tempitem.findIndex((l) => l.filter(Boolean).length === 11);
  if (used < 0) {
    failures.push('no character\'s snapshot lost the ReviveMint');
  }
}
// And it works when the resolve phase runs it.
{
  const queued = st.pendingItem.find(Boolean);
  applyItem(st, queued.id, queued.target);
  if (st.partyHp[1] <= 0) {
    failures.push(`ReviveMint did nothing on resolve (${st.partyHp[1]})`);
  }
}

// CANCEL ON THE BUTTON ROW steps back a character AND UNDOES what they did —
// `scr_prevhero` restores both the bag and the TP. A bare `charturn -= 1` let
// an item spent by character 2 stay spent.
st = fresh();
st.partyHp = [10, 10, 10];
st.menu.submenu = null;
st.menu.charturn = 0;
st.menu.selected[0] = 4;          // DEFEND
const tpBefore = st.tension;
tap(st, 'confirm');               // Kris defends, banking TP, turn -> Susie
if (st.menu.charturn !== 1) failures.push('DEFEND did not advance the turn');
if (st.tension <= tpBefore) failures.push('DEFEND banked no TP');
tap(st, 'cancel');                // back to Kris
if (st.menu.charturn !== 0) failures.push('cancel did not step back a character');
if (st.tension !== tpBefore) failures.push(`cancel left TP at ${st.tension}, expected ${tpBefore} restored`);

// And an item spent by character 1 comes back when you cancel out of them.
st = fresh();
st.partyHp = [10, 10, 10];
st.menu.submenu = null;           // start on the BUTTON ROW, not in the bag
st.menu.charturn = 0;
st.menu.selected[0] = 4;
tap(st, 'confirm');               // Kris defends -> Susie's turn
st.menu.submenu = 'item';
st.menu.gridIndex = 0;            // Spincake, heals all, no target needed
tap(st, 'confirm');
if (st.menu.tempitem[1].length !== INVENTORY_SIZE - 1) {
  failures.push("Susie's snapshot did not lose the Spincake");
}
tap(st, 'cancel');                // back off Ralsei to Susie
tap(st, 'cancel');                // back off Susie to Kris
if (st.menu.charturn !== 0) failures.push(`two cancels landed on ${st.menu.charturn}, expected 0`);
if (st.menu.tempitem[0].length !== INVENTORY_SIZE) {
  failures.push('cancelling back did not restore the spent item');
}

// Cancel on the FIRST character does nothing — there is nowhere to go.
st = fresh();
st.menu.submenu = null;
tap(st, 'cancel');
if (st.menu.charturn !== 0) failures.push('cancel on the first character moved somewhere');

// CANCEL backs out of the list to the button row without spending anything.
st = fresh();
tap(st, 'cancel');
if (st.menu.submenu !== null) failures.push('cancel did not close the bag');
if (st.menu.tempitem[0].length !== INVENTORY_SIZE) failures.push('cancel consumed an item');

// ── Names, because they are now DRAWN ────────────────────────────────────
for (const [id, want] of [[2, 'ReviveMint'], [7, 'Spincake'], [29, 'TensionMax'],
  [30, 'ReviveDust'], [38, 'ExecBuffet'], [39, 'DeluxeDinner']]) {
  if (ITEMS[id].name !== want) failures.push(`item ${id}: "${ITEMS[id].name}" != "${want}"`);
  const lines = (ITEMS[id].desc ?? '').split('#');
  if (lines.length < 1 || !lines[0]) failures.push(`item ${id} has no description`);
  if (lines.length > 3) failures.push(`item ${id} description is ${lines.length} lines — the column fits 3`);
}

console.log('grid: 2 columns x 6 rows, six per page over two pages, cursor is one 0..11 index');
console.log('left and right both TOGGLE columns; up/down step 2 and CLAMP at the ends');
// CANCEL IS A STACK, AND IT UNWINDS ONE CHARACTER AT A TIME. scr_prevhero
// restores `temptension[charturn]`, the snapshot scr_nexthero took when that
// character's turn began — so backing out of Ralsei's turn refunds SUSIE's
// DEFEND and leaves Kris's banked.
//
// The button row used to advance `charturn` with a bare `+= 1`, skipping
// scr_nexthero entirely: temptension stayed at the turn's opening value for
// everyone, so one cancel rewound the TP all the way to the start of the turn
// and undid every DEFEND at once. Reported from play as 32% dropping to zero
// on a single X.
{
  const { BUTTONS, createMenu, openMenu, stepMenu } = await import('../sim/menu.js');
  const { freshParty, TP_DEFEND } = await import('../sim/damage.js');
  const defIdx = BUTTONS.findIndex((b) => b.name === 'DEFEND');
  const s2 = createState({ seed: 1 });
  s2.partyHp = freshParty();
  s2.menu = createMenu();
  openMenu(s2);
  s2.tension = 0;
  const tap = (k) => {
    stepMenu(s2, { [k]: true });
    stepMenu(s2, {});
    for (let g = 0; g < 4 && (s2.menu?.onebuffer ?? -1) >= 0; g++) stepMenu(s2, {});
  };
  for (let i = 0; i < 2; i++) { s2.menu.selected[s2.menu.charturn] = defIdx; tap('confirm'); }
  if (s2.tension !== TP_DEFEND * 2) {
    failures.push(`two DEFENDs banked ${s2.tension} TP, expected ${TP_DEFEND * 2}`);
  }
  tap('cancel');
  if (s2.menu.charturn !== 1) failures.push(`one cancel went to charturn ${s2.menu.charturn}, expected 1`);
  if (s2.tension !== TP_DEFEND) {
    failures.push(`one cancel left ${s2.tension} TP, expected ${TP_DEFEND} — it undid BOTH defends`);
  }
  tap('cancel');
  if (s2.tension !== 0) failures.push(`the second cancel left ${s2.tension} TP, expected 0`);
}

// CANCEL SKIPS THE FALLEN. scr_prevhero does not decrement — it picks a
// target and gates each choice on `charmove`, which scr_dead clears:
//
//     if (charturn == 1) { if (charmove[0] == 1) charturn = 0; }
//     if (charturn == 2) { if (charmove[1] == 1 && acting[1] == 0) charturn = 1;
//                          else if (charmove[0] == 1)             charturn = 0; }
//
// A bare `charturn -= 1` handed the player a SWOONED character's menu, and
// reviving them next turn then let them act immediately. Reported from play.
{
  const { BUTTONS: BT, createMenu: cm, openMenu: om, stepMenu: sm } = await import('../sim/menu.js');
  const { freshParty: fp, scrDead } = await import('../sim/damage.js');
  const s5 = createState({ seed: 1 });
  s5.partyHp = fp();
  scrDead(s5, 1);
  s5.partyHp[1] = -999;                       // Susie swooned
  s5.menu = cm();
  om(s5);
  const t5 = (k) => { sm(s5, { [k]: true }); sm(s5, {}); };
  s5.menu.selected[0] = BT.findIndex((b) => b.name === 'DEFEND');
  t5('confirm');                              // Kris acts; Susie is skipped
  if (s5.menu.charturn !== 2) failures.push(`turn order skipped to ${s5.menu.charturn}, expected 2`);
  t5('cancel');
  if (s5.menu.charturn === 1) failures.push('cancel landed on the SWOONED character');
  if (s5.menu.charturn !== 0) failures.push(`cancel went to ${s5.menu.charturn}, expected 0`);
  // With everyone before them down, cancel must refuse rather than move.
  const s6 = createState({ seed: 1 });
  s6.partyHp = fp();
  scrDead(s6, 0); s6.partyHp[0] = -80;
  s6.menu = cm();
  om(s6);
  s6.menu.charturn = 1;
  const t6 = (k) => { sm(s6, { [k]: true }); sm(s6, {}); };
  t6('cancel');
  if (s6.menu.charturn !== 1) failures.push('cancel moved with nobody living to go back to');
}

console.log('names: ' + [7, 38, 39, 2, 30, 29].map((i) => ITEMS[i].name).join(', '));

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  the item menu (no oracle — see header)');
