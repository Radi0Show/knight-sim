// Browser driver. Owns real time; sim/ never sees it (rule 1).
//
// The accumulator is sim/clock.js `drain` — the same pure helper the headless
// runner would use — so the browser and the verifier advance state through
// exactly the same code path.

import { createState, stepFrame } from '../sim/index.js';
import { drain, MS_PER_FRAME } from '../sim/clock.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { decodeReplay } from '../sim/replay.js';
import { createTitle, stepTitle, MODES, CREDITS, creditLink } from '../sim/modes.js';
import { encodeConfig, decodeConfig, NONE } from '../sim/share.js';
import { WEAPONS, ARMOR, canEquip } from '../sim/equipment.js';
import { ITEMS } from '../sim/items.js';
import { drawTitle, drawGameOver, stepGameOver, makeGameOver } from '../render/title.js';
import { loadFont, drawText } from '../render/font.js';
import { drawBackground } from '../render/background.js';
import { buildSingleAttackScene, ATTACK_MENU, menuEntry } from '../sim/scenes/single.js';
import { bindKeyboard } from '../input/keyboard.js';
import { bindTouch } from '../input/touch.js';
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
import { deltaruneMultiplier } from '../render/windowsize.js';
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
 *   SMALL  the size DELTARUNE ITSELF would open at on this display, leaving
 *          black around the edges. Not "the biggest whole multiple that
 *          fits" -- that was the old behaviour and it is a different, larger
 *          number on most screens. See deltaruneMultiplier() below.
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
  let scale = fit;
  if (scalingMode === 'pixel' && fit >= 1) {
    // The game's own answer, then clamped to what the BROWSER WINDOW can
    // actually show. A real window can be the full display; a canvas cannot,
    // because the browser's own chrome is in the way -- so without this the
    // arena would hang off the bottom on a maximised window. The clamp is a
    // deviation the browser forces, and it only ever reduces.
    const m = deltaruneMultiplier(
      window.screen?.width ?? window.innerWidth,
      window.screen?.height ?? window.innerHeight,
      renderer.VIEW_W,
      renderer.VIEW_H,
    );
    scale = Math.min(m * dpr, Math.floor(fit));
  }
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
// THE TOUCH OVERLAY — a d-pad and Z/X/R, shown only where the primary
// pointer is coarse (the CSS media query owns visibility; binding it
// everywhere costs nothing on a desktop). X carries the keyboard's
// two-jobs mapping: held is the slow modifier, tapped is cancel. R calls
// the same reset() as the key.
// A link the touch handler already opened, so the loop's own open (from the
// same latched confirm, one frame later) can be swallowed instead of opening
// the page twice.
let syncOpenedLink = null;
const touch = bindTouch({
  pad: document.getElementById('dpad'),
  buttons: [
    { el: document.getElementById('btnZ'), actions: ['confirm'] },
    { el: document.getElementById('btnX'), actions: ['focus', 'cancel'] },
    { el: document.getElementById('btnR'), actions: ['reset'] },
  ],
  onReset: () => reset(),
  // LINKS MUST OPEN INSIDE THE GESTURE. The credits page's confirm returns an
  // href that the frame loop passes to window.open — fine for a keyboard,
  // where the keydown's user-activation is still fresh when the 30Hz step
  // runs, but iOS Safari refuses a popup whose open() is not in the gesture
  // handler's own call stack. So when a TAP lands on Z while the credits page
  // has a linked row under the cursor, the open happens here, synchronously;
  // the loop's duplicate is swallowed via syncOpenedLink. Every other state
  // ignores the hook and the tap flows through the ordinary latch.
  onAction: (a) => {
    if (a !== 'confirm' || title.mode !== null) return;
    const s = title.settings;
    if (!s || s.page !== 'credits') return;
    const href = creditLink(CREDITS[s.cursor] ?? {});
    if (!href) return;
    window.open(href, '_blank', 'noopener,noreferrer');
    syncOpenedLink = href;
  },
});
// One reader, three sources: the sim sees the OR of keyboard, controller and
// touch, so all work at once and none can mask another.
const keys = {
  read() {
    const k = keyboard.read();
    const g = gamepad.read();
    const t = touch.read();
    for (const a of Object.keys(g)) if (g[a]) k[a] = true;
    for (const a of Object.keys(t)) if (t[a]) k[a] = true;
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
  if (Array.isArray(saved?.bag)) {
    // Length-checked and id-checked on the way in: a stale entry from before
    // an item was renumbered must not put an unknown id in a slot, and the
    // page has no way to show one.
    const bag = saved.bag.map((v) => v | 0).slice(0, 12);
    while (bag.length < 12) bag.push(0);
    title.bag = bag;
  }
  // A SAVED VOLUME ONLY WINS IF IT WAS A CHOICE.
  //
  // `persistSettings()` runs once at load, so every entry written before the
  // default dropped to 50 holds `100` whether or not anyone touched a slider
  // — the old default, saved automatically. Honouring those would have meant
  // the new default reached nobody who had ever opened the page. `v` marks
  // entries written since, and only those carry their volumes forward;
  // everything else in a pre-`v` entry (gear, bag, shake, scaling) is still
  // read, because those only ever change by hand.
  if (saved?.volumes && (saved.v | 0) >= 1) {
    title.volumes.music = Math.max(0, Math.min(100, saved.volumes.music | 0));
    title.volumes.sfx = Math.max(0, Math.min(100, saved.volumes.sfx | 0));
  }
  if (typeof saved?.shake === 'boolean') title.shake = saved.shake;
  if (saved?.scaling === 'fit' || saved?.scaling === 'pixel') title.scaling = saved.scaling;
} catch { /* a corrupt entry falls back to the defaults */ }

// ?cfg=<token> — A SHARED SETUP, and it WINS over the saved settings.
//
// Following someone's link is an explicit act: it should show you their fight,
// not yours with their name on it. That is why this is applied after the load
// above. It does NOT touch volume, shake or scaling — those are how a person
// sits in front of a screen, and a link that silently reset them would be a
// bad trade for a share button. See sim/share.js.
//
// Everything in the token is validated against the real tables before it is
// used: `canEquip` is the game's own char-flag rule, so a link cannot put
// Susie's axe on Ralsei any more than the equip menu can, and an unknown item
// id becomes an empty slot rather than reaching a renderer that cannot draw it.
const sharedCfg = decodeConfig(params.get('cfg'), {
  weaponOk: (id, c) => id === 0 || (!!WEAPONS[id] && canEquip('weapon', id, c)),
  armorOk: (id, c) => id === 0 || (!!ARMOR[id] && canEquip('armor', id, c)),
  itemOk: (id) => !!ITEMS[id],
  modeCount: MODES.length,
  attackCount: ATTACK_MENU.length,
});
if (sharedCfg) {
  if (sharedCfg.gear) title.gear = sharedCfg.gear;
  if (sharedCfg.bag) title.bag = sharedCfg.bag;
  if (sharedCfg.attack !== null) {
    title.attackIndex = sharedCfg.attack;
    attackId = ATTACK_MENU[sharedCfg.attack].id;
  }
  if (sharedCfg.difficulty !== null) {
    const entry = ATTACK_MENU[title.attackIndex];
    // The token carries the INDEX the picker shows; the launch needs the
    // selector's raw value behind it (0/3/4 for the tunnel), and a link from
    // an older roster can point past the end of a shorter list.
    const di = Math.min(sharedCfg.difficulty, entry.difficulties.length - 1);
    title.difficultyIndex = Math.max(0, di);
    difficulty = entry.difficulties[title.difficultyIndex] ?? 0;
  }
  // A pinned MODE skips the title, the same way `?mode=` does — the sharer
  // chose the fight, so the link opens it rather than a menu.
  if (sharedCfg.mode !== null) {
    title.mode = MODES[sharedCfg.mode].id;
    mode = title.mode === 'single' ? 'practice' : 'fight';
  }
}

let state = createState({
  seed: replay ? replay.meta.seed : Number(params.get('seed') ?? 12345),
  traceBulletSlots: 0,
  // THE SAVED BAG APPLIES HERE TOO. A `?mode=` deep link never reaches
  // `startRun` — it runs on THIS state — so with the title built after it,
  // a link ran the default loadout however the ITEMS page was set. The title
  // and its persistence load moved above this for that reason; they depend on
  // nothing here, while this depends on them.
  bag: title.bag,
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
let acc = 0;
let last = performance.now();

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
  state = createState({
    seed: (Math.floor(performance.now()) % 100000) + 1,
    traceBulletSlots: 0,
    // THE BAG COMES FROM SETTINGS TOO, the same way the gear does. It has to
    // be passed to createState rather than assigned after, because the battle
    // menu snapshots `state.inventory` into its per-character tempitem lists
    // as soon as the scene is built.
    bag: title.bag,
  });
  state.runMode = runMode;
  state.vistaFsBase = vistaFs;
  // THE LOADOUT COMES FROM SETTINGS. The title's equip menu edits title.gear;
  // every fresh fight is built with a copy of it (sim/damage.js gearOf).
  state.loadout.gear = title.gear.map((g) => ({ weapon: g.weapon, armor: [...g.armor] }));
  // …and so does the shake switch. A fresh state starts with flag 12 clear, so
  // without this an R-restart silently turned the camera shake back on.
  state.flag12 = title.shake ? 0 : 1;
  state.spriteFrames = renderer.spriteFrames;
state.spriteRate = renderer.spriteRate;
  build(state);
  acc = 0;
}

// R RESTARTS, and it is the only key the page binds beyond movement.
//
// The debug affordances that used to live here — P pause, Q music, B copy a
// replay token, E deal 1000 to the Knight — are gone, along with the `?hud=1`
// readout, the `?pause=1` freeze and the window.__sim / __intro / __cutscene
// inspection handles. They were for building the thing, not for playing it,
// and a practice tool should not offer the player a key that skips the fight.
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') reset();
});

