// obj_knight_weird_bottom_manager + obj_knight_weird_circle (+ its bullet) —
// myattackchoice 6 ("underboxattack"), reached through obj_dbulletcontroller
// `type = 106`.
//
// *** NOT IN THE FIGHT. *** No row of the selector assigns ac 6, so this is
// debug content like ac 4, 10, 12, 16 and 17 — offered in SINGLE and labelled
// UNUSED. The controller sets `global.turntimer = 999999`, so the attack owns
// its own clock: `local_turntimer` counts 340 down, and the manager's DESTROY
// event is what releases the turn (`global.turntimer = -1`).
//
// A CORRECTION TO CLAUDE.md, which records ac 6 as the ac that creates
// `obj_roaringknight_boxsplitter_attack`: type 106 creates THIS. The
// boxsplitter wrapper is a different unreachable object, and the cut-box
// organism underneath it is very much in the fight (rotating slash spawns it
// every phase). Both files agree ac 6 is unreachable; the object named is
// wrong.
//
// THE SHAPE. Five orbs orbit an ELLIPSE below the battle box and take turns
// spitting a fan of bullets up through it.
//
//   type 106      an obj_knight_warp on the Knight (event_user(1) — he warps
//                 OUT and stays hidden), the arena forced back to 2 x 2, and
//                 the manager created at his position
//   Create        centre = (box centre x, box BOTTOM + 43), spin 2, five orbs
//                 (circle_goal) at radius 120, alarm[0] = 16
//   Other_10      "full": local_turntimer 340, `x += 200`, then the manager's
//                 own warp-out — image_index 8 -> 5 at frame 8, alpha 0 at 16
//   Alarm 0       adds one orb every `init_start` (4) frames until five exist,
//                 each at `(360 / 5) * index`, then arms alarm[1]
//   Step          `angle += spin`, and every orb is placed at
//                 `centre + lengthdir(distance, angle + master.angle)` with
//                 the VERTICAL term scaled 0.25 — a flattened ellipse, which
//                 is what makes them read as circling underneath the arena
//   Alarm 1       fires the frontmost `amount` orbs, rotates the queue, then
//                 re-arms at `18*amount - 4*max(amount-1,0) + 2*irandom(3)`
//                 and lurches `spin` out to choose(-12, 12) and back to +-1
//   the finish    once `local_turntimer < 80` the orbs fade over 32 frames and
//                 the manager returns to the Knight's spot and warps back in
//                 (5 -> 8 at +20), with alarm[2] destroying it at +40
//
// EACH VOLLEY IS ELEVEN BULLETS: one big `spr_knight_weird_shape` straight up
// (speed 6, `gravity_direction = direction` with gravity 0.2, so it
// ACCELERATES along its own line rather than arcing, scaling from a 3-tall
// sliver to 2 x 2 over 12 frames), plus a five-wide fan at 27.5 + 31.25a
// speed 4 and a four-wide one at 40 + 33.33a speed 6 whose middle two are
// SKIPPED (`if (a == 1 || a == 2) continue;`) — the corridor either side of
// the big shot is the answer to the pattern.
//
// The orbs glow as they wind up: r/g/b each climb `191 / rgb_rate` per frame
// while alarm[1] is running, 64 toward 255, and snap back to 64 on firing. So
// an orb whitens just before it spits, which is the entire tell.
//
// `amount` is 1 and nothing in the "full" path changes it, so Alarm 1's
// `amount > 1` / `amount > 2` blocks are dead here. They belong to the
// combination attack's chained segments, along with every turn_type other
// than "full" and the whole `next_up` chain — not translated, same as
// swordfall's, since ac 7 is itself unreachable.
//
// VERIFICATION STATUS: translated from the dump, not oracle-diffed — the
// attack is unreachable in a real fight, so there is nothing to record it
// against. The orb's scanline draw is render/draw/underbox.js.

