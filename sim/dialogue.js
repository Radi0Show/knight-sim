// THE FIGHT'S DIALOGUE — obj_knight_enemy's Step.
//
// It is a TWO-BEAT EXCHANGE, one per turn, and reading it as a single stream
// of lines gets the shape wrong:
//
//     balloonturn++;                       once a turn, and ONLY if Susie
//                                          is alive (`global.hp[2] > 0`)
//     balloonturn == N  ->  the Knight's taunt, and `ballooncon = N - 5`
//     button3_p() or the writer finishing  ->  Susie's reply for that
//                                              ballooncon, then ballooncon = 0
//
// So the Knight speaks, you press C, Susie answers. Both balloons, one turn.
//
// **IT STARTS ON TURN 6.** `balloonturn` counts from 0 and the first line is
// at 6, so the first five turns are silent — the taunting begins once the
// fight has gone on long enough to be going badly.
//
// **IT STOPS IF SUSIE FALLS.** The increment is inside `if (global.hp[2] > 0)`,
// so a downed Susie freezes the exchange where it stands rather than skipping
// ahead. She is the one being talked to.
//
// `&` is GameMaker's line break inside a message; `/%` closes it.

/** `balloonturn == N` — the Knight's taunt. */
export const KNIGHT_LINES = {
  6: "Heheh...",
  7: "Thing is,&you actually...",
  8: "You? You're all&damn alone...",
  9: "Even... even if&you knock me down...",
  10: "As long as Kris has got&a hand to lift me up with...",
  11: "So... give up.",
  12: "You know you can't&win... so... give up!",
  13: "... You won't even...",
  14: "... heh... heheheh...",
};

/**
 * `balloonturn -> ballooncon` — measured from the dump's per-turn branches,
 * NOT `n - 5`: that formula fit 6-9 and then silently broke. Balloonturns
 * 11 and 12 are SINGLE balloons (ballooncon 0, balloonend 1 — no reply),
 * 10 jumps to con 6, and 13/14 sit at 7/8. Balloonturn 9's all-down
 * variant uses con 5 (its reply speaks of Kris and Ralsei being down).
 */
export const BALLOONCON = { 6: 1, 7: 2, 8: 3, 9: 4, 10: 6, 11: 0, 12: 0, 13: 7, 14: 8 };

/**
 * `ballooncon == 8` does not end the exchange: its dismissal queues the
 * con-9 line with `balloonend = 0`, so Alarm 6 re-enters `talked = 0.6` and
 * a THIRD balloon plays before the phase gate arms. The only chain link.
 */
export const BALLOON_CHAIN = { 8: 9 };

/** `ballooncon == N` — Susie's reply. */
export const SUSIE_LINES = {
  1: "Didn't... think&we'd still be&standing, did you?",
  2: "You actually messed up,&picking a fight with US!",
  3: "Me? I got...&Kris and Ralsei&behind me.",
  4: "As long as Kris,&Ralsei, are here...",
  5: "As long as&I'm here...",
  6: "Heh... you're never gonna&win, you hear me?!",
  7: "... say a thing, huh...",
  8: "Man, I'm done talking.",
  9: "... people like you...&just piss me off.",
};

/**
 * Two of the Knight's lines have alternates for when KRIS AND RALSEI ARE BOTH
 * DOWN — `global.hp[1] < 1 && global.hp[3] < 1`. The taunt changes from "even
 * if you knock me down" to "even if you knock THEM down", because at that
 * point Susie is the only one still standing and the Knight is talking about
 * the others rather than about her.
 */
export const KNIGHT_ALONE = {
  9: "Even... even if&you knock them down...",
  10: "As long as I'm here to&lift them back up...",
};

/**
 * ACT results as the game actually pages them: `msgsetloc` opens the message
 * and each `msgnextloc` is a SEPARATE PAGE — the writer halts at the page's
 * `/`, a confirm advances it (scr_nextmsg re-types in the same writer), and
 * only the final `/%` halt lets a confirm destroy it. Check is two pages;
 * both HoldBreath variants are one page of `&` line breaks. The bar waits on
 * the whole lifecycle (`actcon == 1 && !instance_exists(obj_writer)` is what
 * calls scr_nextact -> scr_attackphase) — measured at verify21j turn 7:
 * menu closed f2331, writer born 2332, first page automash-skipped 2333,
 * page-advance 2336, second page skipped 2341, killed 2344, bar at 2345.
 */
