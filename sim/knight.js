// THE KNIGHT'S OWN HP, and what your attacks are worth against it.
//
// From `scr_monstersetup`'s `monstertype == 104` block:
//
//     monstermaxhp 7300    monsterat 40    monsterdf 0
//
// It is displayed as "???" in the real fight. The same block lists its ACTs,
// and index 1 is literally named `HoldBreath`.
//
// EVERYTHING BELOW IS NOW DUMP-CONFIRMED. It previously carried a provenance
// note saying the multipliers came from the handoff spec and had not been
// found in the dump. They have been, in obj_heroparent's Step and
// obj_knight_enemy's, and reading them corrected two things the spec had
// wrong. Both mattered.
//
// ── `damagereduction`, the real "melee multiplier" ────────────────────────
//
//     Create                        damagereduction = 0.04
//     Step, damagereductiontimer==1 damagereduction = 0.2
//     each turn (mnfight == 1.5)    if (dr >= 0.2 && dr < 0.35) dr += 0.01
//     Other_10, phase4turn == 3     damagereduction = 0.4
//
// So the 0.20 -> 0.35 ramp was right, and there are two values outside it: an
// 0.04 opening — the Knight is very nearly immune before the fight proper
// starts — and a 0.4 spike in the endgame.
//
// ── The SWOON scaling is KRIS ONLY ────────────────────────────────────────
//
//     if (object_index == obj_herokris) {
//         if (global.hp[2] < 0 && global.hp[3] < 0)  damage *= 2;
//         else if (global.hp[2] < 0 || global.hp[3] < 0) damage *= 1;
//         else damage = round(damage * 0.5);
//     }
//
// That block is inside a `object_index == obj_herokris` test. Susie and Ralsei
// are NOT halved when the party is healthy and NOT doubled when it is not —
// only Kris is. Applying it party-wide, which is what this module did, roughly
// doubled the party's damage output in the common case and changed the shape
// of the whole fight.
//
// It also reads `< 0`, strictly — a character sitting at exactly 0 does not
// count as down for this. (`global.hp` is indexed by CHARACTER ID: 1 Kris,
// 2 Susie, 3 Ralsei. Slots are a different index, and conflating the two is
// how you end up scaling off Kris's own HP.)
//
// ── Rude Buster's multiplier has no `/ 2` ─────────────────────────────────
//
//     damage = ceil(damage * (obj_knight_enemy.damagereduction + 0.65));
//
// The spec said `(melee + 0.65) / 2`. There is no division. At the fight's
// opening reduction that is x0.85 rather than x0.425 — spells are worth twice
// what this module credited them with, and are the reason TP is worth banking.

import { gmlRound } from './gml.js';
import { gmlRandom } from './rng.js';
import { PARTY, statFor, scrDamage } from './damage.js';
import { cue, cueStop } from './audio.js';
import { scrShakescreen } from './shake.js';

export const KNIGHT_MAXHP = 7300;   // scr_monstersetup, monstertype 104
export const KNIGHT_AT = 40;
export const KNIGHT_DF = 0;

/** obj_knight_enemy Create. Pre-fight: attacks land for almost nothing. */
export const DR_OPENING = 0.04;
/** Set the frame `damagereductiontimer` first ticks, i.e. the fight proper. */
export const DR_BASE = 0.2;
export const DR_PER_TURN = 0.01;
export const DR_CAP = 0.35;
/** Other_10, `phase4turn == 3` — set alongside `phase = 3`. */
export const DR_PHASE4 = 0.4;

/** `knightHP <= 5840` — 1460 taken — opens the endgame. (spec, not dump) */
export const PHASE4_GATE = 5840;

export function createKnight() {
  return {
    hp: KNIGHT_MAXHP,
    // THE OPENING VALUE IS 0.04, not 0.2. `DR_OPENING` was already defined
    // from the Create and then never used — the Knight was built at DR_BASE,
    // so the fight's opening near-immunity simply did not exist and early
    // damage was five times what it should be.
    //
    // `damagereductiontimer++; if (damagereductiontimer == 1)
    //  damagereduction = 0.2;` runs on the Knight's FIRST STEP, so 0.04 only
    // covers the gap between his Create and his first step. Short — but the
    // attack bar can resolve inside it, and the diff reads frame 0.
    damagereduction: DR_OPENING,
    damagereductiontimer: 0,
    blocking: false,
    phase: 1,
    // The hurt/block animation, from obj_knight_enemy's Step and Draw.
    animState: 0,
    hurttimer: 0,
    stronghurtanim: false,
    whiteflash: 0,
    shakex: 0,
    blockanim: 0,
    blocktimer: 0,
    hurtamt: 0,
    holdbreathcount: 0,
    /** Set when the phase-4 Roaring turn runs. Half of the end condition. */
    haveusedroaring: false,
    // `progamer = true` — the knight's Create. Cleared by scr_damage's
    // chapter-3 block on any landed hit; read once, by the phase-4 ending
    // line. True until you get touched.
    progamer: true,
    endCutscene: 0,
    endcon: 0,
  };
}

