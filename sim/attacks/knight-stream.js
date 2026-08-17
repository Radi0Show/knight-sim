// obj_knight_stream + obj_bullet_knight_stream + obj_knight_streamline —
// myattackchoice 4 ("xattacks"), reached through obj_dbulletcontroller
// `type = 103`.
//
// *** NOT IN THE FIGHT. *** ac 4 sits in the knight's dispatch table but no
// row of the selector (Other_10) ever assigns it, so it is debug content in
// the same class as ac 12 diagonal and ac 6 underbox — see CLAUDE.md, THE
// REAL FIGHT. It is offered in SINGLE practice and labelled UNUSED there.
//
// THE SHAPE. A pair of crossed beams sweeps the arena, and the beams are
// telegraphs, not hitboxes: what hurts is the diamonds they shed sideways.
//
//   timer 20   two obj_bullet_knight_stream at the box centre, offset up to
//              40px along ONE axis (`plane_shift = choose(true, false)`
//              picks which), aimed at `slash_angle` and its mirror
//              `180 - slash_angle`
//   timer 23   each beam sprouts a streamline 60px to either side
//   timer 26   another pair at 120px
//   timer 29   another at 180px, and `can_do_slashes` latches false
//   timer 45   `slash_angle += 25 + irandom(25)`, wrapping by -40 past 70,
//              and the timer resets — so the cross rotates every 45 frames
//
// THE BEAMS HAVE NO PARENT. obj_bullet_knight_stream and obj_knight_streamline
// are parented to nothing at all — no scr_bullet_init, no Other_15, no damage
// — so they cannot touch the soul. Only the diamonds can, and they are plain
// `obj_regularbullet` (parent obj_collidebullet).
//
// THE DIAMONDS keep `scr_bullet_init`'s placeholder damage of 10, because
// `scr_fire_bullet` is called without its inherit flag. That is the original's
// behaviour, not an oversight of this port: nothing anywhere hands this attack
// a damage value. Against the party's DF it lands as 1. Left as the game has
// it and asserted that way, rather than "fixed" into a number the dump does
// not contain.
//
// VERIFICATION STATUS: translated from the dump, not oracle-diffed — the
// attack is unreachable in a real fight, so there is nothing to record it
// against without a debug hook. Mechanics are line-for-line; the beam
// rendering is in render/draw/knight-stream.js.

import { spawn, destroy } from '../entity.js';
import { lengthdirX, lengthdirY, scrApproach } from '../gml.js';
import { gmlIrandomRange, gmlIrandom, gmlChoose } from '../rng.js';
import { scrBulletInit, regularbulletCreate, regularbulletStep, collidebulletOther15 } from '../bullets/regularbullet.js';
import { STREAMDIAMOND_MASK, enginePairHit } from '../masks.js';

/** obj_knight_streamline — the grey precursor line. Visual only. */
export const knightStreamline = {
  name: 'obj_knight_streamline',

  create(e) {
    e.x1 = e.x;
    e.y1 = e.y;
    e.x2 = e.x;
    e.y2 = e.y;
    e.width = 4;
    e.width_goal = 4;
    e.line_length = 0;
    e.timer = 0;
    // NOT a bullet: no parent, so no scr_bullet_init and no collision.
    e.isBullet = false;
  },

  step(e) {
    e.timer += 1;
    if (e.timer === 6) e.width_goal = 0;
    if (e.timer >= 12) destroy(e);
  },

  /**
   * The width/length ramps live in the MANAGER's Draw in the original, which
   * means they advance once per frame like any other state. They are here so
   * the renderer stays a pure function of sim state (the 30Hz rule).
   */
  endStep(e) {
    e.line_length = scrApproach(e.line_length, 400, 60);
    e.width = scrApproach(e.width, e.width_goal,
      Math.min(Math.abs(e.width_goal - e.width) * 0.5, 16));
    e.x1 = e.x + lengthdirX(200, e.direction);
    e.y1 = e.y + lengthdirY(200, e.direction);
    e.x2 = e.x1 + lengthdirX(e.line_length, e.direction + 180);
    e.y2 = e.y1 + lengthdirY(e.line_length, e.direction + 180);
  },
};

/** obj_regularbullet as this attack fires it: a diamond at speed 15. */
export const streamDiamond = {
  name: 'obj_bullet_stream_diamond',

  create(e, state) {
    regularbulletCreate(e, state);
    e.sprite_index = 'spr_diamondbullet';
    // `visible = false` — the manager draws every obj_regularbullet itself,
    // CLIPPED TO THE BOX, so an unclipped instance draw would put diamonds
    // outside the arena. The renderer honours this the same way.
    e.visible = false;
    e.isBullet = true;
    e.builtinMotion = true;
  },

  step: regularbulletStep,

  collides(e, heart) {
    if (e.active !== 1 && e.active !== true) return false;
    return enginePairHit(heart, e, STREAMDIAMOND_MASK);
  },

  other15: collidebulletOther15,
};

