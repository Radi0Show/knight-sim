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
  ITEM_PICKER, GEAR_PAGES, pocketOf, wornBy,
  armUnused, unusedRowStyle, UNUSED_PRESSES, UNUSED_SHATTER, UNUSED_SHAKE,
  partyTabs, previewStats,
} from '../sim/modes.js';
import { canEquip } from '../sim/equipment.js';
import { mergeColor } from '../sim/gml.js';
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

// Rows move; ids do not. Every drive resolves its target through
// TITLE_EXTRAS so adding a row (GEAR did it) shifts nothing here.
const extraAt = (id) => MODES.length + TITLE_EXTRAS.findIndex((x) => x.id === id);

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
  // GEAR sits first — the loadout is a thing the fight balances around, so
  // it earns the top of the extras rather than a settings page.
  check(TITLE_EXTRAS.map((e) => e.id).join(',') === 'gear,settings,credits',
    `the title's extra rows should be GEAR, SETTINGS, CREDITS, got `
    + TITLE_EXTRAS.map((e) => e.id).join(','));

  const t = createTitle();
  for (let i = 0; i < extraAt('credits'); i++) tap(t, 'down');
  check(t.index === extraAt('credits'), 'the cursor should reach the CREDITS row');
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
  for (let i = 0; i < extraAt('credits'); i++) tap(t, 'down');
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
  for (let i = 0; i < extraAt('credits'); i++) tap(t4, 'down');
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
  // nothing is broken. EVERY credits row happens to carry a link now (the
  // Developer row gained radi0.dev), so the no-op path is asserted on the
  // pure function rather than by navigating to a row that may not exist —
  // `findIndex` returned -1 when the last linkless row went away, which
  // silently re-pointed this check at row 0 and failed there instead.
  check(creditLink({ role: 'x', who: 'y', link: null }) === null,
    'a row with no link should return no href');
  const noLink = CREDITS.findIndex((c) => !c.link);
  if (noLink >= 0) {
    const t2 = createTitle();
    for (let i = 0; i < extraAt('credits'); i++) tap(t2, 'down');
    tap(t2, 'confirm');
    for (let i = 0; i < noLink; i++) tap(t2, 'down');
    const miss = tap(t2, 'confirm');
    check(!miss.link, `a row with no link should return none, got ${miss.link}`);
    check(!miss.error, 'and it should not buzz — there is just nothing there');
  }

  // ...and every row that DOES carry one resolves to a scheme-prefixed href.
  for (const row of CREDITS) {
    if (!row.link) continue;
    check(creditLink(row) === `https://${row.link}`,
      `${row.who || row.role}: href should be https://${row.link}, got ${creditLink(row)}`);
  }
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
  for (let i = 0; i < extraAt('settings'); i++) tap(t, 'down');
  check(t.index === extraAt('settings'), 'could not reach the SETTINGS row');
  tap(t, 'confirm');
  check(t.settings !== null, 'SETTINGS did not open');
  check(t.settings.page === null, 'SETTINGS should open on its hub');
  tap(t, 'cancel');
  check(t.settings === null, 'X did not close SETTINGS');
}

// ---- the GRAPHICS page: three toggles, all persisted through `dirty` -------
{
  const t = createTitle();
  check(t.scaling === 'fit', `the default scaling should fill the window, got ${t.scaling}`);
  check(t.shake === true, 'the shake should default ON, as the game has it');
  check(t.swapZX === false, 'the touch buttons should default to Z / X, as shipped');
  for (let i = 0; i < extraAt('settings'); i++) tap(t, 'down');
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
  // TOUCH BUTTONS — the Z/X swap, the third row. A layout switch the driver
  // turns into a CSS class; all the menu owns is the flag and that it is
  // persisted like the other two.
  tap(t, 'down');
  t.dirty = false;
  tap(t, 'right');
  check(t.swapZX === true, 'the third row should swap the touch buttons');
  check(t.dirty === true, 'the swap must mark the settings dirty to persist');
  tap(t, 'left');
  check(t.swapZX === false, 'and toggle back');
  // The cursor WRAPS over the three rows, both ways — the page used to flip
  // `1 - cursor`, which a third row silently breaks.
  tap(t, 'down');
  check(t.settings.cursor === 0,
    `down from the third row should wrap to the first, got ${t.settings.cursor}`);
  tap(t, 'up');
  check(t.settings.cursor === 2,
    `up from the first row should wrap to the third, got ${t.settings.cursor}`);
  tap(t, 'cancel');
  check(t.settings.page === null, 'X did not return to the settings hub');
}

