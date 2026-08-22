// The pre-fight sequence's Draw — the snow-zone tableau, the roar fx, the red
// circle layer, the screen-copy ghosts, the sword draw and the backdrop split.
// State machine and sourcing in sim/intro.js; this file only paints.
//
// The fx portion keeps the original Draw's shape:
//     if (bar) draw_line_width_color(px, py - bar*40, px, py + bar*40, bar, white)
//     shift_ol: drawn at (x - 20 + jitter, y + 20 + jitter), and while
//               `whiteout` a WHITE copy on top at whiteout_counter alpha
//     pose_ol:  drawn at (x, y + sin(time * 0.2) * 2) — the settled bob
//
// The jitter is `irandom_range(-1, 1)` per axis in the original's Draw — a
// Draw-event random, so here it is a pure function of the sim frame (the
// 30Hz-vs-monitor rule; CLAUDE.md has the session the distinction cost).
//
// THE RED LAYER: obj_knight_circle's Draw with draw_in_box false — additive
// (`bm_add`), a gradient circle from color_1 (black) at the centre to
// make_color_rgb(r, g, b) at the edge. The sim steps g/b down and leaves r
// (the original's missing line), so this paints white -> red.
//
// THE SCREEN GHOSTS: obj_afterimage_screen re-copies the application surface
// EVERY frame and redraws it growing 0.01/frame around its anchor, fading by
// its faderate — a live radial echo of the current frame. The canvas stands
// in for the application surface (labelled in sim/intro.js); a frozen-at-
// birth snapshot is WRONG and smears stale frames into a screenwide blur.
//
// LABELLED APPROXIMATIONS: the in-rush particles and sprite afterimages are
// recreated from frame-seeded randoms with the original's counts, spawn ring
// (40..240) and inward pull, but not its exact easing curves; the materialising
// sword is drawn
// at its flashing alpha with the original's below-hand slot cut out rather
// than through spr_roaringknight_sword_mask's dest-alpha pass.

import { drawSpriteExt, c_white } from './gm.js';

