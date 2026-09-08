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

/**
 * THE CACHE IS CAPPED. It used to be a bare Map that only ever grew, and the
 * fight's background fed it a NEW colour almost every frame once the Knight
 * had been hit (render/background.js — the column's blend is a hue sweep
 * mixed by battleprog, which is read off the Knight's HP). Measured with the
 * headless allocation harness: 0 new canvases per 600 frames at 7300 HP, then
 * 159-523 retained canvases per 600 frames at every distinct damaged HP —
 * every player attack turn opened a fresh set, and none was ever freed, so a
 * long NORMAL fight or thirty HITLESS restarts sat on hundreds of megabytes
 * of tinted column copies. That was the "stores the visual effects from
 * previous instances" report.
 *
 * The background no longer goes through this cache at all (it owns one
 * scratch canvas; see there). The cap is the safety net for the next caller
 * that passes a per-frame colour: oldest-in, first-out, and a miss only costs
 * one re-tint. 2048 entries is well past the whole fight's steady-state key
 * set (a few hundred), so nothing that is actually hot is ever evicted.
 */
const TINT_CACHE_CAP = 2048;
function remember(key, c) {
  if (tintCache.size >= TINT_CACHE_CAP) tintCache.delete(tintCache.keys().next().value);
  tintCache.set(key, c);
}

/**
 * Tint `img` by `color` INTO a caller-owned canvas — the three composite ops
 * `tinted()` has always done, factored out so a caller that must re-tint the
 * same picture with a changing colour (the background column) can do it in
 * place instead of minting a cache entry per colour. Resizes `dst` to `img`
 * when they differ, which also clears it.
 *
 * MULTIPLY, NOT REPLACE. GameMaker's `draw_sprite_ext` colour argument
 * multiplies the texture, so a BLACK pixel stays black whatever the tint is.
 * A `source-in` fill instead replaces every pixel with the colour, which for
 * the near-white star art is indistinguishable — and for spr_battlebg_0's
 * solid black interior turned the whole arena green.
 *
 * KNOWN INACCURACY, pre-existing: the multiply pass is an OPAQUE fill, so on
 * a pixel with partial alpha `a` it lands `tint * (1 - a + src * a)` rather
 * than `tint * src` — soft edges are lightened toward the tint before
 * `destination-in` restores their alpha. Every sprite the box code tints is
 * binary-alpha (checked: spr_battlebg_0 and spr_battlebg_stretch_hitbox
 * carry only 0 and 255), so it does not reach the arena; it does touch glows
 * and gradients, and it is the same on every path, so nothing here changes it.
 */
export function tintInto(dst, img, color) {
  if (dst.width !== img.width || dst.height !== img.height) {
    dst.width = img.width;
    dst.height = img.height;
  }
  const g = dst.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, dst.width, dst.height);
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = rgb(color);
  g.fillRect(0, 0, dst.width, dst.height);
  // `multiply` ignores the source alpha, so put the original's back.
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-over';
  return dst;
}

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
  // c_WHITE IS THE IDENTITY. `draw_sprite_ext(..., c_white, a)` multiplies
  // every channel by 1, so the decoded image IS the answer — hand it back
  // instead of building a key, probing the map and drawing from a canvas
  // copy. At the Stars burst and in the sword tunnel that was ~450-530 of the
  // ~500-600 drawImage calls per frame (every starchild outline copy while
  // `con` is 0, every tunnel sword's ten-deep trail and every afterimage all
  // pass c_white). ONLY HERE, never in fogged(): a white FOG is a solid white
  // silhouette, not a no-op — the intro's whiteout and the charge-up's white
  // knight depend on that.
  //
  // On a binary-alpha sprite this is pixel-identical; on a soft-alpha one it
  // removes the opaque-fill lightening described at tintInto(), which is a
  // step TOWARD the game (a multiply by 1 should change nothing).
  if (color[0] === 255 && color[1] === 255 && color[2] === 255) return img;
  // ONLY <img> IS CACHEABLE. Callers may also pass CANVASES, and a canvas has
  // no `.src` — so the key would collapse to "undefined|<colour>" and every
  // later call would get the first caller's picture back. Cache on the
  // source URL or not at all. (The cut box used to be such a caller — every
  // drawn frame, so 1-2 fresh 170x170 canvases per rAF for the whole of every
  // box-splitter turn, the frame drop AT the box splitter. It now tints once
  // at build time; see render/splitbox.js. No hot path passes a canvas here
  // any more, and a new one that does will show up as allocation churn.)
  const key = img.src ? `${img.src}|${color[0]},${color[1]},${color[2]}` : null;
  if (key) {
    const hit = tintCache.get(key);
    if (hit) return hit;
  }
  const c = tintInto(document.createElement('canvas'), img, color);
  if (key) remember(key, c);
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
  if (key) remember(key, c);
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
 * `draw_sprite_ext` for a sprite whose GameMaker NINE-SLICE is enabled.
 *
 * With nine-slice on, GameMaker does not scale the texture as one rectangle:
 * the four corners (`guide` pixels square) are copied UNSCALED, the four edges
 * are stretched along one axis only, and the centre is stretched in both. The
 * result is a border that stays `guide` pixels thick at any scale — which is
 * the whole reason the game swaps the arena onto spr_battlebg_stretch(_hitbox)
 * for its non-2x2 boxes (see drawGrowtangle). Tile mode is Stretch on every
 * slice of both stretch sprites, read from the chapter 4 data.win with the
 * UTMT CLI alongside the guide values (spr_battlebg_stretch L/T/R/B = 2,
 * spr_battlebg_stretch_hitbox = 4, spr_battlebg_0 nine-slice DISABLED).
 *
 * Same conventions as drawSpriteExt — position is the origin, scale is about
 * it, angle is CCW degrees, `color` multiplies — but there is NO ctx.scale:
 * the destination rectangle is `w*xs` by `h*ys` anchored at `(-ox*xs, -oy*ys)`
 * and each slice is placed into it by hand.
 *
 * TWO GUARDS, both for the grow-in. obj_growtangle is born at scale 0 and
 * opens over 15 frames, so the first frames are a handful of pixels: a
 * non-positive size draws nothing (drawImage would be handed a zero or
 * negative width), and the corners are clamped to half the destination so
 * that at 3x2 pixels the edge slices come out at zero width rather than
 * negative. GameMaker collapses the slices the same way when the box is
 * smaller than its guides.
 */