// ---- THE POCKET LISTS EVERYTHING, worn or not -----------------------------
// The equip list used to drop every piece anyone in the party had on, on the
// claim that the game cannot put one piece on two characters. It can:
// `global.armor` is a 48-slot bag of plain ids with no uniqueness rule
// (scr_armorget appends with only a noroom check; the dark menu's equip swap
// hands the old piece back to it), so a second LodeStone is simply a second
// entry. The filter capped LodeStone at ONE wearer across the party and,
// because Kris starts in the ShadowMantle, hid the mantle from EVERY
// character's list — reported from play as "can't put it on all three" and
// "the mantle is missing". Driven for real here, the way the reports did it.
{
  const LODESTONE = 24;
  const MANTLE = 23;
  const nav = () => {
    const t = createTitle();
    for (let i = 0; i < extraAt('gear'); i++) tap(t, 'down');
    tap(t, 'confirm'); // GEAR / ITEMS hub
    const equip = GEAR_PAGES.findIndex((p) => p.id === 'equip');
    for (let i = 0; i < equip; i++) tap(t, 'down');
    tap(t, 'confirm'); // WEAPONS / ARMOR
    return t;
  };
  const t = nav();
  check(t.settings?.page === 'equip', 'WEAPONS / ARMOR should open its page');
  const eq = t.settings.equip;

  // The stepper and the renderer both build the list with the gear passed
  // in; whatever the gear, the list is the whole table. Only BlackShard —
  // the Knight's own drop — stays out, and only from the weapon pocket.
  check(pocketOf('armor', t.gear).includes(MANTLE),
    'the ShadowMantle must be listed while Kris is wearing it');
  check(pocketOf('armor', t.gear).length === pocketOf('armor').length,
    'the armour pocket must not shrink for worn pieces');
  check(pocketOf('weapon', t.gear).length === pocketOf('weapon').length,
    'nor the weapon pocket');
  check(!pocketOf('weapon', t.gear).includes(26), 'BlackShard stays out of the weapon pocket');
  check(pocketOf('armor', t.gear)[0] === 0, 'the pocket leads with the empty slot');

  // SIX LODESTONES: every armour slot of every character, through the menu.
  let landed = 0;
  for (let c = 0; c < 3; c++) {
    for (let slot = 1; slot <= 2; slot++) {
      while (eq.char !== c) tap(t, 'right');
      tap(t, 'confirm');                       // char -> slot
      while (eq.row !== slot) tap(t, 'down');
      tap(t, 'confirm');                       // slot -> pocket
      const pocket = pocketOf('armor', t.gear);
      // The cursor opens ON the worn piece — the intent at the slot confirm,
      // dead all the while the worn piece was filtered out of its own list
      // (indexOf -1, so every slot opened on "(Nothing)").
      const worn = t.gear[c].armor[slot - 1] ?? 0;
      check(pocket[eq.pocket] === worn,
        `char ${c} slot ${slot}: the cursor should open on the worn piece (${worn}), got ${pocket[eq.pocket]}`);
      const want = pocket.indexOf(LODESTONE);
      check(want >= 0, `char ${c} slot ${slot}: LodeStone should be in the list`);
      while (eq.pocket !== want) tap(t, 'down');
      const r = tap(t, 'confirm');
      check(r.selected === true && !r.error, `char ${c} slot ${slot}: equipping LodeStone should land`);
      if (t.gear[c].armor[slot - 1] === LODESTONE) landed += 1;
      tap(t, 'cancel');                        // slot -> char
    }
  }
  check(landed === 6, `all six armour slots should take a LodeStone, got ${landed}`);
  check(wornBy('armor', LODESTONE, t.gear).join() === '0,1,2',
    `wornBy should name all three wearers, got [${wornBy('armor', LODESTONE, t.gear).join()}]`);

  // THE MANTLE ON ALL THREE. scr_armorinfo allows it for everyone; the
  // renderer's wearer tag (K S R) is what tells a player who has it, in
  // place of the old filter's silence.
  for (let c = 0; c < 3; c++) {
    while (eq.char !== c) tap(t, 'right');
    tap(t, 'confirm');
    while (eq.row !== 1) tap(t, 'down');
    tap(t, 'confirm');
    const want = pocketOf('armor', t.gear).indexOf(MANTLE);
    while (eq.pocket !== want) tap(t, 'down');
    tap(t, 'confirm');
    tap(t, 'cancel');
  }
  check(t.gear.every((g) => g.armor[0] === MANTLE),
    `the ShadowMantle should go on all three, got ${JSON.stringify(t.gear.map((g) => g.armor))}`);
  check(wornBy('armor', MANTLE, t.gear).length === 3, 'wornBy should count all three mantle wearers');
  check(wornBy('armor', 0, t.gear).length === 0, 'the empty slot is worn by nobody');
  check(wornBy('weapon', t.gear[1].weapon, t.gear).join() === '1',
    "Susie's weapon is worn by Susie alone");
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
    // ITEMS moved out of SETTINGS and into the GEAR / ITEMS hub off the
    // title, alongside WEAPONS / ARMOR — the settings copies were stale
    // leftovers once the loadout got its own row.
    for (let i = 0; i < extraAt('gear'); i++) tap(t, 'down');
    tap(t, 'confirm'); // GEAR / ITEMS hub
    const items = GEAR_PAGES.findIndex((p) => p.id === 'items');
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
  // ...and X from the grid goes back one stage at a time — to the GEAR hub
  // now, since that is the door the page was entered through. The exit
  // remembers where it came from (`s.back`); the same page entered through
  // settings would return there.
  tap(t3, 'cancel');
  check(t3.settings?.page === 'gearhub', 'X from the grid returns to the GEAR / ITEMS hub');
  tap(t3, 'cancel');
  check(t3.settings === null, 'and X from the hub leaves to the title');
}

