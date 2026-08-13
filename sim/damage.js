// scr_damage / scr_damage_all / scr_damage_calculation — getting hit.
//
// Until now a hit only reset the invulnerability timer: the HP bars the menu
// draws never moved and the practice tool had no stakes. This is the real
// chain, every constant read out of the dump.
//
// THE PARTY, from `scr_gamestart`'s `global.chapter == 3` block. These are the
// numbers this fight is actually played with, and the previous placeholders
// (90/130/90) were invented — they are not in the game anywhere.
//
//     Kris    maxhp 160   at 14   weapon 16   armor 1 + 10
//     Susie   maxhp 190   at 18   weapon 17   armor 1 + 10
//     Ralsei  maxhp 140   at 12   weapon 18   armor 1 + 10
//
// DEFENCE is `global.battledf[i] = df[char] + itemdf[0] + itemdf[1] + itemdf[2]`
// — base 2 (scr_gamestart sets every character's `df` to 2), plus the weapon's
// df (0 for all three Ch3 weapons) and the two armour slots.
//
//     Amber Card (1)   df 1
//     GlowWrist (10)   df 2
//     ShadowMantle(23) df = global.chapter = 3
//
// THE SHADOWMANTLE IS THE ONE CHOICE THAT MATTERS, and it is a choice: nothing
// in the dump equips armour 23: `scr_gamestart` hands out 1 and 10, and the
// damage code only ever CHECKS for 23. But it checks three times, once per
// party member, in a branch gated on `i_ex(obj_knight_enemy)` — code written
// for this fight and no other — and it cuts damage to a third. Default here is
// mantled, because that is the loadout the fight's own damage path is written
// around; `state.loadout.shadowMantle = false` gives the unmantled numbers.

import { heroHurt } from './heroes.js';
import { statsOf } from './equipment.js';
import { spawnDmgNumber, TYPE_PARTY, TYPE_DEAD } from './dmgnumbers.js';
import { gmlChoose } from './rng.js';

// Where each party member stands, for the damage number to pop off. Measured
// from traces/flurry2.csv, the same figures sim/actors.js uses — imported from
// there would be a cycle (actors imports damage for PARTY stats).
const PARTY_POS = [
  { x: 126, y: 104 },
  { x: 80, y: 142 },
  { x: 58, y: 190 },
];
import { cue } from './audio.js';

/** `global.maxhp[1..3]` and the rest, from scr_gamestart's chapter 3 block. */
export const PARTY = [
  { name: 'KRIS', maxhp: 160, at: 14, magic: 0, df: 2, weaponDf: 0, armorDf: [1, 2] },
  { name: 'SUSIE', maxhp: 190, at: 18, magic: 2, df: 2, weaponDf: 0, armorDf: [1, 2] },
  { name: 'RALSEI', maxhp: 140, at: 12, magic: 11, df: 2, weaponDf: 0, armorDf: [1, 2] },
];

/**
 * THE DEFAULT LOADOUT — the spec's §5.1 "Taunt Kris" build, which is also the
 * one the wiki's own analysis lands on.
 *
 *   Kris    Saber10 (23)      · ShadowMantle (23) · TennaTie (27)
 *   Susie   Devilsknife (7)   · RoyalPin (22)     · Jevilstail (7)
 *   Ralsei  FiberScarf (18)   · Dealmaker (21)    · BlueRibbon (26)
 *
 * Weapon and armour ids are separate namespaces, which is why 23 and 7 each
 * appear twice above meaning different things.
 *
 * The mantle goes on KRIS because the Knight's targeted attacks avoid him by
 * default (see knightTarget) — putting it on him inverts that and makes the
 * one character who can only DOWN, never SWOON, eat two hits in three at a
 * third of the damage.
 */
export const DEFAULT_GEAR = [
  { weapon: 23, armor: [23, 27] },
  { weapon: 7, armor: [22, 7] },
  { weapon: 18, armor: [21, 26] },
];

