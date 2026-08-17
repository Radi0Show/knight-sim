// obj_knight_tunnel_slasher + obj_bullet_knight_tunnelslash — myattackchoice
// 20 ("knightlines"), reached through obj_dbulletcontroller `type = 101`.
//
// *** NOT IN THE FIGHT. *** No row of the selector assigns ac 20, so this is
// debug content like ac 4, 6, 10, 12, 16 and 17. It also takes NO
// `scr_turntimer` override and the controller never pins `global.turntimer`,
// so unlike every other unused attack it runs on the DEFAULT 90-frame turn —
// and its own timeline is longer than that. See TURN LENGTH below.
//
// THE SHAPE. The Knight steps to the left of a widened arena and throws a
// volley of spears that fly in from off-screen right, spin onto the soul, and
// IMPALE THE ARENA'S LEFT WALL:
//
//   type 101      the arena AND the soul both slide 70 left, the box widens to
//                 image_xscale 2.5, the Knight is hidden and this object
//                 becomes him
//   "prepare"     image_index eases 1 -> 2.8 while he is shoved LEFT on a
//                 decaying push (4, x0.8 a frame, floored at 1); 16 frames
//                 after the pose lands he commits
//   "slash"       image_index eases toward 5.6 and the push REVERSES (x0.9,
//                 no floor, so it dies away) — he recoils right as he throws
//   every 2 frames, while timer < 24
//                 one obj_roaringknight_slash at
//                 `(box right + 50 + random(20) - timer*2,
//                   box top + box centre y * 0.5 + sin(timer + individuality) * 100)`
//                 and one spear fired from it at speed ZERO, armed with
//                 `alarm[0] = 32 + timer * 4`
//   timer 24      he swaps to spr_roaringknight_point_ol and points
//   timer 32..56  image_index eases to 4, the push settles at 1
//
// `individuality = random(100)` in the Create is the attack's whole character:
// it phases the `sin(timer + individuality)` that places each spear, so two
// launches of the same attack lay their spears in a different vertical order.
//
// THE SPEARS ARE THE INTERESTING HALF. Each one sits still — speed 0, alpha
// 0.25, image_xscale 4 — until its alarm fires, and then:
//
//   Alarm 0   it BACKS OFF 90px away from the box (an 8-frame ease-out lerp on
//             both axes), picks an aim at the soul (5 times in 6 with a
//             +-60px vertical jitter, 1 in 6 dead on), and takes on
//             `totalspin = 640 + irandom(80)` DEGREES of spin
//   Step      the spin decays x0.8 a frame and `direction = aim + totalspin`,
//             so the spear whirls and screws itself onto the aim line; once
//             the alarm is done AND the spin is under 1 degree it launches at
//             speed 4 and accelerates toward 20
//   the wall  `if (x <= box left + 12 && y is inside the box's rows) speed = 0`
//             — a spear that reaches the arena STOPS DEAD in the wall. One
//             that misses the box's vertical span flies on, shedding
//             afterimages.
//
// and its Draw clips the sprite at `box left + 7` for exactly the spears in
// that band, so they read as buried in the wall rather than lying over it.
//
// VERIFICATION STATUS: translated from the dump, not oracle-diffed — the
// attack is unreachable, so there is nothing to record it against. The
// spear's two-layer surface draw is render/draw/knightlines.js.

import { spawn, destroy } from '../entity.js';
import {
  scrApproach, pointDirection, lengthdirX, lengthdirY, gmlMedian, gmlEq,
} from '../gml.js';
import { gmlRandom, gmlIrandom, gmlIrandomRange, gmlChoose } from '../rng.js';
import {
  scrBulletInit, regularbulletCreate, regularbulletStep, collidebulletOther15,
} from '../bullets/regularbullet.js';
import { scrLerpvar } from '../lerpvar.js';
import { scrAfterimage, afterimage } from '../fx.js';
import { SLASHTUNNEL_MASK, enginePairHit } from '../masks.js';
import { roaringknightSlash } from './roaringknight-slash.js';
import { cue } from '../audio.js';

