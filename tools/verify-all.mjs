#!/usr/bin/env node
// Run every verification suite. This is the project's health check.
//
//   export PATH="$HOME/tools/node/bin:$PATH"
//   node tools/verify-all.mjs
//
// If this is green, the engine reproduces the real game everywhere it claims
// to. Run it before and after any change to sim/.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));

// TWO KINDS OF SUITE, and the difference is where the truth lives.
//
// The oracle suites diff against recordings in `~/knight-research/traces/` —
// the PRIVATE repo, which is never published and does not exist on a CI
// runner or on a fresh clone. The rest are self-contained: pure logic against
// values read out of the dump and written into the suite.
//
// This runner used to assume the traces were always there, so CI failed 20 of
// 36 suites on ENOENT and blocked the deploy. Skipping them is right — a
// machine without the oracle genuinely cannot check those claims — but it
// must be LOUD, because a silent skip is indistinguishable from a pass and
// this file is the project's health check.
const ORACLE_DIR = join(homedir(), 'knight-research', 'traces');
const HAVE_ORACLE = existsSync(ORACLE_DIR);

/** A suite needs the oracle if it reads a trace. Detected, not hand-listed —
 *  a hand-list goes stale the first time someone adds a suite. */
function needsOracle(file) {
  try {
    const src = readFileSync(join(here, file), 'utf8');
    return /knight-research|traces\//.test(src);
  } catch {
    return false;
  }
}

const SUITES = [
  ['verify-rng.mjs', "GameMaker's RNG (WELL512) reproduced"],
  ['verify-f32.mjs', 'float32 built-in fields narrow as the runner does'],
  ['verify-contact.mjs', 'precise-mask collision model'],
  ['verify-t3.mjs', 'soul movement'],
  ['verify-t4.mjs', 'obj_roaringknight_slash'],
  ['verify-fountain.mjs', 'fountain bullets (engine only — not in the fight)'],
  ['verify-splitter.mjs', 'box splitter organism'],
  ['verify-rotating.mjs', 'rotatingslash — ac 5, every phase'],
  ['verify-stars.mjs', 'Stars cone — ac 1, opens every phase'],
  ['verify-stars-full.mjs', 'Stars — whole attack, ac 1 difficulty 0'],
  ['verify-flurry.mjs', 'Flurry — ac 2, phases 1/2/3'],
  ['verify-tracking.mjs', 'tracking swords — ac 11/14'],
  ['verify-tracking-wheel.mjs', 'tracking swords — anti-repeat wheel (no oracle)'],
  ['verify-diagonal.mjs', 'diagonal bullets (engine only — ac 12 is unreachable)'],
  ['verify-swordtunnel.mjs', 'sword tunnel corridor — ac 13'],
  ['verify-vortex.mjs', 'sword vortex — ac 15'],
  ['verify-rotating-difficulty.mjs', 'rotating slash — difficulties 1 and 2'],
  ['verify-splitter-difficulty.mjs', 'box splitter — difficulties 1 and 3'],
  ['verify-tunnel-difficulty.mjs', 'sword tunnel — difficulties 3 and 4'],
  ['verify-tunnel-finale.mjs', 'sword tunnel finale — con 1 dash, all difficulties'],
  ['verify-starchild.mjs', 'starchild homing — Stars difficulty 2'],
  ['verify-underbox.mjs', 'underbox orbs — ac 6 (unreachable content, no oracle)'],
  ['verify-knightlines.mjs', 'knightlines spears — ac 20 (unreachable content, no oracle)'],
  ['verify-swordslash.mjs', 'Swordslash crescents — ac 0 (unreachable content, no oracle)'],
  ['verify-tunnel-revised.mjs', 'revised sword tunnel — ac 3 (unreachable content, no oracle)'],
  ['verify-combination.mjs', 'combination chain — ac 7 (unreachable, all three segments)'],
  ['verify-roaring-star.mjs', 'roaring star lifecycle — ac 9'],
  ['verify-roaring-pull.mjs', 'roaring pull + rings + screen shake — ac 9'],
  ['verify-fight-order.mjs', 'the playable scene runs the real fight order'],
    ['verify-audio.mjs', 'sound cues — every attack audible, none stacking'],
  ['verify-damage.mjs', 'damage — every attack takes HP, DEFEND reduces it'],
  ['verify-graze.mjs', 'graze + TP — every attack grazeable, clock shortens'],
  ['verify-items.mjs', 'items — 12 slots, chapter 3 heal values'],
  ['verify-fightbar.mjs', 'FIGHT bar — schedule, window, one-button scoring'],
  ['verify-itemmenu.mjs', 'item menu — the 2x6 grid, pages, clamped cursor'],
  ['verify-spells.mjs', 'MAGIC and ACT — lists, TP costs, HoldBreath'],
  ['verify-dmgnumbers.mjs', 'damage numbers + impacts — stack, squash, bounces'],
  ['verify-animation.mjs', 'party + knight animation — poses, timers, hurt strobe'],
  ['verify-swoon.mjs', 'the swoon system — scr_dead/scr_revive, both floors, the heal gate'],
  ['verify-audio-coverage.mjs', 'audio coverage — every live knight sound is cued'],
  ['verify-dialogue.mjs', 'the fight dialogue — the two-beat exchange'],
  ['verify-textsound.mjs', 'the typewriter — per-typer voice, skipped punctuation'],
  ['verify-victory.mjs', 'the ending cutscene — positions, the walk, the exit'],
  ['verify-roaring-fx.mjs', "ROARING's effect layer — screen echoes, streaks, the return"],
  ['verify-share.mjs', 'shareable setups — ?cfg= round trip and hostile tokens'],
  ['verify-contact-coverage.mjs', 'contact coverage — every attack can actually hit'],
  ['verify-titlemenu.mjs', 'title navigation — stages, X back, the GRAPHICS toggles'],
  ['verify-battlemsg.mjs', 'the battle message box — 15 lines, phase 4 gates, down messages'],
  // The whole-fight diff. Skips loudly without ~/knight-research/traces, so on
  // CI this reports SKIP rather than a green tick it has not earned.
  ['verify-fullfight.mjs', 'the whole fight — one token, two runs, one diff'],
  ['sabotage-fullfight.mjs', 'the whole-fight differ itself — 10 injected faults'],
  ['verify-equipment.mjs', 'equipment — tables from the dump, mantle, graze factors'],
  ['verify-knight.mjs', 'knight damage — FIGHT, spells, the reduction ramp'],
['verify-replay.mjs', 'replay tokens — round-trip and reproduce a live run'],
['verify-determinism.mjs', 'byte-identical across 10 runs'],
];

