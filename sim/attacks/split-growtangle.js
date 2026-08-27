// obj_knight_split_growtangle — the box-splitter organism.
// Translated from Create_0, Step_0, Step_2 (End Step), Other_10 (event_user 0).
//
// The box tears into two halves that slide apart, dragging the soul with them,
// and a row of teeth erupts along the tear. Structure:
//
//   con 0  idle
//   con 1  after `split_wait` frames: spawn the teeth, decide which way the
//          soul gets shoved, advance to con 2
//   con 2  distance eases OUT to max_distance over split_hold/2 frames,
//          pushing the soul by the per-frame delta * 1.25; then con 3
//   con 3  distance eases IN back to 0; the soul is no longer pushed, only
//          clamped; then con 4
//   con 4  distance walks to 0 at 12/frame, then con 0 and the timings tighten
//
// End Step clamps the soul into the widened box and ROUNDS its position —
// which is why soul coordinates stay integral all through the attack.
//
// THE FLAMES IN THE GAP are two obj_markers created in Create, NOT anything the
// Draw event does — which is why reading only the Draw event misses them. They
// carry `spr_rk_split_flame_big` at double scale, face opposite ways, animate at
// image_speed 0.5, and are re-placed onto the two cut faces every Step. They are
// what makes the split read as CUT rather than as two rectangles moving apart.
//
// While distance > 0 the main box is parked at x = -9999 so it stops
// colliding; it returns to xstart when the split closes. That is the
// original's mechanism, not a hack.
//
// Not translated (visual only): the two obj_marker flames, the
// obj_knight_split_growtangle_effect, surfaces/box sprite regeneration in
// Other_11, and the debug_print calls. Other_12/13 (the fountain walls) are
// DEAD CODE — nothing in the dump calls event_user(2) or event_user(3).

// ── THE "SAFE SPOT" REPORTS (bottom-left corner, between two teeth) ────────
//
// Investigated twice, four ways, and NOT reproducible as a dead zone:
//
//   1. a 9x7 hit-density map over the whole box interior, 2,400 pinned
//      frames per cell: minimum 9 hits, no zero cell anywhere;
//   2. the exact pressed-in corner, pinned 3,600 frames: 19 hits, teeth
//      passing within 0.8px;
//   3. the player's own route — holding down-left through real collision —
//      across four seeds and all three difficulties: 40-55 hits every run,
//      still landing in the final frames of 6,000;
//   4. every mechanism that could make a sim-only safe strip, checked
//      against the dump: the teeth cull OFFSCREEN (view -80/+760/+580),
//      identical both sides, never at the box walls; the fan's positions and
//      angles are oracle-verified row-exact; the collision model is
//      calibrated on 48 oracle contact points.
//
// What the reports are almost certainly describing: ONE wave's angular gap.
// Thirteen teeth fan out from the cut, and between two adjacent trajectories
// there is real empty space — standing in it, that wave misses entirely,
// and that is the game's own geometry. The next split's cut angle differs
// and covers it, which is what the measured continuing hits show.
//
// Do not "fix" this by widening teeth or adding coverage: every candidate
// mechanism is verified faithful, and making the corner more dangerous than
// the translation says would be inventing difficulty. What would reopen it:
// a capture of the real fight where a stationary soul in that corner
// survives MULTIPLE waves.
import { spawn } from '../entity.js';
import { splitGrowtangleEffect } from '../fx.js';
import { cue } from '../audio.js';

/**
 * obj_marker carrying `spr_rk_split_flame_big` — the burning cut face.
 *
 * A bare sprite carrier: no Step of its own, positioned and rotated entirely by
 * obj_knight_split_growtangle. It animates (image_speed 0.5, six frames) and is
 * destroyed with the organism in its CleanUp.
 */
export const splitFlameMarker = {
  name: 'obj_marker_splitflame',
  create(e) {
    e.image_speed = 0.5;
  },
};
import { splitBullet } from './split-bullet.js';
import {
  scrEaseIn, scrEaseOut, scrMovetowards, inverselerp, sign,
  lengthdirX, lengthdirY, pointDirection, angleDifference, WHITE, GRAY,
} from '../gml.js';
import { gmlChoose, gmlRandomRange, gmlIrandomRange } from '../rng.js';

import { scrBulletInherit } from '../bullets/regularbullet.js';

