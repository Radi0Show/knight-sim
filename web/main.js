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
import { loadFont, drawText } from '../render/font.js';
import { drawBackground } from '../render/background.js';
import { buildSingleAttackScene, ATTACK_MENU, menuEntry } from '../sim/scenes/single.js';
import { bindKeyboard } from '../input/keyboard.js';
import { bindGamepad } from '../input/gamepad.js';
import { createRenderer } from '../render/canvas.js';
import { createIntroScene, stepIntroScene } from '../sim/intro.js';
import { drawIntroScene } from '../render/draw/intro-fx.js';
import { createVictoryScene, stepVictoryScene } from '../sim/victory-scene.js';
import { drawVictoryScene } from '../render/draw/victory-scene.js';
import { createTvTurnoff, stepTvTurnoff } from '../sim/tvturnoff.js';
import { drawTvTurnoff } from '../render/draw/tvturnoff.js';
import { KNIGHT, PARTY as PARTY_ACTORS } from '../sim/actors.js';
import { damageKnight } from '../sim/knight.js';
import { spawnDmgNumber } from '../sim/dmgnumbers.js';
import { createAudio } from '../render/audio.js';
import { drainCues } from '../sim/audio.js';
import { resetTensionBar } from '../render/tensionbar.js';

const canvas = document.getElementById('game');
const renderer = await createRenderer(canvas);
const ctx = renderer.ctx;

/**
 * HOW THE 640x480 FRAME MEETS THE WINDOW — a GRAPHICS setting, because the
 * two answers are genuinely different and neither is right for everyone.
 *
 *   FULL   fill the window, letterboxed on the short axis. The default, and
 *          what fullscreen should look like.
 *   SMALL  scale by a WHOLE number of DEVICE pixels, leaving black around the
 *          edges when the window is not a clean multiple of 640x480.
 *
 * The trade is unavoidable. `image-rendering: pixelated` at a fractional
 * factor gives some source columns n device pixels and their neighbours n + 1,
 * so a one-pixel font stem is fat on one letter and thin on the next — the
 * "weird" menu text. SMALL is the only mode that cannot do that; FULL is the
 * only one that fills the screen. Measuring in DEVICE pixels is what makes
 * SMALL exact: a 2x display turns 640 CSS px into 1280 real ones, and only the
 * real count has to divide evenly.
 *
 * FULL used to be the only behaviour, then SMALL was, and each was reported as
 * a regression by the other's standard. Now it is a switch.
 */
