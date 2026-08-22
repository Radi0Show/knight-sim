// THE ENDING — the fight's true win cutscene. Driver-side like the intro:
// zero sim contact, byte-identical suites and tokens with or without it.
//
// WHICH BRANCH THIS IS, because the wrong one shipped once: ending the fight
// on a hit sets flag[51] = 1 in the battle teardown; obj_knight_enemy's
// Other_13 tallies that as "violenced" and writes flag[50] = 1; PTB02's con 8
// reads `defeated = global.flag[50] == 1` — the flag describes what happened
// to the KNIGHT, not the party — and routes con 49 -> 50: THIS scene. The
// previously ported con 10-12 chain (the beam grab, Undyne, the bird) is a
// different aftermath and is gone from the flow.
//
// SOURCES:
//   obj_ch3_PTB02 Step con 8 (staging) + con 50 script (lines 814-1004)
//   roaring_knight_warp block (1006-1060)     — the static destabilise
//   susie_knight_slash block (1222-1406)      — the clash, parry, shard
//   big_shake (1204) / swoon_display (Create) — impact + the SWOON writer
//   obj_ch3_PTB02_roaringknight states 2/3    — the static warp machine
//   show_clash_overlay (Create)               — the white impact flash
//   numeric ids resolved: rsprite 686 = spr_susier_dark, 359 =
//   spr_ralsei_walk_right_unhappy, loopsfx 169 = snd_suslaugh
//
// THE SCENE, in order (frame counts are the script's):
//   the battle's white recedes /60; a long still; the Knight's hover FREEZES
//   THE WARP: static bursts at timer 1/31/56/69/82 (spr_roaring_knight_
//   static, position jolts choose(±10, ±20), snd_tv_static), settling at 95
//   into state 3 — continuous distortion, shake ±2
//   Susie's disbelief line; the camera pans and she WALKS TOWARD IT
//   (spr_susier_dark), taunting
//   THE CLASH: snd_jump, she leaps (vspeed -14, gravity 2, hspeed 0->20/5);
//   at 10 the Knight catches her mid-swing (spr_roaring_knight_susie_clash,
//   the locked struggle) under a stack of impact sounds; grinding hits at
//   shrinking intervals (80, 70, 60, 50, 40 — each a screenshake, a
//   spr_fx_hitback pair, metal on metal, a half-white flash, afterimages);
//   at 300 the PARRY throws her off (knight hspeed 8, friction 2); at 320
//   she leaps back (snd_laz_c, snd_glassbreak, snd_sparkle_glock) and THE
//   SHARD tumbles off the Black Knife (spr_roaringknight_sword_break_
//   piece_small: vspeed -8, hspeed -7, gravity 2, spinning 1280deg/20f,
//   freezing at 16f where it stays, marked by spr_shine_white)
//   the Knight recovers (ball_transition_sword 8->5/8f, then ball_fly);
//   Susie laughs (spr_susie_laugh_dw @0.25, snd_suslaugh), taunts, laughs
//   again — CUT OFF: five snd_knight_cut2 at pitches .06/.1/.12/.18/.24,
//   the screen SNAPS BLACK with one white streak across it (whiteall
//   blend-black + spr_roaringknight_slash_white_horizontal at (2420,182)),
//   the Knight gone off-frame; the reveal: Susie fallen (spr_susie_dw_fell
//   at 2410, sliding back to 2310/40f "in"), big_shake (six sounds +
//   obj_shake 10/2), the SWOON writer over her (dmgwriter type 12)
//   Ralsei: his cry (unskippable in the original), a step closer, his
//   grief line — then his slash: the same five cuts, black, the streak at
//   (2408,240), spr_ralsei_defeat at 2328, big_shake, slide to 2280, SWOON
//   Kris alone for 180 frames; black; THE KNIGHTING — spr_roaring_knight_
//   kris_knighting at (2326,44) frame 1, Kris hidden (he kneels IN the
//   art); 90 frames black; revealed; then image 1 -> 4 over 90 frames
//   easing "in" — the blade lowering onto the shoulder; black; Kris
//   revealed in spr_krisb_defeat, the Knight restored to 2655 with his
//   sword, hovering; the last reveal, a beat, and out.
//
// AFTER IT: THE MAIN MENU (sc.toMenu — player-directed; the game itself
// rolls into free roam and the later beam scene, out of this tool's scope).
//
// LABELLED APPROXIMATIONS: dialogue is the chatbox (no balloons, faces or
// portrait art); c_talk_wait is a fresh-confirm gate; the wind track
// (wind_highplace.ogg at pitch 0.5) is cued and now PLAYS — the file is a
// loose .ogg in Resources/mus and is in the audio pack. Formerly gated on the local
// audio pack carries it; camera pans use inout easing (c_pan's curve is the
// cutscene master's default, not re-derived). X skips the whole scene.

