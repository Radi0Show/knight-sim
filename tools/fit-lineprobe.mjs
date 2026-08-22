#!/usr/bin/env node
// THE SWORD TUNNEL'S SWEPT PROBE, fitted against the game's own firings.
//
//   node tools/fit-lineprobe.mjs
//
// `obj_sword_tunnel_sword`'s contact path is a `collision_line(...)` inside
// its Step's repeat loop that calls `event_user(5)` directly. It never
// touches obj_heart's Collision event, so the hitlog cannot see it, and the
// swords occupy no whole-fight trace slot either — which is how a one-frame
// error in it survived a token that diffs one-to-one (verify37 f3199).
//
// The oracle now logs the firings themselves (the tunnel sidecar's `P` rows,
// oracle_fullfight.csx). This joins them against the sim's own probe
// evaluations — every sample, tip and soul box the sim tested — to score a
// collision_line model on real labels instead of a couple of hand receipts.
//
// Regenerate the sim side with:
//   KNIGHT_SWEEP_ALL="0-20000" node tools/fullfight-trace.mjs <token> \
//     --keep-alive --slots 32 --shuffle ... --bolts ... --grazes ... --shards ... \
//     --out /tmp/x.csv 2>/tmp/sweep-<name>.txt
//
// TWO DECIMALS DESTROYED THE FIRST VERSION OF THIS. The sim's sweep log used
// toFixed(2), so a probe at x = 331.9999984 (floors to 331, INSIDE) was read
// as "332.00" (floors to 332, outside) — the rounding rewrote exactly the
// sub-pixel cases the fit exists to discriminate. It scored a candidate
// fp=0 that has a real false positive at verify21j f5549, and only a full
// whole-fight run caught it. The log is full precision now and the join keys
// on 4dp; never widen that.
//
// STILL IMPERFECT, stated rather than hidden: 599 of the 603 logged firings
// currently match a sim evaluation. The four that do not are either a real
// position divergence at those frames or a join flaw, and until that is
// settled every score below carries +/-4 of slop — enough to reorder
// candidates that sit one apart. Fix the join before trusting a close call.
//
// EARLIER RESULT, taken at 2dp and therefore UNRELIABLE — kept only so the
// mistake is legible:
//
//   clip floored (shipping)  8123/8126   fp=0  fn=3
//   walk floor               8124/8126   fp=0  fn=2
//   clip raw                 8115/8126   fp=0  fn=11
//   clip raw +1 (coverage)   8090/8126   fp=36 fn=0
//
// Every model's errors are FALSE NEGATIVES except the +1 coverage variants,
// and all three of the shipping model's are sub-pixel corner clips — the
// segment passes 0.3-1.4px outside a corner and the game fires anyway.
//
// SCORE BY WHAT THE ERRORS COST, NOT BY HOW MANY THERE ARE. The walk looks
// one better and behaves worse, because the two models miss different KINDS
// of firing:
//
//   f1507  clip misses, walk catches — the recording's inv is 1.2 there,
//          POSITIVE. event_user(5) gates on inv < 0 and a tunnel sword has
//          destroyonhit = 0, so that firing changes nothing. A free miss.
//   f1500  clip catches, walk misses — inv resets to 3.2, a REAL damage hit,
//          and the only in-box sample is the segment's far endpoint (a float
//          step count with an integer loop never reaches it; ceil fixes that
//          much).
//
// So check every candidate's mismatch frames against the recording's inv
// column before believing a score. A model that drops a damaging firing is
// worse than one that drops a free one, however the totals read.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TRACES = process.env.KNIGHT_TRACES
  || join(process.env.HOME, 'knight-research', 'traces');
const NAMES = (process.env.KNIGHT_FIT_NAMES || 'verify21j,verify37').split(',');
/** Both sides store these positions as f32 and agree to about five decimals;
 *  0.01px sits far inside the 8px gap between consecutive probe samples and
 *  far outside last-bit drift. An EXACT key cannot work here — 4dp split
 *  259.7454528809 from 259.7453918457 and lost 4 firings of 603. */
const MATCH_TOL = 0.01;
const unmatched = [];

