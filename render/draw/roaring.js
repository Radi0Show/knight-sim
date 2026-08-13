// obj_knight_roaring2's Draw event — the ROAR, ported whole.
//
// 282 lines and four offscreen surfaces. It is the one place in the fight where
// nothing you see is a sprite sitting at an instance's position: the knight is
// re-drawn one scanline at a time with a per-row sine offset, the background is
// a tiled texture multiplied by six expanding rings and then re-scanned with a
// second sine, and the whole composite fades in behind an alpha the Create
// event lerps up over 32 frames.
//
// The layer order, which is the whole event:
//
//   ball_surface   tiled `spr_knight_bullet_flow`, drawn five times (once
//                  normally, four more additively), then MULTIPLIED by six
//                  concentric white->#595959 circles whose radii sweep through
//                  `ball_counter`. That multiply is what turns a flat texture
//                  into a vortex.
//   star_surface   the circle, particles, roaring stars, starchildren and
//                  afterimages, with `spr_knight_line_grate` darkened over the
//                  middle of them (RGB only — see gpu_set_colorwriteenable).
//   my_surface     black; then ball_surface re-drawn ONE ROW AT A TIME with a
//                  horizontal sine wobble and an HSV tint that cycles every
//                  frame; then star_surface; then the knight, also row by row.
//
// and finally `draw_surface_ext(my_surface, ..., darkness)`.
//
// The counters the event advances (ball_counter, hsv, star_flicker, intensify)
// live in sim/attacks/roaring.js's endStep — the renderer only reads.
//
// The `do_fake_screen` finale at roaring_timer 299 IS ported — see
// takeScreenCut at the bottom: the composite is photographed, cut along the
// -63 degree diagonal the marker has been telegraphing, and the two halves are
// handed to markers that slide apart.

import { drawSpriteExt, drawBeamColor, mergeColor, clamp01, tinted, c_white, c_gray, c_red } from './gm.js';
import { drawPointingStarchild } from './pointing-starchild.js';

const W = 640;
const H = 480;

function surf(store, key) {
  let c = store[key];
  if (!c) {
    c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    store[key] = c;
  }
  return c;
}
const surfaces = {};

/** GML `make_color_hsv(h, s, v)` — h/s/v are 0..255, not 0..360. */
function makeColorHsv(h, s, v) {
  const hh = ((h / 255) * 6) % 6;
  const ss = s / 255;
  const vv = v / 255;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = vv * (1 - ss);
  const q = vv * (1 - ss * f);
  const t = vv * (1 - ss * (1 - f));
  const map = [[vv, t, p], [q, vv, p], [p, vv, t], [p, q, vv], [t, p, vv], [vv, p, q]];
  const c = map[i % 6];
  return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)];
}

/** `draw_sprite_tiled(spr, sub, x, y)` — repeats the frame over the surface. */
function drawTiled(g, entry, sub, x, y, scale = 1) {
  if (!entry || !entry.frames.length) return;
  const img = entry.frames[sub % entry.frames.length];
  if (!img) return;
  const tw = img.width * scale;
  const th = img.height * scale;
  let ox = x % tw;
  if (ox > 0) ox -= tw;
  let oy = y % th;
  if (oy > 0) oy -= th;
  for (let py = oy; py < H; py += th) {
    for (let px = ox; px < W; px += tw) g.drawImage(img, px, py, tw, th);
  }
}

/**
 * `obj_knight_roaring_star`'s Other_10 / Other_11. Near-identical to the
 * pointing star's, with one addition: past `split >= 2` the star is drawn as
 * two halves peeling apart by `splitease`, which is the tell that it is about
 * to break in two.
 */
