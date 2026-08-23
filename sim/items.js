// ITEMS — the twelve slots you actually take into this fight.
//
// Every effect below is read out of `scr_itemuse`'s switch, at the CHAPTER 3
// values where the item has any (SpinCake heals 80 in chapter 1, 140 in 2, 150
// in 3, 160 in 4 — the chapter matters and the wrong branch is easy to grab).
//
//     id 2   ReviveMint    revive one, to ceil(maxhp / 2)
//     id 7   SpinCake      heal ALL 150
//     id 29  TensionMax    battle-only: fill TP
//     id 30  ReviveDust    revive ALL
//     id 38  ExecBuffet    heal ALL 100
//     id 39  DeluxeDinner  heal ONE 140
//
// TensionMax and ReviveDust are the two whose `scr_itemuse` case is the
// OVERWORLD branch — 29 sets `usable = 0` and prints "try using it in battle",
// and 30 heals a token 10. Their real effects are the battle ones, which is
// what this fight sees.
//
// THE LOADOUT is fixed and is the one specified for this fight: 1 SpinCake and
// 1 ExecBuffet for team healing, 6 ReviveMints, 1 ReviveDust, 1 TensionMax, and
// the remaining slots DeluxeDinners — which can be bought without limit, so
// they are what fills whatever is left of the twelve.

import { PARTY, scrRevive } from './damage.js';
import { MAX_TENSION } from './tension.js';
import { cue, cueStop } from './audio.js';
import { spawnHealWriter } from './dmgnumbers.js';

