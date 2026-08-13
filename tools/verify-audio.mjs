#!/usr/bin/env node
// EVERY ATTACK MAKES A SOUND, and none of them makes a wall of it.
//
// sim/audio.js records cues; it never plays anything, so this runs headless
// like everything else. There is no oracle here — the recordings do not carry
// an audio column — so this asserts the two properties that actually go wrong:
//
//   1. AUDIBILITY. An attack with no cue at all is silent in the shipped tool,
//      and nothing else notices. Six of the eight were silent until this pass.
//   2. NO STACKING. GameMaker's `audio_is_playing` guard is per sound ASSET
//      and global, so sixteen swords dashing together produce ONE cut. Dropping
//      that guard produced 473 snd_knight_cut over a single sword tunnel turn —
//      a solid wall of noise — while every other suite stayed green.
//
// The per-frame peak is the sharp end of (2). Three is legitimate: the Stars
// cone deliberately stacks three copies of snd_knight_drawpower to thicken it.

import { createState, stepFrame } from '../sim/index.js';
import { buildSingleAttackScene, ATTACK_MENU } from '../sim/scenes/single.js';
import { drainCues } from '../sim/audio.js';

const idle = { left: false, right: false, up: false, down: false, focus: false };
const FRAMES = 1100;
const PEAK_LIMIT = 4;

const failures = [];

for (const m of ATTACK_MENU) {
  const state = createState({ seed: 12345, traceBulletSlots: 0 });
  buildSingleAttackScene(state, { seed: 12345, attack: m.id, difficulty: m.difficulties[0] });

  const counts = new Map();
  let peak = 0;
  let peakFrame = 0;
  for (let f = 0; f < FRAMES; f++) {
    stepFrame(state, idle);
    const cues = drainCues(state);
    if (cues.length > peak) {
      peak = cues.length;
      peakFrame = f;
    }
    for (const c of cues) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }

  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) failures.push(`${m.id}: SILENT — no cue in ${FRAMES} frames`);
  if (peak > PEAK_LIMIT) {
    failures.push(`${m.id}: ${peak} cues on frame ${peakFrame} (limit ${PEAK_LIMIT})`);
  }

  // The audio_is_playing model, pinned where it matters. Every tunnel sword
  // asks for these on every frame of the dash; the guard is what turns that
  // into a handful.
  if (m.id === 'tunnel') {
    for (const n of ['snd_knight_cut', 'snd_knight_jump']) {
      const c = counts.get(n) ?? 0;
      if (c === 0) failures.push(`tunnel: ${n} never cued`);
      if (c > 20) failures.push(`tunnel: ${n} cued ${c} times — the idle guard is not holding`);
    }
  }

  const list = [...counts.keys()].sort().map((n) => `${n.replace('snd_', '')}x${counts.get(n)}`);
  console.log(`${m.id.padEnd(11)} peak ${String(peak).padStart(2)}/frame  ${list.join('  ')}`);
}

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}

console.log(`\nPASS  all ${ATTACK_MENU.length} attacks cue sound, none stacks (no oracle — see header)`);
