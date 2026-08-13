// Browser driver. Owns real time; sim/ never sees it (rule 1).
//
// The accumulator is sim/clock.js `drain` — the same pure helper the headless
// runner would use — so the browser and the verifier advance state through
// exactly the same code path.

import { createState, stepFrame } from '../sim/index.js';
import { drain, MS_PER_FRAME } from '../sim/clock.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { createRecorder, recordInput, encodeReplay, decodeReplay } from '../sim/replay.js';
import { buildSingleAttackScene, ATTACK_MENU, menuEntry } from '../sim/scenes/single.js';
import { bindKeyboard } from '../input/keyboard.js';
import { createRenderer } from '../render/canvas.js';
import { createAudio } from '../render/audio.js';
import { drainCues } from '../sim/audio.js';
import { resetTensionBar } from '../render/tensionbar.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);
const audio = createAudio();
const keys = bindKeyboard(window);

const params = new URLSearchParams(location.search);

// MODE. `?mode=practice&attack=<id>&difficulty=<n>` runs one attack on repeat;
// anything else runs the full fight. The picker below writes these back into
// the URL, so a particular attack at a particular difficulty is a shareable,
// reloadable link — same mechanism as ?frames and ?seed.
let mode = params.get('mode') === 'practice' ? 'practice' : 'fight';
let attackId = params.get('attack') ?? ATTACK_MENU[0].id;
let difficulty = Number(params.get('difficulty') ?? 0);

function build(st) {
  if (mode === 'practice') {
    buildSingleAttackScene(st, { seed: st.seed, attack: attackId, difficulty });
  } else {
    buildPracticeScene(st, { seed: st.seed });
  }
}

// ?replay=<token> REPLAYS A PLAYTESTER'S RUN in the browser, input and all.
//
// `?frames=N` fast-forwards with NO input, which lands on a different state
// than the tester saw the moment they touched a key. A token carries the
// input stream, so this is the only way to put human eyes on the exact frame
// a report is about — and the renderer is the half the token cannot check by
// itself.
const replayToken = params.get('replay');
let replay = null;
if (replayToken) {
  try {
    replay = decodeReplay(replayToken);
    mode = replay.meta.mode;
    attackId = replay.meta.attack || attackId;
    difficulty = replay.meta.difficulty;
  } catch (err) {
    console.error(`bad replay token: ${err.message}`);
  }
}

let state = createState({
  seed: replay ? replay.meta.seed : Number(params.get('seed') ?? 12345),
  traceBulletSlots: 0,
});
state.spriteFrames = renderer.spriteFrames;
state.spriteRate = renderer.spriteRate;
build(state);

// ?frames=N fast-forwards the sim before the first paint. Deterministic —
// same code path as the headless verifier — so any moment in the fight can be
// reproduced and inspected without waiting for it in real time.
const skip = Number(params.get('frames') ?? (replay ? replay.frames : 0));
if (skip > 0) {
  const idle = keys.read();
  // A replay feeds its recorded input; everything else fast-forwards idle.
  for (let i = 0; i < skip; i++) {
    stepFrame(state, replay ? replay.inputAt(i) : idle);
  }
}

// Exposed for debugging and for automated screenshots; nothing in sim/ reads
// it back.
window.__audio = audio;
window.__sim = {
  get state() { return state; },
  step(n = 1) { for (let i = 0; i < n; i++) stepFrame(state, keys.read()); renderer.draw(state); },
};

let acc = 0;
let last = performance.now();
// `?pause=1` holds the sim still after the ?frames= fast-forward, which is what
// makes a screenshot of a named frame reproducible — without it the page runs
// on and whatever you sample is whatever moment the round-trip landed in. P
// still toggles.
let running = params.get('pause') !== '1';
let simFrames = 0;
let lastFpsSample = last;
let fps = 0;

const hud = document.getElementById('hud');

// Shown to the player, not decoration: this scene contains a faithfully
// translated attack that the real fight never selects, so it must not be
// mistaken for practice against the real thing. See CLAUDE.md, "THE REAL
// FIGHT". Nothing invented ships; anything unrepresentative is labelled here.
// ---- the picker -----------------------------------------------------------
//
// Built from ATTACK_MENU so it can never drift from what the scene can launch.
const bar = document.getElementById('picker');
const modeSel = document.getElementById('mode');
const attackSel = document.getElementById('attack');
const diffSel = document.getElementById('difficulty');

for (const a of ATTACK_MENU) {
  const o = document.createElement('option');
  o.value = a.id;
  o.textContent = `${a.name} — ${a.where}`;
  attackSel.append(o);
}

function syncDifficulties() {
  const m = menuEntry(attackSel.value);
  diffSel.innerHTML = '';
  for (const d of m.difficulties) {
    const o = document.createElement('option');
    o.value = String(d);
    o.textContent = `difficulty ${d}`;
    diffSel.append(o);
  }
  if (m.difficulties.includes(difficulty)) diffSel.value = String(difficulty);
}

function applyPicker() {
  mode = modeSel.value;
  attackId = attackSel.value;
  difficulty = Number(diffSel.value);
  const q = new URLSearchParams();
  if (mode === 'practice') {
    q.set('mode', 'practice');
    q.set('attack', attackId);
    q.set('difficulty', String(difficulty));
  }
  history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
  attackSel.disabled = diffSel.disabled = mode !== 'practice';
  reset();
}

