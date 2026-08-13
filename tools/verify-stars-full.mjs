#!/usr/bin/env node
// STARS, whole attack, against knight-research/traces/stars2.csv.
//
// Supersedes verify-star-population, which ran on the pre-universal
// `t9-star.csv` and could not close either of the two divergences this project
// carried for a long time (star count at f170, box at f197). Both came from
// the old scene launching every star with a fixed direction and speed.
//
// Checked: the live star POPULATION frame by frame, the cone's `angle`,
// `angle_lerp`, `knockback` and internal `gt_x`, and the battle box position.
// The star count is the aggregate that catches spawn cadence, fire timing and
// per-star lifetime all at once — if any were wrong the curve would part.
//
// `turntimer` is fed from the recording each frame; see the scene header.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { createState, stepFrame } from '../sim/index.js';
import { makeInputTable } from '../input/state.js';
import { real } from '../sim/trace.js';
import {
  buildOracleStarsScene,
  ORACLE_STARS_INPUT,
  STARS_WINDOW,
  STAR_VARIANTS,
  STAR_TRACES,
} from './scenes/oracle-stars-full.js';

const POSITION_TOLERANCE = 1e-3;

function parseVars(field) {
  const d = {};
  for (const kv of (field ?? '').split('|')) {
    const i = kv.indexOf('=');
    if (i > 0) d[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return d;
}

/** Run one difficulty against its own recording. */
function runOne(difficulty) {
  const oraclePath = join(homedir(), 'knight-research', 'traces', STAR_TRACES[difficulty]);

  let slack = 0;
  let maxDelta = 0;
  const agree = (o, s) => {
  if (o === s) return true;
  const d = Math.abs(Number(o) - Number(s));
    if (d < POSITION_TOLERANCE) {
      slack += 1;
      if (d > maxDelta) maxDelta = d;
      return true;
    }
    return false;
  };

  const lines = readFileSync(oraclePath, 'utf8').replace(/\r/g, '').trimEnd().split('\n');
  const oracle = new Map();
  for (const line of lines.slice(1)) {
  const c = line.split(',');
  const frame = Number(c[0]);
  if (!oracle.has(frame)) oracle.set(frame, { stars: 0 });
  const f = oracle.get(frame);
  if (c[1] === 'obj_knight_pointing_star') f.stars += 1;
  else if (c[1] === 'obj_knight_pointing_cone') f.cone = parseVars(c[20]);
  else if (c[1] === 'obj_growtangle') f.box = c[3];
  else if (c[1] === '__global') f.turntimer = Number(parseVars(c[20]).turntimer);
  }

  const { from, to } = STARS_WINDOW;
  const state = createState({ seed: 1, traceBulletSlots: 0 });
  buildOracleStarsScene(state, difficulty);
  const inputAt = makeInputTable(ORACLE_STARS_INPUT);

  let checked = 0;
  let peakStars = 0;
  let sawFire = false;
  const failures = [];

  for (let frame = 0; frame <= to; frame++) {
  // Replay the turn clock before the frame runs — the controller and the cone
  // both branch on it.
  //
  // The value to feed is the one recorded at frame f-1, NOT f. The recorder
  // writes from obj_time's Draw, i.e. at the END of the frame, after
  // obj_battlecontroller has already decremented turntimer; the cone's Step
  // ran earlier in that same frame and saw the previous value. Feeding
  // frame f's value fires the attack exactly one frame early — everything
  // matched through 145 and the cone released at 146 instead of 147.
  const pre = oracle.get(frame - 1);
  if (pre && pre.turntimer !== undefined) state.turntimer = pre.turntimer;

  stepFrame(state, inputAt(frame));
  if (frame < from) continue;

  const exp = oracle.get(frame);
  if (!exp) continue;

  const stars = state.entities.filter(
    (e) => e.alive && e.type.name === 'obj_knight_pointing_star',
  );
  peakStars = Math.max(peakStars, stars.length);

  const cone = state.entities.find(
    (e) => e.alive && e.type.name === 'obj_knight_pointing_cone',
  );
  const box = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
  if (cone && cone.knockback > 0) sawFire = true;

  const exact = [['stars', String(exp.stars), String(stars.length)]];
  const loose = [];
  if (exp.cone && cone) {
    for (const k of ['angle', 'angle_lerp', 'knockback', 'gt_x']) {
      loose.push([`cone.${k}`, exp.cone[k], real(cone[k])]);
    }
  }
  if (exp.box !== undefined && box) loose.push(['box.x', exp.box, real(box.x)]);

  let bad = null;
  for (const [n, o, s] of exact) {
    checked += 1;
    if (String(o) !== String(s)) {
      bad = `${n}  oracle=${o}  engine=${s}`;
      break;
    }
  }
  if (!bad) {
    for (const [n, o, s] of loose) {
      if (o === undefined) continue;
      checked += 1;
      if (!agree(String(o), String(s))) {
        bad = `${n}  oracle=${o}  engine=${s}`;
        break;
      }
    }
  }
  if (bad) {
    failures.push(`frame ${frame}: ${bad}`);
    break;
  }
  }


  return { failures, checked, peakStars, sawFire, slack, maxDelta, oraclePath };
}

let bad = 0;
for (const difficulty of Object.keys(STAR_VARIANTS).map(Number)) {
  const r = runOne(difficulty);
  console.log(`difficulty ${difficulty}: ${r.oraclePath}`);
  if (r.failures.length) {
    for (const f of r.failures) console.log(`  → DIVERGENCE  ${f}`);
    bad += 1;
    continue;
  }
  if (r.checked < 1000 || r.peakStars < 10 || !r.sawFire) {
    console.log(`  EXECUTION ASSERTION FAILED: checked=${r.checked} peakStars=${r.peakStars} sawFire=${r.sawFire}`);
    bad += 1;
    continue;
  }
  console.log(
    `  → ${r.checked} comparisons, peak ${r.peakStars} stars, ` +
      (r.slack === 0 ? 'all exact' : `${r.slack} inexact worst ${r.maxDelta.toExponential(2)}`),
  );
}

if (bad) process.exit(1);
console.log(`\nPASS  frames ${STARS_WINDOW.from}..${STARS_WINDOW.to} — Stars at difficulties 0, 1 and 2`);
