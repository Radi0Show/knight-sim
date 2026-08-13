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

import { PARTY } from './damage.js';
import { cue, cueStop } from './audio.js';

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
    damagereduction: DR_BASE,
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
  const at = PARTY[slot].at;
  let damage = Math.round((at * accuracy) / 20 - KNIGHT_DF * 3);
  damage = Math.ceil(damage * state.knight.damagereduction);
  if (slot === 0) {
    const m = krisMult(state, 0);
    damage = m === 0.5 ? Math.round(damage * 0.5) : damage * m;
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
  const { at, magic } = PARTY[slot];
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
export function stepKnightAnim(state) {
  const k = state.knight;
  if (!k) return;
  if (k.whiteflash > 0) k.whiteflash -= 1;
  // `shakex` is not decremented by the knight — scr_enemy_drawidle_generic
  // walks it toward zero, flipping sign each frame, which is what makes it a
  // shake rather than a slide.
  if (k.shakex !== 0) {
    k.shakex = -(k.shakex - Math.sign(k.shakex) * 2);
    if (Math.abs(k.shakex) < 2) k.shakex = 0;
  }
  if (k.hurttimer > 0) {
    k.hurttimer -= 1;
    if (k.hurttimer === 29 && k.stronghurtanim) cue(state, 'snd_knight_hurtb');
    if (k.hurttimer === 15) k.stronghurtanim = false;
    if (k.hurttimer === 0) {
      k.animState = 0;
      k.stronghurtanim = false;
    }
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
  return !!k.haveusedroaring && k.endCutscene === 0 && k.hp <= PHASE4_GATE;
}

/** Fire it. Idempotent — `endcon` is exactly the original's re-entry guard. */
export function startEndCutscene(state) {
  const k = state.knight;
  if (k.endCutscene !== 0) return false;
  k.endCutscene = 1;
  k.endcon = 1;
  k.hurttimer = 999;
  k.stronghurtanim = true;
  k.animState = 3;
  cue(state, 'snd_knight_hurt');
  // `mus_fade(global.batmusic[1], 1)` — the track fades out as the fight ends.
  cueStop(state, 'mus_knight');
  return true;
}
