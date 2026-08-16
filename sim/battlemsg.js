// THE BATTLE MESSAGE — the flavour line above the button row.
//
// `global.battlemsg[0]`, set at the END of every turn by obj_knight_enemy's
// Step, in the same `mnfight == 2 && turntimer <= 1 && setdownmessage == false`
// block that holds the phase-4 gate:
//
//     turns += 1;
//     global.typer = 6;
//     global.fc = 0;
//     if (phase == 1) { if (phaseturn == 0) battlemsg[0] = "..."; ... }
//
// Every string here is the dump's, character for character, including the `&`
// line breaks and the leading `* `.
//
// ── WHY THE TURN NUMBERS LOOK OFF BY ONE ──────────────────────────────────
//
// The selector (Other_10) uses `phaseturn == 1..5`; this table uses 0..4. That
// is not an inconsistency to correct — the two run at opposite ends of a turn.
// The selector increments `phaseturn` when a turn STARTS; the message block
// runs when a turn ENDS, by which time phase 1's turn 5 has already done
// `phase = 2; phaseturn = 0`.
//
// So `phase 2 turn 0` is the line that plays as the fight CROSSES INTO phase
// 2 — "You felt lightheaded. You saw golden stars..." heralds the new phase
// rather than closing the old one. Read the table as "the message shown on
// arriving at this phase/turn", and the golden/silver/migraine progression
// reads as the escalation it is.

/**
 * `phase -> phaseturn -> message`, exactly as the Step assigns them.
 *
 * Phase 4's entries are keyed by `phase4turn`, which is a different counter —
 * the phase-4 block increments it instead of `phaseturn` (see sim/scenes/
 * fight.js, FIGHT_TABLE[4]).
 */
export const BATTLE_MSG = {
  1: {
    0: '* You felt lightheaded.&* You saw silver stars...',
    1: '* You felt something hovering close behind your head...',
    2: '* Suddenly, the north wind blew fiercely.',
    3: '* Your vision narrows.',
    4: '* Your chest feels tight.',
  },
  2: {
    0: '* You felt lightheaded.&* You saw golden stars...',
    1: '* Suddenly, the north and east winds blew fiercely.',
    2: '* Your vision narrows.&* ... Your head is spinning.',
    3: '* You feel surrounded.',
    4: '* You felt your chest twisting.',
  },
  3: {
    0: '* You felt lightheaded.&* You felt a migraine coming on...',
    1: '* Suddenly, a tempest.',
    2: '* Your vision narrows.&* ... The world revolves around you.',
    3: '* You feel cornered.',
    4: '* Your heartbeat becomes twisted.',
  },
};

/**
 * Phase 4, keyed by `phase4turn` and gated on more than the number.
 *
 *     if (phase == 4 && phase4turn < 3) {
 *         if (phase4turn == 0) "* Your heartbeat becomes twisted."
 *         if (phase4turn == 1 && global.hp[2] > 0) "* Susie grew pale."
 *         if (phase4turn == 1 && global.hp[2] < 1)
 *             "* Susie struggled to give some kind of warning."
 *     }
 *     if (phase == 4 || haveusedroaring == true) {
 *         if (phase4turn == 2) "* The Knight's hands glow a strange color..."
 *         if (phase4turn > 2)  "* The enemy suddenly let down its guard!"
 *         if (phase4turn == 3 && progamer == true)
 *             "* Kris coughed.&* The enemy slowly tilted its head..."
 *     }
 *
 * Note the second block's condition is `phase == 4 || haveusedroaring`, so
 * "let down its guard" keeps showing after ROARING has sent `phase` back to 3.
 * That is the game telling you to hit it — the end cutscene fires on the next
 * hit that lands (sim/knight.js, endCutsceneReached).
 */
