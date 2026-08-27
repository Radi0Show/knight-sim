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
import { useItem, takeItem, applyItem, ITEMS } from './items.js';
import {
  SPELLS, SPELL_LIST, ACTS, canAfford, spellCost, castSpell, holdBreath,
} from './spells.js';
import {
  FACE_IDLE, FACE_ATTACK, FACE_SPELL, FACE_ITEM, FACE_DEFEND, FACE_ACT,
  HERO_SPELL, HERO_ITEM, HERO_ACT, heroAct,
} from './heroes.js';
import { ACT_PAGES } from './dialogue.js';

// Every key the menu edge-detects, refreshed as a set each open frame (and
// seeded from prevInput at openMenu) — polling must never decide which keys'
// held states stay current.
const MENU_KEYS = ['left', 'right', 'up', 'down', 'confirm', 'cancel', 'focus', 'button3'];

/**
 * `global.charaction[c] = 2` — CHOSE A SPELL. The cast itself happens later,
 * during obj_attackpress's delay window, so the animation plays after the
 * whole party has committed rather than over the next character's menu.
 *
 * TP is still spent NOW: `scr_spellconsumeb` deducts on selection, which is
 * what stops two characters spending the same 125.
 */
/**
 * ITEMS RESOLVE WITH THE TURN, NOT ON SELECTION.
 *
 * `tempitem` removes the item from the character's snapshot the moment it is
 * chosen (that is what cancel restores), but the EFFECT waits for the resolve
 * phase — obj_attackpress's Draw fires each character's item at
 * `maxdelaytimer == spelldelay[c]`, exactly as it does for spells.
 *
 * Applying on selection let a revived ally act on the same turn they were
 * revived, which the real fight does not allow: by the time the Revive Mint
 * lands, the command phase is over and their turn is already spent. Reported
 * from play, and it changes what a turn can do rather than how it looks.
 *
 * THE TP ITEMS ARE A REAL EXCEPTION, and this comment used to deny it. The
 * claim was that nothing is special-cased and TP items only FEEL immediate
 * because `temptension` is spent during the menu. That was reasoning from the
 * outside; obj_battlecontroller's Step settles it and says otherwise:
 *
 *     if (tempitem[...] == 27) { scr_tensionheal(80);                   _tensionhealed = 1; }
 *     if (tempitem[...] == 28) { scr_tensionheal(ceil(maxtension / 2)); _tensionhealed = 1; }
 *     if (tempitem[...] == 29) { scr_tensionheal(ceil(maxtension));     _tensionhealed = 1; }
 *     if (_tensionhealed) { ...healanim, snd_cardrive...
 *                           scr_itemshift_temp(...); scr_nexthero(); }
 *     if (!_tensionhealed) { scr_itemconsumeb(); }      // <- everything else
 *
 * The TP items are applied INLINE, in the selection code, and then hand
 * straight to the next hero. `scr_itemconsumeb` — the deferred path every
 * other item takes — is explicitly the ELSE of that. So the split is not a
 * feel, it is two different code paths, and the difference is visible: fill
 * TP with TensionMax and the very next character can afford a spell with it
 * this turn.
 *
 * Reported from play, twice: once to establish that items defer, and once to
 * say TP was wrongly deferred with them.
 */
