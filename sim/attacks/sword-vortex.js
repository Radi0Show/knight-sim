// obj_sword_vortex_manager + obj_sword_vortex — dc.type 154,
// myattackchoice 15, the fourth turn of phase 2.
//
// Six swords orbit a drifting centre. Each one spins inward-facing while its
// orbital radius breathes on a sine, and the centre itself wanders to a new
// random point inside the box every 60 frames — so the safe ring is never
// where it was.
//
// ac 15 fires type 154 AND THEN type 151, so the tracking swords
// (sim/attacks/tracking-swords.js) run on top of this. That half is already
// translated; nothing here needs to know about it.
//
// AN ORIGINAL QUIRK THAT MAKES DIFFICULTY INERT. The Create sets `variant = 3`
// and then immediately runs its variant-specific parameter block, so `rate`,
// `sinpower`, `sinspeed`, `startinglen`, `maxswords` and the setdirection
// table are ALWAYS variant 3's values. The controller assigns
// `_manager.variant = difficulty` afterwards — but unlike types 151 and 153,
// type 154 does NOT call `event_user(0)`, so nothing re-runs the block. The
// only thing the assigned variant reaches is `inst.variant` on each sword, and
// obj_sword_vortex's Step never reads it. Difficulty therefore has no effect
// on this attack at all. Preserved exactly; do not "fix" it into a divergence.
//
// The first six swords all have a `setdirection` entry (0, 180, 0, 180, 0,
// 180) and `maxswords` is 6, so the `choose` of eight compass points is rolled
// and discarded every time. It still consumes a draw.
//
// NOT translated (cosmetic): the per-sword afterimage trail.

import { spawn } from '../entity.js';
import { lengthdirX, lengthdirY, lerp } from '../gml.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';
import { gmlChoose, gmlIrandom } from '../rng.js';

const HEADINGS = [0, 45, 90, 135, 180, 225, 270, 315];

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

function manager(state) {
  return state.entities.find(
    (e) => e.alive && e.type.name === 'obj_sword_vortex_manager',
  );
}

export const swordVortex = {
  name: 'obj_sword_vortex',

  // MEASURED: these swords step BEFORE the manager that spawned them, so each
  // frame they orbit around the manager's PREVIOUS-frame `siner` and centre.
  // See the phaseList comment in sim/entity.js for the evidence.
  stepOrder: -1,

  create(e, state) {
    e.timer = 0;
    e.con = 0;
    e.dir = 0;
    e.image_alpha = 0;
    scrBulletInit(e);
    e.destroyonhit = 0;
    e.damage = 10;
    e.grazepoints = 2;
    e.timepoints = 1;
    e.spinspeed = 4;
    e.speedtowardscenter = 0.4;
    e.len = 70;
    e.sinpower = 65;
    e.sinspeed = 24;
    e.shrinkrate = 0;
    e.lenstart = e.len;
    e.sprite_index = 'spr_roaringknight_sword_ol';
    e.isBullet = true;
  },

  step(e, state) {
    e.image_alpha += 0.1;

    // Spins faster the closer in it is.
    e.dir -= e.spinspeed * lerp(2, 1, e.len / 120);
    e.image_angle = e.dir - 90;

    const mg = manager(state);
    if (mg) {
      // The radius breathes on the MANAGER's clock, so all six swords pulse
      // together.
      e.len = e.lenstart + Math.sin(mg.siner / e.sinspeed) * e.sinpower;
      e.x = mg.swordcirclecenterx + lengthdirX(e.len, e.dir);
      e.y = mg.swordcirclecentery + lengthdirY(e.len, e.dir);
      e.lenstart -= e.shrinkrate;
    }

    e.timer += 1;
    if (e.timer % 4 === 0) e.grazed = 0;
  },

  other15: collidebulletOther15,
};

