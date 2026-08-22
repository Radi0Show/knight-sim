// TENSION — TP, and the graze that earns it.
//
// `global.maxtension = 250` (scr_gamestart). TP is not a reward for hitting
// things; in this fight it comes almost entirely from GRAZING — letting a
// bullet pass close without touching you — which is why the tension bar is the
// dodge-only scope's natural scoreboard.
//
// THE GRAZE BOX is `obj_grazebox`, created by obj_heart's Create at
// `(x + 10, y + 10)` — the soul's centre, not its corner — carrying
// `spr_grazemask`: 50x50, origin (25,25), and flagged AxisAlignedRect, so it is
// a plain square and needs no pixel mask.
//
// `obj_grazebox`'s Collision with obj_collidebullet, in full:
//
//     if (!other.active && other.object_index != obj_sword_tunnel_sword) exit;
//     if (global.inv < 0) {
//         if (grazed == 1) {                       // still inside
//             scr_tensionheal((grazepoints / 30) * grazetpfactor);
//             if (global.turntimer >= 10) global.turntimer -= (timepoints / 30) * f;
//         }
//         if (grazed == 0) {                       // just entered
//             grazed = 1;
//             scr_tensionheal(grazepoints * grazetpfactor);
//             if (global.turntimer >= 10) global.turntimer -= timepoints * f;
//         }
//     }
//
// So entering pays the full `grazepoints` ONCE and staying pays a thirtieth of
// it per frame — a second of hugging a bullet is worth the same as entering it
// twice. It also SHORTENS THE TURN by `timepoints`, which is the real reason
// grazing matters: a turn spent grazing ends measurably sooner.
//
// The sword tunnel's swords graze even while inactive — the one exception in
// that first line, and it is the corridor's whole design: the swords are
// inactive between sub-steps but you are still shaving past them.
//
// `grazetpfactor` and `grazetimefactor` start at 1 and are modified by armour
// ids 15, 24, 3, 9 and 14. This fight's loadout (1, 10, and optionally 23) is
// not among them, so both stay exactly 1.

import { cue } from './audio.js';
import { grazeFactors } from './equipment.js';
import { gearOf } from './damage.js';

export const MAX_TENSION = 250;

/** `scr_tensionheal(amount)` — add TP, clamped at max. */
export function scrTensionheal(state, amount) {
  state.tension = Math.min(state.tension + amount, MAX_TENSION);
}

/** `scr_spellconsumeb`'s inverse: TP as the percentage the bar shows. */
export function tensionPercent(state) {
  return Math.floor((state.tension / MAX_TENSION) * 100);
}

/**
 * The graze box's collision pass.
 *
 * Runs over every live bullet each frame. `grazed` lives on the BULLET, not the
 * box, which is what lets several bullets graze at once and why a bullet that
 * leaves and re-enters pays the entry bonus again.
 *
 * The overlap test is the caller's (sim/index.js `grazes`) and is the same
 * rotated-mask check the hit test uses — see the note there for why a bounding
 * box will not do for this fight's long diagonal bullets.
 */