// NAMES AND DESCRIPTIONS ARE THE DUMP'S, verbatim from `scr_iteminfo`'s
// `itemnameb` / `itemdescb`. Two things they settle that guessing got wrong:
// it is **Spincake**, not "SpinCake", and `#` is GameMaker's newline — the
// descriptions are three short lines, not one long one, which is why they fit
// in the narrow column beside the list.
//
// THE WHOLE BATTLE-USABLE ROSTER, not the six the fight ships with — the
// ITEMS page lets any of them go in any of the twelve slots, so every one
// needs a real effect rather than a name.
//
// `amount` is what `scr_itemuse` actually passes to scr_healitem, which is
// NOT always what the description claims. Two the dump settles outright:
//
//   * **LancerCookie heals 1.** Its description reads "Heals#50HP" and its
//     case is `scr_healitem(global.charselect, 1);` — the rest of the branch
//     is three `scr_itemcomment` lines. Preserved as written, with the
//     description preserved too, because the mismatch is the game's.
//   * **GigaSalad heals 4** for everyone but Noelle, who is not in this
//     fight. "Heals#4HP" is honest; it is a joke item.
//
// `perChar` items pass a different number per member — `global.char[...]` is
// 1 Kris, 2 Susie, 3 Ralsei — and are indexed here by SLOT (0/1/2), which is
// what this project's party arrays use.
//
// Chapter 3 values throughout: Spincake's `healamount` is 150 here (80 in
// ch1, 140 in ch2, 160 in ch4).
export const ITEMS = {
  1: { name: 'Dark Candy', desc: 'Heals#40HP', target: 'one', kind: 'heal', amount: 40 },
  2: { name: 'ReviveMint', desc: 'Heal#Downed#Ally', target: 'one', kind: 'revive' },
  5: { name: 'BrokenCake', desc: 'Heals#20HP', target: 'one', kind: 'heal', amount: 20 },
  6: { name: 'Top Cake', desc: 'Heals#team#160HP', target: 'all', kind: 'heal', amount: 160 },
  7: { name: 'Spincake', desc: 'Heals#team#150HP', target: 'all', kind: 'heal', amount: 150 },
  8: { name: 'Darkburger', desc: 'Heals#70HP', target: 'one', kind: 'heal', amount: 70 },
  // ORIGINAL: the description says 50 and the code says 1. Both kept.
  9: { name: 'LancerCookie', desc: 'Heals#50HP', target: 'one', kind: 'heal', amount: 1 },
  10: { name: 'GigaSalad', desc: 'Heals#4HP', target: 'one', kind: 'heal', amount: 4 },
  11: { name: 'ClubsSandwich', desc: 'Heals#team#70HP', target: 'all', kind: 'heal', amount: 70 },
  12: {
    name: 'HeartsDonut', desc: 'Healing#varies', target: 'one', kind: 'heal',
    perChar: [20, 80, 50],
  },
  13: {
    name: 'ChocDiamond', desc: 'Healing#varies', target: 'one', kind: 'heal',
    perChar: [80, 20, 50],
  },
  14: { name: 'Favwich', desc: 'Heals#ALL HP', target: 'one', kind: 'heal', amount: 500 },
  15: { name: 'RouxlsRoux', desc: 'Heals#50 HP', target: 'one', kind: 'heal', amount: 50 },
  16: { name: 'CD Bagel', desc: 'Heals#80 HP', target: 'one', kind: 'heal', amount: 80 },
  22: { name: 'DD-Burger', desc: 'Heals#60HP 2x', target: 'one', kind: 'heal', amount: 60 },
  23: { name: 'LightCandy', desc: 'Heals#120HP', target: 'one', kind: 'heal', amount: 120 },
  24: { name: 'ButJuice', desc: 'Heals#100HP', target: 'one', kind: 'heal', amount: 100 },
  25: { name: 'SpagettiCode', desc: 'Heals#team#30HP', target: 'all', kind: 'heal', amount: 30 },
  26: {
    name: 'JavaCookie', desc: 'Healing#varies', target: 'one', kind: 'heal',
    perChar: [100, 90, 90],
  },
  // THE THREE TP ITEMS, and they are the INLINE path — see CLAUDE.md. Their
  // amounts are scr_tensionheal's: a flat 80, half the max, and the max.
  27: { name: 'TensionBit', desc: 'Raises#TP#32%', target: 'none', kind: 'tension', tp: 80 },
  28: { name: 'TensionGem', desc: 'Raises#TP#50%', target: 'none', kind: 'tension', tp: 'half' },
  29: { name: 'TensionMax', desc: 'Raises#TP#Max', target: 'none', kind: 'tension', tp: 'max' },
  30: { name: 'ReviveDust', desc: 'Revives#team#25%', target: 'all', kind: 'revive' },
  31: { name: 'ReviveBrite', desc: 'Revives#team#100%', target: 'all', kind: 'revive' },
  // `global.hp[gc] = max(global.hp[gc] - 20, 1)` — it FLOORS at 1, so it can
  // never knock anyone down, which is the only reason it is safe to offer.
  32: { name: 'S.POISON', desc: 'Hurts#party#member', target: 'one', kind: 'hurt', amount: 20 },
  34: { name: 'TVDinner', desc: 'Heals#100HP', target: 'one', kind: 'heal', amount: 100 },
  // `usable = 1` then `scr_healitem(charselect, 100); usable = 0` — the whole
  // effect is inside `if (global.char[charselect] == 1)`, so it heals KRIS
  // for 100 and is genuinely inert for anyone else. The description is right.
  35: { name: 'Pipis', desc: 'Does#nothing', target: 'one', kind: 'heal', perChar: [100, 0, 0] },
  36: { name: 'FlatSoda', desc: 'Heals#20HP', target: 'one', kind: 'heal', amount: 20 },
  37: { name: 'TVSlop', desc: 'Heals#80HP', target: 'one', kind: 'heal', amount: 80 },
  38: { name: 'ExecBuffet', desc: 'Heals#team#100HP', target: 'all', kind: 'heal', amount: 100 },
  39: { name: 'DeluxeDinner', desc: 'Heals#140HP', target: 'one', kind: 'heal', amount: 140 },
};

/** Every id the ITEMS page can put in a slot, in the dump's own order. */
export const ITEM_IDS = Object.keys(ITEMS).map(Number).sort((a, b) => a - b);

/** What this item heals `target` for — `perChar` is indexed by party slot. */
export const healAmountFor = (item, target) => (
  item.perChar ? (item.perChar[target] ?? 0) : (item.amount ?? 0)
);

