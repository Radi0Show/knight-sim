// Canvas renderer. Reads sim state, never writes to it.
//
// Draws the game's own sprites (assets/sprites, extracted from the player's
// data file) positioned by their GameMaker origins. Anything without a sprite
// falls back to its COLLISION MASK, so a missing asset degrades to a shape
// that is still exactly what the physics uses rather than disappearing.

import { HEART_MASK, BATTLEBG_MASK, TOOTH_MASK, FOUNTAIN_MASK, SPRITE_MASKS } from '../sim/masks.js';
import { loadSprites, SPRITE_FOR } from './sprites.js';
import { drawPointingCone } from './draw/pointing-cone.js';
import { drawPointingStar } from './draw/pointing-star.js';
import { drawPointingStarchild } from './draw/pointing-starchild.js';
import { drawRoaring, drawScreenPiece, resetScreenCut, roaringCover, drawRoaringCover } from './draw/roaring.js';
import { drawRoaringknightSlash } from './draw/slash.js';
import { drawGrowtangle, tinted, fogged } from './draw/gm.js';
import { drawSplitCut } from './draw/splitcut.js';
import { drawMenu } from './menu.js';
import { drawTensionBar } from './tensionbar.js';
import { drawGraze } from './graze.js';
import { drawFightBar } from './fightbar.js';
import { drawBackground } from './background.js';
import { drawSnowBackdrop } from './draw/intro-fx.js';
import { CAM_X } from '../sim/intro.js';
import { drawDmgNumbers, drawAttackVfx } from './dmgnumbers.js';
import { drawRudeBuster } from './rudebuster.js';
import { drawDialogue } from './dialogue.js';
import {
  drawSwordTunnelSword, drawTrackingSword, drawTrackingSwordsManager,
  drawSplitslashStrike,
} from './draw/swords.js';
import { drawKnightCircle } from './draw/knight-circle.js';
import { drawKnightStream } from './draw/knight-stream.js';
import { drawFallingSword, drawSwordfallKnight } from './draw/swordfall.js';
import { drawWeirdCircle, drawWeirdBottomManager } from './draw/underbox.js';
import { drawTunnelslash } from './draw/knightlines.js';
import { drawRotatingSlashTelegraph } from './draw/rotating-slash.js';
import { createSplitBox } from './splitbox.js';
import { scrEaseOut, clamp01, lerp } from '../sim/gml.js';

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

