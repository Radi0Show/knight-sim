// obj_knight_roaring2 — ROARING (ac 9, dc.type 107), the phase 4 finale.
//
// The controller's whole GAMEPLAY timeline is translated: the intensity ramp,
// the soul pull, the star rings and their spiral, the corral, and the roar.
// Verified against the recording to frame 678 — see docs/STATUS.md.
//
// THREE CLOCKS, in sequence, and each hands over to the next:
//
//   timer          the intro. Nothing here runs until it passes 128.
//   intensity      a RAMP, not a counter: scr_approach(intensity, 4, 0.008).
//                  Drives the ring cadence, the ring shape, and the corral.
//   roaring_timer  only advances once intensity has CLAMPED at exactly 4.
//                  This is the roar, and it inverts the attack.
//
// THE PULL IS THE ATTACK'S REAL MECHANIC, not a visual. Every frame past
// `timer > 128`:
//
//     player_suck = scr_approach(player_suck, 1, 0.1625)   // while ramping
//     player_suck = scr_approach(player_suck, 0, 0.15)     // every frame
//     tempdir = point_direction(heart.x + 10, heart.y + 10, TARGET)
//     obj_heart.x += lengthdir_x(player_suck, tempdir)
//     obj_heart.y += lengthdir_y(player_suck, tempdir)
//
// Both approaches run, in that order. `player_suck` therefore settles at
// **0.85**, not at 1: the up-step saturates at 1 and the down-step
// immediately takes 0.15 off, so the value the rest of the frame sees — and
// the value the recorder writes — is 0.85 forever after. Measured: 0.5 at
// frame 126, 0.6125, 0.85 by 170, and 0.85 held to the end of the recording.
//
// The soul is dragged until `(x + 10, y + 10)` sits on the target, which is
// `(camerax() + fake_x, cameray() + fake_y + 55)` — with fake_x 320 and fake_y
// settling at 88, that is (320, 143). The recording shows the soul parked at
// (310, 133.3), which is exactly that.
//
// `intensity >= 3.7` SILENCES THE RING BLOCK rather than changing it — the
// spawn gate is `starcount_p1 == 1 && intensity < 3.7`, so above 3.7 no branch
// fires at all and the attack simply waits for intensity to reach 4. Reading
// the block expecting a third ring variant there finds nothing; the content is
// in the roar below.
//
// The 282-line Draw event IS ported now (render/draw/roaring.js), along with
// the roaring_timer 275 wind-up. NOT translated: the `do_fake_screen` finale at
// roaring_timer 299, which snapshots the composite into two sprites and flings
// them apart as the screen is cut.

import { spawn, destroy } from '../entity.js';
import { lengthdirX, lengthdirY, pointDirection, pointDistance, scrApproach, gmlEq } from '../gml.js';
import { gmlChoose, gmlIrandom, gmlIrandomRange, gmlRandom } from '../rng.js';
import { scrLerpvar } from '../lerpvar.js';
import { cue, cueSustain, cueTune } from '../audio.js';
import { roaringStar } from './roaring-star.js';
import { roaringknightSlash } from './roaringknight-slash.js';
import { scrBulletInherit } from '../bullets/regularbullet.js';
import {
  screenPiece, scrAfterimage, knightCircle, particleGeneric, afterimageScreen,
} from '../fx.js';

/**
 * The width of `spr_pixel_white_front` — the sheet the in-rush streaks are
 * drawn from, 4x4 with its origin on the right edge. Dividing the streak's
 * `image_xscale` by it turns the dump's 320 from "320 sheets" (1280px, twice
 * the view) into "320 pixels", which is the distance the particle actually
 * covers. See the note at the spawn site: this is a deviation, on a report
 * from play, not a reading.
 */
const STREAK_UNIT = 4;

