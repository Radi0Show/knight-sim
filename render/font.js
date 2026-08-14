// A REAL GameMaker font asset — `fnt_mainbig`, which is what draws item names,
// ACT names and descriptions.
//
// CLAUDE.md has said for a while that "the only text still out of reach is
// anything drawn with a REAL font asset", on the grounds that extracting one
// means a texture page plus glyph metrics out of the FONT chunk. That turned
// out to be about forty lines of C# (`extract_font.csx`) rather than a project,
// and until it was done the item menu drew coloured chips instead of names —
// a placeholder standing in for something entirely gettable.
//
// A GameMaker font is a texture region plus one Glyph per character:
//
//     c        the code point
//     x y w h  its rect inside the font's own page region
//     shift    the ADVANCE — how far the pen moves after drawing it
//     offset   a horizontal bearing applied before drawing
//
// `shift` and `w` are different numbers and using `w` as the advance is the
// classic way to get text that looks subtly crushed: 'A' is 12 wide and
// advances 14, and a space has w = 0 but shift = 9, so a `w`-based layout
// deletes every space in the string.
//
// `draw_text_transformed(x, y, s, xscale, 1, 0)` is what the item menu uses,
// with `xscale = min(1, 200 / string_width(s))` — names are SQUEEZED to fit
// their column rather than clipped or wrapped. `DeluxeDinner` is comfortably
// under 200 at this size so it never triggers, but the rule is cheap to honour
// and the alternative is text quietly overflowing into the next column.

const fontCaches = new Map();

/**
 * Load the font once. Returns null until it resolves, and the caller draws
 * nothing rather than substituting a system typeface — a wrong font is worse
 * than no font, because it looks deliberate.
 */
export function loadFont(base = '../assets/fonts', name = 'fnt_mainbig') {
  if (fontCaches.has(name)) return fontCaches.get(name);
  const f = { ready: false, glyphs: new Map(), img: null, meta: null };
  fontCaches.set(name, f);

  fetch(new URL(`${base}/${name}.json`, import.meta.url))
    .then((r) => r.json())
    .then((meta) => {
      f.meta = meta;
      for (const g of meta.glyphs) f.glyphs.set(g.c, g);
      const img = new Image();
      img.onload = () => { f.img = img; f.ready = true; };
      img.src = new URL(`${base}/${name}.png`, import.meta.url).href;
    })
    .catch(() => { /* no font: every draw below is a no-op */ });

  return f;
}

/** `string_width(s)` — the sum of the advances, kerning included. */
export function textWidth(font, text) {
  if (!font || !font.glyphs.size) return 0;
  let w = 0;
  let prev = null;
  for (const ch of String(text)) {
    const g = font.glyphs.get(ch.codePointAt(0));
    if (!g) continue;
    if (prev && prev.kern) w += prev.kern[ch.codePointAt(0)] ?? 0;
    w += g.shift;
    prev = g;
  }
  return w;
}

/** The font's line height — the tallest glyph, which is what GML reports. */
export function textHeight(font) {
  if (!font || !font.meta) return 0;
  let h = 0;
  for (const g of font.meta.glyphs) if (g.h > h) h = g.h;
  return h;
}

/**
 * `draw_text_transformed`, with `draw_set_color` folded in as `color`.
 *
 * The tint MULTIPLIES, like every other GML draw colour — see gm.js. Glyphs
 * are white-on-transparent, so multiplying by the colour is the whole effect,
 * but a `source-in` replace would also destroy the antialiased edges' alpha
 * ramp and leave the text looking bitten.
 */
export function drawText(ctx, font, text, x, y, {
  xscale = 1, yscale = 1, color = null, alpha = 1, halign = 'left',
  // obj_writer's layout, not draw_text's: a FIXED advance per character
  // (`wx += hspace` — 16 for the battle message's typer 6, 9 for the
  // balloons' 81) instead of the glyph's own shift, and `|` consumed as an
  // hspace-wide skip (the formatter's continuation indent under a "* ").
  advance = null,
} = {}) {
  if (!font || !font.ready || !font.img) return;

  let pen = x;
  if (halign !== 'left') {
    const w = textWidth(font, text) * xscale;
    pen -= halign === 'center' ? w / 2 : w;
  }

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;

  let prev = null;
  for (const ch of String(text)) {
    if (advance != null && ch === '|') {
      pen += advance * xscale;
      continue;
    }
    const code = ch.codePointAt(0);
    const g = font.glyphs.get(code);
    if (!g) continue;
    if (prev && prev.kern) pen += (prev.kern[code] ?? 0) * xscale;
    if (g.w > 0 && g.h > 0) {
      ctx.drawImage(
        color ? tintedPage(font, color) : font.img,
        g.x, g.y, g.w, g.h,
        pen + g.offset * xscale, y, g.w * xscale, g.h * yscale,
      );
    }
    pen += (advance != null ? advance : g.shift) * xscale;
    prev = g;
  }
  ctx.restore();
}

// One tinted copy of the WHOLE page per colour, not per glyph. The page is
// 256x256 and the menu uses two colours, so this is two canvases for the
// lifetime of the process rather than a canvas per character per frame.
const pageCache = new Map();
function tintedPage(font, color) {
  const key = `${font.meta?.name}|${color}`;
  let c = pageCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = font.img.width;
  c.height = font.img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(font.img, 0, 0);
  g.globalCompositeOperation = 'multiply';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(font.img, 0, 0);
  pageCache.set(key, c);
  return c;
}
