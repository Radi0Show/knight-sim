// Public surface of sim/.
//
// Rule: nothing in this directory touches the DOM, a canvas, a timer, the
// keyboard, or the filesystem. It is a pure function of (state, input) that
// advances exactly one frame. That is what makes verification a plain Node
// script instead of a browser session with a human watching.

import { runPhase, runAlarms, reap } from './entity.js';
import { traceRow } from './trace.js';
import { spriteMaskHit, SPRITE_MASKS, masksOverlap, GRAZE_MASK, grazeMaskAt } from './masks.js';
import { stepGraze } from './tension.js';
import { freshParty, scrRevive } from './damage.js';
import { stepDmgNumbers, stepHealWriters} from './dmgnumbers.js';
import { rngNext } from './rng.js';

export { createState } from './state.js';
export { spawn, destroy, ALARM_COUNT } from './entity.js';
export { traceHeader, traceRow, real, int } from './trace.js';
export { createRng, rngNext, rngRandom, rngIrandom, rngRange, rngChoose, rngSnapshot, rngRestore } from './rng.js';
export { FPS, MS_PER_FRAME, drain } from './clock.js';

/**
 * Phase order for one frame. Rule 5 — this is the whole point of the module.
 *
 * GameMaker's order is Begin Step, then Alarms, then Step, then Collision
 * events, then End Step. Collapsing any two of these, or turning an alarm
 * into a countdown checked inside Step, moves behaviour by exactly one frame.
 *
 * Concretely: `scr_heartclamp` is called from obj_roaringknight_slash's End
 * Step, after obj_heart's Step has already moved and collision-resolved the
 * soul. Run the clamp in Step and the soul sits somewhere else for a frame.
 * And a bullet hit registers in the heart's Collision event (which just does
 * `with (other) event_user(5)`) — after the move, before the clamp.
 */
export const PHASES = ['animation', 'beginStep', 'alarm', 'step', 'motion', 'collision', 'endStep'];

/**
 * GameMaker's built-in motion, applied between the Step event and Collision
 * events (the manual's documented order: "normal step — instances are
 * moved"). Entities opt in with `builtinMotion: true` and plain `speed` /
 * `direction` fields (degrees, CCW on screen).
 *
 * FRICTION is applied here, before the position update, matching the
 * runner's move step. GML semantics: friction reduces speed MAGNITUDE and
 * clamps at zero on crossing — so a NEGATIVE friction accelerates, which is
 * exactly how the splitter's teeth speed up (friction -0.2 / -0.05).
 * Verified against traces/t6-splitter.csv.
 *
 * GRAVITY, added for the Stars attack. GameMaker's move step is, in order:
 * apply friction to the speed MAGNITUDE, then add the gravity vector to
 * hspeed/vspeed, then move. Because gravity is a vector it can change
 * DIRECTION as well as speed, so speed/direction are recomputed from the
 * resulting components rather than treated as independent.
 *
 * Envelope: speed, direction, friction, gravity, gravity_direction. Still no
 * direct hspeed/vspeed writes — extend against an oracle trace when needed.
 *
 * FLOAT32: every built-in field narrows on store (entity.js F32_BUILTINS,
 * measured by oracle_f32_probe). Arithmetic here is f64; the narrowing
 * happens in the field setter.
 */