/**
 * Kris's SWOON scaling, and nobody else's.
 *
 * @param {number} slot  party slot; only slot 0 (Kris) is affected
 */
export function krisMult(state, slot) {
  if (slot !== 0) return 1;
  const susieDown = state.partyHp[1] < 0;
  const ralseiDown = state.partyHp[2] < 0;
  if (susieDown && ralseiDown) return 2;
  if (susieDown || ralseiDown) return 1;
  return 0.5;
}

/**
 * One FIGHT hit.
 *
 *     damage = round(((battleat * points) / 20) - (monsterdf * 3));
 *     damage = ceil(damage * damagereduction);
 *     [Kris only] the SWOON scaling above
 *
 * `points` is the bar's score, 0-150 — and 160 for auto-Susie, which is above
 * the human maximum. There is no floor at 1: a fumbled bar really does nothing.
 *
 * The final `round(damage * 0.5)` for Kris is a ROUND, while the reduction is
 * a CEIL. Mixing them is deliberate in the original and the two disagree on
 * half-integers often enough to matter over a 7300-HP fight.
 */
export function fightDamage(state, slot, accuracy) {
  if (accuracy <= 0) return 0;
  const at = statFor(state, slot).at;
  let damage = gmlRound((at * accuracy) / 20 - KNIGHT_DF * 3);
  damage = Math.ceil(damage * state.knight.damagereduction);
  if (slot === 0) {
    const m = krisMult(state, 0);
    damage = m === 0.5 ? gmlRound(damage * 0.5) : damage * m;
  }
  return Math.max(0, damage);
}

/**
 * `scr_spell` — Rude Buster and the rest.
 *
 *     damage = ceil((battlemag * 5 + battleat * 11) - (monsterdf * 3));
 *     damage = ceil(damage * (damagereduction + 0.65));
 *
 * Note it scales off AT far more than MAGIC (x11 against x5), so Susie's Rude
 * Buster is strong because she hits hard, not because she is a caster. No
 * Kris scaling applies here — that block is in the FIGHT path only.
 */
export function spellDamage(state, slot) {
  const { at, magic } = statFor(state, slot);
  const base = Math.ceil(magic * 5 + at * 11 - KNIGHT_DF * 3);
  return Math.max(0, Math.ceil(base * (state.knight.damagereduction + 0.65)));
}

/**
 * Take damage, and start the HURT ANIMATION — which is not decoration: it is
 * the only feedback the fight gives, since the Knight's HP shows as "???".
 *
 * From `scr_damage_enemy`, the path EVERY ordinary hit takes:
 *
 *     shakex = 9;
 *     state = 3;
 *     hurttimer = 30;
 *     if (chapter == 3 && i_ex(obj_knight_enemy) && arg1 >= 100)
 *         obj_knight_enemy.stronghurtanim = true;
 *
 * **`stronghurtanim` NEEDS DAMAGE >= 100.** That is the whole difference
 * between a big hit and a small one, and it is inverted from how it reads: the
 * Draw's test is
 *
 *     else if ((hurttimer % 2) == 0 || stronghurtanim == false)  draw idle
 *     else                                                       draw ball_transition frame 7
 *
 * so `stronghurtanim == false` takes the first branch ALWAYS and there is no
 * strobe at all. Only a hit of 100 or more makes the Knight flicker between
 * his idle and that one white frame. A chip hit just shakes him.
 *
 * `hurttimer == 15` clears `stronghurtanim`, so the strobe runs for the first
 * half of the 30-frame reaction and the second half is a plain shake settling.
 *
 * THERE IS A SECOND SOUND, one frame in: `hurttimer == 29 && stronghurtanim`
 * plays `snd_knight_hurtb`. Only on big hits, which is why heavy strikes have
 * a delayed thud that chip damage does not.
 *
 * NOT MODELLED, and stated rather than guessed: `scr_damage_enemy` itself
 * plays nothing on an ordinary hit. The strike sound belongs to
 * `obj_basicattack`, which this build does not spawn. No cue is invented here.
 */
