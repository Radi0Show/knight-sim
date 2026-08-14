// GameMaker draw primitives the ported Draw events keep needing.
//
// These are the handful of GML calls that have no one-line canvas equivalent:
// colour merging (GML packs colours BGR), `gpu_set_fog` silhouettes, and
// `draw_triangle_color` gradient beams. Keeping them here means each ported
// Draw event reads like the GML it came from instead of like canvas plumbing.

/** GML `lengthdir_x` — degrees, y axis pointing DOWN, so sin is negated. */
export const ldx = (len, deg) => len * Math.cos((deg * Math.PI) / 180);
/** GML `lengthdir_y`. */
export const ldy = (len, deg) => -len * Math.sin((deg * Math.PI) / 180);

export const c_white = [255, 255, 255];
export const c_gray = [128, 128, 128];
export const c_red = [255, 0, 0];
export const c_black = [0, 0, 0];

/** GML `merge_color(a, b, t)` — a straight per-channel lerp. */
export function mergeColor(a, b, t) {
  const k = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

export const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

/**
 * A copy of one sprite frame recoloured to a solid colour, keeping its alpha.
 *
 * Two different GML calls land here. `gpu_set_fog(true, col, 0, 0)` makes every
 * following draw a flat silhouette in `col` — that is what `scr_draw_outline`
 * uses. `draw_sprite_ext(..., col, a)` instead MULTIPLIES the sprite by `col`,
 * which for the white-ish star art is close enough to the same thing; where it
 * is not (the purple flow texture at `c_gray`) the caller multiplies with a
 * globalAlpha pass instead.
 *
 * Cached per (image, colour) because this runs several times per bullet per
 * frame and there are up to 96 of them.
 */
const tintCache = new Map();
export function tinted(img, color) {
  if (!img) return null;
  // COLOUR IS AN [r, g, b] ARRAY. A string gets indexed character by
  // character and yields the literal `rgb(r,g,b)` — not a colour, so the fill
  // silently does nothing and the sprite draws untinted. An invalid
  // fillStyle throws nothing and changes nothing, so the mistake is
  // completely silent; it cost two rounds of "the Flurry flame still looks
  // wrong" before it was found. Fail loudly instead.
  if (!Array.isArray(color)) {
    throw new TypeError(
      `tinted() needs an [r,g,b] array, got ${JSON.stringify(color)}`,
    );
  }
  // ONLY <img> IS CACHEABLE. Callers also pass CANVASES that are rebuilt every
  // frame (the cut box's two halves), and a canvas has no `.src` — so the key
  // would collapse to "undefined|<colour>" and every later call would get the
  // first frame's picture back. Cache on the source URL or not at all.
  const key = img.src ? `${img.src}|${color[0]},${color[1]},${color[2]}` : null;
  if (key) {
    const hit = tintCache.get(key);
    if (hit) return hit;
  }
  let c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  // MULTIPLY, NOT REPLACE. GameMaker's `draw_sprite_ext` colour argument
  // multiplies the texture, so a BLACK pixel stays black whatever the tint is.
  // A `source-in` fill instead replaces every pixel with the colour, which for
  // the near-white star art is indistinguishable — and for spr_battlebg_0's
  // solid black interior turned the whole arena green.
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = rgb(color);
  g.fillRect(0, 0, c.width, c.height);
  // `multiply` ignores the source alpha, so put the original's back.
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  if (key) tintCache.set(key, c);
  return c;
}

/**
 * `draw_sprite_ext` with GameMaker's conventions: the position is the sprite's
 * ORIGIN, scale is about that origin, and image_angle is counter-clockwise
 * degrees. `color` multiplies the texture; pass null to leave it alone.
 */
/**
 * GameMaker's FOG (`d3d_set_fog(true, colour, 0, 1)`): every pixel REPLACED
 * by the colour, alpha kept — a solid silhouette. This is NOT what the
 * draw-colour argument does (that multiplies; see tinted above), and a white
 * `tinted` is a silent no-op on dark art — which is why the fog draws (the
 * intro's whiteout copy, the charge-up's white knight) need this instead.
 */
export function fogged(img, color) {
  if (!img) return null;
  if (!Array.isArray(color)) {
    throw new TypeError(`fogged() needs an [r,g,b] array, got ${JSON.stringify(color)}`);
  }
  const key = img.src ? `fog|${img.src}|${color[0]},${color[1]},${color[2]}` : null;
  if (key) {
    const hit = tintCache.get(key);
    if (hit) return hit;
  }
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = rgb(color);
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  if (key) tintCache.set(key, c);
  return c;
}

export function drawSpriteExt(ctx, entry, sub, x, y, xs, ys, angleDeg, color, alpha, fog = false) {
  if (!entry || !entry.frames.length) return;
  const img = entry.frames[((sub | 0) % entry.frames.length + entry.frames.length) % entry.frames.length];
  if (!img) return;
  const src = color ? (fog ? fogged(img, color) : tinted(img, color)) : img;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x, y);
  if (angleDeg) ctx.rotate((-angleDeg * Math.PI) / 180);
  ctx.scale(xs, ys);
  ctx.drawImage(src, -(entry.meta.ox ?? 0), -(entry.meta.oy ?? 0));
  ctx.restore();
}

