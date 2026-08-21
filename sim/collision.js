// GameMaker `place_meeting` against obj_battlesolid, precise-mask edition.
//
// What "solid" means here, learned from the oracle (see CLAUDE.md):
// obj_growtangle's parent object IS obj_battlesolid, so the battle box itself
// is the wall — place_meeting collides the soul's heart-shaped mask against
// the box sprite's hollow-ring mask. There is no separate wall object in the
// bullettest scenario, and none in the room.
//
// An entity participates as a solid by carrying:
//   isSolid: true, mask: <mask from masks.js>, xscale, yscale
// with x/y as its origin position (box origin is centred, 37,37).

import { HEART_MASK, masksOverlap } from './masks.js';

export { HEART_MASK };

export function placeMeetingSolid(state, x, y) {
  // The soul's CURRENT mask — the fight soul carries the spr_dodgeheart
  // 20x20 rect (obj_moveheart's Alarm_0 handoff; see HEART_RECT in
  // masks.js), the tester room's soul the heart-shaped precise mask. The
  // wall rests differ between rooms by exactly this bbox difference.
  const heartMask = state.soul?.mask ?? HEART_MASK;
  for (const o of state.entities) {
    if (!o.alive || !o.isSolid || !o.mask) continue;
    if (masksOverlap(heartMask, x, y, o.mask, o.x, o.y, o.image_xscale, o.image_yscale)) {
      return true;
    }
  }
  return false;
}
