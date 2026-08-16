// ROARING's soul pull and star rings — against
// knight-research/traces/roaring2.csv (phase 4 turn 3, 900 frames).
//
// Verifies the two parts of obj_knight_roaring2 that reach the player: the
// intensity ramp plus `player_suck` (the drag on the soul), and the star
// rings — where they are fired, and the spiral the controller drives them
// along afterwards.
//
// Starts at frame 149 from the recorded state, by which point the intro tween
// on `fake_y` has settled at 88 — so the pull target is fixed at
// `(camerax() + 320, cameray() + 88 + 55)` = (320, 143) and the scene does not
// have to model the tween.
//
// `attack_timer` and `starcount_p1` ARE seeded now (they used to be skipped,
// on the grounds that the ring branch was unmodelled and they would drift).
// Seeding them is what puts the first ring on the right frame: the cadence was
// correct in shape but four frames early until `starcount_p1` came from the
// recording instead of starting at 0.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { roaring2 } from '../../sim/attacks/roaring.js';
import { roaringStar } from '../../sim/attacks/roaring-star.js';
import { scrShakescreen } from '../../sim/shake.js';
import { lerpvar } from '../../sim/lerpvar.js';

export const START_FRAME = 149;

/**
 * 150..461, and the pull and the rings now END AT THE SAME FRAME — which is
 * itself the evidence that nothing is left unexplained in between.
 *
 * This used to stop at 191, on the "f192 soul kick": the oracle's soul started
 * moving in X while the engine kept a clean vertical oscillation, and three
 * plausible causes had already been eliminated. The cause was `obj_shake`
 * (sim/shake.js), and it accounted for a SECOND symptom at the same frame —
 * the live star count running one over. Both come from the same place: the
 * pull and the star spiral each aim at `camerax() + fake_x`, so when the
 * camera moves, the soul is dragged somewhere else AND the point the stars
 * fall toward moves with it. At (-4,-4) the star that the recording destroys
 * on 192 is 8.19px from the shaken target, inside the 12px kill radius, while
 * against an unshaken target it sits at 13.65 and lives.
 *
 * Frame 462 is where the oracle switches to the `intensity >= 3.7` branches
 * and the Other_10 timeline, neither translated — it fires a ring of 8 there,
 * then rings of 3 every 5 frames.
 */
export const PULL_WINDOW = { from: 150, to: 678 };

/** Same window; kept as a separate name because the two are asserted differently. */
// EXTENDED TO THE END OF THE RECORDING. This used to stop at 678 because the
// count diverged at 679 — the first released star completing its burst a frame
// early. That was a STEP-ORDER bug (roaring-star.js `stepOrder: -1`), not a
// window limit, and with it fixed the counts match every frame of the trace.
export const RING_WINDOW = { from: 150, to: 698 };

/**
 * THE SOUL is only comparable to 462, and the reason is a genuine sensitivity
 * in the attack rather than a gap in the translation.
 *
 * On frame 462 the roar flips `player_suck` from +0.85 to -6 — and at that
 * instant the soul has been parked ON the pull target for 300 frames, roughly
 * 0.6px away. `point_direction` at 0.6px is near-singular: the sub-pixel
 * residue the soul has carried all along (~3e-5px, documented and bounded)
 * decides which ray it is thrown out along. Engine and oracle pick rays
 * 0.022 degrees apart and then fly straight, identically, forever — the
 * per-frame step is constant and equal in magnitude to 9 decimal places on
 * both sides; only the heading differs.
 *
 * So this is not drift that could be tightened by finding another bug. It is
 * one bit of unavoidable residue amplified through a singular point. What CAN
 * still be checked past 462 is everything that does not depend on where the
 * soul went — which is why the window above keeps going to 678 and this one
 * stops.
 *
 * It matters less than it sounds for the tool: a real player is moving, so the
 * soul is never parked exactly on the target when the roar lands, and the
 * stars are fired radially from the knight rather than aimed at the soul.
 */
export const SOUL_WINDOW = { from: 150, to: 462 };

