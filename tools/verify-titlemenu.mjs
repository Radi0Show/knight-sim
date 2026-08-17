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
} from '../sim/modes.js';

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
  check(creditLink(CREDITS[wander]) === 'https://wander22lstr.carrd.co/',
    `WandeR's link should be the carrd, got ${creditLink(CREDITS[wander])}`);
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
  check(hit.link === 'https://wander22lstr.carrd.co/',
    `confirm on WandeR should return the href, got ${hit.link}`);
  check(t.settings?.page === 'credits', 'and it should stay on the page');

  // A row with no link is a NO-OP: no href, and no error buzz either, because
  // nothing is broken.
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

console.log('title navigation — modes, roster, difficulties, settings\n');
console.log(`→ ${MODES.length} modes + ${TITLE_EXTRAS.map((e) => e.name).join(' + ')},`
  + ` ${SETTINGS_PAGES.length} settings pages`);
console.log('→ X steps back exactly one stage at each level');

if (failures.length) {
  for (const f of failures) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  title menu navigation');
