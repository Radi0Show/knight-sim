#!/usr/bin/env node
// THE TITLE SCREEN's navigation — the mode list, the SINGLE roster, the
// difficulty stage, and backing out of each.
//
// No oracle: this menu is the tool's own, not the game's. What it pins is the
// one thing menus are actually made of, which is where the cursor goes and
// what a press means — and specifically the bug that started this file.
//
// `stepTitle`'s `pressed()` LATCHES: it records the key as held on the way
// out, so calling it twice in a frame makes the second call return false no
// matter what the player did. The cancel handling was written as two guarded
// tests:
//
//     if (pressed('cancel') && title.pickingDifficulty) { ... }
//     if (pressed('cancel') && title.pickingAttack)     { ... }
//
// and the FIRST evaluates `pressed` before its `&&`, so on the attack list —
// where pickingDifficulty is false — it consumed the press and then declined
// to act on it, and the second test never saw it. X therefore backed out of
// the difficulty list and did nothing at all in the attack list. Reported as
// issue #6, and the settings pages were unaffected because they call
// `pressed('cancel')` exactly once.
//
// A latching accessor called twice in one condition chain is a shape that will
// recur, so every stage transition is asserted here rather than just the one
// that was broken.

import {
  createTitle, stepTitle, MODES, SETTINGS_PAGES, TITLE_EXTRAS, CREDITS, creditLink,
  ITEM_PICKER,
} from '../sim/modes.js';
import {
  ITEMS, ITEM_IDS, DEFAULT_BAG, INVENTORY_SIZE, freshInventory,
} from '../sim/items.js';

const ROSTER = [
  { id: 'stars', name: 'Stars', difficulties: [0, 1, 2] },
  { id: 'flurry', name: 'Flurry', difficulties: [0, 1, 3] },
  { id: 'roaring', name: 'ROARING', difficulties: [0] },
];

const NONE = {
  up: false, down: false, left: false, right: false, confirm: false, cancel: false,
};

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/** One EDGE press — the menu is edge-triggered, so it needs a released frame. */
function tap(t, key) {
  const r = stepTitle(t, { ...NONE, [key]: true }, ROSTER);
  stepTitle(t, { ...NONE }, ROSTER);
  return r;
}

/** A title parked on the SINGLE ATTACK roster. */
function atRoster() {
  const t = createTitle();
  const single = MODES.findIndex((m) => m.id === 'single');
  for (let i = 0; i < single; i++) tap(t, 'down');
  tap(t, 'confirm');
  return t;
}

// ---- getting there --------------------------------------------------------
{
  const t = atRoster();
  check(t.pickingAttack === true, 'SINGLE ATTACK did not open the roster');
  check(t.pickingDifficulty === false, 'the difficulty stage opened too early');
}

// ---- X FROM THE ROSTER, the reported bug ----------------------------------
{
  const t = atRoster();
  tap(t, 'cancel');
  check(t.pickingAttack === false,
    'X on the attack roster did nothing — issue #6, the latched pressed()');
  check(t.mode === null, 'X out of the roster should land back on the modes');
}

// ---- and one stage at a time out of the difficulty list --------------------
{
  const t = atRoster();
  tap(t, 'confirm');
  check(t.pickingDifficulty === true, 'choosing an attack did not open its difficulties');
  tap(t, 'cancel');
  check(t.pickingDifficulty === false, 'X did not leave the difficulty list');
  check(t.pickingAttack === true,
    'X from the difficulties should step back to the ROSTER, not all the way out');
  tap(t, 'cancel');
  check(t.pickingAttack === false, 'a second X did not leave the roster');
}

// ---- the cursor wraps, and each stage walks its own list -------------------
{
  const t = createTitle();
  check(t.index === 0, 'the title should start on the first mode');
  tap(t, 'up');
  // MODES + the two TITLE_EXTRAS rows, so the wrap lands on the LAST of them.
  check(t.index === MODES.length + TITLE_EXTRAS.length - 1,
    'up from the top should wrap onto the last extra row');
  tap(t, 'down');
  check(t.index === 0, 'down from the last row should wrap to the top');
}

