// THE CHARBOX ROW — `scr_charbox`, drawn at its own coordinates.
//
// Every number here is out of the dump. The two that set everything else:
//
//     bp = bpy = 152          obj_battlecontroller Create/Draw
//     bpoff = -bp + bpy + yy  == yy, the camera's y (0 here)
//
// so the panel row sits at 480 - 152 = 328, and `b_offset` — 430 while
// `global.fighting == 0`, which is the whole menu-and-bullets phase — puts the
// name and HP strip at 430. Those are two separate bands, not one panel: the
// buttons live in the raised box at 325-361 and the portrait/HP row runs along
// the bottom at 430-449.
//
// The three panels are 212 wide at x 0, 213 and 426 (`xchunk` for
// `chartotal == 3`).

import { drawSpriteExt, rgb } from './draw/gm.js';
import { PARTY } from '../sim/damage.js';
import { BUTTONS, CHAR_COLOR, PARTY_SPRITES, listRows } from '../sim/menu.js';
import { SPELLS } from '../sim/spells.js';
import { MAX_TENSION } from '../sim/tension.js';
import { KNIGHT_MAXHP } from '../sim/knight.js';
import { drawSpriteText, FONTS } from './text.js';
import { loadFont, drawText, textWidth, textHeight } from './font.js';

const BP = 152;
const CHUNK = [0, 213, 426];
const PANEL_W = 212;
/** `global.fighting == 0` for the whole of the menu and bullet phases. */
const B_OFFSET = 430;
/** c_maroon — GameMaker packs BGR, so 0x000080 is RGB(128, 0, 0). */
const MAROON = 'rgb(128,0,0)';
/** `bcolor` — obj_battlecontroller's band colour, c_navy. */
const BCOLOR = [0, 0, 128];

/**
 * `scr_selectionmatrix(x, y)` — the active panel's highlight.
 *
 * A solid colour bar across the panel's top edge, then TWELVE pulsing vertical
 * lines: two pinned to the panel's sides and, for the half of each cycle where
 * `cos < 0`, two more sweeping inward from 30px in. `s_siner += 2` per frame
 * and each line is phase-shifted by `i * 10 * pi`, so they chase each other
 * along the panel rather than blinking together.
 */
function selectionMatrix(ctx, x, y, siner, color) {
  ctx.save();
  ctx.fillStyle = rgb(color);
  ctx.fillRect(x, y, 210, 3);
  ctx.strokeStyle = rgb(color);
  ctx.lineWidth = 2;
  for (let i = 0; i < 12; i++) {
    const m = siner + i * (10 * Math.PI);
    ctx.globalAlpha = Math.max(0, Math.min(1, Math.sin(m / 60)));
    const line = (lx, y0, y1) => {
      ctx.beginPath();
      ctx.moveTo(lx, y0);
      ctx.lineTo(lx, y1);
      ctx.stroke();
    };
    line(x, y - 3, y + 33);
    line(x + 211, y - 3, y + 33);
    if (Math.cos(m / 60) < 0) {
      line(x - Math.sin(m / 60) * 30 + 30, y, y + 33);
      line(x + 210 + Math.sin(m / 60) * 30 - 30, y, y + 33);
    }
  }
  ctx.restore();
}

/**
 * THE ITEM LIST — `obj_battlecontroller`'s Draw, `global.bmenuno == 4`.
 *
 * This is not part of the charbox and does not live inside a panel. It is a
 * full-width list drawn straight over the bottom of the view:
 *
 *     names      xx + 30 and xx + 260, at yy + 375 + i * 30   (375/405/435)
 *     cursor     spr_heart at (10 | 230, 385 | 415 | 445)
 *     page arrow spr_morearrow at (470, 445), bobbing on sin(s_siner / 10) * 2
 *     desc       c_gray at (xx + 496, yy + 375)
 *
 * SIX SLOTS PER PAGE over two pages, which is the part the placeholder version
 * got structurally wrong — it drew all twelve at once as 5px chips crammed
 * into a 34px panel, so the bag looked like a bar chart. The page arrow is the
 * only thing that tells you there are six more.
 *
 * THE ARROW FLIPS RATHER THAN CHANGING SPRITE: page 1 draws the same
 * `spr_morearrow` at `yscale -1` and higher up, and its bob is INVERTED
 * (`- sin` against `+ sin`) so the two pages' arrows lean away from the list
 * in opposite directions rather than both pointing down.
 *
 * Names are squeezed with `xscale = min(1, 200 / string_width(s))` — the
 * column is 200 wide and a long name is compressed, never clipped.
 */
