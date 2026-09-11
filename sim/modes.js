// THE FOUR PRACTICE MODES, and the title screen that picks between them.
//
// This replaces the HTML `<select>` boxes that sat above the canvas. Those
// were the fastest thing to build and they looked like a debug tool bolted to
// a game — a dropdown reading "Stars — phase 1/2/3 opener" is a developer's
// index, not something you hand a playtester.
//
// The menu is drawn ON THE CANVAS with the game's own assets: `fnt_mainbig`
// for the text, `spr_heart` for the cursor, and the same dark-fountain
// background the fight uses. That is not decoration for its own sake — it
// means the menu cannot drift stylistically from the thing it launches,
// because it IS the thing it launches, one frame earlier.
//
// The modes:
//
//   NORMAL    the real fight, the real order, and it ends when it ends
//   HITLESS   one hit and it restarts — the practice loop for learning a
//             pattern, and the reason most people open a tool like this
//   ENDLESS   never stops; the phase order wraps back to the start, so you
//             can stay in the fight as long as you like
//   SINGLE    one attack on repeat, chosen from the roster
//
// HITLESS is the mode this project has been implicitly built for the whole
// time — a deterministic sim with instant restart is exactly the shape a
// hitless practice loop wants — and it was the one thing the UI could not
// express.

export const MODES = [
  {
    id: 'normal',
    name: 'NORMAL',
    blurb: 'The real fight, in order.',
  },
  {
    id: 'hitless',
    name: 'HITLESS',
    blurb: 'One hit and it starts over.',
  },
  {
    id: 'endless',
    name: 'ENDLESS',
    blurb: 'It never stops. The order loops.',
  },
  {
    id: 'single',
    name: 'SINGLE ATTACK',
    blurb: 'One attack, on repeat.',
  },
];

// ---------------------------------------------------------------------------
// SETTINGS — a hub below the modes (player request): the equip menu, an items
// stub, the volume sliders, and UNUSED.
//
// The equip menu drives the sim's real equipment layer (sim/equipment.js /
// state.loadout.gear): every weapon and armour in the chapter's tables is
// offered EXCEPT BlackShard (weapon 26, the Knight's own drop — excluded by
// design), and the char flags from scr_weapon/armorinfo decide who can wear
// what, exactly as the game's menu refuses. Stats preview as base + slots,
// the same sum `battleat/df/mag` are.

import { WEAPONS, ARMOR, canEquip, statsOf } from './equipment.js';
import { WEAPON_REFUSALS, ARMOR_REFUSALS } from './equip-refusals.js';
import { DEFAULT_GEAR, PARTY } from './damage.js';
import { ITEMS, ITEM_IDS, DEFAULT_BAG, INVENTORY_SIZE } from './items.js';

/**
 * THE ITEMS PAGE'S ROSTER — every battle-usable item, plus an EMPTY entry at
 * the front so a slot can be cleared. `0` is the dump's own empty id
 * (`itemname[0] = " "`), which is why it is the value and not a `null`.
 */
export const ITEM_PICKER = [0, ...ITEM_IDS];

export const SETTINGS_PAGES = [
  { id: 'audio', name: 'MUSIC / SFX' },
  { id: 'graphics', name: 'GRAPHICS' },
  // SHARE is not a page — confirming on it copies a link and stays put, which
  // is why it returns `out.share` instead of setting `s.page`.
  { id: 'share', name: 'SHARE SETUP' },
  { id: 'unused', name: 'UNUSED' },
];

// ---------------------------------------------------------------------------
// THE UNUSED ROW'S SECOND LIFE — an OPT-IN state machine, off by default.
//
// WHAT THIS IS AND IS NOT. On the vanilla build `title.unused` is null and the
// row behaves exactly as it always has: dimmed, and confirming it returns
// `out.error` and nothing else. Everything below only runs for a driver that
// ARMS it by assigning `title.unused` a state object (see `armUnused`) — and
// the whole purpose of that gate is that a build which never arms it cannot
// tell this code exists. verify-titlemenu asserts both halves.
//
// WHAT THE ROW BECOMES, once armed: pressing it does not open a page. It
// CRACKS — one stage per press, `UNUSED_CRACK_STAGES` of them — and on the
// stage after the last it BREAKS APART and reads PROCEED. Confirming PROCEED
// returns `out.proceed`, which is the driver's cue to change what the whole
// program is. That is a one-way door: `taken` never goes back to false.
//
// PROVENANCE, because half of this is taken and half is ours and the repo's
// fourth law says which is which must be written down (CLAUDE.md, "nothing
// invented ships unlabelled"):
//
//   TAKEN from EnderCat8's Kaizo Roaring Knight v2.3.3, whose B-Side game-over
//   screen replaces both of DEVICE_CHOICE's options with the same word —
//   `gml_Object_DEVICE_FAILURE_Step_0.gml:384-385`,
//       NAME[0][0] = NAME[1][0] = "PROCEED#(PROCEED)"
//   and then refuses to let either answer leave (`:430-437`: `global.choice ==
//   1` routes to `knight_mode_con 53`, not the 55 that exits). The WORD, its
//   two-line `NAME#(NAME)` shape, and the fact that taking it does not get you
//   out of anything are all from there.
//
//   OURS: the press count, the crack stages, the breaking-apart, and the idea
//   of putting any of it on a settings row. The mod has no cracking button.
//
// The DRIVER owns persistence. This module only counts.
// ---------------------------------------------------------------------------

