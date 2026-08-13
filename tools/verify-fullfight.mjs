#!/usr/bin/env node
// WHOLE-FIGHT DIFF — the one-to-one check (docs/VERIFICATION.md step 4).
//
//   node tools/verify-fullfight.mjs                       # every recorded fight
//   node tools/verify-fullfight.mjs --only t20-fight1     # one of them
//   node tools/verify-fullfight.mjs --context 3           # rows either side
//
// Every other verifier in this repo proves ONE attack over ~200 frames. This
// one proves the FIGHT: one token drives both the real game and the sim from
// the first frame of phase 1 to the end cutscene, and the two traces must be
// the same bytes. Attacks that are individually row-exact can still compose
// wrongly — a turn that ends one frame late, a `damagereduction` that ramps on
// the wrong turn, a bar that scores against the wrong character — and nothing
// in a per-attack suite can see any of that.
//
// ── WHY THE REPORT IS SHAPED LIKE THIS ────────────────────────────────────
//
// 96 columns x ~9000 rows is 850,000 cells. "First mismatch: row 4130, column
// b7_y" is technically the answer and practically useless: by row 4130 the
// fight has diverged so far that the first differing CELL says nothing about
// the first differing CAUSE. A soul that is one pixel off at frame 300 makes
// every bullet position wrong forever after, and the bullet column is the one
// that happens to sort first.
//
// So the report is by SYSTEM, in causal order. The columns are grouped, each
// group's own first divergence is found independently, and they are printed
// EARLIEST FIRST — because the group that broke first is the one to fix, and
// the rest are usually its downstream.
//
// ── BULLET IDENTITY ───────────────────────────────────────────────────────
//
// Bullet columns are positional: `b3_x` is the fourth bullet in SPAWN ORDER on
// each side (CLAUDE.md, "Trace format" — never by instance id). That is exact
// and needs no matching, with one caveat this differ makes loud rather than
// silent: if the two sides disagree about HOW MANY bullets are alive, every
// bullet column shifts and reports as a divergence. That is one fault, not
// forty, so a count mismatch is reported as its own finding and the positional
// columns are suppressed for that frame.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// KNIGHT_TRACES overrides where the oracle CSVs are read from. It exists so
// this differ can be SABOTAGE-TESTED against a synthetic oracle — a suite that
// has never been shown a real divergence is a suite that might report none by
// construction. tools/sabotage-fullfight.mjs uses it.
const TRACES = process.env.KNIGHT_TRACES
  || join(process.env.HOME, 'knight-research', 'traces');
const SIM_OUT = process.env.KNIGHT_SIM_OUT || '/tmp/knight-fullfight';

/**
 * The column groups, in the order a fault propagates.
 *
 * Deliberately CAUSAL, not alphabetical. Input drives the soul; the soul
 * drives what hits you; hits drive HP; HP drives whether the turn ends; the
 * turn drives which attack spawns next; the attack drives the bullets. A
 * divergence in a later group with an earlier group clean is a real, local
 * fault. The reverse is almost always the earlier group's shadow.
 */
const GROUPS = [
  ['turn', ['phase', 'turn', 'menu', 'balloon']],
  ['soul', ['soul_x', 'soul_y']],
  ['damage', ['hp0', 'hp1', 'hp2', 'inv_timer']],
  ['tension', ['tension', 'bar']],
  ['knight', ['knight_hp', 'knight_dr']],
  ['bullets', ['bullets']],
];

function readCsv(path) {
  // STRIP THE CARRIAGE RETURNS. GML's `file_text_writeln` ends every line with
  // \r\n, so without this the last column of the oracle's header is
  // "b15_ys\r" and the last cell of every row carries one too. Because the
  // header check compares two sets, that produced the genuinely baffling
  // report "only in sim: b15_ys / only in oracle: b15_ys" — the same name on
  // both sides, and the comparison is right: those are two different strings.
  //
  // Left unfixed it is worse than a confusing message: every row's final
  // bullet column would compare unequal forever, so the differ could never
  // report a clean fight even against a perfect trace.
  const text = readFileSync(path, 'utf8').replace(/\r/g, '').trim();
  const lines = text.split('\n');
  const header = lines[0].split(',');
  return { header, rows: lines.slice(1).map((l) => l.split(',')), path };
}

/** First row where `col` differs, or -1. */
function firstDiff(a, b, ai, bi, upto) {
  for (let r = 0; r < upto; r++) {
    if (a.rows[r][ai] !== b.rows[r][bi]) return r;
  }
  return -1;
}

