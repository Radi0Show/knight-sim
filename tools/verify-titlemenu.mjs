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
  armUnused, unusedRowStyle, UNUSED_CRACK_STAGES, partyTabs, previewStats,
} from '../sim/modes.js';
import { canEquip } from '../sim/equipment.js';
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
  check(r.crack === 0, 'UNARMED: nothing cracks');
  check(t.unused === null, 'UNARMED: pressing it creates no state');
  const style = unusedRowStyle(t);
  check(style.name === 'UNUSED' && style.dim === true && style.crack === 0,
    'UNARMED: the row still reads a dim UNUSED');
  // Ten more presses change nothing. The row is a wall.
  for (let i = 0; i < 10; i++) tap(t, 'confirm');
  check(unusedRowStyle(t).name === 'UNUSED', 'UNARMED: it never becomes anything');
}

// ---- ARMED: it cracks, it breaks, and THEN it proceeds -------------------
{
  const t = atUnusedRow();
  armUnused(t, {});
  check(unusedRowStyle(t).crack === 0, 'ARMED: a fresh row is uncracked');
  const stages = [];
  for (let i = 0; i < UNUSED_CRACK_STAGES; i++) {
    const r = tap(t, 'confirm');
    stages.push(r.crack);
    check(r.error === true, `press ${i + 1} still refuses (it is cracking, not opening)`);
    check(r.proceed === false, `press ${i + 1} does not proceed`);
    check(t.settings.page === null, `press ${i + 1} opens no page`);
    check(t.dirty === true, `press ${i + 1} asks the driver to persist`);
    t.dirty = false;
  }
  check(stages.join() === [1, 2, 3, 4, 5].slice(0, UNUSED_CRACK_STAGES).join(),
    `every press reported its own stage, got [${stages.join()}]`);
  // BROKEN. The word changes, the dimming stops, and the mod's bracketed
  // second line appears.
  const broke = unusedRowStyle(t);
  check(broke.broken === true, `${UNUSED_CRACK_STAGES} presses break it`);
  check(broke.name === 'PROCEED', 'and the broken row reads PROCEED');
  check(broke.sub === '(PROCEED)', '...with the mod\'s own bracketed echo under it');
  check(broke.dim === false, '...and it is no longer dimmed');
  check(broke.taken === false, 'breaking it is not taking it');

  // THE NEXT PRESS IS THE DOOR, and it comes out through stepTitle's
  // whitelist — which is the exact place the last new intent was dropped.
  const r = tap(t, 'confirm');
  check(r.proceed === true, 'PROCEED reaches the DRIVER through stepTitle');
  check(r.selected === true, '...as a selection, not an error');
  check(r.error === false, '...and it does not sound the refusal any more');
  check(t.unused.taken === true, '...and the state records it was taken');
  check(t.dirty === true, '...and asks the driver to persist that');

  // ONE WAY. Pressing it again cannot un-take it.
  tap(t, 'confirm');
  check(t.unused.taken === true, 'taken never goes back to false');
}

// ---- THE CRACK SURVIVES A RELOAD ----------------------------------------
{
  // Two presses, persisted, re-armed: the row comes back cracked twice, not
  // fresh. Without this the stages are decoration.
  const t = atUnusedRow();
  armUnused(t, {});
  tap(t, 'confirm');
  tap(t, 'confirm');
  const saved = { ...t.unused };
  const t2 = atUnusedRow();
  armUnused(t2, saved);
  check(unusedRowStyle(t2).crack === 2, 'a reload resumes at the crack it left on');
  // A taken row comes back broken whatever the saved count says.
  const t3 = createTitle();
  armUnused(t3, { taken: true, presses: 0 });
  check(unusedRowStyle(t3).broken === true && unusedRowStyle(t3).name === 'PROCEED',
    'a taken row comes back already PROCEED');
  // A hostile entry cannot produce a half-broken row.
  const t4 = createTitle();
  armUnused(t4, { presses: 9999, broken: false });
  check(t4.unused.presses === UNUSED_CRACK_STAGES && t4.unused.broken === true,
    'an out-of-range saved count is clamped, and broken is DERIVED from it');
  const t5 = createTitle();
  armUnused(t5, { presses: -5, broken: true });
  check(t5.unused.presses === 0 && t5.unused.broken === false,
    '...in both directions: a saved `broken` alone cannot break it');
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
