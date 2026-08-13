#!/usr/bin/env node
// MAGIC and ACT — the two lists that were on the button row doing nothing.
//
// THE REASON THEY DID NOTHING is worth pinning first: `BUTTONS[1].name` is a
// FUNCTION, because that slot is ACT for Kris and MAGIC for everyone else. The
// menu read it as a plain string, so `chosen === 'ACT'` compared against a
// Function object, was never true, and the button fell through every branch —
// no list, no error sound, no turn advance. Nothing about it looked broken.
//
// The data, from `scr_gamestart` and `scr_monstersetup` monstertype 104:
//
//     spell[1][0] = 7   Kris:   ACT           (so his slot IS the ACT list)
//     spell[2]    = 4, 11       Rude Buster 125, UltraHeal 225
//     spell[3]    = 3, 2        Pacify 40, Heal Prayer 80
//     actname[104][0..1]        Check, HoldBreath
//
// Costs are raw TP out of 250, which is where the familiar percentages come
// from: Rude Buster 125/250 = 50%.

import { createState } from '../sim/index.js';
import { stepMenu, openMenu, createMenu, listRows, BUTTONS } from '../sim/menu.js';
import { SPELLS, SPELL_LIST, ACTS, castSpell, holdBreath, soulSpeed, canAfford } from '../sim/spells.js';
import { freshInventory } from '../sim/items.js';
import { KNIGHT_MAXHP } from '../sim/knight.js';
import { stepRudeBuster, rudeBusterBusy } from '../sim/rudebuster.js';

const failures = [];
const NONE = { left: false, right: false, up: false, down: false, confirm: false, cancel: false };

function fresh(charturn = 1) {
  const st = createState({ seed: 1 });
  st.menu = createMenu();
  st.inventory = freshInventory();
  openMenu(st);
  st.menu.charturn = charturn;
  return st;
}
function tap(st, key) {
  stepMenu(st, { ...NONE, [key]: true });
  stepMenu(st, { ...NONE });
}

// ── The bug itself ───────────────────────────────────────────────────────
// Button 1's name MUST be per-character. If this ever goes back to a plain
// string, ACT and MAGIC silently stop working again.
const n1 = BUTTONS[1].name;
if (typeof n1 !== 'function') {
  failures.push('BUTTONS[1].name is not a function — ACT/MAGIC cannot both work');
} else {
  if (n1(0) !== 'ACT') failures.push(`Kris's button 1 is "${n1(0)}", expected ACT`);
  if (n1(1) !== 'MAGIC') failures.push(`Susie's button 1 is "${n1(1)}", expected MAGIC`);
}

// ── The lists ────────────────────────────────────────────────────────────
if (SPELL_LIST[0].length !== 1 || SPELL_LIST[0][0] !== 7) {
  failures.push('Kris does not have exactly spell 7 (ACT)');
}
for (const [slot, ids] of [[1, [4, 11]], [2, [3, 2]]]) {
  if (SPELL_LIST[slot].join() !== ids.join()) {
    failures.push(`slot ${slot} spells ${SPELL_LIST[slot].join()}, expected ${ids.join()}`);
  }
}
for (const [id, cost] of [[2, 80], [3, 40], [4, 125], [11, 225]]) {
  if (SPELLS[id].cost !== cost) failures.push(`${SPELLS[id].name} costs ${SPELLS[id].cost}, expected ${cost}`);
}
if (ACTS[0][1].name !== 'HoldBreath') failures.push("Kris's ACT 1 is not HoldBreath");

// Pressing button 1 as Kris opens the ACT list; as Susie, the spell list.
let st = fresh(0);
st.menu.selected[0] = 1;
tap(st, 'confirm');
if (st.menu.submenu !== 'act') failures.push(`Kris's button 1 opened ${st.menu.submenu}, expected act`);
if (listRows(st).length !== 2) failures.push(`Kris has ${listRows(st).length} ACTs, expected 2`);