export function stepGraze(state, grazes, only = null) {
  if (!state.soul) return;
  let grazeNoise = false;
  // The END-STEP lag — see runCollisions. The box tests at last frame's
  // heart position, not this frame's.
  const cx = state.grazePrev ? state.grazePrev.x : state.soul.x + 10;
  const cy = state.grazePrev ? state.grazePrev.y : state.soul.y + 10;
  // `image_xscale = grazesizefactor` — the RIBBONS' actual effect. Hoisted
  // out of the loop: the factor is a property of the loadout, not the bullet.
  const grazeSize = grazeFactors(gearOf(state)).size;
  // The renderer draws the enlarged ring off this (obj_grazebox's own
  // image_xscale), so the flash and the hitbox can never disagree.
  state.grazeSize = grazeSize;

  for (const e of state.entities) {
    if (!e.alive || !e.isBullet || e.type.name === 'obj_heart') continue;
    if (only && !only(e)) continue;

    const active = e.active === 1 || e.active === true;

    // THE PAIRING DECISION. With a recorded pairing table (verification
    // runs — see tools/fullfight-trace.mjs --grazes) the oracle's own
    // grazebox event log decides which bullets paired this frame; the
    // runner's pair enumeration at hit frames is unsolved and this replays
    // it instead. Matching is by frame + object + position within 0.05px
    // (trig-ulp drift), each recorded row consumed once. Without the table
    // (free play, every other scene) the geometric test stands.
    let paired;
    let rowInv = null;
    let rowActive = null;
    if (state.grazeReplay) {
      const rows = state.grazeReplay.get(state.frame);
      const match = rows?.find((r) => !r.used && r.type === e.type.name
        && Math.abs(r.x - e.x) <= 0.05 && Math.abs(r.y - e.y) <= 0.05);
      if (match) {
        match.used = true;
        // THE GATES' INPUTS RIDE THE ROW. On a hit frame the runner's
        // dispatch order between this bullet's graze event and the frame's
        // inv reset is per-slot-reuse state the sim cannot derive — measured
        // both ways (f217: trickle paid at inv -133, the hit after; f2166:
        // hit first, the graze blocked at inv 30; both colseq-pinned). The
        // grazelog's own inv column IS that ordering resolved, so replayed
        // rows gate on it rather than on the sim's phase-local clock.
        rowInv = Number.isFinite(match.inv) ? match.inv : null;
        // `active` rides too, for the same reason: the splitslash's strike
        // (Other_15, fired from the HEART's pairing) zeroes the flag before
        // the graze pairing of the same collision phase — verify21j f1084
        // logs the cut's graze event at active 0, no pay, while the sim's
        // damage pass runs after graze(old) and its own flag still read
        // true, costing a phantom award (1.0 off the turn clock, invisible
        // in tension at the 250 cap).
        rowActive = Number.isFinite(match.active) ? match.active : null;
      }
      paired = Boolean(match);
    } else {
      paired = grazes(e, cx, cy, grazeSize);
    }
    if (!paired) {
      // NOTHING CLEARS `grazed` HERE. obj_grazebox's collision event only
      // ever SETS the flag; the dump has no generic clear-on-leave anywhere.
      // Re-arming is strictly per-object: obj_knight_pointing_star and
      // obj_sword_vortex zero it on their own %4 timers, and
      // obj_knight_split_growtangle resets its teeth itself. Every other
      // bullet pays its entry bonus ONCE and then only trickles — including
      // starchildren born pre-grazed from a bursting parent
      // (sim/childbullet.js). This used to clear the flag on leaving, an
      // invented re-arm no recording ever showed.
      continue;
    }

    // KNIGHT_GRAZE_DEBUG=1 mirrors the oracle's grazelog — logged at the
    // PAIRING, before the active and inv gates, exactly where the oracle
    // patch writes its row, so the two logs diff row-for-row.
    if (typeof process !== 'undefined' && process.env?.KNIGHT_GRAZE_DEBUG) {
      console.error(`[graze] f=${state.frame} ${e.type.name} grazed=${e.grazed}`
        + ` (${e.x}, ${e.y}) a=${e.image_angle} box=(${cx}, ${cy}) inv=${state.invTimer}`);
    }

    // `if (!other.active && other.object_index != obj_sword_tunnel_sword) exit;`
    // A replayed row's own active flag wins over the sim's — see rowActive.
    const gateActive = rowActive !== null ? rowActive === 1 : active;
    if (!gateActive && e.type.name !== 'obj_sword_tunnel_sword') continue;

    if ((rowInv ?? state.invTimer) >= 0) continue;

    // `grazetpfactor` / `grazetimefactor` from obj_grazebox's Create. These
    // were both hardcoded to 1 on the note that this fight's loadout does not
    // touch them — which stopped being true the moment equipment became
    // selectable. TensionBow is +10%, LodeStone +5%, and the RIBBONS ARE
    // NEGATIVE: PinkRibbon -20%, TwinRibbon -25%.
    const gf = grazeFactors(gearOf(state));
    const tp = (e.grazepoints ?? 0) * gf.tp;
    const time = (e.timepoints ?? 0) * gf.time;
    // TWO SEPARATE IFs, exactly as the event body reads — NOT if/else. A
    // bullet at grazed == -1 (the teeth between spawn and the splitter's
    // timer-7 arming) matches NEITHER branch and pays NOTHING. The else
    // that used to be here dropped -1 into the burst branch: tension-
    // invisible (pre-arm grazepoints are 0) but a full timepoint off the
    // turn clock per event — four of them ended verify21g's turn 3 four
    // frames early, with every traced column still matching.
    // THE >= 10 GATE READS THE POST-DECREMENT CLOCK. The battlecontroller is
    // the fight's OLDEST instance, so its Step (turntimer -= 1) runs LAST of
    // the step phase — before the collision events where these cuts live.
    // The sim decrements in the END step, after this pass, so the game's
    // gate value is the sim's minus one. verify21j f4899 discriminates: a
    // tooth's award lands with both clocks ending the prior frame at
    // 10.0666 — the game's gate reads 9.0666 and pays nothing, and the turn
    // (which that award would have shortened) tears down at f4908 on the
    // recording's frame only if the sim refuses it too.
    if (e.grazed === 1) {
      scrTensionheal(state, tp / 30);
      if (state.turntimer - 1 >= 10) state.turntimer -= time / 30;
      state.grazeTimer = Math.max(state.grazeTimer ?? 0, 2);
    } else if (e.grazed === 0) {
      e.grazed = 1;
      state.grazeCount = (state.grazeCount ?? 0) + 1;
      scrTensionheal(state, tp);
      if (state.turntimer - 1 >= 10) state.turntimer -= time;
      state.grazeTimer = 10;
      // `with (obj_battlecontroller) grazenoise = 1;` — a FLAG, not a play.
      // The controller's Step turns it into ONE `snd_graze` and clears it, so
      // ten bullets entering on the same frame make a single sound. Cueing per
      // bullet stacked ten copies on one frame of Roaring.
      grazeNoise = true;
    }
  }

  // obj_battlecontroller's Step: `if (grazenoise == 1) { snd_play(snd_graze);
  // grazenoise = 0; }`.
  if (grazeNoise) cue(state, 'snd_graze');

  if (state.grazeTimer > 0) state.grazeTimer -= 1;
}
