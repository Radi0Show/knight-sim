// THE BATTLE MENU — the charbox row, driven the way the real fight drives it.
//
// Everything here is read out of `scr_charbox` and obj_battlecontroller rather
// than designed. The layout constants live in render/menu.js with the drawing;
// this file is the state the drawing reads and the flow the player feels.
//
// SCOPE, stated plainly because the project rule is that nothing invented
// ships unlabelled. This is dodge-only: the buttons are REAL — five of them,
// in the real order, with the real per-character set — but choosing one does
// not resolve an action. Confirming passes the turn to the next party member,
// and when all three have confirmed the enemy's attack begins. That is the
// authentic SHAPE of a turn (menu for each of three, then bullets) without the
// FIGHT/ACT/ITEM machinery the tool does not model. The HUD says so.
//
// The party is hardcoded to this fight: Kris, Susie, Ralsei, in that order,
// which is `charpos` 0/1/2 with `chartotal == 3`.

import { ACTION_DEFEND, TP_DEFEND, isUp, PARTY } from './damage.js';
import { scrTensionheal } from './tension.js';
import { cue } from './audio.js';
import { useItem, ITEMS } from './items.js';
import {
  SPELLS, SPELL_LIST, ACTS, canAfford, spellCost, castSpell, holdBreath,
} from './spells.js';
import {
  FACE_IDLE, FACE_ATTACK, FACE_SPELL, FACE_ITEM, FACE_DEFEND, FACE_ACT,
  HERO_SPELL, HERO_ITEM, HERO_ACT, heroAct,
} from './heroes.js';

/**
 * `global.charaction[c] = 2` — CHOSE A SPELL. The cast itself happens later,
 * during obj_attackpress's delay window, so the animation plays after the
 * whole party has committed rather than over the next character's menu.
 *
 * TP is still spent NOW: `scr_spellconsumeb` deducts on selection, which is
 * what stops two characters spending the same 125.
 */
function recordSpell(state, c, id, target) {
  const cost = spellCost(state, c, id);
  if (state.tension < cost) return null;
  state.tension -= cost;
  state.charaction[c] = 2;
  state.pendingSpell = state.pendingSpell ?? [];
  state.pendingSpell[c] = { id, target };
  return `${SPELLS[id].name}!`;
}

/** `global.faceaction[c] = n` — the standing pose, read by hero state 0. */
function setFace(state, c, face) {
  const h = state.heroes?.[c];
  if (h) h.faceaction = face;
}

/**
 * `global.hpcolor[]` from obj_battlecontroller's Create. GameMaker packs
 * colours BGR, so c_aqua is RGB(0,255,255) and c_fuchsia RGB(255,0,255) —
 * these are the per-character HP-bar and panel-highlight colours.
 */
export const CHAR_COLOR = [
  [0, 255, 255], // Kris   — c_aqua
  [255, 0, 255], // Susie  — c_fuchsia
  [0, 255, 0], // Ralsei — c_lime
];

/**
 * The five buttons, in `scr_charbox`'s draw order and at its x offsets.
 *
 * The second slot is the one that differs per character: `c == 0` (Kris) draws
 * `spr_btact`, everyone else draws `spr_bttech`. That is a real difference in
 * this chapter and not a detail worth smoothing over.
 */
export const BUTTONS = [
  { x: 15, sprite: () => 'spr_btfight', name: 'FIGHT' },
  // BUTTON 1 IS ONE SLOT WITH TWO CONTENTS, which is the whole reason it
  // needs a function. `obj_battlecontroller`'s Step routes it by character:
  //
  //     coord == 1 && global.char[charturn] != 1  ->  bmenuno 2   (spells)
  //     coord == 1                                ->  bmenuno 11  (Kris: ACT)
  //
  // and Kris's own spell list is `global.spell[1][0] = 7`, whose name is
  // literally "ACT". So it is ACT for Kris and MAGIC for the other two.
  { x: 50, sprite: (c) => (c === 0 ? 'spr_btact' : 'spr_bttech'), name: (c) => (c === 0 ? 'ACT' : 'MAGIC') },
  { x: 85, sprite: () => 'spr_btitem', name: 'ITEM' },
  { x: 120, sprite: () => 'spr_btspare', name: 'SPARE' },
  { x: 155, sprite: () => 'spr_btdefend', name: 'DEFEND' },
];