/**
 * How many presses it takes to break. FIVE, and the number is a feel decision
 * rather than a measurement: fewer and a player who mashes the row twice by
 * accident is on the Weird Route before they have read anything, more and the
 * first two stages look like the row is simply broken. Every stage is visible
 * (render/title.js draws crack `n` of `UNUSED_CRACK_STAGES`), so the count is
 * legible from the screen without being told.
 */
export const UNUSED_CRACK_STAGES = 5;

/**
 * Arm the row. The driver calls this with whatever it has persisted; the
 * shape is deliberately three plain numbers/booleans so a JSON round trip
 * through localStorage is lossless.
 *
 * @param {*} title
 * @param {{presses?: number, broken?: boolean, taken?: boolean}} saved
 */
export function armUnused(title, saved = {}) {
  const presses = Math.max(0, Math.min(UNUSED_CRACK_STAGES, saved.presses | 0));
  const taken = !!saved.taken;
  title.unused = {
    presses: taken ? UNUSED_CRACK_STAGES : presses,
    // BROKEN IS DERIVED, not trusted. A hand-edited storage entry saying
    // `broken: true, presses: 0` would otherwise show a whole button as
    // rubble; deriving it from the count means the drawn state and the
    // stepper's state cannot disagree.
    broken: taken || presses >= UNUSED_CRACK_STAGES,
    taken,
  };
  return title.unused;
}

/**
 * HOW THE ROW SHOULD READ AND BE DRAWN, in one place, so the stepper and the
 * renderer cannot drift. render/title.js calls exactly this.
 *
 * @returns {{name: string, sub: string|null, dim: boolean, crack: number,
 *            broken: boolean, taken: boolean}}
 *   `crack` is 0..UNUSED_CRACK_STAGES — how far through the break it is.
 *   `sub` is the parenthesised second line, which only the broken row has:
 *   the mod writes its choice as `"PROCEED#(PROCEED)"` and `#` is a line
 *   break in `string_hash_to_newline`, so the word appears twice, once in
 *   brackets under itself.
 */
export function unusedRowStyle(title) {
  const u = title?.unused;
  // NOT ARMED — the reserved, inert row, dimmed because grey is this menu's
  // convention for "this does nothing", which there it still does not.
  if (!u) return { name: 'UNUSED', sub: null, dim: true, crack: 0, broken: false, taken: false };
  if (u.broken) return { name: 'PROCEED', sub: '(PROCEED)', dim: false, crack: UNUSED_CRACK_STAGES, broken: true, taken: u.taken };
  return { name: 'UNUSED', sub: null, dim: true, crack: u.presses, broken: false, taken: false };
}

/**
 * THE GEAR / ITEMS HUB — its own two-row menu off the title, in the settings
 * hub's exact shape. WEAPONS / ARMOR and ITEMS lived inside SETTINGS first,
 * and moving the loadout to the title made the settings copies stale
 * leftovers; settings is for how the game LOOKS AND SOUNDS, the hub is for
 * what the party CARRIES.
 */
export const GEAR_PAGES = [
  { id: 'equip', name: 'WEAPONS / ARMOR' },
  { id: 'items', name: 'ITEMS' },
];

/**
 * THE TWO ROWS UNDER THE MODES. Both are top-level: SETTINGS opens the hub
 * above, CREDITS opens its page directly.
 *
 * CREDITS was a settings page first and was moved out — settings is where you
 * go to CHANGE something, and the credits change nothing. Their index is
 * `MODES.length + n`, which is what `stepTitle` branches on.
 */
export const TITLE_EXTRAS = [
  { id: 'gear', name: 'GEAR / ITEMS' },
  { id: 'settings', name: 'SETTINGS' },
  { id: 'credits', name: 'CREDITS' },
];

/**
 * THE CREDITS. `link` holds the DISPLAY string — no scheme — because the page
 * prints it under the name and a `https://` prefix on screen is noise.
 * `creditLink` turns it into the href.
 */
export const CREDITS = [
  { role: 'Developer', who: 'Radi0', link: 'radi0.dev' },
  { role: 'Bug fixing and Playtesting', who: 'WandeR', link: 'wander22lstr.carrd.co' },
  { role: 'SUPPORT', who: '', link: 'ko-fi.com/shadowcrystaldev' },
];

