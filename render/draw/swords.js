// The sword attacks' Draw events: the corridor's telegraph and motion trail,
// and the tracking swords' launch streak.
//
// All three share a shape — a bullet whose Draw is mostly a TRAIL, drawn by
// interpolating between two positions and stacking copies at rising alpha.
// None of it is expressible as a sprite blit, which is why these attacks read
// as static rows of diamonds without it.

import { drawSpriteExt, c_white, clamp01 } from './gm.js';

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * obj_sword_tunnel_sword.
 *
 * Two things the corridor needs and did not have:
 *
 *   THE TELEGRAPH — `spr_lasergun_laser_telegraph` stretched to xscale 999
 *   (effectively across the whole screen) at the sword's angle, in RED, at
 *   `telegraphalpha`. It fades in at 0.05/frame while `telegraph == 1` and out
 *   at 0.1/frame after. This is the line that says where the next sweep goes.
 *
 *   THE MOTION TRAIL — ten copies interpolated from (xprevious, yprevious) to
 *   the current position, alpha `i / 10`. The swords accelerate to 30px a
 *   frame, so without it they strobe across the arena in discrete jumps; with
 *   it each one is a streak that ends at the blade.
 *
 * The alpha ramp and `telegraphalpha` are advanced in the sim's endStep (that
 * Draw event mutates instance state), so this only reads.
 */
export function drawSwordTunnelSword(ctx, e, state, deps) {
  const { sprites } = deps;

  if (e.telegraphalpha > 0) {
    const tel = sprites.get('spr_lasergun_laser_telegraph');
    if (tel) {
      drawSpriteExt(ctx, tel, 0, e.x, e.y, 999, 0.4, e.image_angle,
        [255, 0, 0], e.telegraphalpha);
    }
  }

  const entry = sprites.get(e.sprite_index);
  if (!entry) return false;

  const px = e.xprevious ?? e.x;
  const py = e.yprevious ?? e.y;
  for (let i = 0; i < 10; i++) {
    drawSpriteExt(ctx, entry, e.image_index, lerp(px, e.x, i / 10), lerp(py, e.y, i / 10),
      e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, i / 10);
  }

  // `draw_self()` closes the event — the caller's normal blit does it.
  return false;
}

/**
 * obj_tracking_sword1.
 *
 * THE LAUNCH STREAK. When `afterimagecon` flips to 1 the sword draws FORTY
 * copies of itself interpolated from where it is to `(targetx, targety)` — a
 * point 900px behind its heading — at alpha `0.2 + i/80`, so the streak is
 * faintest at the far end and solid at the blade. The next frame draws it
 * again at half alpha and then it is done: a two-frame flash that reads as the
 * sword having arrived from off screen at enormous speed.
 *
 * `con == 2` adds a `d3d_set_fog(true, c_white, ...)` pass over the normal
 * draw, which flattens the sprite to a white silhouette — the sword flashing
 * white just before it fires.
 *
 * The `afterimagecon` advance (1 -> 2 -> 3) happens in the Draw event, so it
 * lives in the sim's endStep; this reads it.
 */
export function drawTrackingSword(ctx, e, state, deps) {
  const { sprites } = deps;
  const entry = sprites.get(e.sprite_index);
  if (!entry) return false;

  if (e.afterimagecon === 0) {
    drawSpriteExt(ctx, entry, e.image_index, e.x, e.y,
      e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, e.image_alpha);
    if (e.con === 2) {
      drawSpriteExt(ctx, entry, e.image_index, e.x, e.y,
        e.image_xscale, e.image_yscale, e.image_angle, c_white, e.image_alpha);
    }
    return true;
  }

  if (e.afterimagecon === 1 || e.afterimagecon === 2) {
    const dim = e.afterimagecon === 2 ? 0.5 : 1;
    drawSpriteExt(ctx, entry, e.image_index, e.x, e.y,
      e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, 0.0025);
    for (let i = 0; i < 40; i++) {
      drawSpriteExt(ctx, entry, e.image_index,
        lerp(e.x, e.targetx, i / 40), lerp(e.y, e.targety, i / 40),
        e.image_xscale, e.image_yscale, e.image_angle, e.image_blend,
        clamp01((0.2 + i / 80) * dim));
    }
  }
  return true;
}