function drawItemList(ctx, state, sprites, font, siner) {
  const menu = state.menu;
  // ONE LIST RENDERER FOR ALL THREE. bag, MAGIC and ACT are the same 2x6 grid
  // at the same coordinates with the same cursor — the original writes three
  // near-identical Draw blocks for `bmenuno` 4, 2 and 9.
  const rows = listRows(state);
  const coord = menu.gridIndex ?? 0;
  const page = coord > 5 ? 1 : 0;
  const local = coord - page * 6;

  // The heart cursor. Its x is the COLUMN and its y the row pair, and the
  // three y values are 30 apart like the rows but offset 10px down from them.
  const icx = local % 2 === 1 ? 230 : 10;
  const icy = local > 3 ? 445 : local > 1 ? 415 : 385;
  const heart = sprites.get('spr_heart');
  if (heart) drawSpriteExt(ctx, heart, 0, icx, icy, 1, 1, 0, null, 1);

  for (let i = 0; i < 3; i++) {
    for (let col = 0; col < 2; col++) {
      const row = rows[page * 6 + i * 2 + col];
      if (!row) continue;
      const w = textWidth(font, row.label);
      // `min(1, 200 / width)` — only ever squeezes, never stretches.
      const xscale = w > 0 ? Math.min(1, 200 / w) : 1;
      // A SPELL YOU CANNOT AFFORD IS SHOWN AND GREYED, not hidden. The grey is
      // `draw_set_color(c_gray)` — the TEXT COLOUR, not an alpha:
      //
      //     if (global.tension < global.spellcost[thischar][...])
      //         draw_set_color(c_gray);
      //
      // which reads as "disabled" rather than "fading out", and keeps the
      // glyph edges crisp against the black band.
      drawText(ctx, font, row.label, col === 0 ? 30 : 260, 375 + i * 30,
        { xscale, color: row.usable ? '#ffffff' : 'rgb(128,128,128)' });
    }
  }

  const arrow = sprites.get('spr_morearrow');
  const bob = Math.sin(siner / 10) * 2;
  if (arrow) {
    if (page === 0 && rows.length > 6) {
      drawSpriteExt(ctx, arrow, 0, 470, 445 + bob, 1, 1, 0, null, 1);
    } else if (page === 1) {
      drawSpriteExt(ctx, arrow, 0, 470, 395 - bob, 1, -1, 0, null, 1);
    }
  }

  // The description, in c_gray, at `xx + spell_offset` = 496.
  //
  // `#` is GameMaker's line break inside a literal, and `draw_text` breaks at
  // the FONT's line height — not at the 30px the list rows use. Those two
  // numbers have different sources and only coincide by accident, so the
  // description steps by the font's own height rather than borrowing the row
  // pitch.
  const sel = rows[coord];
  if (sel) {
    const lh = textHeight(font) || 26;
    const lines = (sel.descb ?? '').split('#');
    for (let i = 0; i < lines.length; i++) {
      drawText(ctx, font, lines[i], 496, 375 + i * lh, { color: 'rgb(128,128,128)' });
    }
  }

  // THE TP COST IS DRAWN ONCE, under the description, as a PERCENTAGE:
  //
  //     thiscost = floor((spellcost / global.maxtension) * 100);
  //     draw_set_color(c_orange);
  //     draw_text(xx + spell_offset, yy + 440, string(thiscost) + "% TP");
  //
  // Not once per row beside the name, which is where this renderer first put
  // it — at 200px columns the cost and a long name collide, and the original
  // avoids that by only ever showing the SELECTED spell's cost. It is also a
  // percentage, so Rude Buster reads "50% TP" rather than its raw 125.
  if (menu.submenu === 'magic' && sel && SPELLS[sel.id]) {
    const pct = Math.floor((SPELLS[sel.id].cost / MAX_TENSION) * 100);
    drawText(ctx, font, `${pct}% TP`, 496, 440, { color: 'rgb(255,160,64)' });
  }
}


/**
 * THE TARGET PICKER — the heart cursor moved onto a party member's panel.
 *
 * With one enemy the enemy picker has nothing to choose, so the only prompt
 * that appears in this fight is the ally one. It draws over the charbox row,
 * with `spr_heart` beside the chosen member's name.
 *
 * IT OFFERS THE FALLEN, deliberately: a DeluxeDinner on a SWOONed ally is the
 * whole reason to carry single-target heals, since `scr_heal` adds to the
 * negative number. A picker that skipped downed members would make ReviveMint
 * unusable.
 */
function drawTargetPicker(ctx, state, sprites, font) {
  const menu = state.menu;
  const heart = sprites.get('spr_heart');
  for (let c = 0; c < 3; c++) {
    const x = CHUNK[c];
    const hp = state.partyHp?.[c] ?? 0;
    const down = hp <= 0;
    // A downed member is dimmed but still selectable — the dimming says
    // "this one is out", not "you cannot pick this one".
    ctx.globalAlpha = down ? 0.55 : 1;
    drawText(ctx, font, PARTY[c].name.toUpperCase(), x + 40, 385,
      { color: down ? '#ff0000' : '#ffffff' });
    drawText(ctx, font, `${Math.max(hp, 0)} / ${PARTY[c].maxhp}`, x + 40, 415,
      { color: down ? '#ff0000' : '#ffffff' });
    ctx.globalAlpha = 1;
    if (menu.targetIndex === c && heart) {
      drawSpriteExt(ctx, heart, 0, x + 20, 388, 1, 1, 0, null, 1);
    }
  }
}