export const ACT_PAGES = {
  check: ['* Kris analyzed the enemy!', "* But Kris&couldn't learn anything."],
  point: ['* Kris points into the distance.', '* Nothing happened.'],
  holdbreath_first: ['* Kris held their breath.&* Their heartbeat quickened.'
    + '&* The SOUL now moves faster.'],
  holdbreath_again: ['* Kris held their breath...&* Kris smiled.&* Nothing happened.'],
  // SUSIE'S ACT IS SEVEN PAGES AND SHE ONLY GETS ONE. The block ends with
  // `global.canactsus[myself][0] = 0`, so S-Action leaves her list entirely
  // after the first use — there is no repeat variant, which is why the old
  // `susie_done` entry was a misreading: that line is the LAST PAGE of the
  // one performance, not a separate second use.
  //
  // The `\EJ` etc. are face codes for Susie's portrait; the sim does not draw
  // battle portraits, so they are stripped and only the text is kept.
  susie: [
    '* Susie talked to the Knight!',
    "* I don't know what the hell you are, but...",
    '* Leave Toriel alone! You hear me!?',
    '* ...',
    "* ... Fine, you don't wanna listen?",
    '* Then we\'ll just. Have to do things the hard way.',
    '* (Susie will not ACT any more.)',
  ],
  // RALSEI GETS FIVE THE FIRST TIME AND THREE AFTER, keyed on `ractcount`.
  // The sim had two pages and neither matched: three whole pages of his
  // pleading were missing, which is the substance of the ACT.
  ralsei: [
    '* Ralsei tried talking...',
    "* Please... please, don't do this...",
    '* If the Roaring happens, then... then...',
    '* Please... stop...!',
    '* (... but nothing happened.)',
  ],
  ralsei_again: [
    '* Ralsei tried talking...',
    '* Please, stop...',
    '* (... but nothing happened.)',
  ],
};

/** ACT results, which go to the CHATBOX rather than a balloon. */
export const ACT_TEXT = {
  check: "* Kris analyzed the enemy!&* But Kris couldn't learn anything.",
  point: "* Kris points into the distance.&* Nothing happened.",
  holdbreath_first: "* Kris held their breath.&* Their heartbeat quickened."
    + "&* The SOUL now moves faster.",
  holdbreath_again: "* Kris held their breath...&* Kris smiled.&* Nothing happened.",
  susie: "* Susie talked to the Knight!",
  susie_done: "* (Susie will not ACT any more.)",
  ralsei: "* Ralsei tried talking...",
  ralsei_done: "* (... but nothing happened.)",
};

// ─── THE WRITER'S ESCAPE SCANNER ────────────────────────────────────────────
//
// obj_writer's Draw_0 walks `mystring` one character at a time EVERY FRAME and
// draws only what survives its `accept` flag. Everything the loop sets
// `accept = 0` on is a COMMAND, not a glyph, and this engine had no parser for
// any of it — `msgLines` split on `&` and handed the rest to render/menu.js,
// which drew it letter by letter. Vanilla never noticed because every string in
// the tables above was authored with the codes already stripped by hand (see
// the `\EJ` note at the top of ACT_PAGES). The moment a lane pastes a string in
// verbatim, `\ck` and `^2` appear on screen.
//
// What the v1.03 Draw_0 consumes, read out of the loop rather than guessed:
//
//     `        n++; mychar = next        the LITERAL escape — accept stays 1
//     & \n     accept = 0                line break        KEPT, see below
//     |        accept = 0; wx += hspace  indent skip       KEPT, see below
//     ^        accept = 0; n += 1        PAUSE + its digit
//     /        halt = 1 (2 before %)     page halt
//     %        /% -> halt 2, %% -> destroy, else scr_nextmsg()
//     \        accept = 0; n += 2        cmd + arg, ALWAYS two, whatever they are
//
// `&` and `|` are the two this scanner deliberately KEEPS: `msgLines` already
// splits on `&`, `formatWriter` emits both, and render/font.js already consumes
// `|` as an hspace skip. Stripping them here would delete the line breaks and
// the hanging indent this engine has drawn correctly for months.
//
// `#` is NOT handled. The Draw turns a bare `#` into a newline
// (`string_hash_to_newline`) unless a backtick precedes it — but the item
// descriptions in sim/items.js use `#` as their own break character and never
// reach a writer, so touching it here would change a screen this seam has no
// business in. Left alone, deliberately.
//
// THE COLOUR IS PER CHARACTER, THE OTHER TWO LATCH. `colorchange = 0` is
// re-run at the TOP of every Draw pass (Draw_0:87), so `\c` only tints from its
// own position rightward. `shake` and `textsound` are NOT reset — once a `\ck`
// is reached they stay set for the writer's whole life, so on the frame the
// code is first passed only the characters after it shake, and from the next
// frame onward the whole line does. This scanner publishes the first reading
// (from the code's position rightward); every string that uses `\ck` puts it at
// position 0, where the two readings are the same thing.

