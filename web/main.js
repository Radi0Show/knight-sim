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
import { drawTitle, drawGameOver, stepGameOver, makeGameOver } from '../render/title.js';
import { drawBackground } from '../render/background.js';
import { buildSingleAttackScene, ATTACK_MENU, menuEntry } from '../sim/scenes/single.js';
import { bindKeyboard } from '../input/keyboard.js';
import { createRenderer } from '../render/canvas.js';
import { createIntroFx, stepIntroFx } from '../sim/intro.js';
import { drawIntroFx } from '../render/draw/intro-fx.js';
import { KNIGHT } from '../sim/actors.js';
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
  // The Game Over sequence, for the same reason state is here: it is a
  // timeline with a lot of frames in it and no other way to look inside.
  get over() { return over; },
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

/**
 * A BUTTON HELD ACROSS A TRANSITION MUST NOT ACT ON THE OTHER SIDE.
 *
 * Confirming a mode on the title screen used to fire Kris's FIGHT the instant
 * the fight opened, unless you let go of Z faster than a human reliably can.
 * The battle menu IS edge-triggered — but its `menu.held` map starts empty, so
 * the first frame of a still-held key reads as a fresh 0->1 edge. Same for the
 * game over's two options, and for R restarting into a run.
 *
 * The original has this problem too and solves it exactly here: obj_heart's
 * Create latches `disableslow` when the focus button is ALREADY down, so
 * holding focus through the transition into a fight does not slow the opening
 * frames. This is that latch, generalised to every button — the transition
 * happens at a moment the player did not choose, so nothing they were already
 * holding should count as an intent aimed at what comes next.
 *
 * The mask clears per key on release, so holding Z through the transition and
 * keeping it down does not lock FIGHT out — it just requires a new press.
 */
let inputMask = {};
function gatedKeys() {
  const raw = keys.read();
  const out = { ...raw };
  for (const k of Object.keys(inputMask)) {
    if (!raw[k]) delete inputMask[k];      // released: the key is live again
    else out[k] = false;                   // still down from before: not a press
  }
  return out;
}
/** Latch everything currently down; called at every scene change. */
function maskHeldInput() {
  inputMask = {};
  const raw = keys.read();
  for (const k of Object.keys(raw)) if (raw[k]) inputMask[k] = true;
}

function reset() {
  // Sustained cues do not belong to the sim state — rotating slash's aim loop
  // would keep whining over a fresh fight.
  audio.stopAll();
  // Whatever is down right now belongs to the thing that just ended.
  maskHeldInput();
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

// THE OPENING ROAR — obj_knight_roaring_fx, run OUT HERE like the title
// screen, never inside the sim. The real one plays in the overworld before
// scr_battle exists, and keeping it driver-side means replay tokens, the
// whole-fight diff and every suite are byte-identical with or without it.
// The fight is already built and sits at frame 0 underneath; recording
// starts when the fight's own loop does.
let introSeq = null;

function startRun() {
  runMode = title.mode;
  // Entering from the title gets the roar; ENDLESS and SINGLE skip it (one
  // is a treadmill, the other a lab). R-reset never replays it.
  if (runMode === 'normal' || runMode === 'hitless') {
    introSeq = createIntroFx(KNIGHT.x + 20, KNIGHT.ystart - 20);
  }
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
      const r = stepTitle(title, gatedKeys(), ATTACK_MENU.length);
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

  // THE OPENING ROAR, between the title and the fight — the fx runs on the
  // same 30Hz clock as everything else and draws over the dark background,
  // which is what the encounter's own room looks like at that moment.
  // Confirm or cancel skips it; the fight underneath has not stepped once.
  if (introSeq && !introSeq.done) {
    const { steps: is, accumulator: ia } = drain(acc, elapsed);
    acc = ia;
    for (let i = 0; i < is; i++) {
      const input = gatedKeys();
      if (input.confirm || input.cancel) {
        introSeq.done = true;
        // The skip press must not fire FIGHT on the other side (the same
        // held-across-a-transition rule the title uses).
        maskHeldInput();
        break;
      }
      const cues = [];
      stepIntroFx(introSeq, cues);
      if (cues.length) audio.play(cues);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, renderer.VIEW_W, renderer.VIEW_H);
    drawBackground(ctx, state, renderer.sprites);
    drawIntroFx(ctx, introSeq, renderer.sprites);
    if (introSeq.done) {
      introSeq = null;
      maskHeldInput();
    }
    requestAnimationFrame(frame);
    return;
  }

  // GAME OVER. The Knight's own — the soul does not break, it glides away and
  // he talks to you. See render/title.js for why this is not the game over
  // everybody knows: `global.tempflag[93]`, set by his encounter room.
  if (over) {
    const { steps: gs, accumulator: ga } = drain(acc, elapsed);
    acc = ga;
    for (let i = 0; i < gs; i++) {
      const r = stepGameOver(over, gatedKeys());
      if (r.moved) audio.play([{ name: 'snd_menumove', pitch: 1, gain: 1 }]);
      if (r.advanced) audio.play([{ name: 'snd_select', pitch: 1, gain: 1 }]);
      if (r.chosen !== undefined) {
        audio.play([{ name: 'snd_select', pitch: 1, gain: 1 }]);
        over = null;
        if (r.chosen === 0) {
          // GO BACK (FIGHT AGAIN) — the same fight, from the top.
          reset();
        } else {
          // GO FORWARD (MOVE ON) — in the original this leaves the fight
          // behind for the rest of the chapter. Here there is nothing past
          // the fight, so it goes back to the mode menu, which is the same
          // gesture: stop fighting this thing.
          title.mode = null;
          title.pickingAttack = false;
          reset();
        }
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
      const input = gatedKeys();
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
          // `global.heartx = (x + 2) - viewX` (obj_heart's Step) — the soul
          // appears where it died, in SCREEN space, and the +2 is what
          // centres the 16px spr_heart inside the 20px spr_dodgeheart you
          // were dodging with. Dropping either term puts it two pixels off,
          // or anywhere at all once the arena has scrolled.
          // The key that was down when you died is not an answer to the
          // Knight's question.
          maskHeldInput();
          over = makeGameOver(
            shot,
            (state.soul?.x ?? renderer.VIEW_W / 2) + 2 - (state.view?.x ?? 0),
            (state.soul?.y ?? 170) + 2 - (state.view?.y ?? 0),
          );
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
    // Raw, negatives included — the charbox prints them and so does this: a
    // swooned -999 and a downed -80 are different situations and the readout
    // that flattens both to 0 is the one that hides the difference.
    ` · HP ${state.partyHp.join('/')}` +
    ` · TP ${Math.floor((state.tension / 250) * 100)}%` +
    ` · sprites ${renderer.spriteCount}` +
    ` · ${running ? '' : '[PAUSED] '}arrows/WASD move · X focus/cancel · R reset` + ` · Q music ${musicOn ? 'on' : 'OFF'} · P pause · <b style="color:#e0a">B report a bug</b>`;

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
