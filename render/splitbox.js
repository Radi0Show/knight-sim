import { tinted } from './draw/gm.js';
// obj_knight_split_growtangle's Draw event — the cut battle box.
//
// This is the single most important thing to draw in Flurry: the attack spends
// most of its turn split, and while it is split obj_growtangle is parked at
// x = -9999 and draws nothing. Without this the arena vanishes and the soul
// looks like it is floating in the void — it is actually riding one of the
// halves.
//
// The original builds it out of surfaces:
//
//   source_surf   170x170, spr_battlebg_0 frame 1 then frame 0, at (85,85)
//                 scale 2 — the box's own art, not a rectangle
//   half_box_a/b  source_surf with everything on one side of the cut line
//                 subtracted away (bm_subtract against a huge triangle)
//   draw          the two halves pushed apart by `distance` along the cut
//                 normal, plus spr_rk_split_flame_edge on the cut faces
//
// Reproduced here with offscreen canvases and clipping instead of
// bm_subtract — same picture, and clipping is exact where an alpha subtract
// would leave fringes.
//
// TWO DELIBERATE DEVIATIONS, both marked where they happen:
//
//  * The 1px shake (`irandom_range(-1, 1)` x4 per frame) uses a RENDER-LOCAL
//    generator. The original draws from the shared stream, but sim/ must stay
//    deterministic and frame-identical under the headless verifier, and the
//    renderer is forbidden from writing to sim state at all.
//  * The `update_box` re-composite pass — which nudges the halves by
//    choose(-2,-1,1,2) and draws a grey seam while the box is WHOLE — is not
//    reproduced. It is a shimmer on an unsplit box; the split itself is what
//    matters here.

const SURF = 170;
const HALF = 85;

/** lengthdir_x/y: GameMaker angles are CCW with y down. */
const ldx = (len, deg) => len * Math.cos((deg * Math.PI) / 180);
const ldy = (len, deg) => -len * Math.sin((deg * Math.PI) / 180);

const CHANGES = [-2, -1, 1, 2];

/** Render-local PRNG. Never touches the sim's stream — see the header. */
let shakeSeed = 0x2545f491;
function shake() {
  shakeSeed ^= shakeSeed << 13;
  shakeSeed ^= shakeSeed >>> 17;
  shakeSeed ^= shakeSeed << 5;
  return ((shakeSeed >>> 0) % 3) - 1; // irandom_range(-1, 1)
}

/** `choose(-2, -1, 1, 2)` from the same render-local stream. */
function choose4() {
  shakeSeed ^= shakeSeed << 13;
  shakeSeed ^= shakeSeed >>> 17;
  shakeSeed ^= shakeSeed << 5;
  return (shakeSeed >>> 0) % 4;
}

function makeCanvas() {
  const c = document.createElement('canvas');
  c.width = SURF;
  c.height = SURF;
  return c;
}

