/**
 * WHAT THE KNIGHT DRAWS, as data.
 *
 * A pure function returning the ORDERED list of draw calls obj_knight_enemy
 * makes this frame. `render/canvas.js` blits the list; `tools/fullfight-trace`
 * writes it to a sidecar that `verify-fullfight` diffs against the oracle's
 * `oracle_draw.csv`.
 *
 * WHY THIS EXISTS AS A SEPARATE, DOM-FREE MODULE: the 176 traced columns are
 * positions, angles and scales — they record where things ARE, never what is
 * put on screen. Three consecutive wrong versions of the selection highlight
 * shipped through a fully green suite because of that. Rendering could not be
 * checked headlessly while the decisions lived inside a canvas callback, so
 * the decisions moved here and only the blitting stayed behind.
 *
 * The order below is obj_knight_enemy's Draw, top to bottom, including its two
 * early exits — order is part of what is being verified, since a correct
 * overlay composited underneath its base is exactly the bug this is meant to
 * catch.
 */

/** GameMaker's c_white, which is what the fog colour logs as. */
export const C_WHITE = 16777215;
/** The log's "no fog" sentinel. */
export const NO_FOG = -1;

export function knightDrawCalls(state, e) {
  const k = state.knight;
  const out = [];
  if (!k || !e) return out;

  const spr = e.sprite_index ?? 'spr_roaringknight_idle';
  const xs = e.image_xscale ?? 1;
  const ys = e.image_yscale ?? 1;
  const ang = e.image_angle ?? 0;
  const alpha = e.image_alpha ?? 1;
  const blend = e.image_blend ?? C_WHITE;
  // `siner` advances by 1/6 per IDLE frame inside scr_enemy_drawidle_generic.
  // spr_roaringknight_idle has ONE frame, so it never changes what is drawn —
  // but it is the index every one of these calls passes, so it has to be right
  // for the log to match. The old note that siner "is incremented NOWHERE" was
  // reading the Knight's own Draw, where indeed it is not: the increment is in
  // the shared idle helper, two levels down.
  const siner = k.siner ?? 0;
  // scr_enemy_drawidle_generic's `state == 0` branch is
  //
  //     fsiner += 1;
  //     siner += arg0;                       // arg0 = 1/6
  //     draw_monster_body_part(thissprite, siner, x, y);
  //
  // so the increment lands BEFORE the base draw and everything below it in
  // the Draw, while the hurt strobe ABOVE it still sees the old value. One
  // frame's Draw therefore uses two different indices, and the sim used one
  // for both: exactly -1/6 on all 7,458 base rows and 0 on all 1,447 strobe
  // rows, which is how the split was identified rather than guessed.
  const sinerIdle = k.animState === 0 ? siner + (1 / 6) : siner;
  // scr_enemy_object_init: both are 0 for the Knight, and hurtsprite is the
  // SAME sprite as idlesprite (Create sets both to spr_roaringknight_idle).
  const offx = 0;
  const offy = 0;
  const shakex = k.shakex ?? 0;

  // AN INVISIBLE INSTANCE HAS NO DRAW EVENT AT ALL. obj_knight_pointing_cone's
  // Create sets `obj_knight_enemy.visible = false` for the whole of Stars, and
  // GameMaker simply does not run the event — so this is not "draw nothing",
  // it is "none of the below happens", including the counters that live inside
  // the Draw. It has to be the first test here for the same reason.
  if (e.visible === false) return out;

  // `if (i_ex(obj_knight_swordtunnelanim)) exit;` — a separate object performs
  // the whole animation and this Draw stops dead: no bob, no trail, no sprite.
  if (state.entities?.some((x) => x.alive && x.type?.name === 'obj_knight_swordtunnelanim')) {
    return out;
  }

  // `if (chargeupcon == 2) { ...burn-out...; exit; }` — ROARING's launch.
  if (k.chargeupcon === 2) {
    out.push({
      tag: 'burnout', sprite: spr, index: siner, x: e.x, y: e.y,
      xs, ys, ang, blend, alpha: (10 - (k.chargeuptimer ?? 0)) / 10, fog: C_WHITE,
    });
    return out;
  }
  // NO EXIT FOR con 3. Only `chargeupcon == 2` exits the Draw; con 3 falls
  // straight through to scr_enemy_drawidle_generic and the Knight is drawn as
  // normal — at `image_alpha`, which the con 2 -> 3 handoff set to 0. So the
  // game spends the whole roar issuing an INVISIBLE draw every frame rather
  // than issuing none, and the two are indistinguishable on screen but not in
  // the log: 805 base rows the sim did not have.

  // `if (state == 3 && hurttimer >= 0)` — the hurt strobe. The ending's branch
  // uses %3 where the ordinary one uses %2, so he flickers SLOWER while the
  // fight is ending.
  if (k.animState === 3 && (k.hurttimer ?? 0) >= 0) {
    const mod = k.endCutscene === 1 ? 3 : 2;
    const showIdle = ((k.hurttimer ?? 0) % mod) === 0 || !k.stronghurtanim;
    out.push(showIdle
      ? {
        tag: 'strobe_idle', sprite: spr, index: siner,
        x: e.x + shakex + offx, y: e.y + offy, xs: 2, ys: 2, ang: 0, blend, alpha: 1, fog: NO_FOG,
      }
      : {
        tag: 'strobe_ball', sprite: 'spr_roaringknight_ball_transition', index: 7,
        x: e.x + shakex + offx, y: e.y + offy, xs: 2, ys: 2, ang: 0, blend, alpha: 1, fog: NO_FOG,
      });
  }

  // `scr_enemy_drawidle_generic(1/6)` -> `draw_monster_body_part`, which is
  // BOTH the base draw and the selection flash — and is gated on `state == 0`,
  // so a Knight who is mid-hurt shows neither.
  if (k.animState === 0) {
    out.push({ tag: 'base', sprite: spr, index: sinerIdle, x: e.x, y: e.y, xs, ys, ang, blend, alpha, fog: NO_FOG });
    if (k.flash) {
      out.push({
        tag: 'flash', sprite: spr, index: sinerIdle, x: e.x, y: e.y, xs, ys, ang, blend,
        alpha: (-Math.cos((k.fsiner ?? 0) / 5) * 0.4) + 0.6,
        // draw_sprite_ext_flash fogs to its arg7, which the call site passes
        // as image_blend — white for the Knight, but it is the blend, not a
        // hardcoded c_white.
        fog: blend,
      });
    }
  }

  // `if (whiteflash > 0)` — the block hit, over the top, at a fixed 0.62.
  if ((k.whiteflash ?? 0) > 0) {
    if (k.animState === 3 && (k.hurttimer ?? 0) >= 0) {
      out.push({
        tag: 'wflash_hurt', sprite: 'spr_roaringknight_idle', index: 0,
        x: e.x + shakex + offx, y: e.y + offy, xs: 2, ys: 2, ang: 0, blend, alpha: 0.62, fog: C_WHITE,
      });
    }
    if (k.animState === 0) {
      out.push({
        tag: 'wflash_idle', sprite: spr, index: sinerIdle, x: e.x, y: e.y,
        xs, ys, ang, blend, alpha: 0.62, fog: C_WHITE,
      });
    }
  }

  // `if (chargeupcon == 1)` — the wind-up's white silhouette fading in.
  if (k.chargeupcon === 1) {
    out.push({
      tag: 'chargeup', sprite: spr, index: sinerIdle, x: e.x, y: e.y,
      xs, ys, ang, blend, alpha: (k.chargeuptimer ?? 0) / 10, fog: C_WHITE,
    });
  }

  return out;
}