/** The equipment in play. Falls back to the default build. */
export function gearOf(state) {
  return state.loadout?.gear ?? DEFAULT_GEAR;
}

/**
 * `global.battleat/battledf/battlemag[i]` — base plus everything equipped.
 *
 * Every damage and healing formula reads these rather than the base stats,
 * which is the whole point of the equipment layer: nothing downstream should
 * know whether a number came from the character or their gear.
 */
export function statFor(state, slot) {
  return statsOf(PARTY[slot], gearOf(state)[slot] ?? { weapon: 0, armor: [] });
}

/** ShadowMantle replaces the second armour slot: df 2 -> 3, plus the x0.33. */
const MANTLE_DF = 3;

export function battleDf(target, shadowMantle) {
  // Kept for the suites that call it directly with a boolean. The live path
  // is statFor(), which sums whatever is actually equipped.
  const p = PARTY[target];
  const armor2 = shadowMantle ? MANTLE_DF : p.armorDf[1];
  return p.df + p.weaponDf + p.armorDf[0] + armor2;
}

/**
 * `scr_damage_calculation(damage, target)`.
 *
 * NOT a flat subtraction — it walks ONE STEP PER POINT OF DEFENCE, and how much
 * each step removes depends on how big the damage still is relative to that
 * character's max HP:
 *
 *     > maxhp / 5   ->  -3
 *     > maxhp / 8   ->  -2
 *     otherwise     ->  -1
 *
 * So defence bites hardest on big hits and barely touches chip damage, and it
 * scales with the target's own max HP rather than being absolute. The older
 * flat `ceil(damage - battledf * 3)` is still in the source behind an
 * `oldcalculation` flag that is never set.
 */
export function scrDamageCalculation(damage, target, shadowMantle, state = null) {
  let d = damage;
  // `global.battledf[i]` — the sum of everything equipped when there is a
  // state to read it from, and the legacy two-armour approximation when a
  // suite calls this directly.
  const def = state ? statFor(state, target).df : battleDf(target, shadowMantle);
  const maxhp = PARTY[target].maxhp;
  const a = maxhp / 5;
  const b = maxhp / 8;
  for (let i = 0; i < def; i++) {
    if (d > a) d -= 3;
    else if (d > b) d -= 2;
    else d -= 1;
  }
  return d;
}

/** DEFEND — `global.charaction[target] == 10`. */
export const ACTION_DEFEND = 10;

/** `+40` TP per defender, granted the instant DEFEND is chosen. */
export const TP_DEFEND = 40;

/**
 * UP / DOWN / SWOON, derived from HP rather than stored.
 *
 * `scr_damage`'s death branch is where the distinction comes from and it is
 * specific to this fight (`i_ex(obj_knight_enemy)`): Kris goes to
 * `round(-maxhp / 2)` — DOWN — and Susie and Ralsei go to -999 — SWOON. Every
 * other fight in the game sends everyone to the same half-max floor.
 *
 * That gap is the fight's whole healing economy. An ordinary heal of 70-200
 * can carry Kris from -80 back over zero; nothing short of a revive item can
 * cross 999. Deriving the status keeps it impossible for HP and status to
 * disagree, which a stored field invites.
 */
export const UP = 'UP';
export const DOWN = 'DOWN';
export const SWOON = 'SWOON';

export function statusOf(state, target) {
  const hp = state.partyHp[target];
  if (hp > 0) return UP;
  return hp <= -999 ? SWOON : DOWN;
}

export function partyStatus(state) {
  return [0, 1, 2].map((i) => statusOf(state, i));
}

/** Fallen allies are skipped by the COMMAND phase and by enemy targeting. */
export function isUp(state, target) {
  return state.partyHp[target] > 0;
}