const rows = [];
for (const n of NAMES) {
  let firings;
  try {
    firings = [];
    for (const l of readFileSync(join(TRACES, `fullfight-${n}.tunnel.csv`), 'utf8').trim().split('\n')) {
      const r = l.split(',');
      if (r[1] !== 'P') continue;
      // The sidecar stamps obj_time's Draw frame, one behind the step that fired.
      firings.push({ f: +r[0] + 1, x: +r[3], y: +r[4], used: false });
    }
  } catch { console.log(`SKIP ${n}: no tunnel sidecar`); continue; }
  let text;
  try { text = readFileSync(`/tmp/sweep-${n}.txt`, 'utf8'); }
  catch { console.log(`SKIP ${n}: no /tmp/sweep-${n}.txt (see the header)`); continue; }
  for (const l of text.split('\n')) {
    const m = l.match(/\[all\] f=(\d+) seq=\d+ spd=\S+ ang=(\S+) s=\(([-\de.+]+),([-\de.+]+)\) tip=\(([-\de.+]+),([-\de.+]+)\) box=\[([-\d]+),([-\d]+),([-\d]+),([-\d]+)\]/);
    if (!m) continue;
    const sx = +m[3]; const sy = +m[4];
    const fr = +m[1];
    let best = null;
    let bestD = Infinity;
    for (const g of firings) {
      if (g.used || g.f !== fr) continue;
      const d = Math.max(Math.abs(g.x - sx), Math.abs(g.y - sy));
      if (d < bestD) { bestD = d; best = g; }
    }
    const matched = Boolean(best) && bestD <= MATCH_TOL;
    if (matched) best.used = true;
    rows.push({ n, f: fr, ang: +m[2], sx, sy, tx: +m[5], ty: +m[6],
      r: [+m[7], +m[8], +m[9], +m[10]], hit: matched });
  }
  for (const g of firings) if (!g.used) unmatched.push(g);
}
if (!rows.length) { console.log('no samples — nothing to fit'); process.exit(0); }

// REFUSE TO SCORE AGAINST ABSENT LABELS. The `P` rows come from a probe
// logger that is deliberately NOT in the canonical oracle patch: writing it
// means re-importing the sword's decompiled Step, and a recording made
// against that round-trip is not a faithful control (it moved verify37's
// front from f3199 to f4399). So the shipped recordings carry M/S rows and
// no P rows, and without them every sample reads as "did not fire" — which
// would print a confident 7526/8126 with 600 false positives and mean
// nothing at all. Re-add the logger from git history, record into a
// THROWAWAY name, and point KNIGHT_FIT_NAMES at it.
const fired = rows.filter((r) => r.hit).length;
if (fired === 0) {
  console.log(`${rows.length} samples but ZERO recorded firings — the tunnel`);
  console.log('sidecar has no P rows, so there is nothing to score against.');
  console.log('Re-add the probe logger (see the header) and record into a');
  console.log('throwaway name before running this.');
  process.exit(0);
}

function clip(x1, y1, x2, y2, rx0, ry0, rx1, ry1, { floor = false, pad = 0 } = {}) {
  if (floor) { x1 = Math.floor(x1); y1 = Math.floor(y1); x2 = Math.floor(x2); y2 = Math.floor(y2); }
  rx1 += pad; ry1 += pad;
  const dx = x2 - x1; const dy = y2 - y1;
  let t0 = 0; let t1 = 1;
  for (const [p, q] of [[-dx, x1 - rx0], [dx, rx1 - x1], [-dy, y1 - ry0], [dy, ry1 - y1]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}
function walk(x1, y1, x2, y2, rx0, ry0, rx1, ry1) {
  const dx = x2 - x1; const dy = y2 - y1;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps === 0) return x1 >= rx0 && x1 <= rx1 && y1 >= ry0 && y1 <= ry1;
  for (let i = 0; i <= steps; i++) {
    const px = Math.floor(x1 + (dx * i) / steps);
    const py = Math.floor(y1 + (dy * i) / steps);
    if (px >= rx0 && px <= rx1 && py >= ry0 && py <= ry1) return true;
  }
  return false;
}

const MODELS = {
  'clip floored (shipping)': (r) => clip(r.sx, r.sy, r.tx, r.ty, ...r.r, { floor: true }),
  'clip raw': (r) => clip(r.sx, r.sy, r.tx, r.ty, ...r.r),
  'clip raw +1': (r) => clip(r.sx, r.sy, r.tx, r.ty, ...r.r, { pad: 1 }),
  'walk floor': (r) => walk(r.sx, r.sy, r.tx, r.ty, ...r.r),
};

console.log(`probe samples: ${rows.length}  fired: ${rows.filter((r) => r.hit).length}`);
if (unmatched.length) {
  console.log(`WARNING: ${unmatched.length} logged firing(s) matched no evaluation —`);
  console.log('the scores below are unreliable by that much. Investigate before trusting them.');
  for (const g of unmatched.slice(0, 6)) console.log(`  f${g.f} (${g.x}, ${g.y})`);
}
console.log('');
for (const [name, f] of Object.entries(MODELS)) {
  let ok = 0; let fp = 0; let fn = 0;
  const bad = [];
  for (const r of rows) {
    const got = f(r);
    if (got === r.hit) { ok++; continue; }
    if (got) fp++; else fn++;
    bad.push(`${r.n} f${r.f} ${got ? 'FALSE+' : 'FALSE-'} s=(${r.sx.toFixed(2)},${r.sy.toFixed(2)})`
      + ` tip=(${r.tx.toFixed(2)},${r.ty.toFixed(2)}) box=[${r.r}]`);
  }
  console.log(`${name.padEnd(24)} ${ok}/${rows.length}  fp=${fp} fn=${fn}`);
  for (const b of bad.slice(0, 6)) console.log(`    ${b}`);
}
