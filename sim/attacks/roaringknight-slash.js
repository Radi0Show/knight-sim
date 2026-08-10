// obj_roaringknight_slash — translated from:
//   Create_0, Alarm_0 (exit), Alarm_1, Step_2 (End Step), Other_15 (User 5)
//
// Parent chain: obj_collidebullet -> obj_bulletparent (both codeless except
// collidebullet's default Other_15, which this object overrides), so
// event_inherited() in Create is a no-op.
//
// RNG: choose() calls are replayed from a recorded table (state.chooseTable),
// per the CLAUDE.md RNG policy — the oracle's outcomes are logged and
// reproduced, not re-rolled. Order matters: slashdir at create, then per
// jitter frame x-choose before y-choose.
//
// Oracle-verified against traces/t4-slash.csv: shrink chain 24 -> x0.66/frame
// (f64 exact), 4 jitter frames while width > 4, box permanently displaced,
// heart clamped each jitter frame, destroy at width < 0.5.
//
// GML truthiness note: `if (!alarm[0])` is true for alarm values <= 0.5 —
// armed (>0) is false, fired/idle (-1) is true. Translated explicitly.

import { destroy } from '../entity.js';
import { scrHeartclamp } from '../heartclamp.js';
import { HEART_MASK, masksOverlap } from '../masks.js';
import { gmlChoose } from '../rng.js';

/**
 * choose() for this attack.
 *
 * Historical note: attack 1 predates the discovery of GameMaker's actual
 * generator, so its oracle scene supplies a recorded outcome table. Scenes
 * that postdate `gmlRng` (rotating slash onward) supply no table and draw
 * from the real stream instead. Both paths are exercised by the suite.
 */
function chooseReplay(state, values) {
  if (state.chooseTable) {
    if (state.chooseIndex >= state.chooseTable.length) {
      throw new Error(
        'choose() replay table exhausted — this scenario needs more recorded RNG outcomes',
      );
    }
    return state.chooseTable[state.chooseIndex++];
  }
  return gmlChoose(state.gmlRng, values);
}

// spr_rk_quickslash_marker: 250x46, origin (125,23), Precise; every subimage's
// mask is the full 250px line on row 22 only. Encoded directly rather than
// shipped as JSON — one row is not worth a data file.
const SLASH_MASK = {
  name: 'spr_rk_quickslash_marker',
  w: 250,
  h: 46,
  originX: 125,
  originY: 23,
  bbox: [0, 22, 249, 22],
  px: Array.from({ length: 46 }, (_, y) =>
    y === 22 ? new Array(250).fill(true) : new Array(250).fill(false),
  ),
};

export const roaringknightSlash = {
  name: 'obj_roaringknight_slash',

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
    // event_inherited(): no-op (codeless parents)

    e.active = true;
    e.element = 5;
    e.width = 24;
    e.grazepoints = 50;
    e.aoe = true;
    e.alarm[0] = 1;
    e.alarm[1] = 3;
    e.image_index = 2;
    e.image_speed = 0;
    e.image_yscale = 0.1;
    e.slashdir = chooseReplay(state, [-1, 1]); // choose(-1, 1) — Draw-only, but consumes RNG
    e.destroyonhit = false;

    e.isBullet = true;
    e.xscale = 1;
    e.image_angle = 0; // real spawners set image_angle = direction
  },

  alarm: {
    0: () => {}, // exit;
    1: (e) => {
      e.maskOff = true; // mask_index = spr_nomask
    },
  },

  // Collision test used by the engine's collision phase (the heart's
  // Collision_obj_collidebullet -> event_user(5)). The model behind
  // masksOverlap is calibrated against 48 oracle data points, this mask
  // included (tools/verify-contact.mjs): axis-aligned at yscale 0.1 the
  // line cannot connect (its integer bbox samples off the mask row), which
  // is why t4-slash records no hit; rotated to the diagonals the real
  // spawners use, it does.
  collides(e, heart, state) {
    return masksOverlap(
      HEART_MASK, heart.x, heart.y,
      SLASH_MASK, e.x, e.y, e.xscale, e.image_yscale, e.image_angle,
    );
  },

  // Other_15 (User Event 5) — fired by the heart's collision event.
  other15(e, state) {
    e.damage = 206;
    if (e.aoe === true) {
      e.damage = 75;
      e.target = 3;
      // with (obj_knight_enemy) aoedamage = true — no knight enemy in the
      // tester scenario; translate when the fight controller lands.
    }
    if (e.active === 1 || e.active === true) {
      // target != 3 -> scr_damage(); target == 3 -> scr_damage_all().
      // Dodge-only translation of scr_damage_all's observable effect:
      // gated on global.inv < 0, resets it to invc*30 (invc = 1 here).
      // Party hp[] bookkeeping is out of scope (hardcoded HP per CLAUDE.md).
      if (e.target === 3) {
        if (state.invTimer < 0) {
          state.invTimer = state.invc * 30;
        }
      }
      if (e.destroyonhit === 1 || e.destroyonhit === true) {
        destroy(e);
      }
    }
  },

  // Step_2 — End Step. Order preserved exactly: shrink, active check,
  // destroy check, then jitter + clamp while width > 4.
  endStep(e, state) {
    e.damage = 206;
    e.grazepoints = 50;

    if (!(e.alarm[0] > 0.5)) {
      // GML: if (!alarm[0])
      e.width *= 0.66;
      e.image_alpha = (e.image_alpha ?? 1) * 0.66;
    }
    if (e.width < 12) {
      e.active = false;
    }
    if (e.width < 0.5) {
      destroy(e);
    }
    if (e.width > 4) {
      const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
      if (gt) {
        gt.x = gt.xstart + chooseReplay(state, [-2, -1, 0, 1, 2]); // choose(-2,-1,0,1,2)
        gt.y = gt.ystart + chooseReplay(state, [-2, -1, 0, 1, 2]);
      }
      scrHeartclamp(state);
    }
  },
};
