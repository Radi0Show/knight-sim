// THE POST-FIGHT CUTSCENE — Susie against the Knight, from obj_ch3_PTB02's
// con 10-12 script and its three helper objects, translated beat for beat:
//
//   con 11 (the c_ script):
//     - the Knight glides in (-347 x over 40 frames, rising to hover y 72)
//       while the camera pans after him
//     - THE BEAM: obj_ch3_PTB02_roaringknight_pull_test — his reach base, the
//       growing hand (spr_roaringknight_arm_reach_grow 0->3 over 16), a purple
//       additive triangle sweeping off camera-left (triheight 0->100 over 80,
//       wobbling sin(timer/2)*2), spearappear chords, particles sucked along
//       it, held 180 frames with two low knight_stretch notes
//     - the beam stops and retracts — and SUSIE IS IN HIS HAND
//       (spr_susie_dw_fell_grab under spr_roaringknight_look_down_full,
//       snd_noise + shake; the hand copy shakes at choose(0, 2) offsets):
//       "No.. you... you can't..." / "You can't.. take her..."
//     - UNDYNE arrives (spr_undyne_dw_spear_point), spears fly
//       (obj_ch3_PTB02_roaringknight_speardodge_sequence: spr_undyne_dw_spear
//       from camera-right at speed 7 accelerating, friction -1, every 4th
//       frame with randomised swing sounds) while the Knight dodges as
//       spr_roaringknight_ball_transition, image_index 3 + sin(timer/2)*1.6.
//       Susie drops (spr_susieb_defeat)
//     - the Knight breaks off as spr_roaringknight_ball_fly, turns, crosses
//       the screen; "Hey!! You!! Stop!! Police!!"
//     - THE BIRD: spr_roaringknight_fly_transition then spr_roaringknight_fly,
//       accelerating away — snatching Undyne mid-flight (snd_grab;
//       spr_undyne_dw_caught animating at 0.3 with her hat still on him):
//       "Hey, what are you doing!?" / "Put me.. PUT ME DOWN!!!" — with the
//       wing loop (snd_knight_puff at a falling pitch alternating with
//       snd_heavy_passing) fading as he goes
//     - Ralsei kneels (spr_ralsei_kneel_serious), the camera comes back,
//       Susie crouches (spr_susie_crouch) and tears off after them
//       (spr_susie_run_serious_right): "Hey, where the hell are you going?!"
//       Kris lands (spr_kris_dw_landed)
//
// DRIVER-SIDE, like the intro: the real scene runs in the overworld room
// after the battle objects are destroyed, so it never touches sim state and
// every token, diff and suite is byte-identical with or without it.
//
// COORDINATES: the original stages this across a 6000px room with absolute
// camera pans. The sim's stage is the battle view, so the anchoring is
// RELATIVE — every actor starts where the battle drew them, and the
// original's relative motions (the -347 glide, the +440 turn, Undyne's
// entry from the right edge, the flight off it) are kept while the absolute
// room x's are not. LABELLED APPROXIMATIONS beyond that: Toriel (the beam's
// story target, staged far off-view in the room) is not shown; the c_ script
// faces (\EV etc.) are not drawn; dialogue is the chatbox rather than a
// balloon sprite, same as the fight's own talk.
//
// Dialogue strings are the dump's, character for character, minus the
// control codes (\EV, ^1 pauses, / and /% terminators).

const KNIGHT_START_X = 425;
const KNIGHT_START_Y = 78;

export const VICTORY_LINES = {
  susie_cant: "No.. you... you can't...&You can't.. take her...",
  undyne_stop: "Hey!! You!! Stop!! Police!!&Wh.. What the hell is going&on here!!?",
  undyne_punk: "You've got some explaining&to do, punk!!",
  undyne_caught: "Hey, what are you doing!?&Put me.. PUT ME DOWN!!!",
  susie_hey: 'Hey...',
  susie_where: 'Hey, where the hell are&you going?!',
};

