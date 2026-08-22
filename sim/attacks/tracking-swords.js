// obj_tracking_swords_manager + obj_tracking_sword1 — dc.type 151.
//
// The selector reaches this type from myattackchoice 11 (phase 1 turn 2) and
// 14 (phase 3 turn 13), and type 154's vortex chains into it for turn 9 — so
// three of the fight's fifteen turns.
//
// (An earlier version of this note claimed ac 16 and 17 as well. They sit in
// phase 1's block at phaseturn 7 and 8, which the phase never reaches: turn 5
// sets `phase = 2; phaseturn = 0`. See CLAUDE.md, THE REAL FIGHT.)
//
// Shape: swords appear one at a time at a fixed distance from the soul,
// pointing inward. Each fades in, holds, flashes, then slashes straight
// through the soul's position along its own heading. The sword TRACKS the soul
// until it commits (con 2), so the dodge is about where you are when it locks,
// not where you are when it fires.
//
//   con 0   5 frames: alpha 0 -> 0.5, still tracking
//   con 1   30 frames: alpha 0.8 -> 1, len creeps out by 10, still tracking
//   con 2   flashtime+1 = 5 frames: LOCKED, no longer tracking
//   con 3   t1 aim, t2 spawn the slash hitbox, t5 destroy
//
// The manager's cadence tightens as the turn goes on: `rate` starts at 32 and
// drops by `ratedecay` 4 per sword down to `rateminimum` 16 — measured spawn
// gaps 28, 24, 20, 16, 16, 16, 16.
//
// The anti-repeat pass is the interesting bit. `directionprev` remembers the
// last few headings and nudges a repeat by 45 degrees until it is free, so the
// same corner never fires twice in a row — that is what stops the attack from
// being unfair rather than hard. The oracle traces replay POST-wheel headings
// (tools/scenes/oracle-tracking.js), so no trace diff can see it at all;
// `tools/verify-tracking-wheel.mjs` covers it on its guarantee and its
// execution instead, and is sabotage-checked.
//
// The launch streak and the manager's additive, box-clipped slash surface ARE
// drawn now (render/draw/swords.js). NOT translated: the sword's
// afterimage_grow trail, and obj_tracking_sword_slash_extra_graze, which exists
// only to award TP and shave turntimer on a graze (out of scope: dodge-only).

import { spawn, destroy } from '../entity.js';
import { masksOverlap, HEART_MASK, HEART_RECT, PXWHITE2_MASK } from '../masks.js';
import { scrTensionheal } from '../tension.js';
import { gearOf } from '../damage.js';
import { partyWearing } from '../equipment.js';
import { clamp, lerp, lengthdirX, lengthdirY, mergeColor, WHITE, RED } from '../gml.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';
import { gmlChoose } from '../rng.js';
import { cue } from '../audio.js';
import { afterimageGrow } from '../fx.js';

const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * obj_tracking_sword_slash_extra_graze — a 900x7 invisible bar spawned WITH
 * the slash, whose whole job is one graze: `if (global.inv < 0)` and
 * place_meeting with the heart pays +7 TP (+4 when the variant-1 manager or
 * the vortex manager is up), shaves 1/30 off the turn clock, and destroys
 * itself. It has NO lifetime otherwise — a missed band hangs in place until
 * the soul crosses it, which is exactly how the recording pays +7 at f508,
 * fourteen frames after the slash that laid it. Its factor arithmetic is its
 * OWN Create's, not the grazebox's: TensionBow and LodeStone only for TP,
 * SilverWatch only for time — NO ribbon terms on either (the grazebox
 * subtracts them), capped at 3. Sprite spr_pxwhite2 (1x2, origin (0,1),
 * precise), scaled 900x7; no collidebullet parent, so it neither occupies a
 * trace slot nor talks to the grazebox.
 */
