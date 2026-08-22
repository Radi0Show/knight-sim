#!/usr/bin/env node
// THE SIM HALF of whole-fight verification (docs/VERIFICATION.md).
//
//   node tools/fullfight-trace.mjs <token> --out sim.csv
//
// Replays a token through the real fight scene and writes the WIDE row —
// everything that accumulates across a fight, not just one attack's bullets.
// The oracle half drives the patched game from the SAME token and writes the
// same columns; `tools/diff-trace.mjs` then compares them as exact text.
//
// The token is the linchpin and it already exists: `verify-replay` proves it
// reproduces a live run exactly, which is the property that lets one recording
// stand in for a fight forever.

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createState, stepFrame, traceHeader, traceRow } from '../sim/index.js';
import { decodeReplay } from '../sim/replay.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';

const argv = process.argv.slice(2);
const token = argv.find((a) => a.startsWith('K1.'));
const outIdx = argv.indexOf('--out');
const out = outIdx >= 0 ? argv[outIdx + 1] : 'traces/fullfight-sim.csv';
const slots = Number(argv[argv.indexOf('--slots') + 1]) || 16;

if (!token) {
  console.error('usage: node tools/fullfight-trace.mjs <K1....token> [--out f.csv] [--slots N]');
  process.exit(2);
}

const replay = decodeReplay(token);
const state = createState({ seed: replay.meta.seed, traceBulletSlots: slots });
state.traceWide = true;

// KNIGHT_NO_MANTLE=1 disables ONLY scr_damage's ShadowMantle brunt gate
// (sim/damage.js knightTarget reads it) while leaving every stat at
// DEFAULT_GEAR. Diagnostic for recordings whose harness did not pin
// `global.chararmor*`: scr_gamestart zeroes the equip arrays, so that
// oracle party fights bare and the brunt block (gated on armor 23 being
// worn at all) never opens — one fewer choose() per hit than DEFAULT_GEAR
// consumes. This is how the f891 ±1-draw offset against verify21d was
// attributed. Recordings made after the harness pinned the equip arrays
// must NOT use this.
if (process.env.KNIGHT_NO_MANTLE) {
  state.noMantle = true;
  console.log('no-mantle: brunt targeting disabled (stats unchanged)');
}

// THE SHUFFLE IS REPLAYED FROM THE ORACLE, not reproduced.
//
// `ds_list_shuffle`'s algorithm is unsolved (CLAUDE.md), so the sim cannot
// derive a given seed's ordering — and rotating slash runs in every phase, so
// without this the whole-fight diff would fail on every one of them for a
// reason that is not a bug in the fight.
//
// oracle_fullfight.csx logs each shuffled `slash_list` as it is built; this
// feeds them back in build order through the hook rotating-slash.js already
// has for oracle_t7. The real shuffle still runs in the game and still burns
// its draws, so nothing downstream of it is falsified.
//
// This used to set `state.pinnedShuffle = true`, WHICH NOTHING READ. The flag
// was invented here and never wired to anything — the same write-only-variable
// failure CLAUDE.md records for `state.inv` and the original's
// `destroy_on_hit`. It read as "the shuffle is handled" while the sim quietly
// rolled its own order.
const shIdx = argv.indexOf('--shuffle');
if (shIdx >= 0) {
  const text = readFileSync(argv[shIdx + 1], 'utf8').trim();
  const lists = text
    ? text.split('\n').map((line) => line.split(',').slice(1).join(',')
        .split('|').map(Number))
    : [];
  state.fixedSlashOrder = true;
  state.angleLists = lists;
  state.angleIndex = 0;
  console.log(`shuffle: replaying ${lists.length} recorded list(s)`);
}

// THE ATTACK BAR'S SCHEDULE IS REPLAYED FROM THE ORACLE, for the same reason
// the shuffle is: `my_method == 1` builds it with choose() per bolt plus a
// rejection-sampled character, and the two sides' RNG call orders differ
// (scr_randomtarget draws every turn; Draw events consume too).
//
// Each logged line is `frame,boltframe:boltchar|boltframe:boltchar|...`, one
// per bar, in creation order. Without this the sides run different bolt
// frames, and since the scoring window forgives 15 frames of earliness the
// sim scores bolts the oracle has not reached — which reads as a damage
// divergence and is nothing of the kind.
// TRACKING SWORD DIRECTIONS, replayed from the oracle like the shuffle and
// the bolts — one direction per line (`frame,direction`), post-wheel. See
// sim/attacks/tracking-swords.js for why the wheel is bypassed.
const swIdx = argv.indexOf('--swords');
if (swIdx >= 0) {
  const text = readFileSync(argv[swIdx + 1], 'utf8').trim();
  state.swordDirections = text
    ? text.split('\n').map((line) => Number(line.split(',')[1]))
    : [];
  state.swordIndex = 0;
  state.swordDirectionsPostWheel = true;
  console.log(`swords: replaying ${state.swordDirections.length} recorded direction(s)`);
}