function compare(oracle, sim, context) {
  const findings = [];

  // Headers are compared as SETS, not as sequences: the oracle patch writes
  // whatever the GML can reach and the sim writes WIDE_FIELDS, and a column
  // present on one side only is a harness bug worth naming on its own rather
  // than a silent misalignment of every column after it.
  const oCols = new Set(oracle.header);
  const sCols = new Set(sim.header);
  const missing = sim.header.filter((c) => !oCols.has(c));
  const extra = oracle.header.filter((c) => !sCols.has(c));
  if (missing.length || extra.length) {
    return {
      fatal: `column mismatch\n  only in sim:    ${missing.join(', ') || '(none)'}` +
             `\n  only in oracle: ${extra.join(', ') || '(none)'}`,
    };
  }

  const rows = Math.min(oracle.rows.length, sim.rows.length);
  if (rows === 0) return { fatal: 'no rows' };

  // A LENGTH mismatch is a finding, not a fatal: the shared prefix is still
  // worth diffing, and "identical for 6000 frames then the oracle stops" is a
  // very different bug from "diverges at frame 12".
  const lengths = oracle.rows.length !== sim.rows.length
    ? `row count: oracle ${oracle.rows.length}, sim ${sim.rows.length} ` +
      `(comparing the first ${rows})`
    : null;

  const idx = (t, c) => t.header.indexOf(c);
  const bulletCols = sim.header.filter((c) => /^b\d+_/.test(c));

  // The bullet COUNT first — it decides whether the positional columns mean
  // anything at all.
  const nOracle = idx(oracle, 'bullets');
  const nSim = idx(sim, 'bullets');
  const countDiff = nOracle >= 0 && nSim >= 0
    ? firstDiff(oracle, sim, nOracle, nSim, rows) : -1;

  for (const [name, cols] of GROUPS) {
    let worst = -1;
    let worstCol = null;
    for (const c of cols) {
      const oi = idx(oracle, c);
      const si = idx(sim, c);
      if (oi < 0 || si < 0) continue;
      const r = firstDiff(oracle, sim, oi, si, rows);
      if (r >= 0 && (worst < 0 || r < worst)) {
        worst = r;
        worstCol = c;
      }
    }
    if (worst >= 0) findings.push({ group: name, row: worst, col: worstCol });
  }

  // The positional bullet columns, but only from the point where the two sides
  // still agree on the count. Past a count divergence they are noise.
  const validUpto = countDiff >= 0 ? countDiff : rows;
  let bulletRow = -1;
  let bulletCol = null;
  for (const c of bulletCols) {
    const oi = idx(oracle, c);
    const si = idx(sim, c);
    if (oi < 0 || si < 0) continue;
    const r = firstDiff(oracle, sim, oi, si, validUpto);
    if (r >= 0 && (bulletRow < 0 || r < bulletRow)) {
      bulletRow = r;
      bulletCol = c;
    }
  }
  if (bulletRow >= 0) {
    findings.push({ group: 'bullet positions', row: bulletRow, col: bulletCol });
  }

  findings.sort((a, b) => a.row - b.row);
  return { findings, rows, lengths, oracle, sim, context };
}

/** Print the offending column either side of the divergence. */
function showContext(res, f) {
  const oi = res.oracle.header.indexOf(f.col);
  const si = res.sim.header.indexOf(f.col);
  const lo = Math.max(0, f.row - res.context);
  const hi = Math.min(res.rows - 1, f.row + res.context);
  const lines = [];
  for (let r = lo; r <= hi; r++) {
    const o = res.oracle.rows[r][oi];
    const s = res.sim.rows[r][si];
    const mark = o === s ? '  ' : '->';
    lines.push(`      ${mark} frame ${String(res.oracle.rows[r][0]).padStart(5)}` +
               `   oracle ${String(o).padStart(16)}   sim ${String(s).padStart(16)}`);
  }
  return lines.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
  const context = argv.includes('--context')
    ? Number(argv[argv.indexOf('--context') + 1]) : 2;

  if (!existsSync(TRACES)) {
    // The traces are PRIVATE (CLAUDE.md) and absent on CI. Skip LOUDLY — a
    // silent pass here would make the headline suite claim the fight is
    // verified on a machine that has never seen the oracle.
    console.log('SKIP verify-fullfight: ~/knight-research/traces not present');
    console.log('  (private oracle data; run this on the machine with the game)');
    process.exit(0);
  }

  // `[^.]*` and not `.*`: the recorder writes a SIDE-CHANNEL log next to each
  // trace, `fullfight-<name>.shuffle.csv`, and a greedy glob picked that up as
  // a fight of its own and reported it as a divergence. Anything with a second
  // dot in the stem is a companion file, not a recording.
  const fights = readdirSync(TRACES)
    .filter((f) => /^fullfight-[^.]*\.csv$/.test(f))
    .filter((f) => !only || f.includes(only));

  if (fights.length === 0) {
    console.log('SKIP verify-fullfight: no fullfight-*.csv in ~/knight-research/traces');
    console.log('  record one with tools/patches/oracle_fullfight.csx — see docs/VERIFICATION.md');
    process.exit(0);
  }

  let failed = 0;
  for (const file of fights) {
    const name = file.replace(/\.csv$/, '');
    const simPath = join(SIM_OUT, `${name}.csv`);
    console.log(`\n=== ${name} ===`);
    if (!existsSync(simPath)) {
      console.log(`  FAIL: no sim trace at ${simPath}`);
      console.log(`  run: node tools/fullfight-trace.mjs --token <token> --out ${simPath}`);
      failed++;
      continue;
    }

    const res = compare(readCsv(join(TRACES, file)), readCsv(simPath), context);
    if (res.fatal) {
      console.log(`  FAIL: ${res.fatal}`);
      failed++;
      continue;
    }
    if (res.lengths) console.log(`  note: ${res.lengths}`);

    if (res.findings.length === 0 && !res.lengths) {
      console.log(`  OK  ${res.rows} frames, ${res.sim.header.length} columns, byte-exact`);
      continue;
    }
    if (res.findings.length === 0) {
      console.log(`  OK  ${res.rows} shared frames byte-exact (see note above)`);
      continue;
    }

    failed++;
    console.log(`  FAIL  first divergence at frame ${res.oracle.rows[res.findings[0].row][0]}`);
    console.log(`  ${res.rows} frames compared; groups in causal order, earliest first:`);
    for (const f of res.findings) {
      console.log(`\n    ${f.group.toUpperCase()}  frame ${res.oracle.rows[f.row][0]}, column ${f.col}`);
      console.log(showContext(res, f));
    }
    console.log('\n    The FIRST group listed is the one to fix; the rest are');
    console.log('    usually its downstream. See docs/VERIFICATION.md.');
  }

  console.log('');
  if (failed) {
    console.log(`verify-fullfight: ${failed} of ${fights.length} fights diverged`);
    process.exit(1);
  }
  console.log(`verify-fullfight: ${fights.length} fight(s) one-to-one`);
}

main();
