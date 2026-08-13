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

import { spawn } from '../entity.js';
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
    } else if (e.con === 1) {
      e.timer += 1;
    }

    e.siner += 1;
    e.y = e.ystart + Math.sin(e.siner / 16) * 8;
  },
};