// FLURRY'S SLASH ORIENTATIONS AND OFFSETS, replayed from the oracle: the
// first slash's roll sits at an unattributed offset into the anchored
// stream (whole-fight f809), so like the shuffle, bolts and sword
// directions, the recording's values are fed back. Columns per line:
// frame, vertical, diagonal, direction, angleoffset, xoffset, yoffset.
const slIdx = argv.indexOf('--slashes');
if (slIdx >= 0) {
  const text = readFileSync(argv[slIdx + 1], 'utf8').trim();
  const recs = text ? text.split(/\r?\n/).map((line) => line.trim().split(',')) : [];
  state.splitterVerticals = recs.map((r) => Number(r[1]));
  state.splitterVIndex = 0;
  state.slashParams = recs.map((r) => ({
    angleoffset: Number(r[4]), xoffset: Number(r[5]), yoffset: Number(r[6]),
  }));
  state.slashIndex = 0;
  console.log(`slashes: replaying ${recs.length} recorded slash(es)`);
}

// GRAZE PAIRINGS, replayed from the oracle's grazelog — the same class of
// concession as the shuffle, bolts and swords. The runner's collision-pair
// enumeration is UNSOLVED at one specific point: a bullet that hits the
// heart usually gets no grazebox pairing that frame (six receipts across
// verify21g), but fight-860's tooth got both, and no convention tried —
// geometric, ordering, quantizer, history — separates the cases. The log
// rows are `label,ref,object,grazed,x,y,...`; label is stamped one frame
// early (obj_time Draw), and a pairing is keyed by frame + object + exact
// position, which the verified region makes byte-stable. The sim's OWN
// gates (active, grazed, inv) still run after the pairing decision, exactly
// as the game's event body runs after its pair test. Free play keeps the
// live geometric test.
const gzIdx = argv.indexOf('--grazes');
if (gzIdx >= 0) {
  const text = readFileSync(argv[gzIdx + 1], 'utf8').trim();
  // frame -> [{type, x, y, used}] — matched FUZZILY (0.05px) in stepGraze:
  // trig-moving bullets (starchildren) drift ~1e-4 px from the runner's
  // proprietary cosf, the same reason the whole-fight differ carries its
  // 0.02px position tolerance. Exact string keys dropped every one of
  // their pairings.
  const byFrame = new Map();
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    const r = line.split(',');
    if (r.length < 6) continue;
    const fight = Number(r[0]) + 1;
    if (!Number.isFinite(fight)) continue;
    if (!byFrame.has(fight)) byFrame.set(fight, []);
    // `inv` is the game's global.inv AT the event — the graze gate's input
    // with the frame's hit ordering already resolved (see stepGraze).
    byFrame.get(fight).push({
      type: r[2], x: Number(r[4]), y: Number(r[5]), inv: Number(r[10]), used: false,
    });
    n++;
  }
  state.grazeReplay = byFrame;
  console.log(`grazes: replaying ${n} recorded pairing(s)`);
}

// --shards <file>: the d2 starchildren's homing delays, one row per homing
// shard's init (oracle_shard.csv: frame, id, difficulty, delay, x, y). The
// controller's delay chain hands values out in instance-slot order, which
// the sim cannot derive (verify21j f4372) — so the recorded delay is matched
// back at init by frame + position, the graze replay's arrangement. The
// label lag is the same +1 (the shard's init logs in its step phase).
const shIdx = argv.indexOf('--shards');
if (shIdx >= 0 && existsSync(argv[shIdx + 1])) {
  const text = readFileSync(argv[shIdx + 1], 'utf8').trim();
  const byFrame = new Map();
  let n = 0;
  for (const line of text ? text.split(/\r?\n/) : []) {
    const r = line.split(',');
    if (r.length < 6) continue;
    const fight = Number(r[0]) + 1;
    if (!Number.isFinite(fight)) continue;
    if (!byFrame.has(fight)) byFrame.set(fight, []);
    byFrame.get(fight).push({
      delay: Number(r[3]), x: Number(r[4]), y: Number(r[5]), used: false,
    });
    n++;
  }
  state.shardDelays = byFrame;
  console.log(`shards: replaying ${n} recorded homing delay(s)`);
}

