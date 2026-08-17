// THE TITLE SCREEN and the GAME OVER screen, both drawn on the canvas with
// the game's own assets rather than as HTML over it.
//
// `fnt_mainbig` for every word, `spr_heart` for the cursor, the dark-fountain
// background underneath. The alternative — CSS text in a web font — cannot
// match a sprite-based pixel font at 2x, and a menu that looks like a web page
// in front of a game that looks like DELTARUNE reads as two different products.
//
// THE PALETTE is the fight's own, not invented: `#27293F` is
// obj_bgfountaintest's `image_blend`, and the highlight yellow is GameMaker's
// `c_yellow`, which is what DELTARUNE's menus use for the selected row.

import { drawSpriteExt, rgb, c_white } from './draw/gm.js';
import { loadFont, drawText, textWidth, textHeight } from './font.js';
import {
  MODES, SETTINGS_PAGES, TITLE_EXTRAS, CREDITS, pocketOf, previewStats,
} from '../sim/modes.js';
import { difficultyBlurb } from '../sim/scenes/single.js';
import { WEAPONS, ARMOR, canEquip, itemOf } from '../sim/equipment.js';
import { PARTY } from '../sim/damage.js';

const BG = [0x27, 0x29, 0x3f];
const DIM = [128, 128, 138];
const HILITE = [255, 255, 0];

const W = 640;

/** Centre a line of the real font. */
function centred(ctx, font, text, y, color, scale = 1) {
  const w = textWidth(font, text) * scale;
  drawText(ctx, font, text, (W - w) / 2, y, { color: rgb(color), xscale: scale, yscale: scale });
}