export const trackingSlashExtraGraze = {
  name: 'obj_tracking_sword_slash_extra_graze',

  create(e, state) {
    e.timer = 0;
    e.con = 0;
    e.image_xscale = 900;
    e.image_yscale = 7;
    e.visible = false;
  },

  step(e, state) {
    // PRE-DECREMENT inv, like the pre-move soul below: the recording pays at
    // f508, the frame AFTER inv crosses below zero, because the band's step
    // runs before obj_heart's decrement.
    if ((state.invAtFrameStart ?? state.invTimer) >= 0) return;
    const heart = state.soul;
    if (!heart) return;
    // PRE-MOVE soul, like the grazebox and the sword's aim: the band pays on
    // the frame the recording pays (f508, not f507) only against the soul's
    // last-frame position. grazePrev is heart+10 on both axes.
    //
    // THE CHECK IS `place_meeting`, so it runs the project's OWN calibrated
    // precise-mask routine — not a bespoke shape. This used to be a rotated
    // rectangle spanning [-6..+9] across the bar, fitted to 2,586 logged
    // probes of the game's place_meeting (traces/retired/
    // fullfight-slashlog.bandcheck.csv). That fit scored 2581/2586 and the
    // precise routine scores 2574 — but the fit's five misses include two
    // FALSE NEGATIVES, and the precise routine's twelve are ALL false
    // positives, never a missed hit. A fitted shape that can miss a real hit
    // is the dangerous kind: verify37 f577 is exactly that case, a band the
    // game pays and the rectangle refused by 1.07px, which cost a frame of
    // TP and diverged the run. The mask is spr_pxwhite2 (1x2, origin (0,1))
    // scaled 900x7 against the fight soul's 20x20 rect.
    //
    // Same probe set also settles the SOUL POSITION with no fitting at all:
    // the probe logs obj_heart's coordinates at the instant place_meeting
    // ran, and they match the trace row at the same (lagged) label 2468/2586
    // with ZERO matches against the next frame — the band always sees the
    // pre-move soul, never the live one.
    const overlaps = (sx, sy) => masksOverlap(
      HEART_RECT, sx, sy, PXWHITE2_MASK, e.x, e.y, 900, 7, e.image_angle,
    );
    const hx = state.grazePrev ? state.grazePrev.x - 10 : heart.x;
    const hy = state.grazePrev ? state.grazePrev.y - 10 : heart.y;
    const bandHit = overlaps(hx, hy);
    if (!bandHit) return;

    const loadout = gearOf(state);
    let tp = 1 + partyWearing(loadout, 15) * 0.1 + partyWearing(loadout, 24) * 0.05;
    let time = 1 + partyWearing(loadout, 14) * 0.1;
    if (tp > 3) tp = 3;
    if (time > 3) time = 3;

    const variant1 = state.entities.some(
      (m) => m.alive && m.type.name === 'obj_tracking_swords_manager' && m.variant === 1,
    );
    const vortex = state.entities.some(
      (m) => m.alive && m.type.name === 'obj_sword_vortex_manager',
    );
    scrTensionheal(state, (variant1 || vortex ? 4 : 7) * tp);
    if (state.turntimer >= 10) state.turntimer -= (1 / 30) * time;
    destroy(e);
  },
};

/** obj_tracking_sword_slash — a 900x1 bar along the sword's heading, alive for
 *  three frames. This, not the hovering sword, is what hits. */