/**
 * The href for a row, or null. Kept apart from the DISPLAY string above so the
 * page can show a readable `ko-fi.com/shadowcrystaldev` while the driver opens
 * the real URL — and so `sim/` never holds a value only a browser can use.
 *
 * NO TRAILING SLASH. It used to append one, which is harmless on a bare host
 * but wrong the moment a link has a PATH: the Ko-fi page is
 * `ko-fi.com/shadowcrystaldev`, and `.../shadowcrystaldev/` is a different URL
 * that only works because Ko-fi happens to redirect it. The href should be
 * the address, not an address plus a character.
 */
export const creditLink = (row) => (row.link ? `https://${row.link}` : null);

/**
 * The pick list for a slot: id 0 (the empty slot), then every piece in the
 * chapter's table with BlackShard (weapon 26, the Knight's own drop) left out.
 *
 * NOTHING IS HIDDEN FOR BEING WORN. This used to drop every id anyone in the
 * party had on, on the claim that the game "cannot express two characters
 * wearing the same piece". It can, and does: `global.armor` is a 48-slot bag
 * of plain ids — scr_armorget appends with only a `noroom` check and no
 * duplicate test, the shops buy through a bare scr_armorget (obj_shop1 /
 * obj_shop_music Draw), and obj_darkcontroller's equip swap (Step_0, the
 * `newequip = global.armor[coord]` … `global.armor[coord] = oldequip` pair)
 * hands the old piece back to storage — so a second LodeStone is a second
 * entry and a second wearer. The sim has no storage model at all, which
 * makes its bag "unlimited copies of everything", and the filter turned that
 * into "one copy of everything": LodeStone could be worn once across the
 * party (1 of the 6 a player asked for landed, measured by driving this
 * menu headlessly), and the ShadowMantle — on Kris in DEFAULT_GEAR — was
 * listed for NOBODY, Kris included, so the piece the fight balances around
 * read as removed. It also broke the cursor start at the slot confirm
 * below: the worn piece was never in the list, so `indexOf` was always -1
 * and every slot opened on "(Nothing)".
 *
 * The tidiness the filter bought ("taking out already equipped items") is
 * kept by the renderer instead: `wornBy` tells it who has a piece on and it
 * draws their initials beside the name, so a second copy reads as a choice
 * rather than clutter. `gear` stays a parameter for the call sites; the list
 * no longer depends on it, and the stepper and renderer cannot drift apart
 * because there is nothing left to drift.
 */
export function pocketOf(kind, gear = null) { // gear: kept for the callers, unused
  const table = kind === 'weapon' ? WEAPONS : ARMOR;
  const ids = Object.keys(table).map(Number).filter((id) => id !== 26 || kind !== 'weapon');
  return [0, ...ids];
}

/**
 * Who has a piece on: the party slots (0 Kris, 1 Susie, 2 Ralsei) wearing
 * `id` anywhere in `kind`. The pocket renderer's wearer tag; the same walk
 * scr_armorcheck_equipped_party does when the game asks whether anyone in
 * the party wears something, which is why it COUNTS wearers rather than
 * finding one.
 */
export function wornBy(kind, id, gear) {
  if (!gear || id === 0) return [];
  return gear.flatMap((g, i) => (
    (kind === 'weapon' ? g.weapon === id : (g.armor ?? []).includes(id)) ? [i] : []
  ));
}

/**
 * THE EQUIP PAGE'S ROSTER — one tab per character the page offers, in the
 * order `title.gear` is indexed.
 *
 * WHY THIS IS NOT JUST `PARTY`. The page walked `% 3` and read `PARTY[c]`
 * everywhere, which hardcodes three characters AND hardcodes which char
 * flag each tab means: `canEquip(kind, id, slot)` tests
 * `WEAPONS[id].allowed.includes(slot)` and `allowed` is indexed by the
 * game's own `char1..4` flags. Those two indexings agree only for the
 * vanilla trio. A roster of two, or a roster containing anybody who is not
 * Kris/Susie/Ralsei, needs them separated — hence `char`, the char1..4 flag
 * index (0 Kris, 1 Susie, 2 Ralsei, 3 Noelle), carried per tab.
 *
 * `title.party` null is the vanilla three and the DEFAULT: every existing
 * caller gets exactly what it had. A driver supplies its own array of
 * `{ name, char, base, head? }` to change the roster; `base` is the stat
 * block `statsOf` previews against and `head` names the portrait sprite
 * (render/title.js falls back to the vanilla heads by `char`).
 */
export const DEFAULT_PARTY_TABS = PARTY.map((p, i) => ({ name: p.name, char: i, base: p }));

export function partyTabs(title) {
  const tabs = title?.party;
  return Array.isArray(tabs) && tabs.length ? tabs : DEFAULT_PARTY_TABS;
}

