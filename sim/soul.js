// The soul. Translated from obj_heart.
//
//   Create : gml_Object_obj_heart_Create_0
//   Step   : gml_Object_obj_heart_Step_0   (lines 1-242 are the movement path)
//
// Translated line-for-line, in source order. Rules 3 and 4 apply throughout:
// expressions are not split or factored, and `ceil` stays `ceil`. Where the
// original reads a global, the equivalent lives on `state`.
//
// Out of scope (dodge-only, per CLAUDE.md): the snd_* calls, the yellow-soul
// shooting block at Step lines 261-322, and image_index bookkeeping. The one
// piece of that block with a movement consequence — `wspeed = 5` when
// color == 1 — IS translated, including its position at the END of Step. That
// placement matters: the new speed does not take effect until the next frame.

import { soulSpeed } from './spells.js';
import { placeMeetingSolid } from './collision.js';

// obj_heart's VISIBLE sprite is spr_dodgeheart, 20x20, origin (0,0) — so
// sprite_width/sprite_height in the boundary clamps are both 20. Distinct
// from the collision mask (spr_dodgeheartmask), which is heart-shaped and
// inset; the boundary clamp uses the sprite, collision uses the mask.
const SPRITE_WIDTH = 20;
const SPRITE_HEIGHT = 20;

