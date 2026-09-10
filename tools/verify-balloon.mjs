// THE SPEECH BALLOON'S GEOMETRY — the box Susie's lines are drawn in.
//
// This suite exists because the balloon was wrong for months, was reported
// from play twice, was "fixed" once in the wrong direction, and every other
// suite stayed green through all of it. The render smoke test cannot see it:
// it drives a stub canvas with no font loaded, and drawDialogue returns early
// on `!font.ready`, so a draw-call probe cannot tell a correct balloon from a
// broken one. render/dialogue.js's `balloonGeometry` was lifted out of the
// drawer for exactly this reason — it is the arithmetic, with no canvas.
//
// THE BUG, and it is one word. obj_battleblcon's Draw sizes the body as
//
//     balloonheight = ((linecount + 1) * vspace) + 5
//
// and `linecount` is the number of line BREAKS, not the number of LINES.
// obj_writer's Other_15 sets `linecount = 0` at :7 and does `linecount += 1`
// at :164 (the `&` branch), :199 and :212 (the two word-wrap branches) — every
// one of them at a break. A three-line string has two breaks, so the writer
// hands the balloon `linecount == 2` and `(linecount + 1) * vspace` is already
// THREE line-heights.
//
// Reading `linecount` as the line COUNT and adding one made every balloon a
// whole 20px too tall. `writingy = initwritingy - (balloonheight / 2)` then
// put half of that above the anchor, so the text sat 10px high in a box 20px
// too deep. Measured in the browser on Susie's first line: 12 rows of white
// above the first glyph row and 31 below the last. Nothing was ever clipped —
// which is why the "the balloon is 20px SHORT" reading pointed the wrong way.
//
// It had a second symptom nobody connected to it: `if (balloonheight < 40)
// blconscale = 0.5` (Draw:109) gives a ONE-LINE balloon a half-height tail.
// With the spare 20px a one-line balloon measured 45 and got a full-height
// tail instead. So the fix corrects the tail too, and that is asserted below
// because it is an independent consequence of the same number.

import {
  SUSIE_LINES, KNIGHT_LINES, KNIGHT_ALONE,
} from '../sim/dialogue.js';
import { balloonGeometry } from '../render/dialogue.js';

const VSPACE = 20;
const failures = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) failures.push(msg); };
const eq = (a, b, msg) => { checks += 1; if (a !== b) failures.push(`${msg}: got ${a}, want ${b}`); };

// ── the height is exactly `lines * vspace + 5`, with no spare line ─────────
{
  for (let n = 1; n <= 6; n++) {
    const text = Array.from({ length: n }, (_, i) => `line${i}`).join('&');
    const g = balloonGeometry(text);
    eq(g.lines.length, n, `a ${n}-break-free string wraps to ${n} lines`);
    eq(g.bh, n * VSPACE + 5, `balloonheight for ${n} lines is (linecount + 1) * 20 + 5`);
    // The regression itself, stated as the thing that must not come back.
    ok(g.bh - g.lines.length * VSPACE === 5,
      `the body carries NO spare line-height at ${n} lines (the +1 bug)`);
  }
}

// ── the body sits where `- balloonheight / 2` puts it ────────────────────
//
// `writingy = initwritingy - (balloonheight / 2)` (Draw:89, the side -1 arm)
// against `initwritingy = obj_herosusie.y + 38` plus the writer's own +3. The
// deeper of the two rectangles spans `writingy - 10` to `writingy +
// balloonheight`, so in LINE BOXES the text has 10 above it and 5 below — the
// GML's `+ 5` all lands at the bottom, and that asymmetry is the game's, not
// a defect. It comes out balanced on screen because a glyph does not fill its
// line box: measured in a browser on Susie's first line, 12 rows of white
// above the first ink row and 11 below the last. Those are the numbers to
// re-measure if this is ever doubted; what is asserted here is the relation
// they come from, which is exact.
{
  for (const [key, text] of Object.entries(SUSIE_LINES)) {
    const g = balloonGeometry(text);
    const n = g.lines.length;
    ok(Math.abs((g.writingY + g.bh / 2) - (g.ay + 3)) < 1e-9,
      `SUSIE_LINES[${key}] centres the body on the anchor (Draw:89)`);
    eq(g.writingY - (g.boxY - 10), 10.5,
      `SUSIE_LINES[${key}] has ten line-box rows above the first line`);
    eq((g.boxY + g.bh) - (g.writingY + n * VSPACE), 4.5,
      `SUSIE_LINES[${key}] has the GML's five below the last`);
    ok((g.boxY + g.bh) - (g.writingY + (n - 1) * VSPACE) >= VSPACE,
      `SUSIE_LINES[${key}]'s last line fits inside the body`);
  }
}

// ── the tail's half-height threshold flips where the GML flips it ──────────
{
  eq(balloonGeometry('one line').tailScale, 0.5,
    'a one-line balloon (height 25) takes the half tail — Draw:109');
  eq(balloonGeometry('two&lines').tailScale, 1,
    'a two-line balloon (height 45) takes the full tail');
  // Under the +1 bug a one-line balloon measured 45 and took the FULL tail,
  // so this pair fails in both directions if the height regresses.
  ok(balloonGeometry('one line').bh < 40, 'and it is under 40 because it is 25');
  ok(balloonGeometry('two&lines').bh >= 40, 'while two lines is 45, over the line');
}

// ── every line the fight can actually raise ───────────────────────────────
//
// POSITIVE EXECUTION: this counts what it measured, so "the loop never ran"
// and "every line was fine" are different observations.
{
  let measured = 0;
  const all = [
    ...Object.values(SUSIE_LINES),
    ...Object.values(KNIGHT_LINES),
    ...Object.values(KNIGHT_ALONE),
  ].filter((t) => typeof t === 'string');
  for (const text of all) {
    const g = balloonGeometry(text);
    measured += 1;
    ok(g.lines.length >= 1 && g.bw > 0, `"${text.slice(0, 24)}" has a body`);
    eq(g.bh, g.lines.length * VSPACE + 5, `"${text.slice(0, 24)}" sizes off its line count`);
  }
  ok(measured >= 20, `measured every raisable line (${measured})`);
}

// ── the reported case, pinned to the numbers a reader can check on screen ──
{
  const g = balloonGeometry(SUSIE_LINES[1]);
  eq(g.lines.length, 3, 'Susie\'s first line is three lines');
  eq(g.bh, 65, 'so its body is 65 deep, not the 85 the bug produced');
  eq(g.boxY - 10, 140, 'the body\'s top row');
  eq(g.boxY + g.bh, 215, 'and its bottom row — 76 rows, as the browser measures it');
}

console.log(`verify-balloon: ${checks - failures.length}/${checks} assertions passed`);
for (const f of failures) console.log(`  FAIL ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
