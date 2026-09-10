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

import { rgb, tinted } from './draw/gm.js';
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

/**
 * THE SKIN SEAM — `state.tensionBar`, and it is INERT when nothing sets it.
 *
 * obj_tensionbar's Draw is one event whose sprite pair, TP logo, readout
 * offset and trailing pair are all VARIABLES in some builds of the game and
 * literals in v1.05. A scene that drives them (a mod recreation whose Draw
 * swaps `spr_tensionbar` for a sheared one, suppresses the logo, drops the
 * readout 32px and clamps the pair to its own ceiling) publishes them here as
 * plain data on `state`; with the field absent every read below falls back to
 * the v1.05 literal and this file draws exactly what it drew before.
 *
 * The one behavioural fork is `trail`: when a scene supplies its own pair it
 * OWNS the chase — it has already run `apparent`/`current` this frame, in its
 * own Draw slot, so running them again here would advance them twice. The
 * renderer then reads that object and writes nothing to it (`maxed` included,
 * which is why the writeback below is guarded too).
 *
 * `markers` is a flat list of sprite draws to paint OVER the bar, in
 * BAR-LOCAL coordinates — (0, 0) is the bar's own origin, the point this
 * renderer puts at `(barX(frame), 40)`. Local rather than screen because the
 * publisher is sim-side and cannot know the slide-in's position; the two
 * agree exactly once the bar has come to rest, which is the only time
 * anything has ever published one. Each entry is
 * `{sprite, subimage, x, y, xscale, yscale, blend, alpha}` — `draw_sprite_ext`
 * with the manifest origin, which is what the caller's GML issued.
 */
function skinOf(state) {
  return state.tensionBar ?? null;
}

export function drawTensionBar(ctx, state, sprites) {
  // Same guard, and it is on obj_tensionbar's Draw too — the TP bar is part of
  // the battle UI that the ending removes.
  if (state.knight?.endCutscene > 0) return;
  const font = loadFont();
  const skin = skinOf(state);
  // `_bar_sprite` / `_cutout_sprite`: locals in the event, literals here
  // unless a scene names its own pair.
  const entry = sprites.get(skin?.bar ?? 'spr_tensionbar');
  if (!entry || !entry.frames.length) return;
  const bg = entry.frames[Math.min(1, entry.frames.length - 1)];
  // The slide-in, as a pure function of the sim frame (the 30Hz rule).
  const X = barX(state.frame ?? 0);
  const w = bg.width;
  const h = bg.height;
  const tension = state.tension ?? 0;
  const max = 250;

  // THE TRAILING PAIR, and who advances it. A scene that publishes its own
  // has already stepped it this frame (see the seam note above); the module's
  // own copy is stepped here, exactly as before.
  const pair = skin?.trail ?? trail;
  if (!skin?.trail) {
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

  if (pair.current > 0 || pair.apparent > 0) {
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
    const maxed = pair.maxed;
    if (pair.apparent < pair.current) {
      fill(pair.current, RED);
      fill(pair.apparent, ORANGE);
    } else if (pair.apparent > pair.current) {
      fill(pair.apparent, WHITE);
      fill(pair.current, maxed ? MAXED : ORANGE);
    } else {
      fill(pair.current, maxed ? MAXED : ORANGE);
    }
  }
  // THE FOREGROUND GOES OVER THE FILL. `spr_tensionbar` frame 0 is the bar's
  // casing and is drawn AFTER the coloured rectangles, so the fill sits inside
  // it rather than on top of it — then `spr_tensionbar_cutout` is SUBTRACTED,
  // which is what punches the bar's shape out of the block of colour.
  const marker = sprites.get('spr_tensionmarker');
  if (marker && marker.frames[0] && pair.current > 0) {
    ctx.drawImage(marker.frames[0], 3, h - (pair.current / max) * h);
  }
  ctx.drawImage(entry.frames[0], 0, 0);
  const cutout = sprites.get(skin?.cutout ?? 'spr_tensionbar_cutout');
  if (cutout && cutout.frames[0]) {
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(cutout.frames[0], 0, 0);
    ctx.restore();
  }
  // THE SKIN'S OWN OVERLAY, still inside the bar's translate — a flat list of
  // draw_sprite_ext calls in bar-local coordinates (the seam note above). It
  // is drawn AFTER the cutout subtraction because in the game these are
  // separate INSTANCES at `bar.depth - 1`, i.e. in front of the bar, not part
  // of the surface the cutout punches through.
  if (skin?.markers?.length) {
    for (const m of skin.markers) {
      const ent = sprites.get(m.sprite);
      const img = ent?.frames?.[Math.abs(Math.floor(m.subimage ?? 0)) % (ent?.frames?.length || 1)];
      if (!img) continue;
      const alpha = m.alpha ?? 1;
      if (!(alpha > 0)) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.translate(m.x, m.y);
      ctx.scale(m.xscale ?? 1, m.yscale ?? 1);
      ctx.drawImage(m.blend ? tinted(img, m.blend) : img, -(ent.meta?.ox ?? 0), -(ent.meta?.oy ?? 0));
      ctx.restore();
    }
  }
  ctx.restore();

  // ---- the readout, outside the surface -----------------------------------
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // `if (_draw_tptext) draw_sprite(spr_tplogo, ...) else _yoff = 32;` — the
  // logo and the readout offset are one decision, and the seam carries both.
  const yoff = skin?.yoff ?? 0;
  const logo = skin?.tplogo === false ? null : sprites.get('spr_tplogo');
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
  const tamt = Math.floor((pair.apparent / max) * 100);
  // `maxed = 0` is assigned unconditionally before the branch, so it clears
  // every frame the readout is under 100. A scene that owns the pair computes
  // this itself in its own Draw slot, so the writeback is skipped for it —
  // the renderer never writes to a pair it does not own.
  if (!skin?.trail) trail.maxed = false;
  if (tamt < 100) {
    drawText(ctx, font, String(tamt), X - 30, Y + 70 + yoff, { color: '#ffffff' });
    drawText(ctx, font, '%', X - 25, Y + 95 + yoff, { color: '#ffffff' });
  } else {
    // M A X, one letter a line at y+70 / +90 / +110 — and each is 4px FURTHER
    // RIGHT than the last (x-28, x-24, x-20). The stagger is deliberate: the
    // word leans down-right instead of stacking in a column.
    //
    // NO `yoff` HERE, and that is the source's own asymmetry, not an
    // oversight in the seam: the mod adds `+ _yoff` to the two `tamt < 100`
    // lines and to neither of the three MAX lines (obj_tensionbar Draw_0
    // :285-286 against :292-294 in the kaizo dump). A skin that suppresses
    // the logo therefore drops the percentage and leaves MAX where it was.
    if (!skin?.trail) trail.maxed = true;
    drawText(ctx, font, 'M', X - 28, Y + 70, { color: '#ffff00' });
    drawText(ctx, font, 'A', X - 24, Y + 90, { color: '#ffff00' });
    drawText(ctx, font, 'X', X - 20, Y + 110, { color: '#ffff00' });
  }
  ctx.restore();
}
