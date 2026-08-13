#!/usr/bin/env node
// Box Splitter at difficulties 1 and 3 — the phase 2 and phase 3 variants.
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
import { splitslash } from '../sim/attacks/splitslash.js';
import {
  buildSplitterDifficultyScene,
  ORACLE_SPLIT_INPUT,
  SPLIT_WINDOW,
  SPLIT_VARIANTS,
} from './scenes/oracle-splitter-difficulty.js';

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
  'spawn_speed',
  'slash_count',
  'local_turntimer',
  'vertical',
  'diagonal',
  'spawn_range',
];

function runOne(which) {
  const path = join(homedir(), 'knight-research', 'traces', `splitter_d${which}.csv`);
  const lines = readFileSync(path, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
  const oracle = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(',');
    const frame = Number(c[0]);
    if (!oracle.has(frame)) oracle.set(frame, { slashes: 0 });
    const f = oracle.get(frame);
    if (c[1] === 'obj_roaringknight_boxsplitter_attack') f.attack = parseVars(c[20]);
    else if (c[1] === 'obj_roaringknight_splitslash') f.slashes += 1;
  }

  const { from, to } = SPLIT_WINDOW;
  const state = createState({ seed: 1, traceBulletSlots: 0 });
  buildSplitterDifficultyScene(state, which);
  const inputAt = makeInputTable(ORACLE_SPLIT_INPUT);

  let checked = 0;
  let cutCycles = 0;
  let prevCounter = 0;
  const failures = [];

  const hitFrames = SPLIT_VARIANTS[which].hitFrames ?? [];
  let hitsApplied = 0;
  const seenStrike = new Set();

  for (let frame = 0; frame <= to; frame++) {
    stepFrame(state, inputAt(frame));

    // CONTACT IS STILL REPLAYED HERE, unlike verify-flurry.
    //
    // `scr_precise_hit` is implemented now (sim/masks.js) and Flurry's contact
    // is computed from it exactly. This suite is not switched over because
    // difficulty 3's cut lands on a 0.04 PIXEL boundary — the bar's near edge
    // sits at x 321.54 against the soul box's 321.5 — and the exact-geometry
    // model misses it. Flooring the instance position (which the precise-mask
    // model does) fixes that frame but produces a FALSE POSITIVE at 173.
    // Calibrating the boundary needs a measured sweep like the 48-point study
    // behind masksOverlap, not a guess, so the contact stays replayed until
    // then and the suite stays honest about it.
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
      (e) => e.alive && e.type.name === 'obj_roaringknight_boxsplitter_attack',
    );
    if (!a) {
      failures.push(`frame ${frame}: oracle has the attack, engine has none`);
      break;
    }

    if (a.slash_count > prevCounter) cutCycles += 1;
    prevCounter = a.slash_count;

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
for (const which of Object.keys(SPLIT_VARIANTS)) {
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
  if (r.checked < 500 || r.cutCycles < 5) {
    console.log(
      `  EXECUTION ASSERTION FAILED: checked=${r.checked} cutCycles=${r.cutCycles}`,
    );
    console.log('  expected checked >= 500, cutCycles >= 5');
    bad += 1;
    continue;
  }
  console.log(`  → ${r.checked} comparisons exact, ${r.cutCycles} cuts, ${r.hitsApplied} contact(s) replayed`);
}

if (bad) process.exit(1);
console.log(
  `\nPASS  frames ${SPLIT_WINDOW.from}..${SPLIT_WINDOW.to} — box splitter difficulties 1 and 3`,
);
