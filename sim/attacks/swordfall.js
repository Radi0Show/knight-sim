// obj_knight_swordfall + obj_fallingsword — myattackchoice 10 ("swords
// falling"), reached through obj_dbulletcontroller `type = 108`.
//
// *** NOT IN THE FIGHT. *** No row of the selector assigns ac 10, so this is
// debug content like ac 4, 12, 16 and 17 — offered in SINGLE and labelled
// UNUSED. It takes no `scr_turntimer` override either, so it keeps the
// dispatch default of 240.
//
// THE SHAPE. The Knight leaves the field and rains swords into the arena:
//
//   Other_10 ("full")  local_turntimer = 324, alarm[5] = 4
//   Alarm 5            he shrinks out — image_xscale -> 0 and x -> x + 110,
//                      both over 8 frames "out" — then alarm[0] = 8
//   Alarm 0            HIS OWN SWORD falls: one obj_fallingsword at his
//                      centre with a seven-stage image_yscale wobble
//                      (0 -> -3 -> 0 -> 2.5 -> 0 -> -2.25 -> 0 -> 2), scaling
//                      1.5 -> 2 across 49 frames, `nosfx` so it uses
//                      snd_heavy_passing instead of the swordfall cue
//   Step               every `countdown` frames a sword drops from a random
//                      x across the box, aimed at a point clamped to within
//                      40px of its own x, and the cadence TIGHTENS:
//                      `countdowner = scr_approach(countdowner, 5, 5)` from
//                      29, with `countdown = countdowner - irandom(1)`
//   the finish         once `local_turntimer < turn_time (160)` it stops
//                      spawning, arms alarm[1] (the FINAL sword: speed_gain
//                      0.3, grazepoints 30, aimed at the box centre, and
//                      `speed += 2.4` every frame on top of the ramp) and
//                      alarm[2] (his return)
//   Alarm 2            he comes back on spr_roaringknight_sword_ol, dips
//                      through three chained y lerps, becomes
//                      spr_roaringknight_attack_ol_center at +9, and
//                      alarm[4] destroys the manager at +26
//
// THE SWORDS FLY BACKWARDS FIRST. `speed = -4` with the angle pointing at the
// target, and the Step ramps `speed` toward +18 — so each sword rears back
// along its own aim line, stops, and then drives down it. `destroyonhit = 0`,
// so one sword can hit more than once.
//
// The "start" / "end" / "short *" turn_types in Other_10 are the COMBINATION
// attack's chaining (ac 7, also unreachable) and are not translated: this
// launches as "full", the standalone form.
//
// VERIFICATION STATUS: translated from the dump, not oracle-diffed — the
// attack is unreachable in a real fight, so there is nothing to record it
// against. Mechanics line-for-line; the trail render is in
// render/draw/swordfall.js.

import { spawn, destroy } from '../entity.js';
import { scrApproach, pointDirection, clamp } from '../gml.js';
import { gmlRandom, gmlIrandom } from '../rng.js';
import { scrBulletInit, regularbulletCreate, regularbulletStep, collidebulletOther15 } from '../bullets/regularbullet.js';
import { scrLerpvar } from '../lerpvar.js';
import { SWORDOL_MASK, enginePairHit } from '../masks.js';
import { chainNext, registerComboAttack } from './combination.js';
import { cue } from '../audio.js';

/** How many trail samples the sword keeps. `max_old = 3`. */
const MAX_OLD = 3;

