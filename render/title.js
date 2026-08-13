// THE TITLE SCREEN and the GAME OVER screen, both drawn on the canvas with
// the game's own assets rather than as HTML over it.
//
// `fnt_mainbig` for every word, `spr_heart` for the cursor, the dark-fountain
// background underneath. The alternative — CSS text in a web font — cannot
// match a sprite-based pixel font at 2x, and a menu that looks like a web page
// in front of a game that looks like DELTARUNE reads as two different products.
//
// THE PALETTE is the fight's own, not invented: `#27293F` is
// obj_bgfountaintest's `image_blend`, and the highlight yellow is GameMaker's
// `c_yellow`, which is what DELTARUNE's menus use for the selected row.

import { drawSpriteExt, rgb, c_white } from './draw/gm.js';
import { loadFont, drawText, textWidth } from './font.js';
import { MODES } from '../sim/modes.js';

const BG = [0x27, 0x29, 0x3f];
const DIM = [128, 128, 138];
const HILITE = [255, 255, 0];

const W = 640;

/** Centre a line of the real font. */
function centred(ctx, font, text, y, color, scale = 1) {
  const w = textWidth(font, text) * scale;
  drawText(ctx, font, text, (W - w) / 2, y, { color: rgb(color), xscale: scale, yscale: scale });
}

export function drawTitle(ctx, title, sprites, attacks) {
  const font = loadFont();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Only the fountain is behind this — the FIGHT is not drawn at all. Dimming
  // a live battle and putting a menu over it left the party, the HP bars, the
  // TP meter and a stray soul legible through the text, which reads as a pause
  // screen rather than a title.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (!font?.ready) {
    ctx.restore();
    return;
  }

  centred(ctx, font, 'THE ROARING KNIGHT', 60, c_white, 1.6);
  centred(ctx, font, 'practice', 100, DIM);

  const heart = sprites.get('spr_heart');
  const rows = title.pickingAttack
    ? attacks.map((a) => ({ name: a.name.toUpperCase(), blurb: a.where }))
    : MODES.map((m) => ({ name: m.name, blurb: m.blurb }));
  const index = title.pickingAttack ? title.attackIndex : title.index;

  // A four-item list sits comfortably at 34px; the attack roster is longer, so
  // it tightens rather than running off the bottom.
  const pitch = rows.length > 6 ? 26 : 34;
  const top = 170;

  for (let i = 0; i < rows.length; i++) {
    const y = top + i * pitch;
    const on = i === index;
    const x = 190;
    if (on && heart) {
      // The cursor BOBS, as every DELTARUNE menu cursor does.
      const bob = Math.sin(title.siner / 6) * 1.5;
      drawSpriteExt(ctx, heart, 0, x - 30 + bob, y + 4, 1, 1, 0, null, 1);
    }
    drawText(ctx, font, rows[i].name, x, y, { color: rgb(on ? HILITE : c_white) });
  }

  centred(ctx, font, title.pickingAttack
    ? 'Z  choose      X  back'
    : 'arrows  move      Z  choose', 448, DIM, 0.75);
  ctx.restore();
}

/**
 * GAME OVER — `obj_gameover_init`, timer for timer.
 *
 *     scr_gameover()   audio_stop_all; snd_play(snd_hurt1);
 *                      global.screenshot = sprite_create_from_surface(
 *                          application_surface, ...);   // THE MOMENT OF DEATH
 *     timer 30         the screenshot is destroyed; the soul appears at
 *                      (global.heartx, global.hearty)
 *     timer 50         snd_break1; sprite_index = spr_heartbreak; x -= 2
 *     timer 90         snd_break2; six obj_marker shards, each
 *                          direction = random(360), speed = 7,
 *                          gravity_direction = 270, gravity = 0.2,
 *                          sprite_index = spr_heartshards, image_speed = 0.2
 *     timer 140        obj_fadeout
 *
 * THREE THINGS THE FIRST VERSION OF THIS INVENTED, all now taken from the
 * event:
 *
 * 1. **IT FREEZES THE SCREEN, it does not cut to black.** `scr_gameover`
 *    screenshots the application surface at the instant of death and holds it
 *    for 30 frames. Cutting straight to black throws away the moment.
 *
 * 2. **The soul breaks WHERE IT DIED**, at `global.heartx/hearty` — not at
 *    the centre of the screen.
 *
 * 3. **The shards fly at `random(360)`, speed 7, gravity 0.2.** A hand-rolled
 *    symmetric spread reads as a decoration; six pieces thrown in random
 *    directions and pulled down reads as something breaking. The gap between
 *    the crack and the shatter is FORTY frames, not the 24 I guessed — that
 *    beat is most of the feel of it.
 */
export function drawGameOver(ctx, over, sprites) {
  const font = loadFont();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // The frozen screenshot holds for 30 frames, then black.
  if (over.t < 30 && over.shot) {
    ctx.drawImage(over.shot, 0, 0);
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  const brk = sprites.get('spr_heartbreak');
  const shard = sprites.get('spr_heartshards');
  const heart = sprites.get('spr_dodgeheart');

  if (over.t >= 30 && over.t < 90) {
    // Whole until 50, cracked after — and `x -= 2` when it cracks.
    const cracked = over.t >= 50;
    const spr = cracked ? brk : heart;
    if (spr) {
      drawSpriteExt(ctx, spr, 0, over.x - (cracked ? 2 : 0), over.y, 2, 2, 0, null, 1);
    }
  }

  if (over.t >= 90) {
    for (const sh of over.shards) {
      if (!shard) break;
      drawSpriteExt(ctx, shard, Math.floor(sh.index) % shard.frames.length,
        sh.x, sh.y, 2, 2, 0, null, 1);
    }
  }

  // `obj_fadeout` at 140. The prompt rides in on the same beat rather than
  // interrupting the shatter.
  if (over.t >= 140) {
    const a = Math.min(0.85, (over.t - 140) / 40);
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  if (font?.ready && over.t > 155) {
    ctx.globalAlpha = Math.min(1, (over.t - 155) / 25);
    centred(ctx, font, 'try again', 400, c_white);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/**
 * The shard physics, stepped by the driver. `speed = 7` on a random heading
 * with `gravity = 0.2` straight down — GameMaker's own motion, so this is the
 * same decompose/add/recompose the engine's move step does.
 */
export function stepGameOver(over) {
  over.t += 1;
  if (over.t < 90) return;
  for (const sh of over.shards) {
    sh.vy += 0.2;
    sh.x += sh.vx;
    sh.y += sh.vy;
    sh.index += 0.2;
  }
}

/** Six shards on the original's offsets, thrown at random(360), speed 7. */
export function makeShards(x, y, rand) {
  const OFF = [[-2, 0], [0, 3], [2, 6], [8, 0], [10, 3], [12, 6]];
  return OFF.map(([dx, dy]) => {
    const dir = rand() * 360;
    const r = (dir * Math.PI) / 180;
    return {
      x: x + dx * 2,
      y: y + dy * 2,
      vx: Math.cos(r) * 7,
      vy: -Math.sin(r) * 7,
      index: 0,
    };
  });
}
