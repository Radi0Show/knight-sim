#!/usr/bin/env node
// SABOTAGE TEST for tools/verify-fullfight.mjs.
//
//   node tools/sabotage-fullfight.mjs
//
// A differ that has never been shown a divergence might report none by
// construction. This one is the headline suite for the whole project — "the
// fight is one-to-one" rests entirely on it — so it gets the same treatment
// every mechanism in `sim/` gets: introduce the fault deliberately, and assert
// the tool finds it, names the right SYSTEM, and names the right FRAME.
//
// It runs against a synthetic oracle (a copy of a sim trace with cells edited),
// so it needs no game and no private data, and it runs on CI.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRecorder, recordInput, encodeReplay } from '../sim/replay.js';

const TRACES = '/tmp/knight-sab-traces';
const SIM_OUT = '/tmp/knight-sab-sim';
const NAME = 'fullfight-sabotage';

/** Edit one cell of a CSV and write it back. */
function poke(rows, header, frame, col, value) {
  const c = header.indexOf(col);
  if (c < 0) throw new Error(`no column ${col}`);
  const r = rows.findIndex((row) => Number(row[0]) === frame);
  if (r < 0) throw new Error(`no frame ${frame}`);
  rows[r][c] = value;
}

function run() {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, ['tools/verify-fullfight.mjs'], {
        env: { ...process.env, KNIGHT_TRACES: TRACES, KNIGHT_SIM_OUT: SIM_OUT },
        encoding: 'utf8',
      }),
    };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

const CASES = [
  {
    name: 'clean copy passes',
    edit: () => {},
    expectCode: 0,
    expect: [/byte-exact/],
    reject: [/FAIL/],
  },
  {
    name: 'soul divergence is named SOUL, at its frame',
    edit: (rows, h) => poke(rows, h, 500, 'soul_x', '999.0000000000'),
    expectCode: 1,
    expect: [/SOUL\s+frame 500, column soul_x/],
  },
  {
    name: 'a party HP divergence is named DAMAGE',
    edit: (rows, h) => poke(rows, h, 300, 'hp1', '7'),
    expectCode: 1,
    expect: [/DAMAGE\s+frame 300, column hp1/],
  },
  {
    name: 'a knight HP divergence is named KNIGHT',
    edit: (rows, h) => poke(rows, h, 800, 'knight_hp', '1234'),
    expectCode: 1,
    expect: [/KNIGHT\s+frame 800, column knight_hp/],
  },
  {
    name: 'a bullet COUNT divergence is its own finding',
    edit: (rows, h) => poke(rows, h, 400, 'bullets', '99'),
    expectCode: 1,
    expect: [/BULLETS\s+frame 400, column bullets/],
  },
  {
    // The whole reason the count is checked first. A count mismatch shifts
    // every positional column, and reporting forty bullet faults for one
    // missing bullet is how a differ becomes something you stop reading.
    name: 'a count mismatch SUPPRESSES the positional columns after it',
    edit: (rows, h) => {
      poke(rows, h, 400, 'bullets', '99');
      poke(rows, h, 500, 'b0_x', '777.0000000000');
    },
    expectCode: 1,
    expect: [/BULLETS\s+frame 400/],
    reject: [/BULLET POSITIONS/],
  },
  {
    name: 'a positional divergence BEFORE any count fault is still reported',
    edit: (rows, h) => poke(rows, h, 500, 'b0_x', '777.0000000000'),
    expectCode: 1,
    expect: [/BULLET POSITIONS\s+frame 500, column b0_x/],
  },
  {
    // The ordering rule: a fault at frame 200 is printed before one at 600
    // regardless of which group it is in, because the earlier one is the
    // cause and the later one is usually its shadow.
    name: 'groups print EARLIEST first, not in group order',
    edit: (rows, h) => {
      poke(rows, h, 600, 'soul_x', '999.0000000000');
      poke(rows, h, 200, 'knight_hp', '4321');
    },
    expectCode: 1,
    expect: [/KNIGHT\s+frame 200[\s\S]*SOUL\s+frame 600/],
  },
  {
    name: 'a short oracle is a note, and the shared prefix still diffs',
    edit: (rows) => { rows.length = 600; },
    expectCode: 0,
    expect: [/row count: oracle 600, sim 1200/, /600 shared frames byte-exact/],
  },
  {
    // BOTH OF THESE ARE REGRESSION CASES for bugs the first real recording
    // found. Neither was a fight divergence; both were faults in this differ,
    // and both would have made a perfect trace unreportable.
    //
    // GML's `file_text_writeln` ends lines with \r\n. Un-stripped, the last
    // header column reads "b15_ys\r" and the report becomes the genuinely
    // baffling "only in sim: b15_ys / only in oracle: b15_ys".
    name: 'CRLF line endings in the oracle are stripped, not reported',
    raw: (text) => text.replace(/\n/g, '\r\n'),
    edit: () => {},
    expectCode: 0,
    expect: [/byte-exact/],
    reject: [/column mismatch/, /FAIL/],
  },
  {
    name: 'a missing column is fatal and says which side',
    edit: (rows, h) => {
      const c = h.indexOf('tension');
      h.splice(c, 1);
      for (const r of rows) r.splice(c, 1);
    },
    expectCode: 1,
    expect: [/column mismatch/, /only in sim:\s+tension/],
  },
];

