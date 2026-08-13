// obj_bgfountaintest — THE KNIGHT FIGHT'S BACKGROUND.
//
// `obj_knight_enemy`'s Create destroys `obj_battleback` and puts this in its
// place, so the whole fight is played against the dark fountain rather than
// the flat black this build had been drawing.
//
// THE ONE THING THAT MAKES IT MORE THAN WALLPAPER is `battleprog`, which is
// read straight off the Knight's HP every frame:
//
//     battleprog = 1 - (((monsterhp - maxhp * 0.8) / maxhp) * 5);
//
// At 7300/7300 that is 0; at **5840** — exactly `maxhp * 0.8` — it is 1, and
// it keeps climbing past 1 below that. So the fountain BRIGHTENS AND SPEEDS UP
// as you damage the Knight, and it is fully lit at the moment phase 4 opens.
// The background is the fight's health bar, which matters in a fight whose
// enemy HP is displayed as "???".
//
// It is also independent corroboration of the phase-4 gate: 5840 had been
// carried as a spec number with no dump source, and this formula pivots on it.
//
// `oceanspeed` doubles once `battleprog > 0.65` — the water visibly quickens
// in the last third before phase 4.
//
// `alphafactor` lerps 0 -> 1 over 120 frames at Create (`scr_lerpvar`), so the
// background FADES IN over four seconds rather than appearing. Skipping that
// makes the fight open with a hard cut.
//
// Layer order, and every one of them is load-bearing:
//
//   1. two tiled `spr_bg_fountain1` sheets, c_purple, scrolling in opposite
//      diagonals at different rates — the parallax that reads as depth
//   2. `spr_bg_knight_gradient` twice: once MIRRORED (xscale -2) off the right
//      edge, once at the left at yscale 2.05, both c_black
//   3. a 720x90 black bar across the top
//   4. a 240x90 dark panel behind the fountain column
//   5. `spr_cc_fountainbg_white` five times — four ghosts swaying on two
//      different sine periods at i/12 alpha, then one solid copy
//   6. two more black masks (a 40px left gutter, a 20px strip above)
//
// The ghosts are what make the fountain look like it is flowing: they use
// `sin(siner / 20)` and `sin(siner / 13)`, deliberately coprime periods, so the
// two sets never line up and the column never looks like it is pulsing.

import { drawSpriteExt, rgb, mergeColor, c_black } from './draw/gm.js';
import { KNIGHT_MAXHP } from '../sim/knight.js';

const c_purple = [128, 0, 128];
/** `#27293F` — a GML `#RRGGBB` literal is RGB order, not the packed BGR. */
const BASE_BLEND = [0x27, 0x29, 0x3f];

/** `make_color_hsv(h, s, v)` with GameMaker's 0-255 ranges, not 0-360/0-1. */
function hsv255(h, s, v) {
  const hh = ((h % 256) + 256) % 256;
  const i = Math.floor((hh / 256) * 6) % 6;
  const f = ((hh / 256) * 6) - Math.floor((hh / 256) * 6);
  const sv = s / 255;
  const vv = v;
  const p = vv * (1 - sv);
  const q = vv * (1 - sv * f);
  const t = vv * (1 - sv * (1 - f));
  const rgbv = [[vv, t, p], [q, vv, p], [p, vv, t], [p, q, vv], [t, p, vv], [vv, p, q]][i];
  return rgbv.map((x) => Math.max(0, Math.min(255, Math.round(x))));
}

// NO RENDERER-LOCAL COUNTERS HERE, deliberately.
//
// `siner++` per Draw and a 120-frame `alphafactor` ramp are what the object
// does, and modelling them as renderer state is the mistake CLAUDE.md already
// records under "renderer state must not depend on which frames were PAINTED":
// `?frames=N` fast-forwards the sim WITHOUT rendering, so a counter that ticks
// per draw call is at 2 when the sim is at 200. The background opened black
// and un-faded on every fast-forwarded screenshot.
//
// Both are pure functions of the frame the sim is on, so derive them.

/** `draw_sprite_tiled_ext` — repeat to fill the view from an arbitrary offset. */
function tiled(ctx, img, ox, oy, xs, ys, color, alpha, w, h) {
  const tw = img.width * xs;
  const th = img.height * ys;
  if (tw <= 0 || th <= 0) return;
  let sx = ox % tw;
  if (sx > 0) sx -= tw;
  let sy = oy % th;
  if (sy > 0) sy -= th;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  for (let x = sx; x < w; x += tw) {
    for (let y = sy; y < h; y += th) {
      ctx.drawImage(tint(img, color), x, y, tw, th);
    }
  }
  ctx.restore();
}

