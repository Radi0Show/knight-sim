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
/**
 * THE FIGHT'S DEFAULT BOX WALL — spr_battlebg_0 as the FIGHT behaves, which
 * is one source pixel thicker than the stored mask on every side.
 *
 * Measured with mid-wall pushes against the real knight's ac-11 box
 * ((320,190), scale 2, angle 0, image_index 0, mask spr_battlebg_0 — all
 * confirmed in the same recording, traces/wallpush4 + wallpush-we):
 *
 *     north rest 120   (row-2 ink at 122; 119 blocked)
 *     south rest 242   (row-17 ink at 259 = source row 71; 243 blocked)
 *     west  rest 250   (col-2 ink at 252; 249 blocked)
 *     east  rest 372   (col-17 ink at 389 = source col 71; 373 blocked)
 *
 * All four select free interior [3..71] — the stored mask's [2..72] misses
 * every one by exactly one source pixel, and [3..71] is ALSO the stretch
 * box's measured interior, so in the fight both wall sprites collide as the
 * same effective ring. Corner pushes (the soul sliding along a wall into a
 * corner) stop ~2px earlier still, consistent with the rounded corner arcs
 * advancing under the same one-pixel dilation.
 *
 * THE TESTER ROOM IS DIFFERENT, and both measurements stand: the t3
 * recording's box (same sprite, same scale, tester-created) rests the soul
 * at x=374 — the stored [2..72] exactly. Why the two rooms differ is not
 * established; each scene uses the mask its own oracle pinned. Built by
 * one-pixel dilation of the stored ink so the corner arcs thicken with the
 * walls.
 */
export const BATTLEBG_FIGHT_MASK = (() => {
  const src = build(raw.battlebg);
  const h = src.px.length;
  const w = src.px[0].length;
  const px = src.px.map((row, y) => row.map((v, x) => {
    if (v) return true;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy >= 0 && yy < h && xx >= 0 && xx < w && src.px[yy][xx]) return true;
      }
    }
    return false;
  }));
  return { ...src, name: 'battlebg_fight_effective', px };
})();
export const FOUNTAIN_MASK = build(raw.fountain);
export const TOOTH_MASK = build(raw.tooth);
export const STAR_MASK = build(raw.star);
/**
 * `spr_knight_bullet_star`'s OWN precise mask — the full four-pointed star,
 * 2040 inked pixels with spikes reaching the sheet's edges. TWO star hitboxes
 * exist and the difference is a mask_index override, invisible to any grep of
 * the sprite name:
 *
 *   obj_knight_pointing_star   Create: mask_index = spr_knight_bullet_star_mask
 *                              — the small diamond (STAR_MASK, 853 px)
 *   obj_knight_roaring_star    NO override — collides with the sprite itself
 *
 * Both attacks draw the same art. Giving ROARING's rings the small diamond cut
 * their hitbox to 42% of the game's — reported by a player as the circling
 * stars feeling far too generous, and they were.
 */
export const STAR_FULL_MASK = build(raw.starfull);
/** spr_knight_diamondbullet_l — the sword tunnel sword's own sprite, which is
 *  also its collision mask: the recorder shows `mask_index` empty, meaning -1,
 *  so GameMaker falls back to sprite_index. */
export const DIAMOND_MASK = build(raw.diamondbullet);
export const PXWHITE2_MASK = build(raw.pxwhite2);
export const STARCHILD_MASK = build(raw.starchildparts);
export const SWORDOL_MASK = build(raw.swordol);
export const STARCHILD_TRAIL_MASK = build(raw.starchildtrail);
export const QUICKSLASH_MARKER_MASK = build(raw.quickslashmarker);
/** spr_smallbullet — obj_diagonal_bullet's sprite, set on the OBJECT
 *  DEFINITION (invisible to every code grep — the obj_basicattack hole).
 *  sepmasks is AxisAlignedRect with bbox [6,6]..[9,9]: a 4x4 block centred
 *  in a 16x16 sheet, origin (8,8). */
export const SMALLBULLET_MASK = build(raw.smallbullet);
/**
 * `spr_diamondbullet` — the knight stream's shed bullets. NOTE the near-miss:
 * `spr_knight_diamondbullet_l` above is a DIFFERENT sprite (the sword
 * tunnel's, 99x32) and owns the `diamondbullet` key; this one is 33x32 and is
 * keyed `streamdiamond`. Writing it to the obvious key overwrote the tunnel's
 * mask, which no suite would have caught quickly — the tunnel would simply
 * have started missing.
 */