/**
 * The `\c<X>` arms, as this repo's RGB triples (render/draw/gm.js's form).
 *
 * `#RRGGBB` literals in the dump are RGB, not the BGR of the `$` form —
 * `#3F48CC` and `#B5E61D` elsewhere in the dump are the MS Paint blue and
 * green exactly, which settles the byte order without a probe.
 *
 * **`k` IS NOT VANILLA.** It is EnderCat8's single addition to the writer
 * (kaizo gml_Object_obj_writer_Draw_0.gml:567-572, a six-line insert and
 * nothing else in the file):
 *
 *     if (nextchar2 == "k") { textsound = snd_nosound; xcolor = c_gray;
 *                             shake = 1; }
 *
 * so it selects three things at once, and the two flags are why this scanner
 * publishes a style object rather than a colour.
 */
export const WRITER_COLORS = {
  R: [255, 0, 0], // c_red
  B: [0, 0, 255], // c_blue
  Y: [255, 255, 0], // c_yellow
  G: [0, 255, 0], // c_lime
  W: [255, 255, 255], // c_white
  X: [0, 0, 0], // c_black
  P: [128, 0, 128], // c_purple
  M: [128, 0, 0], // c_maroon
  S: [255, 128, 255], // #FF80FF
  V: [128, 255, 128], // #80FF80
  I: [129, 192, 255], // #81C0FF
  k: [128, 128, 128], // c_gray   — KAIZO ONLY
};

/**
 * `^<n>` — obj_writer's PAUSE, and it lives in Alarm_0, not in the Draw:
 *
 *     if (getchar == "^") { pos += 2;
 *         if (alarm[0] > 0) { if (nextchar == "1") alarm[0] += 5; ... } }
 *
 * alarm[0] had already been re-armed to `rate` this tick, so the digit buys
 * EXTRA frames on top of the normal one-character step. `^0` is not in the
 * table and adds nothing.
 *
 * **NO STRING THIS ENGINE TYPES CONTAINS A `^`.** A scan of every string
 * literal in sim/ and render/ (tools/verify-writer.mjs re-runs it, so it
 * cannot rot) finds three: `SILENT_CHARS`' own entry and two regexes in
 * sim/rng.js. So consuming the pause is provably inert here — it moves no
 * gate, because there is nothing to move. The table is translated anyway,
 * faithfully, because the lanes that paste strings in verbatim DO use it and
 * a dropped timing mechanic is not a thing to leave for later. It is
 * UNEXERCISED: no recording covers a pause, and none can until a string here
 * needs one.
 */
export const WRITER_PAUSE = { 1: 5, 2: 10, 3: 15, 4: 20, 5: 30, 6: 40, 7: 60, 8: 90, 9: 150 };

/**
 * The style of a character no command has touched. Shared and frozen, so
 * "the scanner produced nothing but defaults" is an identity test rather than
 * a deep compare — which is exactly what the inertness assertion needs.
 */
export const DEFAULT_STYLE = Object.freeze({ color: null, silent: false, shake: 0 });

const PARSE_CACHE = new Map();
const PARSE_CACHE_MAX = 512;