function drawRoaringStar(ctx, e, sprites, userEvent) {
  const entry = sprites.get(e.sprite_index);
  if (!entry || !entry.frames.length) return;
  const top = sprites.get('spr_knight_bullet_star_top') ?? entry;
  const bottom = sprites.get('spr_knight_bullet_star_bottom') ?? entry;
  const xs = e.image_xscale + 16 / entry.frames[0].width;
  const ys = e.image_yscale + 16 / entry.frames[0].height;
  const split = e.split ?? 0;
  const ease = e.splitease ?? 0;
  const tx = e.x + ease / 2;
  const ty = e.y + ease;
  const bx = e.x - ease / 2;
  const by = e.y - ease;

  if (userEvent === 0) {
    if (split < 2) {
      drawSpriteExt(ctx, entry, 0, e.x, e.y, xs, ys, e.image_angle, e.image_blend, e.image_alpha);
    } else {
      drawSpriteExt(ctx, top, 0, tx, ty, xs, ys, e.image_angle, e.image_blend, e.image_alpha);
      drawSpriteExt(ctx, bottom, 0, bx, by, xs, ys, e.image_angle, e.image_blend, e.image_alpha);
    }
    return;
  }

  const alpha = (Math.sin(e.timer * 3) + 1) * 0.25;
  if (e.con === 2 || e.con === 2.5 || e.con === 3) {
    let a = 1;
    let length = 120;
    if (e.con === 2) {
      a = clamp01(e.timer / 30 - alpha);
      length = 50 * clamp01(e.timer / 30 - (e.timer % 2) * 0.75) + 50;
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    drawBeamColor(ctx, tx, ty, length, 10, 90, c_white, a);
    drawBeamColor(ctx, bx, by, length, 10, 156, c_white, a);
    drawBeamColor(ctx, tx, ty, length, 10, 24, c_white, a);
    drawBeamColor(ctx, bx, by, length, 10, 270, c_white, a);
    drawBeamColor(ctx, tx, ty, length, 10, 336, c_white, a);
    drawBeamColor(ctx, bx, by, length, 10, 204, c_white, a);
    ctx.restore();
  }
  if (e.con === 1 || e.con === 2 || e.con === 2.5) {
    const color = mergeColor(c_gray, c_red, clamp01(e.timer / 30));
    drawSpriteExt(ctx, entry, 1, tx, ty, xs + 0.1, ys + 0.1, 0, c_white, alpha);
    drawSpriteExt(ctx, entry, 0, tx, ty, xs, ys, 0, color, 1);
    if (split >= 2) {
      drawSpriteExt(ctx, bottom, 1, bx, by, xs + 0.1, ys + 0.1, 0, c_white, alpha);
      drawSpriteExt(ctx, bottom, 0, bx, by, xs, ys, 0, color, 1);
    }
  }
  if (e.con === 3 || e.con === 4) {
    const g = (Math.sin(e.timer * 6) + 1) * 0.25;
    drawSpriteExt(ctx, entry, 2, tx, ty, xs + 0.1, ys + 0.1, 0, c_white, g);
    drawSpriteExt(ctx, entry, 2, tx, ty, xs, ys, 0, c_white, 1);
    if (split >= 2) {
      drawSpriteExt(ctx, bottom, 2, bx, by, xs + 0.1, ys + 0.1, 0, c_white, g);
      drawSpriteExt(ctx, bottom, 2, bx, by, xs, ys, 0, c_white, 1);
    }
  }
}

/**
 * THE KNIGHT, one scanline at a time.
 *
 * Each row of `knight_sprite` is blitted as a 70x1 strip at double scale, with
 * its x displaced by `sin((row + time*4) * 0.2) * intensify * 0.3`. Above
 * intensify 1.5 a second pass draws alternate rows at 0.75 alpha, thrown much
 * further (`* 8`) and in ALTERNATING directions, which is what tears the figure
 * apart at the peak of the roar.
 *
 * `y` is `fake_y + row*2 + sin(bobble_count * 0.1) * bobble_amp - 10 - bbox_top*2`:
 * the row spacing is 2 because the whole thing is drawn at scale 2, and the
 * bobble is a slow vertical breathe over the whole figure.
 */
function drawKnightRows(g, entry, e, time, originX, originY) {
  if (!entry || !entry.frames.length) return;
  const img = entry.frames[Math.floor(e.knight_sprite_image ?? 0) % entry.frames.length];
  if (!img) return;
  const bl = entry.meta.bbox ? entry.meta.bbox[0] : 0;
  const bt = entry.meta.bbox ? entry.meta.bbox[1] : 0;
  const h = img.height;
  const bob = Math.sin(e.bobble_count * 0.1) * e.bobble_amp;
  const intensify = e.intensify ?? 0;
  const rowY = (a) => originY + e.fake_y + a * 2 + bob - 10 - bt * 2;

  if (intensify > 1.5) {
    g.save();
    g.globalAlpha = (e.fake_alpha ?? 1) * 0.75;
    for (let a = 0; a < h; a++) {
      if (a % 2 !== 0 && a % 2 !== 1) continue;
      const off = Math.sin((a + time * 4) * 0.15) * (intensify - 1.5) * 8;
      const x = a % 2 === 0
        ? originX + e.fake_x - 70 + off
        : originX + e.fake_x - 70 - off;
      g.drawImage(img, bl, a, 70, 1, x, rowY(a), 140, 2);
    }
    g.restore();
  }

  g.save();
  g.globalAlpha = e.fake_alpha ?? 1;
  for (let a = 0; a < h; a++) {
    const x = originX + e.fake_x - 70 + Math.sin((a + time * 4) * 0.2) * intensify * 0.3;
    g.drawImage(img, bl, a, 70, 1, x, rowY(a), 140, 2);
  }
  g.restore();
}

export function drawRoaring(ctx, e, state, deps) {
  const { sprites } = deps;
  const time = state.frame;
  const vx = state.view.x;
  const vy = state.view.y;
  const alive = (name) => state.entities.filter((x) => x.alive && x.type.name === name);

  // `draw_self()` first — the instance itself sits off screen all turn, so this
  // is a no-op in practice, but the early exit below depends on running after.
  //
  // NOT `if (e.stop)`. The sim sets `stop` in the same endStep that arms the
  // finale, and that runs BEFORE this — so keying the exit off `stop` alone
  // would skip the very frame the finale needs to photograph. The snapshot is
  // the gate instead: draw normally until it has been taken.
  if (e.stop && screenCut.taken) {
    // `draw_self()` IS ABOVE THE `if (stop) exit;` — it runs on every frame of
    // the attack, including every frame after the finale has frozen everything
    // else. That is how the knight stays visible over the two halves of the cut
    // screen: he dips, then arcs 360px up and off the top, trailing a ghost a
    // frame, while the wreckage falls away behind him.
    //
    // Suppressed BEFORE the finale, and that is a deliberate deviation: the
    // recording has this instance parked off screen at y -242 all turn, while
    // the launcher spawns it at the arena. Drawing its plain sprite early would
    // put a second, wrongly-posed knight on screen next to the scanline one.
    const self = sprites.get(e.sprite_index);
    if (self) {
      drawSpriteExt(ctx, self, e.image_index, e.x - vx, e.y - vy,
        e.image_xscale, e.image_yscale, e.image_angle, e.image_blend, e.image_alpha);
    }
    return true;
  }

  // ---- ball_surface: the vortex -------------------------------------------
  const ball = surf(surfaces, 'ball');
  const bg = ball.getContext('2d');
  bg.imageSmoothingEnabled = false;
  bg.setTransform(1, 0, 0, 1, 0, 0);
  bg.clearRect(0, 0, W, H);

  const flow = sprites.get('spr_knight_bullet_flow');
  drawTiled(bg, flow, 0, e.fake_x + time * 2, e.fake_y);
  bg.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) drawTiled(bg, flow, 0, e.fake_x + time * 2, e.fake_y);
  bg.globalCompositeOperation = 'source-over';

  // `gpu_set_blendmode_ext(bm_zero, bm_src_color)` is dst * src — a MULTIPLY.
  // Six radial gradients whose radii sweep 1800 -> 0 cut the flat texture into
  // rings; the last one (radius 640, white -> black) is the vignette that keeps
  // the edges of the screen dark.
  bg.globalCompositeOperation = 'multiply';
  const cx = e.fake_x;
  const cy = e.fake_y + 57;
  const ring = (radius, outer) => {
    if (radius <= 0) return;
    const grad = bg.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(1, outer);
    bg.fillStyle = grad;
    bg.beginPath();
    bg.arc(cx, cy, radius, 0, Math.PI * 2);
    bg.fill();
  };
  for (let a = 0; a < 6; a++) ring(1800 - ((e.ball_counter + 300 * a) % 1800), '#595959');
  ring(640, '#000000');
  bg.globalCompositeOperation = 'source-over';

  // ---- star_surface: everything that lives in the vortex --------------------
  const starC = surf(surfaces, 'star');
  const sg = starC.getContext('2d');
  sg.imageSmoothingEnabled = false;
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.clearRect(0, 0, W, H);
  sg.save();
  sg.translate(-vx, -vy);

  // `with (obj_knight_circle) event_user(1);` is a NO-OP. obj_knight_circle has
  // Create/Step/Draw/CleanUp and no Other_11, and GameMaker silently does
  // nothing when an object has no handler for a user event. The circle draws
  // itself through its own Draw event (render/draw/knight-circle.js) and must
  // NOT be composited here as well, or it appears twice.
  for (const p of alive('obj_particle_generic')) {
    const entry = sprites.get(p.sprite_index);
    if (entry) {
      drawSpriteExt(sg, entry, p.image_index, p.x, p.y,
        p.image_xscale, p.image_yscale, p.image_angle, p.image_blend, p.image_alpha);
    }
  }

  // THREE PASSES, not two — the event has three `with (obj_knight_roaring_star)`
  // blocks and the first TWO are both above the grate line:
  //
  //     pass A  if (image_blend == c_white)  continue;   // dark stars
  //     pass B  if (image_blend == c_dkgray) continue;   // white stars
  //     ...the grate...
  //     pass C  if ((image_blend == c_dkgray || image_xscale > 1) && con < 1)
  //                 continue;                             // over the grate
  //
  // So EVERY star is drawn under the grate, and then white small ones — plus
  // ANY star that has begun charging (`con >= 1`), whatever its colour or size
  // — are drawn AGAIN on top of it. The second copy is what makes an active
  // star burn through the scanlines while the idle field stays striped. The
  // old two-pass reading drew each star once and split them by colour, which
  // striped the active ones too and halved the bright field's intensity.
  const roarStars = alive('obj_knight_roaring_star');
  const isWhite = (x) => !x.image_blend || x.image_blend === c_white
    || (Array.isArray(x.image_blend) && x.image_blend[0] === 255 && x.image_blend[1] === 255);
  const drawStar = (st) => drawRoaringStar(sg, st, sprites, st.con === 0 ? 0 : 1);

  for (const st of roarStars) { if (!isWhite(st)) drawStar(st); }   // pass A
  for (const st of roarStars) { if (isWhite(st)) drawStar(st); }    // pass B

  const grate = sprites.get('spr_knight_line_grate');
  if (grate && grate.frames[0]) {
    // `gpu_set_colorwriteenable(true, true, true, false)` and the grate tinted
    // **c_black**: colour is written, alpha is not, so wherever the grate has
    // ink the pixels turn black but keep their alpha — and black contributes
    // nothing when star_surface is later added onto my_surface, so the striped
    // rows simply vanish from the glow.
    //
    // The old version multiplied by the grate's OWN pixels, and the grate's
    // ink is white — dst * 1 is a NO-OP. The scanline effect was silently
    // absent, which no test can see. 'source-atop' with a black-tinted copy is
    // the real equivalent: draw black, only where the destination already has
    // alpha, leaving that alpha as it was.
    sg.save();
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.globalCompositeOperation = 'source-atop';
    sg.drawImage(tinted(grate.frames[0], [0, 0, 0]), 0, e.star_flicker,
      grate.frames[0].width * 2, grate.frames[0].height * 2);
    sg.restore();
  }

  for (const st of roarStars) {                                     // pass C
    const dark = !isWhite(st);
    const large = (st.image_xscale ?? 1) > 1;
    if ((dark || large) && (st.con ?? 0) < 1) continue;
    drawStar(st);
  }

  for (const k of alive('obj_knight_pointing_starchild')) {
    drawPointingStarchild(sg, k, state, deps);
  }
  for (const a of alive('obj_afterimage')) {
    const entry = sprites.get(a.sprite_index);
    if (entry) {
      drawSpriteExt(sg, entry, a.image_index, a.x, a.y,
        a.image_xscale, a.image_yscale, a.image_angle, c_white, a.image_alpha);
    }
  }
  sg.restore();

  // ---- my_surface: the wobble, the tint, and the knight --------------------
  const my = surf(surfaces, 'my');
  const mg = my.getContext('2d');
  mg.imageSmoothingEnabled = false;
  mg.setTransform(1, 0, 0, 1, 0, 0);
  mg.globalCompositeOperation = 'source-over';
  mg.globalAlpha = 1;
  mg.fillStyle = '#000000';
  mg.fillRect(0, 0, W, H);

  // ONE ROW AT A TIME. Each scanline of the vortex is shifted horizontally by
  // two summed sines scaled by `intensity`, so the whole background ripples;
  // the tint is `make_color_hsv(hsv % 255, 255, 255)`, one fully-saturated hue
  // per frame, sweeping as `hsv` walks 128..288.
  if (e.ball_darkness > 0) {
    const tintC = surf(surfaces, 'tint');
    const tg = tintC.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, W, H);
    tg.drawImage(ball, 0, 0);
    tg.globalCompositeOperation = 'multiply';
    const [r, g, b] = makeColorHsv(e.hsv % 255, 255, 255);
    tg.fillStyle = `rgb(${r},${g},${b})`;
    tg.fillRect(0, 0, W, H);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(ball, 0, 0);
    tg.globalCompositeOperation = 'source-over';

    mg.save();
    mg.globalCompositeOperation = 'lighter';
    mg.globalAlpha = clamp01(e.ball_darkness);
    for (let a = 0; a < H; a++) {
      const dx = Math.sin((a + time) * 0.1) * 4 * e.intensity
        + Math.sin((a + time) * 0.35) * 0.5 * e.intensity;
      mg.drawImage(tintC, 0, a, W, 1, dx, a, W, 1);
    }
    mg.restore();
  }

  mg.save();
  mg.globalCompositeOperation = 'lighter';
  mg.drawImage(starC, 0, 0);
  mg.restore();

  for (const a of alive('obj_afterimage_grow')) {
    const entry = sprites.get(a.sprite_index);
    if (entry) {
      mg.save();
      mg.translate(-vx, -vy);
      drawSpriteExt(mg, entry, a.image_index, a.x, a.y,
        a.image_xscale, a.image_yscale, a.image_angle, c_white, a.image_alpha);
      mg.restore();
    }
  }

  // THE PRE-CUT MARKER. From roaring_timer 275 a bar grows out along -63
  // degrees through the centre of the screen, reddening as r/g/b ramp — the
  // telegraph for the diagonal that ends the fight. It is drawn twice: a
  // gradient copy in that colour, and a solid black copy over it.
  if (e.line_timer > -1) {
    const grad = sprites.get('spr_rk_quickslash_marker_gradient');
    const mark = sprites.get('spr_rk_quickslash_marker');
    const dir = -63;
    const mx = W * 0.5 - Math.cos((dir * Math.PI) / 180) * 280;
    const myy = H * 0.5 + Math.sin((dir * Math.PI) / 180) * 280;
    const thick = 4 + 8 * (1 - Math.min(e.line_timer, 16) / 16);
    const col = [Math.round(e.r), Math.round(e.g), Math.round(e.b)];
    // `gpu_set_colorwriteenable(true, true, true, false)` with NORMAL blending
    // — not a multiply. The coloured gradient and the black core replace what
    // is under them (weighted by their own alpha) while leaving the surface's
    // alpha untouched; my_surface is opaque black-filled, so plain source-over
    // is exact. The old 'multiply' darkened the vortex through the marker
    // instead of painting the marker over it, which muted the reddening ramp
    // the r/g/b lerps exist to show.
    mg.save();
    if (grad) drawSpriteExt(mg, grad, 0, mx, myy, e.line_timer, thick, dir, col, 1);
    if (mark) drawSpriteExt(mg, mark, 0, mx, myy, e.line_timer, thick, dir, [0, 0, 0], 1);
    mg.restore();
  }

  if (!e.do_fake_screen) {
    drawKnightRows(mg, sprites.get(e.knight_sprite), e, time, 0, 0);
  }

  // THE COMPOSITE IS NOT BLITTED HERE ANY MORE — it is registered as a COVER
  // and drawn after the battle UI. In the game the charboxes, the tension bar
  // and the bar all draw at their legacy depths (5 / 1 / 1, from
  // __global_object_depths) and NONE of them has a roaring guard; the
  // full-camera composite simply draws over them, so the menu fades out
  // underneath as `darkness` ramps and is gone at 1. The renderer's old order
  // put the panels last "over everything, including a full-screen attack" —
  // which is exactly the assumption the original does not make.
  //
  // The SOUL is the one thing above the cover: roaring2's own Draw does
  // `with (obj_heart) draw_self();` immediately after its surface blit, so
  // canvas.js re-draws it over the cover.
  roaringCover.img = my;
  roaringCover.alpha = clamp01(e.darkness);
  roaringCover.active = true;

  // THE KNIGHT IS DRAWN AGAIN ON THE FINALE FRAME, over the composite — the
  // `do_fake_screen` branch repeats the whole scanline loop after the surface
  // has been composited, at full brightness instead of behind `darkness`,
  // holding the slash pose the roaring_timer 275/299 lerps put him in. He
  // rides the cover, so he is deferred with it.
  roaringCover.fakeScreen = !!e.do_fake_screen;
  roaringCover.entity = e;

  // THE SCREEN IS CUT IN TWO. `sprite_create_from_surface` twice over the same
  // composite, each pass erasing the other side with `gpu_set_blendenable(false)`
  // and an alpha-0 fill — which writes zero alpha rather than blending, i.e. it
  // cuts a hole. What remains either side of the line from (200, 0) to
  // (440, 480) becomes one sprite each.
  //
  // That line is the -63 degree diagonal the `line_timer` marker has been
  // drawing across the screen since roaring_timer 275: the telegraph and the
  // cut are the same geometry.
  if (e.do_fake_screen && !screenCut.taken) {
    takeScreenCut(my, e, state, sprites);
  }

  return true;
}