/** obj_bullet_knight_stream — one arm of the cross. Visual; sheds diamonds. */
export const bulletKnightStream = {
  name: 'obj_bullet_knight_stream',

  create(e) {
    e.x1 = e.x;
    e.y1 = e.y;
    e.x2 = e.x;
    e.y2 = e.y;
    e.width = 8;
    e.width_goal = 8;
    e.line_length = 0;
    e.timer = 0;
    e.can_do_slashes = true;
    e.isBullet = false; // no parent — see the header
  },

  step(e, state) {
    e.timer += 1;
    // `line_width = 0` at 20 — assigned and read NOWHERE in the dump.
    // ORIGINAL BUG, the `linex`/`splitbox` family. Kept as a no-op.
    if (e.timer >= 20 && e.timer < 40) {
      if (e.timer < 24) {
        e.width_goal = 64 + Math.sin(e.timer * 2.35) * 16;
      } else {
        e.width_goal = 32 + Math.sin(e.timer * 2.35) * 16;
      }
    } else if (e.timer >= 40) {
      e.width_goal = 0;
    } else if (e.timer > 8) {
      e.width_goal = 0;
    }

    // THE DIAMONDS: six per burst, every 8th frame between 16 and 39, three
    // out each side along the beam's perpendicular, all flying BACK down the
    // beam (`direction + 180`) at speed 15.
    if (e.timer > 15 && e.timer % 8 === 0 && e.timer < 40) {
      for (const side of [270, 90]) {
        for (let a = 1; a < 4; a++) {
          const b = spawn(state, streamDiamond, {
            x: e.x1 + lengthdirX(60 * a, e.direction + side),
            y: e.y1 + lengthdirY(60 * a, e.direction + side),
          });
          b.direction = e.direction + 180;
          b.speed = 15;
          b.image_angle = e.direction;
        }
      }
    }

    if (e.timer === 50) destroy(e);
  },

  /** Same per-frame ramps as the streamline — see its endStep. */
  endStep: knightStreamline.endStep,
};

export const knightStream = {
  name: 'obj_knight_stream',

  create(e, state) {
    scrBulletInit(e);
    // scr_darksize()
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.image_speed = 0;
    e.slash_angle = 90 + gmlIrandomRange(state.gmlRng, -45, 45);
    e.timer = 0;
  },

  step(e, state) {
    e.timer += 1;

    if (e.timer === 20) {
      const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
      const gx = gt ? gt.x : state.view.x + 320;
      const gy = gt ? gt.y : state.view.y + 170;
      let xoff = 0;
      let yoff = 0;
      // `plane_shift = choose(true, false)` — which axis the pair is nudged
      // along. The draw happens either way; only its use is conditional.
      const planeShift = gmlChoose(state.gmlRng, [true, false]);
      if (planeShift) xoff = gmlIrandomRange(state.gmlRng, -40, 40);
      else yoff = gmlIrandomRange(state.gmlRng, -40, 40);

      for (const dir of [e.slash_angle, 180 - e.slash_angle]) {
        const b = spawn(state, bulletKnightStream, { x: gx + xoff, y: gy + yoff });
        b.direction = dir;
        b.speed = 0;
      }
    }

    // The three streamline pairs, at 60 / 120 / 180 out along each beam's
    // perpendicular. The last one latches `can_do_slashes` false so a beam
    // sprouts them exactly once.
    const sprout = { 23: 60, 26: 120, 29: 180 }[e.timer];
    if (sprout !== undefined) {
      for (const beam of state.entities) {
        if (!beam.alive || beam.type.name !== 'obj_bullet_knight_stream') continue;
        if (!beam.can_do_slashes) continue;
        for (const sign of [1, -1]) {
          const l = spawn(state, knightStreamline, {
            x: beam.x + sign * lengthdirX(sprout, beam.direction + 270),
            y: beam.y + sign * lengthdirY(sprout, beam.direction + 270),
          });
          l.direction = beam.direction;
          l.speed = 0;
        }
        if (e.timer === 29) beam.can_do_slashes = false;
      }
    }

    if (e.timer === 45) {
      e.slash_angle += 25 + gmlIrandom(state.gmlRng, 25);
      if (e.slash_angle > 70) e.slash_angle -= 40;
      e.timer = 0;
    }
  },
};