/** Push the settings at the things that consume them. No storage. */
function applySettings() {
  audio.setVolumes(title.volumes.music / 100, title.volumes.sfx / 100);
  // `global.flag[12]` in the sim's terms: SET means "do not move the view".
  state.flag12 = title.shake ? 0 : 1;
  if (scalingMode !== title.scaling) {
    scalingMode = title.scaling;
    fitCanvas();
  }
}

function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      v: 1, // see the load above: pre-`v` entries hold the old 100 default
      gear: title.gear, bag: title.bag, volumes: title.volumes,
      shake: title.shake, scaling: title.scaling,
    }));
  } catch { /* private mode etc. — the session still works, unsaved */ }
  applySettings();
}

// FOLLOWING A LINK MUST NOT OVERWRITE YOUR OWN SETUP.
//
// This used to be an unconditional `persistSettings()`, which writes
// `title.gear` and `title.bag` — and the shared config has already replaced
// both by this point. So opening someone's "beat my settings" link silently
// destroyed the loadout the visitor had built, permanently, before they had
// pressed anything. Caught by loading a link with a distinctive local bag set
// and watching the saved entry become the sharer's.
//
// A link now APPLIES without saving. Changing something afterwards still
// persists, which is right: adopting a setup you were shown is a deliberate
// act, arriving at it is not.
if (sharedCfg) applySettings(); else persistSettings();
if (replay || params.get('mode')) title.mode = mode === 'practice' ? 'single' : 'normal';

