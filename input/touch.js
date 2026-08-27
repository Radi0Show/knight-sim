// Touch binder — the on-screen d-pad and buttons for phones and tablets.
//
// Produces the same plain input-state object as the keyboard binder, latched
// the same way: a tap between two 30Hz reads still registers for one frame,
// and held contact reads as held. sim/ cannot tell a thumb from a keyboard,
// which is the whole point — nothing below web/ knows touch exists.
//
// POINTER EVENTS, NOT TOUCH EVENTS, and per-pointer bookkeeping throughout:
// dodging needs one thumb on the pad and one on the buttons at the same
// moment, so every handler keys off `pointerId`. `setPointerCapture` keeps a
// drag that wanders off a button from orphaning its release.
//
// THE D-PAD IS EIGHT-WAY with a centre dead zone. Diagonals are not a nicety:
// the soul's axes are set independently (no normalisation — CLAUDE.md,
// "Diagonals normalized? No."), so a pad that cannot express down-left robs
// the player of the fastest movement the game has.
//
// X IS ONE BUTTON WITH TWO JOBS here exactly as on the keyboard: held it is
// the SLOW modifier, tapped it is CANCEL. Same mapping (['focus','cancel']),
// same reason it cannot collide — the menu is closed during the bullet phase.

import { createInput } from './state.js';

const DEAD_ZONE = 0.28; // fraction of the pad's radius; inside it, no input.

export function bindTouch({ pad, buttons = [], onReset, onAction } = {}) {
  const held = new Set();
  const pressedSinceRead = new Set();
  /** pointerId -> Set of actions that pointer is holding. */
  const byPointer = new Map();

  const press = (id, actions) => {
    let mine = byPointer.get(id);
    if (!mine) byPointer.set(id, (mine = new Set()));
    for (const a of actions) {
      if (!mine.has(a)) {
        mine.add(a);
        pressedSinceRead.add(a);
      }
      held.add(a);
    }
  };
  const release = (id, keep = null) => {
    const mine = byPointer.get(id);
    if (!mine) return;
    for (const a of mine) {
      if (keep && keep.has(a)) continue;
      mine.delete(a);
      // Another pointer may still hold the same action.
      let stillHeld = false;
      for (const [, set] of byPointer) if (set.has(a)) stillHeld = true;
      if (!stillHeld) held.delete(a);
    }
    if (!keep) byPointer.delete(id);
  };

  // ---- the d-pad ----------------------------------------------------------
  const padDirs = (ev) => {
    const r = pad.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = ev.clientX - cx;
    const dy = ev.clientY - cy;
    const radius = Math.min(r.width, r.height) / 2;
    if (Math.hypot(dx, dy) < radius * DEAD_ZONE) return [];
    // Eight 45-degree sectors; each cardinal owns 45 degrees and shares 45
    // with each neighbouring diagonal. SCREEN Y POINTS DOWN, so positive
    // angles are the DOWN half: 0 right, +90 down, -90 up, both ends of the
    // range (sector -4 and +4) are left.
    const a = Math.atan2(dy, dx);
    const sector = Math.round(a / (Math.PI / 4)); // -4..4
    return [
      ['left'], ['left', 'up'], ['up'], ['up', 'right'],
      ['right'], ['right', 'down'], ['down'], ['down', 'left'],
      ['left'],
    ][sector + 4];
  };
  const onPadMove = (ev) => {
    ev.preventDefault();
    const dirs = new Set(padDirs(ev));
    release(ev.pointerId, dirs);
    press(ev.pointerId, dirs);
  };
  // setPointerCapture THROWS (InvalidPointerId) when the pointer is already
  // gone — a finger lifted in the same tick, or a synthetic event. The
  // capture is a nicety (it keeps a drag that wanders off the element from
  // orphaning its release); losing it must never cost the press itself.
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* gone */ } };
  const onPadDown = (ev) => {
    capture(pad, ev.pointerId);
    onPadMove(ev);
  };
  const onPadUp = (ev) => {
    ev.preventDefault();
    release(ev.pointerId);
  };
  if (pad) {
    pad.addEventListener('pointerdown', onPadDown);
    pad.addEventListener('pointermove', onPadMove);
    pad.addEventListener('pointerup', onPadUp);
    pad.addEventListener('pointercancel', onPadUp);
  }

  // ---- the buttons --------------------------------------------------------
  for (const { el, actions } of buttons) {
    if (!el) continue;
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      capture(el, ev.pointerId);
      el.classList.add('down');
      if (actions.includes('reset')) { onReset?.(); return; }
      press(ev.pointerId, actions);
      // SYNCHRONOUS, inside the gesture's own call stack, and that is the
      // whole point. Anything that needs the browser's user-activation —
      // window.open above all; iOS Safari refuses a popup whose open() call
      // is not in the handler stack, however fresh the tap — cannot wait for
      // the 30Hz loop to read the latch. The driver decides what (if
      // anything) the action means right now; the sim still sees the same
      // latched input next frame.
      for (const a of actions) onAction?.(a);
    });
    const up = (ev) => {
      ev.preventDefault();
      el.classList.remove('down');
      release(ev.pointerId);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  return {
    /** Snapshot for one simulated frame. Clears the tap latch. */
    read() {
      const over = {};
      for (const a of held) over[a] = true;
      for (const a of pressedSinceRead) over[a] = true;
      pressedSinceRead.clear();
      return createInput(over);
    },
  };
}
