// obj_attackpress's Draw — the FIGHT bar.
//
// The whole thing is drawn from `(xx + 2, yy + 365)`, view-relative, so in a
// 640x480 room the three rows sit at y 365, 403 and 441.
//
// ONE ROW, left to right:
//
//     spr_pressfront      75x38 at x+0    the character's plate, frame char-1
//     spr_pressfront_b    75x38 at x+0    the button hint laid over it
//     spr_pressspot       10x38 at x+80   the target line, frame char-1
//     the trough                x+78..x+200, 36 tall, drawn as TWO outlines
//
// `x + 80 + (15 * boltspeed)` is where the trough ends: 15 is the scoring
// window's early edge and boltspeed is 8, so the box is exactly as wide as the
// window is long. A bolt entering the right edge of the trough is a bolt
// entering the window. That is not decoration — it is the readout.
//
// TWO NESTED OUTLINES, insets 1 and 2, not one thick one: `draw_rectangle(...,
// true)` is a 1px outline, and the second is drawn at (x+79, y+2) to
// (x+199, y+35). The gap between them is what makes the trough look recessed.
//
// THE ROW COLOUR IS THE CHARACTER'S, and it flashes white on a press:
// `merge_color(c_blue, c_white, pressbuffer / 5)` with pressbuffer set to 5 and
// decremented each frame, so the flash is a five-frame ramp back down. The
// buffer is indexed by CHARACTER ID (1 Kris, 2 Susie, 3 Ralsei, 4 Noelle) — in
// one-button mode every entry is set at once, so all three rows flash together.
//
// BOLTS FADE AS THEY OVERSHOOT: `boltalpha = 1 + (close / 3)` once close < 0,
// hitting zero at close = -3 while the bolt itself survives to -5. So a bolt
// is invisible for its last two scoreable frames — you cannot see the late
// edge of the window, only feel it.
//
// The navy separator between rows spans x+77 to x+300, well past the trough's
// right edge at x+200. It is a filled 1px rectangle, and it is drawn for rows
// 1 and 2 only — never above the first row.

import { drawSpriteExt, mergeColor, rgb, c_white } from './draw/gm.js';
import { BOLT_SPEED, ROW_PITCH, BAR_X, BAR_Y } from '../sim/fightbar.js';
import { HPCOLOR, charIdForSlot } from '../sim/menu.js';

// GameMaker colour constants are BGR-packed, so these are the RGB triples they
// actually name — c_purple is 0x800080 read back-to-front, which happens to be
// symmetric, but c_yellow (0x00FFFF) is not and would come out cyan if the
// packing were ignored.
const c_navy = [0, 0, 128];
const c_blue = [0, 0, 255];
const c_purple = [128, 0, 128];
const c_green = [0, 128, 0];
const c_yellow = [255, 255, 0];
const c_aqua = [0, 255, 255];
const c_fuchsia = [255, 0, 255];
const c_lime = [0, 255, 0];

/**
 * `charcolor[0..2]` from obj_attackpress's Create — and it really is THREE
 * long and indexed by SLOT, unlike everything else on this screen:
 *
 *     charcolor[0] = 16776960;   // 0xFFFF00 BGR = RGB(0,255,255)   c_aqua
 *     charcolor[1] = 16711935;   // 0xFF00FF BGR = RGB(255,0,255)   c_fuchsia
 *     charcolor[2] = 65280;      // 0x00FF00 BGR = RGB(0,255,0)     c_lime
 *       — gml_Object_obj_attackpress_Create_0.gml:66-68
 *
 * and `scr_boltcheck(arg0)` reads `charcolor[arg0]` / `boltcolor[arg0]` with
 * `arg0` the SLOT it was called with (scr_boltcheck.gml:53, and the three
 * call sites at obj_attackpress_Draw_0.gml:150/154/158). So a burst ring on
 * slot 1 is fuchsia whoever is standing there — in the real game, for Noelle
 * too. ORIGINAL BEHAVIOUR: the array is short and slot-keyed while the ROW is
 * character-keyed, and the two disagree the moment the party is not [1,2,3].
 * Do not "fix" it into a fourth entry.
 *
 * The three values are HPCOLOR's first three, so they are DERIVED from it
 * rather than typed a second time — sim/menu.js is the one colour table.
 */
const CHARCOLOR = HPCOLOR.slice(0, 3);
/**
 * `boltcolor[i] = merge_color(<the same three>, c_white, 0.5)` —
 * gml_Object_obj_attackpress_Create_0.gml:73-75. Slot-keyed like its source.
 */
const BOLTCOLOR = CHARCOLOR.map((c) => mergeColor(c, c_white, 0.5));
/**
 * The ROW's colour, by CHARACTER id — four inline `if (j == n)` branches in
 * the Draw rather than an array (obj_attackpress_Draw_0.gml:48-78), and a
 * different palette from `hpcolor` entirely: blue / purple / green / yellow.
 * Noelle's is `c_yellow`, the same constant her hpcolor row carries.
 */
const ROWCOLOR = [c_blue, c_purple, c_green, c_yellow];
/**
 * The `pressbuffer` index each row's flash reads, by character id.
 *
 * ORIGINAL BUG, preserved: the j == 4 branch merges with `pressbuffer[2]` —
 * SUSIE's — where the other three read their own
 * (obj_attackpress_Draw_0.gml:52, 60, 68, **76**). Noelle's row therefore
 * flashes off Susie's press. It is invisible in the default ONE-BUTTON mode,
 * where `scr_boltcheck_onebutton` sets `pressbuffer[0..3] = 5` together
 * (gml_GlobalScript_scr_boltcheck_onebutton.gml:5-8), and only bites in
 * three-button mode, which `global.flag[13]` leaves off.
 */
