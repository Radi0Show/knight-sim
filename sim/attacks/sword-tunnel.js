// obj_sword_tunnel_manager + obj_sword_tunnel_sword — dc.type 153,
// myattackchoice 13, the fourth turn of phases 1, 2 and 3.
//
// A corridor: pairs of swords stream in from the right, one above and one
// below a gap, and the gap wanders up and down. The dodge is staying in the
// gap while it moves.
//
// The manager runs the corridor mouth. Every `rate` (4) frames it drops a pair
// at `swordy -/+ (50 + gapsize/2)`, then walks `swordy` by `verticalchange`
// (10) in the current direction. It alternates between MOVING for `setcount`
// pairs and HOLDING STILL for `waitsetcount` pairs, re-rolling both each time,
// and it refuses to keep climbing past 20px either side of the box centre —
// which is what keeps the gap reachable.
//
// The swords accelerate: `_speed` starts at 6 and gains `_gravity` (1) every
// frame up to `_maxspeed` 30, so the corridor gets faster the further in you
// are.
//
// THE FINALE IS TRANSLATED. At `finishtimer == finishtimermax` (230, or 250 at
// difficulty 3) the manager flips itself and every live sword to con 1: they
// brake, turn onto the soul, back up, pause, and all dash at speed 80, each
// laying a screen-wide `obj_sword_tunnel_hitbox` as it passes. The soul's mask
// shrinks to spr_dodgeheart_smallmask for it. See the con-1 block below.
//
// Still NOT translated: tobymodes 1 and 2 (difficulties 1 and 2), which the
// selector never hands to ac 13 — it only ever uses difficulty 0, 3 and 4, and
// tobymode 3 IS translated.
//
// The telegraph alpha, the proximity colour ramp and the ten-copy motion trail
// ARE translated now (endStep here, render/draw/swords.js). Still not: the
// per-frame afterimage objects the sword spawns.

import { spawn, destroy } from '../entity.js';
import { viewFor } from '../shake.js';
import { afterimage, afterimageGrow } from '../fx.js';
import { lerp, lengthdirX, lengthdirY, mergeColor, pointDirection, scrAnglechange, WHITE, RED} from '../gml.js';
import { scrBulletInit, collidebulletOther15 } from '../bullets/regularbullet.js';
import {
  collisionLineRect, heartBBox, DIAMOND_MASK, HEART_MASK, HEART_SMALL_MASK,
  PXWHITE2_MASK, masksOverlap,
} from '../masks.js';
import { swordTunnelAnim } from './sword-tunnel-anim.js';
import { gmlChoose, gmlIrandom } from '../rng.js';
import { cue, cueIfIdle } from '../audio.js';

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

/**
 * obj_sword_tunnel_hitbox — the finale's SECOND hitbox.
 *
 * A dashing sword lays one of these down the moment it comes within 80px of the
 * soul: `image_xscale = 999`, `image_yscale = 0.4`, at the sword's heading. A
 * screen-wide bar, `damage = 160`, and invisible (`visible = false`) — the
 * sword's own sprite is the only thing you see.
 *
 * It lives THREE FRAMES and is only active for one:
 *
 *     timer++;
 *     if (timer == 2) active = 1;
 *     if (timer == 3) instance_destroy();
 *
 * So the bar is a single-frame sweep along the line the sword travelled, not a
 * lingering wall. That one frame is the finale's whole damage window.
 */
export const swordTunnelHitbox = {
  name: 'obj_sword_tunnel_hitbox',

  create(e) {
    scrBulletInit(e);
    e.grazepoints = 0.8;
    e.destroyonhit = 0;
    e.timer = 0;
    e.con = 0;
    e.damage = 160;
    e.active = 0;
    e.visible = false;
    e.sprite_index = 'spr_pxwhite2';
    e.isBullet = true;
  },

  step(e) {
    e.timer += 1;
    if (e.timer === 2) e.active = 1;
    if (e.timer === 3) destroy(e);
  },

  collides(e, heart, state) {
    if (e.active !== 1) return false;
    // PRE-STEP soul, like the swept probe and the proximity gate: the bar's
    // one active frame connects against where the soul stood at the top of
    // the frame — verify21j f5683: the recording hits with the soul's row
    // at 212 where the live-position precise test's hit region ends at 211;
    // the pre-step position (208) is inside it.
    const hp = state?.soulPrev ?? heart;
    return masksOverlap(
      heart.mask ?? HEART_MASK, hp.x, hp.y,
      PXWHITE2_MASK, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle,
    );
  },

  other15: collidebulletOther15,
};