/** Deterministic per-(frame, salt) random in [0, 1) — mulberry-ish hash. */
function frand(frame, salt) {
  let t = (frame * 374761393 + salt * 668265263) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

export function drawIntroFx(ctx, e, sprites) {
  const entry = sprites.get(e.sprite_index);
  // px/py — `x + sprite_width * 0.42, y + sprite_height * 0.5` at scale 2.
  const w = (entry?.meta?.w ?? 64) * (e.image_xscale ?? 2);
  const h = (entry?.meta?.h ?? 64) * (e.image_yscale ?? 2);
  const px = e.x + w * 0.42;
  const py = e.y + h * 0.5;

  // THE CHARGE-UP — obj_knight_crush, created at fx timer 16. Its Draw is a
  // FILLED, TEXTURED, HUE-SWEPT DISC converging on the Knight, not the thin
  // white ring this used to draw:
  //
  //     draw_circle_color(x - viewx, y - viewy, radius, c_black, ..., false)
  //     gpu_set_colorwriteenable(true, true, true, false);
  //     draw_sprite_tiled(spr_knight_bullet_flow, 0, global.time * 8, 0);
  //     ... colour = make_color_hsv(hsv, 255, 255)
  //     gpu_set_blendmode(bm_add);
  //     repeat (4) draw_surface_ext(my_surface, ..., colour, alpha);
  //     draw_set_alpha(alpha); draw_circle_color(x, y, radius, c_white, ...)
  //
  // The colour-write mask is the trick: the flow texture is written into the
  // disc's RGB while its ALPHA stays the circle's, so the disc is filled with
  // the scrolling flow pattern rather than flat. It is then blended FOUR
  // TIMES additively — deliberate over-saturation — under a white core.
  //
  //     radius  960 -> 160 over 24      (scr_lerpvar)
  //     alpha   0   -> 0.1  over 24
  //     hsv     256 -> 64   over 64, ease "out"
  //
  // so it closes fast and reddens as it does. This is the beat the roar
  // builds on, and a 24px outline read as nothing at all.
  // TWO PHASES, and the second one is the whole point. The Create lerps are
  // only the wind-up; `alarm[0] = 24` then fires
  //
  //     scr_lerpvar("radius", 160, 0,   64, 1, "out");
  //     scr_lerpvar("alpha",  0.1, 1,   64, 1, "out");
  //
  // so the ball goes from a barely-there 0.1 to FULLY OPAQUE WHITE while it
  // shrinks to nothing. This drew only the first 24 frames and capped alpha at
  // 0.1, which over a near-black scene is invisible — the white ball was, for
  // all practical purposes, absent. `1 - (1 - q) * (1 - q)` is scr_ease_out's
  // curve 2, `-t * (t - 2)`.
  if (e.crushTimer >= 0 && e.crushTimer <= 88) {
    let radius;
    let alpha;
    if (e.crushTimer <= 24) {
      const t = e.crushTimer / 24;
      radius = 960 + (160 - 960) * t;
      alpha = 0.1 * t;
    } else {
      const q = Math.min(1, (e.crushTimer - 24) / 64);
      const e2 = 1 - (1 - q) * (1 - q);
      radius = 160 + (0 - 160) * e2;
      alpha = 0.1 + (1 - 0.1) * e2;
    }
    const t = Math.min(1, e.crushTimer / 24);
    // hsv runs on its own 64-frame ease-out, not the 24-frame one.
    const ht = Math.min(1, e.crushTimer / 64);
    const hsv = 256 + (64 - 256) * (1 - (1 - ht) * (1 - ht));
    const [r, g, b] = hsvToRgb255(hsv % 255, 255, 255);

    crushCanvas = getCanvas(crushCanvas, VIEW_W, VIEW_H);
    const cg = crushCanvas.getContext('2d');
    cg.setTransform(1, 0, 0, 1, 0, 0);
    cg.globalCompositeOperation = 'source-over';
    cg.clearRect(0, 0, VIEW_W, VIEW_H);
    cg.fillStyle = '#000';
    cg.beginPath();
    cg.arc(px, py, Math.max(1, radius), 0, Math.PI * 2);
    cg.fill();
    // `colorwriteenable(R, G, B, false)` — paint the flow into the disc's
    // colour without touching its alpha. `source-in` keeps the disc's shape.
    const flow = sprites.get('spr_knight_bullet_flow');
    if (flow?.frames[0]) {
      cg.globalCompositeOperation = 'source-in';
      const img = flow.frames[0];
      const ox = -((e.frame * 8) % img.width);
      for (let x = ox; x < VIEW_W; x += img.width) {
        for (let y = 0; y < VIEW_H; y += img.height) cg.drawImage(img, x, y);
      }
      cg.globalCompositeOperation = 'source-over';
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // The tint, then four additive passes exactly as the repeat does.
    tintCanvas = getCanvas(tintCanvas, VIEW_W, VIEW_H);
    const tg = tintCanvas.getContext('2d');
    tg.setTransform(1, 0, 0, 1, 0, 0);
    tg.globalCompositeOperation = 'source-over';
    tg.clearRect(0, 0, VIEW_W, VIEW_H);
    tg.drawImage(crushCanvas, 0, 0);
    tg.globalCompositeOperation = 'multiply';
    tg.fillStyle = `rgb(${r},${g},${b})`;
    tg.fillRect(0, 0, VIEW_W, VIEW_H);
    tg.globalCompositeOperation = 'destination-in';
    tg.drawImage(crushCanvas, 0, 0);

    // ADDITIVE, RE-ASSERTED BEFORE EVERY DRAW. This is `gpu_set_blendmode
    // (bm_add)` around the whole block, and it is the difference between the
    // ball being made of light and being a hole: the surface it composites is
    // an OPAQUE BLACK DISC with the flow written into its colour channels,
    // so under source-over those four passes paint the scene black — which is
    // exactly what was on screen, a black ball collapsing onto the Knight
    // instead of a white one. Setting the mode once before the loop was not
    // holding; it is now set immediately before each draw.
    ctx.globalAlpha = alpha;
    for (let i = 0; i < 4; i++) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(tintCanvas, 0, 0);
    }
    // `draw_set_alpha(alpha); draw_circle_color(x, y, radius, c_white,
    // c_white, false)` — the white core, same radius, same alpha, still
    // additive. THIS is the white ball.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, radius), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // The in-rush while the whiteout holds: 2 + irandom(2) particles a frame,
  // born 40..240 out, pulled toward the centre. Each is drawn for a few
  // frames along its inward path, seeded by its birth frame.
  if (e.inrushLast != null) {
    // THE IMPLOSION. Each particle's whole life, from the Step:
    //
    //     scr_lerpvar("speed", 4, 16 + irandom(8), 32, 1, "in");
    //     scr_lerpvar("image_xscale", image_xscale, image_xscale * 16, 32, 1, "in");
    //     scr_lerpvar("image_yscale", image_yscale, image_xscale * 0.5, 32, 1, "in");
    //     image_angle = direction;               // pointing AT the centre
    //     ... destroyed within 32px of the centre
    //
    // so it is a 32-FRAME life that accelerates inward while stretching to
    // SIXTEEN TIMES its length and thinning out — streaks converging on the
    // Knight, not dots. This drew 3px squares for 10 frames and then dropped
    // them, which is why the effect registered and vanished before it read.
    //
    // (`yscale`'s target is the ORIGINAL `image_xscale * 0.5`, not the
    // stretched one — the assignment reads the field before its own lerp has
    // moved it. Kept.)
    const LIFE = 32;
    const easeIn = (t) => 1 - Math.cos(t * 1.5707963267948966);
    for (let back = 0; back < LIFE; back++) {
      const bf = e.frame - back;
      // Births only while the Step was still spawning; the ones already born
      // finish their flight regardless of the state now.
      if (bf > e.inrushLast) continue;
      const n = 2 + Math.floor(frand(bf, 1) * 3);
      for (let i = 0; i < n; i++) {
        const dir = frand(bf, 2 + i) * Math.PI * 2;
        const dist0 = 40 + frand(bf, 20 + i) * 240;
        const size = 0.25 + frand(bf, 40 + i) * 0.75;
        const vmax = 16 + Math.floor(frand(bf, 60 + i) * 9);
        // Distance covered = the integral of the eased speed ramp.
        let travelled = 0;
        for (let j = 0; j < back; j++) travelled += 4 + (vmax - 4) * easeIn(j / LIFE);
        const dist = dist0 - travelled;
        if (dist <= 32) continue;
        const t = back / LIFE;
        const sx = px + Math.cos(dir) * dist;
        const sy = py + Math.sin(dir) * dist;
        const len = 3 * size * (1 + 15 * easeIn(t));
        const thick = Math.max(1, 3 * (size + (size * 0.5 - size) * easeIn(t)));
        ctx.save();
        // FULL ALPHA. obj_particle_generic (spr_pixel_white, confirmed via
        // the object-definition dump — its Create sets no sprite, so no grep
        // could find it) is created with the default image_alpha of 1 and
        // nothing fades it; it is destroyed outright inside 32px. The 0.6
        // here was invented and is most of why the implosion read as faint.
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#ffffff';
        ctx.translate(sx, sy);
        ctx.rotate(dir + Math.PI); // image_angle = direction, toward centre
        ctx.fillRect(-len / 2, -thick / 2, len, thick);
        ctx.restore();
      }
    }
  }

  // Sprite afterimages once the roar accelerates: ghost copies around the
  // pose, every 3rd frame while attack_speed is up.
  if (e.fxState === 'roaring' && e.attack_speed > 0 && entry) {
    for (let g = 1; g <= 3; g++) {
      const gf = e.frame - g * 3;
      const ox = (frand(gf, 7) - 0.5) * 60;
      const oy = (frand(gf, 8) - 0.5) * 60;
      drawSpriteExt(ctx, entry, e.image_index, e.x + ox, e.y + oy,
        e.image_xscale, e.image_yscale, 0, null, 0.15 * (4 - g) / 4);
    }
  }

  // NO STROKED RING HERE. There used to be one — a flat white outline
  // expanding to r=280 over 30 frames — and it was INVENTED. Nothing in
  // obj_knight_roaring_fx's Draw strokes a circle: that event is the vertical
  // bar, the shift_ol sprite with its shudder offsets, and the white-fogged
  // whiteout copy, and that is all. The climax's actual circle is
  // obj_knight_circle, a FILLED additive gradient (black centre to (r,g,b)
  // rim) growing 40px a frame to 960 while g and b fall to zero over 28 —
  // modelled in sim/intro.js and drawn as the red layer below.
  //
  // The invented ring sat on top of that bloom as a hard flat arc, which is
  // what read as a badly drawn white circle: a thin outline over a
  // screen-filling flash. Removing it lets the real thing carry the moment.

  // The vertical flash bar. The decay lives in sim (see intro.js).
  if (e.bar) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = e.bar;
    ctx.beginPath();
    ctx.moveTo(px, py - e.bar * 40);
    ctx.lineTo(px, py + e.bar * 40);
    ctx.stroke();
    ctx.restore();
  }

  if (!entry) return true;

  if (e.sprite_index === 'spr_roaringknight_shift_ol') {
    let xoff = 0;
    let yoff = 0;
    if (e.shudder) {
      xoff = Math.floor(frand(e.frame, 11) * 3) - 1;
      yoff = Math.floor(frand(e.frame, 12) * 3) - 1;
    }
    drawSpriteExt(ctx, entry, e.image_index, e.x - 20 + xoff, e.y + 20 + yoff,
      e.image_xscale, e.image_yscale, 0, null, e.image_alpha ?? 1);
    if (e.whiteout) {
      // The original's gpu fog: a SOLID WHITE copy, not a tint — a white
      // multiply-tint is a no-op on this dark art (gm.js, fogged).
      drawSpriteExt(ctx, entry, e.image_index, e.x - 20 + xoff, e.y + 20 + yoff,
        e.image_xscale, e.image_yscale, 0, c_white, e.whiteout_counter, true);
    }
  } else {
    const bob = Math.sin(e.frame * 0.2) * 2;
    drawSpriteExt(ctx, entry, e.image_index, e.x, e.y + bob,
      e.image_xscale, e.image_yscale, 0, null, e.image_alpha ?? 1);
  }
  return true;
}

// ---------------------------------------------------------------------------
// The scene.

const VIEW_W = 640;
const VIEW_H = 480;

// Offscreen canvases, created lazily (renderer-owned pixels, no sim contact).
let bgCanvas = null;
let swordCanvas = null;
let ghostScratch = null; // per-ghost live copy of the canvas

let crushCanvas = null;
let tintCanvas = null;

/** `make_color_hsv(h, s, v)` — GameMaker's 0..255 ranges, not 0..360. */
function hsvToRgb255(h, sat, val) {
  const H = (h / 255) * 6;
  const S = sat / 255;
  const V = val / 255;
  const i = Math.floor(H) % 6;
  const f = H - Math.floor(H);
  const p = V * (1 - S);
  const q = V * (1 - f * S);
  const t = V * (1 - (1 - f) * S);
  const [r, g, b] = [[V, t, p], [q, V, p], [p, V, t], [p, q, V], [t, p, V], [V, p, q]][i];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function getCanvas(ref, w, h) {
  if (!ref || ref.width !== w || ref.height !== h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    // PIXEL ART, SAME AS THE MAIN CONTEXT. A fresh 2d context defaults to
    // imageSmoothingEnabled = true, so every 2x-scaled sprite drawn into
    // these scratch surfaces was bilinear-filtered — the intro's snow vista
    // and dark fountain rendered FUZZY while the fight's identical backdrop
    // (drawn straight onto the main ctx, which render/canvas.js configures)
    // was crisp. Reported from play as exactly that seam. GameMaker
    // surfaces do not interpolate either, so nearest is also the faithful
    // choice for the ghosts' scaled re-blits.
    c.getContext('2d').imageSmoothingEnabled = false;
    return c;
  }
  return ref;
}

// The snow-zone backdrop — obj_dw_snow_zone_parallax's Draw (the ROOM's own
// vista object; the room itself is a black void with no tile layers — dumped
// via dump_room.csx: room_dw_snow_zone, 2960x480, BGCOLOR black, zero tiles).
// Every anchor below is the original's WORLD coordinate; with camerax() past
// the 1320/860/2100 clamps the whole composition is STATIC in world space,
// so screen = world - camX. The load-bearing beat for this camera: a solid
// black fill from world x 2600 rightward — the void the Knight hovers in.
// The fountain-hills draws sit far left of this camera and never show.
const ROOM_W = 2960;

// scr_draw_sprite_tiled_area: sprite tiled from a phase anchor, clipped to an
// area. Single-frame layers only (index 0 everywhere here).
function tiledArea(g, entry, phaseX, phaseY, x1, y1, x2, y2) {
  const tw = entry.meta.w * 2;
  const th = entry.meta.h * 2;
  let startX = phaseX + Math.ceil((x1 - phaseX) / tw - 1) * tw;
  let startY = phaseY + Math.ceil((y1 - phaseY) / th - 1) * th;
  g.save();
  g.beginPath();
  g.rect(x1, y1, x2 - x1, y2 - y1);
  g.clip();
  for (let y = startY; y < y2; y += th) {
    for (let x = startX; x < x2; x += tw) {
      if (x + tw < 0 || x > VIEW_W || y + th < 0 || y > VIEW_H) continue;
      drawSpriteExt(g, entry, 0, x, y, 2, 2, 0, null, 1);
    }
  }
  g.restore();
}

// Exported: the ending plays in this same room and paints the same vista
// (camera-aware — the world anchors hold under the ending's pans).
export function drawSnowBackdrop(g, camX, fountainSpeed, sprites) {
  g.fillStyle = '#000'; // the room's BGCOLOR
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  const S = (name) => sprites.get(name);
  const cam = camX;
  const fs = fountainSpeed;
  const xo = 1320; // x_offset, clamped (camerax() >= 1320)
  const yo = -10; // y_offset
  const bgH = 480; // layer_1 height * 2

  const l1 = S('spr_dw_snow_zone_bg_parallax_layer_1');
  if (l1) tiledArea(g, l1, xo - cam, yo + 20, xo * 0.9 - cam, yo + 20, xo * 0.9 + ROOM_W + 200 - cam, yo + 20 + bgH);
  const tall = S('spr_dw_fountain_tall');
  if (tall) drawSpriteExt(g, tall, Math.floor(fs) % (tall.meta.frames ?? 6), 2200 - cam, -120, 2, 2, 0, null, 1);
  const l2 = S('spr_dw_snow_zone_bg_parallax_layer_2_test');
  if (l2) tiledArea(g, l2, xo * 0.9 - 40 - cam, yo + 20, xo * 0.9 - cam, yo + 20, xo * 0.9 + ROOM_W + 200 - cam, yo + 20 + bgH);
  const l3 = S('spr_dw_snow_zone_bg_parallax_layer_3_test');
  if (l3) tiledArea(g, l3, xo * 0.6 - cam, yo, xo * 0.6 - cam, yo, xo * 0.6 + ROOM_W + 200 - cam, yo + bgH);
  const l4 = S('spr_dw_snow_zone_bg_parallax_layer_4_test');
  if (l4) tiledArea(g, l4, 40 - cam, yo, 0 - cam, yo, ROOM_W - cam, yo + bgH);
  const l5 = S('spr_dw_snow_zone_bg_parallax_layer_5_test');
  if (l5) tiledArea(g, l5, 0 - cam, yo - 180, 0 - cam, yo - 180, ROOM_W - cam, yo - 180 + bgH);
  const end = S('spr_dw_snow_zone_end');
  if (end) drawSpriteExt(g, end, 0, 1998 - cam, yo - 66, 2, 2, 0, null, 1);
  // The void: black from world 2600 to the far right.
  g.fillStyle = '#000';
  g.fillRect(2600 - cam, 0, VIEW_W - (2600 - cam), VIEW_H);
  const cc = S('spr_cc_fountainbg');
  if (cc) drawSpriteExt(g, cc, Math.floor(fs) % (cc.meta.frames ?? 4), 2370 - cam, 0, 2, 2, 0, null, 1);
}

function drawActor(ctx, sprites, a, camX) {
  const entry = sprites.get(a.sprite);
  if (!entry) return;
  const frames = entry.meta.frames ?? 1;
  drawSpriteExt(ctx, entry, Math.floor(a.index) % frames, a.x - camX, a.y, 2, 2, 0, null, 1);
}

export function drawIntroScene(ctx, sc, sprites) {
  const cam = sc.camX;

  // 1. The backdrop — rendered to an offscreen so the handoff can fade the
  // whole scenery as one layer over the fight's own background underneath.
  // (The vista's fountain glow at x 140 and the battle's column at x 138
  // sit in line, so the cross-fade keeps the fountain in place.)
  bgCanvas = getCanvas(bgCanvas, VIEW_W, VIEW_H);
  const bgCtx = bgCanvas.getContext('2d');
  bgCtx.setTransform(1, 0, 0, 1, 0, 0);
  drawSnowBackdrop(bgCtx, sc.camX, sc.bg.fountain_speed, sprites);
  ctx.save();
  ctx.globalAlpha = Math.max(0, sc.bg.fadeAlpha);
  ctx.drawImage(bgCanvas, 0, 0);
  ctx.restore();

  // 1.5 The entry markers' afterimages (obj_encounterbasic fightcon 1),
  // alpha 0.5 fading at 0.04/frame, behind the markers themselves. With the
  // party's flight covering zero distance in this fight they stack in place
  // under the solid marker, exactly as invisibly as the original's.
  if (sc.flightGhosts) {
    for (const g of sc.flightGhosts) {
      const entry = sprites.get(g.sprite);
      if (!entry) continue;
      const alpha = Math.max(0, 0.5 - (sc.t - g.born) * 0.04);
      if (alpha <= 0) continue;
      const frames = entry.meta.frames ?? 1;
      drawSpriteExt(ctx, entry, g.index % frames, g.x - cam, g.y, 2, 2, 0, null, alpha);
    }
  }

  // 2. The party — depth order is -y (autodepth): higher on screen is
  // further back, so Kris (y 104) paints first and Ralsei (y 190) last.
  drawActor(ctx, sprites, sc.actors.kris, cam);
  drawActor(ctx, sprites, sc.actors.susie, cam);
  drawActor(ctx, sprites, sc.actors.ralsei, cam);

  // 3. The knight, his sword, or the room's marker.
  const k = sc.knight;
  if (sc.marker) {
    const entry = sprites.get('spr_roaringknight_sword_appear_new');
    if (entry) {
      drawSpriteExt(ctx, entry, sc.marker.index, k.x - cam, k.y, 2, 2, 0, null, 1);
    }
  } else if (k.visible) {
    // THE ACTOR'S DRAW ORDER, which a first pass had backwards: the MAIN
    // SPRITE paints first, the sword AFTER — the blade sits OVER him — and
    // grab_hand over both (obj_ch3_PTB02_roaringknight Draw, state 0).
    const entry = sprites.get(k.sprite);
    if (entry) {
      const frames = entry.meta.frames ?? 1;
      drawSpriteExt(ctx, entry, Math.floor(k.index) % frames, k.x - cam, k.y, 2, 2, 0, null, 1);
    }
    if (k.sword_active) {
      const sword = sprites.get('spr_roaringknight_sword');
      if (sword) {
        const sx = k.x - cam;
        const sy = k.y + k.y_base_pos;
        if (k.sword_appear) {
          // Flashing in: alpha sword_alpha + sin(alpha_siner), with the
          // original's below-hand region cut out — draw_rectangle is
          // INCLUSIVE of both corners, so x+34..x+75 is 42 columns; a
          // 41-wide rect left a 2px blade sliver visibly rising from the
          // void below (reported from play as "coming from below").
          const alpha = Math.max(0, Math.min(1,
            k.sword_flash ? k.sword_alpha + Math.sin(k.alpha_siner) : 1));
          swordCanvas = getCanvas(swordCanvas, VIEW_W, VIEW_H);
          const sg = swordCanvas.getContext('2d');
          sg.setTransform(1, 0, 0, 1, 0, 0);
          sg.clearRect(0, 0, VIEW_W, VIEW_H);
          drawSpriteExt(sg, sword, 0, sx, sy, 2, 2, 0, null, 1);
          sg.globalCompositeOperation = 'destination-out';
          sg.fillStyle = '#000';
          sg.fillRect(sx + 34, k.y + 58, 42, VIEW_H);
          sg.globalCompositeOperation = 'source-over';
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.drawImage(swordCanvas, 0, 0);
          ctx.restore();
        } else {
          drawSpriteExt(ctx, sword, 0, sx, sy, 2, 2, 0, null, 1);
        }
      }
    }
    if (k.grab_hand && entry) {
      const hand = sprites.get('spr_roaringknight_sword_grab_hand_new');
      if (hand) {
        drawSpriteExt(ctx, hand, Math.floor(k.index) % (hand.meta.frames ?? 1),
          k.x - cam, k.y, 2, 2, 0, null, 1);
      }
    }
  }

  // 4. The roar fx.
  if (sc.fx && !sc.fx.done) drawIntroFx(ctx, sc.fx, sprites);

  // 5. THE RED LAYER — additive gradient circle, black centre to (r,g,b)
  // edge, over the whole scene.
  if (sc.circle) {
    const c = sc.circle;
    const fx = sc.fx;
    const cx = fx ? fx.x + 128 * 0.42 : k.x - cam;
    const cy = fx ? fx.y + 128 * 0.5 : k.y;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.max(0, Math.min(1, c.alpha));
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, c.size));
    grad.addColorStop(0, 'rgb(0,0,0)');
    grad.addColorStop(1, `rgb(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1, c.size), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 6. THE SCREEN GHOSTS — obj_afterimage_screen's Draw re-copies the LIVE
  // application surface EVERY frame and redraws it scaled and fading: a
  // radial echo of the current frame, never a frozen snapshot (the frozen
  // version smeared stale frames — reported from play as blur). Each ghost
  // in depth order copies the canvas as it stands, so the within-frame
  // feedback compounds exactly like the original's surface chain.
  const anchorX = sc.fx ? sc.fx.x + 128 * 0.42 : VIEW_W / 2;
  const anchorY = sc.fx ? sc.fx.y + 128 * 0.5 : VIEW_H / 2;
  for (const g of sc.ghosts) {
    const age = sc.t - g.born;
    const alpha = 0.5 - age * g.faderate;
    if (alpha <= 0) continue;
    const scale = 1 + age * 0.01;
    ghostScratch = getCanvas(ghostScratch, VIEW_W, VIEW_H);
    const gg = ghostScratch.getContext('2d');
    gg.clearRect(0, 0, VIEW_W, VIEW_H);
    gg.drawImage(ctx.canvas, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(anchorX, anchorY);
    ctx.scale(scale, scale);
    ctx.drawImage(ghostScratch, -anchorX, -anchorY);
    ctx.restore();
  }
}