/** `#` is GameMaker's line break in a literal. */
export const descLines = (item) => (item?.desc ?? '').split('#');

export const INVENTORY_SIZE = 12;

/** The fight's bag, in the order the specified loadout lists it. */
export const DEFAULT_BAG = (() => {
  const bag = [7, 38, 2, 2, 2, 2, 2, 2, 30, 29];
  while (bag.length < INVENTORY_SIZE) bag.push(39); // DeluxeDinner fills the rest
  return bag.slice(0, INVENTORY_SIZE);
})();

/**
 * The fight's bag. `custom` is the ITEMS page's twelve slots when the player
 * has set them; 0 is an empty slot and is DROPPED rather than carried, because
 * `scr_itemshift_temp` compacts the list and everything downstream — the
 * menu's `filled()` test, the cancel restore — assumes no holes.
 */
export function freshInventory(custom = null) {
  if (!custom) return [...DEFAULT_BAG];
  return custom.filter((id) => ITEMS[id]).slice(0, INVENTORY_SIZE);
}

/**
 * `scr_heal(target, amount)` — THE funnel every heal goes through, and it does
 * three things that are easy to get wrong:
 *
 *     if (hp <= 0) belowzero = 1;
 *     if (hp <= maxhp) { hp += amount; if (hp > maxhp) hp = maxhp; }
 *     if (belowzero && hp >= 0) {
 *         if (hp < ceil(maxhp / 6)) hp = ceil(maxhp / 6);
 *         scr_revive(target);
 *     }
 *     snd_stop(snd_power); snd_play(snd_power);
 *
 * 1. **A HEAL LANDS ON A FALLEN ALLY.** It adds to the negative number. From
 *    -999 a 150-point party heal leaves them at -849 — still down, but the
 *    healing was not thrown away. Refusing to heal `hp <= 0`, which is what
 *    this module did, is wrong.
 * 2. **CROSSING ZERO SNAPS UP.** Anyone brought from below zero to >= 0 is
 *    floored at `ceil(maxhp / 6)` — so a revive never leaves you on 1 HP. That
 *    floor appears in no summary of this system; it is only in scr_heal.
 * 3. **THERE IS A SOUND**, `snd_power`, stopped before it is played so repeats
 *    cut each other off. This module dropped that cue earlier on the grounds
 *    that `scr_healitem` plays nothing — true, but it delegates to `scr_heal`,
 *    which does.
 *
 * `healRibbons` — BlueRibbon's Heal+, scr_heal_amount_modify_by_equipment
 * verbatim: each equipped ribbon on the CASTER adds `ceil(amount / 8)`,
 * slot-checked separately so two stack.
 */
export function applyHeal(state, target, amount, healRibbons = 0) {
  const hp = state.partyHp;
  const maxhp = PARTY[target].maxhp;
  const amt = amount + Math.ceil(amount / 8) * healRibbons;
  const before = hp[target];
  const belowZero = hp[target] <= 0;

  if (hp[target] <= maxhp) {
    hp[target] += amt;
    if (hp[target] > maxhp) hp[target] = maxhp;
  }
  if (belowZero && hp[target] >= 0) {
    const floor6 = Math.ceil(maxhp / 6);
    if (hp[target] < floor6) hp[target] = floor6;
    // THE REVIVE IS HERE AND NOWHERE ELSE, and its gate is the reason a
    // swooned ally stays swooned: `belowzero == 1 && global.hp >= 0`. Healing
    // a -999 Susie by 200 leaves her at -799, still negative, so scr_revive
    // never runs — the heal is absorbed by the hole. Kris at -80 clears zero
    // with one item and stands up at ceil(maxhp / 6).
    scrRevive(state, target);
  }

  cueStop(state, 'snd_power');
  cue(state, 'snd_power');
  return hp[target] - before;
}

/**
 * `scr_healitem` — scr_heal plus the floating green number.
 *
 * NO RIBBON BONUS HERE: scr_heal_amount_modify_by_equipment's only callers
 * are the SPELL path's wrappers (scr_healitemspell / scr_healallitemspell,
 * called from scr_spell alone). scr_itemuse heals through plain scr_healitem
 * — items heal their printed amount, ribbons or not.
 */
