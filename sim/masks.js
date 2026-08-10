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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raw = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'data', 'masks.json'), 'utf8'),
);

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
export const BATTLEBG_MASK = build(raw.battlebg);
export const FOUNTAIN_MASK = build(raw.fountain);

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