export function drawTitle(ctx, title, sprites, attacks) {
  const font = loadFont();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // Only the fountain is behind this — the FIGHT is not drawn at all. Dimming
  // a live battle and putting a menu over it left the party, the HP bars, the
  // TP meter and a stray soul legible through the text, which reads as a pause
  // screen rather than a title.
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  if (!font?.ready) {
    ctx.restore();
    return;
  }

  if (title.settings) {
    drawSettings(ctx, title, sprites, font);
    ctx.restore();
    return;
  }

  centred(ctx, font, 'BLACK KNIFE SIMULATOR', 60, c_white, 1.6);

  const heart = sprites.get('spr_heart');
  const picked = attacks[title.attackIndex];
  let rows;
  let index;
  if (title.pickingDifficulty && picked) {
    // The third stage: the picked attack's difficulties, SHOWN 1-BASED — the
    // selector's raw values (0/3/4 for the tunnel) mean nothing to a player.
    // The blurb beside each is where that version runs in the real fight,
    // read off the selector's own table.
    rows = picked.difficulties.map((d, i) => ({
      name: `DIFFICULTY ${i + 1}`,
      blurb: difficultyBlurb(picked.ac, d),
    }));
    index = title.difficultyIndex;
    centred(ctx, font, picked.name.toUpperCase(), 136, DIM, 0.9);
  } else if (title.pickingAttack) {
    rows = attacks.map((a) => ({ name: a.name.toUpperCase(), blurb: a.where, unused: a.unused }));
    index = title.attackIndex;
  } else {
    rows = MODES.map((m) => ({ name: m.name, blurb: m.blurb }));
    index = title.index;
  }

  // A SCROLLING WINDOW, so the roster can grow without the list running off
  // the bottom or shrinking until it is unreadable. The alternative — packing
  // the pitch tighter every time an attack is added — is what the previous
  // version did, and it was already down to 24px with eleven entries.
  //
  // The idiom is the game's own item menu: a fixed window of rows with
  // `spr_morearrow` bobbing at the edge when there is more beyond it
  // (obj_battlecontroller's Draw, `bmenuno == 4` — the arrow is what tells you
  // a second page exists). The window follows the cursor rather than paging,
  // because the cursor WRAPS here and a paged view jumps two pages at the wrap.
  const WINDOW = 8;
  const pitch = rows.length > 6 ? 30 : 34;
  const top = title.pickingDifficulty ? 190 : 170;

  // Keep the cursor inside the window, and keep the window inside the list.
  let first = 0;
  if (rows.length > WINDOW) {
    first = Math.min(
      Math.max(0, index - Math.floor(WINDOW / 2)),
      rows.length - WINDOW,
    );
  }
  const last = Math.min(rows.length, first + WINDOW);

  for (let i = first; i < last; i++) {
    const y = top + (i - first) * pitch;
    const on = i === index;
    const x = 160;
    if (on && heart) {
      // The cursor BOBS, as every DELTARUNE menu cursor does.
      const bob = Math.sin(title.siner / 6) * 1.5;
      drawSpriteExt(ctx, heart, 0, x - 30 + bob, y + 4, 1, 1, 0, null, 1);
    }
    // UNUSED debug content is dimmed even at rest — labelled where the player
    // sees it, per the project rule.
    const restColor = rows[i].unused ? DIM : c_white;
    // Long names are SQUEEZED, never clipped — the item menu's own idiom
    // (`xscale = min(1, 200 / string_width)`), sized so the longest name
    // stops short of the blurb column.
    const squeeze = Math.min(1, 250 / Math.max(1, textWidth(font, rows[i].name)));
    drawText(ctx, font, rows[i].name, x, y, { color: rgb(on ? HILITE : restColor), xscale: squeeze });
    if ((title.pickingAttack || title.pickingDifficulty) && rows[i].blurb) {
      drawText(ctx, font, rows[i].blurb, 430, y + 3, { color: rgb(DIM), yscale: 0.75, xscale: 0.75 });
    }
  }

  // MORE ABOVE / MORE BELOW. `spr_morearrow` bobs on `sin(s_siner / 10) * 2`
  // in the item menu, and the upward one is the same sprite at `yscale -1`
  // with the bob INVERTED, so the two lean away from the list rather than
  // both pointing the same way.
  const arrow = sprites.get('spr_morearrow');
  if (arrow && rows.length > WINDOW) {
    const bob = Math.sin(title.siner / 10) * 2;
    if (first > 0) {
      drawSpriteExt(ctx, arrow, 0, 300, top - 22 - bob, 1, -1, 0, null, 1);
    }
    if (last < rows.length) {
      drawSpriteExt(ctx, arrow, 0, 300, top + WINDOW * pitch - 6 + bob, 1, 1, 0, null, 1);
    }
  }

  // SETTINGS and CREDITS — the extra rows, visually separated from the modes
  // by a gap so they read as somewhere else to go rather than a fifth mode.
  if (!title.pickingAttack) {
    for (let i = 0; i < TITLE_EXTRAS.length; i++) {
      const y = top + MODES.length * pitch + 30 + i * pitch;
      const on = title.index === MODES.length + i;
      if (on && heart) {
        const bob = Math.sin(title.siner / 6) * 1.5;
        drawSpriteExt(ctx, heart, 0, 160 + bob, y + 4, 1, 1, 0, null, 1);
      }
      drawText(ctx, font, TITLE_EXTRAS[i].name, 190, y,
        { color: rgb(on ? HILITE : DIM) });
    }
  }

  centred(ctx, font, title.pickingAttack
    ? 'Z  choose      X  back'
    : 'arrows  move      Z  choose', 448, DIM, 0.75);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// SETTINGS — the hub and its pages, in the menu's own idiom (mainbig, the
// heart, c_yellow selection).

const SLOT_NAMES = ['WEAPON', 'ARMOR 1', 'ARMOR 2'];

function drawSettings(ctx, title, sprites, font) {
  const s = title.settings;
  const heart = sprites.get('spr_heart');
  const bob = Math.sin(title.siner / 6) * 1.5;

  if (s.page === null) {
    centred(ctx, font, 'SETTINGS', 60, c_white, 1.4);
    for (let i = 0; i < SETTINGS_PAGES.length; i++) {
      const y = 170 + i * 40;
      const on = i === s.cursor;
      const unused = SETTINGS_PAGES[i].id === 'unused';
      if (on && heart) drawSpriteExt(ctx, heart, 0, 160 + bob, y + 4, 1, 1, 0, null, 1);
      drawText(ctx, font, SETTINGS_PAGES[i].name, 190, y,
        { color: rgb(on ? HILITE : (unused ? DIM : c_white)) });
    }
    centred(ctx, font, 'Z  open      X  back', 448, DIM, 0.75);
    return;
  }

  if (s.page === 'items') {
    centred(ctx, font, 'ITEMS', 60, c_white, 1.4);
    centred(ctx, font, 'Not built yet — the bag is fixed for now.', 220, DIM, 0.85);
    centred(ctx, font, 'Z / X  back', 448, DIM, 0.75);
    return;
  }

  if (s.page === 'credits') {
    centred(ctx, font, 'CREDITS', 60, c_white, 1.4);
    for (let i = 0; i < CREDITS.length; i++) {
      const y = 170 + i * 56;
      const on = i === s.cursor;
      if (on && heart) drawSpriteExt(ctx, heart, 0, 90 + bob, y + 4, 1, 1, 0, null, 1);
      const row = CREDITS[i];
      // The SUPPORT row is a single word, not a role-and-name pair, so it is
      // drawn as one line rather than padded into a column that has no second
      // half.
      if (row.who) {
        drawText(ctx, font, row.role, 120, y,
          { color: rgb(on ? HILITE : DIM), xscale: 0.8, yscale: 0.8 });
        drawText(ctx, font, row.who, 120, y + 22, { color: rgb(on ? HILITE : c_white) });
      } else {
        drawText(ctx, font, row.role, 120, y + 11, { color: rgb(on ? HILITE : c_white) });
      }
    }
    centred(ctx, font, 'arrows  move      X  back', 448, DIM, 0.75);
    return;
  }

  if (s.page === 'graphics') {
    centred(ctx, font, 'GRAPHICS', 60, c_white, 1.4);
    // NO EXPLANATIONS. This page used to carry three lines about obj_shake and
    // global.flag[12] under the toggle — accurate, and nobody wants a footnote
    // in a settings menu. The reasoning lives in the code, where it belongs;
    // the menu says ON or OFF.
    const rows = [
      { name: 'SCREEN SIZE', value: title.scaling === 'fit' ? 'FULL' : 'SMALL' },
      { name: 'SCREEN SHAKE', value: title.shake ? 'ON' : 'OFF' },
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 190 + i * 60;
      const on = i === s.cursor;
      if (on && heart) drawSpriteExt(ctx, heart, 0, 110 + bob, y + 4, 1, 1, 0, null, 1);
      drawText(ctx, font, rows[i].name, 140, y, { color: rgb(on ? HILITE : c_white) });
      drawText(ctx, font, rows[i].value, 420, y, { color: rgb(on ? HILITE : c_white) });
    }
    centred(ctx, font, 'arrows  toggle      X  back', 448, DIM, 0.75);
    return;
  }

  if (s.page === 'audio') {
    centred(ctx, font, 'MUSIC / SFX', 60, c_white, 1.4);
    const rows = [
      { name: 'MUSIC', value: title.volumes.music },
      { name: 'SFX', value: title.volumes.sfx },
    ];
    for (let i = 0; i < rows.length; i++) {
      const y = 190 + i * 60;
      const on = i === s.cursor;
      if (on && heart) drawSpriteExt(ctx, heart, 0, 110 + bob, y + 4, 1, 1, 0, null, 1);
      drawText(ctx, font, rows[i].name, 140, y, { color: rgb(on ? HILITE : c_white) });
      // The slider: a trough with a fill and the value.
      ctx.fillStyle = 'rgb(64,64,72)';
      ctx.fillRect(280, y + 4, 200, 14);
      ctx.fillStyle = on ? 'rgb(255,255,0)' : 'rgb(255,255,255)';
      ctx.fillRect(280, y + 4, rows[i].value * 2, 14);
      drawText(ctx, font, String(rows[i].value), 500, y, { color: rgb(on ? HILITE : c_white) });
    }
    centred(ctx, font, 'arrows  adjust      X  back', 448, DIM, 0.75);
    return;
  }

  // ---- equip ----
  const eq = s.equip;
  centred(ctx, font, 'WEAPONS / ARMOR', 40, c_white, 1.2);

  // The party heads as the character tabs.
  const HEADS = ['spr_headkris', 'spr_headsusie', 'spr_headralsei'];
  for (let c = 0; c < 3; c++) {
    const x = 200 + c * 90;
    const head = sprites.get(HEADS[c]);
    const on = eq.char === c;
    if (head) {
      ctx.save();
      ctx.globalAlpha = on ? 1 : 0.45;
      drawSpriteExt(ctx, head, 0, x, 80, 2, 2, 0, null, 1);
      ctx.restore();
    }
    drawText(ctx, font, PARTY[c].name, x - 4, 130, {
      color: rgb(on ? HILITE : DIM), xscale: 0.75, yscale: 0.75,
    });
    if (on && eq.stage === 'char' && heart) {
      drawSpriteExt(ctx, heart, 0, x + 8, 158 + bob, 1, 1, 0, null, 1);
    }
  }

  // The three slot rows with what is equipped.
  const gear = title.gear[eq.char];
  for (let r = 0; r < 3; r++) {
    const y = 190 + r * 34;
    const id = r === 0 ? gear.weapon : gear.armor[r - 1] ?? 0;
    const it = r === 0 ? itemOf('weapon', id) : itemOf('armor', id);
    const on = eq.stage !== 'char' && eq.row === r;
    if (on && eq.stage === 'slot' && heart) {
      drawSpriteExt(ctx, heart, 0, 120 + bob, y + 4, 1, 1, 0, null, 1);
    }
    drawText(ctx, font, SLOT_NAMES[r], 150, y, { color: rgb(on ? HILITE : DIM), xscale: 0.85, yscale: 0.85 });
    drawText(ctx, font, it?.name ?? '(Nothing)', 300, y, { color: rgb(on ? HILITE : c_white), xscale: 0.85, yscale: 0.85 });
  }

  // The stat line — base plus slots, exactly what battleat/df/mag will be.
  const st = previewStats(title, eq.char);
  drawText(ctx, font, `AT ${st.at}   DF ${st.df}   MG ${st.magic}`, 150, 300,
    { color: rgb(DIM), xscale: 0.85, yscale: 0.85 });

  // The pocket, when a slot is open: every piece in the chapter's table
  // (BlackShard excluded), the unequippable greyed by the char flags.
  if (eq.stage === 'pocket') {
    const kind = eq.row === 0 ? 'weapon' : 'armor';
    const pocket = pocketOf(kind);
    const table = kind === 'weapon' ? WEAPONS : ARMOR;
    // A scrolling window of 7 rows.
    const win = 7;
    let first = Math.max(0, Math.min(eq.pocket - 3, pocket.length - win));
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(360, 150, 260, 270);
    for (let i = 0; i < Math.min(win, pocket.length); i++) {
      const idx = first + i;
      const id = pocket[idx];
      const y = 160 + i * 34;
      const on = idx === eq.pocket;
      const name = id === 0 ? '(Nothing)' : table[id]?.name ?? '?';
      const ok = id === 0 || canEquip(kind, id, eq.char);
      if (on && heart) drawSpriteExt(ctx, heart, 0, 370 + bob, y + 4, 1, 1, 0, null, 1);
      // `min(1, 200 / width)` — the item menu's squeeze, never a clip.
      const w = textWidth(font, name) * 0.85;
      const squeeze = Math.min(1, 200 / w);
      drawText(ctx, font, name, 400, y, {
        color: rgb(on ? HILITE : (ok ? c_white : DIM)),
        xscale: 0.85 * squeeze, yscale: 0.85,
      });
    }
    // The selected piece's stats, under the list.
    const selId = pocket[eq.pocket];
    if (selId !== 0) {
      const it = table[selId];
      const bits = [];
      if (it.at) bits.push(`AT ${it.at > 0 ? '+' : ''}${it.at}`);
      if (it.df) bits.push(`DF ${it.df > 0 ? '+' : ''}${it.df}`);
      if (it.magic) bits.push(`MG ${it.magic > 0 ? '+' : ''}${it.magic}`);
      if (it.ability) bits.push(it.ability);
      drawText(ctx, font, bits.join('  ') || '—', 400, 424,
        { color: rgb(DIM), xscale: 0.7, yscale: 0.7 });
    }
  }

  centred(ctx, font,
    eq.stage === 'char' ? 'arrows  pick character      Z  edit      X  back'
      : eq.stage === 'slot' ? 'arrows  pick slot      Z  change      X  back'
        : 'arrows  pick      Z  equip      X  back',
    448, DIM, 0.75);
}

/**
 * GAME OVER — and the Roaring Knight has his OWN, which is not the one
 * everybody knows.
 *
 * `obj_gameover_init`'s Create reads `global.tempflag[93]` into `knight_mode`,
 * and `obj_ch3_PTB02` — the Knight's own encounter room, 244 references to him
 * in one Step — sets that flag as the fight begins. So dying HERE takes the
 * knight_mode branch every time, and that branch skips the entire sequence
 * the generic game over is famous for:
 *
 *     if (!knight_mode) {
 *         timer 50    snd_break1; sprite_index = spr_heartbreak; x -= 2
 *         timer 90    snd_break2; six shards at random(360), speed 7, grav 0.2
 *         timer 140   obj_fadeout
 *     }
 *     else if (timer == 80) {
 *         scr_lerpvar("x", x, 312, 30, 2, "out");
 *         scr_lerpvar("y", y, cameray() + 80, 30, 2, "out");
 *     }
 *
 * **THE SOUL DOES NOT BREAK.** It stays whole, sits where it died for fifty
 * frames, then GLIDES up to (312, 80) over thirty on a quadratic ease-out —
 * `scr_ease_out` curve 2 is `-t * (t - 2)`. Then, at timer 150 (outside the
 * branch, so both modes reach it), `room_goto(PLACE_FAILURE)`.
 *
 * Two more things this had wrong, both of which made the soul "get bigger" at
 * the moment of death:
 *
 * 1. **The sprite is `spr_heart` (16x16), not `spr_dodgeheart` (20x20).**
 *    `global.heartx = (x + 2) - viewX` carries a +2 that exists precisely to
 *    centre the smaller sprite inside the footprint of the one you were
 *    dodging with. `spr_heartbreak` is 20 wide, which is why the generic path
 *    pairs it with `x -= 2` — the same two pixels, going back.
 *
 * 2. **`obj_gameover_init` never touches image_xscale, so it draws at 1.**
 *    Drawing at 2 doubled the soul against the frozen screenshot behind it,
 *    which still shows it at its real size. That jump was the "weird" part.
 */

// scr_ease_out(t, 2). The only easing this screen uses.
const easeOut2 = (t) => -t * (t - 2);

// knight_mode's glide: `scr_lerpvar(..., 312 / cameray() + 80, 30, 2, "out")`
// armed at timer 80, so obj_lerpvar's `time++` first runs on 81 and the
// thirtieth step lands on 110.
const GLIDE_START = 80;
const GLIDE_TIME = 30;
const GLIDE_X = 312;
const GLIDE_Y = 80;

/** timer 150: `room_goto(PLACE_FAILURE)`. */
const FAILURE_AT = 150;

/**
 * DEVICE_FAILURE's knight branch, verbatim from its Step. `\M0` selects the
 * Knight's face, `^6` is a pause and `/%` ends the message; the text itself is
 * what he says. `&` is DELTARUNE's line break.
 *
 * The FIRST-loss script. The Step also carries a second-loss line
 * ("YOU ARE MISSING SOMETHING IMPORTANT", gated on the party having no
 * ShadowMantle equipped) and a third-loss one, keyed off
 * `global.knight_battle_losses`. Not shipped yet — see task #44 — because a
 * practice tool restarts constantly and the loss counter would mean something
 * different here than it does in a playthrough.
 */
// THE LEADING SPACES ARE THE CENTRING. The Knight's lines are padded by hand
// in the source string — `"\\M0     VERY^6& &  INTERESTING./%"` — and that
// padding IS the layout; there is no centring code anywhere. Stripping it (as
// this did) left every line flush against x 70 and the screen read as
// left-aligned text rather than the Knight's measured address.
//
// `&` is the line break, so a `& &` pair is a BLANK LINE between them. Kept,
// because the spacing between his phrases is most of their weight.
const KNIGHT_LINES = [
  ['     VERY', '', '  INTERESTING.'],
  [' YOUR LOSS HERE', '', '     IS ALL', '', ' BUT GUARANTEED.'],
  ['    AND YET', '', ' YOU PERSIST...'],
  ['IF YOU ARE SO', 'DETERMINED', 'TO TRY ONCE MORE'],
  ['      THEN', '', 'SHALL WE HASTEN?'],
];

/**
 * IT IS TYPED, AND THE PAUSES ARE THE POINT.
 *
 * The strings above are the dump's, verbatim, and their raw form carries two
 * control codes this screen lives on:
 *
 *     "\M0     VERY^6& &  INTERESTING./%"
 *     "\M0 YOUR LOSS HERE^6& &     IS ALL^6& & BUT GUARANTEED./%"
 *
 * `&` is a line break and `^6` is a PAUSE. obj_writer's Alarm 0 adds a fixed
 * number of frames per digit — 1:5 2:10 3:15 4:20 5:30 6:40 7:60 8:90 9:150 —
 * so `^6` is FORTY FRAMES of nothing, mid-sentence, before the break. That
 * beat between "VERY" and "INTERESTING." is the whole delivery, and drawing
 * the line whole threw it away.
 *
 * The `& &` around each pause is a break, a line holding one space, and
 * another break: the blank rows in the arrays above.
 *
 * RATE 2. This used to be recorded as unmeasured — "inventing a rate would put
 * a number on screen the game never chose". It is measured now, from the same
 * scr_texttype row as the font and the glow: `scr_textsetup(main, c_white, x,
 * y, 33, 0, 2, snd_nosound, 12, 20, 2)`, and obj_writer re-arms `alarm[0] =
 * rate` per character. One character every two frames, and `snd_nosound` —
 * this screen types in SILENCE, which is a deliberate choice against the drone
 * underneath it.
 *
 * `\M0` sets `global.flag[20] = 0`, which nothing in DEVICE_FAILURE reads. It
 * is inert here and is not modelled.
 */
const GAMEOVER_RATE = 2;
const PAUSE_FRAMES = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30, 6: 40, 7: 60, 8: 90, 9: 150 };
/** Where a `^6` sits in each message, as a character index into the joined text. */
const KNIGHT_PAUSES = [
  { 9: 6 },                    // ...VERY^6
  { 15: 6, 27: 6 },            // ...HERE^6 ...IS ALL^6
  { 11: 6 },                   // ...AND YET^6
  {},                          // no pauses — three plain breaks
  { 10: 6 },                   // ...THEN^6
];