const CAM_X = 2230;

export const VICTORY_LINES = [
  { speaker: 'susie', text: '* We.. we actually beat it?' },
  { speaker: 'susie', text: "* What, don't tell me you've had ENOUGH already?" },
  { speaker: 'susie', text: "* C'mon, we were just getting started!" },
  { speaker: 'susie', text: '* Heheh...' },
  { speaker: 'susie', text: '* Not so tough NOW, are you!?' },
  { speaker: 'ralsei', text: '* S-Susie!!!' },
  { speaker: 'ralsei', text: '* H.. how could you...' },
];

function actor(x, y, sprite) {
  return {
    x, y, sprite, index: 0, speed: 0, visible: true, flip: false,
    hspeed: 0, vspeed: 0, gravity: 0, friction: 0,
    lerp: null, // { field, from, to, t, dur, curve }
  };
}

export function createVictoryScene() {
  return {
    t: 0,
    done: false,
    toMenu: false, // the driver reads this: main menu, not a card
    camX: CAM_X,
    camLerp: null,
    bg: { fountain_speed: 0.2 }, // the vista's animated fountain frames
    // The whiteall marker: the battle's white fill, later the BLACK cuts.
    white: { alpha: 1, black: false, visible: true, fade: 0 },
    slash: { x: 0, y: 0, visible: false },
    actors: {
      kris: actor(2356, 104, 'spr_krisr_dark'),
      susie: actor(2310, 142, 'spr_susie_walk_right_dw_unhappy'),
      ralsei: actor(2288, 190, 'spr_ralsei_walk_right_unhappy'),
    },
    knight: {
      x: 2655, ystart: 78, y: 78, siner2: 0,
      sprite: 'spr_roaringknight_idle_overworld_sword', index: 0, speed: 0.1,
      visible: true, hoverPause: false, frozen: false, // reach_interrupt
      shake: 0, jolt: [0, 0],
      hspeed: 0, friction: 0,
      lerpIndex: null, // { from, to, t, dur, curve }
    },
    warp: null, // { timer, cache: [x, y] }
    knightStatic: false, // state 3 — continuous distortion
    clash: null, // { timer, shakeSeq, shakeTimer, shakeTime }
    hitFx: [], // spr_fx_hitback { x, y, born, life, alpha }
    flash: null, // show_clash_overlay { t, peak } — 8 up, 8 down
    shard: null, // { x, y, hspeed, vspeed, gravity, angle, born, shine }
    swoons: [], // { x, y, born } — dmgwriter type 12
    bigShake: 0, // frames left of the impact shake
    dialogue: null, // { line, timer }
    lastConfirm: true, // edge detector (starts held: the ending's last press)
    script: buildScript(),
    scriptIndex: 0,
    wait: 0,
    deferred: [],
    rng: 12345, // frame-hashed choose() jolts — cosmetic
  };
}

function srand(sc) {
  sc.rng = (Math.imul(sc.rng, 1664525) + 1013904223) >>> 0;
  return sc.rng / 4294967296;
}
const choosePM = (sc) => [-20, -10, 10, 20][Math.floor(srand(sc) * 4)];

const ease = {
  linear: (t) => t,
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inout: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
};