/**
 * The portraits and name plates. The STATS live in sim/damage.js, read out of
 * `scr_gamestart`'s chapter 3 block — the maxhp values that used to sit here
 * (90/130/90) were invented and are in the game nowhere.
 */
export const PARTY_SPRITES = [
  { head: 'spr_headkris', name: 'spr_bnamekris' },
  { head: 'spr_headsusie', name: 'spr_bnamesusie' },
  { head: 'spr_headralsei', name: 'spr_bnameralsei' },
];

export function createMenu() {
  return {
    open: false,
    /** `global.charturn` — whose panel is raised. */
    charturn: 0,
    /** Which of the five buttons is lit, per character. */
    selected: [0, 0, 0],
    /** `mmy[c]` — the panel's slide offset. 0 down, -32 fully raised. */
    mmy: [0, 0, 0],
    /** `s_siner`, the selection matrix's sweep. */
    siner: 0,
    /** Edge-detection for the menu's own keys; the soul uses held input. */
    held: {},
    /**
     * `onebuffer` / `twobuffer` — obj_battlecontroller's input cooldowns, and
     * the reason the menu cannot be blitzed through.
     *
     *     // set on a confirm
     *     if (button1_p() == 1 && twobuffer < 0 && can_input == true) {
     *         onebuffer = 1; ...
     *     // set on a cancel
     *     if (button2_p() == 1 && onebuffer < 0 && global.charturn > 0 ...) {
     *         twobuffer = 1; ...
     *     // once per Step, at the very bottom
     *     onebuffer -= 1;
     *     twobuffer -= 1;
     *
     * Every input test is `< 0`, and the value is set to 1 and decremented
     * once a frame — so a confirm LOCKS OUT further menu input for two
     * frames (1, then 0, both >= 0), and a cancel does the same in the other
     * direction. They cross-gate: confirm checks `twobuffer`, cancel checks
     * `onebuffer`, so you cannot cancel out of a selection you just made.
     *
     * The sim had neither, so it walked the whole three-character menu in a
     * handful of frames while the game took ~90. The whole-fight diff showed
     * it as the sim resolving its attack bar at frame 26 while the oracle's
     * turn had not started — everything after that was measured from two
     * different clocks.
     */
    onebuffer: 0,
    twobuffer: 0,
    /** Set for one frame when the last character confirms. */
    justClosed: false,
    /** Set with justClosed; the director runs scr_endturn on it. */
    needsCommit: false,
    /**
     * WHICH LIST IS OPEN. `global.bmenuno` in the original: 0 is the button
     * row, and picking ITEM opens the bag as a submenu over the same panel.
     * Cancel backs out of it to the row rather than to the previous character.
     */
    submenu: null,
    itemIndex: 0,
    /**
     * `tempitem[slot][charturn]` — A PER-CHARACTER SNAPSHOT OF THE BAG, and
     * the mechanism behind both "items disappear" and "cancel gives them back".
     *
     *     Create        tempitem[i][j] = global.item[i]        all three
     *     choose one    scr_itemshift_temp() removes it from THIS character's
     *                   list, then scr_nexthero copies that list forward
     *     cancel back   scr_prevhero restores from charturn - 1, or from
     *                   global.item at charturn 0 — UNDOING the consumption
     *     end of turn   scr_endturn writes the last list back to global.item
     *
     * So the item is gone the moment you pick it, comes back if you back out,
     * and only really leaves the inventory when the turn resolves. Consuming
     * straight out of `global.item` looks identical until you press cancel.
     */
    tempitem: [[], [], []],
    /** `global.temptension[]` — the same snapshot, for TP. */
    temptension: [0, 0, 0],
    /** Cursor into whichever list is open. `global.bmenucoord[bmenuno]`. */
    gridIndex: 0,
    /** A chosen thing waiting for a target: { kind, payload }. */
    pending: null,
    /** `global.chartarget[charturn]` while the picker is up. */
    targetIndex: 0,
    /** Last thing an item did, for the HUD to echo. */
    lastItem: null,
    /** Who chose FIGHT this turn — the attack bar reads this. */
    fight: [false, false, false],
  };
}

