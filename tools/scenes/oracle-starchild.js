// obj_knight_pointing_starchild, the HOMING path — against
// knight-research/traces/stars3.csv (Stars at difficulty 2, phase 3 turn 1).
//
// A focused scene: one child, reproduced from its recorded spawn state, plus a
// stand-in obj_heart_follower parked where the recording holds it. That
// isolates the con 1-4 state machine from the rest of the attack, so a failure
// names the child rather than the cone, the star or the spawn cadence.
//
// The child chosen is the first one the recording gives `difficulty = 2`. Its
// life:
//
//   f166  spawned, con 0, speed 4, direction 270, delay 26
//   f192  con 1 — the delay elapses; angle lerps toward the follower
//   f201  con 2 — direction commits, tracking turns on
//   f210  con 3 — accelerates toward speed 25
//
// THE FOLLOWER IS PARKED, not simulated. The recording holds it at (305,160)
// from frame 200 onward because the harness freezes the soul, and this window
// starts at 192. `heartFollower` itself (soft-follow at smoothing 0.125,
// max_speed 4) is translated in sim/attacks/pointing-starchild.js but is not
// what this suite is testing.
//
// `state.childDelay` is seeded to 1 so the child's own `delay` comes out at
// the recorded 26 (25 + the controller's running counter). The accumulator is
// exercised properly by the burst itself; here only its result matters.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { pointingStarchild } from '../../sim/attacks/pointing-starchild.js';

/** Oracle frame the child is created on. */
export const CHILD_SPAWN_FRAME = 166;

/** Its whole life, up to the last frame the recording has for it. */
export const CHILD_WINDOW = { from: 167, to: 225 };

/** Measured at spawn. */
export const CHILD_SPAWN = {
  x: 357.2452697754,
  y: 157.8948059082,
  direction: 270,
  speed: 4,
  difficulty: 2,
  deceleration: 0.15,
  minspeed: 1,
  lifetime: 60,
};

/** Where the recording holds obj_heart_follower through this window. */
export const FOLLOWER_POS = { x: 305, y: 160 };

export const ORACLE_CHILD_INPUT = [{ from: 0 }];

/** A follower that does not move — see the header. */
const parkedFollower = { name: 'obj_heart_follower' };

export function buildOracleStarchildScene(state) {
  // ORACLE PARITY. The universal harness replaces obj_collidebullet's Other_15
  // with a bare hit counter, so in the recording a contact does NOT destroy the
  // bullet or set inv — only the counter moves. `damageEnabled` defaults to
  // true (which is what the playable build wants), so scenes compared against a
  // universal-harness trace have to turn it off.
  //
  // This did not matter until bullets without an explicit `collides` started
  // using their sprite mask (sim/index.js): before that the starchild could
  // never make contact at all, so the difference was invisible.
  state.damageEnabled = false;
  state.view = { x: 0, y: 0 };
  state.turntimer = 300;

  settleBox(spawn(state, battlebox, { x: 320, y: 170 }));
  state.soul = spawn(state, soul, { x: 310, y: 160 });
  spawn(state, parkedFollower, { ...FOLLOWER_POS });

  // 25 + 1 = the recorded delay of 26.
  state.childDelay = 1;
  state.childSubdelay = 1;

  const spawner = {
    name: 'child_spawner',
    create(e) {
      e.done = false;
    },
    endStep(e, st) {
      if (e.done || st.frame !== CHILD_SPAWN_FRAME) return;
      const d = spawn(st, pointingStarchild, { x: CHILD_SPAWN.x, y: CHILD_SPAWN.y });
      d.direction = CHILD_SPAWN.direction;
      d.image_angle = CHILD_SPAWN.direction;
      d.speed = CHILD_SPAWN.speed;
      d.difficulty = CHILD_SPAWN.difficulty;
      d.deceleration = CHILD_SPAWN.deceleration;
      d.minspeed = CHILD_SPAWN.minspeed;
      d.lifetime = CHILD_SPAWN.lifetime;
      e.done = true;
    },
  };
  spawn(state, spawner, {});
}
