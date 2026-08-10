#!/usr/bin/env node
// Headless trace runner. Writes one CSV row per frame.
//
//   node tools/run-trace.mjs --seed 12345 --frames 600 --out traces/stub.csv
//
// No browser, no canvas, no real clock. This is the verification path.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { createState, stepFrame, traceHeader } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { buildStubScene } from './scenes/stub.js';

function parseArgs(argv) {
  const args = { seed: 12345, frames: 600, out: null, scene: 'stub' };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    const val = argv[i + 1];
    if (!(key in args)) {
      console.error(`unknown option: ${argv[i]}`);
      process.exit(2);
    }
    args[key] = key === 'seed' || key === 'frames' ? Number(val) : val;
  }
  return args;
}

// Fixed input program. A recorder comes later; a hardcoded table is what
// CLAUDE.md asks for at this stage, and it keeps the trace reproducible.
const INPUT_PROGRAM = [
  { from: 0, right: true },
  { from: 40, right: true, focus: true },
  { from: 60, left: true },
  { from: 120, right: true, up: true },
  { from: 200 },
  { from: 240, right: true },
];

export function runTrace({ seed, frames, scene = 'stub' }) {
  if (scene !== 'stub') throw new Error(`unknown scene: ${scene}`);

  const state = createState({ seed, traceBulletSlots: 4 });
  buildStubScene(state);

  const inputAt = makeInputTable(INPUT_PROGRAM);
  const header = traceHeader(state);

  for (let i = 0; i < frames; i++) {
    stepFrame(state, inputAt(state.frame));
  }

  return `${header}\n${state.trace.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const csv = runTrace(args);

  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, csv);
    const rows = csv.trimEnd().split('\n').length - 1;
    console.error(`wrote ${args.out}  seed=${args.seed}  ${rows} frames`);
  } else {
    process.stdout.write(csv);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