export function damageKnight(state, amount) {
  if (amount <= 0) return 0;
  const k = state.knight;
  k.hp = Math.max(0, k.hp - amount);
  k.animState = 3;
  k.hurttimer = 30;
  k.shakex = 9;
  k.hurtamt = amount;
  if (amount >= 100) k.stronghurtanim = true;
  return amount;
}

/**
 * One frame of the Knight's reaction, from the Draw event's tail and the
 * blockanim block in the Step.
 */
/**
 * THE CHARGE-UP TURN'S OWN CLOCK — `obj_knight_enemy`'s Step:
 *
 *     if (chargeupcon == 1) {
 *         chargeuptimer++;
 *         if (chargeuptimer == 1) snd_play(snd_knight_powerup_white);
 *         ...white afterimages...
 *         if (chargeuptimer == 60) global.turntimer = 1;
 *     }
 *
 * Phase 4's middle turn spawns no bullets (ac -1), so the one sound is the
 * whole audible content of "The Knight's hands glow a strange color...".
 *
 * TIMING IS THE WHOLE POINT of this being its own function. The selector
 * sets chargeupcon = 1 and this block ticks timer -> 1 in the SAME knight
 * Step (the block sits below the selector in one event), and the stomp at
 * 60 lands in the STEP phase — the controller's decrement follows it within
 * the frame, so `1 - 1 <= 0` tears the turn down THAT frame. verify21j:
 * launch f10953, teardown f11012, the ROARING menu at f11027. Ticking from
 * the director's endStep (post-decrement) pushed each edge a frame.
 */
export function tickChargeup(state) {
  const k = state.knight;
  if (!k || k.chargeupcon !== 1) return;
  k.chargeuptimer = (k.chargeuptimer ?? 0) + 1;
  if (k.chargeuptimer === 1) cue(state, 'snd_knight_powerup_white');

  // THE WHITE AFTERIMAGE'S DRAW, and it is not cosmetic:
  //
  //     if ((chargeuptimer % 4) == 0 && chargeuptimer > 10) {
  //         fade = instance_create_depth(x, y, depth + 1,
  //                    obj_afterimage_fade_to_white);
  //         ...
  //         fade.direction = random(360);      // ONE u32 draw
  //     }
  //
  // Nothing needs the ghost itself, so only the draw is taken. This block
  // sits at the BOTTOM of obj_knight_enemy's Step, below the attack
  // selector, and chargeupcon is never cleared — so it keeps firing every
  // fourth frame straight through ROARING's launch, AFTER
  // scr_bulletspawner has re-anchored the stream on that very frame.
  //
  // That is what verify37's f11269 was. The roar's Create rolls
  // `rand_angle = irandom(360)` and read 220 where the game read 278 --
  // exactly one u32 draw apart. It looked CONDITIONAL and unattributable
  // because it is: whether `chargeuptimer % 4 == 0` lands on the launch
  // frame depends on when the turn started, so token 37 took the draw and
  // token 21 did not. Padding it unconditionally fixed 37 and broke 21.
  // DEFERRED, because this block sits BELOW the attack selector in the same
  // Step. On a launch frame scr_bulletspawner has already re-anchored the
  // stream by the time this runs, so the draw belongs AFTER the launch --
  // taken here it would be discarded by the reseed.
  // Taken HERE, which is already the game's order: obj_knight_enemy's Step
  // runs the attack selector first and this block afterwards, and in the sim
  // the launching entity steps before the director that calls this. The one
  // nuance left is that the game's controller does not create the attack
  // object until its OWN Step, later in the same frame, so this draw lands
  // BEFORE the attack's Create randoms; sim launchAttack creates them inside
  // the launch, so it lands after. Unobservable in the current data -- the
  // condition is false on both tokens' ROARING launch frames (timer 185 and
  // 190) -- but it is why f11269's missing draw has nowhere to sit.
  // A launch frame already took this draw inside launchAttack, at the point
  // the knight's Step reaches it -- between basedir and the attack's Create.
  if (state.chargeupDrawTaken) {
    state.chargeupDrawTaken = false;
  } else if (k.chargeuptimer % 4 === 0 && k.chargeuptimer > 10 && state.gmlRng) {
    gmlRandom(state.gmlRng, 360);
  }

  if (k.chargeuptimer === 60) state.turntimer = 1;
}

