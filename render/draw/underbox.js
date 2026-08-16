// obj_knight_weird_circle's Draw — the orb, which is not drawn as a sprite at
// all but as its own 12 scanlines, each shifted sideways on a travelling sine:
//
//     if (alarm[0] && (alarm[0] % 2) < 1) exit;
//     image_blend = make_color_rgb(r, g, b);
//     for (a = 0; a < sprite_height; a++)
//         draw_sprite_part_ext(sprite_index, image_index, 0, a,
//             sprite_width, 1,
//             (x - 24) + (sin((a + timer) * 0.5) * 2), (y - 6) + a,
//             1, 1, image_blend, image_alpha);
//     if (alarm[1] < 6 && alarm[1] > -1)
//         draw_sprite_ext(sprite_index, image_index, x, y,
//             1 - (alarm[1] * 0.165), 1 - (alarm[1] * 0.165),
//             image_angle, c_black, image_alpha);
//
// Three things worth naming, because none of them is decoration:
//
// 1. THE ROW OFFSET IS A TRAVELLING WAVE, not a per-frame jitter. The phase is
//    `(row + timer) * 0.5`, so the wobble crawls down the orb at a fixed rate
//    and is a pure function of the sim frame — the 30Hz rule (CLAUDE.md) with
//    nothing to seed, since there is no randomness in it at all.
//
// 2. `(x - 24, y - 6)` is a HAND-CENTRED draw. draw_sprite_part_ext ignores
//    the sprite's origin, so the original subtracts half of the 48x12 sheet
//    itself. The black copy below uses draw_sprite_ext, which DOES honour the
//    origin (24, 6) — so both land in the same place, by two different routes.
//
// 3. THE BLACK COPY IS THE MUZZLE FLASH, inverted. In the last five frames
//    before the orb fires, a black silhouette grows from 0.175 up to nearly
//    full size on top of the white-hot glow — the orb goes dark at the exact
//    moment it is brightest. That is the tell you dodge on.
//
// The blink at the top runs off alarm[0] (6 frames at spawn, `exit` on the
// even values), so a new orb strobes into the ring rather than appearing.

import { drawSpriteExt, tinted } from './gm.js';

/** GameMaker `draw_sprite_part_ext` for one 1px row, colour multiplied. */
function drawRow(ctx, img, srcY, w, x, y, color, alpha) {
  if (!img || srcY < 0 || srcY >= img.height) return;
  const src = color ? tinted(img, color) : img;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.drawImage(src, 0, srcY, w, 1, x, y, w, 1);
  ctx.restore();
}

export function drawWeirdCircle(ctx, e, state, deps) {
  const { sprites } = deps;
  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return true;

  // `if (alarm[0] && (alarm[0] % 2) < 1) exit;` — GML truthiness is > 0.5, so
  // an idle -1 never blinks; a counting alarm hides the orb on even frames.
  if (e.alarm[0] > 0.5 && e.alarm[0] % 2 < 1) return true;

  const img = entry.frames[0];
  const vx = state.view.x;
  const vy = state.view.y;
  const alpha = e.image_alpha ?? 1;
  const blend = [
    Math.max(0, Math.min(255, Math.round(e.r))),
    Math.max(0, Math.min(255, Math.round(e.g))),
    Math.max(0, Math.min(255, Math.round(e.b))),
  ];
  // sprite_width / sprite_height — the orb never scales, so 48 x 12.
  const w = entry.meta.w ?? img.width;
  const h = entry.meta.h ?? img.height;

  for (let a = 0; a < h; a++) {
    drawRow(ctx, img, a, w,
      Math.round((e.x - 24) + Math.sin((a + e.timer) * 0.5) * 2) - vx,
      Math.round((e.y - 6) + a) - vy,
      blend, alpha);
  }

  if (e.alarm[1] < 6 && e.alarm[1] > -1) {
    const s = 1 - e.alarm[1] * 0.165;
    drawSpriteExt(ctx, entry, 0, e.x - vx, e.y - vy, s, s,
      e.image_angle ?? 0, [0, 0, 0], alpha);
  }
  return true;
}

/**
 * obj_knight_weird_bottom_manager's Draw — his warp pose with a slow breathe:
 * `y + sin(global.time * 0.1) * 2`. Two pixels, but without it he sits dead
 * still while everything under him turns.
 */
export function drawWeirdBottomManager(ctx, e, state, deps) {
  const { sprites } = deps;
  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return true;
  drawSpriteExt(ctx, entry, e.image_index ?? 0,
    e.x - state.view.x,
    (e.y - state.view.y) + Math.sin(state.frame * 0.1) * 2,
    e.image_xscale ?? 2, e.image_yscale ?? 2, e.image_angle ?? 0,
    e.image_blend, e.image_alpha ?? 1);
  return true;
}
