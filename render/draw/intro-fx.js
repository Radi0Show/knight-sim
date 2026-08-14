// obj_knight_roaring_fx's Draw — the opening roar. See sim/intro.js for the
// state machine and the sourcing; this file is the Draw event plus the three
// helper objects the sequence spawns (crush ring, white circle, particles),
// drawn from fields rather than instances.
//
//     if (bar) draw_line_width_color(px, py - bar*40, px, py + bar*40, bar, white)
//     shift_ol: drawn at (x - 20 + jitter, y + 20 + jitter), and while
//               `whiteout` a WHITE copy on top at whiteout_counter alpha
//               (gpu_set_fog(true, c_white) around a second draw)
//     pose_ol:  drawn at (x, y + sin(time * 0.2) * 2) — the settled bob
//
// The jitter is `irandom_range(-1, 1)` per axis in the original's Draw — a
// Draw-event random, so here it is a pure function of the sim frame (the
// 30Hz-vs-monitor rule; CLAUDE.md has the session the distinction cost).
//
// LABELLED APPROXIMATIONS: the in-rush particles (obj_particle_generic with
// scr_lerpvar easings) and the screen afterimages are recreated from
// frame-seeded randoms with the original's counts, spawn ring (40..240) and
// inward pull, but not its exact easing curves; obj_knight_crush's hsv ramp
// is drawn as a white ring fading with the same radius/alpha/timing.

import { drawSpriteExt, c_white } from './gm.js';

/** Deterministic per-(frame, salt) random in [0, 1) — mulberry-ish hash. */
function frand(frame, salt) {
  let t = (frame * 374761393 + salt * 668265263) >>> 0;
  t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
  return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
}

export function drawIntroFx(ctx, e, sprites) {
  const entry = sprites.get(e.sprite_index);
  // px/py — `x + sprite_width * 0.42, y + sprite_height * 0.5` at scale 2.
  const w = (entry?.meta?.w ?? 64) * (e.image_xscale ?? 2);
  const h = (entry?.meta?.h ?? 64) * (e.image_yscale ?? 2);
  const px = e.x + w * 0.42;
  const py = e.y + h * 0.5;

  // The crush ring: radius 960 -> 160 over 24 frames, alpha 0.1, then gone
  // when its alarm (24) fires. Drawn as a thick white ring.
  if (e.crushTimer >= 0 && e.crushTimer <= 24) {
    const t = e.crushTimer / 24;
    const radius = 960 + (160 - 960) * t;
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 24;
    ctx.beginPath();
    ctx.arc(px, py, Math.max(1, radius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // The in-rush while the whiteout holds: 2 + irandom(2) particles a frame,
  // born 40..240 out, pulled toward the centre. Each is drawn for a few
  // frames along its inward path, seeded by its birth frame.
  if (e.whiteout && e.fxState === 'intro') {
    for (let back = 0; back < 10; back++) {
      const bf = e.frame - back;
      const n = 2 + Math.floor(frand(bf, 1) * 3);
      for (let i = 0; i < n; i++) {
        const dir = frand(bf, 2 + i) * Math.PI * 2;
        const dist0 = 40 + frand(bf, 20 + i) * 240;
        const size = 0.25 + frand(bf, 40 + i) * 0.75;
        // Accelerating inward — `scr_lerpvar("speed", 4, 16..24, 32, "in")`.
        const t = back / 10;
        const dist = dist0 * (1 - t * t);
        if (dist <= 32) continue;
        const sx = px + Math.cos(dir) * dist;
        const sy = py + Math.sin(dir) * dist;
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.fillStyle = '#ffffff';
        const s = 3 * size * (1 + t);
        ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
        ctx.restore();
      }
    }
  }

  // Screen afterimages once the roar accelerates: ghost copies around the
  // pose, every 3rd frame while attack_speed is up.
  if (e.fxState === 'roaring' && e.attack_speed > 0 && entry) {
    for (let g = 1; g <= 3; g++) {
      const gf = e.frame - g * 3;
      const ox = (frand(gf, 7) - 0.5) * 60;
      const oy = (frand(gf, 8) - 0.5) * 60;
      drawSpriteExt(ctx, entry, e.image_index, e.x + ox, e.y + oy,
        e.image_xscale, e.image_yscale, 0, null, 0.15 * (4 - g) / 4);
    }
  }

  // The white circle at the roar itself — obj_knight_circle in pure white,
  // reusing its own growth feel: a fast-expanding fading ring.
  if (e.circleFlash > 0 && e.circleFlash < 30) {
    const t = e.circleFlash / 30;
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, 12 * (1 - t));
    ctx.beginPath();
    ctx.arc(px, py, 20 + t * 260, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // The vertical flash bar. The decay lives in sim (see intro.js).
  if (e.bar) {
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = e.bar;
    ctx.beginPath();
    ctx.moveTo(px, py - e.bar * 40);
    ctx.lineTo(px, py + e.bar * 40);
    ctx.stroke();
    ctx.restore();
  }

  if (!entry) return true;

  if (e.sprite_index === 'spr_roaringknight_shift_ol') {
    let xoff = 0;
    let yoff = 0;
    if (e.shudder) {
      xoff = Math.floor(frand(e.frame, 11) * 3) - 1;
      yoff = Math.floor(frand(e.frame, 12) * 3) - 1;
    }
    drawSpriteExt(ctx, entry, e.image_index, e.x - 20 + xoff, e.y + 20 + yoff,
      e.image_xscale, e.image_yscale, 0, null, e.image_alpha ?? 1);
    if (e.whiteout) {
      // tinted() takes the [r,g,b] ARRAY — a string silently no-ops (gm.js).
      drawSpriteExt(ctx, entry, e.image_index, e.x - 20 + xoff, e.y + 20 + yoff,
        e.image_xscale, e.image_yscale, 0, c_white, e.whiteout_counter);
    }
  } else {
    const bob = Math.sin(e.frame * 0.2) * 2;
    drawSpriteExt(ctx, entry, e.image_index, e.x, e.y + bob,
      e.image_xscale, e.image_yscale, 0, null, e.image_alpha ?? 1);
  }
  return true;
}
