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
import { loadFont, drawText, styleColors } from './font.js';
import { writerLines } from '../sim/dialogue.js';
import { PARTY } from '../sim/actors.js';

const HSPACE = 9;
const VSPACE = 20;

export function drawDialogue(ctx, state, sprites) {
  const dlg = state.dialogue;
  if (!dlg?.text) return;
  const font = loadFont('../assets/fonts', 'fnt_dotumche');
  if (!font?.ready) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // The anchor: obj_herosusie + (92, 38). Susie's battle position is the
  // sim's PARTY[1].
  const ax = PARTY[1].x + 92;
  const ay = PARTY[1].y + 38;

  // `writerLines` wraps and reveals in one pass, and carries the per-character
  // style the escape codes selected out with the text — see sim/dialogue.js.
  // The balloon sizes off the fully-revealed line set (`&` breaks — the
  // writer's own line separator), so it asks for the same text twice at two
  // different timers rather than measuring what is currently typed.
  const fullLines = writerLines(dlg.text, { charline: 33, timer: 1e9 }).lines;
  const stringmax = Math.max(...fullLines.map((l) => l.length));
  const bw = stringmax * HSPACE + 10;
  // `balloonheight = ((linecount + 1) * vspace) + 5` — obj_battleblcon's Draw,
  // line 37. The +1 IS THE BUG THAT WAS REPORTED: a one-line balloon is two
  // line-heights tall, not one, and using `linecount` left every balloon a
  // whole 20px short. The text is laid out from the TOP, so what goes missing
  // is the bottom — reported twice from play as Susie's dialogue being cut off
  // at the bottom, and the half-pixel fix below (which was also real) only
  // ever addressed the last ROW of it.
  const bh = (fullLines.length + 1) * VSPACE + 5;
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

  // The body: the two-rectangle union (draw_rectangle is inclusive; +1).
  ctx.fillStyle = '#fff';
  ctx.fillRect(writingX - 10, boxY - 5, bw + 11, bh + 1);
  ctx.fillRect(writingX - 5, boxY - 10, bw + 1, bh + 11);

  // The tail, mirrored toward the speaker (side -1), half-height for a
  // short balloon.
  const parts = sprites.get('spr_battleblcon_parts');
  if (parts) {
    const tailScale = bh < 40 ? 0.5 : 1;
    ctx.save();
    ctx.translate(ax - 20, ay);
    ctx.scale(-1, tailScale);
    drawSpriteExt(ctx, parts, 4, 0, 0, 1, 1, 0, null, 1);
    ctx.restore();
  }

  // The text — black, revealed at the writer's rate, one row per line.
  const { lines, styles } = writerLines(dlg.text, { charline: 33, timer: dlg.timer });
  for (let i = 0; i < lines.length; i++) {
    drawText(ctx, font, lines[i], writingX, writingY + i * VSPACE, {
      color: 'rgb(0,0,0)', colors: styleColors(styles[i]), advance: HSPACE,
    });
  }
  ctx.restore();
}
