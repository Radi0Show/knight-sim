#!/usr/bin/env node
// THE TOUCH BINDER, headless. A stub element records listeners and lets the
// test fire pointer sequences; the assertions are on read()'s output — the
// exact object the sim is handed, so this covers everything except the DOM
// wiring itself (which verify-render-smoke's page load and the CSS own).
const failures = [];
const check = (c, what) => { if (!c) failures.push(what); };

function stubEl(rect) {
  const listeners = {};
  return {
    rect,
    classList: { add() {}, remove() {} },
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    setPointerCapture() {},
    getBoundingClientRect() { return this.rect; },
    fire(type, ev) { for (const fn of listeners[type] ?? []) fn({ preventDefault() {}, ...ev }); },
  };
}

const { bindTouch } = await import('../input/touch.js');

const pad = stubEl({ left: 0, top: 0, width: 148, height: 148 });
const bz = stubEl({ left: 300, top: 300, width: 64, height: 64 });
const bx = stubEl({ left: 220, top: 300, width: 64, height: 64 });
let resets = 0;
const br = stubEl({ left: 300, top: 0, width: 44, height: 44 });
const t = bindTouch({
  pad,
  buttons: [
    { el: bz, actions: ['confirm'] },
    { el: bx, actions: ['focus', 'cancel'] },
    { el: br, actions: ['reset'] },
  ],
  onReset: () => { resets += 1; },
});

// A tap between reads latches for exactly one frame.
bz.fire('pointerdown', { pointerId: 1, clientX: 332, clientY: 332 });
bz.fire('pointerup', { pointerId: 1 });
let r = t.read();
check(r.confirm === true, 'a Z tap between reads did not latch');
r = t.read();
check(r.confirm === false, 'the tap latch did not clear after one read');

// Held X reads as focus AND cancel, every frame, until release.
bx.fire('pointerdown', { pointerId: 2, clientX: 252, clientY: 332 });
r = t.read();
check(r.focus === true && r.cancel === true, 'held X is not focus+cancel');
r = t.read();
check(r.focus === true, 'X did not stay held across reads');
bx.fire('pointerup', { pointerId: 2 });
r = t.read();
check(r.focus === false && r.cancel === false, 'X release did not clear');

// The d-pad: centre is dead, right is right, and the down-left DIAGONAL
// reads as both axes — the soul's fastest movement, not a nicety.
pad.fire('pointerdown', { pointerId: 3, clientX: 74, clientY: 74 });
r = t.read();
check(!r.left && !r.right && !r.up && !r.down, 'the dead zone is not dead');
pad.fire('pointermove', { pointerId: 3, clientX: 140, clientY: 74 });
r = t.read();
check(r.right && !r.down && !r.up, 'east on the pad is not RIGHT');
pad.fire('pointermove', { pointerId: 3, clientX: 30, clientY: 120 });
r = t.read();
check(r.left && r.down && !r.right, 'south-west on the pad is not DOWN+LEFT');

// TWO THUMBS AT ONCE: the pad keeps its direction while Z fires.
bz.fire('pointerdown', { pointerId: 4, clientX: 332, clientY: 332 });
r = t.read();
check(r.left && r.down && r.confirm, 'a second pointer on Z broke the pad hold');
bz.fire('pointerup', { pointerId: 4 });
pad.fire('pointerup', { pointerId: 3 });
r = t.read();
check(!r.left && !r.down, 'lifting the pad thumb did not clear movement');

// Sliding around the pad rim replaces the direction rather than stacking it.
// The read BETWEEN the down and the slide matters: within one frame window
// the tap latch reports both directions, exactly as rolling between two
// arrow keys inside a frame would — that is the keyboard's semantics, kept.
// Across frames, only the current direction may survive.
pad.fire('pointerdown', { pointerId: 5, clientX: 140, clientY: 74 });
r = t.read();
check(r.right, 'the slide test did not start on RIGHT');
pad.fire('pointermove', { pointerId: 5, clientX: 74, clientY: 10 });
r = t.read();
check(r.up && !r.right, 'sliding right -> up left RIGHT stuck on');
pad.fire('pointerup', { pointerId: 5 });

// R goes through the callback, never through the input object.
br.fire('pointerdown', { pointerId: 6, clientX: 322, clientY: 22 });
r = t.read();
check(resets === 1, 'the reset button did not call back');
check(r.confirm === false && r.cancel === false, 'reset leaked into the input object');

if (failures.length) {
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('tap latch · X two-jobs · 8-way pad with dead zone · two thumbs · reset callback');
console.log('\nPASS  the touch binder (no oracle — there is no touch in the original)');