import { spawn, destroy } from '../entity.js';
import { lengthdirX, lengthdirY } from '../gml.js';
import { gmlIrandom, gmlChoose } from '../rng.js';
import {
  scrBulletInit, regularbulletCreate, regularbulletStep, collidebulletOther15,
} from '../bullets/regularbullet.js';
import { scrLerpvar } from '../lerpvar.js';
import {
  scrAfterimage, scrAfterimageGrow, scrAfterimageGrowAttached,
  knightWarp, knightWarpOut,
} from '../fx.js';
import { WEIRDSHAPE_MASK, DIAMONDFORM_MASK, enginePairHit } from '../masks.js';
import { cue } from '../audio.js';

/**
 * `scr_script_delayed(...)` — a call that lands n frames later, carried on the
 * target itself so it needs no scheduler. Same idea as swordfall.js's
 * `delayedLerp`, generalised: this attack also defers plain assignments
 * (`scr_var`) and an `instance_destroy`.
 */
function delayed(target, delay, fn) {
  (target.pendingDelayed ??= []).push({ delay, fn });
}

function tickDelayed(state, e) {
  if (!e.pendingDelayed || !e.pendingDelayed.length) return;
  for (const p of e.pendingDelayed) p.delay -= 1;
  const due = e.pendingDelayed.filter((p) => p.delay <= 0);
  e.pendingDelayed = e.pendingDelayed.filter((p) => p.delay > 0);
  for (const p of due) p.fn(state, e);
}

/** The big central shot. */
export const weirdCircleBullet = {
  name: 'obj_knight_weird_circle_bullet',

  create(e, state) {
    regularbulletCreate(e, state); // event_inherited() -> obj_regularbullet
    e.timer = 0;
    e.sprite_index = 'spr_knight_weird_shape'; // object definition
    e.destroyonhit = 0;
    e.damage = 206;
    e.element = 5;
    e.grazepoints = 12;
    e.image_yscale = 3;
    e.image_xscale = 0;
    // `scr_script_repeat(scr_afterimage_grow, 600, 4, 0.08, 0, -0.08)` — a
    // swelling ghost every 4 frames for the bullet's whole life. ORIGINAL
    // BUG, harmless: scr_afterimage_grow takes NO arguments, so the three
    // trailing numbers (which look like xrate/yrate/fade overrides) go to a
    // function that never reads them. The ghosts use the object's own
    // defaults, 0.2 / 0.2 / 0.1.
    e.growEvery = 4;
  },

  step(e, state) {
    regularbulletStep(e, state); // event_inherited()
    e.timer += 1;
    // THIS BULLET RE-ARMS ITS GRAZE every third frame, so riding it pays over
    // and over — the reason the big shot is worth standing near.
    if (e.timer % 3 === 0) e.grazed = 0;
    if (e.timer % e.growEvery === 0) scrAfterimageGrow(state, e);
  },

  collides(e, heart) {
    if (e.active !== 1 && e.active !== true) return false;
    return enginePairHit(heart, e, WEIRDSHAPE_MASK);
  },

  other15: collidebulletOther15,
};

/** The fan shots — plain obj_regularbullet wearing spr_diamondbullet_form. */
export const weirdFanBullet = {
  name: 'obj_knight_weird_fan',

  create(e, state) {
    regularbulletCreate(e, state);
    e.sprite_index = 'spr_diamondbullet_form';
    e.damage = 206;
    e.element = 5;
    e.grazepoints = 3;
  },

  step: regularbulletStep,

  collides(e, heart) {
    if (e.active !== 1 && e.active !== true) return false;
    return enginePairHit(heart, e, DIAMONDFORM_MASK);
  },

  other15: collidebulletOther15,
};

