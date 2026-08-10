// T3 scene: the soul, alone, walked into a wall.
//
// The wall is the view boundary, not an obj_battlesolid. That is deliberate —
// the boundary clamp is fully determined by the Step source (view origin, 640
// wide, sprite_width 20, so the soul stops with its left edge at x = 620),
// whereas obj_battlesolid depends on runtime-assigned masks and on GameMaker's
// inclusive-integer bbox semantics, which are still unverified. Wall-clamp
// first, solids once the oracle can arbitrate.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';

/**
 * @param {object} state
 * @param {{x?: number, y?: number}} start  initial soul position
 */
export function buildSoulWallScene(state, { x = 320, y = 160 } = {}) {
  state.hp = 90;
  state.invTimer = 0;
  state.phase = 'freemove';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;

  state.soul = spawn(state, soul, { x, y });
  return state;
}

// Hold right, forever. The soul should advance 4px/frame from 320 and stop
// dead at 620 — (320 + 640 - 20) with the view at origin.
export const HOLD_RIGHT = [{ from: 0, right: true }];

// Focus applied mid-travel, well before the wall, so the ceil() halving is
// visible as a change in speed rather than hidden behind the clamp. Focus is
// pressed at frame 20 — not held from frame 0 — because holding it at create
// time latches disableslow and the halving never engages at all.
export const HOLD_RIGHT_THEN_FOCUS = [
  { from: 0, right: true },
  { from: 20, right: true, focus: true },
];

// Down-right diagonal into the corner. Confirms the axes clamp independently
// and that neither is normalised.
export const DIAGONAL_INTO_CORNER = [{ from: 0, right: true, down: true }];
