// obj_diagonal_bullet_manager + obj_diagonal_bullet — dc.type 152,
// myattackchoice 12.
//
// *** NOT IN THE FIGHT. *** ac 12 lives in phase 1's selector block at
// `phaseturn == 6`, and phase 1 ends at 5 (`phase = 2; phaseturn = 0`), so it
// is never selected. Verified row-exact regardless — verify-diagonal is the
// acceptance test for component (hspeed/vspeed) motion and stays in the suite
// for that. Same status as the fountain bullets: real engine value, not an
// attack. See CLAUDE.md, THE REAL FIGHT.
//
// The simplest attack in the fight, and the only one with no state machine at
// all: every `rate` frames a wall of 24 bullets is dropped 300px to the right
// of the box and sweeps left across it on a fixed diagonal. The whole wave
// shares one `choose(+6, -6)` — the wall slants either down-left or up-left,
// and that single coin flip is the entire read.
//
// The pressure comes from the cadence, not the pattern: `rate` starts at 44
// and drops 4 per wave to a floor of 8, so the walls arrive more than five
// times as often by the end of the turn.
//
// `bulletcount * gapsize` is 1344px of wall against a 150px box, so most of
// any given wave is off-screen. The `_vspeed > 0` branch shifts the whole
// column up by 1044px so the visible slice is the one that matters.
//
// This is the first attack to write hspeed/vspeed directly rather than
// speed/direction — see `componentMotion` in sim/index.js.
//
// NOT translated: nothing. The bullet's Step is three lines of alpha fade
// (cosmetic) plus a lifetime, and both are here.

import { spawn, destroy } from '../entity.js';
import { clamp, lerp } from '../gml.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';
import { gmlChoose } from '../rng.js';

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

export const diagonalBullet = {
  name: 'obj_diagonal_bullet',

  create(e, state) {
    e.timer = 0;
    e.con = 0;
    e.image_alpha = 0;
    scrBulletInit(e);
    e.destroyonhit = 0;
    // spr_smallbullet comes from the OBJECT DEFINITION, not any event — the
    // same grep-invisible hole as obj_basicattack (object_sprite.csx found
    // it). Without it the bullet had no sprite, no mask, no contact and no
    // graze: the verifiers caught all three the day it joined ATTACK_MENU.
    e.sprite_index = 'spr_smallbullet';
    e.isBullet = true;
    e.componentMotion = true;
    e.hspeed = 0;
    e.vspeed = 0;
  },

  step(e, state) {
    e.timer += 1;

    // Fades in as it nears the box horizontally and out as it leaves it
    // vertically, so only the part of the wall crossing the arena is visible.
    const gt = box(state);
    if (gt) {
      const a = clamp(Math.abs(e.x - gt.x) / 300, 0, 1);
      const maxalpha = lerp(1.3, 0, a);
      e.image_alpha = lerp(maxalpha, 0, Math.abs(e.y - gt.y) / 200);
    }

    if (e.timer > 260) destroy(e);
  },

  other15: collidebulletOther15,
};

export const diagonalBulletManager = {
  name: 'obj_diagonal_bullet_manager',

  create(e, state) {
    // A COLLIDEBULLET IN ITS OWN RIGHT. The object's parent chain (dumped via
    // object_parents.csx) is obj_diagonal_bullet_manager -> obj_regularbullet -> the
    // collidebullet base — so the real game's bullet enumeration counts the
    // MANAGER itself, sitting at (growtangle.x, cameray()) from its creation
    // frame. The whole-fight differ pairs bullets by slot, and without this
    // flag every bullet of the turn sat one slot early against the recording
    // (turn 2's f450: oracle b0 is the manager, sim b0 was the first sword).
    // maskOff keeps it out of the collision and graze loops: parked at the
    // camera top it never touches the soul, and its own damage never fires.
    e.isBullet = true;
    e.maskOff = true;
    e.timer = 0;
    e.con = 0;
    e.damage = 1;
    e.grazepoint = 2;
    e.timepoints = 2;
    e.inv = 0;
    e.target = 4;
    e.grazed = 0;
    e.grazetimer = 0;
    e.element = 0;
    e.rate = 44;
    e.verticalspeed = 6;
    e.horizontalspeed = -5;
    e.gapsize = 56;
    e.bulletcount = 24;
    // One frame short of the first wave, so it fires on the very first Step.
    e.timer = e.rate - 1;
  },

  step(e, state) {
    e.timer += 1;
    if (e.timer !== e.rate) return;
    e.timer = 0;

    const gt = box(state);
    if (!gt) return;

    // ONE draw for the whole wave — the entire wall slants the same way.
    const vspeed = state.diagonalFlips
      ? state.diagonalFlips[state.diagonalIndex++]
      : gmlChoose(state.gmlRng, [e.verticalspeed, e.verticalspeed * -1]);

    for (let i = 0; i < e.bulletcount; i++) {
      const inst = spawn(state, diagonalBullet, {
        x: gt.x + 300,
        y: gt.y - 100 + e.gapsize * i,
      });
      inst.hspeed = e.horizontalspeed;
      inst.vspeed = vspeed;
      inst.damage = e.damage;
      if (vspeed > 0) {
        inst.y = inst.y - e.bulletcount * e.gapsize + 300;
      }
    }

    e.rate -= 4;
    if (e.rate < 8) e.rate = 8;
  },
};
