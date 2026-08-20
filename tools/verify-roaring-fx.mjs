#!/usr/bin/env node
// ROARING'S EFFECT LAYER — the half of obj_knight_roaring2 that the oracle
// diff cannot see.
//
// `verify-roaring-pull` compares the soul, the stars, the camera and
// ball_darkness against `traces/roaring2.csv` row by row, and passed the whole
// time these effects were missing: the recording has no column for a screen
// copy or a particle, so an attack with none of them diffs clean. Reported
// from play as ROARING being "all sorts of wrong" and short of effects — which
// it was, and nothing here could tell.
//
// THE KNIGHT DISAPPEARING is the one that reads worst. His whole visibility is
// `fake_alpha`, and the wind-up FADES HIM OUT on purpose:
//
//     if (intensity == 3.74 && knight_sprite == 664)
//         scr_script_delayed(scr_lerpvar, 8, "fake_alpha", 1, 0, 32);
//
// behind a white bloom. The roar is what brings him back, and it is a bare
// assignment rather than a lerp — he is THERE, at full alpha, on the frame he
// screams:
//
//     if (roaring_timer == 9) { ... fake_alpha = 1; ... }
//
// That single line was missing, so the fade never reversed.
//
// NO ORACLE, by construction — see above. Every assertion is positive
// execution on the sim's own entity list.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { STAR_MASK, STAR_FULL_MASK, scrPreciseHit } from '../sim/masks.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

const st = createState({ seed: 777, traceBulletSlots: 0 });
buildSingleAttackScene(st, { seed: 777, attack: 'roaring', difficulty: 0 });

const peak = Object.create(null);
const total = Object.create(null);
const seen = new Set();
/** The inward-pulling copies and the outward-blowing ones are different sets. */
let inward = 0;
let outward = 0;
let streaks = 0;
/** The view, and the widest streak drawn into it. */
const VIEW_W = 640;
/** `spr_pixel_white_front` is 4x4 — the manifest's, and the whole problem. */
const STREAK_SHEET_W = 4;
let longestStreak = 0;
let fadedTo = 1;
let alphaAfterRoar = null;
let roarFrame = -1;
let flashSeen = false;
let darkCircleSeen = false;

for (let f = 0; f < 900; f++) {
  stepFrame(st, IDLE);
  const live = Object.create(null);
  for (const e of st.entities) {
    if (!e.alive) continue;
    const n = e.type.name;
    live[n] = (live[n] ?? 0) + 1;
    if (seen.has(e)) continue;
    seen.add(e);
    total[n] = (total[n] ?? 0) + 1;
    if (n === 'obj_afterimage_screen') {
      if (e.xrate < 0) inward += 1;
      if (e.xrate > 0) outward += 1;
    }
    if (n === 'obj_particle_generic' && e.sprite_index === 'spr_pixel_white_front') {
      streaks += 1;
    }
    if (n === 'obj_knight_circle') {
      if (e.r === 255 && e.g === 255 && e.b === 255) flashSeen = true;
      if (e.r === 0 && e.g === 0 && e.b === 0) darkCircleSeen = true;
    }
  }
  for (const k of Object.keys(live)) peak[k] = Math.max(peak[k] ?? 0, live[k]);
  for (const e of st.entities) {
    if (!e.alive || e.type.name !== 'obj_particle_generic') continue;
    longestStreak = Math.max(longestStreak, e.image_xscale * STREAK_SHEET_W);
  }

  const r = st.entities.find((e) => e.alive && e.type.name === 'obj_knight_roaring2');
  if (!r) continue;
  // The deepest he fades during the wind-up, before the roar starts.
  if (r.roaring_timer < 1) fadedTo = Math.min(fadedTo, r.fake_alpha ?? 1);
  if (r.roaring_timer === 9 && roarFrame < 0) roarFrame = f;
  if (r.roaring_timer > 20) alphaAfterRoar = r.fake_alpha;
}

// ------------------------------------------------------- THE KNIGHT RETURNS
check(fadedTo < 0.5,
  `he should fade out behind the bloom during the wind-up; the lowest fake_alpha was ${fadedTo}`);
check(roarFrame > 0, 'the roar never happened');
check(alphaAfterRoar === 1,
  `fake_alpha must be back to 1 after the roar — the reported bug. It is ${alphaAfterRoar}`);

// ------------------------------------------------------------ THE ECHOES
// Both directions have to exist, and they are the same object with opposite
// rates — a translation that spawned only one set would still show "some"
// echoes, so counting them together proves nothing.
check(inward > 20,
  `the wind-up pulls the screen IN (xrate -0.01) every 3 frames; saw ${inward} copies`);
check(outward > 20,
  `the roar blows it OUT (xrate +0.015) every 3 frames; saw ${outward} copies`);
check((total.obj_afterimage_screen ?? 0) > 60,
  `expected a stream of screen copies, got ${total.obj_afterimage_screen ?? 0}`);
check((peak.obj_afterimage_screen ?? 0) > 3,
  'the copies should overlap — each lives long enough for the next few to start');

// --------------------------------------------------------- THE IN-RUSH LINES
// `timer >= 136 && intensity < 3.75`, one EVERY frame — the modulo in the
// original is `(timer % 1) == 0`, which is always true.
check(streaks > 100,
  `the in-rush streaks fire once a frame for ~270 frames; saw ${streaks}`);
check((peak.obj_particle_generic ?? 0) > 5,
  `they should overlap heavily, peak was ${peak.obj_particle_generic ?? 0}`);
