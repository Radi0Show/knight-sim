#!/usr/bin/env node
// AUDIO COVERAGE — every sound the live knight objects play must be cued
// somewhere in sim/, or be listed below with the reason it is not.
//
// Written after a player reported "stars is missing some sounds" and the
// answer was yes: obj_dbulletcontroller's type 98 plays snd_stardrop on every
// star it spawns (~every 4 frames while the cone is open) and the sim cued
// nothing. A per-attack ear check would never have found the other two —
// the charge-up's powerup (phase 4's silent turn) and the block bell.
//
// THE DUMP IS THE SOURCE and the sim is the thing under test, so this suite
// re-derives the expected set on every run rather than hardcoding a list:
// add an attack, add its sounds, and the gap shows up here.
//
// LIMIT, stated because it matters: this checks the sound is cued SOMEWHERE,
// not that it is cued at the right site with the right pitch. snd_stardrop
// was already cued by ROARING while Stars was silent, which is exactly the
// hole this suite cannot see — the per-site work is still reading the object.
import { readdirSync, readFileSync } from 'node:fs';

const DUMP = process.env.HOME + '/knight-research/gml_dump/CodeEntries';
const SIM = process.env.HOME + '/knight-sim/sim';

// Objects the real fight actually reaches (CLAUDE.md's selector table),
// plus the shared bullet/controller layer.
const LIVE = [
  'obj_knight_pointing_cone', 'obj_knight_pointing_star', 'obj_knight_pointing_starchild',
  'obj_knight_rotating_slash', 'obj_roaringknight_slash', 'obj_roaringknight_quickslash',
  'obj_roaringknight_quickslash_big', 'obj_roaringknight_quickslash_attack',
  'obj_roaringknight_splitslash', 'obj_roaringknight_boxsplitter_attack',
  'obj_knight_split_growtangle', 'obj_roaringknight_split_bullet',
  'obj_tracking_swords_manager', 'obj_tracking_sword1', 'obj_tracking_sword_slash',
  'obj_sword_tunnel_manager', 'obj_sword_tunnel_sword', 'obj_swordtunnelanim',
  'obj_sword_vortex', 'obj_knight_roaring2', 'obj_knight_roaring_star',
  'obj_knight_roaring_fx', 'obj_knight_enemy', 'obj_dbulletcontroller',
];

const gml = new Map(); // sound -> [where]
for (const f of readdirSync(DUMP)) {
  const base = f.replace(/^gml_Object_/, '').replace(/_(Step|Draw|Create|Other|Alarm|CleanUp)_\d+\.gml$/, '');
  if (!LIVE.includes(base)) continue;
  const text = readFileSync(`${DUMP}/${f}`, 'utf8');
  for (const m of text.matchAll(/snd_(?:play|play_x|play_pitch|loop|play_pitch_x)\s*\(\s*(snd_[a-z_0-9]+)/g)) {
    if (!gml.has(m[1])) gml.set(m[1], []);
    gml.get(m[1]).push(f.replace(/^gml_Object_/, '').replace(/\.gml$/, ''));
  }
}

const simCued = new Set();
const walk = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) { walk(`${dir}/${f.name}`); continue; }
    if (!f.name.endsWith('.js')) continue;
    const text = readFileSync(`${dir}/${f.name}`, 'utf8');
    // cue(state, 'snd_x') / cueLoop / cueStop — ignore commented lines
    for (const line of text.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const m of line.matchAll(/cue[A-Za-z]*\s*\(\s*state\s*,\s*'(snd_[a-z_0-9]+)'/g)) simCued.add(m[1]);
    }
  }
};
walk(SIM);

// Sounds in obj_dbulletcontroller that belong to OTHER bosses' types. The
// controller carries every attack type in the game; the knight uses 98, 99,
// 104, 105, 107, 151-154. Each of these was traced to its enclosing
// `if (type == N)` and none of those N is the knight's.
const OTHER_BOSSES = {
  snd_coin: 'type 32',
  snd_spearappear: 'type 34',
  snd_laz_c: 'type 77',
  snd_rimshot: 'type 129',
};

const missing = [...gml.keys()].filter((s) => !simCued.has(s) && !OTHER_BOSSES[s]).sort();
const excused = [...gml.keys()].filter((s) => !simCued.has(s) && OTHER_BOSSES[s]).sort();
console.log(`GML sounds in live objects: ${gml.size}   cued by sim: ${simCued.size}`);
console.log(`not the knight's (other controller types): ${excused.map((s) => `${s} (${OTHER_BOSSES[s]})`).join(', ')}`);
if (missing.length) {
  console.log(`\n→ FAILURE  ${missing.length} sound(s) the fight plays and the sim never cues:`);
  for (const s of missing) console.log(`  ${s.padEnd(34)} ${[...new Set(gml.get(s))].join(', ')}`);
  process.exit(1);
}

// THE OTHER DIRECTION: every cue name the sim (or a driver-side scene) can
// emit must have a file in the local audio index, or it plays as SILENCE.
// Written after the ending's laugh and shard-break sounds shipped extracted
// but unlisted — the audio layer plays only what index.json maps, so a
// missing entry is inaudible and no suite saw it. Cue sites come in two
// shapes: cue(state, 'snd_x') and the scenes' cues.push({ name: 'snd_x' }).
const emitted = new Set(simCued);
const collectPushes = (dir) => {
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    if (f.isDirectory()) { collectPushes(`${dir}/${f.name}`); continue; }
    if (!f.name.endsWith('.js')) continue;
    const text = readFileSync(`${dir}/${f.name}`, 'utf8');
    for (const line of text.split('\n')) {
      if (/^\s*(\/\/|\*)/.test(line)) continue;
      for (const m of line.matchAll(/name:\s*'(snd_[a-z_0-9]+)'/g)) emitted.add(m[1]);
    }
  }
};
collectPushes(SIM);
const index = JSON.parse(readFileSync(`${process.env.HOME}/knight-sim/assets/audio/index.json`, 'utf8'));
const unplayable = [...emitted].filter((s) => !index[s]).sort();
if (unplayable.length) {
  console.log(`\n→ FAILURE  ${unplayable.length} cue(s) with no file in assets/audio/index.json (silent):`);
  for (const s of unplayable) console.log(`  ${s}`);
  process.exit(1);
}
console.log(`cue names emitted anywhere: ${emitted.size} — all present in the audio index`);
console.log('\nPASS  audio coverage — every live knight sound is cued');
