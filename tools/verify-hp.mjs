#!/usr/bin/env node
// PARTY HP BOOKKEEPING — the half of the fight the whole-fight diff cannot see.
//
// verify-fullfight runs with `--keep-alive`, which refills `global.hp` every
// frame on BOTH sides so one scripted token can reach the end of the fight.
// The cost is stated wherever that result is reported: hp0/hp1/hp2 are pinned
// constants there, so they agree trivially and NOTHING about damage taken is
// checked — not scr_damage's targeting, not the ShadowMantle's two-hits-in-
// three redirect, not the swoon values, not the down/swoon asymmetry.
//
// This is the other half. `hprun-nka1` is recorded against
// oracle_fullfight_nokeepalive.csx — the same patch with the refill and revive
// loops removed — so party HP moves for real. The scripted token does not
// dodge, so the party WIPES around frame 598 and the fight stops; that is the
// point of the artifact, not a defect in it. The recording is deliberately
// named `hprun-` rather than `fullfight-` so verify-fullfight's discovery
// glob does not pick it up and refuse it as degenerate.
//
// WHAT THIS CAUGHT, the first time it ever ran (both invisible to 12,011
// frames of the canonical recording, because both only move HP):
//
//   * `charaction` was never set to 1 on a FIGHT confirm, and nothing in the
//     fight zeroes it per turn — so a character who chose DEFEND once kept
//     `charaction == 10` for the rest of the fight and took ceil(2*dmg/3) on
//     every hit forever after (f494: the game deals Kris 58, the sim 38).
//   * ac 13 and ac 14 were missing their `dc.damage` overrides (62 and 206);
//     both were sitting on the controller's monsterat*5 = 200.
//
// The window ends at the wipe. After the last member falls the real game goes
// to its Game Over and destroys the soul, which this scene does not model, so
// everything past WIPE_FRAME is out of scope here and says so rather than
// being silently compared.

import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const TRACES = process.env.KNIGHT_TRACES
  || join(process.env.HOME, 'knight-research', 'traces');
const NAME = 'hprun-nka1';
const OUT = '/tmp/knight-hp';

/** The frame the last party member falls. Past it the game runs its Game
 *  Over, which this scene does not model — see the header. */
const WIPE_FRAME = 598;

const oraclePath = join(TRACES, `${NAME}.csv`);
if (!existsSync(oraclePath)) {
  console.log(`SKIP verify-hp: no ${NAME}.csv in ${TRACES}`);
  console.log('  record one with tools/patches/oracle_fullfight_nokeepalive.csx');
  process.exit(0);
}

const tokenPath = process.env.KNIGHT_HP_TOKEN || '/tmp/tok20-21.txt';
if (!existsSync(tokenPath)) {
  console.log(`SKIP verify-hp: token not found at ${tokenPath}`);
  process.exit(0);
}
const token = readFileSync(tokenPath, 'utf8').trim();

mkdirSync(OUT, { recursive: true });

// The same four replay feeds the canonical premise uses — and NOT
// --keep-alive, which is the entire point of this suite.
const feed = (flag, suffix) => {
  const p = join(TRACES, `${NAME}.${suffix}`);
  return existsSync(p) ? [flag, p] : [];
};
execFileSync('node', [
  join(HERE, 'fullfight-trace.mjs'), token,
  '--slots', '32',
  ...feed('--shuffle', 'shuffle.csv'),
  ...feed('--bolts', 'bolts.csv'),
  ...feed('--grazes', 'grazelog.csv'),
  ...feed('--shards', 'shard.csv'),
  '--frames', '3000',
  '--out', join(OUT, `${NAME}.csv`),
], { cwd: REPO, stdio: 'pipe' });

function load(p) {
  const t = readFileSync(p, 'utf8').replace(/\r/g, '').trim().split('\n');
  const h = t[0].split(',');
  const rows = new Map(t.slice(1).map((l) => l.split(','))
    .filter((r) => Number(r[0]) >= 0).map((r) => [Number(r[0]), r]));
  return { h, rows };
}

const oracle = load(oraclePath);
const sim = load(join(OUT, `${NAME}.csv`));

// knight_hp rides along: damage DEALT is already covered by verify-knight,
// but a run whose party actually dies is a cheap second opinion on it.
const COLUMNS = ['hp0', 'hp1', 'hp2', 'knight_hp'];

const failures = [];
let compared = 0;
for (const f of [...oracle.rows.keys()].sort((a, b) => a - b)) {
  if (f > WIPE_FRAME) break;
  if (!sim.rows.has(f)) {
    failures.push(`frame ${f}: sim has no row`);
    break;
  }
  compared += 1;
  for (const c of COLUMNS) {
    const a = oracle.rows.get(f)[oracle.h.indexOf(c)];
    const b = sim.rows.get(f)[sim.h.indexOf(c)];
    if (a !== b) failures.push(`frame ${f}, ${c}: oracle ${a} vs sim ${b}`);
  }
  if (failures.length >= 8) break;
}

// POSITIVE ASSERTIONS, per the project rule that a suite of negative results
// can hide a dead code path: this must actually have watched HP move, and it
// must have watched the down/swoon asymmetry resolve — Kris to round(-maxhp/2)
// and the others to -999. A run where nobody was ever hit would otherwise
// "pass" while proving nothing at all.
const at = (f, c) => oracle.rows.get(f)?.[oracle.h.indexOf(c)];
const simAt = (f, c) => sim.rows.get(f)?.[sim.h.indexOf(c)];
const checks = [
  ['party HP actually moved', at(0, 'hp0') !== at(WIPE_FRAME, 'hp0')],
  ['Kris went DOWN at -80, not -999', Number(at(WIPE_FRAME, 'hp0')) === -80],
  ['an ally SWOONed at -999', Number(at(WIPE_FRAME, 'hp1')) === -999
    || Number(at(WIPE_FRAME, 'hp2')) === -999],
  ['the sim reproduced the wipe', simAt(WIPE_FRAME, 'hp0') === at(WIPE_FRAME, 'hp0')
    && simAt(WIPE_FRAME, 'hp1') === at(WIPE_FRAME, 'hp1')
    && simAt(WIPE_FRAME, 'hp2') === at(WIPE_FRAME, 'hp2')],
];

console.log(`verify-hp: ${NAME}, frames 0..${WIPE_FRAME} (${compared} compared)`);
for (const [label, ok] of checks) {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
}
const assertionsFailed = checks.filter(([, ok]) => !ok).length;

if (failures.length || assertionsFailed) {
  for (const f of failures) console.log(`  FAIL ${f}`);
  console.log(`\nFAIL  party HP diverges — ${failures.length} column mismatch(es), `
    + `${assertionsFailed} assertion(s) failed`);
  process.exit(1);
}

console.log(`\nPASS  party HP, targeting, the mantle reduction and the down/swoon `
  + `values are exact through the wipe`);