function main() {
  rmSync(TRACES, { recursive: true, force: true });
  rmSync(SIM_OUT, { recursive: true, force: true });
  mkdirSync(TRACES, { recursive: true });
  mkdirSync(SIM_OUT, { recursive: true });

  // One real sim trace is the base for both sides. Any token works — this is
  // testing the DIFFER, not the fight. The inputs are a plain repeating walk
  // so the trace has movement in it: a soul that never moves would let a
  // broken `soul_x` comparison pass.
  const rec = createRecorder({ seed: 9 });
  for (let f = 0; f < 1200; f++) {
    const phase = Math.floor(f / 40) % 4;
    recordInput(rec, {
      left: phase === 0, down: phase === 1, right: phase === 2, up: phase === 3,
      confirm: f % 37 === 0,
    });
  }
  const token = encodeReplay(rec);
  const simPath = join(SIM_OUT, `${NAME}.csv`);
  execFileSync(process.execPath,
    ['tools/fullfight-trace.mjs', '--token', token, '--out', simPath],
    { encoding: 'utf8' });

  const base = readFileSync(simPath, 'utf8').trim().split('\n');
  const baseHeader = base[0].split(',');
  const baseRows = base.slice(1).map((l) => l.split(','));

  let failed = 0;
  for (const c of CASES) {
    const header = [...baseHeader];
    const rows = baseRows.map((r) => [...r]);
    c.edit(rows, header);
    let text = `${header.join(',')}\n${rows.map((r) => r.join(',')).join('\n')}\n`;
    if (c.raw) text = c.raw(text);
    writeFileSync(join(TRACES, `${NAME}.csv`), text);

    const { code, out } = run();
    const problems = [];
    if (code !== c.expectCode) problems.push(`exit ${code}, wanted ${c.expectCode}`);
    for (const re of c.expect ?? []) {
      if (!re.test(out)) problems.push(`missing ${re}`);
    }
    for (const re of c.reject ?? []) {
      if (re.test(out)) problems.push(`should not have reported ${re}`);
    }
    if (problems.length) {
      failed++;
      console.log(`FAIL  ${c.name}`);
      for (const p of problems) console.log(`        ${p}`);
      console.log(out.split('\n').map((l) => `      | ${l}`).join('\n'));
    } else {
      console.log(`ok    ${c.name}`);
    }
  }

  // The recorder writes `fullfight-<name>.shuffle.csv` beside each trace. A
  // greedy `fullfight-.*\.csv` glob picked that up as a fight in its own right
  // and reported it as a divergence — on the first real recording, two
  // failures where there was one.
  {
    const header = [...baseHeader];
    const rows = baseRows.map((r) => [...r]);
    writeFileSync(join(TRACES, `${NAME}.csv`),
      `${header.join(',')}\n${rows.map((r) => r.join(',')).join('\n')}\n`);
    writeFileSync(join(TRACES, `${NAME}.shuffle.csv`), '10,45|135|225|315\n');
    const { code, out } = run();
    if (code !== 0 || /shuffle/.test(out)) {
      failed++;
      console.log('FAIL  a .shuffle.csv companion is not treated as a fight');
      console.log(out.split('\n').map((l) => `      | ${l}`).join('\n'));
    } else {
      console.log('ok    a .shuffle.csv companion is not treated as a fight');
    }
    rmSync(join(TRACES, `${NAME}.shuffle.csv`), { force: true });
  }

  console.log('');
  if (failed) {
    console.log(`sabotage-fullfight: ${failed} of ${CASES.length + 1} cases failed`);
    process.exit(1);
  }
  console.log(`sabotage-fullfight: ${CASES.length + 1}/${CASES.length + 1} — the differ ` +
              'catches every fault it is meant to');
}

main();
