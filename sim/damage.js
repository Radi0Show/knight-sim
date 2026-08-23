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

import { gmlRound } from './gml.js';
import { heroHurt } from './heroes.js';
import { statsOf } from './equipment.js';
import { spawnDmgNumber, TYPE_PARTY, TYPE_DEAD, TYPE_SWOON} from './dmgnumbers.js';
import { gmlChoose } from './rng.js';
import { scrShakescreen } from './shake.js';

// Where each party member stands, for the damage number to pop off. Measured
// from traces/flurry2.csv, the same figures sim/actors.js uses — imported from
// there would be a cycle (actors imports damage for PARTY stats).
/**
 * `(charinstance.x, charinstance.y + myheight - 24)` — where a writer over a
 * PARTY MEMBER goes, from scr_damage_fixed and scr_damage_maxhp. Exported
 * because the heal writers land at the same anchor (sim/dmgnumbers.js).
 */
export const PARTY_POS = [
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
 *   Susie   ToxicAxe (24)     · RoyalPin (22)     · Jevilstail (7)
 *   Ralsei  FiberScarf (18)   · Dealmaker (21)    · BlueRibbon (26)
 *
 * Weapon and armour ids are separate namespaces, which is why 23 and 7 each
 * appear twice above meaning different things.
 *
 * SUSIE CARRIES THE TOXICAXE, not the Devilsknife. The spec's build paired
 * the Devilsknife with the Jevilstail, and a save cannot hold both — so the
 * default was a loadout no player could actually bring to this fight, which
 * is the same class of error as inventing content. Reported by the project
 * owner. Both weapons are at 6 vs 5, so the swap also costs nothing: what it
 * gives up is the Devilsknife's Rude Buster discount (125 TP instead of 100),
 * which is a real difference in play and now has to be chosen deliberately in
 * the settings menu.
 *
 * The mantle goes on KRIS because the Knight's targeted attacks avoid him by
 * default (see knightTarget) — putting it on him inverts that and makes the
 * one character who can only DOWN, never SWOON, eat two hits in three at a
 * third of the damage.
 */
export const DEFAULT_GEAR = [
  { weapon: 23, armor: [23, 27] },
  { weapon: 24, armor: [22, 7] },
  { weapon: 18, armor: [21, 26] },
];

/**
 * The equipment in play. Falls back to the default build.
 *
 * `loadout.shadowMantle === false` STRIPS armour 23 from every character, so
 * the unmantled numbers can be asked for. That is what the note at the top of
 * this file has always promised and it was NOT true: this read
 * `state.loadout?.gear`, and the loadout object createState builds is
 * `{ shadowMantle: true }` with no `gear` field at all — so it fell through to
 * DEFAULT_GEAR every time and the flag was inert. A dead read facing a live
 * write, the mirror of the balloon-timer bug.
 *
 * This is separate from `state.noMantle`, which suppresses only the TARGET
 * REDIRECT for a recording whose party fights bare; this one changes what is
 * equipped, so it moves DF and the x0.33 reduction as well.
 */
export function gearOf(state) {
  if (state.loadout?.gear) return state.loadout.gear;
  if (state.loadout?.shadowMantle === false) {
    return DEFAULT_GEAR.map((g) => ({
      ...g,
      armor: (g.armor ?? []).filter((a) => a !== 23),
    }));
  }
  return DEFAULT_GEAR;
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
  // `global.chardead[]` IS the state, and HP is only how you get there. A
  // heal that lifts a -999 ally to -899 leaves them DOWN with more HP, and
  // an HP-sign test would call that standing.
  if (state.chardead) return !state.chardead[target];
  return state.partyHp[target] > 0;
}

/**
 * `scr_dead(slot)` — the five globals, all of them:
 *
 *     charmove[i] = 0; charcantarget[i] = 0; chardead[i] = 1;
 *     charaction[i] = 0; charspecial[i] = 0;
 *
 * Restoring HP does NOT undo this (CLAUDE.md has the session it cost): the
 * harness pinned global.hp and the party stayed swooned at full health.
 */
export function scrDead(state, slot) {
  if (state.charmove) state.charmove[slot] = 0;
  if (state.charcantarget) state.charcantarget[slot] = 0;
  if (state.chardead) state.chardead[slot] = 1;
  if (state.charaction) state.charaction[slot] = 0;
  if (state.charspecial) state.charspecial[slot] = 0;
}

/** `scr_revive(slot)` — THREE of the five; charaction/charspecial stay 0. */
export function scrRevive(state, slot) {
  if (state.charmove) state.charmove[slot] = 1;
  if (state.charcantarget) state.charcantarget[slot] = 1;
  if (state.chardead) state.chardead[slot] = 0;
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
  // WHO WEARS IT comes from the gear: the redirect branch tests EITHER slot
  // per character. THE RESET DOES NOT — and an earlier note here claiming
  // "no slot distinction exists" mis-read the parentheses. The original's
  // reset-skip chain is, verbatim in shape:
  //
  //     if ((target == 0 && chararmor1[K] == 23) || chararmor2[K] == 23) {}
  //     else if ((target == 1 && chararmor1[S] == 23) || chararmor2[S] == 23) {}
  //     else if ((target == 2 && chararmor1[R] == 23) || chararmor2[R] == 23) {}
  //     else damagecounter = 0;
  //
  // The SLOT-2 test sits OUTSIDE the target conjunction (ORIGINAL BUG — the
  // intended reading is plainly `target == i && (slot1 || slot2)`), so a
  // mantle worn in ARMOR 2 skips the reset on EVERY hit: the counter passes
  // 3 after two redirects and never comes back — only the first two hits of
  // the whole fight go to the wearer, then pure random forever. Worn in
  // ARMOR 1 it is the documented two-of-three cycle. Both placements are
  // reachable from the equip menu, so both behaviours ship.
  const gear = gearOf(state);
  const wearer = gear.findIndex((g) => (g.armor ?? []).includes(23));
  // state.noMantle: verification-only override (tools/fullfight-trace.mjs,
  // KNIGHT_NO_MANTLE) matching a recording whose party fights bare.
  const mantle = wearer >= 0 && !state.noMantle;
  // `obj_knight_enemy.myattackchoice != 13` — THE SWORD TUNNEL IS EXEMPT
  // from the brunt (CLAUDE.md's own table). No caller was passing the ac,
  // so the gate compared undefined !== 13 and the brunt choose rolled
  // during turn 4 anyway: tension- and hp-invisible under keep-alive, but
  // one extra stream draw per tunnel hit — verify21i's corridor boundary
  // chooses sat exactly that far off from f1322's hit onward.
  const ac = opts.ac ?? state.currentAc;
  if (mantle && ac !== 13) {
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
      // The original's chain, precedence and all.
      const a1 = (i) => (gear[i]?.armor ?? [])[0] === 23;
      const a2 = (i) => (gear[i]?.armor ?? [])[1] === 23;
      const skipReset = ((t === 0 && a1(0)) || a2(0))
        || ((t === 1 && a1(1)) || a2(1))
        || ((t === 2 && a1(2)) || a2(2));
      if (!skipReset) k.damagecounter = 0;
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
  // Scene parity with the universal oracle harness, which replaces
  // obj_collidebullet's Other_15 with a pure hit counter: when a scene
  // declares damage disabled, NONE of scr_damage happens — no HP change, no
  // dmgwriter (and its RNG draw), no obj_shake, no inv. The camera shake made
  // this observable: a disabled-damage recording never shakes, and a sim that
  // still ran the side effects shook the tracking swords' cameray() clamp
  // three suites away from the cause.
  if (state.damageEnabled === false) return 0;
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
    t = gmlRound(t * 0.33);
    mantled = true;
  }
  if (state.charaction?.[target] === ACTION_DEFEND) t = Math.ceil((2 * t) / 3);
  if (!mantled) t = Math.ceil(t * (opts.elementReduction ?? 1));
  if (t < 1) t = 1;

  // Flurry (myattackchoice 2) at difficulty 1 or 3 takes a further third off,
  // inside the HP write itself rather than up with the other multipliers.
  if (opts.flurrySoftened) t = gmlRound(t * 0.66);

  // `if (!instance_exists(obj_shake)) instance_create(0, 0, obj_shake)` —
  // every hit the party TAKES shakes the screen, and the shake is GAMEPLAY:
  // camerax() moves ±4..0 for five frames, and the bullets' offscreen culls
  // compare against camerax(), so the despawn boundary moves with it.
  // Measured at whole-fight f242-247: a second star hit at f242 put the
  // camera at +3 on f246's step, and a star at x -35.27 (past the unshaken
  // -35.20 boundary) survived one more frame than the shake-less sim.
  // scr_damage_all's three inner scr_damage calls pass through here too; the
  // exists-guard (mirrored by obj_shake's own second-instance suicide) keeps
  // it to one shake per burst.
  if (!state.entities.some((s) => s.alive && s.type?.name === 'obj_shake')) {
    scrShakescreen(state);
  }

  hp[target] -= t;
  if (hp[target] <= 0) {
    // KRIS AND THE OTHERS SWOON DIFFERENTLY, and the numbers are the point:
    //
    //     if (target == 0) { doomtype = 4;  hp = round(-maxhp / 2); }   // -80
    //     else             { doomtype = 12; hp = -999; }
    //
    // -80 is inside one heal item's reach, so Kris can be brought back;
    // -999 cannot be (scr_heal only revives if the result reaches >= 0), so
    // a downed ally stays down for the rest of the fight. That asymmetry is
    // the fight's real difficulty curve, and clamping either to 0 erases it.
    hp[target] = target === 0 ? Math.round(-PARTY[0].maxhp / 2) : -999;
    scrDead(state, target);
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
  // KRIS DOWNS, THE OTHERS SWOON — two doomtypes, two graphics. See
  // TYPE_SWOON. This used TYPE_DEAD for anyone felled, which drew DOWN over
  // Susie and Ralsei.
  const doomtype = hp[target] > 0
    ? TYPE_PARTY
    : (target === 0 ? TYPE_DEAD : TYPE_SWOON);
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
  if (state.damageEnabled === false) return 0;
  if (state.invTimer >= 0) return 0;
  // `with (obj_knight_enemy) progamer = false;` — scr_damage's chapter-3
  // block, inside the same `global.inv < 0` gate. Any hit that actually
  // lands ends the hitless run; the flag starts true in the knight's Create
  // and is only ever read by the phase-4 ending line ("Kris coughed...").
  if (state.knight) state.knight.progamer = false;
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
  if (state.damageEnabled === false) return 0;
  if (state.invTimer >= 0) return 0;
  // `with (obj_knight_enemy) progamer = false;` — scr_damage's chapter-3
  // block, inside the same `global.inv < 0` gate. Any hit that actually
  // lands ends the hitless run; the flag starts true in the knight's Create
  // and is only ever read by the phase-4 ending line ("Kris coughed...").
  if (state.knight) state.knight.progamer = false;
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
    // `clamp(tdamage, 1, hp - 1)` — it can take you to 1 and no further, and
    // THE OPERAND ORDER IS THE MECHANIC: GML's clamp is min(max(v, lo), hi),
    // so when the target is ALREADY at 1 the range degenerates to [1, 0] and
    // the HIGH bound wins — tdamage 0, a MISS. This used to be written
    // max(lo, min(v, hi)), which lets the LOW bound win and deals 1: the
    // slash killed a 1-HP character the game explicitly spares. The wiki
    // documents the spare ("displays as MISS"); the dump's clamp confirms it.
    t = Math.min(Math.max(t, 1), hp[target] - 1);
  }
  // `if (!instance_exists(obj_shake)) instance_create(0, 0, obj_shake);`
  // sits HERE in scr_damage_maxhp, right after the cannotFell clamp — this
  // script shakes on its own account, it does not route through scr_damage.
  // The sim's copy had no shake at all, so Flurry's slash (the only caller:
  // 66% of max HP, ignoring DF, clamped so it cannot fell you) hurt you in
  // total silence from the camera's point of view.
  //
  // That is gameplay, not decoration, for the reason scr_damage's own copy
  // documents above: every wall cull compares against camerax(). Missing this
  // is verify37's f6832 -- the shake it should have made at f6829 would have
  // put the camera at +3 by f6832, moving obj_regularbullet's `x < view.x -
  // 80` boundary to -77, which is what culls the Flurry tooth sitting at
  // -78.9147. The sim kept the tooth and the live bullet count diverged.
  if (!state.entities?.some((sh) => sh.alive && sh.type?.name === 'obj_shake')) {
    scrShakescreen(state);
  }

  // NO EARLY RETURN AT ZERO. The original carries on: `hurt = 1`, the
  // dmgwriter (a 0 draws MISS) and the invulnerability all still happen —
  // the slash connects and whiffs visibly, it does not silently not-happen.
  if (t < 0) t = 0;

  hp[target] -= t;
  if (hp[target] <= 0) {
    // THE SAME FELL AS scr_damage, AND IT HAS TO BE. This path had its own
    // half-copy: it set the HP hole but never called scr_dead, and it drew
    // TYPE_DEAD for everyone. Both halves were wrong and they broke in
    // opposite directions.
    //
    //   - NO scr_dead meant `chardead` stayed 0 while HP went negative, and
    //     those are the two SEPARATE gates stepHeroes and isUp read (the pose
    //     follows the HP sign, the menu follows chardead). So the felled
    //     character drew the defeat pose and stayed in the menu, the FIGHT
    //     bar and the target list -- down and still acting.
    //   - TYPE_DEAD for everyone put the DOWN graphic over Susie and Ralsei,
    //     who SWOON. That was fixed in scr_damage and missed here, so
    //     whichever entry point felled you decided which graphic you got.
    //
    // scr_damage_maxhp is Flurry's slash, which passes cannotFell and clamps
    // to hp - 1 -- so this only runs for a caller that does NOT, which is
    // exactly why it went unnoticed.
    hp[target] = target === 0 ? Math.round(-PARTY[0].maxhp / 2) : -999;
    scrDead(state, target);
  }
  heroHurt(state, target);
  spawnDmgNumber(state, PARTY_POS[target].x, PARTY_POS[target].y, t,
    hp[target] > 0 ? TYPE_PARTY : (target === 0 ? TYPE_DEAD : TYPE_SWOON), 2);
  state.invTimer = state.invc * 30;
  return t;
}

