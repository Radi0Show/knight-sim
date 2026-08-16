// obj_bullet_knight_tunnelslash's Draw — a spear drawn TWICE and then cut off
// by the arena wall.
//
//     if (!surface_exists(spear_surface)) spear_surface = surface_create(100, 100);
//     surface_set_target(spear_surface);
//     draw_clear_alpha(c_black, 0);
//     draw_sprite_ext(sprite_index, image_index, 50, 50,
//         image_xscale + sin(timer * 2) * 0.2,
//         image_yscale + sin(timer * 2) * 0.05,
//         image_angle, c_gray, image_alpha);
//     draw_sprite_ext(sprite_index, image_index, 50, 50,
//         image_xscale * 0.85 + sin(timer * 2) * 0.1,
//         image_yscale + sin(timer * 2) * 0.05,
//         image_angle, image_blend, image_alpha);
//     surface_reset_target();
//     if (y > scr_get_box(1) + 8 && y < scr_get_box(3) - 8) {
//         var cut = max((scr_get_box(2) + 7) - (x - 50), 0);
//         draw_surface_part(spear_surface, cut, 0, 100 - cut, 100, (x - 50) + cut, y - 50);
//     } else {
//         draw_surface_part(spear_surface, 0, 0, 100, 100, x - 50, y - 50);
//     }
//
// TWO THINGS, and both are load-bearing:
//
// 1. THE OUTLINE IS A SECOND COPY, not a shader. A c_gray spear at the full
//    scale, then the real one at 85% of the x scale over it — so the grey
//    shows only as a rim along the long axis. Both breathe on `sin(timer * 2)`
//    at different amplitudes (0.2 against 0.1), which makes the rim itself
//    pulse rather than the whole shape.
//
// 2. THE CUT IS WHAT PUTS IT IN THE WALL. For a spear whose y lies inside the
//    box's rows, the left of the surface is clipped at `box left + 7`, so the
//    part that would hang over the arena is simply not drawn and the spear
//    reads as buried in the wall. Spears outside those rows are drawn whole
//    and sail past. Note the clip is on the SURFACE, not on the sprite: the
//    100x100 buffer is what makes a single `draw_surface_part` able to cut a
//    rotated sprite at a world x.
//
// The surface is rebuilt every frame in the original (`draw_clear_alpha` then
// two draws), so a per-frame scratch canvas here is not a shortcut.

import { drawSpriteExt } from './gm.js';

let scratch = null;
function surface() {
  if (!scratch) {
    scratch = document.createElement('canvas');
    scratch.width = 100;
    scratch.height = 100;
  }
  return scratch;
}

export function drawTunnelslash(ctx, e, state, deps) {
  const { sprites } = deps;
  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return true;

  const c = surface();
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, 100, 100);

  const wob = Math.sin(e.timer * 2);
  const alpha = e.image_alpha ?? 1;
  const ys = (e.image_yscale ?? 1) + wob * 0.05;
  drawSpriteExt(g, entry, e.image_index ?? 0, 50, 50,
    (e.image_xscale ?? 1) + wob * 0.2, ys, e.image_angle ?? 0,
    [128, 128, 128], alpha);
  drawSpriteExt(g, entry, e.image_index ?? 0, 50, 50,
    (e.image_xscale ?? 1) * 0.85 + wob * 0.1, ys, e.image_angle ?? 0,
    e.image_blend, alpha);

  const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
  const hw = gt ? (gt.image_xscale ?? 2) * 37.5 : 75;
  const hh = gt ? (gt.image_yscale ?? 2) * 37.5 : 75;
  const boxTop = gt ? gt.y - hh : state.view.y + 95;
  const boxBottom = gt ? gt.y + hh : state.view.y + 245;
  const boxLeft = gt ? gt.x - hw : state.view.x + 245;

  const vx = state.view.x;
  const vy = state.view.y;
  if (e.y > boxTop + 8 && e.y < boxBottom - 8) {
    const cut = Math.max(boxLeft + 7 - (e.x - 50), 0);
    if (cut < 100) {
      ctx.drawImage(c, cut, 0, 100 - cut, 100,
        Math.round(e.x - 50 + cut) - vx, Math.round(e.y - 50) - vy, 100 - cut, 100);
    }
  } else {
    ctx.drawImage(c, Math.round(e.x - 50) - vx, Math.round(e.y - 50) - vy);
  }
  return true;
}
