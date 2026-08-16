#!/usr/bin/env node
// EQUIPMENT — one weapon, two armour slots, and everything that reads them.
//
// The tables in sim/equipment.js are GENERATED from scr_weaponinfo and
// scr_armorinfo rather than retyped, so this suite is not re-checking the
// parse. It checks the things a parse cannot: that the stats actually reach
// the formulas, that the mantle is per-character, and the four places the
// handoff spec disagreed with the dump.

import { createState } from '../sim/index.js';
import {
  WEAPONS, ARMOR, statsOf, grazeFactors, canEquip, itemOf, CHAPTER,
} from '../sim/equipment.js';
import { PARTY, statFor, gearOf, DEFAULT_GEAR, scrDamage, knightTarget } from '../sim/damage.js';
import { spellDamage, fightDamage, createKnight } from '../sim/knight.js';
import { spellCost } from '../sim/spells.js';
import { createHeroes } from '../sim/heroes.js';
import { collidebulletOther15 } from '../sim/bullets/regularbullet.js';

const failures = [];
const st = (gear) => {
  const s = createState({ seed: 1 });
  s.heroes = createHeroes();
  s.partyHp = [160, 190, 140];
  s.knight = createKnight();
  if (gear) s.loadout = { gear };
  return s;
};
const BARE = [{ weapon: 0, armor: [] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }];

// ── The four spec corrections ────────────────────────────────────────────
//
// 1. THE RIBBONS COST TP. The spec sells them as pure graze-area upgrades.
{
  const pink = grazeFactors([{ weapon: 0, armor: [3] }]);
  if (pink.tp >= 1) failures.push(`PinkRibbon graze TP is x${pink.tp}, expected a PENALTY`);
  if (Math.abs(pink.tp - 0.8) > 1e-9) failures.push(`PinkRibbon TP x${pink.tp}, expected 0.8`);
  if (Math.abs(pink.time - 0.8) > 1e-9) failures.push(`PinkRibbon time x${pink.time}, expected 0.8`);
  if (Math.abs(pink.size - 1.2) > 1e-9) failures.push(`PinkRibbon size x${pink.size}, expected 1.2`);

  const twin = grazeFactors([{ weapon: 0, armor: [9] }]);
  if (Math.abs(twin.tp - 0.75) > 1e-9) failures.push(`TwinRibbon TP x${twin.tp}, expected 0.75`);
  if (Math.abs(twin.size - 1.25) > 1e-9) failures.push(`TwinRibbon size x${twin.size}, expected 1.25`);
}
// 2. LodeStone is +5%, not the spec's +10%. TensionBow is the +10% one.
{
  const lode = grazeFactors([{ weapon: 0, armor: [24] }]);
  const bow = grazeFactors([{ weapon: 0, armor: [15] }]);
  if (Math.abs(lode.tp - 1.05) > 1e-9) failures.push(`LodeStone TP x${lode.tp}, expected 1.05`);
  if (Math.abs(bow.tp - 1.1) > 1e-9) failures.push(`TensionBow TP x${bow.tp}, expected 1.1`);
}
// 3. The factors COUNT WEARERS — scr_armorcheck_equipped_party returns a total.
{
  const two = grazeFactors([{ weapon: 0, armor: [15] }, { weapon: 0, armor: [15] }]);
  if (Math.abs(two.tp - 1.2) > 1e-9) failures.push(`two TensionBows give x${two.tp}, expected 1.2`);
  // `if (grazesizefactor > 3) grazesizefactor = 3;`
  const many = grazeFactors(Array.from({ length: 9 }, () => ({ weapon: 0, armor: [9] })));
  if (many.size !== 3) failures.push(`graze size capped at ${many.size}, expected 3`);
}
// 4. BounceBlade is df 1, which the spec guessed at 2.
if (WEAPONS[14].df !== 1) failures.push(`BounceBlade df ${WEAPONS[14].df}, expected 1`);

// ── The ribbon rule is the char flags ────────────────────────────────────
// "Susie refuses ribbons" is armorchar2temp = 0, not a special case.
for (const [id, name] of [[3, 'PinkRibbon'], [4, 'WhiteRibbon'], [9, 'TwinRibbon'], [26, 'BlueRibbon']]) {
  if (canEquip('armor', id, 1)) failures.push(`Susie can equip ${name} — char2 should be 0`);
  if (!canEquip('armor', id, 0)) failures.push(`Kris cannot equip ${name}`);
}
// And the mantle is open to all three (only Noelle is excluded).
for (let c = 0; c < 3; c++) {
  if (!canEquip('armor', 23, c)) failures.push(`slot ${c} cannot wear the mantle`);
}
// Weapons are per-character: Saber10 is Kris's, ToxicAxe is Susie's.
if (!canEquip('weapon', 23, 0) || canEquip('weapon', 23, 1)) failures.push('Saber10 is not Kris-only');
if (!canEquip('weapon', 24, 1) || canEquip('weapon', 24, 0)) failures.push('ToxicAxe is not Susie-only');

