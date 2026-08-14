// Drawing the post-fight cutscene — the Draw events of the knight actor, the
// beam object and the spear sequence, composited from sim/victory-scene.js
// state. Sources are cited in that file's header; this one only paints.
//
// The beam triangle is the pull_test's Draw verbatim: additive purple,
// alpha 0.6 + sin(timer/3) * 0.1, from the hand to two points off
// camera-left. Its particles are frame-seeded here (Draw-random rule).

import { drawSpriteExt, c_white } from './gm.js';
import { loadFont, drawText } from '../font.js';
import { formatWriter, revealed } from '../../sim/dialogue.js';

function srand(frame, salt) {
  let t = (frame * 374761393 + salt * 668265263) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

function actor(ctx, sprites, a, camX, shake, frame) {
  if (!a.visible) return;
  const entry = sprites.get(a.sprite);
  if (!entry) return;
  let ox = 0;
  if (shake) ox = Math.floor(srand(frame, 31) * 3) - 1;
  drawSpriteExt(ctx, entry, Math.floor(a.index), a.x - camX + ox, a.y, 2, 2, 0, null, 1);
}

export function drawVictoryScene(ctx, sc, sprites) {
  const cam = Math.round(sc.camX) + (sc.shake ? Math.floor(srand(sc.t, 30) * 5) - 2 : 0);
  const k = sc.knight;
  const A = sc.actors;

  // The party and Undyne.
  actor(ctx, sprites, A.ralsei, cam, 0, sc.t);
  actor(ctx, sprites, A.susie, cam, A.susie.shake, sc.t);
  actor(ctx, sprites, A.kris, cam, 0, sc.t);
  actor(ctx, sprites, A.undyne, cam, 0, sc.t);

  // The beam: base sprite + growing hand + the triangle + in-fall particles.
  if (sc.beam) {
    const b = sc.beam;
    const bx = b.x - cam;
    const by = b.y;
    const base = sprites.get('spr_roaringknight_reach_base_sword');
    if (base) drawSpriteExt(ctx, base, 0, bx, by, 2, 2, 0, null, 1);
    const hand = sprites.get('spr_roaringknight_arm_reach_grow');
    const hx = bx + 42 + (b.con >= 4 ? srand(sc.t, 33) * 2 : 0);
    const hy = by + 40;
    if (hand) drawSpriteExt(ctx, hand, Math.floor(b.handframe), hx, hy, 2, 2, 0, null, 1);
    if (b.triheight > 0) {
      const trix = hx + 16;
      const triy = hy + 12;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6 + Math.sin(b.timer / 3) * 0.1;
      ctx.fillStyle = 'rgb(160,0,160)';
      ctx.beginPath();
      ctx.moveTo(trix, triy);
      ctx.lineTo(-100, triy + b.triheight);
      ctx.lineTo(-80, triy - b.triheight);
      ctx.closePath();
      ctx.fill();
      // Particles pulled along the beam toward the hand.
      if (b.con >= 4) {
        for (let back = 0; back < 8; back++) {
          const bf = sc.t - back;
          const off = (srand(bf, 34) * 2 - 1) * b.triheight * 0.8;
          const tt = back / 8;
          const px = -80 + (trix + 80) * tt;
          const py = (triy + off) + (triy - (triy + off)) * tt;
          ctx.globalAlpha = 0.5 * (1 - tt) + 0.1;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(px - 2, py - 2, 4 + tt * 4, 4 - tt * 2);
        }
      }
      ctx.restore();
    }
  }

  // The spear-dodge sequence: the dodging knight and Undyne's spears.
  if (sc.dodge) {
    const d = sc.dodge;
    const ball = sprites.get('spr_roaringknight_ball_transition');
    if (ball) {
      // Ghosts every other frame, per the sequence's Draw.
      for (let g = 1; g <= 2; g++) {
        drawSpriteExt(ctx, ball, Math.floor(d.index), d.x - cam + g * 4, d.y + g * 2,
          2, 2, 0, null, 0.25 / g);
      }
      drawSpriteExt(ctx, ball, Math.floor(d.index), d.x - cam, d.y, 2, 2, 0, null, 1);
    }
    const spear = sprites.get('spr_undyne_dw_spear');
    for (const s of d.spears) {
      const ang = (s.dir * 180) / Math.PI + 90;
      if (spear) drawSpriteExt(ctx, spear, 0, s.x - cam, s.y, 2, 2, ang, null, 1);
      else {
        ctx.save();
        ctx.strokeStyle = '#66ccff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(s.x - cam, s.y);
        ctx.lineTo(s.x - cam - Math.cos(s.dir) * 30, s.y - Math.sin(s.dir) * 30);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // The knight himself.
  if (k.visible) {
    const entry = sprites.get(k.sprite);
    if (entry) {
      const kx = k.x - cam;
      if (k.flip) {
        ctx.save();
        ctx.translate(kx + (entry.meta.w ?? 50), 0);
        ctx.scale(-1, 1);
        drawSpriteExt(ctx, entry, Math.floor(k.index), 0, k.y, 2, 2, 0, null, 1);
        ctx.restore();
      } else {
        drawSpriteExt(ctx, entry, Math.floor(k.index), kx, k.y, 2, 2, 0, null, 1);
      }
      // Undyne caught mid-flight, hat and all — the actor's own Draw:
      // spr_undyne_dw_caught at (x+28, y+26) animating 0.3, the hat at
      // (x+56, y+30).
      if (k.undyneCatch) {
        const caught = sprites.get('spr_undyne_dw_caught');
        const hat = sprites.get('spr_undyne_dw_hat');
        if (caught) drawSpriteExt(ctx, caught, Math.floor(k.undyneAnim), kx + 28, k.y + 26, 2, 2, 0, null, 1);
        if (hat) drawSpriteExt(ctx, hat, 0, kx + 56, k.y + 30, 2, 2, 0, null, 1);
      }
    }
  }

  // Susie in the grab — under the look-down pose, her sprite plus the
  // shuddering hand copy.
  if (sc.susieGrab) {
    const g = sc.susieGrab;
    const noHand = sprites.get('spr_susie_dw_fell_grab_no_hand');
    const handOnly = sprites.get('spr_susie_dw_fell_grab_hand');
    if (noHand) drawSpriteExt(ctx, noHand, 0, g.x - cam, g.y, 2, 2, 0, null, 1);
    if (handOnly) drawSpriteExt(ctx, handOnly, 0, g.x - cam + g.shakeOffset, g.y, 2, 2, 0, null, 1);
  }

  // Dialogue — the typer-81 chatbox, same metrics as the fight's talk.
  if (sc.dialogue) {
    const font = loadFont('../assets/fonts', 'fnt_dotumche');
    if (font?.ready) {
      const lines = revealed(formatWriter(sc.dialogue.text, 33), sc.dialogue.timer, 1);
      drawText(ctx, font, sc.dialogue.speaker === 'susie' ? 'SUSIE' : 'UNDYNE',
        40, 318, { color: 'rgb(160,160,170)', xscale: 0.7, yscale: 0.7 });
      for (let i = 0; i < lines.length; i++) {
        drawText(ctx, font, lines[i], 40, 340 + i * 20, { color: 'rgb(255,255,255)', advance: 9 });
      }
    }
  }
}
