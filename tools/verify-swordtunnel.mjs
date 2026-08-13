#!/usr/bin/env node
// Diagonal bullets (ac 12, dc.type 152) against
// knight-research/traces/swordtunnel.csv.
//
// Also the acceptance test for component (hspeed/vspeed) motion. Exact string
// equality throughout — no tolerance here, unlike the tracking swords, because
// nothing in this attack goes through diagonal trig.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState, stepFrame } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { real } from '../sim/trace.js';
import {
  buildOracleTunnelScene,
  ORACLE_TUNNEL_INPUT,
  TUNNEL_WINDOW,
} from './scenes/oracle-swordtunnel.js';

const oraclePath =
  process.argv[2] ?? join(homedir(), 'knight-research', 'traces', 'swordtunnel.csv');

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

const idNum = (s) => Number(String(s).replace(/\D+/g, ''));

const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
const oracle = new Map();

for (const line of lines.slice(1)) {
  const c = line.split(',');
  const frame = Number(c[0]);
  if (!oracle.has(frame)) oracle.set(frame, { bullets: [] });
  const f = oracle.get(frame);
  if (c[1] === 'obj_sword_tunnel_manager') f.manager = parseVars(c[20]);
  else if (c[1] === 'obj_sword_tunnel_sword') {
    f.bullets.push({ id: c[2], x: c[3], y: c[4], angle: c[10], yscale: c[12], v: parseVars(c[20]) });
  }
}

const { from, to } = TUNNEL_WINDOW;
const state = createState({ seed: 1, traceBulletSlots: 0 });
buildOracleTunnelScene(state);
const inputAt = makeInputTable(ORACLE_TUNNEL_INPUT);

const find = (n) => state.entities.filter((e) => e.alive && e.type.name === n);

let checked = 0;
let peakBullets = 0;
let waves = 0;
let prevCount = 0;
const failures = [];

for (let frame = 0; frame <= to; frame++) {
  stepFrame(state, inputAt(frame));
  if (frame < from) continue;

  const exp = oracle.get(frame);
  if (!exp) continue;
  const cmp = [];

  const mg = find('obj_sword_tunnel_manager')[0];
  if (mg && exp.manager) {
    for (const k of ['timer', 'finishtimer', 'swordy', 'swordcount', 'setcount', 'waitsetcount']) {
      cmp.push([`manager.${k}`, exp.manager[k], real(mg[k])]);
    }
    cmp.push(['manager.movedirection', exp.manager.movedirection, String(mg.movedirection)]);
  }

  const mine = find('obj_sword_tunnel_sword').sort((a, b) => a.seq - b.seq);
  if (mine.length > prevCount) waves += 1;
  prevCount = mine.length;
  peakBullets = Math.max(peakBullets, mine.length);
  cmp.push(['bullet_count', String(exp.bullets.length), String(mine.length)]);

  if (exp.bullets.length === mine.length) {
    const theirs = [...exp.bullets].sort((a, b) => idNum(a.id) - idNum(b.id));
    // Spot-check the first, middle and last of the live set rather than all
    // 400: the wall is homogeneous and this keeps the suite quick while still
    // covering both ends of every wave.
    for (const i of [0, Math.floor(mine.length / 2), mine.length - 1]) {
      if (i < 0 || i >= mine.length) continue;
      const o = theirs[i];
      const m = mine[i];
      cmp.push([`sword[${i}].x`, o.x, real(m.x)]);
      cmp.push([`sword[${i}].y`, o.y, real(m.y)]);
      cmp.push([`sword[${i}]._speed`, o.v._speed, real(m._speed)]);
      cmp.push([`sword[${i}].image_angle`, o.angle, real(m.image_angle)]);
      cmp.push([`sword[${i}].image_yscale`, o.yscale, real(m.image_yscale)]);
    }
  }

  for (const [name, o, s] of cmp) {
    if (o === undefined) continue;
    checked += 1;
    if (String(o) !== String(s)) {
      failures.push(`frame ${frame}: ${name}  oracle=${o}  engine=${s}`);
      break;
    }
  }
  if (failures.length) break;
}

