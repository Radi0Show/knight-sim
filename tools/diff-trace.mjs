#!/usr/bin/env node
// Trace differ.
//
//   node tools/diff-trace.mjs <oracle.csv> <engine.csv>
//
// Exact string equality, cell by cell. No float tolerance — the whole point is
// to catch the sub-pixel divergence that a tolerance would hide. Exits 0 on a
// match, 1 on a divergence, 2 on a usage error.

import { readFileSync } from 'node:fs';

function load(path) {
  // Oracle CSVs come from GML file_text_writeln, which emits CRLF.
  const lines = readFileSync(path, 'utf8').replace(/\r/g, '').replace(/\n$/, '').split('\n');
  return { header: lines[0].split(','), rows: lines.slice(1) };
}

export function diffTraces(oraclePath, enginePath) {
  const a = load(oraclePath);
  const b = load(enginePath);

  if (a.header.join(',') !== b.header.join(',')) {
    return {
      ok: false,
      message:
        `HEADER MISMATCH\n` +
        `  oracle: ${a.header.join(',')}\n` +
        `  engine: ${b.header.join(',')}`,
    };
  }

  const n = Math.min(a.rows.length, b.rows.length);

  for (let i = 0; i < n; i++) {
    if (a.rows[i] === b.rows[i]) continue;

    const ca = a.rows[i].split(',');
    const cb = b.rows[i].split(',');

    for (let c = 0; c < Math.max(ca.length, cb.length); c++) {
      if (ca[c] === cb[c]) continue;
      const field = a.header[c] ?? `col${c}`;
      return {
        ok: false,
        frame: i,
        message:
          `→ DIVERGENCE at frame ${i}: ${field}  ` +
          `oracle=${ca[c] ?? '<missing>'}  engine=${cb[c] ?? '<missing>'}`,
      };
    }
  }

  if (a.rows.length !== b.rows.length) {
    return {
      ok: false,
      frame: n,
      message:
        `→ traces agree through frame ${n - 1}, then LENGTH MISMATCH: ` +
        `oracle has ${a.rows.length} frames, engine has ${b.rows.length}`,
    };
  }

  return { ok: true, frames: n, message: `→ traces match through frame ${n - 1}   OK` };
}

function main() {
  const [, , oracle, engine] = process.argv;
  if (!oracle || !engine) {
    console.error('usage: node tools/diff-trace.mjs <oracle.csv> <engine.csv>');
    process.exit(2);
  }

  const result = diffTraces(oracle, engine);
  console.log(result.message);
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
