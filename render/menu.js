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

import { drawSpriteExt, rgb, c_white } from './draw/gm.js';
import { formatWriter, revealed } from '../sim/dialogue.js';
import { PARTY } from '../sim/damage.js';
import { BUTTONS, CHAR_COLOR, PARTY_SPRITES, listRows } from '../sim/menu.js';
import { SPELLS, spellCost } from '../sim/spells.js';
import { MAX_TENSION } from '../sim/tension.js';
import { KNIGHT_MAXHP } from '../sim/knight.js';
import { drawSpriteText, FONTS } from './text.js';
import { loadFont, drawText, textWidth, textHeight } from './font.js';

const BP = 152;
const CHUNK = [0, 213, 426];
const PANEL_W = 212;
/** `global.fighting == 0` for the whole of the menu and bullet phases. */
/**
 * `b_offset` — where the name/HP strip sits. IT IS CONDITIONAL, and 430 is
 * the wrong branch for a battle.
 *
 *     // scr_charbox
 *     b_offset = 480;
 *     if (global.fighting == 0) b_offset = 430;
 *     if (global.fighting == 1) b_offset = 336;
 *     ...
 *     draw_sprite(spr_headkris, ..., xx + 13 + xchunk, bpoff + b_offset + mmy[c]);
 *
 * and `bpoff = -bp + bpy + yy` (obj_battlecontroller's Draw) is ZERO, since
 * bp and bpy are both 152 and the view y is 0. So the strip is at b_offset
 * itself: 336 in a fight, 430 outside one.
 *
 * This was hardcoded to 430 — over a hundred pixels too low, which is why the
 * icons and HP bars sat far below the button row instead of beside it, and
 * why anything drawn in the real message band appeared to collide with them.
 *
 * MEASURED, not derived: reference/flipped_oracle_shot_140.png from the real
 * game puts the unraised strip at ~332 and Kris's raised box at ~300, which
 * is 336 and 336 - 32 (see the mmy note in sim/menu.js — the raise stops at
 * 32, and the -64 clamp is unreachable). The panel row above it is at
 * 480 - 152 = 328, so the strip and the buttons share a band, as the
 * screenshot shows.
 */