export const fallingSword = {
  name: 'obj_fallingsword',

  create(e, state) {
    regularbulletCreate(e, state); // event_inherited()
    e.sprite_index = 'spr_roaringknight_sword_ol'; // from the OBJECT definition
    e.slowing = 30;
    e.damage = 206;
    e.element = 5;
    e.grazepoints = 12;
    e.image_yscale = 0;
    e.alarm[0] = 1;
    e.destroyonhit = 0;
    e.image_alpha = 0;
    e.timer = 0;
    e.nosfx = false;
    e.old_x = new Array(MAX_OLD).fill(e.x);
    e.old_y = new Array(MAX_OLD).fill(e.y);
    e.old_angle = new Array(MAX_OLD).fill(e.image_angle ?? 0);
    e.speed_gain = 0.4;
    e.finalsword = false;
    e.isBullet = true;
    e.builtinMotion = true;
  },

  alarm: {
    /** `alarm[2] = 16; if (finalsword) alarm[3] = 10;` — then the ramp starts. */
    0(e) {
      e.alarm[2] = 16;
      if (e.finalsword) e.alarm[3] = 10;
    },
    2() {},
    3() {},
  },

  step(e, state) {
    regularbulletStep(e, state); // event_inherited()
    tickDelayed(state, e);
    e.timer += 1;

    if (!e.nosfx) {
      // snd_knight_fallingsword at 3, its pitch sliding 3.3 down over the
      // next 17 frames — the whistle of it coming in.
      if (e.timer === 3) cue(state, 'snd_knight_fallingsword', 1, 1);
      if (e.timer === 31 && e.finalsword) {
        cue(state, 'snd_knight_fallingsword_big', 1, 1);
      }
    } else if (e.timer === 1) {
      cue(state, 'snd_heavy_passing', 1, 1);
    }

    // The trail history, shifted oldest-first.
    for (let i = MAX_OLD - 1; i > 0; i--) {
      e.old_x[i] = e.old_x[i - 1];
      e.old_y[i] = e.old_y[i - 1];
      e.old_angle[i] = e.old_angle[i - 1];
    }
    e.old_x[0] = e.x;
    e.old_y[0] = e.y;
    e.old_angle[0] = e.image_angle;

    // THE REAR-BACK. `speed` starts NEGATIVE along the aim line and ramps
    // toward +18, so the sword pulls away before it drives in. The step size
    // carries `sign(speed)`, which makes the approach slower while it is
    // still travelling backwards and faster once it has turned over.
    if (!(e.alarm[0] > 0.5)) {
      e.speed = scrApproach(e.speed, 18, 0.6 + e.speed_gain * Math.sign(e.speed));
    }
    if (e.speed && e.finalsword) e.speed += 2.4;
  },

  collides(e, heart) {
    if (e.active !== 1 && e.active !== true) return false;
    return enginePairHit(heart, e, SWORDOL_MASK);
  },

  other15: collidebulletOther15,
};

/** Aim + wobble shared by every sword the Step drops. */
function dropSword(state, e, box) {
  const x = box.x - 110 + gmlRandom(state.gmlRng, 220);
  const y = box.y - 110 + gmlRandom(state.gmlRng, 30);
  const s = spawn(state, fallingSword, { x, y });
  // `clamp((gt.x + 95) - random(190), x - 40, x + 40)` — the target wanders
  // across the box but can never be more than 40px either side of the
  // sword's own column, so they fall near-vertically.
  const tx = clamp(box.x + 95 - gmlRandom(state.gmlRng, 190), x - 40, x + 40);
  s.image_angle = pointDirection(x, y, tx, box.y + 110);
  s.direction = s.image_angle;
  s.speed = -4;
  // THE YSCALE WOBBLE IS THE HITBOX, not decoration. The sword is created
  // with `image_yscale = 0` and these lerps open it out:
  //
  //     scr_lerpvar("image_yscale", 0, -1, 8);
  //     scr_script_delayed(scr_lerpvar, 8, "image_yscale", -1, 1, 8);
  //     scr_lerpvar("image_angle", image_angle, image_angle + 360, 16, 1, "out");
  //     scr_lerpvar("image_alpha", 0, 1, 16, 1, "out");
  //
  // A mask at yscale 0 has no height, and the contact model's own rule is
  // that an axis-aligned mask thinner than one pixel never registers (see
  // sim/masks.js) — so without these the swords fell straight through the
  // soul. verify-graze caught it: "NOTHING grazed in 600 frames".
  //
  // The 360-degree spin is what makes them tumble as they rear back.
  scrLerpvar(state, spawn, s, 'image_yscale', 0, -1, 8);
  delayedLerp(state, s, 8, 'image_yscale', -1, 1, 8);
  scrLerpvar(state, spawn, s, 'image_angle', s.image_angle, s.image_angle + 360, 16, 1);
  scrLerpvar(state, spawn, s, 'image_alpha', 0, 1, 16, 1);
  return s;
}

/**
 * `scr_script_delayed(scr_lerpvar, n, ...)` — a lerp that starts n frames
 * later. Carried on the target itself so it survives without a scheduler.
 */
function delayedLerp(state, target, delay, varname, from, to, dur) {
  (target.pendingLerps ??= []).push({ delay, varname, from, to, dur });
}

/** Runs the pending list; called from both objects' steps. */
function tickDelayed(state, e) {
  if (!e.pendingLerps || !e.pendingLerps.length) return;
  for (const p of e.pendingLerps) p.delay -= 1;
  const due = e.pendingLerps.filter((p) => p.delay <= 0);
  e.pendingLerps = e.pendingLerps.filter((p) => p.delay > 0);
  for (const p of due) {
    scrLerpvar(state, spawn, e, p.varname, p.from, p.to, p.dur, 1);
  }
}

