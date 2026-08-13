// SWORD VORTEX (ac 15, dc.type 154) — against
// knight-research/traces/vortex.csv, recorded with
// `tools/oracle-run.sh 2 4 vortex frames=320`.
//
// Pins the six-sword orbit: the paired spawn cadence, the setdirection table,
// each sword's inward-facing spin (which speeds up as the radius shrinks), the
// shared sine breathing of the radius, and the centre's 60-frame drift.
//
// ONE RECORDED INPUT: the centre's drift target, `irandom(120)` twice every 60
// frames. Everything else is computed — including the sword headings, which
// come from the setdirection table rather than the `choose` (the choose is
// rolled and discarded for all six swords; the draw is still taken).
//
// ac 15 also fires type 151 on top of this. The tracking swords are verified
// separately (verify-tracking) and are deliberately absent here so a failure
// points at one attack.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { swordVortexManager } from '../../sim/attacks/sword-vortex.js';

export const MANAGER_FRAME = 13;
/**
 * Ends at 185 for a measured reason: `global.turntimer` crosses zero on frame
 * 190 and the battle controller's end-of-turn cleanup destroys every live
 * bullet. That is turn-system machinery, which this project does not model
 * (CLAUDE.md: dodge-only) — the same boundary verify-tracking runs into. The
 * oracle still shows all six swords alive at 189.
 */
export const VORTEX_WINDOW = { from: 13, to: 185 };

const BOX = { x: 320, y: 170 };
const SOUL_START = { x: 310, y: 160 };

/** Measured, in order. Each is `box - 60 + irandom(120)` on both axes. */
export const VORTEX_TARGETS = [
  { x: 324, y: 206 },
  { x: 375, y: 201 },
  { x: 274, y: 162 },
  { x: 349, y: 129 },
  { x: 300, y: 214 },
  { x: 356, y: 137 },
];

export const ORACLE_VORTEX_INPUT = [{ from: 0 }];

const spawner = {
  name: 'vortex_spawner',
  create(e) {
    e.done = false;
  },
  endStep(e, state) {
    if (e.done || state.frame !== MANAGER_FRAME) return;
    const mg = spawn(state, swordVortexManager, { x: BOX.x, y: BOX.y });
    mg.damage = 10;
    e.done = true;
  },
};

export function buildOracleVortexScene(state) {
  state.view = { x: 0, y: 0 };
  state.turntimer = 300;

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, spawner, {});

  state.vortexTargets = VORTEX_TARGETS;
  state.vortexIndex = 0;
}
