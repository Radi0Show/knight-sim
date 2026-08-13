// Browser driver. Owns real time; sim/ never sees it (rule 1).
//
// The accumulator is sim/clock.js `drain` — the same pure helper the headless
// runner would use — so the browser and the verifier advance state through
// exactly the same code path.

import { createState, stepFrame } from '../sim/index.js';
import { drain, MS_PER_FRAME } from '../sim/clock.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { createRecorder, recordInput, encodeReplay, decodeReplay } from '../sim/replay.js';
import { createTitle, stepTitle } from '../sim/modes.js';
import { drawTitle, drawGameOver, stepGameOver, makeShards } from '../render/title.js';
import { drawBackground } from '../render/background.js';
import { buildSingleAttackScene, ATTACK_MENU, menuEntry } from '../sim/scenes/single.js';
import { bindKeyboard } from '../input/keyboard.js';
import { createRenderer } from '../render/canvas.js';
import { createAudio } from '../render/audio.js';
import { drainCues } from '../sim/audio.js';
import { resetTensionBar } from '../render/tensionbar.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);
const ctx = renderer.ctx;
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
// THE PICKER IS GONE. Three HTML <select> boxes above the canvas, one of them
// reading "Stars — phase 1/2/3 opener", made this look like a debug harness
// with a game attached. The title screen replaces them: same choices, drawn on
// the canvas in the game's own font with its own cursor, so the menu cannot
// drift stylistically from the fight it launches.
//
// The URL parameters still work and still round-trip — ?mode, ?attack,
// ?difficulty and ?replay all bypass the title screen — because a shareable
// link to a specific attack is the thing the dropdowns were actually good for.

function reset() {
  // Sustained cues do not belong to the sim state — rotating slash's aim loop
  // would keep whining over a fresh fight.
  audio.stopAll();
  // The bar's two trailing values are renderer-local, so a fresh fight has to
  // clear them or the new run starts with the old one's TP draining away.
  resetTensionBar();
  state = createState({ seed: (Math.floor(performance.now()) % 100000) + 1, traceBulletSlots: 0 });
  state.runMode = runMode;
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
  // Q — MUSIC ONLY. The sound effects are feedback (a graze, a hit, a bolt
  // scoring) and muting them makes the fight harder to read; the track is the
  // part people turn off. Two separate things, so one key for one of them.
  if (e.code === 'KeyQ') {
    musicOn = !musicOn;
    if (musicOn) cueLoopNow('mus_knight');
    else audio.stopLoop('mus_knight');
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

// ---- THE TITLE SCREEN AND THE FOUR MODES --------------------------------
//
// `title.mode` is null while the menu is up. A URL that names a mode skips it
// entirely, which is what keeps ?attack= links working.
const title = createTitle();
if (replay || params.get('mode')) title.mode = mode === 'practice' ? 'single' : 'normal';

let musicOn = true;
function cueLoopNow(name) {
  audio.play([{ name, pitch: 1, gain: 1, loop: true }]);
}

let over = null;          // the Game Over sequence, once the party is down
let hitlessDeaths = 0;

function startRun() {
  runMode = title.mode;
  // The director reads this: ENDLESS must not reach the ending.
  state.runMode = runMode;
  mode = runMode === 'single' ? 'practice' : 'fight';
  if (runMode === 'single') attackId = ATTACK_MENU[title.attackIndex].id;
  reset();
}

let runMode = title.mode ?? 'normal';

function frame(now) {
  const elapsed = now - last;
  last = now;

  // THE TITLE SCREEN runs on the same clock as everything else, so its cursor
  // bobs at 30Hz like the battle menu's rather than at the monitor's rate.
  if (!title.mode) {
    const { steps: ts, accumulator: ta } = drain(acc, elapsed);
    acc = ta;
    for (let i = 0; i < ts; i++) {
      const r = stepTitle(title, keys.read(), ATTACK_MENU.length);
      if (r.moved) audio.play([{ name: 'snd_menumove', pitch: 1, gain: 1 }]);
      if (r.selected) audio.play([{ name: 'snd_select', pitch: 1, gain: 1 }]);
      if (r.chosen) { startRun(); break; }
    }
    // The fountain only. Drawing the fight under the menu made the party, the
    // HP bars and a stray soul legible through it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, renderer.VIEW_W, renderer.VIEW_H);
    drawBackground(ctx, state, renderer.sprites);
    drawTitle(ctx, title, renderer.sprites, ATTACK_MENU);
    requestAnimationFrame(frame);
    return;
  }

  // GAME OVER. The party is down; the fight stops and the shatter plays out.
  if (over) {
    const { steps: gs, accumulator: ga } = drain(acc, elapsed);
    acc = ga;
    for (let i = 0; i < gs; i++) {
      stepGameOver(over);
      // The two cracks, on the original's own frames — 50 and 90, forty apart.
      if (over.t === 50) audio.play([{ name: 'snd_break1', pitch: 1, gain: 1 }]);
      if (over.t === 90) {
        audio.play([{ name: 'snd_break2', pitch: 1, gain: 1 }]);
        over.shards = makeShards(over.x, over.y, Math.random);
      }
      // `try again` accepts confirm once the prompt is up.
      if (over.t > 170 && keys.read().confirm) {
        over = null;
        reset();
        break;
      }
    }
    renderer.draw(state);
    if (over) drawGameOver(ctx, over, renderer.sprites);
    requestAnimationFrame(frame);
    return;
  }

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
      const hitsBefore = state.counters.collisionHits;
      stepFrame(state, input);
      audio.play(drainCues(state));
      simFrames += 1;

      // HITLESS: one hit and it starts over. The restart is instant because
      // the sim is a pure function of (seed, input) — there is nothing to
      // tear down, which is the whole reason this mode is cheap to offer.
      if (runMode === 'hitless' && state.counters.collisionHits > hitsBefore) {
        hitlessDeaths += 1;
        reset();
        break;
      }

      // The party is down. In NORMAL and SINGLE that ends the run; in ENDLESS
      // and HITLESS it simply restarts, because stopping is the one thing
      // those two modes exist to avoid.
      if (state.gameOver) {
        if (runMode === 'endless' || runMode === 'hitless') {
          reset();
        } else {
          // `scr_gameover`: audio_stop_all, snd_hurt1, and a SCREENSHOT of
          // the application surface — the death is frozen on screen for 30
          // frames before anything else happens.
          audio.stopAll();
          audio.play([{ name: 'snd_hurt1', pitch: 1, gain: 1 }]);
          renderer.draw(state);
          const shot = document.createElement('canvas');
          shot.width = renderer.VIEW_W;
          shot.height = renderer.VIEW_H;
          shot.getContext('2d').drawImage(canvas, 0, 0);
          over = {
            t: 0,
            shot,
            // `global.heartx/hearty` — the soul breaks where it died.
            x: state.soul?.x ?? renderer.VIEW_W / 2,
            y: state.soul?.y ?? 170,
            shards: [],
          };
        }
        break;
      }
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
    // The Game Over SCREEN says this now, in the game own font.

    `frame ${state.frame} · sim ${fps}/30 Hz · hits ${state.counters.collisionHits}` +
    ` · HP ${state.partyHp.map((h) => Math.max(h, 0)).join('/')}` +
    ` · TP ${Math.floor((state.tension / 250) * 100)}%` +
    ` · sprites ${renderer.spriteCount}` +
    ` · ${running ? '' : '[PAUSED] '}arrows/WASD move · X focus/cancel · R reset` + ` · Q music ${musicOn ? 'on' : 'OFF'} · P pause · <b style="color:#e0a">B report a bug</b>`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
