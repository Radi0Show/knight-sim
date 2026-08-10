// obj_knight_rotating_slash — attack 4, `rotatingslash` (myattackchoice 5).
//
// The first translated attack the fight ACTUALLY USES: the selector picks it
// in every phase, and combinationattack chains it too. Reached from
// obj_dbulletcontroller `type = 104`, which is a thin wrapper that creates
// this object, sets difficulty, and fires event_user(0).
//
// Shape: a rotating aimer that periodically fires a fan of slashes at the
// soul. States advance intro -> aim -> slash -> cooldown -> (aim | slash |
// return), driven entirely by `timer`.
//
//   aim      spin the aim direction, lock onto the soul on frame 1
//   slash    build `slash_number` angles evenly spaced around a circle,
//            offset by random_offset + aim_direction, shuffle them, then fire
//            one obj_roaringknight_slash per frame from the list
//   cooldown step slash_array to the next fan size, then loop
//
// Both things it spawns are already translated and oracle-verified:
// obj_roaringknight_slash (attack 1) and, via quickslash_big, the
// split_growtangle organism (attack 3).
//
// NOT translated (cosmetic, and none of it touches frame state): the knight's
// sprite/lerp movement, obj_knight_circle, particle bursts, obj_afterimage
// debris, sounds, and the colour ramps (r/g/b, line_width).
//
// SHUFFLE CAVEAT: ds_list_shuffle consumes 16 draws per element but its
// algorithm is unsolved (see CLAUDE.md). This uses our own Fisher-Yates over
// gmlRng — statistically equivalent, NOT bit-identical. The real game
// reshuffles every playthrough, so order is not a fidelity property; the
// oracle diff fixes the order on both sides to pin the mechanics.

import { spawn } from '../entity.js';
import { roaringknightSlash } from './roaringknight-slash.js';
import { scrApproach } from '../gml.js';
import { gmlChoose, gmlIrandom, gmlU32 } from '../rng.js';

/** Fisher-Yates over the real generator. See SHUFFLE CAVEAT above. */
function shuffleList(list, rng) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = gmlU32(rng) % (i + 1);
    const t = list[i];
    list[i] = list[j];
    list[j] = t;
  }
  return list;
}

