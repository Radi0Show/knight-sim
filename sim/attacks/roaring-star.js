// obj_knight_roaring_star — the bullets of ROARING (ac 9, dc.type 107), the
// phase 4 finale.
//
// A SIBLING of obj_knight_pointing_star (the Stars attack), not a copy: same
// con skeleton — friction at con 1, gravity reversed along `direction - 180`
// at con 2, a six-child burst at con 3 — but `diff` on the two Steps is 153
// lines. What roaring adds:
//
//   split      a star can halve into a top and bottom piece that drift apart
//              (con 2.5, `splitease`), and the halves burst separately
//   outbound   it will NOT despawn until it has been on screen at least once.
//              These stars are FIRED FROM OFF SCREEN toward the knight, so
//              without this every one of them would die on its first frame.
//
// and what it drops: the growth phase and the graze timer.
//
// The offscreen bounds are scale-dependent, as in pointing-star.js —
// `sprite_width` is the sprite's width TIMES image_xscale, not a constant.
// That mistake cost a long-standing divergence in the Stars attack; it is not
// repeated here.
//
// NOT translated: Other_10 and Other_11, which are pure drawing (beams, the
// split halves, colour ramps) and carry no state — unlike the CONE's Draw,
// which turned out to drive its opening. Checked, not assumed.
//
// Other_15 IS modelled now. It was skipped when sim/masks.js had no
// `scr_precise_hit`; it has one, so these stars are dangerous again — they
// were flying straight through the soul.
//
//     if (active == 1) {
//         var _hitbox = (obj_heart.sprite_index == spr_dodgeheart_smaller_2px)
//                       ? 0 : 2;
//         if (!scr_precise_hit(_hitbox)) exit;
//         ... damage ...
//         if (destroyonhit == 1) instance_destroy();
//     }
//
// `destroyonhit` is 0 for every star the rings and the roar fire, so they pass
// THROUGH the soul rather than popping on contact — the damage repeats while
// they overlap, gated only by the soul's invulnerability.

import { spawn, destroy } from '../entity.js';
import { cue } from '../audio.js';
import { clamp01, scrEaseOut } from '../gml.js';
import { STAR_FULL_MASK, scrPreciseHit, enginePairHit } from '../masks.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';
import { knightCatch } from '../knight.js';
import { scrChildbulletCopy } from '../childbullet.js';
import { pointingStarchild } from './pointing-starchild.js';

