// Collision masks, extracted from the data file (sim/data/masks.json).
//
// Measured facts these encode — all verified against the oracle trace
// t3-hold-right / t3-diagnostic:
//
//   - obj_heart's mask is spr_dodgeheartmask: 20x20, Precise, heart-shaped,
//     bbox inset to [2,2]..[17,17]. NOT a 20x20 rect. The soul rests at
//     x=374 against the box's right wall precisely because its rightmost
//     pixel is at x+17.
//   - The battle box (obj_growtangle, whose parent is obj_battlesolid — the
//     wall IS the box) collides with spr_battlebg_0's mask: a 75x75 hollow
//     ring, ~2px border, drawn scaled. At battle scale 2 and box (320,170):
//     interior spans world x 250..391 for the soul.
//
// Sampling model, oracle-calibrated (traces/t4-contact-hits.csv and the
// sub-pixel sweep — 41 data points, all reproduced by `masksOverlap`;
// tools/verify-contact.mjs replays them):
//
//   1. Instance positions are FLOORED before the test. (The 20/20 misses at
//      fractional spawn y require it.)
//   2. B's transformed bbox is rounded to an integer world rectangle —
//      floor on the min edge, ceil-1 on the max — and pixels outside it are
//      never tested. This pre-check, not sampling, is what makes an
//      axis-aligned mask thinner than 1px unhittable (yscale ramp threshold
//      exactly 1.0; same mask at 30/45/60/135 degrees connects, 0/90 miss).
//   3. Surviving pixels sample by inverse transform at the pixel CORNER
//      with floor. (The ramp discriminates corner from centre sampling:
//      centre wrongly hits at yscale 0.5-0.9.)
//
// VALIDATED ENVELOPE: integer A positions; B at angles 0/30/45/60/90/135,
// scales 0.1-5.0, floored positions. The T3 grow-in (rotating fractional-
// scale box, frames 0-3) also matches this model EXACTLY once the box state
// live during the heart's Step is taken as timer=row rather than row+1 —
// free, block x3, free, all six observations. So the earlier "growth window
// contradiction" was a frame-alignment assumption, not a sampling failure.
// The grow animation still isn't modelled in sim/battlebox.js; when it is,
// pin that alignment with a dedicated trace. New attacks at unusual
// angle/scale combinations should get an oracle spot-check before being
// trusted.

// Static import, not a filesystem read: sim/ runs in the browser as well as
// under Node, and the architecture rule is that it touches neither the DOM
// nor the filesystem. Regenerate the data module with tools/gen-masks.mjs.
import { MASK_DATA as raw } from './data/masks.js';

function build(m) {
  return {
    name: m.name,
    w: m.w,
    h: m.h,
    originX: m.originX,
    originY: m.originY,
    bbox: m.bbox, // [left, top, right, bottom], inclusive
    // rows of '0'/'1' chars -> arrays of booleans, indexed [y][x]
    px: m.rows.map((r) => Array.from(r, (c) => c === '1')),
  };
}

export const HEART_MASK = build(raw.heart);
/**
 * `spr_dodgeheart_smallmask` — an 8x8 square at the soul's centre, against the
 * heart shape's 16x16. THE SWORD TUNNEL'S FINALE SWAPS TO IT: each dashing
 * sword does `with (obj_heart) mask_index = spr_dodgeheart_smallmask` as it
 * lays its screen-wide bar, which is what makes a wall of 999px hitboxes
 * survivable. Restored by obj_heart's own Step when the attack ends.
 */