/** obj_knight_weird_circle — one orb on the ellipse. */
export const weirdCircle = {
  name: 'obj_knight_weird_circle',

  create(e) {
    e.sprite_index = 'spr_knight_weird_shadow'; // object definition
    e.angle = 0;
    e.distance = 0;
    e.spin = 0;
    e.master = e;
    e.timer = 0;
    e.r = 64;
    e.g = 64;
    e.b = 64;
    e.rgb_rate = 24;
    e.hellzone = false;
    // The orb itself has no mask and no Other_15 — only its bullets bite.
  },

  step(e, state) {
    // `hellzone` clamps the fuse to 13. Only the combination attack's "short"
    // segments set it, so it is inert in the standalone form; kept so the
    // condition reads the same as the dump.
    if (e.hellzone && e.alarm[1] > 13) e.alarm[1] = 13;
    e.timer += 1;
    // GML truthiness: `if (alarm[1])` means `> 0.5`, so an idle -1 is FALSE.
    if (e.alarm[1] > 0.5) {
      // THE WIND-UP GLOW: 64 -> 255 across rgb_rate frames.
      e.r += 191 / e.rgb_rate;
      e.g += 191 / e.rgb_rate;
      e.b += 191 / e.rgb_rate;
      if (e.alarm[1] < 16 && e.alarm[1] % 4 === 0) {
        scrAfterimageGrowAttached(state, e, e, e.image_blend, false);
      }
    }
  },

  alarm: {
    /** `exit;` — it exists only so the Draw can blink while it counts. */
    0() {},

    /** THE VOLLEY. */
    1(e, state) {
      e.r = 64;
      e.g = 64;
      e.b = 64;
      cue(state, 'snd_drake_dodge', 1, 1);

      const big = spawn(state, weirdCircleBullet, { x: e.x, y: e.y });
      big.direction = 90;
      big.speed = 6;
      big.gravity_direction = big.direction;
      big.gravity = 0.2;
      big.image_speed *= 0.5;
      scrLerpvar(state, spawn, big, 'image_yscale', 3, 2, 12);
      scrLerpvar(state, spawn, big, 'image_xscale', 0, 2, 12);
      big.image_angle = big.direction;

      for (let a = 0; a < 5; a++) {
        const b = spawn(state, weirdFanBullet, { x: e.x, y: e.y });
        b.direction = 27.5 + 31.25 * a;
        b.speed = 4;
        b.image_angle = b.direction;
      }
      for (let a = 0; a < 4; a++) {
        // a == 1 and a == 2 are SKIPPED. Without the `continue` this second
        // fan is a wall with no gap in it.
        if (a === 1 || a === 2) continue;
        const b = spawn(state, weirdFanBullet, { x: e.x, y: e.y });
        b.direction = 40 + 33.333333333333336 * a;
        b.speed = 6;
        b.image_angle = b.direction;
      }
    },
  },
};