/**
 * How many characters of message `n` are showing after `t` frames, and whether
 * it has finished. Walks the string a character at a time so a pause costs
 * real frames exactly where the `^` is.
 */
function typedCount(n, t) {
  const chars = KNIGHT_LINES[n].join('').length;
  const pauses = KNIGHT_PAUSES[n] ?? {};
  let frames = 0;
  for (let i = 0; i < chars; i++) {
    frames += GAMEOVER_RATE;
    if (pauses[i]) frames += PAUSE_FRAMES[pauses[i]];
    if (frames > t) return { shown: i, done: false };
  }
  return { shown: chars, done: true };
}

/** `scr_delay_var("knight_mode_con", next, 30)` — the beat between messages. */
const LINE_GAP = 30;

/** Total frames message `n` takes to type, for the X skip. */
function typedFrames(n) {
  const chars = KNIGHT_LINES[n].join('').length;
  const pauses = KNIGHT_PAUSES[n] ?? {};
  let frames = 0;
  for (let i = 0; i < chars; i++) {
    frames += GAMEOVER_RATE;
    if (pauses[i]) frames += PAUSE_FRAMES[pauses[i]];
  }
  return frames;
}

/** Slice the padded rows to the first `shown` characters, keeping the layout. */
function revealRows(rows, shown) {
  let left = shown;
  return rows.map((r) => {
    if (left <= 0) return '';
    const out = r.slice(0, left);
    left -= r.length;
    return out;
  });
}

