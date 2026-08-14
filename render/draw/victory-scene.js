// Drawing the ending — the true win cutscene's Draw events, composited from
// sim/victory-scene.js state. Sources cited there; this file only paints.
//
// Layering, per the original's depths: the snow vista (the room), the shard
// and its shine (scr_depth — y-sorted with the actors), the actors in -y
// order, the Knight (with his warp jolts and static ghosts), the clash fx
// pair, the whiteall fill (white at the start, BLACK for the cuts, depth
// -110 — over the actors), the slash streak (depth -120 — over the fill),
// the clash flash, the SWOON writers (spr_battlemsg frame 13, c_red, the
// dmgwriter's stretch-in), and the dialogue box.
//
// The big_shake is obj_shake moving the CAMERA (shakex 10, speed 2): drawn
// here as a whole-frame jitter seeded by the sim frame (the 30Hz rule).

import { drawSpriteExt } from './gm.js';
import { drawSnowBackdrop } from './intro-fx.js';
import { loadFont, drawText } from '../font.js';
import { formatWriter, revealed } from '../../sim/dialogue.js';
import { VICTORY_LINES } from '../../sim/victory-scene.js';

const VIEW_W = 640;
const VIEW_H = 480;

function srand(frame, salt) {
  let t = (frame * 374761393 + salt * 668265263) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function drawActor(ctx, sprites, a, cam) {
  if (!a.visible) return;
  const entry = sprites.get(a.sprite);
  if (!entry) return;
  const frames = entry.meta.frames ?? 1;
  const index = Math.floor(a.index) % frames;
  const sx = a.x - cam;
  if (a.flip) {
    ctx.save();
    ctx.translate(sx, a.y);
    ctx.scale(-1, 1);
    drawSpriteExt(ctx, entry, index, 0, 0, 2, 2, 0, null, 1);
    ctx.restore();
  } else {
    drawSpriteExt(ctx, entry, index, sx, a.y, 2, 2, 0, null, 1);
  }
}

export function drawVictoryScene(ctx, sc, sprites) {
  const shakeJitter = sc.bigShake > 0
    ? [Math.floor(srand(sc.t, 51) * 21) - 10, Math.floor(srand(sc.t, 52) * 9) - 4]
    : [0, 0];
  ctx.save();
  ctx.translate(shakeJitter[0], shakeJitter[1]);
  const cam = Math.round(sc.camX);

  // 1. The room.
  drawSnowBackdrop(ctx, cam, sc.bg.fountain_speed, sprites);

  // 2. The shard and its shine.
  if (sc.shard) {
    const s = sc.shard;
    const piece = sprites.get('spr_roaringknight_sword_break_piece_small');
    if (piece) {
      drawSpriteExt(ctx, piece, 0, s.x - cam, s.y, 2, 2, s.angle, null, 1);
    }
    if (s.shine) {
      const shine = sprites.get('spr_shine_white');
      if (shine) {
        const frames = shine.meta.frames ?? 4;
        drawSpriteExt(ctx, shine, Math.floor(sc.t * 0.1) % frames,
          s.x - 4 - cam, s.y - 4, 2, 2, 0, null, 1);
      }
    }
  }

  // 3. The actors, -y depth order (higher paints first).
  const order = Object.values(sc.actors).sort((a, b) => a.y - b.y);
  for (const a of order) drawActor(ctx, sprites, a, cam);

  // 4. The Knight — hover, warp jolts, static ghosts, the clash composites.
  const k = sc.knight;
  if (k.visible) {
    const entry = sprites.get(k.sprite);
    if (entry) {
      const frames = entry.meta.frames ?? 1;
      const index = Math.min(Math.floor(k.index), frames - 1);
      let ox = k.jolt[0];
      let oy = k.jolt[1];
      if (k.shake > 0) {
        ox += Math.floor(srand(sc.t, 61) * (k.shake * 2 + 1)) - k.shake;
        oy += Math.floor(srand(sc.t, 62) * (k.shake * 2 + 1)) - k.shake;
      }
      // state 3's afterimages: two ghost copies drifting off, every other
      // frame while the static loops.
      if (sc.knightStatic) {
        for (let g = 1; g <= 2; g++) {
          const gf = sc.t - g * 2;
          const gx = (srand(gf, 63) - 0.5) * 24;
          const gy = (srand(gf, 64) - 0.5) * 24;
          drawSpriteExt(ctx, entry, index, k.x - cam + gx, k.y + gy,
            2, 2, 0, null, 0.3 / g);
        }
      }
      drawSpriteExt(ctx, entry, index, k.x - cam + ox, k.y + oy, 2, 2, 0, null, 1);
    }
  }

  // 5. The clash fx pair — spr_fx_hitback, index lerping 0 -> 4 over life.
  const hitback = sprites.get('spr_fx_hitback');
  if (hitback) {
    for (const f of sc.hitFx) {
      const age = sc.t - f.born;
      const index = Math.min(4, Math.floor((age / f.life) * 5));
      const alpha = f.alpha * (f.alpha < 1 ? 1 - age / f.life : 1);
      drawSpriteExt(ctx, hitback, index, f.x - cam, f.y, 2, 2, 0, null,
        Math.max(0, alpha));
    }
  }

  ctx.restore(); // the shake does not move the overlays

  // 6. The whiteall fill — white at the start, black for the cuts.
  if (sc.white.visible && sc.white.alpha > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, sc.white.alpha);
    ctx.fillStyle = sc.white.black ? '#000' : '#fff';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  // 7. The slash streak, over the black.
  if (sc.slash.visible) {
    const streak = sprites.get('spr_roaringknight_slash_white_horizontal');
    if (streak) {
      drawSpriteExt(ctx, streak, 0, sc.slash.x - cam, sc.slash.y, 2, 2, 0, null, 1);
    } else {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, sc.slash.y - 4, VIEW_W, 8);
    }
  }

  // 8. The clash flash — show_clash_overlay: alpha 0 -> peak over 8 "out",
  // then back down over 8.
  if (sc.flash) {
    const f = sc.flash;
    const t = f.t <= 8 ? f.t / 8 : Math.max(0, 1 - (f.t - 10) / 8);
    const eased = 1 - (1 - t) * (1 - t);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, eased * f.peak));
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.restore();
  }

  // 9. The SWOON writers — spr_battlemsg frame 13 in red, the dmgwriter's
  // stretch-in approximated over its first 8 frames.
  const msg = sprites.get('spr_battlemsg');
  if (msg) {
    for (const s of sc.swoons) {
      const age = sc.t - s.born;
      // The writer's pop-in, simplified to a vertical unsquash over 8 frames;
      // it holds ~2s then fades out (the original's stretch/kill pair drives
      // scales and fade through its bounce cycle).
      if (age > 90) continue;
      const stretch = Math.min(2, (age / 8) * 2);
      const alpha = age < 60 ? 1 : 1 - (age - 60) / 30;
      drawSpriteExt(ctx, msg, 13, s.x - cam + 30, s.y, 2, stretch, 0,
        [255, 0, 0], alpha);
    }
  }

  // 10. Dialogue — the typer-81 chatbox, same metrics as the fight's talk.
  if (sc.dialogue) {
    const font = loadFont('../assets/fonts', 'fnt_dotumche');
    if (font?.ready) {
      const line = VICTORY_LINES[sc.dialogue.line];
      const lines = revealed(formatWriter(line.text, 33), sc.dialogue.timer, 1);
      drawText(ctx, font, line.speaker === 'susie' ? 'SUSIE' : 'RALSEI',
        40, 318, { color: 'rgb(160,160,170)', xscale: 0.7, yscale: 0.7 });
      for (let i = 0; i < lines.length; i++) {
        drawText(ctx, font, lines[i], 40, 340 + i * 20, { color: 'rgb(255,255,255)', advance: 9 });
      }
    }
  }
}