let scalingMode = 'fit';
function fitCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const availW = window.innerWidth * dpr;
  const availH = window.innerHeight * dpr;
  const fit = Math.min(availW / renderer.VIEW_W, availH / renderer.VIEW_H);
  // Below 1x there is no whole multiple to land on, so SMALL falls back to
  // filling: showing the whole frame slightly soft beats cropping the arena.
  const scale = scalingMode === 'pixel' && fit >= 1 ? Math.floor(fit) : fit;
  canvas.style.width = `${(renderer.VIEW_W * scale) / dpr}px`;
  canvas.style.height = `${(renderer.VIEW_H * scale) / dpr}px`;
}
fitCanvas();
window.addEventListener('resize', fitCanvas);
// A window dragged between displays changes devicePixelRatio without ever
// firing `resize`; this is the documented way to hear about that.
if (window.matchMedia) {
  const watchDpr = () => {
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { fitCanvas(); watchDpr(); }, { once: true });
  };
  watchDpr();
}
const audio = createAudio();
const keyboard = bindKeyboard(window);
const gamepad = bindGamepad();
// One reader, two sources: the sim sees the OR of keyboard and controller,
// so both work at once and neither can mask the other. The replay recorder
// sits downstream of this read, so controller runs produce tokens exactly
// like keyboard runs.
const keys = {
  read() {
    const k = keyboard.read();
    const g = gamepad.read();
    for (const a of Object.keys(g)) if (g[a]) k[a] = true;
    return k;
  },
};

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
window.__intro = {
  get seq() { return introSeq; },
  skips: 0,
  // Deterministic single-frame inspection: build a scene, step to t, paint.
  // Same modules, same draw — throttle-immune (screenshot tooling stalls the
  // rAF clock, and the drain then blows through the timeline in one burst).
  hold: false, // freezes the rAF loop so a drive() paint stays on screen
  drive(t) {
    this.hold = true;
    const sc = createIntroScene();
    const cues = [];
    for (let i = 0; i < t; i++) stepIntroScene(sc, cues);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, renderer.VIEW_W, renderer.VIEW_H);
    drawBackground(ctx, state, renderer.sprites);
    drawIntroScene(ctx, sc, renderer.sprites);
    return { phase: sc.phase, t: sc.t, done: sc.done };
  },
};
// Deterministic single-frame inspection of the ENDING, auto-confirming the
// dialogue gates. Same hold semantics as __intro.drive.
window.__cutscene = {
  /**
   * @param t         frames to run
   * @param opts.hold if set, STOP pressing confirm from this frame on — the
   *                  run parks on whichever dialogue gate it reaches next,
   *                  which is the only way to inspect a textbox that a
   *                  confirm-every-other-frame driver clears before you can
   *                  screenshot it.
   */
  drive(t, opts = {}) {
    window.__intro.hold = true;
    const sc = createVictoryScene();
    const cues = [];
    // Alternate confirm every other frame: gates need a fresh edge.
    for (let i = 0; i < t; i++) {
      const held = opts.hold !== undefined && i >= opts.hold;
      stepVictoryScene(sc, { confirm: !held && i % 2 === 0 }, cues);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, renderer.VIEW_W, renderer.VIEW_H);
    drawVictoryScene(ctx, sc, renderer.sprites);
    return {
      t: sc.t, done: sc.done, wait: sc.wait, scriptIndex: sc.scriptIndex,
      dialogue: sc.dialogue ? { ...sc.dialogue } : null,
    };
  },
};
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
// `?hud=1` brings back the debug readout (frame, HP, TP, the key legend) for
// bug reports. Default is the game alone, letterboxed.
const hudOn = params.get('hud') === '1';
if (hudOn) document.body.classList.add('hud');

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
  // The vista's animation accumulator survives a reset — an R-restart is a
  // fresh battle in the SAME room, not a re-run of the story intro.
  const vistaFs = state?.vistaFsBase ?? 0;
  state = createState({ seed: (Math.floor(performance.now()) % 100000) + 1, traceBulletSlots: 0 });
  state.runMode = runMode;
  state.vistaFsBase = vistaFs;
  // THE LOADOUT COMES FROM SETTINGS. The title's equip menu edits title.gear;
  // every fresh fight is built with a copy of it (sim/damage.js gearOf).
  state.loadout.gear = title.gear.map((g) => ({ weapon: g.weapon, armor: [...g.armor] }));
  // …and so does the shake switch. A fresh state starts with flag 12 clear, so
  // without this an R-restart silently turned the camera shake back on.
  state.flag12 = title.shake ? 0 : 1;
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
  // E — DEBUG HIT: 1000 through the real damage path (scr_damage_enemy's
  // anim/state effects included), so the ending is reachable in seconds when
  // bug-fixing it. A practice-tool tool, shown in the HUD like every key.
  // 1000 >= 100 so it strobes like any heavy hit, and the number is drawn.
  if (e.code === 'KeyE' && mode === 'fight' && !introSeq && !tvOff && !cutsceneSeq) {
    const dealt = damageKnight(state, 1000);
    if (dealt > 0) spawnDmgNumber(state, KNIGHT.x, KNIGHT.ystart + 40, dealt, 1);
  }
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

