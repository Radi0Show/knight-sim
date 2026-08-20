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
export function loadFont(base = new URL('../assets/fonts', import.meta.url).href, name = 'fnt_mainbig') {
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
  // (`wx += hspace` — 16 for the battle message's typer 4, 9 for the
  // balloons' 81) instead of the glyph's own shift, and `|` consumed as an
  // hspace-wide skip (the formatter's continuation indent under a "* ").
  advance = null,
  // scr_textsetup's ELEVENTH argument, per typer. See SPECIAL below.
  special = 0,
  // `siner`, for special 2's pulse — obj_writer increments it once a frame.
  siner = 0,
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
      const gx = pen + g.offset * xscale;
      const blit = (src, dx, dy, a) => {
        ctx.globalAlpha = a;
        ctx.drawImage(src, g.x, g.y, g.w, g.h, dx, dy, g.w * xscale, g.h * yscale);
      };
      // SPECIAL 1 — the drop shadow, drawn BEFORE the glyph and per
      // character, exactly where the original's loop puts it.
      if (special === 1) blit(shadowPage(font), gx + xscale, y + yscale, alpha);
      // SPECIAL 2 — the pulsing glow: the four cardinals, then the four
      // diagonals, then the solid glyph last.
      if (special === 2) {
        const page = color ? tintedPage(font, color) : font.img;
        const near = (0.3 + Math.sin(siner / 14) * 0.1) * alpha;
        const far = (0.08 + Math.sin(siner / 14) * 0.04) * alpha;
        blit(page, gx + xscale, y, near);
        blit(page, gx - xscale, y, near);
        blit(page, gx, y + yscale, near);
        blit(page, gx, y - yscale, near);
        blit(page, gx + xscale, y + yscale, far);
        blit(page, gx - xscale, y - yscale, far);
        blit(page, gx - xscale, y + yscale, far);
        blit(page, gx + xscale, y - yscale, far);
      }
      blit(color ? tintedPage(font, color) : font.img, gx, y, alpha);
    }
    pen += (advance != null ? advance : g.shift) * xscale;
    prev = g;
  }
  ctx.restore();
}

/**
 * THE TEXT SHADOW — scr_textsetup's eleventh argument, `special`, which the
 * typer table hands out and which nothing in this renderer read until now.
 *
 *     case 4:  scr_textsetup(mainbig, c_white, ..., snd_text, 16, 28, 1);
 *     case 6:  scr_textsetup(mainbig, c_white, ..., snd_text, 16, 36, 1);
 *
 * Typer 6 is the DARK-ZONE speaker — Susie and Ralsei at the ending — and it
 * is also the battle message box. Both are `special = 1`, and obj_writer's
 * Draw spends that on:
 *
 *     if (draw_get_color() != c_white && draw_get_color() != c_black) {
 *         ...a faint tinted copy...
 *     } else {
 *         draw_text_color(wx + 1, wy + 1, mychar, c_dkgray, c_dkgray,
 *                                                 c_navy,   c_navy, 1);
 *         draw_text(wx, wy, mychar);
 *     }
 *
 * White text takes the ELSE: a full-alpha copy one pixel down and right, in a
 * VERTICAL GRADIENT from c_dkgray at the glyph's top to c_navy at its bottom
 * — `$404040` is rgb(64,64,64) and `$800000` is rgb(0,0,128), BGR as every
 * GML colour literal is. So the shadow is grey where it meets the letter and
 * dark blue where it falls away, which is what gives dark-world dialogue its
 * slight lift off the black.
 *
 * The gradient resets PER GLYPH, so it cannot be one flat tint of the page.
 * It can be one gradient-shaded COPY of the page: each glyph's rect gets its
 * own ramp from its own top to its own bottom, `destination-in` restores the
 * page's alpha, and the result is cached for the process like tintedPage.
 */
const shadowCache = new Map();
function shadowPage(font) {
  const key = font.meta?.name ?? 'font';
  let c = shadowCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = font.img.width;
  c.height = font.img.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  for (const gl of font.meta.glyphs) {
    if (!(gl.w > 0 && gl.h > 0)) continue;
    const grad = g.createLinearGradient(0, gl.y, 0, gl.y + gl.h);
    grad.addColorStop(0, 'rgb(64,64,64)'); // c_dkgray
    grad.addColorStop(1, 'rgb(0,0,128)'); // c_navy
    g.fillStyle = grad;
    g.fillRect(gl.x, gl.y, gl.w, gl.h);
  }
  // The glyphs are white-on-transparent, so a MULTIPLY by the ramp and a
  // straight fill masked to the page's alpha come out the same; this is the
  // second, and it keeps the antialiased edge ramps intact.
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(font.img, 0, 0);
  shadowCache.set(key, c);
  return c;
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