function runMotion(state) {
  state.eventPhase = 'motion';

  for (const e of state.entities) {
    if (!e.alive) continue;

    // A type-level motion handler, for state that must change after every
    // step but before any collision: the soul's inv decrement lives here
    // (sim/soul.js — the runner's newest-first stepping puts the heart's
    // decrement after attack-step damage, and this slot reproduces that
    // without reordering the sim's step phase).
    if (e.type.motion) e.type.motion(e, state);

    // COMPONENT MOTION. GameMaker's real state is hspeed/vspeed; speed and
    // direction are derived views of them. Most translated objects set
    // speed/direction, but obj_diagonal_bullet assigns hspeed and vspeed
    // directly, and routing that through speed*cos(direction) would move it by
    // -4.999999... instead of exactly -5 every frame.
    //
    // So entities that opt in move by their components, and speed/direction
    // are computed FROM them for anything that reads those (and for the
    // trace) — which is the direction GameMaker itself derives.
    if (e.componentMotion) {
      if (!e.hspeed && !e.vspeed) continue;
      state.counters.motionSteps += 1;
      e.x = e.x + e.hspeed;
      e.y = e.y + e.vspeed;
      e.speed = Math.sqrt(e.hspeed * e.hspeed + e.vspeed * e.vspeed);
      let dir = (Math.atan2(-e.vspeed, e.hspeed) * 180) / Math.PI;
      if (dir < 0) dir += 360;
      e.direction = dir;
      continue;
    }

    if (!e.builtinMotion) continue;

    if (e.friction) {
      if (e.speed > 0) {
        e.speed = e.speed - e.friction;
        if (e.speed < 0) e.speed = 0;
      } else if (e.speed < 0) {
        e.speed = e.speed + e.friction;
        if (e.speed > 0) e.speed = 0;
      }
    }

    // ── THE RUNNER'S MOVE STEP, MEASURED END TO END ─────────────────────────
    //
    // MOTION PROBE, 2026-09-08 (knight-research/kaizo-mod/probes/
    // kaizo_oracle_motion.csv, patch tools/patches/oracle_motion_probe.csx;
    // scorer tools/fit-motion.mjs, written BEFORE the data existed): 237 bare
    // obj_marker instances of the real runtime, each assigned a speed,
    // direction, gravity and gravity_direction -- gravity 0.4 @ 180 over
    // headings 190..215 and speeds 0.5..20.42, gravity 0.1 (the Stars regime),
    // the cardinal gravity directions, gravity-0 controls -- and logged every
    // frame for 80 frames at 17 decimal places: 18,960 rows, 18,723
    // integration steps, each a (pre, post) pair a model must reproduce in
    // ALL of hspeed, vspeed, speed, direction, x and y at f32 exactness.
    //
    //   model                                    pairs reproduced
    //   shipped (this block before today)           674 / 18723    3.60%
    //   refuted-f64-components (ledger:3520)        327             1.75%
    //   refuted-f64-sum-narrowed-once               609             3.25%
    //   refuted-whole-tail-narrowed                 639             3.41%
    //   refuted-pi32-divide                         676             3.61%
    //   refuted-f64-atan2 (the pre-09-04 tail)      669             3.57%
    //   components-primary                         9743            52.04%
    //   redecompose-fixup                          1101             5.88%
    //   runner-f32chain (no fix-up)               18483            98.72%
    //   runner-fixup-1e-5                         18524            98.94%
    //   runner-fixup  -- THIS BLOCK               18723           100.00%
    //
    // Four facts, each fitted on its own sub-step against the recorded post
    // state and only then composed (a model that fits the frame that found
    // it is not a measurement -- ledger:3494):
    //
    // 1. hspeed AND vspeed ARE THE STATE. The old block rebuilt them from
    //    (speed, direction) every frame, which launders a drifting component
    //    through a narrowed polar pair: vspeed came back right on 1,481 of
    //    18,723 steps. The runner keeps the components and touches them only
    //    on an ASSIGNMENT of speed or direction (GameMaker's setter derives
    //    them then); entity.js raises `motionPolarWritten` from those two
    //    accessors and this block re-derives only while it is up. Under
    //    gravity 0.4 @ 180 vspeed climbs one f32 ulp a frame -- sin of the
    //    f32 radian of 180 deg is -8.74e-8, times 0.4 is more than half an
    //    ulp at 0.52 -- and only a kept component can do that.
    // 2. THE GRAVITY ADD is the f32-pi radian chain, f64 trig narrowed, f32
    //    product, f32 sum: 0 misses on 18,012 gravity steps (a single
    //    FMA-style rounding misses 10, an f64 radian 15,940). No snap and no
    //    fix-up on the add itself: a component of -6.4e-5 survives it.
    // 3. THE RECOMPOSITION IS ALL-f32 ARITHMETIC, THEN AN INTEGER FIX-UP.
    //    speed = sqrt(f32(f32(hs*hs) + f32(vs*vs))) narrowed; direction =
    //    f32(f32(f32(atan2(-vs, hs)) * 180) / f32(pi)), every operation in
    //    single precision (the old f64 sqrt: 12,234 right; f32(atan2) then
    //    f64 degrees, the half MEASURED at oracle f6604: 8,485; the f32
    //    chains: 18,674 and 18,511). The remaining 49 speeds and 212
    //    headings are exactly the cases whose recomposed value lies within
    //    1e-4 of an integer, and the recording holds the INTEGER: 13.999933
    //    -> 14, 180.99991 -> 181, 6.4e-5 -> 0. The window is bounded by the
    //    data -- snapped values up to 9.92e-5 away, unsnapped from 2.1e-4;
    //    GML's documented 1e-5 epsilon is refuted (18,524). Fix-up-then-wrap
    //    and wrap-then-fix-up are not separable on this probe (no heading
    //    recomposes within 1e-4 of 0 there); the runner's own wrap is a
    //    single-precision + 360.
    // 4. THE SAME FIX-UP IS ON THE ASSIGNMENT PATH. The 237 creation rows
    //    (direction then speed assigned, components read back) store hspeed
    //    exactly -1 for speed 1 at 180.6504 (cos is -0.99993557) and an exact
    //    0 for the cardinals (cos of the f32 radian of 90 deg is -4.37e-8):
    //    the old decomposition gets 230 of them, the fix-up all 237. This is
    //    what SNAP_EPS was approximating all along. At speed 1 a 1e-4 snap
    //    on the TRIG VALUE and a 1e-4 fix-up on the PRODUCT coincide -- which
    //    is why 1e-4 scored 719/720 on the speed-1 direction sweep -- and at
    //    speed 9.67 they do not, which is why verify37's star at 180.6504
    //    walked off (9.67 * 0.99993555 is nowhere near an integer, so the
    //    runner leaves it alone; the trig snap moved it a full 2^-11 a
    //    frame). The 1e-12 snap that replaced it was a no-op: an f32 cannot
    //    hold 1 - 3.8e-15, so narrowing the trig value already returns the
    //    clean +/-1. Both are gone; the fix-up is the mechanism. The sweep's
    //    one residual miss (163.123 deg) stays: cos64 there sits 2.9e-8 from
    //    BOTH f32 neighbours, a rounding tie that neither V8 nor the UCRT's
    //    cos or cosf resolves the runner's way. Accepted, as before.
    //
    // The position update is x += hspeed, y += vspeed with the POST-gravity
    // components, through the f32 accessors: 0 misses on all 18,723 steps.
    // Friction ahead of gravity is the order this block always had; the probe
    // ran with friction 0 and cannot order the two, and no vanilla or kaizo
    // object runs both at once.
    //
    // NOT MODELLED HERE: a GML write to hspeed or vspeed on a built-in-motion
    // instance (GameMaker then recomposes speed/direction the way fact 3
    // does). setMotionComponents below is that write; the revised tunnel's
    // `vspeed = dorifto` and its hold's `hspeed *= 0.9` are its callers-to-be
    // (vanilla's copy still lands those on a dead property).
    let hs;
    let vs;
    if (e.motionPolarWritten !== false) {
      // Fact 4: the assignment path. speed/direction were assigned (or this
      // is the instance's first step): derive the components afresh.
      const r = Math.fround(Math.fround(Math.fround(e.direction) * PI32) / 180);
      hs = fixupInteger(Math.fround(Math.fround(e.speed) * Math.fround(Math.cos(r))));
      vs = fixupInteger(Math.fround(Math.fround(e.speed) * -Math.fround(Math.sin(r))));
    } else {
      // Fact 1: the kept state.
      hs = e.motionHspeed;
      vs = e.motionVspeed;
    }

    if (!e.gravity && hs === 0 && vs === 0) {
      // Nothing moves. An assigned speed of 0 derives components of exactly
      // +/-0, so this is the old `!speed && !gravity` skip for every case
      // the probe saw; a kept sub-1e-4 component (fact 3 reads it as speed
      // 0) keeps moving, as the runner's x += hspeed would.
      e.motionHspeed = hs;
      e.motionVspeed = vs;
      e.motionPolarWritten = false;
      continue;
    }
    state.counters.motionSteps += 1;

    if (e.gravity) {
      // Fact 2: the gravity vector, by the same chain, onto the components.
      const gr = Math.fround(Math.fround(Math.fround(e.gravity_direction) * PI32) / 180);
      hs = Math.fround(hs + Math.fround(Math.fround(e.gravity) * Math.fround(Math.cos(gr))));
      vs = Math.fround(vs + Math.fround(Math.fround(e.gravity) * -Math.fround(Math.sin(gr))));
      // Fact 3: the recomposition, all-f32, fixed up.
      e.speed = fixupInteger(Math.fround(Math.sqrt(Math.fround(Math.fround(hs * hs) + Math.fround(vs * vs)))));
      let dir = fixupInteger(Math.fround(Math.fround(Math.fround(Math.atan2(-vs, hs)) * 180) / PI32));
      if (dir < 0) dir = Math.fround(dir + 360);
      e.direction = dir;
    }

    e.motionHspeed = hs;
    e.motionVspeed = vs;
    // The stores above are the runner's own recomposition, not an assignment.
    e.motionPolarWritten = false;

    // No explicit fround: x/y are f32-narrowing accessors (see entity.js
    // F32_BUILTINS). Narrowing is structural so no call site can forget.
    e.x = e.x + hs;
    e.y = e.y + vs;
  }
}

