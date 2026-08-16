#!/usr/bin/env node
// The combination attack (ac 7, dc.type 105) — obj_knight_combinations.
//
// NO ORACLE: the selector never assigns ac 7. What this pins is the one thing
// the object is actually FOR — the order of the three segments and the handoff
// between them — plus the finding that makes it translatable at all.
//
// THE SHUFFLE IS DEAD CODE. Other_10 builds [2,3,4,5], shuffles it, derives
// first/second/third_attack from it (with two de-dupe guards that test for an
// attack the list never contains), and then OVERWRITES all three from
// `obj_knight_enemy`'s own fields — which its Create sets to 4, 2 and 3 and
// which nothing else in the dump ever writes. So the combination is always
// swordfall -> rotating slash -> sword tunnel (revised).
//
// That retires a documented blocker: CLAUDE.md carries `ds_list_shuffle` as
// unsolved and names it as what stands between this project and this attack.
// It stands between nothing. The draws are still burned (16 per element,
// measured in-game) and the sim burns them too, so the stream stays aligned —
// which is the only part of a shuffle anything downstream can observe.
//
// ALL THREE SEGMENTS NOW RUN. Segment 3 is obj_knight_tunnel_slasher_2_revised
// — ac 3's own attack — and translating it completed this one, so the
// assertions below moved from "the chain stops here, deliberately" to "the
// chain runs to the end and the turn closes itself".

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';
import { COMBO_ATTACKS, COMBO_ORDER, comboSequence } from '../sim/attacks/combination.js';
import { gmlCreate, gmlShuffle, gmlU32 } from '../sim/rng.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

/** Every object a combination turn can be running. */
const SEGMENT_NAMES = new Set(Object.values(COMBO_ATTACKS).map((a) => a.name));

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const live = (s, n) => s.entities.filter((e) => e.alive && e.type.name === n);

// ------------------------------------------------- the order, from the dump
check(COMBO_ORDER.first === 4 && COMBO_ORDER.second === 2 && COMBO_ORDER.third === 3,
  `the Knight's Create fixes the order at 4, 2, 3; got ${COMBO_ORDER.first},`
  + ` ${COMBO_ORDER.second}, ${COMBO_ORDER.third}`);
check(COMBO_ORDER.power === 1, 'combo_power is 1 — the "short" three-attack form');
check(comboSequence()[0] === 'obj_knight_swordfall', 'segment 1 is swordfall');
check(comboSequence()[1] === 'obj_knight_rotating_slash', 'segment 2 is the rotating slash');
check(comboSequence()[2] === 'obj_knight_tunnel_slasher_2_revised',
  'segment 3 is the revised sword tunnel');

// ------------------------------------------- the shuffle: draws, not results
// The measured fact is the DRAW COUNT — 16 u32 per element, constant across
// seeds (traces/shuffle-probe.csv). Asserted directly, because it is the only
// part of ds_list_shuffle this project can defend and the only part that has
// an observable effect here.
{
  const a = gmlCreate(12345);
  const before = [];
  for (let i = 0; i < 200; i++) before.push(gmlU32(a));

  const b = gmlCreate(12345);
  gmlShuffle(b, [2, 3, 4, 5]);
  // 4 elements x 16 = 64 burned, then Fisher-Yates takes 3 more (n-1).
  const after = [];
  for (let i = 0; i < 10; i++) after.push(gmlU32(b));
  const expectedAt = 64 + 3;
  check(after[0] === before[expectedAt],
    `after shuffling 4 elements the stream should sit at draw ${expectedAt};`
    + ' the 16-per-element count is the measured half of ds_list_shuffle');
}

