// Attack 4 oracle-comparison scene: obj_knight_rotating_slash, against
// knight-research/traces/t7-rotating.csv.
//
// Mirrors the oracle: soul frozen at (165,160), box at (320,170), and the
// attack created at trace frame 61 (the controller spawns it at 60, and it
// appears the frame after).
//
// TWO recorded inputs, both documented deviations rather than translation:
//
//   spin / random_offset — chosen by choose()/irandom() in the attack's
//     Create, far downstream of the tester's seed. Replaying them is cheaper
//     than reproducing thousands of intervening draws and verifies the same
//     mechanics.
//   ANGLE_LISTS — the shuffled fan orders. ds_list_shuffle's algorithm is
//     unsolved (16 draws per element; see CLAUDE.md), so the oracle's orders
//     are replayed verbatim. Everything around them is verified normally:
//     state timing, aim spin, lock-on, fan geometry, spawn positions.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox } from '../../sim/battlebox.js';
import { rotatingSlash } from '../../sim/attacks/rotating-slash.js';
import { gmlCreate } from '../../sim/rng.js';
import { real, int } from '../../sim/trace.js';

// One complete cycle: intro -> aim -> slash -> cooldown.
//
// The window stops at 118 for an honest reason. At frame 113 the ORACLE's
// soul snaps back to (165,160) — the tester's battle flow re-placing it, the
// same artifact that dogged the fight harness. That is harness behaviour, not
// fight behaviour, and it is not reproduced here. Since the aim state locks
// onto the soul, every cycle after the first inherits that discrepancy.
//
// What one cycle still pins: the full state machine and its timing, the spin
// direction and easing of `rotation`, lock-on, fan angle generation, and slash
// spawn cadence. Extending it needs an oracle run where the soul is pinned for
// the whole attack.
export const T7_WINDOW = { from: 62, to: 118 };
const SPAWN_FRAME = 61;

// Recorded from the oracle. `spin` is re-rolled by choose() on every entry
// into the aim state, so the whole sequence is replayed, not just the first.
const SPIN_SEQUENCE = [-1, -1, -1, 1, -1, -1, 1];
const RANDOM_OFFSET = 5;
const ANGLE_LISTS = [
  [-160],
  [-221, -311],
  [-72, -162],
  [-249, -309, -189],
  [-456, -396, -336],
  [-174, -264, -309, -219],
];

const spawner = {
  name: 't7_spawner',
  endStep(e, state) {
    if (state.frame !== SPAWN_FRAME) return;
    const knight = { x: 425, y: 79.81590270996094 };
    const rs = spawn(state, rotatingSlash, { x: knight.x, y: knight.y });
    rs.difficulty = 0;
    rotatingSlash.init(rs);
    rs.random_offset = RANDOM_OFFSET;
    state.rs = rs;
  },
};

export function buildOracleT7Scene(state) {
  state.hp = 0;
  state.invTimer = -1;
  state.phase = 'oracle';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.frame = 0;
  state.gmlRng = gmlCreate(4242);
  state.damageEnabled = false;
  state.rs = null;

  // Replay the recorded fans instead of shuffling, and the recorded spins.
  state.fixedSlashOrder = true;
  state.spinSequence = [...SPIN_SEQUENCE];
  state.spinIndex = 0;
  state.angleLists = ANGLE_LISTS.map((a) => [...a]);
  state.angleIndex = 0;

  spawn(state, battlebox, { x: 320, y: 170 });
  state.soul = spawn(state, soul, { x: 165, y: 160 });
  state.soul.canmove = 0; // frozen, as in the oracle run
  spawn(state, spawner);

  state.traceExtraHeader = ['state', 'rtimer', 'aimdir', 'rotation', 'slashnum', 'aimx', 'aimy', 'slashes'];
  state.traceExtra = (s) => {
    const rs = s.rs && s.rs.alive ? s.rs : null;
    const live = s.entities.filter(
      (x) => x.alive && x.type.name === 'obj_roaringknight_slash',
    ).length;
    if (!rs) return ['', '', '', '', '', '', '', int(live)];
    return [
      rs.state, int(rs.timer), real(rs.aim_direction), real(rs.rotation),
      int(rs.slash_number), real(rs.aim_x), real(rs.aim_y), int(live),
    ];
  };
  return state;
}

export const ORACLE_T7_INPUT = [{ from: 0 }];