// ---- CONTACT, now computed on both paths ----------------------------------
//
// The recorder counts every obj_collidebullet Other_15 invocation
// (`global.oracle_hits`), and a tunnel sword reaches that event TWO ways:
//
//   1. `collision_line(x, y, tip, obj_heart, 0, false)` at each 8px sub-step,
//      which calls event_user(5) explicitly. prec = 0, so it is the soul's
//      BOUNDING BOX, not its pixel mask.
//   2. the sword's own mask overlapping the soul, through obj_heart's ordinary
//      Collision_obj_collidebullet — which just does `with (other) event_user(5)`.
//
// Both are computed here and compared PER FRAME, not just as a total, so a
// path that fires the right number of times on the wrong frames cannot pass.
// The split is 30 line hits and 15 mask hits over the window; comparing only
// totals would have hidden that the mask path was contributing zero.

const hitState = createState({ seed: 1, traceBulletSlots: 0 });
buildOracleTunnelScene(hitState);
const hitInput = makeInputTable(ORACLE_TUNNEL_INPUT);

const hitAt = new Map();
for (const line of lines.slice(1)) {
  const c = line.split(',');
  if (c[1] !== '__global') continue;
  hitAt.set(Number(c[0]), Number(parseVars(c[20]).hits));
}

let prevOracle = 0;
let prevEngine = 0;
let hitFrames = 0;
let totalHits = 0;
let lineHits = 0;
let maskHits = 0;
for (let f = 0; f <= to; f++) {
  stepFrame(hitState, hitInput(f));
  const o = hitAt.get(f) ?? prevOracle;
  const engine = (hitState.tunnelHits ?? 0) + (hitState.counters.collisionHits ?? 0);
  const dO = o - prevOracle;
  const dE = engine - prevEngine;
  if (dO !== dE) {
    failures.push(`frame ${f}: hits  oracle +${dO}  engine +${dE}`);
    break;
  }
  if (dO) {
    hitFrames += 1;
    totalHits += dO;
  }
  prevOracle = o;
  prevEngine = engine;
}
lineHits = hitState.tunnelHits ?? 0;
maskHits = hitState.counters.collisionHits ?? 0;

console.log(`oracle: ${oraclePath}`);
console.log(`window: frames ${from}..${to}\n`);

if (failures.length) {
  for (const f of failures) console.log(`→ DIVERGENCE  ${f}`);
  process.exit(1);
}

if (checked < 1000 || peakBullets < 8 || waves < 10) {
  console.log(
    `EXECUTION ASSERTION FAILED: checked=${checked} peakBullets=${peakBullets} waves=${waves}`,
  );
  console.log('  expected checked >= 1000, peakBullets >= 8, waves >= 10');
  process.exit(1);
}

// Both contact paths must actually fire. 32 line hits and 16 mask hits are the
// measured split; requiring each separately is what stops one of them going
// dead again, which is exactly what happened to the mask path.
if (lineHits < 30 || maskHits < 15 || totalHits < 45) {
  console.log(
    `EXECUTION ASSERTION FAILED: lineHits=${lineHits} maskHits=${maskHits} totalHits=${totalHits}`,
  );
  console.log('  expected >= 30 line hits, >= 15 mask hits, >= 45 total');
  process.exit(1);
}

console.log(`→ ${checked} value comparisons, all exact`);
console.log(`→ ${waves} pair spawns, peak ${peakBullets} swords alive`);
console.log(
  `→ ${totalHits} contacts COMPUTED on ${hitFrames} frames, per-frame exact ` +
    `(${lineHits} via collision_line sub-steps, ${maskHits} via mask overlap)`,
);
console.log(`\nPASS  frames ${from}..${to} match the real game — sword tunnel corridor (ac 13)`);
