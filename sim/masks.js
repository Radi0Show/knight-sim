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
 * THE FIGHT SOUL'S REAL HITBOX — the full 20x20 spr_dodgeheart rect, NOT the
 * heart-shaped precise mask.
 *
 * Found via the verify21g hitlog: every heart pairing in the fight logs the
 * heart's collision mask as spr_dodgeheart (AxisAlignedRect, bbox [0..19],
 * maskcount 0). The chain is obj_moveheart's Alarm_0:
 *
 *     heart = instance_create(x, y, obj_heart);
 *     heart.sprite_index = sprite_index;
 *     heart.mask_index = mask_index;        // <- obj_moveheart's OWN mask
 *
 * The fight's soul is created by scr_moveheart and inherits obj_moveheart's
 * definition mask; the TESTER room's soul is created directly and keeps
 * obj_heart's definition mask (spr_dodgeheartmask, the precise heart shape).
 * TWO ROOMS, TWO HITBOXES — which retroactively explains the "tester room
 * is different" wall mystery: the fight's rests (E 372 / W 250 / N 120 /
 * S 242) and the tester's (E 374) all fall out of the SAME stored wall mask
 * once each room's true heart bbox ([0..19] vs [2..17]) is used. The
 * one-pixel wall dilation (BATTLEBG_FIGHT_MASK) was compensating for the
 * wrong heart, not measuring a thicker wall.
 *
 * `axisRect` AFTER ALL — the eighth receipt settled it. This was
 * deliberately left off the rect routine on the strength of seven receipts
 * (f904/f947/f982/f898 hits, f903/f946/f986 misses) that the precise
 * corner-sampling model reproduced — but none of the seven happened to
 * discriminate the two routines. verify21j f3392 does: the first vortex
 * sword's contact (sword at 247.2818/146.0177, angle 84.667, soul at
 * 250/148) HITS in the recording, hits under the rectangle routine (raw
 * positions, round bbox, floor-inverse into B — the same routine the
 * 30,976-point graze probe and the 28,000-point growmeet fit calibrated
 * for AAR-A x rotated-B), and misses under the precise model by a hair.
 * The runner routes by MASK KIND, and spr_dodgeheart's AxisAlignedRect
 * mask is exactly that kind. The seven old receipts ride along: turns 1-4
 * of the whole-fight diff contain every one of them and stay row-exact
 * under the flip.
 */
export const HEART_RECT = {
  name: 'dodgeheart_rect',
  w: 20,
  h: 20,
  originX: 0,
  originY: 0,
  bbox: [0, 0, 19, 19],
  px: Array.from({ length: 20 }, () => new Array(20).fill(true)),
  axisRect: true,
};
/**
 * The same rect flagged for the RECTANGLE routine — the WALL path's model.
 *
 * place_meeting(obj_battlesolid) with the fight heart is an AAR-A against a
 * (possibly rotated, fractionally scaled) precise ring — the graze probe's
 * exact regime, and masksOverlapRectA reproduces the mid-grow ring's true
 * coverage 28,000/28,000 against the growmeet probe (all four recorded
 * grow states of the sword tunnel's box, knight-research
 * traces/growmeet.csv). The DAMAGE path stays on HEART_RECT's precise flow:
 * the collision-event path measurably differs from place_meeting (f982's
 * trailing sliver), so the two routes are two real runner behaviours, not
 * a convenience split.
 */
export const HEART_RECT_WALL = { ...HEART_RECT, name: 'dodgeheart_rect_wall', axisRect: 'always' };
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
    // THE B-SIDE'S ROTATION SPLITS THE RECT-A FAMILY — forced by two
    // receipts on opposite sides of any single rule:
    //
    //   f982  (tooth, angle 0, soul at fractional x): HITS in the recording,
    //         hits under the floored-corner precise model, MISSES under the
    //         raw-position rectangle routine;
    //   f3392 (vortex sword, angle 84.667): HITS in the recording, hits
    //         under the rectangle routine, MISSES under the precise model.
    //
    // The toothmeet probe (place_meeting, unrotated B) already measured
    // floored-x semantics, and the growmeet fit (28,000 points, rotated B)
    // measured the raw-position rectangle — the two datasets were never in
    // conflict because they sit on opposite sides of this split. An A with
    // `axisRect: 'always'` (the graze box, whose sprite has NO mask data at
    // all, and the wall path) stays on the rectangle routine at every angle
    // — its 30,976-point calibration includes unrotated pairs. The wall
    // cannot tell the difference: its contacts happen at integer soul
    // positions, where floored and raw agree.
    const unrotated = ((bangle % 360) + 360) % 360 === 0;
    if (unrotated && maskA.axisRect !== 'always') {
      return masksOverlapPrecise(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle);
    }
    return masksOverlapRectA(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle);
  }
  return masksOverlapPrecise(maskA, ax, ay, maskB, bx, by, bsx, bsy, bangle);
}