const B_OFFSET = 336;
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
    // The DISPLAYED cost has to be the one that will actually be charged —
    // Devilsknife turns Rude Buster's 50% into 40%, and a menu that still
    // says 50% is lying about the only stat that item exists for.
    const pct = Math.floor((spellCost(state, menu.charturn, sel.id) / MAX_TENSION) * 100);
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
  // bmenuno 7's REAL layout (obj_battlecontroller Draw — issue #2): three
  // rows in the band, one per party member, the heart on the chosen row:
  //
  //     heart   (xx + 55, yy + 385 + coord * 30)
  //     name    (xx + 80, yy + 375 + i * 30)   c_white, mainbig
  //     trough  (xx + 400 .. 500, yy + 380 + i*30, 15 tall)   c_maroon
  //     fill    xx + 400 -> 400 + hp%                          c_lime
  //
  // FAITHFUL ODDITY: `_hp` is hp/maxhp*100 clamped only at -100, so a
  // SWOONED member's lime fill extends LEFTWARD out of the trough — the
  // original draws the negative rectangle and so does this. The fallen stay
  // selectable (a DeluxeDinner on a swooned ally is the point of carrying
  // one; scr_heal adds to the negative number).
  const menu = state.menu;
  const heart = sprites.get('spr_heart');
  for (let i = 0; i < 3; i++) {
    const y = 375 + i * 30;
    drawText(ctx, font, PARTY[i].name, 80, y, { color: '#ffffff' });
    ctx.fillStyle = '#800000'; // c_maroon
    ctx.fillRect(400, y + 5, 101, 16);
    let hpPct = ((state.partyHp?.[i] ?? 0) / PARTY[i].maxhp) * 100;
    if (hpPct <= -100) hpPct = -100;
    ctx.fillStyle = '#00ff00'; // c_lime
    if (hpPct >= 0) ctx.fillRect(400, y + 5, hpPct + 1, 16);
    else ctx.fillRect(400 + hpPct, y + 5, -hpPct + 1, 16);
  }
  if (heart) {
    drawSpriteExt(ctx, heart, 0, 55, 385 + menu.targetIndex * 30, 1, 1, 0, null, 1);
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

/**
 * obj_battlecontroller's Draw, `intro == 1` — the bottom band RISES at battle
 * start: `bp` climbs 0 -> 152 at +30 a frame, easing by `round(d / 2.5)` once
 * within 40, and every charbox coordinate carries a `(480 - bp)` or
 * `bpoff = -bp + bpy` term. The series is 0, 30, 60, 90, 120, 133, 141, 145,
 * 148, 150, 151, 152 — eleven frames. A pure function of the sim frame (the
 * 30Hz rule), so R-reset replays it exactly as a fresh battle does.
 *
 * The battle MESSAGE does not ride it — scr_battletext's writer is created at
 * a fixed (30, 376) — which is why the translate below is cancelled before
 * the full-width lists are drawn.
 */
function panelRise(frame) {
  if (frame >= 12) return 0;
  let bp = 0;
  for (let i = 0; i < frame; i++) {
    if (bp < 151) {
      const d = 152 - bp;
      bp += d < 40 ? Math.round(d / 2.5) : 30;
    } else {
      bp = 152;
    }
  }
  return 152 - bp;
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
  const rise = panelRise(state.frame ?? 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (rise) ctx.translate(0, rise);

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
    // ALWAYS DRAWN. This used to `continue` whenever a submenu or the FIGHT
    // bar was up, on a misread of scr_charbox: the mmy = -170 slide that
    // empties the band belongs to the ROUXLS-GRID branch
    // (`rouxlsgridenabled`), which this fight never enables. Here the active
    // character's panel rises 32px (mmy -> -32) and everyone's strip keeps
    // drawing at its mmy offset — which is why selecting FIGHT in the real
    // game leaves the portraits, names, HP and button icons all on screen.
    // The player report was exact: "during selecting attacks the icons and
    // menu stuff disappear".

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
    // RAW, INCLUDING THE NEGATIVE. scr_charbox draws
    // `string(global.hp[c + 1])` with no clamp, so a swooned ally reads -999
    // and a downed Kris reads -80 — that number IS the fight telling you who
    // can still be brought back (see scr_heal's revive gate). Clamping it to
    // 0 hid the whole swoon economy; reported as "the health is going to
    // zero, but it should go to -999".
    const shown = hp;
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

  // The lists are full-width over the band, not panel decoration — and they
  // are anchored at a FIXED y (375/376), not at (480 - bp), so the intro rise
  // stops here.
  if (rise) ctx.translate(0, -rise);
  const font = loadFont();
  if (menu.open && (menu.submenu === 'item' || menu.submenu === 'magic' || menu.submenu === 'act')) {
    drawItemList(ctx, state, sprites, font, menu.siner);
  } else if (menu.open && menu.submenu === 'target') {
    drawTargetPicker(ctx, state, sprites, font);
  } else if (menu.open && menu.submenu === 'enemy') {
    drawEnemyRow(ctx, state, sprites, font);
  } else if (menu.open) {
    drawBattleMsg(ctx, state, font);
  }

  ctx.restore();
}

/**
 * THE FLAVOUR LINE — `global.battlemsg[0]`, shown over the button row.
 *
 *     // scr_battletext
 *     battlewriter = instance_create(xx + 30, yy + 376, obj_writer);
 *
 * The same y band as the item list (375), which is why only one of them is
 * ever on screen: the lists replace the message rather than sitting beside
 * it. That is also why this draws in the `else` arm above.
 *
 * `&` is the line break in these strings, as it is in the Susie dialogue —
 * NOT `#`, which is what the item descriptions use. Two different break
 * characters in the same UI, from two different string sources.
 *
 * The message is not cleared between turns (nothing assigns "" to
 * `global.battlemsg[0]`), so whatever was last set stays up — including
 * through turns that set nothing.
 */
function drawBattleMsg(ctx, state, font) {
  if (!font?.ready || !state.battlemsg) return;
  // LINE SPACING IS THE WRITER'S `vspace`, NOT THE FONT'S HEIGHT.
  //
  //     obj_writer Create:  vspace = 18;
  //     obj_writer Draw:    charline = 26;
  //                         if (global.fc == 22) { charline = 30;
  //                             vspace = 28; if (i_ex(obj_writer)) vspace = 30; }
  //
  // `global.fc` selects the speaker's face and, with it, the spacing. The
  // Susie exchange sets `fc = 22` (the enemy-talk branch) and so runs at 30;
  // the battle MESSAGE sets `fc = 0` in the turn-end block
  // (`global.typer = 6; global.fc = 0;`) and so runs at the Create default.
  //
  // Using the font's own height (32 here) put the second line's glyphs into
  // the charbox HP strip at y 430-449 — visible overlap, caught by looking at
  // the render rather than by any test.
  //
  // 18 IS RIGHT, and the charbox proves it. The strip sits at y 430-449, so
  // two lines at 376 have to fit above it:
  //
  //     vspace 18  ->  lines at 376 and 394, glyphs ending ~426   fits
  //     vspace 30  ->  lines at 376 and 406, glyphs ending ~438   COLLIDES
  //
  // 30 was used here first, borrowed from the fc == 22 path, and it put the
  // second line straight through the party's names — which is what the
  // spacing is chosen to avoid. The game's own number for this message is the
  // one that clears the strip.
  // TYPER 6 — the battle message's writer, from scr_texttype:
  //
  //     case 6: scr_textsetup(scr_84_get_font("mainbig"), c_white, x, y,
  //                           33, 0, 1, snd_text, 16, 36, 1);
  //
  // charline 33, rate 1 (one character a frame), hspace 16, vspace 36 —
  // scr_textsetup runs at the writer's birth and OVERRIDES the Create
  // defaults this block used to quote (vspace 18 was the pre-override
  // default, and 18px lines under 26px glyphs is exactly the "text is too
  // close together" a player reported). The advance is the writer's fixed
  // hspace, not the glyph's shift — obj_writer moves `wx += hspace` per
  // character — which is the letter-spacing the same report called out.
  //
  // The string is wrapped by the writer's own formatter (charline 33, last
  // space becomes the break, `||` hangs the continuation under the "* ") —
  // the dump's strings arrive unsplit and were drawn off the canvas edge.
  const lh = 36;
  const formatted = formatWriter(state.battlemsg, 33);
  // Typed, not shown: one character a frame from the moment the message was
  // set. The director owns the clock (state.battlemsgTimer).
  // rate 1: ONE character a frame (scr_textsetup arg 6), not the balloons' 2.
  const lines = revealed(formatted, state.battlemsgTimer ?? 1e9, 1);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    drawText(ctx, font, lines[i], 30, 376 + i * lh, { color: rgb(c_white), advance: 16 });
  }
}