export function createTitle() {
  return {
    /** null while the menu is up; the chosen mode id once it is not. */
    mode: null,
    index: 0,
    /** Which attack, for SINGLE. An index into the attack roster. */
    attackIndex: 0,
    /** True once the mode is picked and SINGLE needs its second choice. */
    pickingAttack: false,
    /** True while SINGLE's third choice is up — an index into the picked
     *  attack's `difficulties`, SHOWN 1-based (the raw values are 0/3/4
     *  shaped and mean nothing to a player). */
    pickingDifficulty: false,
    difficultyIndex: 0,
    difficultyCount: 1,
    siner: 0,
    held: {},
    /** null, or the open settings state. */
    settings: null,
    /** The loadout the next fight is built with (persisted by the driver). */
    gear: DEFAULT_GEAR.map((g) => ({ weapon: g.weapon, armor: [...g.armor] })),
    /**
     * The twelve item slots the next fight is built with. Same lifecycle as
     * `gear`: the page edits it, `dirty` tells the driver to persist, and the
     * run reads it once at start.
     */
    bag: [...DEFAULT_BAG],
    /**
     * Master volumes 0..100 (persisted by the driver).
     *
     * FIFTY, not a hundred — a player request, and the right default for what
     * this is. The fight opens on a roar and stays loud; a practice tool that
     * blasts on the first frame is one you turn down before you play it, and
     * a first impression at half volume is easier to correct upward than a
     * startle is to undo. Anyone who has already moved the sliders keeps
     * their setting: the driver's saved entry is applied over this.
     */
    volumes: { music: 50, sfx: 50 },
    /**
     * `global.flag[12]`, DELTARUNE's own screen-shake switch, kept in the
     * player's polarity: true here = the shake happens = flag 12 is 0.
     *
     * obj_shake moves the CAMERA, and both of its writes are wrapped in
     * `if (global.flag[12] == 0)` — so with the flag set the object still
     * runs and still destroys itself on schedule, it simply never touches the
     * view. That is the game's answer to "the whole screen shakes and I don't
     * want it to", and it is the only one: nothing in the fight shakes the
     * Knight alone, and the ending explicitly zeroes his own `shakex`.
     */
    shake: true,
    /**
     * HOW THE 640x480 FRAME MEETS THE WINDOW.
     *
     * 'fit'   fill it — the frame is scaled to whatever is there, letterboxed
     *         on the short axis. This is the default and what the game looks
     *         like fullscreen.
     * 'pixel' scale by a WHOLE number of device pixels instead, which leaves
     *         black around the edges when the window is not a clean multiple
     *         of 640x480.
     *
     * The difference is real and unavoidable, not a preference between two
     * equal things: `image-rendering: pixelated` at a fractional factor gives
     * some source columns n device pixels and their neighbours n+1, so a
     * one-pixel font stem is fat on one letter and thin on the next. 'pixel'
     * is the only setting that cannot do that; 'fit' is the only one that
     * fills the screen. Both are offered because both are right sometimes.
     */
    scaling: 'fit',
    /**
     * TOUCH BUTTONS — swap the on-screen Z and X. No GML counterpart: the
     * game has no touch UI, this is the overlay's own layout. False is as
     * shipped (Z above-right, X below-left); true mirrors them. It is a
     * POSITION swap — a CSS class the driver toggles on #touch — never a
     * remap: the labels travel with the buttons, so the letter on a button
     * is always what it does. Persisted with shake and scaling, and like
     * them kept OUT of the share token: it is how a person holds a phone,
     * not a setup.
     */
    swapZX: false,
    /**
     * THE UNUSED ROW'S STATE, or null for "not armed" — which is the default
     * and is what every vanilla build stays on. See `armUnused` above; a
     * driver that never calls it gets the reserved, inert row unchanged.
     */
    unused: null,
    /**
     * THE EQUIP PAGE'S ROSTER, or null for the vanilla three (`partyTabs`).
     * A plain data field on purpose: a driver with a different party hands
     * one over without `sim/` learning anything about that driver.
     */
    party: null,
    /** Set when gear/volumes change; the driver persists and clears it. */
    dirty: false,
  };
}

function openSettings(title) {
  title.settings = {
    page: null, // null = the hub
    cursor: 0,
    shared: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
    items: { stage: 'slots', slot: 0, pick: 0 },
  };
}

/**
 * CREDITS, opened from the title rather than through the hub. `root` is what
 * X means on the page: without it, cancelling would drop the player into the
 * settings hub they never asked for.
 */
/**
 * GEAR, opened from the title directly. The equip page always existed inside
 * SETTINGS, and a playtester assumed the loadout was fixed because Bad Time
 * Simulator's settings never held one — "I kind of assumed you couldn't
 * tweak your armor". A thing the fight balances around should not be a page
 * players have to suspect exists. `root` gives X the same leave-to-title
 * meaning as the credits page.
 */
