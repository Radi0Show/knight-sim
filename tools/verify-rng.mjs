#!/usr/bin/env node
// RNG acceptance: gmlRng against the oracle's logged stream.
//
//   node tools/verify-rng.mjs [path-to-rng-probe.csv]
//
// The probe (knight-research/tools/patches/oracle_rng_probe.csx) logged, from
// known seeds inside the real game: 40 raw random(1) outputs, per-seed first
// outputs, and 20 calls each of irandom / random_range / choose /
// irandom_range. Every value must be reproduced.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  gmlCreate, gmlU32, gmlRandom, gmlRandomRange, gmlIrandom, gmlIrandomRange, gmlChoose,
} from '../sim/rng.js';

const path =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 'rng-probe.csv');

const sec = {};
for (const line of readFileSync(path, 'utf8').replace(/\r/g, '').trim().split('\n').slice(1)) {
  const [s, , v] = line.split(',');
  (sec[s] ??= []).push(parseFloat(v));
}

let pass = 0;
let fail = 0;
function check(name, ok) {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
}

{
  const r = gmlCreate(1);
  check('A: 40 raw draws from seed 1 (random(1) * 2^32)',
    sec.A.every((want) => gmlU32(r) === want));
}
{
  check('F: first output of seeds 0..9',
    sec.F.every((want, seed) => gmlU32(gmlCreate(seed)) === want));
}
{
  const r = gmlCreate(1);
  check('B: irandom(255) x20 — 63-bit compose, 2 draws',
    sec.B.every((want) => gmlIrandom(r, 255) === want));
}
{
  const r = gmlCreate(1);
  // Oracle printed 12 decimals; equality is up to print rounding.
  check('C: random_range(3,7) x20 — 1 draw, within print rounding',
    sec.C.every((want) => Math.abs(gmlRandomRange(r, 3, 7) - want) < 5e-13));
}
{
  const r = gmlCreate(1);
  check('D: choose(10,20,30,40) x20 — u32 % argc, 1 draw',
    sec.D.every((want) => gmlChoose(r, [10, 20, 30, 40]) === want));
}
{
  const r = gmlCreate(1);
  check('E: irandom_range(-3,3) x20 — 2 draws',
    sec.E.every((want) => gmlIrandomRange(r, -3, 3) === want));
}
{
  // gmlRandom sanity: A section values ARE random(1)*2^32.
  const r = gmlCreate(1);
  check('random(1) equals u32/2^32',
    sec.A.every((want) => gmlRandom(r, 1) === want / 4294967296));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass}/${pass + fail} sections reproduce the real game's RNG`);
process.exit(fail === 0 ? 0 : 1);
