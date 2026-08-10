#!/usr/bin/env node
// Run every verification suite. This is the project's health check.
//
//   export PATH="$HOME/tools/node/bin:$PATH"
//   node tools/verify-all.mjs
//
// If this is green, the engine reproduces the real game everywhere it claims
// to. Run it before and after any change to sim/.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const SUITES = [
  ['verify-rng.mjs', "GameMaker's RNG (WELL512) reproduced"],
  ['verify-f32.mjs', 'float32 built-in fields narrow as the runner does'],
  ['verify-contact.mjs', 'precise-mask collision model'],
  ['verify-t3.mjs', 'soul movement'],
  ['verify-t4.mjs', 'obj_roaringknight_slash'],
  ['verify-fountain.mjs', 'fountain bullets (engine only — not in the fight)'],
  ['verify-splitter.mjs', 'box splitter organism'],
  ['verify-rotating.mjs', 'rotatingslash — ac 5, every phase'],
  ['verify-stars.mjs', 'Stars cone — ac 1, opens every phase'],
  ['verify-determinism.mjs', 'byte-identical across 10 runs'],
];

let failed = 0;
const width = Math.max(...SUITES.map(([f]) => f.length));

for (const [file, what] of SUITES) {
  const r = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  if (!ok) failed++;
  const last = out.trimEnd().split('\n').pop() ?? '';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file.padEnd(width)}  ${what}`);
  if (!ok) {
    for (const line of out.trimEnd().split('\n').slice(-6)) console.log(`        ${line}`);
  }
}

console.log('');
if (failed) {
  console.log(`${failed}/${SUITES.length} SUITES FAILING`);
  process.exit(1);
}
console.log(`All ${SUITES.length} suites green.`);