export function scrHealitem(state, target, amount) {
  const did = applyHeal(state, target, amount, 0);
  // `healtext.healamt = arg1` — the REQUESTED amount, not what landed. A
  // Spincake on a full party reads +150 in the game too.
  spawnHealWriter(state, target, amount);
  return did;
}

/** `scr_healitem_all(amount)` — EVERY member, the fallen included. */
export function scrHealitemAll(state, amount) {
  let total = 0;
  for (let i = 0; i < 3; i++) total += applyHeal(state, i, amount, 0);
  // A separate loop, as in the dump: scr_healall runs first, THEN one writer
  // per character. Interleaving is invisible here but is not what it does.
  for (let i = 0; i < 3; i++) spawnHealWriter(state, i, amount);
  return total;
}

/**
 * REVIVES ARE HEAL AMOUNTS, not HP assignments — which is why heal modifiers
 * apply to them at all.
 *
 * RESOLVED — the battle path is `scr_spell`, not `scr_itemuse`, and it is
 * case 202:
 *
 *     reviveamt = ceil(global.maxhp[...] / 2);
 *     if (global.hp[...] <= 0)
 *         reviveamt = ceil(global.maxhp[...]) + abs(global.hp[...]);
 *     scr_healitemspell(reviveamt);
 *
 * So a revive on someone STANDING is half their max, and on someone DOWN it
 * is their whole bar plus however deep the hole is — 190 + 999 = 1189 for a
 * swooned Susie. That is why the number on screen is enormous: it is the
 * game's own, and scr_healitemspell passes it straight to the writer as
 * `damage`. `scr_itemuse` case 2's ceil(maxhp / 2) is the OVERWORLD path,
 * which is why it cannot lift -999 and never needs to.
 *
 * The amounts below already matched this; the note that used to sit here
 * calling them unconfirmed guesses was out of date.
 */
export function reviveAmount(state, target, which) {
  const hp = state.partyHp[target];
  const maxhp = PARTY[target].maxhp;
  if (which === 'mint') return hp <= 0 ? maxhp - hp : Math.floor(maxhp * 0.5);
  return hp <= 0 ? Math.floor(maxhp * 0.25) - hp : 10;
}

/**
 * Use the item in slot `slot` on `target`, and REMOVE it from the bag.
 *
 * Returns a short description of what happened, or null if the slot was empty
 * or the item could do nothing — a ReviveMint on a living party, say. The
 * caller decides whether a no-op still costs the turn; here it does not consume
 * the item, which is the forgiving reading and the one a practice tool wants.
 */
/**
 * TAKE the item out of the character's snapshot, WITHOUT applying it.
 *
 * The two halves of using an item happen at different times: `tempitem` loses
 * it the moment it is chosen — that is the state cancel restores — but the
 * EFFECT waits for the resolve phase, where obj_attackpress fires it at
 * `maxdelaytimer == spelldelay[c]` alongside the spells.
 *
 * Bundling both into one call let a Revive land during the command phase, so
 * the revived ally could still act that turn. They cannot: by the time the
 * item resolves, the menu is closed.
 *
 * Returns the item id, or null if the slot is empty.
 */
export function takeItem(state, slot, bag = null) {
  const list = bag ?? state.inventory;
  const id = list[slot];
  if (!ITEMS[id]) return null;
  // `scr_itemshift_temp` COMPACTS the list — everything moves down one and
  // slot 12 is zeroed, so there is never a hole.
  list.splice(slot, 1);
  return id;
}

/**
 * ONE implementation of "what does this item do", shared by the deferred
 * battle path and the direct one. They had a copy each, which is how the
 * per-character amounts and the two new kinds could have landed in one and
 * not the other — invisible until a HeartsDonut healed the wrong number
 * through whichever path the menu happened to take.
 *
 * Returns how much it moved; 0 means the item did nothing and the caller
 * refuses the use.
 */
