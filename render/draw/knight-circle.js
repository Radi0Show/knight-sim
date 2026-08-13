// obj_knight_circle's Draw — an additive gradient bloom at an aim point.
//
// `draw_circle_color(x, y, circle_size, color_1, color_2, false)` with
// color_1 = 0 (black) and color_2 = rgb(r, g, b): a disc that is dark in the
// middle and coloured at the rim. Drawn with `bm_add`, which on canvas is
// `globalCompositeOperation = 'lighter'`.
//
// `draw_in_box` renders it into a surface the size of the arena and blits that
// at the box's top-left, so the bloom is CLIPPED to the battle box — the
// version rotating slash uses. ROARING's sets the flag false and draws it
// free over the whole screen.

export function drawKnightCircle(ctx, e, state, deps) {
  const { boxRect } = deps;
  const size = e.circle_size ?? 0;
  if (size <= 0 || e.image_alpha <= 0) return true;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.max(0, Math.min(1, e.image_alpha));

  if (e.draw_in_box) {
    const r = boxRect(state);
    if (r) {
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
    }
  }

  const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, size);
  g.addColorStop(0, 'rgb(0,0,0)');
  g.addColorStop(1, `rgb(${Math.round(e.r)},${Math.round(e.g)},${Math.round(e.b)})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(e.x, e.y, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  return true;
}