/**
 * THE ENEMY ROW — `obj_battlecontroller`'s Draw, `__drawstatus == 0`.
 *
 * The row FIGHT opens, and the only place the fight tells you anything about
 * the Knight's condition:
 *
 *     name      xx + 80
 *     comment   xx + 80 + namewidth + 60, c_gray
 *     trough    (420, 380) to (500, 395)          c_maroon, 80 wide
 *     fill      420 -> 420 + (hp / maxhp) * 80    c_lime
 *     "HP"      (424, 364)   yscale 0.5
 *     "???"     (424, 380)   yscale 0.5
 *
 * **THE BAR IS HONEST, THE NUMBER IS NOT.** For the Knight the percentage is
 * replaced with a literal `"???"` — but the lime fill still tracks
 * `monsterhp / monstermaxhp` exactly. You can watch the bar move and never be
 * told by how much, which is the whole design of a 7300-HP enemy whose damage
 * numbers are also suppressed.
 *
 * Both texts are drawn with `draw_text_transformed(..., 1, 0.5, 0)` — SQUASHED
 * TO HALF HEIGHT. At this font's 24px that is what makes them fit in a 15px
 * bar, and drawing them at full height overflows the row.
 */
function drawEnemyRow(ctx, state, sprites, font) {
  const heart = sprites.get('spr_heart');
  if (heart) drawSpriteExt(ctx, heart, 0, 10, 385, 1, 1, 0, null, 1);

  // The name is EMPTY at setup — `global.monstername[myself] = ""` — and
  // obj_knight_enemy's Step fills it in with "Knight" on the frame
  // `damagereductiontimer` first ticks, i.e. once the fight proper starts.
  //
  // NO COMMENT IS DRAWN. `global.monstercomment` defaults to a single space
  // (`scr_monster_statreset`) and only ever becomes "(Tired)" or "(Warned)",
  // neither of which this fight can produce. A first pass here invented a
  // flavour line, which is exactly what rule 5 forbids.
  drawText(ctx, font, 'Knight', 80, 375, { color: '#ffffff' });

  ctx.fillStyle = MAROON;
  ctx.fillRect(420, 380, 80, 15);
  const hp = state.knight?.hp ?? KNIGHT_MAXHP;
  ctx.fillStyle = 'rgb(0,255,0)'; // c_lime
  ctx.fillRect(420, 380, Math.max(0, (hp / KNIGHT_MAXHP) * 80), 15);

  drawText(ctx, font, 'HP', 424, 364, { yscale: 0.5, color: '#ffffff' });
  drawText(ctx, font, '???', 424, 380, { yscale: 0.5, color: '#ffffff' });
}

