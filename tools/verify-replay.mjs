#!/usr/bin/env node
// REPLAY TOKENS — the playtest bug-report format.
//
// A token is only useful if it reproduces the run EXACTLY. If it decodes to
// almost-the-right inputs it reproduces a different bug, and the fix goes
// somewhere useless — worse than having no token, because it looks like it
// worked.
//
// So this asserts the round trip bit for bit, and then asserts the thing that
// actually matters: replaying a token through the real scene lands on the same
// state as playing it live did.

import { createState, stepFrame } from '../sim/index.js';
import {
  createRecorder, recordInput, encodeReplay, decodeReplay,
  packInput, unpackInput, TOKEN_VERSION,
} from '../sim/replay.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';

const failures = [];
const KEYS = ['left', 'right', 'up', 'down', 'focus', 'confirm', 'cancel'];
const idle = Object.fromEntries(KEYS.map((k) => [k, false]));

// Every button must survive the byte packing, including all of them at once —
// an off-by-one in the bit table only shows on the button that got clipped.
for (let mask = 0; mask < 128; mask++) {
  const input = unpackInput(mask);
  if (packInput(input) !== mask) failures.push(`mask ${mask} did not round-trip`);
}

/** A plausible play pattern: long holds, occasional taps, a chord. */
function play(f) {
  const i = { ...idle };
  if ((Math.floor(f / 37) % 3) === 0) i.right = true;
  if ((Math.floor(f / 37) % 3) === 1) i.left = true;
  if (f % 53 === 0) i.confirm = true;
  if (f % 211 === 0) i.cancel = true;
  if ((Math.floor(f / 90) % 2) === 0) i.focus = true;
  return i;
}

// ── the round trip ───────────────────────────────────────────────────────
{
  const N = 3000;
  const rec = createRecorder({ seed: 9, mode: 'fight' });
  for (let f = 0; f < N; f++) recordInput(rec, play(f));
  const token = encodeReplay(rec);
  const back = decodeReplay(token);

  if (back.frames !== N) failures.push(`decoded ${back.frames} frames, recorded ${N}`);
  for (let f = 0; f < N; f++) {
    const a = play(f);
    const b = back.inputAt(f);
    for (const k of KEYS) {
      if (!!a[k] !== !!b[k]) {
        failures.push(`frame ${f} ${k}: ${a[k]} -> ${b[k]}`);
        f = N;
        break;
      }
    }
  }
  if (back.meta.seed !== 9) failures.push('the seed did not survive');

  // IT HAS TO FIT IN AN ISSUE. 3000 frames is 100 seconds of play; if that
  // does not encode small enough to paste, testers will not send it.
  if (token.length > 1200) {
    failures.push(`100s of play encodes to ${token.length} chars — too long to paste`);
  }
  // A run-length encoding that is not actually compressing means the format
  // regressed to one entry per frame, which passes every other check here.
  if (token.length > N / 2) {
    failures.push(`token is ${token.length} chars for ${N} frames — RLE is not working`);
  }
}

// A held-still run is the best case and must be tiny.
{
  const rec = createRecorder({ seed: 1, mode: 'fight' });
  for (let f = 0; f < 5000; f++) recordInput(rec, idle);
  const token = encodeReplay(rec);
  if (token.length > 100) failures.push(`5000 idle frames encode to ${token.length} chars`);
}

// ── malformed tokens must THROW, not decode to something plausible ───────
const bad = [
  ['', 'empty'],
  ['K1.9.fight', 'too few fields'],
  ['K2.9.fight.-.0.4.AAEA', 'wrong version'],
  ['K1.9.fight.-.0.999.AAEA', 'frame count disagrees with the payload'],
];
for (const [token, why] of bad) {
  let threw = false;
  try { decodeReplay(token); } catch { threw = true; }
  if (!threw) failures.push(`a token with ${why} decoded instead of throwing`);
}
if (TOKEN_VERSION !== 'K1') failures.push(`token version is ${TOKEN_VERSION}, tokens in the wild say K1`);

// ── THE ONE THAT MATTERS: a replay reproduces the run ────────────────────
// Play a scene live, record it, then replay the token into a fresh scene and
// require the same state. This is the whole promise of a replay token.
{
  const N = 500;
  const live = createState({ seed: 9, traceBulletSlots: 0 });
  buildPracticeScene(live, { seed: 9 });
  const rec = createRecorder({ seed: 9, mode: 'fight' });
  for (let f = 0; f < N; f++) {
    const i = play(f);
    recordInput(rec, i);
    stepFrame(live, i);
  }

  const back = decodeReplay(encodeReplay(rec));
  const redo = createState({ seed: 9, traceBulletSlots: 0 });
  buildPracticeScene(redo, { seed: 9 });
  for (let f = 0; f < back.frames; f++) stepFrame(redo, back.inputAt(f));

  const shape = (s) => [
    s.frame, s.partyHp.join('/'), s.knight.hp, Math.round(s.tension * 1000),
    s.soul ? `${s.soul.x},${s.soul.y}` : '-',
    s.counters.collisionHits, s.entities.filter((e) => e.alive).length,
  ].join(' | ');

  if (shape(live) !== shape(redo)) {
    failures.push(`replay diverged:\n     live ${shape(live)}\n     redo ${shape(redo)}`);
  }
  console.log(`replayed 500 frames of live play exactly: ${shape(redo)}`);
}

console.log(`3000 frames (100s) of play -> ${encodeReplay((() => {
  const r = createRecorder({ seed: 9, mode: 'fight' });
  for (let f = 0; f < 3000; f++) recordInput(r, play(f));
  return r;
})()).length} chars`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  replay tokens round-trip and reproduce a live run');
