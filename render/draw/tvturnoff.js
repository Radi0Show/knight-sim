// The CRT power-off's draw half — obj_tvturnoff_manager's Other_10 again,
// which interleaves its draws with the state machine in sim/tvturnoff.js.
//
//     con 0: draw_sprite_ext(spr_zapper_tvturnoff1, 0, cx + 320, cy + 240,
//                            6, 10, 0, c_white, _alpha1)
//     con 1: ... 6, _yscale1 ... plus tvturnoff2 FRAME 2 at 0.1
//     con 2: ... _xscale1, _yscale1 ... plus tvturnoff2 frame 2 at _xscale2
//
// The screen behind it is already black by the time this runs (the ending
// holds a full-black apron), so this only ever paints the collapsing pane
// and the pinch-out blob.

import { drawSpriteExt } from './gm.js';

const VIEW_W = 640;
const VIEW_H = 480;

export function drawTvTurnoff(ctx, tv, sprites) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);

  const pane = sprites.get('spr_zapper_tvturnoff1');
  const blob = sprites.get('spr_zapper_tvturnoff2');
  // `camerax() + 320, cameray() + 240` — dead centre, and `yoff` is 0 for
  // every use in this build.
  const cx = VIEW_W / 2;
  const cy = VIEW_H / 2;

  if (tv.con === 0) {
    if (pane) drawSpriteExt(ctx, pane, 0, cx, cy, 6, 10, 0, null, tv.alpha1);
  } else if (tv.con === 1) {
    if (pane) drawSpriteExt(ctx, pane, 0, cx, cy, 6, tv.yscale1, 0, null, 1);
    // FRAME 2 of the blob, specifically — not 0.
    if (blob) drawSpriteExt(ctx, blob, 2, cx, cy, 0.1, 0.1, 0, null, 1);
  } else if (tv.con === 2) {
    if (pane) drawSpriteExt(ctx, pane, 0, cx, cy, tv.xscale1, tv.yscale1, 0, null, 1);
    if (blob) drawSpriteExt(ctx, blob, 2, cx, cy, tv.xscale2, tv.yscale2, 0, null, 1);
  }

  ctx.restore();
}
