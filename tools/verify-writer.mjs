#!/usr/bin/env node
// THE WRITER'S ESCAPE CODES — obj_writer's Draw_0, the half that never draws.
//
// The writer's per-character loop sets `accept = 0` on everything that is a
// COMMAND rather than a glyph, and this engine had no parser for any of it:
// `msgLines` split on `&` and render/menu.js drew the remainder letter by
// letter. Vanilla never noticed because every string in sim/dialogue.js was
// authored with the codes already stripped by hand — the `\EJ` note above
// ACT_PAGES is the record of that. A lane that pastes a string in verbatim
// gets `\ck` and `^2` on screen.
//
// No oracle: none of these strings is in a recording, and no recording carries
// a text colour column. So every assertion here is a positive-execution one on
// the scanner's own output, in both directions:
//
//   * A CODE WAS EATEN **AND** THE STYLE IT SELECTS CAME OUT. "the text looks
//     right" and "the parser never ran" produce the same glyph stream for a
//     clean string, and `parseWriter` publishes `codes` precisely so the two
//     are distinguishable. Every consumed-code assertion below is paired with
//     one on `codes` and one on `style`.
//   * NOTHING THIS ENGINE TYPES CHANGED. The other half of the suite walks
//     every writer-fed string in the tables and requires the scanner to hand
//     it back character for character with DEFAULT_STYLE throughout — the same
//     claim the fullfight md5 diff makes, made where a reader can see it.
//
// THE PAUSE. `^<n>` is a real timing command (Alarm_0 adds 5/10/15/20/30/40/
// 60/90/150 frames to the next step) and consuming it without honouring it
// would silently shorten a line. It is translated, and it is UNEXERCISED: the
// literal scan below finds no `^` in any string this engine types, so the
// translation cannot move a gate here and no recording can pin it. Both facts
// are asserted, so neither can rot into an assumption.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseWriter, msgLines, formatWriter, formatWriterStyled, writerLines,
  revealed, dialogueDone, dialogueSkipTimer, textSoundChar,
  DEFAULT_STYLE, WRITER_COLORS, WRITER_PAUSE,
  KNIGHT_LINES, SUSIE_LINES, KNIGHT_ALONE, ACT_PAGES, ACT_TEXT,
} from '../sim/dialogue.js';
import { BATTLE_MSG, OPENING_MSG, phase4Msg, downMsg } from '../sim/battlemsg.js';
import { VICTORY_LINES } from '../sim/victory-scene.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

// ═══ 1. THE CODES ARE CONSUMED, AND THE STYLE THEY SELECT COMES OUT ═══════
//
// The measured defect, verbatim. `\ck` is EnderCat8's one addition to the
// writer and `^2` is the pause; both used to reach the glyph stream.
const TAUNT = String.raw`\ck* Well, aren't you something special...^2?&* Go ahead.`;
const t = parseWriter(TAUNT);

check(t.codes === 2, `the taunt carries two codes, the scanner ate ${t.codes}`);
check(!t.text.includes('\\'), 'a backslash survived into the glyph stream');
check(!t.text.includes('^'), 'a caret survived into the glyph stream');
check(t.text === "* Well, aren't you something special...?&* Go ahead.",
  `the printable stream is wrong: ${JSON.stringify(t.text)}`);
check(msgLines(TAUNT).join('|') === "* Well, aren't you something special...?|* Go ahead.",
  `msgLines still leaks codes: ${JSON.stringify(msgLines(TAUNT))}`);

// THE STYLE IS THE OTHER HALF. A scanner that deleted `\ck` and published
// nothing would pass every assertion above and would have thrown the whole
// point away — the taunt is meant to arrive grey, shaking and voiceless.
check(t.style[0] !== DEFAULT_STYLE, 'the `\\ck` selected nothing at all');
check(String(t.style[0].color) === String(WRITER_COLORS.k),
  `\\ck is c_gray, got ${JSON.stringify(t.style[0].color)}`);
