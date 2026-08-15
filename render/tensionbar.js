// obj_tensionbar's Draw — the TP bar down the left of the screen.
//
// `spr_tensionbar` is 25x196, and the bar is drawn INTO a surface at local
// (0,0) then blitted at the instance's position — `y = yy + 40 + yoffset`,
// with `yoffset` lerping to -90 only for a menu this fight never opens.
//
// THE BAR HAS TWO VALUES CHASING ONE, and that is the whole character of it:
//
//     apparent   tracks global.tension at +/-20 a frame, snapping when within 20
//     current    waits 15 frames, then closes on `apparent` in a CASCADE — the
//                same shape as the charbox slide, +2 then another +2 past 10,
//                +3 past 25, +4 past 50, +5 past 100, snapping inside 3
//
// so a graze throws `apparent` up instantly and `current` crawls after it. The
// gap between them is drawn in a different colour, which is what makes TP look
// like it is being poured in rather than set:
//
//     gaining (apparent > current)   WHITE to apparent, ORANGE to current
//     spending (apparent < current)  RED to current, ORANGE to apparent
//     settled                        ORANGE, or yellow-orange at max
//
// The fill spans x 3..width-1 and grows upward from the bottom.

import { rgb } from './draw/gm.js';
import { drawSpriteText, FONTS } from './text.js';
import { loadFont, drawText } from './font.js';

// THE BAR SLIDES IN. obj_tensionbar's Create puts the instance at
// `x = view_x - 40` with `hspeed = 13, friction = 1` — built-in motion, so
// each frame the speed drops by 1 FIRST and then the move happens (the
// oracle-verified order in sim/index.js). The travel is 12+11+...+1 = 78,
// coming to rest at x = +38 with the TP logo and readout at `x - 30` = 8.
//
// (An earlier note here claimed the instance "sits at x = 0" with the readout
// off-screen, and shifted everything right by 30 to compensate. That was a
// misread of the Create — the slide had not been seen. The real rest position
// is 38, confirmed against reference/flipped_oracle_shot_20.png: bar at ~38,
// "TP" text at ~8.)
function barX(frame) {
  let x = -40;
  let sp = 13;
  for (let i = 0; i < frame; i++) {
    sp -= 1;
    if (sp <= 0) return 38;
    x += sp;
  }
  return x;
}
const Y = 40;

/** GameMaker packs colours BGR: c_orange is 0x0080FF -> RGB(255,128,0). */
const ORANGE = 'rgb(255,128,0)';
const RED = 'rgb(255,0,0)';
const WHITE = 'rgb(255,255,255)';
/** merge_color(c_yellow, c_orange, 0.5) */
const MAXED = 'rgb(255,191,0)';

/** The trailing pair. Renderer-local: obj_tensionbar keeps them on itself. */
const trail = { apparent: 0, current: 0, changetimer: 0, maxed: false };

export function resetTensionBar() {
  trail.apparent = 0;
  trail.current = 0;
  trail.changetimer = 0;
  trail.maxed = false;
}