function itemEffect(state, item, target) {
  if (item.kind === 'heal') {
    const amount = healAmountFor(item, target);
    if (item.target === 'all') return scrHealitemAll(state, amount);
    // A zero-amount heal still has to be REFUSED rather than played — Pipis
    // in anyone but Kris's hands sets `usable = 0` in the same breath.
    if (amount <= 0) return 0;
    return scrHealitem(state, target, amount);
  }
  if (item.kind === 'revive') {
    const which = item.name === 'ReviveMint' ? 'mint' : 'dust';
    if (item.target === 'all') {
      let did = 0;
      for (let i = 0; i < 3; i++) did += applyHeal(state, i, reviveAmount(state, i, which));
      return did;
    }
    return applyHeal(state, target, reviveAmount(state, target, which));
  }
  if (item.kind === 'tension') {
    // `scr_tensionheal(80)` / `ceil(maxtension / 2)` / `ceil(maxtension)`,
    // and all three are the INLINE path — they resolve during selection, not
    // on the spell clock, so the next character can spend what they gave.
    const want = item.tp === 'max' ? MAX_TENSION
      : item.tp === 'half' ? Math.ceil(MAX_TENSION / 2)
        : (item.tp ?? 0);
    const before = state.tension;
    state.tension = Math.min(MAX_TENSION, state.tension + want);
    return state.tension - before;
  }
  if (item.kind === 'hurt') {
    // `global.hp[_gc] = max(global.hp[_gc] - 20, 1)` — it FLOORS AT 1, so
    // S.POISON can never knock anyone down however often it is used.
    const hp = state.partyHp;
    const before = hp[target];
    hp[target] = Math.max(before - (item.amount ?? 0), 1);
    return before - hp[target];
  }
  return 0;
}

/** How the result reads in the log — the verb belongs to the kind. */
function itemVerb(item, did) {
  if (item.kind === 'revive') return `revived ${did}`;
  if (item.kind === 'tension') return `TP +${Math.round(did)}`;
  if (item.kind === 'hurt') return `-${did} HP`;
  return `healed ${did}`;
}

/** Apply an item's effect by id, with no bag bookkeeping. See takeItem. */
export function applyItem(state, id, target = 0) {
  const item = ITEMS[id];
  if (!item) return null;
  const did = itemEffect(state, item, target);
  if (did <= 0) return null;
  return `${item.name}: ${itemVerb(item, did)}`;
}

export function useItem(state, slot, target = 0, bag = null) {
  // THE BAG IS THE CHARACTER'S SNAPSHOT, not `global.item`. `tempitem` holds
  // one list per party member; the item leaves that list now and only reaches
  // the real inventory when the turn commits (scr_endturn). Splicing
  // `state.inventory` directly looks identical right up until you press
  // cancel, at which point the item is gone for good.
  const list = bag ?? state.inventory;
  const id = list[slot];
  const item = ITEMS[id];
  if (!item) return null;

  const did = itemEffect(state, item, target);
  if (did <= 0) return null;

  // `scr_itemshift_temp` COMPACTS the list — it copies everything down one
  // and zeroes slot 12 — so there is never a hole, which is what lets the
  // menu's `filled(i)` test be a simple length check.
  list.splice(slot, 1);
  return `${item.name}: ${itemVerb(item, did)}`;
}

/** Slots that would actually do something right now, for the menu to grey out. */
export function usableSlots(state, bag = null) {
  const anyDown = state.partyHp.some((h) => h <= 0);
  const anyHurt = state.partyHp.some((h, i) => h > 0 && h < PARTY[i].maxhp);
  return (bag ?? state.inventory).map((id) => {
    const item = ITEMS[id];
    if (!item) return false;
    if (item.kind === 'revive') return anyDown;
    // A heal is useful on anyone not at full — INCLUDING the fallen, whose
    // negative HP a party heal legitimately raises toward zero.
    if (item.kind === 'heal') return anyHurt || anyDown;
    if (item.kind === 'tension') return state.tension < MAX_TENSION;
    // S.POISON always does something; whether you want it to is your problem.
    if (item.kind === 'hurt') return state.partyHp.some((h) => h > 1);
    return false;
  });
}
