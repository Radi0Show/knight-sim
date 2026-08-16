// obj_fallingsword's Draw — the motion trail, then the sword.
//
//     i = max_old - 1;
//     while (i > 0) {
//         draw_sprite_ext(sprite_index, 0, old_x[i], old_y[i],
//             image_xscale, image_yscale - 0.2 * i, old_angle[i],
//             c_white, image_alpha - 0.3 * i);
//         i--;
//     }
//     draw_self();
//
// Two ghosts behind the blade at its previous two positions, each a little
// flatter and a lot fainter — which is what sells a sword travelling faster
// than the frame rate can show. Note the ghosts use the LIVE xscale and alpha
// with a per-step offset, not stored ones, so they thin out as the sword's own
// wobble squashes it.
//
// The manager (obj_knight_swordfall) draws its own pose at a FIXED screen x —
// `camerax() + 544` — rather than at its instance position while `forcexfix`
// is set or while it wears the sword pose, with a `sin(global.time * 0.1) *
// dip` breathe on top. That is why he reads as standing off to the right
// through the whole attack.

import { drawSpriteExt } from './gm.js';

export function drawFallingSword(ctx, e, state, deps) {
  const { sprites } = deps;
  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return true;

  const vx = state.view.x;
  const vy = state.view.y;
  const xs = e.image_xscale ?? 1;
  const ys = e.image_yscale ?? 1;
  const alpha = e.image_alpha ?? 1;

  for (let i = (e.old_x?.length ?? 1) - 1; i > 0; i--) {
    const a = alpha - 0.3 * i;
    if (a <= 0) continue;
    drawSpriteExt(ctx, entry, 0, e.old_x[i] - vx, e.old_y[i] - vy,
      xs, ys - 0.2 * i, e.old_angle[i], null, a);
  }
  drawSpriteExt(ctx, entry, 0, e.x - vx, e.y - vy, xs, ys, e.image_angle ?? 0,
    e.image_blend, alpha);
  return true;
}

/** The manager's own Draw — the fixed-x pose with its dip breathe. */
export function drawSwordfallKnight(ctx, e, state, deps) {
  const { sprites } = deps;
  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return true;
  const k = state.knight;
  const dip = Math.sin(state.frame * 0.1) * (e.dip ?? 0);
  const idx = Math.abs(Math.floor(e.image_index ?? 0)) % entry.frames.length;

  if (e.forcexfix && e.sprite_index === 'spr_roaringknight_attack_ol_center') {
    // `_siner++` lives in the Draw, but a renderer must not advance state —
    // the sim owns it, and the hover is handed back to the knight by alarm 4.
    const y = (k?.ystart ?? 78) + Math.cos((e._siner ?? 0) / 8) * 8;
    drawSpriteExt(ctx, entry, idx, 544, y,
      e.image_xscale ?? 2, e.image_yscale ?? 2, e.image_angle ?? 0, e.image_blend,
      e.image_alpha ?? 1);
  } else if (e.sprite_index === 'spr_roaringknight_sword_ol') {
    drawSpriteExt(ctx, entry, idx, 544, e.y - state.view.y + dip + 30,
      e.image_xscale ?? 2, e.image_yscale ?? 2, e.image_angle ?? 0, e.image_blend,
      e.image_alpha ?? 1);
  } else {
    drawSpriteExt(ctx, entry, idx, e.x - state.view.x, e.y - state.view.y + dip,
      e.image_xscale ?? 2, e.image_yscale ?? 2, e.image_angle ?? 0, e.image_blend,
      e.image_alpha ?? 1);
  }
  return true;
}