// ---- CREDITS IS TOP-LEVEL NOW, not a settings page ------------------------
// It moved out of the hub (settings is where you change something; the credits
// change nothing), and the two halves of that are easy to do independently:
// leaving it listed in both places, or moving the row and leaving X to drop
// the player into the hub they never opened.
{
  check(!SETTINGS_PAGES.some((p) => p.id === 'credits'),
    'CREDITS should no longer be a settings page');
  check(TITLE_EXTRAS.map((e) => e.id).join(',') === 'settings,credits',
    `the title's extra rows should be SETTINGS then CREDITS, got `
    + TITLE_EXTRAS.map((e) => e.id).join(','));

  const t = createTitle();
  for (let i = 0; i < MODES.length + 1; i++) tap(t, 'down');
  check(t.index === MODES.length + 1, 'the cursor should reach the CREDITS row');
  tap(t, 'confirm');
  check(t.settings?.page === 'credits', 'confirm on CREDITS should open it directly');
  check(t.settings?.root === true, 'it opens as a ROOT page, not through the hub');

  // The cursor walks its three rows...
  tap(t, 'down');
  check(t.settings.cursor === 1, 'down should walk the credits rows');
  tap(t, 'up');
  check(t.settings.cursor === 0, 'and up should come back');
  check(CREDITS.length === 3, `three credit rows, got ${CREDITS.length}`);

  // ...and X leaves for the TITLE, not for the settings hub.
  tap(t, 'cancel');
  check(t.settings === null,
    'X out of CREDITS should return to the title, not open the settings hub');
}

// ---- the link comes back as data, not as a window.open ---------------------
// `sim/` has no DOM and every verifier here runs under Node, so a row that
// goes somewhere has to SAY so and let the driver do it. Two ways to get this
// wrong that look identical from the menu: opening nothing, and opening on
// every row.
{
  const wander = CREDITS.findIndex((c) => c.who === 'WandeR');
  check(wander >= 0, 'the WandeR row went missing');
  check(creditLink(CREDITS[wander]) === 'https://wander22lstr.carrd.co',
    `WandeR's link should be the carrd, got ${creditLink(CREDITS[wander])}`);

  // SUPPORT is the Ko-fi page, and it is the row that proves the builder has
  // to stop appending a trailing slash: `ko-fi.com/shadowcrystaldev/` is a
  // DIFFERENT URL that happens to redirect. An href should be the address.
  const support = CREDITS.findIndex((c) => c.role === 'SUPPORT');
  check(support >= 0, 'the SUPPORT row went missing');
  check(creditLink(CREDITS[support]) === 'https://ko-fi.com/shadowcrystaldev',
    `SUPPORT should be the Ko-fi page, got ${creditLink(CREDITS[support])}`);
  // It has no `who`, so the page draws role + link and no name line. A link on
  // a row with no name has to survive that layout branch.
  check(CREDITS[support].who === '', 'SUPPORT is a role with no name');
  // The DISPLAY string carries no scheme — the page shows a readable host and
  // creditLink builds the href — so a row whose `link` already had "https://"
  // would silently produce "https://https://...".
  check(!CREDITS.some((c) => String(c.link ?? '').includes('://')),
    'credit links are stored bare; creditLink adds the scheme');

  const t = createTitle();
  for (let i = 0; i < MODES.length + 1; i++) tap(t, 'down');
  tap(t, 'confirm');
  for (let i = 0; i < wander; i++) tap(t, 'down');
  const hit = tap(t, 'confirm');
  check(hit.link === 'https://wander22lstr.carrd.co',
    `confirm on WandeR should return the href, got ${hit.link}`);
  check(t.settings?.page === 'credits', 'and it should stay on the page');

  // ONE HREF PER PRESS. `pressed()` is edge-detected, and it has to be: the
  // driver turns every `out.link` into a `window.open`, so a confirm that
  // reported the link on each held frame would fan a run of popups out of one
  // keypress — and the frame batch after a throttled tab resumes can be dozens
  // of steps long.
  const t4 = createTitle();
  for (let i = 0; i < MODES.length + 1; i++) tap(t4, 'down');
  tap(t4, 'confirm');
  for (let i = 0; i < wander; i++) tap(t4, 'down');
  let opens = 0;
  for (let f = 0; f < 20; f++) {
    if (stepTitle(t4, { ...NONE, confirm: true }, ROSTER).link) opens += 1;
  }
  check(opens === 1, `a confirm HELD for 20 frames should open one link, got ${opens}`);
  stepTitle(t4, { ...NONE }, ROSTER);
  check(stepTitle(t4, { ...NONE, confirm: true }, ROSTER).link,
    'and a fresh press after releasing should open it again');

  // A row with no link is a NO-OP: no href, and no error buzz either, because
  // nothing is broken.
  // Developer is the row with no link now that SUPPORT has one.
  const noLink = CREDITS.findIndex((c) => !c.link);
  const t2 = createTitle();
  for (let i = 0; i < MODES.length + 1; i++) tap(t2, 'down');
  tap(t2, 'confirm');
  for (let i = 0; i < noLink; i++) tap(t2, 'down');
  const miss = tap(t2, 'confirm');
  check(!miss.link, `a row with no link should return none, got ${miss.link}`);
  check(!miss.error, 'and it should not buzz — there is just nothing there');
}
{
  const t = atRoster();
  tap(t, 'down');
  check(t.attackIndex === 1, 'the roster cursor did not move');
  tap(t, 'up');
  tap(t, 'up');
  check(t.attackIndex === ROSTER.length - 1, 'the roster cursor did not wrap');
}

