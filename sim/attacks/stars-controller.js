// obj_dbulletcontroller, type 98 — the STARS spawner (ac 1).
//
// This lived inside tools/scenes/oracle-stars-full.js, which was fine while
// only the verifier needed it and wrong as soon as the playable build did:
// every other attack's manager is in sim/ and Stars was the one attack the
// fight scheduler could not launch. Same code, same suite
// (tools/verify-stars-full.mjs) — it just lives where the fight can reach it.
//
// The controller derives each star from a pair of values that evolve per star:
//
//   size    += 0.5 + sin(made) * 0.5,  then % 1
//   special += 0.5 + (0.5 + sin(random(1)) * 0.3),  then % 1, then -= 0.5
//   direction = 180 + special * cone.angle
//   speed     = lerp(10, 5, size)
//
// `sin(random(1))` makes the launches unreproducible without the real stream,
// so the ORACLE SCENE replays them from the recording. In the playable build
// there is nothing to replay against, so it rolls them off gmlRng — which is
// the honest behaviour: the real game rerolls every playthrough too.
//
// ORIGINAL BUG, preserved: the controller sets `d.grow_Speed` (capital S)
// while obj_knight_pointing_star reads `growspeed`. Different variables, so
// the intended per-star growth variation never happens and every star in the
// recording grows at the same 0.02.

import { spawn } from '../entity.js';
import { cue } from '../audio.js';
import { scrMovetowards, scrEaseOut, lerp } from '../gml.js';
import { gmlRandomRange, gmlChoose, gmlRandom } from '../rng.js';
import { pointingStar } from './pointing-star.js';
import { heartFollower } from './pointing-starchild.js';