export function drawSpriteExtNineSlice(ctx, entry, sub, x, y, xs, ys, angleDeg, color, alpha, guide) {
  if (!entry || !entry.frames.length) return;
  const img = entry.frames[((sub | 0) % entry.frames.length + entry.frames.length) % entry.frames.length];
  if (!img) return;
  const w = img.width;
  const h = img.height;
  const W = w * xs;
  const H = h * ys;
  if (!(W > 0) || !(H > 0)) return;
  const src = color ? tinted(img, color) : img;
  const g = guide; // source corner size
  const cw = Math.min(g, W / 2); // destination corner width
  const ch = Math.min(g, H / 2);
  const ew = W - 2 * cw; // destination edge lengths
  const eh = H - 2 * ch;
  const sw = w - 2 * g; // source edge lengths
  const sh = h - 2 * g;
  const ox = -(entry.meta.ox ?? 0) * xs;
  const oy = -(entry.meta.oy ?? 0) * ys;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.translate(x, y);
  if (angleDeg) ctx.rotate((-angleDeg * Math.PI) / 180);
  const slice = (sx, sy, sW, sH, dx, dy, dW, dH) => {
    if (sW <= 0 || sH <= 0 || dW <= 0 || dH <= 0) return;
    ctx.drawImage(src, sx, sy, sW, sH, ox + dx, oy + dy, dW, dH);
  };
  // corners
  slice(0, 0, g, g, 0, 0, cw, ch);
  slice(w - g, 0, g, g, W - cw, 0, cw, ch);
  slice(0, h - g, g, g, 0, H - ch, cw, ch);
  slice(w - g, h - g, g, g, W - cw, H - ch, cw, ch);
  // edges
  slice(g, 0, sw, g, cw, 0, ew, ch);
  slice(g, h - g, sw, g, cw, H - ch, ew, ch);
  slice(0, g, g, sh, 0, ch, cw, eh);
  slice(w - g, g, g, sh, W - cw, ch, cw, eh);
  // centre
  slice(g, g, sw, sh, cw, ch, ew, eh);
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
/**
 * Gradients for the beams, cached. During Stars' burst wind-up every charging
 * star draws SIX of these a frame — ~18 stars gave ~108 fresh CanvasGradient
 * allocations per frame, reported from play as a massive FPS drop exactly
 * when the stars wind up. A gradient is position-free if the triangle is
 * drawn in LOCAL space (translate/rotate first), so one gradient per
 * (colour, integer length) serves every beam of that shape forever. The
 * length is Math.round'd FOR THE CACHE KEY ONLY — the strobe's fractional
 * lengths differ from the rounded gradient by under a pixel of ramp, and the
 * triangle geometry itself keeps the exact float length.
 */
const beamGradients = new WeakMap();

export function drawBeamColor(ctx, x, y, length, width, angle, color, alpha, circle = false) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  if (circle) {
    ctx.fillStyle = rgb(color);
    ctx.beginPath();
    ctx.arc(x + ldx(length, angle), y + ldy(length, angle), width / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // The gradient runs apex -> tip, which is what a two-colour triangle with
  // both far vertices the same colour interpolates to. Drawn in LOCAL space
  // (apex at the origin, beam along +x) so the cached gradient fits every
  // position and angle; GameMaker's angles are CCW, canvas rotation is CW,
  // hence the negation.
  // A CanvasGradient belongs to the context that made it, and MORE THAN ONE
  // context draws beams in the same frame (the roar's beams go to its own
  // star surface). A per-context map means neither evicts the other — a
  // single shared cache cleared on context change would have churned every
  // frame of the roar, which is the failure this cache exists to remove.
  let perCtx = beamGradients.get(ctx);
  if (!perCtx) beamGradients.set(ctx, (perCtx = new Map()));
  const key = `${rgb(color)}|${Math.round(length)}`;
  let g = perCtx.get(key);
  if (!g) {
    g = ctx.createLinearGradient(0, 0, Math.round(length), 0);
    g.addColorStop(0, rgb(color));
    g.addColorStop(1, 'rgb(0,0,0)');
    perCtx.set(key, g);
  }
  ctx.translate(x, y);
  ctx.rotate((-angle * Math.PI) / 180);
  const half = (width / 2) * Math.PI / 180;
  const ex = length * Math.cos(half);
  const ey = length * Math.sin(half);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(ex, -ey);
  ctx.lineTo(ex, ey);
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
 * THE `customBox` BRANCH IS REACHABLE — it was documented here as dead, and it
 * is what every non-2x2 arena runs. obj_growtangle Step_0, first frame:
 *
 *     if (visible && (maxxscale != 2 || maxyscale != 2) && sprite_index == spr_battlebg_0) {
 *         customBox = true;
 *         sprite_index = spr_battlebg_stretch_hitbox;
 *         ...snap maxxscale/maxyscale to 1/37.5...
 *         image_xscale = maxxscale / 2;  image_yscale = maxyscale / 2;
 *         surf = surface_create(sprite_width, sprite_height);
 *         draw_sprite_ext(spr_battlebg_stretch, 0, sprite_xoffset, sprite_yoffset,
 *                         image_xscale, image_yscale, 0, c_white, 1);
 *         spr_custom_box = sprite_create_from_surface(surf, ...);
 *     }
 *
 * and Draw_0 in full:
 *
 *     draw_sprite_ext(sprite_index, 1, x, y, image_xscale, image_yscale, image_angle, image_blend, image_alpha);
 *     if (customBox && growth && growcon != 2)
 *         draw_sprite_ext(spr_custom_box, 0, x, y, sizer * growscale, sizer * growscale, image_angle, image_blend, image_alpha);
 *     else
 *         draw_self();
 *
 * Stars (2.24 x 1.76), the sword tunnel (2.9867 x 2) and the two arenas the
 * vanilla selector never picks (3.4933 square, 0.5067 x 2) are all custom.
 * The point of the swap is that spr_battlebg_stretch_hitbox and
 * spr_battlebg_stretch are NINE-SLICE sprites (guides 4 and 2, read from the
 * chapter 4 data.win; spr_battlebg_0's nine-slice is disabled), so the
 * game's border stays 4px thick on those arenas. This renderer drew
 * spr_battlebg_0 through a plain ctx.scale, and its 2px border came out
 * 4.48 x 3.52px on Stars, 5.97 x 4 on the tunnel, ~7px on the 3.49 square —
 * the "no nine-slicing when squashing and stretching on some attacks" report.
 * Collision was never wrong: sim/battlebox.js already models the sprite
 * swap's mask and the scale snap, only the picture was off.
 *
 * spr_battlebg_stretch is pixel-identical to spr_battlebg_0 in both frames
 * (compared the shipped PNGs: 0 differing pixels), so the baked
 * `spr_custom_box` is spr_battlebg_0 frame 0 nine-sliced with guides 2 at
 * (maxxscale/2, maxyscale/2) — an integer-sized surface because of the
 * 1/37.5 snap (84x66 for Stars, 112x75 for the tunnel).
 */

/**
 * The baked `spr_custom_box`, one per (snapped arena size, blend). The game
 * bakes it white and tints at draw; here the tint is folded into the bake
 * (multiply commutes with the copy) so the grow-in draws straight from a
 * canvas instead of re-tinting a canvas every frame — tinted() cannot cache a
 * canvas input. A handful of entries per fight, never evicted.
 */
const customBoxBakes = new Map();
function customBoxBake(entry, maxxscale, maxyscale, blend) {
  const key = `${maxxscale}|${maxyscale}|${blend ? blend.join(',') : ''}`;
  let c = customBoxBakes.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  // `surface_create(sprite_width, sprite_height)` with image_xscale =
  // maxxscale / 2: 75 * maxxscale / 2 = 37.5 * maxxscale, an integer after
  // the snap. Math.round only guards float noise.
  c.width = Math.max(1, Math.round((entry.meta.w ?? 75) * maxxscale / 2));
  c.height = Math.max(1, Math.round((entry.meta.h ?? 75) * maxyscale / 2));
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  // Drawn at (sprite_xoffset, sprite_yoffset) — the scaled origin — so the
  // sprite's top-left lands on the surface's (0, 0).
  drawSpriteExtNineSlice(g, entry, 0,
    (entry.meta.ox ?? 0) * maxxscale / 2, (entry.meta.oy ?? 0) * maxyscale / 2,
    maxxscale / 2, maxyscale / 2, 0, blend, 1, 2);
  customBoxBakes.set(key, c);
  return c;
}

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

  // GATED ON THE SIZE, NOT ON THE FLAG ALONE. The game makes a fresh
  // obj_growtangle every turn (customBox = false, spr_battlebg_0); the fight
  // scene here REUSES one and re-arms `init` per turn, and nothing ever
  // clears `customBox` — so from the first Stars turn on, the flag is stale
  // true on every later 2x2 turn and on ROARING, whose tween lerps
  // image_xscale/yscale off a 2x2 box (sim/attacks/roaring.js) while
  // maxxscale/maxyscale stay 2. Measured on the fullfight replay: custom=true
  // from f6269 on every turn, including the ROARING box at 4.06 x 3.48 and
  // climbing. The game only ever sets the flag under this same size test, so
  // re-testing it is exact — and it keeps ROARING's box on spr_battlebg_0,
  // which the game STRETCHES (its border reaches ~34 x 25px), not nine-slices.
  const custom = !!e.customBox && (e.maxxscale !== 2 || e.maxyscale !== 2);
  const hitbox = custom ? sprites.get('spr_battlebg_stretch_hitbox') : null;
  if (!custom || !hitbox || hitbox.frames.length < 2) {
    drawSpriteExt(ctx, entry, 1, e.x, e.y,
      e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, e.image_alpha);
    return false; // draw_self() still follows — the caller's normal blit
  }

  // The custom arena: `sprite_index` is spr_battlebg_stretch_hitbox now, so
  // the frame-1 under-layer is that sprite's, nine-sliced with its guides of
  // 4 (frame 1's transparent margin is 2px and stays 2px).
  drawSpriteExtNineSlice(ctx, hitbox, 1, e.x, e.y,
    e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, e.image_alpha, 4);

  // `customBox && growth && growcon != 2`, seen from AFTER the Step. `growth`
  // and `sizer` are Step locals (sim/battlebox.js keeps them local too):
  // growth is decided before the timer moves and growcon is read after, so
  // the branch is live exactly while growcon 1 has not yet reached maxtimer
  // or growcon 3 still has timer left — on the frame the timer lands on
  // maxtimer, growcon is already 2 and the game falls through to draw_self.
  // sizer = timer / maxtimer post-increment, growscale is 2.
  const growing = (e.growcon === 1 && e.timer < e.maxtimer) || (e.growcon === 3 && e.timer > 0);
  if (growing) {
    const bake = customBoxBake(entry, e.maxxscale, e.maxyscale, e.image_blend);
    const sc = (e.timer / e.maxtimer) * (e.growscale ?? 2);
    if (sc > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, e.image_alpha));
      ctx.translate(e.x, e.y);
      if (e.image_angle) ctx.rotate((-e.image_angle * Math.PI) / 180);
      ctx.scale(sc, sc);
      // sprite_create_from_surface(..., sprite_xoffset, sprite_yoffset): the
      // baked sprite's origin is the SCALED origin of the box art.
      ctx.drawImage(bake, -(entry.meta.ox ?? 0) * e.maxxscale / 2, -(entry.meta.oy ?? 0) * e.maxyscale / 2);
      ctx.restore();
    }
  } else {
    // draw_self(): frame 0 of the hitbox sprite, nine-sliced at the box's
    // own scale — the constant 4px border.
    drawSpriteExtNineSlice(ctx, hitbox, 0, e.x, e.y,
      e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, e.image_alpha, 4);
  }
  return true; // drawn entirely — the generic plain-scaled blit must NOT follow
}
