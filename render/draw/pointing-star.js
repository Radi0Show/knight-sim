// obj_knight_pointing_star's Draw event, ported whole.
//
// The star is not a sprite blit. It is three things layered:
//
//   * a COLOUR RAMP — `merge_color(c_gray, c_red, timer/30)`. A star charges
//     from grey to red over 30 frames, which is the attack's entire tell for
//     when it is about to fire. Drawing it in flat white removes the tell.
//   * a PULSING GLOW — frame 1 of the sprite, one notch larger, at
//     `(sin(timer*3) + 1) * 0.25` alpha, so it throbs against the backdrop.
//   * BEAM SPIKES at con 2/3 — `scr_draw_beam_color` wedges radiating out,
//     drawn additively. Difficulty 0/1 gets a fixed three-spike star with
//     three shorter sub-spikes; difficulty 2 gets six spikes that ROTATE with
//     the star's `side` and pinch inward as `_offset` eases 66 -> 5.
//
// The early exit at the top is the one that matters for reading the attack:
//
//     if (instance_exists(obj_knight_pointing_cone) && con == 0) exit;
//
// (the dump renders this as `instance_exists(548 && con == 0)` — decompiler
// damage to the operator precedence, not real code). While the cone is up and
// the star has not been released, the star does NOT draw itself: the cone
// draws it into `starsurf` through `event_user(0)`, as a plain white blob
// behind the scanline grate. That is why the accumulating stars look
// completely different from the fired ones.

import { scrEaseIn } from '../../sim/gml.js';
import {
  drawSpriteExt, drawBeamColor, mergeColor, clamp01,
  c_gray, c_red, c_white,
} from './gm.js';

export function drawPointingStar(ctx, e, state, deps) {
  const { sprites } = deps;
  const coneUp = state.entities.some(
    (x) => x.alive && x.type.name === 'obj_knight_pointing_cone',
  );
  if (coneUp && e.con === 0) return true; // the cone draws it — see header

  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return false;

  // `(sprite_width + 16) / sprite_get_width(...)` — sprite_width already
  // includes image_xscale, so this is "grow by 16 screen pixels", not "scale by
  // 16". A small star grows proportionally more, which is what makes the
  // accumulating cloud read as a mass of light.
  const w = entry.frames[0].width;
  const h = entry.frames[0].height;
  const xs = e.image_xscale + 16 / w;
  const ys = e.image_yscale + 16 / h;

  const color = mergeColor(c_gray, c_red, clamp01(e.timer / 30));
  const alpha = (Math.sin(e.timer * 3) + 1) * 0.25;

  if (e.con === 2 || e.con === 3) {
    let a = 1;
    let length = 120;
    let prog = clamp01(e.timer / 30);
    if (e.con === 2) {
      a = clamp01(prog - alpha);
      // The `(timer % 2) * 0.75` is a per-frame STROBE on the beam length,
      // not a smooth ramp — the spikes flicker as they extend.
      length = 50 * clamp01(prog - (e.timer % 2) * 0.75) + 50;
    }
    let offset = 66;
    const sublength = e.difficulty >= 1 ? length : length / 2;
    let beamcolor = e.difficulty >= 2 ? color : c_white;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (e.difficulty === 2) {
      prog = scrEaseIn(clamp01(e.timer / 20), 4);
      offset = e.con === 3 ? 5 : 66 + (5 - 66) * prog;
      beamcolor = color;
      if (e.timer >= 30) {
        // A late KICK on the length: the spikes lunge outward just before the
        // star bursts.
        const p2 = scrEaseIn(clamp01((e.timer - 30) / 10), 4);
        length += 50 - p2 * 50;
      }
      const s = 90 + e.side;
      const t = -90 + e.side;
      drawBeamColor(ctx, e.x, e.y, length, 10, s, beamcolor, a);
      drawBeamColor(ctx, e.x, e.y, length, 10, t, beamcolor, a);
      drawBeamColor(ctx, e.x, e.y, sublength, 10, s + offset, beamcolor, a);
      drawBeamColor(ctx, e.x, e.y, sublength, 10, s - offset, beamcolor, a);
      drawBeamColor(ctx, e.x, e.y, sublength, 10, t + offset, beamcolor, a);
      drawBeamColor(ctx, e.x, e.y, sublength, 10, t - offset, beamcolor, a);
    } else {
      drawBeamColor(ctx, e.x, e.y, length, 10, 90, beamcolor, a);
      drawBeamColor(ctx, e.x, e.y, sublength, 10, 156, c_white, a);
      drawBeamColor(ctx, e.x, e.y, sublength, 10, 24, c_white, a);
      drawBeamColor(ctx, e.x, e.y, sublength, 10, 270, c_white, a);
      drawBeamColor(ctx, e.x, e.y, length, 10, 336, beamcolor, a);
      drawBeamColor(ctx, e.x, e.y, length, 10, 204, beamcolor, a);
    }
    ctx.restore();
  }

  if (e.con === 1 || e.con === 2) {
    drawSpriteExt(ctx, entry, 1, e.x, e.y, xs + 0.1, ys + 0.1, e.image_angle, c_white, alpha);
    drawSpriteExt(ctx, entry, 0, e.x, e.y, xs, ys, e.image_angle, color, 1);
  }
  if (e.con === 3 || e.con === 4) {
    // Frame 2 is the BURSTING star. The glow copy throbs at double rate.
    const g = (Math.sin(e.timer * 6) + 1) * 0.25;
    drawSpriteExt(ctx, entry, 2, e.x, e.y, xs + 0.1, ys + 0.1, e.image_angle, c_white, g);
    drawSpriteExt(ctx, entry, 2, e.x, e.y, xs, ys, e.image_angle, c_white, 1);
  }

  return true; // fully drawn — there is no draw_self() in this event
}

/**
 * `obj_knight_pointing_star`'s Other_10, which the cone calls through
 * `event_user(0)` for every star while it is still accumulating. Deliberately
 * plain: a flat white copy of frame 0, grown by the same 16px. The character
 * comes from what the cone does to the surface afterwards — see the grate in
 * render/draw/pointing-cone.js.
 */
export function drawStarUserEvent0(ctx, e, sprites) {
  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return;
  const xs = e.image_xscale + 16 / entry.frames[0].width;
  const ys = e.image_yscale + 16 / entry.frames[0].height;
  drawSpriteExt(ctx, entry, 0, e.x, e.y, xs, ys, 0, c_white, 1);
}