const PRESSBUFFER_ROW = [1, 2, 3, 2];

/** `draw_rectangle(x1, y1, x2, y2, true)` — a 1px outline, inclusive corners. */
function outlineRect(ctx, x1, y1, x2, y2, color) {
  ctx.strokeStyle = rgb(color);
  ctx.lineWidth = 1;
  // GameMaker's outline covers the pixels AT the coordinates; a canvas stroke
  // straddles the path. The half-pixel offset puts it back on the pixel grid,
  // without which every line lands as two half-lit rows.
  ctx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1, y2 - y1);
}

export function drawFightBar(ctx, bar, sprites, originX = BAR_X, originY = BAR_Y, state = null) {
  // obj_attackpress's Draw opens with the same guard as the controller's and
  // the tension bar's.
  if (state?.knight?.endCutscene > 0) return;
  if (!bar || !bar.active) return;
  const x = originX;
  const y = originY;
  const anyChar = bar.havechar.some((h) => h === 1);

  const front = sprites.get('spr_pressfront');
  const frontB = sprites.get('spr_pressfront_b');
  const spot = sprites.get('spr_pressspot');
  const attackspot = sprites.get('spr_attackspot');

  ctx.save();
  for (let i = 0; i < 3; i++) {
    const ry = y + ROW_PITCH * i;

    // The separator is drawn whenever ANYONE is fighting — it is not gated on
    // this row having a character, so a party with only Kris still gets the
    // two lines below him.
    if (anyChar && (i === 1 || i === 2)) {
      ctx.fillStyle = rgb(c_navy);
      ctx.fillRect(x + 77, ry, 300 - 77, 1);
    }

    if (bar.havechar[i] !== 1) continue;

    // `j = global.char[i]` — the character ID. It used to be written `i + 1`,
    // true of this fight's fixed [1, 2, 3] and of nothing else: on the mod's
    // Kris+Noelle party, slot 1 is character 4, and `i + 1` painted the row
    // PURPLE and stamped Susie's plate and target line over Noelle. Through
    // the seam it is 4, so the row is c_yellow and the frames are 3.
    const j = charIdForSlot(state, i);
    let color = ROWCOLOR[j - 1] ?? c_navy;
    const pb = bar.pressbuffer[PRESSBUFFER_ROW[j - 1] ?? j] ?? 0;
    if (pb > 0) color = mergeColor(color, c_white, pb / 5);

    outlineRect(ctx, x + 78, ry, x + 80 + 15 * BOLT_SPEED, ry + 36, color);
    outlineRect(ctx, x + 79, ry + 2, x + 80 + 15 * BOLT_SPEED - 1, ry + 35, color);

    if (front) drawSpriteExt(ctx, front, j - 1, x, ry, 1, 1, 0, c_white, 1);
    // `global.flag[13]` picks the hint: frame 0 for one-button, frame i for
    // three-button, where each row shows its own key.
    if (frontB) {
      drawSpriteExt(ctx, frontB, bar.oneButton ? 0 : i, x, ry, 1, 1, 0, c_white, 1);
    }
    if (spot) drawSpriteExt(ctx, spot, j - 1, x + 80, ry, 1, 1, 0, c_white, 1);
  }

  // The afterimage trail goes UNDER the bolts — obj_afterimage is a separate
  // instance at a lower depth, so a bolt is never dimmed by its own trail.
  if (attackspot) {
    for (const a of bar.afterimages) {
      drawSpriteExt(ctx, attackspot, 0, x + a.x, y + a.y, 1, 1, 0, c_white, a.alpha);
    }
    for (const b of bar.bolts) {
      if (!b.alive) continue;
      const close = b.frame - bar.boltx;
      const alpha = close < 0 ? 1 + close / 3 : 1;
      if (alpha <= 0) continue;
      drawSpriteExt(
        ctx, attackspot, 0,
        x + 80 + close * BOLT_SPEED, y + ROW_PITCH * b.char,
        1, 1, 0, c_white, alpha,
      );
    }

    // obj_burstbolt. A critical is yellow; anything from p >= 3 takes the
    // washed-out bolt colour, and p >= 15 the saturated character colour —
    // so the ring's colour reads as the grade of the hit.
    for (const s of bar.bursts) {
      const color = s.critical ? c_yellow : BOLTCOLOR[s.char] ?? c_white;
      drawSpriteExt(
        ctx, attackspot, 0, x + s.x, y + s.y,
        s.xscale, s.yscale, 0, color, Math.max(0, s.alpha),
      );
    }
  }

  // THE BAR DOES NOT VANISH — IT IS PAINTED OUT.
  //
  //     if (fade == 1 || fakefade == 1) {
  //         fadeamt += 0.08;
  //         draw_set_color(c_black);
  //         draw_set_alpha(fadeamt);
  //         draw_rectangle(x - 1, y, x + 640, y + 300, false);
  //         draw_set_alpha(1);
  //         if (fade == 1 && fadeamt > 1) instance_destroy();
  //     }
  //
  // A black rectangle over the whole bar area, growing opaque at 0.08 a frame
  // — about 13 frames — and only then is the object destroyed. Without it the
  // bar sits fully lit through the post-attack hold and then disappears
  // abruptly, which is what "the attack bar stays and looks weird after you
  // attack" describes.
  //
  // The rectangle is 640 wide and 300 tall from the bar's own origin, so it
  // covers the rows and everything drawn among them, not just the track.
  if (bar.fade) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, bar.fadeamt ?? 0)})`;
    ctx.fillRect(x - 1, y, 641, 300);
  }

  ctx.restore();
}