export const soul = {
  name: 'obj_heart',

  create(e, state) {
    // global.sp = 4; wspeed = global.sp;
    state.sp = 4;
    e.wspeed = state.sp;

    e.fly = 0;
    e.canmove = 1;
    e.boundaryup = 0;
    e.color = 0;
    e.dmgnoise = 0;

    // disableslow latches here if focus is ALREADY held at create time, and is
    // only cleared by releasing focus. Holding focus through the transition
    // into the fight therefore does not slow the opening frames.
    e.disableslow = 0;
    if (state.input && state.input.focus) {
      e.disableslow = 1;
    }

    e.remove_slow_z_buffer = 40;
  },

  step(e, state) {
    // One-shot birth-frame MOVEMENT freeze for the sword tunnel's delivery.
    // The step itself RUNS — verify21g shows global.inv decrementing on both
    // ac-13 birth frames (f1257/f2901) — but the position stays at the
    // destination exactly: the newborn soul sits inside the still-growing
    // ring's blocked zone and its walk-back resolves every axis to zero.
    // The sim's mid-grow collision does not reproduce that particular
    // rotating fractional-scale geometry, so the observed outcome (step
    // effects yes, movement no) ships directly. See the moveheart alarm in
    // sim/scenes/practice.js.
    if (e.skipBirthStep) {
      e.skipBirthStep = false;
      state.invTimer -= 1;
      state.heartx = e.x + 2 - state.view.x;
      state.hearty = e.y + 2 - state.view.y;
      return;
    }
    const input = state.input;

    e.wallcheck = 0;
    let press_l = 0;
    let press_r = 0;
    let press_d = 0;
    let press_u = 0;
    let bkx = 0;
    let bky = 0;
    let bkxy = 0;
    e.jelly = 2;

    // HOLDBREATH is the one thing in this fight that changes soul speed, and
    // it is applied from obj_knight_enemy's Step, not from obj_heart's:
    //
    //     if (holdbreathcount > 0 && i_ex(obj_heart))              wspeed = 5;
    //     if (holdbreathcount > 0 && i_ex(obj_knight_roaring2) ...) wspeed = 6;
    //
    // Reassigned every frame by the knight, so it is a live property of the
    // fight rather than a one-off write — which matters because the Roaring
    // bump comes and goes with the attack while the base 5 persists.
    e.wspeed = soulSpeed(state);

    if (input.left) press_l = 1;
    if (input.right) press_r = 1;
    if (input.up) press_u = 1;
    if (input.down) press_d = 1;

    let px = 0;
    let py = 0;

    if (e.canmove) {
      // Axes are set independently — no normalisation. A diagonal moves
      // wspeed on both axes. Note the assignment order: holding left and
      // right together leaves px negative, because left is assigned second.
      if (press_r === 1) px = e.wspeed;
      if (press_l === 1) px = -e.wspeed;
      if (press_d === 1) py = e.wspeed;
      if (press_u === 1) py = -e.wspeed;

      if (input.focus && state.flag22 === 0) {
        if (e.disableslow === 0) {
          px = Math.ceil(px * 0.5);
          py = Math.ceil(py * 0.5);
        }
      } else {
        e.disableslow = 0;
      }
    }

    e.remove_slow_z_buffer += 0.5;

    // ---- collision resolution against obj_battlesolid ----------------------
    // Three passes in source order: X alone, Y alone, then the diagonal.
    // Each pass may also slide the soul along the other axis to escape.

    if (placeMeetingSolid(state, e.x + px, e.y)) {
      for (let g = e.wspeed; g > 0; g -= 1) {
        let mvd = 0;
        if (press_d === 0 && !placeMeetingSolid(state, e.x + px, e.y - g)) {
          e.y -= g;
          py = 0;
          break;
        }
        if (press_u === 0 && mvd === 0 && !placeMeetingSolid(state, e.x + px, e.y + g)) {
          e.y += g;
          py = 0;
          break;
        }
      }

      bkx = 0;
      if (px > 0) {
        for (let i = px; i >= 0; i -= 1) {
          if (!placeMeetingSolid(state, e.x + i, e.y)) {
            px = i;
            bkx = 1;
            break;
          }
        }
      }
      if (px < 0) {
        for (let i = px; i <= 0; i += 1) {
          if (!placeMeetingSolid(state, e.x + i, e.y)) {
            px = i;
            bkx = 1;
            break;
          }
        }
      }
      if (bkx === 0) px = 0;
    }

    if (placeMeetingSolid(state, e.x, e.y + py)) {
      bky = 0;
      for (let g = e.wspeed; g > 0; g -= 1) {
        let mvd = 0;
        if (press_r === 0 && !placeMeetingSolid(state, e.x - g, e.y + py)) {
          e.x -= g;
          px = 0;
          break;
        }
        if (mvd === 0 && press_l === 0 && !placeMeetingSolid(state, e.x + g, e.y + py)) {
          e.x += g;
          px = 0;
          break;
        }
      }

      if (py > 0) {
        for (let i = py; i >= 0; i -= 1) {
          if (!placeMeetingSolid(state, e.x, e.y + i)) {
            py = i;
            bky = 1;
            break;
          }
        }
      }
      if (py < 0) {
        for (let i = py; i <= 0; i += 1) {
          if (!placeMeetingSolid(state, e.x, e.y + i)) {
            py = i;
            bky = 1;
            break;
          }
        }
      }
      if (bky === 0) py = 0;
    }

    if (placeMeetingSolid(state, e.x + px, e.y + py)) {
      bkxy = 0;
      let i = px;
      let j = py;
      while (j !== 0 || i !== 0) {
        if (!placeMeetingSolid(state, e.x + i, e.y + j)) {
          px = i;
          py = j;
          bkxy = 1;
          break;
        }
        if (Math.abs(j) >= 1) {
          if (j > 0) j -= 1;
          if (j < 0) j += 1;
        } else {
          j = 0;
        }
        if (Math.abs(i) >= 1) {
          if (i > 0) i -= 1;
          if (i < 0) i += 1;
        } else {
          i = 0;
        }
      }
      if (bkxy === 0) {
        px = 0;
        py = 0;
      }
    }

    // ---- view boundary clamp ----------------------------------------------
    // __view_get(e__VW.XView, 0) / YView. The view is 640x480; the soul is
    // clamped to a 640x320 region measured from the view origin.

    if (e.x + px >= state.view.x + 640 - SPRITE_WIDTH) {
      px = state.view.x + 640 - SPRITE_WIDTH - e.x;
    }
    if (e.x + px <= 0) {
      px = -e.x;
    }
    if (e.y + py <= 0) {
      py = -e.y;
    }
    if (e.y + py >= state.view.y + 320 - SPRITE_HEIGHT + e.boundaryup) {
      py = state.view.y + 320 - SPRITE_HEIGHT - e.y + e.boundaryup;
    }

    // Single commit point, after every resolution pass.
    e.x += px;
    e.y += py;

    // global.inv -= 1. Unclamped in the original — it goes negative and stays
    // there between hits. Do not "fix" this to a floor of zero.
    state.invTimer -= 1;

    state.heartx = e.x + 2 - state.view.x;
    state.hearty = e.y + 2 - state.view.y;

    // Yellow soul is faster. Assigned at the end of Step, so it applies from
    // the NEXT frame — the frame that turns the soul yellow still moves at 4.
    if (e.color === 1) {
      e.wspeed = 5;
    }
  },
};