export const weirdBottomManager = {
  name: 'obj_knight_weird_bottom_manager',

  create(e, state) {
    scrBulletInit(e);
    // scr_darksize()
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.sprite_index = 'spr_knight_warp'; // object definition
    e.image_index = 8;
    e.image_speed = 0;
    e.image_alpha = 1;
    e.timer = 0;
    e.spin = 2;
    e.angle = 0;
    e.amount = 1;
    e.init_start = 4;
    e.init = 8;
    e.circle_val = 0;
    e.circle_goal = 5;
    e.circle_distance = 120;
    e.circle_list = [];
    e.endme = false;
    e.alarm[0] = 16;
    e.center_x = boxCentreX(state);
    e.center_y = boxBottom(state) + 43;
    e.anchor_x = e.x;
    e.anchor_y = e.y;
    e.difficulty = 0;
    e.turn_type = 'full';
    e.turn_segment = -1;
    e.next_up = -999;
    e.next_next_up = -1;
    e.local_turntimer = 340;
    e.pendingDelayed = [];
  },

  /** Other_10. The four `difficulty` blocks in the original are all EMPTY. */
  init(e) {
    e.local_turntimer = 340;
    e.x += 200;
    delayed(e, 8, (st, m) => scrLerpvar(st, spawn, m, 'image_index', 8, 5, 8));
    delayed(e, 16, (st, m) => { m.image_alpha = 0; });
  },

  alarm: {
    /** Seed the ring, one orb every `init_start` frames until five exist. */
    0(e, state) {
      // ORIGINAL BUG, inert: `var rep = 1; if (short start/mid) rep = 6;` and
      // then `repeat (6)` — `rep` is computed and never used, so every
      // turn_type runs the loop six times. Another `linex`.
      for (let i = 0; i < 6; i++) {
        if (e.circle_val < 5) {
          e.circle_val += 1;
          const c = spawn(state, weirdCircle, { x: e.x, y: e.y });
          c.angle = (360 / e.circle_goal) * e.circle_list.length;
          c.distance = e.circle_distance;
          c.spin = e.spin;
          c.master = e;
          c.alarm[0] = 6;
          e.circle_list.push(c);
          e.alarm[0] = e.init_start;
        } else {
          e.alarm[1] = e.init;
        }
      }
    },

    /** Fire, rotate the queue, lurch the spin — or wind the attack down. */
    1(e, state) {
      if (e.local_turntimer < 80) {
        for (const c of e.circle_list) {
          if (!c || !c.alive) continue;
          scrLerpvar(state, spawn, c, 'image_alpha', c.image_alpha ?? 1, 0, 32);
          delayed(c, 32, (st, orb) => destroy(orb));
        }
        e.x = e.anchor_x;
        e.y = e.anchor_y;
        // turn_type "full": he comes back where he left.
        e.alarm[2] = 40;
        delayed(e, 20, (st, m) => scrLerpvar(st, spawn, m, 'image_index', 5, 8, 8));
        delayed(e, 20, (st, m) => { m.image_alpha = 1; });
        return; // `exit;`
      }

      const fuse = 18 * e.amount - 4 * Math.max(e.amount - 1, 0);
      // The frontmost `amount` orbs light up. `amount` is 1 in the standalone
      // form, so this is one orb; the > 1 / > 2 arms are the chained form's.
      for (let i = 0; i < Math.min(e.amount, 3); i++) {
        const c = e.circle_list[i];
        if (c && c.alive) {
          c.alarm[1] = fuse;
          c.rgb_rate = fuse;
        }
      }
      // `ds_list_add(list, list[0]); ds_list_delete(list, 0)` — the queue
      // rotates, so the next volley comes from the next orb round the ring.
      e.circle_list.push(e.circle_list.shift());

      e.alarm[1] = fuse + 2 * gmlIrandom(state.gmlRng, 3);
      const newspin = gmlChoose(state.gmlRng, [-12, 12]);
      const half = e.alarm[1] / 2 - 2;
      // THE LURCH. spin swings out to +-12 and then settles back to +-1, both
      // legs eased "inout" on curve 2 — so the ring surges between volleys
      // instead of turning evenly. First caller of obj_lerpvar's "inout" arm
      // in the project; see sim/gml.js scrEaseInout.
      scrLerpvar(state, spawn, e, 'spin', e.spin, newspin, half, 2, 'inout');
      delayed(e, half, (st, m) => scrLerpvar(
        st, spawn, m, 'spin', newspin, Math.sign(newspin), half, 2, 'inout',
      ));
    },

    /**
     * Done. `next_up` is -999 standalone, so Alarm 2's chain block — which
     * would create the next attack in a combination — is skipped and only
     * `instance_destroy()` runs.
     *
     * THE DESTROY EVENT IS WHAT ENDS THE TURN, and this engine has no Destroy
     * hook, so it runs here — alarm 2 is the object's only route to
     * destruction other than the scene's own end-of-turn sweep (which
     * restores the Knight itself, in clearTurn).
     *
     *     if (turn_type != "start" && ... && scr_bulletparent_count() < 2) {
     *         with (obj_knight_enemy) image_alpha = 1;
     *         global.turntimer = -1;
     *     }
     *
     * The controller pinned `global.turntimer` at 999999 and only this puts it
     * back — along with the Knight's alpha, which his warp-out never restored
     * (obj_knight_warp's event_user(1) has no alarm[0]). The count test means
     * "no other attack is still running", always true standalone.
     */
    2(e, state) {
      if (e.turn_type !== 'start' && e.turn_type !== 'short start'
          && e.turn_type !== 'short mid') {
        const knight = knightEntity(state);
        if (knight) knight.image_alpha = 1;
        state.turntimer = -1;
      }
      destroy(e);
    },
  },

  step(e, state) {
    tickDelayed(state, e);
    // `obj_knight_enemy.siner2 = 0` — he does not bob while he is away, and
    // the anchor is re-read EVERY frame so the return lands wherever he ends
    // up. NOTE this is the knight ENTITY, not `state.knight`, which is the
    // battle-data record (hp, damagereduction) and has no x/y at all: writing
    // an anchor from it produced `undefined`, and `e.x = e.anchor_x` in the
    // wind-down then narrowed to NaN — the manager would simply vanish
    // instead of warping back.
    const knight = knightEntity(state);
    if (knight) {
      knight.siner2 = 0;
      e.anchor_x = knight.x;
      e.anchor_y = knight.y;
    }
    e.local_turntimer -= 1;
    e.timer += 1;
    e.angle += e.spin;
    e.center_x = boxCentreX(state);
    e.center_y = boxBottom(state) + 43;

    // The `local_turntimer < 112 && next_up == 4` block here hands off to
    // obj_knight_swordfall mid-turn. `next_up` is -999 unless the combination
    // attack set it, so it never runs standalone — not translated.

    // THE ELLIPSE. The vertical term is a QUARTER of the horizontal, which is
    // the whole look: they circle UNDER the arena rather than around it.
    for (const c of e.circle_list) {
      if (!c || !c.alive) continue;
      c.x = e.center_x + lengthdirX(c.distance, c.angle + e.angle);
      c.y = e.center_y + lengthdirY(c.distance * 0.25, c.angle + e.angle);
      tickDelayed(state, c);
    }

    // His own warp streak, drifting right at hspeed 4.
    if (state.frame % 4 === 0 && e.image_alpha !== 0) {
      const fade = scrAfterimage(state, e);
      // `fade.depth = creatorid.depth + 1` — creatorid is the Knight, copied
      // down by the controller's scr_bullet_inherit.
      fade.depth = (knight?.depth ?? 0) + 1;
      fade.image_alpha = 0.6;
      fade.fadeSpeed = 0.04;
      fade.speed = 4;
      fade.direction = 0;
    }
  },

};

