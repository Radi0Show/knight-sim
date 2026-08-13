#!/usr/bin/env node
// Run a playtester's replay token.
//
//   node tools/replay.mjs <token>              summary at the end of the run
//   node tools/replay.mjs <token> --at 412     state at frame 412
//   node tools/replay.mjs <token> --trace out.csv
//   node tools/replay.mjs --file report.txt    token on stdin or in a file
//
// This is the point of the whole deterministic-sim discipline. A tester's
// report is a string; this replays their exact run in a Node process with no
// browser, no renderer and no human at the keyboard, and lands on the frame
// they were looking at.
//
// If it does not reproduce, that is itself a finding — it means the bug is in
// the RENDERER (which the token does not capture) rather than in sim/, and
// that halves the search before you have opened a file.

import { readFileSync, writeFileSync } from 'node:fs';
import { createState, stepFrame, traceHeader, traceRow } from '../sim/index.js';
import { decodeReplay } from '../sim/replay.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { buildSingleAttackScene } from '../sim/scenes/single.js';

const argv = process.argv.slice(2);
function flag(name, fallback = null) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
}

let token = argv.find((a) => a.startsWith('K1.'));
const file = flag('--file');
if (!token && file) {
  // Testers paste the token into an issue body with other text around it, so
  // pull it out rather than demanding a clean file.
  const m = readFileSync(file, 'utf8').match(/K1\.[A-Za-z0-9._-]+/);
  if (m) [token] = m;
}
if (!token) {
  console.error('usage: node tools/replay.mjs <K1....token> [--at N] [--trace out.csv]');
  console.error('   or: node tools/replay.mjs --file <issue-body.txt>');
  process.exit(2);
}

let replay;
try {
  replay = decodeReplay(token);
} catch (err) {
  console.error(`bad token: ${err.message}`);
  process.exit(2);
}

const { meta, frames, inputAt } = replay;
const at = Number(flag('--at', frames));
const tracePath = flag('--trace');

const state = createState({ seed: meta.seed, traceBulletSlots: tracePath ? 8 : 0 });
if (meta.mode === 'practice') {
  buildSingleAttackScene(state, { attack: meta.attack, difficulty: meta.difficulty });
} else {
  buildPracticeScene(state, { seed: state.seed });
}

console.log(`replaying seed ${meta.seed} · ${meta.mode}`
  + (meta.mode === 'practice' ? ` · ${meta.attack} difficulty ${meta.difficulty}` : '')
  + ` · ${frames} frames recorded`);

// A snapshot of everything a report is likely to be about. Cheap to widen —
// if a class of bug keeps needing a field that is not here, add it.
const snap = () => ({
  frame: state.frame,
  phase: state.phase,
  hp: state.partyHp.map((h) => Math.max(h, -999)).join('/'),
  knight: state.knight?.hp,
  tp: Math.round(state.tension),
  soul: state.soul ? `${state.soul.x.toFixed(1)},${state.soul.y.toFixed(1)}` : '-',
  hits: state.counters.collisionHits,
  bullets: state.entities.filter((e) => e.alive && e.isBullet && e.type.name !== 'obj_heart').length,
  menu: state.menu?.open ? (state.menu.submenu ?? 'buttons') : '-',
  bar: state.fightBar ? `boltx ${state.fightBar.boltx}` : '-',
});

const rows = tracePath ? [traceHeader(state)] : null;
let hitFrames = [];
let prevHits = 0;
const stop = Math.min(at, frames);

for (let f = 0; f < stop; f++) {
  stepFrame(state, inputAt(f));
  if (rows) rows.push(traceRow(state));
  if (state.counters.collisionHits > prevHits) {
    hitFrames.push(state.frame);
    prevHits = state.counters.collisionHits;
  }
}

const s = snap();
console.log('');
for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(8)} ${v}`);
if (hitFrames.length) {
  // The frames the player got hit on are almost always what the report is
  // about, so surface them without being asked.
  const shown = hitFrames.slice(0, 12).join(', ');
  console.log(`\n  hit on frames: ${shown}${hitFrames.length > 12 ? ` … (+${hitFrames.length - 12})` : ''}`);
}

if (rows) {
  writeFileSync(tracePath, `${rows.join('\n')}\n`);
  console.log(`\ntrace -> ${tracePath} (${rows.length - 1} rows)`);
}

// The browser URL that lands a human on the EXACT frame, input and all. The
// renderer is the half a headless replay cannot check, so a visual report
// needs eyes on precisely this — `?frames=N` alone would fast-forward with no
// input and arrive somewhere else entirely.
console.log(`\nsee it:  /web/index.html?replay=${token}&frames=${stop}&pause=1`);