export const trackingSwordSlash = {
  name: 'obj_tracking_sword_slash',

  create(e, state) {
    e.timer = 0;
    e.con = 0;
    e.image_xscale = 900;
    e.image_yscale = 1;
    scrBulletInit(e);
    e.active = 1;
    e.destroyonhit = 0;
    e.damage = 1;
    // GRAZEPOINTS ARE HALVED IN TWO CASES, and this hardcoded the un-halved 4:
    //
    //     grazepoints = 4;
    //     if (i_ex(obj_sword_vortex_manager)) grazepoints = 2;
    //     if (i_ex(obj_tracking_swords_manager) && variant == 1) grazepoints = 2;
    //
    // `variant` is the attack's DIFFICULTY (`_manager.variant = difficulty`).
    //
    // The first case is the one this fight hits: ac 15 chains the vortex and
    // the tracking swords, so the vortex manager is alive while the slashes
    // spawn and every one of them pays HALF. Paying the full 4 there gave
    // double TP for the whole of phase 2 turn 9 — a 900px bar sweeping the
    // arena is a lot of graze frames to be double-counting.
    const vortex = state.entities.some(
      (x) => x.alive && x.type.name === 'obj_sword_vortex_manager',
    );
    const variantOne = state.entities.some(
      (x) => x.alive && x.type.name === 'obj_tracking_swords_manager' && x.variant === 1,
    );
    e.grazepoints = (vortex || variantOne) ? 2 : 4;
    e.timepoints = 11;
    e.sprite_index = 'spr_pxwhite2';
    e.isBullet = true;
  },

  // The original counts this down in its DRAW event, not its Step, so the bar
  // survives exactly three drawn frames.
  endStep(e) {
    e.timer += 1;
    if (e.timer === 3) destroy(e);
  },

  other15: collidebulletOther15,
};