export function stepKnightAnim(state) {
  const k = state.knight;
  if (!k) return;

  // THE OPENING REDUCTION ENDS ON THE FIRST STEP.
  //
  //     damagereductiontimer++;
  //     if (damagereductiontimer == 1) { ... damagereduction = 0.2;
  //                                      global.monstername = ""Knight""; }
  //
  // `damagereductiontimer` was in createKnight and NOTHING EVER INCREMENTED
  // IT — a write-only field of the same family as `state.inv` and the
  // original's `destroy_on_hit`. Setting the Create value to 0.04 without
  // this would have been strictly worse than the bug it fixed: the Knight
  // would sit at near-immunity for the entire fight instead of the one frame
  // it is meant to last.
  //
  // The `== 1` is an equality, not a threshold, so it fires exactly once and
  // the per-turn ramp takes over from there.
  k.damagereductiontimer += 1;
  if (k.damagereductiontimer === 1) {
    k.damagereduction = DR_BASE;
    // The same line renames the enemy from ""???"" to ""Knight"". Also, at
    // `damagereductiontimer >= 750`, the Step renames it again — the fight
    // stops calling him a mystery about 25 seconds in.
    k.named = true;
  }

  if (k.whiteflash > 0) k.whiteflash -= 1;
  // `shakex` is not decremented by the knight — scr_enemy_drawidle_generic
  // walks it toward zero, flipping sign each frame, which is what makes it a
  // shake rather than a slide.

  // `if (state == 3) scr_enemy_hurt();` — and scr_enemy_hurt is
  //
  //     hurttimer -= 1;
  //     if (hurttimer < 0) state = 0;
  //
  // UNGUARDED, and it goes NEGATIVE. This used to be `if (hurttimer > 0)`
  // with the state reset at exactly 0, which is wrong twice: the hurt ended a
  // frame early, and the counter FROZE at 0 instead of running on. The freeze
  // is the visible half -- the ending forces `state = 3` every frame, so in
  // the game hurttimer keeps falling (oracle_end.csv reads -1, -2, -3 ...)
  // and the strobe's `hurttimer % 3` keeps cycling for the whole cutscene,
  // while the sim sat at 0, where `0 % 3 == 0` picks the idle frame forever
  // and the Knight went STATIC exactly when he should be flickering hardest.
  if (k.animState === 3) {
    k.hurttimer -= 1;
    if (k.hurttimer < 0) {
      k.animState = 0;
    } else {
      // THE SHAKE, and it is the ELSE branch — it stops the moment the hurt
      // ends, leaving shakex wherever it got to rather than walking it home.
      //
      //     hurtshake += 1;
      //     if (hurtshake > 1) {
      //         if (shakex > 0) shakex -= 1;
      //         if (shakex < 0) shakex += 1;
      //         shakex = -shakex;
      //         hurtshake = 0;
      //     }
      //
      // EVERY OTHER FRAME, BY ONE. `hurtshake` is the half-rate gate, so 9
      // decays as 9, 9, -8, -8, 7, 7, -6, -6 ... over about eighteen frames.
      // The old model moved it EVERY frame BY TWO (9, -7, 5, -3, 1, 0) — the
      // same alternation and roughly the same envelope, which is why a suite
      // asserting only "it changes sign" passed, but a quarter of the
      // duration and the wrong value on every single frame.
      k.hurtshake = (k.hurtshake ?? 0) + 1;
      if (k.hurtshake > 1) {
        if (k.shakex > 0) k.shakex -= 1;
        if (k.shakex < 0) k.shakex += 1;
        k.shakex = -k.shakex;
        k.hurtshake = 0;
      }
    }
  }
  // Both of these are in the DRAW, inside `state == 3 && hurttimer >= 0`, so
  // they see the value the Step just decremented.
  if (k.animState === 3 && k.hurttimer >= 0) {
    // `&& end_cutscene_version == 0` — the second hurt sound is SUPPRESSED
    // during the ending. The ending's own trigger already plays three pitched
    // copies of snd_knight_hurt as a chord; without this guard the sim added a
    // fourth, unrelated hit sound one frame into the cutscene.
    if (k.hurttimer === 29 && k.stronghurtanim && !k.endCutscene) {
      cue(state, 'snd_knight_hurtb');
    }
    if (k.hurttimer === 15) k.stronghurtanim = false;
  }
  // THE CHARGE-UP TURN'S OWN CLOCK — `obj_knight_enemy`'s Step:
  //
  //     if (chargeupcon == 1) {
  //         chargeuptimer++;
  //         if (chargeuptimer == 1) snd_play(snd_knight_powerup_white);
  //         if ((chargeuptimer % 4) == 0 && chargeuptimer > 10) { ...white
  //             afterimages... }
  //
  // Phase 4's middle turn spawns no bullets at all (ac -1), so this ONE
  // sound is the whole audible content of "The Knight's hands glow a strange
  // color..." — without it the wind-up plays in silence. Found by auditing
  // every snd_play in the live knight objects against the sim's cues.
  // The chargeupcon-1 tick used to live here — stepKnightAnim runs in the
  // director's END step, after turnClock's decrement, so the timer-60
  // `turntimer = 1` stomp landed post-decrement and the teardown slipped a
  // frame. It is now tickChargeup(), run from the STEP phase (turnClock's
  // step) the way the knight's own Step orders it, plus once inline at the
  // arm frame. See practice.js.
  // chargeupcon 2 is ROARING's launch, and it runs a TEN-FRAME WHITE
  // BURN-OUT before he disappears — `(10 - chargeuptimer) / 10` on a
  // fog-white copy, then `chargeupcon = 3; image_alpha = 0`.
  //
  // RETRACTED: this note used to call that fade dead code, reasoning that
  // chargeuptimer was already ~60 from the charge-up turn so the ramp
  // started negative. It is not — obj_knight_roaring2's Create zeroes the
  // timer on the very next line after setting con 2:
  //
  //     obj_knight_enemy.chargeupcon = 2;
  //     obj_knight_enemy.chargeuptimer = 0;
  //
  // Reading the assignment without reading the line under it is the same
  // mistake as reading a dispatch table without the selector. The fade is
  // live, sim/actors.js drives the timer, and the vanish-in-one-frame it
  // was replaced with was reported from play. con 3 is the hidden state,
  // held until the roar's CleanUp restores him (chargeupcon = 0,
  // image_alpha = 1, siner2 = 0).

  // `blockanim == 1` — the Knight BLOCKS, and the bell is its whole audio:
  //
  //     if (blockanim == 1) { snd_stop(snd_bell); snd_play(snd_bell);
  //                           idlesprite = spr_roaringknight_block_ol;
  //                           whiteflash = 2; blockanim = 2; ... }
  //
  // `blockanim = 1` is armed by obj_heroparent when a party attack is blocked
  // (`knightblock == 1`), which this sim does not yet decide — so the arm
  // never fires today and this is the sound waiting at the end of it. Wired
  // here rather than left out so that landing the block mechanic is one
  // assignment, not an audio hunt.
  if (k.blockanim === 1) {
    cueStop(state, 'snd_bell');
    cue(state, 'snd_bell');
    k.blockanim = 2;
    k.blocktimer = 0;
  }

  if (k.blockanim === 2) {
    k.blocktimer += 1;
    if (k.blocktimer >= 15) {
      k.blocktimer = 0;
      k.blockanim = 0;
    }
  }
}

