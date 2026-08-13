#!/usr/bin/env node
// obj_dmgwriter and obj_basicattack — the feedback for a FIGHT hit.
//
// These matter more in this fight than in any other, because the Knight's HP
// reads "???". The number that pops off him is the ONLY way to know whether an
// attack bar was worth anything.
//
// What this pins, all of it easy to get wrong invisibly:
//
//   * the stack: `(monstery + 20) - (hittarget * 20)`, so simultaneous hits
//     go UP rather than overlapping
//   * the squash: stretch 0.2 -> 1 at 0.4 a frame, drawn (2 - stretch,
//     stretch + kill) — a wide flat smear snapping to square in three frames
//   * TWO bounces, each half the last, then it sticks
//   * `damage == 0` is a MISS graphic, not a "0"
//   * `image_index >= maxindex` destroys the impact — and a critical KEEPS
//     GROWING (+0.1 a frame) rather than sitting at 2.5

import { createState } from '../sim/index.js';
import {
  createDmgNumbers, spawnDmgNumber, stepDmgNumbers, resetDmgStack, DMG_COLORS,
  dmgColor, TYPE_PARTY, TYPE_DEAD,
} from '../sim/dmgnumbers.js';
import { knightTarget } from '../sim/damage.js';
import { createKnight } from '../sim/knight.js';
import { createAttackVfx, spawnImpact, stepAttackVfx, IMPACT, KRIS_IMPACT } from '../sim/attackvfx.js';

const failures = [];
const half = () => 0.5;

function st() {
  const s = createState({ seed: 1 });
  s.dmg = createDmgNumbers();
  s.attackVfx = createAttackVfx();
  return s;
}

// ── the stack ────────────────────────────────────────────────────────────
{
  const s = st();
  spawnDmgNumber(s, 400, 100, 11, 0);
  spawnDmgNumber(s, 400, 100, 27, 1);
  spawnDmgNumber(s, 400, 100, 18, 2);
  const ys = s.dmg.list.map((n) => n.ystart);
  if (ys.join() !== '120,100,80') {
    failures.push(`stack is ${ys.join()}, expected 120,100,80 (20px apart, going up)`);
  }
  resetDmgStack(s);
  spawnDmgNumber(s, 400, 100, 5, 0);
  if (s.dmg.list[3].ystart !== 120) failures.push('resetDmgStack did not clear hittarget');
}

// ── the delay ────────────────────────────────────────────────────────────
// Nothing happens until it elapses — the number lands AFTER the swing.
{
  const s = st();
  spawnDmgNumber(s, 400, 100, 50, 0, 8);
  const n = s.dmg.list[0];
  for (let i = 0; i < 7; i++) stepDmgNumbers(s, half);
  if (n.y !== n.ystart || n.vspeed !== 0) failures.push('the number moved during its delay');
  stepDmgNumbers(s, half);
  if (n.vspeed >= 0) failures.push('the number was never thrown upward');
  if (n.hspeed !== 10) failures.push(`hspeed is ${n.hspeed}, expected 10`);
}

// ── the squash ───────────────────────────────────────────────────────────
// (1.8, 0.2) -> (1.4, 0.6) -> (1.0, 1.0), then it clamps.
{
  const s = st();
  spawnDmgNumber(s, 400, 100, 50, 0, 0);
  const n = s.dmg.list[0];
  const seen = [];
  for (let i = 0; i < 5; i++) {
    seen.push(`${(2 - n.stretch).toFixed(1)}x${(n.stretch + n.kill).toFixed(1)}`);
    stepDmgNumbers(s, half);
  }
  if (seen[0] !== '1.8x0.2') failures.push(`first frame ${seen[0]}, expected 1.8x0.2`);
  if (n.stretch !== 1) failures.push(`stretch settled at ${n.stretch}, expected 1`);
  if (n.stretchgo !== 0) failures.push('stretchgo never cleared');
}