/**
 * The current setup as a URL. Gear, bag, mode, attack and difficulty — the
 * things that make a run hard — and nothing about how the player's screen or
 * speakers are set.
 *
 * The MODE is only pinned once one has been chosen. Sharing from the settings
 * hub, before you have picked, produces a link that carries the loadout and
 * opens on the title, which is the honest thing: you configured a party, not
 * a fight.
 */
function shareUrl() {
  const modeIndex = title.mode ? MODES.findIndex((m) => m.id === title.mode) : NONE;
  const cfg = encodeConfig({
    mode: modeIndex < 0 ? NONE : modeIndex,
    attack: title.attackIndex,
    difficulty: title.difficultyIndex,
    gear: title.gear,
    bag: title.bag,
  });
  const url = new URL(location.href);
  // A share link is the setup and nothing else — `?frames=`, `?seed=` and a
  // `?replay=` token are all debugging state from whatever the sharer happened
  // to have open, and carrying them would hand someone a fast-forwarded or
  // pre-played run instead of a fight.
  url.search = '';
  url.searchParams.set('cfg', cfg);
  return url.toString();
}

/**
 * Copy it. `navigator.clipboard` needs a secure context and a user gesture —
 * a keypress is one — and is missing on plain http, so the textarea fallback
 * is not optional politeness: the dev server runs on http://localhost and
 * would have no working share button without it.
 */
