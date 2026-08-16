// obj_knight_tunnel_slasher_2_revised + obj_knight_diamondswordbullet_ext —
// "swordtunnel", myattackchoice 3, through obj_dbulletcontroller `type = 102`.
//
// *** NOT IN THE FIGHT. *** ac 3 is on the unused list, and it is the LAST of
// the six. It is also the combination attack's missing third segment, so
// translating it completes ac 7 as well.
//
// NOT THE SAME ATTACK AS ac 13. The fight's sword tunnel is
// `obj_sword_tunnel_manager` (dc.type 153); this is the "_2_revised" object, a
// different and much nastier machine that happens to share the name in
// `global.monsterattackname`.
//
// THE SHAPE. A gap runs at you. Every eight frames the attack picks a new
// `vertical_pos` and fires a PAIR of blades from the right edge — one growing
// down from above the arena, one up from below — leaving a hole between them.
// The hole moves, and the hole is the whole attack:
//
//     newpos = old_pos + 15 + irandom(90);
//     if (newpos > 60) newpos -= 120;          // wraps, so it can jump either way
//     old_pos = vertical_pos;
//     vertical_pos = clamp(newpos, old_pos - 50, old_pos + 50);
//
// and the SIZE OF THE HOLE IS SET BY HOW FAR IT MOVED — 36 if the gap shifted
// under 20 pixels, 44 under 30, 52 under 40, 60 beyond that. A big jump is
// forgiven with a wide gap; a small shift is a tight one. That inverse is the
// design of the attack and it is four lines.
//
// THE FIRST FOUR STRIKES ARE FREE. `first_strike` starts at 1 and steps down
// by 0.25, and while it is above zero the gap is centred (`irandom_range(-15,
// 15)`) and enormous — 100, then 90, 75, 60 — before the real pattern starts.
//
// THE BLADES ARE ALSO A TRICK. Each one is fired at speed 0.5 with
// `gravity_direction = 180, gravity = 0.4` — so they DRIFT IN slowly and then
// accelerate — and `image_xscale` is lerped 0 -> its true length on curve -1,
// ease_out_back, which OVERSHOOTS: the blade extends past its final length and
// snaps back. Their `vspeed` is a tiny `dorifto` so the whole wall sags or
// rises as it comes.
//
// And a stream of FAKES: every fourth frame past `fake_timer > 8` a blade is
// fired with `active = false` and `r/g/b = 34` — a dark, harmless copy behind
// the arena (`depth = obj_growtangle.depth - 1`). You have to read colour, not
// shape, to know which wall is real.
//
// THE FINALE (`local_turntimer < 60`, and only for a standalone turn — a
// chained segment hands off instead): the Knight drops to `spr_roaringknight_
// noarm` and points, every blade still on screen turns RED and shakes
// (`g`/`b` approach 0 at 21.25 a frame), and at timer 12 they all fire at once
// — `event_user(0)` on each: back off 40 pixels, turn to face the soul over 12
// frames, then `speed` lerps -4 -> 0 -> 24 and they come in as a volley.
//
// VERIFICATION STATUS: translated from the dump, not oracle-diffed — ac 3 is
// unreachable, so there is nothing recorded to diff against.

import { spawn, destroy } from '../entity.js';
import {
  scrApproach, clamp, pointDirection, lengthdirX, lengthdirY, angleDifference, sign,
} from '../gml.js';
import { gmlIrandom, gmlIrandomRange, gmlRandom, gmlRandomRange, gmlChoose } from '../rng.js';
import {
  scrBulletInit, regularbulletCreate, regularbulletStep, collidebulletOther15,
} from '../bullets/regularbullet.js';
import { scrLerpvar } from '../lerpvar.js';
import { scrAfterimage, scrAfterimageGrow } from '../fx.js';
import { spriteMaskHit } from '../masks.js';
import { cue, cueLoop, cueStop } from '../audio.js';
import { chainNext, registerComboAttack } from './combination.js';

function boxOf(state) {
  return state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
}
/** scr_get_box, same indices as elsewhere: 0 right, 1 top, 2 left, 3 bottom. */
function getBox(state, which) {
  const gt = boxOf(state);
  if (!gt) return which === 1 ? state.view.y + 95 : state.view.y + 245;
  const hw = (gt.image_xscale ?? 2) * 37.5;
  const hh = (gt.image_yscale ?? 2) * 37.5;
  return [gt.x + hw, gt.y - hh, gt.x - hw, gt.y + hh, gt.x, gt.y][which];
}

