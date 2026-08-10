// Canvas renderer. Reads sim state, never writes to it.
//
// Shapes come from the collision masks already in sim/data — the same pixel
// grids the physics uses. That means what you see is exactly what you collide
// with (no sprite/hitbox mismatch), and it ships no extracted art.

import { HEART_MASK, BATTLEBG_MASK, TOOTH_MASK, FOUNTAIN_MASK } from '../sim/masks.js';

const VIEW_W = 640;
const VIEW_H = 480;

const COLORS = {
  bg: '#000000',
  box: '#ffffff',
  soul: '#ff0000',
  soulHurt: '#7a0000',
  tooth: '#ffffff',
  fountain: '#ffffff',
  slash: '#ff4444',
  text: '#ffffff',
};

/** Pre-render a mask into an offscreen canvas once, then blit it per frame. */
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
      const on = mask.px[y][x];
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
      img.data[i + 3] = on ? 255 : 0;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const baked = {
    heart: bakeMask(HEART_MASK, COLORS.soul),
    heartHurt: bakeMask(HEART_MASK, COLORS.soulHurt),
    box: bakeMask(BATTLEBG_MASK, COLORS.box),
    tooth: bakeMask(TOOTH_MASK, COLORS.tooth),
    fountain: bakeMask(FOUNTAIN_MASK, COLORS.fountain),
  };

  /**
   * Draw a baked mask with GameMaker's transform convention: position is the
   * instance origin, scale about that origin, angle CCW in degrees.
   */
  function blit(img, mask, x, y, sx = 1, sy = 1, angleDeg = 0, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (angleDeg) ctx.rotate((-angleDeg * Math.PI) / 180);
    ctx.scale(sx, sy);
    ctx.drawImage(img, -mask.originX, -mask.originY);
    ctx.restore();
  }

  function draw(state) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    ctx.save();
    ctx.translate(-state.view.x, -state.view.y);

    for (const e of state.entities) {
      if (!e.alive) continue;
      const n = e.type.name;

      if (n === 'obj_growtangle') {
        if (e.visible === false) continue;
        blit(baked.box, BATTLEBG_MASK, e.x, e.y, e.xscale, e.yscale, 0, 0.9);
      } else if (n === 'obj_roaringknight_split_bullet') {
        blit(baked.tooth, TOOTH_MASK, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle);
      } else if (n === 'obj_roaringknight_fountain_bullet') {
        blit(baked.fountain, FOUNTAIN_MASK, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle);
      } else if (n === 'obj_roaringknight_slash') {
        // The slash draws as a long thin wedge in the original; a line along
        // its angle reads the same at a glance and needs no extra art.
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
      }
    }

    // Soul last, so it is never hidden behind a bullet.
    const soul = state.soul;
    if (soul && soul.alive) {
      // Flash while invincible, as the original does via image_speed.
      const iFrames = state.invTimer > 0;
      const hide = iFrames && Math.floor(state.frame / 2) % 2 === 0;
      if (!hide) {
        blit(iFrames ? baked.heartHurt : baked.heart, HEART_MASK, soul.x, soul.y);
      }
    }

    ctx.restore();
  }

  return { draw, VIEW_W, VIEW_H };
}
