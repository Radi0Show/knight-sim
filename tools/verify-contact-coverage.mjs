#!/usr/bin/env node
// CAN EVERY ATTACK ACTUALLY HIT YOU?
//
// The one question no other suite asks. Every attack has its own file pinning
// its geometry, its timings and its state machine against the dump or a
// recording, and an attack can pass all of that while being COMPLETELY
// HARMLESS — the bullets fly the right paths, the right number of them, at the
// right speeds, and nothing ever connects. Nothing is wrong on any traced
// column, so nothing fails.
//
// It had happened. `obj_fallingsword` and four other unused-attack bullets
// were testing contact with `scr_precise_hit(n)` at **n = 0** — a single-point
// probe at the soul's centre against a hairline mask. The dump does not call
// scr_precise_hit for ANY of them (its only callers are splitslash,
// pointing_star, pointing_starchild and roaring_star), so the probe was an
// invented stand-in, and against a 5-row sliver it essentially never
// coincided. Swordfall landed nothing at all in seven hundred frames.
//
// The real test for those bullets is the engine's own: obj_heart's collision
// event fires on a MASK-VS-MASK overlap, which is `enginePairHit`. Swapping to
// it roughly doubled the contact on swordslash, underbox and knightlines and
// took swordfall from zero to hittable.
//
// THE SOUL HAS TO MOVE. A stationary soul is not a fair probe: the knight
// stream is a cross that sweeps around a pivot, and the pivot — the middle of
// the arena, where an idle soul sits — is a genuine safe spot. Standing still
// measures the safe spot, not the attack.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { ATTACK_MENU } from '../sim/scenes/single.js';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const NONE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

/** Walk the arena in a slow square, so no one spot can be a hiding place. */
function circling(f) {
  const i = { ...NONE };
  const leg = Math.floor(f / 20) % 4;
  if (leg === 0) i.right = 1;
  else if (leg === 1) i.down = 1;
  else if (leg === 2) i.left = 1;
  else i.up = 1;
  return i;
}

const FRAMES = 700;
const rows = [];

for (const entry of ATTACK_MENU) {
  const st = createState({ seed: 909, traceBulletSlots: 0 });
  // The recorder stands in for the damage handler, exactly as the oracle
  // patches do — counting contact without killing the party and ending the
  // run early.
  st.damageEnabled = false;
  let built = true;
  try {
    buildSingleAttackScene(st, {
      seed: 909, attack: entry.id, difficulty: entry.difficulties[0] ?? 0,
    });
  } catch (err) {
    built = false;
    fail.push(`${entry.id} would not build: ${err.message}`);
  }
  if (!built) continue;

  for (let f = 0; f < FRAMES; f++) stepFrame(st, circling(f));
  const c = st.counters;
  rows.push({
    id: entry.id,
    checks: c.collisionChecks,
    hits: c.collisionHits,
    unmasked: c.unmaskedBullets ?? 0,
  });
}

for (const r of rows) {
  // A bullet with no mask at all can never hit and is counted separately, so
  // "the check ran and said no" stays distinguishable from "no check ran".
  check(r.unmasked === 0,
    `${r.id}: ${r.unmasked} bullet-frames had NO registered mask — those bullets`
    + ' cannot hit anything, ever');
  check(r.checks > 0, `${r.id}: no collision check ever ran — the attack spawns nothing`);
  check(r.hits > 0,
    `${r.id}: ${r.checks} contact checks and NOT ONE HIT. The attack is harmless;`
    + ' its bullets fly the right paths and connect with nothing');
}

console.log('contact coverage — can each attack actually hit? (no oracle)\n');
for (const r of rows) {
  console.log(`  ${r.id.padEnd(12)} ${String(r.checks).padStart(6)} checks`
    + `  ${String(r.hits).padStart(4)} hits`);
}

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log(`\nPASS  all ${rows.length} attacks connect against a moving soul`);