// The con-50 script as [op, ...] steps. `w` waits; `say` gates on a fresh
// confirm; everything else is instantaneous state.
function buildScript() {
  return [
    ['w', 60],
    ['whiteFadeOut', 60], ['music', 'wind'],
    ['w', 120],
    ['knightFreeze'],
    ['w', 15], ['music', 'stop'],
    ['warpStart'],
    ['w', 125], // c_wait(30) + the warp settles at its own 95
    ['w', 90],
    ['say', 0],
    ['pan', 2400, 30],
    ['susieWalk', 2510, 30],
    ['say', 1], ['say', 2],
    ['w', 30],
    ['clashStart'],
    ['waitClash'],
    ['pan', CAM_X, 60],
    ['w', 40],
    ['knightRecover'],
    ['w', 145],
    ['susieIdle'],
    ['say', 3],
    ['susieLaugh'],
    ['w', 60],
    ['say', 4],
    ['laughAgain'],
    ['w', 26],
    ['slashCut', 'susie'],
    ['w', 55],
    ['susieSlide'],
    ['w', 25], ['music', 'wind'],
    ['reveal', 'susie'],
    ['w', 60],
    ['say', 5],
    ['ralseiApproach'],
    ['w', 60],
    ['say', 6],
    ['music', 'stop'],
    ['slashCut', 'ralsei'],
    ['w', 90], ['music', 'wind'],
    ['reveal', 'ralsei'],
    ['w', 180],
    ['music', 'stop'],
    ['black'],
    ['knighting'],
    ['w', 90],
    ['unblack'], ['music', 'wind'],
    ['w', 30],
    ['knightingLower', 90],
    ['w', 120],
    ['music', 'stop'], ['black'],
    ['krisDown'],
    ['w', 120],
    ['unblack'],
    ['w', 120],
    ['end'],
  ];
}

function pushHitFx(sc, kx, ky, life, alpha) {
  sc.hitFx.push({ x: kx - 90, y: ky - 90, born: sc.t, life, alpha });
}

function fiveCuts(cues) {
  for (const p of [0.06, 0.1, 0.12, 0.18, 0.24]) {
    cues.push({ name: 'snd_knight_cut2', pitch: p, gain: 1 });
  }
}

/**
 * `obj_shake` with `shakex = 10, shakespeed = 2, shakesign = 2` — the camera
 * shake PTB02 fires at each swoon reveal. Modelled properly rather than as a
 * frame counter, because all three of its characteristics were wrong:
 *
 *     Step (active == 0):  view = camera + shakex;  shakesign = -shakesign
 *     Alarm 0 (every shakespeed frames):
 *         view = camera + shakex * shakesign
 *         if (shakex > 0) shakex -= 1
 *         shakesign = -shakesign
 *         if (shakex == 0) instance_destroy()
 *
 * so it is HORIZONTAL ONLY (`shakey` is never assigned, so the vertical term
 * is always 0), it DECAYS from 10 to 0, and it steps every TWO frames rather
 * than re-rolling per frame. `shakesign` is 2, not 1 — a multiplier — so the
 * swings after the first reach +/-20 before decaying.
 *
 * This was a random jitter of constant amplitude on BOTH axes, re-rolled
 * every frame for 20 frames: harsher, longer and noisier than the real one.
 */
function bigShake(sc, cues) {
  sc.shake = { x: 10, sign: -2, speed: 2, timer: 0, offset: 10 };
  sc.bigShake = 20;
  cues.push({ name: 'snd_impact', pitch: 1, gain: 1 });
  cues.push({ name: 'snd_closet_impact', pitch: 1, gain: 1 });
  cues.push({ name: 'snd_closet_impact', pitch: 0.5, gain: 1 });
  cues.push({ name: 'snd_bageldefeat', pitch: 0.8, gain: 0.8 });
  cues.push({ name: 'snd_damage', pitch: 1, gain: 1 });
  cues.push({ name: 'snd_glassbreak', pitch: 0.4, gain: 0.8 });
  cues.push({ name: 'snd_glassbreak', pitch: 0.3, gain: 0.6 });
}