/**
 * WHO ACTUALLY GETS HIT — `scr_damage`'s chapter-3 block, and it is two
 * separate rules stacked.
 *
 *     if (chapter == 3 && i_ex(obj_knight_enemy) && truedamage == 0) {
 *         if (aoedamage == false) {
 *             if (target == 0) {
 *                 if (hp[2] > 0 && hp[3] > 0) target = choose(1, 2);
 *                 else if (hp[2] > 0) target = 1;
 *                 else if (hp[3] > 0) target = 2;
 *             }
 *             if (myattackchoice != 13) { ...ShadowMantle... }
 *         }
 *     }
 *
 * **1. KRIS IS NEVER THE DEFAULT TARGET.** A hit aimed at slot 0 is redirected
 * to Susie or Ralsei, at random when both are up. Kris only takes a hit when
 * both of the others are down — or when the mantle rule below picks him.
 *
 * **2. SOMEONE TAKES THE BRUNT.** If anyone wears the ShadowMantle (armour 23)
 * a counter runs, and **two hits in every three go to the wearer**:
 *
 *     damagecounter++;
 *     if (damagecounter < 3)  target = the mantle wearer
 *     else                    target = choose(0, 1, 2), skipping the fallen,
 *                             and reset the counter if that one is not a wearer
 *
 * That is what makes the mantle a TANK item rather than just a damage cut: it
 * pulls fire onto whoever has it, and combined with its x0.33 reduction the
 * wearer eats two-thirds of the attacks at a third of the damage.
 *
 * **THE SWORD TUNNEL IS EXEMPT** — `myattackchoice != 13`. The corridor picks
 * its own targets and the mantle does not redirect it. Only the redirect to
 * Kris still applies there.
 *
 * `aoedamage` skips both: an attack that hits everyone hits everyone.
 */
export function knightTarget(state, target, opts = {}) {
  if (opts.aoe || opts.truedamage) return target;

  let t = target;
  // 1. The Kris redirect.
  if (t === 0) {
    const susie = state.partyHp[1] > 0;
    const ralsei = state.partyHp[2] > 0;
    if (susie && ralsei) t = opts.choose ? opts.choose(1, 2) : 1;
    else if (susie) t = 1;
    else if (ralsei) t = 2;
  }

  // 2. The ShadowMantle brunt. `myattackchoice != 13` — not the sword tunnel.
  // WHO WEARS IT comes from the gear, not a flag. `scr_damage` tests
  // `chararmor1[i] == 23 || chararmor2[i] == 23` per character — EITHER slot,
  // same behaviour. The handoff spec claims slot 1 and slot 2 differ (a
  // persistent cycle against only the first two hits of the battle); no such
  // distinction exists in the code, and it is modelled as the dump has it.
  const gear = gearOf(state);
  const wearer = gear.findIndex((g) => (g.armor ?? []).includes(23));
  const mantle = wearer >= 0;
  if (mantle && opts.ac !== 13) {
    const k = state.knight;
    k.damagecounter = (k.damagecounter ?? 0) + 1;
    if (k.damagecounter < 3) {
      if (state.partyHp[wearer] > 0) t = wearer;
    } else {
      let pick = opts.choose ? opts.choose(0, 1, 2) : 0;
      // `repeat (2)` walking past the fallen, wrapping at 2 -> 0. Not a
      // filtered random: two nudges, so a party with two down can still land
      // on a corpse and the hit is simply thrown away — faithful, and the
      // reason it is written as a loop rather than a filter.
      for (let i = 0; i < 2; i++) {
        if (state.partyHp[pick] <= 0) pick += 1;
        if (pick > 2) pick = 0;
      }
      t = pick;
      if (t !== wearer) k.damagecounter = 0;
    }
  }
  return t;
}

/**
 * `scr_damage()`, reduced to what this fight reaches.
 *
 * Order matters and is the original's:
 *
 *     tdamage = scr_damage_calculation(damage, target)
 *     if ShadowMantle on target      tdamage = round(tdamage * 0.33)
 *     if charaction[target] == 10    tdamage = ceil(2 * tdamage / 3)   // DEFEND
 *     if NOT mantled                 tdamage = ceil(tdamage * elementReduction)
 *     if (tdamage < 1) tdamage = 1
 *     if Flurry at difficulty 1 or 3 tdamage = round(tdamage * 0.66)
 *     hp -= tdamage
 *
 * The element reduction is skipped entirely when the mantle applied — the
 * original's `if (shadowmantlereduction == false)`, so the two never stack.
 *
 * DEATH is special-cased for this fight: `i_ex(obj_knight_enemy)` sends Kris to
 * `round(-maxhp / 2)` and everyone else to -999, rather than the usual
 * half-max. Down is down either way here; the distinction only matters to
 * revival costs, which are out of scope.
 */
