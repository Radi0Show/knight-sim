// SHATTER FRAGMENTS — cutting a picture along a shatter sheet, and drawing one
// piece of the result.
//
// ══ WHO CALLS THIS, AND WHY IT IS ONE MODULE AND NOT TWO ══════════════════
//
// TWO callers, and the second is the reason this is written general:
//
//   1. THE UNUSED ROW (render/title.js). The settings row shatters where it
//      sits after twenty presses — sim/modes.js's `UNUSED_SHATTER`, the
//      chapter 4 prophecy break. It has a PICTURE to cut (the row's own word)
//      and a box to cut it inside.
//
//   2. THE ROAR'S FINALE (the kaizo page's draw override for
//      `kaizo_shatterpiece`). EnderCat8's `scr_screenshatter_create` has been
//      SIMULATED since 2026-09-08 — 31 pieces, their velocities, their spin
//      fold, their blend — and PAINTED BY NOTHING, so the fight's own ending
//      currently draws empty air. That is the ledger's G-38, severity 4, and
//      this module is the half it was missing. It has NO picture to cut (the
//      mod slices a screenshot off `application_surface`, which the browser
//      renderer has no equivalent of at that point in the pass), so it takes
//      the flat-blend path below.
//
// A drawer only the menu could call would have been the SEVENTH instance of
// this repo's signature defect — a value computed correctly and written where
// nothing reads it. Hence: general over (sprite, origin, fragment count,
// blend), and both callers are named above so a later reader can check that
// both still exist.
//
// ══ WHAT A "SHATTER SHEET" IS ═════════════════════════════════════════════
//
// One sprite whose SUB-IMAGES are the pieces: sub-image `i` is a silhouette of
// shard `i`, in the whole picture's frame, so drawing every sub-image at one
// position reassembles the intact picture. Both of the game's own shatters are
// built that way, which is exactly why the chapter 4 break looks smooth:
//
//     var _fragments = sprite_get_number(_shattersprite);
//     for (var i = 0; i < _fragments; i++)
//         with (scr_marker_ext(logo_prophecy.x, logo_prophecy.y,
//                              _shattersprite, 2, 2, undefined, i, ...))
//     — gml_Object_obj_intro_ch4_Step_0.gml:183-196 (the ch4+ dump)
//
// and the mod cuts its screenshot along the same kind of sheet, one piece per
// sub-image of `spr_roaringknight_finalshatter`:
//
//     draw_sprite_ext(spr_roaringknight_finalshatter, _i, 321, 241, ...)
//     with gpu_set_blendmode(bm_subtract), then the screen through the hole
//     — gml_GlobalScript_scr_lerpvar.gml:74-90 (the kaizo dump)
//
// `sliceShatter` below is that subtract-and-punch, done with canvas composite
// operations instead of surfaces: `destination-in` keeps only the pixels the
// silhouette covers, which is the same hole the mod's two `bm_subtract` passes
// cut. The mod's version samples the LIVE SCREEN; this one samples whatever
// the caller paints, or a flat colour when the caller has nothing to paint.
//
// NOTHING HERE IS RANDOM. Every fragment's motion is decided by its owner (the
// sim), and a Draw that rolled its own dice would run at the monitor's rate
// rather than the sim's — CLAUDE.md, "A GML Draw runs at 30Hz; a browser
// renderer does not".

import { rgb } from './draw/gm.js';

/** How many pieces a sheet has — `sprite_get_number`. 0 for a missing sheet,
 *  which every caller must survive: the vanilla asset pack ships no shatter
 *  sheet at all. */
export function shatterFragmentCount(entry) {
  return entry?.frames?.length ?? 0;
}

/**
 * CUT A PICTURE INTO A SHEET'S SUB-IMAGES.
 *
 * @param {*} entry   the shatter sheet, as `sprites.get(name)` returns it
 *                    (`{ frames: [Image], meta: { w, h, ox, oy } }`).
 * @param {object} opts
 * @param {number} opts.width   destination width — the sheet is scaled to it
 * @param {number} opts.height  destination height
 * @param {number[]} opts.blend [r, g, b]; the flat fill when `paint` is null,
 *                    and a MULTIPLY over the painted picture when it is not.
 *                    Pass the same expression the sim ramps toward and the
 *                    two cannot disagree — `UNUSED_RED` is exactly that.
 * @param {(g: CanvasRenderingContext2D, w: number, h: number) => void} [opts.paint]
 *                    draws the intact picture into a `width` x `height`
 *                    scratch. Omit it for a flat silhouette in `blend`, which
 *                    is what caller 2 above uses.
 * @param {number} [opts.count]  how many fragments to cut (default: all).
 * @returns {HTMLCanvasElement[]} one `width` x `height` canvas per fragment,
 *          indexed by fragment number, each holding ONLY that shard's pixels
 *          in their original places. Drawing all of them at one position
 *          reassembles the picture, which is the property the whole effect
 *          rests on.
 *
 * COST AND CACHING: this is a per-fragment composite over the whole box, so it
 * is built ONCE per break and never per frame. Callers cache it; this module
 * deliberately does not, because the two callers key on different things (a
 * word and a box for one, a sheet and a blend for the other) and a cache here
 * would have to guess.
 */