modeSel.value = mode;
attackSel.value = attackId;
syncDifficulties();
attackSel.disabled = diffSel.disabled = mode !== 'practice';

modeSel.addEventListener('change', applyPicker);
attackSel.addEventListener('change', () => { syncDifficulties(); applyPicker(); });
diffSel.addEventListener('change', applyPicker);
// Keep the canvas focused so arrow keys move the soul, not the dropdown.
for (const el of [modeSel, attackSel, diffSel]) {
  el.addEventListener('change', () => el.blur());
}

function reset() {
  // Sustained cues do not belong to the sim state — rotating slash's aim loop
  // would keep whining over a fresh fight.
  audio.stopAll();
  // The bar's two trailing values are renderer-local, so a fresh fight has to
  // clear them or the new run starts with the old one's TP draining away.
  resetTensionBar();
  state = createState({ seed: (Math.floor(performance.now()) % 100000) + 1, traceBulletSlots: 0 });
  // A reset starts a new recording — a token must describe exactly one run.
  recorder = createRecorder({ seed: state.seed, mode, attack: attackId, difficulty });
  state.spriteFrames = renderer.spriteFrames;
state.spriteRate = renderer.spriteRate;
  build(state);
  acc = 0;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') reset();
  if (e.code === 'KeyP') {
    running = !running;
    if (!running) audio.stopAll();
  }
  // B — copy a replay token for a bug report.
  if (e.code === 'KeyB') copyReplay();
});

// ---- BUG REPORTS --------------------------------------------------------
//
// The token is the whole report. Everything else — what it looked like, which
// attack, how far in — is recoverable by replaying it, so the tester only has
// to say what looked wrong.
let recorder = createRecorder({ seed: state.seed, mode, attack: attackId, difficulty });

async function copyReplay() {
  const token = encodeReplay(recorder);
  let copied = false;
  try {
    await navigator.clipboard.writeText(token);
    copied = true;
  } catch {
    // Clipboard access needs a secure context and a user gesture, and a
    // keypress on a file:// page has neither. Falling back to a selectable
    // box means the feature still works rather than failing silently.
  }
  showReplay(token, copied);
}

function showReplay(token, copied) {
  let box = document.getElementById('replaybox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'replaybox';
    box.style.cssText =
      'position:fixed;left:0;right:0;bottom:0;background:#111;color:#ddd;'
      + 'font:12px monospace;padding:8px;border-top:2px solid #e0a;z-index:99';
    document.body.append(box);
  }
  box.innerHTML =
    `<b style="color:#e0a">${copied ? 'Replay token copied.' : 'Replay token — copy this:'}</b> `
    + `${recorder.frames} frames · paste it into the bug report `
    + '<a href="https://github.com/Radi0Show/knight-sim/issues/new?template=bug.yml" '
    + 'target="_blank" style="color:#6cf">(open an issue)</a> '
    + '<button id="replayclose" style="float:right">close</button>'
    + `<textarea readonly rows="3" style="width:100%;background:#000;color:#8f8;`
    + `font:11px monospace;border:1px solid #444">${token}</textarea>`;
  const ta = box.querySelector('textarea');
  ta.focus();
  ta.select();
  box.querySelector('#replayclose').onclick = () => box.remove();
}

function frame(now) {
  const elapsed = now - last;
  last = now;

  if (running) {
    const { steps, accumulator } = drain(acc, elapsed);
    acc = accumulator;
    for (let i = 0; i < steps; i++) {
      const input = keys.read();
      // RECORD EVERY FRAME. `sim/` is deterministic, so seed + input stream
      // reproduces this exact run on any machine — which turns a playtester's
      // bug report from a description into something you can run. See
      // sim/replay.js. One byte a frame, run-length encoded; the cost of
      // recording unconditionally is nothing next to the cost of asking a
      // tester to reproduce something they already saw.
      recordInput(recorder, input);
      stepFrame(state, input);
      audio.play(drainCues(state));
      simFrames += 1;
    }
  }

  renderer.draw(state);

  if (now - lastFpsSample >= 500) {
    fps = Math.round((simFrames * 1000) / (now - lastFpsSample));
    simFrames = 0;
    lastFpsSample = now;
  }
  // THE BANNER IS GONE, and rule 5 is still satisfied.
  //
  // It existed because the scene used to show content the real fight never
  // selects, and anything unrepresentative has to be labelled where the player
  // sees it. Two things changed: the fight scene now runs the real order with
  // real HP and the real 5840 phase-4 gate, so the sandbox text was describing
  // things that are no longer true of it; and practice mode labels each
  // unreachable attack in the DROPDOWN itself (`name — where`), which is
  // nearer the choice than a banner is.
  //
  // If an unlabelled placeholder is ever added back, the label goes on the
  // thing itself, not here.
  hud.innerHTML =
    (state.gameOver ? '<b style="color:#f44">GAME OVER — R to retry</b><br>' : '') +
    `frame ${state.frame} · sim ${fps}/30 Hz · hits ${state.counters.collisionHits}` +
    ` · HP ${state.partyHp.map((h) => Math.max(h, 0)).join('/')}` +
    ` · TP ${Math.floor((state.tension / 250) * 100)}%` +
    ` · sprites ${renderer.spriteCount}` +
    ` · ${running ? '' : '[PAUSED] '}arrows/WASD move · X focus/cancel · R reset · P pause · <b style="color:#e0a">B report a bug</b>`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