// ── the bounces ──────────────────────────────────────────────────────────
// Exactly two, each half the last, then it sticks at ystart.
{
  const s = st();
  spawnDmgNumber(s, 400, 100, 50, 0, 0);
  const n = s.dmg.list[0];
  for (let i = 0; i < 34; i++) stepDmgNumbers(s, half);
  if (n.bounces !== 2) failures.push(`bounced ${n.bounces} times, expected 2`);
  if (n.y !== n.ystart) failures.push('the number did not settle at ystart');
  // hspeed decays to a stop rather than carrying on forever.
  if (n.hspeed !== 0) failures.push(`hspeed settled at ${n.hspeed}, expected 0`);
}

// ── the fade, and that it is CLEANED UP ──────────────────────────────────
// A number that never dies is a leak that shows as clutter on screen.
{
  const s = st();
  spawnDmgNumber(s, 400, 100, 50, 0, 0);
  for (let i = 0; i < 100; i++) stepDmgNumbers(s, half);
  if (s.dmg.list.length !== 0) failures.push('the number was never destroyed');
}

// A zero is a MISS, and it must survive to be drawn as one.
{
  const s = st();
  spawnDmgNumber(s, 400, 100, 0, 0, 0);
  for (let i = 0; i < 5; i++) stepDmgNumbers(s, half);
  if (s.dmg.list.length !== 1) failures.push('a zero-damage number was dropped');
  if (s.dmg.list[0].damage !== 0) failures.push('the MISS number lost its zero');
}

// Colours are per CHARACTER for damage DEALT, and distinct — three identical
// numbers in a column are unreadable.
if (new Set(DMG_COLORS.map((c) => c.join())).size !== 3) {
  failures.push('the three damage colours are not distinct');
}

// **DAMAGE TAKEN IS WHITE.** `dmgwriter.type = doomtype`, which is -1 for an
// ordinary hit, and obj_dmgwriter's Draw opens `draw_set_color(c_white)`
// before any type branch — -1 matches none of them. Tinting an incoming hit by
// who took it reads as if the party were hitting themselves.
if (dmgColor(TYPE_PARTY).join() !== '255,255,255') {
  failures.push(`party damage is ${dmgColor(TYPE_PARTY).join()}, expected white`);
}
if (dmgColor(TYPE_DEAD).join() !== '255,0,0') {
  failures.push('a death is not red');
}
for (let i = 0; i < 3; i++) {
  if (dmgColor(i).join() === '255,255,255') failures.push(`slot ${i} dealt damage is white`);
}

// ── WHO GETS HIT ─────────────────────────────────────────────────────────
// Two stacked rules from scr_damage's chapter-3 block.
{
  // 1. KRIS IS NEVER THE DEFAULT TARGET while either ally stands.
  const s = st();
  s.heroes = null;
  s.partyHp = [160, 190, 140];
  s.knight = createKnight();
  // No mantle anywhere: the plain avoid-Kris redirect.
  s.loadout = { gear: [{ weapon: 0, armor: [] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }] };
  const hits = [0, 0, 0];
  for (let i = 0; i < 30; i++) hits[knightTarget(s, 0, { choose: (...x) => x[i % x.length] })] += 1;
  if (hits[0] !== 0) failures.push(`Kris took ${hits[0]} hits aimed at him — he should never be the target`);
  if (hits[1] === 0 || hits[2] === 0) failures.push('the redirect did not reach both allies');

  // Both allies down: it falls back to Kris.
  s.partyHp = [160, -999, -999];
  if (knightTarget(s, 0, { choose: (...x) => x[0] }) !== 0) {
    failures.push('with both allies down the hit did not fall back to Kris');
  }
}
{
  // 2. THE BRUNT. Two hits in every three go to the ShadowMantle wearer.
  const s = st();
  s.partyHp = [160, 190, 140];
  s.knight = createKnight();
  // ShadowMantle is armour id 23; on Kris, as the default build has it.
  s.loadout = { gear: [{ weapon: 0, armor: [23] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }] };
  const hits = [0, 0, 0];
  for (let i = 0; i < 30; i++) hits[knightTarget(s, 1, { choose: (...x) => x[i % x.length] })] += 1;
  if (hits[0] !== 20) failures.push(`the mantle wearer took ${hits[0]}/30, expected 20 (two in three)`);
}
{
  // THE SWORD TUNNEL IS EXEMPT — `myattackchoice != 13`.
  const s = st();
  s.partyHp = [160, 190, 140];
  s.knight = createKnight();
  // ShadowMantle is armour id 23; on Kris, as the default build has it.
  s.loadout = { gear: [{ weapon: 0, armor: [23] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }] };
  const hits = [0, 0, 0];
  for (let i = 0; i < 30; i++) hits[knightTarget(s, 1, { ac: 13, choose: (...x) => x[i % x.length] })] += 1;
  if (hits[0] !== 0) failures.push(`the mantle pulled ${hits[0]} sword-tunnel hits — ac 13 is exempt`);
}
{
  // `aoedamage` skips both rules: an attack that hits everyone hits everyone.
  const s = st();
  s.partyHp = [160, 190, 140];
  s.knight = createKnight();
  // ShadowMantle is armour id 23; on Kris, as the default build has it.
  s.loadout = { gear: [{ weapon: 0, armor: [23] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }] };
  if (knightTarget(s, 0, { aoe: true, choose: (...x) => x[0] }) !== 0) {
    failures.push('an AOE hit was redirected');
  }
}

