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
// The burst now spawns real obj_knight_pointing_starchild instances
// (sim/attacks/pointing-starchild.js) with the per-difficulty speeds, angles
// and difficulty assignments. Not translated: sprite animation, afterimages,
// sounds.

import { spawn, destroy } from '../entity.js';
import { cue } from '../audio.js';
import { gmlChoose } from '../rng.js';
import { clamp01 } from '../gml.js';
import { STAR_MASK, scrPreciseHit, enginePairHit } from '../masks.js';
import { scrChildbulletCopy } from '../childbullet.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';
import { scrDamageAll } from '../damage.js';
import { pointingStarchild } from './pointing-starchild.js';

export const pointingStar = {
  name: 'obj_knight_pointing_star',

  create(e, state) {
    scrBulletInit(e);
    // MEASURED from the recording's sprite column. This was never assigned, so
    // the stars had no sprite and the renderer drew nothing for them — the
    // "stars sprites are not shown" report. The object's default sprite comes
    // from its GameMaker definition, which the GML dump does not contain, so
    // the trace is the only place it is written down.
    e.sprite_index = 'spr_knight_bullet_star';
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

    // The Create's `dir = choose(-1, 1)`. The value only feeds the Draw, but
    // the DRAW IS REAL and sits between the spawn and the controller's
    // size/special rolls — the oracle's ledger for the first star places it
    // at exactly that position. The old "documented deviation" (skip it)
    // held while nothing compared streams; the anchored whole-fight does.
    e.dir = state?.gmlRng ? gmlChoose(state.gmlRng, [-1, 1]) : 1;

    e.isBullet = true;
    e.builtinMotion = true;
    e.speed = 0;
    e.direction = 0;
    e.image_angle = 0;
    // `mask_index = spr_knight_bullet_star_mask` — CREATE line 19. The star is
    // dangerous from the moment it is fired.
    //
    // This used to set `maskOff = true` here, on the reading that the mask
    // only arrives at con 2 because the Step assigns it there too. The Step's
    // assignment is redundant; the Create already did it. The consequence was
    // that every star crossing the arena during the charge passed straight
    // through the soul, and the attack only became dangerous once the cone
    // released them — 0 hits at con 0 against 15 after, with the soul parked
    // directly on them.
    e.maskOff = false;
    // `mask_index = spr_knight_bullet_star_mask` — the SMALL diamond, not the
    // sprite's own spiked mask. Pinned on the entity so the graze test (which
    // reads `e.mask ?? SPRITE_MASKS[sprite]`) uses the override exactly as the
    // game's grazebox collides with the instance's current mask. The contact
    // probe below names STAR_MASK explicitly for the same reason.
    e.mask = STAR_MASK;
    e.burst = 0; // starchildren that WOULD have spawned
  },

  step(e, state) {
    // Offscreen cull, from the top of the original Step:
    //
    //   x < camerax() - sprite_width / 2 ||
    //   y < cameray() - sprite_height / 2 ||
    //   y > cameray() + 480 + sprite_height / 2
    //
    // THE MARGIN IS NOT A CONSTANT. GameMaker's `sprite_width` is the sprite's
    // width TIMES `image_xscale`, and these stars grow by `growspeed` every
    // frame, so the cull box widens as they age. An earlier version of this
    // translation hardcoded 12 and 18 — measured from one early frame — which
    // killed a long-lived star roughly 30 frames too soon and made the live
    // population diverge at f120.
    //
    // spr_knight_bullet_star / _easy are both 64x64.
    const halfW = (64 * Math.abs(e.image_xscale)) / 2;
    const halfH = (64 * Math.abs(e.image_yscale)) / 2;
    if (
      e.x < state.view.x - halfW ||
      e.y < state.view.y - halfH ||
      e.y > state.view.y + 480 + halfH
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
      e.maskOff = false; // the Step re-assigns the same mask at con 2
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
        // The star going off. `playSound` is false for the ones the controller
        // bursts in bulk, so a wave does not fire fifteen copies at once.
        if (e.playSound) cue(state, 'snd_explosion_firework');
      }
      e.growstart = e.image_xscale;
    } else if (e.con === 3) {
      e.timer += 1;
      e.image_xscale = e.growstart + clamp01(e.timer / 2);
      e.image_yscale = e.growstart + clamp01(e.timer / 2);

      if (e.timer === 3) {
        // THE BURST. Six children, always — the original computes
        // `var _count = 6; if (difficulty == 2) _count = 2;` and then loops
        // `for (i = 0; i < 6; i++)`. `_count` is never read. ORIGINAL BUG,
        // left as written.
        let angle = 90;
        if (e.difficulty === 2) angle += e.side;

        for (let i = 0; i < 6; i++) {
          const d = spawn(state, pointingStarchild, { x: e.x, y: e.y });
          // The full scr_childbullet copy set — including `grazed` and
          // `grazetimer` (see sim/childbullet.js: a star bursting mid-graze
          // seeds shards that trickle, never fresh-graze). NOT copied:
          // difficulty, which is why it is assigned explicitly below.
          scrChildbulletCopy(d, e);
          d.image_angle = angle;
          d.direction = angle;

          if (e.difficulty === 0 && i % 2 === 1) {
            // Half the shards at difficulty 0 are slow and short-lived: the
            // fight's "three of six travel and last shorter".
            d.speed = 1;
            d.lifetime = 30;
          } else {
            d.speed = 4;
          }

          d.image_xscale = e.image_xscale * 0.5;
          d.image_yscale = e.image_yscale * 0.5;
          d.deceleration = 0.15;

          if (e.difficulty === 2 && i % 3 > 0) {
            // Four of six become inert trail shards.
            d.difficulty = -1;
            d.lifetime = 30;
            d.speed = 2;
            if (i === 1 || i === 4) {
              d.speed /= 3;
              d.minspeed /= 3;
              d.deceleration /= 3;
            } else {
              d.speed *= 2 / 3;
              d.minspeed *= 2 / 3;
              d.deceleration *= 2 / 3;
            }
            d.sprite_index = 'spr_knight_starchild_trail';
          } else {
            // i = 0 and 3 at difficulty 2: these are the ones that home.
            d.difficulty = e.difficulty;
          }

          // At difficulty 2 the steps are 180 and 0, which collapses all six
          // onto TWO headings — the fight's "each star only explodes into two
          // shards".
          if (i === 1 || i === 4) angle += e.difficulty === 2 ? 180 : 48;
          else angle += e.difficulty === 2 ? 0 : 66;
        }

        e.burst = 6;
        e.active = false;
      }
      if (e.timer >= 4) {
        destroy(e);
      }
    }
  },

  /**
   * `scr_precise_hit(3)` — a 3px probe at the soul's CENTRE against the star's
   * mask, not a mask-vs-mask overlap.
   *
   * This used to be `masksOverlap(HEART_MASK, ...)`, which requires the soul's
   * heart SHAPE to overlap the star's, and is far stricter than what the game
   * does: stars visibly passing through the soul without registering. The
   * probe ignores the heart's outline entirely.
   */
  collides(e, heart) {
    // Engine pair test first, then the Other_15 probe — see enginePairHit.
    if (!enginePairHit(heart, e, STAR_MASK)) return false;
    return scrPreciseHit(heart, e, STAR_MASK, 3);
  },

  other15: starOther15,
};