export function createVictoryScene(party) {
  return {
    t: 0,
    phase: 'approach',
    phaseT: 0,
    done: false,
    camX: 0,
    // The knight: position, pose, motion targets.
    knight: {
      x: KNIGHT_START_X,
      y: KNIGHT_START_Y,
      ystart: KNIGHT_START_Y,
      siner2: 0,
      hoverPause: false,
      visible: true,
      sprite: 'spr_roaringknight_idle_overworld_sword',
      index: 0,
      speed: 0,
      flip: false,
      undyneCatch: false,
      undyneAnim: 0,
    },
    beam: null,      // { timer, handframe, triheight, con }
    dodge: null,     // { timer, x, y, xstart, ystart, index, rem1, spears: [] }
    // The party, standing where the fight left them (screen coords).
    actors: {
      kris: { x: party?.[0]?.x ?? 126, y: party?.[0]?.y ?? 104, sprite: 'spr_krisr_dark', index: 0, speed: 0, visible: true },
      susie: { x: party?.[1]?.x ?? 80, y: party?.[1]?.y ?? 142, sprite: 'spr_susie_walk_right_dw_unhappy', index: 0, speed: 0, visible: true, shake: 0 },
      ralsei: { x: party?.[2]?.x ?? 58, y: party?.[2]?.y ?? 190, sprite: 'spr_ralsei_walk_right_unhappy', index: 0, speed: 0, visible: true },
      undyne: { x: 700, y: 100, sprite: 'spr_undyne_dw_spear_point', index: 0, speed: 0, visible: false },
    },
    susieGrab: null, // { x, y, shakeOffset, shakeTimer }
    dialogue: null,  // { speaker, text, timer } — typer-81 chatbox
    lerps: [],       // active { obj, key, from, to, dur, t, ease }
  };
}

/** `scr_lerpvar`-ish: linear with the two eases the scene uses. */
function pushLerp(sc, obj, key, to, dur, ease = 'linear') {
  sc.lerps.push({ obj, key, from: obj[key], to, dur, t: 0, ease });
}

function stepLerps(sc) {
  for (const L of sc.lerps) {
    L.t += 1;
    let a = Math.min(1, L.t / L.dur);
    if (L.ease === 'inout') a = a < 0.5 ? 2 * a * a : 1 - (-2 * a + 2) ** 2 / 2;
    if (L.ease === 'in') a = a * a;
    if (L.ease === 'out') a = 1 - (1 - a) ** 2;
    L.obj[L.key] = L.from + (L.to - L.from) * a;
  }
  sc.lerps = sc.lerps.filter((L) => L.t < L.dur);
}

function say(sc, speaker, text) {
  sc.dialogue = { speaker, text, timer: 0 };
}

