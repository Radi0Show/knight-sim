#!/usr/bin/env node
// Turn a replay token into the input table the ORACLE PATCH reads.
//
//   node tools/token-to-inputs.mjs <token> --out /tmp/oracle_inputs.txt
//
// One line per frame, a single integer bitmask. The patch reads the file once
// at startup and indexes it by `global.oracle_frame`, so the real game gets
// exactly the input the sim gets — which is the whole basis of a one-to-one
// diff (docs/VERIFICATION.md).
//
// A FILE, NOT A BAKED LITERAL. A full fight is ~9000 frames; embedding that as
// a GML string in the patch would be a 9000-character literal inside a C#
// verbatim string, and CLAUDE.md already records three compile failures from
// quoting inside those. The harness writes traces with `file_text_*` anyway,
// so reading one back is the same mechanism pointed the other way.

import { writeFileSync } from 'node:fs';
import { decodeReplay, packInput } from '../sim/replay.js';

const argv = process.argv.slice(2);
const token = argv.find((a) => a.startsWith('K1.'));
const i = argv.indexOf('--out');
const out = i >= 0 ? argv[i + 1] : '/tmp/oracle_inputs.txt';

if (!token) {
  console.error('usage: node tools/token-to-inputs.mjs <K1....token> [--out file]');
  process.exit(2);
}

const replay = decodeReplay(token);
const lines = [];
for (let f = 0; f < replay.frames; f++) lines.push(String(packInput(replay.inputAt(f))));

// The header carries the seed so the patch can seed the game's RNG to match,
// and the frame count so it knows when the run is over rather than guessing.
writeFileSync(out, `${replay.meta.seed}\n${replay.frames}\n${lines.join('\n')}\n`);
console.log(`seed ${replay.meta.seed}, ${replay.frames} frames -> ${out}`);