const PI32 = Math.fround(Math.PI);

/**
 * THE RUNNER'S INTEGER FIX-UP (runMotion, facts 3 and 4): a value the runner
 * RECOMPOSES -- speed and direction from the components, the components from
 * an assigned (speed, direction) -- is stored as the nearest integer when it
 * lies within 1e-4 of one. Measured on the motion probe: snapped values sit
 * up to 9.92e-5 from the integer, unsnapped ones from 2.1e-4; 1e-5 misses
 * 199 pairs. Never applied to the gravity add. Math.round keeps the sign of a
 * tiny negative (-4.37e-8 -> -0), which is what the direction wrap and the
 * f32 accessors expect.
 */
function fixupInteger(v) {
  const r = Math.round(v);
  return Math.abs(v - r) < 1e-4 ? r : v;
}

/**
 * The components a built-in-motion entity will move by on its next step: the
 * kept state, or -- after an assignment of speed/direction -- the derivation
 * runMotion is about to make. What a GML read of hspeed/vspeed returns.
 */
export function motionComponents(e) {
  if (e.motionPolarWritten !== false) {
    const r = Math.fround(Math.fround(Math.fround(e.direction) * PI32) / 180);
    return [
      fixupInteger(Math.fround(Math.fround(e.speed) * Math.fround(Math.cos(r)))),
      fixupInteger(Math.fround(Math.fround(e.speed) * -Math.fround(Math.sin(r)))),
    ];
  }
  return [e.motionHspeed, e.motionVspeed];
}