st = fresh(1);
st.menu.selected[1] = 1;
tap(st, 'confirm');
if (st.menu.submenu !== 'magic') failures.push(`Susie's button 1 opened ${st.menu.submenu}, expected magic`);
if (listRows(st).map((r) => r.label).join() !== 'Rude Buster,UltraHeal') {
  failures.push(`Susie's list is ${listRows(st).map((r) => r.label).join()}`);
}

// ── Affordability: SHOWN AND GREYED, not hidden ──────────────────────────
st = fresh(1);
st.tension = 0;
st.menu.submenu = 'magic';
const broke = listRows(st);
if (broke.length !== 2) failures.push('an unaffordable spell was hidden — it should be greyed');
if (broke.some((r) => r.usable)) failures.push('a spell was usable at 0 TP');
st.tension = 125;
if (!canAfford(st, 4)) failures.push('Rude Buster unaffordable at exactly its cost');
if (canAfford(st, 11)) failures.push('UltraHeal affordable at 125 TP');

// Confirming an unaffordable spell must refuse, not cast.
st = fresh(1);
st.tension = 0;
st.menu.submenu = 'magic';
st.menu.gridIndex = 0;
tap(st, 'confirm');
if (st.menu.charturn !== 1) failures.push('an unaffordable spell advanced the turn');
if (st.tension < 0) failures.push('an unaffordable spell spent TP');

// ── Rude Buster is a TIMING MINIGAME, not an instant subtraction ─────────
//
// Casting starts an animation; the damage lands when the bolt does, and a
// press just before impact adds up to +30. This suite used to assert the HP
// dropped on cast, which passed while the whole mechanic was missing.
//
// `/** Run the spell to completion, pressing on the frame `pressAt`. */`
function resolveRude(pressAt) {
  const s = fresh(1);
  s.tension = 250;
  const hp0 = s.knight.hp;
  castSpell(s, 1, 4, 0);
  let f = 0;
  while (rudeBusterBusy(s) && f < 400) {
    const b = s.rude.bolt;
    stepRudeBuster(s, !!b && b.explode === 0 && b.boltTimer + 1 === pressAt);
    f += 1;
  }
  return { dealt: hp0 - s.knight.hp, tp: s.tension, frames: f, state: s };
}

// It must NOT resolve on cast — the animation has to run first.
st = fresh(1);
st.tension = 250;
const hp0 = st.knight.hp;
const line = castSpell(st, 1, 4, 0);
if (st.knight.hp !== hp0) failures.push('Rude Buster dealt damage instantly — the bolt never flew');
if (!rudeBusterBusy(st)) failures.push('casting Rude Buster started nothing');
if (st.tension !== 125) failures.push(`Rude Buster left ${st.tension} TP, expected 125`);
if (!line) failures.push('Rude Buster returned no message');
if (hp0 !== KNIGHT_MAXHP) failures.push('the knight did not start at full HP');

// The bolt lands and deals damage on its own.
const noPress = resolveRude(-1);
if (noPress.dealt <= 0) failures.push('the bolt landed for no damage');
if (rudeBusterBusy(noPress.state)) failures.push('Rude Buster never finished');
// `damage = round(damage / 2)` against the Knight, applied to spellDamage 177.
if (noPress.dealt !== 89) failures.push(`unpressed Rude Buster dealt ${noPress.dealt}, expected 89`);

// Find the frame it lands on, then press exactly there for the full +30.
const landOn = (() => {
  const s = fresh(1);
  s.tension = 250;
  castSpell(s, 1, 4, 0);
  let f = 0;
  let final = 0;
  while (rudeBusterBusy(s) && f < 400) {
    stepRudeBuster(s, false);
    if (s.rude.bolt?.explode === 1 && !final) final = s.rude.bolt.boltTimer;
    f += 1;
  }
  return final;
})();
if (landOn < 4) failures.push(`the bolt lands on frame ${landOn} — before the press window opens at 4`);

// THE BONUS IS HALVED WITH THE BASE, because the Knight's `/ 2` is applied
// AFTER it is added. round((177 + 30) / 2) = 104, not 89 + 30.
const perfect = resolveRude(landOn);
if (perfect.dealt !== 104) failures.push(`a perfect press dealt ${perfect.dealt}, expected 104`);
if (perfect.dealt >= 89 + 30) failures.push('the timing bonus was not halved with the base');