/**
 * `mmy[c]` — straight from scr_charbox, and the cascade matters.
 *
 * RAISING is four independent tests in sequence, so a panel at 0 takes all
 * four (-2 -4 -6 -8 = -20) on its first frame and then decelerates: 0, -20,
 * -26, -28, -30, -32. It arrives fast and eases in, which is why the panel
 * feels like it snaps up rather than travelling.
 *
 * LOWERING is one test: +15 while below -14, then straight to 0 — three
 * frames, no easing. Up is smooth, down is abrupt; that asymmetry is the
 * original's.
 */
function slide(menu, c, raised) {
  if (raised) {
    if (menu.mmy[c] > -32) menu.mmy[c] -= 2;
    if (menu.mmy[c] > -24) menu.mmy[c] -= 4;
    if (menu.mmy[c] > -16) menu.mmy[c] -= 6;
    if (menu.mmy[c] > -8) menu.mmy[c] -= 8;
    // ORIGINAL BUG: `if (mmy[c] < -32) mmy[c] = -64;` IS UNREACHABLE.
    //
    // The four tests above are sequential on the same variable, so from 0 the
    // value walks 0 -> -12 -> -18 -> -24 -> -26 -> -28 -> -30 -> -32 and
    // sticks there: `-32 > -32` is false so nothing decrements it further,
    // and `-32 < -32` is false so this line never fires. The box raises 32
    // pixels, never 64.
    //
    // Kept verbatim rather than removed, per the project's rule on original
    // bugs: a later cleanup that "fixes" the arithmetic would double the
    // raise and move the whole charbox row. Same family as `splitbox`,
    // `linex` and `destroy_on_hit` in CLAUDE.md's dead-variable table.
    if (menu.mmy[c] < -32) menu.mmy[c] = -64;
  } else if (menu.mmy[c] < -14) {
    menu.mmy[c] += 15;
  } else {
    menu.mmy[c] = 0;
  }
}

/** The bag the CURRENT character sees — their snapshot, not `global.item`. */
export function bagOf(state) {
  return state.menu.tempitem[state.menu.charturn] ?? state.inventory;
}

/**
 * `scr_nexthero()` — advance, carrying this character's bag and TP forward.
 *
 *     tempitem[i][charturn] = tempitem[i][prevturn];
 *
 * The next character inherits what the previous one left, which is what makes
 * a two-item turn spend two different items rather than the same one twice.
 */
function nextHero(menu, state) {
  const prev = menu.charturn;
  menu.charturn += 1;
  if (menu.charturn > 2) return;
  menu.tempitem[menu.charturn] = [...menu.tempitem[prev]];
  menu.temptension[menu.charturn] = state.tension;
}

/**
 * `scr_prevhero()` — step back, and UNDO everything that character did.
 *
 *     if (charturn == 0) { tension = temptension[0];
 *                          tempitem[i][0] = global.item[i]; }
 *     else               { tension = temptension[charturn];
 *                          tempitem[i][charturn] = tempitem[i][charturn - 1]; }
 *
 * Both halves matter and both were missing: cancel used to just decrement
 * `charturn`, so an item spent by character 2 stayed spent after backing out
 * of their turn, and DEFEND's 40 TP could be banked once per cancel.
 *
 * It also clears the action fields — `charaction`, `chartarget`, `faceaction`,
 * `charspecial` — so the character really is undecided again.
 */
function prevHero(menu, state) {
  if (menu.charturn <= 0) return false;
  menu.charturn -= 1;
  const c = menu.charturn;
  state.tension = menu.temptension[c] ?? state.tension;
  menu.tempitem[c] = c === 0 ? [...state.inventory] : [...menu.tempitem[c - 1]];
  state.charaction[c] = 0;
  // `global.faceaction[charturn] = 0` — scr_prevhero drops the pose too, so a
  // cancelled DEFEND stops looking defended.
  setFace(state, c, FACE_IDLE);
  menu.fight[c] = false;
  menu.submenu = null;
  menu.pending = null;
  return true;
}