check(t.style[0].silent === true, '\\ck sets textsound = snd_nosound');
check(t.style[0].shake === 1, '\\ck sets shake = 1');
check(t.style.every((s) => s.silent && s.shake === 1),
  'the two flags LATCH — every character after the code carries them');
// And the blip has to actually stop. textsound is what scr_textsound plays.
let voiced = 0;
for (let i = 1; i <= 80; i++) if (textSoundChar(TAUNT, i)) voiced += 1;
check(voiced === 0, `a \\ck line must type in silence, heard ${voiced} blips`);

// ── the pause, translated from Alarm_0 ────────────────────────────────────
// `^2` is +10 frames. The characters before it are unaffected; everything
// after is pushed back by exactly that much.
check(t.totalDelay === 10, `^2 is ten frames, got ${t.totalDelay}`);
const noPause = parseWriter("* Well, aren't you something special...?&* Go ahead.");
check(dialogueSkipTimer(TAUNT) === dialogueSkipTimer(noPause.text) + 10,
  'the pause has to be part of how long the line takes');
// The reveal actually stalls: at the frame the un-paused line would be one
// character further on, the paused one is not.
const pausedAt = (timer) => revealed(TAUNT, timer, 1).join('').length;
const plainAt = (timer) => revealed(noPause.text, timer, 1).join('').length;
check(pausedAt(38) === plainAt(38), 'before the pause the two lines type alike');
check(pausedAt(45) < plainAt(45), 'after the pause the paused line is behind');
check(pausedAt(70) === plainAt(60),
  'and it catches up exactly ten frames late, not approximately');
for (const [arg, frames] of Object.entries(WRITER_PAUSE)) {
  check(parseWriter(`ab^${arg}cd`).totalDelay === frames,
    `^${arg} should buy ${frames} frames`);
}
check(parseWriter('ab^0cd').totalDelay === 0, '^0 is not in the table and buys nothing');
check(parseWriter('ab^0cd').text === 'abcd', '^0 is still consumed');

// ── every other colour arm, and the ones that are not colours ─────────────
for (const [arg, rgb] of Object.entries(WRITER_COLORS)) {
  const p = parseWriter(`A\\c${arg}B`);
  check(p.text === 'AB', `\\c${arg} was not consumed: ${JSON.stringify(p.text)}`);
  check(p.style[0] === DEFAULT_STYLE, `\\c${arg} tinted the character BEFORE it`);
  check(String(p.style[1].color) === String(rgb),
    `\\c${arg} should select ${rgb}, got ${p.style[1].color}`);
}
// `\c0` restores the writer's own colour rather than picking one.
const back = parseWriter('A\\cRB\\c0C');
check(back.text === 'ABC', '\\c0 was not consumed');
check(String(back.style[1].color) === String(WRITER_COLORS.R), '\\cR did not take');
check(back.style[2].color === null, '\\c0 must hand the colour back to the writer');
// An UNRECOGNISED command still eats its argument — `accept = 0; n += 2;` is
// unconditional in the Draw. A scanner that only knew the arms it models would
// spill the stray letter into the text.
const unknown = parseWriter('A\\EJB\\Zq C');
check(unknown.text === 'AB C', `an unknown code leaked: ${JSON.stringify(unknown.text)}`);
check(unknown.codes === 2, `both unknown codes should be eaten, got ${unknown.codes}`);
// The face codes the ACT_PAGES header says were stripped BY HAND now survive
// the machine, which is what lets a lane paste a line in unedited.
check(parseWriter('\\EJ\\FS* Susie talked to the Knight!').text
  === '* Susie talked to the Knight!', 'the face codes are still leaking');

// ── the halt characters ───────────────────────────────────────────────────
const halted = parseWriter('* A page./%');
check(halted.text === '* A page.', `\`/%\` leaked: ${JSON.stringify(halted.text)}`);
check(halted.halt === 2, `\`/%\` is halt 2, got ${halted.halt}`);
check(parseWriter('* A page./').halt === 1, 'a bare `/` is halt 1');
check(parseWriter('* Bye.%%').destroy === true, '`%%` destroys the writer');
check(parseWriter('* Bye.%%').text === '* Bye.', '`%%` leaked into the text');
const paged = parseWriter('* One.%* Two.');
check(paged.nextmsg === 1, 'a bare `%` asks for the next page');
check(paged.text === '* One.* Two.', 'the page break leaked');
check(parseWriter('\\C2 pick').halt === 5, '\\C<n> halts for the choicer');
check(parseWriter('\\s0 x').skippable === false, '\\s0 makes the line unskippable');
check(parseWriter('\\s1 x').skippable === true, '\\s1 hands the skip back');