// AND THE RESULT IS DISCARDED. Different seeds shuffle differently and the
// sequence must not move — that is the whole finding, expressed as a test.
{
  const orders = [1, 999, 20260816].map((seed) => {
    const st = createState({ seed, traceBulletSlots: 0 });
    buildSingleAttackScene(st, { seed, attack: 'combination', difficulty: 0 });
    const order = [];
    let last = '';
    for (let f = 0; f < 400; f++) {
      stepFrame(st, IDLE);
      const seg = st.entities.find(
        (e) => e.alive && SEGMENT_NAMES.has(e.type.name),
      );
      const key = seg ? `${seg.type.name}:${seg.turn_type}` : '';
      if (key && key !== last) { order.push(key); last = key; }
    }
    return order.join(' -> ');
  });
  check(orders.every((o) => o === orders[0]),
    `the segment order must not depend on the seed — the shuffle is discarded:\n    ${orders.join('\n    ')}`);
  check(orders[0].startsWith('obj_knight_swordfall:short start'),
    `the first segment should be swordfall on "short start", got ${orders[0]}`);
}

// ------------------------------------------------------------- the handoff
{
  const st = createState({ seed: 4242, traceBulletSlots: 0 });
  buildSingleAttackScene(st, { seed: 4242, attack: 'combination', difficulty: 0 });
  const stages = [];
  let last = '';
  let knightHidden = 0;
  let bothAtOnce = 0;
  let endedAt = -1;
  // CAPTURED WHEN IT HAPPENS, not read at the end: the drill loops, and each
  // launch clears `comboUntranslated` for the new run.
  let sawUntranslated = null;
  for (let f = 0; f < 400; f++) {
    stepFrame(st, IDLE);
    const segs = st.entities.filter((e) => e.alive && SEGMENT_NAMES.has(e.type.name));
    if (segs.length > 1) bothAtOnce += 1;
    const key = segs.map((e) => `${e.type.name}:${e.turn_type}/${e.turn_segment}`).join(' + ');
    if (key !== last) { stages.push(key || '(none)'); last = key; }
    const k = live(st, 'obj_knight_enemy')[0];
    if (k && k.image_alpha === 0) knightHidden += 1;
    if (endedAt < 0 && st.turntimer === -1) endedAt = f;
    if (st.comboUntranslated) sawUntranslated = st.comboUntranslated;
  }

  check(stages[0] === 'obj_knight_swordfall:short start/0',
    `segment 1 should be swordfall "short start" at segment 0, got ${stages[0]}`);
  check(stages[1] === 'obj_knight_rotating_slash:short mid/1',
    `segment 2 should be the rotating slash PROMOTED to "short mid" at segment 1,`
    + ` got ${stages[1]}`);
  // The promotion is by turn_segment, so a mis-set segment silently produces
  // "end" — the two-attack form — and the combination would be one short with
  // nothing else looking different.
  check(bothAtOnce === 0, 'the segments run one at a time, not overlapping');
  check(knightHidden > 50, `the Knight stays hidden through the turn, saw ${knightHidden}`);

  check(stages[2] === 'obj_knight_tunnel_slasher_2_revised:short end/2',
    `segment 3 should be the revised tunnel PROMOTED to "short end" at segment 2,`
    + ` got ${stages[2]}`);
  check(sawUntranslated === null,
    `every segment is translated now, so nothing should record a stop; got ${sawUntranslated}`);
  check(endedAt > 0, 'the turn never ended — the last segment closes the clock');
  check(COMBO_ATTACKS[2].type !== null && COMBO_ATTACKS[3].type !== null
    && COMBO_ATTACKS[4].type !== null,
    'all three segments of the fixed order must be registered');

  console.log(`→ ${stages.filter((s) => s !== '(none)').join('  ->  ')}`);
  console.log(`→ turn ended at frame ${endedAt}; stopped at ${sawUntranslated}`);
}

console.log('\ncombination (ac 7, dc.type 105) — no oracle; unreachable content');
console.log(`→ order fixed at ${comboSequence().join(' -> ')} (the shuffle is discarded)`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  combination chains all three segments — ac 7 (UNUSED content)');
