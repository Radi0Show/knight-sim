// Canvas renderer. Reads sim state, never writes to it.
//
// Draws the game's own sprites (assets/sprites, extracted from the player's
// data file) positioned by their GameMaker origins. Anything without a sprite
// falls back to its COLLISION MASK, so a missing asset degrades to a shape
// that is still exactly what the physics uses rather than disappearing.

import { HEART_MASK, BATTLEBG_MASK, TOOTH_MASK, FOUNTAIN_MASK } from '../sim/masks.js';
import { loadSprites, SPRITE_FOR } from './sprites.js';

const VIEW_W = 640;
const VIEW_H = 480;

const COLORS = {
  bg: '#000000',
  box: '#ffffff',
  soul: '#ff0000',
  soulHurt: '#7a0000',
  fallback: '#ffffff',
  slash: '#ff4444',
};

const MASK_FOR = {
  obj_heart: HEART_MASK,
  obj_growtangle: BATTLEBG_MASK,
  obj_roaringknight_split_bullet: TOOTH_MASK,
  obj_roaringknight_fountain_bullet: FOUNTAIN_MASK,
};

/** Pre-render a collision mask into an offscreen canvas (fallback path). */
function bakeMask(mask, color) {
  const c = document.createElement('canvas');
  c.width = mask.w;
  c.height = mask.h;
  const g = c.getContext('2d');
  const img = g.createImageData(mask.w, mask.h);
  const r = parseInt(color.slice(1, 3), 16);
  const gg = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  for (let y = 0; y < mask.h; y++) {
    for (let x = 0; x < mask.w; x++) {
      const i = (y * mask.w + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = mask.px[y][x] ? 255 : 0;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export async function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  let sprites = new Map();
  try {
    sprites = await loadSprites();
  } catch (err) {
    console.warn('sprites unavailable, falling back to collision masks:', err.message);
  }

  const baked = {
    obj_heart: bakeMask(HEART_MASK, COLORS.soul),
    heartHurt: bakeMask(HEART_MASK, COLORS.soulHurt),
    obj_growtangle: bakeMask(BATTLEBG_MASK, COLORS.box),
    obj_roaringknight_split_bullet: bakeMask(TOOTH_MASK, COLORS.fallback),
    obj_roaringknight_fountain_bullet: bakeMask(FOUNTAIN_MASK, COLORS.fallback),
  };

  /**
   * Draw with GameMaker's convention: position is the instance origin, scale
   * about that origin, image_angle counter-clockwise in degrees.
   */
  function blit(img, ox, oy, x, y, sx, sy, angleDeg, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (angleDeg) ctx.rotate((-angleDeg * Math.PI) / 180);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -ox, -oy);
    ctx.restore();
  }

  function drawEntity(e, name) {
    const sx = e.image_xscale ?? e.xscale ?? 1;
    const sy = e.image_yscale ?? e.yscale ?? 1;
    const ang = e.image_angle ?? 0;
    const alpha = e.image_alpha ?? 1;

    const entry = sprites.get(e.sprite ?? SPRITE_FOR[name]);
    if (entry && entry.frames.length) {
      const idx = Math.abs(Math.floor(e.image_index ?? 0)) % entry.frames.length;
      blit(entry.frames[idx], entry.meta.ox, entry.meta.oy, e.x, e.y, sx, sy, ang, alpha);
      return true;
    }

    const mask = MASK_FOR[name];
    if (mask && baked[name]) {
      blit(baked[name], mask.originX, mask.originY, e.x, e.y, sx, sy, ang, alpha);
      return true;
    }
    return false;
  }

  function draw(state) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(-state.view.x, -state.view.y);

    for (const e of state.entities) {
      if (!e.alive || e === state.soul) continue;
      if (e.visible === false) continue;
      const name = e.type.name;

      if (name === 'obj_roaringknight_slash') {
        // Drawn in the original as a tapering wedge built from triangles, not
        // from its sprite; a line along its angle reads the same at a glance.
        ctx.save();
        ctx.globalAlpha = Math.min(1, e.width / 24);
        ctx.strokeStyle = COLORS.slash;
        ctx.lineWidth = Math.max(1, e.width / 3);
        ctx.translate(e.x, e.y);
        ctx.rotate((-e.image_angle * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(-320, 0);
        ctx.lineTo(320, 0);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      drawEntity(e, name);
    }

    // Soul last so a bullet never hides it.
    const soul = state.soul;
    if (soul && soul.alive) {
      const iFrames = state.invTimer > 0;
      const hidden = iFrames && Math.floor(state.frame / 2) % 2 === 0;
      if (!hidden) {
        const entry = sprites.get('spr_dodgeheart');
        if (entry && entry.frames.length) {
          ctx.save();
          if (iFrames) ctx.globalAlpha = 0.45;
          blit(entry.frames[0], entry.meta.ox, entry.meta.oy, soul.x, soul.y, 1, 1, 0, 1);
          ctx.restore();
        } else {
          blit(iFrames ? baked.heartHurt : baked.obj_heart,
            HEART_MASK.originX, HEART_MASK.originY, soul.x, soul.y, 1, 1, 0, 1);
        }
      }
    }

    ctx.restore();
  }

  return { draw, VIEW_W, VIEW_H, spriteCount: sprites.size };
}