// AND THEY MUST NOT SPAN THE SCREEN — the reported bug, and the one number
// this file exists to hold down. `spr_pixel_white_front` is 4px wide, so the
// dump's `image_xscale` lerp from 320 multiplies out to a 1280px bar on a
// 640px view; the untouched translation peaked at 1200px, once a frame for
// the whole wind-up. STREAK_UNIT divides that back to a length in pixels.
// See the note at the spawn site: a deviation on a play report, not a
// reading, which is exactly why it needs a test rather than a comment alone.
check(longestStreak > 0, 'no streak was measured at all');
check(longestStreak < VIEW_W,
  `a streak should not span the view; the longest was ${longestStreak.toFixed(0)}px`
  + ` against a ${VIEW_W}px screen`);

// ------------------------------------------------------------- THE CIRCLES
// TWO, and they are opposites: a BLACK one at intensity 3.66 whose colour
// goals lerp up to white over 48 frames, and a plain WHITE one on the roar.
check(darkCircleSeen, 'the intensity-3.66 circle (r/g/b 0, goals lerping to 255) is missing');
check(flashSeen, "the roar's white flash (r/g/b 255 on its Create defaults) is missing");
check((total.obj_knight_circle ?? 0) >= 2,
  `both circles should appear, got ${total.obj_knight_circle ?? 0}`);

// ---------------------------------------------------- THE RINGS' REAL MASK
// The circling stars collide with `spr_knight_bullet_star`'s OWN precise mask
// — the full four-pointed star, 2040 inked pixels, spikes reaching the sheet
// edge. Only the STARS attack's pointing star overrides mask_index to the
// small 853px diamond (`spr_knight_bullet_star_mask`). The rings ran on the
// diamond for a while — 42% of the real hitbox — and no oracle suite could
// see it: traces/roaring2.csv has no ring-contact frames, so positions and
// counts diffed clean while the rings passed through the soul. Reported from
// play as the circling stars being far too generous, and pinned here so the
// two masks can never be swapped again.
{
  const inkOf = (m) => m.px.reduce((n, row) => n + row.reduce((a, c) => a + (c ? 1 : 0), 0), 0);
  check(inkOf(STAR_FULL_MASK) === 2040,
    `the ring mask is the full star, 2040 px; got ${inkOf(STAR_FULL_MASK)}`);
  check(inkOf(STAR_MASK) === 853,
    `the pointing-star override is the small diamond, 853 px; got ${inkOf(STAR_MASK)}`);
  // The spikes are the part the diamond lacks — the widest row spans the
  // sheet, and it is the spike that clips you as a ring sweeps past. (Cells
  // are truthy, not literal 1s — findIndex(Boolean), not indexOf.)
  const span = (row) => {
    const a = row.findIndex(Boolean);
    if (a < 0) return 0;
    let b = row.length - 1;
    while (b > a && !row[b]) b -= 1;
    return b - a + 1;
  };
  const widest = Math.max(...STAR_FULL_MASK.px.map(span));
  check(widest >= 63, `the full mask's spikes should span the sheet, widest row ${widest}`);

  // And a spike contact DISCRIMINATES the two. Found from the data, not
  // hand-picked: the farthest cell (from the origin) that is inked in the
  // FULL mask and clear in the small one — a spike tip by construction. A
  // probe there registers on the full mask and cannot on the diamond.
  let tip = null;
  let best = -1;
  for (let cy = 0; cy < 64; cy++) {
    for (let cx = 0; cx < 64; cx++) {
      if (!STAR_FULL_MASK.px[cy][cx] || STAR_MASK.px[cy][cx]) continue;
      const d = Math.hypot(cx - 32, cy - 32);
      if (d > best) { best = d; tip = [cx, cy]; }
    }
  }
  check(tip !== null, 'the full mask should have ink the diamond lacks');
  check(best > 20, `the extra ink should reach spike distance, farthest ${best.toFixed(1)}px`);
  const star = { x: 320, y: 160, image_xscale: 1, image_yscale: 1, image_angle: 0 };
  // scrPreciseHit probes at (heart.x + 10, heart.y + 10); the star's origin is
  // (32, 32), so cell (cx, cy) sits at world (320 + cx - 32, 160 + cy - 32).
  const heart = { x: 320 + tip[0] - 32 - 10, y: 160 + tip[1] - 32 - 10 };
  check(scrPreciseHit(heart, star, STAR_FULL_MASK, 2) === true,
    'a spike-tip touch must register on the full mask');
  check(scrPreciseHit(heart, star, STAR_MASK, 2) === false,
    '...and must NOT register on the small diamond — the masks are distinct');
}

console.log('ROARING effects (ac 9) — no oracle; the trace has no column for these\n');
console.log(`→ screen copies: ${inward} inward (wind-up) + ${outward} outward (roar),`
  + ` peak ${peak.obj_afterimage_screen} at once`);
console.log(`→ ${streaks} in-rush streaks, peak ${peak.obj_particle_generic},`
  + ` longest ${longestStreak.toFixed(0)}px on a ${VIEW_W}px view`);
console.log(`→ ${total.obj_knight_circle} circles: the dark one at intensity 3.66, the white one on the roar`);
console.log(`→ fake_alpha ${fadedTo} at its lowest, back to ${alphaAfterRoar} after the roar`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  ROARING draws its whole effect layer, and the Knight comes back');