const boltIdx = argv.indexOf('--bolts');
if (boltIdx >= 0) {
  const text = readFileSync(argv[boltIdx + 1], 'utf8').trim();
  const schedules = text
    ? text.split('\n').map((line) => line.split(',').slice(1).join(',')
        .split('|').map((b) => {
          const [frame, char] = b.split(':').map(Number);
          return { char, frame, alive: true, red: false };
        }))
    : [];
  state.boltSchedules = schedules;
  state.boltIndex = 0;
  console.log(`bolts: replaying ${schedules.length} recorded schedule(s)`);
}

buildPracticeScene(state, { seed: state.seed });

// KEEP THE PARTY ALIVE — and say plainly what that costs.
//
// A scripted input does not dodge, so the party wipes within a turn or two and
// the fight stops; the recording then flatlines and the degeneracy guard
// (rightly) refuses it. verify-fight-order.mjs already faces this and resolves
// it the same way, "refusing to let a survival question decide a turn-order
// question".
//
// THE COST: hp0/hp1/hp2 are pinned at maximum, so THIS RUN DOES NOT VERIFY
// PARTY HP BOOKKEEPING — not the Shadow Mantle's two-hits-in-three targeting,
// not Kris never being the default target, not the swoon scaling. Damage still
// fires and still resets `inv_timer`, so the damage PATH is exercised; only
// the resulting HP is not checked.
//
// That is why this is a flag and not the default: a survivable hand-authored
// run, which keeps the hp columns honest, is the other half of the picture and
// is tracked separately. Reporting a --keep-alive run as whole-fight
// verification without this caveat would overstate it exactly the way the
// one-turn recording did.
const keepAlive = argv.includes('--keep-alive');
if (keepAlive) console.log('keep-alive: party HP pinned — hp columns NOT verified');

// USE THE ROWS `stepFrame` ALREADY WROTE, do not generate them again.
//
// stepFrame does `state.trace.push(traceRow(state)); state.frame += 1;` — the
// row is captured BEFORE the counter advances, so its first row is frame 0,
// matching the oracle's first in-room frame.
//
// Calling traceRow() again after stepFrame returns reads the ALREADY
// INCREMENTED counter, so every row came out numbered one too high. The
// differ joins on the frame column, so that silently compared the sim's
// frame N against the oracle's frame N — which are different moments — and
// showed up as the sim being consistently one frame behind on the menu, the
// bar and everything downstream.
const rows = [traceHeader(state)];
// The refill itself lives INSIDE stepFrame (state.keepAlive), before the
// trace row is captured — the oracle recorder refills before composing its
// row, so a refill done out here, after the row was already pushed, left
// every hit frame showing the drop the oracle never records.
state.keepAlive = keepAlive;
// KNIGHT_TT_DEBUG="a-b,c-d" prints turntimer and the cone's state for those
// frame ranges — the whole-fight differ has no turntimer column (the oracle
// trace does not record it), so release-timing questions land here.
const ttRanges = (process.env.KNIGHT_TT_DEBUG ?? '').split(',').filter(Boolean)
  .map((r) => r.split('-').map(Number));
// KNIGHT_DRAW_TRACE="a-b" prints every gmlU32 draw in those frames with its
// call site — for attributing a ±1 stream offset against the oracle.
const dtRange = (process.env.KNIGHT_DRAW_TRACE ?? '').split('-').map(Number);
for (let f = 0; f < replay.frames; f++) {
  globalThis.__simFrame = f;
  globalThis.__trap = dtRange.length === 2 && f >= dtRange[0] && f <= dtRange[1];
  stepFrame(state, replay.inputAt(f));
  if (ttRanges.some(([a, b]) => f >= a && f <= (b ?? a))) {
    const cone = state.entities.find((e) => e.alive && e.type.name === 'obj_knight_pointing_cone');
    const dir = state.entities.find((e) => e.alive && e.type.name === 'fight_director');
    console.error(`[tt] f=${f} tt=${state.turntimer}`
      + ` menu=${state.menu?.open ? (state.menu.submenu ?? 'buttons') : '-'}`
      + ` bar=${dir?.bar ? `x${dir.bar.boltx}${dir.bar.done ? 'D' : ''}` : '-'}`
      + ` talked=${dir?.talked ?? '-'} started=${dir?.started ?? '-'}`
      + (cone ? ` cone con=${cone.con} end=${cone.endtimer}` : ''));
  }
}
rows.push(...state.trace);
writeFileSync(out, `${rows.join('\n')}\n`);

console.log(`${replay.frames} frames -> ${out}`);
console.log(`  final: hp ${state.partyHp.join('/')} · knight ${state.knight.hp}`
  + ` · TP ${Math.round(state.tension)} · phase ${state.phaseNum} turn ${state.turnNum}`
  + ` · balloon ${state.dialogue.balloonturn}`);
console.log(`  columns: ${rows[0].split(',').length}`);