/**
 * The deferred composite — see the registration site in drawRoaring. Cleared
 * by canvas.js at the top of every frame, drawn by drawRoaringCover after the
 * battle UI so the roar covers the menu the way the game's depth order does.
 */
export const roaringCover = {
  active: false, img: null, alpha: 0, fakeScreen: false, entity: null,
};

/** Blit the registered cover (and the finale knight) over whatever is drawn. */
export function drawRoaringCover(ctx, state, sprites) {
  if (!roaringCover.active || !roaringCover.img) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = roaringCover.alpha;
  ctx.drawImage(roaringCover.img, 0, 0);
  ctx.globalAlpha = 1;
  if (roaringCover.fakeScreen && roaringCover.entity) {
    drawKnightRows(ctx, sprites.get(roaringCover.entity.knight_sprite),
      roaringCover.entity, state.frame, 0, 0);
  }
  ctx.restore();
}

const CUT_TOP_X = 200;   // midway - 120
const CUT_BOTTOM_X = 440; // midway + 120

/** The two halves, built once from the last composited frame. */
export const screenCut = { taken: false, halves: [null, null], origins: [[160, 240], [480, 240]] };

function takeScreenCut(my, e, state, sprites) {
  screenCut.taken = true;

  // WHAT GETS PHOTOGRAPHED IS `my_surface`, NOT THE SCREEN.
  //
  //     surface_set_target(terrible_surface);
  //     draw_clear_alpha(c_black, 0);
  //     draw_surface_ext(my_surface, 0, 0, 1, 1, 0, c_white, darkness);
  //     with (obj_heart) draw_sprite_ext(...);
  //
  // The vortex composite at `darkness`, plus the soul. The KNIGHT is not in it:
  // his scanline rows go to the main canvas a few lines earlier, outside this
  // surface, precisely so that he stays a separate figure and can leap over the
  // two halves as they fall. Snapshotting the whole canvas instead — which is
  // what this did — bakes him into both halves and he gets torn in two with the
  // background.
  const src = document.createElement('canvas');
  src.width = W;
  src.height = H;
  {
    const g = src.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.globalAlpha = clamp01(e.darkness);
    g.drawImage(my, 0, 0);
    g.globalAlpha = 1;
    const heart = state.soul;
    const hs = heart && sprites.get(heart.sprite_index ?? 'spr_dodgeheart');
    if (hs) {
      drawSpriteExt(g, hs, heart.image_index, heart.x - state.view.x, heart.y - state.view.y,
        heart.image_xscale, heart.image_yscale, heart.image_angle,
        heart.image_blend, heart.image_alpha);
    }
  }

  for (let i = 0; i < 2; i++) {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = '#000';
    g.beginPath();
    if (i === 0) {
      // Keep the LEFT half: erase everything right of the diagonal.
      g.moveTo(CUT_TOP_X, -1);
      g.lineTo(CUT_BOTTOM_X, H);
      g.lineTo(W, H);
      g.lineTo(W, -1);
    } else {
      // Keep the RIGHT half.
      g.moveTo(CUT_TOP_X, 0);
      g.lineTo(CUT_BOTTOM_X, H);
      g.lineTo(0, H);
      g.lineTo(0, 0);
    }
    g.closePath();
    g.fill();
    screenCut.halves[i] = c;
  }
}

/** Reset between turns — the practice loop replays Roaring. */
export function resetScreenCut() {
  screenCut.taken = false;
  screenCut.halves = [null, null];
}

/**
 * One half of the cut screen, carried by an obj_marker. Drawn at the marker's
 * position minus the origin the sprite was created with, so it starts exactly
 * where the screen was and then slides.
 */
export function drawScreenPiece(ctx, e, state) {
  const img = screenCut.halves[e.piece];
  if (!img) return true;
  const [ox, oy] = screenCut.origins[e.piece];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = clamp01(e.image_alpha ?? 1);
  ctx.drawImage(img, e.x - state.view.x - ox, e.y - state.view.y - oy);
  ctx.restore();
  return true;
}