/**
 * The two options, with the game's own strings and coordinates:
 *
 *     NAME[0][0] = "GO BACK#(FIGHT AGAIN)"     NAMEX 70   NAMEY 180
 *     NAME[1][0] = "GO FORWARD#(MOVE ON)"      NAMEX 190  NAMEY 180
 *     XMAX = 1; CURX = -1; fadebuffer = 20;
 *     scr_lerpvar("choice_y_offset", 20, 0, 20);
 *
 * `#` is a line break in `string_hash_to_newline`. **CURX starts at -1**, so
 * neither option is highlighted until you move — the screen does not preselect
 * an answer for you.
 *
 * These map onto what this tool needs without renaming anything: GO BACK
 * fights the Knight again, and GO FORWARD leaves — which here means the mode
 * menu rather than the rest of the chapter.
 */
const CHOICES = [
  { name: ['GO BACK', '(FIGHT AGAIN)'], x: 70, y: 180 },
  { name: ['GO FORWARD', '(MOVE ON)'], x: 190, y: 180 },
];

/**
 * **PLACE_FAILURE IS A 320x240 ROOM.** Every coordinate quoted above is in
 * that space, and the game scales the whole room up to fill the 640x480
 * window. Drawing those numbers straight onto a 640-wide canvas puts the
 * entire screen in the top-left QUARTER — which is exactly how it looked.
 *
 * The room's width is not inferred from the layout, it is written down:
 * DEVICE_CHOICE's Draw centres its name field with `(320 - width) / 2`.
 *
 * The scale also settles the heart. DEVICE_FAILURE creates its marker at
 * `(156, 40)` with `image_xscale = 0.5`, which lands at (312, 80) full size
 * on screen — the SAME place `obj_gameover_init` glides the soul to, at the
 * same size. The two rooms hand off without the soul moving a pixel, and any
 * scaling that breaks that equality is wrong.
 */