export const STREAMDIAMOND_MASK = build(raw.streamdiamond);
/**
 * `spr_knight_weird_shape` — the underbox's big central shot, 55x20 Precise
 * with only 9 inked rows: a horizontal sliver, which is why the yscale lerp
 * from 3 down to 2 matters more than it looks (the mask is scaled, and a
 * 20px sheet at yscale 3 is a 60px-tall hitbox).
 */
export const WEIRDSHAPE_MASK = build(raw.weirdshape);
/**
 * `spr_diamondbullet_form` — the underbox's fan shots. THE THIRD DIAMOND: the
 * sword tunnel's `spr_knight_diamondbullet_l` (99x32) owns `diamondbullet`,
 * the stream's `spr_diamondbullet` (33x32) owns `streamdiamond`, and this one
 * is 33x32 as well but with a 5-row inked core rather than the stream's full
 * 32. Same near-miss the streamdiamond note warns about, one sprite further
 * along; keyed `diamondform` for the same reason.
 */
export const DIAMONDFORM_MASK = build(raw.diamondform);
/**
 * `spr_roaringknight_slash_tunnel` — the knightlines spears. 99x21 Precise,
 * and only 9 rows are inked: a long lens that tapers to a point at both ends,
 * which is why it reads as a spear rather than a bar. The bullet is created at
 * `image_xscale = 4` and approaches 1, so the mask is FOUR TIMES this wide on
 * the frame it appears and shrinks to true size as it locks on.
 */
export const SLASHTUNNEL_MASK = build(raw.slashtunnel);
/**
 * `spr_bullet_knightcrescent_hitbox` — and this one is an EXPLICIT
 * `mask_index`, not a sprite fallback:
 *
 *     mask_index = spr_bullet_knightcrescent_hitbox;   // knightcrescent Create
 *
 * so the crescent collides with a 26-row Precise crescent while it DRAWS
 * `spr_bullet_knightcrescent` (same 36x34 sheet, AxisAlignedRect). Taking the
 * drawn sprite's mask instead would give the whole rectangle — a crescent's
 * concave side would kill you from inside the curve. The hitbox sprite is
 * never drawn, so it is a mask here and no PNG ships for it.
 *
 * ORIGIN (0, 34) — the BOTTOM-left corner, not the centre, on both sprites.
 */
export const CRESCENT_MASK = build(raw.crescenthitbox);
/**
 * THE REVISED TUNNEL'S SWORDS, in their three sizes. The attack picks by how
 * long the blade needs to be: the default `spr_knight_diamondswordbullet`
 * (33x32), `_m` at 66 once `y3 > 48`, `_l` at 99 once `y3 > 80`.
 *
 * The first two are ROTATED-RECT sprites whose bbox is ONE PIXEL TALL —
 * [4,15]..[28,15] and [4,15]..[61,15] — so the mask is a horizontal hairline,
 * built here from the bbox rather than from the art (the same treatment
 * SMALLBULLET_MASK gets, and the correct one: a rect mask IS its bbox).
 *
 * A one-pixel-tall mask is exactly at the contact model's threshold, and it
 * only registers because these are drawn at `image_angle` 90 or 270 —
 * CLAUDE.md's contact study, rule 2: an axis-aligned sub-pixel bar misses,
 * the same bar rotated crosses integer sample rows and connects. Turned
 * upright, that hairline is the blade.
 */
export const DIAMONDSWORD_MASK = build(raw.diamondsword);
export const DIAMONDBULLET_M_MASK = build(raw.diamondbullet_m);

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
  // The SPRITE's own mask — what an instance with no mask_index override
  // collides and GRAZES with. Stars' pointing stars override to the small
  // diamond via `e.mask` at create (sim/attacks/pointing-star.js).
  spr_knight_bullet_star: STAR_FULL_MASK,
  spr_roaringknight_tooth: TOOTH_MASK,
  spr_rk_fountain_bullet: FOUNTAIN_MASK,
  spr_smallbullet: SMALLBULLET_MASK,
  spr_diamondbullet: STREAMDIAMOND_MASK,
  spr_knight_weird_shape: WEIRDSHAPE_MASK,
  spr_diamondbullet_form: DIAMONDFORM_MASK,
  spr_roaringknight_slash_tunnel: SLASHTUNNEL_MASK,
  spr_bullet_knightcrescent: CRESCENT_MASK,
  spr_knight_diamondswordbullet: DIAMONDSWORD_MASK,
  spr_knight_diamondbullet_m: DIAMONDBULLET_M_MASK,
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