/**
 * GML `hspeed = a; vspeed = b` on a built-in-motion entity: the components
 * become the state and speed/direction are recomposed from them the way the
 * move step does (runMotion fact 3). GameMaker documents the recompose on
 * either assignment; the arithmetic is the probe's, the routing is the
 * runtime's documented behaviour, not a separate measurement. Write one
 * component by reading the other from motionComponents first. No vanilla
 * caller yet: the revised tunnel's `vspeed = dorifto` and `hspeed *= 0.9`
 * still land on a dead property in sim/attacks/sword-tunnel-revised.js.
 */
export function setMotionComponents(e, hs, vs) {
  hs = Math.fround(hs);
  vs = Math.fround(vs);
  e.motionHspeed = hs;
  e.motionVspeed = vs;
  e.speed = fixupInteger(Math.fround(Math.sqrt(Math.fround(Math.fround(hs * hs) + Math.fround(vs * vs)))));
  let dir = fixupInteger(Math.fround(Math.fround(Math.fround(Math.atan2(-vs, hs)) * 180) / PI32));
  if (dir < 0) dir = Math.fround(dir + 360);
  e.direction = dir;
  e.motionPolarWritten = false;
}

/**
 * Does this bullet overlap the graze box?
 *
 * Uses the SAME rotated-mask test as the hit check, against a solid 50x50 mask
 * for the box. The first version compared axis-aligned bounding boxes and it
 * did not work: the tracking swords' slash is a 900x1 bar drawn at 45 degrees,
 * and an unrotated bbox for it is a horizontal strip 1800 wide and 2 tall — it
 * missed the soul entirely, so the whole attack paid no TP. Inflating the bbox
 * to the rotated extent would have been worse than useless in the other
 * direction: that bar's rotated AABB is a 1800px diamond that would "graze"
 * from most of the screen.
 *
 * Long thin rotated bullets are most of this fight, so the graze needs the real
 * shape, not a cheap approximation of it.
 */
function grazes(e, gx, gy, sizeFactor = 1) {
  const mask = e.mask ?? SPRITE_MASKS[e.sprite_index] ?? null;
  if (!mask) return false;
  // The box is drawn AND tested at `grazesizefactor` — see grazeMaskAt.
  return masksOverlap(
    grazeMaskAt(sizeFactor), gx, gy,
    mask, e.x, e.y, e.image_xscale ?? 1, e.image_yscale ?? 1, e.image_angle ?? 0,
  );
}