export function advanceTurn(state) {
  const k = state.knight;
  if (k.damagereduction >= DR_BASE && k.damagereduction < DR_CAP) {
    k.damagereduction += DR_PER_TURN;
  }
}

/**
 * `obj_knight_enemy`'s **Other_12** — `event_user(2)`, the ROARING CATCH.
 *
 *     for (ti = 0; ti < 3; ti++) {
 *         global.inv = -1;
 *         damage = 40;
 *         if (ti == 0 && hp[1] > 1 && hp[1] < 41) damage = hp[1] - 1;
 *         if (ti == 1 && hp[2] > 1 && hp[2] < 41) damage = hp[2] - 1;
 *         if (ti == 2 && hp[3] > 1 && hp[3] < 41) damage = hp[3] - 1;
 *         target = ti;
 *         if (hp[char[ti]] > 0) scr_damage();
 *     }
 *
 * A roaring star that touches you during the roar does NOT deal its own 206.
 * It fires this instead: **40 to every living member**, softened by a clamp
 * that drops the damage to `hp - 1` for anyone sitting between 2 and 40 HP.
 *
 * **THE CLAMP DOES NOT COVER 1 HP.** The guard is `hp > 1 && hp < 41`, so a
 * character already on exactly 1 takes the full 40 and dies. It is very nearly
 * non-lethal and not quite — worth stating precisely, because "cannot fell
 * anyone" is the obvious reading of the clamp and it is wrong at the one value
 * where it matters most.
 *
 * `hp - 1` is also passed THROUGH `scr_damage`, so defence reduces it further
 * and the survivor usually lands above 1 rather than on it.
 *
 * Treating the star as an ordinary 206 bullet made the finale the most lethal
 * attack in the fight, when it is close to the least.
 *
 * `global.inv = -1` before each call, so all three land on the same frame
 * rather than the first one granting invulnerability against the other two.
 */