export const roaring2 = {
  name: 'obj_knight_roaring2',

  create(e, state) {
    // Create: image_speed = 0. The knight's frames are driven by
    // knight_sprite_speed instead, so leaving the default 1 here made the
    // engine walk image_index underneath that as well.
    e.image_speed = 0;
    e.image_index = 0;

    // `obj_knight_enemy.chargeupcon = 2` — the launch hides the white
    // charged knight (instantly, in effect: sim/knight.js has the dead-fade
    // note). The CleanUp below restores him.
    if (state.knight) {
      state.knight.chargeupcon = 2;
      // ...AND ZERO THE TIMER. obj_knight_roaring2's Create is two lines:
      //
      //     obj_knight_enemy.chargeupcon = 2;
      //     obj_knight_enemy.chargeuptimer = 0;
      //
      // Only the first was translated, so the burn-out started with the
      // ~185 left over from the charge-up turn: `chargeuptimer >= 10` was
      // already true, con flipped to 3 on the FIRST frame, and the ten-frame
      // white fade played as a single frame. The draw log caught it as
      // 1 burnout row against the game's 10.
      state.knight.chargeuptimer = 0;
    }

    e.timer = 0;
    e.intensity = 1.5;
    e.attack_timer = 0;
    e.roaring_timer = 0;
    e.player_suck = 0.5;
    // camerawidth() * 0.5, and the intro tween's settled value.
    e.fake_x = 320;
    e.fake_y = 24;
    // `fake_alpha = 0` — THE PHANTOM STARTS INVISIBLE. It was never
    // initialised here, and the renderer's `e.fake_alpha ?? 1` then drew the
    // scanline knight at FULL alpha for the first 80 frames, until the
    // timer-80 lerp reset it to 0 and faded it in again. Reported from play
    // as the knight appearing, then appearing a second time — which is
    // exactly what it was doing.
    e.fake_alpha = 0;
    // `rand_angle = irandom(360)` — IN THE ORIGINAL'S CREATE, so the draw is
    // taken here and not by the caller. It was left at 0 with a note saying
    // the scene would replay it, and only ONE scene ever did: sim/scenes/
    // fight.js. The whole-fight runner builds the PRACTICE scene, which never
    // set it, so every ROARING in a full fight fired its star rings from a
    // base of 0 while the game fired from a random one.
    //
    // Invisible until the camera work pushed verify37's front this far: at
    // f11269 the six ring stars sat on the right circle, 60 degrees apart,
    // uniformly 2 degrees off — the token's roll happened to be 58, and 58
    // minus a whole 60-degree step is what that 2 degrees was.
    //
    // Position in the stream matters as much as the value: irandom is two
    // draws, and taking them at Create is what the runner does.
    e.rand_angle = gmlIrandom(state.gmlRng, 360);
    // ONE U32 DRAW IS MISSING BEFORE THIS ROLL, and it is CONDITIONAL.
    // verify37's front sits on the six-star ring at f11269: the ring is right
    // (radius 590, 60 degrees apart) but rotated, because rand_angle is 220
    // here and 278 in the game. The anchor is correct (n=27, seed 27037) and
    // 278 is exactly what this roll returns after THREE u32 draws off that
    // anchor, where the sim takes two (obj_dbulletcontroller's basedir).
    //
    // Do NOT pad it unconditionally: measured, a single extra draw here moves
    // verify37 to f11726 AND makes the camera match on every one of its
    // 12,007 frames -- and BREAKS verify21j, which is byte-exact today, at
    // f11274. So the third draw happens in token 37's roar and not token
    // 21's. Launch conditions look identical in both (no live bullets, inv
    // -5, full party), so what varies has not been found yet. Attribute it
    // before adding it; this project has been burnt by blind pads twice.
    e.rand_dist = 320;
    e.starcount_p1 = 0;
    e.starcount_p2 = 0;
    e.spinspeed = 1;
    e.star_angle1 = -1;
    e.star_angle2 = -1;
    e.star_angle3 = -1;
    e.ball_speed = 0;
    e.ball_darkness = 0;
    e.ballDarknessDelay = 0;

    // ---- Draw-event state ---------------------------------------------------
    //
    // Every field below is read (and most are advanced) by obj_knight_roaring2's
    // Draw event. They live here rather than in the renderer because the
    // original stores them on the instance and because a renderer that mutated
    // them would not be reproducible headlessly — the same reason the cone's
    // `con` advance is in sim/. See CLAUDE.md, "Draw events run gameplay".
    e.darkness = 0;         // the whole effect fades up from black
    e.star_flicker = 2;     // alternates 0/2 so the grate's scanlines crawl
    e.intensify = 1.5;      // drives the knight's per-scanline wobble
    e.line_timer = -1;      // -1 until the pre-cut marker starts, then counts
    e.r = 128;
    e.g = 128;
    e.b = 128;
    e.bobble_count = 0;
    e.bobble_freq = 1;
    e.bobble_amp = 4;
    e.ball_counter = 0;
    e.hsv = 128;            // cycles 128..288, which is the vortex's hue sweep
    e.hsv_switch = false;
    e.stop = false;
    e.do_fake_screen = false;
    e.jumpimages = false;
    e.jumpUpDelay = -1;
    e.jumpUpFrom = 0;

    // `scr_script_delayed(scr_lerpvar, 20, "darkness", 0, 1, 32)` — Create's
    // last line. The screen does not go black instantly; it takes 32 frames,
    // starting 20 frames in.
    e.darknessDelay = 20;
    // Create lines 28-30. Asset ids in the original; 664 is
    // spr_roaringknight_front, resolved from the sprite metadata dump.
    e.knight_sprite = 'spr_roaringknight_front';
    e.knight_sprite_image = 0;
    e.knight_sprite_speed = 0.5;
    /** ds_list of stars caught at roaring_timer 181, released one per frame. */
    e.bullet_list = [];

    // `obj_heart.boundaryup = 160` — Create, line 45. It reads like a ceiling
    // and is actually a RAISED FLOOR: the soul's own clamp is
    // `view.y + 320 - sprite_height + boundaryup`, so this moves the lower
    // limit from 300 down to 460.
    //
    // It only matters once the ROAR reverses the pull and shoves the soul out
    // of the arena. Without it the clamp catches the soul at y 300 and drags
    // it back a pixel a frame, against a recording that sails straight past —
    // which is exactly how it was found, at frame 536.
    if (state.soul) state.soul.boundaryup = 160;
  },

  step(e, state) {
    e.timer += 1;

    // THE STRETCH IS A PITCH RAMP — see cueSustain/cueTune in sim/audio.js.
    if (e.timer === 132) {
      e.stretchPitch = 0.1;
      cueSustain(state, 'snd_knight_stretch', e.stretchPitch);
    }
    // `audio_sound_pitch(sound, audio_sound_get_pitch(sound) + 0.000535)` — the
    // note bends upward every frame from 132 until the roar. Over the ~240
    // frames to roaring_timer 9 that is 0.1 -> roughly 0.23, slow enough that
    // you feel it building rather than hear it sliding.
    if (e.timer > 132 && e.stretchPitch !== undefined) {
      e.stretchPitch += 0.000535;
      cueTune(state, 'snd_knight_stretch', e.stretchPitch);
    }

    // THE ROAR CORRALS THE SOUL TO THE SCREEN. The Step's very first block,
    // before anything else it does:
    //
    //     with (obj_heart) {
    //         if (x < camerax())                        x = camerax();
    //         if (x > camerax() + camerawidth() - 20)    x = camerax() + camerawidth() - 20;
    //         if (y < cameray())                         y = cameray();
    //         if (y > cameray() + cameraheight())        y = cameray() + cameraheight() - 20;
    //     }
    //
    // This is the attack's arena: the battle box is gone, and the WHOLE
    // SCREEN becomes the floor, with the pull dragging you across it. Without
    // the clamp the soul could be shoved off the edge entirely and sit there
    // for the rest of the roar, which is what it was doing — parked in a
    // corner, out of play, while the attack happened without it.
    //
    // Note the asymmetry, kept: the left and top clamps snap to the edge
    // exactly, the right and bottom to 20 inside it (the sprite's width).
    if (state.soul) {
      const vx = state.view.x;
      const vy = state.view.y;
      if (state.soul.x < vx) state.soul.x = vx;
      if (state.soul.x > vx + 640 - 20) state.soul.x = vx + 640 - 20;
      if (state.soul.y < vy) state.soul.y = vy;
      if (state.soul.y > vy + 480) state.soul.y = vy + 480 - 20;
    }

    // `if (jumpimages) scr_afterimagefast();` — Step line 20, ABOVE everything
    // else. One ghost per frame for the whole leap, which is what makes the
    // jump read as a streak rather than a teleport.
    if (e.jumpimages) {
      const g = scrAfterimage(state, e);
      g.sprite_index = e.sprite_index;
      g.image_index = e.image_index;
      g.fadeSpeed = 0.08; // scr_afterimageFAST — three times the usual 0.04
    }

    // Step lines 25-29, in their original order.
    if (e.line_timer > -1) e.line_timer += 1;
    e.bobble_count += e.bobble_freq;

    if (e.darknessDelay > 0) {
      e.darknessDelay -= 1;
      if (e.darknessDelay === 0) scrLerpvar(state, spawn, e, 'darkness', 0, 1, 32);
    }

    // THE COLOUR. This one line is the whole reason the roar looked black:
    //
    //     if (timer == 118)
    //         scr_script_delayed(scr_lerpvar, 16, "ball_darkness", 0, 1, 32, 1, "out");
    //
    // `ball_darkness` is the ALPHA the Draw composites the vortex at —
    // `draw_surface_part_ext(ball_surface, ..., color, ball_darkness)` — and
    // it starts at 0. Without this it stays 0 for the entire attack, so the
    // tiled `spr_knight_bullet_flow`, the six expanding rings that cut it into
    // a vortex, the per-row sine ripple and the cycling HSV hue were all
    // computed, composited and then multiplied by zero. Every layer was
    // there; none of it reached the screen. Reported twice from play as the
    // roar missing its background colours.
    //
    // It fades in from timer 134 (118 + the 16-frame delay) over 32 frames on
    // ease_out curve 1 — arriving just as the stretch note starts bending.
    // FIFTEEN, NOT SIXTEEN, and the recording is what says so.
    //
    // `scr_script_delayed(scr_lerpvar, 16, ...)` arms an alarm 16 frames out.
    // GameMaker's event order is Alarms BEFORE Step, so the obj_lerpvar that
    // alarm creates gets its own first Step on that SAME frame — its first
    // write lands 16 frames after the cue. This engine freezes the entity list
    // at the start of each phase (sim/entity.js), so a tween spawned here does
    // not step until the next frame; counting 15 puts the first write back on
    // frame 16 where the game has it.
    //
    // Checked against the trace, not reasoned into place: the fade-OUT is cued
    // at frame 411 and `traces/roaring2.csv` has ball_darkness 0.9509323257 at
    // frame 427, which is exactly `1 - sin((1/32) * pi/2)` — one frame of a
    // 32-frame ease_out-curve-1 lerp, sixteen frames after the cue. At 16 the
    // first write fell on 428 and every frame after was one behind.
    const DELAYED_TWEEN = 15;
    if (e.timer === 118) { e.ballDarknessDelay = DELAYED_TWEEN; e.ballDarknessTo = 1; }
    if (e.ballDarknessDelay > 0) {
      e.ballDarknessDelay -= 1;
      if (e.ballDarknessDelay === 0) {
        const to = e.ballDarknessTo ?? 1;
        scrLerpvar(state, spawn, e, 'ball_darkness', 1 - to, to, 32, 1);
      }
    }
    // It fades back OUT the same way at `intensity == 3.66` — see the gmlEq
    // block below, which is where that equality is handled.

    // WHERE THE KNIGHT IS DRAWN. obj_knight_roaring2's own instance sits off
    // screen (the recording has it at y -242 all turn); the knight you see is
    // drawn by its Draw event at `camerax() + fake_x, cameray() + fake_y`.
    // The renderer reads these two fields so the figure appears centre-stage
    // as it does in the game, without moving the instance and breaking the
    // verified geometry that keys off `fake_y`.
    e.renderX = state.view.x + e.fake_x;
    e.renderY = state.view.y + e.fake_y;

    // IT IS `knight_sprite` THAT IS DRAWN, not `sprite_index`. The Draw event
    // builds the figure out of `knight_sprite` / `knight_sprite_image`, one
    // scanline at a time with a per-row sine wobble, and never touches
    // `sprite_index` — which stays on the generic attack pose all turn.
    //
    // Using sprite_index put the ATTACK pose on screen for the whole of
    // Roaring, which is the same pose Flurry and rotating slash wear. The real
    // progression is a different sprite entirely, and it changes four times:
    //
    //   Create              spr_roaringknight_front, advancing at 0.5
    //   intensity == 3.74   spr_roaringknight_front_flourish, held
    //   roaring_timer 15    spr_roaringknight_front_roar, advancing at 0.5
    //   roaring_timer 181   spr_roaringknight_front_flourish, held
    //   roaring_timer 275   spr_roaringknight_front_slash
    //
    // The renderer draws `knight_sprite` at (fake_x, fake_y); the per-scanline
    // wobble is not reproduced (see docs/STATUS.md).
    e.knight_sprite_image += e.knight_sprite_speed;
    // `sprite_index` AND `knight_sprite` ARE TWO DIFFERENT SPRITES, and this
    // used to copy one onto the other every single step.
    //
    //   sprite_index    what `draw_self()` draws — the instance's own sprite
    //   knight_sprite   a NUMERIC id, drawn row by row by the scanline
    //                   `draw_sprite_part_ext` calls
    //
    // The Step assigns them separately and to different values (rt 275 sets
    // `sprite_index = spr_roaringknight_front_slash` and `knight_sprite =
    // 4320` on adjacent lines). Copying knight_sprite over sprite_index broke
    // the attack's LAST beat: at roaring_timer 363 the knight is supposed to
    // rematerialise at his battle spot as `spr_knight_warp`, frames 5 -> 8
    // over 8 frames — and this line overwrote that on the very next frame, so
    // for the twelve frames before the real knight returns he was drawn as
    // the slash pose at an image_index the lerp had walked past the end of
    // the sheet, wrapping to garbage. Reported from play as the knight
    // appearing weirdly a second or two after the screen slash.
    //
    // The renderer already reads `knight_sprite` directly for the scanline
    // rows (drawKnightRows), so nothing needed it copied here.
    e.image_xscale = 2;
    e.image_yscale = 2;

    // THE KNIGHT HIDES HIMSELF. obj_knight_roaring2 never touches his
    // image_alpha — his own Draw does it, at the end of the con-2 burn-out
    // (`if (chargeuptimer == 10) { chargeupcon = 3; image_alpha = 0; }`).
    // Forcing it to 0 here every frame — the stand-in for a fade this file
    // wrongly believed was dead — overwrote the burn-out on its first frame,
    // so he vanished instantly instead of over ten. He is restored at
    // roaring_timer 375 (below), which IS the CleanUp's job.

    // THE INTRO, which the oracle scene never exercised because it starts at
    // frame 149 with the settled values already seeded. In a real turn these
    // two beats are what put the attack where it belongs, and without them
    // Roaring played 64px too high inside a battle box that never opened.
    if (e.timer === 30) {
      // The arena expands to swallow the screen: 2560 x 1920 against the box's
      // CURRENT scaled size, which at the default xscale 2 works out to 17.07
      // and 12.8 — exactly the values the recording holds for the whole turn.
      const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
      if (gt) {
        const sw = 75 * gt.image_xscale;
        const sh = 75 * gt.image_yscale;
        scrLerpvar(state, spawn, gt, 'image_xscale', gt.image_xscale, 2560 / sw, 160, 1);
        scrLerpvar(state, spawn, gt, 'image_yscale', gt.image_yscale, 1920 / sh, 160, 1);
      }
    }

    if (e.timer === 80) {
      // The knight rises into position. Everything this attack aims at is
      // `cameray() + fake_y + 55`, so until this runs the pull, the spiral and
      // the star rings all converge on the wrong point.
      e.fake_alpha = 0;
      scrLerpvar(state, spawn, e, 'fake_alpha', 0, 1, 48, 1);
      scrLerpvar(state, spawn, e, 'fake_y', 24, 88, 48, 2);
    }

    if (e.timer <= 128) return;

    e.intensity = scrApproach(e.intensity, 4, 0.008);

    // THE TWO INTENSITY GATES, and they are the reason `gmlEq` exists.
    //
    //     if (intensity == 3.66) { ...ball_darkness 1 -> 0, a white circle... }
    //     if (intensity == 3.74 && knight_sprite == 664) { ...the flourish... }
    //
    // Both test EXACT EQUALITY against a value built by repeated `+= 0.008`
    // from 1.5, and both fire in the real game — GML compares reals with a
    // tolerance, JS `===` does not. This was previously read two different
    // wrong ways (a `>=` rewrite here, a "dead branch" retraction there); see
    // sim/gml.js's gmlEq for the recording that settles it.
    //
    // NOTE the ORDER: 3.66 comes first, and its 16-frame delay means the
    // vortex starts fading out ten frames before he changes pose.
    if (gmlEq(e.intensity, 3.66)) {
      // `scr_script_delayed(scr_lerpvar, 16, "ball_darkness", 1, 0, 32, 1, "out")`
      e.ballDarknessDelay = 15; // see DELAYED_TWEEN above
      e.ballDarknessTo = 0;
      // The white bloom that covers the change: obj_knight_circle at the
      // knight's centre, black and 480 wide, its r/g/b_goal all lerping to
      // 255 over 48 frames while `size_goal` pulls it shut. `visible = false`
      // and `draw_in_box = false` — it is composited by the roar's own Draw
      // (the `with (obj_knight_circle) event_user(1)` pass), not by itself.
      const c = spawn(state, knightCircle, {
        x: state.view.x + e.fake_x,
        y: state.view.y + e.fake_y + 55,
      });
      c.r = 0; c.g = 0; c.b = 0;
      c.r_goal = 255; c.g_goal = 255; c.b_goal = 255;
      c.fade_time = 48;
      c.circle_size = 480;
      c.size_goal = 0;
      c.growth = 10;
      c.draw_in_box = false;
      c.visible = false;
      c.destroyAt = 48;
      scrLerpvar(state, spawn, c, 'r_goal', 0, 255, 48, 0);
      scrLerpvar(state, spawn, c, 'g_goal', 0, 255, 48);
      scrLerpvar(state, spawn, c, 'b_goal', 0, 255, 48, 1);
    }

    // THE SCREEN IS PULLED IN. Every third frame until the intensity is
    // nearly maxed, a copy of the WHOLE SCREEN is taken at a jittered point
    // near the vortex and shrunk toward it:
    //
    //     if ((timer % 3) == 0 && intensity < 3.9)
    //         with (instance_create(camerax() + fake_x + irandom_range(-30, 30),
    //                               cameray() + fake_y + 55 + irandom_range(-30, 30),
    //                               obj_afterimage_screen))
    //         { faderate = 0.1 / other.intensity; draw_end = true;
    //           xrate = -0.01; yrate = -0.01; }
    //
    // NEGATIVE rates, so the copies close INWARD — the screen itself being
    // dragged into the vortex, and the visual half of the `player_suck` that
    // is already dragging the soul there. The roar later uses POSITIVE rates
    // for the opposite reading. Missing entirely; reported as the attack
    // being short of effects.
    //
    // `faderate = 0.1 / intensity` means they last LONGER as it winds up
    // (0.1/1.5 clears 0.5 alpha in 8 frames; 0.1/3.9 takes 20), so the echoes
    // pile deeper the closer he gets to roaring.
    if (e.timer % 3 === 0 && e.intensity < 3.9) {
      const g = spawn(state, afterimageScreen, {
        x: state.view.x + e.fake_x + gmlIrandomRange(state.gmlRng, -30, 30),
        y: state.view.y + e.fake_y + 55 + gmlIrandomRange(state.gmlRng, -30, 30),
      });
      g.faderate = 0.1 / e.intensity;
      g.draw_end = true;
      g.xrate = -0.01;
      g.yrate = -0.01;
    }

    if (gmlEq(e.intensity, 3.74) && e.knight_sprite === 'spr_roaringknight_front') {
      e.knight_sprite = 'spr_roaringknight_front_flourish';
      e.knight_sprite_image = 0;
      e.knight_sprite_speed = 0;
      scrLerpvar(state, spawn, e, 'knight_sprite_image', 0, 4, 16);
      // `scr_script_delayed(scr_lerpvar, 8, "fake_alpha", 1, 0, 32)` — he
      // FADES OUT as he flourishes, which is what leaves the vortex alone on
      // screen for the beat before the roar.
      e.fakeAlphaDelay = 7; // `scr_script_delayed(..., 8, ...)`; see above
    }
    if (e.fakeAlphaDelay > 0) {
      e.fakeAlphaDelay -= 1;
      if (e.fakeAlphaDelay === 0) {
        scrLerpvar(state, spawn, e, 'fake_alpha', 1, 0, 32);
      }
    }

    // THE IN-RUSH STREAKS — `timer >= 136 && intensity < 3.75`, ONE EVERY
    // FRAME (`(timer % 1) == 0` is always true; the modulo is vestigial).
    //
    // STREAK_UNIT IS A DEVIATION, taken on a play report and recorded here
    // rather than buried. `spr_pixel_white_front` is FOUR pixels wide (the
    // extracted manifest; its bbox fills all 4x4), so `image_xscale = 320`
    // multiplies out to a **1280-pixel** bar on a 640-pixel view — measured,
    // not estimated: the longest streak the untouched translation put on
    // screen was 1200px, once a frame for the whole 270-frame wind-up. That
    // is the screen-spanning starburst reported as not being in the real
    // fight.
    //
    // Everything around it checks out. The lerp reads (from, to, time) like
    // every other call in this object; the origin is the sprite's RIGHT edge
    // (ox 4) so the body trails backward from the anchor, away from the
    // vortex; drawSpriteExt scales that offset with the sprite and negates
    // image_angle for GameMaker's winding. The translation is literal and the
    // renderer is right — the product is simply not what the fight looks
    // like, which means something in the reading is wrong in a way no capture
    // this project has can locate.
    //
    // Dividing by the sheet width is the reading under which the number
    // becomes physical: 320 as a LENGTH IN PIXELS is about the 480-560px the
    // particle is born out at and travels in, so the streak spans its own
    // approach instead of twice the screen. The count, the cadence, the
    // 480 + irandom(80) spawn ring, the 8-frame in-rush and the 18-frame life
    // are all untouched.
    // Each starts 480-560px out on a random bearing as a 16x0.5 white pixel
    // aimed at the vortex, then four lerps fire at once:
    //
    //     image_xscale  320 -> 2    over 16    a long streak collapsing
    //     image_yscale    2 -> 0.1  over 16
    //     image_alpha     1 -> 0.5  over 16
    //     x, y  ->  the vortex      over 8, curve 1 "out"
    //
    // so it is stretched to 320 wide on its first frame and then whips into
    // the centre in eight. `timer = 18` is its own kill switch — the position
    // lerp finishes at 8 and it sits for ten more frames shrinking.
    //
    // ── THE IN-RUSH STREAKS ARE NOT DRAWN. ──────────────────────────────
    //
    // Everything below is kept and still RUNS — the two irandom draws matter,
    // because the stream is shared and skipping them would move every later
    // roll — but the particle is no longer created, so nothing reaches the
    // screen.
    //
    // WHY. The dump is unambiguous about what it asks for: a 4x4
    // `spr_pixel_white_front` at `image_xscale` lerping 320 -> 2, angled at
    // the vortex, born 480-560px out. Taken literally that is a 1280px streak
    // — twice the width of the 640px screen — several times a frame. Dividing
    // by the sheet width (the STREAK_UNIT reading above) brings it to ~320px,
    // still half the screen.
    //
    // The player, who has the real fight in front of them, reports there are
    // NO streaks across the screen in this attack at all. That is a direct
    // observation of the thing being translated, and it beats a reading this
    // file already admitted it could not make come out right: "something in
    // the reading is wrong in a way no capture this project has can locate."
    //
    // So they are removed rather than left at a fudged length. The research
    // stays here in full: if a future capture explains the 320, restore the
    // spawn and delete this block. Do NOT "fix" it by scaling the number
    // until it looks acceptable — that was the previous attempt.
    const DRAW_INRUSH_STREAKS = false;
    if (e.timer >= 136 && e.intensity < 3.75) {
      const randangle = gmlIrandom(state.gmlRng, 360);
      const randdistance = 480 + gmlIrandom(state.gmlRng, 80);
      const px = state.view.x + e.fake_x + lengthdirX(randdistance, randangle);
      const py = state.view.y + e.fake_y + 55 + lengthdirY(randdistance, randangle);
      const cx = state.view.x + e.fake_x;
      const cy = state.view.y + e.fake_y + 55;
      if (!DRAW_INRUSH_STREAKS) {
        // The draws above have been taken; the particle is not made.
        void px; void py; void cx; void cy;
      } else {
      const p = spawn(state, particleGeneric, { x: px, y: py });
      p.not_outbound = false;
      p.sprite_index = 'spr_pixel_white_front';
      p.direction = pointDirection(px, py, cx, cy);
      p.image_angle = p.direction;
      p.image_xscale = 16 / STREAK_UNIT;
      p.image_yscale = 0.5;
      p.timer = 18;
      scrLerpvar(state, spawn, p, 'image_xscale', 320 / STREAK_UNIT, 2 / STREAK_UNIT, 16);
      scrLerpvar(state, spawn, p, 'image_yscale', 2, 0.1, 16);
      scrLerpvar(state, spawn, p, 'image_alpha', 1, 0.5, 16);
      scrLerpvar(state, spawn, p, 'x', px, cx, 8, 1);
      scrLerpvar(state, spawn, p, 'y', py, cy, 8, 1);
      }
    }

    if (e.roaring_timer < 1 && e.intensity < 4) {
      e.ball_speed = e.intensity * 3;
      if (e.intensity < 3.75) {
        e.player_suck = scrApproach(e.player_suck, 1, 0.1625);
      }
    }
    // Runs unconditionally, right after the ramp — this pair is what pins
    // player_suck at 0.85 rather than 1.
    e.player_suck = scrApproach(e.player_suck, 0, 0.15);

    const heart = state.soul;
    if (heart) {
      const tx = state.view.x + e.fake_x;
      const ty = state.view.y + e.fake_y + 55;
      // THE DIRECTION READS THE PRE-STEP HEART. The roar is born at launch,
      // AFTER the turn's heart is delivered to the arena, so it is the
      // NEWER instance and the runner's newest-first stepping runs its pull
      // before the heart's own move each frame. verify21j f11271 pins it:
      // the heart starts the frame at (212,129), the held DOWN moves it to
      // 133, and the recording's pull lands 212 + 0.5125*cos(-2.337°) =
      // 212.5120697 with +0.0209 in y — the direction from (222,139), the
      // frame-START position. Reading the live heart gave dir exactly 0.
      // Same compensation family as the heart follower and the bar.
      const hp0 = state.soulPrev ?? heart;
      // CLAMPED, because the Step's very first act is
      //
      //     with (obj_heart) { if (x < camerax()) x = camerax(); ... }
      //
      // and the tempdir read at line 100 sees the heart AFTER it. The sim
      // applied that clamp to the LIVE soul but fed the pull the frame-start
      // snapshot, which never saw it. Identical whenever the camera is
      // steady and the soul is already inside — which is every frame the
      // pull was verified on, f11271 included — and wrong on exactly the
      // frames a SHAKE moves the boundary: at f11726 the camera is at (3, 3),
      // so the game clamps the soul from x 0 to x 3 and aims from there,
      // while the sim aimed from 0. Same asymmetry as the clamp above: left
      // and top snap to the edge, right and bottom to 20 inside.
      const cvx = state.view.x;
      const cvy = state.view.y;
      let hpx = hp0.x;
      let hpy = hp0.y;
      if (hpx < cvx) hpx = cvx;
      if (hpx > cvx + 640 - 20) hpx = cvx + 640 - 20;
      if (hpy < cvy) hpy = cvy;
      if (hpy > cvy + 480) hpy = cvy + 480 - 20;
      const hp = { x: hpx, y: hpy };
      // A --roar replay row's RESOLVED tempdir wins over the recomputation:
      // the runner's atan2 differs from JS's in the last bits, and those
      // bits reach the soul's f32-narrowed position (one ULP at f11288) and
      // from there a homing child's discrete turn decision (f11809). Same
      // concession shape as --grazes: give up the term nobody can model,
      // pin everything around it. Free play recomputes live.
      const roarRow = state.roarReplay?.get(state.frame);
      const tempdir = roarRow?.tempdir ?? pointDirection(hp.x + 10, hp.y + 10, tx, ty);
      heart.x += lengthdirX(e.player_suck, tempdir);
      heart.y += lengthdirY(e.player_suck, tempdir);
      // RE-CLAMP AFTER THE SHOVE, with the HEART'S OWN boundary geometry.
      // In the game the heart's Step runs AFTER this one (the roar is the
      // newer instance), so the frame ENDS on the heart's own clamps: x in
      // [0, view+620], y in [0, view.y + 300 + boundaryup] — with the
      // roar's boundaryup 160 that floor is the screen floor, 460. The
      // sim's heart steps first, so without this the reversed suck parks
      // the end-of-frame soul past the edges: verify21j f11715 reads
      // x 0.000 in the recording and -2.37 here, and f11738-11755 hold
      // y 460.000 against a drifting 462.07 (the corral's own bottom clamp
      // only fires past 480 and never pulls it back).
      //
      // A fresh shake's incoming first offset is peeked, exactly as the
      // heart's own step clamp does (sim/soul.js) — without it this clamp
      // dragged the soul back off the shaken floor mid-frame.
      let shx = 0;
      let shy = 0;
      for (const sh of state.entities) {
        if (sh.alive && sh.type.name === 'obj_shake' && sh.active === 0) {
          shx = sh.shakex;
          shy = sh.shakey;
        }
      }
      if (heart.x >= state.view.x + shx + 640 - 20) heart.x = state.view.x + shx + 640 - 20;
      if (heart.x <= 0) heart.x = 0;
      if (heart.y <= 0) heart.y = 0;
      const hfloor = state.view.y + shy + 320 - 20 + (heart.boundaryup ?? 0);
      if (heart.y >= hfloor) heart.y = hfloor;
    }

    e.attack_timer += 1;

    // THE STAR RINGS.
    //
    // Fire when `attack_timer` reaches 4, then reset it to
    // `floor(-1 + intensity)` — so as intensity ramps from 1.5 toward 4 the
    // gap between rings SHRINKS from 4 frames to 1. That single line is the
    // attack's whole build-up.
    //
    // `starcount_p1` gates which of those beats actually spawns: it counts up
    // and only the FIRST of every three fires a ring, until intensity crosses
    // 2.7 and every beat fires.
    if (e.attack_timer === 4) {
      e.rand_dist = 600;
      e.starcount_p1 += 1;
      // choose(-1, 1) — the value is only used by the untranslated variants,
      // but the draw is taken.
      e.spinspeed = gmlChoose(state.gmlRng, [-1, 1]);

      if (e.starcount_p1 === 1 && e.intensity < 3.7) {
        if (e.intensity >= 2.7) {
          // Two stars, opposite each other.
          e.rand_angle += 9;
          for (const off of [0, 180]) {
            const a = e.rand_angle + off;
            fireRingStar(state, e, a, 16);
          }
        } else {
          // Six stars evenly round the ring.
          e.rand_angle += 32;
          for (let i = 0; i < 6; i++) {
            e.rand_angle += 60;
            fireRingStar(state, e, e.rand_angle, 8 + e.intensity);
          }
        }
      }

      if (e.starcount_p1 === 3 || e.intensity >= 2.7) e.starcount_p1 = 0;

      // THE CORRAL, and it is a difficulty ramp disguised as a clamp. Once
      // intensity passes 3, every star still in flight is yanked back inside
      // 60px of the screen on each axis. The stars are fired from 600px out,
      // so late in the attack they stop having a long approach: they appear
      // near the edge and are on you at once.
      //
      // It also THINS them, which is how it was found. A corralled star is
      // much closer to the knight, so it reaches the 12px destroy radius
      // sooner — the engine carried two stars too many at frame 342 without
      // this, not too few.
      //
      // Only on ring beats: this sits inside the `attack_timer == 4` block,
      // not in the per-frame spiral below.
      if (e.intensity >= 3 && e.intensity < 4) {
        const vx = state.view.x;
        const vy = state.view.y;
        for (const d of state.entities) {
          if (!d.alive || d.type.name !== 'obj_knight_roaring_star') continue;
          if (d.x < vx - 60) d.x = vx - 60;
          if (d.x > vx + 640 + 60) d.x = vx + 640 + 60;
          if (d.y < vy - 60) d.y = vy - 60;
          if (d.y > vy + 480 + 60) d.y = vy + 480 + 60;
        }
      }

      e.attack_timer = Math.floor(-1 + e.intensity);
    }

    // ============ THE ROAR ============
    //
    // `intensity` stops ramping at exactly 4 (scr_approach clamps), and that
    // equality opens the last phase of the attack. `roaring_timer` then drives
    // it, and the FIRST thing it does is turn the attack inside out: the
    // spiral below is gated on `roaring_timer < 1`, so from here the stars stop
    // being drawn in toward the knight and are fired OUT from him instead.
    //
    // `player_suck` flips sign with it. It has been positive all attack,
    // dragging the soul in; the roar sets it to -6 and then pins it at -3, and
    // a negative length through `lengthdir_*` pushes the soul AWAY. The pull
    // and the shove are the same three lines of code with a different sign.
    //
    // Settling at exactly -3 is the same fixed-point trick as the 0.85 above:
    // `scr_approach(player_suck, 0, 0.15)` runs every frame and lifts it, and
    // `min(player_suck, -3)` runs every frame and puts it back.
    if (e.intensity === 4) {
      e.roaring_timer += 1;

      if (e.roaring_timer < 169) {
        if (e.roaring_timer === 9) {
          // THE ROAR ITSELF. Eight stars straight out on the compass points.
          //
          // AND `fake_alpha = 1` — THE KNIGHT COMES BACK. This one line was
          // missing, and it is the whole of the reported bug: at intensity
          // 3.74 he fades out over 32 frames behind the white bloom, and the
          // roar is what snaps him back, in a new pose, on the frame he
          // screams. Without it the fade never reversed and he simply never
          // returned — "the knight disappears halfway through". It is a bare
          // assignment, not a lerp: he is THERE, instantly, at full alpha.
          e.fake_alpha = 1;
          // ...continuing the flourish he faded out on, 4 -> 6 over 4 frames.
          scrLerpvar(state, spawn, e, 'knight_sprite_image', 4, 6, 4);
          e.player_suck = Math.min(e.player_suck, -6);
          e.ball_speed = -32;
          e.ball_darkness = 1;
          scrLerpvar(state, spawn, e, 'bobble_freq', 1, 3, 8);
          cue(state, 'snd_knight_roar', 1);

          // THE WHITE FLASH. A plain obj_knight_circle at the vortex with
          // r/g/b already 255 and no goals set, so it opens on its Create
          // defaults (size_goal 960, growth 40) and blows white across the
          // screen — the counterpart of the BLACK one at intensity 3.66,
          // which starts at 0 and lerps its goals up. `visible = false` and
          // `draw_in_box = false`: composited by the roar, unclipped.
          const flash = spawn(state, knightCircle, {
            x: state.view.x + e.fake_x,
            y: state.view.y + e.fake_y + 55,
          });
          flash.r = 255; flash.g = 255; flash.b = 255;
          flash.draw_in_box = false;
          flash.visible = false;

          // `scr_script_repeat(instance_create, 8, 2, x, y, 46)` — object 46
          // is `obj_afterimage_screen`, resolved off the object list
          // (tools/patches/object_ids.csx), NOT from the dump's
          // `__global_object_depths` table, which is partial and does not
          // list the roar's own objects at all. Reading 46 out of that table
          // gives `obj_interactable`, which is how a numeric asset id turns
          // into a wrong answer that looks sourced.
          //
          // max_time 8 at rate 2 = FOUR copies, two frames apart, on the
          // object's own defaults (xrate/yrate +0.01, faderate 0.00625, and
          // `draw_end` false so each draws itself). Positive rates: the
          // screen blows OUTWARD here, against the inward pull that ran for
          // the whole wind-up.
          e.roarGhosts = { left: 8, rate: 2, next: 0 };

          // ...and the eight stars, straight out on the compass points, at
          // `8.5 + random(2)` EACH — a live roll per star, one u32 per
          // iteration. The fullfight replays no roar table, and the flat
          // 8.5 fallback ran the whole burst slow: verify21j f11591's ring
          // leaves at vx 8.50 while the recording's b0 flies 9.04 (its roll
          // was 0.54) — nine pixels short by the catch, which then landed
          // two frames off. The recorded-table path stays for the scenario
          // suites that predate live RNG.
          const burst = state.roarBurstSpeeds ?? null;
          for (let a = 0; a < 8; a++) {
            const spd = burst
              ? (burst[a] ?? 8.5)
              : 8.5 + gmlRandom(state.gmlRng, 2);
            fireRoarStar(state, e, a * 45, spd, 1.2);
          }
        }
        // The repeat's own clock. obj_script_delayed fires on its rate until
        // `max_time` runs out, so this is four spawns and then nothing.
        if (e.roarGhosts && e.roarGhosts.left > 0) {
          if (e.roarGhosts.next <= 0) {
            spawn(state, afterimageScreen, {
              x: state.view.x + e.fake_x,
              y: state.view.y + e.fake_y + 55,
            });
            e.roarGhosts.next = e.roarGhosts.rate;
          }
          e.roarGhosts.next -= 1;
          e.roarGhosts.left -= 1;
        }

        // AND THE ROAR'S OWN SCREEN ECHOES, every third frame for the whole
        // 169-frame scream — `xrate/yrate 0.015, faderate 0.025`. Faster and
        // shorter-lived than the wind-up's, and OUTWARD. This runs alongside
        // the star fans below; it is not gated on them.
        if (e.roaring_timer % 3 === 0) {
          const g = spawn(state, afterimageScreen, {
            x: state.view.x + e.fake_x + gmlIrandomRange(state.gmlRng, -30, 30),
            y: state.view.y + e.fake_y + 55 + gmlIrandomRange(state.gmlRng, -30, 30),
          });
          g.xrate = 0.015;
          g.yrate = 0.015;
          g.faderate = 0.025;
          g.draw_end = true;
        }

        if (e.roaring_timer === 15) {
          // The roar pose, and the only one that plays rather than holds.
          e.knight_sprite = 'spr_roaringknight_front_roar';
          e.knight_sprite_image = 0;
          e.knight_sprite_speed = 0.5;
        }

        if (e.roaring_timer >= 9) e.player_suck = Math.min(e.player_suck, -3);

        if (e.roaring_timer > 15 && e.roaring_timer % 5 === 0) {
          // One per star of the roar's stream, at half volume.
          cue(state, 'snd_stardrop', 0.5, 0.5);
          // A THREE-STAR FAN every five frames, walking around the circle.
          // The walk and every speed ROLL LIVE: `irandom(10)` (two u32) for
          // the step, then `6.5 + random(2)` / `8.5 + random(2)` /
          // `8.5 + random(2)` in spawn order — same fallback story as the
          // burst above.
          let fan;
          if (state.roarFans) {
            fan = state.roarFans[state.roarFanIndex++] ?? {
              rand: 0, s1: 6.5, s2: 8.5, s3: 8.5,
            };
          } else {
            fan = { rand: gmlIrandom(state.gmlRng, 10) };
          }
          e.rand_angle += 60 + fan.rand;

          // ORIGINAL BUG: the line above this in the source aims star_angle1
          // at the soul with `point_direction(knight, obj_heart)` and the very
          // next statement overwrites it with `rand_angle`. The fan does NOT
          // track the player, however much it looks like it means to.
          e.star_angle1 = e.rand_angle;
          e.star_angle2 = e.rand_angle + 20;
          e.star_angle3 = e.rand_angle - 20;

          fireRoarStar(state, e, e.star_angle1, fan.s1 ?? (6.5 + gmlRandom(state.gmlRng, 2)), 1.6);
          fireRoarStar(state, e, e.star_angle2, fan.s2 ?? (8.5 + gmlRandom(state.gmlRng, 2)), 1.6);
          fireRoarStar(state, e, e.star_angle3, fan.s3 ?? (8.5 + gmlRandom(state.gmlRng, 2)), 1.6);
        }
      }

      if (e.roaring_timer === 181) {
        e.knight_sprite = 'spr_roaringknight_front_flourish';
        e.knight_sprite_speed = 0;
        scrLerpvar(state, spawn, e, 'knight_sprite_image', 5.99, 0, 12);

        // THE CATCH. Every star in flight gets positive friction and is queued.
        // `with` iterates NEWEST FIRST, so the queue is youngest-to-oldest and
        // the release below pops it in that order.
        scrLerpvar(state, spawn, e, 'player_suck', e.player_suck, 0, 24);
        for (const d of starsNewestFirst(state)) {
          d.friction = 0.5;
          e.bullet_list.push(d);
        }
      }

      if (e.roaring_timer === 275) {
        // THE WIND-UP TO THE CUT. He shifts to the slash pose and the pre-cut
        // marker starts drawing itself across the screen (`line_timer`), while
        // r/g/b ramp grey -> red so the marker reddens as it extends. The
        // bobble flattens out over 24 frames.
        //
        // 4320 is spr_roaringknight_front_slash — GameMaker asset ids are the
        // index into the sprite list, and /private/tmp/sprite_meta.json is
        // dumped in that order, so `list(meta)[4320]` resolves them.
        e.sprite_index = 'spr_roaringknight_front_slash';
        e.knight_sprite = 'spr_roaringknight_front_slash';
        scrLerpvar(state, spawn, e, 'knight_sprite_image', 0, 2, 8);
        scrLerpvar(state, spawn, e, 'image_index', 0, 2, 8);
        scrLerpvar(state, spawn, e, 'bobble_amp', 4, 0, 24);
        e.line_timer = 0;
        scrLerpvar(state, spawn, e, 'r', 128, 255, 16);
        scrLerpvar(state, spawn, e, 'g', 128, 0, 16);
        scrLerpvar(state, spawn, e, 'b', 128, 0, 16);
      }

      if (e.roaring_timer === 299) {
        // THE CUT. The knight lands the diagonal and the screen itself is
        // severed; `do_fake_screen` triggers the Draw event's finale, which
        // this endStep carries out below.
        e.x = state.view.x + e.fake_x;
        e.y = state.view.y + e.fake_y + 20;
        const gt299 = state.entities.find(
          (x) => x.alive && x.type.name === 'obj_growtangle',
        );
        if (gt299) {
          gt299.image_xscale = 0;
          gt299.image_yscale = 0;
        }
        scrLerpvar(state, spawn, e, 'knight_sprite_image', 2, 5, 6);
        scrLerpvar(state, spawn, e, 'image_index', 2, 5, 6);
        e.do_fake_screen = true;
        cue(state, 'snd_knight_cut', 1);

        // THE CUT IS A REAL SLASH BULLET, not just the screen effect: the
        // original spawns obj_roaringknight_slash across the screen centre
        // at 117 degrees, xscale 4, width x4, slashdir forced -1, inherits
        // the roar's bullet fields, and lets it live out its ordinary
        // shrink-and-die — the recording's last bullet, parked at
        // (247.36, 97.44) from f11881 while everything else is swept
        // (`event_user(0)` on it is a no-op: the slash has no Other_10 and
        // its parents are codeless). The soul is destroyed by the same
        // frame's finale, so it can never connect.
        const cut = spawn(state, roaringknightSlash, {
          x: state.view.x + 320 - lengthdirX(-160, 117),
          y: state.view.y + 240 - lengthdirY(-160, 117),
        });
        cut.direction = 117;
        cut.image_xscale = 4;
        cut.xscale = 4;
        cut.image_angle = 117;
        cut.width *= 4;
        cut.slashdir = -1;
        scrBulletInherit(e, cut);

        // AND HE LEAPS. The cut is a jump-through: he dips 40px over 16 frames
        // easing out, and then — delayed by exactly those 16 — is thrown 360px
        // UP over 24 more, easing in, straight off the top of the screen.
        //
        // `draw_self()` is above the `if (stop) exit;` in the Draw event, so he
        // keeps drawing after the finale has frozen everything else: the knight
        // arcs up OVER the two halves of the cut screen as they fall apart.
        // That is the shot the attack ends on.
        e.jumpimages = true;
        scrLerpvar(state, spawn, e, 'y', e.y, e.y + 40, 16, 1, 'out');
        e.jumpUpDelay = 16;
        e.jumpUpFrom = e.y + 40;
      }

      if (e.jumpUpDelay > 0) {
        e.jumpUpDelay -= 1;
        if (e.jumpUpDelay === 0) {
          scrLerpvar(state, spawn, e, 'y', e.jumpUpFrom, e.jumpUpFrom - 360, 24, 1, 'in');
        }
      }

      if (e.roaring_timer === 363) {
        // He lands back at the knight's own position and warps in.
        e.jumpimages = false;
        const enemy = state.entities.find(
          (x) => x.alive && x.type.name === 'obj_knight_enemy',
        );
        if (enemy) {
          e.x = enemy.x;
          e.y = enemy.y;
        }
        e.sprite_index = 'spr_knight_warp';
        e.image_index = 5;
        e.image_speed = 0;
        scrLerpvar(state, spawn, e, 'image_index', 5, 8, 8);
      }

      if (e.roaring_timer === 375) {
        // THE END OF THE TURN, and Roaring is the one that decides it. The
        // controller (type 107) starts the turn with `global.turntimer =
        // 999999` precisely so the clock cannot cut the attack short; this is
        // where it hands the turn back. Without it the scheduler ended Roaring
        // on a 240-frame clock, halfway through the spiral, and then started
        // it again.
        const knight = state.entities.find(
          (x) => x.alive && x.type.name === 'obj_knight_enemy',
        );
        if (knight) knight.image_alpha = 1;
        // CleanUp also hands the knight back: `chargeupcon = 0` — he was
        // hidden from ROARING's launch (con 2, see create below).
        if (state.knight) state.knight.chargeupcon = 0;
        // `siner2 = 0` — the THIRD thing the CleanUp does, and the sim was
        // missing it. The bob is frozen for the whole attack (the Draw's
        // `if (!i_ex(obj_knight_roaring2)) siner2++`), so without the reset
        // he resumes from whatever phase the roar happened to freeze him at
        // and the hover reads as drifting from the wrong height. Zeroing it
        // puts him at `ystart + cos(0) * 8` — the top of the bob, the same
        // place the fight starts him.
        if (knight) knight.siner2 = 0;

        // `with (obj_growtangle) { growcon = 3; timer = 0; }` — the arena
        // collapses instead of just vanishing when the turn is swept.
        const gt = state.entities.find(
          (x) => x.alive && x.type.name === 'obj_growtangle',
        );
        if (gt) {
          gt.growcon = 3;
          gt.timer = 0;
        }

        state.turntimer = -1;
      }

      if (e.roaring_timer >= 182 && e.bullet_list.length) {
        // ONE STAR PER FRAME is promoted to con 1, which starts its brake ->
        // gravity-reversal -> six-child burst arc (sim/attacks/roaring-star.js,
        // already verified). That staggered release is what makes the finale
        // read as a wave rather than one detonation.
        const bul = e.bullet_list.shift();
        if (bul && bul.alive) bul.con = 1;
      }
    }

    // THE SPIRAL, and it lives HERE rather than in the bullet.
    // obj_knight_roaring_star has no `con == 0` branch at all — a ring star
    // does nothing of its own until the controller promotes it to con 1. Every
    // frame the controller instead re-aims each star at the knight and then
    // pushes it 90 degrees off that aim. `speed` (accelerating on the negative
    // friction) carries it inward while this tangential term carries it
    // around, and the sum is the spiral. `spinspeed` picks which way it winds.
    //
    // The star's SCALE is re-derived here too, from its distance to the knight
    // at 1/170 per pixel with a floor of 0.2 — which is why the stars shrink
    // as they fall in rather than growing like the Stars attack's do.
    //
    // Order does not matter even though the original is a `with` (newest
    // first): each star reads only its own state and the controller's.
    //
    // DEAD GATE preserved: the original nests `if (roaring_timer < 180)`
    // inside `if (roaring_timer < 1)`, so it can never be false.
    if (e.roaring_timer < 1) {
      const tx = state.view.x + e.fake_x;
      const ty = state.view.y + e.fake_y + 55;
      for (const d of state.entities) {
        if (!d.alive || d.type.name !== 'obj_knight_roaring_star') continue;

        if (e.roaring_timer < 180) {
          const scale = Math.max(0.2, 0.0058823529411764705 * pointDistance(d.x, d.y, tx, ty));
          d.image_xscale = scale;
          d.image_yscale = scale;
          d.direction = pointDirection(d.x, d.y, tx, ty);
          // `speed * 0.625 * (1 / intensity)`, and the shape matters: the
          // original takes the RECIPROCAL first and multiplies. Written as a
          // division instead, one star of the ring landed a single f32 ulp off
          // in y and stayed there.
          const step = d.speed * 0.625 * (1 / e.intensity);
          const swirl = d.direction + 90 * d.spinspeed;
          d.x += lengthdirX(step, swirl);
          d.y += lengthdirY(step, swirl);
        }

        if (pointDistance(d.x, d.y, tx, ty) < 12) destroy(d);
      }
    }
  },

  /**
   * THE DRAW EVENT'S OWN COUNTERS.
   *
   * obj_knight_roaring2's Draw advances four values as a side effect of
   * rendering, and the whole look depends on them:
   *
   *   ball_counter  += ball_speed, wrapped to [0, 1800) — the radius of the six
   *                    concentric rings multiplied over the vortex. `ball_speed`
   *                    is 2 while he charges and flips to -32 at the roar, which
   *                    is what makes the rings slam outward.
   *   hsv           counts 128 -> 288 -> 128, `hsv_switch` flipping at each end.
   *                 That is the vortex's hue sweep, one colour per frame.
   *   star_flicker  alternates 2 -> 0 -> 2, moving the scanline grate a pixel.
   *   intensify     tracks `intensity` until 3.75, then decays to 0 at 0.1 a
   *                 frame. It scales the knight's per-scanline wobble, so the
   *                 figure thrashes hardest right as the roar peaks and settles
   *                 as it ends.
   *
   * endStep is the phase that sits where Draw does. Keeping them here rather
   * than in render/ means a headless run produces the same numbers a browser
   * does — the renderer stays a pure reader.
   */
  /**
   * `star_flicker` is flipped AFTER the grate is drawn with it, so it advances
   * in beginStep — see the note on obj_tracking_sword1's beginStep for why the
   * two Draw-counter phases are not interchangeable.
   */
  beginStep(e) {
    if (!e.stop) e.star_flicker = 2 - e.star_flicker;
  },

  endStep(e, state) {
    // THE PINNED SOUL'S END-OF-FRAME CLAMP, once more with the FINAL view.
    // The step-phase clamp above ran before obj_shake's own first Step
    // (spawn order puts the shake last), so on a shake's FIRST frame it
    // clamped against the unshaken view; the game's heart steps after the
    // shake's set and its floor rides the offset. End steps run after every
    // step, so the view here is the frame's final one: verify21j
    // f11756-11759 holds the edge-pinned soul at 464/456/463/458 — the
    // shaken floor — where a view-0 clamp froze it at 460.
    if (state.soul && (e.timer ?? 0) > 128) {
      const heart = state.soul;
      // Left and top are ABSOLUTE zero (the heart's own `x + px <= 0`
      // form); right and floor are view-relative. The recording holds
      // x 0.000 through the shake while the floor rides it.
      if (heart.x >= state.view.x + 640 - 20) heart.x = state.view.x + 640 - 20;
      if (heart.x <= 0) heart.x = 0;
      if (heart.y <= 0) heart.y = 0;
      const hfloor = state.view.y + 320 - 20 + (heart.boundaryup ?? 0);
      if (heart.y >= hfloor) heart.y = hfloor;
    }

    // THE FINALE, and it lives at the bottom of the Draw event in the original:
    // the composite is snapshotted into two sprites cut along the -63 degree
    // diagonal, `obj_heart` is DESTROYED, `stop` is set so nothing draws again,
    // and the two halves are handed to markers that slide apart.
    //
    // The renderer takes its snapshot on this same frame — it keys off
    // `do_fake_screen`, not `stop`, precisely so the last composited frame is
    // the one that gets cut up.
    if (e.do_fake_screen && !e.stop) {
      e.stop = true;

      for (const k of state.entities) {
        if (k.alive && k.type.name === 'obj_knight_pointing_starchild') destroy(k);
      }

      // camerawidth() * 0.5 and cameraheight() * 0.5; the two sprites are
      // created with their origins at these points and placed there, so each
      // half starts exactly where it was.
      const left = spawn(state, screenPiece, {
        x: state.view.x + 160,
        y: state.view.y + 240,
      });
      left.piece = 0;
      left.direction = 180;
      left.gravity_direction = 180;
      left.gravityDelay = 12;
      scrLerpvar(state, spawn, left, 'speed', 15, 0.5, 12, 1, 'out');

      const right = spawn(state, screenPiece, {
        x: state.view.x + 480,
        y: state.view.y + 240,
      });
      right.piece = 1;
      right.direction = 0;
      right.gravity_direction = 0;
      right.gravityDelay = 12;
      scrLerpvar(state, spawn, right, 'speed', 14, 0.5, 12, 1, 'out');

      // `with (obj_heart) instance_destroy();` — the soul is cut in half with
      // the screen. The scene puts one back at the top of the next turn; see
      // clearTurn in sim/scenes/fight.js.
      if (state.soul) {
        destroy(state.soul);
        state.soul = null;
      }
    }

    if (e.stop) return;

    e.ball_counter += e.ball_speed;
    if (e.ball_counter < 0) e.ball_counter += 1800;
    if (e.ball_counter > 1800) e.ball_counter -= 1800;

    if (!e.hsv_switch) e.hsv += 1;
    else e.hsv -= 1;
    if (e.hsv >= 288) e.hsv_switch = true;
    if (e.hsv <= 128) e.hsv_switch = false;

    if (e.intensity < 3.75) e.intensify = e.intensity;
    else e.intensify = scrApproach(e.intensify, 0, 0.1);
  },
};