const ROOM_SCALE = 2;
const rx = (v) => v * ROOM_SCALE;

// DEVICE_CHOICE's Draw: white, and c_yellow on CURX.
const C_YELLOW = [255, 255, 0];

export function drawGameOver(ctx, over, sprites) {
  // TYPER 667 IS `fnt_main`, NOT fnt_mainbig:
  //
  //     case 667: scr_textsetup(scr_84_get_font("main"), c_white, x, y,
  //                             33, 0, 2, snd_nosound, 12, 20, 2);
  //
  // charline 33, hspace 12, vspace 20 — a smaller, wider-spaced face than the
  // battle box's. Drawing the death screen in mainbig made his words the
  // wrong size and the wrong shape, which is the "weird font" this should
  // have had all along.
  const font = loadFont('../assets/fonts', 'fnt_main');
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // The frozen screenshot holds for 30 frames, then black.
  if (over.t < 30 && over.shot) {
    ctx.drawImage(over.shot, 0, 0);
  } else {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  const heart = sprites.get('spr_heart');

  // `visible = 1` at timer 30, and it never breaks. Scale 1: the object sets
  // no image_xscale, and the soul must not change size against the screenshot.
  if (over.t >= 30 && over.t < FAILURE_AT && heart) {
    drawSpriteExt(ctx, heart, 0, over.x, over.y, 1, 1, 0, null, 1);
  }

  if (over.t >= FAILURE_AT) drawFailure(ctx, over, font, heart);

  ctx.restore();
}

/**
 * PLACE_FAILURE, the Knight's version.
 *
 * DEVICE_FAILURE's Create puts a HALF-SIZE heart at a fixed spot —
 * `heart_marker = scr_marker(156, 40, spr_heart)` with `image_xscale = 0.5`
 * — above the Knight's words, and fades it out when the choice appears
 * (`scr_lerp_var_instance(heart_marker, "image_alpha", 1, 0, 15)`).
 *
 * The Knight's lines are drawn whole rather than typed. `obj_writer` at
 * `global.typer = 667` types them out, and this project has not measured that
 * typer's speed — the same gap that blocks the battle's flavour line (task
 * #40). Inventing a rate would put a number on screen that the game never
 * chose, so the line appears complete and advances on confirm.
 */
function drawFailure(ctx, over, font, heart) {
  const t = over.t - FAILURE_AT;

  // The marker, fading over 15 frames once the choice is up. Room scale 2 and
  // image_xscale 0.5 cancel to 1 — the soul is the same size it was mid-glide.
  if (heart) {
    const a = over.choiceT >= 0 ? Math.max(0, 1 - over.choiceT / 15) : 1;
    if (a > 0) drawSpriteExt(ctx, heart, 0, rx(156), rx(40), 1, 1, 0, null, a);
  }

  if (!font?.ready) return;

  // obj_writer is created at (70, 80), one instance per line, and TYPES it —
  // `over.lineT` is that writer's clock, reset by stepGameOver on every new
  // message.
  const which = Math.min(over.line, KNIGHT_LINES.length - 1);
  const line = revealRows(
    KNIGHT_LINES[which], typedCount(which, over.lineT ?? 0).shown,
  );
  if (over.choiceT < 0 && t > 2) {
    line.forEach((s, i) => {
      // `vspace = 20`, in the 320x240 room's coordinates — so rx(20) on
      // screen. This stepped by a flat 30, mixing a scaled origin with an
      // unscaled stride, and the block drifted tighter than the game's.
      // `hspace = 12` is the per-character advance.
      // `special = 2`, the eleventh argument of typer 667's scr_textsetup:
      //
      //     case 667: scr_textsetup(main, c_white, ..., snd_nosound, 12, 20, 2);
      //
      // A PULSING GLOW, not a shadow — the glyph is drawn at the four
      // cardinals at `0.3 + sin(siner/14) * 0.1` and the four diagonals at
      // `0.08 + sin(siner/14) * 0.04`, then solid on top. `specfade` scales
      // all of it and is pinned at 1: DEVICE_FAILURE only lowers it inside
      // `if (specfade <= 0.9)`, which can never be true starting from 1 —
      // an ORIGINAL BUG, so the glow never dims on a held X.
      // THE WHOLE BLOCK IS ROOM-SPACE, INCLUDING THE GLYPHS.
      //
      // PLACE_FAILURE is a 320x240 room displayed at 2x, so every number in
      // DEVICE_FAILURE is in ROOM pixels and the font is magnified with the
      // room: the origin (70, 80), `vspace = 20` AND `hspace = 12` all scale,
      // and the characters are drawn twice size.
      //
      // Only the origin and the stride were being scaled. The advance stayed
      // at 12 SCREEN pixels — half the game's — and the glyphs at 1x, so the
      // Knight's words came out half width and hard against the left, which
      // is what "should generally be centered" is about. THE GAME DOES NOT
      // CENTRE ANYTHING HERE: the strings are hand-padded with leading spaces
      // and the origin is chosen so that lands near the middle of a 320-wide
      // room. " YOUR LOSS HERE" is 15 characters at hspace 12 = 180 wide, and
      // (320 - 180) / 2 is exactly 70 — the writer's own x. The lines that
      // look off-centre, like "IF YOU ARE SO", are off-centre in the game too,
      // which is the "except the stuff that is not".
      drawText(ctx, font, s, rx(70), rx(80) + i * rx(20),
        // `advance` is in the SAME space as the glyphs — drawText multiplies
        // it by xscale — so it stays 12 and the room scale is applied once.
        { color: rgb(c_white), advance: 12, xscale: ROOM_SCALE,
          yscale: ROOM_SCALE, special: 2, siner: over.t });
    });
  }

  if (over.choiceT < 0) return;

  // `xfade = (10 - fadebuffer) / 10`, capped at 1, with fadebuffer counting
  // down from 20 — so the choice is invisible for ten frames, then fades in
  // over ten. `choice_y_offset` lerps 20 -> 0 across twenty, so it rises as
  // it appears.
  const fadebuffer = Math.max(0, 20 - over.choiceT);
  const xfade = Math.min(1, Math.max(0, (10 - fadebuffer) / 10));
  const yoff = rx(20) * (1 - Math.min(1, over.choiceT / 20));
  if (xfade <= 0) return;

  // THE FADE HAS TO BE PASSED IN, not set on the context: drawText does its
  // own `save()` / `globalAlpha = alpha` / `restore()`, so an outer
  // globalAlpha was being overwritten by the default 1 and the ten-frame
  // fade-in never appeared. It also has to reach the glow copies, which scale
  // their own 0.3/0.08 alphas by it — `specfade` in the original does exactly
  // this, and DEVICE_FAILURE's ten-frame `xfade` is the same idea one layer up.
  // THE CHOICES ARE NOT THE WRITER'S. DEVICE_CHOICE's Draw is
  //
  //     scr_84_set_draw_font("main");
  //     draw_text(NAMEX[i][0], NAMEY[i][0] + choice_y_offset,
  //               string_hash_to_newline(NAME[i][0]));
  //
  // a plain `draw_text` — so the glyphs advance by their OWN widths, not by
  // the writer's fixed `hspace = 12`, and there is no `special` glow because
  // that lives in obj_writer and nothing else. Borrowing the writer's metrics
  // (which is what the last pass did) made "(FIGHT AGAIN)" thirteen characters
  // at 12 apart — 156 room pixels from x 70, straight through GO FORWARD at
  // 190. Reported as the two options intersecting; they do not intersect in
  // the game because the real advances are far narrower.
  //
  // `#` is the line break, and one draw_text call renders both lines, so the
  // second sits a FONT line-height below — not the writer's vspace.
  const lineH = textHeight(font) * ROOM_SCALE;
  CHOICES.forEach((c, i) => {
    const color = rgb(over.cur === i ? C_YELLOW : c_white);
    c.name.forEach((s, k) => {
      drawText(ctx, font, s, rx(c.x), rx(c.y) + yoff + k * lineH,
        { color, xscale: ROOM_SCALE, yscale: ROOM_SCALE, alpha: xfade });
    });
  });
}

/**
 * The timeline, stepped by the driver. Returns what the driver has to act on
 * — sounds and the chosen option — rather than reaching out of the renderer.
 *
 * `keys` is the current input; the choice reads it directly because
 * DEVICE_CHOICE's own Step does, and this screen is outside `sim/` (it is a
 * different room in the original, with no bullets and no determinism to
 * preserve).
 */
export function stepGameOver(over, keys = {}) {
  over.t += 1;

  // knight_mode's glide. obj_lerpvar sets the value every frame from
  // `lerp(pointa, pointb, ease(time / maxtime))`, so the position is a pure
  // function of elapsed frames — no accumulation, no drift.
  if (over.t > GLIDE_START && over.t <= GLIDE_START + GLIDE_TIME) {
    const p = easeOut2((over.t - GLIDE_START) / GLIDE_TIME);
    over.x = over.x0 + (GLIDE_X - over.x0) * p;
    over.y = over.y0 + (GLIDE_Y - over.y0) * p;
  }

  if (over.t < FAILURE_AT) return {};

  const t = over.t - FAILURE_AT;

  // THE LINES TYPE, AND THEY ADVANCE THEMSELVES.
  //
  // The original's timeline is a chain of `knight_mode_con` steps, each of the
  // shape "when the writer is gone, set the next message and make a new
  // writer", with `scr_delay_var("knight_mode_con", next, 30)` inserting a
  // THIRTY-FRAME hold between them:
  //
  //     if (knight_mode_con == 1 && !i_ex(obj_writer)) {
  //         knight_mode_con = 2;
  //         scr_delay_var("knight_mode_con", 3, 30);
  //         global.msg[0] = "...";  instance_create(70, 80, obj_writer);
  //     }
  //
  // and the writer ends on `/%`, which is `halt = 2` — it dismisses ITSELF
  // rather than waiting for a press. So the Knight talks at you at his own
  // pace; nothing here is reader-driven, which is what makes the pauses land.
  //
  // The reader's only power is X, which obj_writer honours as
  // `if (halt == 0 && button2 == 1 && pos < length && skippable == 1)
  //  skipme = 1;` — the whole line at once, not a faster crawl.
  if (over.choiceT < 0) {
    if (t <= 2) return {};
    over.lineT = (over.lineT ?? 0) + 1;
    if (keys.focus) {
      over.lineT = Math.max(over.lineT, typedFrames(over.line));
    }
    const { done } = typedCount(over.line, over.lineT);
    if (!done) return {};
    over.gap = (over.gap ?? 0) + 1;
    if (over.gap < LINE_GAP) return {};
    over.gap = 0;
    over.lineT = 0;
    if (over.line < KNIGHT_LINES.length - 1) {
      over.line += 1;
      return { advanced: true };
    }
    // knight_mode_con 50: the choice is created and the marker fades.
    over.choiceT = 0;
    return { advanced: true };
  }

  over.choiceT += 1;

  // DEVICE_CHOICE's Step: left/right walk 0..XMAX. CURX starts at -1, so the
  // first press selects rather than moves.
  const left = !!keys.left && !over.heldLeft;
  const right = !!keys.right && !over.heldRight;
  over.heldLeft = !!keys.left;
  over.heldRight = !!keys.right;

  let moved = false;
  if (left && over.cur !== 0) { over.cur = Math.max(0, over.cur - 1); moved = true; }
  if (right && over.cur !== 1) { over.cur = over.cur < 0 ? 0 : 1; moved = true; }

  const pressed = !!keys.confirm && !over.heldConfirm;
  over.heldConfirm = !!keys.confirm;
  // `fadebuffer = 20` is also the input buffer: nothing is choosable until the
  // options have finished fading in.
  if (pressed && over.cur >= 0 && over.choiceT > 20) {
    return { chosen: over.cur };
  }
  return { moved };
}

/**
 * The state the driver holds. `x0`/`y0` are kept because the glide lerps from
 * where the soul died every frame rather than stepping from where it is.
 */
export function makeGameOver(shot, x, y) {
  return {
    t: 0,
    shot,
    x,
    y,
    x0: x,
    y0: y,
    line: 0,
    lineT: 0,
    gap: 0,
    choiceT: -1,
    cur: -1,
    heldConfirm: false,
    heldLeft: false,
    heldRight: false,
  };
}