// ── The mantle's DF is the CHAPTER ───────────────────────────────────────
if (itemOf('armor', 23).df !== CHAPTER) failures.push('the mantle df is not the chapter number');
if (CHAPTER !== 3) failures.push('this fight is chapter 3');

// ── Stats reach the formulas ─────────────────────────────────────────────
{
  const bare = st(BARE);
  const geared = st();  // DEFAULT_GEAR
  if (statFor(bare, 1).at !== PARTY[1].at) failures.push('bare AT is not the base AT');
  if (statFor(geared, 1).at <= statFor(bare, 1).at) failures.push('gear did not raise AT');
  // FIGHT and spell damage must both move with it, or the layer is cosmetic.
  if (fightDamage(geared, 1, 150) <= fightDamage(bare, 1, 150)) {
    failures.push('gear did not raise FIGHT damage');
  }
  if (spellDamage(geared, 1) <= spellDamage(bare, 1)) {
    failures.push('gear did not raise Rude Buster');
  }
  // Devilsknife's whole reason to exist — tested on a loadout that HOLDS
  // one, not through the default build. Susie's default is the ToxicAxe now
  // (a save cannot carry the Devilsknife and the Jevilstail together), so
  // routing this through DEFAULT_GEAR would have quietly stopped testing the
  // discount the moment the default changed.
  const knife = st([{ weapon: 0, armor: [] }, { weapon: 7, armor: [] }, { weapon: 0, armor: [] }]);
  if (spellCost(knife, 1, 4) !== 100) failures.push('Devilsknife did not cut Rude Buster to 100');
  if (spellCost(geared, 1, 4) !== 125) failures.push('the ToxicAxe default should pay full price');
  if (spellCost(bare, 1, 4) !== 125) failures.push('the bare Rude Buster cost is not 125');
  // Heal Prayer's other spells keep their flat cost.
  if (spellCost(geared, 2, 2) !== 80) failures.push('Heal Prayer cost moved');
}

// ── THE MANTLE IS PER-CHARACTER ──────────────────────────────────────────
// `scr_damage` tests chararmor1/2 against 23 per target. Treating it as a
// party-wide switch gave all three the x0.33 and made the party unkillable.
{
  const g = [{ weapon: 0, armor: [23] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }];
  const s = st(g);
  const onKris = scrDamage(s, 200, 0);
  const s2 = st(g);
  const onSusie = scrDamage(s2, 200, 1);
  if (onKris >= onSusie) {
    failures.push(`the mantled character took ${onKris} and the bare one ${onSusie}`);
  }
  // Roughly a third, before DF.
  if (onKris > onSusie * 0.6) failures.push('the x0.33 resist looks too weak');
}

// ── Targeting still comes from the gear ──────────────────────────────────
{
  // No mantle: Kris is never the default target.
  const s = st(BARE);
  const hits = [0, 0, 0];
  for (let i = 0; i < 30; i++) hits[knightTarget(s, 0, { choose: (...x) => x[i % x.length] })] += 1;
  if (hits[0] !== 0) failures.push(`unmantled Kris took ${hits[0]} hits aimed at him`);

  // Mantle on Kris: two in three.
  const m = st([{ weapon: 0, armor: [23] }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }]);
  const mh = [0, 0, 0];
  for (let i = 0; i < 30; i++) mh[knightTarget(m, 1, { choose: (...x) => x[i % x.length] })] += 1;
  if (mh[0] !== 20) failures.push(`the mantled Kris took ${mh[0]}/30, expected 20`);

  // Mantle on SUSIE pulls fire onto her instead — the taunt follows the item.
  const sm = st([{ weapon: 0, armor: [] }, { weapon: 0, armor: [23] }, { weapon: 0, armor: [] }]);
  const sh = [0, 0, 0];
  for (let i = 0; i < 30; i++) sh[knightTarget(sm, 1, { choose: (...x) => x[i % x.length] })] += 1;
  if (sh[1] < 15) failures.push(`the mantle on Susie pulled only ${sh[1]}/30 onto her`);
}

// ── BlueRibbon's real math: + ceil(amount/8) PER ribbon, spells only ─────
// scr_heal_amount_modify_by_equipment's only callers are the SPELL path's
// wrappers (scr_healitemspell/scr_healallitemspell, from scr_spell). Items
// heal their printed amount. Asserted at 100, where the flattened x1.125
// this replaces disagrees with the ceil (112 vs 113).
{
  const one = statsOf(PARTY[2], { weapon: 0, armor: [26] });
  const two = statsOf(PARTY[2], { weapon: 0, armor: [26, 26] });
  if (one.healRibbons !== 1) failures.push(`one ribbon counts ${one.healRibbons}`);
  if (two.healRibbons !== 2) failures.push('two ribbons do not stack');
  const heal = (amt, r) => amt + Math.ceil(amt / 8) * r;
  if (heal(100, 1) !== 113) failures.push(`ribbon math ${heal(100, 1)}, expected 113`);
  if (heal(100, 2) !== 126) failures.push(`stacked ribbon math ${heal(100, 2)}, expected 126`);
}