/** `with (obj_knight_roaring_star)` order: newest first. */
function starsNewestFirst(state) {
  return state.entities
    .filter((d) => d.alive && d.type.name === 'obj_knight_roaring_star')
    .sort((a, b) => b.seq - a.seq);
}

/**
 * A roar star: fired FROM the knight outward, the mirror image of a ring star.
 *
 * No negative friction and no `spinspeed` — these fly straight out at constant
 * speed, and the spiral that would have read `spinspeed` is switched off for
 * the rest of the attack. The original does not set it either.
 *
 * They start at `image_xscale = 0.1` and a tween grows them to `finalScale`
 * over 32 frames, which the offscreen cull reads through `sprite_width`.
 */
function fireRoarStar(state, e, direction, speed, finalScale) {
  const d = spawn(state, roaringStar, {
    x: state.view.x + e.fake_x,
    y: state.view.y + e.fake_y + 55,
  });
  d.wall_destroy = false;
  d.bottomfade = false;
  d.destroyonhit = false;
  d.direction = direction;
  d.speed = speed;
  d.image_xscale = 0.1;
  d.image_yscale = 0.1;
  scrLerpvar(state, spawn, d, 'image_xscale', 0.1, finalScale, 32);
  scrLerpvar(state, spawn, d, 'image_yscale', 0.1, finalScale, 32);
  return d;
}