/**
 * The scanner. Returns the printable stream, the per-character style, and the
 * writer state the commands selected.
 *
 *     text     the glyph stream, codes removed, `&` and `|` kept
 *     style    one entry per UTF-16 unit of `text`; DEFAULT_STYLE when clean
 *     delay    extra pause frames accrued before each character is revealed
 *     codes    HOW MANY COMMANDS WERE EATEN — the positive assertion. A string
 *              that renders correctly because it had no codes and one that
 *              renders correctly because the parser ran are different facts,
 *              and this is what tells them apart.
 *     halt     0 none, 1 `/`, 2 `/%`, 5 `\C<n>` (the choicer)
 *     destroy  `%%` — the writer kills itself rather than paging
 *     nextmsg  how many bare `%` asked for the next page
 *     skippable `\s0` / `\s1`, null when neither appeared
 *
 * A string with no commands returns `text === input` and every style entry
 * `=== DEFAULT_STYLE`, so every existing consumer sees exactly what it saw
 * before this function existed.
 */
export function parseWriter(raw) {
  const src = String(raw);
  const hit = PARSE_CACHE.get(src);
  if (hit) return hit;

  const out = [];
  const style = [];
  const delay = [];
  // obj_writer Create: xcolor = c_black, colorchange = 0, shake = 0,
  // textsound = snd_text.
  let xcolor = null;
  let colorchange = 0;
  let silent = false;
  let shake = 0;
  let skippable = null;
  let halt = 0;
  let destroy = false;
  let nextmsg = 0;
  let codes = 0;
  let accrued = 0;
  let pending = 0;
  let cur = DEFAULT_STYLE;

  const restyle = () => {
    cur = (colorchange === 0 && !silent && shake === 0)
      ? DEFAULT_STYLE
      : Object.freeze({ color: colorchange ? xcolor : null, silent, shake });
  };
  const emit = (ch) => {
    out.push(ch);
    style.push(cur);
    delay.push(accrued);
    // The `^` tick reveals the character that FOLLOWS the code (Alarm_0 does
    // `pos += 2` for the code and `pos += 1` again at the bottom), so the
    // extra frames land on the character after that one. `&` costs no reveal
    // tick in this engine's model, so it does not absorb the pause either.
    if (pending && ch !== '&') { accrued += pending; pending = 0; }
  };

  let n = 0;
  while (n < src.length) {
    const ch = src[n];
    if (ch === '`') {
      // The literal escape: the next character is drawn without examination.
      codes += 1;
      if (n + 1 < src.length) emit(src[n + 1]);
      n += 2;
      continue;
    }
    if (ch === '^') {
      codes += 1;
      pending += WRITER_PAUSE[src[n + 1]] ?? 0;
      n += 2;
      continue;
    }
    if (ch === '/') {
      codes += 1;
      halt = src[n + 1] === '%' ? 2 : 1;
      n += 1;
      continue;
    }
    if (ch === '%') {
      codes += 1;
      if (src[n - 1] === '/') halt = 2;
      if (src[n + 1] === '%') {
        // DELIBERATE DEVIATION, one character wide: the original falls through
        // to the second `%` and would ask for the next message, but
        // `instance_destroy()` has already run by then so nothing reads it.
        // Consuming both here is the same outcome with no phantom page.
        destroy = true;
        n += 2;
        continue;
      }
      if (halt !== 2) nextmsg += 1;
      n += 1;
      continue;
    }
    if (ch === '\\') {
      // `accept = 0; n += 2;` is UNCONDITIONAL in the Draw — an unrecognised
      // command still eats its argument. Matching that is what keeps a
      // mistyped code from spilling one stray letter into the glyph stream.
      codes += 1;
      const cmd = src[n + 1] ?? '';
      const arg = src[n + 2] ?? '';
      if (cmd === 'c') {
        colorchange = 1;
        if (arg === '0') xcolor = null; // xcolor = mycolor, the writer's own
        else if (arg === 'k') { xcolor = WRITER_COLORS.k; silent = true; shake = 1; }
        else if (WRITER_COLORS[arg]) xcolor = WRITER_COLORS[arg];
        restyle();
      } else if (cmd === 's') {
        if (arg === '0') skippable = false;
        if (arg === '1') skippable = true;
      } else if (cmd === 'C') {
        if (arg === '1' || arg === '2' || arg === '3' || arg === '4') halt = 5;
      }
      // \E \F \f \* \T \M \S \I \m \O all pick faces, sounds, sprites and
      // flags this engine does not draw. Consumed, not modelled.
      n += 3;
      continue;
    }
    emit(ch);
    n += 1;
  }

  const res = {
    text: out.join(''),
    style,
    delay,
    totalDelay: accrued,
    codes,
    halt,
    destroy,
    nextmsg,
    skippable,
  };
  if (PARSE_CACHE.size >= PARSE_CACHE_MAX) PARSE_CACHE.clear();
  PARSE_CACHE.set(src, res);
  return res;
}