/**
 * STAR POSITIONS are bounded only to 639, though their COUNT is exact all the
 * way to 678.
 *
 * 635 is where `roaring_timer` passes 182 and the finale begins releasing the
 * caught stars one per frame into con 1 — brake, then gravity reversed along
 * `direction - 180`, then the six-child burst. Through 639 the worst star is
 * 6.3e-3px out; after that a released star wanders far enough to be a real
 * divergence rather than residue, while the population stays in lockstep.
 *
 * The suspects are the con 2 gravity phase (whose ~6e-8/frame accumulation
 * residue is a known open engine question, see docs/STATUS.md) and the `split`
 * / con 2.5 branch, which nothing has exercised yet. NOT chased here — the
 * count being exact means the release CADENCE is right, and the tail is a
 * self-contained next piece.
 */
// Also extended: star positions now hold to 0.006 px across the whole
// recording, including all 298 stars' burst arcs.
export const STAR_POS_WINDOW = { from: 150, to: 698 };

/** Measured at frame 149. */
export const ROARING_STATE = {
  timer: 136,
  intensity: 1.564,
  player_suck: 0.6,
  fake_x: 320,
  fake_y: 88,
  roaring_timer: 0,
  // THE RING COUNTERS, measured. `attack_timer` fires a beat every time it
  // reaches 4 and resets to `floor(-1 + intensity)`, and `starcount_p1` lets
  // only the FIRST of every three beats spawn a ring — so seeding it at 2
  // rather than 0 is what puts the first ring at frame 157 instead of 153.
  attack_timer: 0,
  starcount_p1: 2,
  rand_angle: 694,
  rand_dist: 600,
  // THE VORTEX IS ALREADY FADING IN. This scene starts at timer 136 and the
  // fade is cued at timer 118 with a 16-frame delay, so the cue is BEHIND the
  // window and the value has to be seeded like every other mid-attack field.
  // Leaving it at the Create default of 0 is what let the sim ship with the
  // whole coloured background invisible and every suite still green — this
  // scene simply never reached the line that turns it on.
  //
  // 0.1467304745 is the recording's own value at frame 149, and it identifies
  // the curve exactly: `sin(3/32 * pi/2)` to ten decimals, i.e. three frames
  // into a 32-frame ease_out-curve-1 lerp. See BALL_DARKNESS_TWEEN below.
  ball_darkness: 0.1467304745,
};

/** The in-flight `ball_darkness` lerp at frame 149 — 3 of its 32 frames gone. */
export const BALL_DARKNESS_TWEEN = { pointa: 0, pointb: 1, maxtime: 32, easetype: 1, time: 3 };

/**
 * The six stars of the PREVIOUS ring, measured at frame 149 and still in
 * flight when the scene starts. They have to be seeded or the live count is
 * short by six until they leave: the ring that fired them was before the
 * window, but a roaring star lives a long time — it is launched from 600px
 * off screen, accelerates inward on `friction = -0.1`, crosses the arena and
 * only despawns once `outbound` has been satisfied.
 *
 * Their `image_xscale` differs per star (2.98..3.62) because scale tracks how
 * long each has been alive, and the ring's six do not all clear the screen
 * edge on the same frame.
 */
export const PRE_RING_STARS = [
  { x: 806.3405151367, y: 350.9108276367, direction: 157.2832183838, image_xscale: 3.1702051163, outbound: true },
  { x: 339.2104797363, y: 638.690246582, direction: 92.6778106689, image_xscale: 2.9769322872, outbound: true },
  { x: -143.6675567627, y: 382.7382507324, direction: 27.7767887115, image_xscale: 3.1293876171, outbound: true },
  { x: -167.0648193359, y: -166.2927856445, direction: 327.9780578613, image_xscale: 3.4528710842, outbound: true },
  { x: 300.2961730957, y: -462.4585266113, direction: 272.2393493652, image_xscale: 3.6223413944, outbound: false },
  { x: 790.3001098633, y: -202.0553894043, direction: 216.6570587158, image_xscale: 3.4901416302, outbound: true },
];