export const starsController = {
  name: 'obj_dbulletcontroller',
  // See pointingCone's stepOrder note. The controller precedes the cone,
  // which precedes the heart: [-2, -1, 0].
  stepOrder: -2,

  create(e, state) {
    e.btimer = 0;
    e.made = 0;
    e.endtimer = 120;
    e.init = 2;
    e.size = 0;
    e.special = 0;

    // obj_heart_follower — the soft-following ghost the homing starchildren
    // aim at (they lead the soul rather than tracking it exactly). The type-98
    // controller creates it, which is here.
    //
    // It was missing outside the oracle scene, which spawned one by hand. In a
    // real turn the difficulty-2 shards therefore had nothing to home toward
    // and flew in straight lines — the "homing stars just move horizontally"
    // report. Nothing in the verifier could catch it: the scene supplied the
    // follower itself, so the suite never exercised the controller's job.
    if (state.soul && !state.entities.some((x) => x.alive && x.type.name === 'obj_heart_follower')) {
      spawn(state, heartFollower, { x: state.soul.x, y: state.soul.y });
    }
  },

  step(e, state) {
    // The init-block's `global.turntimer += 30` (and `+= 60` at difficulty
    // >= 2) runs in the controller's FIRST STEP, not at creation: the dc is
    // created during the knight's Step, its own first Step comes the next
    // frame, and the oracle's diag shows the +30 landing exactly there
    // (launch frame ends 239; the next frame 239 - 1 + 30 = 268). Paying it
    // in create() armed the clock one frame early and two units high.
    if (!e.turntimerPaid) {
      e.turntimerPaid = true;
      state.turntimer += 30;
      if ((e.difficulty ?? 0) >= 2) state.turntimer += 60;
    }
    if (e.init >= 3) return;

    e.btimer += 1;

    // POST-DECREMENT READ. The dc's stop check sees the clock as of this
    // frame's END: verify21j turn 11 (Stars d2, endtimer 210) spawns its
    // last star at f4239 and stays silent at f4243, where the pre-decrement
    // value is 211.9 (> 211, would spawn) and the post 210.9 (stops). The
    // cone's own release check stays on the pre-decrement read the earlier
    // turns pinned — the two objects genuinely read the clock at different
    // effective moments, and each check carries the receipt that set it.
    if (state.turntimer - 1 <= e.endtimer + 1) {
      e.init = 3;
      return;
    }

    if ((e.made !== 0 && e.btimer >= 4) || e.btimer >= 45) {
      const cone = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_pointing_cone',
      );
      if (!cone) return;

      // THE ANGLE THE CONE WILL HAVE THIS FRAME, not the one it has. Two
      // exact measurements pin an ordering the per-instance model cannot
      // produce: the first star's special is us[39] of the anchored stream
      // TO THE LAST DIGIT only if dir used angle 56.25 — the value the cone
      // reaches during the SAME frame — while size sits at us[38], which
      // requires the controller's rolls to precede the cone's two drag
      // draws. So the game's dc reads a current-frame angle while drawing
      // first. Reproduced by advancing a COPY of the cone's own
      // deterministic ramp (movetowards 0.025, ease_out 6) — no state is
      // touched, no draws consumed; the cone still runs its real update
      // afterwards. Marked as an ordering reconciliation: the underlying
      // event scheduling is not fully understood, the two measurements are.
      let coneAngle = cone.angle;
      if ((cone.angle ?? 0) < (cone.target_angle ?? 60) && (cone.con ?? 0) >= 2) {
        const nextLerp = scrMovetowards(cone.angle_lerp ?? 0, 1, 0.025);
        coneAngle = lerp(0, cone.target_angle ?? 60, scrEaseOut(nextLerp, 6));
      }

      // DIFFICULTY 2 RE-ROLLS THE BURST AXIS PER STAR, before the star is
      // created (the choose sits directly above `scr_childbullet` in the
      // spawn branch):
      //
      //     if (difficulty == 2) side = choose(0, 66, -66);
      //
      // so each star's two shard headings tilt to vertical or ±66 degrees.
      // This was promised by a launchAttack comment and NEVER IMPLEMENTED:
      // `e.side ?? 1` left every difficulty-2 burst on the one axis 90+1,
      // which flattened the whole pattern — reported from play as "the
      // hardest Stars is off, most of the move is wrong".
      if ((e.difficulty ?? 0) === 2 && state.gmlRng) {
        e.side = gmlChoose(state.gmlRng, [0, 66, -66]);
      }

      // THE STAR IS CREATED BEFORE THE ROLLS. `d = scr_childbullet(...)` runs
      // first — and the star's Create draws its `dir = choose(-1, 1)` — THEN
      // the controller rolls size/special. Rolling first put the sim's size
      // one stream position early (us[37] instead of us[38]), which two
      // recordings measured as speed 7.2553 vs the oracle's 6.8077.
      const d = spawn(state, pointingStar, { x: cone.x + 22, y: cone.y + 56 });
      d.difficulty = e.difficulty ?? 0;
      d.side = e.side ?? 1;

      // EVERY STAR DROPS WITH A SOUND, and Stars was silent without it:
      //
      //     starsound = snd_play_pitch(snd_stardrop, 0.5);
      //     snd_volume(starsound, 0.5, 0);
      //
      // Pitched down half and at half volume, once per spawn — roughly every
      // four frames while the cone is open, so it is the attack's whole
      // texture as the fan fills up. Reported from play as "stars is missing
      // some sounds"; an audit of every snd_play in the live knight objects
      // against the sim's cues (the same sweep that found the tunnel sword's
      // jump and the charge-up's powerup) is what confirmed which.
      cue(state, 'snd_stardrop', 0.5, 0.5);

      let direction;
      let speed;
      const replay = state.starVariant ? state.starVariant.launches : null;
      if (replay) {
        const rec = replay[e.made];
        if (!rec) { d.alive = false; return; }
        direction = rec.direction;
        speed = rec.speed;
      } else if (e.made === 0) {
        // THE FIRST STAR ROLLS, the rest INCREMENT:
        //
        //     if (made == 0) { size = random_range(0.5, 1);
        //                      special = random_range(-0.5, 0.5); }
        //     else { ...the += formulas... }
        //
        // This branch was MISSING: every star took the else-arm, and with
        // size starting at 0 the first star's size was (0 + 0.5 + sin(0)/2)
        // % 1 = exactly 0.5 — speed exactly 7.5, which is what finally gave
        // it away: two independent recordings measured the sim at 7.5000
        // while the oracle rolled 6.8077 = lerp(10, 5, us[38]) of the
        // anchored stream, to the last digit.
        e.size = gmlRandomRange(state.gmlRng, 0.5, 1);
        e.special = gmlRandomRange(state.gmlRng, -0.5, 0.5);
        direction = 180 + e.special * coneAngle;
        speed = lerp(10, 5, e.size);
      } else {
        e.size = (e.size + (0.5 + Math.sin(e.made) * 0.5)) % 1;
        const _u = gmlRandom(state.gmlRng, 1);
        if (globalThis.process?.env?.KNIGHT_STAR_DEBUG) {
          console.error(`[chain] made=${e.made} specialPrev=${e.special} u=${_u} sin=${Math.sin(_u)}`);
        }
        e.special =
          ((e.special + (0.5 + (0.5 + Math.sin(_u) * 0.3))) % 1) - 0.5;
        direction = 180 + e.special * coneAngle;
        speed = lerp(10, 5, e.size);
      }

      // `if (size <= 0.1)` — the fast-star aim clamp. A star this small is
      // near max speed, and if its heading lies within 20 degrees of the
      // soul it is pushed OUT to exactly 20 degrees off, then looped back
      // into the cone's arc. Deterministic — no draws — but absent it a
      // sub-0.1 roll fires a near-guaranteed hit the real game never fires.
      if (!replay && e.size <= 0.1 && state.soul) {
        const hx = state.soul.x + 10 - (cone.x + 22);
        const hy = state.soul.y + 10 - (cone.y + 56);
        const heartdir = ((Math.atan2(-hy, hx) * 180) / Math.PI + 360) % 360;
        let diffd = ((heartdir - direction) % 360 + 540) % 360 - 180;
        if (Math.abs(diffd) < 20) {
          direction = direction < heartdir
            ? heartdir - 20 + diffd
            : heartdir + 20 + diffd;
          const lo = 180 - cone.angle;
          const hi = 180 + cone.angle;
          const span = hi - lo;
          if (span > 0) {
            while (direction < lo) direction += span;
            while (direction > hi) direction -= span;
          }
        }
      }

      d.direction = direction;
      d.speed = speed;
      if (globalThis.process?.env?.KNIGHT_STAR_DEBUG) {
        console.error(`[star] f=${globalThis.__simFrame} made=${e.made} size=${e.size}`
          + ` special=${e.special} coneAngle=${coneAngle} dir=${direction} spd=${speed}`);
      }

      e.made += 1;
      e.btimer = 0;
    }
  },
};
