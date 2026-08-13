// THE BATTLE CHATBOX and the speech balloons.
//
// The chatbox is the band the button row occupies between turns —
// `obj_writer` types into the same 640x60ish strip the menu uses, which is why
// the menu and the text never appear together.
//
// TYPED, NOT SHOWN. `global.typer = 81` and the writer reveals a character at
// a time. A block of text appearing whole reads as a subtitle; revealed at
// ~2 characters a frame it reads as someone speaking, and the pacing is most
// of what makes a DELTARUNE conversation feel like one.
//
// `&` is the line break, so a message is up to three short lines rather than
// one wrapped paragraph — the balloons are sized for exactly that.

import { drawSpriteExt, rgb, c_white } from './draw/gm.js';
import { loadFont, drawText, textWidth, textHeight } from './font.js';
// The typing logic is PURE and lives in sim/ — the turn loop needs it too.
import { revealed, dialogueDone } from '../sim/dialogue.js';


const DIM = [160, 160, 170];


/**
 * The chatbox, drawn over the band where the button row sits.
 *
 * Positioned at the band's own top (480 - bp = 328) rather than at an invented
 * offset, so it lands exactly where the menu it replaces does.
 */
export function drawDialogue(ctx, state, sprites) {
  const dlg = state.dialogue;
  if (!dlg?.text) return;
  const font = loadFont();
  if (!font?.ready) return;

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const lines = revealed(dlg.text, dlg.timer);
  const lh = textHeight(font) || 26;
  const top = 340;

  // The speaker's face colour tints nothing — DELTARUNE draws the text plain
  // white and identifies the speaker by the portrait, which this build does
  // not have. The name is drawn instead of inventing a tint.
  if (dlg.speaker) {
    drawText(ctx, font, dlg.speaker === 'susie' ? 'SUSIE' : 'THE KNIGHT', 40, top - 22,
      { color: rgb(DIM), xscale: 0.7, yscale: 0.7 });
  }

  for (let i = 0; i < lines.length; i++) {
    drawText(ctx, font, lines[i], 40, top + i * lh, { color: rgb(c_white) });
  }

  // The prompt only appears once the line has finished typing — pressing
  // through mid-sentence is allowed, but advertising it before then would
  // teach players to skip everything.
  if (dialogueDone(dlg.text, dlg.timer)) {
    const t = 'C';
    drawText(ctx, font, t, 600 - textWidth(font, t), top + 2 * lh,
      { color: rgb(DIM), xscale: 0.7, yscale: 0.7 });
  }
  ctx.restore();
}
