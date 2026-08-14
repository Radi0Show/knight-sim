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
export function stepGraze(state, grazes) {
  if (!state.soul) return;
  let grazeNoise = false;
  // The END-STEP lag — see runCollisions. The box tests at last frame's
  // heart position, not this frame's.
  const cx = state.grazePrev ? state.grazePrev.x : state.soul.x + 10;
  const cy = state.grazePrev ? state.grazePrev.y : state.soul.y + 10;

  for (const e of state.entities) {
    if (!e.alive || !e.isBullet || e.type.name === 'obj_heart') continue;

    // `if (!other.active && other.object_index != obj_sword_tunnel_sword) exit;`
    const active = e.active === 1 || e.active === true;
    if (!active && e.type.name !== 'obj_sword_tunnel_sword') continue;

    if (!grazes(e, cx, cy)) {
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

    if (state.invTimer >= 0) continue;

    // `grazetpfactor` / `grazetimefactor` from obj_grazebox's Create. These
    // were both hardcoded to 1 on the note that this fight's loadout does not
    // touch them — which stopped being true the moment equipment became
    // selectable. TensionBow is +10%, LodeStone +5%, and the RIBBONS ARE
    // NEGATIVE: PinkRibbon -20%, TwinRibbon -25%.
    const gf = grazeFactors(gearOf(state));
    const tp = (e.grazepoints ?? 0) * gf.tp;
    const time = (e.timepoints ?? 0) * gf.time;
    if (process.env.KNIGHT_GRAZE_DEBUG && state.frame >= 290 && state.frame <= 296) {
      console.error('GRZ f' + state.frame, e.type?.name, 'seq', e.seq, e.grazed === 1 ? 'TRICKLE' : 'FRESH', 'gt', e.grazetimer, 'x', e.x?.toFixed(2), 'y', e.y?.toFixed(2), 'act', e.active);
    }
    if (e.grazed === 1) {
      scrTensionheal(state, tp / 30);
      if (state.turntimer >= 10) state.turntimer -= time / 30;
      state.grazeTimer = Math.max(state.grazeTimer ?? 0, 2);
    } else {
      e.grazed = 1;
      state.grazeCount = (state.grazeCount ?? 0) + 1;
      scrTensionheal(state, tp);
      if (state.turntimer >= 10) state.turntimer -= time;
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