export const diamondSwordBullet = {
  name: 'obj_knight_diamondswordbullet_ext',

  create(e, state) {
    regularbulletCreate(e, state); // event_inherited()
    e.sprite_index = 'spr_knight_diamondswordbullet'; // object definition
    e.element = 5;
    e.con = 0;
    e.timer = 0;
    e.topindex = gmlIrandom(state.gmlRng, 12);
    e.botindex = gmlIrandom(state.gmlRng, 12);
    e.shakeme = false;
    e.play_passing_sfx = true;
    e.image_speed = 0;
    e.fake = false;
    e.do_afterimage = false;
    e.r = 255;
    e.g = 255;
    e.b = 255;
  },

  /** Other_10 — THE VOLLEY, fired on every live blade at once. */
  init(e, state) {
    e.shakeme = false;
    e.play_passing_sfx = false;
    const heart = state.soul;
    const atPlayer = heart
      ? pointDirection(e.x, e.y, heart.x + 10, heart.y + 10)
      : 180;
    const aim = atPlayer + 180;
    e.speed = 0;
    // BACK OFF FIRST, away from the soul, then turn and come in.
    const nx = e.x + lengthdirX(40, aim);
    const ny = e.y + lengthdirY(40, aim);
    scrLerpvar(state, spawn, e, 'x', e.x, nx, 12);
    scrLerpvar(state, spawn, e, 'y', e.y, ny, 12);

    // THE LONG WAY ROUND. The turn is written so the blade sweeps through the
    // far side rather than taking the short arc: the target angle is pushed a
    // full turn past the aim, with the +-360 chosen by which side of 180 the
    // current angle is on. A plain lerp to `scr_at_player()` would snap it
    // round the short way and lose the wind-up entirely.
    const angleDiff = angleDifference(e.image_angle, atPlayer);
    const s = sign(angleDiff);
    let thing = e.image_angle;
    if (s === 1) {
      thing = e.image_angle > 180
        ? e.image_angle - angleDiff + 360
        : e.image_angle - angleDiff - 360;
    } else if (s === -1) {
      thing = e.image_angle > 180
        ? e.image_angle - angleDiff - 360
        : e.image_angle - angleDiff + 360;
    }
    scrLerpvar(state, spawn, e, 'image_angle', e.image_angle, thing, 12, 2);
    scrLerpvar(state, spawn, e, 'direction', e.direction, thing, 12, 2);
    // `scr_script_delayed(scr_lerpvar, 13, "speed", -4, 0, 8, 2, "out")` then
    // `..., 21, "speed", 0, 24, 12` — it rocks BACKWARDS first, stops, and
    // then drives in at 24.
    e.pending = [
      { at: 13, run: (st) => scrLerpvar(st, spawn, e, 'speed', -4, 0, 8, 2) },
      { at: 21, run: (st) => scrLerpvar(st, spawn, e, 'speed', 0, 24, 12) },
      { at: 21, run: () => { e.do_afterimage = 1; } },
    ];
    e.pendingT = 0;
  },

  step(e, state) {
    regularbulletStep(e, state); // event_inherited()

    if (e.pending) {
      e.pendingT += 1;
      for (const p of e.pending) {
        if (p.at === e.pendingT) p.run(state);
      }
    }

    // THE COLOUR IS THE TELL. A blade marked `shakeme` bleeds green and blue
    // out at 21.25 a frame — 255 to 0 in twelve — so the wall turns red just
    // before it fires. `fake` blades never do; they are born dark and stay.
    if (e.shakeme && !e.fake) {
      e.g = scrApproach(e.g, 0, 21.25);
      e.b = scrApproach(e.b, 0, 21.25);
    }

    if (e.do_afterimage === 1) {
      e.do_afterimage = 2;
      const a = scrAfterimageGrow(state, e);
      a.image_blend = [255, 0, 0];
    }
    if (e.do_afterimage === 2) {
      const a = scrAfterimage(state, e);
      a.fadeSpeed = 0.33; // scr_afterimageFAST
      a.image_blend = [255, 0, 0];
    }

    if (e.play_passing_sfx && state.soul
      && e.x < state.soul.x + 30 && e.y > state.soul.y) {
      e.play_passing_sfx = false;
      cue(state, 'snd_object_passing', 1, 1);
    }
  },

  collides(e, heart) {
    // `active = false` is what makes a fake harmless, and it is the ONLY
    // difference — a fake has the same mask, the same size and the same
    // motion. Reading the flag here rather than skipping the spawn is what
    // keeps them on screen to lie to you.
    if (e.active !== 1 && e.active !== true) return false;
    return spriteMaskHit(e, heart);
  },

  other15(e, state) {
    if (e.active !== 1 && e.active !== true) return;
    // A GRAZE-LIKE FLINCH. On contact a white (g == 255) unshaken blade that
    // catches you outside i-frames tilts 10 degrees away and HALVES its speed
    // — the wall reacts to hitting you.
    if (!e.shakeme && e.g === 255 && state.invTimer < 0) {
      if (e.image_angle === 90) {
        scrLerpvar(state, spawn, e, 'image_angle', e.image_angle, e.image_angle - 10, 6, 1);
      } else if (e.image_angle === 270) {
        scrLerpvar(state, spawn, e, 'image_angle', e.image_angle, e.image_angle + 10, 6, 1);
      }
      e.speed *= 0.5;
    }
    collidebulletOther15(e, state);
  },
};