export function sliceShatter(entry, { width, height, blend, paint = null, count = 0 }) {
  const total = shatterFragmentCount(entry);
  if (!total || !(width > 0) || !(height > 0)) return [];
  const n = count > 0 ? Math.min(count, total) : total;

  // The intact picture, once — every fragment is a copy of this with a hole
  // punched round it.
  const w = Math.ceil(width);
  const h = Math.ceil(height);
  const source = document.createElement('canvas');
  source.width = w;
  source.height = h;
  const sg = source.getContext('2d');
  sg.imageSmoothingEnabled = false;
  if (paint) {
    // TWO CANVASES, AND THE SECOND ONE IS NOT OPTIONAL. The tint is a MULTIPLY
    // — the same rule `tintInto` documents, so a black pixel stays black
    // whatever the colour is, which is what GameMaker's `draw_sprite_ext`
    // colour argument does — and `multiply` IGNORES THE DESTINATION'S ALPHA:
    // over a transparent pixel it simply writes the source colour. So the fill
    // floods the whole box and the picture's own shape has to be put back with
    // a `destination-in` pass over an UNTOUCHED copy.
    //
    // Doing that pass against the canvas being drawn INTO is the bug this
    // comment is here to prevent: `drawImage(source, 0, 0)` on `source`'s own
    // context keeps everything, so the box came out a solid slab of colour and
    // the word inside it was gone. Seen on screen, not in a suite — the slices
    // were the right count, the right size and in the right place, and every
    // assertion about them passed.
    const art = document.createElement('canvas');
    art.width = w;
    art.height = h;
    const ag = art.getContext('2d');
    ag.imageSmoothingEnabled = false;
    paint(ag, w, h);
    sg.drawImage(art, 0, 0);
    if (blend) {
      sg.globalCompositeOperation = 'multiply';
      sg.fillStyle = rgb(blend);
      sg.fillRect(0, 0, w, h);
      sg.globalCompositeOperation = 'destination-in';
      sg.drawImage(art, 0, 0);
      sg.globalCompositeOperation = 'source-over';
    }
  } else {
    sg.fillStyle = rgb(blend ?? [255, 255, 255]);
    sg.fillRect(0, 0, w, h);
  }

  const out = [];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = source.width;
    c.height = source.height;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(source, 0, 0);
    // THE HOLE. `destination-in` keeps the destination only where the source
    // has alpha — the silhouette IS the shard, so what survives is that shard's
    // pixels and nothing else.
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(entry.frames[i], 0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
    out.push(c);
  }
  return out;
}

/**
 * DRAW ONE FRAGMENT. `x, y` is where the fragment's ORIGIN lands, and the
 * origin is the caller's to name: the menu row pins its box by the top-left
 * (0, 0 — the default), while the mod's pieces each carry their own
 * `sprite_create_from_surface(..., _sx, _sy)` anchor.
 *
 * `angle` is GameMaker's `image_angle`: degrees, counter-clockwise, which is
 * why it is negated for the canvas's clockwise rotation — the same conversion
 * `drawSpriteExt` makes. A NEGATIVE `xscale` flips the piece, which is what
 * the mod's spin fold does four times a turn.
 */
export function drawShatterFragment(ctx, image, x, y, {
  ox = 0, oy = 0, xscale = 1, yscale = 1, angle = 0, alpha = 1,
} = {}) {
  if (!image || !(alpha > 0)) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.imageSmoothingEnabled = false;
  ctx.translate(x, y);
  if (angle) ctx.rotate((-angle * Math.PI) / 180);
  if (xscale !== 1 || yscale !== 1) ctx.scale(xscale, yscale);
  ctx.drawImage(image, -ox, -oy);
  ctx.restore();
}