function setTimeoutStep(sc, frames, fn) {
  sc.deferred.push({ at: sc.t + frames, fn });
}

/** One 30Hz tick. Cues use the sim's {name, pitch, gain} shape; the music
 * ops emit {music: 'wind' | 'stop'} for the driver. */
export function stepVictoryScene(sc, input, cues) {
  if (sc.done) return;
  sc.t += 1;
  const A = sc.actors;
  const k = sc.knight;
  const confirmPressed = input.confirm && !sc.lastConfirm;
  sc.lastConfirm = !!input.confirm;

  // ---- continuous systems -------------------------------------------------
  if (!k.frozen && !k.hoverPause) {
    k.siner2 += 1;
    k.y = k.ystart + Math.cos(k.siner2 / 8) * 8;
  }
  if (k.speed) k.index += k.speed;
  if (k.lerpIndex) {
    const L = k.lerpIndex;
    L.t += 1;
    k.index = L.from + (L.to - L.from) * ease[L.curve](Math.min(1, L.t / L.dur));
    if (L.t >= L.dur) k.lerpIndex = null;
  }
  if (k.hspeed) {
    k.x += k.hspeed;
    k.hspeed = Math.max(0, k.hspeed - k.friction);
  }
  for (const key of Object.keys(A)) {
    const a = A[key];
    if (a.speed) a.index += a.speed;
    if (a.hspeed || a.vspeed) {
      a.x += a.hspeed;
      a.y += a.vspeed;
      a.vspeed += a.gravity;
      if (a.friction) {
        const s = Math.sign(a.hspeed);
        a.hspeed -= s * Math.min(Math.abs(a.hspeed), a.friction);
      }
    }
    if (a.lerp) {
      const L = a.lerp;
      L.t += 1;
      a[L.field] = L.from + (L.to - L.from) * ease[L.curve](Math.min(1, L.t / L.dur));
      if (L.t >= L.dur) a.lerp = null;
    }
    if (a.landing && a.y >= 142) {
      a.y = 142;
      a.vspeed = 0;
      a.gravity = 0;
      a.landing = false;
    }
  }
  if (sc.camLerp) {
    const L = sc.camLerp;
    L.t += 1;
    sc.camX = L.from + (L.to - L.from) * ease.inout(Math.min(1, L.t / L.dur));
    if (L.t >= L.dur) sc.camLerp = null;
  }
  if (sc.white.fade) {
    sc.white.alpha = Math.max(0, sc.white.alpha - 1 / sc.white.fade);
    if (sc.white.alpha === 0) { sc.white.fade = 0; sc.white.visible = false; }
  }
  if (sc.flash) {
    sc.flash.t += 1;
    if (sc.flash.t > 18) sc.flash = null;
  }
  if (sc.bigShake > 0) sc.bigShake -= 1;
  // obj_shake's alarm chain (see bigShake).
  if (sc.shake) {
    const sh = sc.shake;
    sh.timer += 1;
    if (sh.timer >= sh.speed) {
      sh.timer = 0;
      sh.offset = sh.x * sh.sign;
      if (sh.x > 0) sh.x -= 1;
      sh.sign = -sh.sign;
      if (sh.x === 0) sc.shake = null;
    }
  }
  sc.bg.fountain_speed += 0.1;
  sc.hitFx = sc.hitFx.filter((f) => sc.t - f.born < f.life);
  sc.deferred = sc.deferred.filter((d) => {
    if (sc.t >= d.at) { d.fn(); return false; }
    return true;
  });

  // The warp — the destabilise's fixed schedule (roaring_knight_warp), each
  // burst running the actor's state-2 machine: the warp sheet's frames are
  // horizontal SHREDS of the silhouette, so a burst must ANIMATE 5 -> 6 ->
  // 7 -> 8 then flicker choose(6,7,8) before settling back to frame 0 —
  // holding one shred draws a lone floating fragment (reported from play).
  if (sc.warp) {
    const w = sc.warp;
    w.timer += 1;
    if (w.timer === 1) {
      k.hoverPause = true;
      w.cache = [k.x, k.y];
      k.speed = 0;
      w.burstT = 0; // the first burst starts immediately (state 2)
      cues.push({ name: 'snd_tv_static', pitch: 1, gain: 1 });
    }
    if (w.timer === 31 || w.timer === 56 || w.timer === 69 || w.timer === 82) {
      // warp_start: one frame of spr_roaring_knight_static, a position jolt,
      // then state 2 again.
      k.sprite = 'spr_roaring_knight_static';
      k.index = Math.floor(srand(sc) * 3);
      k.x += choosePM(sc);
      k.y += choosePM(sc);
      w.burstT = -1; // the static flash frame; the burst machine starts next
      cues.push({ name: 'snd_tv_static', pitch: 0.5 + srand(sc), gain: 1 });
    }
    if (w.burstT !== undefined && w.burstT !== null) {
      w.burstT += 1;
      if (w.burstT >= 1) {
        // state 2's static_timer: 1..4 step frames 5..8, 5+ flicker, 10
        // settles, 12 back to rest frame 0.
        const st = w.burstT;
        k.sprite = 'spr_roaring_knight_overworld_warp';
        k.shake = 4;
        if (st === 1) k.index = 5;
        else if (st === 2) k.index = 6;
        else if (st === 3) k.index = 7;
        else if (st === 4) k.index = 8;
        else if (st < 10) k.index = 6 + Math.floor(srand(sc) * 3);
        else if (st === 10) k.index = 6;
        else if (st === 11) k.index = 5;
        else {
          k.index = 0;
          k.shake = 0;
          w.burstT = null;
        }
      }
    }
    if (w.timer === 95) {
      k.x = w.cache[0];
      k.y = w.cache[1];
      k.sprite = 'spr_roaring_knight_overworld_warp';
      k.index = 5;
      k.shake = 2;
      sc.knightStatic = true; // state 3
      sc.warp = null;
    }
  }
  if (sc.knightStatic && sc.t % 2 === 0) {
    // state 3: image 5 + floor(random(3) + 2.8) — frames 7..10 of the warp
    // sheet — shake choose(-2..2).
    k.index = 5 + Math.floor(srand(sc) * 3 + 2.8);
    k.jolt = [Math.floor(srand(sc) * 5) - 2, Math.floor(srand(sc) * 5) - 2];
  }

  // The clash (susie_knight_slash).
  if (sc.clash) {
    const c = sc.clash;
    const su = A.susie;
    c.timer += 1;
    if (c.timer === 1) {
      cues.push({ name: 'snd_jump', pitch: 1, gain: 1 });
      su.sprite = 'spr_susie_clash_jump';
      su.index = 1;
      su.speed = 0;
      su.vspeed = -14;
      su.gravity = 2;
      su.lerp = { field: 'hspeed', from: 0, to: 20, t: 0, dur: 5, curve: 'linear' };
      sc.flash = { t: 0, peak: 1 };
    }
    if (c.timer === 10) {
      c.shakeSeq = true;
      sc.bigShake = Math.max(sc.bigShake, 10);
      cues.push({ name: 'snd_laz_c', pitch: 0.7, gain: 1 });
      cues.push({ name: 'snd_heavyswing', pitch: 1, gain: 1 });
      cues.push({ name: 'snd_closet_impact', pitch: 0.9, gain: 1 });
      cues.push({ name: 'snd_impact', pitch: 0.7, gain: 1 });
      su.visible = false;
      su.lerp = null;
      su.hspeed = 0; su.vspeed = 0; su.gravity = 0;
      su.x = k.x - 30;
      su.y = k.y - 40;
      sc.knightStatic = false;
      k.jolt = [0, 0];
      k.sprite = 'spr_roaring_knight_susie_clash';
      k.index = 0;
      k.speed = 0.4;
      k.shake = 2;
    }
    if (c.shakeSeq) {
      c.shakeTimer += 1;
      if (c.shakeTimer % c.shakeTime === 1) {
        c.shakeTime -= 10;
        if (c.shakeTime <= 30) c.shakeSeq = false;
        sc.bigShake = Math.max(sc.bigShake, 10);
        pushHitFx(sc, k.x, k.y, 16, 1);
        pushHitFx(sc, k.x, k.y, 24, 0.5);
        cues.push({ name: 'snd_damage', pitch: 1, gain: 1 });
        cues.push({ name: 'snd_metal_hit_strong', pitch: 0.8, gain: 0.5 });
        cues.push({ name: 'snd_closet_impact', pitch: 0.9, gain: 1 });
        cues.push({ name: 'snd_impact', pitch: 0.7, gain: 1 });
        sc.flash = { t: 0, peak: 0.5 };
      }
    } else {
      if (c.timer === 300) {
        pushHitFx(sc, k.x, k.y, 12, 1);
        cues.push({ name: 'snd_damage', pitch: 1, gain: 1 });
        sc.flash = { t: 0, peak: 0.5 };
        k.hspeed = 8;
        k.friction = 2;
        k.shake = 0;
        k.index = 2;
        k.speed = 0;
      }
      if (c.timer === 320) {
        cues.push({ name: 'snd_laz_c', pitch: 0.9, gain: 1 });
        cues.push({ name: 'snd_glassbreak', pitch: 1, gain: 1 });
        cues.push({ name: 'snd_sparkle_glock', pitch: 1, gain: 1 });
        su.visible = true;
        su.sprite = 'spr_susie_clash_jump';
        su.index = 0;
        su.vspeed = -4;
        su.gravity = 2;
        su.hspeed = -14;
        k.sprite = 'spr_roaring_knight_clash_pull_back';
        k.index = 0;
        k.speed = 0;
        setTimeoutStep(sc, 4, () => { k.index = 1; });
        // THE SHARD, off the Black Knife.
        sc.shard = {
          x: k.x, y: k.y, hspeed: -7, vspeed: -8, gravity: 2,
          angle: 0, born: sc.t, shine: false,
        };
      }
      if (c.timer === 330) {
        su.sprite = 'spr_susieb_idle_serious';
        su.index = 0;
        su.speed = 0;
        // She keeps falling until her row — the script's literal numbers
        // freeze her ~50px above the ground (the room floors its actors
        // elsewhere); landing at y 142 is what the scene shows. LABELLED.
        su.friction = 2;
        su.landing = true;
      }
      if (c.timer === 340) {
        sc.clash = null;
        if (sc.shard) sc.shard.shine = true;
      }
    }
  }
  if (sc.shard) {
    const s = sc.shard;
    if (sc.t - s.born <= 16) {
      s.x += s.hspeed;
      s.y += s.vspeed;
      s.vspeed += s.gravity;
      s.angle += 64; // 1280 degrees over 20 frames
    }
  }

  // ---- dialogue gate ------------------------------------------------------
  if (sc.dialogue) {
    const d = sc.dialogue;
    d.timer += 1;
    const line = VICTORY_LINES[d.line];
    const typed = d.timer >= line.text.length; // rate 1
    if (typed && confirmPressed) sc.dialogue = null;
    else return; // the script clock pauses on the gate
  }

  // ---- the script ---------------------------------------------------------
  if (sc.wait > 0) {
    sc.wait -= 1;
    if (sc.wait > 0) return;
  }
  while (sc.scriptIndex < sc.script.length) {
    const [op, a, b] = sc.script[sc.scriptIndex];
    if (op === 'w') { sc.scriptIndex += 1; sc.wait = a; break; }
    if (op === 'say') {
      sc.scriptIndex += 1;
      sc.dialogue = { line: a, timer: 0 };
      break;
    }
    if (op === 'waitClash') {
      if (sc.clash) break; // re-checked next frame
      sc.scriptIndex += 1;
      continue;
    }
    sc.scriptIndex += 1;
    switch (op) {
      case 'whiteFadeOut': sc.white.fade = a; break;
      case 'music': cues.push({ music: a }); break;
      case 'knightFreeze': k.frozen = true; break;
      case 'warpStart': sc.warp = { timer: 0, cache: null }; break;
      case 'pan': sc.camLerp = { from: sc.camX, to: a, t: 0, dur: b }; break;
      case 'susieWalk': {
        const su = A.susie;
        su.sprite = 'spr_susier_dark'; // rsprite 686
        su.index = 0;
        su.speed = 0.25;
        su.lerp = { field: 'x', from: su.x, to: a, t: 0, dur: b, curve: 'linear' };
        // The walk anim STOPS on arrival (c_autowalk halts the cycle) —
        // without this she treadmills in place until the clash.
        setTimeoutStep(sc, b + 1, () => { su.speed = 0; su.index = 0; });
        break;
      }
      case 'clashStart':
        sc.clash = { timer: 0, shakeSeq: false, shakeTimer: 0, shakeTime: 80 };
        break;
      case 'knightRecover':
        sc.knightStatic = false;
        k.jolt = [0, 0];
        k.shake = 0;
        k.sprite = 'spr_roaringknight_ball_transition_sword';
        k.speed = 0;
        k.lerpIndex = { from: 8, to: 5, t: 0, dur: 8, curve: 'linear' };
        k.frozen = false;
        k.hoverPause = false;
        setTimeoutStep(sc, 8, () => {
          k.sprite = 'spr_roaringknight_ball_fly';
          k.index = 0;
          k.speed = 0.4;
        });
        break;
      case 'susieIdle': {
        const su = A.susie;
        su.sprite = 'spr_susieb_idle';
        su.index = 0;
        su.speed = 0.334;
        break;
      }
      case 'susieLaugh': {
        const su = A.susie;
        // `c_flip("x")` TOGGLES — `image_xscale = -image_xscale`. This is the
        // first of two in the sequence; the second (at the swoon) turns her
        // back. Assigning `true` at both sites left her mirrored for the rest
        // of the scene.
        su.flip = !su.flip;
        su.sprite = 'spr_susie_laugh_dw';
        su.index = 0;
        su.speed = 0.25;
        cues.push({ name: 'snd_suslaugh', pitch: 1, gain: 1 });
        break;
      }
      case 'laughAgain': {
        const su = A.susie;
        su.sprite = 'spr_susie_laugh_dw';
        su.speed = 0.25;
        // loopsfx 169 IS snd_suslaugh — she keeps laughing into the cut.
        cues.push({ name: 'snd_suslaugh', pitch: 1, gain: 1 });
        break;
      }
      case 'slashCut': {
        fiveCuts(cues);
        sc.white.black = true;
        sc.white.alpha = 1;
        sc.white.visible = true;
        sc.slash.visible = true;
        if (a === 'susie') {
          sc.slash.x = 2420; sc.slash.y = 182;
          k.x = sc.camX + 640 + 300;
          k.sprite = 'spr_roaringknight_idle_overworld';
          k.index = 0;
          k.speed = 0;
          const su = A.susie;
          // THE SECOND `c_flip("x")`, and it flips her BACK — the command
          // negates image_xscale rather than setting it, and the script runs
          // one before the laugh and one here with no c_sel in between. She
          // is drawn unmirrored for the swoon.
          //
          // This is why she landed too far back: `flip` stayed true, so the
          // renderer kept applying the mirror's x-compensation
          // (`x += (w - 2*ox) * xscale`, scr_flip) on top of a position the
          // script sets ABSOLUTELY on the next line. Reported from play.
          su.flip = !su.flip;
          su.x = 2410; su.y = 142;
          su.sprite = 'spr_susie_dw_fell';
          su.index = 0; su.speed = 0;
        } else {
          sc.slash.x = 2408; sc.slash.y = 240;
          const ra = A.ralsei;
          ra.x = 2328; ra.y = 190;
          ra.sprite = 'spr_ralsei_defeat';
          ra.index = 0; ra.speed = 0;
        }
        break;
      }
      case 'susieSlide': {
        const su = A.susie;
        su.lerp = { field: 'x', from: su.x, to: 2310, t: 0, dur: 40, curve: 'in' };
        A.ralsei.sprite = 'spr_ralsei_shocked_behind';
        A.ralsei.index = 0;
        break;
      }
      case 'reveal': {
        bigShake(sc, cues);
        sc.white.visible = false;
        sc.slash.visible = false;
        const target = a === 'susie' ? A.susie : A.ralsei;
        sc.swoons.push({ x: target.x + 20, y: target.y + 30, born: sc.t });
        if (a === 'ralsei') {
          target.lerp = { field: 'x', from: target.x, to: 2280, t: 0, dur: 30, curve: 'out' };
        }
        break;
      }
      case 'ralseiApproach': {
        const ra = A.ralsei;
        ra.sprite = 'spr_ralsei_walk_right_unhappy'; // rsprite 359
        ra.speed = 0.25;
        // `c_walkwait("r", 8, 10)` IS 80 PIXELS, NOT 8. The second argument is
        // a SPEED and the third a duration — this was read as a distance, so
        // Ralsei took one step and stopped, ten times short of Susie.
        // Reported from play as him not walking up far enough.
        //
        // `scr_cutscene_commands`, the "walk" branch, states the product
        // itself in its own skip path:
        //
        //     actor_move.speed = command_arg2[i];   // 8, px per frame
        //     actor_move.time  = command_arg3[i];   // 10 frames
        //     // ...and when the cutscene is being SKIPPED:
        //     command_actor[i].x += lengthdir_x(command_arg2[i] * command_arg3[i], ...)
        //
        // The instant branch has to land the actor exactly where the animated
        // one would, so `speed * time` is the game's own statement of what the
        // walk is worth. obj_move_actor then holds `target.speed = 8` until
        // `timer >= time` and zeroes it, which is the same 80 give or take the
        // frame the counter trips on.
        const WALK = 8 * 10;
        ra.lerp = { field: 'x', from: ra.x, to: ra.x + WALK, t: 0, dur: 10, curve: 'linear' };
        // ...AND THEN HE TURNS TO FACE THE KNIGHT. The script is
        //
        //     c_autowalk(1); c_walkwait("r", 8, 10); c_facing("u");
        //
        // and `c_facing` swaps to the facing set's UP sprite —
        // `scr_set_facing_sprites`, "ralseiunhappy": `usprite =
        // spr_ralsei_walk_up` (the unhappy set keeps the neutral up sprite;
        // there is no unhappy variant of it). The turn was missing entirely,
        // so he finished the walk still facing right, side-on to the Knight
        // he is about to be cut down by — reported from play as him not
        // walking and turning correctly. Standing still, the walk sprite
        // rests on frame 0 (obj_actor's Step: `v_speed == 0` -> image_index
        // 0, image_speed 0).
        setTimeoutStep(sc, 10, () => {
          ra.speed = 0;
          ra.index = 0;
          ra.sprite = 'spr_ralsei_walk_up';
        });
        break;
      }
      case 'black':
        sc.white.black = true;
        sc.white.alpha = 1;
        sc.white.visible = true;
        break;
      case 'unblack': sc.white.visible = false; break;
      case 'knighting':
        sc.knightStatic = false;
        k.sprite = 'spr_roaring_knight_kris_knighting';
        k.x = 2326;
        k.y = 44;
        k.hoverPause = true;
        k.index = 1;
        k.speed = 0;
        k.hspeed = 0;
        k.shake = 0;
        k.jolt = [0, 0];
        A.kris.visible = false; // Kris kneels IN the art
        break;
      case 'knightingLower':
        k.lerpIndex = { from: 1, to: 4, t: 0, dur: a, curve: 'in' };
        break;
      case 'krisDown': {
        const kr = A.kris;
        kr.visible = true;
        kr.sprite = 'spr_krisb_defeat';
        kr.index = 0;
        k.sprite = 'spr_roaringknight_idle_overworld_sword';
        k.index = 0;
        k.speed = 0.1;
        k.x = 2655;
        k.hoverPause = false;
        break;
      }
      case 'end':
        sc.done = true;
        sc.toMenu = true;
        break;
    }
  }
}