/**
 * `scr_endturn()` — commit. The last character's bag becomes the real one and
 * all three snapshots resync to it.
 */
export function endTurnItems(state) {
  const menu = state.menu;
  const last = Math.min(menu.charturn, 2);
  state.inventory = [...(menu.tempitem[last] ?? state.inventory)];
  for (let i = 0; i < 3; i++) menu.tempitem[i] = [...state.inventory];
  for (let i = 0; i < 3; i++) menu.temptension[i] = state.tension;
}

/**
 * The rows of whichever list is open. All three — bag, MAGIC, ACT — are the
 * same 2x6 grid drawn by the same code at the same coordinates; only the
 * contents differ. `global.bmenuno` picks which.
 */
export function listRows(state) {
  const menu = state.menu;
  const c = menu.charturn;
  if (menu.submenu === 'item') {
    return bagOf(state).map((id) => {
      const it = ITEMS[id];
      return { label: it?.name ?? '', descb: it?.desc ?? '', id, usable: true };
    });
  }
  if (menu.submenu === 'magic') {
    return (SPELL_LIST[c] ?? []).map((id) => ({
      label: SPELLS[id].name,
      descb: SPELLS[id].descb,
      id,
      // A spell you cannot pay for is SHOWN AND GREYED, not hidden — the list
      // is what the character knows, not what they can afford this second.
      usable: canAfford(state, id, c),
    }));
  }
  if (menu.submenu === 'act') {
    return (ACTS[c] ?? []).map((a, i) => ({
      label: a.name, descb: a.descb, id: i, usable: true,
    }));
  }
  return [];
}

/**
 * One frame of the menu. Returns true on the frame the last character
 * confirms, which is the director's cue to start the enemy's turn.
 *
 * Left/right move along the button row and WRAP, as the original's does.
 * Confirm advances to the next character; cancel steps back to the previous
 * one, and cancelling on the first character does nothing (there is nowhere to
 * go — the fight does not let you leave).
 */
