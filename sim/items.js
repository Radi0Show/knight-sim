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
export const ITEMS = {
  2: { name: 'ReviveMint', desc: 'Heal#Downed#Ally', target: 'one', kind: 'revive' },
  7: { name: 'Spincake', desc: 'Heals#team#150HP', target: 'all', kind: 'heal', amount: 150 },
  29: { name: 'TensionMax', desc: 'Raises#TP#Max', target: 'none', kind: 'tension' },
  30: { name: 'ReviveDust', desc: 'Revives#team#25%', target: 'all', kind: 'revive' },
  38: { name: 'ExecBuffet', desc: 'Heals#team#100HP', target: 'all', kind: 'heal', amount: 100 },
  39: { name: 'DeluxeDinner', desc: 'Heals#140HP', target: 'one', kind: 'heal', amount: 140 },
};

/** `#` is GameMaker's line break in a literal. */
export const descLines = (item) => (item?.desc ?? '').split('#');

export const INVENTORY_SIZE = 12;

/** The fight's bag, in the order the specified loadout lists it. */
export function freshInventory() {
  const bag = [7, 38, 2, 2, 2, 2, 2, 2, 30, 29];
  while (bag.length < INVENTORY_SIZE) bag.push(39); // DeluxeDinner fills the rest
  return bag.slice(0, INVENTORY_SIZE);
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
 * UNRESOLVED, and flagged rather than guessed: `scr_itemuse` case 2 computes
 * `reviveamt = ceil(maxhp / 2)` and heals that. Against a SWOONed -999 that is
 * +80 and leaves them at -919, so it cannot be the BATTLE behaviour — the
 * fight is unwinnable if nothing lifts -999. The battle item path mustdiffer
 * and I have not located it. The amounts below follow the handoff spec, which
 * produces the behaviour the fight needs; they are NOT confirmed against the
 * dump.
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

/** Apply an item's effect by id, with no bag bookkeeping. See takeItem. */
export function applyItem(state, id, target = 0) {
  const item = ITEMS[id];
  if (!item) return null;
  let did = 0;
  let what = '';

  if (item.kind === 'heal') {
    did = item.target === 'all'
      ? scrHealitemAll(state, item.amount)
      : scrHealitem(state, target, item.amount);
    what = `healed ${did}`;
  } else if (item.kind === 'revive') {
    const which = item.name === 'ReviveMint' ? 'mint' : 'dust';
    if (item.target === 'all') {
      for (let i = 0; i < 3; i++) did += applyHeal(state, i, reviveAmount(state, i, which));
    } else {
      did = applyHeal(state, target, reviveAmount(state, target, which));
    }
    what = `revived ${did}`;
  } else if (item.kind === 'tension') {
    did = MAX_TENSION - state.tension;
    state.tension = MAX_TENSION;
    what = `TP +${Math.round(did)}`;
  }
  if (did <= 0) return null;
  return `${item.name}: ${what}`;
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

  let did = 0;
  let what = '';

  if (item.kind === 'heal') {
    did = item.target === 'all'
      ? scrHealitemAll(state, item.amount)
      : scrHealitem(state, target, item.amount);
    what = `healed ${did}`;
  } else if (item.kind === 'revive') {
    const which = item.name === 'ReviveMint' ? 'mint' : 'dust';
    if (item.target === 'all') {
      for (let i = 0; i < 3; i++) did += applyHeal(state, i, reviveAmount(state, i, which));
    } else {
      did = applyHeal(state, target, reviveAmount(state, target, which));
    }
    what = `revived ${did}`;
  } else if (item.kind === 'tension') {
    did = MAX_TENSION - state.tension;
    state.tension = MAX_TENSION;
    what = `TP +${Math.round(did)}`;
  }

  if (did <= 0) return null;

  // `scr_itemshift_temp` COMPACTS the list — it copies everything down one
  // and zeroes slot 12 — so there is never a hole, which is what lets the
  // menu's `filled(i)` test be a simple length check.
  list.splice(slot, 1);
  return `${item.name}: ${what}`;
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
    return false;
  });
}
