// obj_knight_swordtunnelanim — the knight's performance during Sword Tunnel.
//
// Created by obj_sword_tunnel_manager's Create, at the knight's position. It is
// a real instance with real state, not a decoration: it takes over the
// knight's appearance for the whole attack, and `obj_knight_enemy`'s own Draw
// begins with
//
//     if (i_ex(obj_knight_swordtunnelanim)) exit;
//
// so while this exists the knight does not draw himself at all. Missing that
// left the idle knight standing there through the corridor.
//
// con 0, the part you see:
//
//   timer 1    image_index tweens 0 -> 4 over 10 frames (he draws back and
//              points), and `dir` swings 4 -> -18 over 40 on an ease-in
//   timer 20   image_alpha tweens 1 -> 0 over 10 and hspeed becomes -4, so he
//              fades as he sweeps off to the left
//   timer 26   the trail stops
//   timer 60   con 1
//
// con 1 is almost entirely SOUND — the shinka ambience bed and a leaf-pitch
// ramp — and is not translated here beyond the state it keeps, because audio
// is plumbed but silent (CLAUDE.md, Assets).
//
// The bob is `y = ystart + sin(siner / 16) * 8`: same amplitude as the
// knight's idle bob but on sin and a 16-divisor rather than cos and 8, so it
// reads as a slower, deeper sway.

import { gmlRandom, gmlRandomRange } from '../rng.js';
import { spawn, destroy } from '../entity.js';
import { scrLerpvar } from '../lerpvar.js';

export const swordTunnelAnim = {
  name: 'obj_knight_swordtunnelanim',

  create(e, state) {
    e.con = 0;
    e.timer = 0;
    e.siner = 0;
    e.animindex = 0;
    e.sprite_index = 'spr_roaringknight_point_ol';
    e.image_speed = 0;
    e.image_index = 0;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.drawtrail = true;
    e.shadowtimer = 0;
    e.dir = 4;
    e.fadeaudio = 0;
    e.fadeaudio2 = 0;
    e.shinkafade = 0;
    e.leafpitch = 1;
    e.endtimer = 0;
    e.componentMotion = true;
    e.hspeed = 0;
    e.vspeed = 0;
    e.ystart = e.y;

    // `depth = obj_growtangle.depth - 1` — in front of the arena.
    const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
    e.depth = (gt ? gt.depth : 5) - 1;
  },

  step(e, state) {
    if (e.con === 0) {
      // TWO PITCH ROLLS EVERY THIRD FRAME, checked BEFORE the increment:
      //
      //     if (timer < 60) if ((timer % 3) == 0) {
      //         snd_play_x(226, 0.8 * fadeaudio, 1 + random(0.2));  // twice
      //     }
      //
      // The rolls are call-site pitch arguments — step-phase, LIVE on the
      // anchored stream (the snd wrappers themselves never roll). Sound
      // asset 226's name is not yet identified, so the draws are consumed
      // without a cue; the audible half can land when it is.
      if (e.timer < 60 && e.timer % 3 === 0 && state.gmlRng) {
        gmlRandom(state.gmlRng, 0.2);
        gmlRandom(state.gmlRng, 0.2);
      }
      e.timer += 1;

      if (e.timer === 1) {
        scrLerpvar(state, spawn, e, 'image_index', 0, 4, 10);
        scrLerpvar(state, spawn, e, 'dir', 4, -18, 40, 2);
      }
      if (e.timer === 20) {
        scrLerpvar(state, spawn, e, 'image_alpha', 1, 0, 10);
        e.hspeed = -4;
      }
      if (e.timer === 26) e.drawtrail = 0;
      if (e.timer === 60) {
        e.timer = 0;
        e.con = 1;
      }
    }
    // A SEPARATE IF, not else-if: the dump's con-0 and con-1 blocks are
    // sequential, so on the transition frame (timer 60 -> con 1, timer 0)
    // the con-1 block runs the SAME frame — its timer ticks to 1 and the
    // lerpvars arm immediately. An else-if delayed all of that a frame and
    // phase-shifted every %3 pitch pair after it.
    if (e.con === 1) {
      e.timer += 1;
      // Con 1's pair, POST-increment and UNGATED BY TIME — the leaf-pitch
      // pair fires every third frame until the turn-end teardown destroys
      // the anim (`global.turntimer < 10`, endtimer 8):
      //
      //     if ((timer % 3) == 0) {
      //         snd_play_x(226, ..., leafpitch + random_range(0, 0.2));  // twice
      //     }
      if (e.timer % 3 === 0 && state.gmlRng) {
        gmlRandomRange(state.gmlRng, 0, 0.2);
        gmlRandomRange(state.gmlRng, 0, 0.2);
      }
    }

    // THE TEARDOWN, which was described in a comment here and never written:
    //
    //     if (global.turntimer < 10)
    //     {
    //         endtimer++;
    //         image_alpha = 1;
    //         x = obj_knight_enemy.x;
    //         if (endtimer == 1) { sprite_index =
    //             spr_roaringknight_ball_transition_sword;
    //             image_index = 5; image_speed = 0.5; }
    //         if (endtimer == 8) instance_destroy();
    //     }
    //
    // Without it the anim survived until the end-of-turn sweep reaped it —
    // THREE FRAMES LATE, on all five sword-tunnel turns. That is invisible in
    // every traced column, because the only thing it changes is whether the
    // Knight's own Draw exits: `if (i_ex(obj_knight_swordtunnelanim)) exit;`.
    // The draw log sees it as 15 frames the game draws him and the sim does
    // not, in five runs of exactly 3.
    // MINUS ONE, reading the clock the GAME's step sees. This is the same
    // compensation sim/tension.js already applies to the graze gate, and for
    // the same reason: the sim decrements `turntimer` in the END step, after
    // this pass, so a mid-step reader here is one ahead of the game's.
    //
    // Measured, not assumed. The two clocks are IDENTICAL digit for digit —
    // oracle_box.csv and the sim both read 10.1333333333 on the frame before
    // the cut and 9.1333333333 after — so the earlier guess that the sim's
    // turntimer "crossed 10 a frame late" was wrong. What differs is only
    // which side of the decrement this test lands on, and the draw log
    // measures it as exactly one frame per sword tunnel, five times.
    if (state.turntimer - 1 < 10) {
      e.endtimer = (e.endtimer ?? 0) + 1;
      e.image_alpha = 1;
      const knight = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_enemy',
      );
      if (knight) e.x = knight.x;
      if (e.endtimer === 1) {
        e.sprite_index = 'spr_roaringknight_ball_transition_sword';
        e.image_index = 5;
        e.image_speed = 0.5;
      }
      if (e.endtimer === 8) {
        destroy(e);
        return;
      }
    }

    e.siner += 1;
    e.y = e.ystart + Math.sin(e.siner / 16) * 8;
  },
};
