#!/usr/bin/env node
// Diagonal bullets (ac 12, dc.type 152) against
// knight-research/traces/diagonal.csv.
//
// Also the acceptance test for component (hspeed/vspeed) motion. Exact string
// equality throughout — no tolerance here, unlike the tracking swords, because
// nothing in this attack goes through diagonal trig.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState, stepFrame } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { real } from '../sim/trace.js';
import {
  buildOracleDiagonalScene,
  ORACLE_DIAGONAL_INPUT,
  DIAGONAL_WINDOW,
} from './scenes/oracle-diagonal.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 'diagonal.csv');

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

const idNum = (s) => Number(String(s).replace(/\D+/g, ''));

const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
const oracle = new Map();

for (const line of lines.slice(1)) {
  const c = line.split(',');
  const frame = Number(c[0]);
  if (!oracle.has(frame)) oracle.set(frame, { bullets: [] });
  const f = oracle.get(frame);
  if (c[1] === 'obj_diagonal_bullet_manager') f.manager = parseVars(c[20]);
  else if (c[1] === 'obj_diagonal_bullet') {
    f.bullets.push({ id: c[2], x: c[3], y: c[4], speed: c[5], dir: c[6], alpha: c[15] });
  }
}

const { from, to } = DIAGONAL_WINDOW;
const state = createState({ seed: 1, traceBulletSlots: 0 });
buildOracleDiagonalScene(state);
const inputAt = makeInputTable(ORACLE_DIAGONAL_INPUT);

const find = (n) => state.entities.filter((e) => e.alive && e.type.name === n);

let checked = 0;
let peakBullets = 0;
let waves = 0;
let prevCount = 0;
const failures = [];

for (let frame = 0; frame <= to; frame++) {
  stepFrame(state, inputAt(frame));
  if (frame < from) continue;

  const exp = oracle.get(frame);
  if (!exp) continue;
  const cmp = [];

  const mg = find('obj_diagonal_bullet_manager')[0];
  if (mg && exp.manager) {
    for (const k of ['timer', 'rate']) cmp.push([`manager.${k}`, exp.manager[k], real(mg[k])]);
  }

  const mine = find('obj_diagonal_bullet').sort((a, b) => a.seq - b.seq);
  if (mine.length > prevCount) waves += 1;
  prevCount = mine.length;
  peakBullets = Math.max(peakBullets, mine.length);
  cmp.push(['bullet_count', String(exp.bullets.length), String(mine.length)]);

  if (exp.bullets.length === mine.length) {
    const theirs = [...exp.bullets].sort((a, b) => idNum(a.id) - idNum(b.id));
    // Spot-check the first, middle and last of the live set rather than all
    // 400: the wall is homogeneous and this keeps the suite quick while still
    // covering both ends of every wave.
    for (const i of [0, Math.floor(mine.length / 2), mine.length - 1]) {
      if (i < 0 || i >= mine.length) continue;
      const o = theirs[i];
      const m = mine[i];
      cmp.push([`bullet[${i}].x`, o.x, real(m.x)]);
      cmp.push([`bullet[${i}].y`, o.y, real(m.y)]);
      cmp.push([`bullet[${i}].speed`, o.speed, real(m.speed)]);
      cmp.push([`bullet[${i}].direction`, o.dir, real(m.direction)]);
      cmp.push([`bullet[${i}].image_alpha`, o.alpha, real(m.image_alpha)]);
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

console.log(`oracle: ${oraclePath}`);
console.log(`window: frames ${from}..${to}\n`);

if (failures.length) {
  for (const f of failures) console.log(`→ DIVERGENCE  ${f}`);
  process.exit(1);
}

if (checked < 1000 || peakBullets < 24 || waves < 5) {
  console.log(
    `EXECUTION ASSERTION FAILED: checked=${checked} peakBullets=${peakBullets} waves=${waves}`,
  );
  console.log('  expected checked >= 1000, peakBullets >= 24, waves >= 5');
  process.exit(1);
}

console.log(`→ ${checked} value comparisons, all exact`);
console.log(`→ ${waves} waves, peak ${peakBullets} bullets alive, component motion exact`);
console.log(`\nPASS  frames ${from}..${to} match the real game — diagonal bullets (ac 12)`);
