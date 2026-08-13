// Browser key binder. The only DOM-aware file outside render/.
//
// Produces the same plain input-state object the headless runner feeds the
// sim, so sim/ cannot tell the difference between a keyboard and a table.
//
// Sampling: keys are latched on keydown and cleared on keyup, and the driver
// reads a SNAPSHOT once per simulated frame. A key pressed and released
// between two frames still registers for one frame — without the latch, fast
// taps would vanish at 30 Hz.

import { createInput } from './state.js';

// X IS ONE BUTTON WITH TWO JOBS, and that is the game's design, not a clash:
//
//     obj_heart's Step      `if (button2_h() ...)`   the SLOW modifier
//     obj_battlecontroller  `if (button2_p() ...)`   CANCEL
//
// Same physical key — button 2 — read HELD while dodging and as an EDGE in the
// menu. They never collide because the menu is closed during the bullet phase
// and the soul is frozen while it is open.
//
// This build had `KeyX: 'focus'` only, so the cancel key of the actual game did
// nothing in the menu and cancelling was possible solely on Escape, which is
// not a DELTARUNE binding at all.
const KEYMAP = {
  ArrowLeft: ['left'],
  ArrowRight: ['right'],
  ArrowUp: ['up'],
  ArrowDown: ['down'],
  KeyA: ['left'],
  KeyD: ['right'],
  KeyW: ['up'],
  KeyS: ['down'],
  // button 2.
  KeyX: ['focus', 'cancel'],
  // Shift is not a DELTARUNE binding; it is kept as a convenience alias for
  // the slow modifier only, so it cannot cancel a menu by accident.
  ShiftLeft: ['focus'],
  ShiftRight: ['focus'],
  // button 1.
  KeyZ: ['confirm'],
  Enter: ['confirm'],
  // Not a game binding either, kept because a keyboard without X is a real
  // thing and being unable to back out of a menu is worse than an extra key.
  Escape: ['cancel'],
  // button 3, which `global.flag[13] == 1` gives the third character on the
  // attack bar. Unused at flag 13 == 0 (the default, one button).
  KeyC: ['button3'],
};

export function bindKeyboard(target = window) {
  const held = new Set();
  const pressedSinceRead = new Set();

  const onDown = (ev) => {
    const actions = KEYMAP[ev.code];
    if (!actions) return;
    ev.preventDefault();
    for (const a of actions) {
      held.add(a);
      pressedSinceRead.add(a);
    }
  };
  const onUp = (ev) => {
    const actions = KEYMAP[ev.code];
    if (!actions) return;
    ev.preventDefault();
    for (const a of actions) held.delete(a);
  };
  const onBlur = () => {
    held.clear();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);

  return {
    /** Snapshot for one simulated frame. Clears the tap latch. */
    read() {
      const over = {};
      for (const a of held) over[a] = true;
      for (const a of pressedSinceRead) over[a] = true;
      pressedSinceRead.clear();
      return createInput(over);
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