/** One blade of a pair. `up` picks which edge it grows from. */
function fireBlade(state, e, opts) {
  const b = spawn(state, diamondSwordBullet, { x: opts.x, y: opts.y });
  b.direction = 180;
  b.speed = opts.speed;
  b.damage = 206;
  b.grazepoints = 4;
  b.element = 5;
  b.image_angle = opts.angle;
  b.image_yscale = 1;
  b.image_alpha = 0;
  b.image_index = 1;
  // THE SPRITE IS PICKED BY LENGTH, and `sprite_width` below is read AFTER the
  // swap — so the scale that gets lerped to is relative to whichever sheet was
  // chosen, not to the default one.
  let width = 33;
  if (opts.len > 48) { b.sprite_index = 'spr_knight_diamondbullet_m'; width = 66; }
  if (opts.len > 80) { b.sprite_index = 'spr_knight_diamondbullet_l'; width = 99; }
  const endscale = opts.len / width;
  b.image_xscale = opts.startScale;
  // CURVE -1 IS ease_out_back — the blade OVERSHOOTS its length and settles.
  scrLerpvar(state, spawn, b, 'image_xscale', 0, endscale, 14, -1);
  scrLerpvar(state, spawn, b, 'image_alpha', 0, 1, 10, 2);
  b.gravity_direction = 180;
  b.gravity = 0.4;
  b.vspeed = opts.drift;
  if (opts.fake) {
    b.active = false;
    b.fake = true;
    b.r = 34; b.g = 34; b.b = 34;
  }
  return b;
}