/** frame-seeded random for choose()-style cosmetic picks. */
function srand(frame, salt) {
  let t = (frame * 374761393 + salt * 668265263) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

/**
 * One 30Hz tick. `input` is the driver's key state ({confirm}), `cues` the
 * audio out-array. Dialogue advances on a fresh confirm once fully typed
 * (`c_talk_wait`); everything else is the timeline.
 */
export function stepVictoryScene(sc, input, cues) {
  if (sc.done) return;
  sc.t += 1;
  sc.phaseT += 1;
  const k = sc.knight;
  const A = sc.actors;

  // The knight's hover — the actor's own Step, verbatim.
  k.siner2 += 1;
  if (!k.hoverPause) k.y = k.ystart + Math.cos(k.siner2 / 8) * 8;
  if (k.speed) k.index += k.speed;
  for (const name of Object.keys(A)) {
    if (A[name].speed) A[name].index += A[name].speed;
  }
  if (k.undyneCatch) k.undyneAnim += 0.3;
  stepLerps(sc);

  // Dialogue typing + gating.
  if (sc.dialogue) {
    sc.dialogue.timer += 1;
    const len = sc.dialogue.text.replace(/&/g, '').length;
    const done = sc.dialogue.timer >= len; // typer 81, rate 1
    const fresh = input?.confirm && !sc.heldConfirm;
    if (done && fresh) sc.dialogue = null;
  }
  sc.heldConfirm = !!input?.confirm;
  const talking = !!sc.dialogue;

  const enter = (phase) => {
    sc.phase = phase;
    sc.phaseT = 0;
  };

  switch (sc.phase) {
    case 'approach': {
      if (sc.phaseT === 1) {
        // c_var_lerp x -347 over 40 inout; ystart -> 60 over 40.
        pushLerp(sc, k, 'x', k.x - 347, 40, 'inout');
        pushLerp(sc, k, 'ystart', 60, 40);
      }
      if (sc.phaseT === 10) pushLerp(sc, sc, 'camX', sc.camX - 180, 30);
      if (sc.phaseT === 130) {
        k.hoverPause = true;
        k.y = 72;
        k.visible = false;
        sc.beam = { timer: 0, handframe: 0, triheight: 0, con: 1, x: k.x, y: k.y };
        enter('beam');
      }
      break;
    }
    case 'beam': {
      const b = sc.beam;
      b.timer += 1;
      // con 1: hand 0->3/16 'in'; +12: con 3: chord + triheight 0->100/80.
      if (b.con === 1) {
        b.handframe = Math.min(3, 3 * (b.timer / 16) ** 2);
        if (b.timer === 12) {
          b.con = 4;
          cues.push({ name: 'snd_spearappear', pitch: 0.8, gain: 1 });
          cues.push({ name: 'snd_spearappear', pitch: 0.5, gain: 1 });
          cues.push({ name: 'snd_spearappear', pitch: 0.6, gain: 1 });
          pushLerp(sc, b, 'triheight', 100, 80, 'out');
        }
      } else {
        // The crackle: `snd_play_x(snd_spearappear, 0.2, 0.5 + random(0.3))`
        // EVERY frame in the original; every 3rd here so the mixer survives,
        // said out loud rather than hidden.
        if (b.timer % 3 === 0) {
          cues.push({ name: 'snd_spearappear', pitch: 0.5 + srand(sc.t, 3) * 0.3, gain: 0.2 });
        }
        b.triheight += Math.sin(b.timer / 2) * 2;
      }
      if (sc.phaseT === 8) {
        cues.push({ name: 'snd_knight_stretch', pitch: 0.8, gain: 0.6 });
        cues.push({ name: 'snd_knight_stretch', pitch: 0.8, gain: 0.4 });
      }
      if (sc.phaseT === 180) {
        // Beam stop: retract, and 17 frames later the grab tableau.
        pushLerp(sc, b, 'triheight', 0, 20, 'in');
        pushLerp(sc, b, 'handframe', 0, 16);
        enter('grab');
      }
      break;
    }
    case 'grab': {
      if (sc.phaseT === 17) {
        sc.beam = null;
        k.visible = true;
        k.sprite = 'spr_roaringknight_look_down_full';
        k.index = 0;
        k.speed = 0;
        // Susie is in his hand — at HER position, per the beam's Draw.
        sc.susieGrab = { x: A.susie.x, y: A.susie.y, shakeOffset: 0, shakeTimer: 2 };
        A.susie.visible = false;
        cues.push({ name: 'snd_noise', pitch: 1, gain: 1 });
        sc.shake = 8;
      }
      if (sc.phaseT === 57) say(sc, 'susie', VICTORY_LINES.susie_cant);
      if (sc.phaseT > 57 && !talking) enter('undyne');
      break;
    }
    case 'undyne': {
      if (sc.phaseT === 60) {
        A.undyne.visible = true;
        A.undyne.x = sc.camX + 700;
        A.undyne.speed = 0.2;
        cues.push({ name: 'snd_spearappear', pitch: 1, gain: 1 });
        pushLerp(sc, A.undyne, 'x', sc.camX + 480, 40);
      }
      if (sc.phaseT === 118) {
        // The spear barrage: the knight breaks the grab and dodges.
        k.visible = false;
        sc.susieGrab = null;
        A.susie.visible = true;
        sc.dodge = {
          timer: 0, x: k.x, y: k.y, xstart: k.x, ystart: k.y,
          index: 12, rem1: -1, spears: [], makespear: true, rotate: false,
        };
        enter('spears');
      }
      break;
    }
    case 'spears': {
      const d = sc.dodge;
      d.timer += 1;
      // image_index 12 -> 3 over 18 'out', then the sin wobble.
      if (d.timer <= 18) d.index = 12 + (3 - 12) * (1 - (1 - d.timer / 18) ** 2);
      else d.index = 3 + Math.sin(d.timer / 2) * 1.6;
      // Spears from camera-right every 4th frame while the barrage holds.
      if (d.makespear && d.timer % 4 === 0 && d.timer < 40) {
        cues.push({ name: 'snd_swing', pitch: 1.1 + srand(sc.t, 5) * 0.4, gain: 0.4 + srand(sc.t, 6) * 0.3 });
        const sx = sc.camX + 640 + 40 + srand(sc.t, 7) * 200;
        const sy = -80;
        const dir = Math.atan2((d.y + 80) - sy, (d.x + 110) - sx);
        d.spears.push({ x: sx, y: sy, dir, speed: 7, life: 40 });
      }
      for (const s of d.spears) {
        s.speed += 1; // friction -1 accelerates
        s.x += Math.cos(s.dir) * s.speed;
        s.y += Math.sin(s.dir) * s.speed;
        s.life -= 1;
      }
      d.spears = d.spears.filter((s) => s.life > 0);
      // The dodge weave, every 12 frames.
      if (d.timer % 12 === 0 && d.timer < 40) {
        const gx = d.xstart + (40 + Math.floor(srand(sc.t, 8) * 4) * 10) * d.rem1;
        const gy = d.ystart + (20 + Math.floor(srand(sc.t, 9) * 3) * 10) * (srand(sc.t, 10) < 0.5 ? -1 : 1);
        pushLerp(sc, d, 'x', gx, 12, 'out');
        pushLerp(sc, d, 'y', gy, 12, 'out');
        d.rem1 *= -1;
      }
      if (d.timer === 18) {
        // Susie hits the ground.
        A.susie.sprite = 'spr_susieb_defeat';
        A.susie.index = 0;
        A.susie.speed = 0;
        A.susie.shake = 6;
        cues.push({ name: 'snd_noise', pitch: 1, gain: 1 });
      }
      if (d.timer === 48) {
        // spear_throw_stop: back to centre, then ball_fly.
        d.makespear = false;
        pushLerp(sc, d, 'x', d.xstart, 12, 'out');
        pushLerp(sc, d, 'y', d.ystart, 12, 'out');
      }
      if (d.timer === 61) {
        k.x = d.x;
        k.y = d.y;
        k.ystart = d.y;
        k.visible = true;
        k.sprite = 'spr_roaringknight_ball_fly';
        k.index = 0;
        k.speed = 0.2;
        sc.dodge = null;
        enter('turn');
      }
      break;
    }
    case 'turn': {
      if (sc.phaseT === 60) {
        k.flip = true;
        pushLerp(sc, k, 'x', k.x + 440, 40, 'inout');
      }
      if (sc.phaseT === 70) pushLerp(sc, sc, 'camX', sc.camX + 220, 30);
      if (sc.phaseT === 100) {
        k.sprite = 'spr_roaringknight_ball_transition_sword';
        k.index = 0;
        k.speed = 0.4;
      }
      if (sc.phaseT === 120) k.speed = 0;
      if (sc.phaseT === 130) say(sc, 'undyne', VICTORY_LINES.undyne_stop);
      if (sc.phaseT > 130 && !talking && !sc.saidPunk) {
        sc.saidPunk = true;
        say(sc, 'undyne', VICTORY_LINES.undyne_punk);
      }
      if (sc.phaseT > 131 && !talking && sc.saidPunk) {
        k.hoverPause = true;
        k.sprite = 'spr_roaringknight_fly_transition';
        k.index = 0;
        k.speed = 0.6;
        k.x -= 234 / 2; // the original shifts -234 at xscale 2; ours draws at 2 too
        cues.push({ name: 'snd_drake_dodge', pitch: 1, gain: 1 });
        cues.push({ name: 'snd_jump_bc', pitch: 1, gain: 1 });
        sc.birdPitch = 0.6;
        sc.birdVol = 1;
        sc.birdLoopT = 0;
        enter('bird');
      }
      break;
    }
    case 'bird': {
      if (sc.phaseT === 5) {
        // x -> far off right, 160 frames, accelerating 'in'.
        pushLerp(sc, k, 'x', k.x + 3500, 160, 'in');
      }
      if (k.index >= 16 && k.sprite === 'spr_roaringknight_fly_transition') {
        k.sprite = 'spr_roaringknight_fly';
        k.index = 0;
        k.speed = 0.25;
      }
      // The camera chases for a while.
      if (sc.phaseT === 20) pushLerp(sc, sc, 'camX', sc.camX + 320, 90);
      // The snatch: Undyne vanishes into his claws.
      if (!k.undyneCatch && k.x > A.undyne.x - 60 && A.undyne.visible) {
        A.undyne.visible = false;
        k.undyneCatch = true;
        cues.push({ name: 'snd_grab', pitch: 1, gain: 1 });
        say(sc, 'undyne', VICTORY_LINES.undyne_caught);
      }
      // The wing loop, fading with distance.
      sc.birdLoopT += 1;
      if (sc.birdLoopT === 6) cues.push({ name: 'snd_knight_puff', pitch: sc.birdPitch, gain: 0.85 * sc.birdVol });
      if (sc.birdLoopT >= 10) {
        sc.birdLoopT = 0;
        cues.push({ name: 'snd_heavy_passing', pitch: 1, gain: sc.birdVol });
      }
      if (sc.phaseT > 60) {
        sc.birdPitch = Math.max(0.1, sc.birdPitch - 0.01);
        sc.birdVol = Math.max(0, sc.birdVol - 0.02);
      }
      if (sc.phaseT === 120) {
        A.ralsei.sprite = 'spr_ralsei_kneel_serious';
        A.ralsei.index = 0;
      }
      if (sc.phaseT === 150) pushLerp(sc, sc, 'camX', sc.camX - 340, 60);
      if (sc.phaseT > 210 && !talking) enter('chase');
      break;
    }
    case 'chase': {
      if (sc.phaseT === 30) {
        A.susie.shake = 6;
        cues.push({ name: 'snd_noise', pitch: 1, gain: 1 });
        say(sc, 'susie', VICTORY_LINES.susie_hey);
      }
      if (sc.phaseT > 30 && !talking && !sc.susieUp) {
        sc.susieUp = true;
        sc.susieUpT = sc.phaseT;
        A.susie.sprite = 'spr_susie_crouch';
        A.susie.index = 0;
        A.susie.speed = 0;
        A.susie.shake = 4;
        cues.push({ name: 'snd_noise', pitch: 1, gain: 1 });
      }
      if (sc.susieUp && sc.phaseT === sc.susieUpT + 5) A.susie.index = 1;
      if (sc.susieUp && sc.phaseT === sc.susieUpT + 20) {
        cues.push({ name: 'snd_wing', pitch: 1, gain: 1 });
        A.susie.sprite = 'spr_susie_run_serious_right';
        A.susie.index = 0;
        A.susie.speed = 0.4;
        pushLerp(sc, A.susie, 'x', A.susie.x + 640, 90);
        say(sc, 'susie', VICTORY_LINES.susie_where);
      }
      if (sc.susieUp && sc.phaseT === sc.susieUpT + 80) {
        A.kris.sprite = 'spr_kris_dw_landed';
        A.kris.index = 0;
        A.kris.speed = 0;
      }
      if (sc.susieUp && sc.phaseT > sc.susieUpT + 84 && sc.phaseT < sc.susieUpT + 97
          && (sc.phaseT - sc.susieUpT) % 4 === 0) {
        A.kris.index = Math.min(2, A.kris.index + 1);
      }
      if (sc.phaseT > (sc.susieUpT ?? 999) + 140 && !talking) sc.done = true;
      break;
    }
    default:
      sc.done = true;
  }

  // Shakes decay.
  if (sc.shake) sc.shake -= 1;
  if (A.susie.shake) A.susie.shake -= 1;
  // The grab hand's shudder: `shake_offset = choose(0, 2)` every 2 frames.
  if (sc.susieGrab) {
    sc.susieGrab.shakeTimer -= 1;
    if (sc.susieGrab.shakeTimer <= 0) {
      sc.susieGrab.shakeTimer = 2;
      sc.susieGrab.shakeOffset = srand(sc.t, 20) < 0.5 ? 0 : 2;
    }
  }
}
