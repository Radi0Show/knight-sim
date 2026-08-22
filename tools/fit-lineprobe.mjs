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
// RESULT AS OF 2026-08-22, over 8,126 samples / 603 firings from two tokens:
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
// The walk is strictly better on this data and fixes verify37 f3199, but
// adopting it regressed verify21j to f5549: it also (correctly) ADDS the
// firing at f1507, and something downstream of that hit diverges. Settle
// that before switching models — the probe model is not the open question,
// what the game does with the hit is.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TRACES = process.env.KNIGHT_TRACES
  || join(process.env.HOME, 'knight-research', 'traces');
const NAMES = (process.env.KNIGHT_FIT_NAMES || 'verify21j,verify37').split(',');

const rows = [];
for (const n of NAMES) {
  let fired;
  try {
    fired = new Set();
    for (const l of readFileSync(join(TRACES, `fullfight-${n}.tunnel.csv`), 'utf8').trim().split('\n')) {
      const r = l.split(',');
      if (r[1] !== 'P') continue;
      // The sidecar stamps obj_time's Draw frame, one behind the step that fired.
      fired.add(`${+r[0] + 1}|${(+r[3]).toFixed(2)},${(+r[4]).toFixed(2)}`);
    }
  } catch { console.log(`SKIP ${n}: no tunnel sidecar`); continue; }
  let text;
  try { text = readFileSync(`/tmp/sweep-${n}.txt`, 'utf8'); }
  catch { console.log(`SKIP ${n}: no /tmp/sweep-${n}.txt (see the header)`); continue; }
  for (const l of text.split('\n')) {
    const m = l.match(/\[all\] f=(\d+) seq=\d+ spd=\S+ ang=(\S+) s=\(([-\d.]+),([-\d.]+)\) tip=\(([-\d.]+),([-\d.]+)\) box=\[([-\d]+),([-\d]+),([-\d]+),([-\d]+)\]/);
    if (!m) continue;
    const sx = +m[3]; const sy = +m[4];
    rows.push({ n, f: +m[1], ang: +m[2], sx, sy, tx: +m[5], ty: +m[6],
      r: [+m[7], +m[8], +m[9], +m[10]],
      hit: fired.has(`${+m[1]}|${sx.toFixed(2)},${sy.toFixed(2)}`) });
  }
}
if (!rows.length) { console.log('no samples — nothing to fit'); process.exit(0); }

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

console.log(`probe samples: ${rows.length}  fired: ${rows.filter((r) => r.hit).length}\n`);
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
