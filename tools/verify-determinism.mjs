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
const SCENES = ['stub', 'soul-wall', 'soul-focus', 'soul-corner'];

const hash = (s) => createHash('sha256').update(s).digest('hex');

function main() {
  let failed = false;

  for (const scene of SCENES) {
    const baseline = runTrace({ seed: SEED, frames: FRAMES, scene });
    const baselineHash = hash(baseline);
    const rows = baseline.trimEnd().split('\n').length - 1;

    let sceneOk = true;
    for (let i = 2; i <= RUNS; i++) {
      if (hash(runTrace({ seed: SEED, frames: FRAMES, scene })) !== baselineHash) {
        sceneOk = false;
      }
    }
    if (!sceneOk) failed = true;

    console.log(
      `${sceneOk ? 'PASS' : 'FAIL'}  ${scene.padEnd(12)} ` +
        `${RUNS}/${RUNS} runs  ${rows} frames  ${baselineHash.slice(0, 16)}`,
    );
  }

  console.log('');

  // Negative control, stub scene only — it is the one that consumes the PRNG.
  // Without this, "deterministic" could just mean the PRNG is never reached,
  // which would pass while proving nothing.
  const a = hash(runTrace({ seed: SEED, frames: FRAMES, scene: 'stub' }));
  const b = hash(runTrace({ seed: SEED + 1, frames: FRAMES, scene: 'stub' }));
  if (a === b) {
    failed = true;
    console.log('FAIL  a different seed produced an identical trace —');
    console.log('      the PRNG is not influencing the output, so this test is vacuous');
  } else {
    console.log('PASS  seed sensitivity: a different seed changes the trace');
  }

  console.log('');
  if (failed) {
    console.log('FAILED');
    process.exit(1);
  }
  console.log(`All scenes byte-identical across ${RUNS} runs.`);
}

main();
