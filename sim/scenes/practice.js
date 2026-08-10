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
import { gmlCreate } from '../rng.js';

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

// SANDBOX SCHEDULE — NOT the real fight.
//
// The fabricated "fountain wave" that used to live here has been deleted: I
// invented it, and nothing like it exists in the Knight fight. See CLAUDE.md,
// "THE REAL FIGHT".
//
// What remains is the box splitter, which IS faithfully translated and passes
// a row-exact oracle diff — but is `underboxattack` (ac=6), which the fight's
// selector never chooses. So this scene is an ENGINE SANDBOX, and it says so
// in the HUD. It is not a practice tool for the real fight yet.
//
// The real phase-1 order, for when these are translated:
//   1 Stars · 11 tracking · 2 Flurry · 13 swordtunnel · 5 rotatingslash
//   12 diagonal · 16 tracking16 · 17 tracking17 · 7 combination
// All dispatch through obj_dbulletcontroller by `type`; parameters are
// tabulated in CLAUDE.md.
export const IS_SANDBOX = true;
export const SANDBOX_NOTE = 'SANDBOX — engine demo, not the real fight sequence';

const SCHEDULE = [
  { at: 60, kind: 'split', vertical: false },
  { at: 260, kind: 'split', vertical: true },
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
