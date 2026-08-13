import { drawSpriteExt, ldx, ldy, rgb, clamp01 } from './gm.js';
import { drawSlashWedge } from './slash.js';

// obj_knight_rotating_slash's Draw — the AIM TELEGRAPH.
//
// This is the thing that tells you where the fan is about to cut, and it was
// missing entirely: the object had no sprite and no draw port, so the attack
// gave no warning at all.
//
// While `state == "aim"` and the timer is running, for each of the
// `slash_number` pending cuts it draws a marker along that cut's heading:
//
//     dir    = (360 / (slash_number * 2)) * a + random_offset + aim_direction
//     xscale = timer * 0.2
//     yscale = 1 + 2 * (1 - timer / (slash_base + 6 + slash_offset))
//
// So each marker GROWS along its length as the aim charges (xscale climbs with
// the timer) while THINNING across it (yscale starts at 3 and eases to 1) —
// it sharpens into the line the slash will occupy. The angles are exactly the
// ones the slash state then fires, computed from the same expression, so the
// telegraph cannot drift from the attack.
//
// Two passes in the original: a coloured `_gradient` underneath, then the
// black `spr_rk_quickslash_marker` over it. Both drawn into a surface that is
// offset by the box origin, i.e. CLIPPED TO THE ARENA — cuts aimed outside it
// are only visible where they cross the board.
//
// The `line2` / `line3` rails ARE drawn now, and so are the slash wedges: the
// same `with (obj_roaringknight_slash)` block the original runs inside this
// surface, which is why a cut looks brighter where it crosses the board.

export function drawRotatingSlashTelegraph(ctx, e, state, deps) {
  const { sprites, boxRect } = deps;
  const box = boxRect(state);

  ctx.save();
  if (box) {
    // `my_surface` is sized to the box interior and blitted at its origin, so
    // everything below is CLIPPED TO THE ARENA.
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
  }

  const n = e.slash_number ?? 0;
  if (e.state === 'aim' && e.timer && n > 0) {
    const grad = sprites.get('spr_rk_quickslash_marker_gradient');
    const mark = sprites.get('spr_rk_quickslash_marker');
    const sx = e.timer * 0.2;
    const sy = 1 + 2 * (1 - e.timer / (e.slash_base + 6 + e.slash_offset));
    // THE COLOUR, which was being computed and then thrown away. The gradient
    // pass is `make_color_rgb(r, g, b)` — grey at the top of each aim, ramping
    // to pure red — and the marker pass is flat c_BLACK over it. Drawing both
    // as raw sprite pixels made the telegraph a white smear.
    const col = [Math.round(e.r ?? 128), Math.round(e.g ?? 128), Math.round(e.b ?? 128)];

    for (const [entry, tint] of [[grad, col], [mark, [0, 0, 0]]]) {
      if (!entry) continue;
      for (let a = 0; a < n; a++) {
        const dir = (360 / (n * 2)) * a + e.random_offset + e.aim_direction;
        drawSpriteExt(ctx, entry, 0, e.aim_x, e.aim_y, sx, sy, dir, tint, 1);
      }
    }

    // `line2` / `line3`: paired rails that flick out perpendicular to each
    // marker and fade as the counter climbs to 8. Each is a 640px line through
    // the aim point, offset +/- `line * 6` across the heading.
    for (const ln of [e.line2, e.line3]) {
      if (!(ln > 0)) continue;
      ctx.save();
      ctx.globalAlpha = clamp01(1 - ln / 7);
      ctx.strokeStyle = rgb(col);
      ctx.lineWidth = e.line_width ?? 4;
      for (let a = 0; a < n; a++) {
        const dir = (360 / (n * 2)) * a + e.random_offset + e.aim_direction;
        const dx = ldx(320, dir);
        const dy = ldy(320, dir);
        for (const sgn of [1, -1]) {
          const ox = ldx(ln * 6, dir + 90) * sgn;
          const oy = ldy(ln * 6, dir + 90) * sgn;
          ctx.beginPath();
          ctx.moveTo(e.aim_x + dx + ox, e.aim_y + dy + oy);
          ctx.lineTo(e.aim_x - dx + ox, e.aim_y - dy + oy);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // THE SLASHES, drawn AGAIN inside the box. obj_roaringknight_slash has its
  // own Draw (render/draw/slash.js) that covers the screen; this `with` block
  // draws the same wedge into the clipped surface, so the part crossing the
  // arena is laid down twice and reads brighter than the tails outside it.
  for (const sl of state.entities) {
    if (!sl.alive || sl.type.name !== 'obj_roaringknight_slash') continue;
    drawSlashWedge(ctx, sl);
  }

  ctx.restore();

  // `draw_sprite_ext(sprite_index, image_index, x, y + sin(global.time * 0.1) * 2, ...)`
  // — the knight BOBS while he aims. Drawn outside the clip, after the surface.
  const self = sprites.get(e.sprite_index);
  if (self) {
    drawSpriteExt(ctx, self, e.image_index, e.x,
      e.y + Math.sin(state.frame * 0.1) * 2,
      e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, e.image_alpha);
  }
  return true;
}