/**
 * `msgsetloc` uses `&` for a line break — and everything else the writer
 * consumes is gone before the split, so a caller that only wanted lines gets
 * lines rather than lines with `\ck` welded to the front of the first one.
 */
export const msgLines = (s) => parseWriter(s).text.split('&');

/**
 * obj_writer's FORMATTER (Other_15), the part our strings exercise: wrap at
 * `charline` characters per line, breaking at the LAST SPACE (the space
 * itself becomes the `&`), force-breaking mid-word when a line has no space
 * past position 2, and indenting the continuation of a `*` line with `||`
 * (each `|` is one hspace-wide skip in the writer's Draw, so the wrapped
 * text hangs under the message rather than under the asterisk).
 *
 * `charline` comes from scr_texttype: 33 for the battle message (typer 4)
 * and the balloons (81) both. The dump's own battle strings arrive UNSPLIT —
 * "* You felt something hovering close behind your head..." is one 55-char
 * line — and the game wraps them here at draw time, which is why copying the
 * strings verbatim and skipping the formatter cut them off at the canvas
 * edge instead.
 *
 * THE CODES ARE WIDTH-NEUTRAL, so scanning them out first lands the breaks
 * where the original's formatter would. Other_15 counts them off explicitly —
 * `/` and `%` do `charpos -= 1`, `^` does `-= 2`, `\` does `-= 3` — and every
 * one of those is followed by the loop's own `charpos += 1` per character, so
 * a command contributes exactly zero to the line width. Stripping before
 * wrapping is therefore the same arithmetic, not an approximation.
 *
 * The wrap runs on the char array rather than on a string so the per-character
 * style survives it: every splice the original does to `mystring` is mirrored
 * onto the style and delay arrays, and an inserted `&` or `||` inherits the
 * style of the character it was inserted after (both are non-printing, so the
 * inheritance is bookkeeping, not a colour decision).
 */
function formatChars(cs, st, dl, charline) {
  let charpos = 0;
  let remspace = -1;
  let aster = false;
  const insert = (at, chars) => {
    const style = st[at - 1] ?? DEFAULT_STYLE;
    const delay = dl[at - 1] ?? 0;
    cs.splice(at, 0, ...chars);
    st.splice(at, 0, ...chars.map(() => style));
    dl.splice(at, 0, ...chars.map(() => delay));
  };
  for (let i = 0; i < cs.length; i++) {
    const ch = cs[i];
    if (ch === '&') {
      charpos = 0;
      remspace = -1;
      // The explicit-break indent checks the next char; a wrap's (below,
      // scr_asterskip) does not. Faithful to both.
      if (aster && cs[i + 1] !== '*') {
        insert(i + 1, ['|', '|']);
        charpos = 2;
        i += 2;
      }
      continue;
    }
    if (ch === ' ') remspace = i;
    if (ch === '*') aster = true;
    charpos += 1;
    if (charpos >= charline) {
      if (remspace > 2) {
        cs[remspace] = '&';
        i = remspace;
        charpos = 1;
        remspace = -1;
        if (aster) {
          insert(i + 1, ['|', '|']);
          i += 2;
          charpos = 2;
        }
      } else {
        insert(i + 1, ['&']);
        i += 1;
        charpos = 1;
        remspace = -1;
        if (aster) {
          insert(i + 1, ['|', '|']);
          i += 2;
          charpos = 2;
        }
      }
    }
  }
  return { text: cs.join(''), style: st, delay: dl };
}