// SETTINGS PERSISTENCE — the loadout and the volumes survive reloads.
const SETTINGS_KEY = 'knightsim.settings';
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  if (saved?.gear?.length === 3) {
    title.gear = saved.gear.map((g) => ({ weapon: g.weapon | 0, armor: (g.armor ?? []).map((a) => a | 0) }));
  }
  if (saved?.volumes) {
    title.volumes.music = Math.max(0, Math.min(100, saved.volumes.music | 0));
    title.volumes.sfx = Math.max(0, Math.min(100, saved.volumes.sfx | 0));
  }
  if (typeof saved?.shake === 'boolean') title.shake = saved.shake;
  if (saved?.scaling === 'fit' || saved?.scaling === 'pixel') title.scaling = saved.scaling;
} catch { /* a corrupt entry falls back to the defaults */ }

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      gear: title.gear, volumes: title.volumes, shake: title.shake,
      scaling: title.scaling,
    }));
  } catch { /* private mode etc. — the session still works, unsaved */ }
  audio.setVolumes(title.volumes.music / 100, title.volumes.sfx / 100);
  // `global.flag[12]` in the sim's terms: SET means "do not move the view".
  state.flag12 = title.shake ? 0 : 1;
  if (scalingMode !== title.scaling) {
    scalingMode = title.scaling;
    fitCanvas();
  }
}
persistSettings();
if (replay || params.get('mode')) title.mode = mode === 'practice' ? 'single' : 'normal';

let musicOn = true;
function cueLoopNow(name) {
  audio.play([{ name, pitch: 1, gain: 1, loop: true }]);
}

let over = null;          // the Game Over sequence, once the party is down
// THE WIN. The game hands the white fade to obj_ch3_PTB02's story cutscene
// (Susie against the Knight, Undyne, the bird) — overworld actors this build
// does not ship. The seam is cut at the fade: the tool holds the white, then
// shows its own card. Tool UI, styled like the title, labelled as the point
// where the story continues — not a recreation of it.
// THE CELEBRATION CARD IS GONE. It was tool-authored text ("THE KNIGHT LET
// DOWN ITS GUARD", a timer, a hits count) over a white fade — invented
// content in a project whose first rule is that nothing invented ships. A
// won run now ends the way Chapter 3 ends a scene: the TV switches off and
// the title screen comes back, so the state it used is gone with it.
// obj_tvturnoff_manager — the CRT power-off that closes a won run.
let tvOff = null;
// THE STORY SCENE between the white and the card — Susie against the Knight,
// Undyne, the bird. sim/victory-scene.js has the sourcing; it runs driver-
// side like the intro. Z advances dialogue; X skips the whole scene.
let cutsceneSeq = null;

/**
 * The card itself: white field easing back to black, the game's own closing
 * beat named for what it is, and the run's numbers — a practice tool's
 * scoreboard, in the fight's font.
 */
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
    introSeq = createIntroScene();
    // The title's confirm is still DOWN on the intro's first frames — an
    // ordinary ~100ms press spans four 30Hz steps — and the skip check would
    // read it as a fresh press (the held-across-a-transition rule).
    maskHeldInput();
  }
  // The director reads this: ENDLESS must not reach the ending.
  state.runMode = runMode;
  mode = runMode === 'single' ? 'practice' : 'fight';
  if (runMode === 'single') {
    const entry = ATTACK_MENU[title.attackIndex];
    attackId = entry.id;
    // The picker shows DIFFICULTY 1..N; the launch uses the selector's raw
    // value behind it (0/3/4 for the tunnel, etc).
    difficulty = entry.difficulties[title.difficultyIndex] ?? entry.difficulties[0] ?? 0;
  }
  reset();
}

let runMode = title.mode ?? 'normal';