/**
 * One star of a ring: created out on a circle of `rand_dist` around the
 * knight and aimed straight at him, with NEGATIVE friction so it accelerates
 * inward the whole way.
 */
function fireRingStar(state, e, angle, speed) {
  const cx = state.view.x + e.fake_x;
  const cy = state.view.y + e.fake_y;
  const d = spawn(state, roaringStar, {
    x: cx + lengthdirX(e.rand_dist, angle),
    y: cy + lengthdirY(e.rand_dist, angle),
  });
  d.wall_destroy = false;
  d.destroyonhit = false;
  d.bottomfade = false;
  // REQUIRED, not decoration: `spinspeed` exists nowhere in
  // obj_knight_roaring_star's own code — not its Create, not its Step. The
  // spawner is the only thing that ever sets it and the controller's spiral is
  // the only thing that reads it. Leaving it out made `90 * spinspeed` NaN and
  // poisoned x/y on every ring star.
  d.spinspeed = 1;
  // The original also sets `visible = false` here. NOT mirrored: the stars are
  // drawn manually by the controller's Draw (event_user on each one), so in the
  // game invisibility costs nothing, while a renderer that draws by sprite
  // would simply lose them.
  d.image_index = 0;
  d.image_speed = 0;
  d.image_xscale = 2;
  d.image_yscale = 2;
  d.direction = pointDirection(d.x, d.y, cx, cy + 55);
  d.speed = speed;
  d.friction = -0.1;
  return d;
}