// Earlier presses are worth less, monotonically — that gradient IS the game.
let prev = perfect.dealt;
for (let gap = 1; gap <= 4 && landOn - gap >= 4; gap++) {
  const got = resolveRude(landOn - gap).dealt;
  if (got > prev) failures.push(`pressing ${gap} frames earlier dealt MORE (${got} > ${prev})`);
  if (got < noPress.dealt) failures.push(`a press dealt less than no press at all (${got})`);
  prev = got;
}

// ONE PRESS ONLY. `chosen_bolt == 0` locks it, so mashing cannot stack bonuses.
{
  const s = fresh(1);
  s.tension = 250;
  const before = s.knight.hp;
  castSpell(s, 1, 4, 0);
  let f = 0;
  while (rudeBusterBusy(s) && f < 400) { stepRudeBuster(s, true); f += 1; }
  const mashed = before - s.knight.hp;
  if (mashed > perfect.dealt) failures.push(`mashing dealt ${mashed}, more than a perfect press`);
}

// Heal Prayer heals `magic * 5` = 55 at Ralsei's 11, and reaches the FALLEN.
st = fresh(2);
st.tension = 250;
st.partyHp = [160, -100, 140];
castSpell(st, 2, 2, 1);
if (st.partyHp[1] !== -45) failures.push(`Heal Prayer left the fallen ally at ${st.partyHp[1]}, expected -45`);

// Pacify SPENDS the TP and does nothing — the Knight can never be spared.
st = fresh(2);
st.tension = 250;
const before = st.knight.hp;
castSpell(st, 2, 3, 0);
if (st.tension !== 210) failures.push(`Pacify left ${st.tension} TP, expected 210`);
if (st.knight.hp !== before) failures.push('Pacify damaged the Knight');

// ── HoldBreath works ONCE ────────────────────────────────────────────────
// `holdbreathcount++` then `holdbreathcount = 1` — the counter is clamped, so
// the second use prints "Nothing happened" and changes nothing. A plain
// increment would let the buff stack forever.
st = fresh(0);
if (soulSpeed(st) !== 4) failures.push(`base soul speed is ${soulSpeed(st)}, expected 4`);
const first = holdBreath(st);
if (soulSpeed(st) !== 5) failures.push(`after HoldBreath the soul moves ${soulSpeed(st)}, expected 5`);
if (!first.includes('faster')) failures.push('the first HoldBreath did not report the speed-up');
const second = holdBreath(st);
if (!second.includes('Nothing happened')) failures.push('the second HoldBreath did not refuse');
if (st.knight.holdbreathcount !== 1) failures.push(`holdbreathcount reached ${st.knight.holdbreathcount}, expected 1`);
if (soulSpeed(st) !== 5) failures.push('the second HoldBreath changed the speed');
st.roaringActive = true;
if (soulSpeed(st) !== 6) failures.push(`during Roaring the soul should move 6, got ${soulSpeed(st)}`);

// Choosing it through the menu advances the turn.
st = fresh(0);
st.menu.submenu = 'act';
st.menu.gridIndex = 1;
tap(st, 'confirm');
if (st.menu.charturn !== 1) failures.push('HoldBreath did not advance the turn');
if (soulSpeed(st) !== 5) failures.push('HoldBreath through the menu did not buff the soul');

console.log(`Kris: ${ACTS[0].map((a) => a.name).join(', ')}`);
console.log(`Susie: ${SPELL_LIST[1].map((i) => `${SPELLS[i].name} ${SPELLS[i].cost}TP`).join(', ')}`);
console.log(`Ralsei: ${SPELL_LIST[2].map((i) => `${SPELLS[i].name} ${SPELLS[i].cost}TP`).join(', ')}`);
console.log('HoldBreath: soul 4 -> 5, 6 during Roaring, and works exactly once');
console.log(`Rude Buster: bolt lands frame ${landOn} · no press ${noPress.dealt} · perfect ${perfect.dealt} (bonus halved with the base)`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  MAGIC and ACT (no oracle — see header)');