export function formatWriter(text, charline = 33) {
  return formatWriterStyled(text, charline).text;
}

/**
 * `formatWriter`, with the style the codes selected still attached — this is
 * the half a renderer needs. `text` is the wrapped glyph stream, `style[i]` is
 * the style of `text[i]`, `delay[i]` the pause frames accrued before it.
 */
export function formatWriterStyled(text, charline = 33) {
  const p = parseWriter(text);
  return formatChars(p.text.split(''), p.style.slice(), p.delay.slice(), charline);
}

/** The first turn a taunt appears. */
export const FIRST_BALLOON_TURN = 6;

export function createDialogue() {
  return { balloonturn: 0, ballooncon: 0, text: null, speaker: null, timer: 0 };
}

/**
 * One turn's advance. Called when a turn begins.
 *
 * Returns the Knight's line, or null on the silent early turns.
 */
export function advanceBalloon(dlg, state) {
  // ── THE KAIZO BALLOON SEAM, INERT unless a scene installs it ────────────
  //
  // The mod puts two lines in front of the counter (kaizo
  // gml_Object_obj_knight_enemy_Step_0.gml:206-211):
  //
  //     if (practicemode || k_sideb || !i_ex(obj_herosusie)) balloonturn = -1;
  //     if (global.hp[2] > 0 || k_freeze[2]) balloonturn++;
  //
  // so on the B-Side, in practice mode, or with Susie out of the party the
  // exchange never fires — and the second test reads Susie's CHARACTER hp,
  // not slot 1's, which on a Kris + Noelle roster is Noelle. The vanilla
  // body below cannot express any of that without knowing who is in slot 1,
  // and sim/ must not import kaizo/, so the whole advance defers to a hook
  // on the state — same shape as `state.kaizo.hooks.knightTarget` in
  // sim/damage.js. NO HOOK -> byte-identical to what it was.
  const kHook = state.kaizo?.hooks?.advanceBalloon;
  if (kHook) return kHook(dlg, state);
  // `if (global.hp[2] > 0)` — Susie must be standing for the exchange to move.
  if (state.partyHp[1] <= 0) return null;
  dlg.balloonturn += 1;
  const n = dlg.balloonturn;
  let line = KNIGHT_LINES[n];
  if (!line) return null;
  // Kris AND Ralsei both down swaps two of them.
  if (KNIGHT_ALONE[n] && state.partyHp[0] < 1 && state.partyHp[2] < 1) {
    line = KNIGHT_ALONE[n];
  }
  // The all-down variant of balloonturn 9 also swaps the reply chain: the
  // dump's branch assigns ballooncon 5 there, 4 on the normal line.
  const allDown = KNIGHT_ALONE[n] && state.partyHp[0] < 1 && state.partyHp[2] < 1;
  dlg.ballooncon = n === 9 && allDown ? 5 : (BALLOONCON[n] ?? 0);
  dlg.text = line;
  dlg.speaker = 'knight';
  dlg.timer = 0;
  return line;
}

/** The next balloon of the exchange, run from the previous one's dismissal. */
export function advanceReply(dlg) {
  if (!dlg.ballooncon) return null;
  const con = dlg.ballooncon;
  const line = SUSIE_LINES[con] ?? null;
  // The con-8 link queues con 9 with `balloonend = 0`, so the middle balloon
  // is dismissed like a knight balloon (the C-arm applies, and its death
  // queues the next line) rather than ending the talk. Speaker doubles as
  // the balloonend flag in this model: 'knight' = more queued, 'susie' =
  // final, gate on the writer's death alone.
  dlg.ballooncon = BALLOON_CHAIN[con] ?? 0;
  dlg.text = line;
  dlg.speaker = dlg.ballooncon ? 'knight' : 'susie';
  dlg.timer = 0;
  return line;
}

export function clearDialogue(dlg) {
  dlg.text = null;
  dlg.speaker = null;
}

