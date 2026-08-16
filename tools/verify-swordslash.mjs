#!/usr/bin/env node
// Swordslash (ac 0, dc.type 109) — obj_bullet_knight_crescentGenerator.
//
// NO ORACLE: the selector never assigns ac 0. Every assertion is
// positive-execution, and the list is shaped by what this attack is easy to
// get wrong in ways nothing on screen would report:
//
//   * THE SLOT. `view.x + 320 - 152` with `maxxscale = 0.5` — a 37-pixel-wide
//     arena at x 168, full height. maxyscale is NOT touched.
//   * THE CLAMP. obj_knight_enemy's End Step holds the soul at
//     `camerax() + 165` for the whole turn. This project already paid for that
//     line once, in reverse: a default `myattackchoice = 0` on a knight with
//     no attack running is the "soul outside the box" root cause CLAUDE.md
//     records. It is this attack's wall.
//   * SIX LANES ACROSS THE WHOLE BOX. `boxheight` is read ONCE, at con 0, from
//     the live `box.sprite_height` — so the arena has to have finished growing
//     before the attack starts, exactly as the fight's 12-frame rtimer gap
//     arranges. With the board still opening the lanes come out 22 pixels
//     apart instead of 150, and the attack looks like it fires down one line.
//   * PAIRS, MIRRORED. Two crescents per shot, the lower one `image_yscale
//     = -2`.
//   * NEGATIVE FRICTION. `hspeed = -1, friction = -0.35` — they ACCELERATE.
//   * THE MASK IS NOT THE SPRITE. `mask_index = spr_bullet_knightcrescent_hitbox`.
//   * DIFFICULTY 1 IS A DIFFERENT ATTACK. `d.type = 3` adds the diagonal
//     sweep, which travels at the SOUL'S OWN walking speed.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { CRESCENT_MASK } from '../sim/masks.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};
const RIGHT = { ...IDLE, right: 1 };

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const live = (s, n) => s.entities.filter((e) => e.alive && e.type.name === n);
const gen = (s) => live(s, 'obj_bullet_knight_crescentGenerator')[0];

/** Run one difficulty and gather everything in a single pass. */
function run(difficulty, input = RIGHT, frames = 420) {
  const st = createState({ seed: 909, traceBulletSlots: 0 });
  buildSingleAttackScene(st, { seed: 909, attack: 'swordslash', difficulty });
  const out = {
    st,
    lanes: null,
    cons: new Set(),
    crescents: 0,
    peak: 0,
    mirrored: 0,
    upright: 0,
    accelerated: 0,
    clampViolations: 0,
    launched: false,
    box: null,
    slashAnims: 0,
    speeds: new Map(),
  };
  const seen = new Set();
  for (let f = 0; f < frames; f++) {
    stepFrame(st, input);
    const g = gen(st);
    if (g) {
      out.launched = true;
      out.cons.add(`${g.con}/${g.subcon}`);
      if (g.ypos && g.ypos.length === 6 && g.con >= 1) out.lanes = [...g.ypos];
      // Sampled EVERY frame and kept last, not first: the board is still
      // growing when the generator appears, so the first reading is 80% of a
      // scale rather than the scale.
      const gt = live(st, 'obj_growtangle')[0];
      if (gt) out.box = { x: gt.x, xs: gt.image_xscale, ys: gt.image_yscale };
    }
    // The clamp only applies once the attack is the current choice.
    if (st.currentAc === 0 && st.soul && st.soul.x > st.view.x + 165 + 1e-6) {
      out.clampViolations += 1;
    }
    out.slashAnims += live(st, 'obj_knight_crescentslash_slashinganimation').length ? 1 : 0;
    const cs = live(st, 'obj_bullet_knightcrescent');
    out.peak = Math.max(out.peak, cs.length);
    for (const c of cs) {
      if (!seen.has(c)) {
        seen.add(c);
        out.crescents += 1;
        if (c.image_yscale < 0) out.mirrored += 1; else out.upright += 1;
        out.speeds.set(c, c.speed);
      } else if (c.speed > out.speeds.get(c) + 1e-9) {
        out.accelerated += 1;
        out.speeds.set(c, c.speed);
      }
    }
  }
  return out;
}

