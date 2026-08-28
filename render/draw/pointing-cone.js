// obj_knight_pointing_cone's Draw event — the STARS backdrop, ported whole.
//
// The game's look does not come from `sprite_index`: it comes from Draw events
// that composite layers, scroll textures, and mask them against primitives. A
// renderer that only blits each entity's sprite gets the geometry right and the
// character wrong.
//
// The event is a chain of EARLY EXITS, and honouring them is most of the work:
//
//   con >= 4        nothing is drawn at all — the cone is on its way home
//   con <= 1        ONLY the charge beam, then exit
//   con == 3, t > 0 ONLY the closing flare, then exit
//   otherwise       the wedge, the scrolling flow, the soul cut-out
//
// So the backdrop and the beam never appear together; each phase of the attack
// looks completely different, and drawing them all at once would read as a
// mess. The `con` advance and its timers live in sim/attacks/pointing-cone.js
// (this file must not mutate sim state), so this only decides what is shown.
//
// The pointing knight himself is `draw_self()` near the TOP of the event, not
// the end, so he is drawn here and every path returns true. The colour is the
// other thing worth stating up front: it is not tinted anywhere — the purple
// is the `spr_knight_bullet_flow` texture, added over a grey wedge.

import { drawSpriteExt } from './gm.js';
import { drawStarUserEvent0 } from './pointing-star.js';

const BG_SPEED = 20;
const LINES_SPEED = 80;
const TILE = 640; // spr_knight_bullet_flow is 320 wide, drawn at scale 2

/** Frame the cone first drew, so the scroll starts at 0 as the original does. */
/**
 * A 2x nearest-neighbour copy of an image, made once and kept.
 *
 * Keyed on the image object itself, so a re-extracted sprite pack yields fresh
 * copies rather than stale ones, and a WeakMap lets them go if the pack does.
 */
const x2Cache = new WeakMap();
function x2(img) {
  if (!img) return null;
  const hit = x2Cache.get(img);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = img.width * 2;
  c.height = img.height * 2;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0, c.width, c.height);
  x2Cache.set(img, c);
  return c;
}

const firstDraw = new WeakMap();

/**
 * `draw_sprite_part_ext(spr, sub, left, top, w, h, x, y, xs, ys, col, alpha)` —
 * a rectangle cut out of one frame and stretched somewhere. The charge beam is
 * built entirely from these: a 1px-tall slice of the flow texture, stretched
 * across the screen at the cone's mouth.
 */
function drawSpritePart(ctx, entry, sub, left, top, w, h, dx, dy, xs, ys, alpha) {
  if (!entry || !entry.frames[sub]) return;
  const img = entry.frames[sub];
  const sw = Math.max(0, Math.min(w, img.width - left));
  const sh = Math.max(0, Math.min(h, img.height - top));
  if (sw <= 0 || sh <= 0 || left < 0 || top < 0 || left >= img.width || top >= img.height) return;
  ctx.save();
  // Every caller passes `c_gray`, which in GameMaker MULTIPLIES the texture by
  // (128,128,128) — the beam is the flow texture at half brightness, not at
  // full. Under an additive blend that halving is exactly a 0.5 alpha, so it
  // is folded in here rather than costing a tinted copy of the texture.
  ctx.globalAlpha = alpha * 0.5;
  ctx.drawImage(img, left, top, sw, sh, dx, dy, sw * xs, sh * ys);
  ctx.restore();
}

/**
 * The second surface the event needs (`starsurf`). The renderer's shared
 * `scratch` is a single canvas, and this composites INTO the first one, so it
 * cannot be borrowed.
 */
let starCanvas = null;
function starSurface(w, h) {
  if (!starCanvas) starCanvas = document.createElement('canvas');
  if (starCanvas.width !== w || starCanvas.height !== h) {
    starCanvas.width = w;
    starCanvas.height = h;
  }
  return starCanvas;
}

/** `draw_angle = 1 - draw_angle` — a 1px per-frame jitter on the wedge. */
const drawAngle = new WeakMap();
/** Last frame's dirty rects, per cone, so clears cover shrink as well as growth. */
const prevRect = new WeakMap();
const prevStarRect = new WeakMap();

