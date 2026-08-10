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
// Sampling model: a world pixel (wx,wy) tests a scaled mask by inverse
// mapping, floor((w - left) / scale).
//
// VALIDATED ENVELOPE — integer positions, integer scale, NO rotation.
// That covers the steady battle box and everything T3/T4 verify. Outside it,
// measured against the oracle (traces/t4-contact-hits.csv):
//
//   - Sub-pixel scale, axis-aligned: the real runtime registers NOTHING
//     below scale 1.0. Measured on a 1px mask row at angle 0: yscale 0.1-0.9
//     all miss, 1.0 and above all hit. This model instead predicts hits at
//     certain sub-pixel offsets (2 of 20 in a y-sweep that produced 0 real
//     hits), so it is OVER-PERMISSIVE here.
//   - Rotation is not implemented at all, and it is decisive: the same 0.1-
//     scaled mask HITS at 30/45/60/135 degrees and misses at 0 and 90. A
//     diagonal thin line crosses integer sample rows; an axis-aligned one
//     sits in a sub-pixel band and never does.
//
// Consequence: any attack that rotates its mask (most of them — the real
// slash spawners all set image_angle = direction) needs a rotation-capable
// test built and oracle-validated before it can be trusted.

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

/**
 * Precise-vs-precise overlap: unscaled mask A at integer (ax, ay) against
 * mask B at (bx, by) with scale (bsx, bsy), both origin-adjusted, angle 0.
 *
 * Walks A's set pixels inside its bbox and inverse-samples B. Matches
 * GameMaker for the integer-position, integer-scale case.
 */
export function masksOverlap(maskA, ax, ay, maskB, bx, by, bsx, bsy) {
  const leftB = bx - maskB.originX * bsx;
  const topB = by - maskB.originY * bsy;
  const [al, at, ar, ab] = maskA.bbox;

  for (let cy = at; cy <= ab; cy++) {
    const rowA = maskA.px[cy];
    const wy = ay + cy;
    const sy = Math.floor((wy - topB) / bsy);
    if (sy < 0 || sy >= maskB.h) continue;
    const rowB = maskB.px[sy];

    for (let cx = al; cx <= ar; cx++) {
      if (!rowA[cx]) continue;
      const sx = Math.floor((ax + cx - leftB) / bsx);
      if (sx < 0 || sx >= maskB.w) continue;
      if (rowB[sx]) return true;
    }
  }
  return false;
}