/** scr_get_box, by the same indices sim/attacks/rotating-slash.js documents. */
function boxOf(state) {
  return state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
}
function getBox(state, which) {
  const gt = boxOf(state);
  if (!gt) return which === 0 || which === 2 || which === 4 ? state.view.x + 320 : state.view.y + 170;
  const hw = (gt.image_xscale ?? 2) * 75 * 0.5;
  const hh = (gt.image_yscale ?? 2) * 75 * 0.5;
  switch (which) {
    case 0: return gt.x + hw; // RIGHT
    case 1: return gt.y - hh; // TOP
    case 2: return gt.x - hw; // LEFT
    case 3: return gt.y + hh; // BOTTOM
    case 4: return gt.x; // centre x
    default: return gt.y; // centre y
  }
}

export const tunnelslashBullet = {
  name: 'obj_bullet_knight_tunnelslash',

  create(e, state) {
    regularbulletCreate(e, state); // event_inherited()
    e.element = 5;
    e.destroyonhit = 0;
    e.image_xscale = 4;
    e.image_yscale = 1;
    e.image_alpha = 0.25;
    e.xspeed = 0;
    e.timer = 0;
    e.totalspin = 0;
    e.new_x = e.x;
    e.new_y = e.y;
    e.boxdir = 0;
    e.aim = 0;
  },

  alarm: {
    /** THE LOCK-ON, armed by the slasher at `32 + timer * 4`. */
    0(e, state) {
      // `median(180, point_direction(...))` — a TWO-ARGUMENT clamp, which is
      // not a clamp. See gmlMedian: it degenerates to `min(180, dir)`, so a
      // spear aiming downward-left (180..270) is flattened to due left and
      // one aiming upward-left keeps its angle. The target it measures
      // against is `box left + centre x * 0.5, box top + centre y * 0.5`,
      // which mixes an edge with half of an ABSOLUTE coordinate — the same
      // odd idiom as the slasher's spawn y below. Both are reproduced as
      // written; they only make sense because the camera sits at 0.
      e.boxdir = gmlMedian(180, pointDirection(
        e.x, e.y,
        getBox(state, 2) + getBox(state, 4) * 0.5,
        getBox(state, 1) + getBox(state, 5) * 0.5,
      ));
      // BACK OFF FIRST. 90px in the OPPOSITE direction, over 8 frames.
      e.new_x = e.x + lengthdirX(90, e.boxdir + 180);
      e.new_y = e.y + lengthdirY(90, e.boxdir + 180);
      scrLerpvar(state, spawn, e, 'x', e.x, e.new_x, 8, 2);
      scrLerpvar(state, spawn, e, 'y', e.y, e.new_y, 8, 2);
      // FIVE IN SIX MISS ON PURPOSE. `irandom(5)` is 0 one time in six, and
      // THAT is the branch with no jitter — so most spears are thrown at a
      // point up to 60px above or below you and only the occasional one is
      // aimed at your centre. Reading the condition the other way round makes
      // the attack unfair rather than tense.
      if (gmlIrandom(state.gmlRng, 5)) {
        e.aim = pointDirection(e.new_x, e.new_y,
          state.soul.x + 10,
          state.soul.y + 10 + gmlIrandomRange(state.gmlRng, -60, 60));
      } else {
        e.aim = pointDirection(e.new_x, e.new_y, state.soul.x + 10, state.soul.y + 10);
      }
      // Nearly two full turns of spin to shed before it can fly.
      e.totalspin = 640 + gmlIrandom(state.gmlRng, 80);
    },
  },

  step(e, state) {
    regularbulletStep(e, state); // event_inherited()
    e.timer += 1;
    e.image_alpha = scrApproach(e.image_alpha, 1, 0.25);
    e.image_xscale = scrApproach(e.image_xscale, 1, 1);

    // THE SCREW. `direction = aim + totalspin` with totalspin decaying x0.8
    // means the heading spirals onto the aim rather than snapping to it.
    if (e.totalspin) {
      e.totalspin *= 0.8;
      e.direction = e.aim + e.totalspin;
      e.image_angle = e.direction;
    }

    // `if (!alarm[0] && totalspin < 1)` — GML truthiness, so an idle -1 is
    // false and this waits for the alarm to have FIRED, not to be pending.
    if (!(e.alarm[0] > 0.5) && e.totalspin < 1) {
      if (e.speed === 0) e.speed = 4;
      else e.speed = scrApproach(e.speed, 20, 2);
    }

    // THE WALL. A spear whose x has reached the arena and whose y is inside
    // the box's rows STOPS — buried in the left wall for the rest of the turn.
    // The 8px inset at top and bottom is what lets a spear aimed at the very
    // edge of the box sail past instead of hanging in the corner.
    if (e.x <= getBox(state, 2) + 12
      && e.y > getBox(state, 1) + 8 && e.y < getBox(state, 3) - 8) {
      e.speed = 0;
    } else if (e.x > getBox(state, 2) + 50
      || e.y <= getBox(state, 1) + 8 || e.y >= getBox(state, 3) - 8) {
      // Everything still travelling sheds a ghost every frame — which is what
      // makes a volley read as a hail rather than as a dozen sliding sprites.
      const a = scrAfterimage(state, e);
      a.fadeSpeed = 0.1;
      a.image_alpha = 0.4;
    }
  },

  collides(e, heart) {
    if (e.active !== 1 && e.active !== true) return false;
    return enginePairHit(heart, e, SLASHTUNNEL_MASK);
  },

  other15: collidebulletOther15,
};

