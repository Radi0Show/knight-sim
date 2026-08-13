// obj_rudebuster_anim and obj_rudebuster_bolt.
//
// SUSIE IS HIDDEN while this plays — `with (obj_herosusie) visible = 0` in the
// anim's Create, restored at `t >= 28`. The animation object stands in for
// her at her own depth; it is not an effect layered on top. Drawing both
// gives you two Susies.
//
// The bolt leaves a trail of `scr_afterimage` copies, one per frame, each
// shrinking on the Y axis (`image_yscale -= 0.1`) — so the streak tapers
// behind it rather than fading uniformly. On impact eight bursts fly out on
// 45-degree diagonals and decay at two different rates, 0.75 for the first
// four and 0.8 for the second, which is what stops the explosion looking
// like a single ring.

import { drawSpriteExt, c_white } from './draw/gm.js';

export function drawRudeBuster(ctx, state, sprites) {
  const r = state.rude;
  if (!r) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const anim = sprites.get('spr_susie_rudebuster');
  if (r.anim && anim?.frames.length) {
    // `image_index = t / 2` — the sheet plays at half speed, the same
    // 0.5-per-frame rule obj_heroparent uses everywhere.
    const f = Math.min(Math.floor(r.anim.index), anim.frames.length - 1);
    drawSpriteExt(ctx, anim, f, r.anim.x, r.anim.y, 2, 2, 0, c_white, 1);
  }

  const b = r.bolt;
  const beam = sprites.get('spr_rudebuster_beam');
  if (!b || !beam?.frames.length) {
    ctx.restore();
    return;
  }

  // The trail goes under the bolt.
  for (const a of b.trail) {
    if (a.alpha <= 0 || a.scale <= 0) continue;
    // `image_index = 4` — the afterimages are all one frame of the sheet, not
    // the animating one.
    drawSpriteExt(ctx, beam, Math.min(4, beam.frames.length - 1),
      a.x, a.y, 2, a.scale, a.angle, c_white, Math.max(0, a.alpha));
  }

  if (b.explode === 0) {
    drawSpriteExt(ctx, beam, Math.floor(b.t) % beam.frames.length,
      b.x, b.y, 2, 2, b.direction, c_white, b.alpha);
  } else {
    for (const s of b.bursts ?? []) {
      if (s.scale <= 0.05) continue;
      drawSpriteExt(ctx, beam, Math.min(4, beam.frames.length - 1),
        s.x, s.y, s.scale * 2, s.scale * 2, s.angle, c_white, 1);
    }
  }
  ctx.restore();
}
