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
    //   if (|c| > 1 - 1e-4) c = sign(c)                      // the SNAP: within
    //   if (|s| > 1 - 1e-4) s = sign(s)                      //   1e-4 of ±1 -> ±1
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
    const PI32 = Math.fround(Math.PI);
    const r = Math.fround(Math.fround(Math.fround(e.direction) * PI32) / 180);
    let rc = Math.cos(r);
    let rs = Math.sin(r);
    if (Math.abs(rs) > 1 - 1e-4) rs = Math.sign(rs);
    if (Math.abs(rc) > 1 - 1e-4) rc = Math.sign(rc);
    let hs = Math.fround(Math.fround(e.speed) * Math.fround(rc));
    let vs = Math.fround(Math.fround(e.speed) * -Math.fround(rs));

    if (e.gravity) {
      // The runner adds the gravity vector onto the STORED f32 components —
      // the vector derived by the same path as above, both sums narrowed.
      const gr = Math.fround(Math.fround(Math.fround(e.gravity_direction) * PI32) / 180);
      let gc = Math.cos(gr);
      let gsn = Math.sin(gr);
      if (Math.abs(gsn) > 1 - 1e-4) gsn = Math.sign(gsn);
      if (Math.abs(gc) > 1 - 1e-4) gc = Math.sign(gc);
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
  stepGraze(state, grazes);

  for (const b of [...state.entities].sort((a, z) => a.seq - z.seq)) {
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
      b.type.other15(b, state);
    }
  }

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
  runPhase(state, 'step');
  runMotion(state);
  runCollisions(state);
  runPhase(state, 'endStep');

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