function openGear(title) {
  title.settings = {
    page: 'gearhub',
    root: true,
    cursor: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
    items: { stage: 'slots', slot: 0, pick: 0 },
  };
}

function openCredits(title) {
  title.settings = {
    page: 'credits',
    root: true,
    cursor: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
    items: { stage: 'slots', slot: 0, pick: 0 },
  };
}

/**
 * One frame of the settings pages. Same edge-detected input as the title.
 * Returns { moved, selected, error } for the driver's sounds.
 */
function stepSettings(title, pressed) {
  const s = title.settings;
  const out = { moved: false, selected: false, error: false };

  // ---- the hub ----
  // ONE WAY OUT OF A PAGE, wherever it was entered from: back to the gear
  // hub when that is where the player came from, off the whole overlay when
  // the page IS the root (credits, the hub itself), and to the settings hub
  // otherwise. Five call sites had five copies of a two-way version of this,
  // and the gear hub would have made every one of them three-way.
  const leavePage = () => {
    if (s.back) { s.page = s.back; s.back = null; }
    else if (s.root) title.settings = null;
    else s.page = null;
  };

  if (s.page === null) {
    // The "copied" confirmation is on a clock rather than latched, so it
    // cannot get stuck on after the player walks away from the row.
    if (s.shared > 0) s.shared -= 1;
    if (pressed('up')) { s.cursor = (s.cursor + SETTINGS_PAGES.length - 1) % SETTINGS_PAGES.length; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % SETTINGS_PAGES.length; out.moved = true; }
    if (pressed('cancel')) { title.settings = null; out.moved = true; return out; }
    if (pressed('confirm')) {
      const page = SETTINGS_PAGES[s.cursor].id;
      // ---- UNUSED: reserved and inert, unless a driver armed it ------------
      //
      // NOT ARMED is the whole vanilla behaviour and the whole vanilla line:
      // one error sound, no page, nothing else returned.
      //
      // ARMED, the row cracks (see the block above SETTINGS_PAGES for what is
      // taken from the mod and what is this project's). Every press before the
      // break still SOUNDS like the refusal it used to be — `out.error` stays
      // true — because the row is still refusing; what changes is that it is
      // visibly coming apart while it does it. `out.crack` carries the stage
      // for a driver that wants a different sound per press; the page may
      // ignore it and lose nothing.
      if (page === 'unused') {
        const u = title.unused;
        if (!u) { out.error = true; return out; }        // reserved, inert
        if (u.broken) {
          // THE POINT OF NO RETURN. `taken` is written here and never
          // cleared — the mod's own screen offers PROCEED as the only answer
          // and then does not let you leave (DEVICE_FAILURE_Step_0:430-437),
          // and a button that can be un-pressed would not be that.
          u.taken = true;
          out.proceed = true;
          out.selected = true;
          title.dirty = true;
          return out;
        }
        u.presses += 1;
        if (u.presses >= UNUSED_CRACK_STAGES) {
          u.presses = UNUSED_CRACK_STAGES;
          u.broken = true;
        }
        out.crack = u.presses;
        out.error = true;
        // The crack must survive a reload, or the player re-cracks it every
        // visit and it reads as a decoration rather than progress.
        title.dirty = true;
        return out;
      }
      // SHARE copies rather than opens. The driver builds the URL and talks to
      // the clipboard — `sim/` has neither, and a headless verifier must be
      // able to run this path without either.
      if (page === 'share') {
        out.share = true;
        out.selected = true;
        // NINETY frames — three seconds. Long enough to read and to be sure
        // the press registered; a shorter flash reads as nothing happening,
        // which on a button whose whole output is invisible (a clipboard) is
        // the difference between working and appearing broken.
        s.shared = 90;
        return out;
      }
      s.page = page;
      s.back = null;
      s.cursor = 0;
      s.equip = { stage: 'char', char: 0, row: 0, pocket: 0 };
      out.selected = true;
    }
    return out;
  }

  if (s.page === 'gearhub') {
    if (pressed('up')) { s.cursor = (s.cursor + GEAR_PAGES.length - 1) % GEAR_PAGES.length; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % GEAR_PAGES.length; out.moved = true; }
    // The hub is the root: X leaves to the title.
    if (pressed('cancel')) { title.settings = null; out.moved = true; return out; }
    if (pressed('confirm')) {
      s.page = GEAR_PAGES[s.cursor].id;
      // Pages entered from here come BACK here — the same page reached
      // through settings used to return to the settings hub, and the exit
      // has to remember which door the player used.
      s.back = 'gearhub';
      s.equip = { stage: 'char', char: 0, row: 0, pocket: 0 };
      s.items = { stage: 'slots', slot: 0, pick: 0 };
      out.selected = true;
    }
    return out;
  }

  // ---- items: TWELVE SLOTS, and any item can go in any of them --------------
  //
  // Navigation is `obj_battlecontroller`'s own, from the battle item menu:
  // a single 0..11 cursor from which page, row and column are derived, UP AND
  // DOWN STEP BY TWO because the list is two columns wide, and LEFT AND RIGHT
  // DO THE SAME THING — with two columns a toggle is its own inverse. Copying
  // that here means the page a player learns in the fight is the page they
  // get in the menu.
  //
  // What is NOT copied is the battle menu's refusal to move onto an empty
  // slot: here every slot is a target, because filling the empty ones is the
  // entire point of the page.
  if (s.page === 'items') {
    const it = s.items;
    if (it.stage === 'slots') {
      if (pressed('up') && it.slot >= 2) { it.slot -= 2; out.moved = true; }
      if (pressed('down') && it.slot <= INVENTORY_SIZE - 3) { it.slot += 2; out.moved = true; }
      // The column toggle, both keys, exactly as the battle menu has it.
      if (pressed('left') || pressed('right')) {
        it.slot += it.slot % 2 === 0 ? 1 : -1;
        out.moved = true;
      }
      if (pressed('cancel')) { leavePage(); out.moved = true; }
      if (pressed('confirm')) {
        it.stage = 'pick';
        // Open the picker ON the slot's current contents, so a nudge is one
        // keypress rather than a walk from the top of a 32-item list.
        it.pick = Math.max(0, ITEM_PICKER.indexOf(title.bag[it.slot] ?? 0));
        out.selected = true;
      }
      return out;
    }
    // the picker
    if (pressed('up')) {
      it.pick = (it.pick + ITEM_PICKER.length - 1) % ITEM_PICKER.length;
      out.moved = true;
    }
    if (pressed('down')) {
      it.pick = (it.pick + 1) % ITEM_PICKER.length;
      out.moved = true;
    }
    if (pressed('cancel')) { it.stage = 'slots'; out.moved = true; }
    if (pressed('confirm')) {
      title.bag[it.slot] = ITEM_PICKER[it.pick];
      title.dirty = true;
      it.stage = 'slots';
      out.selected = true;
    }
    return out;
  }

  // ---- credits: a cursor over three rows, one of which now goes somewhere ---
  //
  // Confirm on a row WITH a link returns it as `out.link` and the driver opens
  // it — `sim/` has no DOM and must not grow one for this. Confirm on a row
  // without is a NO-OP rather than an error sound: nothing is broken, there is
  // just nothing there.
  if (s.page === 'credits') {
    if (pressed('confirm')) {
      const href = creditLink(CREDITS[s.cursor]);
      if (href) { out.link = href; out.selected = true; }
      return out;
    }
    if (pressed('up')) { s.cursor = (s.cursor + CREDITS.length - 1) % CREDITS.length; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % CREDITS.length; out.moved = true; }
    // X goes back to wherever the page was opened FROM — the title now, not
    // the hub, which no longer lists it.
    if (pressed('cancel')) {
      leavePage();
      out.moved = true;
    }
    return out;
  }

  // ---- graphics: three toggles ----
  if (s.page === 'graphics') {
    // Three rows since TOUCH BUTTONS joined SCREEN SIZE and SCREEN SHAKE, so
    // the old `1 - cursor` flip became a wrap. Each key is polled ONCE —
    // `pressed()` latches, so `up || down` would leave a same-frame down
    // unrecorded (the trap verify-titlemenu's header describes).
    const ROWS = 3;
    if (pressed('up')) { s.cursor = (s.cursor + ROWS - 1) % ROWS; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % ROWS; out.moved = true; }
    const flipL = pressed('left');
    const flipR = pressed('right');
    const flipC = pressed('confirm');
    if (flipL || flipR || flipC) {
      if (s.cursor === 0) title.scaling = title.scaling === 'fit' ? 'pixel' : 'fit';
      else if (s.cursor === 1) title.shake = !title.shake;
      else title.swapZX = !title.swapZX;
      title.dirty = true;
      out.moved = true;
    }
    if (pressed('cancel')) { leavePage(); out.moved = true; }
    return out;
  }

  // ---- audio: two sliders, left/right in steps of 5 ----
  if (s.page === 'audio') {
    if (pressed('up') || pressed('down')) { s.cursor = 1 - s.cursor; out.moved = true; }
    const key = s.cursor === 0 ? 'music' : 'sfx';
    if (pressed('left')) {
      title.volumes[key] = Math.max(0, title.volumes[key] - 5);
      title.dirty = true;
      out.moved = true;
    }
    if (pressed('right')) {
      title.volumes[key] = Math.min(100, title.volumes[key] + 5);
      title.dirty = true;
      out.moved = true;
    }
    if (pressed('cancel')) { leavePage(); out.moved = true; }
    return out;
  }

  // ---- equip ----
  const eq = s.equip;
  // THE ROSTER, not the literal three. `partyTabs` is `PARTY` unless a driver
  // supplied its own — and `tab.char` is the char1..4 flag index, which is
  // what `canEquip` and the refusal tables are keyed by. `% tabs.length` makes
  // the left/right wrap the roster's size instead of a hardcoded 3; a stale
  // cursor from a longer roster is clamped rather than left dangling.
  const tabs = partyTabs(title);
  if (eq.char >= tabs.length) eq.char = 0;
  const charFlag = tabs[eq.char].char;
  if (eq.stage === 'char') {
    if (pressed('left')) { eq.char = (eq.char + tabs.length - 1) % tabs.length; out.moved = true; }
    if (pressed('right')) { eq.char = (eq.char + 1) % tabs.length; out.moved = true; }
    // `root`: the page was opened straight from the title (the GEAR row), so
    // X leaves to the title rather than dropping into a settings hub the
    // player never visited — the same rule the credits page carries.
    if (pressed('cancel')) {
      leavePage();
      out.moved = true;
    }
    if (pressed('confirm')) { eq.stage = 'slot'; eq.row = 0; out.selected = true; }
    return out;
  }
  if (eq.stage === 'slot') {
    if (pressed('up')) { eq.row = (eq.row + 2) % 3; out.moved = true; }
    if (pressed('down')) { eq.row = (eq.row + 1) % 3; out.moved = true; }
    if (pressed('cancel')) { eq.stage = 'char'; out.moved = true; }
    if (pressed('confirm')) {
      eq.stage = 'pocket';
      // Start the pocket cursor on the currently-equipped piece.
      const kind = eq.row === 0 ? 'weapon' : 'armor';
      const cur = eq.row === 0 ? title.gear[eq.char].weapon : title.gear[eq.char].armor[eq.row - 1] ?? 0;
      const pocket = pocketOf(kind, title.gear);
      eq.pocket = Math.max(0, pocket.indexOf(cur));
      out.selected = true;
    }
    return out;
  }
  // pocket
  const kind = eq.row === 0 ? 'weapon' : 'armor';
  const pocket = pocketOf(kind, title.gear);
  if (pressed('up')) { eq.pocket = (eq.pocket + pocket.length - 1) % pocket.length; out.moved = true; }
  if (pressed('down')) { eq.pocket = (eq.pocket + 1) % pocket.length; out.moved = true; }
  // Moving the cursor replaces the comment in the game (scr_itemcomment runs
  // per selection); here the next attempt sets a fresh one, so just clear.
  if (out.moved) eq.comment = null;
  if (pressed('cancel')) { eq.stage = 'slot'; eq.comment = null; out.moved = true; }
  if (pressed('confirm')) {
    const id = pocket[eq.pocket];
    // THE CHARACTER COMMENTS ON EVERY ATTEMPT. The dark menu's confirm is
    //
    //     if (canequip == 1) { snd_play(snd_equip); ...swap... }
    //     else               { snd_play(snd_cantselect); }
    //     scr_itemcomment(..., wmsg);          // BOTH paths
    //
    // so the remark is not a refusal message — it shows whether the equip
    // landed or not, and refusal only changes the SOUND. The Mane Ax is why
    // this exists: it is unequippable BY DESIGN (weaponchar all 0 in
    // scr_weaponinfo) and Susie's line for it is "I'm too GOOD for that." —
    // the sim refused silently, and a player read that as the menu being
    // broken. Reported from play, twice removed: the refusal was right, the
    // silence was the bug.
    //
    // Speaker keys are the game's: 2 Susie, 3 Ralsei. Kris has no line —
    // scr_weaponinfo defines no wmessage1 because Kris never speaks.
    {
      // Keyed by the CHAR FLAG (1 Kris, 2 Susie, 3 Ralsei, 4 Noelle), not by
      // the tab position — a two-person roster puts a different character in
      // tab 1, and the line has to follow the character.
      const table = kind === 'weapon' ? WEAPON_REFUSALS : ARMOR_REFUSALS;
      const line = id !== 0 ? table[id]?.[String(charFlag + 1)] : null;
      eq.comment = line && line.trim() ? line : null;
    }
    if (id !== 0 && !canEquip(kind, id, charFlag)) { out.error = true; return out; }
    if (eq.row === 0) title.gear[eq.char].weapon = id;
    else {
      const armor = title.gear[eq.char].armor;
      while (armor.length < 2) armor.push(0);
      armor[eq.row - 1] = id;
    }
    title.dirty = true;
    eq.stage = 'slot';
    out.selected = true;
  }
  return out;
}