export const trackingSword = {
  name: 'obj_tracking_sword1',

  create(e, state) {
    e.timer = 0;
    e.con = 0;
    e.afterimagecon = 0;
    e.targetx = 0;
    e.targety = 0;
    e.variant = 0;
    e.image_alpha = 0;
    scrBulletInit(e);
    e.element = 5;
    e.fadetohalftime = 5;
    e.waittime = 10;
    e.fadetofulltime = 20;
    e.flashtime = 4;
    e.len = 120;
    e.lenstart = e.len;
    e.sprite_index = 'spr_roaringknight_sword_ol';
    e.image_xscale = 1;
    e.image_yscale = 1;
    // THE HOVERING SWORD IS A BULLET TOO. It has no Other_15 of its own, which
    // by the dump's own convention means it inherits obj_collidebullet's — the
    // same reasoning that puts obj_sword_tunnel_sword and
    // obj_tracking_sword_slash in the "counted" column in CLAUDE.md. And
    // `scr_bullet_init` leaves it `active = 1` with `grazepoints = 1`.
    //
    // Without this flag it was invisible to BOTH passes: the collision phase
    // skipped it (no other15) and the graze box could not see it (no isBullet),
    // so the sword you spend the whole attack manoeuvring around was the one
    // object on screen that could neither hurt you nor pay you TP.
    e.isBullet = true;
  },

  step(e, state) {
    const heart = state.soul;
    // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
    // Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a bullet that outlives its turn by a frame has
    // nothing to aim at. Skipping the frame leaves it where it was until the
    // turn sweep takes it; inventing a position would make it lunge at a soul
    // that is not there.
    if (!heart) return;
    // NO SOUL, NO TRACKING. obj_heart exists only during the bullet phase —
    // the Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a sword that outlives its turn by a frame has nothing
    // to follow. Skipping the frame leaves it exactly where it was until the
    // turn sweep takes it, which is what the original's sweep does; inventing
    // a target position would make it lunge at a soul that is not there.
    if (!heart) return;

    // Tracking. It follows the soul right up until it commits at con 2 —
    // and it reads the soul's PRE-MOVE position: the recording's sword sits
    // at (soul_last_frame + 10) every frame it tracks (spawn f455: sword y
    // 154 with the soul already at 140, having been at 144). state.grazePrev
    // is exactly that value — obj_heart's position as of last frame, +10 on
    // both axes — maintained for the graze box, which lags the same way.
    if (e.con < 2) {
      const aim = state.grazePrev ?? { x: heart.x + 10, y: heart.y + 10 };
      e.x = aim.x + lengthdirX(e.len, e.direction);
      e.y = clamp(
        aim.y + lengthdirY(e.len, e.direction),
        state.view.y + 40,
        state.view.y + 320,
      );
    }

    if (e.con === 0) {
      e.timer += 1;
      if (e.timer === 1) cue(state, 'snd_knight_jump_quick', 1.3);
      e.image_alpha = lerp(0, 0.5, e.timer / e.fadetohalftime);
      // Exact equality, as the original has it: alpha lands on 0.5 at timer 5.
      if (e.image_alpha === 0.5) {
        e.con = 1;
        e.timer = 0;
      }
    }

    if (globalThis.process?.env?.KNIGHT_TRACK_DEBUG) {
      const f = globalThis.__simFrame;
      const [a, b] = globalThis.process.env.KNIGHT_TRACK_DEBUG.split('-').map(Number);
      if (f >= a && f <= (b ?? a)) {
        console.error(`[trk] f=${f} seq=${e.seq} con=${e.con} timer=${e.timer}`
          + ` len=${e.len} dir=${e.direction} x=${e.x}`);
      }
    }
    if (e.con === 1) {
      e.timer += 1;
      if (e.timer >= e.waittime) {
        const t = (e.timer - e.waittime) / e.fadetofulltime;
        e.image_alpha = lerp(0.8, 1, t);
        // THE SWORD REDDENS AS IT CHARGES. `merge_color(c_white, c_red,
        // timer / 30)` — waittime is 10 and fadetofulltime 20, so the ramp runs
        // over exactly the frames the sword is fading to full opacity and it is
        // fully red by the time it locks on at con 2. Without it the sword is
        // white until it fires and the attack loses its only warning.
        e.image_blend = mergeColor(WHITE, RED, e.timer / 30);
        // `len` is re-lerped from its CURRENT value each frame, so it eases
        // out rather than moving linearly.
        e.len = lerp(e.len, e.lenstart + 10, t);
      }
      if (e.image_alpha === 1) {
        e.con = 2;
        e.timer = 0;
        // ONE growing ghost on the lock-on, not a per-frame trail.
        const a = spawn(state, afterimageGrow, { x: e.x, y: e.y });
        a.sprite_index = e.sprite_index;
        a.image_angle = e.image_angle;
        a.image_blend = e.image_blend;
        a.xrate = 0.2;
        a.yrate = 0.2;
        a.fade = 0.3;
      }
    }

    if (e.con === 2) {
      e.timer += 1;
      if (e.timer === e.flashtime + 1) {
        e.con = 3;
        e.timer = 0;
      }
    }

    if (e.con === 3) {
      e.timer += 1;
      if (e.timer === 1) {
        e.afterimagecon = 1;
        e.targetx = e.x + lengthdirX(900, e.direction + 180);
        e.targety = e.y + lengthdirY(900, e.direction + 180);
        cue(state, 'snd_knight_cut2', 1.3);
      }
      if (e.timer === 2) {
        const s = spawn(state, trackingSwordSlash, { x: e.x, y: e.y });
        s.image_angle = e.image_angle;
        s.direction = e.direction;
        s.damage = e.damage;
        const s2 = spawn(state, trackingSlashExtraGraze, { x: e.x, y: e.y });
        s2.image_angle = e.image_angle;
        s2.direction = e.direction;
        // variant 1 also seeds 27 obj_tracking_sword2 along the path; variant
        // 1 is not reached by ac 11 and is not translated yet.
      }
      if (e.timer === 5) destroy(e);
    }
  },

  other15: collidebulletOther15,

  /**
   * `afterimagecon` walks 1 -> 2 -> 3, and the value selects which streak is
   * drawn: 1 is the full 40-copy launch trail, 2 is the same trail at half
   * alpha, 3 draws nothing. Without the advance it would be drawn every frame
   * for the rest of the sword's life.
   *
   * BEGIN STEP, NOT END STEP — and the difference is visible. The original
   * advances it at the BOTTOM of its Draw event: Draw READS the value, then
   * increments. So the frame the Step sets it to 1, Draw still sees 1.
   *
   * Advancing in endStep — the phase that otherwise stands in for Draw — runs
   * BEFORE the renderer, so the renderer would see 2 on that frame and 3 on the
   * next: the full-brightness streak, which is the whole effect, would never be
   * drawn at all. Advancing here instead means the increment lands on the
   * following frame, which is what "read then increment" actually means.
   *
   * The rule generalises: a Draw-event counter goes in endStep when the event
   * increments it BEFORE using it (obj_knight_roaring2's ball_counter and hsv,
   * the starchild's drawtimer), and in beginStep when it increments AFTER
   * (this, and roaring's star_flicker).
   */
  beginStep(e) {
    if (e.afterimagecon === 1 || e.afterimagecon === 2) e.afterimagecon += 1;
  },
};

