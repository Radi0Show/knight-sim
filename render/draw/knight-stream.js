// obj_knight_stream's Draw — the whole attack's look lives in the MANAGER,
// not in the bullets (obj_bullet_knight_stream's own Draw is a bare `exit;`).
//
//     draw_self();
//     scr_draw_in_box_ext_begin(-4, -4);
//     with (obj_regularbullet)          draw_self();
//     with (obj_knight_streamline)      ... draw_line_width_color(c_gray)
//     with (obj_bullet_knight_stream)   ... draw_line_width_color(c_red)
//     with (obj_bullet_knight_stream)   if (width > 8) ... c_maroon at
//                                       width * (0.8 + sin(global.time*pi)*0.2)
//     with (obj_bullet_knight_stream)   if (width > 8) ... c_black at
//                                       width * (0.65 + sin(...)*0.2)
//     scr_draw_in_box_end();
//
// So each beam is THREE stacked lines — a red body with a maroon layer and a
// black core inside it, the inner two pulsing on a sine — and everything,
// including the diamonds, is CLIPPED TO THE BATTLE BOX. That clip is the
// attack's whole presentation: the beams read as something happening inside
// the arena rather than lines drawn over the screen.
//
// The endpoint maths (`line_length`, `width`, x1/y1/x2/y2) advances in the sim
// (sim/attacks/knight-stream.js) because the original computes it inside this
// Draw and it is per-frame state; a renderer that advanced it would run at the
// monitor's rate, not 30Hz.

import { drawSpriteExt } from './gm.js';

/** `scr_draw_in_box_ext_begin(-4, -4)` — the arena, grown by 4 on each side. */
function clipToBox(ctx, state) {
  const gt = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
  if (!gt) return false;
  // gt_minx/miny/maxx/maxy are the box's drawn extent; the script insets by 5
  // and then back out by `arg`, which for (-4, -4) nets +1 inside each edge.
  const hw = (gt.image_xscale ?? 2) * 37.5;
  const hh = (gt.image_yscale ?? 2) * 37.5;
  const minx = gt.x - hw + 5 + 4;
  const miny = gt.y - hh + 5 + 4;
  const maxx = gt.x + hw - 4 - 4;
  const maxy = gt.y + hh - 4 - 4;
  ctx.save();
  ctx.beginPath();
  ctx.rect(minx - state.view.x, miny - state.view.y, maxx - minx, maxy - miny);
  ctx.clip();
  return true;
}

function line(ctx, e, state, width, color) {
  if (!(width > 0)) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(e.x1 - state.view.x, e.y1 - state.view.y);
  ctx.lineTo(e.x2 - state.view.x, e.y2 - state.view.y);
  ctx.stroke();
}

export function drawKnightStream(ctx, e, state, deps) {
  const { sprites } = deps;
  if (!clipToBox(ctx, state)) return true;

  const alive = (n) => state.entities.filter((x) => x.alive && x.type.name === n);
  // `global.time * pi` — the pulse on the inner two layers.
  const pulse = Math.sin(state.frame * Math.PI);

  // The diamonds, drawn by the MANAGER so the clip applies to them (their own
  // instances are `visible = false`).
  const diamond = sprites.get('spr_diamondbullet');
  if (diamond) {
    for (const b of alive('obj_bullet_stream_diamond')) {
      drawSpriteExt(ctx, diamond, 0, b.x - state.view.x, b.y - state.view.y,
        b.image_xscale ?? 1, b.image_yscale ?? 1, b.image_angle ?? 0, null,
        b.image_alpha ?? 1);
    }
  }

  // c_gray / c_red / c_maroon / c_black — GameMaker packs BGR, so c_maroon
  // (0x000080) is RGB(128, 0, 0).
  for (const l of alive('obj_knight_streamline')) {
    line(ctx, l, state, l.width, 'rgb(128,128,128)');
  }
  const beams = alive('obj_bullet_knight_stream');
  for (const b of beams) line(ctx, b, state, b.width, 'rgb(255,0,0)');
  for (const b of beams) {
    if (b.width > 8) line(ctx, b, state, b.width * (0.8 + pulse * 0.2), 'rgb(128,0,0)');
  }
  for (const b of beams) {
    if (b.width > 8) line(ctx, b, state, b.width * (0.65 + pulse * 0.2), 'rgb(0,0,0)');
  }

  ctx.restore();
  return true;
}
