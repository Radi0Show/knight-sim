// MAGIC and ACT — the two lists the button row opens besides the bag.
//
// `global.spell[char][i]` from `scr_gamestart`, indexed by CHARACTER ID:
//
//     spell[1][0] = 7     Kris:   ACT
//     spell[2][0] = 4     Susie:  Rude Buster
//     spell[2][1] = 11            UltraHeal
//     spell[3][0] = 3     Ralsei: Pacify
//     spell[3][1] = 2             Heal Prayer
//
// **KRIS'S "MAGIC" IS ACT.** His only entry is spell 7, whose name is literally
// `"ACT"` and whose `spelltarget` is 0. That is why his button row reads ACT
// where Susie's and Ralsei's read MAGIC — it is one menu slot holding different
// contents, not two different buttons.
//
// Costs are RAW TP out of `global.maxtension = 250`, not percentages, and they
// come out to the familiar numbers: Rude Buster 125/250 = 50%, Heal Prayer
// 80/250 = 32%, Pacify 40/250 = 16%, UltraHeal 225/250 = 90%.
//
// `spelltarget`: 0 none, 1 an ALLY, 2 an ENEMY. It is what decides whether
// choosing the spell opens a target picker, and getting it from the dump
// rather than from the spell's obvious meaning matters for Pacify — it targets
// an enemy despite doing no damage.

import { PARTY } from './damage.js';
import { spellDamage, damageKnight } from './knight.js';
import { castRudeBuster } from './rudebuster.js';
import { applyHeal } from './items.js';
import { cue } from './audio.js';

// Where the caster and the Knight stand. Duplicated from sim/actors.js rather
// than imported: actors.js pulls in damage.js which pulls in this, and the
// cycle is not worth untangling for two coordinates.
const PARTY_POS = [{ x: 126, y: 104 }, { x: 80, y: 142 }, { x: 58, y: 190 }];
const KNIGHT_POS = { x: 425, y: 78 };

/** `scr_spellinfo`, the cases this fight can reach. */
export const SPELLS = {
  2: { name: 'Heal Prayer', descb: 'Heal#Ally', cost: 80, target: 1 },
  3: { name: 'Pacify', descb: 'Spare#TIRED foe', cost: 40, target: 2 },
  4: { name: 'Rude Buster', descb: 'Rude#Damage#', cost: 125, target: 2 },
  7: { name: 'ACT', descb: 'Use#action', cost: 0, target: 0 },
  11: { name: 'UltraHeal', descb: 'Best#healing', cost: 225, target: 1 },
};

/** `global.spell[char]`, by PARTY SLOT (slot + 1 is the character id here). */
export const SPELL_LIST = [[7], [4, 11], [3, 2]];

/**
 * `scr_monstersetup`, monstertype 104 — the Knight's ACT list.
 *
 * Kris gets two, Susie and Ralsei one each, and the party ACTs really are
 * named `S-Action` and `R-Action` in the dump. They look like placeholders and
 * they are not: those are the strings the game draws. Renaming them to
 * something that reads better would be inventing content.
 */
export const ACTS = [
  [
    { name: 'Check', descb: 'Useless#analysis' },
    { name: 'HoldBreath', descb: '' },
  ],
  [{ name: 'S-Action', descb: '' }],
  [{ name: 'R-Action', descb: '' }],
];

/**
 * `scr_spellconsumeb`'s TP check. A spell you cannot pay for is still SHOWN —
 * greyed, not hidden — because the list is built from what the character
 * knows, not from what they can afford this second.
 */
export function canAfford(state, spellId) {
  const s = SPELLS[spellId];
  return !!s && state.tension >= s.cost;
}

/**
 * HOLDBREATH, from obj_knight_enemy's Step:
 *
 *     if (acting == 2 && actcon == 0) {
 *         actcon = 1;
 *         holdbreathcount++;
 *         if (holdbreathcount <= 1) "* The SOUL now moves faster."
 *         if (holdbreathcount > 1)  "* Nothing happened."
 *         holdbreathcount = 1;
 *     }
 *
 * and then, at the top of the same Step:
 *
 *     if (holdbreathcount > 0 && i_ex(obj_heart))                 wspeed = 5;
 *     if (holdbreathcount > 0 && i_ex(obj_knight_roaring2) ...)    wspeed = 6;
 *
 * **IT ONLY WORKS ONCE.** The counter is incremented and then hard-assigned
 * back to 1, so the second use prints "Nothing happened" and changes nothing.
 * A naive `holdbreathcount++` would let it stack forever.
 *
 * The payoff is soul speed 4 -> 5, and 6 while Roaring is on screen — the
 * fight's one permanent buff, and the reason the ACT is worth a turn.
 */
export function holdBreath(state) {
  const first = (state.knight.holdbreathcount ?? 0) < 1;
  state.knight.holdbreathcount = 1;
  return first
    ? '* Kris held their breath. The SOUL now moves faster.'
    : '* Kris held their breath... Nothing happened.';
}

/** The soul's `wspeed`, which HoldBreath is the only thing that changes. */
export function soulSpeed(state) {
  if (!state.knight?.holdbreathcount) return 4;
  return state.roaringActive ? 6 : 5;
}

/**
 * Cast. Returns a line for the HUD, or null if it could not be paid for.
 *
 * `scr_spellconsumeb` spends the TP FIRST and the effect runs after, so a
 * spell that turns out to do nothing still costs — Pacify against an enemy
 * that cannot be spared is a wasted 40, and this fight's Knight is exactly
 * that enemy.
 */
export function castSpell(state, slot, spellId, target = 0) {
  const s = SPELLS[spellId];
  if (!s || state.tension < s.cost) return null;
  state.tension -= s.cost;

  if (spellId === 4) {
    // RUDE BUSTER DOES NOT RESOLVE HERE. It is a timing minigame: the
    // animation plays, a bolt flies, and pressing Z just before it lands adds
    // up to +30 before the Knight's halving. Subtracting the damage on cast —
    // which is what this did — threw the whole mechanic away and made the
    // spell a worse Rude Buster than the game's.
    //
    // See sim/rudebuster.js. `scr_spell` sets `global.spelldelay = 70`, so the
    // turn holds while it resolves.
    castRudeBuster(state, PARTY_POS[slot].x, PARTY_POS[slot].y,
      spellDamage(state, slot), KNIGHT_POS.x, KNIGHT_POS.y);
    return 'Rude Buster!';
  }
  if (spellId === 2) {
    // Heal Prayer heals `magic * 5` — 55 at Ralsei's magic of 11. Through
    // scr_heal, so it lands on the fallen and floors at ceil(maxhp / 6).
    const amount = PARTY[slot].magic * 5;
    const did = applyHeal(state, target, amount);
    return `Heal Prayer: +${did}`;
  }
  if (spellId === 11) {
    // UltraHeal's cost is `225 - round(global.flag[1045] * 2.5)`; flag 1045 is
    // 0 in this fight's state, so it is the flat 225.
    const did = applyHeal(state, target, PARTY[slot].magic * 5 + 100);
    return `UltraHeal: +${did}`;
  }
  if (spellId === 3) {
    // Pacify SPARES a TIRED enemy. The Knight's `mercymax` is 100 and nothing
    // in the fight raises its mercy, so it can never be spared — the TP is
    // spent and nothing happens. Faithful, and worth showing rather than
    // silently refusing the cast.
    return 'Pacify: the Knight is not TIRED';
  }
  return null;
}