export function stepMenu(state, input) {
  const menu = state.menu;
  menu.justClosed = false;
  menu.siner += 2;

  // `onebuffer -= 1; twobuffer -= 1;` — the LAST two lines of
  // obj_battlecontroller's Step, so the decrement happens after every input
  // test that frame. Doing it first here is equivalent only because the tests
  // below read the already-decremented value, which is what the original's
  // NEXT frame sees. Setting to 1 and testing `< 0` gives a two-frame lockout
  // either way.
  const wasOne = menu.onebuffer;
  const wasTwo = menu.twobuffer;
  menu.onebuffer = (menu.onebuffer ?? 0) - 1;
  menu.twobuffer = (menu.twobuffer ?? 0) - 1;
  void wasOne; void wasTwo;

  for (let c = 0; c < 3; c++) slide(menu, c, menu.open && menu.charturn === c);

  if (!menu.open) return false;

  // Edge-triggered: the menu must not skip five buttons because a key was held
  // for five frames. The soul's own movement is level-triggered and unaffected.
  const rawPressed = (k) => {
    const down = !!input[k];
    const was = !!menu.held[k];
    menu.held[k] = down;
    return down && !was;
  };

  // THE BUFFERS GATE CONFIRM AND CANCEL, AND THEY CROSS-GATE.
  //
  //     if (button1_p() == 1 && twobuffer < 0 && can_input == true) onebuffer = 1;
  //     if (button2_p() == 1 && onebuffer < 0 && ...)               twobuffer = 1;
  //
  // Confirm checks `twobuffer` and cancel checks `onebuffer`, so you cannot
  // immediately cancel a selection you just made, or re-confirm out of a
  // cancel. Both are set to 1 and decremented once per Step, so each locks
  // input out for two frames.
  //
  // The EDGE is still consumed while buffered — `menu.held` updates either
  // way — so a key held across the cooldown does not fire the moment it
  // lifts. That matches `button1_p()` being evaluated before the buffer test
  // in the original: the press is seen, then discarded.
  const pressed = (k) => {
    const edge = rawPressed(k);
    if (!edge) return false;
    if (k === 'confirm') {
      if (menu.twobuffer >= 0) return false;
      // `onebuffer = 1` — latched HERE rather than in each accepting branch.
      // The original sets it in all six of them; one gate cannot miss one.
      menu.onebuffer = 1;
      return true;
    }
    if (k === 'cancel') {
      if (menu.onebuffer >= 0) return false;
      menu.twobuffer = 1;
      return true;
    }
    return true;
  };

  // `movenoise` / `selnoise` — the same flag-then-play pattern as the graze:
  // obj_battlecontroller's Step turns each into ONE sound and clears it, so a
  // frame that moves and confirms together still makes one of each, not two.
  let moveNoise = false;
  let selNoise = false;

  const c = menu.charturn;

  // ---- THE TARGET PICKER --------------------------------------------------
  //
  // `spelltarget` decides whether this appears at all: 0 casts immediately,
  // 1 picks an ALLY, 2 picks an enemy. With one enemy the enemy picker has
  // nothing to choose, so only the ally case is a real prompt.
  //
  // IT MUST OFFER THE FALLEN. A DeluxeDinner on a SWOONed ally is the whole
  // point of carrying single-target heals — `scr_heal` adds to the negative
  // number — and a picker that skipped downed members would make ReviveMint
  // unusable. Left/right walk all three regardless of state.
  if (menu.submenu === 'target') {
    if (pressed('left')) {
      menu.targetIndex = (menu.targetIndex + 2) % 3;
      moveNoise = true;
    }
    if (pressed('right')) {
      menu.targetIndex = (menu.targetIndex + 1) % 3;
      moveNoise = true;
    }
    if (pressed('cancel')) {
      // Back to the list the choice came from, NOT to the button row — one
      // step per press.
      menu.submenu = menu.pending?.from ?? 'item';
      menu.pending = null;
      moveNoise = true;
    } else if (pressed('confirm')) {
      const p = menu.pending;
      const t = menu.targetIndex;
      let did = null;
      if (p?.kind === 'item') {
        did = useItem(state, p.slot, t, bagOf(state));
      } else if (p?.kind === 'spell') {
        did = recordSpell(state, c, p.id, t);
      }
      if (did) {
        menu.lastItem = did;
        // `state = 4` for an item, `state = 2` for a spell — obj_attackpress's
        // Draw sets these on a DELAY (`spelldelay`, 10 frames) rather than
        // instantly, which is why the animation reads as a response to the
        // turn starting rather than to the button press.
        heroAct(state, c, p.kind === 'spell' ? HERO_SPELL : HERO_ITEM);
        menu.pending = null;
        menu.submenu = null;
        state.charaction[c] = 0;
        cue(state, 'snd_select');
        nextHero(menu, state);
        if (!skipFallen(state)) {
          menu.charturn = 0;
          menu.open = false;
          menu.justClosed = true;
          menu.needsCommit = true;
          return true;
        }
      } else {
        cue(state, 'snd_error');
      }
    }
    if (moveNoise) cue(state, 'snd_menumove');
    return false;
  }

  // ---- THE ENEMY ROW (`bmenuno == 1`) --------------------------------------
  //
  // One line per living enemy: name, comment, and an HP bar. For the Knight
  // the NUMBER is replaced with "???" while the BAR still tracks the real
  // fraction — you can watch it move, you just are not told by how much.
  if (menu.submenu === 'enemy') {
    if (pressed('cancel')) {
      menu.submenu = null;
      setFace(state, c, FACE_IDLE);
      moveNoise = true;
    } else if (pressed('confirm')) {
      menu.submenu = null;
      menu.fight[c] = true;
      // `global.faceaction[myself] = 1` was set when FIGHT opened this row —
      // the character raises their weapon and HOLDS it through everyone
      // else's turn. faceaction does nothing until hero state 0 reads it, so
      // it is a pose, not an animation.
      cue(state, 'snd_select');
      nextHero(menu, state);
      if (!skipFallen(state)) {
        menu.charturn = 0;
        menu.open = false;
        menu.justClosed = true;
        menu.needsCommit = true;
        return true;
      }
    }
    if (moveNoise) cue(state, 'snd_menumove');
    return false;
  }

  // ---- THE LISTS: bag, MAGIC, ACT -----------------------------------------
  //
  // One handler for all three. They are the same 2x6 grid at the same
  // coordinates and the same `global.bmenucoord` cursor; only the contents
  // differ, which is why the original draws them with near-identical blocks.
  if (menu.submenu === 'item' || menu.submenu === 'magic' || menu.submenu === 'act') {
    const rows = listRows(state);
    const n = rows.length;
    if (n === 0) {
      menu.submenu = null;
    } else {
      // Two columns by SIX rows, shown three rows at a time across two PAGES.
      // The cursor is a single 0..11 index; page, row and column are all
      // derived from it. NAVIGATION IS CLAMPED, NOT WRAPPED — `down` refuses
      // at `coord >= 10`, `up` at `coord <= 1`, and both refuse an empty slot.
      const filled = (i) => i >= 0 && i < n;
      const coord = menu.gridIndex;

      // left_p() and right_p() DO THE SAME THING — with two columns a toggle
      // is its own inverse, and the original writes the branch out twice.
      if (pressed('left') || pressed('right')) {
        const other = coord % 2 === 0 ? coord + 1 : coord - 1;
        if (filled(other)) {
          menu.gridIndex = other;
          moveNoise = true;
        }
      }
      if (pressed('down')) {
        if (coord < 10 && filled(coord + 2)) {
          menu.gridIndex = coord + 2;
          moveNoise = true;
        } else if (coord === 5 && filled(6) && !filled(7)) {
          menu.gridIndex = 6;
          moveNoise = true;
        }
      }
      if (pressed('up') && coord > 1) {
        menu.gridIndex = coord - 2;
        moveNoise = true;
      }
      while (menu.gridIndex > 0 && !filled(menu.gridIndex)) menu.gridIndex -= 1;
      menu.itemIndex = menu.gridIndex; // the renderer's name for it

      if (pressed('cancel')) {
        // A submenu cancel goes to the BUTTON ROW, not the previous character:
        // `global.bmenuno = 0`. Only a cancel already on the row calls
        // scr_prevhero. One step per press, which is what makes the menu
        // feel like a stack rather than a jump.
        menu.submenu = null;
        menu.gridIndex = 0;
        moveNoise = true;
      } else if (pressed('confirm')) {
        const row = rows[menu.gridIndex];
        if (!row || !row.usable) {
          cue(state, 'snd_error');
        } else if (menu.submenu === 'act') {
          const line = row.id === 1 && c === 0
            ? holdBreath(state)
            : `* ${PARTY[c].name} used ${row.label}.`;
          menu.lastItem = line;
          menu.submenu = null;
          // `state = 6` — the ACT swing plays NOW, and it outlasts the menu:
          // the character is still mid-animation when the next one is choosing.
          heroAct(state, c, HERO_ACT);
          selNoise = true;
          nextHero(menu, state);
          if (!skipFallen(state)) {
            menu.charturn = 0;
            menu.open = false;
            menu.justClosed = true;
            menu.needsCommit = true;
            return true;
          }
        } else {
          // ITEM and MAGIC both route through the target rule. `spelltarget`
          // 1 opens the ally picker; anything else resolves immediately.
          const needsTarget = menu.submenu === 'magic'
            ? SPELLS[row.id]?.target === 1
            : ITEMS[row.id]?.target === 'one';
          if (needsTarget) {
            menu.pending = menu.submenu === 'magic'
              ? { kind: 'spell', id: row.id, from: 'magic' }
              : { kind: 'item', slot: menu.gridIndex, from: 'item' };
            // Default to the acting character, as the original does — most
            // heals are self-heals and it saves a press.
            menu.targetIndex = c;
            menu.submenu = 'target';
            selNoise = true;
          } else {
            // A SPELL IS RECORDED, NOT CAST. `obj_attackpress`'s Create
            // collects everyone whose `charaction` is 2 (spell) or 4 (item)
            // and its Draw fires their animation on a DELAY, before the bolts
            // run. Casting on the button press ran Rude Buster's whole
            // animation while the NEXT character was still choosing.
            const did = menu.submenu === 'magic'
              ? recordSpell(state, c, row.id, c)
              : useItem(state, menu.gridIndex, c, bagOf(state));
            if (!did) {
              cue(state, 'snd_error');
            } else {
              menu.lastItem = did;
              // Capture WHICH list this came from before clearing it — reading
              // `menu.submenu` after the null always says "item".
              const wasMagic = menu.submenu === 'magic';
              menu.submenu = null;
              heroAct(state, c, wasMagic ? HERO_SPELL : HERO_ITEM);
              selNoise = true;
              nextHero(menu, state);
              if (!skipFallen(state)) {
                menu.charturn = 0;
                menu.open = false;
                menu.justClosed = true;
                return true;
              }
            }
          }
        }
      }
    }
    if (moveNoise) cue(state, 'snd_menumove');
    if (selNoise) cue(state, 'snd_select');
    return false;
  }

  if (pressed('left')) {
    menu.selected[c] = (menu.selected[c] + BUTTONS.length - 1) % BUTTONS.length;
    moveNoise = true;
  }
  if (pressed('right')) {
    menu.selected[c] = (menu.selected[c] + 1) % BUTTONS.length;
    moveNoise = true;
  }

  // CANCEL ON THE BUTTON ROW steps back a character — `scr_prevhero()` — and
  // that call does far more than decrement: it restores the previous
  // character's bag AND their TP, and clears their action. Cancel used to be
  // a bare `charturn -= 1`, so an item spent by character 2 stayed spent and
  // DEFEND's 40 TP could be re-banked once per cancel.
  //
  // `global.charturn > 0` — there is nowhere to go from the first character.
  // The fight does not let you leave the menu.
  if (pressed('cancel')) {
    if (prevHero(menu, state)) moveNoise = true;
    else cue(state, 'snd_error');
  }

  if (pressed('confirm')) {
    // DEFEND is `global.charaction[target] == 10`, and the damage chain reads
    // it: a defending character takes ceil(2 * damage / 3). It is the one
    // button whose choice the dodge-only scope can honour completely.
    // `name` IS A FUNCTION for button 1 — it depends on the character. Reading
    // it as a plain string made `chosen === 'ACT'` compare against a Function
    // object, so it was never true and the button did nothing at all: no
    // menu, no error sound, no turn advance. ACT and MAGIC were unreachable
    // for exactly this reason.
    const nameOf = BUTTONS[menu.selected[c]].name;
    const chosen = typeof nameOf === 'function' ? nameOf(c) : nameOf;
    if (chosen === 'FIGHT') {
      // `bmenucoord[0] == 0 -> global.bmenuno = 1` — FIGHT opens the ENEMY
      // ROW first, and that row is where the Knight's HP bar and its "???"
      // live. This build jumped straight to the attack bar, so the one place
      // the fight shows you the Knight's condition never appeared.
      //
      // With a single enemy the row is one entry and confirming it is a
      // formality, which is exactly how it plays in the real fight.
      menu.submenu = 'enemy';
      menu.gridIndex = 0;
      setFace(state, c, FACE_ATTACK);
      cue(state, 'snd_select');
      return false;
    }
    // MAGIC and ACT open the same 2x6 grid the bag uses. For KRIS the MAGIC
    // slot holds `spell[1][0] = 7`, whose name is literally "ACT" — his row
    // reads ACT where the others read MAGIC because it is one menu slot with
    // different contents, not a different button.
    if (chosen === 'MAGIC' || chosen === 'ACT') {
      const which = chosen === 'ACT' || (chosen === 'MAGIC' && c === 0) ? 'act' : 'magic';
      if (listRows({ ...state, menu: { ...menu, submenu: which } }).length === 0) {
        cue(state, 'snd_error');
        return false;
      }
      menu.submenu = which;
      menu.gridIndex = 0;
      menu.itemIndex = 0;
      setFace(state, c, which === 'act' ? FACE_ACT : FACE_SPELL);
      cue(state, 'snd_select');
      return false;
    }
    if (chosen === 'ITEM' && bagOf(state).length === 0) {
      // An empty bag greys the button out — the original refuses rather than
      // opening a list with nothing in it.
      cue(state, 'snd_error');
      return false;
    }
    if (chosen === 'ITEM') {
      // Opens the bag rather than ending the turn. Everything else still just
      // passes to the next character — see this file's scope note.
      menu.submenu = 'item';
      menu.gridIndex = 0;
      menu.itemIndex = 0;
      // `scr_itemconsumeb` sets `global.faceaction[charturn] = 3`.
      setFace(state, c, FACE_ITEM);
      cue(state, 'snd_select');
      return false;
    }
    state.charaction[c] = chosen === 'DEFEND' ? ACTION_DEFEND : 0;
    // DEFEND PAYS ITS TP THE INSTANT IT IS CHOSEN, not when the turn resolves —
    // so a later party member can spend what an earlier one's DEFEND just
    // banked. That ordering is the whole reason to defend with Kris and cast
    // with Ralsei in the same turn.
    if (chosen === 'DEFEND') {
      scrTensionheal(state, TP_DEFEND);
      // DEFEND is the one ready-pose that animates while standing — its timer
      // ramps to `defendframes` and holds there for the whole enemy turn.
      setFace(state, c, FACE_DEFEND);
    } else {
      setFace(state, c, FACE_IDLE);
    }
    selNoise = true;
    menu.charturn += 1;
    if (!skipFallen(state)) {
      menu.charturn = 0;
      menu.open = false;
      menu.justClosed = true;
      menu.needsCommit = true;
      if (selNoise) cue(state, 'snd_select');
      return true;
    }
  }

  if (moveNoise) cue(state, 'snd_menumove');
  if (selNoise) cue(state, 'snd_select');

  // `onebuffer -= 1; twobuffer -= 1;` — THE LAST TWO LINES of
  // obj_battlecontroller's Step, and the position matters.
  //
  // Both start at 0 (Create). Decrementing at the END means frame 0's input
  // test sees 0, which FAILS `< 0` — so the very first confirm of the fight
  // is rejected and the menu cannot begin until frame 1 at the earliest.
  // Decrementing at the TOP instead makes that test see -1 and accept it, and
  // the sim then ran a constant TWO FRAMES AHEAD of the oracle all turn:
  //
  //     frame  oracle menu   sim menu
  //       0    buttons       buttons
  //       2    buttons       enemy      <- a selection ahead already
  //       4    enemy         buttons
  //       8    enemy         (bar started)
  //
  // An earlier version of this comment asserted the two placements were
  // equivalent. They are not — the opening frame is exactly where they
  // differ, and that difference propagates through every turn of the fight.
  menu.onebuffer = (menu.onebuffer ?? 0) - 1;
  menu.twobuffer = (menu.twobuffer ?? 0) - 1;
  return false;
}

/**
 * Advance past anyone who is down — the COMMAND phase skips fallen allies.
 * Returns false if nobody is left to act.
 */
function skipFallen(state) {
  while (state.menu.charturn < 3 && !isUp(state, state.menu.charturn)) {
    state.menu.charturn += 1;
  }
  return state.menu.charturn < 3;
}

/** Reopen for the next turn, back at the first conscious character. */
export function openMenu(state) {
  state.menu.open = true;
  state.menu.charturn = 0;
  state.menu.submenu = null;
  state.menu.pending = null;
  state.menu.gridIndex = 0;
  state.menu.itemIndex = 0;
  state.menu.fight = [false, false, false];
  // `obj_battlecontroller`'s Create: `tempitem[i][j] = global.item[i]` for
  // every slot and every character. All three start the turn seeing the same
  // bag; they diverge only as items are spent.
  for (let i = 0; i < 3; i++) {
    state.menu.tempitem[i] = [...state.inventory];
    state.menu.temptension[i] = state.tension;
  }
  // Everyone down: no command phase at all, straight to the enemy's turn.
  if (!skipFallen(state)) {
    state.menu.charturn = 0;
    state.menu.open = false;
  }
}

export { skipFallen };