function recordItem(state, c, slot, target) {
  // The item leaves the snapshot NOW — that is what cancel restores.
  const id = takeItem(state, slot, bagOf(state));
  if (id === null) return null;
  state.charaction[c] = 4;

  // `_tensionhealed`: applied here, never queued.
  if (ITEMS[id]?.kind === 'tension') {
    applyItem(state, id, target);
    return ITEMS[id]?.name ?? 'Item';
  }

  state.pendingItem = state.pendingItem ?? [];
  state.pendingItem[c] = { id, target };
  return ITEMS[id]?.name ?? 'Item';
}

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
  // IT SKIPS THE FALLEN, and it refuses when there is nobody to go back to.
  // scr_prevhero does not decrement — it picks a target and gates each choice
  // on `charmove`, which scr_dead clears:
  //
  //     if (charturn == 1) { if (charmove[0] == 1) { charturn = 0;
  //                                                  moveswapped = 1; } }
  //     if (charturn == 2) { moveswapped = 1;
  //                          if (charmove[1] == 1 && acting[1] == 0) charturn = 1;
  //                          else if (charmove[0] == 1)              charturn = 0; }
  //     if (moveswapped == 1) { ...the undo... }
  //
  // A bare `charturn -= 1` handed the player a SWOONED character's menu:
  // cancel from Ralsei with Susie down and you could pick her action, and
  // reviving her next turn then let her act immediately. Reported from play.
  //
  // `isUp` reads `chardead`, which scr_dead and scr_revive set alongside
  // charmove, so it is the same flag. `acting[1] == 0` is not modelled: it
  // marks a character mid-ACT PERFORMANCE, which cannot be true during the
  // command phase this runs in.
  const from = menu.charturn;
  let to = -1;
  if (from === 1) {
    if (isUp(state, 0)) to = 0;
  } else if (from === 2) {
    if (isUp(state, 1)) to = 1;
    else if (isUp(state, 0)) to = 0;
  }
  if (to < 0) return false;
  menu.charturn = to;
  const c = menu.charturn;
  state.tension = menu.temptension[c] ?? state.tension;
  menu.tempitem[c] = c === 0 ? [...state.inventory] : [...menu.tempitem[c - 1]];
  state.charaction[c] = 0;
  // THE DEED IS UN-QUEUED WITH THE TURN. scr_prevhero's charaction = 0 is
  // what stops the resolve phase firing the choice — the game's resolver
  // iterates characters BY charaction. This sim's resolver iterates the
  // pending queues directly, so each queue entry must go with the action:
  // without these, cancelling a Rude Buster refunded the 125 TP and then
  // fired the bolt anyway, and the character could act AGAIN on top of it.
  // Reported from play, twice, within hours of each other.
  if (state.pendingSpell) state.pendingSpell[c] = null;
  if (state.pendingItem) state.pendingItem[c] = null;
  if (state.pendingAct?.c === c) state.pendingAct = null;
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
  if (menu.submenu === 'actgrid') {
    // `global.canactsus[myself][0] = 0` — SUSIE'S ACT IS ONE USE. Her block
    // ends by clearing her canact flag, so S-Action leaves the list entirely
    // after the first time; the "(Susie will not ACT any more.)" line is the
    // last PAGE of that one performance, not a second use. With the row gone
    // the list is empty, and opening an empty list is the `snd_error` the
    // confirm handler already plays.
    return (ACTS[c] ?? [])
      .map((a, i) => ({ label: a.name, descb: a.descb, id: i, usable: true }))
      .filter(() => !(c === 1 && state.actCounts?.susieUsed));
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

  if (!menu.open) {
    // `onebuffer -= 1; twobuffer -= 1;` are the LAST two lines of
    // obj_battlecontroller's Step and run UNCONDITIONALLY — menu open or
    // not. Freezing them while closed carried a confirm lockout from one
    // menu's last press into the next menu's first frames: the third menu
    // refused its opening confirm for exactly two frames (f702-703) while
    // the recording acted on it immediately.
    menu.onebuffer = (menu.onebuffer ?? 0) - 1;
    menu.twobuffer = (menu.twobuffer ?? 0) - 1;
    return false;
  }

  // Edge-triggered: the menu must not skip five buttons because a key was held
  // for five frames. The soul's own movement is level-triggered and unaffected.
  //
  // EVERY KEY'S EDGE IS COMPUTED UP FRONT, whether or not the current section
  // consults it. The game's `right_p()` is a global frame-over-frame edge; it
  // does not care which bmenuno is looking. The held map used to update only
  // when a section POLLED the key, so a key never consulted in the current
  // submenu went stale: verify21j f8720's RIGHT press landed while character
  // 2 sat on the enemy row (which never reads left/right), the map still
  // said "up" when character 3's button row opened a frame later, and the
  // sim minted a phantom edge the game never saw — cursor onto MAGIC, 40 TP
  // the oracle never pays.
  const edges = {};
  for (const k of MENU_KEYS) {
    const down = !!input[k];
    edges[k] = down && !menu.held[k];
    menu.held[k] = down;
  }
  const rawPressed = (k) => edges[k] ?? false;

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
  // CONFIRM AND CANCEL ARE EVALUATED LAZILY, IN THE ORDER EACH SECTION
  // CONSULTS THEM — because the controller's own order is SECTION-DEPENDENT,
  // and it decides who wins when both edges land on the SAME frame (the
  // masher's cancel pulse coincides with a confirm every 74 frames):
  //
  //   button row (bmenuno 0):  confirm first, gate `twobuffer < 0` (line 288),
  //                            cancel at 517 gated `onebuffer < 0` — so the
  //                            confirm's `onebuffer = 1` cross-gates a
  //                            same-frame cancel away (f702's FIGHT).
  //   grid lists (2, 4, 9):    confirm first (632/935/1138), BOTH gated on
  //                            `onebuffer < 0` — confirm still wins.
  //   target lists (7, 1, 8,   CANCEL FIRST (1178, before the confirm at
  //   3, 11, 12, 13):          1315): the cancel reassigns bmenuno and the
  //                            confirm sits behind a RE-TEST of it, so a
  //                            same-frame Z+X is a cancel and nothing else.
  //                            verify21j f6622: the token mashes both on the
  //                            enemy row; the game backs out to the button
  //                            row and re-picks (bar at 6626), where a
  //                            global confirm-first ended the command phase
  //                            four frames early.
  //
  // Each edge is read up front (the held map must update every frame), the
  // GATE resolves at the first `pressed()` call for that key, and the
  // winner's latch (`onebuffer`/`twobuffer = 1`) is what gates the other —
  // so call order inside a section reproduces the original's text order.
  const confirmEdge = rawPressed('confirm');
  const cancelEdge = rawPressed('cancel');
  let confirmFired = null;
  let cancelFired = null;
  const evalConfirm = () => {
    if (confirmFired === null) {
      // The button row's confirm is the only one gated on `twobuffer`;
      // every list and picker checks `onebuffer`.
      const gate = menu.submenu ? menu.onebuffer : menu.twobuffer;
      confirmFired = confirmEdge && gate < 0;
      // `onebuffer = 1` — latched HERE rather than in each accepting branch.
      // The original sets it in all six of them; one gate cannot miss one.
      if (confirmFired) menu.onebuffer = 1;
    }
    return confirmFired;
  };
  const evalCancel = () => {
    if (cancelFired === null) {
      cancelFired = cancelEdge && menu.onebuffer < 0;
      if (cancelFired) menu.twobuffer = 1;
    }
    return cancelFired;
  };
  // Sections may consult each at most once per frame; consuming reads keep
  // an if/else-if chain from double-acting on one edge.
  let confirmLeft = null;
  let cancelLeft = null;
  const pressed = (k) => {
    if (k === 'confirm') {
      if (confirmLeft === false) return false;
      confirmLeft = false;
      return evalConfirm();
    }
    if (k === 'cancel') {
      if (cancelLeft === false) return false;
      cancelLeft = false;
      return evalCancel();
    }
    return rawPressed(k);
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
    // bmenuno 7's real navigation is UP/DOWN over the three rows (issue #2:
    // the picker is the game's own ally list, not a horizontal toggle).
    if (pressed('up') || pressed('left')) {
      menu.targetIndex = (menu.targetIndex + 2) % 3;
      moveNoise = true;
    }
    if (pressed('down') || pressed('right')) {
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
        // Recorded, not applied — see recordItem.
        const nm = recordItem(state, c, p.slot, t);
        did = nm ? `${nm}!` : null;
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
      // `global.charaction[global.charturn] = 1` — THE LINE THAT CLEARS A
      // STALE DEFEND. obj_battlecontroller's bmenuno-1 confirm sets
      // chartarget, faceaction AND charaction together; the sim set only
      // faceaction, and since nothing in the fight ever zeroes charaction
      // per turn (the dump zeroes it in obj_battlecontroller's Create,
      // scr_dead and scr_prevhero, nowhere else), a character who chose
      // DEFEND once kept `charaction == 10` for the REST OF THE FIGHT and
      // took ceil(2*dmg/3) on every hit forever after. Invisible to the
      // canonical whole-fight diff because that run pins party HP; caught
      // the first time a recording let HP move (nka1 f494: the game deals
      // Kris 58, the sim 38 = ceil(2*56/3)).
      state.charaction[c] = 1;
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

  // ---- KRIS'S ACT PICKER (`bmenuno == 11`) --------------------------------
  //
  // The stage between the ACT button and the option grid: pick which enemy
  // to act on. One enemy in this fight, so it is a single confirm — but the
  // stage still owns its press and its frames (traced as "act", same as the
  // grid's parent state, in the oracle's coarse vocabulary).
  if (menu.submenu === 'actpick') {
    if (pressed('cancel')) {
      menu.submenu = null;
      setFace(state, c, FACE_IDLE);
      moveNoise = true;
    } else if (pressed('confirm')) {
      // `global.bmenuno = 9` — into the option grid.
      menu.submenu = 'actgrid';
      menu.gridIndex = 0;
      menu.itemIndex = 0;
      cue(state, 'snd_select');
    }
    if (moveNoise) cue(state, 'snd_menumove');
    return false;
  }

  // ---- THE LISTS: bag, MAGIC, ACT -----------------------------------------
  //
  // One handler for all three. They are the same 2x6 grid at the same
  // coordinates and the same `global.bmenucoord` cursor; only the contents
  // differ, which is why the original draws them with near-identical blocks.
  if (menu.submenu === 'item' || menu.submenu === 'magic' || menu.submenu === 'actgrid') {
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

      // CONFIRM BEFORE CANCEL — the grid lists (bmenuno 2/4/9) test
      // button1_p first (632/935/1138 vs 654/994/1151), so a same-frame
      // Z+X confirms and the latch gates the cancel. Only the TARGET lists
      // reverse this; see the evaluation-order comment above.
      const gridConfirm = pressed('confirm');
      if (!gridConfirm && pressed('cancel')) {
        // A submenu cancel goes to the BUTTON ROW, not the previous character:
        // `global.bmenuno = 0`. Only a cancel already on the row calls
        // scr_prevhero. One step per press, which is what makes the menu
        // feel like a stack rather than a jump.
        menu.submenu = null;
        menu.gridIndex = 0;
        moveNoise = true;
      } else if (gridConfirm) {
        const row = rows[menu.gridIndex];
        if (!row || !row.usable) {
          cue(state, 'snd_error');
        } else if (menu.submenu === 'actgrid') {

          // SELECTION QUEUES, RESOLUTION COUNTS. The menu marks the act
          // (`acting = 1`); everything else — checkcount++, holdbreathcount++
          // and its clamp, canactsus = 0, ractcount++, and the page choice
          // those counts drive — happens in the KNIGHT'S acting blocks, after
          // the menu has closed. This used to do all of it at selection, and
          // cancel could not un-ring any of that bell: an X after choosing
          // HoldBreath left the speed buff live and the repeat page armed,
          // and cancelling Ralsei's first R-Action burned his five-page
          // variant without ever showing it. resolveActPages (sim/spells.js)
          // is the acting block; the director calls it when the writer is
          // born, which is the sim's "after the menu".
          state.pendingAct = { c, act: row.id };
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
              : (() => {
                const nm = recordItem(state, c, menu.gridIndex, c);
                return nm ? `${nm}!` : null;
              })();
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
  // CONFIRM EVALUATES BEFORE CANCEL on the button row (288 vs 517): a fired
  // confirm's `onebuffer = 1` gates a same-frame cancel away — f702's FIGHT
  // press rode a cancel pulse and must not become a prevHero.
  const rowConfirm = pressed('confirm');
  if (pressed('cancel')) {
    if (prevHero(menu, state)) moveNoise = true;
    else cue(state, 'snd_error');
  }

  if (rowConfirm) {
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
      const isAct = chosen === 'ACT' || (chosen === 'MAGIC' && c === 0);
      const listName = isAct ? 'actgrid' : 'magic';
      if (listRows({ ...state, menu: { ...menu, submenu: listName } }).length === 0) {
        cue(state, 'snd_error');
        return false;
      }
      // KRIS'S ACT IS TWO STAGES. The button opens `bmenuno = 11` — the
      // ENEMY PICKER for the act — and only its confirm reaches `bmenuno =
      // 9`, the 2x6 option grid. The sim used to jump straight to the grid,
      // which spent the token's picker press on the grid instead: verify21j
      // f2322 shows the oracle in state 9 for the press the sim had already
      // used to leave the menu. One enemy makes the picker look redundant;
      // its frames are not.
      menu.submenu = isAct ? 'actpick' : 'magic';
      menu.gridIndex = 0;
      menu.itemIndex = 0;
      setFace(state, c, isAct ? FACE_ACT : FACE_SPELL);
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
    // `scr_nexthero()`, NOT a bare increment. This advanced `charturn` by hand
    // and so skipped BOTH halves of the handover: the TP snapshot
    // (`temptension[charturn] = global.tension`) and carrying the bag forward
    // (`tempitem[i][charturn] = tempitem[i][charturn - 1]`).
    //
    // temptension therefore stayed at the turn's opening value for every
    // character, and cancelling out of anyone's turn restored THAT — so
    // DEFEND with Kris, DEFEND with Susie, then X at Ralsei rewound the TP
    // from 32% to 0 and cancelled both defends instead of just Susie's.
    // Reported from play exactly that way.
    //
    // The snapshot has to be taken AFTER the TP is paid, which is why the
    // call belongs here and not above the DEFEND branch: scr_tensionheal runs
    // on the choice, and the next character must inherit what it banked.
    nextHero(menu, state);
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
  if (state.menu.charturn < 3) return true;
  // NO ONE LEFT — SO THE TURN IS OVER, AND THAT IS WHERE THE BAG COMMITS.
  //
  // `scr_endturn` is called from inside `scr_nexthero`, on the branch where
  // there is no next hero, and its first line is
  //
  //     for (i = 0; i < 12; i++) global.item[i] = tempitem[i][global.charturn];
  //
  // reading `global.charturn` while it is still the character who just acted.
  // `charturn = 0` happens later, in scr_mnendturn.
  //
  // THIS SIM HAD THE ORDER INVERTED: every caller set `menu.charturn = 0` and
  // then flagged `needsCommit` for the director to honour a frame later, so
  // endTurnItems read index 0 and committed KRIS's snapshot. Kris rarely eats
  // anything, so his snapshot is the untouched bag — and every item Susie or
  // Ralsei used came straight back. Reported from play: Spincake never leaves
  // the inventory.
  //
  // Committing here puts it back where the original has it, before the index
  // is thrown away. The director's deferred call still runs and is a harmless
  // no-op: all three snapshots equal the inventory by then.
  endTurnItems(state);
  return false;
}

/** Reopen for the next turn, back at the first conscious character. */
export function openMenu(state) {
  state.menu.open = true;
  // `scr_battlecursor_memory_reset()` — called by scr_mnendturn before every
  // menu (flag 14, cursor memory, is 0 by default): ALL of bmenucoord zeroes,
  // which includes the button-row cursor per character. Without it the row
  // reopened wherever last turn's mashing left it — DEFEND for the recorded
  // token — while the recording confirms FIGHT from a clean cursor.
  state.menu.selected = [0, 0, 0];
  // SEED THE EDGE MAP FROM THE PREVIOUS FRAME. The game's `button1_p()` is a
  // global frame-over-frame edge — it does not care whether a menu was
  // looking. This map used to freeze on close and reopen carrying the LAST
  // open frame's held states: the reopen at f342 saw confirm "already down"
  // from the fight bar three hundred frames earlier, discarded the real edge
  // the recording acted on, and the held-LEFT auto-repeat walked the cursor
  // onto DEFEND before the next edge landed — 40 TP the oracle never pays.
  // Seeding from last frame's mask (not this frame's — the same-frame
  // stepMenu at open must still see today's edge) reproduces
  // `mask[f] && !mask[f-1]` exactly.
  for (const k of MENU_KEYS) {
    state.menu.held[k] = !!(state.prevInput?.[k]);
  }
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
