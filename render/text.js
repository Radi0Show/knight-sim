// SPRITE FONTS — `font_add_sprite_ext`, which is what the battle UI uses.
//
// None of the numbers on screen come from a real font asset. obj_initializer2
// builds them out of sprites:
//
//     global.hpfont       = font_add_sprite_ext(spr_numbersfontsmall,
//                                               "0123456789-+", 0, 2);
//     global.damagefont   = font_add_sprite_ext(spr_numbersfontbig,
//                                               "0123456789", 20, 0);
//     global.tvlandfont   = font_add_sprite_ext(spr_tvlandfont, "ABC...", 0, 1);
//
// So drawing text is: look each character up in the map string, blit that frame
// of the sprite, advance. No glyph metrics, no texture page, no font chunk to
// extract — the whole mechanism is a sprite with one frame per character.
//
// `font_add_sprite_ext(sprite, map, prop, sep)`:
//
//     map   the characters, in frame order
//     prop  PROPORTIONAL. Falsy means every glyph advances by the sprite's full
//           width; truthy means each advances by its own inked width. `hpfont`
//           passes 0 — fixed — which is why HP numbers line up in a column.
//     sep   extra pixels between glyphs. 2 for hpfont, 0 for the damage font.

/** The fonts the battle UI builds, exactly as obj_initializer2 builds them. */
export const FONTS = {
  hp: { sprite: 'spr_numbersfontsmall', map: '0123456789-+', prop: false, sep: 2 },
  damage: { sprite: 'spr_numbersfontbig', map: '0123456789', prop: true, sep: 0 },
};

/** Advance for one glyph — full sprite width unless the font is proportional. */
function advance(entry, font, index) {
  const img = entry.frames[index];
  const w = font.prop && img ? img.width : entry.meta.w ?? (img ? img.width : 0);
  return w + font.sep;
}

export function measureText(sprites, font, text) {
  const entry = sprites.get(font.sprite);
  if (!entry || !entry.frames.length) return 0;
  let total = 0;
  for (const ch of String(text)) {
    const i = font.map.indexOf(ch);
    if (i < 0 || i >= entry.frames.length) continue;
    total += advance(entry, font, i);
  }
  return total > 0 ? total - font.sep : 0;
}

/**
 * `draw_text` with a sprite font.
 *
 * `halign` mirrors `draw_set_halign`: the charbox draws both HP numbers with
 * `fa_right`, so the current value's right edge sits at x+160 and the max's at
 * x+205 — the numbers grow leftward and the slash between them never moves.
 */
export function drawSpriteText(ctx, sprites, font, text, x, y, {
  halign = 'left', color = null, alpha = 1,
} = {}) {
  const entry = sprites.get(font.sprite);
  if (!entry || !entry.frames.length) return;

  let cx = x;
  if (halign === 'right') cx -= measureText(sprites, font, text);
  else if (halign === 'center') cx -= measureText(sprites, font, text) / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  for (const ch of String(text)) {
    const i = font.map.indexOf(ch);
    if (i < 0 || i >= entry.frames.length) continue;
    const img = entry.frames[i];
    if (img) {
      if (color) {
        // A tinted copy, the same multiply the rest of the renderer uses.
        ctx.drawImage(tintedGlyph(img, color), cx, y);
      } else {
        ctx.drawImage(img, cx, y);
      }
    }
    cx += advance(entry, font, i);
  }
  ctx.restore();
}

/** Glyphs are tiny and few; one cached tint per (glyph, colour) is plenty. */
const glyphCache = new Map();
function tintedGlyph(img, color) {
  const key = `${img.src}|${color}`;
  let c = glyphCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0);
  glyphCache.set(key, c);
  return c;
}
