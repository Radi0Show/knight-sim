#!/usr/bin/env node
// Sword Tunnel at difficulties 3 and 4 — the phase 2 and phase 3 variants.
// Difficulty 3 is tobymode 3, the sweeping corridor; difficulty 4 is tobymode 0
// with a tighter gap. Exact string equality: nothing compared here is a
// diagonal-trig product.
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
  buildTunnelDifficultyScene,
  ORACLE_TUNNEL_D_INPUT,
  TUNNEL_D_WINDOW,
  TUNNEL_D_VARIANTS,
} from './scenes/oracle-tunnel-difficulty.js';

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

const STATE_FIELDS = [
  'timer',
  'finishtimer',
  'swordy',
  'swordcount',
  'setcount',
  'waitsetcount',
  'movedirection',
  'sworddirection',
  'tobytimer',
  'verticalchange',
  'gapsize',
];

function runOne(which) {
  const path = join(homedir(), 'knight-research', 'traces', `tunnel_d${which}.csv`);
  const lines = readFileSync(path, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
  const oracle = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const frame = Number(c[0]);
    if (!oracle.has(frame)) oracle.set(frame, { slashes: 0 });
    const f = oracle.get(frame);
    if (c[1] === 'obj_sword_tunnel_manager') f.attack = parseVars(c[20]);
    else if (c[1] === 'obj_sword_tunnel_sword') f.slashes += 1;
  }

  const { from, to } = TUNNEL_D_WINDOW;
  const state = createState({ seed: 1, traceBulletSlots: 0 });
  buildTunnelDifficultyScene(state, which);
  const inputAt = makeInputTable(ORACLE_TUNNEL_D_INPUT);

  let checked = 0;
  let cutCycles = 0;
  let prevCounter = 0;
  const failures = [];

  const hitFrames = TUNNEL_D_VARIANTS[which].hitFrames ?? [];
  let hitsApplied = 0;

  for (let frame = 0; frame <= to; frame++) {
    stepFrame(state, inputAt(frame));

    // Replay the recorded contact — see the scene header.
    if (hitFrames.includes(frame)) {
      const live = state.entities.filter(
        (e) => e.alive && e.type.name === 'obj_roaringknight_splitslash',
      );
      if (live.length !== 1) {
        failures.push(`frame ${frame}: hit replay expected 1 live slash, found ${live.length}`);
        break;
      }
      splitslash.onHit(live[0], state);
      hitsApplied += 1;
    }

    if (frame < from) continue;

    const exp = oracle.get(frame);
    if (!exp || !exp.attack) continue;
    const a = state.entities.find(
      (e) => e.alive && e.type.name === 'obj_sword_tunnel_manager',
    );
    if (!a) {
      failures.push(`frame ${frame}: oracle has the attack, engine has none`);
      break;
    }

    if (a.swordcount !== prevCounter) cutCycles += 1;
    prevCounter = a.swordcount;

    const cmp = [];
    for (const k of STATE_FIELDS) {
      // `vertical` and `diagonal` start life as JS booleans (the GML Create
      // assigns `false`) and become 0/1 once a cut sets them. The oracle
      // prints both as reals, so coerce before formatting.
      const v = a[k];
      const mine = typeof v === 'string' ? v : real(typeof v === 'boolean' ? Number(v) : v);
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

  return { failures, checked, cutCycles, path, hitsApplied, hitsWanted: hitFrames.length };
}

let bad = 0;
for (const which of Object.keys(TUNNEL_D_VARIANTS)) {
  const r = runOne(which);
  console.log(`difficulty ${which}: ${r.path}`);
  if (r.failures.length) {
    for (const f of r.failures) console.log(`  → DIVERGENCE  ${f}`);
    bad += 1;
    continue;
  }
  if (r.hitsApplied !== r.hitsWanted) {
    console.log(`  EXECUTION ASSERTION FAILED: replayed ${r.hitsApplied}/${r.hitsWanted} contacts`);
    bad += 1;
    continue;
  }
  if (r.checked < 500 || r.cutCycles < 20) {
    console.log(
      `  EXECUTION ASSERTION FAILED: checked=${r.checked} cutCycles=${r.cutCycles}`,
    );
    console.log('  expected checked >= 500, cutCycles >= 20');
    bad += 1;
    continue;
  }
  console.log(`  → ${r.checked} comparisons exact, ${r.cutCycles} set transitions, ${r.hitsApplied} contact(s) replayed`);
}

if (bad) process.exit(1);
console.log(
  `\nPASS  frames ${TUNNEL_D_WINDOW.from}..${TUNNEL_D_WINDOW.to} — sword tunnel difficulties 3 and 4`,
);