/**
 * `scr_draw_beam_color(x, y, length, width, angle, col, outer, alpha, circle)`.
 *
 * A `draw_triangle_color` wedge: apex at (x,y) in `col`, spreading `width`
 * degrees and reaching `length`, with the two far corners in `outer` — which
 * every caller passes as 0 (black). Under `bm_add` black contributes nothing,
 * so the beam is a spike that fades out along its length.
 */
export function drawBeamColor(ctx, x, y, length, width, angle, color, alpha, circle = false) {
  const e1x = x + ldx(length, angle + width / 2);
  const e1y = y + ldy(length, angle + width / 2);
  const e2x = x + ldx(length, angle - width / 2);
  const e2y = y + ldy(length, angle - width / 2);

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (circle) {
    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    ctx.arc(x + ldx(length, angle), y + ldy(length, angle), width / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // The gradient runs apex -> tip, which is what a two-colour triangle with
  // both far vertices the same colour interpolates to.
  const g = ctx.createLinearGradient(x, y, x + ldx(length, angle), y + ldy(length, angle));
  g.addColorStop(0, rgb(color));
  g.addColorStop(1, 'rgb(0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(e1x, e1y);
  ctx.lineTo(e2x, e2y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * `scr_draw_outline(dist, color, alpha)` — four flat-colour copies of the
 * instance's own sprite offset along the axes (rotated with image_angle when it
 * is not a multiple of 90). Drawn additively by both callers, so it reads as a
 * glow rather than an outline.
 */
export function drawOutline(ctx, entry, e, dist, color, alpha) {
  let xA = dist;
  let xB = 0;
  let yA = 0;
  let yB = dist;
  if (e.image_angle % 90 !== 0) {
    xA = ldx(dist, e.image_angle);
    xB = ldx(dist, e.image_angle + 90);
    yA = ldy(dist, e.image_angle + 90);
    yB = ldy(dist, e.image_angle);
  }
  const a = e.image_alpha * alpha;
  for (const [dx, dy] of [[xA, yA], [-xA, -yA], [xB, yB], [-xB, -yB]]) {
    drawSpriteExt(ctx, entry, e.image_index, e.x + dx, e.y + dy,
      e.image_xscale, e.image_yscale, e.image_angle, color, a);
  }
}

/** GML `scr_pingpong(v, n)` — 0..n..0 with period 2n. */
export function pingpong(v, n) {
  if (n === 0) return v;
  const m = ((v % (n * 2)) + n * 2) % (n * 2);
  return m > n ? n * 2 - m : m;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * obj_growtangle's Draw — the arena, and it is GREEN.
 *
 *     draw_sprite_ext(sprite_index, 1, x, y, ..., image_blend, image_alpha);
 *     ... draw_self();
 *
 * Frame 1 tinted with `image_blend` (which Create sets to
 * `merge_color(c_green, c_lime, 0.5)`) UNDER the ordinary frame. spr_battlebg_0's
 * two frames are two layers of one border, not an animation — the second is the
 * green glow that the arena wears for the entire fight.
 *
 * The `customBox` branch is not reachable here: nothing in the knight fight sets
 * `customBox`, so the `else` arm — draw_self() — is the one that runs.
 */
export function drawGrowtangle(ctx, e, sprites, fallbackName) {
  // NOTE the second layer is `draw_self()`, which applies image_blend TOO — so
  // both frames are tinted green. Frame 1 is a solid black interior (green x
  // black is still black) and frame 0 is the border, which is what actually
  // comes out green. The generic blit in render/canvas.js therefore has to
  // honour image_blend as well, or the border stays white.
  // The box never assigns `sprite_index` — GameMaker gives it one from the
  // object definition — so the renderer resolves it through SPRITE_FOR, and
  // this has to use the same map or it silently draws nothing.
  const entry = sprites.get(e.sprite_index ?? fallbackName);
  if (!entry || entry.frames.length < 2) return false; // fall back to the blit
  drawSpriteExt(ctx, entry, 1, e.x, e.y,
    e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, e.image_alpha);
  return false; // draw_self() still follows — the caller's normal blit
}
