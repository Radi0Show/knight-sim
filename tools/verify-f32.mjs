#!/usr/bin/env node
// Float32 acceptance: which built-in fields narrow, replayed from the oracle.
//
//   node tools/verify-f32.mjs [path-to-f32-probe.csv]
//
// The probe (knight-research/tools/patches/oracle_f32_probe.csx) assigned 1/3
// to every built-in on a real instance and read it back at 10 decimals.
// Narrowing fields print 0.3333333433; plain instance variables print
// 0.3333333333. This asserts the engine's entity accessors agree field by
// field — a positive check on the mechanism, so a regression that silently
// stops narrowing fails loudly instead of hiding behind integer test data.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState } from '../sim/state.js';
import { spawn } from '../sim/entity.js';

const path = process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 'f32-probe.csv');

const oracle = {};
for (const line of readFileSync(path, 'utf8').replace(/\r/g, '').trim().split('\n').slice(1)) {
  const [field, value] = line.split(',');
  oracle[field] = value;
}

const state = createState({ seed: 1 });
const e = spawn(state, { name: 'probe' });

const fmt = (v) => v.toFixed(10);
let pass = 0;
let fail = 0;

// Fields the probe measured on a real instance. hspeed/vspeed are derived
// from speed/direction by the runner, not stored, so they are not modelled.
const FIELDS = [
  'x', 'y', 'image_angle', 'image_xscale', 'image_yscale', 'speed', 'direction',
  'image_speed', 'image_alpha', 'image_index', 'friction', 'gravity',
  'gravity_direction', 'depth',
];

for (const f of FIELDS) {
  if (!(f in oracle)) continue;
  e[f] = 1 / 3;
  const got = fmt(e[f]);
  const ok = got === oracle[f];
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${f}: engine=${got} oracle=${oracle[f]}`);
}

// Controls: plain instance variables must NOT narrow.
e.myvar = 1 / 3;
const ctlOk = fmt(e.myvar) === oracle.VAR_myvar;
ctlOk ? pass++ : fail++;
if (!ctlOk) console.log(`  FAIL  plain var narrowed: ${fmt(e.myvar)} vs ${oracle.VAR_myvar}`);

console.log(
  `${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} built-in fields narrow exactly as the runner does`,
);
process.exit(fail === 0 ? 0 : 1);