export const HEART_SMALL_MASK = build(raw.heartsmall);
export const BATTLEBG_MASK = build(raw.battlebg);
/**
 * THE CUSTOM BOX'S WALL — `spr_battlebg_stretch_hitbox`, as the runtime
 * BEHAVES, not as the data file stores it.
 *
 * obj_growtangle's first Step swaps any non-default-scale box onto this
 * sprite (and snaps the scale — see sim/battlebox.js). The mask extracted
 * from game.ios (knight-research tools/patches/extract_mask.csx) has a 4px
 * border: free interior source cols/rows [4..70]. The recorded fight
 * disagrees: with the box at (320,170) / (230,170), snapped scale
 * 2.24 x 1.76, the soul's rests are
 *
 *     east  381   (heart col-17 pixel: 398 free, 399 blocked)
 *     south 214   (row-17 pixel: 231 free, 232 blocked)
 *     north 109   (row-2 pixel: 111 free, 110 blocked)
 *
 * Six inequalities, and under the calibrated floor-sampling model they all
 * select a border ONE SOURCE PIXEL THINNER than the stored mask — free
 * interior [3..71] — while the stored [4..70] misses east by a pixel in one
 * direction and north by a pixel in the other, and no alternative sampling
 * (round, ceil, pixel-centre, interval overlap, nearest-neighbour
 * pre-rasterisation — all tried) reconciles the stored mask with the
 * measurements. So the EFFECTIVE mask ships, with the deviation recorded:
 * fitted at scale 2.24 x 1.76 only; the corners are unmeasured (drawn square
 * here, rounded in the stored data); the sword tunnel's snapped 2.9866...
 * box will exercise it at a second scale and the whole-fight diff will say
 * if the fit holds. Default scale-2 boxes keep spr_battlebg_0's mask, whose
 * [2..72] interior is T3-verified — this entry does not touch them.
 */
export const BATTLEBG_STRETCH_HITBOX_MASK = build(raw.battlebgStretchHitbox);
export const FOUNTAIN_MASK = build(raw.fountain);
export const TOOTH_MASK = build(raw.tooth);
export const STAR_MASK = build(raw.star);
/** spr_knight_diamondbullet_l — the sword tunnel sword's own sprite, which is
 *  also its collision mask: the recorder shows `mask_index` empty, meaning -1,
 *  so GameMaker falls back to sprite_index. */
export const DIAMOND_MASK = build(raw.diamondbullet);
export const PXWHITE2_MASK = build(raw.pxwhite2);
export const STARCHILD_MASK = build(raw.starchildparts);
export const SWORDOL_MASK = build(raw.swordol);
export const STARCHILD_TRAIL_MASK = build(raw.starchildtrail);
export const QUICKSLASH_MARKER_MASK = build(raw.quickslashmarker);

/**
 * sprite name -> its precise mask, for the DEFAULT contact test.
 *
 * GameMaker's default is `mask_index = -1`, meaning "collide with my own
 * sprite", and obj_heart's Collision event just fires `event_user(5)` on
 * whatever overlaps. This engine used to require every bullet type to hand-roll
 * a `collides`, and `runCollisions` SKIPPED any type that did not have one —
 * silently, which is the worst possible failure for a contact path.
 *
 * Four bullets were in that state, three of them in the real fight:
 * obj_tracking_sword_slash, obj_knight_pointing_starchild and obj_sword_vortex
 * could not damage the player at all. Registering the sprite mask here makes
 * the default work the way the original does, so a newly translated bullet is
 * dangerous by default rather than inert by default.
 */
export const SPRITE_MASKS = {
  spr_pxwhite2: PXWHITE2_MASK,
  spr_knight_starchild_parts: STARCHILD_MASK,
  // The inert trail shards at difficulty 2. Without this they were skipped
  // 67,908 times in a single practice run — invisible and harmless.
  spr_knight_starchild_trail: STARCHILD_TRAIL_MASK,
  spr_rk_quickslash_marker: QUICKSLASH_MARKER_MASK,
  spr_roaringknight_sword_ol: SWORDOL_MASK,
  spr_knight_diamondbullet_l: DIAMOND_MASK,
  spr_knight_bullet_star: STAR_MASK,
  spr_roaringknight_tooth: TOOTH_MASK,
  spr_rk_fountain_bullet: FOUNTAIN_MASK,
};

