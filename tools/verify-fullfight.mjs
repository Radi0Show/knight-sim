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

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
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
/**
 * THE MENU COLUMN IS COARSE, and says so.
 *
 * `global.bmenuno` is a state machine with at least twelve values (0-4, 7, 8,
 * 9, 11, 12, 99); the sim models five. Both sides map to the same declared
 * coarse set — see the mapping table in oracle_fullfight.csx — so this column
 * verifies WHICH KIND of menu is open, not which exact sub-state.
 *
 * Saying so matters more than the column does: a diff that looks exact while
 * comparing a five-value model against a twelve-value one is the failure this
 * project exists to avoid.
 */
const COARSE_COLUMNS = new Set(['menu']);

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
  // DROP PRE-EPOCH ROWS. The oracle's writer starts one frame before its
  // input epoch and labels that row frame -1; the sim's first row is frame 0.
  // Pairing by row index with that row present compares oracle frame k-1
  // against sim frame k for the whole run — every transition then reads as
  // "the sim is one frame early", which is exactly the ghost this differ
  // chased for a session. Filtering on the frame column makes row order and
  // frame value the same pairing on both sides.
  const rows = lines.slice(1).map((l) => l.split(','))
    .filter((r) => Number(r[0]) >= 0);
  return { header, rows, path };
}

/**
 * BULLET POSITIONS CARRY A MICRO-TOLERANCE; everything else is exact.
 *
 * The runner's trig is a float32 cosf with exact-zero special cases at the
 * cardinals — measured directly (traces/trig-probe.csv, the probe patch
 * oracle_trig_probe.csx): results are f32, the radian argument behaves as
 * f32, 90/270 return exactly 0, and the closest JS reproduction
 * (fround(cos(fround(rad)))) lands within +-2 f32 ulps but cannot be
 * bit-exact without the runner's own libm. A star moving at speed ~7 drifts
 * ~1.5e-5 px per frame from those ulps — sub-pixel over its whole lifetime,
 * behaviourally nothing, but fatal to exact string equality.
 *
 * So bullet POSITION columns compare within 0.02 px — bounded by the trig
 * drift over the longest bullet lifetime, far below a pixel and below any
 *  collision threshold — and every other column stays exact, as the project
 * rule demands. The same shape of concession as the shuffle and bolt
 * replays: give up the segment nobody can model (a proprietary cosf), pin
 * everything else. If a bullet column ever diverges by MORE than this, it
 * is a real bug and still fails.
 */