export function knightCatch(state) {
  // THE WHOLE CATCH IS `if (global.inv < 0)` — Other_12's first line wraps
  // everything. A star that clips the soul during invulnerability does
  // nothing at all: verify21j f11343-11344 logs the pairing at inv 7 and 6
  // with no damage and no reset, while the ungated sim caught the party for
  // 120 and flipped the rest of the finale.
  if (state.invTimer >= 0) return 0;
  let total = 0;
  for (let ti = 0; ti < 3; ti++) {
    const hp = state.partyHp[ti];
    if (hp <= 0) continue;
    let dmg = 40;
    if (hp > 1 && hp < 41) dmg = hp - 1;
    state.invTimer = -1;
    total += scrDamage(state, dmg, ti, { truedamage: true });
  }
  state.invTimer = state.invc * 30;
  return total;
}

export function phase4Reached(state) {
  return state.knight.hp <= PHASE4_GATE;
}

/**
 * THE FIGHT'S END CONDITION, from obj_knight_enemy's Draw:
 *
 *     if (haveusedroaring == true && end_cutscene_version == 0
 *         && global.monsterhp[myself] <= (global.monstermaxhp[myself] * 0.8)
 *         && endcon != 1)
 *     {
 *         ...
 *         end_cutscene_version = 1;
 *         endcon = 1;
 *         mus_fade(global.batmusic[1], 1);
 *         inst = instance_create(x, y, obj_shake);   // 30 x 8, speed 2
 *         stronghurtanim = true;
 *         hurttimer = 999;
 *         snd_play_x(snd_knight_hurt, 0.8, 1);
 *         snd_play_x(snd_knight_hurt, 0.8, 0.7);
 *         snd_play_x(snd_knight_hurt, 0.8, 1.3);
 *     }
 *
 * TWO CONDITIONS, both required: **Roaring must have been used** AND the
 * Knight must be at or below 80% HP. Damaging him to 5840 without reaching
 * phase 4 does nothing, and Roaring at full health does nothing. That is why
 * the fight cannot be rushed.
 *
 * 5840 now appears in THREE independent places — the phase-4 gate, the
 * background's `battleprog` reaching 1, and this. It is the fight's one real
 * number.
 *
 * `hurttimer = 999` here is NOT an ordinary hit (those are 30) — it is the
 * permanent strobe of the ending. And the three `snd_knight_hurt` at pitches
 * 1, 0.7 and 1.3 on one frame are a chord, not a mistake.
 *
 * `end_cutscene_version > 0` then makes obj_battlecontroller's Draw, the
 * tension bar's Draw and obj_attackpress's Draw all `exit` on their first
 * line — the ENTIRE battle UI disappears at once.
 */
export function endCutsceneReached(state) {
  const k = state.knight;
  // THE FIGHT ENDS ON A HIT, NOT ON A THRESHOLD. The condition lives in
  // obj_knight_enemy's DRAW, and it is nested:
  //
  //     if (state == 3 && hurttimer >= 0) {
  //         if (haveusedroaring == true && end_cutscene_version == 0
  //             && global.monsterhp[myself] <= (global.monstermaxhp[myself] * 0.8)
  //             && endcon != 1) { ... end_cutscene_version = 1; }
  //     }
  //
  // `state = 3` is assigned by `scr_damage_enemy`, so the outer test means
  // THE KNIGHT IS CURRENTLY BEING HURT. Without it the end fires the instant
  // ROARING's own selector line sets `haveusedroaring = true` — the HP gate
  // is already satisfied by then, since that is what opened phase 4 — and
  // ROARING would be cut off before it ever ran. That is the difference
  // between a finale and a fight that stops at the beginning of one.
  //
  // What really happens: ROARING plays, `phase` falls back to 3, the party
  // gets one more turn, and the fight ends on the next hit that lands. Which
  // is what "The enemy suddenly let down its guard!" is telling you to do.
  if (k.animState !== 3 || !(k.hurttimer >= 0)) return false;
  return !!k.haveusedroaring && k.endCutscene === 0 && k.endcon !== 1
    && k.hp <= PHASE4_GATE;
}