/**
 * THE SHAKE TRIGGERS — the only recorded input this scene has besides the
 * frame-149 state, and they are DERIVED FROM THE RECORDING rather than tuned:
 * every frame where the logged view steps from 0 to 4 is a shake's first Step,
 * so the create is one frame earlier.
 *
 * Only the trigger is replayed. What the shake then DOES is entirely computed
 * (sim/shake.js): the alternating decay, the alarm phase, the camera restore
 * on destruction, and the resulting 4, -4, 3, -2, 0 — matched frame for frame.
 *
 * WHAT FIRES THEM IS STILL UNKNOWN, and two cheap hypotheses are already dead.
 * It is not a star reaching the knight (stars die near him 20 times over the
 * frames that hold 2 shakes) and it is not `obj_knight_circle` or the slash
 * (recorded at 411-421/462-472 and 752-764, nowhere near the shake frames).
 * Roaring never calls `scr_shakescreen` itself. The caller is not in the trace
 * at all because the universal recorder filters by an object-name list, so
 * finding it means another oracle run with that list widened — worth doing,
 * but it buys a trigger frame, not a mechanism, and the mechanism is the part
 * that moves the soul.
 */
export const SHAKE_FRAMES = [
  190, 221, 253, 285, 317, 350, 385, 419, 489, 522, 564, 595, 632, 663, 694,
];

/**
 * THE ROAR'S RNG, recovered from the recording.
 *
 * The roar phase rolls three kinds of dice, and these tables replay them so
 * the STRUCTURE around them can be computed and checked:
 *
 *   `8.5 + random(2)`    the eight-star burst at roaring_timer 9
 *   `60 + irandom(10)`   how far each three-star fan walks around the circle
 *   `6.5 + random(2)` / `8.5 + random(2)`   the fan's three speeds
 *
 * Everything else is derived, and that is the part worth verifying: the fan is
 * always `rand_angle`, `+20`, `-20`; the burst is always `a * 45`; the cadence
 * is always every 5 frames after roaring_timer 15. `rand_angle` itself is NOT
 * replayed — it accumulates out of the ring phase (197 degrees on entry, mod
 * 360) and each fan advances it by the recorded increment.
 *
 * Speeds are stored whole rather than as offsets from 6.5/8.5, so the value
 * reaching the f32 `speed` field is the recorded one and not a sum that has to
 * round back to it.
 *
 * The recorder lists instances NEWEST FIRST, so the raw rows for a fan read
 * [-20, +20, 0] and for the burst 315 down to 0. Both are un-reversed here.
 */
export const ROAR_BURST_SPEEDS = [
  9.5473899841, 8.5001726151, 9.9392652512, 8.5067749023,
  8.5587472916, 10.4729270935, 10.1363744736, 9.6587724686,
];