export function scrDamage(state, damage, target, opts = {}) {
  // THE MANTLE IS PER-CHARACTER, not a party switch. `scr_damage` checks
  // `chararmor1[2] == 23 && target == 1` and so on, one test per slot — only
  // the WEARER gets the x0.33 and the +3 DF. Treating it as a global boolean
  // gave the reduction to all three, which is most of why the party used to
  // feel unkillable.
  const mantle = (gearOf(state)[target]?.armor ?? []).includes(23);
  const hp = state.partyHp;
  if (!hp || hp[target] <= 0) return 0;

  let t = scrDamageCalculation(damage, target, mantle, state);

  let mantled = false;
  if (mantle) {
    t = Math.round(t * 0.33);
    mantled = true;
  }
  if (state.charaction?.[target] === ACTION_DEFEND) t = Math.ceil((2 * t) / 3);
  if (!mantled) t = Math.ceil(t * (opts.elementReduction ?? 1));
  if (t < 1) t = 1;

  // Flurry (myattackchoice 2) at difficulty 1 or 3 takes a further third off,
  // inside the HP write itself rather than up with the other multipliers.
  if (opts.flurrySoftened) t = Math.round(t * 0.66);

  hp[target] -= t;
  if (hp[target] <= 0) {
    hp[target] = target === 0 ? Math.round(-PARTY[0].maxhp / 2) : -999;
  }
  // THE FLINCH. `obj_heroparent`'s Step gates every other state behind
  // `hurt == 0`, so a character being hit stops whatever pose or animation
  // they were in and shows `hurtsprite`. Nothing was setting it, so the party
  // took damage with no visible reaction at all — the HP number moved and
  // that was the whole feedback.
  heroHurt(state, target);
  // `dmgwriter.type = doomtype` — **-1** for an ordinary hit, so the number is
  // WHITE, and 4 on death, which turns it red and swaps the digits for the
  // DOWN graphic. The per-character tints belong to damage you DEAL.
  const doomtype = hp[target] <= 0 ? TYPE_DEAD : TYPE_PARTY;
  spawnDmgNumber(state, PARTY_POS[target].x, PARTY_POS[target].y, t, doomtype, 2);
  return t;
}

/**
 * `scr_damage()` called directly — one target, its own inv gate.
 *
 * A bullet with `target != 3` hits ONE party member (target 0 unless something
 * says otherwise) rather than the whole party. obj_roaringknight_slash is the
 * one that matters: 206 damage to a single character, or 75 to everyone when
 * `aoe` is set.
 */
export function scrDamageSingle(state, damage, target, opts = {}) {
  if (state.invTimer >= 0) return 0;
  // WHO GETS HIT is decided here, not by the bullet. `scr_damage`'s chapter-3
  // block redirects away from Kris and pulls two hits in three onto the
  // ShadowMantle wearer — see knightTarget. Bullets that pass `target` were
  // choosing the victim themselves, which meant Kris took hits he never takes
  // in the real fight and nobody ever took the brunt.
  // `choose(...)` — one RNG draw, `args[u32 % argc]`, as sim/rng.js models it.
  const t = knightTarget(state, target, {
    ...opts,
    choose: (...xs) => (state.gmlRng ? gmlChoose(state.gmlRng, xs) : xs[0]),
  });
  const dealt = scrDamage(state, damage, t, opts);
  state.invTimer = state.invc * 30;
  if (dealt > 0) cue(state, 'snd_damage');
  return dealt;
}