export const knightTunnelSlasher = {
  name: 'obj_knight_tunnel_slasher',

  create(e, state) {
    e.sprite_index = 'spr_roaringknight_attack_ol'; // object definition
    e.image_speed = 0;
    e.image_index = 1;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.push_left = 4;
    e.timer = 0;
    e.fulltimer = 0;
    // THE ONE RNG DRAW IN THE OBJECT, and it is what makes two launches
    // differ: it phases the sine that places every spear.
    e.individuality = gmlRandom(state.gmlRng, 100);
    e.behavior = 'prepare';
    e.damage = 206;
  },

  step(e, state) {
    e.fulltimer += 1;

    if (e.behavior === 'prepare') {
      e.image_index = scrApproach(e.image_index, 2.8, 0.2);
      if (e.push_left) {
        e.x -= e.push_left;
        e.push_left *= 0.8;
        if (e.push_left < 1) e.push_left = 1;
      }
      // `if (image_index == 2.8)` — scr_approach CLAMPS on crossing
      // (`if (from > to) return to`), so this lands on the literal exactly
      // rather than accumulating past it. gmlEq anyway: a real `==` in GML is
      // epsilon-based and this project has been bitten twice by translating
      // one as `===` (see sim/gml.js).
      if (gmlEq(e.image_index, 2.8)) e.timer += 1;
      if (e.timer === 16) {
        e.push_left = 4;
        e.behavior = 'slash';
        e.timer = 0;
        e.image_index = 3;
      }
    }

    if (e.behavior === 'slash') {
      if (e.timer < 20) e.image_index = scrApproach(e.image_index, 5.6, 0.4);
      e.timer += 1;
      if (e.push_left) {
        // THE RECOIL — the same variable, now pushing the other way and with
        // no floor under it, so it dies out instead of settling at 1.
        e.x += e.push_left;
        e.push_left *= 0.9;
      }

      if (e.timer % 2 === 0 && e.timer < 24) {
        const offset = Math.sin(e.timer + e.individuality) * 100;
        const temptime = e.timer;
        cue(state, 'snd_smallswing', 3, 1);
        const sx = getBox(state, 0) + 50 + gmlRandom(state.gmlRng, 20) - e.timer * 2;
        // `scr_get_box(1) + scr_get_box(5) * 0.5` — the box's TOP plus half
        // its centre y, which is an edge added to half an absolute
        // coordinate. It only lands in a sensible place because the camera is
        // at 0 (top 95 + 85 = 180, just under the box's middle). Reproduced
        // as written, and flagged: it is the same idiom as the bullet's
        // Alarm 0 target, so it is the author's shorthand rather than a slip
        // in one line.
        const sy = getBox(state, 1) + getBox(state, 5) * 0.5 + offset;
        const slash = spawn(state, roaringknightSlash, { x: sx, y: sy });
        slash.direction = 240 + gmlRandom(state.gmlRng, 60);
        slash.image_angle = slash.direction;

        // The spear, fired from the SLASH at speed zero. `choose` picks the
        // slash's heading or its opposite, so half the volley points back the
        // way it came until the lock-on turns it round.
        const b = spawn(state, tunnelslashBullet, { x: sx, y: sy });
        b.sprite_index = 'spr_roaringknight_slash_tunnel';
        b.direction = gmlChoose(state.gmlRng, [slash.direction, slash.direction + 180]);
        b.speed = 0;
        b.damage = e.damage;
        // `image_angle = other.direction` — the SLASH's angle, not the
        // bullet's own, so the spear is drawn along the cut that threw it.
        b.image_angle = slash.direction;
        b.alarm[0] = 32 + temptime * 4;
      }

      if (e.timer === 20) e.image_index -= 1;
      if (e.timer === 24) {
        e.sprite_index = 'spr_roaringknight_point_ol';
        e.image_index = 0;
      }
      if (e.timer > 32 && e.timer < 56) {
        e.image_index = scrApproach(e.image_index, 4, 0.35);
        e.push_left = 1;
      }
    }

    if (e.fulltimer % 2 === 0) {
      const fade = scrAfterimage(state, e);
      fade.image_alpha = 0.6;
      fade.fadeSpeed = 0.04;
      fade.speed = 4;
      fade.direction = 0;
    }
  },
};