/**
 * `scr_precise_hit(n)` — the contact test most knight bullets actually use.
 *
 *     n /= 2
 *     collision_rectangle(hx - n, hy - n, hx + n, hy + n, id, true, false)
 *
 * where (hx, hy) is the soul's CENTRE, `obj_heart.x + 10, y + 10`. So it is a
 * small square probe at the soul's middle against the bullet's precise mask —
 * NOT a mask-vs-mask overlap, and much more forgiving than one: the soul's
 * heart-shaped mask never enters into it.
 *
 * Built as a solid n-by-n probe mask fed through masksOverlap, which is
 * exactly `collision_rectangle` against a precise mask and reuses the
 * calibrated sampling rather than inventing a second one. Probes are cached
 * per size; there are only ever two or three.
 */
const probeCache = new Map();
function probeMask(n) {
  let m = probeCache.get(n);
  if (!m) {
    const side = Math.max(1, Math.round(n));
    m = build({
      name: `probe${side}`,
      w: side,
      h: side,
      originX: 0,
      originY: 0,
      bbox: [0, 0, side - 1, side - 1],
      rows: Array.from({ length: side }, () => '1'.repeat(side)),
    });
    probeCache.set(n, m);
  }
  return m;
}

export function scrPreciseHit(heart, e, mask, n = 3) {
  const half = n / 2;
  const hx = heart.x + 10;
  const hy = heart.y + 10;
  if (!mask) return false;
  const probe = probeMask(n);
  return masksOverlap(
    probe, hx - half, hy - half,
    mask, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle,
  );
}

/** The default contact test: the bullet's own sprite mask against the soul. */
export function spriteMaskHit(e, heart) {
  const m = SPRITE_MASKS[e.sprite_index];
  if (!m) return null; // no mask registered — caller decides what that means
  return masksOverlap(
    HEART_MASK, heart.x, heart.y,
    m, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle,
  );
}

/**
 * Precise-vs-precise overlap: unscaled, unrotated mask A at integer (ax, ay)
 * against mask B at (bx, by) with scale (bsx, bsy) and rotation `bangle`
 * (GameMaker image_angle: degrees, counter-clockwise on screen).
 *
 * Walks A's set pixels inside its bbox and inverse-samples B at the pixel
 * CORNER with floor — the model the oracle's yscale ramp selects exactly
 * (hit threshold at yscale 1.0; corner+floor reproduces it 8/8, centre
 * sampling does not). Instance positions are floored first, which is what
 * makes the oracle's 20/20 misses at fractional spawn y come out right.
 *
 * A is always the heart here — the soul never rotates or scales, so only
 * the B side carries a transform.
 */