function frame(now) {
  const elapsed = now - last;
  last = now;

  // Controller driver keys — start pauses, select resets, mirroring the
  // KeyP/KeyR handlers. Polled here because the Gamepad API has no events.
  {
    const pe = gamepad.driverEdges();
    if (pe.reset) reset();
    if (pe.pause) {
      running = !running;
      if (!running) audio.stopAll();
    }
  }

  // Debug freeze: a __intro.drive() paint stays on screen until released.
  if (window.__intro.hold) {
    requestAnimationFrame(frame);
    return;
  }

  // THE TITLE SCREEN runs on the same clock as everything else, so its cursor
  // bobs at 30Hz like the battle menu's rather than at the monitor's rate.
  if (!title.mode) {
    const { steps: ts, accumulator: ta } = drain(acc, elapsed);
    acc = ta;
    for (let i = 0; i < ts; i++) {
      const r = stepTitle(title, gatedKeys(), ATTACK_MENU);
      if (r.moved) audio.play([{ name: 'snd_menumove', pitch: 1, gain: 1 }]);
      if (r.selected) audio.play([{ name: 'snd_select', pitch: 1, gain: 1 }]);
      // The equip menu's refusal, and UNUSED's whole personality.
      if (r.error) audio.play([{ name: 'snd_error', pitch: 1, gain: 1 }]);
      if (title.dirty) {
        title.dirty = false;
        persistSettings();
      }
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
        window.__intro.skips += 1;
        introSeq.done = true;
        // The skip press must not fire FIGHT on the other side (the same
        // held-across-a-transition rule the title uses).
        maskHeldInput();
        break;
      }
      const cues = [];
      stepIntroScene(introSeq, cues);
      if (cues.length) audio.play(cues);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, renderer.VIEW_W, renderer.VIEW_H);
    // The fight's own backdrop underneath — the split slides the snow scene
    // off the edges and this is what it reveals.
    drawBackground(ctx, state, renderer.sprites);
    drawIntroScene(ctx, introSeq, renderer.sprites);
    if (introSeq.done) {
      // The room persists across the seam: hand the vista's animation
      // accumulator to the fight renderer so the backdrop's 120-frame
      // fade-in happens over an unbroken scene (render/canvas.js).
      state.vistaFsBase = introSeq.bg.fountain_speed;
      introSeq = null;
      maskHeldInput();
    }
    requestAnimationFrame(frame);
    return;
  }

  // THE STORY SCENE. White recedes over its first 20 frames, then the
  // knight glides in. When it finishes (or X skips it), the card.
  if (cutsceneSeq) {
    const { steps: cs, accumulator: ca } = drain(acc, elapsed);
    acc = ca;
    for (let i = 0; i < cs; i++) {
      const input = gatedKeys();
      if (input.cancel) {
        cutsceneSeq.done = true;
      }
      const cues = [];
      stepVictoryScene(cutsceneSeq, input, cues);
      // The scene's music ops ride the cue list: the wind track plays only
      // if the local pack carries it (wind_highplace is not extracted), so
      // 'wind' is a labelled no-op today; 'stop' quiets any loop.
      const sound = cues.filter((c) => !c.music);
      if (sound.length) audio.play(sound);
      if (cutsceneSeq.done) break;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, renderer.VIEW_W, renderer.VIEW_H);
    drawBackground(ctx, state, renderer.sprites);
    if (!cutsceneSeq.done) {
      drawVictoryScene(ctx, cutsceneSeq, renderer.sprites);
      // The white receding out of the battle's ending fade.
      const white = Math.max(0, 1 - cutsceneSeq.t / 20);
      if (white > 0) {
        ctx.globalAlpha = white;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, renderer.VIEW_W, renderer.VIEW_H);
        ctx.globalAlpha = 1;
      }
    } else {
      // After the knighting: the TV SWITCHES OFF and the title comes back.
      // Both exits go the same way now — the celebration card is gone (it
      // was tool-authored text over a white fade, and the game has its own
      // way of ending a scene).
      cutsceneSeq = null;
      maskHeldInput();
      tvOff = createTvTurnoff();
    }
    requestAnimationFrame(frame);
    return;
  }

  // THE TV TURNS OFF. obj_tvturnoff_manager, then straight back to the menu
  // — no card, no prompt. Unskippable: it is 43 frames end to end, shorter
  // than the press that would skip it.
  if (tvOff) {
    const { steps: ts2, accumulator: ta2 } = drain(acc, elapsed);
    acc = ta2;
    for (let i = 0; i < ts2; i++) {
      const cues = [];
      stepTvTurnoff(tvOff, cues);
      for (const c of cues) {
        if (c.stop) audio.stopLoop(c.name);
        else audio.play([c]);
      }
      if (tvOff.done) break;
    }
    drawTvTurnoff(ctx, tvOff, renderer.sprites);
    if (tvOff.done) {
      tvOff = null;
      title.mode = null;
      title.pickingAttack = false;
      title.pickingDifficulty = false;
      maskHeldInput();
      reset();
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
      // NO CUE ON ADVANCE. The lines advance themselves now, on the writer's
      // own clock, and typer 667's sound is `snd_nosound` — this screen is
      // the drone and nothing else until you answer.
      if (r.chosen !== undefined) {
        audio.play([{ name: 'snd_select', pitch: 1, gain: 1 }]);
        audio.stopLoop('audio_drone');
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
          title.pickingDifficulty = false;
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

      // The win: the ending's white fade has filled (stepEndCutscene drives
      // it to 1 over 30 frames from endtimer 32). The story scene plays
      // first; the card follows it.
      if (!tvOff && !cutsceneSeq && (state.endFade ?? 0) >= 1) {
        maskHeldInput();
        cutsceneSeq = createVictoryScene();
      }

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
          // THE DRONE. DEVICE_FAILURE's Create, on the knight_mode branch:
          //
          //     snd_free_all();
          //     global.currentsong[0] = snd_init("AUDIO_DRONE.ogg");
          //     global.currentsong[1] = mus_loop(global.currentsong[0]);
          //
          // `snd_free_all()` first — every other sound in the game is released,
          // so the screen is a single sustained tone and nothing else. It is a
          // LOOSE file in Resources/mus, like the fight's own knight.ogg, so it
          // needed no extraction pass. The typer over it is `snd_nosound`: the
          // Knight's words arrive in silence on top of the drone.
          audio.stopLoop('mus_knight');
          if (musicOn) audio.play([{ name: 'audio_drone', pitch: 1, gain: 1, loop: true }]);
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
  // THE READOUT IS OFF UNLESS ASKED FOR. The page is the game and nothing
  // else now (letterboxed 640x480, black bars, no chrome); this line stays
  // behind `?hud=1` because a playtester filing a report still needs the
  // frame number and the key legend. Skipping the work when it is hidden
  // also keeps a per-frame string build out of the loop.
  if (!hudOn) {
    requestAnimationFrame(frame);
    return;
  }
  hud.innerHTML =
    // The Game Over SCREEN says this now, in the game own font.

    `frame ${state.frame} · sim ${fps}/30 Hz · hits ${state.counters.collisionHits}` +
    // Raw, negatives included — the charbox prints them and so does this: a
    // swooned -999 and a downed -80 are different situations and the readout
    // that flattens both to 0 is the one that hides the difference.
    ` · HP ${state.partyHp.join('/')}` +
    ` · TP ${Math.floor((state.tension / 250) * 100)}%` +
    ` · sprites ${renderer.spriteCount}` +
    ` · ${running ? '' : '[PAUSED] '}arrows/WASD move · X focus/cancel · R reset` + ` · Q music ${musicOn ? 'on' : 'OFF'} · P pause · E debug-hit 1000 · <b style="color:#e0a">B report a bug</b>`
    + (gamepad.connected() ? ' · 🎮 A confirm · B cancel/slow · start pause · select reset' : '');

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