// ── the backtick, which is the one escape that KEEPS its character ────────
const lit = parseWriter('A`#B');
check(lit.text === 'A#B', `the backtick escape lost its character: ${JSON.stringify(lit.text)}`);
check(lit.codes === 1, 'the backtick itself is a code');
// And it must not re-examine what it escaped.
check(parseWriter('A`\\B').text === 'A\\B', 'a backtick-escaped backslash is a glyph');

// ── `&` and `|` are KEPT, deliberately ────────────────────────────────────
// Stripping them here would delete every line break and the hanging indent
// under a "* ", which this engine has drawn correctly for months.
check(parseWriter('a&b').text === 'a&b', 'the line break must survive the scanner');
check(parseWriter('a||b').text === 'a||b', 'the indent skip must survive the scanner');
check(msgLines('a&b').length === 2, 'msgLines still splits on the break');

// ── the style survives the WRAP, which is where a naive seam loses it ─────
const wrapped = formatWriterStyled(TAUNT, 33);
check(wrapped.style.length === wrapped.text.length,
  'the style array must stay parallel to the wrapped text');
check(wrapped.style.every((s) => s.shake === 1),
  'the wrap dropped the style on the characters it moved');
const wl = writerLines(TAUNT, { charline: 33 });
check(wl.lines.length === wl.styles.length, 'writerLines must return one style row per line');
for (let i = 0; i < wl.lines.length; i++) {
  check(wl.lines[i].length === wl.styles[i].length,
    `line ${i}'s style row is the wrong length`);
}
check(wl.styles.at(-1).at(-1).shake === 1,
  'the LAST character of the LAST line lost its style — the wrap re-indexed it');
// The wrap is unchanged by the scanner: the codes are width-neutral in
// Other_15 (`charpos -= 1/2/3` against the loop's own `+= 1`), so stripping
// first has to land the breaks where the original's formatter would.
check(formatWriter(TAUNT, 33) === formatWriter(noPause.text, 33),
  'the codes changed where the line wraps, and they must not');

// ═══ 2. NOTHING THIS ENGINE TYPES CHANGED ════════════════════════════════
//
// Every string that reaches a writer, walked through the scanner. `text`
// identical and every style entry the shared DEFAULT_STYLE object — an
// identity test, not a deep compare, so a style that merely LOOKS default
// still fails.
const fed = [];
const feed = (s) => { if (typeof s === 'string' && s) fed.push(s); };
for (const v of Object.values(KNIGHT_LINES)) feed(v);
for (const v of Object.values(SUSIE_LINES)) feed(v);
for (const v of Object.values(KNIGHT_ALONE)) feed(v);
for (const pages of Object.values(ACT_PAGES)) for (const p of pages) feed(p);
for (const v of Object.values(ACT_TEXT)) feed(v);
for (const v of Object.values(BATTLE_MSG)) feed(v);
feed(OPENING_MSG);
for (let t4 = 0; t4 <= 3; t4 += 1) {
  for (const hp of [0, 100]) {
    for (const roar of [false, true]) {
      for (const pro of [false, true]) feed(phase4Msg(t4, hp, roar, pro));
    }
  }
}
for (const hp of [[0, 0, 0], [100, 0, 0], [0, 100, 0], [0, 0, 100], [100, 100, 100]]) {
  feed(downMsg(hp, new Set()));
  feed(downMsg(hp, new Set([0, 1, 2])));
}
for (const l of VICTORY_LINES) feed(l.text);