export const swordTunnelSword = {
  name: 'obj_sword_tunnel_sword',

  create(e, state) {
    scrBulletInit(e);
    e.grazepoints = 0.8;
    e.destroyonhit = 0;
    e.timer = 0;
    e.con = 0;
    e._maxspeed = 30;
    e.active = 0;
    e.create_2nd_hitbox = false;
    e.image_index = 2;
    e.image_speed = 0;
    e.mydirection = 180;
    // The original assigns _speed/_gravity twice; the second pair wins.
    e._speed = 6;
    e._gravity = 1;
    e.image_yscale = 0;
    e.randx = -20 + gmlIrandom(state.gmlRng, 40);
    e.randy = -20 + gmlIrandom(state.gmlRng, 40);
    e.targetangle = 0;
    e.anglespeed = 8;
    e.telegraph = 0;
    e.telegraphalpha = 0;
    // MEASURED, not guessed: the recording's sprite column reads
    // `spr_knight_diamondbullet_l` for every tunnel sword. This used to be set
    // to spr_roaringknight_sword_ol, which drew the wrong shape AND disagreed
    // with the mask the contact test uses. The visible sword blades in this
    // attack are drawn by obj_knight_swordtunnelanim, a separate object.
    e.sprite_index = 'spr_knight_diamondbullet_l';
    e.isBullet = true;
  },

  step(e, state) {
    e._speed += e._gravity;
    if (e._speed > e._maxspeed) e._speed = e._maxspeed;

    let xadd = lengthdirX(1, e.mydirection);
    let yadd = lengthdirY(1, e.mydirection);

    // ---- con 1: THE FINALE --------------------------------------------------
    //
    // The manager flips every live sword to con 1 at `finishtimer ==
    // finishtimermax` (230, or 250 at difficulty 3). What follows is a second
    // attack bolted onto the corridor, and it is the same shape for every
    // difficulty — only the frame it starts on moves.
    //
    // With `c = 10`:
    //
    //   timer 1        gravity off, TELEGRAPH ON — the red laser line appears
    //   timer < 15     turn to face the soul at `anglespeed` easing 8 -> 0,
    //                  aiming at (heart + 10 + randx/randy) so each sword picks
    //                  a slightly different point
    //   timer < 20     brake: _speed lerps toward 0
    //   timer 21-24    BACK UP at speed 2, away from the aim — the wind-up
    //   timer 25-29    dead stop
    //   timer 30       a growing flare (afterimage_grow, fade 0.2)
    //   timer >= 30    telegraph off, damage 160, SPEED 80 along image_angle
    //
    // So the corridor freezes, every sword turns on the soul, and they all
    // launch at once. `_speed = 80` at 30 frames a second crosses the screen in
    // eight frames.
    if (e.con === 1) {
      e.timer += 1;
      const c = 10;
      if (e.timer === 1) {
        e._gravity = 0;
        e.telegraph = 1;
      }
      if (e.timer < 10 + c / 2) {
        e.anglespeed = lerp(8, 0, e.timer / (10 + c / 2));
        // PRE-STEP soul position, same as the swept probe: the sword aims
        // before the soul's own step moves it (verify21i f1491's finale
        // turn is 0.2 degrees off with the live position).
        const hp = state.soulPrev ?? state.soul;
        if (hp) {
          const want = pointDirection(e.x, e.y, hp.x + 10 + e.randx, hp.y + 10 + e.randy);
          e.image_angle += scrAnglechange(e.image_angle, want, e.anglespeed);
        }
        e.targetangle += e.anglespeed;
      }
      e.direction = e.image_angle;
      if (e.timer < 10 + c) {
        e._speed = lerp(e._speed, 0, e.timer / 10);
      }
      if (e.timer >= 11 + c && e.timer < 15 + c) {
        cueIfIdle(state, 'snd_knight_jump', 0.8);
        e._speed = 2;
        xadd = lengthdirX(2, e.image_angle + 180);
        yadd = lengthdirY(2, e.image_angle + 180);
      }
      if (e.timer >= 15 + c && e.timer < 20 + c) {
        xadd = 0;
        yadd = 0;
      }
      if (e.timer === 20 + c) {
        const flare = spawn(state, afterimageGrow, { x: e.x, y: e.y });
        flare.sprite_index = e.sprite_index;
        flare.image_angle = e.image_angle;
        flare.image_blend = e.image_blend;
        flare.xrate = 0.4;
        flare.yrate = 0.4;
        flare.fade = 0.2;
      }
      if (e.timer >= 20 + c) {
        cueIfIdle(state, 'snd_knight_cut', 0.8);
        e.telegraph = 0;
        e.damage = 160;
        e._speed = 80;
        xadd = lengthdirX(1, e.image_angle);
        yadd = lengthdirY(1, e.image_angle);
      }
    }

    // THE SWEPT HIT TEST. Within 80px of the soul the sword advances in 8px
    // sub-steps, testing a 37px probe from its tip along its heading at each
    // one, then RESTORES its position — so a sword moving 30px per frame
    // cannot tunnel straight through the soul between frames.
    //
    // `collision_line(..., prec = 0)` tests the soul's BOUNDING BOX, not its
    // pixel mask (sim/masks.js).
    // `image_blend = c_white;` runs unconditionally right before this test, and
    // the near-miss branch turns it RED. That is the corridor's whole tell: a
    // sword lights up the moment it enters the 160x160 box around the soul, and
    // its Draw event then ramps it back toward white over 10 frames.
    e.image_blend = WHITE;

    const heart = state.soul;
    // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
    // Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a bullet that outlives its turn by a frame has
    // nothing to aim at. Skipping the frame leaves it where it was until the
    // turn sweep takes it; inventing a position would make it lunge at a soul
    // that is not there.
    if (!heart) return;
    // THE SOUL'S PRE-STEP POSITION (state.soulPrev): the sword steps before
    // the soul in the runner (newest-first), so its proximity gate and its
    // swept probe both read the soul where it stood at the top of the
    // frame — verify21i f1486's connect is 4px of exactly this.
    const hp = state.soulPrev ?? heart;
    if (
      e.x > hp.x - 80 &&
      e.x < hp.x + 80 &&
      e.y < hp.y + 80 &&
      e.y > hp.y - 80
    ) {
      e.image_blend = RED;
      const remx = e.x;
      const remy = e.y;
      const steps = Math.max(Math.floor(e._speed / 8), 1);
      const [bx0, by0, bx1, by1] = heartBBox({ x: hp.x, y: hp.y, mask: heart.mask });
      for (let i = 0; i < steps; i++) {
        e.x += xadd * 8;
        e.y += yadd * 8;
        // `active = 1` INSIDE the sub-step loop, and back to 0 at the bottom —
        // the sword is only ever "live" for the instant of each probe. The
        // damage handler gates on it, so without this the probe found the soul
        // and Other_15 threw the hit away.
        e.active = 1;
        // THE SECOND HITBOX, and it REPLACES the swept probe rather than adding
        // to it — note the `else if` in the original. Once a dashing sword gets
        // within 80px of the soul it lays down a screen-wide bar along its
        // heading (999 x 0.4, damage 160) and stops probing.
        if (e.con === 1 && e._speed === 80 && e.create_2nd_hitbox === false) {
          const hb = spawn(state, swordTunnelHitbox, { x: e.x, y: e.y });
          hb.image_angle = e.image_angle;
          hb.image_yscale = 0.4;
          hb.image_xscale = 999;
          hb.damage = 160;
          // AND THE SOUL'S HITBOX SHRINKS. `with (obj_heart) mask_index =
          // spr_dodgeheart_smallmask` — the finale is survivable precisely
          // because the target gets smaller for it.
          if (state.soul) state.soul.mask = HEART_SMALL_MASK;
          e.create_2nd_hitbox = true;
        } else if (e.create_2nd_hitbox === false) {
          const tipx = e.x + lengthdirX(37, e.image_angle);
          const tipy = e.y + lengthdirY(37, e.image_angle);
          // KNIGHT_SWEEP_ALL="lo-hi" logs EVERY probe evaluation — sample,
          // tip and soul box — not just the ones that connect. Joined against
          // the oracle's own firings (the tunnel sidecar's P rows) by
          // tools/fit-lineprobe.mjs, that is how this model gets scored on
          // real labels instead of a couple of hand-picked receipts.
          if (globalThis.process?.env?.KNIGHT_SWEEP_ALL) {
            const [lo, hi] = globalThis.process.env.KNIGHT_SWEEP_ALL.split('-').map(Number);
            const fnow = globalThis.__simFrame;
            if (fnow >= lo && fnow <= hi) {
              console.error(`[all] f=${fnow} seq=${e.seq} spd=${e._speed} ang=${e.image_angle}`
                // FULL PRECISION, never toFixed(2). These decisions flip on
                // sub-pixel boundaries — a probe at x = 331.9999984 floors to
                // 331 (inside) while the rounded "332.00" floors to 332
                // (outside). Logging two decimals silently rewrote the very
                // cases the fit exists to discriminate, and made a model with
                // a real false positive at f5549 score fp=0.
                + ` s=(${e.x},${e.y}) tip=(${tipx},${tipy})`
                + ` box=[${bx0},${by0},${bx1},${by1}]`
                + ` hit=${collisionLineRect(e.x, e.y, tipx, tipy, bx0, by0, bx1, by1)}`);
            }
          }
          if (collisionLineRect(e.x, e.y, tipx, tipy, bx0, by0, bx1, by1)) {
            if (globalThis.process?.env?.KNIGHT_SWEEP_DEBUG) {
              console.error(`[sweep] f=${globalThis.__simFrame} seq=${e.seq}`
                + ` sample=(${e.x},${e.y}) tip=(${tipx},${tipy})`
                + ` box=[${bx0},${by0},${bx1},${by1}] inv=${state.invTimer}`);
            }
            e.tunnelHits = (e.tunnelHits ?? 0) + 1;
            state.tunnelHits = (state.tunnelHits ?? 0) + 1;
            // `event_user(5)` IS Other_15 — the swept probe does not just
            // count, it deals the damage. This is the corridor's PRIMARY
            // contact path (32 of its 48 recorded hits), and it was tallying
            // and returning: 44 hits a turn and not one point of HP lost.
            swordTunnelSword.other15(e, state);
          }
        }
        e.active = 0;
      }
      e.x = remx;
      e.y = remy;
    }

    e.x += xadd * e._speed;
    e.y += yadd * e._speed;

    // ONE AFTERIMAGE PER FRAME, at the MIDPOINT of the move. This is separate
    // from the ten-copy trail the Draw event stacks: that one is drawn fresh
    // each frame and vanishes, this one persists and fades on its own, so a
    // sword crossing the arena leaves a fading wake behind the live streak.
    // `(x + xprevious) / 2` is why the engine latches xprevious (sim/index.js).
    const ghost = spawn(state, afterimage, {
      x: (e.x + e.xprevious) / 2,
      y: (e.y + e.yprevious) / 2,
    });
    ghost.sprite_index = e.sprite_index;
    ghost.image_index = e.image_index;
    ghost.image_angle = e.image_angle;
    ghost.image_xscale = e.image_xscale;
    ghost.image_yscale = e.image_yscale;
    ghost.image_alpha = 0.4;
    ghost.image_blend = e.con > 0 ? WHITE : e.image_blend;

    // THE CULL RIDES THE SCREEN SHAKE — see viewFor. A hit landing this frame
    // moves cameray() before these swords read it in the real game, which
    // moves the kill line by four pixels.
    const vw = viewFor(state, e);
    if (e.x <= vw.x - 100) return destroy(e);
    if (e.x >= vw.x + 740) return destroy(e);
    if (e.y >= vw.y + 600) return destroy(e);
    if (e.y <= vw.y - 250) return destroy(e);

    if (e.con === 0) {
      e.image_yscale = lerp(e.image_yscale, e._speed / 20, 0.1);
    }
  },

  /**
   * The sword's OWN mask overlap, which is a SECOND contact path distinct from
   * the swept probe above. The probe calls `event_user(5)` explicitly; this is
   * obj_heart's ordinary collision with a `collidebullet`, and the recorder
   * counts both.
   *
   * mask_index is -1 (empty in the recording), so the collision shape is the
   * sprite itself, spr_knight_diamondbullet_l. `image_yscale` starts at 0 and
   * eases toward `_speed / 20` — while it is under 1 the mask is thinner than
   * a pixel and, per the calibrated model, cannot register at all.
   *
   * THIS PATH WAS DEAD until GameMaker's instance defaults landed in spawn()
   * (sim/entity.js). The sword never assigns `image_xscale` because GameMaker
   * already made it 1; here it was `undefined`, which made every overlap test
   * false. It contributes 16 of the attack's 48 recorded hits, so its absence
   * looked exactly like `collision_line` under-firing — and sent this
   * investigation after the wrong primitive twice.
   */
  collides(e, heart) {
    return masksOverlap(
      heart.mask ?? HEART_MASK, heart.x, heart.y,
      DIAMOND_MASK, e.x, e.y, e.image_xscale, e.image_yscale, e.image_angle,
    );
  },

  /**
   * THE DRAW EVENT'S STATE, which is the corridor's entire telegraph.
   *
   *   telegraphalpha  eases toward 0.5 while `telegraph == 1` (+0.05/frame) and
   *                   back to 0 when it drops (-0.1/frame). It is the alpha of
   *                   a red laser line showing where a sword is about to sweep.
   *   image_blend     the Step turns it red on proximity; here it ramps back
   *                   toward white over 10 frames, so a sword that grazed the
   *                   soul stays lit and cools off.
   *
   * `timer` is clamped to 10 first, and the ramp only runs while `con > 0` —
   * both straight from the event.
   */
  endStep(e) {
    if (e.telegraph === 0 && e.telegraphalpha > 0) e.telegraphalpha -= 0.1;
    if (e.telegraph === 1 && e.telegraphalpha < 0.5) e.telegraphalpha += 0.05;

    if (e.con > 0) {
      const t = Math.min(e.timer, 10);
      // `if (image_blend == c_red)` — only the frame it FIRST goes red starts
      // the ramp; after that it is no longer exactly c_red and the test fails,
      // so the colour freezes wherever `timer/10` had reached. Faithful.
      if (e.image_blend === RED) e.image_blend = mergeColor(RED, WHITE, t / 10);
    }
  },

  other15: collidebulletOther15,
};