// ── The mantle reset chain's SLOT precedence (ORIGINAL BUG, ported) ──────
// `(target == i && chararmor1 == 23) || chararmor2 == 23` — the slot-2 test
// sits outside the target conjunction, so a mantle in ARMOR 2 skips the
// counter reset on every hit: two redirects at the start of the fight and
// never again. ARMOR 1 is the documented two-of-three cycle.
{
  const hitsOnWearer = (armor) => {
    const s = st([{ weapon: 0, armor }, { weapon: 0, armor: [] }, { weapon: 0, armor: [] }]);
    let n = 0;
    for (let i = 0; i < 10; i++) {
      if (knightTarget(s, 1, { choose: () => 1 }) === 0) n += 1;
    }
    return n;
  };
  const slot1 = hitsOnWearer([23]);
  const slot2 = hitsOnWearer([0, 23]);
  if (slot1 !== 7) failures.push(`mantle in slot 1 redirected ${slot1}/10, expected the 2-of-3 cycle (7)`);
  if (slot2 !== 2) failures.push(`mantle in slot 2 redirected ${slot2}/10, expected the first-2 latch`);
}

// ── Bullet contact is SINGLE-TARGET by default ───────────────────────────
// obj_collidebullet Other_15: `if (target != 3) scr_damage()` — one member,
// through the redirect — `else scr_damage_all()`. The sim shipped with the
// default contact hitting the whole party (three bars draining per touch,
// the mantle economy never running), reported from play as Susie and Ralsei
// melting. A default-target bullet must cost exactly ONE member HP; a
// target-3 bullet must cost all standing members.
{
  const mk = () => {
    const s = st();
    s.damageEnabled = true;
    s.invTimer = -1;
    s.invc = 1;
    return s;
  };
  const s1 = mk();
  const before1 = [...s1.partyHp];
  collidebulletOther15({ active: 1, target: 0, damage: 100, destroyonhit: 0, alive: true }, s1);
  const hit1 = [0, 1, 2].filter((c) => s1.partyHp[c] !== before1[c]);
  if (hit1.length !== 1) failures.push(`default bullet contact hit ${hit1.length} members, expected 1`);

  const s3 = mk();
  const before3 = [...s3.partyHp];
  collidebulletOther15({ active: 1, target: 3, damage: 100, destroyonhit: 0, alive: true }, s3);
  const hit3 = [0, 1, 2].filter((c) => s3.partyHp[c] !== before3[c]);
  if (hit3.length !== 3) failures.push(`target-3 bullet contact hit ${hit3.length} members, expected 3`);
}

// ── The default build is the one the spec recommends ─────────────────────
{
  const g = gearOf(st());
  if (g !== DEFAULT_GEAR) failures.push('the default gear is not DEFAULT_GEAR');
  if (!(g[0].armor ?? []).includes(23)) failures.push('the default build does not put the mantle on Kris');
  // THE DEFAULT MUST BE OBTAINABLE. Devilsknife (7) + Jevilstail (armour 7)
  // cannot coexist on a save, so Susie carries the ToxicAxe.
  if (g[1].weapon !== 24) failures.push('Susie is not holding the ToxicAxe by default');
  if (g[1].weapon === 7 && (g[1].armor ?? []).includes(7)) {
    failures.push('the default pairs Devilsknife with Jevilstail — not obtainable together');
  }
  if (!(g[2].armor ?? []).includes(26)) failures.push('Ralsei is not wearing BlueRibbon by default');
}

const s = st();
console.log(`${Object.keys(WEAPONS).length} weapons, ${Object.keys(ARMOR).length} armour — generated from the dump`);
console.log('equipped: ' + [0, 1, 2].map((c) => {
  const q = statFor(s, c);
  return `${PARTY[c].name} AT${q.at} DF${q.df} MAG${q.magic}`;
}).join(' · '));
const hpBase = statFor(s, 2).magic * 5;
console.log(`Rude Buster ${spellDamage(s, 1)} for ${spellCost(s, 1, 4)} TP · Heal Prayer `
  + `${hpBase + Math.ceil(hpBase / 8) * statFor(s, 2).healRibbons}`);
console.log('ribbons COST graze TP (Pink -20%, Twin -25%); LodeStone is +5%, TensionBow +10%');

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  equipment (tables generated from the dump)');
