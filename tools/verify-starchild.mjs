#!/usr/bin/env node
// obj_knight_pointing_starchild's homing path, against
// knight-research/traces/stars3.csv.
//
// The state machine (con, timer, ease, tracking, delay) is compared EXACTLY.
// Positions and direction go through `lengthdir_*` and `point_direction` at
// arbitrary angles every frame, so they carry the same sub-pixel trig residue
// documented in verify-tracking and verify-vortex: a fixed bound in PIXELS,
// with the worst observed value printed.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState, stepFrame } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { real } from '../sim/trace.js';
import {
  buildOracleStarchildScene,
  ORACLE_CHILD_INPUT,
  CHILD_WINDOW,
} from './scenes/oracle-starchild.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 'stars3.csv');

const POSITION_TOLERANCE = 1e-3;
let slack = 0;
let maxDelta = 0;

function agree(o, s) {
  if (o === s) return true;
  const d = Math.abs(Number(o) - Number(s));
  if (d < POSITION_TOLERANCE) {
    slack += 1;
    if (d > maxDelta) maxDelta = d;
    return true;
  }
  return false;
}

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

// The child under test is the first one the recording gives difficulty 2.
const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
const byId = new Map();
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (c[1] !== 'obj_knight_pointing_starchild') continue;
  if (!byId.has(c[2])) byId.set(c[2], []);
  byId.get(c[2]).push(c);
}

let track = null;
for (const rows of byId.values()) {
  if (parseVars(rows[0][20]).difficulty?.startsWith('2')) {
    track = new Map(rows.map((c) => [Number(c[0]), c]));
    break;
  }
}
if (!track) {
  console.log('no difficulty-2 starchild in the recording');
  process.exit(1);
}

const { from, to } = CHILD_WINDOW;
const state = createState({ seed: 1, traceBulletSlots: 0 });
buildOracleStarchildScene(state);
const inputAt = makeInputTable(ORACLE_CHILD_INPUT);

let checked = 0;
let consSeen = new Set();
const failures = [];

for (let frame = 0; frame <= to; frame++) {
  stepFrame(state, inputAt(frame));
  if (frame < from) continue;

  const row = track.get(frame);
  if (!row) continue;
  const v = parseVars(row[20]);
  const d = state.entities.find(
    (e) => e.alive && e.type.name === 'obj_knight_pointing_starchild',
  );
  if (!d) {
    failures.push(`frame ${frame}: oracle has the child, engine has none`);
    break;
  }
  consSeen.add(Number(d.con));

  const exact = [
    ['con', v.con, real(d.con)],
    ['timer', v.timer, real(d.timer)],
    ['delay', v.delay, real(d.delay)],
    ['ease', v.ease, real(d.ease)],
    ['tracking', v.tracking, real(Number(d.tracking))],
  ];
  const loose = [
    ['speed', row[5], real(d.speed)],
    ['direction', row[6], real(d.direction)],
    ['x', row[3], real(d.x)],
    ['y', row[4], real(d.y)],
  ];

  let bad = null;
  for (const [n, o, s] of exact) {
    if (o === undefined) continue;
    checked += 1;
    if (String(o) !== String(s)) {
      bad = `${n}  oracle=${o}  engine=${s}`;
      break;
    }
  }
  if (!bad) {
    for (const [n, o, s] of loose) {
      if (o === undefined) continue;
      checked += 1;
      if (!agree(String(o), String(s))) {
        bad = `${n}  oracle=${o}  engine=${s}`;
        break;
      }
    }
  }
  if (bad) {
    failures.push(`frame ${frame}: ${bad}`);
    break;
  }
}

console.log(`oracle: ${oraclePath}`);
console.log(`window: frames ${from}..${to}\n`);

if (failures.length) {
  for (const f of failures) console.log(`→ DIVERGENCE  ${f}`);
  process.exit(1);
}

// The whole point is the homing, so require the child to have gone all the way
// through con 1, 2 and 3 — not merely to have drifted.
for (const need of [0, 1, 2, 3]) {
  if (!consSeen.has(need)) {
    console.log(`EXECUTION ASSERTION FAILED: never reached con ${need}`);
    console.log(`  cons seen: ${[...consSeen].sort().join(', ')}`);
    process.exit(1);
  }
}

console.log(`→ ${checked} comparisons, cons ${[...consSeen].sort().join(' -> ')}`);
console.log(
  slack === 0
    ? '→ every position exact'
    : `→ ${slack} samples inexact, worst ${maxDelta.toExponential(2)} px (bound ${POSITION_TOLERANCE})`,
);
console.log(`\nPASS  frames ${from}..${to} — starchild homing (Stars difficulty 2)`);