// ---- SHARE SETUP copies, it does not open ---------------------------------
// It sits in the hub's page list but is not a page: confirming returns
// `out.share` for the driver to act on and STAYS on the hub. Two ways to get
// that wrong that both look plausible — opening a blank page, or firing the
// share every frame the row is highlighted.
{
  const t = createTitle();
  for (let i = 0; i < extraAt('settings'); i++) tap(t, 'down');
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
  for (let i = 0; i < extraAt('settings'); i++) tap(t2, 'down');
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

// ---- THE UNUSED ROW: INERT BY DEFAULT, AND IT MUST STAY THAT WAY ---------
//
// This is the half of the seam that matters most to the vanilla build. A
// driver that never calls `armUnused` must see EXACTLY the row it has always
// seen: dim, error-on-confirm, no page, and — the trap this file was written
// about — no new intent leaking out of `stepTitle`'s whitelist either.
/** A title parked on the settings hub with the cursor on UNUSED. */
function atUnusedRow() {
  const t = createTitle();
  for (let i = 0; i < extraAt('settings'); i++) tap(t, 'down');
  tap(t, 'confirm');
  const row = SETTINGS_PAGES.findIndex((p) => p.id === 'unused');
  for (let i = 0; i < row; i++) tap(t, 'down');
  return t;
}
{
  const t = atUnusedRow();
  const r = tap(t, 'confirm');
  check(r.error === true, 'UNARMED: confirming UNUSED still sounds the error');
  check(!r.selected, 'UNARMED: it does not select');
  check(t.settings.page === null, 'UNARMED: it opens no page');
  check(r.proceed === false, 'UNARMED: no proceed intent, ever');
  check(r.press === 0, 'UNARMED: no press is counted');
  check(r.shatter === false, 'UNARMED: nothing shatters');
  check(t.unused === null, 'UNARMED: pressing it creates no state');
  const style = unusedRowStyle(t);
  check(style.name === 'UNUSED' && style.dim === true && style.heat === 0,
    'UNARMED: the row still reads a dim UNUSED at zero heat');
  check(style.sprite === null, 'UNARMED: and names no shatter sheet');
  // THE RAMP'S ZERO IS THE OLD LINE. render/title.js draws the row in
  // `mergeColor(DIM, style.red, style.heat)`, so heat 0 has to BE the dim grey
  // the vanilla row has always been — otherwise the unarmed build changed
  // colour, which is exactly what this section exists to forbid.
  check(mergeColor([128, 128, 138], style.red, style.heat).join() === '128,128,138',
    'UNARMED: heat 0 mixes to exactly the old DIM, so the vanilla row is unmoved');
  // Thirty more presses change nothing. The row is a wall.
  for (let i = 0; i < 30; i++) tap(t, 'confirm');
  check(unusedRowStyle(t).name === 'UNUSED', 'UNARMED: it never becomes anything');
}

// ---- ARMED: it reddens, it shatters, and THEN it proceeds ----------------
//
// ONE FRAME AT A TIME. `tap()` is two stepTitle calls (press then release), so
// it cannot count an animation's frames; `idle()` is the single frame with
// nothing held, which is what the shatter is stepped by.
function idle(t) {
  return stepTitle(t, { ...NONE }, ROSTER);
}
{
  const t = atUnusedRow();
  armUnused(t, { sprite: 'spr_test_shatter', fragments: 6 });
  check(unusedRowStyle(t).heat === 0, 'ARMED: a fresh row is cold');
  check(unusedRowStyle(t).sprite === 'spr_test_shatter',
    'ARMED: the driver\'s sheet is carried out to the renderer');

  // EVERY PRESS SHORT OF THE LAST refuses, counts, and is hotter than the one
  // before it. The monotonicity is the user's own requirement ("more and more
  // red the more you press"), so it is asserted press by press rather than
  // read off the formula.
  let lastHeat = -1;
  for (let i = 1; i < UNUSED_PRESSES; i++) {
    const r = tap(t, 'confirm');
    check(r.press === i, `press ${i} reports its own count`);
    check(r.error === true, `press ${i} still refuses (it is heating, not opening)`);
    check(r.selected !== true, `press ${i} is not a selection`);
    check(r.proceed === false, `press ${i} does not proceed`);
    check(r.shatter === false, `press ${i} does not break it`);
    check(t.settings.page === null, `press ${i} opens no page`);
    check(t.dirty === true, `press ${i} asks the driver to persist`);
    t.dirty = false;
    const h = unusedRowStyle(t).heat;
    check(h > lastHeat, `press ${i} is strictly redder than press ${i - 1}`);
    lastHeat = h;
    check(t.unused.shatter === null, `press ${i} has not started the break`);
  }
  check(Math.abs(lastHeat - (UNUSED_PRESSES - 1) / UNUSED_PRESSES) < 1e-12,
    `nineteen presses is 19/20 of the way, got ${lastHeat}`);
  check(unusedRowStyle(t).name === 'UNUSED',
    'and it is still UNUSED right up to the last press');

  // ---- THE TWENTIETH PRESS BREAKS IT ------------------------------------
  //
  // Read on the PRESS frame, not through `tap`: tap's release frame is already
  // the first frame of the animation, and `proceed`/`shatter` on it would be
  // the shatter block's answer rather than the press's.
  const r20 = stepTitle(t, { ...NONE, confirm: true }, ROSTER);
  check(r20.press === UNUSED_PRESSES, 'the twentieth press reports twenty');
  check(r20.shatter === true, '...and reports that it broke the row');
  check(r20.selected === true, '...as a SELECTION — the one press the row accepts');
  check(r20.error !== true, '...not the refusal the other nineteen were');
  check(r20.proceed === false, 'the break is not the door: the glass falls first');
  check(t.unused.taken === false, '...and the route is not taken yet');
  check(unusedRowStyle(t).shattering === true, 'the row now reads as shattering');

  // THE FIELD. One fragment per sub-image, all of them AT THE ROW'S OWN SPOT
  // (dx = dy = 0) — the chapter 4 shape, and the reason it looks smooth.
  const sh = t.unused.shatter;
  check(sh !== null, 'a fragment field exists');
  check(sh.frags.length === 6, 'one fragment per sub-image of the driver\'s sheet');
  check(sh.frags.every((f, i) => f.i === i), '...each wearing its own sub-image');
  check(sh.frags.every((f) => f.dx === 0 && f.dy === 0),
    '...and every one born exactly where the intact row was');
  check(sh.frags.every((f) => f.direction >= 0 && f.direction < 360),
    'every fragment already has a direction — random(360), drawn at birth');
  check(new Set(sh.frags.map((f) => f.direction)).size === 6,
    '...and they are six different directions, so the stream really advanced');
  check(sh.frags.every((f) => f.gravity >= 0.4 && f.gravity < 0.52),
    'every gravity is 0.4 + random(0.12), the ch4 spread');

  // ---- THE HOLD: nineteen frames of absolutely nothing moving ------------
  //
  // This is the whole effect. `scr_delay_var(..., 20)` lands all three vars
  // together, so the picture sits intact and then comes apart; a fragment that
  // drifted during the hold would make the break visible before it happens.
  let held = 0;
  while (t.unused.shatter && t.unused.shatter.t < UNUSED_SHATTER.delay - 1) {
    const rr = idle(t);
    held += 1;
    check(rr.proceed === false, `hold frame ${t.unused.shatter.t}: not finished`);
    check(t.unused.shatter.frags.every((g) => g.dx === 0 && g.dy === 0),
      `hold frame ${t.unused.shatter.t}: every fragment still exactly where it started`);
  }
  // THE PRESS FRAME IS PART OF THE HOLD. `stepSettings` builds the field at
  // `t = 0` and the shatter block only starts stepping it the frame after, so
  // the picture is intact on the press frame and on `delay - 1` frames after
  // it — twenty frames of intact row, which is `_delay` exactly.
  check(held === UNUSED_SHATTER.delay - 1,
    `the hold ran ${UNUSED_SHATTER.delay} frames of intact row, got ${held + 1}`);
  // FRAME `delay` IS THE ONE THAT MOVES. Speed 4 lands, gravity lands, and
  // every fragment leaves the spot on the same frame.
  idle(t);
  check(t.unused.shatter.t === UNUSED_SHATTER.delay, 'the field is at frame 20');
  check(t.unused.shatter.frags.every((g) => g.dx !== 0 || g.dy !== 0),
    'frame 20: the delayed vars land together and everything moves at once');

  // ---- INPUT IS SWALLOWED WHILE THE GLASS IS FALLING ---------------------
  const beforeCursor = t.settings.cursor;
  const beforePresses = t.unused.presses;
  const rIn = stepTitle(t, { ...NONE, down: true }, ROSTER);
  check(rIn.moved === false, 'the shatter swallows input — nothing reports a move');
  check(t.settings.cursor === beforeCursor, '...the settings cursor is untouched');
  const rZ = stepTitle(t, { ...NONE, confirm: true }, ROSTER);
  check(rZ.press === 0 && t.unused.presses === beforePresses,
    '...and confirm cannot count another press onto a row that is already glass');

  // ---- IT ENDS, ONCE, AND THE DOOR IS THE LAST FRAME --------------------
  let doneAt = -1;
  for (let f = 0; f < 400 && doneAt < 0; f++) {
    if (idle(t).proceed) doneAt = f;
  }
  check(doneAt >= 0, `the shatter finishes (${doneAt} frames after the move)`);
  check(t.unused.taken === true, 'and the route is taken on that frame');
  check(t.unused.shatter === null, '...the field is gone');
  check(t.settings === null, '...the SETTINGS SCREEN IS CLOSED — back to the title');
  check(t.dirty === true, '...and the driver is asked to persist it');
  const after = unusedRowStyle(t);
  check(after.name === 'PROCEED', 'the row now reads PROCEED');
  check(after.sub === '(PROCEED)', '...with the mod\'s own bracketed echo under it');
  check(after.dim === false, '...and it is no longer dimmed');
  check(after.heat === 1, '...at full heat');
  check(after.shattering === false, '...and it is not shattering any more');

  // ONE WAY, AND ONE SIGNAL. Proceed fires on exactly one frame.
  let again = 0;
  for (let f = 0; f < 30; f++) if (idle(t).proceed) again += 1;
  check(again === 0, 'proceed fires on exactly ONE frame, never again');
  check(t.unused.taken === true, 'taken never goes back to false');
}

// ---- THE WHOLE BREAK IS BOUNDED, AND IT IS THE CH4 SHAPE ----------------
//
// A full-size field (31 sub-images, the mod's own sheet) run to the end. This
// is the assertion that the animation cannot hang the title screen: every
// fragment either falls off the bottom or hits the `scr_doom` bound.
{
  const t = atUnusedRow();
  armUnused(t, { sprite: 'spr_roaringknight_finalshatter' });
  for (let i = 1; i < UNUSED_PRESSES; i++) tap(t, 'confirm');
  stepTitle(t, { ...NONE, confirm: true }, ROSTER);
  check(t.unused.shatter.frags.length === 31,
    '31 fragments — sprite_get_number(spr_roaringknight_finalshatter)');
  let frames = 1;
  while (t.unused.shatter && frames < 500) { idle(t); frames += 1; }
  check(t.unused.taken === true, `the break ends, after ${frames} frames`);
  check(frames <= UNUSED_SHATTER.doom,
    `...within scr_doom's 120 (${frames}), so nothing outlives its bound`);
  check(frames > UNUSED_SHATTER.delay,
    '...and after the hold, so the pieces really flew');
}

// ---- THE RAMP SURVIVES A RELOAD -----------------------------------------
{
  // Seven presses, persisted, re-armed: the row comes back seven along, not
  // fresh. Without this the ramp is decoration and the player does twenty
  // presses every visit.
  const t = atUnusedRow();
  armUnused(t, {});
  for (let i = 0; i < 7; i++) tap(t, 'confirm');
  const saved = { presses: t.unused.presses, taken: t.unused.taken };
  const t2 = atUnusedRow();
  armUnused(t2, saved);
  check(t2.unused.presses === 7, 'a reload resumes at the press it left on');
  check(unusedRowStyle(t2).heat === 7 / UNUSED_PRESSES, '...at the same heat');
  // A taken row comes back PROCEED whatever the saved count says.
  const t3 = createTitle();
  armUnused(t3, { taken: true, presses: 0 });
  check(unusedRowStyle(t3).taken === true && unusedRowStyle(t3).name === 'PROCEED',
    'a taken row comes back already PROCEED');
  check(t3.unused.presses === UNUSED_PRESSES, '...with a full bar behind it');
  // A hostile entry cannot produce a row that is half-red and already taken.
  const t4 = createTitle();
  armUnused(t4, { presses: 9999 });
  check(t4.unused.presses === UNUSED_PRESSES && t4.unused.taken === false,
    'an out-of-range saved count is clamped, and does not take the route');
  const t5 = createTitle();
  armUnused(t5, { presses: -5 });
  check(t5.unused.presses === 0, '...in both directions');
  check(t5.unused.shatter === null, 'and no saved value can arm a live shatter');
  // A CLAMPED-FULL ROW STILL HAS TO BE PRESSED. This is the one that would
  // otherwise let a corrupt entry walk straight onto the Weird Route.
  const t6 = atUnusedRow();
  armUnused(t6, { presses: UNUSED_PRESSES });
  check(unusedRowStyle(t6).taken === false, 'a full bar is not a taken route');
  const rFull = stepTitle(t6, { ...NONE, confirm: true }, ROSTER);
  check(rFull.shatter === true && rFull.proceed === false,
    '...it takes one more press to break, and the break still is not the door');
}

// ---- THE EQUIP PAGE READS A ROSTER, and defaults to the vanilla three ----
{
  const t = createTitle();
  check(t.party === null, 'a fresh title carries no roster override');
  const tabs = partyTabs(t);
  check(tabs.length === 3, 'the default roster is the vanilla three');
  check(tabs.map((x) => x.name).join() === 'KRIS,SUSIE,RALSEI', 'in the vanilla order');
  check(tabs.map((x) => x.char).join() === '0,1,2',
    'and tab position equals char flag for the vanilla three — which is why the '
    + 'bug this separates was invisible');

  // A TWO-PERSON ROSTER whose second member is NOT Susie. Tab 1 is char flag
  // 3 (Noelle), so the refusal test must consult 3 and not 1: ThornRing
  // (weapon 13) is Noelle-only, and Susie's Brave Ax (6) is not hers.
  const wr = createTitle();
  wr.party = [
    { name: 'KRIS', char: 0, base: { at: 14, df: 2, magic: 0 } },
    { name: 'NOELLE', char: 3, base: { at: 5, df: 1, magic: 13 } },
  ];
  const wtabs = partyTabs(wr);
  check(wtabs.length === 2, 'a supplied roster is the roster');
  check(canEquip('weapon', 13, wtabs[1].char) === true,
    'Noelle CAN equip the ThornRing (weaponchar4temp = 1 in the dump)');
  check(canEquip('weapon', 13, 1) === false,
    '...and Susie still cannot — the char4 flag added nobody to char1..3');
  check(canEquip('weapon', 6, wtabs[1].char) === false,
    'Noelle cannot equip Susie\'s Brave Ax');
  check(canEquip('weapon', 23, 0) === true && canEquip('weapon', 23, 1) === false,
    'and every vanilla answer is exactly what it was (Saber10 is Kris-only)');

  // The preview reads the ROSTER's stat block, not PARTY[slot]: tab 1's magic
  // is Noelle's 13, never Susie's 2.
  wr.gear = [{ weapon: 0, armor: [] }, { weapon: 0, armor: [] }];
  check(previewStats(wr, 1).magic === 13,
    'the stat preview uses the roster\'s own base, not PARTY[1] = Susie');

  // And the CURSOR wraps the roster's size. Two tabs: right, right returns
  // to 0 rather than walking onto a third that is not there.
  for (let i = 0; i < extraAt('gear'); i++) tap(wr, 'down');
  tap(wr, 'confirm');                     // the GEAR hub
  tap(wr, 'confirm');                     // WEAPONS / ARMOR
  check(wr.settings.equip.stage === 'char', 'the equip page is open');
  tap(wr, 'right');
  check(wr.settings.equip.char === 1, 'right moves to the second member');
  tap(wr, 'right');
  check(wr.settings.equip.char === 0, 'and wraps at TWO, not at three');

  // AND THE EQUIP REALLY LANDS, through the stepper rather than through
  // `canEquip` directly — testing the predicate proves the table, not the
  // page, and it was the PAGE that was passing the wrong index.
  const pocket = pocketOf('weapon', wr.gear);
  const put = (tab, id) => {
    wr.settings.equip = { stage: 'char', char: tab, row: 0, pocket: 0 };
    tap(wr, 'confirm');                                   // -> slot rows
    tap(wr, 'confirm');                                   // -> the pocket
    wr.settings.equip.pocket = pocket.indexOf(id);
    return tap(wr, 'confirm');
  };
  const r13 = put(1, 13);
  check(r13.error !== true && wr.gear[1].weapon === 13,
    'the page equips Noelle\'s ThornRing — the refusal reads char flag 3, not tab 1');
  const r6 = put(1, 6);
  check(r6.error === true && wr.gear[1].weapon === 13,
    'and refuses her Susie\'s Brave Ax, leaving what she had on');
  const r23 = put(0, 23);
  check(r23.error !== true && wr.gear[0].weapon === 23, 'Kris still takes Saber10');
}

// ---- THE RAMP AND THE KICK ARE ON SCREEN, ASSERTED AS PIXELS ------------
//
// WHY THIS SECTION EXISTS. Every assertion above this one is about STATE, and
// state is not what the player was promised. Delete `drawUnusedRow`'s ramp and
// put the flat white line back, or drop `style.shake` from the row's x, and
// all of it stays green — the same hole CLAUDE.md names twice ("a green suite
// does not mean a change took effect", and the renderer that threw on its
// first frame while 58 suites passed). The user's correction was entirely
// about what the row LOOKS LIKE, so what the row looks like is what is checked
// here: the colour actually painted into the glyph page, and the x the glyph
// actually lands on.
//
// HOW, with no browser. `drawText` blits a TINTED COPY of the font page —
// `tintedPage()` mints a canvas, fills it with the colour and hands it to
// `ctx.drawImage` — so a canvas stub that remembers its last `fillStyle` and a
// main context that records `(image, dx, dy)` recover both facts exactly. The
// font is made ready by stubbing `fetch` and `Image`, which is the only reason
// check-proceed-route could not do this over in the kaizo tree and said so.
//
// SABOTAGE-TESTED: reverting `mergeColor(DIM, style.red, style.heat)` to a
// flat `DIM`, and dropping `+ style.shake`, each turn this section red.
{
  const META = {
    name: 'fnt_mainbig',
    // Every printable ASCII glyph, all the same size — the metrics are not
    // under test, the colour and the position are.
    glyphs: Array.from({ length: 95 }, (_, i) => ({
      c: 32 + i, x: i * 16, y: 0, w: 12, h: 24, shift: 14, offset: 0,
    })),
  };
  const prevFetch = globalThis.fetch;
  const prevImage = globalThis.Image;
  const prevDoc = globalThis.document;
  globalThis.fetch = async () => ({ json: async () => META });
  globalThis.Image = class {
    constructor() { this.width = 1520; this.height = 24; }
    set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
  };

  const blits = [];
  let recording = false;
  const mkCtx = (owner) => new Proxy({}, {
    get(t, p) {
      if (p === 'canvas') return owner;
      if (p === 'measureText') return () => ({ width: 10 });
      if (p === 'createLinearGradient' || p === 'createRadialGradient') {
        return () => ({ addColorStop: () => {} });
      }
      // `tintedPage`: `g.fillStyle = color; g.fillRect(...)`. THIS is the pixel.
      if (p === 'fillRect') return () => { owner.fill = t.fillStyle; };
      if (p === 'drawImage') {
        return (img, ...a) => {
          // The 9-argument form drawText uses: dx/dy are arguments 5 and 6.
          if (owner.main && recording) blits.push({ fill: img?.fill ?? null, dx: a[4], dy: a[5] });
        };
      }
      if (typeof p === 'string') return t[p] !== undefined ? t[p] : () => undefined;
      return () => undefined;
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') return {};
      const c = { width: 0, height: 0, style: {}, fill: null };
      c.getContext = () => mkCtx(c);
      return c;
    },
  };

  const { drawTitle } = await import('../render/title.js');
  // BOTH FACES, WARMED EXPLICITLY. drawSettings asks for `fnt_main` (the row's
  // second line, and the face the deleted counter was drawn in) with the same
  // two arguments; loading it here rather than waiting for the first draw to
  // ask means the counter assertion below is not vacuous — a check that can
  // only pass because the font never arrived proves nothing about the pixels.
  const { loadFont } = await import('../render/font.js');
  loadFont();
  loadFont('../assets/fonts', 'fnt_main');
  const main = { width: 640, height: 480, style: {}, main: true };
  const ctx = mkCtx(main);
  const sprites = { get: () => null };
  const ROW = SETTINGS_PAGES.findIndex((p) => p.id === 'unused');
  const ROW_Y = 170 + ROW * 40;                // drawSettings' own row pitch
  const DIM = [128, 128, 138];

  /** One frame's worth of the UNUSED row's glyphs, in pen order. */
  const rowGlyphs = () => {
    recording = true;
    blits.length = 0;
    drawTitle(ctx, t, sprites, ROSTER);
    recording = false;
    return blits.filter((b) => b.dy === ROW_Y);
  };

  const t = createTitle();
  for (let i = 0; i < extraAt('settings'); i++) tap(t, 'down');
  tap(t, 'confirm');
  for (let i = 0; i < ROW; i++) tap(t, 'down');
  armUnused(t, { sprite: 'spr_test_shatter' });

  // The font loads asynchronously; the first draw only starts it.
  drawTitle(ctx, t, sprites, ROSTER);
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  // THE CURSOR MUST BE OFF THE ROW to read the ramp at all — the highlight
  // wins while the heart is beside it, and that is deliberate (every other row
  // turns yellow under the cursor and this one must not be the exception).
  const onRow = rowGlyphs();
  check(onRow.length === 6 && onRow[0].fill === 'rgb(255,255,0)',
    'the row really reaches the canvas — six glyphs, and the cursor still wins');
  tap(t, 'up');

  const cold = rowGlyphs();
  check(cold.length === 6, 'UNUSED is six glyphs wide off the cursor too');
  check(cold[0].fill === `rgb(${DIM.join(',')})`,
    'HEAT 0 IS PAINTED THE OLD DIM GREY — the unarmed row, to the pixel');

  // HEAT 1 without taking the route: a full bar that has not been pressed the
  // twentieth time (the section above pins that this is not `taken`).
  const hot = createTitle();
  for (let i = 0; i < extraAt('settings'); i++) tap(hot, 'down');
  tap(hot, 'confirm');
  armUnused(hot, { presses: UNUSED_PRESSES, sprite: 'spr_test_shatter' });
  const hotGlyphs = (() => {
    recording = true; blits.length = 0;
    drawTitle(ctx, hot, sprites, ROSTER);
    recording = false;
    return blits.filter((b) => b.dy === ROW_Y);
  })();
  const wantHot = `rgb(${mergeColor(DIM, unusedRowStyle(hot).red, 1).join(',')})`;
  check(hotGlyphs.length === 6 && hotGlyphs[0].fill === wantHot,
    `HEAT 1 IS PAINTED ${wantHot} — the mod's own final-hit red`);
  check(hotGlyphs[0].fill !== cold[0].fill,
    'AND THE TWO DIFFER — a flat row that ignored heat would fail here');

  // THE MIDDLE OF THE RAMP IS ON THE RAMP, so "it reddens" is the arithmetic
  // and not two endpoints that happen to be right.
  const mid = createTitle();
  for (let i = 0; i < extraAt('settings'); i++) tap(mid, 'down');
  tap(mid, 'confirm');
  armUnused(mid, { presses: 10, sprite: 'spr_test_shatter' });
  recording = true; blits.length = 0;
  drawTitle(ctx, mid, sprites, ROSTER);
  recording = false;
  const midGlyphs = blits.filter((b) => b.dy === ROW_Y);
  check(midGlyphs[0]?.fill === `rgb(${mergeColor(DIM, unusedRowStyle(mid).red, 0.5).join(',')})`,
    'half the presses paints half the way to the red');

  // ---- AND NO COUNTER IS DRAWN ANYWHERE ---------------------------------
  //
  // The `n / 20` the user removed was drawn in the SMALL font at `y + 6`, so
  // its absence is checkable as pixels too: nothing may land on the row's
  // counter line, at any heat.
  const counterLine = blits.filter((b) => b.dy === ROW_Y + 6);
  check(counterLine.length === 0,
    'NOTHING is drawn on the counter line — the `n / 20` is gone from the screen');

  // ---- THE KICK MOVES THE ROW ------------------------------------------
  //
  // `scr_minishakeobj` -> obj_shakeobj: -3, +2, -1, 0, then the object is
  // gone. The press frame itself reads 0, because event_user(0) only latches
  // and the first write is the shakeobj's own Step (sim/modes.js says why).
  // Asserted as the x the first glyph LANDS ON, against the same row drawn
  // with nothing shaking.
  const kick = createTitle();
  for (let i = 0; i < extraAt('settings'); i++) tap(kick, 'down');
  tap(kick, 'confirm');
  for (let i = 0; i < ROW; i++) tap(kick, 'down');
  armUnused(kick, { sprite: 'spr_test_shatter' });
  const penX = () => {
    recording = true; blits.length = 0;
    drawTitle(ctx, kick, sprites, ROSTER);
    recording = false;
    return blits.filter((b) => b.dy === ROW_Y)[0]?.dx;
  };
  const home = penX();
  check(home === 190, `the row's home x is 190, got ${home}`);
  // ONE press, then one frame at a time — `tap` is two frames and would eat
  // the first two offsets.
  stepTitle(kick, { ...NONE, confirm: true }, ROSTER);
  const seen = [penX() - home];
  for (let i = 0; i < 5; i++) {
    stepTitle(kick, { ...NONE }, ROSTER);
    seen.push(penX() - home);
  }
  check(seen.join() === '0,-3,2,-1,0,0',
    `the kick draws the row at ${UNUSED_SHAKE.amt}/${UNUSED_SHAKE.reduct}'s own`
    + ` offsets 0,-3,2,-1,0,0 — got ${seen.join()}`);
  check(seen.some((o) => o !== 0),
    'AND THE ROW ACTUALLY MOVED — a renderer that dropped style.shake fails here');
  check(kick.unused.shake === null, 'the shakeobj destroys itself at shakeamt <= 0');
  check(seen[seen.length - 1] === 0,
    'and leaves the row exactly where it stood — no residue');

  // ONE KICK PER PRESS. A second press re-arms it, which is what a second
  // scr_minishakeobj call comes to in the original (no instance_number guard,
  // both writes off the same nowx).
  stepTitle(kick, { ...NONE, confirm: true }, ROSTER);
  check(kick.unused.shake?.shakeamt === UNUSED_SHAKE.amt,
    'a second press arms a second kick at full amplitude');
  stepTitle(kick, { ...NONE }, ROSTER);
  stepTitle(kick, { ...NONE, confirm: true }, ROSTER);
  check(kick.unused.shake.shakeamt === UNUSED_SHAKE.amt,
    '...and a press DURING a kick re-arms it rather than stacking a second');

  // THE TRANSLATIONS MUST NOT DRIFT. kaizo/party/scenes.js carries the
  // instance version of this object for k_hpscene's puff; this is the same
  // four frames in a menu's shape, so the numbers are asserted against the
  // GML's own rather than against each other's copy.
  check(UNUSED_SHAKE.amt === 4 && UNUSED_SHAKE.reduct === 1,
    'scr_minishakeobj\'s own shakeamt 4 / shakereduct 1');

  globalThis.fetch = prevFetch;
  globalThis.Image = prevImage;
  globalThis.document = prevDoc;
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
