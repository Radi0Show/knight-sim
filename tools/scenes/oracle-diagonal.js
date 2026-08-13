// DIAGONAL BULLETS (ac 12, dc.type 152) — against
// knight-research/traces/diagonal.csv, recorded with
// `tools/oracle-run.sh 1 6 diagonal frames=320`.
//
// Pins the wave cadence (`rate` 44 decaying by 4 to a floor of 8), the 24-wide
// wall geometry including the 1044px shift on an upward slant, and every
// bullet's component motion and alpha fade.
//
// ONE RECORDED INPUT: the per-wave `choose(+6, -6)`. It is one draw per wave
// and it decides the whole wall's slant. Replayed rather than re-rolled, for
// the usual reason — the stream has already been consumed by the knight's own
// setup by the time the manager exists.
//
// This scene is also the acceptance test for `componentMotion` (sim/index.js):
// the bullets write hspeed/vspeed directly, and they must move exactly -5/+6
// per frame rather than the -4.99999... that speed*cos(direction) produces.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { diagonalBulletManager } from '../../sim/attacks/diagonal-bullets.js';

export const MANAGER_FRAME = 13;

/** Seven waves. Ends before the trace's own turn wind-down. */
export const DIAGONAL_WINDOW = { from: 13, to: 230 };

/** Measured, in wave order. See the note above. */
export const DIAGONAL_FLIPS = [6, -6, -6, 6, -6, -6, 6, -6, -6, -6, -6, -6];

const BOX = { x: 320, y: 170 };
const SOUL_START = { x: 310, y: 160 };

export const ORACLE_DIAGONAL_INPUT = [{ from: 0 }];

const spawner = {
  name: 'diagonal_spawner',
  create(e) {
    e.done = false;
  },
  endStep(e, state) {
    if (e.done || state.frame !== MANAGER_FRAME) return;
    spawn(state, diagonalBulletManager, { x: BOX.x, y: state.view.y });
    e.done = true;
  },
};

export function buildOracleDiagonalScene(state) {
  state.view = { x: 0, y: 0 };
  state.turntimer = 300;

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, spawner, {});

  state.diagonalFlips = DIAGONAL_FLIPS;
  state.diagonalIndex = 0;
}