/**
 * Fallback shapes, by OBJECT name. These four predate the sprite pack.
 *
 * The fallback below now also consults SPRITE_MASKS by SPRITE name, which is
 * the more useful key: a bullet whose sprite is missing from the pack still
 * draws the exact shape it collides with. `spr_pxwhite2` — the tracking
 * swords' damage bar — is the case that forced it: 1x2 pixels, not worth
 * shipping as a PNG, and invisible without this.
 */
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
  function blit(img, ox, oy, x, y, sx, sy, angleDeg, alpha, blend) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    if (angleDeg) ctx.rotate((-angleDeg * Math.PI) / 180);
    ctx.scale(sx, sy);
    // `draw_self()` uses the instance's own image_blend, and GameMaker
    // MULTIPLIES by it. Ignoring it here left the battle box's border white for
    // the whole fight when obj_growtangle's Create dyes it green, and left the
    // tracking swords white when their Step reddens them as they charge.
    ctx.drawImage(blend ? tinted(img, blend) : img, -ox, -oy);
    ctx.restore();
  }

  const splitBox = createSplitBox(sprites);

  /**
   * PER-OBJECT DRAW EVENTS.
   *
   * The game's look lives in Draw events that composite layers, scroll
   * textures and mask them against primitives — none of which a generic
   * sprite blit can express. Each entry here is one ported Draw event; it
   * returns true if it has drawn the object entirely, false to let the normal
   * sprite draw still happen after it (GML's `draw_self()`).
   */
  // ROARING'S SCREEN CUT IS A ONE-SHOT, and the practice loop replays the
  // attack — so the snapshot has to be dropped when the turn that took it is
  // over, or the second run flings the FIRST run's photograph apart. Keyed off
  // the controller disappearing, which is the only signal the renderer has.
  let roaringWasAlive = false;

  const roaringOwnsIt = (state) =>
    state.entities.some((x) => x.alive && x.type.name === 'obj_knight_roaring2' && !x.stop);

  const DRAW_EVENTS = {
    obj_knight_pointing_cone: drawPointingCone,
    // The stream draws its beams, its streamlines AND its diamonds itself,
    // clipped to the box — see render/draw/knight-stream.js.
    obj_knight_stream: drawKnightStream,
    // The swords carry a two-ghost motion trail, and the manager draws its
    // pose at a fixed screen x — see render/draw/swordfall.js.
    obj_fallingsword: drawFallingSword,
    obj_knight_swordfall: drawSwordfallKnight,
    // The underbox orb is drawn as 12 wobbling scanlines, not as a sprite,
    // and its manager breathes on a sine — see render/draw/underbox.js.
    obj_knight_weird_circle: drawWeirdCircle,
    obj_knight_weird_bottom_manager: drawWeirdBottomManager,
    // The knightlines spear is drawn twice onto a 100x100 surface and then
    // CUT at the arena's left wall — see render/draw/knightlines.js.
    obj_bullet_knight_tunnelslash: drawTunnelslash,
    /**
     * obj_knight_tunnel_slasher's Draw is the pose with a `sin(fulltimer *
     * 0.1) * 2` breathe, the same two-pixel bob the rotating slash's knight
     * has. Its `fulltimer` is the instance's own clock, not global.time.
     */
    obj_knight_tunnel_slasher(ctx2, e, state2, deps) {
      const entry = deps.sprites.get(e.sprite_index);
      if (!entry || !entry.frames.length) return true;
      blit(entry.frames[Math.abs(Math.floor(e.image_index ?? 0)) % entry.frames.length],
        entry.meta.ox, entry.meta.oy,
        e.x, e.y + Math.sin(e.fulltimer * 0.1) * 2,
        e.image_xscale ?? 2, e.image_yscale ?? 2, 0, e.image_alpha ?? 1, e.image_blend);
      return true;
    },
    obj_bullet_knight_stream: () => true,
    obj_knight_streamline: () => true,
    obj_bullet_stream_diamond: () => true,
    obj_knight_pointing_star: drawPointingStar,
    obj_knight_roaring2: drawRoaring,
    obj_marker_screenpiece: drawScreenPiece,

    // The slash the fight throws most: rotating slash spawns a fan of these
    // every cycle in every phase, and Roaring throws one at the cut. It was
    // rendering as a plain line — see render/draw/slash.js.
    obj_roaringknight_slash: drawRoaringknightSlash,

    obj_sword_tunnel_sword: drawSwordTunnelSword,
    obj_tracking_sword1: drawTrackingSword,
    obj_tracking_swords_manager: drawTrackingSwordsManager,

    /**
     * `obj_tracking_sword_slash`'s entire Draw event is `timer++; if (timer ==
     * 3) instance_destroy();` — no sprite draw at all. It reaches the screen
     * only through its manager's additive, box-clipped surface, so the generic
     * blit must not draw it as well. (The timer and destroy are in the sim's
     * endStep, where Draw sits.)
     */
    obj_tracking_sword_slash: () => true,
    obj_roaringknight_splitslash: drawSplitslashStrike,
    obj_knight_split_growtangle_effect: drawSplitCut,

    // The arena's green under-layer. See drawGrowtangle — the board is green
    // for the whole fight and this had been drawing only the top layer.
    // The board is drawn only during the bullet phase — see the note in
    // sim/scenes/practice.js. `boardVisible` is undefined in scenes that never
    // set it (the oracle scenes), and those must keep drawing it.
    obj_growtangle: (ctx, e, state, deps) => {
      // RETURN TRUE, not undefined. A DRAW_EVENTS entry that returns falsy
      // falls through to the generic blit, so an early `return` suppressed
      // the custom draw and let the DEFAULT one draw the board anyway —
      // the box stayed on screen through the whole command phase.
      if (state.boardVisible === false) return true;
      drawGrowtangle(ctx, e, deps.sprites, SPRITE_FOR.obj_growtangle);
      // RETURN FALSY. `drawGrowtangle` draws only the GREEN UNDER-LAYER —
      // frame 1, the solid interior. The BORDER is frame 0, drawn by
      // `draw_self()`, which here is the generic blit that runs when an
      // override declines to handle the entity.
      //
      // Returning true to suppress the blit therefore deleted the box's
      // outline and left a black interior on a dark background: the arena
      // looked like it had stopped appearing entirely. Both layers are
      // needed, which is what obj_growtangle's own two-line Draw says.
      return false;
    },

    /**
     * DRAWN BY THE ROAR, NOT BY THEMSELVES.
     *
     * obj_knight_roaring_star, obj_particle_generic, obj_afterimage and
     * obj_afterimage_grow have no Draw event at all in the original — every one
     * of them reaches the screen only through obj_knight_roaring2's `with`
     * blocks, composited into its star surface. Letting the generic sprite blit
     * draw them too puts a second, un-graded copy outside the vortex.
     *
     * The starchild does have its own Draw, but the roar draws it as well and
     * with different numbers (a fixed 45/60 fade rather than the child's own
     * lifetime), so during Roaring the roar's copy is the one that counts.
     */
    obj_knight_roaring_star: (ctx, e, state) => roaringOwnsIt(state),
    obj_particle_generic: (ctx, e, state) => roaringOwnsIt(state),
    obj_afterimage: (ctx, e, state) => roaringOwnsIt(state),
    obj_afterimage_grow: (ctx, e, state) => roaringOwnsIt(state),
    obj_knight_pointing_starchild(ctx, e, state, deps) {
      if (roaringOwnsIt(state)) return true;
      return drawPointingStarchild(ctx, e, state, deps);
    },
    obj_knight_circle: drawKnightCircle,

    /**
     * obj_oflash — a FOGGED copy of its target at `sin(siner / 3)`.
     *
     * `gpu_set_fog(true, flashcolor, 0, 1)` replaces every pixel with the
     * colour and keeps the alpha, which is not what the draw-colour argument
     * does (that multiplies, and a white multiply on dark art is a no-op —
     * the same trap the charge-up silhouette hit). `fogged()` is the one that
     * is right here.
     */
    obj_oflash(ctx2, e, state2, deps) {
      const entry = deps.sprites.get(e.sprite_index ?? SPRITE_FOR.obj_knight_enemy);
      if (!entry || !entry.frames.length) return true;
      const a = Math.sin(e.siner / 3);
      if (a <= 0) return true;
      const idx = Math.abs(Math.floor(e.image_index ?? 0)) % entry.frames.length;
      blit(fogged(entry.frames[idx], e.flashcolor ?? [255, 255, 255]),
        entry.meta.ox, entry.meta.oy, e.x, e.y,
        e.image_xscale ?? 2, e.image_yscale ?? 2, 0, Math.min(1, a));
      return true;
    },
    obj_knight_rotating_slash: drawRotatingSlashTelegraph,

    /**
     * obj_knight_enemy's Draw opens with
     * `if (i_ex(obj_knight_swordtunnelanim)) exit;` — during Sword Tunnel the
     * anim object IS the knight, so he must not draw himself as well.
     *
     * Expressed here rather than as `visible = false` in sim/ because that is
     * where the original expresses it: a Draw-event early exit, not a state
     * change. The cone does the opposite and really does set visible.
     */
    obj_knight_enemy(ctx, e, state) {
      const k = state.knight;
      // ROARING's launch. con 3 is "gone until the CleanUp hands him back";
      // con 2 is the TEN-FRAME WHITE BURN-OUT that gets him there, and it is
      // NOT dead code — the retraction this replaces assumed `chargeuptimer`
      // was still ~60 from the charge-up turn, but obj_knight_roaring2's
      // Create zeroes it on the same two lines that set con 2:
      //
      //     obj_knight_enemy.chargeupcon = 2;
      //     obj_knight_enemy.chargeuptimer = 0;
      //
      // so `(10 - chargeuptimer) / 10` really does walk 0.9 -> 0 and the
      // `== 10` handoff really does fire. sim/actors.js runs the timer; this
      // draws it, fogged white like the charge-up's silhouette. The roar's
      // own `darkness` lerp is delayed 20 frames, so the burn-out happens in
      // full view — dropping it made him pop out in one frame.
      if (k?.chargeupcon >= 3) return true;
      if (k?.chargeupcon === 2) {
        const entry = sprites.get(e.sprite_index ?? SPRITE_FOR.obj_knight_enemy);
        if (!entry || !entry.frames.length) return true;
        const idx = Math.abs(Math.floor(e.image_index ?? 0)) % entry.frames.length;
        blit(fogged(entry.frames[idx], [255, 255, 255]), entry.meta.ox, entry.meta.oy,
          e.x, e.y, e.image_xscale ?? 1, e.image_yscale ?? 1, 0,
          Math.max(0, e.image_alpha ?? 0));
        return true;
      }
      // THE CHARGE-UP TURN (chargeupcon 1) — the Draw's two layers:
      //
      //     d3d_set_fog(true, c_white, 0, 1);
      //     draw_sprite_ext(idlesprite, siner, x, y, ..., chargeuptimer / 10);
      //     d3d_set_fog(false, ...);
      //
      // a SOLID WHITE copy fading in over the normal sprite in 10 frames —
      // and, from the Step, obj_afterimage_fade_to_white copies every 4th
      // frame past timer 10 (speed 4, random direction, alpha 0.6): the
      // white trails shedding off him. The trails here are frame-seeded
      // renderer ghosts (Draw-random rule; the oracle's RNG draws for them
      // are covered by the per-launch re-anchor) with the drift and count
      // kept and the fade rate approximated — LABELLED.
      if (k?.chargeupcon === 1) {
        const entry = sprites.get(e.sprite_index ?? SPRITE_FOR.obj_knight_enemy);
        if (!entry || !entry.frames.length) return false;
        const idx = Math.abs(Math.floor(e.image_index ?? 0)) % entry.frames.length;
        const t = k.chargeuptimer ?? 0;
        // The trails, oldest first: one born every 4th frame past 10, each
        // drifting speed 4 along a seeded direction, fading over ~12 frames.
        for (let back = 12; back >= 1; back--) {
          const bf = t - back;
          if (bf <= 10 || bf % 4 !== 0) continue;
          const dir = frandCanvas(bf, 71) * Math.PI * 2;
          const dist = back * 4;
          const alpha = Math.max(0, 0.6 - back * 0.05);
          if (alpha <= 0) continue;
          // FOGGED, not tinted — a white multiply is a no-op on dark art.
          blit(fogged(entry.frames[idx], [255, 255, 255]), entry.meta.ox, entry.meta.oy,
            e.x + Math.cos(dir) * dist, e.y + Math.sin(dir) * dist,
            e.image_xscale ?? 1, e.image_yscale ?? 1, 0, alpha);
        }
        // The base sprite, then the white silhouette fading in over it.
        blit(entry.frames[idx], entry.meta.ox, entry.meta.oy, e.x, e.y,
          e.image_xscale ?? 1, e.image_yscale ?? 1, 0, e.image_alpha ?? 1, e.image_blend);
        blit(fogged(entry.frames[idx], [255, 255, 255]), entry.meta.ox, entry.meta.oy,
          e.x, e.y, e.image_xscale ?? 1, e.image_yscale ?? 1, 0,
          Math.min(1, t / 10));
        return true;
      }
      return state.entities.some(
        (x) => x.alive && x.type.name === 'obj_knight_swordtunnelanim',
      );
    },
  };

  /** Frame-seeded random for the charge trails (the 30Hz Draw-random rule). */
  function frandCanvas(frame, salt) {
    let t = (frame * 374761393 + salt * 668265263) >>> 0;
    t = Math.imul(t ^ (t >>> 13), 1274126177) >>> 0;
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  }

  // One reusable offscreen buffer for the compositing the Draw ports need.
  let scratchCanvas = null;
  function scratch(w, h) {
    if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
    if (scratchCanvas.width !== w || scratchCanvas.height !== h) {
      scratchCanvas.width = w;
      scratchCanvas.height = h;
    }
    return scratchCanvas;
  }
  /** The arena's screen rect, for Draw ports that clip to the battle box. */
  function boxRect(state) {
    const gt = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
    if (!gt) return null;
    const w = 75 * gt.image_xscale;
    const h = 75 * gt.image_yscale;
    return { x: gt.x - w / 2, y: gt.y - h / 2, w, h };
  }

  const drawDeps = { sprites, VIEW_W, VIEW_H, scratch, boxRect };

  /**
   * THE SECOND TELEGRAPH LAYER, from obj_roaringknight_boxsplitter_attack's
   * Draw: a 142x142 surface centred on the box, into which every pending
   * splitslash draws a SHORTER bar (`clamp01(timer/30) * 90`, not the
   * screen-wide `ease*180` the slash draws for itself), masked with two
   * counter-scrolling copies of spr_knight_bullet_flow and blitted additively.
   *
   * This is the layer that actually reads as "a cut is coming HERE": it is
   * clipped to the arena and it has the flowing texture. Drawing only the
   * long bar — as this renderer first did — gets the geometry right and the
   * character wrong.
   */
  const hellSurface = (() => {
    const c = document.createElement('canvas');
    c.width = 142;
    c.height = 142;
    return c;
  })();

  function drawHellSurface(state) {
    const px = sprites.get('spr_pxwhite10_center');
    const flow = sprites.get('spr_knight_bullet_flow');
    if (!px || !px.frames.length) return;

    const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
    const pending = state.entities.filter(
      (x) => x.alive && x.type.name === 'obj_roaringknight_splitslash' && !x.slash,
    );
    if (!gt || !pending.length) return;

    const g = hellSurface.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, 142, 142);

    for (const e of pending) {
      const ease = scrEaseOut(clamp01(e.timer / 30), 3);
      const spin = (ease * 15 - 15) * e.flip;
      const size = lerp(4, 0, ease);
      const length = clamp01(e.timer / 30) * 90;

      g.save();
      g.translate(71 + e.xoffset, 71 + e.yoffset);
      g.rotate((-(spin + e.image_angle + e.angleoffset) * Math.PI) / 180);
      g.scale(length, size);
      g.drawImage(tintedPixel, -px.meta.ox, -px.meta.oy);
      g.restore();

      // bm_dest_alpha: the flow texture shows only where the bar already is.
      if (flow && flow.frames.length) {
        g.save();
        g.globalCompositeOperation = 'source-atop';
        const f = flow.frames[2 % flow.frames.length];
        g.scale(0.25, 0.25);
        g.drawImage(f, e.timer / 0.25, e.timer / 0.25);
        g.drawImage(f, (-e.timer + 40) / 0.25, (-e.timer + 40) / 0.25);
        g.restore();
      }
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(hellSurface, gt.x - 71, gt.y - 71);
    ctx.restore();
  }

  /**
   * obj_roaringknight_splitslash's OWN telegraph — the long red bar that spins
   * into place over the 30 frames before a cut. Additive, drawn at the box's
   * position plus this slash's own offsets, so it shows EXACTLY where the cut
   * will land. Separate from, and drawn alongside, the surface layer above.
   */
  function drawTelegraph(e, state) {
    const px = sprites.get('spr_pxwhite10_center');
    if (!px || !px.frames.length) return;

    const gt =
      state.entities.find((x) => x.alive && x.type.name === 'obj_knight_split_growtangle') ??
      state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
    if (!gt) return;

    const ease = scrEaseOut(clamp01(e.timer / 30), 3);
    const spin = (ease * 15 - 15) * e.flip;
    const size = lerp(4, 0, ease);
    const length = ease * 180;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(gt.x + e.xoffset, gt.y + e.yoffset);
    ctx.rotate((-(spin + e.image_angle + e.angleoffset) * Math.PI) / 180);
    ctx.scale(length, size);
    // merge_color(c_black, c_red, 0.5)
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.drawImage(tintedPixel, -px.meta.ox, -px.meta.oy);
    ctx.restore();
  }

  // The telegraph's bar is one 10x10 sprite tinted dark red; bake it once.
  const tintedPixel = (() => {
    const px = sprites.get('spr_pxwhite10_center');
    const c = document.createElement('canvas');
    c.width = px ? px.meta.w : 10;
    c.height = px ? px.meta.h : 10;
    const g = c.getContext('2d');
    if (px && px.frames.length) g.drawImage(px.frames[0], 0, 0);
    else g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#800000'; // merge_color(c_black, c_red, 0.5)
    g.fillRect(0, 0, c.width, c.height);
    return c;
  })();

  function drawEntity(e, name, simFrame = 0) {
    let sx = e.image_xscale ?? e.xscale ?? 1;
    let sy = e.image_yscale ?? e.yscale ?? 1;
    const ang = e.image_angle ?? 0;
    const alpha = e.image_alpha ?? 1;

    // THE SPLIT TEETH PULSE. Their Draw jitters BOTH scales every frame:
    //
    //     draw_sprite_ext(sprite_index, image_index, x, y,
    //         image_xscale + random_range(-0.1, 0.1),
    //         image_yscale + random_range(-0.1, 0.1), ...)
    //
    // which is the warping the rhombus projectiles have in the real fight
    // (GitHub #5). It was stripped deliberately once — it would consume two
    // draws per tooth per frame and swamp the oracle's RNG stream — so it is
    // reinstated the way this project reinstates any Draw-random: seeded from
    // the SIM FRAME, not advanced per paint, so it runs at 30Hz on any
    // monitor and a paused inspection redraws identically.
    if (name === 'obj_roaringknight_split_bullet') {
      sx += (frandCanvas(simFrame, e.seq * 2 + 1) - 0.5) * 0.2;
      sy += (frandCanvas(simFrame, e.seq * 2 + 2) - 0.5) * 0.2;
    }

    const entry = sprites.get(e.sprite_index ?? e.sprite ?? SPRITE_FOR[name]);
    if (entry && entry.frames.length) {
      const idx = Math.abs(Math.floor(e.image_index ?? 0)) % entry.frames.length;
      // `renderX/renderY` let an object draw somewhere other than its own
      // position, which is what a GML Draw event does freely. ROARING needs it:
      // its instance is parked off screen while the knight is drawn centre.
      const dx = e.renderX ?? e.x;
      const dy = e.renderY ?? e.y;
      blit(entry.frames[idx], entry.meta.ox, entry.meta.oy, dx, dy, sx, sy, ang, alpha, e.image_blend);
      return true;
    }

    const mask = MASK_FOR[name];
    if (mask && baked[name]) {
      blit(baked[name], mask.originX, mask.originY, e.x, e.y, sx, sy, ang, alpha);
      return true;
    }

    // Then by sprite name, baked on first use. This is what makes bullets with
    // no PNG visible rather than silently absent — and what you see is exactly
    // the shape the collision test uses.
    const sm = SPRITE_MASKS[e.sprite_index];
    if (sm) {
      const key = `sprite:${e.sprite_index}`;
      if (!baked[key]) baked[key] = bakeMask(sm, COLORS.fallback);
      blit(baked[key], sm.originX, sm.originY, e.x, e.y, sx, sy, ang, alpha);
      return true;
    }
    return false;
  }

  function draw(state) {
    // The deferred roaring composite is per-frame: drawRoaring re-registers
    // it if the attack is still on. Left set, the last composite would sit
    // over the menu for the rest of the fight.
    roaringCover.active = false;
    {
      const roaringNow = state.entities.some(
        (e) => e.alive && e.type.name === 'obj_knight_roaring2',
      );
      if (roaringWasAlive && !roaringNow) resetScreenCut();
      roaringWasAlive = roaringNow;
    }
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // THE ROOM IS STILL THERE. scr_battle never changes rooms: the fight is
    // played at the same camera the cutscene ends on, with the snow vista's
    // world-anchored tiles on the left of the view. What darkens it is
    // obj_bgfountaintest's own 120-frame alphafactor ramp drawing OVER it —
    // there is no fade-out of the scenery itself. Cutting straight to black
    // here was the visible seam between the intro and the fight.
    // `vistaFsBase` carries the intro's fountain-animation accumulator across
    // the handoff (0.1/frame, same rate on both sides).
    drawSnowBackdrop(ctx, CAM_X, (state.vistaFsBase ?? 0) + 0.1 * (state.frame ?? 0), sprites);

    // obj_bgfountaintest, at depth 150000 — behind absolutely everything.
    // obj_knight_enemy's Create destroys obj_battleback and puts this in its
    // place, so the fight is played against the dark fountain and not the flat
    // black this drew before. See render/background.js: its brightness and
    // speed are read off the Knight's HP.
    drawBackground(ctx, state, sprites);

    ctx.save();

    // SCREEN SHAKE IS ALREADY IN state.view. obj_shake (sim/shake.js) moves
    // the camera itself, verified against the recording, so the renderer just
    // honours the view like it does for everything else.
    //
    // There used to be an extra jitter here, derived from a `state.shake`
    // magnitude and flipped by `state.frame % 2`. Both it and its only caller
    // were invented, and a ±3px whole-screen wobble alternating EVERY FRAME is
    // what the battle board "flickering" was.
    ctx.translate(-state.view.x, -state.view.y);

    // Deeper depth draws first, matching GameMaker's painter order.
    const ordered = state.entities
      .filter((e) => e.alive && e !== state.soul && e.visible !== false)
      .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0) || a.seq - b.seq);

    for (const e of ordered) {
      const name = e.type.name;

      const custom = DRAW_EVENTS[name];
      if (custom && custom(ctx, e, state, drawDeps)) continue;

      if (name === 'obj_knight_split_growtangle') {
        // The cut box draws itself out of surfaces; obj_growtangle is parked
        // offscreen for the duration.
        if (splitBox) splitBox.draw(ctx, e, state.frame);
        continue;
      }

      if (name === 'obj_roaringknight_splitslash' && !e.slash) {
        drawTelegraph(e, state);
        continue;
      }

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

      drawEntity(e, name, state.frame ?? 0);
    }

    // The boxsplitter's surface telegraph sits above the arena, below the soul.
    drawHellSurface(state);

    // Soul last so a bullet never hides it.
    const soul = state.soul;
    const drawSoul = () => {
      if (!soul || !soul.alive) return;
      const iFrames = state.invTimer > 0;
      // The soul is DESTROYED with the board, not just idle — Alarm 11 does
      // `with (obj_heart) instance_destroy(); with (obj_growtangle)
      // instance_destroy();` in one block. The soul has its own draw path here
      // rather than going through DRAW_EVENTS, so suppressing it there was not
      // enough and a lone heart hung in the air over the command menu.
      const hidden = state.boardVisible === false
        || (iFrames && Math.floor(state.frame / 2) % 2 === 0);
      if (hidden) return;
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
    };
    drawSoul();

    drawGraze(ctx, state, sprites);

    ctx.restore();

    // THE CHARBOX ROW, last and in screen space — the party panels sit over
    // everything, including a full-screen attack.
    drawTensionBar(ctx, state, sprites);
    // Damage numbers go OVER the arena and UNDER the menu band — they are at
    // the enemy's depth, and the band is drawn on top of everything.
    // The impact lands UNDER the number — the number is thrown up out of it.
    drawAttackVfx(ctx, state, sprites);
    drawRudeBuster(ctx, state, sprites);
    drawDmgNumbers(ctx, state, sprites);
    // The chatbox occupies the same band as the button row, and the two are
    // never up together — the exchange runs before the menu opens.
    drawDialogue(ctx, state, sprites);
    drawMenu(ctx, state, sprites);
    // The FIGHT bar sits where the menu was — the menu is closed while it runs.
    drawFightBar(ctx, state.fightBar, sprites, undefined, undefined, state);

    // THE ROAR COVERS THE MENU. obj_knight_roaring2's full-camera composite
    // draws over the charboxes, the tension bar and the attack bar — none of
    // them has a roaring guard in the dump; they are simply painted over as
    // `darkness` ramps, and the sim's old order (panels last, "over
    // everything") was the opposite of the game's. The SOUL alone rides above
    // the cover: roaring2's Draw blits obj_heart immediately after its
    // surface, so it is re-drawn here in screen space.
    if (roaringCover.active) {
      drawRoaringCover(ctx, state, sprites);
      if (state.soul && state.soul.alive) {
        const entry = sprites.get('spr_dodgeheart');
        if (entry && entry.frames.length) {
          ctx.save();
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.drawImage(entry.frames[0],
            state.soul.x - state.view.x - entry.meta.ox,
            state.soul.y - state.view.y - entry.meta.oy);
          ctx.restore();
        }
      }
    }

    // THE ENDING'S WHITE FADEOUT — `scr_fadeout(15)` with `image_blend =
    // c_white; length *= 2` at endtimer 32 of the win. Over everything,
    // soul included: the game's fadeout object draws above the whole room.
    if (state.endFade) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = Math.min(1, state.endFade);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.restore();
    }
  }

  // Frame counts for the sim's animation phase. sim/ must not read the
  // filesystem, so the renderer — which has the manifest anyway — hands them
  // over. Without this, image_speed does nothing and everything sits on frame 0.
  const spriteFrames = {};
  const spriteRate = {};
  for (const [name, entry] of sprites) {
    spriteFrames[name] = entry.frames.length;
    const m = entry.meta;
    spriteRate[name] =
      m.playbacktype === 'FramesPerSecond' ? (m.playback ?? 30) / 30 : (m.playback ?? 1);
  }

  // `sprites` and `ctx` are exposed so the title and Game Over screens can
  // draw with the same assets rather than loading their own copies.
  return {
    draw, ctx, sprites, VIEW_W, VIEW_H,
    spriteCount: sprites.size, spriteFrames, spriteRate,
  };
}
