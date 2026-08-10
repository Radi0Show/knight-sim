// Browser driver. Owns real time; sim/ never sees it (rule 1).
//
// The accumulator is sim/clock.js `drain` — the same pure helper the headless
// runner would use — so the browser and the verifier advance state through
// exactly the same code path.

import { createState, stepFrame } from '../sim/index.js';
import { drain, MS_PER_FRAME } from '../sim/clock.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { bindKeyboard } from '../input/keyboard.js';
import { createRenderer } from '../render/canvas.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);
const keys = bindKeyboard(window);

const params = new URLSearchParams(location.search);

let state = createState({ seed: Number(params.get('seed') ?? 12345), traceBulletSlots: 0 });
buildPracticeScene(state, { seed: state.seed });

// ?frames=N fast-forwards the sim before the first paint. Deterministic —
// same code path as the headless verifier — so any moment in the fight can be
// reproduced and inspected without waiting for it in real time.
const skip = Number(params.get('frames') ?? 0);
if (skip > 0) {
  const idle = keys.read();
  for (let i = 0; i < skip; i++) stepFrame(state, idle);
}

// Exposed for debugging and for automated screenshots; nothing in sim/ reads
// it back.
window.__sim = {
  get state() { return state; },
  step(n = 1) { for (let i = 0; i < n; i++) stepFrame(state, keys.read()); renderer.draw(state); },
};

let acc = 0;
let last = performance.now();
let running = true;
let simFrames = 0;
let lastFpsSample = last;
let fps = 0;

const hud = document.getElementById('hud');

// Shown to the player, not decoration: this scene contains a faithfully
// translated attack that the real fight never selects, so it must not be
// mistaken for practice against the real thing. See CLAUDE.md, "THE REAL
// FIGHT". Nothing invented ships; anything unrepresentative is labelled here.
const SANDBOX_NOTE = 'SANDBOX — engine demo, not the real fight sequence';

function reset() {
  state = createState({ seed: (Math.floor(performance.now()) % 100000) + 1, traceBulletSlots: 0 });
  buildPracticeScene(state, { seed: state.seed });
  acc = 0;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyP') running = !running;
});

function frame(now) {
  const elapsed = now - last;
  last = now;

  if (running) {
    const { steps, accumulator } = drain(acc, elapsed);
    acc = accumulator;
    for (let i = 0; i < steps; i++) {
      stepFrame(state, keys.read());
      simFrames += 1;
    }
  }

  renderer.draw(state);

  if (now - lastFpsSample >= 500) {
    fps = Math.round((simFrames * 1000) / (now - lastFpsSample));
    simFrames = 0;
    lastFpsSample = now;
  }
  // The sandbox label is not decoration: this scene shows a faithfully
  // translated attack that the real fight never selects. Nothing invented
  // ships, and anything unrepresentative is labelled where the player sees it.
  hud.innerHTML =
    `<b style="color:#e0a">${SANDBOX_NOTE}</b><br>` +
    `frame ${state.frame} · sim ${fps}/30 Hz · hits ${state.counters.collisionHits}` +
    ` · sprites ${renderer.spriteCount}` +
    ` · ${running ? '' : '[PAUSED] '}arrows/WASD move · shift focus · R reset · P pause`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