/**
 * The organism's own depth, which the dump does NOT contain.
 *
 * Every sibling this object creates is positioned in depth RELATIVE to it --
 * `depth + 10` for the flame markers, `depth + 1` and `depth - 10` for the
 * teeth -- but `depth` itself is set in the OBJECT DEFINITION, not in any
 * event, so no grep of the code dump can find it (the same hole that hid
 * obj_basicattack's sprite; see CLAUDE.md).
 *
 * It was simply absent here, so all three offsets evaluated to `undefined +
 * 10` = **NaN**, and NaN in the renderer's depth comparator makes the sort
 * comparison neither less nor greater -- the order of the box, its teeth and
 * its flames became whatever the sort happened to leave them in.
 *
 * Falling back to 0 keeps the RELATIVE order the code actually states, which
 * is the part the dump gives us. The absolute value is still unmeasured, so
 * ordering against objects OUTSIDE this family is not yet trustworthy -- that
 * needs the object-definition dump.
 */
function baseDepth(e) {
  return e.depth ?? 0;
}

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

/** Other_10 — event_user(0). */
function eventUser0(e) {
  e.timer = 0;
  e.con += 1;
}

export const splitGrowtangle = {
  name: 'obj_knight_split_growtangle',

  // BEFORE THE SOUL. The runner steps newest-first and the splitter organism
  // is born mid-turn, so in the game its Step — the distance easing, the
  // con-2 heart drag, and above all the main box's park/return at the tail —
  // runs before obj_heart's. The one frame that order is observable is the
  // cut's CLOSE: the box returns to xstart in the half's step, and the
  // heart's own step then resolves its movement against the ring while the
  // envelope clamp has not yet pulled the soul out of the border — the
  // game's soul loses its input move that frame (verify21j f2500: oracle x
  // stalls at 346 with right held; the sim, stepping the soul first against
  // a still-parked box, walked on). During an open cut the box is at -9999
  // and nothing the order touches can collide, which is why every earlier
  // split verified row-exact with the wrong order.
  stepOrder: -0.5,

  create(e, state) {
    const gt = box(state);
    e.image_xscale = gt ? gt.xscale : 2;
    e.image_yscale = gt ? gt.yscale : 2;
    // THE FLAMES IN THE GAP. Two obj_markers carrying `spr_rk_split_flame_big`,
    // created facing OPPOSITE ways (image_angle 180 and 0) at double scale and
    // animating at image_speed 0.5. They are repositioned every frame onto the
    // two cut faces, so what the player sees is the severed edges of the arena
    // burning at each other across the gap — the effect that makes the split
    // look cut rather than merely moved apart.
    //
    // `c_gray` is a MULTIPLY, so the flame art is drawn at half brightness.
    e.markers = [0, 1].map((i) => {
      const m = spawn(state, splitFlameMarker, {
        x: e.x + (i === 0 ? 2 : 0),
        y: e.y + (i === 0 ? -1 : 2),
      });
      m.sprite_index = 'spr_rk_split_flame_big';
      m.image_speed = 0.5;
      m.image_xscale = 2;
      m.image_yscale = 2;
      m.image_angle = i === 0 ? 180 : 0;
      m.image_blend = GRAY;
      m.depth = baseDepth(e) + 10;
      return m;
    });

    // `image_blend = obj_growtangle.image_blend;` — the FIRST line of Create.
    // The cut box keeps the arena's green; every `draw_surface_ext` of a half
    // passes it. Without it the box turns white the moment it splits, which is
    // the one frame the player is most likely to be looking at it.
    e.image_blend = gt ? gt.image_blend : WHITE;
    e.con = 0;
    e.timer = 0;
    e.distance = 0;
    e.old_distance = 0;
    if (gt) gt.visible = false;
    e.heart_y = 0;
    e.heart_x = 0;
    e.split_dist = 50;
    e.slow = 4;
    e.fast = 8;
    e.child_bullet = [];
    e.count = 0;
    e.flame_index = 0;
    e.split = false;
    e.vertical = false;
    e.diagonal = false;
    e.launch_force = 0;
    e.open_time = 45;
    e.boxgone = false;
    e.max_distance = 70;
    e.split_delay = 0;
    e.vshift = 0;
    e.hshift = 0;
    e.xoffset = 0;
    e.yoffset = 0;
    e.angle = 0;
    e.h_change = 0;
    e.v_change = 0;
    e.update_box = false;
    e.difficulty = 0;
    e.split_wait = 5;
    e.split_hold = 30;
    e.init = false;
    e.bullet_count = 13;
    e.bullet_range = 144;
    e.disable_on_close = true;
  },

  step(e, state) {
    if (!e.init) {
      if (e.difficulty === 2) {
        e.split_wait = 4;
        e.split_hold = 26;
      }
      e.init = true;
    }
    e.timer += 1;
    e.old_distance = e.distance;

    if (e.con === 1) {
      // THE CUT EFFECT, on the first frame of the split — the screen-tear and
      // flash (sim/fx.js). It carries the cut's geometry so it can slide the
      // halves along the right normal.
      if (e.timer <= 1 && !e.effectSpawned) {
        e.effectSpawned = true;
        const fx = spawn(state, splitGrowtangleEffect, { x: e.x, y: e.y });
        fx.angle = e.angle;
        fx.diagonal = e.diagonal;
        fx.xoffset = e.xoffset;
        fx.yoffset = e.yoffset;
        fx.vertical = e.vertical;
        fx.image_xscale = e.image_xscale;
        fx.image_yscale = e.image_yscale;
        fx.image_blend = e.image_blend;
        fx.sprite_index = e.sprite_index;
      }

      if (e.timer >= e.split_wait + e.split_delay) {
        if (e.disable_on_close) {
          for (const b of state.entities) {
            if (b.alive && b.type.name === 'obj_roaringknight_split_bullet') b.active = false;
          }
          e.child_bullet = [];
          e.count = 0;
        }

        // THE BOX BREAKING. `snd_play_x(snd_knight_boxbreak, 1, 1.1)` fires on
        // the frame the arena actually parts, before the teeth are placed.
        cue(state, 'snd_knight_boxbreak', 1.1);

        eventUser0(e); // -> con 2, timer 0

        const heart = state.soul;
        // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
        // Knight delivers it per turn via scr_moveheart and it is gone by the
        // party's menu — so a bullet that outlives its turn by a frame has
        // nothing to aim at. Skipping the frame leaves it where it was until the
        // turn sweep takes it; inventing a position would make it lunge at a soul
        // that is not there.
        if (!heart) return;
        if (e.diagonal) {
          // WHICH SIDE OF THE DIAGONAL CUT the soul is on — an angle test,
          // not the axis thresholds. The heading from the cut point to the
          // soul is compared against the cut's own normal (angle + 45 for a
          // vertical-diagonal, -45 otherwise); within 90 degrees the soul
          // rides the (+1, -/+1) half, past it the opposite. This was
          // hardcoded to the first half ("not exercised by the verified
          // scenario") until turn 12's first d2 cut put the soul on the
          // other side: verify21j f4654 dragged the oracle's soul -14/frame
          // while the sim pushed +10 the other way.
          const hd = pointDirection(
            e.x + e.xoffset, e.y + e.yoffset, heart.x + 10, heart.y + 10,
          );
          const cutNormal = (e.angle ?? 0) + (e.vertical ? 45 : -45);
          if (Math.abs(angleDifference(cutNormal, hd)) < 90) {
            e.heart_x = 1;
            e.heart_y = e.vertical ? -1 : 1;
          } else {
            e.heart_x = -1;
            e.heart_y = e.vertical ? 1 : -1;
          }
        } else {
          e.heart_x = heart.x + 10 < e.x + e.xoffset ? -1 : 1;
          e.heart_y = heart.y + 10 < e.y + e.yoffset ? -1 : 1;
        }

        // TWO fires when the cut was delayed by a hit — the low one is the
        // extra. `split_delay` is set to 5 by splitslash's Other_15, so a
        // player who just got cut hears a doubled report.
        if (e.split_delay > 0) cue(state, 'snd_chargeshot_fire', 0.5);
        cue(state, 'snd_chargeshot_fire');

        e.split_delay = 0;

        const range = e.bullet_range;
        let total = e.bullet_count;
        let odd = false;
        if (e.bullet_count % 2 === 1) {
          odd = true;
          total += 1;
        }
        let flip = gmlChoose(state.gmlRng, [true, false]);
        const trueangle = e.vertical ? e.angle + 90 : e.angle;
        const xrange = lengthdirX(range, trueangle);
        const yrange = lengthdirY(range, trueangle);
        const xshift = xrange / (total / 2 - 1);
        const yshift = yrange / (total / 2 - 1);
        let xstart = e.x - xrange / 2;
        let ystart = e.y - yrange / 2;
        let weight = 0;
        let direction = 0;

        for (let i = 0; i < e.bullet_count; i++) {
          if (!e.diagonal && i === total / 2) {
            xstart = e.x - xrange / 2;
            ystart = e.y - yrange / 2;
            if (odd) {
              xstart += xshift / 2;
              ystart += yshift / 2;
            }
            weight = 0;
            flip = !flip;
          }
          if (weight === 0) {
            weight = gmlChoose(state.gmlRng, [-2, -1, 1, 2]);
          }
          const speedClass = inverselerp(-1, 1, sign(-weight));

          const b = e.diagonal
            ? spawn(state, splitBullet, { x: e.x, y: e.y })
            : spawn(state, splitBullet, { x: xstart, y: ystart });

          b.friction = speedClass === 1 ? -0.2 : -0.05;
          const topspeed = speedClass === 1 ? 4 : 2;
          b.top_speed = topspeed + gmlRandomRange(state.gmlRng, -0.2, 0.2);
          b.image_speed = 0.5;
          b.depth = baseDepth(e) + 1;
          b.image_xscale = 2;
          b.image_yscale = 2;
          b.active = false;
          b.speed = 0;

          if (e.diagonal) direction += 360 / e.bullet_count;
          else if (e.vertical) direction = flip ? 180 : 0;
          else direction = flip ? 90 : -90;

          b.direction = direction;
          b.image_angle = direction;
          scrBulletInherit(e, b);
          b.grazed = -1;
          e.child_bullet[e.count] = b;
          e.count += 1;

          if (Math.abs(weight) === 1) {
            weight = gmlChoose(state.gmlRng, [1, 2]) * sign(-weight);
          } else {
            weight = scrMovetowards(weight, 0, 1);
          }
          xstart += xshift;
          ystart += yshift;
        }
      }
    }

    const hold = e.diagonal ? e.split_hold + 2 : e.split_hold;

    if (e.con === 2) {
      e.split = true;
      if (e.timer === 7) {
        for (let i = 0; i < e.count; i++) {
          const b = e.child_bullet[i];
          if (b && b.alive) {
            b.depth = baseDepth(e) - 10;
            b.active = true;
            b.grazed = 0;
          }
        }
      }
      if (e.timer <= hold / 2) {
        e.distance = scrEaseOut(e.timer / (e.split_hold / 2), 3) * e.max_distance;
        const heart = state.soul;
        // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
        // Knight delivers it per turn via scr_moveheart and it is gone by the
        // party's menu — so a bullet that outlives its turn by a frame has
        // nothing to aim at. Skipping the frame leaves it where it was until the
        // turn sweep takes it; inventing a position would make it lunge at a soul
        // that is not there.
        if (!heart) return;
        if (e.diagonal) {
          heart.x += (e.distance - e.old_distance) * e.heart_x * 1;
          heart.y += (e.distance - e.old_distance) * e.heart_y * 1;
        } else if (e.vertical) {
          heart.x += (e.distance - e.old_distance) * e.heart_x * 1.25;
        } else {
          heart.y += (e.distance - e.old_distance) * e.heart_y * 1.25;
        }
      } else {
        eventUser0(e);
      }
    }

    if (e.con === 3) {
      e.distance = e.max_distance - scrEaseIn(e.timer / (e.split_hold / 2), 3) * e.max_distance;
      if (e.timer >= hold / 2) {
        if (e.vertical || e.diagonal) {
          e.vshift = gmlIrandomRange(state.gmlRng, -3, 3);
        } else {
          e.hshift = gmlIrandomRange(state.gmlRng, -3, 3);
        }
        if (e.diagonal) e.hshift = e.vshift;
        eventUser0(e);
      }
    }

    if (e.con === 4) {
      e.distance = scrMovetowards(e.distance, 0, 12);
      if (e.distance === 0) {
        e.con = 0;
        e.split = false;
        if (e.difficulty === 3) {
          if (e.split_wait > 3) e.split_wait -= 1;
          if (e.split_hold > 26) e.split_hold -= 2;
        } else {
          if (e.split_wait > 5) e.split_wait -= 1;
          if (e.split_hold > 30) e.split_hold -= 2;
        }
        // The box SLAMMING SHUT — outside the if/else, so it plays on every
        // close regardless of which timing branch tightened.
        cue(state, 'snd_locker');
      }
    }

    // THE FLAMES RIDE THE CUT FACES. Straight from the Step, immediately
    // before the box is parked: each marker is placed on the inner edge of its
    // half and turned to face across the gap, so they stay pinned to the
    // severed edges however far apart the halves travel.
    //
    // The +2/-1/+3 offsets are the original's and are not symmetric — marker 0
    // sits one pixel back, marker 1 three forward.
    if (e.markers && e.markers.length === 2) {
      const [m0, m1] = e.markers;
      const d = Math.round(e.distance);
      if (e.diagonal) {
        m0.image_angle = e.vertical ? -45 : 225;
        m1.image_angle = e.vertical ? 135 : 45;
        const sq = Math.SQRT1_2 * d;
        m0.x = e.x - sq - 1 + e.xoffset;
        m1.x = e.x + sq + 3 + e.xoffset;
        m0.y = e.y - sq - 1 + e.yoffset;
        m1.y = e.y + sq + 3 + e.yoffset;
      } else if (e.vertical) {
        m0.image_angle = -90;
        m1.image_angle = 90;
        m0.x = e.x - d - 1 + e.xoffset;
        m1.x = e.x + d + 3 + e.xoffset;
        m0.y = e.y - 1 + e.yoffset;
        m1.y = e.y + 3 + e.yoffset;
      } else {
        m0.image_angle = 180;
        m1.image_angle = 0;
        m0.y = e.y - d - 1 + e.yoffset;
        m1.y = e.y + d + 3 + e.yoffset;
        m0.x = e.x - 1 + e.xoffset;
        m1.x = e.x + 3 + e.xoffset;
      }
    }

    // Park the main box offscreen while the split is open.
    const gt = box(state);
    if (gt) {
      if (e.distance > 0) gt.x = -9999;
      else gt.x = gt.xstart;
    }
  },

  // Step_2 — End Step. Clamps the soul into the widened box, then ROUNDS it.
  endStep(e, state) {
    // `flame_index += 0.5` at the bottom of the object's own Draw. It is a
    // Draw-event counter, so it belongs in a step phase — and it is USE-then-
    // increment, which CLAUDE.md's table puts in endStep's neighbourhood
    // rather than beginStep. Keeping it here makes it per-instance and
    // survives `?frames=N`, which paints nothing; the renderer only reads it.
    e.flame_index = (e.flame_index ?? 0) + 0.5;

    const heart = state.soul;
    // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
    // Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a bullet that outlives its turn by a frame has
    // nothing to aim at. Skipping the frame leaves it where it was until the
    // turn sweep takes it; inventing a position would make it lunge at a soul
    // that is not there.
    if (!heart) return;
    const gt = box(state);
    if (!heart || !gt) return;

    let dist = Math.round(e.distance);
    if (e.con === 0) dist = 0;

    let sw = e.vertical ? dist : 0;
    let sh = e.vertical ? 0 : dist;
    if (e.diagonal) {
      sw = Math.sqrt(0.5) * dist;
      sh = Math.sqrt(0.5) * dist;
    }

    const tlx = gt.xstart - 70 - sw;
    const tly = gt.ystart - 70 - sh;
    const brx = gt.xstart + 52 + sw;
    const bry = gt.ystart + 52 + sh;

    const distChange = Math.sqrt(0.5) * (dist - Math.round(e.old_distance));
    let startX = 0;
    let startY = 0;
    if (e.diagonal && distChange !== 0) {
      startX = heart.x;
      startY = heart.y;
    }

    if (heart.x < tlx) heart.x = tlx;
    if (heart.x > brx) heart.x = brx;
    if (heart.y < tly) heart.y = tly;
    if (heart.y > bry) heart.y = bry;

    if (e.diagonal && distChange !== 0) {
      const cx = Math.max(-Math.abs(distChange), Math.min(Math.abs(distChange), heart.x - startX));
      const cy = Math.max(-Math.abs(distChange), Math.min(Math.abs(distChange), heart.y - startY));
      if (cx !== 0) {
        if (!e.vertical) heart.y += cx;
        else heart.y -= cx;
      }
      if (cy !== 0) {
        if (!e.vertical) heart.x += cy;
        else heart.x -= cy;
      }
    }

    heart.x = Math.round(heart.x);
    heart.y = Math.round(heart.y);
  },
};
