// obj_dmgwriter's Draw — the floating damage number.
//
//     draw_set_halign(fa_right);
//     draw_text_transformed(x + 30, y, damagemessage,
//                           2 - stretch, stretch + kill, 0);
//     draw_set_alpha(1 - kill);
//
// FOUR THINGS, all of which change how it reads:
//
// 1. **fa_RIGHT.** The number's right edge is pinned at `x + 30`, so a 3-digit
//    hit grows LEFTWARD from the same point a 1-digit hit occupies. Numbers
//    from different characters in the same turn stay aligned in a column
//    instead of wandering.
// 2. **The squash.** `stretch` starts at 0.2 and rises 0.4 a frame to a clamp
//    of 1, so the scale runs (1.8, 0.2) -> (1.4, 0.6) -> (1.0, 1.0). Three
//    frames of a wide flat smear snapping to square. Constant scale loses the
//    impact completely.
// 3. **`kill` is in the Y SCALE as well as the alpha** — `stretch + kill` — so
//    the number stretches vertically as it fades rather than just dimming.
// 4. **`damage == 0` draws `spr_battlemsg` frame 0, not a "0".** That is the
//    MISS graphic. A fumbled attack bar reads as MISS, which is the only way
//    the player can tell a zero-accuracy turn from a zero-damage one.
//
// The font is `global.damagefont` — `font_add_sprite_ext(spr_numbersfontbig,
// "0123456789", 20, 0)`, PROPORTIONAL (prop = 20 is truthy), unlike the
// fixed-advance HP font. Already in render/text.js.

import { drawSpriteExt, rgb } from './draw/gm.js';
import { drawSpriteText, measureText, FONTS } from './text.js';
import { dmgColor, TYPE_DEAD } from '../sim/dmgnumbers.js';

/**
 * obj_basicattack — the impact sprite, drawn at the enemy's depth so it lands
 * ON the Knight rather than behind or in front of the arena.
 *
 * The Create's `image_xscale = 2` is the default and a critical overrides it
 * to 2.5, then GROWS 0.1 a frame for its whole three-frame life. So a critical
 * is the same art, bigger, and still expanding when it disappears.
 */
export function drawAttackVfx(ctx, state, sprites) {
  const list = state.attackVfx;
  if (!list || !list.length) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const v of list) {
    const entry = sprites.get(v.sprite);
    if (!entry || !entry.frames.length) continue;
    const frame = Math.min(Math.floor(v.index), entry.frames.length - 1);
    drawSpriteExt(ctx, entry, frame, v.x, v.y, v.scale, v.scale, 0, null, 1);
  }
  ctx.restore();
}

export function drawDmgNumbers(ctx, state, sprites) {
  const d = state.dmg;
  if (!d || !d.list.length) return;
  const msg = sprites.get('spr_battlemsg');

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (const n of d.list) {
    if (n.delaytimer < n.delay) continue;

    const xs = 2 - n.stretch;
    const ys = n.stretch + n.kill;
    const alpha = Math.max(0, 1 - n.kill);
    if (xs <= 0 || ys <= 0 || alpha <= 0) continue;
    const color = dmgColor(n.type);

    // `message` swaps the digits for a graphic. `damage == 0` is frame 0
    // (MISS) in the writer's colour; a death — `type == 4` — is frame 1 in
    // c_red, which the branch above already selected.
    const frame = n.type === TYPE_DEAD ? 1 : 0;
    if (n.damage === 0 || n.type === TYPE_DEAD) {
      if (msg) drawSpriteExt(ctx, msg, frame, n.x + 30, n.y, xs, ys, 0, color, alpha);
      continue;
    }

    // `draw_text_transformed` scales about the DRAW ORIGIN, and with
    // `fa_right` that origin is the string's right edge. Translating to
    // (x + 30, y) and scaling there reproduces both at once — scaling the
    // glyph positions instead would fan the digits apart as the number
    // squashes.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(n.x + 30, n.y);
    ctx.scale(xs, ys);
    const text = String(n.damage);
    drawSpriteText(ctx, sprites, FONTS.damage, text, 0, 0, {
      halign: 'right', color: rgb(color),
    });
    ctx.restore();
    // Nothing reads it, but measuring keeps the font warm in the same cache
    // the HP numbers use — and a zero-width measure is the signal that the
    // damage font failed to load, which is otherwise silent.
    if (measureText(sprites, FONTS.damage, text) === 0) {
      state.counters.missingDamageFont = (state.counters.missingDamageFont ?? 0) + 1;
    }
  }
  ctx.restore();
}