/**
 * ONE CHARACTER A FRAME — measured, not estimated.
 *
 * This was 2, from a note that said typer 81 reveals "roughly two characters
 * a frame". It reveals one. `scr_texttype` passes `rate` into
 * `scr_textsetup(font, colour, x, y, charline, shake, RATE, sound, hspace,
 * vspace, special)`, and both typers this fight uses are rate 1:
 *
 *     case 75: scr_textsetup(dotumche, c_black, x, y, 33, 0, 1, snd_txtsus, 9, 20, 0)
 *     case 81: scr_textsetup(dotumche, c_black, x, y, 33, 0, 1, snd_tv_voice_short, 9, 20, 0)
 *
 * and the writer's Alarm 0 re-arms with `alarm[0] = rate` while advancing
 * `pos += 1` once. Alarms 1 and 2 only play the voice blip — neither adds a
 * character, which is what makes "two a frame" wrong rather than a rounding.
 * So the Susie exchange was typing at DOUBLE speed; the battle-message box
 * was already correct because its call site passes `1` explicitly.
 *
 * PURE TEXT LOGIC, so it lives in sim/ rather than render/. The turn loop has
 * to know when a line has finished typing (to decide whether Z advances or
 * the line auto-holds), and a sim module importing from render/ to find that
 * out is the dependency arrow pointing the wrong way — sim/ is the half that
 * must run headless.
 */
export const CHARS_PER_FRAME = 1;

/** Characters revealed after `timer` frames at `cps` characters a frame. */

/**
 * How many characters are up at `timer`, with the `^` pauses counted.
 *
 * `delay` is the frames a character had to wait beyond its own position, and
 * it only ever climbs, so the walk stops at the first character that is not
 * out yet. **With no pause anywhere in the string this is `floor(timer * cps)`
 * and nothing else** — the same arithmetic the reveal has always used, which
 * is what makes the seam inert on every string this engine types.
 */
function revealCount(text, delay, timer, cps) {
  const n = Math.floor(timer * cps);
  if (delay.length === 0 || delay[delay.length - 1] === 0) return n;
  // `delay` is indexed over the whole stream including `&`, which costs no
  // reveal tick, so walk the two together.
  let shown = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '&') continue;
    if (Math.floor((timer - delay[i]) * cps) < shown + 1) break;
    shown += 1;
  }
  return shown;
}

export function revealed(text, timer, cps = CHARS_PER_FRAME) {
  const p = parseWriter(text);
  const n = revealCount(p.text, p.delay, timer, cps);
  const lines = p.text.split('&');
  let left = n;
  const out = [];
  for (const line of lines) {
    if (left <= 0) break;
    out.push(line.slice(0, left));
    left -= line.length;
  }
  return out;
}

/**
 * The lines a renderer should draw, and the style of every character in them
 * — the writer's Draw output, wrapped, revealed and tinted, in one call.
 *
 * `formatWriter` + `revealed` cannot carry style between them: the first
 * returns a plain string and the second parses it again, by which time the
 * codes are already gone. Anything that wants to PAINT what `\c` selected
 * has to go through here instead. `styles[i][j]` is the style of
 * `lines[i][j]`; a clean string gives DEFAULT_STYLE for every character, so a
 * caller can skip the whole business with one identity test.
 */
export function writerLines(text, { charline = 33, timer = 1e9, cps = CHARS_PER_FRAME } = {}) {
  const f = formatWriterStyled(text, charline);
  const n = revealCount(f.text, f.delay, timer, cps);
  const lines = [];
  const styles = [];
  let left = n;
  let i = 0;
  while (i <= f.text.length) {
    let end = f.text.indexOf('&', i);
    if (end === -1) end = f.text.length;
    if (left <= 0) break;
    const take = Math.min(end - i, left);
    lines.push(f.text.slice(i, i + take));
    styles.push(f.style.slice(i, i + take));
    left -= end - i;
    if (end === f.text.length) break;
    i = end + 1;
  }
  return { lines, styles };
}

export function dialogueDone(text, timer) {
  const p = parseWriter(text);
  return revealCount(p.text, p.delay, timer, CHARS_PER_FRAME)
    >= p.text.split('&').join('').length;
}

/**
 * The timer value at which `text` is fully revealed — obj_writer's
 * `skipme` in this model's terms:
 *
 *     pos = string_length(mystring) + 1;
 *
 * X held is not a faster crawl in the original, it is the whole line at
 * once, so the skip assigns this rather than adding to the rate.
 */
