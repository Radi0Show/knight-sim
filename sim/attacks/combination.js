// obj_knight_combinations — the COMBINATION ATTACK, myattackchoice 7, reached
// through obj_dbulletcontroller `type = 105`.
//
// *** NOT IN THE FIGHT. *** ac 7 sits on phase 1's `phaseturn == 9` branch,
// and phase 1's turn 5 has already reassigned `phase` and zeroed `phaseturn`
// by then — the fall-through CLAUDE.md documents. It is the last of the six
// unused attacks.
//
// IT IS NOT ONE ATTACK. It is a turn that runs THREE others back to back,
// each handing to the next as it finishes, with their arenas and their poses
// flowing into one another instead of the board tearing down between them.
//
// THE SHUFFLE IS DEAD CODE, and this is the headline.
//
//     main_list = ds_list_create();
//     ds_list_add(main_list, 2, 3, 4, 5);
//     ds_list_shuffle(main_list);
//     first_attack  = ds_list_find_value(main_list, 0);
//     if (first_attack == 1 && ds_list_find_value(main_list, 1) == 3)
//         ds_list_delete(main_list, 1);
//     second_attack = ds_list_find_value(main_list, 1);
//     ...
//     third_attack  = ds_list_find_value(main_list, 2);
//     first_attack  = obj_knight_enemy.first_attack;      // <-- and then
//     second_attack = obj_knight_enemy.second_attack;     //     ALL THREE ARE
//     third_attack  = obj_knight_enemy.third_attack;      //     OVERWRITTEN
//
// Sixteen lines of shuffling and de-duplicating, and the next three throw
// every result away. The order comes from the Knight's own fields, and
// `obj_knight_enemy`'s Create is the ONLY writer of them in the whole dump:
//
//     combo_power = 1;  first_attack = 4;  second_attack = 2;  third_attack = 3;
//
// So the combination is always SWORDFALL -> ROTATING SLASH -> SWORD TUNNEL
// (revised), every time, and `composition = combo_power = 1` puts it in its
// "short" form. The two de-dupe guards are dead twice over: they test for
// attack 1, which is never in a list built from 2, 3, 4 and 5.
//
// THIS RETIRES A DOCUMENTED BLOCKER. CLAUDE.md carries `ds_list_shuffle` as
// unsolved — 16 draws per element, algorithm not recovered — and lists it as
// what stands between this project and a bit-exact combination. It stands
// between nothing: the one attack that shuffles does not use the result. The
// draws are still consumed (four elements, 64 u32s) and the sim consumes them
// too, so anything downstream on the same stream stays aligned.
//
// THE CHAIN. Each segment is created with a `turn_type` that tells it which
// end of the combination it is, and every participating object ends its turn
// with the same block — see chainNext below.
//
//   segment 1   turn_type "short start", turn_segment 0,
//               next_up = second, next_next_up = third
//   segment 2   promoted to "short mid", turn_segment 1, next_up = third
//   segment 3   promoted to "short end", turn_segment 2
//
// WHAT IS MISSING, stated plainly: segment 3 is
// `obj_knight_tunnel_slasher_2_revised` (attack id 3), which is ac 3's own
// unused attack and is NOT translated — 547 lines with its own bullet type.
// The chain reaches it and stops there. The roster labels this, and ac 3 is
// the next piece of work.

import { spawn, destroy } from '../entity.js';
import { gmlShuffle } from '../rng.js';

/**
 * The combination's attack ids, as the switch in Other_10 maps them — held in
 * a REGISTRY rather than imported, because the dependency genuinely runs both
 * ways: the combination creates the segments, and each segment calls
 * `chainNext` to create the one after it. Importing the attack modules here
 * closed that loop and this table hit the temporal dead zone — "Cannot access
 * 'knightSwordfall' before initialization", the cycle showing up as a crash
 * rather than as a subtly wrong value, which is the good version of that
 * failure.
 *
 * Each attack registers itself at the bottom of its own module instead, so
 * this file imports nothing from them.
 *
 * `type: null` means "the game has this segment and the sim does not yet".
 * 1 (quickslash) is never selected — the Knight's fields are 4, 2 and 3.
 */
export const COMBO_ATTACKS = {
  1: { name: 'obj_roaringknight_quickslash_attack', type: null },
  2: { name: 'obj_knight_rotating_slash', type: null },
  3: { name: 'obj_knight_tunnel_slasher_2_revised', type: null },
  4: { name: 'obj_knight_swordfall', type: null },
  5: { name: 'obj_knight_weird_bottom_manager', type: null },
};

/** Called by each attack module once its own type object exists. */
export function registerComboAttack(id, type) {
  if (COMBO_ATTACKS[id]) COMBO_ATTACKS[id].type = type;
}

/** The Knight's Create, and nothing else in the dump writes these. */
export const COMBO_ORDER = { first: 4, second: 2, third: 3, power: 1 };

