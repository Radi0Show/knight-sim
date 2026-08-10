// obj_knight_pointing_star — the bullets of `Stars` (ac 1, dc.type 98).
//
// Spawned by the controller every ~4 frames from the cone's mouth while the
// cone is open. They drift outward growing, then the cone fires them all at
// once, then each bursts into starchildren.
//
// Lifecycle (con), driven from the Step:
//   0  drift and grow: image_x/yscale += growspeed (0.02) per frame
//   1  friction = 0.5, immediately con++   (set externally — see below)
//   2  mask on. Once friction has braked speed to 0: gravity 0.1 pointing
//      BACKWARDS along the original direction (direction - 180), friction 0.
//      That reverses the star and accelerates it back the way it came.
//      After 40 frames -> con 3.
//   3  scale up over 2 frames; at timer 3 burst into 6 starchildren; at
//      timer >= 4 destroy self.
//
// **`con 0 -> 1` is set by the CONE, not here.** obj_knight_pointing_cone
// flips every live star at once inside its `turntimer <= endtimer` branch —
// that is the "fire" moment. See pointing-cone.js.
//
// NOT translated: obj_knight_pointing_starchild (148-line tracking bullet that
// homes on obj_heart_follower). The burst is modelled as a count so the star's
// own lifecycle can be verified; the children are a separate unit of work.
// Also not translated: sprite animation, afterimages, sounds.

import { destroy } from '../entity.js';
import { clamp01 } from '../gml.js';
import { HEART_MASK, masksOverlap, STAR_MASK } from '../masks.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';

export const pointingStar = {
  name: 'obj_knight_pointing_star',

  create(e, state) {
    scrBulletInit(e);
    e.growspeed = 0.02;
    e.image_xscale = 0;
    e.image_yscale = 0;
    e.even = false;
    e.destroyonhit = false;
    e.timer = 0;
    e.con = 0;
    e.growstart = 0;
    e.playSound = true;
    e.damage = 1;
    e.grazepoints = 2;
    e.element = 5;
    e.difficulty = 0;
    e.grazetimer = 0;
    e.side = 0;
    e.init = false;
    e.rotation = 0;

    // The Create's `dir = choose(-1, 1)` is Draw-only, but it CONSUMES a draw.
    // Scenes that need stream fidelity must account for it; here the value is
    // unused so the draw is simply not taken (documented deviation).
    e.dir = 1;

    e.isBullet = true;
    e.builtinMotion = true;
    e.speed = 0;
    e.direction = 0;
    e.image_angle = 0;
    e.maskOff = true; // mask_index only becomes the star mask at con 2
    e.burst = 0; // starchildren that WOULD have spawned
  },

  step(e, state) {
    // Offscreen cull, from the top of the original Step.
    if (
      e.x < state.view.x - 12 ||
      e.y < state.view.y - 18 ||
      e.y > state.view.y + 480 + 18
    ) {
      destroy(e);
      return;
    }

    if (!e.init) e.init = true;

    e.grazetimer += 1;
    if (e.grazetimer % 4 === 0) e.grazed = 0;

    if (e.con === 0) {
      e.image_xscale += e.growspeed;
      e.image_yscale += e.growspeed;
    } else if (e.con === 1) {
      e.friction = 0.5;
      e.con += 1;
    } else if (e.con === 2) {
      e.maskOff = false; // mask_index = spr_knight_bullet_star_mask
      if (e.speed === 0) {
        // Friction has braked it to a stop; now it falls BACKWARDS along its
        // original heading and accelerates away.
        e.gravity = 0.1;
        e.gravity_direction = e.direction - 180;
        e.friction = 0;
      }
      e.timer += 1;
      if (e.timer >= 40) {
        e.timer = 0;
        e.con += 1;
      }
      e.growstart = e.image_xscale;
    } else if (e.con === 3) {
      e.timer += 1;
      e.image_xscale = e.growstart + clamp01(e.timer / 2);
      e.image_yscale = e.growstart + clamp01(e.timer / 2);

      if (e.timer === 3) {
        // Burst: six starchildren in a fan. The children are not translated;
        // record the count so the star's lifecycle stays verifiable.
        e.burst = 6;
        e.active = false;
      }
      if (e.timer >= 4) {
        destroy(e);
      }
    }
  },

  collides(e, heart) {
    return masksOverlap(
      HEART_MASK, heart.x, heart.y,
      STAR_MASK, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle,
    );
  },

  other15: collidebulletOther15,
};
