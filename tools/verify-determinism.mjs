#!/usr/bin/env node
// T2 acceptance test.
//
//   node tools/verify-determinism.mjs
//
// Runs the stub scene 10 times from a cold state and requires every run to
// produce a byte-identical CSV. Also checks that a different seed produces a
// *different* trace — otherwise "deterministic" could just mean the PRNG is
// never consulted, which would pass while proving nothing.

import { createHash } from 'node:crypto';
import { runTrace } from './run-trace.mjs';

const RUNS = 10;
const SEED = 12345;
const FRAMES = 600;

const hash = (s) => createHash('sha256').update(s).digest('hex');

function main() {
  let failed = false;

  const baseline = runTrace({ seed: SEED, frames: FRAMES });
  const baselineHash = hash(baseline);
  const rows = baseline.trimEnd().split('\n').length - 1;

  console.log(`stub scene: seed=${SEED} frames=${FRAMES} rows=${rows}`);
  console.log(`baseline sha256 ${baselineHash}`);
  console.log('');

  for (let i = 2; i <= RUNS; i++) {
    const h = hash(runTrace({ seed: SEED, frames: FRAMES }));
    const ok = h === baselineHash;
    if (!ok) failed = true;
    console.log(`  run ${String(i).padStart(2)}/${RUNS}  ${ok ? 'identical' : 'DIFFERS  ' + h}`);
  }

  console.log('');

  // Negative control: the PRNG must actually be reaching the output.
  const other = hash(runTrace({ seed: SEED + 1, frames: FRAMES }));
  if (other === baselineHash) {
    failed = true;
    console.log('  FAIL  a different seed produced an identical trace —');
    console.log('        the PRNG is not influencing the output, so this test is vacuous');
  } else {
    console.log('  seed sensitivity: a different seed changes the trace   OK');
  }

  console.log('');
  if (failed) {
    console.log(`FAIL  ${RUNS} runs were not byte-identical`);
    process.exit(1);
  }
  console.log(`PASS  ${RUNS}/${RUNS} runs byte-identical`);
}

main();