export const rotatingSlash = {
  name: 'obj_knight_rotating_slash',

  create(e, state) {
    // scr_bullet_init()
    e.grazed = 0;
    e.grazetimer = 0;
    e.destroyonhit = 1;
    e.target = 0;
    e.inv = 60;
    e.damage = 10;
    e.element = 0;
    e.grazepoints = 1;
    e.timepoints = 1;
    e.active = 1;
    e.updateimageangle = 0;

    e.difficulty = 2;
    e.slash_number = 1;
    e.rotation = 16;
    e.rotation_base = 16;
    e.rotation_change = 1;
    e.rotation_goal = 2;
    e.timer = 0;
    e.state = 'intro';
    e.turn_type = 'full';
    e.local_turntimer = 0;
    e.aim_direction = 0;
    e.spin = state.spinSequence
      ? state.spinSequence[state.spinIndex++]
      : gmlChoose(state.gmlRng, [-1, 1]);
    e.random_offset = gmlIrandom(state.gmlRng, 360);
    e.slash_array = [1, 2, 2, 3, 3, 4];
    e.slash_counter = 0;
    e.final_counter = 0;
    e.slash_base = 18;
    e.slash_offset = 6;
    e.speed_gain = 16;
    e.cooldown_time = 6;
    e.slash_timer = 8;
    e.aim_type = 0;
    e.anchor_x = e.x;
    e.anchor_y = e.y;
    e.aim_x = e.x;
    e.aim_y = e.y;
    e.slash_list = [];
    e.movebox_x = 40;
    e.movebox_y = 60;
    e.do_final = true;
    e.turn_limit_4 = 270;
    e.done = false;
  },

  /** Other_10 — event_user(0), fired by the controller right after create. */
  init(e) {
    if (e.difficulty === 1) {
      e.slash_offset = 6;
      e.slash_number = 3;
      e.slash_array = [2, 3, 4, 4, 4, 4];
    }
    if (e.difficulty === 2) {
      e.slash_offset = 0;
      e.slash_number = 3;
      e.slash_array = [3, 4, 4, 4, 4, 4];
    }
    if (e.turn_type === 'full') e.local_turntimer = 400;
    if (e.turn_type === 'start') e.local_turntimer = 320;
    if (e.turn_type === 'end') {
      e.local_turntimer = 300;
      e.timer = 15;
    }
  },

  step(e, state) {
    if (e.done) return;
    e.local_turntimer -= 1;

    if (e.state === 'intro') {
      e.timer += 1;
      if (e.timer > 16) {
        e.state = 'aim';
        e.timer = 0;
      }
    }

    if (e.state === 'aim') {
      e.timer += 1;
      if (e.timer === 1) {
        e.rotation = e.rotation_base;
        e.spin = state.spinSequence
      ? state.spinSequence[state.spinIndex++]
      : gmlChoose(state.gmlRng, [-1, 1]);
        e.movebox_x += 20 + gmlIrandom(state.gmlRng, 40);
        e.movebox_y += 30 + gmlIrandom(state.gmlRng, 60);
        if (e.movebox_x > 80) e.movebox_x -= 80;
        if (e.movebox_y > 120) e.movebox_y -= 120;
      }

      // Order matters: the aim spins BEFORE the frame-1 lock-on below, and
      // rotation eases toward its goal every frame of the state.
      e.aim_direction += e.rotation * e.spin;
      e.rotation = scrApproach(e.rotation, e.rotation_goal, e.rotation_change);

      if (e.timer === 1 && e.aim_type === 0) {
        const heart = state.soul;
        e.aim_x = heart.x + 10;
        e.aim_y = heart.y + 10;
      }

      if (e.timer === e.slash_base + 6 + e.slash_offset) {
        e.state = 'slash';
        e.timer = 0;
      }
    }

    if (e.state === 'slash') {
      e.timer += 1;
      if (e.timer === 1) {
        e.slash_list = [];
        for (let a = 0; a < e.slash_number; a++) {
          e.slash_list.push(
            (360 / (e.slash_number * 2)) * a + e.random_offset + e.aim_direction,
          );
        }
        if (state.fixedSlashOrder === true && state.angleLists) {
          // Replay the oracle's shuffled order (see SHUFFLE CAVEAT).
          const rec = state.angleLists[state.angleIndex++];
          if (rec) e.slash_list = [...rec];
        } else {
          shuffleList(e.slash_list, state.gmlRng);
        }
      }

      if (e.timer - 1 < e.slash_list.length) {
        const s = spawn(state, roaringknightSlash, { x: e.aim_x, y: e.aim_y });
        s.direction = e.slash_list[e.timer - 1];
        s.image_xscale = 2;
        s.xscale = 2;
        s.image_angle = s.direction;
        s.visible = false;
        s.width = s.width * 2;
        s.aoe = true;
      }

      if (e.timer === e.slash_timer) {
        e.state = 'cooldown';
        e.timer = 0;
      }
    }

    if (e.state === 'cooldown') {
      e.timer += 1;
      if (e.timer === e.cooldown_time || e.local_turntimer < 200) {
        e.slash_counter += 1;
        if (e.slash_counter < e.slash_array.length) {
          e.slash_number = e.slash_array[e.slash_counter];
        }

        if (e.aim_type < 2) {
          e.state = 'aim';
          e.timer = 0;
          return;
        }

        // aim_type 2 is the finale: fire continuously, accelerating the spin.
        e.state = 'slash';
        e.timer = 0;
        e.aim_direction += e.speed_gain * e.spin;
        e.speed_gain = scrApproach(e.speed_gain, 24, 1);
        e.final_counter += 1;
        if (e.final_counter === 28) {
          e.state = 'return';
          e.done = true;
        }
      }
    }
  },
};

/** obj_dbulletcontroller `type = 104`. */
export function spawnRotatingSlash(state, x, y, { difficulty = 0 } = {}) {
  const e = spawn(state, rotatingSlash, { x, y });
  e.difficulty = difficulty;
  rotatingSlash.init(e);
  return e;
}