export function phase4Msg(phase4turn, susieHp, haveusedroaring, progamer = false) {
  if (phase4turn === 3 && progamer) {
    return '* Kris coughed.&* The enemy slowly tilted its head...';
  }
  if (phase4turn === 2) return "* The Knight's hands glow a strange color...";
  if (phase4turn > 2) return '* The enemy suddenly let down its guard!';
  if (phase4turn === 0) return '* Your heartbeat becomes twisted.';
  if (phase4turn === 1) {
    return susieHp > 0
      ? '* Susie grew pale.'
      : '* Susie struggled to give some kind of warning.';
  }
  return null;
}

/**
 * The DOWN messages, which replace the flavour line entirely.
 *
 *     if (krisdownmessage == false && global.hp[1] < 1) {
 *         krisdown = "* Kris kneeled in silence.&";
 *         downcount++; krisdownmessage = true; battlemsg[0] = krisdown;
 *     }
 *     ... susie, ralsei ...
 *     if (downcount == 2) battlemsg[0] = krisdown + susiedown + ralseidown;
 *
 * Two things a summary would lose:
 *
 * 1. **The `*downmessage` flags make each ONE-SHOT.** A character who falls,
 *    is revived and falls again gets no second line. The flags are never
 *    cleared, so it is once per fight, not once per knockdown.
 *
 * 2. **`downcount == 2` CONCATENATES, but three does not.** With two falling
 *    in the same turn you get both lines joined; with three, the test fails
 *    and `battlemsg[0]` keeps whatever the last individual assignment left —
 *    Ralsei's line alone. That is the original's behaviour, not a mistake to
 *    tidy: an equality where a `>=` was probably meant.
 *
 * Each string ends with `&`, so concatenation produces line breaks.
 *
 * @param seen  mutable {kris,susie,ralsei} booleans — the *downmessage flags
 */
export function downMsg(partyHp, seen) {
  let kris = '';
  let susie = '';
  let ralsei = '';
  let count = 0;
  let msg = null;

  if (!seen.kris && partyHp[0] < 1) {
    kris = '* Kris kneeled in silence.&';
    count++;
    seen.kris = true;
    msg = kris;
  }
  if (!seen.susie && partyHp[1] < 1) {
    susie = '* Susie was hurt and beaten.&';
    count++;
    seen.susie = true;
    msg = susie;
  }
  if (!seen.ralsei && partyHp[2] < 1) {
    ralsei = '* Ralsei became a pile of fluff.&';
    count++;
    seen.ralsei = true;
    msg = ralsei;
  }
  // ORIGINAL BEHAVIOUR: `== 2`, not `>= 2`. Three at once falls through and
  // leaves Ralsei's line alone.
  if (count === 2) msg = kris + susie + ralsei;
  return msg;
}

/** `scr_encountersetup` case 115 — the line the fight opens on. */
export const OPENING_MSG = '* The Roaring Knight appeared.';

/**
 * The message for a turn that has just ended.
 *
 * Returns null when nothing applies, in which case the previous message stays
 * on screen — `global.battlemsg[0]` is not cleared between turns.
 */
export function battleMsgFor(phase, phaseturn, opts = {}) {
  const { phase4turn, partyHp, haveusedroaring, progamer, downSeen } = opts;

  // A knockdown replaces the flavour line — the Step's `else` arm, taken when
  // the phase-4 message block does not apply.
  if (partyHp && downSeen) {
    const down = downMsg(partyHp, downSeen);
    if (down) return down;
  }
  // `if (phase == 4 || haveusedroaring == true)` — the CALLER encodes that
  // condition by passing a `phase4turn` at all, because the second half of it
  // is true while `phase` reads 3. Testing `phase === 4` here instead dropped
  // every message after ROARING sends the fight back to phase 3, which is
  // exactly when the guard-drop line is supposed to be up.
  if (phase4turn !== undefined) {
    return phase4Msg(phase4turn, partyHp?.[1] ?? 1, haveusedroaring, progamer);
  }
  return BATTLE_MSG[phase]?.[phaseturn] ?? null;
}