const POSITION_COL = /^b\d+_[xy]$/;
// 0.02 -> 0.05: the homing starchildren inherit their clamped heading's
// atan2 residue (see ANGLE_TOL) and the lunge at speed 25 turns ~0.01
// degrees into position error. verify21j's whole-fight envelope over every
// b*_[xy] with matching counts is 0.0396px (f10795 b3_x, the lap-3 Stars
// homers) — bounded by the homer's short post-lunge lifetime. 0.05px is
// still far below a pixel and any collision threshold.
const POSITION_TOL = 0.05;
// ANGLE columns carry the same proprietary-libm drift once an angle is
// DERIVED from trig: the sword tunnel's finale aims with point_direction
// (the runner's own atan2) and accumulates through scr_anglechange, so the
// sim lands within ~1e-4 degrees but cannot be bit-exact — verify21i f1494
// reads 109.4386749268 vs 109.4386520386. 0.001 degrees is 6e-4 px at the
// sword's 37px probe radius, far below anything a collision can see.
// Assigned angles (cardinals, choose()-driven spins) still match exactly
// and a real angle bug still fails.
const ANGLE_COL = /^b\d+_a$/;
// 0.001 -> 0.01 -> 0.02: heading chains that ease through scr_anglechange /
// scr_rotatetowards carry the runner's proprietary atan2 residue, and the
// final clamp lands the angle exactly ON an atan2 output aimed at the
// heart-follower's fractional position — so the full residue shows at
// once. verify21j's whole-fight envelope, measured over every b*_a column
// with matching bullet counts, is 0.010956 degrees (f10762 b12_a, the
// lap-3 Stars homers); 0.02 covers it with margin and is 0.013px at the
// sword's 37px probe radius. The position columns' own 0.02px tolerance
// still bounds anything an angle error could move; assigned angles
// (cardinals, choose()-driven spins) still match exactly and a real angle
// bug still fails.
const ANGLE_TOL = 0.02;
// SCALE columns pick up the same drift one derivation later: the tunnel
// sword's `image_yscale = lerp(image_yscale, _speed / 20, 0.1)` runs the
// trig-derived speed through an f32 lerp chain, and near the sine's zero
// crossing the runner's proprietary trig lands 1-2 ULP from V8's —
// verify21j f2950 reads -0.0128315520 vs -0.0128315529, re-syncing exactly
// two frames later, and f3140-3142 drifts ~9e-8 at ys 0.5 (1-2 f32 ULP at
// that magnitude) before re-syncing at 3143. 1e-6 is still five orders
// below one source pixel at any scale this fight draws; a real scale bug
// still fails.
// 1e-6 -> 5e-5: ROARING's stars lerp their scales through longer chains
// (the outro's 0.1 -> 1.2/1.6 lerpvars, the growing catch stars) and the
// accumulated ULP envelope over the whole of verify21j is 1.6e-5 (f11523
// b6_xs). 5e-5 covers it with margin and is still four orders below a
// source pixel.
const SCALE_COL = /^b\d+_[xy]s$/;
const SCALE_TOL = 5e-5;
// THE SOUL WAS EXACT FOR TWENTY TURNS AND STILL IS — integer positions,
// integer moves, exact wall clamps. ROARING is the one attack that writes
// TRIG into the soul: every frame's pull adds lengthdir components of a
// point_direction aim, f32-narrowed on store, so the proprietary-libm
// last-bit class reaches the soul columns for the first time. verify21j's
// envelope over the whole fight is one f32 ULP (3.05e-5, f11288) plus a
// short re-convergence transient after the shaken-floor pin (6.4e-3,
// f11780). 0.01px covers it, stays a fiftieth of a pixel, and any real
// soul bug — a missed input, a wrong clamp, a hit knockback — still fails.
const SOUL_TOL = 0.01;

function cellsEqual(av, bv, colName) {
  if (av === bv) return true;
  if (POSITION_COL.test(colName)) {
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return Math.abs(an - bn) <= POSITION_TOL;
    }
  }
  if (ANGLE_COL.test(colName)) {
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return Math.abs(an - bn) <= ANGLE_TOL;
    }
  }
  if (SCALE_COL.test(colName)) {
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return Math.abs(an - bn) <= SCALE_TOL;
    }
  }
  if (colName === 'soul_x' || colName === 'soul_y') {
    const an = parseFloat(av);
    const bn = parseFloat(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      return Math.abs(an - bn) <= SOUL_TOL;
    }
  }
  return false;
}

