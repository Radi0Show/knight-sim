// Attack 3 oracle-comparison scene: the box-splitter organism, against
// knight-research/traces/t6-splitter.csv.
//
// Mirrors oracle_t6_splitter.csx exactly: steady box, soul holding right, and
// at trace frame 60 a split_growtangle created directly on the box with the
// bullet fields splitslash would have inherited into it, difficulty 2,
// horizontal (vertical=false, diagonal=false), con driven to 1.
//
// RNG: the oracle calls random_set_seed(12345) immediately before creating
// the splitter, so gmlRng is seeded identically here and consumes draws in
// the same order (choose flip, then per tooth: maybe choose weight, then
// random_range top_speed, then maybe choose weight-flip). The oracle patch
// strips the teeth's per-frame Draw jitter so nothing else touches the
// stream — a documented visual-only deviation.

import { spawn } from '../../sim/entity.js';
import { soul } from '../../sim/soul.js';
import { battlebox, settleBox } from '../../sim/battlebox.js';
import { splitGrowtangle } from '../../sim/attacks/split-growtangle.js';
import { gmlCreate } from '../../sim/rng.js';
import { real, int } from '../../sim/trace.js';

export const T6_WINDOW = { from: 4, to: 193 };
const SPLIT_FRAME = 60;

const splitSpawner = {
  name: 't6_spawner',
  endStep(e, state) {
    if (state.frame !== SPLIT_FRAME) return;

    state.gmlRng = gmlCreate(12345);
    const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
    const sg = spawn(state, splitGrowtangle, { x: gt.x, y: gt.y });

    // What splitslash's scr_bullet_inherit(_splitter) would have set,
    // followed by its grazepoints override.
    sg.damage = 206;
    sg.grazepoints = 5;
    sg.timepoints = 1;
    sg.inv = 60;
    sg.target = 0;
    sg.grazed = 0;
    sg.grazetimer = 0;
    sg.element = 5;

    sg.difficulty = 2;
    sg.vertical = false;
    sg.diagonal = false;
    sg.xoffset = 0;
    sg.yoffset = 0;
    sg.angle = 0;
    sg.timer = 0;
    sg.con = 1;
    state.splitter = sg;
  },
};

export function buildOracleT6Scene(state) {
  state.hp = 0;
  state.invTimer = -4;
  state.phase = 'oracle';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.frame = T6_WINDOW.from;
  // The oracle patch replaces obj_collidebullet Other_15 with a recorder so
  // the party cannot die mid-run; mirror that here.
  state.damageEnabled = false;
  state.splitter = null;

  settleBox(spawn(state, battlebox, { x: 320, y: 170 }));
  state.soul = spawn(state, soul, { x: 318, y: 162 });
  spawn(state, splitSpawner);

  state.traceExtraHeader = [
    'con', 'gtimer', 'distance',
    't0_x', 't0_y', 't0_a', 't1_x', 't1_y', 't1_a',
    't2_x', 't2_y', 't2_a', 't3_x', 't3_y', 't3_a',
    'hits',
  ];
  state.traceExtra = (s) => {
    const sg = s.splitter && s.splitter.alive ? s.splitter : null;
    const cells = sg
      ? [int(sg.con), int(sg.timer), real(sg.distance)]
      : ['', '', ''];
    const teeth = s.entities
      .filter((x) => x.alive && x.type.name === 'obj_roaringknight_split_bullet')
      .sort((a, b) => a.seq - b.seq);
    for (let i = 0; i < 4; i++) {
      const t = teeth[i];
      cells.push(t ? real(t.x) : '', t ? real(t.y) : '', t ? real(t.image_angle) : '');
    }
    cells.push(int(s.counters.collisionHits));
    return cells;
  };
  return state;
}

export const ORACLE_T6_INPUT = [{ from: 0, right: true }];
