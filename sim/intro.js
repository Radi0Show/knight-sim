// THE FIGHT'S OPENING ROAR — obj_knight_roaring_fx, the transformation the
// encounter room plays right before scr_battle.
//
// In the real game this runs in the OVERWORLD: obj_ch3_PTB02's cutscene hides
// its knight actor, creates obj_knight_roaring_fx at (x + 20, y - 20), waits
// 255 frames, and only then draws the sword and calls scr_battle. The battle
// itself opens straight onto the menu — the anchor recordings show `buttons`
// on frame 1 — so this sequence is the ONLY place the roar exists, and it
// exists BEFORE the battle sim does.
//
// That placement is load-bearing here too: the roar runs in the WEB DRIVER,
// between the title screen and the fight, exactly like the title itself. It
// never touches sim state, so replay tokens, the whole-fight diff and every
// suite are byte-identical with or without it. This module is therefore a
// plain object + step function, not an entity type.
//
// The fx object's Step, translated on its VISUAL-ONLY path: `createbullets`
// is true only `if (i_ex(obj_battlecontroller))`, and the overworld has no
// battle controller, so the fire rings never spawn and none of that code is
// ported. What remains, in order:
//
//   intro    t8   shudder (the sprite jitters ±1 while `shudder` is nonzero)
//            t16  obj_knight_crush — a converging ring, radius 960 -> 160
//                 over 24 frames at alpha 0.1
//            t24  whiteout begins (a white copy of the sprite fades in at
//                 1/48 a frame) + snd_knight_stretch at pitch 0.75, and
//                 particles rush INTO the centre while it lasts
//            t32  shudder again
//            t64  -> "roaring", timer = -20
//   roaring  t16  `bar = 24` — a vertical white flash line that decays x0.65
//            t24  (first cycle only) spr_roaringknight_pose_ol at speed 0.5,
//                 snd_knight_roar, whiteout off, obj_knight_circle in white;
//                 later cycles play snd_knight_puff at pitch 0.15 instead
//            t28  spin flips, counter++, attack_speed -> 14 by 1; while
//                 counter < 30 the cycle restarts (timer = 0), and from
//                 attack_speed > 0 every 3rd frame throws screen afterimages
//            roarendtimer 190 -> done, and the fight proper begins
//
// DEVIATIONS, labelled: the in-rush particles and the screen afterimages are
// drawn by the renderer from frame-seeded randoms (the GML spawns
// obj_particle_generic instances with scr_lerpvar easings; the counts, the
// 40..240 spawn ring and the inward pull are kept, the easing curves are
// approximated). Skippable with confirm/cancel — a practice tool addition,
// said here rather than hidden.

/** The fx at the knight's overworld offset: (KNIGHT.x + 20, ystart - 20). */
export function createIntroFx(x, y) {
  return {
    x,
    y,
    timer: 0,
    frame: 0, // drives the renderer's frame-seeded randoms and the bob
    spin: 1, // `choose(1, -1)` — cosmetic
    counter: 0,
    attack_speed: 0,
    sprite_index: 'spr_roaringknight_shift_ol',
    image_index: 1,
    image_speed: 0,
    image_xscale: 2,
    image_yscale: 2,
    fxState: 'intro',
    whiteout: false,
    whiteout_counter: 0,
    shudder: 0,
    bar: 0,
    roarendtimer: 0,
    roarendtimermax: 190,
    crushTimer: -1, // -1 idle; 0..24 the converging ring
    circleFlash: 0, // frames since the white circle spawned, 0 = none
    done: false,
  };
}

/**
 * One 30Hz tick. Pushes {name, pitch, gain} onto `cues` for the driver to
 * hand to the audio layer — the same shape sim cues use.
 */
export function stepIntroFx(e, cues) {
  if (e.done) return;
  e.frame += 1;
  if (e.shudder) e.shudder -= 1;
  if (e.crushTimer >= 0 && e.crushTimer < 48) e.crushTimer += 1;
  if (e.circleFlash > 0) e.circleFlash += 1;

  if (e.whiteout) {
    // `scr_approach(whiteout_counter, 1, 1/48)`.
    e.whiteout_counter = Math.min(1, e.whiteout_counter + 1 / 48);
  }

  if (e.fxState === 'intro') {
    e.timer += 1;
    if (e.timer === 8) e.shudder = 999;
    if (e.timer === 16) e.crushTimer = 0;
    if (e.timer === 24) {
      e.whiteout = true;
      cues.push({ name: 'snd_knight_stretch', pitch: 0.75, gain: 1 });
    }
    if (e.timer === 32) e.shudder = 999;
    if (e.timer === 64) {
      e.fxState = 'roaring';
      e.timer = -20;
    }
  }

  if (e.fxState === 'roaring') {
    e.timer += 1;
    if (e.timer === 16 && !e.attack_speed) e.bar = 24;
    if (e.timer === 24 - e.attack_speed) {
      if (e.attack_speed === 0) {
        e.sprite_index = 'spr_roaringknight_pose_ol';
        e.image_index = 0;
        e.image_speed = 0.5;
        cues.push({ name: 'snd_knight_roar', pitch: 1, gain: 1 });
        e.whiteout = false;
        e.circleFlash = 1;
      } else {
        cues.push({ name: 'snd_knight_puff', pitch: 0.15, gain: 1 });
      }
    }
    if (e.timer === 28 - e.attack_speed) {
      e.spin *= -1;
      e.counter += 1;
      e.attack_speed = Math.min(14, e.attack_speed + 1);
      if (e.counter < 30) e.timer = 0;
    }
    e.roarendtimer += 1;
    if (e.roarendtimer >= e.roarendtimermax) e.done = true;
  }

  // The pose sprite animates at 0.5; two frames in the pack.
  if (e.image_speed) e.image_index = (e.image_index + e.image_speed) % 2;

  // The flash bar's decay is per-frame state (the GML does it in Draw, but
  // a renderer must not advance numbers — the 30Hz rule).
  if (e.bar) {
    e.bar *= 0.65;
    if (e.bar < 0.5) e.bar = 0;
  }
}
