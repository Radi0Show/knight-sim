// SWORD TUNNEL (ac 13, dc.type 153) — against
// knight-research/traces/swordtunnel.csv, recorded with
// `tools/oracle-run.sh 1 4 swordtunnel frames=300`.
//
// Pins the corridor: the spawn cadence, the pair geometry around `swordy`, the
// gap's wandering (move for `setcount` pairs, hold for `waitsetcount`, never
// more than 20px past the box centre), and every sword's accelerating flight.
//
// RECORDED INPUTS — this attack rolls dice constantly, so there are four:
//   * `timer = -40 + irandom(10)`, which sets when the first pair arrives
//   * the Create's `choose(2,3,4)` / `choose(1,2,3)` / `choose("up","down")`
//   * the same three re-rolled at every set boundary
// Each is replayed from the trace. The LOGIC around them is not: which
// boundary fires, whether the run is a move or a hold, and the two clamps that
// turn the gap around at the box edges are all computed.
//
// WINDOW ENDS AT 235 for a measured reason. `finishtimer` hits its max of 230
// on frame 243 (the manager is created on 13), and that starts the finale —
// swords stopping, aiming and dashing — which is NOT translated. Everything up
// to 235 is the corridor proper.
//
// SWORD HITS ARE NOW VERIFIED TOO, per frame and on both contact paths: the
// swept 8px `collision_line` sub-step and the sword's own mask overlap. 45
// contacts over the window, 30 and 15. See tools/verify-swordtunnel.mjs.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { swordTunnelManager } from '../../sim/attacks/sword-tunnel.js';

export const MANAGER_FRAME = 13;
export const TUNNEL_WINDOW = { from: 13, to: 235 };

/** ac 13 moves the box to (300,190) and stretches it to xscale 3. */
const BOX = { x: 300, y: 190 };
// MEASURED at 264, not the 260 it spawns at: the soul takes one 4px step
// right on frame 10 and stays there for the rest of the turn. The window
// starts at 13, so it begins settled. This was wrong at 260 for a long time
// and nothing caught it — the swords never read the soul, so only the swept
// hit test is sensitive to it, and that had not been implemented yet.
const SOUL_START = { x: 264, y: 182 };

/** Measured. `timer` reads -37, so irandom(10) returned 3. */
const CREATE = { timerOffset: 3, setcount: 3, waitsetcount: 2, movedirection: 'down' };

/**
 * Measured at each set boundary, in order. `movedirection` is only consumed
 * when the previous run was a hold — otherwise the code forces "none" and the
 * choose never happens.
 */
export const TUNNEL_SETS = [
  { setcount: 3, waitsetcount: 2, movedirection: 'none' },
  { setcount: 4, waitsetcount: 1, movedirection: 'up' },
  { setcount: 4, waitsetcount: 2, movedirection: 'none' },
  { setcount: 3, waitsetcount: 2, movedirection: 'down' },
  { setcount: 4, waitsetcount: 1, movedirection: 'none' },
  { setcount: 2, waitsetcount: 1, movedirection: 'down' },
  { setcount: 4, waitsetcount: 1, movedirection: 'none' },
  { setcount: 4, waitsetcount: 2, movedirection: 'up' },
  { setcount: 2, waitsetcount: 1, movedirection: 'none' },
  { setcount: 4, waitsetcount: 2, movedirection: 'down' },
  { setcount: 3, waitsetcount: 2, movedirection: 'none' },
  { setcount: 3, waitsetcount: 2, movedirection: 'up' },
  { setcount: 2, waitsetcount: 3, movedirection: 'none' },
  { setcount: 3, waitsetcount: 1, movedirection: 'down' },
  { setcount: 4, waitsetcount: 1, movedirection: 'none' },
  { setcount: 4, waitsetcount: 2, movedirection: 'up' },
  { setcount: 3, waitsetcount: 3, movedirection: 'none' },
  { setcount: 3, waitsetcount: 1, movedirection: 'up' },
];

export const ORACLE_TUNNEL_INPUT = [{ from: 0 }];

const spawner = {
  name: 'tunnel_spawner',
  create(e) {
    e.done = false;
  },
  endStep(e, state) {
    if (e.done || state.frame !== MANAGER_FRAME) return;
    const mg = spawn(state, swordTunnelManager, { x: BOX.x, y: state.view.y });
    mg.timer = -40 + CREATE.timerOffset;
    mg.setcount = CREATE.setcount;
    mg.waitsetcount = CREATE.waitsetcount;
    mg.movedirection = CREATE.movedirection;
    mg.difficulty = 0;
    mg.damage = 1;
    swordTunnelManager.init(mg, state);
    e.done = true;
  },
};

export function buildOracleTunnelScene(state) {
  state.view = { x: 0, y: 0 };
  state.turntimer = 360;

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, spawner, {});

  state.tunnelSets = TUNNEL_SETS;
  state.tunnelIndex = 0;
}