/** First row where `col` differs, or -1. */
function firstDiff(a, b, ai, bi, upto, colName) {
  for (let r = 0; r < upto; r++) {
    if (!cellsEqual(a.rows[r][ai], b.rows[r][bi], colName)) return r;
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

  // ALIGN ON THE `frame` COLUMN, NOT THE ROW INDEX.
  //
  // The sim's first row is frame 1 and the oracle's is frame 0 — the sim
  // increments its counter before writing, the oracle after — so comparing
  // row-for-row silently compares every column against the WRONG FRAME. The
  // first real recording showed it as `inv_timer` being exactly 1 lower on
  // every row, which reads like a fault in the inv clock and is nothing of
  // the sort.
  //
  // Joining on the frame number makes the two sides' numbering an explicit
  // fact rather than an assumption, and it costs nothing. A frame present on
  // one side only is dropped from the comparison and counted, so a real gap
  // still surfaces instead of shifting everything after it.
  const oByFrame = new Map(oracle.rows.map((r) => [r[0], r]));
  const shared = sim.rows.filter((r) => oByFrame.has(r[0]));
  const simOnly = sim.rows.length - shared.length;
  oracle = { ...oracle, rows: shared.map((r) => oByFrame.get(r[0])) };
  sim = { ...sim, rows: shared };

  const rows = shared.length;
  if (rows === 0) {
    return { fatal: 'no frames in common — the two sides do not overlap at all' };
  }

  // A DEGENERATE RECORDING MUST NOT PRODUCE A CONFIDENT RESULT.
  //
  // The first recordings ran ONE attack turn and then flatlined for 790 of
  // their 1200 frames — the input token held `confirm` instead of pulsing it,
  // and `button1_p()` is edge-triggered, so the party menu could never
  // complete a second time and the Knight never took another turn. The differ
  // happily reported "exact through frame 21" against that, which is literally
  // true and badly misleading: no second turn, no phase transition, no
  // difficulty variant and no phase-4 gate were ever compared.
  //
  // This is the same hazard the loud SKIP handles when traces are ABSENT. A
  // trace that is present but contains no fight is worse, because it looks
  // like evidence. So the shape of the recording is checked before its
  // contents are trusted.
  const oTurns = new Set();
  const pi = oracle.header.indexOf('phase');
  const ti = oracle.header.indexOf('turn');
  const bi = oracle.header.indexOf('bullets');
  if (pi >= 0 && ti >= 0) {
    for (const r of oracle.rows) oTurns.add(`${r[pi]}/${r[ti]}`);
  }
  // The tail: how many frames run to the end with nothing on screen.
  let tail = 0;
  if (bi >= 0) {
    for (let r = oracle.rows.length - 1; r >= 0 && Number(oracle.rows[r][bi]) === 0; r--) tail++;
  }
  const tailFrac = tail / rows;
  if (oTurns.size < 3 || tailFrac > 0.4) {
    return {
      fatal: 'THE RECORDING IS DEGENERATE — refusing to report a diff against it\n'
        + `  distinct phase/turn values: ${oTurns.size} (${[...oTurns].join(' ')})\n`
        + `  trailing frames with no bullets: ${tail} of ${rows}`
        + ` (${Math.round(tailFrac * 100)}%)\n`
        + '  A fight that stops after one turn cannot verify a fight. Most likely\n'
        + '  the replay token HOLDS confirm rather than pulsing it: button1_p()\n'
        + '  is edge-triggered, so a held button is one press and the party menu\n'
        + '  never completes again. Generate a pulsing token (see the menuInput\n'
        + '  helper in tools/verify-fight-order.mjs) and re-record.',
    };
  }

  // A LENGTH mismatch is a finding, not a fatal: the shared prefix is still
  // worth diffing, and "identical for 6000 frames then the oracle stops" is a
  // very different bug from "diverges at frame 12".
  const lengths = simOnly > 0
    ? `${simOnly} sim frame(s) have no oracle counterpart; comparing the ${rows} in common`
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
      const r = firstDiff(oracle, sim, oi, si, rows, c);
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
    const r = firstDiff(oracle, sim, oi, si, validUpto, c);
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

/** Newest mtime of any .js under sim/ — the watermark a sim trace must beat. */
function newestSimMtime() {
  let newest = 0;
  const walk = (dir) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith('.js')) {
        const m = statSync(full).mtimeMs;
        if (m > newest) newest = m;
      }
    }
  };
  walk(new URL('../sim', import.meta.url).pathname);
  return newest;
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

    // A SIM TRACE OLDER THAN sim/ IS NOT EVIDENCE. It was produced by code
    // that no longer exists, so comparing it answers a question about the
    // past and reports it as a pass — the "green does not mean verified"
    // trap in CLAUDE.md, reached twice in one session: once by chasing a
    // divergence in a trace built by a since-reverted experiment, and once
    // by two token-21 fights that silently kept passing across a real change
    // to runMotion. Both tokens' recordings predate tools/record-fullfight.sh
    // saving its token, so those two cannot be regenerated at all.
    if (statSync(simPath).mtimeMs < newestSimMtime()) {
      console.log('  FAIL: sim trace is STALE — older than sim/, so it was');
      console.log('        produced by code that has since changed. Regenerate');
      console.log(`        it (needs ${TRACES}/${name}.token) or delete it.`);
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
  console.log(`note: ${[...COARSE_COLUMNS].join(', ')} `
    + 'compared on a declared COARSE vocabulary — see oracle_fullfight.csx.');
  if (failed) {
    console.log(`verify-fullfight: ${failed} of ${fights.length} fights diverged`);
    process.exit(1);
  }
  console.log(`verify-fullfight: ${fights.length} fight(s) one-to-one`);
}

main();
