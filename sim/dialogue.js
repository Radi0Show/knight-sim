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

/** `ballooncon == N` — Susie's reply, N = balloonturn - 5. */
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

/** `msgsetloc` uses `&` for a line break. */
export const msgLines = (s) => String(s).split('&');

/**
 * obj_writer's FORMATTER (Other_15), the part our strings exercise: wrap at
 * `charline` characters per line, breaking at the LAST SPACE (the space
 * itself becomes the `&`), force-breaking mid-word when a line has no space
 * past position 2, and indenting the continuation of a `*` line with `||`
 * (each `|` is one hspace-wide skip in the writer's Draw, so the wrapped
 * text hangs under the message rather than under the asterisk).
 *
 * `charline` comes from scr_texttype: 33 for the battle message (typer 6)
 * and the balloons (81) both. The dump's own battle strings arrive UNSPLIT —
 * "* You felt something hovering close behind your head..." is one 55-char
 * line — and the game wraps them here at draw time, which is why copying the
 * strings verbatim and skipping the formatter cut them off at the canvas
 * edge instead.
 */
export function formatWriter(text, charline = 33) {
  let s = String(text);
  let charpos = 0;
  let remspace = -1;
  let aster = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '&') {
      charpos = 0;
      remspace = -1;
      // The explicit-break indent checks the next char; a wrap's (below,
      // scr_asterskip) does not. Faithful to both.
      if (aster && s[i + 1] !== '*') {
        s = `${s.slice(0, i + 1)}||${s.slice(i + 1)}`;
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
        s = `${s.slice(0, remspace)}&${s.slice(remspace + 1)}`;
        i = remspace;
        charpos = 1;
        remspace = -1;
        if (aster) {
          s = `${s.slice(0, i + 1)}||${s.slice(i + 1)}`;
          i += 2;
          charpos = 2;
        }
      } else {
        s = `${s.slice(0, i + 1)}&${s.slice(i + 1)}`;
        i += 1;
        charpos = 1;
        remspace = -1;
        if (aster) {
          s = `${s.slice(0, i + 1)}||${s.slice(i + 1)}`;
          i += 2;
          charpos = 2;
        }
      }
    }
  }
  return s;
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
  dlg.ballooncon = n - 5;
  dlg.text = line;
  dlg.speaker = 'knight';
  dlg.timer = 0;
  return line;
}

/** The second beat: C, or the writer running out. */
export function advanceReply(dlg) {
  if (!dlg.ballooncon) return null;
  const line = SUSIE_LINES[dlg.ballooncon] ?? null;
  dlg.ballooncon = 0;
  dlg.text = line;
  dlg.speaker = 'susie';
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

export function revealed(text, timer, cps = CHARS_PER_FRAME) {
  const n = Math.floor(timer * cps);
  const lines = msgLines(text);
  let left = n;
  const out = [];
  for (const line of lines) {
    if (left <= 0) break;
    out.push(line.slice(0, left));
    left -= line.length;
  }
  return out;
}

export function dialogueDone(text, timer) {
  return Math.floor(timer * CHARS_PER_FRAME) >= msgLines(text).join('').length;
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
  return Math.ceil(msgLines(text).join('').length / CHARS_PER_FRAME);
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
  const s = msgLines(text).join('\n');
  const pos = Math.floor(timer * cps);
  if (pos < 1 || pos > s.length) return null;
  let ch = s[pos - 1];
  // `if (getchar == "&" || getchar == "\n")` — at rate < 3 the blip belongs
  // to the character AFTER the break, not to the break.
  if ((ch === '&' || ch === '\n') && cps >= 0.5) ch = s[pos] ?? '';
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