/**
 * The collision rotation's [cos, sin]. EXACT values at the cardinals — the
 * runner's trig lands true zeros and ones there (traces/trig-probe.csv:
 * 90/270 return exactly 0) — and plain JS trig everywhere else, which the
 * 30,976-point graze probe validated at non-cardinal angles. The receipt
 * that forces the split is verify21j f9433 (see masksOverlapRectA).
 */
function collisionTrig(bangle) {
  const a = ((bangle % 360) + 360) % 360;
  if (a % 90 === 0) {
    return [[1, 0], [0, 1], [-1, 0], [0, -1]][a / 90];
  }
  const r = (bangle * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
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
  // Cardinal-exact trig — the 30,976-point graze probe scored JS trig and
  // cardinal-exact identically (its angles sat at 270/90/336/204 with
  // geometry that never straddled a residue), and verify21j f9433 finally
  // discriminates: a 900x1 slash at EXACT angle 180, line at y 120, soul
  // band ending 119. With sin(pi)'s 1.22e-16 JS residue the inverse sample
  // lands at v = 1 - 1.7e-14 -> mask row 1, ink, a hit the game does not
  // have; with the runner's exact zero (traces/trig-probe: cardinals return
  // exact values) v = 1 -> row 2, outside the 1x2 mask, miss — the
  // recording's frame. Non-cardinal angles keep JS trig, as probed.
  const [cos, sin] = collisionTrig(bangle);

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
  // ROUND, not floor. verify21j f9093 discriminates: a tooth at
  // x 428.9574890137 (ink reach +6 of origin) registers against the heart
  // rect starting at 435 in the recording — floored, its rightmost ink cell
  // is 434 and the hit comes a frame late; rounded to 429 it is 435 and the
  // hit lands on the game's frame. Every earlier receipt (t6 toothmeet, the
  // t4 contact sweep, 14 verified turns of fullfight hits) is indifferent
  // between the two — the suites all pass either way — because a bullet
  // crossing at several px/frame rarely puts the marginal pixel inside the
  // [.5, 1) fraction window on the exact touching frame.
  const px = Math.round(bx);
  const py = Math.round(by);
  const [al, at, ar, ab] = maskA.bbox;
  const [bl, bt, br, bb] = maskB.bbox;

  // In screen coordinates (y down), a visually-CCW rotation by `a` maps
  // local (u,v) -> (u cos a + v sin a, -u sin a + v cos a); sampling uses
  // the inverse. Standard f64 trig — the bbox pre-check below, not trig
  // epsilon behaviour, is what decides the degenerate axis-aligned cases.
  // Same cardinal-exact trig as masksOverlapRectA — see the f9433 receipt
  // there. Unrotated calls (the common case here) get 1/0 either way.
  const [cos, sin] = collisionTrig(bangle);

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
  // GAMEMAKER WALKS THE LINE; IT DOES NOT CLIP IT. `collision_line` steps
  // along the segment and tests SAMPLED POINTS against the target, so a
  // segment passing a hair outside a corner still registers when one of its
  // samples lands on the corner cell. Exact slab clipping — what this used to
  // do — is the right answer to the wrong question and misses those.
  //
  // ENDPOINTS RAW, SAMPLES FLOORED, FOUR STEPS PER PIXEL. Each part is
  // load-bearing: flooring the endpoints first changes the interpolated PATH
  // rather than merely its rounding, and the step count must reach t = 1 —
  // sometimes the only in-box point (probe21 f1500, a real damage hit).
  //
  // THE DENSITY IS NOT A FITTED KNOB. Swept over the labelled set, the score
  // is flat from 2 steps per pixel all the way to 2048:
  //
  //     0.5x  1x  1.5x   fn=2, fp=0        (too coarse — misses f3041/f3199)
  //     2x ... 2048x     PERFECT, 8126/8126
  //
  // Four orders of magnitude of plateau, so any half-pixel-or-finer sampling
  // is the same model; 4x sits well clear of the cliff below 2x and costs a
  // few hundred iterations per probe. What the coarse end was missing is
  // narrow: at probe37 f3199 the segment satisfies both floor conditions only
  // for t in (0.9377, 0.958) — a window 0.020 wide that a 1/32 step can jump.
  //
  // MEASURED AGAINST THE GAME'S OWN FIRINGS, and the measurement mattered
  // more than the result. This call is the tunnel sword's contact path — it
  // runs inside that sword's Step and invokes event_user(5) directly, never
  // reaching obj_heart's Collision event, and those swords hold no trace
  // slot, so the corridor had no coverage at all. A throwaway oracle variant
  // (knight-research oracle_fullfight_probelog.csx) logs every firing,
  // KNIGHT_SWEEP_ALL logs every evaluation, and tools/fit-lineprobe.mjs
  // joins them. Over 8,126 evaluations and 603 firings from two tokens:
  //
  //   walk 4x (this)  8,126   fp=0  fn=0     <- every firing, every miss
  //   walk 1x          8,124   fp=0  fn=2
  //   clip (old)       8,123   fp=0  fn=3
  //
  // ZERO ERRORS on 603 firings and 7,523 non-firings. Note the model is NOT
  // the continuous limit of itself: exact segment-vs-pixel-coverage (any cell
  // the line passes through) over-fires. The game samples discretely, and a
  // dense-but-discrete walk is what reproduces it.
  //
  // THREE TRAPS THIS ROUTINE COST, all worth more than the model:
  //
  //   * The first version of the fit scored a walk fp=0 that had a REAL false
  //     positive, because the sweep log printed toFixed(2) — and these
  //     decisions turn on sub-pixel boundaries, so 331.9999984 (floors to
  //     331, inside) was read as "332.00" (floors to 332, outside). Rounding
  //     erased exactly the cases the fit existed to discriminate.
  //   * An EXACT join key cannot work: both sides store f32 and agree to
  //     about five decimals, so 4dp split 259.7454528809 from 259.7453918457
  //     and silently lost 4 firings of 603. The join matches on a tolerance.
  //   * Two of this model's apparent misses were never a collision problem at
  //     all — they were `lengthdir_x(37, 90)` returning -1.6e-6 instead of 0,
  //     which walked a probe tip off the box edge. Fixed in sim/gml.js at the
  //     cardinals; see the note there.
  //
  // The two misses this routine carried until 2026-08-22 (probe37 f3041 and
  // f3199) were exactly that coarse-sampling gap, not a shape error — which
  // is what the monotone plateau above proves: refining density fixed them
  // and introduced nothing.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) * 4));
  if (steps <= 0) {
    const px = Math.floor(x1);
    const py = Math.floor(y1);
    return px >= rx0 && px <= rx1 && py >= ry0 && py <= ry1;
  }
  for (let i = 0; i <= steps; i++) {
    const px = Math.floor(x1 + ((x2 - x1) * i) / steps);
    const py = Math.floor(y1 + ((y2 - y1) * i) / steps);
    if (px >= rx0 && px <= rx1 && py >= ry0 && py <= ry1) return true;
  }
  return false;
}

/** obj_heart's bounding box in world space, from spr_dodgeheartmask's bbox. */
export function heartBBox(heart) {
  // THE SOUL'S LIVE MASK, not a constant — the fight soul is the 20x20
  // spr_dodgeheart rect ([0..19]), the tester soul the heart shape
  // ([2..17]), and the sword tunnel's swept probe reads whichever is
  // current (verify21h f1372: an edge contact the [2..17] box misses).
  const [l, t, r, b] = (heart.mask ?? HEART_MASK).bbox;
  // INCLUSIVE integer edges, [l..r] x [t..b] — the coordinates of the last
  // included pixel, exactly as the runner's bbox fields hold them. The
  // segment side is floored before the test (collisionLineRect); together
  // the two conventions satisfy both swept receipts — see there.
  return [heart.x + l, heart.y + t, heart.x + r, heart.y + b];
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
GRAZE_MASK.axisRect = 'always';

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
  m.axisRect = 'always';
  grazeScaled.set(key, m);
  return m;
}