// EVERY suite file must be in the table. A suite that exists and is never run
// is worse than no suite: it looks like coverage and checks nothing. This
// catches the one I keep making — writing a suite and forgetting to register
// it, which happened twice while building the menus.
const listed = new Set(SUITES.map(([f]) => f));
const onDisk = readdirSync(here)
  .filter((f) => /^verify-.*\.mjs$/.test(f) && f !== 'verify-all.mjs');
const unregistered = onDisk.filter((f) => !listed.has(f));
if (unregistered.length) {
  console.log(`UNREGISTERED SUITES (in tools/ but never run): ${unregistered.join(', ')}`);
  console.log('Add them to SUITES in tools/verify-all.mjs.\n');
}

let failed = 0;
let skipped = 0;
const width = Math.max(...SUITES.map(([f]) => f.length));

for (const [file, what] of SUITES) {
  if (!HAVE_ORACLE && needsOracle(file)) {
    skipped++;
    console.log(`SKIP  ${file.padEnd(width)}  ${what}`);
    continue;
  }
  const r = spawnSync(process.execPath, [join(here, file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file.padEnd(width)}  ${what}`);
  if (!ok) {
    for (const line of out.trimEnd().split('\n').slice(-6)) console.log(`        ${line}`);
  }
}

console.log('');
if (skipped) {
  console.log(`${skipped} oracle suites SKIPPED — no ${ORACLE_DIR}.`);
  console.log('Those are the ones that diff against recordings of the real game.');
  console.log('This run proves the self-contained half only.\n');
}
if (unregistered.length) {
  console.log(`${unregistered.length} suite file(s) are not registered — see above.`);
  process.exit(1);
}
if (failed) {
  console.log(`${failed}/${SUITES.length - skipped} SUITES FAILING`);
  process.exit(1);
}
const ran = SUITES.length - skipped;
console.log(HAVE_ORACLE
  ? `All ${ran} suites green.`
  : `All ${ran} self-contained suites green (${skipped} oracle suites skipped).`);
