// obj_roaringknight_slash's Draw event — the TAPERING WEDGE.
//
// This is the slash that rotating slash throws every phase and that Roaring
// throws at the cut, and until now the renderer drew it as a plain line. It is
// not a line: it is a filled triangle 640px long whose apex sits ON the spawn
// point and whose base is `width` across, and both ends move as the slash
// fades.
//
//   * the APEX RETREATS. `x - hx * image_alpha` — at full alpha the point is a
//     whole 640px back along the heading, and it slides forward to the origin
//     as the slash dies. The wedge appears to be swept through, not switched on.
//   * the COLOUR bleaches. `make_color_rgb(255, (1 - image_alpha) * 255,
//     (1 - image_alpha) * 255)` is pure RED at full alpha and pure WHITE as it
//     fades, so a fresh slash is red and a spent one is a white streak.
//   * the alpha is `image_alpha * 2` — clamped by the hardware, so the wedge
//     holds full opacity until image_alpha drops below 0.5 and only then starts
//     to fade. The Step shrinks `width` and `image_alpha` by 0.66 together, so
//     the wedge narrows for several frames at full brightness before going.
//
// `slashdir` (choose(-1, 1) at Create) picks which side of the spawn point the
// wedge extends to. It is a Draw-only value that still consumes from the RNG
// stream — see sim/attacks/roaringknight-slash.js.

import { ldx, ldy, clamp01 } from './gm.js';

/** The wedge itself, shared with the rotating slash's clipped surface. */
export function drawSlashWedge(ctx, e) {
  const dir = e.direction;
  const hx = ldx(640, dir);
  const hy = ldy(640, dir);
  const hxoff = ldx(e.width, dir + 90);
  const hyoff = ldy(e.width, dir + 90);
  const a = e.image_alpha ?? 1;
  const c = Math.round((1 - a) * 255);

  ctx.save();
  ctx.globalAlpha = clamp01(a * 2);
  ctx.fillStyle = `rgb(255,${c},${c})`;
  ctx.beginPath();
  if (e.slashdir) {
    ctx.moveTo(e.x - hx * a, e.y - hy * a);
    ctx.lineTo(e.x + hx + hxoff, e.y + hy + hyoff);
    ctx.lineTo(e.x + hx - hxoff, e.y + hy - hyoff);
  } else {
    ctx.moveTo(e.x + hx * a, e.y + hy * a);
    ctx.lineTo(e.x - hx + hxoff, e.y - hy + hyoff);
    ctx.lineTo(e.x - hx - hxoff, e.y - hy - hyoff);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawRoaringknightSlash(ctx, e) {
  drawSlashWedge(ctx, e);
  return true; // the event has no draw_self()
}