export function drawMenu(ctx, state, sprites) {
  const menu = state.menu;
  if (!menu) return;
  // obj_battlecontroller's Draw, FIRST LINES:
  //     if (instance_exists(obj_knight_enemy)
  //         && obj_knight_enemy.end_cutscene_version > 0) exit;
  // The whole battle UI goes at once when the fight ends.
  if (state.knight?.endCutscene > 0) return;

  const top = 480 - BP; // 328
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // THE BOTTOM BAND, drawn before anything else in it:
  //
  //     draw_rectangle(xx - 10, 481, xx + 700, (480 - bp) - 4, false)   black
  //     draw_rectangle(xx - 10, 480 - bp - 3, xx + 700, 480 - bp - 2)   bcolor
  //     draw_rectangle(xx - 10, 480 - bp + 34, xx + 700, 480 - bp + 36) bcolor
  //
  // Two hairlines bracketing the button row, and a black field under
  // everything. Without the field the item list is drawn over live bullets —
  // the arena extends behind it.
  ctx.fillStyle = '#000000';
  ctx.fillRect(-10, top - 4, 710, 481 - (top - 4));
  ctx.fillStyle = rgb(BCOLOR);
  ctx.fillRect(-10, top - 3, 710, 1);
  ctx.fillRect(-10, top + 34, 710, 2);

  for (let c = 0; c < 3; c++) {
    const chunk = CHUNK[c];
    const mmy = menu.mmy[c];
    const color = CHAR_COLOR[c];
    const active = menu.open && menu.charturn === c;

    // The panel. NOTE the border's bottom edge does NOT take mmy while the
    // black fill does — so as the panel rises the coloured band grows out from
    // under it instead of the whole thing sliding. That is what gives the
    // raised panel its outline.
    ctx.fillStyle = rgb(active ? color : [128, 128, 128]);
    ctx.fillRect(chunk, top - 3 + mmy, PANEL_W, top - 2 - (top - 3 + mmy));
    ctx.fillStyle = '#000000';
    ctx.fillRect(chunk + 2, top - 1 + mmy, 208, 34);

    if (active && menu.submenu) {
      // The panel stays and keeps its highlight; the BAG is not drawn here —
      // it is a full-width list over the whole band, outside this loop.
      selectionMatrix(ctx, chunk, top, menu.siner, color);
    } else if (active) {
      selectionMatrix(ctx, chunk, top, menu.siner, color);

      // The five buttons, at 15/50/85/120/155. Frame 1 is the lit version;
      // `btc[]` selects it in the original (an array scr_charbox reads and
      // nothing in the dump writes — the lit button is driven from the menu's
      // own selection here).
      for (let b = 0; b < BUTTONS.length; b++) {
        const spec = BUTTONS[b];
        const entry = sprites.get(spec.sprite(c));
        if (!entry) continue;
        const lit = menu.selected[c] === b ? 1 : 0;
        drawSpriteExt(ctx, entry, lit, chunk + spec.x, 485 - BP, 1, 1, 0, null, 1);
      }
    }

    // ---- the portrait / name / HP strip -------------------------------------
    //
    // HIDDEN WHILE THE BAND IS IN USE. `scr_charbox` slides `mmy[c]` to
    // **-170** in its else branch — the strip travels up and off the band
    // entirely — and that is what makes room for the two things that occupy
    // the same pixels:
    //
    //   * the ITEM list, whose third row sits at y 435
    //   * the FIGHT bar, whose third row sits at y 441
    //
    // The strip is y 430-449, so it collides with both. The game is never
    // showing the strip and either of them at once.
    if ((menu.open && menu.submenu) || state.fightBar) continue;

    const stats = PARTY_SPRITES[c];
    const head = sprites.get(stats.head);
    const name = sprites.get(stats.name);
    if (head) drawSpriteExt(ctx, head, 0, chunk + 13, B_OFFSET + mmy, 1, 1, 0, null, 1);
    if (name) drawSpriteExt(ctx, name, 0, chunk + 51, B_OFFSET + 3 + mmy, 1, 1, 0, null, 1);

    const hp = state.partyHp?.[c] ?? 0;
    const maxhp = PARTY[c].maxhp;

    // THE NUMBERS. `draw_set_halign(fa_right)` covers BOTH — the current value's
    // right edge at x+160 and the max's at x+205 — so they grow leftward and
    // the slash between them never moves.
    //
    // The colour is a threshold, not a gradient: white normally, YELLOW at or
    // under a quarter health, RED at zero.
    const shown = Math.max(hp, 0);
    let hpColor = '#ffffff';
    if (hp / maxhp <= 0.25) hpColor = '#ffff00'; // c_yellow
    if (hp <= 0) hpColor = '#ff0000'; // c_red
    drawSpriteText(ctx, sprites, FONTS.hp, shown, chunk + 160, B_OFFSET - 2 + mmy,
      { halign: 'right', color: hpColor });
    drawSpriteText(ctx, sprites, FONTS.hp, maxhp, chunk + 205, B_OFFSET - 2 + mmy,
      { halign: 'right', color: hpColor });

    const hpname = sprites.get('spr_hpname');
    if (hpname) drawSpriteExt(ctx, hpname, 0, chunk + 109, B_OFFSET + 11 + mmy, 1, 1, 0, null, 1);
    const slash = sprites.get('spr_hpslash');
    if (slash) drawSpriteExt(ctx, slash, 0, chunk + 159, B_OFFSET - 4 + mmy, 1, 1, 0, null, 1);

    // The bar: a maroon trough 75 wide, filled to `ceil(hp / maxhp * 75)`.
    ctx.fillStyle = MAROON;
    ctx.fillRect(chunk + 128, B_OFFSET + 11 + mmy, 75, 8);
    if (hp > 0) {
      ctx.fillStyle = rgb(color);
      ctx.fillRect(chunk + 128, B_OFFSET + 11 + mmy, Math.ceil((hp / maxhp) * 75), 8);
    }
  }

  // The lists are full-width over the band, not panel decoration.
  const font = loadFont();
  if (menu.open && (menu.submenu === 'item' || menu.submenu === 'magic' || menu.submenu === 'act')) {
    drawItemList(ctx, state, sprites, font, menu.siner);
  } else if (menu.open && menu.submenu === 'target') {
    drawTargetPicker(ctx, state, sprites, font);
  } else if (menu.open && menu.submenu === 'enemy') {
    drawEnemyRow(ctx, state, sprites, font);
  }

  ctx.restore();
}
