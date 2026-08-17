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
import { DEFAULT_GEAR, PARTY } from './damage.js';
import { ITEMS, ITEM_IDS, DEFAULT_BAG, INVENTORY_SIZE } from './items.js';

/**
 * THE ITEMS PAGE'S ROSTER — every battle-usable item, plus an EMPTY entry at
 * the front so a slot can be cleared. `0` is the dump's own empty id
 * (`itemname[0] = " "`), which is why it is the value and not a `null`.
 */
export const ITEM_PICKER = [0, ...ITEM_IDS];

export const SETTINGS_PAGES = [
  { id: 'equip', name: 'WEAPONS / ARMOR' },
  { id: 'items', name: 'ITEMS' },
  { id: 'audio', name: 'MUSIC / SFX' },
  { id: 'graphics', name: 'GRAPHICS' },
  { id: 'unused', name: 'UNUSED' },
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
  { id: 'settings', name: 'SETTINGS' },
  { id: 'credits', name: 'CREDITS' },
];

/**
 * THE CREDITS. Three rows, and none of them links anywhere yet — the `link`
 * field is here so that when one gets a URL the page does not have to change
 * shape, only the value.
 */
export const CREDITS = [
  { role: 'Developer', who: 'Radi0', link: null },
  { role: 'Bug fixing and Playtesting', who: 'WandeR', link: 'wander22lstr.carrd.co' },
  { role: 'SUPPORT', who: '', link: null },
];

/**
 * The href for a row, or null. Kept apart from the DISPLAY string above so the
 * page can show a readable `wander22lstr.carrd.co` while the driver opens the
 * real URL — and so `sim/` never holds a value only a browser can use.
 */
export const creditLink = (row) => (row.link ? `https://${row.link}/` : null);

/** BlackShard (26) stays out of the pocket; id 0 is the empty slot. */
export function pocketOf(kind) {
  const table = kind === 'weapon' ? WEAPONS : ARMOR;
  return [0, ...Object.keys(table).map(Number).filter((id) => id !== 26 || kind !== 'weapon')];
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
    /** Set when gear/volumes change; the driver persists and clears it. */
    dirty: false,
  };
}

function openSettings(title) {
  title.settings = {
    page: null, // null = the hub
    cursor: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
    items: { stage: 'slots', slot: 0, pick: 0 },
  };
}

/**
 * CREDITS, opened from the title rather than through the hub. `root` is what
 * X means on the page: without it, cancelling would drop the player into the
 * settings hub they never asked for.
 */
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
  if (s.page === null) {
    if (pressed('up')) { s.cursor = (s.cursor + SETTINGS_PAGES.length - 1) % SETTINGS_PAGES.length; out.moved = true; }
    if (pressed('down')) { s.cursor = (s.cursor + 1) % SETTINGS_PAGES.length; out.moved = true; }
    if (pressed('cancel')) { title.settings = null; out.moved = true; return out; }
    if (pressed('confirm')) {
      const page = SETTINGS_PAGES[s.cursor].id;
      if (page === 'unused') { out.error = true; return out; } // reserved, inert
      s.page = page;
      s.cursor = 0;
      s.equip = { stage: 'char', char: 0, row: 0, pocket: 0 };
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
      if (pressed('cancel')) { s.page = null; out.moved = true; }
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
      if (s.root) title.settings = null; else s.page = null;
      out.moved = true;
    }
    return out;
  }

  // ---- graphics: two toggles ----
  if (s.page === 'graphics') {
    if (pressed('up') || pressed('down')) { s.cursor = 1 - s.cursor; out.moved = true; }
    if (pressed('left') || pressed('right') || pressed('confirm')) {
      if (s.cursor === 0) title.scaling = title.scaling === 'fit' ? 'pixel' : 'fit';
      else title.shake = !title.shake;
      title.dirty = true;
      out.moved = true;
    }
    if (pressed('cancel')) { s.page = null; out.moved = true; }
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
    if (pressed('cancel')) { s.page = null; out.moved = true; }
    return out;
  }

  // ---- equip ----
  const eq = s.equip;
  if (eq.stage === 'char') {
    if (pressed('left')) { eq.char = (eq.char + 2) % 3; out.moved = true; }
    if (pressed('right')) { eq.char = (eq.char + 1) % 3; out.moved = true; }
    if (pressed('cancel')) { s.page = null; out.moved = true; }
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
      const pocket = pocketOf(kind);
      eq.pocket = Math.max(0, pocket.indexOf(cur));
      out.selected = true;
    }
    return out;
  }
  // pocket
  const kind = eq.row === 0 ? 'weapon' : 'armor';
  const pocket = pocketOf(kind);
  if (pressed('up')) { eq.pocket = (eq.pocket + pocket.length - 1) % pocket.length; out.moved = true; }
  if (pressed('down')) { eq.pocket = (eq.pocket + 1) % pocket.length; out.moved = true; }
  if (pressed('cancel')) { eq.stage = 'slot'; out.moved = true; }
  if (pressed('confirm')) {
    const id = pocket[eq.pocket];
    // The char flags ARE the equip rule — refused pieces buzz, like the menu.
    if (id !== 0 && !canEquip(kind, id, eq.char)) { out.error = true; return out; }
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

/** The stat line the equip page previews — base plus slots, like battleat. */
export function previewStats(title, char) {
  return statsOf(PARTY[char], title.gear[char]);
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
    return {
      moved: r.moved, chosen: false, selected: r.selected, error: r.error,
      link: r.link ?? null,
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
      if (extra.id === 'credits') openCredits(title); else openSettings(title);
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
