// The battle box — obj_growtangle at steady state.
//
// obj_growtangle's parent object is obj_battlesolid, so the box itself is
// what place_meeting(…, obj_battlesolid) hits: the hollow-ring precise mask
// of spr_battlebg_0, scaled by image_xscale/yscale, origin centred (37,37).
//
// This module models the box ALREADY GROWN (image scale = maxscale, angle 0),
// which is the steady state every attack plays out in. The 15-frame grow-in
// (obj_growtangle Create: timer 0..15, scale ramping, image_angle spinning
// 180..360) is deliberately not modelled: fractional-scale rotated precise
// masks have rasterization semantics the oracle showed we do not reproduce
// (t3 trace frames 0-3). Grow-in support needs its own oracle study first.

import { BATTLEBG_MASK } from './masks.js';

export const battlebox = {
  name: 'obj_growtangle',

  create(e) {
    // Defaults from obj_growtangle Create, post-grow values.
    if (e.xscale === undefined) e.xscale = 2; // maxxscale
    if (e.yscale === undefined) e.yscale = 2; // maxyscale
    e.isSolid = true; // parent: obj_battlesolid
    e.mask = BATTLEBG_MASK;
    e.keep = 0;
    e.megakeep = 0;
    // GML built-ins: creation position. The slash's box jitter re-bases off
    // these every frame (x = xstart + choose(...)), it does not accumulate.
    e.xstart = e.x;
    e.ystart = e.y;
  },

  // obj_growtangle End Step: while the box is MOVING (path_speed or speed
  // nonzero, or megakeep), the heart is clamped to the interior. Static box
  // (the T3 case) never runs this branch. Translated now, exercised never —
  // do not trust it until a moving-box attack gets an oracle diff.
  endStep(e, state) {
    if (e.keep === 1) {
      const heart = state.soul;
      if (heart && heart.alive) {
        if (e.path_speed !== 0 || e.speed !== 0 || e.megakeep === 1) {
          const lborder = e.x - (e.mask.w * e.xscale) / 2;
          const rborder = e.x + (e.mask.w * e.xscale) / 2;
          const uborder = e.y - (e.mask.h * e.yscale) / 2;
          const dborder = e.y + (e.mask.h * e.yscale) / 2;
          if (heart.x < lborder + 5) heart.x = lborder + 5;
          if (heart.x > rborder - 22) heart.x = rborder - 22;
          if (heart.y < uborder + 5) heart.y = uborder + 5;
          if (heart.y > dborder - 22) heart.y = dborder - 22;
        }
      }
    }
  },
};