/**
 * The stat line the equip page previews — base plus slots, like battleat.
 * `char` is the TAB index; the stat block comes from the roster so a driver's
 * own party previews against its own numbers (Noelle's 120/5/13/1, not
 * Susie's).
 */
export function previewStats(title, char) {
  const tabs = partyTabs(title);
  return statsOf((tabs[char] ?? tabs[0]).base, title.gear[char]);
}

/**
 * One frame of the title screen. Returns true on the frame a mode is chosen.
 *
 * Edge-detected like the battle menu — the same `pressed()` shape, because a
 * held key walking the cursor down a four-item list is unusable.
 *
 * `attacks` is the SINGLE roster (the array itself; a bare count is accepted
 * for old callers, which then never see the difficulty stage).
 */
export function stepTitle(title, input, attacks) {
  const attackCount = Array.isArray(attacks) ? attacks.length : attacks;
  title.siner += 1;
  const pressed = (k) => {
    const down = !!input?.[k];
    const was = !!title.held[k];
    title.held[k] = down;
    return down && !was;
  };

  // The settings pages own the input while open.
  if (title.settings) {
    const r = stepSettings(title, pressed);
    // THE WHITELIST THAT COST A DEBUG CYCLE THE LAST TIME A NEW INTENT WAS
    // ADDED. This rebuilds the settings result field by field, so an intent
    // set correctly inside `stepSettings` is DROPPED here unless it is named
    // — the row reports `selected`, the driver sees nothing to act on, and
    // the button looks dead while every test of `stepSettings` itself passes.
    // `proceed` and `crack` are named for that reason, and
    // verify-titlemenu asserts them through `stepTitle`, never through
    // `stepSettings` directly.
    return {
      moved: r.moved, chosen: false, selected: r.selected, error: r.error,
      link: r.link ?? null, share: r.share ?? false,
      proceed: r.proceed ?? false, crack: r.crack ?? 0,
    };
  }

  // The cursor walks the modes plus the TITLE_EXTRAS rows below them.
  const list = title.pickingDifficulty
    ? title.difficultyCount
    : title.pickingAttack ? attackCount : MODES.length + TITLE_EXTRAS.length;
  const cur = title.pickingDifficulty
    ? 'difficultyIndex'
    : title.pickingAttack ? 'attackIndex' : 'index';
  let moved = false;

  if (pressed('up')) {
    title[cur] = (title[cur] + list - 1) % list;
    moved = true;
  }
  if (pressed('down')) {
    title[cur] = (title[cur] + 1) % list;
    moved = true;
  }

  // ONE CALL, THEN BRANCH — `pressed()` LATCHES.
  //
  // It records the key as held on the way out, so calling it twice in a frame
  // makes the second call return false no matter what the player did. Written
  // as two guarded tests:
  //
  //     if (pressed('cancel') && title.pickingDifficulty) { ... }
  //     if (pressed('cancel') && title.pickingAttack)     { ... }
  //
  // the first one evaluates `pressed` FIRST, latches, and then fails its own
  // `&&` whenever the difficulty stage is not the one showing — and the second
  // test can never see the press. So X backed out of the difficulty list
  // (where the first test matches) and did nothing at all in the attack list.
  // Reported as issue #6: "X does not bring you back to the main menu from
  // single attack", and it works in settings because that path calls
  // `pressed('cancel')` exactly once.
  const cancelled = pressed('cancel');
  if (cancelled && title.pickingDifficulty) {
    title.pickingDifficulty = false;
    return { moved: true, chosen: false };
  }
  if (cancelled && title.pickingAttack) {
    title.pickingAttack = false;
    return { moved: true, chosen: false };
  }

  if (pressed('confirm')) {
    if (!title.pickingAttack && title.index >= MODES.length) {
      const extra = TITLE_EXTRAS[title.index - MODES.length];
      if (extra.id === 'credits') openCredits(title);
      else if (extra.id === 'gear') openGear(title);
      else openSettings(title);
      return { moved: false, chosen: false, selected: true };
    }
    if (!title.pickingAttack && MODES[title.index].id === 'single') {
      // SINGLE needs a second choice, so it opens the roster rather than
      // starting. Everything else starts immediately.
      title.pickingAttack = true;
      return { moved: false, chosen: false, selected: true };
    }
    // The roster confirm: an attack with one difficulty starts; one with
    // several opens the third stage.
    if (title.pickingAttack && !title.pickingDifficulty && Array.isArray(attacks)) {
      const entry = attacks[title.attackIndex];
      const count = entry?.difficulties?.length ?? 1;
      if (count > 1) {
        title.pickingDifficulty = true;
        title.difficultyIndex = 0;
        title.difficultyCount = count;
        return { moved: false, chosen: false, selected: true };
      }
    }
    title.mode = MODES[title.index].id;
    return { moved: false, chosen: true, selected: true };
  }

  return { moved, chosen: false };
}