export const tunnelSlasher2 = {
  name: 'obj_knight_tunnel_slasher_2_revised',

  create(e, state) {
    e.vertical_pos = 0;
    e.old_pos = 0;
    e.hole_size = 60;
    scrBulletInit(e);
    e.image_xscale = 2; // scr_darksize
    e.image_yscale = 2;
    e.sprite_index = 'spr_roaringknight_attack_ol'; // object definition
    e.damage = 206;
    e.knightafterimagerange = 1;
    e.image_speed = 0;
    e.timer = 0;
    e.introtimer = 0;
    e.fake_timer = 0;
    e.siner = 0;
    e.con = 0;
    e.fakefire = 0;
    e.first_strike = 1; // `true`, and then stepped down by 0.25
    e.anchor_x = e.x;
    e.anchor_y = e.y;
    e.state = 'nothin much tbh';
    e.turn_type = 'full';
    e.turn_segment = -1;
    e.next_up = -1;
    e.next_next_up = -1;
    e.local_turntimer = 280;
    e.armpoint = 0;
    e.armpoint_index = 0;
    e.turntimer_limit = 90;
    e.pending = [];
  },

  /** Other_10 — the turn_type arms, including the combination's. */
  init(e, state) {
    const point = () => {
      e.sprite_index = 'spr_roaringknight_point_ol';
      e.image_index = 0;
      e.image_speed = 0;
      scrLerpvar(state, spawn, e, 'image_index', 0, 4, 15, 2);
      scrLerpvar(state, spawn, e, 'x', e.x, e.x + 40, 15, 2);
      scrLerpvar(state, spawn, e, 'y', e.y, getBox(state, 5) - 100, 15, 2);
      scrLerpvar(state, spawn, e, 'knightafterimagerange', e.knightafterimagerange, 4, 30);
      e.con = 1;
      e.timer = 7;
      e.fake_timer = 7;
    };
    if (e.turn_type === 'full') e.local_turntimer = 240;
    if (e.turn_type === 'start') e.local_turntimer = 140;
    if (e.turn_type === 'end') { e.local_turntimer = 140; point(); }
    if (e.turn_type === 'short start') {
      e.local_turntimer = 120;
      if (e.next_up === 4) e.turntimer_limit = 60;
    }
    if (e.turn_type === 'short mid') {
      e.local_turntimer = 100;
      point();
      if (e.next_up === 4) e.turntimer_limit = 70;
    }
    if (e.turn_type === 'short end') { e.local_turntimer = 90; point(); }
  },

  alarm: {
    /** The handoff, identical to every other segment's. */
    2(e, state) {
      chainNext(state, e);
      destroy(e);
    },
  },

  step(e, state) {
    const knight = state.entities.find(
      (k) => k.alive && k.type.name === 'obj_knight_enemy',
    );
    if (knight) {
      knight.siner2 = 0;
      e.anchor_x = knight.x;
      e.anchor_y = knight.y;
    }
    e.local_turntimer -= 1;

    for (const p of e.pending) p.delay -= 1;
    const due = e.pending.filter((p) => p.delay <= 0);
    e.pending = e.pending.filter((p) => p.delay > 0);
    for (const p of due) p.run(state);

    // The mid-turn handoffs to swordfall (4) and the underbox (5) live in this
    // Step rather than in an alarm, so the next segment starts while this
    // one's blades are still in the air.
    if (e.local_turntimer < e.turntimer_limit && (e.next_up === 4 || e.next_up === 5)) {
      chainNext(state, e);
      e.next_up = -999;
    }

    // THE FINALE, for a turn that ends here rather than handing on.
    if (e.local_turntimer < 60 && (e.turn_type === 'full' || e.next_up === -1)
      && e.state !== 'final') {
      e.timer = 0;
      e.fake_timer = -99999;
      e.local_turntimer = 99999;
      e.state = 'final';
      return;
    }

    if (e.state === 'final') {
      e.timer += 1;
      const blades = () => state.entities.filter(
        (x) => x.alive && x.type.name === 'obj_knight_diamondswordbullet_ext',
      );
      if (e.timer === 1) {
        e.sprite_index = 'spr_roaringknight_noarm';
        scrLerpvar(state, spawn, e, 'armpoint', 0, -75, 12, 2);
        // ANYTHING PAST THE LEFT WALL IS DISARMED — a blade that has already
        // crossed the arena cannot come back and kill you in the volley.
        for (const b of blades()) {
          if (b.x < getBox(state, 2)) b.active = false;
        }
        for (const b of blades()) {
          if (!b.active) {
            scrLerpvar(state, spawn, b, 'image_alpha', b.image_alpha, 0, 8);
            e.pending.push({ delay: 8, run: () => destroy(b) });
          } else {
            b.shakeme = true;
          }
        }
      }
      if (e.timer === 12) {
        if (blades().length) cue(state, 'snd_jump', 1, 1);
        cueStop(state, 'snd_shinka_ambience');
        for (const b of blades()) diamondSwordBullet.init(b, state);
      }
      if (e.timer === 33) {
        if (blades().length) cue(state, 'snd_knight_cut', 1, 1);
        e.armpoint_index = 1;
      }
      if (e.timer < 12) {
        // They are HELD while he points: gravity off and the drift damped to
        // nothing, so the wall hangs there.
        for (const b of blades()) {
          if (!b.active) continue;
          b.gravity = 0;
          b.hspeed *= 0.9;
          b.vspeed *= 0.9;
        }
      }
      if (e.timer === 52) {
        scrLerpvar(state, spawn, e, 'image_index', e.image_index, 0, 8);
        e.pending.push({
          delay: 16,
          run: (st) => {
            scrLerpvar(st, spawn, e, 'x', e.x, e.anchor_x, 24, 2);
            scrLerpvar(st, spawn, e, 'y', e.y, e.anchor_y, 24, 2);
          },
        });
      }
      if (e.timer === 92) {
        if (knight) knight.image_alpha = 1;
        state.turntimer = -1;
        destroy(e);
      }
      return;
    }

    if (e.local_turntimer < 40) {
      e.timer = -99999;
      e.fake_timer = -99999;
      e.local_turntimer = 99999;
      if (e.turn_type === 'end' || e.turn_type === 'short end') {
        scrLerpvar(state, spawn, e, 'image_index', e.image_index, 0, 8);
        e.pending.push({
          delay: 16,
          run: (st) => {
            scrLerpvar(st, spawn, e, 'x', e.x, e.anchor_x, 24, 2);
            scrLerpvar(st, spawn, e, 'y', e.y, e.anchor_y, 24, 2);
          },
        });
        e.pending.push({ delay: 40, run: () => { cleanUp(e, state); destroy(e); } });
      } else {
        e.alarm[2] = 1;
      }
      return;
    }

    if (e.con === 0) e.con = 0.1;

    if (e.con === 0.1 || e.con === 0.2) {
      e.introtimer += 1;
      if (e.introtimer === 5) {
        e.con = 0.2;
        e.sprite_index = 'spr_roaringknight_point_ol';
        e.image_index = 0;
        e.image_speed = 0;
        scrLerpvar(state, spawn, e, 'image_index', 0, 4, 15, 2);
        scrLerpvar(state, spawn, e, 'x', e.x, e.x + 40, 15, 2);
        scrLerpvar(state, spawn, e, 'y', e.y, getBox(state, 5) - 100, 15, 2);
        // The drone under the whole attack, and only for the standalone launch.
        if (state.currentAc === 3) cueLoop(state, 'snd_shinka_ambience', 1, 1);
      }
      if (e.introtimer === 20) {
        scrLerpvar(state, spawn, e, 'knightafterimagerange', e.knightafterimagerange, 4, 30);
      }
      if (e.introtimer === 25) {
        e.con = 1;
        e.introtimer = 0;
      }
    }

    // `if ((con >= 0.2 && (...)) || con)` — the second arm makes the whole
    // test true for any non-zero con, so the turn_type list on the first is
    // inert. ORIGINAL BUG, preserved: reading only the first arm would delay
    // every chained segment's first volley.
    if (e.con) {
      e.timer += 1;
      e.fake_timer += 1;
      if (e.timer >= 8) {
        let newpos = e.old_pos + 15 + gmlIrandom(state.gmlRng, 90);
        if (newpos > 60) newpos -= 120;
        e.old_pos = e.vertical_pos;
        e.vertical_pos = clamp(newpos, e.old_pos - 50, e.old_pos + 50);
        // THE HOLE IS SIZED BY THE JUMP — a bigger move is a wider gap.
        const holeDiff = Math.abs(e.old_pos - e.vertical_pos);
        e.hole_size = holeDiff < 20 ? 36 : holeDiff < 30 ? 44 : holeDiff < 40 ? 52 : 60;

        if (e.first_strike > 0) {
          e.vertical_pos = gmlIrandomRange(state.gmlRng, -15, 15);
          e.old_pos = e.vertical_pos;
          e.hole_size = 100;
          if (e.first_strike === 0.75) e.hole_size = 90;
          if (e.first_strike === 0.5) e.hole_size = 75;
          if (e.first_strike === 0.25) e.hole_size = 60;
          e.first_strike = scrApproach(e.first_strike, 0, 0.25);
        }

        const mbox = (getBox(state, 1) + getBox(state, 3)) / 2;
        const dorifto = 0.15 + gmlRandom(state.gmlRng, 0.6) * gmlChoose(state.gmlRng, [1, -1]);
        const decoy = e.first_strike >= 0.75
          && (e.turn_type === 'end' || e.turn_type === 'mid' || e.turn_type === 'short end');

        // The UPPER blade, grown down toward the hole — skipped entirely when
        // the hole has drifted to the very top.
        if (e.vertical_pos > -20) {
          const y1 = mbox + e.vertical_pos - e.hole_size * 0.5;
          const y2 = getBox(state, 1) - 40;
          const y3 = Math.max((y1 - y2) * (0.5 + gmlRandom(state.gmlRng, 0.5)), 50);
          fireBlade(state, e, {
            x: getBox(state, 0) + 40, y: (y1 + (y1 - y3)) / 2, speed: 0.5,
            angle: 270, len: y3, startScale: 15, drift: dorifto, fake: decoy,
          });
        }
        // And the LOWER one.
        if (e.vertical_pos < 20) {
          const y1 = mbox + e.vertical_pos + e.hole_size * 0.5;
          const y2 = getBox(state, 3) + 40;
          const y3 = Math.max((y2 - y1) * (0.5 + gmlRandom(state.gmlRng, 0.5)), 60);
          fireBlade(state, e, {
            x: getBox(state, 0) + 40, y: (y1 + (y1 + y3)) / 2, speed: 0.5,
            angle: 90, len: y3, startScale: 15, drift: dorifto, fake: decoy,
          });
        }
        e.timer = 0;
      }
    }

    // THE DECOY STREAM, every fourth frame — dark, inactive, drawn BEHIND the
    // arena, and otherwise identical. `y3` here is computed from a `y2` picked
    // by `choose` between the two edges, so it can come out negative and the
    // `max` floor does the work.
    if (e.fake_timer > 8 && (e.fake_timer + 8) % 4 === 0) {
      const vertical_pos2 = gmlIrandomRange(state.gmlRng, -70, 70);
      const mbox = (getBox(state, 1) + getBox(state, 3)) / 2;
      const dorifto = 0.25 + gmlRandom(state.gmlRng, 0.6) * gmlChoose(state.gmlRng, [1, -1]);
      const y1 = mbox + vertical_pos2 - e.hole_size * 0.5;
      const y2 = gmlChoose(state.gmlRng, [getBox(state, 1) - 40, getBox(state, 3) + 40]);
      const y3 = Math.max((y1 - y2) * (0.5 + gmlRandom(state.gmlRng, 0.5)), 50);
      const gt = boxOf(state);
      const b = fireBlade(state, e, {
        x: getBox(state, 0) + 40,
        y: (gt ? gt.y : mbox)
          + gmlRandomRange(state.gmlRng, 20, 70) * gmlChoose(state.gmlRng, [1, -1]),
        speed: 0.35, angle: 90, len: y3 * 0.75, startScale: 0,
        drift: dorifto * 2, fake: true,
      });
      if (gt) b.depth = (gt.depth ?? 0) - 1;
    }

    e.siner += 1;
    // The Draw's afterimage, which is per-frame state rather than decoration:
    // it consumes a `random_range` every fourth frame.
    if (e.siner % 4 === 0 && e.image_alpha !== 0) {
      const fade = scrAfterimage(state, e);
      fade.image_alpha = 0.6;
      fade.depth = (knight?.depth ?? 0) + 1;
      fade.fadeSpeed = 0.04;
      fade.speed = 4;
      fade.direction = 0;
      fade.vspeed = gmlRandomRange(
        state.gmlRng, -e.knightafterimagerange, e.knightafterimagerange,
      );
    }
  },
};

/** CleanUp — the closing segment gives the Knight and the clock back. */
function cleanUp(e, state) {
  cueStop(state, 'snd_shinka_ambience');
  if (e.turn_type === 'start' || e.turn_type === 'short start'
    || e.turn_type === 'short mid') return;
  const knight = state.entities.find(
    (k) => k.alive && k.type.name === 'obj_knight_enemy',
  );
  if (knight) knight.image_alpha = 1;
  state.turntimer = -1;
}

/** The `type = 102` branch: hide the Knight, pin the clock, hand over. */
export function launchSwordTunnelRevised(state) {
  const knight = state.entities.find(
    (k) => k.alive && k.type.name === 'obj_knight_enemy',
  );
  state.turntimer = 999999;
  const e = spawn(state, tunnelSlasher2, {
    x: knight?.x ?? state.view.x + 425,
    y: knight?.y ?? state.view.y + 78,
  });
  tunnelSlasher2.init(e, state);
  if (knight) knight.image_alpha = 0;
  return e;
}

// Combination segment 3 — this is what completes ac 7.
registerComboAttack(3, tunnelSlasher2);