const tintCache = new Map();
function tint(img, color) {
  const key = `${img.src}|${color}`;
  let c = tintCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = rgb(color);
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  tintCache.set(key, c);
  return c;
}

/** `draw_sprite_ext(spr_pxwhite, ...)` — a 1x1 pixel scaled into a rectangle. */
function bar(ctx, x, y, w, h, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.fillStyle = rgb(color);
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

export function drawBackground(ctx, state, sprites) {
  const fountain = sprites.get('spr_bg_fountain1');
  const gradient = sprites.get('spr_bg_knight_gradient');
  const column = sprites.get('spr_cc_fountainbg_white');
  // No art: leave the canvas as the caller cleared it. A half-drawn background
  // is worse than none, and the fallback-to-masks rule does not apply to
  // wallpaper.
  if (!fountain?.frames[0] || !column?.frames.length) return;

  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  const frame = state.frame ?? 0;
  // `scr_lerpvar("alphafactor", 0, 1, 120)` — a linear ramp over 120 frames
  // from the object's Create, which is the Knight's Create, which is frame 0.
  const af = Math.min(1, frame / 120);

  // THE FIGHT'S PROGRESS, off the Knight's HP. `maxhp * 0.8` is 5840.
  const hp = state.knight?.hp ?? KNIGHT_MAXHP;
  const battleprog = 1 - ((hp - KNIGHT_MAXHP * 0.8) / KNIGHT_MAXHP) * 5;
  const oceanspeed = battleprog > 0.65 ? 2 : 1;

  const shakex = state.shakeX ?? 0;
  const shakey = state.shakeY ?? 0;
  const s = frame;

  // `make_color_hsv(127.5 + sin(siner / 90) * 127.5, 255, 255)` — a full hue
  // sweep every ~565 frames, which is most of a phase.
  const desicolor = hsv255(127.5 + (Math.sin(s / 90) * 255) / 2, 255, 255);

  // 1. The two parallax sheets. Opposite diagonals, different rates.
  tiled(ctx, fountain.frames[0], shakex - s * oceanspeed, shakey + s * oceanspeed,
    2, 2, c_purple, 0.5 * af * (battleprog + 0.3), W, H);
  tiled(ctx, fountain.frames[0], shakex - (s * oceanspeed) / 2, shakey - (s * oceanspeed) / 2,
    2, 2, c_purple, 0.35 * af * (battleprog + 0.2), W, H);

  // 2. The gradients. The right-hand one is MIRRORED — `xscale -2` — and
  // anchored past the view's right edge, so it bleeds in from off screen.
  if (gradient?.frames[0]) {
    drawSpriteExt(ctx, gradient, 0, shakex + W + 640, shakey + 90, -2, 2, 0, c_black, af);
    drawSpriteExt(ctx, gradient, 0, shakex, shakey + 90, 2, 2.05, 0, c_black, af);
  }

  // 3. The top bar.
  bar(ctx, shakex - 40, shakey, 720, 90, c_black, 1);

  // 4/5. The column, tinted from #27293F toward the cycling hue as the fight
  // progresses — so the fountain literally changes colour as the Knight weakens.
  const blend = mergeColor(BASE_BLEND, desicolor, Math.max(0, Math.min(1, battleprog / 2)));
  bar(ctx, shakex + 138 + 50, shakey, 240, 90, mergeColor(blend, c_black, 0.8), af);

  const sub = Math.floor(s / 10) % column.frames.length;
  for (let i = 1; i < 3; i++) {
    drawSpriteExt(ctx, column, sub,
      shakex + 138 - Math.sin(s / 20) * (i * 12), shakey, 2, 2, 0, blend, (i / 12) * af);
    drawSpriteExt(ctx, column, sub,
      shakex + 138 + Math.sin(s / 13) * (i * 6), shakey, 2, 2, 0, blend, (i / 12) * af);
  }
  drawSpriteExt(ctx, column, sub, shakex + 138, shakey, 2, 2, 0, blend, 1);

  // 6. The gutters, drawn LAST so they cut the column off cleanly.
  bar(ctx, shakex - 40, shakey, 40, 480, c_black, 1);
  bar(ctx, shakex - 40, shakey - 20, 720, 20, c_black, 1);
}