export const swordTunnelManager = {
  name: 'obj_sword_tunnel_manager',

  create(e, state) {
    // A COLLIDEBULLET IN ITS OWN RIGHT. The object's parent chain (dumped via
    // object_parents.csx) is obj_sword_tunnel_manager -> obj_regularbullet -> the
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

    // `instance_create(obj_knight_enemy.x, obj_knight_enemy.y,
    // obj_knight_swordtunnelanim)` — the knight's performance for this attack.
    // It takes over his appearance entirely; see sword-tunnel-anim.js.
    e.timer = -40 + gmlIrandom(state.gmlRng, 10);
    e.finishtimer = 0;
    // The Create reads the KNIGHT's difficulty, not its own, and difficulty 3
    // lengthens the run before the finale. Missing this stopped the sweep 20
    // frames early: `finishtimer == finishtimermax` sets con = 1, which halts
    // spawning, so the corridor simply stopped feeding at frame 243.
    // `if (obj_knight_enemy.difficulty == 3) finishtimermax = 250;` — it reads
    // the KNIGHT's difficulty, not the manager's own, and it does so in Create.
    //
    // That ordering is the trap. `spawn()` runs create() before the caller can
    // assign anything, so a launcher that sets a field on the returned manager
    // is already too late — which is exactly how the playable build ran
    // difficulty 3's corridor 20 frames short while every suite stayed green.
    // Reading the knight out of `state` here removes the ordering dependency;
    // `knightDifficulty` remains as a fallback for oracle scenes that have no
    // knight.
    const theKnight = state.entities.find(
      (x) => x.alive && x.type.name === 'obj_knight_enemy',
    );
    const kd = theKnight?.difficulty ?? e.knightDifficulty;
    e.finishtimermax = kd === 3 ? 250 : 230;
    e.con = 0;
    // camerax() + camerawidth() + 20
    e.swordx = state.view.x + 640 + 20;
    e.swordy = gt ? gt.y : 190;
    e.swordxrel = 340;
    e.swordyrel = 0;
    e.sworddirection = 180;
    e.swordcount = 0;
    e.setcount = gmlChoose(state.gmlRng, [2, 3, 4]);
    e.waitsetcount = gmlChoose(state.gmlRng, [1, 2, 3]);
    e.movedirection = gmlChoose(state.gmlRng, ['up', 'down']);
    e.tobymode = 0;
    e.tobytimer = 0;
    // `tobyvolleyamount = 10 + irandom(6)` — ORIGINAL BUG: assigned in the
    // create and read nowhere in the dump (the write-only-variable club).
    // Dead mechanically, but the irandom still takes its two draws off the
    // anchored stream — AFTER the three chooses, exactly where the dump
    // rolls it (the old placement right after the timer roll shifted the
    // chooses two positions).
    gmlIrandom(state.gmlRng, 6);
    // The knight's performance object is created at the END of the Create,
    // after every roll — `instance_create(..., obj_knight_swordtunnelanim)`
    // is the dump's last line.
    const knight = state.entities.find(
      (x) => x.alive && x.type.name === 'obj_knight_enemy',
    );
    if (knight) spawn(state, swordTunnelAnim, { x: knight.x, y: knight.y });
    e.difficulty = 0;
    e.stopsfxtimer = 0;
    e.tobyvolleymode = 0;
    e.tobyvolleycount = 0;
    e.tobyvolleymodeinitspeed = 1;
  },

  /** Other_10 — event_user(0), fired from Create. */
  init(e) {
    e.rate = 6;
    e.gapsize = 50;
    e.verticalchange = 15;
    e.tobymode = 0;
    e.maxswords = 999;
    if (e.difficulty === 0) {
      e.rate = 4;
      e.gapsize = 45;
      e.verticalchange = 10;
      e.tobymode = 0;
      e.maxswords = 999;
    }
    if (e.difficulty === 3) {
      e.rate = 4;
      e.gapsize = 45;
      e.verticalchange = 7;
      e.tobymode = 3;
      e.tobytimer = 0;
      e.maxswords = 999;
    }
    // Difficulties 1 and 2 (tobymode 1 and 2) are NOT translated, and are not
    // needed: the selector only ever hands ac 13 difficulty 0, 3 or 4.
    if (e.difficulty === 4) {
      e.rate = 4;
      e.gapsize = 40;
      e.verticalchange = 10;
      e.tobymode = 0;
      e.maxswords = 999;
    }
  },

  step(e, state) {
    e.timer += 1;
    e.finishtimer += 1;

    const gt = box(state);

    if (e.finishtimer === e.finishtimermax) {
      // The finale. Flagged, not translated — the swords' con-1 behaviour is
      // absent, so nothing downstream of this is faithful.
      e.con = 1;
      for (const s of state.entities) {
        if (s.alive && s.type.name === 'obj_sword_tunnel_sword') s.con = 1;
      }
    }

    if (e.timer >= e.rate && e.con === 0) {
      if (e.tobymode === 3) {
        // DIFFICULTY 3 (phase 2, turn 8): the corridor SWEEPS around the box
        // instead of running straight in. `sworddirection` advances 8 degrees
        // per pair, and the gap breathes on a sine.
        //
        // `tobytimer` is incremented TWICE per spawn — once before the sine
        // and once in the middle of the placement block. The sine therefore
        // reads the ODD value: at the first pair it is 1, giving
        // `abs(sin(1/8)) * 5 = 0.6234`, which is exactly what the recording
        // shows. Using the post-increment value gives 1.237 and everything
        // downstream drifts. Preserved as written.
        e.tobytimer += 1;
        if (!e.tobyvolleymode) {
          // PLAIN Math.sin, and that is MEASURED, not an oversight. The f32
          // runner-trig family (fround(sin(fround(rad)))) was tried here on
          // the theory that it would close verify37's f3190 drift; it did not
          // move that front and it BROKE verify-tunnel-difficulty, which is
          // oracle-verified for difficulties 3 and 4. Whatever the f3190
          // offset is, it is not this call's rounding.
          e.verticalchange = Math.abs(Math.sin(e.tobytimer / 8)) * 5;
          e.gapsize = 34 + e.verticalchange * 1.4;
        }

        const cx = gt ? gt.x : 300;
        const cy = gt ? gt.y : 190;
        const dir = e.sworddirection;

        const sx = lengthdirX(e.swordxrel, dir + 180);
        const sy = lengthdirY(e.swordxrel, dir + 180);
        const syaddx = lengthdirX(e.swordy - cy, dir + 270);
        const syaddy = lengthdirY(e.swordy - cy, dir + 270);
        const sgapx = lengthdirX(e.gapsize, dir + 270) * 2;
        const sgapy = lengthdirY(e.gapsize, dir + 270) * 2;

        e.tobytimer += 1;

        // Slower when the corridor is vertical: 1.0 head-on, 0.8 side-on.
        const speedproportion = lerp(1, 0.8, Math.abs(lengthdirY(1, dir + 180)));
        const gravity =
          (2 * speedproportion - e.verticalchange / 15) * e.tobyvolleymodeinitspeed;

        const a = spawn(state, swordTunnelSword, {
          x: cx + sx - sgapx + syaddx,
          y: cy + sy - sgapy + syaddy,
        });
        a.image_angle = dir + 270;
        a.mydirection = dir;
        a.damage = e.damage;
        a._speed = -8 * speedproportion;
        a._gravity = gravity;

        const b = spawn(state, swordTunnelSword, {
          x: cx + sx + sgapx + syaddx,
          y: cy + sy + sgapy + syaddy,
        });
        b.image_angle = dir + 90;
        b.mydirection = dir;
        b.damage = e.damage;
        b._speed = -8 * speedproportion;
        b._gravity = gravity;

        e.sworddirection += 8;
      } else if (e.tobymode === 0) {
        const upper = spawn(state, swordTunnelSword, {
          x: e.swordx,
          y: e.swordy - 50 - e.gapsize / 2,
        });
        upper.image_angle = 270;
        upper.damage = e.damage;

        const lower = spawn(state, swordTunnelSword, {
          x: e.swordx,
          y: e.swordy + 50 + e.gapsize / 2,
        });
        lower.image_angle = 90;
        lower.damage = e.damage;
      }

      if (globalThis.process?.env?.KNIGHT_TUNNEL_DEBUG) {
        console.error(`[tun] f=${globalThis.__simFrame} toby=${e.tobytimer}`
          + ` dir=${e.movedirection} sy=${e.swordy} sc=${e.swordcount}`
          + ` set=${e.setcount} wait=${e.waitsetcount} vc=${e.verticalchange}`);
      }
      if (e.movedirection === 'up') e.swordy -= e.verticalchange;
      if (e.movedirection === 'down') e.swordy += e.verticalchange;

      e.swordcount += 1;

      const boundary =
        (e.setcount === e.swordcount &&
          (e.movedirection === 'down' || e.movedirection === 'up')) ||
        (e.waitsetcount === e.swordcount && e.movedirection === 'none');

      if (boundary) {
        e.swordcount = 0;

        const rec = state.tunnelSets ? state.tunnelSets[state.tunnelIndex++] : null;
        e.setcount = rec ? rec.setcount : gmlChoose(state.gmlRng, [2, 3, 4]);
        e.waitsetcount = rec ? rec.waitsetcount : gmlChoose(state.gmlRng, [1, 2, 3]);

        // Alternate between a moving run and a stationary run.
        if (e.movedirection === 'none') {
          e.movedirection = rec ? rec.movedirection : gmlChoose(state.gmlRng, ['up', 'down']);
        } else {
          e.movedirection = 'none';
        }

        // Refuse to wander more than 20px past the box centre, so the gap
        // stays reachable.
        const cy = gt ? gt.y : 190;
        if (e.movedirection === 'up' && e.swordy < cy - 20) e.movedirection = 'down';
        if (e.movedirection === 'down' && e.swordy > cy + 20) e.movedirection = 'up';
      }
    }

    if (e.timer >= e.rate && e.stopsfxtimer < 3) {
      if (e.con === 1) e.stopsfxtimer += 1;
      cue(state, 'snd_heavy_passing', 1.2, 0.3);
      e.timer = 0;
    }

    if (e.swordcount >= e.maxswords) destroy(e);
  },
};
