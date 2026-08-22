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

    if (!e.speed && !e.gravity) continue;
    state.counters.motionSteps += 1;

    // Decompose to components, add gravity, recompose — THE RUNNER'S WAY,
    // measured, not assumed. A direct probe of the runner (assign
    // speed/direction to an instance, read hspeed/vspeed back at 17 digits;
    // oracle_vspeed_probe.csx, plus a 720-point direction sweep) pinned the
    // exact derivation:
    //
    //   r  = f32( f32( f32(direction) * f32(pi) ) / 180 )   // SINGLE-PRECISION pi
    //   c  = cos(r); s = sin(r)                              // f64-grade trig
    //   if (|c| > 1 - SNAP_EPS) c = sign(c)                  // the SNAP: a hair
    //   if (|s| > 1 - SNAP_EPS) s = sign(s)                  //   from ±1 -> ±1
    //   hspeed = f32( f32(speed) *  f32(c) )
    //   vspeed = f32( f32(speed) * -f32(s) )
    //
    // Every piece is load-bearing and data-selected: the f32 pi radian is one
    // f32 ulp away from f32(d*PI/180) for ~30% of directions (sweep score
    // 719/720 vs 501/720); the chained-f32 product is what reproduces the
    // probe's own hspeed AND vspeed for the recorded stars (f(s*t) fails two
    // of them); the snap is why a 30-degree direction at speed 2 reads back
    // vspeed exactly -1. The remaining 1-in-720 sweep miss is an f64
    // rounding-boundary straddle between V8's cos and the runner's — odds
    // ~1e-8 per bullet, accepted.
    //
    // Getting this wrong is not cosmetic: the b1 star's vspeed differed by
    // 8e-6, which flipped a y-grid phase, then a graze at f217, then the
    // cone's turntimer release frame, then the star count of the turn — and
    // from there the RNG stream of every later Stars turn.
    // SNAP_EPS WAS 1e-4 AND THAT WAS 11 ORDERS TOO LOOSE. The snap exists so a
    // CARDINAL direction reads back exactly +/-1: the f32-pi radian puts
    // |cos(180 deg)| at 1 - 3.8e-15 rather than 1, and the runner returns the
    // clean value. That is the snap's entire data support -- and it does not
    // constrain the width at all, because over the 720-point integer sweep
    // that validated this block, 1e-4 and 1e-6 snap the SAME four directions
    // (0/90/180/270); the nearest integer miss, 1 deg, sits at 1 - 1.5e-4,
    // outside both. The width was simply never measured.
    //
    // At 1e-4 the window is +/-0.81 deg wide, so it swallowed real headings.
    // verify37's true first divergence was a Stars bullet at direction
    // 180.6504058838, where cos = -0.99993555: the sim snapped it to exactly
    // -1 and moved the star its FULL speed in x, while the oracle moved it by
    // speed * cos. That is a per-frame x excess of exactly 2^-11, growing
    // linearly, and it is why the star's y stayed bit-exact while its x
    // walked off -- a signature that is impossible for any (speed, direction)
    // pair, since it needs |cos| > 1.
    //
    // 1e-12 keeps three orders of headroom over the 3.8e-15 a true cardinal
    // needs, while narrowing the false-snap window to 8e-5 deg. The choice is
    // not fitted: 1e-6, 1e-9, 1e-12 and 1e-14 all put verify37's front at the
    // same frame (6832), the same plateau argument that pins the collision
    // walk's step density.
    const SNAP_EPS = 1e-12;
    const PI32 = Math.fround(Math.PI);
    const r = Math.fround(Math.fround(Math.fround(e.direction) * PI32) / 180);
    let rc = Math.cos(r);
    let rs = Math.sin(r);
    if (Math.abs(rs) > 1 - SNAP_EPS) rs = Math.sign(rs);
    if (Math.abs(rc) > 1 - SNAP_EPS) rc = Math.sign(rc);
    let hs = Math.fround(Math.fround(e.speed) * Math.fround(rc));
    let vs = Math.fround(Math.fround(e.speed) * -Math.fround(rs));

    if (e.gravity) {
      // The runner adds the gravity vector onto the STORED f32 components —
      // the vector derived by the same path as above, both sums narrowed.
      const gr = Math.fround(Math.fround(Math.fround(e.gravity_direction) * PI32) / 180);
      let gc = Math.cos(gr);
      let gsn = Math.sin(gr);
      // SAME SNAP_EPS as the direction vector above. These two were left at
      // 1e-4 when that one was tightened, and the half-fix is exactly what
      // verify37's next front was: a star whose speed reaches 0 arms
      // `gravity_direction = direction - 180`, so a heading of 180.6504 gives
      // a gravity direction of 0.6504 -- cos 0.99993555, inside the old
      // window. The sim accelerated it by a clean 0.1 in x while the oracle
      // used 0.1 * cos, and the two crept apart one f32 ulp at a time.
      if (Math.abs(gsn) > 1 - SNAP_EPS) gsn = Math.sign(gsn);
      if (Math.abs(gc) > 1 - SNAP_EPS) gc = Math.sign(gc);
      hs = Math.fround(hs + Math.fround(Math.fround(e.gravity) * Math.fround(gc)));
      vs = Math.fround(vs + Math.fround(Math.fround(e.gravity) * -Math.fround(gsn)));
      e.speed = Math.sqrt(hs * hs + vs * vs);
      let dir = (Math.atan2(-vs, hs) * 180) / Math.PI;
      if (dir < 0) dir += 360;
      e.direction = dir;
    }

    // No explicit fround: x/y are f32-narrowing accessors (see entity.js
    // F32_BUILTINS). Narrowing is structural so no call site can forget.
    e.x = e.x + hs;
    e.y = e.y + vs;
  }
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
    for (const b of [...state.entities].sort((a, z) => a.seq - z.seq)) {
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