/** Fire it. Idempotent — `endcon` is exactly the original's re-entry guard. */
export function startEndCutscene(state) {
  const k = state.knight;
  if (k.endCutscene !== 0) return false;
  k.endCutscene = 1;
  k.endcon = 1;
  // MINUS ONE, so this frame ENDS at 0. The game sets end_cutscene_version in
  // obj_knight_enemy's DRAW, and the `endtimer++` lives in its STEP -- which
  // has already run by then, so the first increment lands on the FOLLOWING
  // frame. The sim triggers and steps the cutscene in the same frame, so
  // starting at 0 made every later endtimer one high and fired the teardown a
  // frame early: measured against oracle_end.csv, which has endtimer 1 on
  // f12007 where the trigger is f12006.
  k.endtimer = -1;
  k.hurttimer = 999;
  k.stronghurtanim = true;
  k.animState = 3;
  // obj_tensionbar is already on screen and stationary when the ending opens;
  // the teardown 46 frames later is what launches it.
  state.tensionbarFly = { x: 38, hspeed: 0, friction: -0.4, alarm: -1 };
  // The ending hit, exactly as the Draw's trigger block plays it:
  //
  //     inst = instance_create(x, y, obj_shake);
  //     inst.shakex = 30; inst.shakey = 8; inst.shakespeed = 2;
  //     snd_play_x(snd_knight_hurt, 0.8, 1);
  //     snd_play_x(snd_knight_hurt, 0.8, 0.7);
  //     snd_play_x(snd_knight_hurt, 0.8, 1.3);
  //
  // Three copies of the hurt at three pitches — a chord, not an echo — over
  // the biggest shake in the fight.
  scrShakescreen(state, { shakex: 30, shakey: 8, shakespeed: 2 });
  cue(state, 'snd_knight_hurt', 1, 0.8);
  cue(state, 'snd_knight_hurt', 0.7, 0.8);
  cue(state, 'snd_knight_hurt', 1.3, 0.8);
  // `mus_fade(global.batmusic[1], 1)` — the track fades out as the fight ends.
  cueStop(state, 'mus_knight');
  return true;
}

/**
 * The ending's own clock — obj_knight_enemy's Step, `end_cutscene_version
 * == 1`:
 *
 *     endtimer++;
 *     if (endtimer == 32) { scr_fadeout(15); with (obj_fadeout) {
 *         image_blend = c_white; x -= 40; length *= 2; } }
 *     if (endcon == 1 && endtimer > 45) { ...destroy obj_attackpress and
 *         every obj_dmgwriter; tension bar flies off (hspeed -10,
 *         friction -0.4); global.fighting = 0; endcon = 2; }
 *
 * `state.endFade` is the renderer's cue for the WHITE fadeout (0..1 over 15
 * frames — scr_fadeout(15) with `length *= 2`), and `state.tensionbarFly`
 * carries the bar's exit motion. The room's story cutscene (Susie, Undyne,
 * the bird) picks up after this in the game; the tool hands off to its own
 * win screen instead — that seam is the deliberate cut, not a gap.
 */
// `scr_fadeout(15)` -> `fadespeed = 1 / arg0`. f64, NOT f32: `fadespeed` is a
// plain instance variable, and CLAUDE.md's rule is that only BUILT-INS narrow.
// `image_alpha` is the built-in, so the narrowing belongs on the accumulator
// and not on the step. The two models agree for the first two frames and part
// on the third -- f32 fadespeed gives 0.2000000179 where the oracle reads
// 0.2000000030 -- which is what pinned it.
const FADESPEED = 1 / 15;