function runCollisions(state) {
  state.eventPhase = 'collision';
  const heart = state.soul;
  if (!heart || !heart.alive) return;

  // THE GRAZE BOX IS ONE FRAME BEHIND THE HEART. obj_grazebox repositions in
  // its END STEP (`x = obj_heart.x + 10`), and GameMaker runs collision
  // events BEFORE End Steps — so the box a bullet collides with this frame
  // sits where the heart was LAST frame. Using the live position made the
  // sim's box lead the game's by one movement step (4px at full speed),
  // which the whole-fight diff caught as a graze at f156 that the recording
  // never pays: the sim clipped a passing star the real box never reaches.
  //
  // `grazePrev` is refreshed after the collision phase each frame, and
  // seeded from the heart's spawn position the frame it is born.
  if (!state.grazePrev) state.grazePrev = { x: heart.x + 10, y: heart.y + 10 };

  // GRAZE BEFORE DAMAGE — measured, and a RETRACTION of the opposite order.
  //
  // Within one frame the game runs obj_grazebox's collision events before
  // obj_heart's. The proof is one bullet doing both: fullfight-verify21b's
  // star ref 110101 approaches the soul, and on the frame it CONNECTS the
  // oracle's tension ledger (scr_tensionheal instrumented) records its +1/15
  // trickle with global.inv still at -133 — the hit's inv = 30 lands after.
  // With damage first, the sim set inv = 30 and the graze gate
  // (`global.inv < 0`) ate that trickle, leaving tension 1/15 short from
  // f217 on — and the turn timer one graze-reduction short, which pushed the
  // cone's star release a frame late and desynced the turn's star count.
  //
  // The comment that used to justify damage-first cited a measurement "at
  // whole-fight f201": the oracle setting inv with no tension change on the
  // same frame. That reading predates the turn-machinery alignment fixes —
  // the two traces were a frame apart at the time, and the "no tension
  // change" frame was not the hit frame at all. One further trap fixed the
  // ledger itself: `global.oracle_frame` is stamped in obj_time's DRAW, so
  // every step/collision-phase log line carries the PREVIOUS frame's label;
  // the f216-labelled trickle IS the f217 payment.
  // ...WITH A CATCH-UP CAVEAT for bullets born THIS frame. Two receipts
  // from the same recording, contradictory under any single order:
  //
  //   f217: star 110101 (alive since f134) pays its trickle at inv -133,
  //         then its own hit sets inv 30 — graze BEFORE damage;
  //   f494: the tracking slash (created during f494's step phase) hits
  //         first (inv 12) and its graze event logs BLOCKED at 12 —
  //         damage BEFORE graze, same frame, same bullet.
  //
  // The order that satisfies both: instances alive at frame start run in
  // the graze-then-damage order; instances created mid-frame get their
  // collision events in a catch-up pass afterwards, hit first. So the
  // phases here are [graze(old)] [damage(old)] [damage(new)] [graze(new)].
  // THE GRAZE<->HIT ORDER IS PER-TURN STATE, NOT A CONSTANT. Two receipts,
  // same object class, opposite orders, both colseq-pinned (the shared
  // counter both collision logs bump):
  //
  //   f217  (turn 1): star 110101 — graze colseq 64, hit colseq 65: the
  //         trickle pays at inv -133 and the hit's 30 lands after, ON THE
  //         SAME row (inv 30 AND tension +1/15 both at row 217);
  //   f2166 (turn 6): star 116362 — hit colseq 796, graze colseq 797: the
  //         graze logs global.inv already at 30 and pays nothing. The sim's
  //         fixed graze-first order paid a burst there and cut the turn
  //         clock one extra unit, pulling the cone's <=120 release to f2189.
  //
  // obj_grazebox is created in obj_heart's CREATE, both fresh each turn, so
  // no static rule orders the two instances' collision events — GameMaker's
  // instance-slot reuse decides, and the measured bit flips even mid-turn
  // (frames 216-218 graze-first, 219 hit-first, same star). The resolution
  // is not an order model here but the graze REPLAY carrying the gate's
  // input: each grazelog row logs the game's global.inv at that event, with
  // the frame's ordering already resolved, and stepGraze gates replayed
  // rows on the row's inv rather than the sim's phase-local clock. This
  // phase stays graze-first for the sim's own (free-play) semantics.
  const bornNow = (b) => b.bornFrame === state.frame;
  stepGraze(state, grazes, (b) => !bornNow(b));

  for (const pass of ['old', 'new']) {
    const want = pass === 'old' ? (b) => !bornNow(b) : bornNow;
    // NEWEST INSTANCE FIRST within a pass. MEASURED: the recorder's graze log
    // (obj_grazebox's collision event, one row per firing) lists a frame's
    // contacts in DESCENDING instance order -- kaizo _tok3 f884: sword 112609,
    // blade 112600, blade 112576 -- and obj_heart's collision event is the
    // same mechanism: the newest bullet, the sword, dealt that frame's hit and
    // the blades' events then saw global.inv already at 12. Iterating oldest
    // first handed the hit to a blade -- a target-4 bullet, one extra
    // scr_randomtarget_old draw -- and desynced the stream from there. The
    // same newest-first rule already holds for with() and the step phase
    // (sim/entity.js, STATUS.md "with iterates newest first"). Vanilla
    // whole-fight: unchanged (60/60) either way; kaizo byte gate: f900 -> f1142.
    for (const b of [...state.entities].sort((a, z) => z.seq - a.seq)) {
      if (!want(b)) continue;
      if (!b.alive || !b.isBullet || !b.type.other15) continue;
    if (b.maskOff) continue; // mask_index = spr_nomask
    // A type may override the test (rotated-rect probes, swept lines, the
    // splitslash's scr_precise_hit). Otherwise fall back to GameMaker's
    // default: `mask_index = -1`, collide with my own sprite.
    //
    // THAT FALLBACK IS NEW, and its absence was a silent hole. This used to be
    // `if (collides) {...}` with no else, so a bullet type that never defined
    // one was skipped entirely — no check, no hit, no complaint. Three attacks
    // in the real fight could not damage the player at all: the tracking
    // swords' slash, the starchildren, and the vortex swords.
    const collides = b.type.collides;
    let hit;
    if (collides) {
      state.counters.collisionChecks += 1;
      hit = collides(b, heart, state);
    } else {
      hit = spriteMaskHit(b, heart);
      if (hit === null) {
        // No override AND no registered mask: this bullet cannot ever hit.
        // Counted rather than ignored so a verifier can assert on it.
        state.counters.unmaskedBullets += 1;
        continue;
      }
      state.counters.collisionChecks += 1;
    }
    // KNIGHT_PAIR_DEBUG=obj_x KNIGHT_PAIR_FRAMES=a-b prints the pair test's exact
    // inputs (both masks, positions, angle, scales) and its answer for one
    // bullet type -- the sim-side mirror of a recording's hit for the offline
    // reproduction in sim/masks.js (the f921/f2343 receipts). Env-gated and
    // guarded like KNIGHT_HIT_DEBUG below; the browser build never sees it.
    // one bullet type -- KNIGHT_PAIR_DEBUG=obj_x, frames a-b via KNIGHT_PAIR_FRAMES.
    if (typeof process !== 'undefined' && process.env?.KNIGHT_PAIR_DEBUG && b.type.name === process.env.KNIGHT_PAIR_DEBUG) {
      const [pa, pb] = (process.env.KNIGHT_PAIR_FRAMES ?? '0-0').split('-').map(Number);
      if (state.frame >= pa && state.frame <= pb) console.error(`[pair] f=${state.frame} ${b.type.name} seq=${b.seq} b=(${b.x}, ${b.y}) a=${b.image_angle} xs=${b.image_xscale} ys=${b.image_yscale} sprite=${b.sprite_index} maskOff=${b.maskOff} heart=(${heart.x}, ${heart.y}) heartMask=${heart.mask?.name ?? '(default)'} hit=${hit}`);
    }
    if (hit) {
      state.counters.collisionHits += 1;
      // KNIGHT_HIT_DEBUG=1 prints every collision hit with the bullet's
      // exact state at test time — the sim-side mirror of the oracle's
      // hitlog (tools/patches/oracle_fullfight.csx). Env-gated and guarded
      // so the browser build never touches `process`.
      if (typeof process !== 'undefined' && process.env?.KNIGHT_HIT_DEBUG) {
        console.error(`[hit] f=${state.frame} ${b.type.name} (${b.x}, ${b.y})`
          + ` a=${b.image_angle} xs=${b.image_xscale} ys=${b.image_yscale}`
          + ` inv=${state.invTimer} soul=(${heart.x}, ${heart.y})`);
      }
      b.type.other15(b, state);
    }
    }
  }

  stepGraze(state, grazes, bornNow);

}

