// THE SPEECH BALLOON — the Susie/Knight enemy-talk exchange, drawn the way
// the fight draws it (issue #1: the bottom chatbox read as the game
// buffering; the real exchange is a balloon over the party's side).
//
// From obj_knight_enemy's talk block:
//
//     global.typer = 75;
//     scr_enemyblcon(obj_herosusie.x + 92, obj_herosusie.y + 38, 14);
//
// and scr_enemyblcon's case 14: obj_battleblcon with spr_battleblcon_long,
// auto_length = 1, side = -1. The auto-length balloon's Draw builds the body
// out of TWO WHITE RECTANGLES (the plus-union is the rounded corner) sized
// from the writer's text:
//
//     balloonwidth  = stringmax * hspace + 10        (longest line * 9)
//     balloonheight = (linecount + 1) * vspace + 5   (lines * 20 + 5)
//     side -1: xoffset 20; writing starts AT the anchor, centred vertically
//     tail: spr_battleblcon_parts frame 4 at (x - 20, y), xscale -1,
//           yscale 0.5 when balloonheight < 40
//
// TYPER 75: fnt_dotumche, c_black, charline 33, advance 9, vspace 20 —
// BLACK text on the white balloon. Both beats of the exchange (the line and
// the reply) present at the same anchor, as the block stages them.
//
// LABELLED: the writer's voice blips (snd_txtsus) are not cued.

import { drawSpriteExt } from './draw/gm.js';
import { loadFont, drawText } from './font.js';
import { revealed, formatWriter } from '../sim/dialogue.js';
import { PARTY } from '../sim/actors.js';

const HSPACE = 9;
const VSPACE = 20;

/**
 * THE BALLOON'S GEOMETRY, as a pure function of the text.
 *
 * Lifted out of the drawer so it can be ASSERTED. The stub canvas the render
 * suites use loads no font, and drawDialogue returns early on `!font.ready` —
 * so a draw-call probe cannot tell a correct balloon from a broken one, which
 * is how a 20px height error survived two reports from play and one wrong
 * fix. This is the arithmetic; tools/verify-balloon.mjs checks it.
 */
export function balloonGeometry(text) {
  const ax = PARTY[1].x + 92;
  const ay = PARTY[1].y + 38;
  // formatWriter returns the wrapped STRING; the balloon sizes off its
  // fully-revealed line set (`&` breaks — the writer's own line separator).
  const formatted = formatWriter(text, 33);
  const lines = revealed(formatted, 1e9);
  const stringmax = Math.max(...lines.map((l) => l.length));
  const bw = stringmax * HSPACE + 10;
  // `balloonheight = ((linecount + 1) * vspace) + 5` — obj_battleblcon's Draw,
  // line 37.
  //
  // `linecount` IS THE NUMBER OF LINE BREAKS, NOT THE NUMBER OF LINES, and
  // that one word is the whole of this bug. obj_writer's Other_15 sets
  // `linecount = 0` at :7 and does `linecount += 1` at :164, :199 and :212 —
  // every one of them at a BREAK: the `&` branch, and the two word-wrap
  // branches. A three-line string has two breaks, so the writer hands the
  // balloon `linecount == 2` and `(linecount + 1) * vspace` is already
  // THREE line-heights.
  //
  // So `fullLines.length` IS `linecount + 1`, and the `+ 1` this line used to
  // carry made every balloon a whole 20px too tall. Because `writingy` is
  // `initwritingy - balloonheight / 2`, half of that extra height went above
  // the anchor and half below, which put the text 10px HIGH inside a box 20px
  // too deep: measured on the three-line "Didn't... think&we'd still be&
  // standing, did you?", the glyph rows sat 12px below the body's top edge
  // and 31px above its bottom. That lopsidedness is what reads from play as
  // the text being wrong in the box, and it is why the earlier reading —
  // that the balloon was 20px SHORT and clipping the last line — pointed the
  // fix in exactly the wrong direction. Nothing was ever clipped; the last
  // line always had 30-odd rows of white under it.
  //
  // With the `+ 1` gone the same balloon measures 12px of white above the
  // first glyph row and 11 below the last, which is the centring the GML's
  // own `- balloonheight / 2` is asking for.
  const bh = lines.length * VSPACE + 5;
  const writingX = ax + 5;
  // `writingy = initwritingy - (balloonheight / 2)`, and balloonheight is
  // `lines * 20 + 5` — always ODD, so this lands on a HALF PIXEL.
  //
  // GameMaker rasterises a filled rectangle onto whole pixels; a canvas
  // fillRect at x.5 blends its edge rows instead, so the balloon's top and
  // bottom rows came out half-strength grey against the background —
  // reported from play as the balloon looking cut off at the bottom pixel.
  // Flooring here matches the rasteriser rather than the arithmetic; the
  // TEXT keeps the exact value, because that is a sprite blit and the game
  // positions those at the unrounded coordinate.
  const writingY = ay + 3 - bh / 2;
  const boxY = Math.floor(writingY);
  return {
    ax, ay, formatted, lines, bw, bh, writingX, writingY, boxY,
    // `if (balloonheight < 40) blconscale = 0.5` — obj_battleblcon Draw:109.
    tailScale: bh < 40 ? 0.5 : 1,
  };
}

export function drawDialogue(ctx, state, sprites) {
  const dlg = state.dialogue;
  if (!dlg?.text) return;
  const font = loadFont('../assets/fonts', 'fnt_dotumche');
  if (!font?.ready) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // The anchor (obj_herosusie + (92, 38)) and every measurement taken from
  // it now come from balloonGeometry above, which is the asserted copy.
  const g = balloonGeometry(dlg.text);
  const { ax, ay, formatted, bw, bh, writingX, writingY, boxY, tailScale } = g;

  // The body: the two-rectangle union (draw_rectangle is inclusive; +1).
  ctx.fillStyle = '#fff';
  ctx.fillRect(writingX - 10, boxY - 5, bw + 11, bh + 1);
  ctx.fillRect(writingX - 5, boxY - 10, bw + 1, bh + 11);

  // The tail, mirrored toward the speaker (side -1), half-height for a
  // short balloon.
  const parts = sprites.get('spr_battleblcon_parts');
  if (parts) {
    ctx.save();
    ctx.translate(ax - 20, ay);
    ctx.scale(-1, tailScale);
    drawSpriteExt(ctx, parts, 4, 0, 0, 1, 1, 0, null, 1);
    ctx.restore();
  }

  // The text — black, revealed at the writer's rate, one row per line.
  const lines = revealed(formatted, dlg.timer);
  for (let i = 0; i < lines.length; i++) {
    drawText(ctx, font, lines[i], writingX, writingY + i * VSPACE, {
      color: 'rgb(0,0,0)', advance: HSPACE,
    });
  }
  ctx.restore();
}