/**
 * obj_tracking_swords_manager.
 *
 * The slash flashes are composited ADDITIVELY into a 150x150 surface pinned to
 * the arena's top-left corner and then blitted — so they glow where they
 * overlap and, more importantly, they are CLIPPED TO THE BOX. A slash that
 * would extend past the arena edge is cut off at it.
 *
 * `obj_tracking_sword_slash` has no sprite draw of its own: its whole Draw
 * event is `timer++; if (timer == 3) instance_destroy();`. It reaches the
 * screen only through here.
 */
const slashSurface = { c: null };
export function drawTrackingSwordsManager(ctx, e, state, deps) {
  const { sprites, boxRect } = deps;
  const slashes = state.entities.filter(
    (x) => x.alive && x.type.name === 'obj_tracking_sword_slash',
  );
  const box = boxRect(state);
  if (!slashes.length || !box) return true;

  if (!slashSurface.c) {
    slashSurface.c = document.createElement('canvas');
    slashSurface.c.width = 150;
    slashSurface.c.height = 150;
  }
  const g = slashSurface.c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, 150, 150);
  g.globalCompositeOperation = 'lighter';
  for (const s of slashes) {
    const entry = sprites.get(s.sprite_index);
    if (!entry) continue;
    drawSpriteExt(g, entry, s.image_index, s.x - box.x, s.y - box.y,
      s.image_xscale, s.image_yscale, s.image_angle, c_white, s.image_alpha);
  }
  g.globalCompositeOperation = 'source-over';

  ctx.drawImage(slashSurface.c, box.x, box.y);
  return true;
}

/**
 * obj_roaringknight_splitslash's `playerstrike` overlay — the CUT.
 *
 * When a Flurry slash connects, `obj_heart.image_alpha` goes to 0 and the slash
 * takes over drawing the soul: a copy jittered by `irandom(2) - 1` on each axis,
 * with `spr_rk_slash_heartslice` laid over it fading out from timer 45 to 55.
 *
 * The slice's FRAME is chosen by where the cut landed on the soul (`cuty`, set
 * in Other_15 from the soul's offset from the slash line), so the mark sits at
 * the height it actually crossed rather than always through the middle. The
 * jitter is a render-local generator for the same reason splitbox.js uses one:
 * sim/ has to stay frame-identical headless, and the renderer never writes to
 * it.
 *
 * The slash's own telegraph bar and its hell-surface layer are drawn elsewhere
 * (render/canvas.js `drawHellSurface`); this is only the strike overlay.
 */
let jitterSeed = 1;
function jitter() {
  jitterSeed = (jitterSeed * 1103515245 + 12345) & 0x7fffffff;
  return (jitterSeed >>> 16) % 3 - 1;
}

export function drawSplitslashStrike(ctx, e, state, deps) {
  if (e.playerstrike !== 1) return false;
  const { sprites } = deps;
  const heart = state.soul;
  if (!heart) return false;

  const hs = sprites.get(heart.sprite_index) ?? sprites.get('spr_dodgeheart');
  const slice = sprites.get('spr_rk_slash_heartslice');
  const dx = jitter();
  const dy = jitter();
  // remap_clamped(45, 55, 1, 0, timer)
  const fade = clamp01(1 - (e.timer - 45) / 10);

  if (hs) {
    drawSpriteExt(ctx, hs, heart.image_index, heart.x + dx, heart.y + dy, 1, 1, 0, null, 1);
  }
  if (slice) {
    drawSpriteExt(ctx, slice, e.cuty, heart.x + dx, heart.y + dy, 1, 1, 0, c_white, fade);
  }
  return false; // the slash's own layers still follow
}