export function stepEndCutscene(state) {
  const k = state.knight;
  if (!k || k.endCutscene !== 1) return;
  // THE KNIGHT HIMSELF IS HELD STILL. obj_knight_enemy's Draw, above the
  // block that triggers all this:
  //
  //     if (end_cutscene_version == 1) { stronghurtanim = true;
  //                                      state = 3; shakex = 0; }
  //
  // It runs EVERY FRAME of the ending, so the 9-pixel hurt shake that
  // `scr_damage_enemy` gave him on the killing blow is wiped before he is
  // drawn — he takes the hit and then stands rigid while the CAMERA does the
  // shaking. Without this the sim ran both at once, so his sprite jittered
  // against a view that was already jittering: twice the motion the game has,
  // and on the one frame the fight is asking you to look at him.
  // NOT ON THE TRIGGER FRAME. `if (end_cutscene_version == 1) { ... shakex = 0
  // }` sits at the TOP of the Draw, and the block that SETS ecv to 1 is
  // further down it — so on the frame the ending fires, that test is still
  // false and the killing blow's `shakex = 9` survives to be drawn. The sim
  // zeroed it immediately and lost the flinch on the one frame the fight is
  // asking you to look at him. This reads endtimer BEFORE the tick further
  // down, so on the trigger frame it is still the -1 startEndCutscene set and
  // `>= 0` means "every frame after the trigger".
  if ((k.endtimer ?? 0) >= 0) k.shakex = 0;
  k.stronghurtanim = true;
  k.animState = 3;
  // ...AND THEN CLEARED AGAIN on the single frame hurttimer hits 15. The Draw
  // sets stronghurtanim true at the TOP for the whole ending and the
  // `if (hurttimer == 15) stronghurtanim = false;` sits at the BOTTOM, below
  // the strobe, so the flag is false for exactly one frame. oracle_end.csv
  // shows it: 1 everywhere except f12022, where hurttimer is 15.
  if (k.hurttimer === 15) k.stronghurtanim = false;
  // ALARMS RUN BEFORE STEP (CLAUDE.md rule 5), so the alarm the teardown sets
  // below does NOT tick on the frame it is set. Ticking it in the same pass
  // destroyed the tension bar at f12066 where the oracle still has it and
  // loses it at f12067 -- the classic one-frame alarm error this project
  // already has a rule for.
  if (state.tensionbarFly?.alarm > 0) {
    state.tensionbarFly.alarm -= 1;
    if (state.tensionbarFly.alarm === 0) state.tensionbarFly = null;
  }
  k.endtimer = (k.endtimer ?? 0) + 1;
  // THE WHITE FADEOUT, at the game's own rate. This ran at 1/30 -- HALF
  // speed -- and the 0.0001 seed existed only so `if (state.endFade)` would
  // not read a real 0 as absent.
  //
  //     scr_fadeout(15)  ->  __fadeouter.fadespeed = 1 / 15
  //     obj_fadeout Draw ->  image_alpha += fadespeed;   // BEFORE drawing
  //
  // obj_fadeout's Create sets image_alpha = 0, the Step creates it on the
  // endtimer == 32 frame, and its Draw runs later in that SAME frame -- so
  // the first alpha ever drawn is 1/15 and it reaches 1 fifteen frames after
  // creation, at endtimer 46. Deriving it from endtimer instead of
  // accumulating removes the seed hack and cannot drift.
  //
  // The rate is not cosmetic: web/main.js hands off to the post-battle
  // cutscene on `endFade >= 1`, so at 1/30 the whole ending sat on a white
  // screen fifteen frames longer than the game does.
  //
  // ACCUMULATED IN f32 AND NEVER CLAMPED. `image_alpha` is a built-in, so
  // every store narrows (CLAUDE.md's F32_BUILTINS rule) -- the oracle reads
  // 0.0666666701, 0.1333333403, 0.2000000030, which is fround(1/15) summed,
  // not the f64 series. And obj_fadeout's Draw has no ceiling: it keeps
  // adding past 1.0 (the oracle is at 1.0666667223 two frames after full),
  // so clamping the STATE here loses the match. The renderer clamps at draw
  // time instead, which is what GameMaker does with an alpha above 1.
  if (k.endtimer === 32) state.endFade = 0;
  if (k.endtimer >= 32) state.endFade = Math.fround(state.endFade + FADESPEED);
  if (k.endcon === 1 && k.endtimer > 45) {
    k.endcon = 2;
    state.fightBar = null;
    if (state.dmg) state.dmg.list = [];
    // The teardown's `with (obj_tensionbar) { alarm[5] = 15; hspeed = -10;
    // friction = -0.4; }`. Alarm 5 is `instance_destroy()`, so the bar flies
    // left for fifteen frames and then stops existing -- the oracle's tb_x
    // reads -1 (no instance) from f12067, exactly 15 after the teardown at
    // f12052.
    //
    // NOT DRAWN, and that is not a bug: obj_tensionbar's Draw exits on
    // `chapter == 3 && obj_knight_enemy.end_cutscene_version > 0`, so the bar
    // left the screen when the ending began and none of this is visible.
    // Modelled anyway because the oracle now records it, and a measured
    // column that quietly does not match is worse than one labelled invisible.
    state.tensionbarFly.hspeed = -10;
    state.tensionbarFly.alarm = 15;
    state.fighting = 0;
  }
  if (state.tensionbarFly) {
    const f = state.tensionbarFly;
    // x 38 is obj_tensionbar's resting position, measured off oracle_end.csv.
    // It sits still for the first 46 frames of the ending; only the teardown
    // gives it a speed.
    if (!f.hspeed) return;
    // GML friction reduces speed MAGNITUDE, so a negative friction grows it:
    //     hspeed = sign(hspeed) * (|hspeed| - friction)
    // The old line worked out to -10 + 0.4 = -9.6, decelerating, where the
    // oracle reads -10.4 then -10.8 then -11.2. Friction is applied BEFORE
    // the move: f12052 has hspeed -10.4 and x 27.6, i.e. 38 - 10.4.
    // f32 on both, for the same reason: `x` and `hspeed` are built-ins. The
    // oracle reads 27.6000003815 and -10.3999996185 where f64 gives 27.6 and
    // -10.4 exactly.
    f.hspeed = Math.fround(Math.sign(f.hspeed) * (Math.abs(f.hspeed) - f.friction));
    f.x = Math.fround(f.x + f.hspeed);
  }
}