/**
 * `scr_damage_all()` — the knight's attacks hit the WHOLE PARTY.
 *
 * It loops targets 0..2 and applies scr_damage to each living one, then sets
 * the shared invulnerability. `global.inv` is forced to -1 before each call so
 * the per-character gate inside scr_damage cannot swallow the second and third.
 */
export function scrDamageAll(state, damage, opts = {}) {
  if (state.invTimer >= 0) return 0;
  let total = 0;
  for (let ti = 0; ti < 3; ti++) {
    if (state.partyHp[ti] > 0) total += scrDamage(state, damage, ti, opts);
  }
  state.invTimer = state.invc * 30;
  // `damagenoise = 1` — one snd_damage for the whole party, not one each.
  if (total > 0) cue(state, 'snd_damage');
  return total;
}

/** Full party, used at the top of a run and by the scene's reset. */
export function freshParty() {
  return PARTY.map((p) => p.maxhp);
}

/** Every party member down — the fight is lost. */
export function partyWiped(state) {
  return state.partyHp.every((h) => h <= 0);
}

/**
 * `scr_damage_maxhp(fraction, ignoreDefend, cannotFell)` — THE SECOND DAMAGE
 * ENTRY POINT, and this build did not have it at all.
 *
 * Flurry's slash calls `scr_damage_maxhp(0.66, false, true)`. It is not a
 * damage number run through the defence walk; it is a FRACTION OF MAX HP, and
 * almost every rule is different:
 *
 *     tdamage = ceil(global.maxhp[chartarget] * arg0);
 *     if (charaction == 10 && !arg1) tdamage = ceil(tdamage / 1.5);   // DEFEND
 *     if (arg2) tdamage = clamp(tdamage, 1, global.hp[chartarget] - 1);
 *
 *   * **DF DOES NOTHING.** There is no `scr_damage_calculation` on the
 *     single-target path — armour cannot reduce it.
 *   * **IT CANNOT FELL YOU.** `clamp(..., 1, hp - 1)` leaves you on at least
 *     1 HP however big the fraction is. A 66% hit on someone at 40% health
 *     takes them to 1, not below.
 *   * **THE SHADOW MANTLE HALVES THE FRACTION**, not the result:
 *     `arg0 /= 2`, so 0.66 becomes 0.33 before anything else happens.
 *   * **DEFEND is `/1.5`**, applied before the clamp.
 *
 * The same targeting block as `scr_damage` runs first — the Kris redirect and
 * the mantle counter — but gated on `!i_ex(obj_knight_roaring2)`: during
 * Roaring there is no redirect at all.
 */
export function scrDamageMaxhp(state, fraction, ignoreDefend = false, cannotFell = false, opts = {}) {
  if (state.invTimer >= 0) return 0;
  const hp = state.partyHp;

  // Targeting, then the mantle's halving of the FRACTION.
  let target = opts.target ?? 0;
  if (!state.roaringActive) {
    target = knightTarget(state, target, {
      ...opts,
      choose: (...xs) => (state.gmlRng ? gmlChoose(state.gmlRng, xs) : xs[0]),
    });
    if ((gearOf(state)[target]?.armor ?? []).includes(23)) fraction /= 2;
  }

  const maxhp = PARTY[target].maxhp;
  let t = Math.ceil(maxhp * fraction);
  if (state.charaction?.[target] === ACTION_DEFEND && !ignoreDefend) {
    t = Math.ceil(t / 1.5);
  }
  if (cannotFell) {
    // `clamp(tdamage, 1, hp - 1)` — it can take you to 1 and no further.
    t = Math.max(1, Math.min(t, hp[target] - 1));
  }
  if (t <= 0) return 0;

  hp[target] -= t;
  if (hp[target] <= 0) hp[target] = target === 0 ? Math.round(-PARTY[0].maxhp / 2) : -999;
  heroHurt(state, target);
  spawnDmgNumber(state, PARTY_POS[target].x, PARTY_POS[target].y, t,
    hp[target] <= 0 ? TYPE_DEAD : TYPE_PARTY, 2);
  state.invTimer = state.invc * 30;
  return t;
}

