// T4 oracle-comparison scene: one obj_roaringknight_slash, end to end,
// against knight-research/traces/t4-slash.csv.
//
// Oracle scenario: the T3 steady state (soul pinned at 374 against the box's
// right wall, dummy-enemy bullets sterilized by the patch), then at trace
// frame 60 the patch spawns obj_roaringknight_slash at (384, 172). The slash:
//   - shrinks width x0.66 per frame once alarm[0] has fired
//   - while width > 4, teleports the box to (xstart±2, ystart±2) and calls
//     scr_heartclamp — dragging the pinned soul to gt.x + 50
//   - never touches the heart (its 0.1-yscaled line mask overlaps no integer
//     row at these params — oracle-confirmed, no inv reset)
//   - dies at width < 0.5 (trace frame 70), leaving the box permanently at
//     its last jitter position (321, 169); the soul re-pins at 375
//
// CHOOSE_TABLE is the recorded RNG: slashdir (mechanically irrelevant,
// consumed for stream position), then per jitter frame x then y, read off
// rows 61-64 of the trace (gt - (320,170)): (0,0) (+2,-1) (+1,-1) (+1,-1).

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { roaringknightSlash } from '../../sim/attacks/roaringknight-slash.js';
import { real } from '../../sim/trace.js';

export const T4_WINDOW = { from: 4, to: 193 };
const SLASH_SPAWN_FRAME = 60;

const CHOOSE_TABLE = [
  1, // slashdir: choose(-1, 1) — unobservable in the trace, either matches
  0, 0, // frame 61 jitter
  2, -1, // frame 62
  1, -1, // frame 63
  1, -1, // frame 64
];

// The oracle patch spawns the slash from obj_time's Draw event — after every
// End Step, so the slash's first Step_2 and first alarm tick are the NEXT
// frame. This spawner mirrors that by spawning in its own endStep; the
// phase-frozen entity list guarantees the slash runs nothing that frame.
const slashSpawner = {
  name: 't4_spawner',
  endStep(e, state) {
    if (state.frame === SLASH_SPAWN_FRAME) {
      spawn(state, roaringknightSlash, { x: 384, y: 172 });
    }
  },
};

export function buildOracleT4Scene(state) {
  state.hp = 0;
  state.invTimer = -4;
  state.phase = 'oracle';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.frame = T4_WINDOW.from;
  state.chooseTable = CHOOSE_TABLE;

  // Tester-room recording: its box rests the soul on the stored [2..72]
  // interior (see BATTLEBG_FIGHT_MASK in sim/masks.js).
  state.testerBoxMask = true;
  const gt = settleBox(spawn(state, battlebox, { x: 320, y: 170 }));
  state.soul = spawn(state, soul, { x: 318, y: 162 });
  spawn(state, slashSpawner);

  // Mirror the oracle's extra columns: gt_x, gt_y, slash_w.
  state.traceExtraHeader = ['gt_x', 'gt_y', 'slash_w'];
  state.traceExtra = (s) => {
    const slash = s.entities.find(
      (x) => x.alive && x.type.name === 'obj_roaringknight_slash',
    );
    return [real(gt.x), real(gt.y), slash ? real(slash.width) : ''];
  };

  return state;
}

export const ORACLE_T4_INPUT = [{ from: 0, right: true }];
