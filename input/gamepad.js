// Gamepad binder — the second DOM-aware file in input/.
//
// The Gamepad API is POLL-ONLY: there are no button events, so unlike the
// keyboard binder there is nothing to latch — read() samples the live pads
// once per simulated frame and produces the same plain input object. A tap
// shorter than one 30Hz frame can vanish; controllers do not produce
// sub-33ms taps in practice, so no event shim is carried for it.
//
// The mapping mirrors DELTARUNE's own controller defaults on the standard
// layout (https://w3c.github.io/gamepad/#remapping):
//
//   d-pad 12-15 / left stick     move
//   button 0 (A / cross)         CONFIRM             (keyboard Z)
//   button 1 (B / circle)        CANCEL + SLOW       (keyboard X — one
//                                button, two jobs; see input/keyboard.js)
//   buttons 2/3 (X/Y, square/triangle)  button 3     (keyboard C)
//   shoulders 4/5                SLOW only           (the Shift alias)
//   button 9 (start)             pause  — a DRIVER key, not sim input
//   button 8 (select/back)       reset  — likewise
//
// The stick threshold is 0.5: menus and dodging both want a digital read,
// and a low threshold turns stick drift into a cursor that walks by itself.

import { createInput } from './state.js';

const DEADZONE = 0.5;

function livePads() {
  const list = (typeof navigator !== 'undefined' && navigator.getGamepads)
    ? navigator.getGamepads()
    : [];
  const out = [];
  for (const p of list) if (p && p.connected) out.push(p);
  return out;
}

export function bindGamepad() {
  // Edge state for the driver buttons (start/select toggle things; a held
  // button must fire once, exactly like the keydown handlers they mirror).
  let startWas = false;
  let selectWas = false;

  return {
    /** Snapshot for one simulated frame — same shape as the keyboard's. */
    read() {
      const over = {};
      for (const p of livePads()) {
        const b = (i) => !!p.buttons?.[i]?.pressed;
        const ax = (i) => p.axes?.[i] ?? 0;
        if (b(12) || ax(1) < -DEADZONE) over.up = true;
        if (b(13) || ax(1) > DEADZONE) over.down = true;
        if (b(14) || ax(0) < -DEADZONE) over.left = true;
        if (b(15) || ax(0) > DEADZONE) over.right = true;
        if (b(0)) over.confirm = true;
        if (b(1)) {
          over.focus = true;
          over.cancel = true;
        }
        if (b(2) || b(3)) over.button3 = true;
        if (b(4) || b(5)) over.focus = true;
      }
      return createInput(over);
    },

    /** Rising edges for the driver keys (start -> pause, select -> reset). */
    driverEdges() {
      let start = false;
      let select = false;
      for (const p of livePads()) {
        if (p.buttons?.[9]?.pressed) start = true;
        if (p.buttons?.[8]?.pressed) select = true;
      }
      const edges = { pause: start && !startWas, reset: select && !selectWas };
      startWas = start;
      selectWas = select;
      return edges;
    },

    connected() {
      return livePads().length > 0;
    },

    dispose() {},
  };
}
