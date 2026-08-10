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

const KEYMAP = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyW: 'up',
  KeyS: 'down',
  ShiftLeft: 'focus',
  ShiftRight: 'focus',
  KeyX: 'focus',
  KeyZ: 'confirm',
  Enter: 'confirm',
  Escape: 'cancel',
};

export function bindKeyboard(target = window) {
  const held = new Set();
  const pressedSinceRead = new Set();

  const onDown = (ev) => {
    const action = KEYMAP[ev.code];
    if (!action) return;
    ev.preventDefault();
    held.add(action);
    pressedSinceRead.add(action);
  };
  const onUp = (ev) => {
    const action = KEYMAP[ev.code];
    if (!action) return;
    ev.preventDefault();
    held.delete(action);
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
