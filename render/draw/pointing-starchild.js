// obj_knight_pointing_starchild's Draw event, ported whole.
//
// The shards that burst out of each star. Three layers, and the middle one is
// the reason they read as dangerous rather than as debris:
//
//   * an additive GLOW outline (`scr_draw_outline`) whose colour tracks the
//     child's state — white while it drifts, `merge_color(c_white, c_red,
//     timer/10)` while it winds up, and flat RED once it is homing. The glow
//     brightness ping-pongs every other frame.
//   * frame 1 tinted with the instance's `outline` colour, additively. That
//     colour is driven from the Step (`merge_color(c_black, c_red, cos(...))`)
//     and pulses through black, so the overlay appears and vanishes with the
//     same cosine that squashes the sprite during the flip.
//   * frame 0 normally, tinted with `image_blend` — which the same Step line
//     drives from white to black, so the shard darkens as it turns edge-on.
//
// con 4 replaces all of it with `spr_thrash_missile_explosion`, indexed by
// `timer` and tinted red: the shard detonating.

import {
  drawSpriteExt, drawOutline, mergeColor, pingpong, clamp01,
  c_white, c_red, c_black,
} from './gm.js';

export function drawPointingStarchild(ctx, e, state, deps) {
  const { sprites } = deps;

  if (e.con === 4) {
    const boom = sprites.get('spr_thrash_missile_explosion');
    const scale = (e.image_yscale + e.image_xscale) / 2;
    drawSpriteExt(ctx, boom, e.timer, e.x, e.y, scale, scale, e.image_angle - 90, c_red, 1);
    return true;
  }

  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return false;

  // `drawtimer++` lives in the Draw event in the original, and the fade below
  // reads it — so it is advanced in sim/attacks/pointing-starchild.js's
  // endStep, which is the phase that runs where Draw does.
  const glow = pingpong(e.drawtimer, 2) / 4;

  let glowcol = c_white;
  if (e.con >= 1) {
    glowcol = e.con > 1 ? c_red : mergeColor(c_white, c_red, e.timer / 10);
  }

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  drawOutline(ctx, entry, e, e.image_xscale, glowcol, glow * e.image_alpha);
  if (e.con > 0) {
    drawSpriteExt(ctx, entry, 1, e.x, e.y, e.image_xscale, e.image_yscale,
      e.image_angle, e.outline ?? c_black, e.image_alpha);
  }
  ctx.restore();

  drawSpriteExt(ctx, entry, 0, e.x, e.y, e.image_xscale, e.image_yscale,
    e.image_angle, e.image_blend ?? c_white, e.image_alpha);

  return true;
}
