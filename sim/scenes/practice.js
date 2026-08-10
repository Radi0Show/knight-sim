// Playable practice scene: the soul in the battle box, with the verified
// attacks on a loop.
//
// Lives in sim/ (not tools/) because the browser build needs it and sim/ is
// the only directory guaranteed DOM-free and filesystem-free.
//
// Every attack here is one that passes a row-exact oracle diff. Attacks are
// scheduled from an explicit table rather than the original's controller,
// which is turn-system machinery and out of scope (CLAUDE.md: dodge-only).

import { spawn } from '../entity.js';
import { soul } from '../soul.js';
import { battlebox } from '../battlebox.js';
import { splitGrowtangle } from '../attacks/split-growtangle.js';
import { fountainBullet } from '../attacks/fountain-bullet.js';
import { gmlCreate, gmlIrandomRange } from '../rng.js';

const BOX = { x: 320, y: 170 };
const SOUL_START = { x: 314, y: 162 };

/** Seed the splitter with the bullet fields splitslash would have inherited. */
function makeSplitter(state, opts) {
  const gt = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
  const sg = spawn(state, splitGrowtangle, { x: gt.x, y: gt.y });
  sg.damage = 206;
  sg.grazepoints = 5;
  sg.timepoints = 1;
  sg.inv = 60;
  sg.target = 0;
  sg.grazed = 0;
  sg.grazetimer = 0;
  sg.element = 5;
  sg.difficulty = 2;
  sg.vertical = opts.vertical;
  sg.diagonal = false;
  sg.xoffset = 0;
  sg.yoffset = 0;
  sg.angle = 0;
  sg.timer = 0;
  sg.con = 1;
  return sg;
}

/** A wall of fountain bullets rising from below, with a gap to dodge into. */
function fountainWave(state, gapIndex) {
  const left = BOX.x - 66;
  for (let i = 0; i < 12; i++) {
    if (i === gapIndex || i === gapIndex + 1) continue;
    const b = spawn(state, fountainBullet, { x: left + i * 12, y: BOX.y + 120 });
    b.speed = 0;
    b.top_speed = 3;
    b.direction = 90;
  }
}

// Attack schedule, in frames. Kept sparse enough to be dodgeable.
const SCHEDULE = [
  { at: 60, kind: 'split', vertical: false },
  { at: 170, kind: 'fountain' },
  { at: 250, kind: 'split', vertical: true },
  { at: 360, kind: 'fountain' },
];
const LOOP_LENGTH = 460;

const director = {
  name: 'practice_director',

  create(e) {
    e.cycle = 0;
  },

  endStep(e, state) {
    const t = state.frame % LOOP_LENGTH;
    if (state.frame > 0 && t === 0) e.cycle += 1;

    for (const ev of SCHEDULE) {
      if (t !== ev.at) continue;
      if (ev.kind === 'split') {
        const alreadySplitting = state.entities.some(
          (x) => x.alive && x.type.name === 'obj_knight_split_growtangle',
        );
        if (!alreadySplitting) makeSplitter(state, { vertical: ev.vertical });
      } else {
        fountainWave(state, gmlIrandomRange(state.gmlRng, 0, 9));
      }
    }

    // Housekeeping: a finished splitter would otherwise sit at con 0 forever
    // and block the next one.
    for (const x of state.entities) {
      if (x.alive && x.type.name === 'obj_knight_split_growtangle' && x.con === 0 && x.split === false && x.timer > 5) {
        x.alive = false;
        const gt = state.entities.find((g) => g.alive && g.type.name === 'obj_growtangle');
        if (gt) {
          gt.x = gt.xstart;
          gt.visible = true;
        }
      }
    }

    state.phase = `cycle ${e.cycle}`;
  },
};

export function buildPracticeScene(state, { seed = 12345 } = {}) {
  state.hp = 0;
  state.invTimer = -1;
  state.phase = 'practice';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.gmlRng = gmlCreate(seed);

  spawn(state, battlebox, { x: BOX.x, y: BOX.y });
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, director);
  return state;
}