function growtangle(state) {
  return state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
}

/** The Knight INSTANCE. `state.knight` is his battle record, not his body. */
function knightEntity(state) {
  return state.entities.find((x) => x.alive && x.type.name === 'obj_knight_enemy');
}

/** scr_get_box(4) — obj_growtangle.x. */
function boxCentreX(state) {
  const gt = growtangle(state);
  return gt ? gt.x : state.view.x + 320;
}

/** scr_get_box(3) — obj_growtangle.y + sprite_height * 0.5, the BOTTOM edge. */
function boxBottom(state) {
  const gt = growtangle(state);
  if (!gt) return state.view.y + 245;
  return gt.y + (gt.image_yscale ?? 2) * 75 * 0.5;
}

/**
 * The `type = 106` branch of obj_dbulletcontroller, launch side: warp the
 * Knight out, force the arena back to 2 x 2, and hand the turn to the manager.
 */
export function launchUnderbox(state, x, y) {
  const knight = knightEntity(state);
  if (knight) {
    const w = spawn(state, knightWarp, { x: knight.x, y: knight.y });
    w.master = knight;
    knightWarpOut(state, w);
    knight.image_alpha = 0;
  }
  const gt = growtangle(state);
  if (gt) {
    gt.image_xscale = 2;
    gt.image_yscale = 2;
  }
  const mg = spawn(state, weirdBottomManager, {
    x: x ?? knight?.x ?? 0,
    y: y ?? knight?.y ?? 0,
  });
  weirdBottomManager.init(mg, state);
  return mg;
}

// Combination segment 5 — the registry, not an import, breaks the cycle.
import { registerComboAttack } from './combination.js';
registerComboAttack(5, weirdBottomManager);