/**
 * The `type = 101` branch of obj_dbulletcontroller.
 *
 * TURN LENGTH. ac 20 sets no `scr_turntimer`, and unlike types 103/106/107/108
 * this branch does not pin `global.turntimer` either — so the turn keeps the
 * default the mnfight 1.5 -> 2 transition leaves, which is 90. The slasher's
 * own timeline is about 105 frames (9 to ease the pose in, 16 to commit, then
 * 56 of slashing and pointing) and the spears' alarms run to `32 + 22 * 4` =
 * 120 before they even move. So in the real game the turn clock would cut it
 * off mid-volley. That is what the dump says; SINGLE gives it room to finish
 * by running the attack on its own clock like every other practice drill, and
 * that difference is noted here rather than papered over.
 */
export function launchKnightlines(state, x, y) {
  const knight = state.entities.find(
    (k) => k.alive && k.type.name === 'obj_knight_enemy',
  );
  // THE ARENA AND THE SOUL BOTH SLIDE, and the soul moving with it is the
  // point: you are not teleported relative to the box, the whole fight shifts
  // left to make room for the spears' run-up on the right.
  const gt = boxOf(state);
  if (gt) {
    gt.x -= 70;
    gt.image_xscale = 2.5;
    // A non-2 scale makes this a CUSTOM box — different mask, quantised
    // scale — and obj_growtangle's first Step is what applies that, so it has
    // to be re-armed (CLAUDE.md, "THE CUSTOM ARENA IS A DIFFERENT OBJECT").
    gt.init = false;
  }
  if (state.soul) state.soul.x -= 70;
  if (knight) knight.image_alpha = 0;

  const e = spawn(state, knightTunnelSlasher, {
    x: x ?? knight?.x ?? 0,
    y: y ?? knight?.y ?? 0,
  });
  return e;
}

export { afterimage };
