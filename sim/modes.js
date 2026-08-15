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

export const SETTINGS_PAGES = [
  { id: 'equip', name: 'WEAPONS / ARMOR' },
  { id: 'items', name: 'ITEMS' },
  { id: 'audio', name: 'MUSIC / SFX' },
  { id: 'unused', name: 'UNUSED' },
];

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
    /** Master volumes 0..100 (persisted by the driver). */
    volumes: { music: 100, sfx: 100 },
    /** Set when gear/volumes change; the driver persists and clears it. */
    dirty: false,
  };
}

function openSettings(title) {
  title.settings = {
    page: null, // null = the hub
    cursor: 0,
    equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
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

  // ---- items: a stub page; any press leaves ----
  if (s.page === 'items') {
    if (pressed('cancel') || pressed('confirm')) { s.page = null; out.moved = true; }
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
    return { moved: r.moved, chosen: false, selected: r.selected, error: r.error };
  }

  // The cursor walks the modes plus the SETTINGS row below them.
  const list = title.pickingDifficulty
    ? title.difficultyCount
    : title.pickingAttack ? attackCount : MODES.length + 1;
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

  if (pressed('cancel') && title.pickingDifficulty) {
    title.pickingDifficulty = false;
    return { moved: true, chosen: false };
  }
  if (pressed('cancel') && title.pickingAttack) {
    title.pickingAttack = false;
    return { moved: true, chosen: false };
  }

  if (pressed('confirm')) {
    if (!title.pickingAttack && title.index === MODES.length) {
      openSettings(title);
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