export const knightSwordfall = {
  name: 'obj_knight_swordfall',

  create(e, state) {
    scrBulletInit(e);
    // scr_darksize()
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.image_speed = 0;
    e.sprite_index = 'spr_roaringknight_idle';
    e.swordcount = 1;
    e.countdowner = 29;
    e.countdown = 45;
    e.turn_type = 'full';
    e.turn_time = 160;
    e.local_turntimer = 0;
    e.anchor_x = e.x;
    e.anchor_y = e.y;
    e.dip = 2;
    e.difficulty = 0;
    e.forcexfix = false;
    e._siner = 0;
    e.done = false;
  },

  /**
   * Other_10. The "full" arm is the standalone launch; the rest are the
   * COMBINATION's (ac 7), which chains this attack as one of three segments.
   *
   * `short start` and `short mid` share a shape — a short clock, a fast
   * `countdowner`, and the point pose eased in over 20 frames to the box's
   * right edge — and differ only in how long they run (70 against 80) and how
   * quickly the swords come (10 against 20). `short end` is the odd one: it
   * skips the pose entirely, takes the LONGEST clock in the object (214), and
   * arms alarm 5 exactly as "full" does, because it is the segment that has to
   * finish the turn rather than hand it on.
   */
  init(e, state) {
    if (e.turn_type === 'short start' || e.turn_type === 'short mid') {
      const short = e.turn_type === 'short start';
      e.local_turntimer = short ? 70 : 80;
      e.countdowner = short ? 10 : 20;
      e.countdown = 2;
      e.turn_time = 40;
      e.sprite_index = 'spr_roaringknight_point_ol';
      scrLerpvar(state, spawn, e, 'image_index', 0, 4, 8);
      const box = boxOf(state);
      if (box) {
        const hw = (box.image_xscale ?? 2) * 37.5;
        const hh = (box.image_yscale ?? 2) * 37.5;
        scrLerpvar(state, spawn, e, 'x', e.x, box.x + hw + 60, 20, 1);
        scrLerpvar(state, spawn, e, 'y', e.y, box.y - 110, 20, 1);
      }
      return;
    }
    if (e.turn_type === 'short end') {
      e.local_turntimer = 214;
      e.countdowner = 10;
      e.countdown = 20;
      e.alarm[5] = 4;
      return;
    }
    e.local_turntimer = 324;
    e.alarm[5] = 4;
  },

  alarm: {
    /** The Knight's OWN sword, with its seven-stage wobble. */
    0(e, state) {
      const s = spawn(state, fallingSword, {
        x: e.x + 75, // sprite_width * 0.5 at scale 2 (spr_roaringknight_idle)
        y: e.y - 30,
      });
      s.alarm[0] = 1;
      s.image_angle = -90;
      s.direction = 90; // `direction = -image_angle`
      s.speed = -4;
      s.old_angle = [-90, -90, -90];
      s.image_xscale = 1.5;
      s.image_alpha = 1;
      s.nosfx = true;
      // scr_lerpvar("image_xscale", 1.5, 2, 49, 1, "out") and the yscale
      // chain; the renderer reads `wobble` for the latter.
      scrLerpvar(state, spawn, s, 'image_xscale', 1.5, 2, 49, 1);
      // The seven-stage yscale chain, delays and durations verbatim.
      scrLerpvar(state, spawn, s, 'image_yscale', 0, -3, 4, 1);
      delayedLerp(state, s, 4, 'image_yscale', -3, 0, 5);
      delayedLerp(state, s, 9, 'image_yscale', 0, 2.5, 6);
      delayedLerp(state, s, 15, 'image_yscale', 2.5, 0, 7);
      delayedLerp(state, s, 22, 'image_yscale', 0, -2.25, 8);
      delayedLerp(state, s, 30, 'image_yscale', -2.25, 0, 9);
      delayedLerp(state, s, 39, 'image_yscale', 0, 2, 10);
    },

    /** The FINAL sword — faster, worth far more graze, aimed at the centre. */
    1(e, state) {
      const box = boxOf(state);
      const x = box.x - 55 + gmlRandom(state.gmlRng, 110);
      const y = box.y - 110 + gmlRandom(state.gmlRng, 30);
      const s = spawn(state, fallingSword, { x, y });
      s.image_angle = pointDirection(x, y, box.x, box.y);
      s.direction = s.image_angle;
      s.speed = -6;
      s.speed_gain = 0.3;
      s.image_xscale = 2;
      s.finalsword = true;
      s.grazepoints = 30;
      scrLerpvar(state, spawn, s, 'image_yscale', 0, -2, 8);
      delayedLerp(state, s, 8, 'image_yscale', -2, 2, 8);
      scrLerpvar(state, spawn, s, 'image_angle', s.image_angle, s.image_angle + 360, 16, 1);
      scrLerpvar(state, spawn, s, 'image_alpha', 0, 1, 16, 1);
    },

    /** His return: the sword pose, the dip, then the attack pose. */
    2(e, state) {
      e.dip = 0;
      const k = state.entities.find((x) => x.alive && x.type.name === 'obj_knight_enemy');
      e.x = (k ? k.x : e.x) + 10;
      e.image_xscale = 2;
      e.sprite_index = 'spr_roaringknight_sword_ol';
      e.image_angle = -90;
      e.forcexfix = true;
      e.returnT = 0;
      e.alarm[4] = 26;
    },

    /**
     * Alarm 3 — THE HANDOFF. `if (next_up != -999) { ...create the next
     * segment... } instance_destroy();` — so outside a combination it is
     * simply the object's end.
     */
    3(e, state) {
      chainNext(state, e);
      destroy(e);
    },

    /** The manager is done; hand the knight's hover phase back. */
    4(e, state) {
      if (state.knight) state.knight.siner2 = e._siner;
      e.done = true;
      destroy(e);
    },

    /** He slides out and shrinks away, then drops his sword. */
    5(e) {
      e.slideT = 0;
      e.slideFromX = e.x;
      e.alarm[0] = 8;
    },
  },

  step(e, state) {
    e.local_turntimer -= 1;
    // `obj_knight_enemy.siner2 = 0` every step — his hover is FROZEN for the
    // whole attack and handed back by alarm 4.
    if (state.knight) state.knight.siner2 = 0;

    // Alarm 5's two 8-frame "out" lerps.
    if (e.slideT !== undefined && e.slideT < 8) {
      e.slideT += 1;
      const t = e.slideT / 8;
      const out = 1 - (1 - t) * (1 - t);
      e.image_xscale = 2 * (1 - out);
      e.x = e.slideFromX + 110 * out;
    }
    // Alarm 2's chained return lerps, and the pose swap at +9.
    if (e.returnT !== undefined) {
      e.returnT += 1;
      if (e.returnT === 9) {
        e.sprite_index = 'spr_roaringknight_attack_ol_center';
        e.image_angle = 0;
        e.image_yscale = 2;
      }
    }

    // `if (alarm[0]) exit;` — nothing below runs while his own sword is armed.
    if (e.alarm[0] > 0.5) return;

    e.countdown -= 1;
    if (e.countdown !== 0) return;

    // THE FINISH. `ex` is 30 at difficulty 1, so the harder version stops
    // raining earlier and gets to its final sword sooner.
    const ex = e.difficulty === 1 ? 30 : 0;
    if (e.local_turntimer < e.turn_time - ex) {
      e.countdown = 99999;
      e.local_turntimer = 99999;
      // TWO ENDINGS, and the turn_type picks one. A standalone launch throws
      // the FINAL sword (alarm 1) and brings the Knight back (alarm 2); a
      // chained segment does neither — it eases the pose back and arms the
      // HANDOFF (alarm 3) four frames later, so the next attack starts while
      // this one's swords are still in the air.
      if (e.turn_type !== 'start' && e.turn_type !== 'short start'
        && e.turn_type !== 'short mid') {
        e.alarm[1] = 8;
        e.alarm[2] = 60;
      } else {
        scrLerpvar(state, spawn, e, 'image_index', 4, 0, 8);
        e.alarm[3] = 4;
      }
      return;
    }

    dropSword(state, e, boxOf(state));

    // The cadence tightens toward 5 (or 4 at difficulty 1).
    if (e.difficulty === 0) {
      e.countdowner = scrApproach(e.countdowner, 5, 5);
      e.countdown = e.countdowner - gmlIrandom(state.gmlRng, 1);
    } else {
      e.countdowner = scrApproach(e.countdowner, 4, 5);
      e.countdown = e.countdowner;
    }
  },
};

function boxOf(state) {
  const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
  return gt ? { x: gt.x, y: gt.y } : { x: state.view.x + 320, y: state.view.y + 170 };
}

// Combination segment 4 — see sim/attacks/combination.js's registry note.
registerComboAttack(4, knightSwordfall);
