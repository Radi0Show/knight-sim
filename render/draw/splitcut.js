// obj_knight_split_growtangle_effect's Draw — THE CUT.
//
// Ten frames when Flurry slices the arena. Three layers, and the middle one is
// the reason the attack lands the way it does:
//
//   1. the BOX's two halves peeling apart at 4, 6 and 8 times the timer along
//      the cut normal, each fading with `(10 - timer) / 10`
//   2. A SNAPSHOT OF THE ENTIRE SCREEN, taken on the effect's first drawn
//      frame, redrawn as two halves sliding apart by `timer * 8` at half the
//      fade. The picture itself is cut in two — party, knight, background and
//      all — which is what makes it read as the world being cut rather than
//      the box.
//   3. two white bars along the cut line (`spr_pxwhite10_center` at scale 50 by
//      `_fade` and by `_fade * 1.4` at half alpha) — the flash.
//
// The original takes the snapshot with `surface_copy(surf, 0, 0,
// application_surface)` inside `if (!surface_exists(surf))`, i.e. exactly once.
// Here that is a copy of the canvas at the moment this Draw first runs, which
// is the same thing as long as the effect draws late — its depth is
// `depth - 100`, so it does.

import { drawSpriteExt, clamp01, ldx, ldy, c_white } from './gm.js';

const W = 640;
const H = 480;

/** One snapshot per effect instance, taken on its first drawn frame. */
const snapshots = new WeakMap();

export function drawSplitCut(ctx, e, state, deps) {
  const { sprites } = deps;
  const timer = e.timer;
  const fade = (10 - timer) / 10;
  if (fade <= 0) return true;

  let snap = snapshots.get(e);
  if (!snap) {
    snap = document.createElement('canvas');
    snap.width = W;
    snap.height = H;
    const g = snap.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(ctx.canvas, 0, 0);
    snapshots.set(e, snap);
  }

  const xmul = ldx(1, e.angle);
  const ymul = ldy(1, e.angle);
  const htimer = (e.vertical ? 0 : timer) * xmul;
  const vtimer = (e.vertical ? timer : 0) * ymul;

  // ---- 1. the box halves ---------------------------------------------------
  const entry = sprites.get(e.sprite_index ?? 'spr_battlebg_0');
  if (entry && entry.frames[0]) {
    const img = entry.frames[0];
    let splitW = img.width;
    let splitH = img.height;
    let splitLeft = 0;
    let splitTop = 0;
    if (e.vertical) {
      splitLeft = img.width / 2;
      splitW /= 2;
    } else {
      splitTop = img.height / 2;
      splitH /= 2;
    }

    const half = (sl, st, sw, sh, mul, alpha) => {
      ctx.save();
      ctx.globalAlpha = clamp01(alpha);
      ctx.translate(e.x + htimer * mul, e.y + vtimer * mul);
      ctx.scale(e.image_xscale, e.image_yscale);
      ctx.drawImage(img, sl, st, sw, sh,
        -(entry.meta.ox ?? 0), -(entry.meta.oy ?? 0), sw, sh);
      ctx.restore();
    };
    // The two halves take DIFFERENT source rectangles — the first three draws
    // read from (0,0), the second three from the split offset — so each side
    // carries its own half of the border away with it.
    for (const m of [-8, -6, -4]) half(0, 0, splitW, splitH, m, fade);
    for (const m of [8, 6, 4]) half(splitLeft, splitTop, splitW, splitH, m, fade);
  }

  // ---- 2. the screen, cut in half ------------------------------------------
  const sx = e.x - state.view.x;
  const sy = e.y - state.view.y;
  ctx.save();
  ctx.globalAlpha = clamp01(fade / 2);
  if (e.vertical) {
    ctx.drawImage(snap, 0, 0, sx, H, 0, -timer * 8, sx, H);
    ctx.drawImage(snap, sx, 0, W - sx, H, sx, timer * 8, W - sx, H);
  } else {
    ctx.drawImage(snap, 0, 0, W, sy, -timer * 8, 0, W, sy);
    ctx.drawImage(snap, 0, sy, W, H - sy, timer * 8, sy, W, H - sy);
  }
  ctx.restore();

  // ---- 3. the flash --------------------------------------------------------
  const px = sprites.get('spr_pxwhite10_center');
  if (px) {
    let angle = e.angle;
    if (e.vertical) angle += 90;
    if (e.diagonal) angle += 45;
    drawSpriteExt(ctx, px, 0, e.x + e.xoffset, e.y + e.yoffset, 50, fade, angle, c_white, 1);
    drawSpriteExt(ctx, px, 0, e.x + e.xoffset, e.y + e.yoffset, 50, fade * 1.4, angle, c_white, 0.5);
  }

  return true;
}