/** IEEE round-half-to-even — the C library's rint(), which is what the
 *  runner's collision_rectangle uses on its bounds. Math.round is half-UP
 *  and differs exactly at the .5 boundaries the probe grid exposed. */
function rint(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * `collision_rectangle(x1, y1, x2, y2, id, true, false)` against a precise
 * mask — CALIBRATED, not modelled. An 15,795-point oracle sweep
 * (knight-research tools/patches/oracle_rect_probe.csx ->
 * traces/rect-probe.csv: the f201 star exactly, the same star at integer
 * position, and a scale-1 star) selects ONE rule with zero mismatches:
 *
 *   1. round each bound with rint (HALF-TO-EVEN — half-up loses 81+ points
 *      exactly at the .5 boundaries);
 *   2. iterate integer pixels [x1..x2] x [y1..y2] INCLUSIVE;
 *   3. sample the target mask at the pixel CENTRE (+0.5), anchored at
 *      floor(instance position), floor-inverse to source coordinates.
 *
 * This is a DIFFERENT quantisation from masksOverlap's corner sampling —
 * measured there, measured here, both kept. Rotation is applied by inverse
 * transform like masksOverlap's, but the sweep did not cover rotated
 * targets; a rotated scr_precise_hit target should get its own spot-check.
 */
export function collisionRectanglePrecise(x1, y1, x2, y2, e, mask) {
  if (!mask) return false;
  // CALIBRATED, second generation — two oracle sweeps:
  //
  //   traces/rect-probe.csv   15,795 pts, unrotated stars   -> 0 mismatches
  //   traces/rect2-probe.csv  14,884 pts, rotated children  -> 12, all on one
  //                           boundary row of the 270-degree config
  //
  // The rule the data selects:
  //   1. B's world bbox: rotate the scaled sprite-bbox corners about the RAW
  //      (f32) position — floats, no rounding;
  //   2. intersect that with the FLOAT rectangle; empty -> no hit. The
  //      fractional intersection is load-bearing: two rects with identical
  //      integer pixel windows resolve differently when their float overlap
  //      with the bbox differs (measured, cfg0 rows 152.4 vs 152.9);
  //   3. integerize the intersection ends with rint (HALF-TO-EVEN — this is
  //      also what reconciles the first sweep's floor-looking anchors:
  //      rint(300.5) = 300);
  //   4. sample each pixel CENTRE about an rint-rounded anchor, inverse
  //      rotation, floor-divide into mask cells.
  //
  // The 12-point residual is a documented oracle-fitted limit: model hits on
  // a row the runner misses, half a pixel above the mask's rotated top edge,
  // in a configuration (fractional position, 270 degrees, scale 0.73) whose
  // every neighbouring row and column fits exactly. No variant tried (raw or
  // clamped sampling, floor/round windows, per-pixel square SAT) removes it
  // without breaking hundreds of other points.
  const sxs = e.image_xscale ?? 1;
  const sys = e.image_yscale ?? 1;
  const ang = e.image_angle ?? 0;
  const r = (ang * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const [bl, bt, br, bb] = mask.bbox;
  const lx0 = (bl - mask.originX) * sxs;
  const lx1 = (br + 1 - mask.originX) * sxs;
  const ly0 = (bt - mask.originY) * sys;
  const ly1 = (bb + 1 - mask.originY) * sys;
  let mnx = Infinity;
  let mxx = -Infinity;
  let mny = Infinity;
  let mxy = -Infinity;
  for (const u of [lx0, lx1]) {
    for (const v of [ly0, ly1]) {
      const wx = e.x + u * cos + v * sin;
      const wy = e.y - u * sin + v * cos;
      if (wx < mnx) mnx = wx;
      if (wx > mxx) mxx = wx;
      if (wy < mny) mny = wy;
      if (wy > mxy) mxy = wy;
    }
  }
  const ix0 = Math.max(x1, mnx);
  const ix1 = Math.min(x2, mxx);
  const iy0 = Math.max(y1, mny);
  const iy1 = Math.min(y2, mxy);
  if (ix0 > ix1 || iy0 > iy1) return false;
  const px0 = rint(ix0);
  const px1 = rint(ix1);
  const py0 = rint(iy0);
  const py1 = rint(iy1);
  const ax = rint(e.x);
  const ay = rint(e.y);
  for (let py = py0; py <= py1; py++) {
    for (let px = px0; px <= px1; px++) {
      const dx = px + 0.5 - ax;
      const dy = py + 0.5 - ay;
      const u = dx * cos - dy * sin;
      const v = dx * sin + dy * cos;
      const sx = Math.floor(u / sxs + mask.originX);
      if (sx < 0 || sx >= mask.w) continue;
      const sy = Math.floor(v / sys + mask.originY);
      if (sy < 0 || sy >= mask.h) continue;
      if (mask.px[sy][sx]) return true;
    }
  }
  return false;
}

export function scrPreciseHit(heart, e, mask, n = 3) {
  const half = n / 2;
  const hx = heart.x + 10;
  const hy = heart.y + 10;
  if (!mask) return false;
  return collisionRectanglePrecise(hx - half, hy - half, hx + half, hy + half, e, mask);
}

/**
 * THE ENGINE PAIR TEST THAT PRECEDES EVERY Other_15. A bullet's damage event
 * is obj_heart's collision event (`with (other) event_user(5)`), and the
 * engine only fires it when the two instances' MASKS overlap. The
 * scr_precise_hit call inside Other_15 is a REFINEMENT of that, never a
 * replacement: both must pass. The sim's precise-hit bullets skipped the
 * pair test and hit one frame early the moment a probe pixel touched before
 * the masks did — whole-fight f295, a starchild's 3px probe connecting a
 * frame before the recording's hit at f296.
 */
export function enginePairHit(heart, e, mask) {
  if (!mask) return false;
  // THE SOUL'S LIVE MASK, not a constant. The sword tunnel swaps obj_heart's
  // mask_index to spr_dodgeheart_smallmask mid-attack and the engine collides
  // with whatever is current — hardcoding HEART_MASK made every pair test
  // ignore the swap. `?? HEART_MASK` because a freshly respawned soul carries
  // no override, exactly as moveheart hands the new heart its default mask.
  return masksOverlap(
    heart.mask ?? HEART_MASK, heart.x, heart.y,
    mask, e.x, e.y, e.image_xscale ?? 1, e.image_yscale ?? 1, e.image_angle ?? 0,
  );
}

/** The default contact test: the bullet's own sprite mask against the soul. */
export function spriteMaskHit(e, heart) {
  const m = SPRITE_MASKS[e.sprite_index];
  if (!m) return null; // no mask registered — caller decides what that means
  return masksOverlap(
    heart.mask ?? HEART_MASK, heart.x, heart.y,
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
/** IEEE round-half-to-even, as in collisionRectanglePrecise — exact .5
 *  bbox extents (scale-1 masks at half-pixel offsets) round like the
 *  runner's rint, not like Math.round's half-up. */
function rintHalfEven(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * TWO ROUTINES, SELECTED BY MASK A'S KIND — measured, not designed.
 *
 * The runner special-cases collision by mask type, and the two calibration
 * datasets are irreconcilable under any single rule that was tried:
 *
 *   - PRECISE A (the heart, every bullet): corner-of-A-cells sampling with
 *     B's position floored and a floor/ceil-1 world bbox. Calibrated by the
 *     t4 contact study (48 points) and held by the t6/t7/roaring recordings
 *     (a raw-position variant hits the t6 teeth one frame early and breaks
 *     the roaring ring arc outright).
 *
 *   - AXIS-ALIGNED-RECT A (the graze box - spr_grazeappear has maskcount=0,
 *     no pixel data at all): the rectangle routine - RAW positions, ROUND
 *     bbox, pixel-corner sampling, floor-inverse into B. Calibrated by
 *     traces/graze-probe.csv (30,976 place_meeting points, 0 mismatches);
 *     the precise routine is 591 points wrong on that data and misses the
 *     whole-fight f293 graze.
 *
 * This mirrors collisionRectanglePrecise above, which is the same rectangle
 * family measured through collision_rectangle. A rect mask never reaches
 * the precise path because it has no pixel data in the game files to be
 * precise WITH.
 */
export function masksOverlap(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle = 0) {
  // A ZERO SCALE HAS NO AREA — and both routines invert through it.
  //
  // `Math.floor(v / 0 + originY)` is NaN, which passes `sy < 0 || sy >= h`
  // because every comparison with NaN is false, and then `maskB.px[NaN][sx]`
  // throws. obj_fallingsword's Create opens with `image_yscale = 0` and lerps
  // out of it, so every falling sword spends its first frames here — the
  // crash only appeared once these bullets started using the pair test
  // instead of a probe that happened to guard it upstream.
  //
  // Returning false is also the right ANSWER, not just a safe one: GameMaker
  // collides nothing at zero scale.
  if (!bsx || !bsy) return false;
  if (maskA.axisRect) {
    return masksOverlapRectA(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle);
  }
  return masksOverlapPrecise(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle);
}

function masksOverlapRectA(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle = 0) {
  // PIXEL-INTERSECTION MODEL — CALIBRATED, second generation.
  //
  // The first model iterated A's solid cells and sampled their corners into
  // B (positions floored, B's world bbox floor/ceil-1). It was fitted to the
  // t4 contact study and held for every axis-aligned pairing — then
  // whole-fight f293 found a rotated case it gets wrong: the graze box
  // misses a starchild at angle 270, scale 0.61, fractional position, that
  // the game grazes. A dedicated probe (knight-research
  // tools/patches/oracle_graze_probe.csx -> traces/graze-probe.csv: 30,976
  // place_meeting points over four child configs, angles 270/90/336/204)
  // selects THIS rule with zero mismatches, and the t4 48-point study plus
  // every green suite still pass under it:
  //
  //   1. positions RAW — not floored; the fractional part participates;
  //   2. each mask's world bbox: A at position - origin + bbox (unrotated);
  //      B by rotating its scaled bbox corners about its position, then
  //      ROUND(min)..ROUND(max)-1 (not floor/ceil-1 — round is what keeps a
  //      sub-pixel-thin axis-aligned mask unhittable AND matches the probe's
  //      angle-90 edge columns, where floor/ceil-1 was 50 points wrong);
  //   3. iterate the INTEGER pixels of the bbox intersection;
  //   4. sample BOTH masks at the pixel corner: A directly
  //      (pixel - (pos - origin)), B by inverse rotation about its raw
  //      position, floor-divided into source cells.
  //
  // Cardinal-exact f32 trig and JS trig score identically on the probe; JS
  // trig is kept.
  const cos = Math.cos((bangle * Math.PI) / 180);
  const sin = Math.sin((bangle * Math.PI) / 180);

  const [al, at, ar, ab] = maskA.bbox;
  const aox = maskA.originX ?? 0;
  const aoy = maskA.originY ?? 0;
  const aLeft = ax - aox + al;
  const aRight = ax - aox + ar;
  const aTop = ay - aoy + at;
  const aBottom = ay - aoy + ab;

  const [bl, bt, br, bb] = maskB.bbox;
  const x0 = (bl - maskB.originX) * bsx;
  const x1 = (br + 1 - maskB.originX) * bsx;
  const y0 = (bt - maskB.originY) * bsy;
  const y1 = (bb + 1 - maskB.originY) * bsy;
  let minx = Infinity;
  let maxx = -Infinity;
  let miny = Infinity;
  let maxy = -Infinity;
  for (const u of [x0, x1]) {
    for (const v of [y0, y1]) {
      const wx = u * cos + v * sin;
      const wy = -u * sin + v * cos;
      if (wx < minx) minx = wx;
      if (wx > maxx) maxx = wx;
      if (wy < miny) miny = wy;
      if (wy > maxy) maxy = wy;
    }
  }
  const left = Math.max(Math.ceil(aLeft), rintHalfEven(bx + minx));
  const right = Math.min(Math.floor(aRight), rintHalfEven(bx + maxx) - 1);
  const top = Math.max(Math.ceil(aTop), rintHalfEven(by + miny));
  const bottom = Math.min(Math.floor(aBottom), rintHalfEven(by + maxy) - 1);
  if (left > right || top > bottom) return false;

  for (let py = top; py <= bottom; py++) {
    for (let px = left; px <= right; px++) {
      const acx = Math.floor(px - (ax - aox));
      if (acx < 0 || acx >= maskA.w) continue;
      const acy = Math.floor(py - (ay - aoy));
      if (acy < 0 || acy >= maskA.h) continue;
      if (!maskA.px[acy][acx]) continue;

      const dx = px - bx;
      const dy = py - by;
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

function masksOverlapPrecise(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle = 0) {
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

  // MASK A'S ORIGIN IS SUBTRACTED. Every caller before the graze box passed
  // the heart (origin 0,0), so `ax + cx` happened to be right and the origin
  // term was invisible — until GRAZE_MASK, whose (25,25) origin makes the
  // box CENTRED on its position. Without the subtraction the graze area sat
  // 25px down-right of the soul, and the whole-fight diff caught it as a
  // graze on a star with twenty pixels of clear air between it and the real
  // box. The calibrated A-side of every earlier verification is untouched:
  // subtracting zero changes nothing.
  const aox = maskA.originX ?? 0;
  const aoy = maskA.originY ?? 0;
  for (let cy = at; cy <= ab; cy++) {
    const rowA = maskA.px[cy];
    const wy = ay + cy - aoy;
    if (wy < top || wy > bottom) continue;
    const dy = wy - py;

    for (let cx = al; cx <= ar; cx++) {
      if (!rowA[cx]) continue;
      const wx = ax + cx - aox;
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
/**
 * The same RotatedRect as a pixel mask, for the GRAZE path. The splitslash
 * grazes the box for its full 10 grazepoints in the recording (whole-fight
 * f886: fresh +10, then 1/3 trickles) — the grazebox pairs with it like any
 * collidebullet, and grazes() needs a registered mask once the strike sets
 * sprite_index. A RotatedRect mask is its bbox, solid, rotated with the
 * instance — which the calibrated sampler already handles.
 */
export const QUICKSLASH_MASK = (() => {
  const [bx0, by0, bx1, by1] = QUICKSLASH_SHAPE.bbox;
  const px = [];
  for (let y = 0; y < QUICKSLASH_SHAPE.h; y++) {
    const row = [];
    for (let x = 0; x < QUICKSLASH_SHAPE.w; x++) {
      row.push(x >= bx0 && x <= bx1 && y >= by0 && y <= by1);
    }
    px.push(row);
  }
  return {
    name: 'rk_quickslash_rect',
    w: QUICKSLASH_SHAPE.w,
    h: QUICKSLASH_SHAPE.h,
    originX: QUICKSLASH_SHAPE.ox,
    originY: QUICKSLASH_SHAPE.oy,
    bbox: QUICKSLASH_SHAPE.bbox,
    px,
  };
})();
// Registered here rather than in the literal: QUICKSLASH_SHAPE lives below
// SPRITE_MASKS in this file, so the literal would read it uninitialised.
SPRITE_MASKS.spr_rk_quickslash = QUICKSLASH_MASK;

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
})
// AxisAlignedRect in the game data (maskcount=0): takes the rectangle
// collision routine, not the precise one. See masksOverlap.
GRAZE_MASK.axisRect = true;

/**
 * The graze box AT ITS EQUIPPED SIZE.
 *
 * `obj_grazebox`'s Create ends with `image_xscale = grazesizefactor;
 * image_yscale = grazesizefactor;`, and the graze-area ribbons are the only
 * things that move it: PinkRibbon +0.2 each, TwinRibbon +0.25 each, capped at
 * 3. The sim tested against the unscaled 50x50 square no matter what was
 * equipped, so the ribbons' entire reason to exist — a bigger graze window —
 * did nothing to the collision. Only their TP/time PENALTIES were modelled,
 * which made them strictly bad items.
 *
 * A scaled AxisAlignedRect is just a bigger rectangle about the same centre,
 * so it is rebuilt rather than run through the rotation path. Cached: this is
 * called once per bullet per frame.
 *
 * LABELLED: the game scales the mask and lets the runner rasterise the
 * result, so a FRACTIONAL size (TwinRibbon's 1.25 gives 62.5px) rounds
 * somewhere this project has not measured. `Math.round` on the extent is the
 * assumption; integer factors — the common 1.2 pairing included — are exact.
 */
const grazeScaled = new Map();
export function grazeMaskAt(factor) {
  if (!(factor > 1)) return GRAZE_MASK;
  const key = factor.toFixed(4);
  const hit = grazeScaled.get(key);
  if (hit) return hit;
  const side = Math.round(50 * factor);
  const half = side / 2;
  const m = build({
    name: 'spr_grazemask',
    w: side,
    h: side,
    originX: half,
    originY: half,
    bbox: [0, 0, side - 1, side - 1],
    rows: Array.from({ length: side }, () => '1'.repeat(side)),
  });
  m.axisRect = true;
  grazeScaled.set(key, m);
  return m;
}