export const trackingSwordsManager = {
  name: 'obj_tracking_swords_manager',

  // BEFORE THE VORTEX MANAGER. ac 15 creates the vortex controller first and
  // the tracking controller second; the runner steps newest-first, so the
  // game's tracking manager runs BEFORE the vortex's — its first telegraph
  // takes the earlier spawn seq on their shared birth frame (verify21j
  // f3366: oracle b2 is the telegraph, the sim's was the vortex's first
  // sword; the trajectories were identical and only the slot order
  // diverged). Every solo-tracking turn (ac 11/14) has no vortex to order
  // against, and soulPrev reads are snapshot-based, so the earlier slot is
  // safe there.
  stepOrder: -0.1,

  create(e, state) {
    e.timer = 0;
    e.con = 0;
    e.variant = 0;
    e.firstsword = false;
    e.multiswordmax = 0;
    e.multiswordframes = 0;
    e.multiswordcon = 0;
    e.multiswordcount = 0;
    e.setcount = 0;
    e.setdirection = new Array(50).fill(-1);
    // A COLLIDEBULLET IN ITS OWN RIGHT. The object's parent chain (dumped via
    // object_parents.csx) is obj_tracking_swords_manager -> obj_regularbullet -> the
    // collidebullet base — so the real game's bullet enumeration counts the
    // MANAGER itself, sitting at (growtangle.x, cameray()) from its creation
    // frame. The whole-fight differ pairs bullets by slot, and without this
    // flag every bullet of the turn sat one slot early against the recording
    // (turn 2's f450: oracle b0 is the manager, sim b0 was the first sword).
    // maskOff keeps it out of the collision and graze loops: parked at the
    // camera top it never touches the soul, and its own damage never fires.
    e.isBullet = true;
    e.maskOff = true;
    scrBulletInit(e);
    e.swordcount = 0;
    e.directionprev = new Array(8).fill(-1);
    e.wheelNudges = 0;
  },

  /** Other_10 — event_user(0), fired from the Create in the original. */
  init(e, state, chainedType = null) {
    if (e.variant === 0) {
      e.rate = 32;
      e.ratedecay = 4;
      e.rateminimum = 16;
      e.maxswords = 99;
      e.multiswordmax = 0;
    }
    if (e.variant === 1) {
      // The original assigns a first set of values and then immediately
      // overwrites every one of them. Kept as-is: the dead assignments are
      // what the code does, and "tidying" them is how a divergence gets
      // introduced later.
      e.rate = 50;
      e.ratedecay = 10;
      e.rateminimum = 6;
      e.maxswords = 5;
      e.multiswordmax = 0;
      e.rate = 24;
      e.ratedecay = 0;
      e.rateminimum = 24;
      e.maxswords = 99;
      e.multiswordmax = 0;
    }
    if (e.variant === 2) {
      e.rate = 24;
      e.ratedecay = 0;
      e.rateminimum = 24;
      e.maxswords = 99;
      e.multiswordmax = 2;
      e.multiswordframes = 4;
      const set = [0, 45, 90, 135, 180, 225, 270, 315, 0, 45];
      for (let i = 0; i < set.length; i++) e.setdirection[i + 1] = set[i];
    }
    if (e.variant === 3) {
      e.rate = 20;
      e.ratedecay = 4;
      e.rateminimum = 13;
      e.maxswords = 99;
      e.multiswordmax = 0;
    }

    // Chained launches retune the cadence: rotatingslash (104) makes it much
    // sparser, the sword vortex (154) keeps it dense. The dump's Other_10
    // scans live obj_dbulletcontroller instances for the sibling's type; the
    // sim spawns its managers directly and has no dc entities to find, so
    // the launch site passes the sibling type in (`chainedType`) — the
    // entity scan stays for any scene that does model the controllers.
    // Without this, ac 15's tracking ran rate 32 and its second sword came
    // at +33 instead of the recording's +25 (verify21j f3386).
    if (chainedType === 104 || chainedType === 154) {
      e.rate = chainedType === 104 ? 55 : 24;
      e.ratedecay = chainedType === 104 ? 0 : 4;
      e.rateminimum = chainedType === 104 ? 24 : 16;
      e.maxswords = 99;
      e.multiswordmax = 0;
      if (chainedType === 104) e.multiswordframes = 0;
    }
    for (const dc of state.entities) {
      if (!dc.alive || dc.type.name !== 'obj_dbulletcontroller') continue;
      if (dc.dcType === 104) {
        e.rate = 55;
        e.ratedecay = 0;
        e.rateminimum = 24;
        e.maxswords = 99;
        e.multiswordmax = 0;
        e.multiswordframes = 0;
      }
      if (dc.dcType === 154) {
        e.rate = 24;
        e.ratedecay = 4;
        e.rateminimum = 16;
        e.maxswords = 99;
        e.multiswordmax = 0;
      }
    }

    e.timer = e.rate - 5;
  },

  step(e, state) {
    // The manager stops feeding the turn well before it ends.
    if (state.turntimer < 70) return;

    e.timer += 1;
    const fire =
      (e.timer === e.rate && e.swordcount <= e.maxswords) ||
      (e.timer === e.multiswordframes && e.multiswordcon === 1);
    if (!fire) return;

    const inst = spawn(state, trackingSword, { x: e.x, y: e.y });

    // Past the end of a replayed list, fall back to the live stream: a
    // spawn-count divergence in a later turn must show up as a diff, not as
    // an undefined direction crashing the trace.
    // THE CHOOSE IS CONSUMED EITHER WAY. The game rolls
    // `choose(0,45,...,315)` for every sword; the replay only substitutes
    // the OUTCOME (the post-wheel heading the oracle logged). Skipping the
    // draw under replay left the anchored stream one short per sword —
    // invisible on tracking-only turns, but ac 15's vortex rolls its second
    // centermove target from the same stream and verify21j f3423 read
    // irandom(120)=54 at the sim's position where the game (three swords
    // in) drew 65 three positions later.
    const rolledHeading = state.gmlRng ? gmlChoose(state.gmlRng, HEADINGS) : null;
    inst.direction = state.swordDirections && state.swordIndex < state.swordDirections.length
      ? state.swordDirections[state.swordIndex++]
      : rolledHeading;
    inst.variant = e.variant;
    inst.damage = e.damage;

    // ANTI-REPEAT. Nudge the heading by 45 until it is not one the last few
    // swords used. The `repeat (8)` around it lets a heading walk several
    // steps when the wheel is crowded.
    //
    // SKIPPED when the replayed directions are POST-wheel: the whole-fight
    // recording logs each sword's direction as first sighted — after the
    // game's own wheel already ran — so running the wheel again here could
    // double-nudge a value into a heading the game never used. The raw
    // choose() sits at an unresolved offset into the anchored stream (some
    // consumer between the spawns is unaccounted), which is exactly why the
    // whole-fight replays these like the shuffle and the bolt schedules.
    if (!state.swordDirectionsPostWheel) {
      for (let r = 0; r < 8; r++) {
        for (let i = 0; i < 8; i++) {
          if (inst.direction === e.directionprev[i]) {
            inst.direction += 45;
            // Instrumentation, not behaviour: a nudge that never happens is
            // indistinguishable from a wheel that had nothing to fix, and
            // this whole mechanism is invisible in the oracle traces (they
            // replay post-wheel headings). verify-tracking-wheel asserts on
            // it.
            e.wheelNudges = (e.wheelNudges ?? 0) + 1;
          }
        }
      }
    }

    inst.image_angle = inst.direction + 180;
    e.directionprev[e.swordcount] = inst.direction;

    // Forget the three slots ahead, so the wheel reopens behind the sword.
    for (let i = 1; i < 4; i++) {
      let a = i + e.swordcount;
      if (a > 7) a -= 7;
      e.directionprev[a] = -1;
    }

    e.swordcount += 1;
    if (e.swordcount > e.maxswords && e.variant === 0) state.turntimer = 70;
    if (e.swordcount > e.maxswords && e.variant === 1) state.turntimer = 120;
    if (e.swordcount > 7 && e.swordcount < e.maxswords) e.swordcount = 0;

    e.setcount += 1;
    // The GML array is EXACTLY 50 slots (`for (i = 0; i < 50; i++)`), and a
    // real turn cannot fire 50 swords — the game would hard-error on the
    // read. verify-fight-order's confirm-mashing driver CAN run a vortex turn
    // long enough to get there (the turntimer=120 refresh above keeps the
    // finisher window open), and an out-of-range read here returned
    // `undefined`, which `!== -1` treated as a scripted override: the sword's
    // direction went NaN and the collision phase crashed on it. Out of range
    // means "past the scripted opening" — no override.
    const setdir = e.setcount < 50 ? e.setdirection[e.setcount] : -1;
    if (setdir !== -1) inst.direction = setdir;

    if (e.multiswordmax > 0) e.multiswordcount += 1;
    if (e.multiswordcon === 0 && e.multiswordmax > 0) e.multiswordcon = 1;
    if (e.multiswordcon === 1 && e.multiswordcount === e.multiswordmax) {
      e.multiswordcon = 0;
      e.multiswordcount = 0;
    }

    // Place it around the soul. Note this runs AFTER setdirection may have
    // overridden the heading, so the two always agree.
    const heart = state.soul;
    // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
    // Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a bullet that outlives its turn by a frame has
    // nothing to aim at. Skipping the frame leaves it where it was until the
    // turn sweep takes it; inventing a position would make it lunge at a soul
    // that is not there.
    if (!heart) return;
    // NO SOUL, NO TRACKING. obj_heart exists only during the bullet phase —
    // the Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a sword that outlives its turn by a frame has nothing
    // to follow. Skipping the frame leaves it exactly where it was until the
    // turn sweep takes it, which is what the original's sweep does; inventing
    // a target position would make it lunge at a soul that is not there.
    if (!heart) return;
    // Same pre-move read as the tracking loop above — the newborn sword's
    // first traced position already lags the soul by one movement step.
    // NO CLAMP HERE: the recording's sword can be born above the tracking
    // clamp's ceiling (b2 at y=38 with the floor at cameray()+40) — only the
    // Step's own positioning line clamps.
    {
      const aim = state.grazePrev ?? { x: heart.x + 10, y: heart.y + 10 };
      inst.x = aim.x + lengthdirX(inst.len, inst.direction);
      inst.y = aim.y + lengthdirY(inst.len, inst.direction);
    }
    inst.ystart = inst.y;
    inst.image_angle = inst.direction + 180;

    e.rate -= e.ratedecay;
    if (e.rate < e.rateminimum) e.rate = e.rateminimum;
    e.timer = 0;
  },
};
