#!/usr/bin/env node
// REGENERATE THE SIM HALF OF THE WHOLE-FIGHT DIFF.
//
//   node tools/regen-fullfight.mjs                 # all six fights
//   node tools/regen-fullfight.mjs verify37        # one
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────
//
// `verify-fullfight` refuses a sim trace older than `sim/`, so ANY edit under
// sim/ turns the whole-fight suite red until the six traces are rebuilt. That
// is correct — a stale trace is not evidence — but the rebuild has four
// non-obvious requirements, and getting any of them wrong produces a trace that
// is perfectly valid and completely uncomparable. The failure then looks
// exactly like the sim/ change under test having broken the fight.
//
// That has now happened three times in one sitting, once per requirement:
//
//   MISSING              WHAT IT LOOKED LIKE
//   --slots 32           "6 of 6 fights diverged", column mismatch, only in
//                        oracle: b16_x ... b31_ys. The tracer defaults to 16
//                        bullet slots; every recording carries 32.
//   the four feeds       divergence at f37 on TENSION (47 vs 54) and knight_hp
//                        (7280 vs 7268) — the sim rolled its own bolt schedule,
//                        so a different set of bolts scored. Reads as a damage
//                        bug.
//   --keep-alive         divergence at f175 on hp0 (oracle 160 flat, sim 150).
//                        The ORACLE pins party HP; an unpinned sim takes real
//                        damage. CLAUDE.md: "--keep-alive pins party HP in
//                        every whole-fight recording, so the amount of damage
//                        TAKEN is not compared by the whole-fight diff at all."
//   a token on argv      the tokens are ~53 KB, past the Windows command-line
//                        limit, and a shell mangles them long before that.
//
// The fourth is why this is a script and not a line in a doc: the token has to
// be spliced into `process.argv` in-process, because it cannot survive a shell.
//
// ── THE FEEDS ─────────────────────────────────────────────────────────────
//
// docs/HANDOFF.md: the whole-fight claim holds "under FOUR measured
// micro-tolerances plus pinned equip arrays and FOUR replay feeds (--shuffle
// --bolts --grazes --shards)". They are not tuning. Each replays an outcome the
// sim cannot reproduce from the seed alone — the ds_list_shuffle permutation
// (measured but unsolved), the randomly-generated bolt schedule, the graze
// pairings, and the shard arrangement.
//
// NEVER pass --slashes. The recordings carry no per-slash feed and the differ
// then compares a column set the oracle side cannot match.
//
// ── AFTER RUNNING THIS ────────────────────────────────────────────────────
//
// `npm run verify` and judge by EXIT CODE. If a fight still diverges, THAT is a
// result about the sim/ change — but only once this script has run, and only
// once its warnings are clean.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const TRACES = process.env.KNIGHT_TRACES || join(homedir(), 'knight-research', 'traces');
// The same default verify-fullfight uses, so the two cannot disagree about
// where the sim half lives.
const SIM_OUT = process.env.KNIGHT_SIM_OUT || '/tmp/knight-fullfight';

/** The fights, discovered from the tokens rather than hardcoded. */
function fights() {
  if (!existsSync(TRACES)) return [];
  return readdirSync(TRACES)
    .filter((f) => /^fullfight-.+\.token$/.test(f))
    .map((f) => f.replace(/^fullfight-/, '').replace(/\.token$/, ''))
    .sort();
}

const FEEDS = [
  ['--shuffle', '.shuffle.csv'],
  ['--bolts', '.bolts.csv'],
  ['--grazes', '.grazelog.csv'],
  ['--shards', '.shard.csv'],
];

function regen(name) {
  const tokenFile = join(TRACES, `fullfight-${name}.token`);
  if (!existsSync(tokenFile)) {
    console.log(`  ${name}: MISSING ${tokenFile}`);
    return false;
  }
  const base = join(TRACES, `fullfight-${name}`);
  const feeds = [];
  const missing = [];
  for (const [flag, suffix] of FEEDS) {
    if (existsSync(base + suffix)) feeds.push(flag, base + suffix);
    else missing.push(suffix);
  }

  // A CHILD PROCESS, not a dynamic import: the tracer runs at import time and
  // reads process.argv once, so a second fight in the same process would reuse
  // the first one's module state. One process per fight is the only safe shape.
  const runner = join(HERE, 'fullfight-trace.mjs');
  const args = [
    '-e',
    `const t=require('fs').readFileSync(process.argv[1],'utf8').trim();`
    + `process.argv=[process.argv[0],${JSON.stringify(runner)},t,...process.argv.slice(2)];`
    + `import(${JSON.stringify(pathToFileURL(runner).href)});`,
    tokenFile,
    '--out', join(SIM_OUT, `fullfight-${name}.csv`),
    '--slots', '32',
    '--keep-alive',
    ...feeds,
  ];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log(`  ${name}: ${ok ? 'ok' : `FAILED (exit ${r.status})`}`
    + (missing.length ? `   WARNING missing feed(s): ${missing.join(' ')}` : ''));
  if (!ok && r.stderr) console.log(r.stderr.split('\n').slice(-6).map((l) => `      ${l}`).join('\n'));
  return ok;
}

const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const all = fights();
if (!all.length) {
  console.log(`regen-fullfight: no fullfight-*.token in ${TRACES}`);
  console.log('  Nothing to regenerate. verify-fullfight will skip for the same reason.');
  process.exit(0);
}
const names = want.length ? want : all;
console.log(`regen-fullfight: ${names.length} fight(s) -> ${SIM_OUT}`);
let bad = 0;
for (const n of names) if (!regen(n)) bad++;
console.log(bad ? `  ${bad} failed` : '  all regenerated — now run `npm run verify`');
process.exit(bad ? 1 : 0);
