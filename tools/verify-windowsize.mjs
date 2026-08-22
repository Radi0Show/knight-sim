// SMALL must be the size DELTARUNE itself opens at, not "the biggest whole
// multiple that fits" -- those differ on most real displays.
//
// Every case below is the GML loop evaluated by hand from
// gml_Object_obj_time_Create_0.gml. The discriminating ones are marked: each
// is a case where a plausible-looking rewrite of the loop gives a different
// answer, which is the only reason a table like this is worth having.
import { deltaruneMultiplier } from '../render/windowsize.js';

const cases = [
  // [ displayW, displayH, expected, why ]
  [640, 480, 1, 'the frame itself: no room for 2x, and the floor is 1 not 0'],
  [1280, 960, 1, 'DISCRIMINATES >= : exactly 2x fails the STRICT test, so 1x'],
  [1281, 961, 2, 'one pixel over on both axes is the first size that clears 2x'],
  [1281, 960, 1, 'DISCRIMINATES per-axis: width clears, height does not'],
  [1280, 961, 1, 'the mirror: height clears, width does not'],
  [1470, 956, 1, 'this laptop panel -- wide enough for 2x, four rows short'],
  [1512, 982, 2, 'the default 14in panel DOES clear 2x, so the game opens 1280x960'],
  [1920, 1080, 2, 'ordinary 1080p: 2x fits, 3x needs 1440 rows'],
  [2560, 1440, 2, 'DISCRIMINATES width-only: 2560 would allow 3x (1920) but 1440 rows do not'],
  [3840, 2160, 4, '4K: 4x needs 1920 rows and has 2160; 5x needs 2400'],
  [99999, 99999, 11, 'DISCRIMINATES the cap: the loop stops at _ww < 12'],
];

let failed = 0;
for (const [w, h, want, why] of cases) {
  const got = deltaruneMultiplier(w, h);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(w).padStart(5)}x${String(h).padEnd(5)} -> ${got}x` +
    `${ok ? '' : ` (want ${want}x)`}   ${why}`);
}

// The loop must never return something a caller would divide by or floor to
// zero, at any display size at all.
for (let w = 1; w <= 5000; w += 7) {
  for (const h of [1, 479, 480, 481, 959, 960, 961, 3000]) {
    const m = deltaruneMultiplier(w, h);
    if (!Number.isInteger(m) || m < 1 || m > 11) {
      console.log(`  FAIL ${w}x${h} -> ${m}, outside the integer range 1..11`);
      failed++;
    }
  }
}

console.log(failed === 0
  ? 'verify-windowsize: OK — SMALL tracks obj_time'
  : `verify-windowsize: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
