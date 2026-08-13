#!/usr/bin/env node
// Flurry (ac 2, dc.type 99) against knight-research/traces/flurry.csv.
//
// The oracle trace is in the universal recorder's LONG format — one row per
// instance per frame, with every instance variable in a trailing `k=v|` field
// — so this compares state directly rather than going through the wide CSV
// writer. Same discipline: exact string equality on formatted values, first
// divergence wins, and positive execution assertions so a silently dead code
// path cannot pass.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState, stepFrame } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { real } from '../sim/trace.js';
import {
  buildOracleFlurryScene,
  ORACLE_FLURRY_INPUT,
  FLURRY_WINDOW,
} from './scenes/oracle-flurry.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 'flurry.csv');

// ---- parse the long-format oracle trace -----------------------------------

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
const oracle = new Map(); // frame -> { manager, slashes[], organism }

for (const line of lines.slice(1)) {
  const c = line.split(',');
  const frame = Number(c[0]);
  const obj = c[1];
  if (!oracle.has(frame)) oracle.set(frame, { slashes: [] });
  const f = oracle.get(frame);
  if (obj === 'obj_roaringknight_boxsplitter_attack') f.manager = parseVars(c[20]);
  else if (obj === 'obj_roaringknight_splitslash') f.slashes.push(parseVars(c[20]));
  else if (obj === 'obj_knight_split_growtangle') f.organism = parseVars(c[20]);
}

// ---- run the sim ----------------------------------------------------------

const { from, to } = FLURRY_WINDOW;
const state = createState({ seed: 1, traceBulletSlots: 0 });
buildOracleFlurryScene(state);
const inputAt = makeInputTable(ORACLE_FLURRY_INPUT);

const find = (name) => state.entities.filter((e) => e.alive && e.type.name === name);

let checked = 0;
let slashesSeen = 0;
let hitsApplied = 0;
const seenStrike = new Set();
const failures = [];

for (let frame = 0; frame <= to; frame++) {
  stepFrame(state, inputAt(frame));

  // THE CONTACT IS COMPUTED, not replayed. It used to be fed in at its
  // recorded frame because `scr_precise_hit` had no implementation; it now
  // does (sim/masks.js), and the engine fires the hit itself.
  for (const sl of find('obj_roaringknight_splitslash')) {
    if (sl.playerstrike === 1 && !seenStrike.has(sl.seq)) {
      seenStrike.add(sl.seq);
      hitsApplied += 1;
    }
  }

  if (frame < from) continue;
  const exp = oracle.get(frame);
  if (!exp) continue;

  const cmp = [];

  const mg = find('obj_roaringknight_boxsplitter_attack')[0];
  if (exp.manager && !mg) {
    failures.push(`frame ${frame}: oracle has a manager, sim has none`);
    break;
  }
  if (!exp.manager && mg) {
    failures.push(`frame ${frame}: sim has a manager, oracle has none`);
    break;
  }
  if (mg) {
    for (const k of ['timer', 'spawn_speed', 'slash_count', 'local_turntimer', 'spawn_range']) {
      cmp.push([`manager.${k}`, exp.manager[k], real(mg[k])]);
    }
  }

  const slashes = find('obj_roaringknight_splitslash');
  slashesSeen = Math.max(slashesSeen, slashes.length);
  cmp.push(['slash_count_live', String(exp.slashes.length), String(slashes.length)]);

  // Compare slashes in spawn order on the fields that drive the cut.
  if (exp.slashes.length === slashes.length) {
    const byTimer = [...exp.slashes].sort((a, b) => Number(b.timer) - Number(a.timer));
    const mine = [...slashes].sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < mine.length; i++) {
      for (const k of ['timer', 'active', 'playerstrike', 'hurt_delay']) {
        cmp.push([`slash[${i}].${k}`, byTimer[i][k], real(Number(mine[i][k] ?? 0))]);
      }
    }
  }

  const org = find('obj_knight_split_growtangle')[0];
  cmp.push(['organism_alive', exp.organism ? '1' : '0', org ? '1' : '0']);
  if (exp.organism && org) {
    for (const k of ['con', 'timer', 'split_delay']) {
      cmp.push([`organism.${k}`, exp.organism[k], real(org[k])]);
    }
  }

  for (const [name, o, s] of cmp) {
    if (o === undefined) continue;
    checked += 1;
    if (String(o) !== String(s)) {
      failures.push(`frame ${frame}: ${name}  oracle=${o}  engine=${s}`);
      break;
    }
  }
  if (failures.length) break;
}

// ---- report ---------------------------------------------------------------

console.log(`oracle: ${oraclePath}`);
console.log(`window: frames ${from}..${to}\n`);

if (failures.length) {
  for (const f of failures) console.log(`→ DIVERGENCE  ${f}`);
  process.exit(1);
}

// Positive execution assertions. A cadence check that never spawned a slash,
// never created the organism, or never landed the hit would pass on emptiness
// — which is exactly how a dead collision path once hid. `hitsApplied` now
// counts CONTACTS THE ENGINE COMPUTED; requiring exactly 1 is what proves the
// new scr_precise_hit fires on the right frame and only then, because the
// manager's timer/local_turntimer feedback is compared exactly.
if (checked < 1000 || slashesSeen < 1 || hitsApplied !== 1) {
  console.log(
    `EXECUTION ASSERTION FAILED: checked=${checked} slashesSeen=${slashesSeen} hitsComputed=${hitsApplied}`,
  );
  console.log('  expected checked >= 1000, slashesSeen >= 1, hitsComputed == 1');
  process.exit(1);
}

console.log(`→ ${checked} value comparisons, all exact`);
console.log(`→ peak live slashes ${slashesSeen}, ${hitsApplied} contact COMPUTED (not replayed)`);
console.log(`\nPASS  frames ${from}..${to} match the real game — Flurry cadence and cut handoff`);