// ── the impact ───────────────────────────────────────────────────────────
// Kris's sprite comes off the OBJECT, not the code. If this is ever null again
// the impact silently disappears for him alone.
if (KRIS_IMPACT !== 'spr_attack_cut1') {
  failures.push(`Kris's impact is ${KRIS_IMPACT}, expected spr_attack_cut1`);
}
if (new Set(IMPACT.map((i) => i.sprite)).size !== 3) {
  failures.push('two characters share an impact sprite');
}
// Only Susie shakes.
if (IMPACT[0].shake || IMPACT[2].shake) failures.push('someone other than Susie shakes the screen');
if (!IMPACT[1].shake) failures.push('Susie does not shake the screen');

{
  const s = st();
  spawnImpact(s, 400, 100, 1, false, half);
  const v = s.attackVfx[0];
  if (v.scale !== 2) failures.push(`a normal impact is scale ${v.scale}, expected 2`);
  for (let i = 0; i < 20; i++) stepAttackVfx(s);
  if (s.attackVfx.length !== 0) failures.push('the impact was never destroyed');
}
{
  // A CRITICAL keeps growing rather than sitting at 2.5.
  const s = st();
  spawnImpact(s, 400, 100, 1, true, half);
  const v = s.attackVfx[0];
  if (v.scale !== 2.5) failures.push(`a critical starts at ${v.scale}, expected 2.5`);
  stepAttackVfx(s);
  stepAttackVfx(s);
  if (v.scale <= 2.5) failures.push('a critical did not keep growing');
}
// The random scatter must actually scatter — three hits landing on the same
// pixel look like one.
{
  const s = st();
  let r = 0;
  const seq = () => { r += 0.31; return r % 1; };
  spawnImpact(s, 400, 100, 1, false, seq);
  spawnImpact(s, 400, 100, 1, false, seq);
  if (s.attackVfx[0].x === s.attackVfx[1].x) failures.push('two impacts landed on the same x');
}

console.log('stack 20px apart going up · squash 1.8x0.2 -> 1.0x1.0 · two bounces · fade at killtimer 35');
console.log(`impacts: Kris ${IMPACT[0].sprite}, Susie ${IMPACT[1].sprite} (+shake), Ralsei ${IMPACT[2].sprite}`);
console.log('a critical starts at 2.5 and keeps growing 0.1 a frame');
console.log('damage TAKEN is white (doomtype -1), red on death; damage DEALT is tinted per character');
console.log('targeting: Kris is never the default; the ShadowMantle wearer takes 2 hits in 3; ac 13 exempt');

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  damage numbers and impacts (no oracle — see header)');