/**
 * THE HANDOFF, written once because all four participants write it identically
 * — obj_knight_swordfall's Alarm 3, obj_knight_rotating_slash's Alarm 2,
 * obj_knight_weird_bottom_manager's Alarm 2 and
 * obj_knight_tunnel_slasher_2_revised's Step all carry the same block:
 *
 *     with (new_knight) {
 *         turn_type = "end";
 *         if (other.turn_segment == 0) { turn_type = "short mid";
 *                                        turn_segment = 1;
 *                                        next_up = other.next_next_up; }
 *         if (other.turn_segment == 1) { turn_type = "short end";
 *                                        turn_segment = 2; }
 *         anchor_x = other.anchor_x;  anchor_y = other.anchor_y;
 *         event_user(0);
 *     }
 *
 * Note the promotion is by SEGMENT, not by `next_up`: an attack that does not
 * know it is in a combination (turn_segment -1) hands the next one "end",
 * which is the two-attack form. The three-attack form is what `composition`
 * selects, by starting at segment 0.
 *
 * Returns the new segment, or null when the id has no translation yet.
 */
export function chainNext(state, self) {
  if (self.next_up === -999 || self.next_up === -1 || self.next_up === undefined) {
    return null;
  }
  const entry = COMBO_ATTACKS[self.next_up];
  if (!entry) return null;
  if (!entry.type) {
    // THE CHAIN DEAD-ENDS, and it has to end the TURN as well as itself.
    //
    // Every segment's CleanUp leaves `global.turntimer` alone unless it is the
    // closing one — the successor is expected to do it. With the successor
    // missing, nobody does, and the turn sits at the controller's 999999
    // forever: the drill hung with the second segment alive and no third.
    //
    // So this stands in for the missing attack's CleanUp, and ONLY for that.
    // It is labelled here, on `state.comboUntranslated`, and in the roster
    // entry the player reads ("Combination (2 of 3)"), because a turn that
    // ends because a translation is missing is not the same event as a turn
    // that ends because the Knight finished.
    state.comboUntranslated = entry.name;
    const knight = state.entities.find(
      (k) => k.alive && k.type.name === 'obj_knight_enemy',
    );
    if (knight) knight.image_alpha = 1;
    state.turntimer = -1;
    return null;
  }

  const next = spawn(state, entry.type, { x: self.x, y: self.y });
  next.turn_type = 'end';
  if (self.turn_segment === 0) {
    next.turn_type = 'short mid';
    next.turn_segment = 1;
    next.next_up = self.next_next_up;
  }
  if (self.turn_segment === 1) {
    next.turn_type = 'short end';
    next.turn_segment = 2;
  }
  next.anchor_x = self.anchor_x;
  next.anchor_y = self.anchor_y;
  if (entry.type.init) entry.type.init(next, state);
  state.comboSegments = (state.comboSegments ?? 0) + 1;
  return next;
}

/**
 * The `type = 105` branch and obj_knight_combinations' whole life: it exists
 * for one frame, creates the first segment, and destroys itself.
 */
export function launchCombination(state) {
  const knight = state.entities.find(
    (k) => k.alive && k.type.name === 'obj_knight_enemy',
  );
  if (knight) knight.image_alpha = 0;
  state.turntimer = 999999;
  state.comboSegments = 0;
  state.comboUntranslated = null;

  // THE DEAD SHUFFLE, consumed anyway. `ds_list_shuffle` burns 16 u32 draws
  // per element (CLAUDE.md — measured, algorithm unrecovered), so four
  // elements is 64 draws off the shared stream whatever the result is. The
  // result is discarded three lines later; the draws are not, and anything
  // sharing the stream after this would shift without them.
  gmlShuffle(state.gmlRng, [2, 3, 4, 5]);

  const composition = COMBO_ORDER.power;
  const entry = COMBO_ATTACKS[COMBO_ORDER.first];
  if (!entry?.type) {
    state.comboUntranslated = entry?.name ?? 'unknown';
    return null;
  }
  const first = spawn(state, entry.type, {
    x: knight?.x ?? state.view.x + 425,
    y: knight?.y ?? state.view.y + 78,
  });
  first.turn_type = composition === 1 ? 'short start' : 'start';
  first.turn_segment = composition ? 0 : -1;
  first.next_up = COMBO_ORDER.second;
  first.next_next_up = COMBO_ORDER.third;
  if (entry.type.init) entry.type.init(first, state);
  state.comboSegments = 1;
  return first;
}

/** Kept so the roster and the suites can name the sequence. */
export function comboSequence() {
  return [COMBO_ORDER.first, COMBO_ORDER.second, COMBO_ORDER.third]
    .map((id) => COMBO_ATTACKS[id]?.name ?? `#${id}`);
}

export { destroy };