export const roaringStar = {
  name: 'obj_knight_roaring_star',

  /**
   * THE STAR STEPS BEFORE THE CONTROLLER THAT PROMOTES IT.
   *
   * obj_knight_roaring2's Step releases one caught star per frame with
   * `con = 1`, and the star's own Step turns that into `friction = 0.5; con++`.
   * If the star runs after the controller it sees `con == 1` on the SAME frame
   * it was released, and the whole brake -> reverse -> burst arc finishes in 44
   * frames. The recording takes 45.
   *
   * That one frame is the entire f679+ divergence: from the first burst the
   * engine was a star short for the rest of the run, and stayed EXACTLY one
   * short, because the stars die one per frame and every one of them died a
   * frame early.
   *
   * This is the second sighting of the same ordering — obj_sword_vortex steps
   * before its manager too, reading the previous frame's `siner` (CLAUDE.md,
   * "Mid-phase spawns"). Two independent attacks now need the spawned object to
   * step first, which is a good deal more than one special case.
   */
  stepOrder: -1,

  create(e, state) {
    scrBulletInit(e);
    e.image_xscale = 0;
    e.image_yscale = 0;
    e.even = false;
    e.destroyonhit = false;
    e.timer = 0;
    e.con = 0;
    e.growstart = 0;
    e.playSound = true;
    e.beamflicker = 0;
    e.split = 0;
    e.outbound = false;
    e.splitmax = 14;
    e.splitease = 0;
    e.finalx = 0;
    e.damage = 206;
    e.element = 5;
    e.sprite_index = 'spr_knight_bullet_star';
    e.isBullet = true;
    e.builtinMotion = true;
  },

  /**
   * `scr_precise_hit(2)` — a 2px probe at the soul's centre against the star's
   * mask. The 0 variant is for the shrunken soul sprite, which this project
   * does not use.
   *
   * THE MASK IS THE SPRITE'S OWN — the full 2040px spiked star. Unlike the
   * Stars attack's pointing star, this object sets NO mask_index, so both the
   * engine pair test and the probe run against `spr_knight_bullet_star`
   * itself. It ran against the small diamond (42% of the ink) for a while,
   * which made the rings pass visibly through the soul without registering —
   * reported from play, and the report was right.
   */
  collides(e, heart, state) {
    if (state && state.replayContacts) return false;
    if (e.active !== 1 && e.active !== true) return false;
    // Engine pair test first, then the Other_15 probe — see enginePairHit.
    if (!enginePairHit(heart, e, STAR_FULL_MASK)) return false;
    return scrPreciseHit(heart, e, STAR_FULL_MASK, 2);
  },

  /**
   * `obj_knight_roaring_star`'s Other_15 — a CATCH, not a hit.
   *
   *     if (i_ex(obj_knight_roaring2)) with (obj_knight_enemy) event_user(2);
   *     else { target != 3 ? scr_damage() : scr_damage_all(); }
   *
   * Roaring stars only exist while Roaring is on screen, so the catch is the
   * live path and the damage branch is unreachable in practice. This had the
   * generic handler, which dealt the star's own 206 to one character and made
   * the finale the most lethal attack in the fight — when the real thing is
   * 40 to everyone and cannot fell anybody.
   */
  other15(e, state) {
    if (e.active !== 1 && e.active !== true) return;
    if (state.roaringActive) knightCatch(state);
    else collidebulletOther15(e, state);
    // destroy takes the entity — see the note in pointing-star's other15.
    if (e.destroyonhit === 1) destroy(e);
  },

  step(e, state) {
    // Scale-dependent bounds; spr_knight_bullet_star is 64x64.
    const halfW = 64 * Math.abs(e.image_xscale);
    const halfH = 64 * Math.abs(e.image_yscale);
    const off =
      e.x < state.view.x - halfW ||
      e.x > state.view.x + 640 + halfW ||
      e.y < state.view.y - halfH ||
      e.y > state.view.y + 480 + halfH;

    if (off) {
      // Only once it has been seen. These are fired from off screen.
      if (e.outbound) {
        destroy(e);
        return;
      }
    } else {
      e.outbound = true;
    }

    if (e.con === 1) {
      e.friction = 0.5;
      e.con += 1;
    } else if (e.con === 2) {
      if (e.speed === 0 && e.gravity === 0) {
        // Braked to a stop; now it falls BACKWARDS along its original heading
        // and accelerates away.
        e.gravity = 0.1;
        e.gravity_direction = e.direction - 180;
        e.friction = 0;
      }
      e.timer += 1;
      if (e.timer >= 40 && !e.split) {
        e.timer = 0;
        e.con += 1;
        // The star going off. `playSound` is false for the ones the controller
        // bursts in bulk, so a wave does not fire fifteen copies at once.
        if (e.playSound) cue(state, 'snd_explosion_firework');
      }
      e.growstart = e.image_xscale;
    } else if (e.con === 2.5) {
      if (e.split === 1) {
        e.speed = 0;
        e.gravity = 0;
        e.sprite_index = 'spr_knight_bullet_star_top';
        e.timer = -10;
        e.split = 2;
      }
      e.timer += 1;
      e.splitease = scrEaseOut(clamp01(e.timer / 20), 4) * e.splitmax * e.image_xscale;
      if (e.timer === 20) {
        e.con = 3;
        e.timer = 0;
      }
    } else if (e.con === 3) {
      e.timer += 1;
      e.image_xscale = e.growstart + clamp01(e.timer / 2);
      e.image_yscale = e.growstart + clamp01(e.timer / 2);

      if (e.timer === 3) {
        let angle = 90;
        for (let i = 0; i < 6; i++) {
          let xx = e.x;
          let yy = e.y;
          if (e.split > 0) {
            // A split star throws its children from the two halves rather
            // than from its centre.
            if (i === 0 || i >= 4) {
              xx += (e.splitmax * e.image_xscale) / 2;
              yy += e.splitmax * e.image_xscale;
            } else {
              xx -= (e.splitmax * e.image_xscale) / 2;
              yy -= e.splitmax * e.image_xscale;
            }
          }
          // NOTE the original creates the child at (x, y), NOT at (_xx, _yy) —
          // it computes the split offsets and then does not use them.
          // ORIGINAL BUG, preserved.
          const d = spawn(state, pointingStarchild, { x: e.x, y: e.y });
          // scr_childbullet's copy set, grazed/grazetimer included — see
          // sim/childbullet.js.
          scrChildbulletCopy(d, e);
          d.image_angle = angle;
          d.direction = angle;
          d.speed = 1;
          d.friction = -0.1;
          d.image_xscale = e.image_xscale * 0.5;
          d.image_yscale = e.image_yscale * 0.5;
          d.deceleration = 0.15;
          angle += i === 1 || i === 4 ? 57 : 66;
        }
      }

      if (e.timer >= 4) {
        if (globalThis.process?.env?.KNIGHT_RSTAR_DEBUG) {
          console.error(`[rstar] burst f=${state.frame} seq=${e.seq}`
            + ` (${e.x.toFixed(2)},${e.y.toFixed(2)})`);
        }
        destroy(e);
      }
    }
  },
};