// ---- SETTINGS still opens and closes with one press each -------------------
{
  const t = createTitle();
  for (let i = 0; i < MODES.length; i++) tap(t, 'down');
  check(t.index === MODES.length, 'could not reach the SETTINGS row');
  tap(t, 'confirm');
  check(t.settings !== null, 'SETTINGS did not open');
  check(t.settings.page === null, 'SETTINGS should open on its hub');
  tap(t, 'cancel');
  check(t.settings === null, 'X did not close SETTINGS');
}

// ---- the GRAPHICS page: two toggles, both persisted through `dirty` --------
{
  const t = createTitle();
  check(t.scaling === 'fit', `the default scaling should fill the window, got ${t.scaling}`);
  check(t.shake === true, 'the shake should default ON, as the game has it');
  for (let i = 0; i < MODES.length; i++) tap(t, 'down');
  tap(t, 'confirm');
  const gfx = SETTINGS_PAGES.findIndex((p) => p.id === 'graphics');
  check(gfx >= 0, 'there is no GRAPHICS page');
  for (let i = 0; i < gfx; i++) tap(t, 'down');
  tap(t, 'confirm');
  check(t.settings.page === 'graphics', `GRAPHICS did not open, got ${t.settings.page}`);
  t.dirty = false;
  tap(t, 'right');
  check(t.scaling === 'pixel', 'the first row should toggle the screen size');
  check(t.dirty === true, 'a graphics change must mark the settings dirty to persist');
  tap(t, 'down');
  tap(t, 'right');
  check(t.shake === false, 'the second row should toggle the shake');
  tap(t, 'cancel');
  check(t.settings.page === null, 'X did not return to the settings hub');
}

// ---- THE ITEMS PAGE: any item, any of the twelve slots --------------------
// It was a stub that any keypress closed. The failure modes now are all quiet
// ones — a page that edits the wrong slot, or edits a copy the run never
// reads — so each half is pinned separately.
{
  // Every battle-usable item is offered, and the roster leads with EMPTY so a
  // slot can be cleared. A picker that cannot clear is a page you can fill and
  // never un-fill.
  check(ITEM_PICKER[0] === 0, 'the picker should lead with the empty slot');
  check(ITEM_PICKER.length === ITEM_IDS.length + 1,
    `the picker offers every item plus empty; ${ITEM_PICKER.length} vs ${ITEM_IDS.length}`);
  check(ITEM_IDS.length > 25,
    `the roster should be the whole battle-usable list, got ${ITEM_IDS.length}`);
  // Names come from scr_iteminfo's `itemnameb`, which is where the casing
  // lives — CLAUDE.md's Spincake note. scr_itemnamelist spells three of them
  // differently and is NOT what the menu draws.
  check(ITEMS[7].name === 'Spincake', `it is Spincake, got ${ITEMS[7].name}`);
  check(ITEMS[11].name === 'ClubsSandwich', `got ${ITEMS[11].name}`);
  // ORIGINAL: LancerCookie's description says 50 and scr_itemuse heals 1.
  check(ITEMS[9].amount === 1,
    `LancerCookie heals 1 in scr_itemuse whatever its description says, got ${ITEMS[9].amount}`);
  check(ITEMS[9].desc.includes('50'), 'and its description still says 50 — both are the game');

  const nav = () => {
    const t = createTitle();
    for (let i = 0; i < MODES.length; i++) tap(t, 'down');
    tap(t, 'confirm'); // SETTINGS
    const items = SETTINGS_PAGES.findIndex((p) => p.id === 'items');
    for (let i = 0; i < items; i++) tap(t, 'down');
    tap(t, 'confirm'); // ITEMS
    return t;
  };

  const t = nav();
  check(t.settings?.page === 'items', 'ITEMS should open its page, not close the menu');
  check(t.bag.length === INVENTORY_SIZE, `the bag is ${INVENTORY_SIZE} slots`);

  // TWO COLUMNS: up/down step by TWO, left/right toggle the column and are
  // each other's inverse. Straight off obj_battlecontroller's own grid.
  const it = t.settings.items;
  check(it.slot === 0, 'the cursor starts on slot 0');
  tap(t, 'down');
  check(it.slot === 2, `down steps by two in a two-column grid, got ${it.slot}`);
  tap(t, 'right');
  check(it.slot === 3, `right toggles the column, got ${it.slot}`);
  tap(t, 'left');
  check(it.slot === 2, `and left toggles it back, got ${it.slot}`);
  // Clamped at the ends, like the battle menu — not wrapped.
  for (let i = 0; i < 20; i++) tap(t, 'down');
  check(it.slot < INVENTORY_SIZE, `the cursor must stay in the bag, got ${it.slot}`);
  for (let i = 0; i < 20; i++) tap(t, 'up');
  check(it.slot >= 0, `and not run off the top, got ${it.slot}`);

  // Confirm opens the picker ON the slot's current contents, so nudging one
  // slot is a keypress rather than a walk down a 32-item list.
  const t2 = nav();
  const i2 = t2.settings.items;
  i2.slot = 0;
  const had = t2.bag[0];
  tap(t2, 'confirm');
  check(i2.stage === 'pick', 'confirm should open the picker');
  check(ITEM_PICKER[i2.pick] === had,
    `the picker should open on what the slot holds (${had}), not the top`);

  // Setting writes THAT slot and nothing else, and marks the settings dirty
  // so the driver persists it.
  const before = [...t2.bag];
  tap(t2, 'down');
  const want = ITEM_PICKER[i2.pick];
  t2.dirty = false;
  tap(t2, 'confirm');
  check(i2.stage === 'slots', 'setting an item returns to the grid');
  check(t2.bag[0] === want, `slot 0 should now hold ${want}, got ${t2.bag[0]}`);
  check(t2.dirty === true, 'a bag change must mark the settings dirty, or it is never saved');
  check(t2.bag.slice(1).join() === before.slice(1).join(),
    'setting one slot must not disturb the others');

  // X out of the picker CHANGES NOTHING — the escape hatch has to be real.
  const t3 = nav();
  const i3 = t3.settings.items;
  const keep = [...t3.bag];
  tap(t3, 'confirm');
  tap(t3, 'down');
  tap(t3, 'down');
  tap(t3, 'cancel');
  check(i3.stage === 'slots', 'X should back out of the picker');
  check(t3.bag.join() === keep.join(), 'and leave the bag alone');
  // ...and X from the grid goes back to the hub, one stage at a time.
  tap(t3, 'cancel');
  check(t3.settings?.page === null, 'X from the grid returns to the settings hub');
}