export const ROAR_FANS = [
  { rand: 5, s1: 7.1648645401, s2: 10.0277910233, s3: 9.9949522018 },
  { rand: 7, s1: 7.7410836220, s2: 9.5840072632, s3: 8.5686511993 },
  { rand: 10, s1: 8.0079107285, s2: 8.5412693024, s3: 9.3179588318 },
  { rand: 4, s1: 7.9697880745, s2: 9.3834266663, s3: 10.0589742661 },
  { rand: 4, s1: 7.9756007195, s2: 10.1033802032, s3: 10.3726387024 },
  { rand: 3, s1: 7.2965307236, s2: 8.8480796814, s3: 8.6669397354 },
  { rand: 3, s1: 8.4872217178, s2: 9.0886325836, s3: 8.9386587143 },
  { rand: 1, s1: 7.9204678535, s2: 9.0161008835, s3: 10.4353284836 },
  { rand: 10, s1: 6.7890543938, s2: 8.9948444366, s3: 8.6032505035 },
  { rand: 4, s1: 8.3778457642, s2: 10.1549720764, s3: 10.1506118774 },
  { rand: 7, s1: 6.8733253479, s2: 10.3620910645, s3: 8.8701629639 },
  { rand: 5, s1: 7.0694990158, s2: 9.3148384094, s3: 9.5460548401 },
  { rand: 8, s1: 6.5872378349, s2: 8.5666198730, s3: 9.6492595673 },
  { rand: 0, s1: 7.7805519104, s2: 9.7498188019, s3: 8.5585546494 },
  { rand: 5, s1: 6.7487959862, s2: 9.7397079468, s3: 9.4503831863 },
  { rand: 6, s1: 8.0310955048, s2: 10.0892438889, s3: 9.0645332336 },
  { rand: 10, s1: 6.8078651428, s2: 9.5609159470, s3: 10.3283882141 },
  { rand: 10, s1: 6.9097766876, s2: 10.3168935776, s3: 8.5188274384 },
  { rand: 6, s1: 7.1159596443, s2: 9.9533557892, s3: 8.7968215942 },
  { rand: 9, s1: 6.8535404205, s2: 10.2822141647, s3: 9.1459341049 },
  { rand: 4, s1: 7.3840765953, s2: 9.7958917618, s3: 9.0168266296 },
  { rand: 0, s1: 7.0437488556, s2: 10.3004446030, s3: 9.0978431702 },
  { rand: 5, s1: 7.7895860672, s2: 9.5712213516, s3: 10.2818832397 },
  { rand: 9, s1: 8.2478761673, s2: 9.1120433807, s3: 9.0575475693 },
  { rand: 0, s1: 7.0643410683, s2: 9.8026247025, s3: 8.8808403015 },
  { rand: 10, s1: 6.8364605904, s2: 8.9619731903, s3: 9.7604227066 },
  { rand: 8, s1: 7.7784304619, s2: 8.8112211227, s3: 9.2896747589 },
  { rand: 0, s1: 8.4866075516, s2: 9.8852701187, s3: 8.8207845688 },
  { rand: 0, s1: 7.5034246445, s2: 10.2000312805, s3: 8.9017839432 },
  { rand: 4, s1: 6.7733588219, s2: 9.7548446655, s3: 9.1740198135 },
];

export const SOUL_AT_START = { x: 310, y: 155.5500030518 };

export const ORACLE_PULL_INPUT = [{ from: 0 }];

export function buildOracleRoaringPullScene(state) {
  // THE ORACLE'S DAMAGE IS A PURE COUNTER. The universal harness replaces
  // obj_collidebullet's Other_15 with a hit recorder — no scr_damage, so no
  // party HP change, no dmgwriter, and NO obj_shake. The sim must mirror
  // that: scr_damage now spawns the screen shake (whole-fight f242 measured
  // the camera moving on a hit), and a scene that leaves damage live shakes
  // a camera the recording never shook — the tracking swords clamp to
  // cameray()+40/+320, so the divergence surfaced as sword_y, three rooms
  // away from its cause.
  state.damageEnabled = false;

  state.view = { x: 0, y: 0 };
  state.turntimer = 999;
  state.roarBurstSpeeds = ROAR_BURST_SPEEDS;
  state.roarFans = ROAR_FANS;
  state.roarFanIndex = 0;

  state.soul = spawn(state, soul, { ...SOUL_AT_START });

  const spawner = {
    name: 'roaring_pull_spawner',
    create(e) {
      e.done = false;
    },
    endStep(e, st) {
      if (SHAKE_FRAMES.includes(st.frame)) scrShakescreen(st);
      if (e.done || st.frame !== START_FRAME) return;
      const r = spawn(st, roaring2, { x: 320, y: 88 });
      Object.assign(r, ROARING_STATE);
      // Re-arm the tween itself, not just its current value: without it
      // ball_darkness would freeze at the seeded 0.1467 for the whole run.
      const tw = spawn(st, lerpvar, { x: 0, y: 0 });
      Object.assign(tw, BALL_DARKNESS_TWEEN, { target: r, varname: 'ball_darkness', init: 1 });

      for (const s of PRE_RING_STARS) {
        const d = spawn(st, roaringStar, { x: s.x, y: s.y });
        d.direction = s.direction;
        d.speed = 10.0320014954;
        d.friction = -0.1;
        d.image_xscale = s.image_xscale;
        d.image_yscale = s.image_xscale;
        d.outbound = s.outbound;
        d.spinspeed = 1;
      }

      e.done = true;
    },
  };
  spawn(state, spawner, {});
}