/**
 * Sprite animation. GameMaker advances image_index by image_speed once per
 * step, wrapping at the frame count — the engine does it, not the object, so
 * no translated Create/Step ever assigns it frame by frame.
 *
 * IT RUNS AT THE START OF THE FRAME, before Begin Step — measured, not
 * assumed. `obj_knight_rotating_slash` sets `image_speed = 0.5` in its Step on
 * one frame and the recording does not move `image_index` until the NEXT one;
 * advancing after the Step made it move a frame early. With the advance first,
 * image_index is exact against traces/rotating_d2.csv for 200 frames, and the
 * Animation End path that destroys obj_roaringknight_splitslash still passes.
 *
 * It lives in sim/ rather than render/ because it is real instance state: the
 * Animation End event fires from it (obj_roaringknight_splitslash destroys
 * itself that way), and a renderer that invented its own frame counter would
 * drift from the object's own `image_index` reads.
 *
 * `frameCount` comes from the scene/renderer via `state.spriteFrames`, a plain
 * name -> count map. sim/ must not read the filesystem, so it never loads the
 * manifest itself; with no map, animation simply does not advance and the
 * renderer falls back to frame 0.
 */
function runAnimation(state) {
  for (const e of state.entities) {
    if (!e.alive || !e.image_speed) continue;

    // ADVANCE EVEN WITHOUT A FRAME COUNT. `spriteFrames` comes from the sprite
    // manifest, which only the browser loads — so headless runs used to freeze
    // every animation, and any Step logic keyed off `image_index` (rotating
    // slash clamps it at 5) could never fire in a verifier. The count is only
    // needed to WRAP; advancing is not conditional on it.
    const n = state.spriteFrames?.[e.sprite_index] ?? 0;
    // GameMaker multiplies image_speed by the SPRITE's own playback rate; a
    // sprite authored at 6 fps in a 30 fps room advances 0.2 per step at
    // image_speed 1. `state.spriteRate` carries that, defaulting to 1.
    const rate = state.spriteRate?.[e.sprite_index] ?? 1;
    let idx = (e.image_index ?? 0) + e.image_speed * rate;
    if (n > 1 && idx >= n) {
      idx -= n;
      e.animationEnded = true;
    }
    e.image_index = idx;
  }
}

