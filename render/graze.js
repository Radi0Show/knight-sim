// obj_grazebox's Draw — the ring that flashes when a bullet shaves past.
//
// The whole event:
//
//     if (grazetimer > 0) {
//         draw_sprite_ext(sprite_index, 0, x, y, 1, 1, 0, c_white, grazetimer / 6);
//         draw_sprite_ext(sprite_index, 3, x, y, 1, 1, 0, c_white, grazetimer / 6 - 0.2);
//         ...
//     }
//     grazetimer -= 1;
//
// TWO FRAMES OF THE SAME SPRITE, layered, the second 0.2 dimmer — that is what
// gives the flash an edge rather than a flat glow. `grazetimer` is set to 10 on
// a bullet ENTERING the box and floored at 2 while one stays inside, so a clean
// pass flashes bright and fades over ten frames while hugging a bullet holds a
// faint ring the whole time.
//
// The alpha divisor is 6 against a timer that starts at 10, so the first four
// frames are clamped at full — the flash has a flat top and then falls away.
//
// It is drawn at the GRAZE BOX's position, which obj_heart's Create puts at
// `(x + 10, y + 10)`: the soul's centre, not its corner.

import { drawSpriteExt, c_white } from './draw/gm.js';

export function drawGraze(ctx, state, sprites) {
  const t = state.grazeTimer ?? 0;
  if (t <= 0 || !state.soul) return;
  const entry = sprites.get('spr_grazeappear');
  if (!entry || !entry.frames.length) return;

  const x = state.soul.x + 10;
  const y = state.soul.y + 10;
  drawSpriteExt(ctx, entry, 0, x, y, 1, 1, 0, c_white, t / 6);
  if (entry.frames.length > 3) {
    drawSpriteExt(ctx, entry, 3, x, y, 1, 1, 0, c_white, t / 6 - 0.2);
  }

  // THE RIBBON FLASH — the half of the event that was missing:
  //
  //     if (image_xscale > 1) {
  //         draw_sprite_ext(sprite_index, 0, x, y, image_xscale, image_yscale, ...);
  //         draw_sprite_ext(sprite_index, 3, x, y, image_xscale, image_yscale, ...);
  //     }
  //
  // With a graze-area ribbon equipped (PinkRibbon or TwinRibbon, the only
  // things that raise `grazesizefactor`), the whole ring is drawn a SECOND
  // time at the enlarged scale, over the normal one. That outer flash is how
  // the game shows you the bigger window you are being paid TP for — and it
  // is the tell for where the enlarged hitbox actually is.
  const size = state.grazeSize ?? 1;
  if (size > 1) {
    drawSpriteExt(ctx, entry, 0, x, y, size, size, 0, c_white, t / 6);
    if (entry.frames.length > 3) {
      drawSpriteExt(ctx, entry, 3, x, y, size, size, 0, c_white, t / 6 - 0.2);
    }
  }
}