export function drawTensionBar(ctx, state, sprites) {
  // Same guard, and it is on obj_tensionbar's Draw too — the TP bar is part of
  // the battle UI that the ending removes.
  if (state.knight?.endCutscene > 0) return;
  const font = loadFont();
  const entry = sprites.get('spr_tensionbar');
  if (!entry || !entry.frames.length) return;
  const bg = entry.frames[Math.min(1, entry.frames.length - 1)];
  // The slide-in, as a pure function of the sim frame (the 30Hz rule).
  const X = barX(state.frame ?? 0);
  const w = bg.width;
  const h = bg.height;
  const tension = state.tension ?? 0;
  const max = 250;

  // `apparent` chases the real value hard and snaps once it is close.
  if (Math.abs(trail.apparent - tension) < 20) trail.apparent = tension;
  if (trail.apparent < tension) trail.apparent += 20;
  if (trail.apparent > tension) trail.apparent -= 20;

  // `current` waits, then closes in the cascade.
  if (trail.apparent !== trail.current) {
    trail.changetimer += 1;
    if (trail.changetimer > 15) {
      const d = trail.apparent - trail.current;
      if (d > 0) trail.current += 2;
      if (d > 10) trail.current += 2;
      if (d > 25) trail.current += 3;
      if (d > 50) trail.current += 4;
      if (d > 100) trail.current += 5;
      if (d < 0) trail.current -= 2;
      if (d < -10) trail.current -= 2;
      if (d < -25) trail.current -= 3;
      if (d < -50) trail.current -= 4;
      if (d < -100) trail.current -= 5;
      if (Math.abs(trail.apparent - trail.current) < 3) trail.current = trail.apparent;
    }
  } else {
    trail.changetimer = 0;
  }

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.translate(X, Y);
  ctx.drawImage(bg, 0, 0);

  const fill = (value, style) => {
    const top = h - (value / max) * h;
    ctx.fillStyle = style;
    ctx.fillRect(3, top, w - 1 - 3, h - 1 - top);
  };

  if (trail.current > 0 || trail.apparent > 0) {
    // `maxed` IS ONE FRAME STALE, and deliberately so — the original assigns
    // it at the very BOTTOM of the Draw event, inside the `tamt >= 100`
    // branch, and reads it HERE, near the top. So the fill takes its
    // yellow-orange one frame after the MAX text appears, and keeps it one
    // frame after the text goes.
    //
    // It is also derived from `floor(apparent / maxtension * 100) >= 100`,
    // not from `tension >= maxtension`: it follows the fast trailing value's
    // FLOORED PERCENTAGE. At 249/250 that floor is 99, so the bar is not
    // "maxed" until the readout actually says 100.
    const maxed = trail.maxed;
    if (trail.apparent < trail.current) {
      fill(trail.current, RED);
      fill(trail.apparent, ORANGE);
    } else if (trail.apparent > trail.current) {
      fill(trail.apparent, WHITE);
      fill(trail.current, maxed ? MAXED : ORANGE);
    } else {
      fill(trail.current, maxed ? MAXED : ORANGE);
    }
  }
  // THE FOREGROUND GOES OVER THE FILL. `spr_tensionbar` frame 0 is the bar's
  // casing and is drawn AFTER the coloured rectangles, so the fill sits inside
  // it rather than on top of it — then `spr_tensionbar_cutout` is SUBTRACTED,
  // which is what punches the bar's shape out of the block of colour.
  const marker = sprites.get('spr_tensionmarker');
  if (marker && marker.frames[0] && trail.current > 0) {
    ctx.drawImage(marker.frames[0], 3, h - (trail.current / max) * h);
  }
  ctx.drawImage(entry.frames[0], 0, 0);
  const cutout = sprites.get('spr_tensionbar_cutout');
  if (cutout && cutout.frames[0]) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(cutout.frames[0], 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // ---- the readout, outside the surface -----------------------------------
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const logo = sprites.get('spr_tplogo');
  if (logo && logo.frames[0]) ctx.drawImage(logo.frames[0], X - 30, Y + 30);

  // `tamt = floor((apparent / maxtension) * 100)` — the PERCENTAGE tracks the
  // fast value, so the number moves with the flash rather than the slow fill.
  //
  // DRAWN WITH THE REAL FONT NOW. This used to be a sprite-font number with the
  // "%" faked as a 8x2 bar and MAX as a filled yellow block, because the
  // sprite fonts cover digits only and inventing typography is worse than
  // admitting you have none. `fnt_mainbig` is extracted, so both are real.
  //
  // THE "%" SITS UNDER THE NUMBER, not beside it — (x-30, y+70) then
  // (x-25, y+95). The whole readout is a narrow vertical column beside the
  // bar, which is why it fits in the 30px the logo occupies.
  const tamt = Math.floor((trail.apparent / max) * 100);
  // `maxed = 0` is assigned unconditionally before the branch, so it clears
  // every frame the readout is under 100.
  trail.maxed = false;
  if (tamt < 100) {
    drawText(ctx, font, String(tamt), X - 30, Y + 70, { color: '#ffffff' });
    drawText(ctx, font, '%', X - 25, Y + 95, { color: '#ffffff' });
  } else {
    // M A X, one letter a line at y+70 / +90 / +110 — and each is 4px FURTHER
    // RIGHT than the last (x-28, x-24, x-20). The stagger is deliberate: the
    // word leans down-right instead of stacking in a column.
    trail.maxed = true;
    drawText(ctx, font, 'M', X - 28, Y + 70, { color: '#ffff00' });
    drawText(ctx, font, 'A', X - 24, Y + 90, { color: '#ffff00' });
    drawText(ctx, font, 'X', X - 20, Y + 110, { color: '#ffff00' });
  }
  ctx.restore();
}