/**
 * Advance exactly one frame.
 *
 * @param {object} state  mutated in place and returned
 * @param {object} input  this frame's input state; sim never polls for it
 */
export function stepFrame(state, input) {
  // Last frame's mask survives the frame — the game's `_p()` accessors are
  // `mask[f] && !mask[f-1]`, and a menu reopening mid-fight needs f-1's mask
  // to seed its edge map (sim/menu.js openMenu).
  state.prevInput = state.input;
  state.input = input;
  // inv as of frame START — knight-side objects (the tracking slash's graze
  // band, measured at f508) test `global.inv < 0` before obj_heart's own
  // step decrements it, so a same-frame crossing must not fire them.
  state.invAtFrameStart = state.invTimer;

  // GameMaker latches xprevious/yprevious at the TOP of every frame, before any
  // event runs, so during a Step they hold where the instance was last frame.
  // obj_sword_tunnel_sword's Draw builds its motion trail by lerping between
  // them and the current position — a corridor sword with no xprevious draws
  // ten stacked copies of itself instead of a streak.
  for (const e of state.entities) {
    if (!e.alive) continue;
    e.xprevious = e.x;
    e.yprevious = e.y;
  }

  // `i_ex(obj_knight_roaring2)` — HoldBreath's bump to soul speed 6 is gated
  // on Roaring being on screen, so the flag has to track the object's life
  // rather than being set once when the attack launches.
  state.roaringActive = state.entities.some(
    (e) => e.alive && e.type.name === 'obj_knight_roaring2',
  );

  runAnimation(state);
  runPhase(state, 'beginStep');
  runAlarms(state);
  // THE SOUL'S PRE-STEP POSITION, for attack steps that read obj_heart
  // mid-frame. The runner steps newest-first, so an attack object created
  // during the turn reads the soul BEFORE it has moved this frame — the
  // tunnel sword's swept probe (verify21i f1486) connects against exactly
  // that stale position. Same compensation family as grazePrev.
  state.soulPrev = state.soul && state.soul.alive
    ? { x: state.soul.x, y: state.soul.y }
    : null;
  runPhase(state, 'step');
  runMotion(state);
  runCollisions(state);
  runPhase(state, 'endStep');
  // THE DRAW SLOT. GameMaker runs every Draw event after every End Step, and
  // some objects do STATE work in Draw that everything else reads a frame
  // later: obj_knight_enemy's bob (`siner2++; y = ystart + cos(siner2/8)*8`,
  // Draw_0:1-4) is the one that mattered. With the bob in endStep, an
  // entity that sorts after the knight there -- the kaizo director -- launched
  // an attack at the knight's ALREADY-BOBBED y, where the mod's Step created
  // it at the previous Draw's. Measured (kaizo_oracle_probe f791/f792 against
  // the sim's launch): the swordfall manager was born 0.5414 px low, and
  // every sword it made carried that. Types that need Draw-time state
  // declare `draw(e, state)`; nothing visual happens here.
  runPhase(state, 'draw');

  // THE FRAME'S END SLOT — the dmg writers' draw pass. Their one-shot throw
  // roll must land after every end-step consumer of the same frame (the
  // slash jitter, the tunnel boundary rolls, the star chain); see the
  // ledger header over stepDmgNumbers.
  stepDmgNumbers(state, state.rng ? () => rngNext(state.rng) : undefined);
  // obj_healwriter: no delay, no RNG, rises and fades on its own. Frame-level
  // like its owner instance in the game, so it keeps moving while the menu is
  // open — which is when items are actually used.
  stepHealWriters(state);
  // obj_returnheart: `move_towards_point(distx, disty, dist / flytime)` with
  // flytime 8 — a CONSTANT speed set once at creation, so it covers an eighth
  // of the original distance every frame and arrives on frame 8, where
  // alarm[0] snaps it to the target and swaps it for obj_heartburst.
  // Frame-level because it outlives the turn that made it.
  const rh = state.returnHeart;
  if (rh) {
    rh.t += 1;
    const p = Math.min(1, rh.t / rh.flytime);
    rh.x = rh.x + (rh.tx - rh.x) * (1 / Math.max(1, rh.flytime - rh.t + 1));
    rh.y = rh.y + (rh.ty - rh.y) * (1 / Math.max(1, rh.flytime - rh.t + 1));
    if (p >= 1) {
      // `x = distx; y = disty; instance_create(x, y, obj_heartburst);`
      state.returnHeart = null;
      state.heartBurst = { x: rh.tx, y: rh.ty, burst: 0 };
    }
  }
  // obj_heartburst's Draw is its whole life: `burst += 1` and out at > 10.
  if (state.heartBurst) {
    state.heartBurst.burst += 1;
    if (state.heartBurst.burst > 10) state.heartBurst = null;
  }

  // obj_grazebox's End Step: the box moves to the heart NOW, after this
  // frame's collisions already tested against where it was. See runCollisions.
  if (state.soul && state.soul.alive) {
    state.grazePrev = { x: state.soul.x + 10, y: state.soul.y + 10 };
  } else {
    state.grazePrev = null;
  }

  // Destroyed entities disappear before the row is written, matching GML
  // instance_destroy() taking effect immediately.
  reap(state);

  // KEEP-ALIVE PARITY WITH THE ORACLE RECORDER. The whole-fight patch pins
  // the party at max HP inside its per-frame recorder, BEFORE the row is
  // composed — so a hit frame's row already shows full HP again. A tool that
  // refilled after stepFrame returned left the drop visible in the row it had
  // just captured, which the differ read as a real hp divergence on the first
  // landed hit (f201). The refill lives here, in the same position relative
  // to the row write as the oracle's. Damage itself still ran — inv, hurt,
  // dmgwriter, TP all keep their effects; only the resulting HP is unpinned.
  if (state.keepAlive) {
    state.partyHp = freshParty();
    // AND STAND THEM BACK UP. The oracle patch pairs its HP refill with
    // scr_revive per slot precisely because HP alone leaves them swooned —
    // full health, no menu, no attacks, and Kris the only one still fighting
    // (CLAUDE.md, "Restoring HP does not stand anyone up").
    for (let i = 0; i < 3; i++) scrRevive(state, i);
    state.gameOver = false;
  }

  state.trace.push(traceRow(state));
  state.frame += 1;

  return state;
}

/** Run `frames` frames, pulling input from `inputAt(frame)`. */
export function runFrames(state, frames, inputAt) {
  for (let i = 0; i < frames; i++) {
    stepFrame(state, inputAt(state.frame));
  }
  return state;
}