export const swordVortexManager = {
  name: 'obj_sword_vortex_manager',

  create(e, state) {
    // A COLLIDEBULLET IN ITS OWN RIGHT. The object's parent chain (dumped via
    // object_parents.csx) is obj_sword_vortex_manager -> obj_regularbullet -> the
    // collidebullet base — so the real game's bullet enumeration counts the
    // MANAGER itself, sitting at (growtangle.x, cameray()) from its creation
    // frame. The whole-fight differ pairs bullets by slot, and without this
    // flag every bullet of the turn sat one slot early against the recording
    // (turn 2's f450: oracle b0 is the manager, sim b0 was the first sword).
    // maskOff keeps it out of the collision and graze loops: parked at the
    // camera top it never touches the soul, and its own damage never fires.
    e.isBullet = true;
    e.maskOff = true;
    const gt = box(state);
    e.timer = 0;
    e.siner = 0;
    e.con = 0;
    e.variant = 3;
    e.firstsword = false;
    e.swordcount = 0;
    e.multiswordcon = 0;
    e.multiswordcount = 0;
    e.centermovescon = 0;
    e.centermovestimer = 0;
    e.swordcirclecenterx = gt ? gt.x : 320;
    e.swordcirclecentery = gt ? gt.y : 170;
    e.startx = e.swordcirclecenterx;
    e.starty = e.swordcirclecentery;
    e.targetx = 0;
    e.targety = 0;
    e.setcount = 0;
    e.setdirection = new Array(50).fill(-1);
    scrBulletInit(e);

    // Always variant 3 — see the header. Only that branch is translated,
    // because only that branch can ever run.
    e.rate = 11;
    e.ratedecay = 0;
    e.rateminimum = 1;
    e.maxswords = 6;
    e.multiswordmax = 2;
    e.multiswordframes = 1;
    e.sinpower = 17;
    e.sinspeed = 22;
    e.startinglen = 80;
    e.shrinkrate = 0;
    e.centermoves = 1;
    e.movespeed = 60;
    for (let i = 1; i <= 6; i++) e.setdirection[i] = i % 2 === 1 ? 0 : 180;

    e.timer = e.rate - 5;
  },

  step(e, state) {
    e.timer += 1;
    e.siner += 1;

    const gt = box(state);

    const fire =
      (e.timer === e.rate && e.swordcount < e.maxswords) ||
      (e.timer === e.multiswordframes && e.multiswordcon === 1);

    if (fire) {
      const inst = spawn(state, swordVortex, {
        x: gt ? gt.x : 320,
        y: gt ? gt.y : 170,
      });

      // Rolled, then thrown away by setdirection below — but the draw is
      // taken, so it must be taken here too.
      inst.dir = gmlChoose(state.gmlRng, HEADINGS);
      inst.variant = e.variant;
      inst.sinpower = e.sinpower;
      inst.sinspeed = e.sinspeed;
      inst.len = e.startinglen;
      inst.lenstart = inst.len;
      inst.shrinkrate = e.shrinkrate;
      inst.damage = e.damage;
      inst.target = e.target;

      e.swordcount += 1;
      e.setcount += 1;
      if (e.setdirection[e.setcount] !== -1) inst.dir = e.setdirection[e.setcount];

      if (e.multiswordmax > 0) e.multiswordcount += 1;
      if (e.multiswordcon === 0 && e.multiswordmax > 0) e.multiswordcon = 1;
      if (e.multiswordcon === 1 && e.multiswordcount === e.multiswordmax) {
        e.multiswordcon = 0;
        e.multiswordcount = 0;
      }

      inst.x = inst.xstart + lengthdirX(inst.len, inst.dir);
      inst.y = inst.ystart + lengthdirY(inst.len, inst.dir);
      inst.image_angle = inst.dir - 90;

      e.rate -= e.ratedecay;
      if (e.rate < e.rateminimum) e.rate = e.rateminimum;
      e.timer = 0;
    }

    if (e.centermoves === 1) {
      if (e.centermovescon === 0) {
        e.startx = e.swordcirclecenterx;
        e.starty = e.swordcirclecentery;
        const rec = state.vortexTargets ? state.vortexTargets[state.vortexIndex++] : null;
        e.targetx = rec
          ? rec.x
          : (gt ? gt.x : 320) - 60 + gmlIrandom(state.gmlRng, 120);
        e.targety = rec
          ? rec.y
          : (gt ? gt.y : 170) - 60 + gmlIrandom(state.gmlRng, 120);
        e.centermovescon = 1;
      }
      if (e.centermovescon === 1) {
        e.centermovestimer += 1;
        e.swordcirclecenterx = lerp(e.startx, e.targetx, e.centermovestimer / e.movespeed);
        e.swordcirclecentery = lerp(e.starty, e.targety, e.centermovestimer / e.movespeed);
        if (e.centermovestimer === e.movespeed) {
          e.centermovestimer = 0;
          e.centermovescon = 0;
        }
      }
    }
  },
};