export function masksOverlap(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle = 0) {
  const px = Math.floor(bx);
  const py = Math.floor(by);
  const [al, at, ar, ab] = maskA.bbox;
  const [bl, bt, br, bb] = maskB.bbox;

  // In screen coordinates (y down), a visually-CCW rotation by `a` maps
  // local (u,v) -> (u cos a + v sin a, -u sin a + v cos a); sampling uses
  // the inverse. Standard f64 trig — the bbox pre-check below, not trig
  // epsilon behaviour, is what decides the degenerate axis-aligned cases.
  const r = (bangle * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);

  // B's world-space integer bounding box: rotate the corners of its scaled
  // bbox rectangle, then floor the min edge and ceil-1 the max edge. This is
  // the pre-check that makes a sub-pixel-thin axis-aligned mask unhittable
  // (its integer bbox collapses to a row/column that samples off the mask)
  // while the same mask rotated to a diagonal connects. Without it, trig
  // epsilons at 90° would decide hits — and get them wrong.
  const lx0 = (bl - maskB.originX) * bsx;
  const lx1 = (br + 1 - maskB.originX) * bsx;
  const ly0 = (bt - maskB.originY) * bsy;
  const ly1 = (bb + 1 - maskB.originY) * bsy;
  let minx = Infinity;
  let maxx = -Infinity;
  let miny = Infinity;
  let maxy = -Infinity;
  for (const u of [lx0, lx1]) {
    for (const v of [ly0, ly1]) {
      const wx = u * cos + v * sin;
      const wy = -u * sin + v * cos;
      if (wx < minx) minx = wx;
      if (wx > maxx) maxx = wx;
      if (wy < miny) miny = wy;
      if (wy > maxy) maxy = wy;
    }
  }
  const left = Math.floor(px + minx);
  const right = Math.ceil(px + maxx) - 1;
  const top = Math.floor(py + miny);
  const bottom = Math.ceil(py + maxy) - 1;

  for (let cy = at; cy <= ab; cy++) {
    const rowA = maskA.px[cy];
    const wy = ay + cy;
    if (wy < top || wy > bottom) continue;
    const dy = wy - py;

    for (let cx = al; cx <= ar; cx++) {
      if (!rowA[cx]) continue;
      const wx = ax + cx;
      if (wx < left || wx > right) continue;
      const dx = wx - px;

      const u = dx * cos - dy * sin;
      const v = dx * sin + dy * cos;

      const sx = Math.floor(u / bsx + maskB.originX);
      if (sx < 0 || sx >= maskB.w) continue;
      const sy = Math.floor(v / bsy + maskB.originY);
      if (sy < 0 || sy >= maskB.h) continue;

      if (maskB.px[sy][sx]) return true;
    }
  }
  return false;
}

/**
 * GameMaker collision shapes that are NOT precise pixel masks.
 *
 * A sprite's `sepmasks` decides what its collision actually is, and only
 * `Precise` uses the pixel grid `masksOverlap` walks. The two contact tests
 * this project needs are both non-precise:
 *
 *   spr_rk_quickslash   RotatedRect, bbox [2,26]..[241,28]  — Flurry's cut
 *   spr_dodgeheart      AxisAlignedRect                     — the soul's body
 *
 * so `collision_rectangle(..., prec = true)` against the cut is an ORIENTED
 * BOX test, not a pixel test. Getting that wrong would mean walking a pixel
 * grid that the runner never consults.
 */

/**
 * spr_rk_quickslash, from the extracted sprite metadata: a 250x48 sprite whose
 * mask is the RotatedRect over bbox [2,26]..[241,28] — a 240x3 bar — with
 * origin (125,27). This is Flurry's cut.
 */
export const QUICKSLASH_SHAPE = { bbox: [2, 26, 241, 28], ox: 125, oy: 27, w: 250, h: 48 };

/** A sprite's bbox as a local rectangle about its origin, before rotation. */
function localBBox(meta, sx, sy) {
  const [bl, bt, br, bb] = meta.bbox;
  return {
    x0: (bl - meta.ox) * sx,
    // bbox is INCLUSIVE, so the far edge is one pixel past the stored index.
    x1: (br + 1 - meta.ox) * sx,
    y0: (bt - meta.oy) * sy,
    y1: (bb + 1 - meta.oy) * sy,
  };
}

/** The four world-space corners of a rotated, scaled sprite bbox. */
export function rotatedRectCorners(meta, x, y, sx, sy, angleDeg) {
  const r = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const b = localBBox(meta, sx, sy);
  const pts = [];
  for (const u of [b.x0, b.x1]) {
    for (const v of [b.y0, b.y1]) {
      // Same convention as masksOverlap: y down, angle CCW on screen.
      pts.push({ x: x + u * cos + v * sin, y: y - u * sin + v * cos });
    }
  }
  // Order them around the rectangle rather than in nested-loop order, so the
  // edge axes below are real edges.
  return [pts[0], pts[1], pts[3], pts[2]];
}