/** Union of two [x0,y0,x1,y1] rects; either may be null. */
function unionRect(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function drawPointingCone(ctx, e, state, deps) {
  const { sprites, VIEW_W, VIEW_H, scratch } = deps;
  const flow = sprites.get('spr_knight_bullet_flow');

  // THE KNIGHT GOES UNDER THE BACKDROP. `draw_self()` is the SIXTEENTH line of
  // this event, before the beam and before the surface — so the pointing pose
  // is drawn first and everything else is laid over it. Letting the renderer's
  // normal sprite blit run after this function put him on top of the cone,
  // which is backwards. Every path below therefore returns true.
  if (e.con < 5) {
    const self = sprites.get(e.sprite_index);
    if (self) {
      drawSpriteExt(ctx, self, e.image_index, e.x, e.y,
        e.image_xscale, e.image_yscale, e.image_angle, null, e.image_alpha);
    }
  }

  // `if (con >= 4) exit;` — after the flare he is travelling home and the
  // whole backdrop is gone.
  if (e.con >= 4) return true;

  if (!firstDraw.has(e)) firstDraw.set(e, state.frame);
  const age = state.frame - firstDraw.get(e);

  const camX = state.view.x;
  const mouthX = e.x + 22;
  const mouthY = e.y + 54;

  // ---- con <= 1: THE CHARGE BEAM, and nothing else ------------------------
  //
  // A single scanline of flow texture stretched from the left edge of the
  // screen to the cone's mouth, thickening as `timer` climbs. On the second
  // frame of every pair a second, faster-scrolling copy is laid over it. Past
  // timer 28 the texture is dropped for a solid white bar — the beam has
  // "charged" and the stars start coming.
  if (e.con <= 1) {
    const width = (mouthX - camX) / 2;
    if (e.timer < 28) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      drawSpritePart(ctx, flow, 2, e.timer * 1, e.timer * 4 + e.yoff - 2, width, 1, camX, mouthY, 2, 2, 1);
      if (e.timer % 2 === 0) {
        drawSpritePart(ctx, flow, 2, e.timer * 2, e.timer * 4 + e.yoff, width, 1, camX, mouthY, 2, 2, 1);
      }
      ctx.restore();
    } else {
      // ossafe_fill_rectangle(camerax(), y + 54, x + 22, y + 56)
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(camX, mouthY, mouthX - camX, 2);
      ctx.restore();
    }
    return true;
  }

  // ---- con == 3: THE CLOSING FLARE, and nothing else -----------------------
  //
  // Two slices peeling apart from the mouth as `timer` counts 10 down to 0,
  // fading with it. This is the cone snapping shut.
  if (e.con === 3 && e.timer > 0) {
    const width = (mouthX - camX) / 2;
    const t = e.timer;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawSpritePart(ctx, flow, 2, (10 - t) * 2, e.yoff - (10 - t) * 4, width, 1, camX, mouthY, 2, 2, t / 10);
    drawSpritePart(ctx, flow, 2, (10 - t) * 2, e.yoff + (10 - t) * 4, width, 1, camX, mouthY, 2, 2, t / 10);
    ctx.restore();
    return true;
  }

  // ---- the open cone: wedge, flow, and the soul cut out of it --------------
  const angle = e.angle ?? 0;
  const target = e.target_angle || 60;
  if (angle <= 0) return true;

  // `draw_angle = 1 - draw_angle; var _angle = (angle > 0) ? angle + draw_angle : 0;`
  // The wedge widens and narrows by one degree every frame. It is a single
  // line in the original and it is what keeps the cone from looking like a
  // static gradient.
  const jitter = 1 - (drawAngle.get(e) ?? 0);
  drawAngle.set(e, jitter);
  const openAngle = angle + jitter;

  const rad = (a) => (a * Math.PI) / 180;
  const apexY = e.y + 56;
  const xLeft = 600 * Math.cos(rad(180 + openAngle / 2));
  const yTop = -600 * Math.sin(rad(180 - openAngle / 2));
  const yBottom = -600 * Math.sin(rad(180 + openAngle / 2));

  // THE WEDGE'S SCREEN BOUNDING BOX, and everything below stays inside it.
  //
  // This pipeline used to run at full 640x480 every frame — a whole-surface
  // clear, four tile draws, a whole-surface `destination-in` mask, and a
  // whole-surface blit — and Firefox rasterises the composite passes far
  // slower than Chrome, which is the reported Stars lag (still present after
  // the tile pre-scale). The wedge is the only region that ever holds pixels,
  // so the clears and blits crop to its box, padded 2px for the antialiased
  // edge and UNIONED with last frame's box so the shrink of the one-degree
  // jitter cannot leave a stale rim.
  const mouthSX = mouthX - state.view.x;
  const apexSY = apexY - state.view.y;
  const rect = [
    Math.max(0, Math.floor(mouthSX + xLeft) - 2),
    Math.max(0, Math.floor(apexSY + yTop) - 2),
    Math.min(VIEW_W, Math.ceil(mouthSX) + 2),
    Math.min(VIEW_H, Math.ceil(apexSY + 2 + yBottom) + 2),
  ];
  // ...AND unioned with LAST frame's star box: the star surface is blitted
  // INTO this buffer inside that box, so a clear that covered only the wedge
  // left last frame's stars ghosting wherever the boxes do not overlap.
  const clearR = unionRect(unionRect(rect, prevRect.get(e)), prevStarRect.get(e));
  prevRect.set(e, rect);

  const buf = scratch(VIEW_W, VIEW_H);
  const b = buf.getContext('2d');
  b.imageSmoothingEnabled = false;
  b.setTransform(1, 0, 0, 1, 0, 0);
  b.clearRect(clearR[0], clearR[1], clearR[2] - clearR[0], clearR[3] - clearR[1]);
  b.save();
  b.translate(-state.view.x, -state.view.y);

  // THREE VERTICES, NOT FOUR. The original is
  //
  //     draw_primitive_begin(pr_trianglelist);
  //     draw_vertex(mouth + xleft, apex + ytop);
  //     draw_vertex(mouth,         apex);
  //     draw_vertex(mouth + xleft, apex + 2 + ybottom);
  //     draw_vertex(mouth,         apex + 2);
  //     draw_primitive_end();
  //
  // and `pr_trianglelist` consumes vertices in THREES — a fourth on its own is
  // discarded, so the cone is one triangle and that last vertex never draws.
  // Treating the four as a quad, which is the obvious reading, produces a
  // self-intersecting bowtie: the two long edges cross, the winding number
  // over the middle of the cone comes out zero, and the fill silently drops
  // out. The wedge was invisible for exactly that reason, and it looked like a
  // blend-mode problem because the flow layer on top was fine.
  const wedgePath = (g) => {
    g.beginPath();
    g.moveTo(mouthX + xLeft, apexY + yTop);
    g.lineTo(mouthX, apexY);
    g.lineTo(mouthX + xLeft, apexY + 2 + yBottom);
    g.closePath();
  };
  // THE CLIP IS THE MASK. The old order was: fill the wedge, draw the flow
  // tiles across the whole surface with `lighter`, then one whole-surface
  // `destination-in` pass with the wedge path to take the spill back off.
  // `destination-in` touches EVERY pixel of the surface whatever the path
  // covers — that is what it is — and it is the single pass Firefox
  // rasterises worst. Clipping to the same path FIRST means nothing is ever
  // painted outside the wedge, so the mask pass has nothing to do and is
  // gone. Interior pixels are bit-identical (same fill, same adds, same
  // coverage); the only difference lives in the antialiased 1px edge, where
  // clip coverage replaces the mask's post-multiply.
  wedgePath(b);
  b.clip();
  // merge_color(c_white, c_black, angle / target_angle): white closed, black open.
  const k = Math.max(0, Math.min(1, angle / target));
  const v = Math.round(255 * (1 - k));
  b.fillStyle = `rgb(${v},${v},${v})`;
  b.fill();
  // Back to screen space for the tiles — the clip persists (it was defined in
  // world coordinates and mapped at definition time); only the transform pops.
  b.setTransform(1, 0, 0, 1, 0, 0);

  // ---- the two flow layers ------------------------------------------------
  //
  // THIS IS WHERE THE COLOUR COMES FROM. `spr_knight_bullet_flow` is a deep
  // purple texture, and the blend is
  //
  //     gpu_set_blendmode_ext_sepalpha(bm_src_alpha, bm_one, bm_dest_alpha, bm_zero)
  //
  // — additive on RGB, `srcA * dstA` on alpha. The texture is opaque, so that
  // reduces to "add the purple on top of the grey wedge, keep the wedge's
  // shape". Compositing with `source-in` instead, as this did, REPLACES the
  // wedge with the texture and throws the grey away: the cone came out flat
  // and dim rather than a white-hot mouth bleeding into purple as it opens.
  //
  // On canvas that is `lighter` for the colour, then one `destination-in` pass
  // with the wedge to put the alpha back — `lighter` adds alpha too, which
  // would otherwise paint the whole screen.
  if (flow && flow.frames.length >= 2) {
    const bgX = -((age * BG_SPEED) % TILE);
    const linesX = -((age * LINES_SPEED) % TILE);
    b.globalCompositeOperation = 'lighter';
    for (const [frame, sx] of [
      [0, bgX], [0, bgX + TILE],
      [1, linesX], [1, linesX + TILE],
    ]) {
      // PRE-SCALED ONCE, not four times a frame. This passed width/height to
      // drawImage, so every one of the four passes rescaled a 320px texture to
      // 640 — 120 rescales a second between them. Smoothing is off on this
      // buffer, so the scale is nearest-neighbour and doing it up front is
      // PIXEL-IDENTICAL, just cached.
      //
      // Reported as the Stars drill lagging on Firefox but not Chrome. This is
      // the cheap half; the expensive half is the full-screen
      // `destination-in` below, which Firefox handles far worse than Chrome
      // and which cannot be narrowed without changing how the wedge's edge
      // antialiases. Left alone until it can actually be profiled.
      const img = x2(flow.frames[frame]);
      if (img) b.drawImage(img, sx, 0);
    }

    // The clip has done the destination-in's whole job; pop it before the
    // heart punch-out, which must be able to cut the wedge's own edge.
    b.restore();

    // `draw_set_blend_mode(bm_subtract); with (obj_heart) draw_sprite(...)` —
    // the soul is PUNCHED OUT of the backdrop, so it stays readable against
    // it. `destination-out` via drawImage only composites the drawn image's
    // own 20x20 rect, so this pass was never part of the cost.
    const heart = state.soul;
    const hs = heart && sprites.get('spr_dodgeheart');
    if (hs && hs.frames[0]) {
      b.globalCompositeOperation = 'destination-out';
      b.save();
      b.translate(-state.view.x, -state.view.y);
      b.drawImage(hs.frames[0], heart.x, heart.y);
      b.restore();
    }
    b.globalCompositeOperation = 'source-over';
  } else {
    b.restore();
  }

  // ---- the star surface ----------------------------------------------------
  //
  // The accumulating stars are NOT drawn by themselves — their own Draw event
  // exits while the cone exists and `con == 0`. They are drawn here, as flat
  // white blobs, into a second surface; then `spr_knight_line_grate` is
  // SUBTRACTED from that surface, cutting scanlines through every one of them
  // at once. `star_flicker` alternates the grate's y between 0 and 2 each
  // frame, so the lines crawl.
  //
  // Stars with `image_xscale > 0.5` go in BEFORE the grate and get striped;
  // the small ones go in after and stay solid. That split is the whole reason
  // a fresh star reads as a hard point of light and a grown one reads as a
  // shimmering mass.
  const stars = state.entities.filter(
    (x) => x.alive && x.type.name === 'obj_knight_pointing_star' && x.con === 0,
  );
  if (stars.length) {
    // THE STARS' OWN BOX, same reasoning as the wedge's: they cluster at the
    // cone's mouth, and clearing/blitting the whole 640x480 for a dozen
    // sprites was most of this surface's cost. 48px of pad per side covers
    // the largest star sprite at its grown scale; the union with last frame
    // covers movement.
    let sr = null;
    for (const st of stars) {
      const pad = 48 * Math.max(1, st.image_xscale ?? 1);
      const sx = st.x - state.view.x;
      const sy = st.y - state.view.y;
      sr = unionRect(sr, [sx - pad, sy - pad, sx + pad, sy + pad]);
    }
    sr = [
      Math.max(0, Math.floor(sr[0])), Math.max(0, Math.floor(sr[1])),
      Math.min(VIEW_W, Math.ceil(sr[2])), Math.min(VIEW_H, Math.ceil(sr[3])),
    ];
    const sClear = unionRect(sr, prevStarRect.get(e));
    prevStarRect.set(e, sr);

    const sbuf = starSurface(VIEW_W, VIEW_H);
    const s = sbuf.getContext('2d');
    s.imageSmoothingEnabled = false;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(sClear[0], sClear[1], sClear[2] - sClear[0], sClear[3] - sClear[1]);
    s.save();
    s.translate(-state.view.x, -state.view.y);

    for (const st of stars) if (st.image_xscale > 0.5) drawStarUserEvent0(s, st, sprites);

    const grate = sprites.get('spr_knight_line_grate');
    if (grate && grate.frames[0]) {
      const flick = (state.frame % 2) * 2; // star_flicker = 2 - star_flicker
      // SOURCE-CROPPED to the star box. destination-out via drawImage only
      // composites the drawn rect, so drawing just the slice of the grate
      // that overlaps the stars is the same subtraction at a fraction of the
      // pixels. The mapping is exact: the grate sits at (0, flick) scaled
      // 2x, so destination (dx,dy,dw,dh) reads source (dx/2, (dy-flick)/2,
      // dw/2, dh/2).
      const g0 = grate.frames[0];
      const gx0 = Math.max(sr[0], 0);
      const gy0 = Math.max(sr[1], flick);
      const gx1 = Math.min(sr[2], g0.width * 2);
      const gy1 = Math.min(sr[3], flick + g0.height * 2);
      if (gx1 > gx0 && gy1 > gy0) {
        s.save();
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.globalCompositeOperation = 'destination-out';
        s.drawImage(g0, gx0 / 2, (gy0 - flick) / 2, (gx1 - gx0) / 2, (gy1 - gy0) / 2,
          gx0, gy0, gx1 - gx0, gy1 - gy0);
        s.restore();
      }
    }

    for (const st of stars) if (st.image_xscale <= 0.5) drawStarUserEvent0(s, st, sprites);
    s.restore();
    s.globalCompositeOperation = 'source-over';

    // Normal alpha blending for the stars, over the purple backdrop —
    // cropped to their box; everywhere else the surface is transparent.
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.globalCompositeOperation = 'source-over';
    const scw = sClear[2] - sClear[0];
    const sch = sClear[3] - sClear[1];
    if (scw > 0 && sch > 0) {
      b.drawImage(sbuf, sClear[0], sClear[1], scw, sch, sClear[0], sClear[1], scw, sch);
    }
  }

  // `draw_set_blend_mode(bm_add); surface_reset_target(); draw_surface(surf, ...)`
  // — the whole backdrop is ADDED to the room, so it glows over the battle
  // background instead of covering it, and the soul's punched-out hole shows
  // the background through untouched.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  // Cropped to the union of the wedge's and the stars' boxes: outside them
  // the surface is transparent and `lighter` with transparent is a no-op, so
  // the pixels are identical and the screen composite shrinks with the cone.
  const outR = unionRect(clearR, prevStarRect.get(e));
  const ow = Math.min(VIEW_W, outR[2]) - Math.max(0, outR[0]);
  const oh = Math.min(VIEW_H, outR[3]) - Math.max(0, outR[1]);
  if (ow > 0 && oh > 0) {
    const ox = Math.max(0, outR[0]);
    const oy = Math.max(0, outR[1]);
    ctx.drawImage(buf, ox, oy, ow, oh, ox, oy, ow, oh);
  }
  ctx.restore();

  return true; // draw_self() already happened — see the note in drawPointingCone
}