let clean = 0;
for (const s of fed) {
  const p = parseWriter(s);
  if (p.text !== s) { fail.push(`the scanner changed a live string: ${JSON.stringify(s)}`); continue; }
  if (p.codes !== 0) { fail.push(`a live string carried a code: ${JSON.stringify(s)}`); continue; }
  if (!p.style.every((st) => st === DEFAULT_STYLE)) {
    fail.push(`a live string picked up a style: ${JSON.stringify(s)}`);
    continue;
  }
  if (p.totalDelay !== 0) { fail.push(`a live string carried a pause: ${JSON.stringify(s)}`); continue; }
  // The four consumers a scene actually calls, against the arithmetic they
  // used before the seam existed.
  const lines = s.split('&');
  if (msgLines(s).join('') !== lines.join('')) {
    fail.push(`msgLines moved: ${JSON.stringify(s)}`);
    continue;
  }
  const len = lines.join('').length;
  if (dialogueSkipTimer(s) !== Math.ceil(len)) {
    fail.push(`dialogueSkipTimer moved: ${JSON.stringify(s)}`);
    continue;
  }
  if (dialogueDone(s, len) !== true || dialogueDone(s, len - 1) !== false) {
    fail.push(`dialogueDone moved: ${JSON.stringify(s)}`);
    continue;
  }
  if (revealed(s, 5, 1).join('') !== lines.join('').slice(0, 5)) {
    fail.push(`revealed moved: ${JSON.stringify(s)}`);
    continue;
  }
  clean += 1;
}
check(fed.length > 60, `only ${fed.length} live strings collected — the sweep lost its sources`);

// ═══ 3. THE GREP, so the pause decision cannot rot ═══════════════════════
//
// "No string this engine types contains a `^`" is the whole argument for the
// pause being inert here, so it is a test rather than a sentence in a comment.
// This walks every string literal in sim/ and render/ — comments stripped —
// and allows exactly the three that are not writer text.
const ALLOWED_CARETS = new Set([
  '^', // sim/dialogue.js SILENT_CHARS' own entry
  '^at ', // sim/rng.js, a stack-frame regex
  'file:///[^ )]*/(sim|kaizo)/', // sim/rng.js, the same
]);
const BS = String.fromCharCode(92);
function literals(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { literals(p, out); continue; }
    if (!p.endsWith('.js')) continue;
    const src = readFileSync(p, 'utf8');
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') {
        i += 2;
        while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') {
        let j = i + 1;
        let buf = '';
        while (j < src.length && src[j] !== c) {
          if (src[j] === BS) { buf += src[j] + src[j + 1]; j += 2; continue; }
          buf += src[j];
          j++;
        }
        i = j + 1;
        out.push({ p, s: buf });
        continue;
      }
      i++;
    }
  }
  return out;
}
const lits = literals(join(ROOT, 'sim')).concat(literals(join(ROOT, 'render')));
const carets = lits.filter((l) => l.s.includes('^') && !ALLOWED_CARETS.has(l.s));
check(lits.length > 3000, `the literal scan found only ${lits.length} — it is not reading the tree`);
check(carets.length === 0,
  `a string literal now carries a "^": ${carets.map((c) => JSON.stringify(c.s)).join(', ')}`
  + ' — the pause is no longer unexercised, so it needs a recording or a label');

// ───────────────────────────────────────────────────────────── report
console.log("obj_writer's escape codes — the scanner (no oracle; see header)\n");
console.log(`→ the taunt: ${t.codes} codes eaten, ${t.totalDelay}f of pause, `
  + `style c_gray/silent/shake${t.style[0].shake}`);
console.log(`→ ${Object.keys(WRITER_COLORS).length} colour arms, `
  + `${Object.keys(WRITER_PAUSE).length} pause steps, halt // %% \` \\c \\s \\C`);
console.log(`→ ${clean} of ${fed.length} live strings round-trip unchanged, all DEFAULT_STYLE`);
console.log(`→ ${lits.length} string literals scanned in sim/ + render/: `
  + `${carets.length} unaccounted carets — the pause is inert here`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  the codes are eaten, the style they select comes out, '
  + 'and no live string moved');