// ---- SHARE SETUP copies, it does not open ---------------------------------
// It sits in the hub's page list but is not a page: confirming returns
// `out.share` for the driver to act on and STAYS on the hub. Two ways to get
// that wrong that both look plausible — opening a blank page, or firing the
// share every frame the row is highlighted.
{
  const t = createTitle();
  for (let i = 0; i < MODES.length; i++) tap(t, 'down');
  tap(t, 'confirm');
  const row = SETTINGS_PAGES.findIndex((p) => p.id === 'share');
  check(row >= 0, 'SHARE SETUP should be in the settings hub');
  for (let i = 0; i < row; i++) tap(t, 'down');

  const r = tap(t, 'confirm');
  check(r.share === true, 'confirming SHARE should return share:true for the driver');
  check(t.settings.page === null, 'and STAY on the hub — it is not a page');
  check(t.settings.shared > 0, 'it should raise the copied confirmation');

  // The confirmation is a COUNTDOWN, not a latch, so it cannot stick on after
  // the player moves away.
  const held = t.settings.shared;
  tap(t, 'down');
  check(t.settings.shared < held, 'the confirmation should tick down');
  for (let i = 0; i < 200; i++) stepTitle(t, { ...NONE }, ROSTER);
  check(t.settings.shared === 0, 'and reach zero on its own');

  // Walking onto the row does NOT fire it — only a press does.
  const t2 = createTitle();
  for (let i = 0; i < MODES.length; i++) tap(t2, 'down');
  tap(t2, 'confirm');
  let fired = false;
  for (let i = 0; i < row; i++) { if (tap(t2, 'down').share) fired = true; }
  check(!fired, 'moving the cursor onto SHARE must not copy anything');
}

// ---- and the bag REACHES the fight ----------------------------------------
// The page could be perfect and edit a copy nothing reads. `freshInventory` is
// the one funnel, and it DROPS empty slots because scr_itemshift_temp compacts
// the list and everything downstream assumes there are no holes.
{
  const custom = [39, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const bag = freshInventory(custom);
  check(bag.join() === '39,7', `empty slots are dropped, got [${bag.join()}]`);
  check(freshInventory().join() === DEFAULT_BAG.join(),
    'no custom bag falls back to the default loadout');
  check(freshInventory([]).join() === '', 'an all-empty bag is empty, not the default');
}

console.log('title navigation — modes, roster, difficulties, settings\n');
console.log(`→ ${MODES.length} modes + ${TITLE_EXTRAS.map((e) => e.name).join(' + ')},`
  + ` ${SETTINGS_PAGES.length} settings pages`);
console.log(`→ ITEMS: ${INVENTORY_SIZE} slots, any of ${ITEM_IDS.length} items or empty in each`);
console.log('→ X steps back exactly one stage at each level');

if (failures.length) {
  for (const f of failures) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  title menu navigation');