export function dialogueSkipTimer(text) {
  const p = parseWriter(text);
  // The pauses are part of how long the line takes, so they are part of where
  // the skip has to land. `totalDelay` is 0 for every string here, so this is
  // the old expression until something uses a `^`.
  return Math.ceil(p.text.split('&').join('').length / CHARS_PER_FRAME) + p.totalDelay;
}

/**
 * scr_textsound — THE TYPEWRITER BLIP, and it is per-typer, not one sound.
 *
 * `scr_textsetup`'s EIGHTH argument names it, from the same table row that
 * carries the font, the spacing and the shadow:
 *
 *     case  6  mainbig   c_white  rate 1  snd_text             (message box,
 *                                                               and the ending)
 *     case 75  dotumche  c_black  rate 1  snd_txtsus           (Susie's balloon)
 *     case 81  dotumche  c_black  rate 1  snd_tv_voice_short   (the Knight's)
 *     case 667 main      c_white  rate 2  snd_nosound          (Game Over)
 *
 * So the Knight does not talk, he TRANSMITS — his balloon is voiced by the
 * same TV-static syllables the chapter's televisions use, and the Game Over
 * screen is deliberately silent. Neither is a detail a generic "text beep"
 * would have got right.
 *
 * WHAT DOES NOT PLAY, from scr_textsound's own list: a space, and any of
 * `^ ! . ? , : / \ | *`. That is not a nicety — "* We.. we actually beat
 * it?" is thirteen silent characters out of twenty-seven, and blipping on
 * all of them is the difference between speech and a machine gun. `&` and a
 * newline look AHEAD one character instead (at rate < 3) and blip on that.
 *
 * Holding X mutes it (`button2_h()` -> `playtextsound = 0`) unless the line
 * is unskippable. The caller passes `muted` because input lives outside this
 * module.
 */
const SILENT_CHARS = new Set([' ', '^', '!', '.', '?', ',', ':', '/', '\\', '|', '*']);

export function textSoundChar(text, timer, cps = CHARS_PER_FRAME) {
  // The character revealed BY this frame: pos is 1-based in the original and
  // `getchar = string_char_at(mystring, pos)` at rate <= 2.
  const p = parseWriter(text);
  const s = p.text.split('&').join('\n');
  const pos = p.totalDelay === 0
    ? Math.floor(timer * cps)
    : revealCount(p.text, p.delay, timer, cps);
  if (pos < 1 || pos > s.length) return null;
  let ch = s[pos - 1];
  let at = pos - 1;
  // `if (getchar == "&" || getchar == "\n")` — at rate < 3 the blip belongs
  // to the character AFTER the break, not to the break.
  if ((ch === '&' || ch === '\n') && cps >= 0.5) { ch = s[pos] ?? ''; at = pos; }
  // `textsound = snd_nosound` — EnderCat8's `\ck` arm. The blip is not made
  // quieter, it is not played, and the whole point of the Knight's kaizo
  // taunts is that they arrive without a voice.
  if (p.style[at]?.silent) return null;
  if (!ch || SILENT_CHARS.has(ch)) return null;
  return ch;
}

/**
 * TYPER 81'S voice is NINE SAMPLES, picked per character:
 *
 *     var rand = irandom(8) + 1;
 *     soundindex = "snd_tv_voice_short" + (rand >= 2 ? "_" + rand : "");
 *     ...all nine stopped...
 *     snd_play_x(soundindex, 0.7, 0.86 + random(0.35));
 *
 * `global.flag[1054]` multiplies the pitch and is forced to 1 the first time
 * it is read, so it is 1 here.
 *
 * NOT THE KNIGHT'S BALLOON — retracting an earlier claim in this file. This
 * fight never reaches typer 81: `obj_knight_enemy`'s Step sets it at line 110
 * and then sets 75 again at lines 196 and 296, on the same frame each
 * `scr_enemyblcon` builds its writer. Both balloons are snd_txtsus. Nothing
 * reads this constant; it stays as the record of what 81 would sound like if
 * anything ever selected it, so that a future reader does not re-derive the
 * wrong conclusion from the typer table alone.
 */
export const TV_VOICE_COUNT = 9;
