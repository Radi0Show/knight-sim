// obj_roaringknight_boxsplitter_attack — the driver of FLURRY (ac 2,
// dc.type 99), the second attack of phases 1, 2 and 3.
//
// The name is a trap. CLAUDE.md called this object unreachable content
// belonging to `underboxattack` (ac 6); it is nothing of the kind. Its only
// creator anywhere in the dump is obj_dbulletcontroller under `type == 99`,
// which the knight's Step assigns for myattackchoice 2 — Flurry.
// `dc.type = 106` creates obj_knight_weird_bottom_manager, a different object.
// Confirmed by recording: traces/flurry.csv, phase 1 turn 3, shows type=99 and
// this whole chain live.
//
// What it does: on a shortening timer it drops obj_roaringknight_splitslash
// onto the arena. Each slash cuts the battle box, and the cut spawns the
// already-verified obj_knight_split_growtangle organism and its teeth. This
// object owns only the cadence.
//
//   timer      counts up to spawn_speed, then a slash and a reset
//   spawn_speed 50 at difficulty 0, walking down to 40 by 3 per slash
//   local_turntimer  330 down to 30, then the wind-down, then destroy
//
// The cadence is not fixed: a slash that CONNECTS reaches back into this
// object from its Other_15 and does `timer -= 5; local_turntimer += 5`, so
// getting hit delays the next cut and lengthens the turn. That is visible in
// the recording — the gap between slashes 1 and 2 is 52 frames, not 47.
//
// NOT translated (cosmetic, no frame-state effect): the knight sprite/pose
// handling in the wind-down, image_index animation, the hell_surface, and the
// afterimage debris. `splitbox` is assigned -4 and never read anywhere in the
// dump — an ORIGINAL BUG, left in place so a cleanup pass cannot "fix" it into
// a divergence.

import { scrAfterimage } from '../fx.js';
import { spawn, destroy } from '../entity.js';
import { scrApproach, scrMovetowards, lerp, sign } from '../gml.js';
import { splitslash } from './splitslash.js';
import { gmlIrandom } from '../rng.js';

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