// ------------------------------------------------------------- difficulty 0
const d0 = run(0);
check(d0.launched, 'the crescent generator never appeared');
check(d0.box !== null, 'no arena');
if (d0.box) {
  check(Math.abs(d0.box.x - 168) < 1, `the slot should sit at x 168, got ${d0.box.x}`);
  // 0.5 is not an even scale, so obj_growtangle's custom-box init QUANTISES it
  // to `round(0.5 * 37.5) / 37.5` — 19/37.5, a touch over 0.5.
  check(d0.box.xs > 0.49 && d0.box.xs < 0.52,
    `the slot should be ~0.5 wide (quantised), got ${d0.box.xs}`);
  check(Math.abs(d0.box.ys - 2) < 0.05,
    `maxyscale is untouched, so the slot is full height; got ${d0.box.ys}`);
}
check(d0.clampViolations === 0,
  `the soul left the slot on ${d0.clampViolations} frames — the End Step clamp is not holding`);

check(d0.lanes !== null, 'the six lanes were never computed');
if (d0.lanes) {
  const spread = d0.lanes[5] - d0.lanes[0];
  // boxheight 150, six lanes at 150/7 apart: 116..224, a spread of ~107.
  check(spread > 100,
    `the lanes should span the whole slot (~107px), got ${spread.toFixed(1)} —`
    + ' the box height was read while the board was still growing');
  const gaps = d0.lanes.slice(1).map((v, i) => v - d0.lanes[i]);
  check(gaps.every((g) => Math.abs(g - gaps[0]) < 0.01), 'the lanes should be evenly spaced');
}

check(d0.crescents >= 20, `expected a stream of crescents, got ${d0.crescents}`);
check(d0.mirrored > 0 && d0.upright > 0,
  `every shot is a MIRRORED PAIR: ${d0.upright} upright / ${d0.mirrored} flipped`);
check(Math.abs(d0.upright - d0.mirrored) <= 1,
  `the pair should be one of each: ${d0.upright} vs ${d0.mirrored}`);
check(d0.accelerated > 50,
  `negative friction should ACCELERATE the crescents, saw ${d0.accelerated} speed increases`);
check(d0.slashAnims > 5, `the wind-up animation should play before each shot, saw ${d0.slashAnims}`);

// THE MASK. The drawn sprite is an AxisAlignedRect over the whole 36x34 sheet;
// the hitbox is a Precise crescent. If these ever became the same thing the
// concave side of the blade would kill you from inside the curve.
check(CRESCENT_MASK.name === 'spr_bullet_knightcrescent_hitbox',
  `the crescent's mask should be the hitbox sprite, got ${CRESCENT_MASK.name}`);
{
  const inked = CRESCENT_MASK.px.filter((row) => row.some(Boolean)).length;
  const solid = CRESCENT_MASK.px.every((row) => row.every(Boolean));
  check(inked > 5 && !solid, 'the crescent mask should be a crescent, not a filled rect');
}

// ------------------------------------------------------------- difficulty 1
const d1 = run(1);
const reachedDiagonal = [...d1.cons].some((c) => c.startsWith('10/'));
check(reachedDiagonal, `difficulty 1 (type 3) should reach the diagonal, saw ${[...d1.cons].join(' ')}`);
check([...d1.cons].includes('10/3'), 'the diagonal never reached its firing sub-state');
const d0Diagonal = [...d0.cons].some((c) => c.startsWith('10/'));
check(!d0Diagonal, 'difficulty 0 (type 2) must NOT have the diagonal — that is the difference');
check(d1.crescents > d0.crescents,
  `the diagonal should add crescents: ${d1.crescents} at d1 vs ${d0.crescents} at d0`);

// ---------------------------------------------------------------- the report
console.log('Swordslash (ac 0, dc.type 109) — no oracle; unreachable content\n');
console.log(`→ slot at x ${d0.box?.x} scale ${d0.box?.xs.toFixed(3)} x ${d0.box?.ys}, `
  + `soul clamped for the whole turn`);
console.log(`→ lanes ${d0.lanes?.map((v) => Math.round(v)).join(', ')}`);
console.log(`→ d0: ${d0.crescents} crescents (${d0.upright}/${d0.mirrored} paired), `
  + `${d0.accelerated} accelerations`);
console.log(`→ d1: ${d1.crescents} crescents, diagonal states ${[...d1.cons].filter((c) => c.startsWith('10')).join(' ')}`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  Swordslash mechanics match the dump — ac 0 (UNUSED content)');
