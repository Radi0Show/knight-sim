#!/usr/bin/env node
// Rotating Slash at difficulties 1 and 2 — the phase 2 and phase 3 variants.
//
// Runs BOTH recordings in one pass; a difficulty that regresses names itself.
// Exact string equality throughout: this attack's state machine is integers
// and simple approaches, with no trig in anything compared here.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState, stepFrame } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { real } from '../sim/trace.js';
import {
  buildRotatingDifficultyScene,
  ORACLE_ROT_INPUT,
  ROT_WINDOW,
  SPIRAL_WINDOW,
  ROT_VARIANTS,
} from './scenes/oracle-rotating-difficulty.js';

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

const STATE_FIELDS = [
  // The spiral finisher's own state. `aim_type` and `final_counter` are the
  // ones that matter: they are integers with no trig anywhere near them, so a
  // finisher that fires the right number of slashes on the wrong frames
  // cannot slip through.
  'aim_type',
  'final_counter',
  'speed_gain',
  'cooldown_time',
  'aim_x',
  'aim_y',
  'state',
  'timer',
  'slash_number',
  'slash_counter',
  'slash_base',
  'slash_offset',
  'aim_direction',
  'rotation',
  'local_turntimer',
  'spin',
];

function runOne(which) {
  const path = join(homedir(), 'knight-research', 'traces', `rotating_d${which}.csv`);
  const lines = readFileSync(path, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
  const oracle = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const frame = Number(c[0]);
    if (!oracle.has(frame)) oracle.set(frame, { slashes: 0 });
    const f = oracle.get(frame);
    if (c[1] === 'obj_knight_rotating_slash') f.attack = parseVars(c[20]);
    else if (c[1] === 'obj_roaringknight_slash') f.slashes += 1;
  }

  // Difficulty 2 runs to the end of its recording, because only difficulty 2
  // has a spiral finisher — `do_final` is gated on
  // `difficulty == 2 && turn_type == "full"`. Difficulty 1 winds down at
  // `slashes_done` instead and its window stops where the cuts do.
  const { from } = ROT_WINDOW;
  const to = which === '2' ? SPIRAL_WINDOW.to : ROT_WINDOW.to;
  const state = createState({ seed: 1, traceBulletSlots: 0 });
  buildRotatingDifficultyScene(state, which);
  const inputAt = makeInputTable(ORACLE_ROT_INPUT);

  let checked = 0;
  let cutCycles = 0;
  let prevCounter = 0;
  let peakFinal = 0;
  let destroyedAt = null;
  const failures = [];

  for (let frame = 0; frame <= to; frame++) {
    stepFrame(state, inputAt(frame));
    if (frame < from) continue;

    const exp = oracle.get(frame);
    const a = state.entities.find(
      (e) => e.alive && e.type.name === 'obj_knight_rotating_slash',
    );

    // LIFETIME is compared, not just state. Alarm_3 destroys the attack 22
    // frames after the last slash; without it the engine kept a live instance
    // for the rest of the recording and nothing noticed.
    const oracleHas = !!(exp && exp.attack);
    if (oracleHas !== !!a) {
      failures.push(
        `frame ${frame}: attack alive  oracle=${oracleHas}  engine=${!!a}`,
      );
      break;
    }
    if (!oracleHas) {
      if (destroyedAt === null) destroyedAt = frame;
      continue;
    }

    if (a.slash_counter > prevCounter) cutCycles += 1;
    prevCounter = a.slash_counter;
    if (a.final_counter > peakFinal) peakFinal = a.final_counter;

    const cmp = [];
    for (const k of STATE_FIELDS) {
      const mine = typeof a[k] === 'string' ? a[k] : real(a[k]);
      cmp.push([k, exp.attack[k], mine]);
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

  return { failures, checked, cutCycles, peakFinal, destroyedAt, path };
}

let bad = 0;
for (const which of Object.keys(ROT_VARIANTS)) {
  const r = runOne(which);
  console.log(`difficulty ${which}: ${r.path}`);
  if (r.failures.length) {
    for (const f of r.failures) console.log(`  → DIVERGENCE  ${f}`);
    bad += 1;
    continue;
  }
  if (r.checked < 500 || r.cutCycles < 5) {
    console.log(
      `  EXECUTION ASSERTION FAILED: checked=${r.checked} cutCycles=${r.cutCycles}`,
    );
    console.log('  expected checked >= 500, cutCycles >= 5');
    bad += 1;
    continue;
  }
  // POSITIVE ASSERTION for the spiral. Everything compared above exists
  // whether or not the finisher runs, so a finisher that never fired would
  // pass on the wind-down alone. Difficulty 2 must reach 28 slashes and must
  // then be destroyed by Alarm_3 — measured at frame 363.
  if (which === '2' && (r.peakFinal < 28 || r.destroyedAt !== 363)) {
    console.log(
      `  EXECUTION ASSERTION FAILED: peakFinal=${r.peakFinal} destroyedAt=${r.destroyedAt}`,
    );
    console.log('  expected final_counter 28 and destruction at frame 363');
    bad += 1;
    continue;
  }

  console.log(
    `  → ${r.checked} comparisons exact, ${r.cutCycles} cut cycles` +
      (which === '2'
        ? `, spiral ran ${r.peakFinal} slashes, destroyed at frame ${r.destroyedAt}`
        : ''),
  );
}

if (bad) process.exit(1);
console.log(
  `\nPASS  rotating slash — d1 frames ${ROT_WINDOW.from}..${ROT_WINDOW.to}, ` +
    `d2 frames ${ROT_WINDOW.from}..${SPIRAL_WINDOW.to} with the spiral finisher`,
);