function shareSetup() {
  const url = shareUrl();
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = url;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { /* nothing else to try */ }
    ta.remove();
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).catch(fallback);
  } else {
    fallback();
  }
}

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
  lastFrameRun = now;
  const elapsed = now - last;
  last = now;

  // Select resets, mirroring R. Start no longer pauses — the pause went with
  // the rest of the debug keys. Polled here because the Gamepad API has no
  // events.
  {
    const pe = gamepad.driverEdges();
    if (pe.reset) reset();
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
      // A CREDITS row with a link. `sim/` returns the href and the DRIVER
      // opens it — the architecture rule is that sim/ has no DOM, and a
      // `window.open` inside it would also break every headless verifier.
      // `noopener` because the tool has no reason to hand a third-party page
      // a handle back to this one.
      if (r.link) {
        // Swallow the copy the touch handler already opened in-gesture.
        if (r.link === syncOpenedLink) syncOpenedLink = null;
        else window.open(r.link, '_blank', 'noopener,noreferrer');
      }
      // SHARE SETUP — build the link and put it on the clipboard.
      if (r.share) shareSetup();
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
      // THE WIND. The ending's ambience is a real track and it is now in the
      // pack: obj_ch3_PTB02 does
      //
      //     c_mus2("initloop", "wind_highplace.ogg", 0);
      //     c_mus2("pitch", 0.5, 0);
      //     c_mus2("volume", 0, 0); c_mus2("volume", 1, 60);
      //
      // a LOOP at HALF PITCH under the whole cutscene. It used to be a
      // labelled no-op because the file was thought unextracted; it is a
      // loose .ogg in Resources/mus, like knight.ogg and AUDIO_DRONE, so it
      // needed no extraction pass at all. The 60-frame volume ramp is not
      // reproduced — the driver has no fade — so it comes in at full gain;
      // that is the one approximation here and it is deliberate.
      for (const c of cues) {
        if (!c.music) continue;
        if (c.music === 'wind') {
          audio.play([{ name: 'wind_highplace', pitch: 0.5, gain: 1, loop: true }]);
        } else if (c.music === 'stop') {
          audio.stopLoop('wind_highplace');
        }
      }
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

  {
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
      const hpBefore = state.partyHp[0] + state.partyHp[1] + state.partyHp[2];
      const caughtBefore = state.soul?.alive && state.soul.image_alpha === 0;
      stepFrame(state, input);
      audio.play(drainCues(state));

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
      //
      // A HIT IS DAMAGE, NOT A place_meeting POSITIVE. This used to watch
      // `counters.collisionHits`, which counts every registered overlap —
      // including a class that deals nothing: a tooth's ACTIVE gate lives
      // inside its contact handler, so a just-spawned, unarmed tooth
      // overlapping the soul on the cut line increments the counter and does
      // no damage at all. Measured on a wandering Flurry run: 86 of 188
      // counted collisions were consequence-free. Reported from play as
      // grazing the red slashes restarting the fight, and as "restarting at
      // random during the box split" — teeth spawn exactly where the cut is.
      //
      // The game's own judgement of a no-hit run is damage taken, so the
      // trigger is the party's HP dropping — plus the splitslash CATCH
      // (image_alpha 0, the cut carrying the soul), which is a hit whose
      // damage lands ~35 frames later and must restart NOW, not after the
      // animation.
      const hpNow = state.partyHp[0] + state.partyHp[1] + state.partyHp[2];
      const caughtNow = state.soul?.alive && state.soul.image_alpha === 0;
      if (runMode === 'hitless' && (hpNow < hpBefore || (caughtNow && !caughtBefore))) {
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
          audio.play([{ name: 'audio_drone', pitch: 1, gain: 1, loop: true }]);
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
  requestAnimationFrame(frame);
}

// THE LOOP, plus a WATCHDOG for browsers that starve requestAnimationFrame.
// Opera GX shipped exactly that: a black screen where each keypress painted
// one frame — rAF never fired, and the only draws were the event-path ones
// (Bad Time Simulator reportedly has the same failure there). If the page is
// VISIBLE and no frame has run for 500ms, the watchdog drives frame() itself
// with a wall-clock timestamp. drain() meters sim steps by elapsed real time,
// so if rAF later revives and the two overlap briefly, the sim does not
// double-step — the accumulator absorbs it.
let lastFrameRun = performance.now();
requestAnimationFrame(frame);
// A probe rAF, separate from the game loop, is the liveness signal; the
// fallback is a 33ms interval driving frame() at full rate. It ARMS when the
// probe has been silent half a second with the page visible, and DISARMS the
// moment real rAF ticks return, so a browser that merely throttled catches
// back up without ever running both for long.
let rafTick = performance.now();
const rafProbe = () => { rafTick = performance.now(); requestAnimationFrame(rafProbe); };
requestAnimationFrame(rafProbe);
let fallback = null;
setInterval(() => {
  const stale = performance.now() - rafTick > 500;
  const visible = document.visibilityState === 'visible';
  if (stale && visible && !fallback) {
    fallback = setInterval(() => frame(performance.now()), 33);
  } else if (!stale && fallback) {
    clearInterval(fallback);
    fallback = null;
  }
}, 250);

// THE APP SHELL. The service worker is what turns add-to-home-screen into a
// standalone app (and keeps the fight loadable offline). Registration failing
// — file://, an old browser, private mode — costs nothing: the page is fully
// functional without it.
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  // Module-relative, not document-relative — the same rule as the asset
  // loaders (4911a09): the hub hosts this driver from a page one level up,
  // where './sw.js' resolves to a URL that does not exist. The worker's
  // scope stays web/ either way; that is where the installable app lives.
  navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(() => {});
}