/** Separating-axis test: axis-aligned rectangle against an oriented box. */
function aabbHitsOBB(rx0, ry0, rx1, ry1, corners) {
  const axes = [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: corners[1].x - corners[0].x, y: corners[1].y - corners[0].y },
    { x: corners[3].x - corners[0].x, y: corners[3].y - corners[0].y },
  ];
  const rect = [
    { x: rx0, y: ry0 },
    { x: rx1, y: ry0 },
    { x: rx1, y: ry1 },
    { x: rx0, y: ry1 },
  ];

  for (const a of axes) {
    const len = Math.hypot(a.x, a.y);
    if (len === 0) continue;
    const ax = a.x / len;
    const ay = a.y / len;

    let amin = Infinity;
    let amax = -Infinity;
    for (const p of rect) {
      const d = p.x * ax + p.y * ay;
      if (d < amin) amin = d;
      if (d > amax) amax = d;
    }
    let bmin = Infinity;
    let bmax = -Infinity;
    for (const p of corners) {
      const d = p.x * ax + p.y * ay;
      if (d < bmin) bmin = d;
      if (d > bmax) bmax = d;
    }
    if (amax < bmin || bmax < amin) return false; // separating axis found
  }
  return true;
}

/**
 * scr_precise_hit(n) against a RotatedRect-masked instance.
 *
 *     arg0 /= 2
 *     collision_rectangle(hx - arg0, hy - arg0, hx + arg0, hy + arg0, id, ...)
 *
 * with hx/hy the soul's centre — `obj_heart.x + 10`, `obj_heart.y + 10`, NOT
 * its origin. At n = 0 the original degrades to `collision_point`, which is
 * the same test with a zero-size rectangle.
 */
export function scrPreciseHitRotatedRect(heart, e, meta, n = 3) {
  const half = n / 2;
  const hx = heart.x + 10;
  const hy = heart.y + 10;
  const corners = rotatedRectCorners(
    meta,
    e.x,
    e.y,
    e.image_xscale ?? 1,
    e.image_yscale ?? 1,
    e.image_angle ?? 0,
  );
  return aabbHitsOBB(hx - half, hy - half, hx + half, hy + half, corners);
}

/**
 * `collision_line(x1, y1, x2, y2, obj, prec, notme)` with **prec = 0**.
 *
 * That flag matters: at prec 0 GameMaker tests the target's BOUNDING BOX, not
 * its pixel mask, even when the sprite is Precise. obj_heart's mask sprite
 * (spr_dodgeheartmask) IS precise, so using the pixel grid here would be
 * testing something the call explicitly opted out of.
 *
 * Segment against an axis-aligned rectangle, by slab clipping.
 */
export function collisionLineRect(x1, y1, x2, y2, rx0, ry0, rx1, ry1) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  for (const [p, q] of [
    [-dx, x1 - rx0],
    [dx, rx1 - x1],
    [-dy, y1 - ry0],
    [dy, ry1 - y1],
  ]) {
    if (p === 0) {
      if (q < 0) return false; // parallel and outside this slab
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/** obj_heart's bounding box in world space, from spr_dodgeheartmask's bbox. */
export function heartBBox(heart) {
  const [l, t, r, b] = HEART_MASK.bbox;
  // Inclusive bbox, so the far edge is one pixel past the stored index.
  return [heart.x + l, heart.y + t, heart.x + r + 1, heart.y + b + 1];
}


/**
 * `spr_grazemask` — 50x50, origin (25,25), flagged AxisAlignedRect, so it is a
 * solid square with no pixel data to extract. Built here rather than shipped in
 * the mask module because a rectangle is cheaper to describe than to store.
 */
export const GRAZE_MASK = build({
  name: 'spr_grazemask',
  w: 50,
  h: 50,
  originX: 25,
  originY: 25,
  bbox: [0, 0, 49, 49],
  rows: Array.from({ length: 50 }, () => '1'.repeat(50)),
});