export const boxsplitterAttack = {
  name: 'obj_roaringknight_boxsplitter_attack',

  // AFTER THE SPLIT ORGANISM. The runner steps newest-first and this manager
  // is the attack's OLDEST object (created at launch), so in the game every
  // splitslash, tooth and the split_growtangle itself step before it. The
  // read that pins it: the wind-down's `split == false` gate. The organism's
  // con-4 merge clears the flag and the manager zeroes global.turntimer in
  // the SAME frame's step (verify21j: box back at 320 and turntimer 0.033 ->
  // -1 both on f9166, the turn's teardown frame). At the sim's default
  // oldest-first order the manager read yesterday's split=true and held the
  // turn open one frame longer. 0.25 places it after every default-0 attack
  // object but still before the box's own 0.5 slot, which the game's
  // (manager newer than the mnfight-1.5 board) order also implies.
  stepOrder: 0.25,

  create(e, state) {
    e.spawn_speed = 40;
    e.spawn_range = 4;
    e.min_angle = 145;
    e.max_angle = 215;
    e.timer = 200; // >= spawn_speed on the very first Step, so slash 1 is immediate
    e.slash_count = 0;
    e.image_alpha = 1;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.image_speed = 0;
    e.image_index = 1;
    e.animtimer = 5;

    // THIS OBJECT IS THE VISIBLE KNIGHT for the whole attack. The type-99
    // dispatch does `with (creatorid) image_alpha = 0`, hiding
    // obj_knight_enemy, and this takes over the pose — measured in
    // traces/flurry2.csv, where the knight's alpha drops to 0 on frame 13 and
    // this appears at (425, 77.5665) with spr_roaringknight_attack_ol.
    e.sprite_index = 'spr_roaringknight_attack_ol';
    e.depth = 2;
    e.count = 3;
    e.aetimer = 0;
    e.recoil = 0;
    e.final_slash_anim = false;
    e.slash_anim_count = 0;
    e.flip = false;
    e.flipped = -1;
    e.forward = 0;
    e.flip_mode = true;
    e.turn_segment = -1;
    e.local_turntimer = 330;
    e.next_up = -1;
    e.next_next_up = -1;
    e.auto = true;
    e.splitbox = -4; // ORIGINAL BUG: assigned, read nowhere in the dump
    e.anchor_x = e.x;
    e.anchor_y = e.y;
    e.done = false;
    e.omae_wa_con = 0;
    e.omae_wa_timer = 0;
    e.vertical = false;
    e.difficulty = 2; // the controller overwrites this right after Create
    e.init = false;
    e.force_swap = -1;
    e.first_vertical = false;
    e.diagonal = false;
    e.force_oneside = e.difficulty0Force ?? gmlIrandom(state.gmlRng, 1);

    // `growtangle` starts as the obj_growtangle OBJECT, then splitslash
    // replaces it with the split_growtangle INSTANCE at the first cut — so
    // every slash after the first spawns at the organism's position, not the
    // box's. Modelled as null = "the battle box".
    e.splitterRef = null;
  },

  /** The controller does `turn_type = "full"; event_user(0)`. This object has
   *  no Other_10, so event_user(0) is a no-op — turn_type only matters to the
   *  CleanUp, which is not translated. */
  init() {},

  step(e, state) {
    e.local_turntimer -= 1;

    if (!e.init) {
      if (e.difficulty === 0) {
        e.spawn_speed = 50;
      } else if (e.difficulty === 1) {
        e.spawn_speed = 46;
        // ORIGINAL BUG: assigned here and read nowhere in the dump.
        e.force_swap = e.force_swap > 0 ? e.force_swap : gmlIrandom(state.gmlRng, 2) + 1;
      } else if (e.difficulty === 2) {
        e.spawn_speed = 31;
      }
      e.init = true;
      // The init block has its OWN vertical roll, before any cut. Scenes
      // supply it separately from the per-cut table.
      e.vertical = e.initVertical ?? gmlIrandom(state.gmlRng, 1);
    }

    if (!e.auto) return;

    // The knight's slash animation, from this object's Draw event:
    //
    //   if (animtimer < 4) animtimer++;
    //   else if (image_index == 1 || image_index == 4) image_index++;
    //
    // and each cut sets `image_index = (image_index >= 4) ? 1 : 4` with
    // `animtimer = 0`, so he alternates between two two-frame slash poses —
    // 4 then 5, then 1 then 2 — holding each until the next cut. Modelled
    // here rather than in the renderer because image_index is instance state
    // and the pose flip is driven from splitslash's Step.
    if (e.image_alpha === 1) {
      if (e.animtimer < 4) e.animtimer += 1;
      else if (e.image_index === 1 || e.image_index === 4) e.image_index += 1;
    }

    if (e.local_turntimer <= 30) {
      // Wind-down: back to the idle pose, then drift up to meet the knight.
      if (e.local_turntimer <= 10 && e.sprite_index !== 'spr_roaringknight_idle') {
        if (e.image_xscale < 0) e.x -= 220;
        e.image_xscale = Math.abs(e.image_xscale);
        e.sprite_index = 'spr_roaringknight_idle';
        e.image_index = 0;
      } else if (e.local_turntimer < 22 && e.image_xscale < 0) {
        e.image_index = 4;
      }

      const knight = state.entities.find((x) => x.alive && x.type.name === 'obj_knight_enemy');
      if (knight && e.x < knight.x) e.x += 1;
      let lt = e.local_turntimer;
      if (lt < 0) lt = 0;
      if (knight) e.y = lerp(e.y, knight.y, (50 - lt) / 50);

      const splitter = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_split_growtangle',
      );
      if (e.local_turntimer < 0 && !(splitter && splitter.split)) {
        state.turntimer = 0;
        destroy(e);
      }
      return;
    }

    e.timer += 1;
    if (e.timer >= e.spawn_speed) {
      e.timer = 0;

      // ORDER MATTERS: the draw happens even at difficulty 0, where the value
      // is then thrown away for force_oneside. Skipping it would shift the
      // whole stream.
      e.vertical = state.splitterVerticals
        ? state.splitterVerticals[state.splitterVIndex++]
        : gmlIrandom(state.gmlRng, 1);
      // A REPLAYED vertical is the recording's FINAL value — force_oneside
      // (the sim's own roll) must not overwrite it at difficulty 0.
      if (e.difficulty === 0 && !state.splitterVerticals) e.vertical = e.force_oneside;

      const at = e.splitterRef && e.splitterRef.alive ? e.splitterRef : box(state);
      const s = spawn(state, splitslash, { x: at ? at.x : e.x, y: at ? at.y : e.y });
      s.vertical = e.vertical;
      if (e.difficulty === 3) {
        s.diagonal = e.diagonal;
        if (e.diagonal) {
          e.timer = -4;
          e.diagonal = false;
        } else {
          e.diagonal = state.splitterDiagonals
            ? state.splitterDiagonals[state.splitterDIndex++]
            : gmlIrandom(state.gmlRng, 1);
        }
      }

      e.slash_count += 1;
      if (e.difficulty <= 2 && e.spawn_speed > 40) {
        e.spawn_speed = scrMovetowards(e.spawn_speed, 40, 3);
      }
      e.spawn_range = scrApproach(e.spawn_range, 60, 3);
    }
  },

  /**
   * THE MANAGER'S AFTERIMAGE TRAIL, from the same Draw event as the pose flip
   * above:
   *
   *     aetimer++;
   *     if ((aetimer % 4) == 0 && image_alpha != 0) {
   *         fade = scr_afterimage();
   *         fade.image_alpha = 0.6;
   *         fade.fadeSpeed = 0.02;
   *         fade.hspeed = 2 * sign(x - obj_growtangle.x);
   *         ...depth + 50 or + 100 depending on which side he is on
   *     }
   *
   * A ghost every four frames at 0.6 alpha, fading over fifty (0.02 a frame),
   * drifting horizontally AWAY from the arena at 2px. Because the manager
   * teleports from side to side between cuts, the trail is what connects those
   * jumps into a figure that moves — Flurry's knight reads as a blink without
   * it.
   *
   * The whole thing sits inside `if (image_alpha == 1)`, so it stops the
   * moment the wind-down starts fading him out. `aetimer++` comes before the
   * modulo test, so this is an increment-before-use counter: endStep.
   */
  endStep(e, state) {
    if (e.image_alpha !== 1) return;
    e.aetimer += 1;
    if (e.aetimer % 4 !== 0) return;

    const gt = state.entities.find(
      (x) => x.alive && x.type.name === 'obj_growtangle',
    );
    const fade = scrAfterimage(state, e);
    fade.image_alpha = 0.6;
    fade.fadeSpeed = 0.02;
    // `hspeed = ...` — obj_afterimage moves on built-in motion, and hspeed is
    // derived from speed/direction, so this is the equivalent pair.
    const dir = sign(e.x - (gt ? gt.x : e.x));
    fade.speed = Math.abs(2 * dir);
    fade.direction = dir < 0 ? 180 : 0;
    fade.depth = e.depth + (gt && e.x < gt.x ? 50 : 100);
  },
};