export function createSplitBox(sprites) {
  const bg = sprites.get('spr_battlebg_0');
  if (!bg || bg.frames.length < 2) return null;

  // source_surf: the box art, drawn twice (frame 1 under frame 0) at scale 2.
  const source = makeCanvas();
  function resetSource() {
    const g = source.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SURF, SURF);
    g.imageSmoothingEnabled = false;
    const { ox, oy } = bg.meta;
    for (const f of [1, 0]) {
      g.save();
      g.translate(HALF, HALF);
      g.scale(2, 2);
      g.drawImage(bg.frames[f], -ox, -oy);
      g.restore();
    }
  }
  resetSource();

  // `source_surf` is created PER INSTANCE in the original (`if
  // (!surface_exists(source_surf))` inside the object's own Draw), and the
  // shear below degrades it permanently — that is the point. This renderer
  // builds it once and reuses it across turns, so it has to be reset whenever a
  // NEW organism appears, or the second Flurry of a run would start with the
  // first one's smeared border already baked in.
  let lastOrganism = null;
  let updateBox = false;

  const halfA = makeCanvas();
  const halfB = makeCanvas();

  // ---- the SHEAR, which is where the goop comes from ----------------------
  //
  // Every frame the box is split, the original REBUILDS `source_surf` out of
  // its own two halves, each shoved along the cut normal by a random deviation,
  // and paints a dark line down the seam:
  //
  //     var _change = choose(-2, -1, 1, 2);
  //     _deviation  = _change - (vertical ? v_change : h_change);
  //     surface_set_target(source_surf);
  //     draw_surface(half_box_a, -xmul * _deviation, -ymul * _deviation);
  //     draw_surface(half_box_b,  xmul * _deviation,  ymul * _deviation);
  //     draw_set_color(merge_color(c_black, c_white, 0.25));
  //     gpu_set_blendmode_ext(bm_dest_alpha, bm_zero);
  //     draw_line(...);
  //
  // and the halves are re-cut from `source_surf` on the next frame. That is a
  // FEEDBACK LOOP: the picture is fed through itself, sheared a couple of
  // pixels each way, every frame it stays split. The border smears and crawls
  // along the cut instead of sitting still — that is the goopy, molten look of
  // the split board, and it cannot be got by drawing two clean halves.
  //
  // `bm_dest_alpha, bm_zero` is `src * dstAlpha`: the seam is painted only where
  // the surface already has pixels, and it REPLACES them rather than blending,
  // so it darkens the cut edge to a hard grey line. `destination-in` after a
  // clipped fill is the 2D equivalent.
  let vChange = 0;
  let hChange = 0;
  const scratch = makeCanvas();

  function shearSource(angle, xoffset, yoffset, vertical) {
    const change = CHANGES[choose4()];
    const deviation = change - (vertical ? vChange : hChange);
    if (vertical) vChange = change;
    else hChange = change;

    const xmul = ldx(1, angle);
    const ymul = ldy(1, angle);

    const g = scratch.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SURF, SURF);
    g.drawImage(halfA, -xmul * deviation, -ymul * deviation);
    g.drawImage(halfB, xmul * deviation, ymul * deviation);

    // The seam: `merge_color(c_black, c_white, 0.25)` is rgb(64,64,64).
    const abs = HALF + Math.abs(deviation);
    g.save();
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgb(64,64,64)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(HALF + xoffset - xmul * abs, HALF + yoffset - ymul * abs);
    g.lineTo(HALF + xoffset + xmul * abs, HALF + yoffset + ymul * abs);
    g.stroke();
    g.restore();

    const sg = source.getContext('2d');
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, SURF, SURF);
    sg.drawImage(scratch, 0, 0);
  }

  /**
   * Clip `source` to one side of the cut line and return the canvas.
   *
   * The original subtracts a triangle spanning the cut line and running 400px
   * off to one side, which is a half-plane in practice. `side` picks which.
   */
  function buildHalf(target, angle, xoffset, yoffset, vertical, side) {
    const g = target.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, SURF, SURF);

    const xmul = ldx(1, angle);
    const ymul = ldy(1, angle);
    const cx = HALF + xoffset;
    const cy = HALF + yoffset;
    // The perpendicular the original uses: 400 along x when vertical, else y.
    const ex = (vertical ? 400 : 0) * side;
    const ey = (vertical ? 0 : 400) * side;

    g.save();
    g.beginPath();
    g.moveTo(cx - xmul * 400, cy - ymul * 400);
    g.lineTo(cx + xmul * 400, cy + ymul * 400);
    g.lineTo(cx + ex, cy + ey);
    g.closePath();
    g.clip();
    g.drawImage(source, 0, 0);
    g.restore();
    return target;
  }

  /**
   * @param ctx    the world-space context (already translated by the view)
   * @param e      the live obj_knight_split_growtangle entity
   */
  function draw(ctx, e) {
    if (e !== lastOrganism) {
      lastOrganism = e;
      resetSource();
      vChange = 0;
      hChange = 0;
      // ARMED, not cleared. The original's `update_box` starts false and is set
      // true by the `distance == 0` branch — which works there because every
      // frame is drawn. Here it is NOT: `?frames=N` fast-forwards the sim
      // without rendering, so the renderer can first meet an organism that is
      // already mid-split and would then never build its halves at all — the
      // box simply vanished.
      //
      // Arming it per organism instead makes the build depend only on the
      // entity, never on which frames happened to be painted. Same one build
      // per split; no dependence on render history.
      updateBox = true;
    }
    const distance = e.distance ?? 0;
    const vertical = !!e.vertical;
    const diagonal = !!e.diagonal;

    let splid = vertical ? Math.round(distance) : 0;
    let dist = vertical ? 0 : Math.round(distance);
    let angle = (e.angle ?? 0) + (vertical ? 90 : 0);
    if (diagonal) {
      splid = Math.SQRT1_2 * distance;
      dist = splid;
      angle += 45;
    }

    const xoffset = e.xoffset ?? 0;
    const yoffset = e.yoffset ?? 0;

    // EVERY half is drawn with `image_blend`, which Create copies off
    // obj_growtangle — so the cut box stays the arena's green. Drawing it
    // plain turned it white for the whole split, which is precisely the moment
    // the box has the player's attention.
    const blend = e.image_blend;

    if (distance === 0) {
      // Whole box: the source surface, drawn straight. `update_box = true` is
      // set here and ONLY here.
      updateBox = true;
      ctx.drawImage(blend ? tinted(source, blend) : source, e.x - HALF, e.y - HALF);
      return;
    }

    // ONCE PER SPLIT, NOT ONCE PER FRAME. The original's whole re-composite —
    // cutting the two halves AND shearing the source back together — sits
    // inside `if (distance != 0 && update_box)`, and the last line of that
    // block is `update_box = false`. Only `distance == 0` sets it again.
    //
    // Running it every frame turns a one-shot shear into a feedback loop that
    // eats the picture: each frame re-cuts halves from an already-sheared
    // source and shears them again, so after a dozen frames the border has
    // smeared into mush. That is what "something is seriously wrong" looked
    // like. The halves are built once, from the pristine source, and then just
    // drawn further apart as `distance` grows.
    if (updateBox) {
      updateBox = false;
      buildHalf(halfA, angle, xoffset, yoffset, vertical, -1);
      buildHalf(halfB, angle, xoffset, yoffset, vertical, 1);
      shearSource(angle, xoffset, yoffset, vertical);
    }

    const jx = shake();
    const jy = shake();
    const jx2 = shake();
    const jy2 = shake();

    const tA = blend ? tinted(halfA, blend) : halfA;
    const tB = blend ? tinted(halfB, blend) : halfB;
    if (diagonal && vertical) {
      ctx.drawImage(tA, e.x - splid - HALF + jx, e.y + dist - HALF + jy);
      ctx.drawImage(tB, e.x + splid - HALF + jx2, e.y - dist - HALF + jy2);
    } else {
      ctx.drawImage(tA, e.x - splid - HALF + jx, e.y - dist - HALF + jy);
      ctx.drawImage(tB, e.x + splid - HALF + jx2, e.y + dist - HALF + jy2);
    }

    // The burning cut faces.
    const flame = sprites.get('spr_rk_split_flame_edge');
    if (!flame || !flame.frames.length) return;
    // `flame_index` IS PER INSTANCE and lives on the object, not on the
    // renderer. A module-level counter advanced once per draw call is shared
    // by every growtangle on screen and stops entirely under `?frames=N`,
    // which paints nothing — the documented "renderer state must not depend
    // on which frames were PAINTED" trap. The sim owns it now.
    const fi = Math.floor(e.flame_index ?? 0) % flame.frames.length;
    const img = flame.frames[fi];
    const { ox, oy } = flame.meta;

    const blit = (x, y, deg) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((-deg * Math.PI) / 180);
      ctx.scale(2, 2);
      // `c_gray` MULTIPLIES the sprite to half brightness. This drew it at
      // `globalAlpha = 0.5` instead, which makes it half TRANSPARENT — a
      // washed-out ghost you can see the box through, rather than a dim
      // ember burning on the cut face.
      //
      // CLAUDE.md records the case where the two ARE equivalent: a c_gray
      // multiply under an ADDITIVE blend is exactly alpha 0.5. This is a
      // normal blend, so the equivalence does not hold, and borrowing it here
      // was reading the note without its condition.
      ctx.drawImage(tinted(img, 'rgb(128,128,128)'), -ox, -oy);
      ctx.restore();
    };

    if (vertical) {
      blit(e.x - dist - 1, e.y + 2, angle);
      blit(e.x + dist + 2, e.y, angle);
    } else {
      blit(e.x + 2, e.y - dist - 1, angle + 185);
      blit(e.x, e.y + dist + 2, angle);
    }
  }

  return { draw };
}