/**
 * `obj_knight_pointing_star`'s Other_15 — and it is NOT the inherited one.
 *
 *     target = 3;
 *     damage = 75;
 *     with (obj_knight_enemy) aoedamage = true;
 *     if (active == 1) {
 *         if (!scr_precise_hit(3)) exit;
 *         if (target == 3) scr_damage_all();
 *         if (destroyonhit == 1) instance_destroy();
 *     }
 *     with (obj_knight_enemy) aoedamage = false;
 *
 * THREE THINGS the generic handler got wrong, and the port used the generic
 * handler for both the star and its children:
 *
 * 1. **THE DAMAGE IS 75, SET AT CONTACT.** The `damage = 1` in Create is a
 *    placeholder the hit overwrites. An audit that compares the sim's value
 *    against every `damage =` in the object sees 1 in a list of [1, 75] and
 *    calls it a match — which is exactly what happened here. The value that
 *    matters is the one live AT THE MOMENT OF THE HIT.
 *
 * 2. **`target = 3` MEANS THE WHOLE PARTY.** It is `scr_damage_all`, not
 *    `scr_damage`. Stars was hitting one character for 1 instead of all three
 *    for 75.
 *
 * 3. **`aoedamage = true` FOR THE DURATION.** The Knight's targeting block
 *    reads it: an AOE hit skips the redirect-away-from-Kris and the
 *    ShadowMantle pull entirely, because an attack that hits everyone has
 *    nobody to redirect to. Set and cleared around the call, not left on.
 */
export function starOther15(e, state) {
  if (e.active !== 1 && e.active !== true) return;
  e.damage = 75;
  e.target = 3;
  scrDamageAll(state, e.damage, { aoe: true, element: 5 });
  // `destroy` takes THE ENTITY — `destroy(state, e)` marked the state object
  // dead and left the bullet alive. Invisible until the whole-fight diff
  // counted bullets on a hit frame: starchildren keep destroyonhit=1 from
  // scr_bullet_init, so the game's hitter died at f296 while the sim's flew
  // on (79 live vs the recording's 78).
  if (e.destroyonhit === 1) destroy(e);
}
