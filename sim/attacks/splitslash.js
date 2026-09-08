// obj_roaringknight_splitslash — Flurry's cut (ac 2, dc.type 99).
//
// Dropped by obj_roaringknight_boxsplitter_attack on its spawn timer. Each one
// telegraphs for 30 frames, then cuts: it snaps back to its spawn point, jitters
// by a random offset and angle, and hands the cut to the already-verified
// obj_knight_split_growtangle organism, which does the actual box-splitting and
// spawns the teeth.
//
//   timer 1        init: angleoffset, and the axis jitter for this cut
//   timer <= 15    thickness eases 10 -> 1 (visual telegraph)
//   timer 29       depth restored
//   timer 30       THE CUT. active = true, split_growtangle con = 1
//   timer 30..33   the ONLY frames this object can hit the soul
//   timer 34       active = false; the sprite animation ends and it destroys
//                  itself unless it connected
//   timer 35+hurt_delay  (only if it connected) damage, then destroy
//
// The hit window is FOUR FRAMES out of ~34. This attack's danger is not the
// slash, it is the organism the slash creates.
//
// A connecting slash feeds back into the whole attack: Other_15 pushes the
// manager's `timer` back 5 and its `local_turntimer` forward 5, so being hit
// delays the next cut and lengthens the turn.
//
// FABRICATED CONTENT REMOVED: this used to call `addShake(state, 6)` on the
// cut. obj_roaringknight_splitslash does not shake anything — no event of it
// mentions a shake, and the only caller of `scr_shakescreen` in the knight's
// code is obj_knight_lightorb's Draw. The invented shake drove a whole-screen
// jitter that alternated sign every frame, which is what the battle board
// "flickering" was.
//
// COSMETIC BUT MODELLED: the 16 obj_afterimage debris (sim/fx.js) and the
// sound cue (sim/audio.js). Neither can touch the soul, but both are spawned
// from this Step in the original and both draw from the shared RNG stream —
// roughly four calls per debris plus a random(4) for the sound pitch — so
// modelling them is closer to the real thing than skipping them. The oracle
// scene replays recorded values and is unaffected either way.
//
// THE SLASHMARKER IS MODELLED (2026-08-29). It used to be listed here as a
// deliberate visual-only omission, together with the black->red merge_color
// tint; the kaizo recording turned the omission into a NUMBER and the decision
// was re-taken with that number in view.
//
//   MEASURED (knight-research/kaizo-mod/oracle/traces/kaizo_oracle_seq_deep.csv,
//   grouped by kaizo_playing): obj_marker counts per turn are 10 / 12 / 10 for
//   atk_Splitter1 / 2 / 3. The organism's two flame markers are two of them;
//   the other 8 / 10 / 8 are exactly one per obj_roaringknight_splitslash. The
//   recording logs each slashmarker ONE FRAME after its slash — the frame the
//   slash's own first Step runs the `!init` block — at the slash's own (x, y),
//   at image_xscale/yscale 2, carrying the slash's image_angle (0 horizontal,
//   90 / 270 vertical, 45 / 315 diagonal: the f32-narrow-then-wrap of -90/-45).
//
// It is in the VANILLA GML, unchanged by the mod: Step_0 line 7 here and line 7
// of the kaizo dump are the same `scr_dark_marker(x, y, spr_rk_quickslash_upper)`
// call, so it belongs in this module and not only in the kaizo copy. It costs
// NO RNG (see scrDarkMarker below), so the shared stream is unmoved.
//
// The black->red merge_color tint comes with it, because the per-frame sync
// (Step_0 40-51) copies `image_blend` onto the marker — leaving the tint out
// would have made that line propagate `undefined`. The telegraph BAR is still
// drawn by render/canvas.js from this object's `timer`, `flip` and
// `angleoffset`; the tint is instance state, not a draw local.
//
// ORIGINAL BUG preserved: `slice_delay = 5` is assigned in Create and read
// nowhere in the entire dump. The delay that actually governs the cut is the
// organism's `split_wait`.

import { spawn, destroy } from '../entity.js';
import { scrDamageMaxhp } from '../damage.js';
import {
  clamp01, lerp, lengthdirX, lengthdirY, scrEaseOut, sign,
  mergeColor, BLACK, RED, WHITE,
} from '../gml.js';
import { scrBulletInit, scrBulletInherit } from '../bullets/regularbullet.js';
import { QUICKSLASH_SHAPE, scrPreciseHitRotatedRect } from '../masks.js';
import { splitGrowtangle } from './split-growtangle.js';
import { gmlChoose, gmlRandom, gmlRandomRange, gmlRandomsign } from '../rng.js';
import { afterimage } from '../fx.js';
import { cue, cueStop } from '../audio.js';

function manager(state) {
  return state.entities.find(
    (e) => e.alive && e.type.name === 'obj_roaringknight_boxsplitter_attack',
  );
}

function organism(state) {
  return state.entities.find(
    (e) => e.alive && e.type.name === 'obj_knight_split_growtangle',
  );
}

function box(state) {
  return state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
}

/**
 * `obj_marker` — the game's GENERIC one-shot sprite stamp, not anything
 * knight-specific. It is used all over DELTARUNE.
 *
 * IT HAS NO CODE ENTRIES ANYWHERE IN THE DUMP. A whole-dump listing of
 * `gml_Object_obj_marker_*` returns only the DERIVED variants (`_jitter`,
 * `_wobble`, `_animateOnce`, `_blendmode`, `_palette`); the base object has no
 * Create, no Step, no Draw. So it is inert: nothing steps it, nothing draws
 * itself with RNG in it, and creating one CONSUMES NO DRAWS. That matters more
 * than the visual — a create that burned a draw would shift every stream
 * position after it (CLAUDE.md, "A visual's draws are still draws").
 *
 * Everything it does here is done TO it by obj_roaringknight_splitslash: it is
 * positioned, rotated, tinted and faded from the slash's Step and deleted with
 * the slash (CleanUp_0 `safe_delete(slashmarker)`).
 */
export const slashMarker = {
  name: 'obj_marker',
};

/**
 * `scr_dark_marker(x, y, sprite)`, line for line
 * (gml_GlobalScript_scr_dark_marker.gml):
 *
 *     thismarker = instance_create(arg0, arg1, obj_marker);
 *     with (thismarker) { sprite_index = arg2; image_speed = 0;
 *                         image_xscale = 2; image_yscale = 2; }
 *     return thismarker;
 *
 * The "dark" in the name is the DOUBLE SCALE — `scr_marker` is the same script
 * without the two scale lines. The recording confirms the 2 x 2 on every
 * slashmarker row.
 */
export function scrDarkMarker(state, x, y, sprite) {
  const m = spawn(state, slashMarker, { x, y });
  m.sprite_index = sprite;
  m.image_speed = 0;
  m.image_xscale = 2;
  m.image_yscale = 2;
  return m;
}

/**
 * `obj_growtangle.depth + N`. The box's own depth lives in the OBJECT
 * DEFINITION, not in any event, so no grep of the code dump can find it —
 * CLAUDE.md, "The OBJECT DEFINITION holds more than the sprite", where the same
 * hole turned this organism's `depth + 10` into NaN. Falling back to 0 keeps
 * the RELATIVE order the code states, which is the part the dump gives us;
 * split-growtangle.js's baseDepth() does exactly this for the flame markers.
 */
function boxDepth(state) {
  const gt = box(state);
  return gt && typeof gt.depth === 'number' ? gt.depth : 0;
}

export const splitslash = {
  name: 'obj_roaringknight_splitslash',

  create(e, state) {
    scrBulletInit(e);
    e.active = false;
    e.timer = 0;
    e.image_alpha = 1;
    e.image_speed = 0;
    e.slash = false;
    e.destroyonhit = false;
    e.thickness = 10;
    // Create l.9 `image_blend = c_black` — the FLOOR of the telegraph ramp in
    // Step, and the value the slashmarker's sync copies before the cut.
    e.image_blend = BLACK;
    e.xdir = 0;
    e.ydir = 0;
    e.xdraw = 250;
    e.ydraw = 250;
    e.init = false;

    // Draw-only, but it CONSUMES a draw.
    e.flip = state.flipTable ? state.flipTable[state.flipIndex++] : gmlChoose(state.gmlRng, [-1, 1]);

    e.damage = 206;
    e.element = 5;
    e.grazepoints = 10;
    e.vertical = false;
    e.memheartx = 0;
    e.memhearty = 0;
    e.playerstrike = false;
    e.cuty = 1;
    e.xoffset = 0;
    e.yoffset = 0;
    e.angleoffset = 0;
    e.difficulty = 0;
    // Create l.24 `slashmarker = -4` — GML's `noone`. Replaced on the first
    // Step by the scr_dark_marker call below; nothing reads it before then.
    e.slashmarker = null;
    e.slice_delay = 5; // ORIGINAL BUG: never read anywhere
    e.hurt_delay = 15;
    e.diagonal = false;

    e.image_angle = 0;
    e.image_xscale = 1;
    e.image_yscale = 1;
    e.isBullet = true;
  },

  step(e, state) {
    e.timer += 1;

    if (!e.init) {
      e.init = true;

      // Step_0 7-10, in the GML's own order and BEFORE the angleoffset draw:
      //
      //     slashmarker = scr_dark_marker(x, y, spr_rk_quickslash_upper);
      //     slashmarker.depth = obj_growtangle.depth + 50;
      //     slashmarker.image_speed = 0;
      //     slashmarker.image_alpha = 0;
      //
      // AT THE SLASH'S OWN (x, y) — this is not the organism's marker and it is
      // not at the box centre by construction, it is at the centre because the
      // slash is dropped there. The recording separates the three markers a
      // turn makes by position (the organism's flames are at its own
      // (x + 2, y - 1) and (x, y + 2)), so a marker parked anywhere else would
      // be counted as the wrong thing.
      //
      // Consumes no RNG, so it can sit here without moving the stream.
      e.slashmarker = scrDarkMarker(state, e.x, e.y, 'spr_rk_quickslash_upper');
      e.slashmarker.depth = boxDepth(state) + 50;
      e.slashmarker.image_speed = 0;
      e.slashmarker.image_alpha = 0;

      const rec = state.slashParams ? state.slashParams[state.slashIndex++] : null;
      e.angleoffset = rec ? rec.angleoffset : gmlRandomRange(state.gmlRng, -12, 12);

      const mg = manager(state);
      const odd = mg ? mg.slash_count % 2 === 1 : false;

      if (e.diagonal) {
        e.direction = odd ? -45 : 45;
        e.vertical = odd;
        e.image_angle = e.direction;
        e.xoffset = rec ? rec.xoffset : gmlRandomRange(state.gmlRng, -2, 2) * 2;
        e.yoffset = rec ? rec.yoffset : gmlRandomRange(state.gmlRng, -2, 2) * 2;
      } else if (e.vertical) {
        e.direction = odd ? -90 : 90;
        e.image_angle = e.direction;
        e.xoffset = rec ? rec.xoffset : gmlRandomRange(state.gmlRng, -8, 8) * 2;
      } else {
        // Note the asymmetry in the original: the horizontal case sets NO
        // direction and NO image_angle, so both stay 0.
        e.yoffset = rec ? rec.yoffset : gmlRandomRange(state.gmlRng, -8, 8) * 2;
      }

      // Step_0 30, the LAST line of the init block: the marker takes the angle
      // the branch above just assigned — 0 for a horizontal cut, +-90 for a
      // vertical one, +-45 for a diagonal. Set ONCE and never again: the
      // `image_angle += angleoffset` tilt at timer 30 is NOT propagated, so the
      // marker keeps the untilted heading for its whole life. The recording
      // agrees — its slashmarker rows carry 0 / 45 / 90 / 270 / 315 exactly
      // (270 and 315 being -90 and -45 narrowed to f32 and then wrapped).
      e.slashmarker.image_angle = e.image_angle;
    }

    // Step_0 36-39: the telegraph charges black -> red over 20 frames. Carried
    // now because the sync below copies it onto the marker. (The
    // `image_alpha < 1 && !slash` ramp above it in the GML is dead — Create
    // pins image_alpha to 1 — so it is still not carried.)
    if (!e.slash) {
      e.image_blend = mergeColor(BLACK, RED, clamp01(e.timer / 20));
    }

    // Step_0 40-51: the marker is a PASSIVE COPY of the slash. Hidden while the
    // telegraph charges, then locked onto the slash's position, animation frame,
    // tint and alpha for the four frames of the cut — it is the UPPER half of
    // the slash sprite, drawn above the arena at growtangle.depth + 50.
    if (!e.slash) {
      e.slashmarker.image_alpha = 0;
    } else {
      e.slashmarker.x = e.x;
      e.slashmarker.y = e.y;
      e.slashmarker.image_index = e.image_index;
      e.slashmarker.image_blend = e.image_blend;
      e.slashmarker.image_alpha = e.image_alpha;
    }

    if (e.timer <= 15) {
      e.thickness = lerp(10, 1, scrEaseOut(e.timer / 15, 4));
    }

    if (e.timer === 30) {
      e.x = e.xstart;
      e.y = e.ystart;
      if (e.image_angle === 90) e.image_yscale *= -1;
      e.image_angle += e.angleoffset;
      e.x += e.xoffset;
      e.y += e.yoffset;
      // Step_0 74: the cut itself is WHITE — the red is the warning, not the
      // blade. It is the line that ends the telegraph ramp, and the sync above
      // hands it to the slashmarker on the next step.
      e.image_blend = WHITE;
      e.active = true;
      e.slash = true;

      let splitter = organism(state);
      if (!splitter) {
        const gt = box(state);
        splitter = spawn(state, splitGrowtangle, { x: gt ? gt.x : e.x, y: gt ? gt.y : e.y });
        // The slash's own `damage = 206` reaches the teeth ONLY through here:
        // splitslash -> split_growtangle -> split_bullet, one inherit per hop.
        // Without this call the organism kept `scr_bullet_init`'s placeholder
        // 10 and passed it down, and 10 against the party's DF resolves to 1.
        //
        // ORDER MATTERS: the original inherits FIRST and then overwrites
        // grazepoints, so the 5 wins over the slash's 10. Swapping these two
        // lines silently changes the graze economy.
        scrBulletInherit(e, splitter);
        splitter.grazepoints = 5;
        const mg = manager(state);
        if (mg) {
          mg.splitterRef = splitter;
          splitter.difficulty = mg.difficulty;
        }
      }

      splitter.xoffset = e.xoffset;
      splitter.yoffset = e.yoffset;
      splitter.angle = e.angleoffset;
      splitter.vertical = e.vertical;
      splitter.diagonal = e.diagonal;
      splitter.con = 1;
      splitter.timer = 0;

      e.sprite_index = 'spr_rk_quickslash';
      e.image_speed = 1;
      e.image_index = 0;
      e.image_yscale *= 2;

      // The debris burst. Cosmetic, but modelled (see sim/fx.js) because it
      // moves on GameMaker's own friction and because the original consumes
      // these draws from the shared stream.
      let angle = e.image_angle;
      if (e.image_xscale < 0) angle += 180;
      const dirx = lengthdirX(60, angle);
      const diry = lengthdirY(60, angle);
      for (let i = 0; i < 16; i++) {
        const d = spawn(state, afterimage, {
          x: e.xstart + e.xoffset,
          y: e.ystart + e.yoffset,
        });
        d.speed = gmlRandomRange(state.gmlRng, 10, 20);
        d.direction = e.image_angle + ((20 - d.speed) * gmlRandomsign(state.gmlRng)) / 2 + 180;
        d.speed += gmlRandomRange(state.gmlRng, -2, 2);
        if (i % 2 === 0) {
          d.direction -= 180;
          d.speed *= 0.75;
          d.x += dirx;
          d.y += diry;
        } else {
          d.x -= dirx;
          d.y -= diry;
        }
        d.image_angle = d.direction;
        d.sprite_index = 'spr_knight_slash_mark';
        d.image_alpha = 1;
        d.image_xscale = d.speed / 10;
        d.image_yscale = 0.1;
        d.friction = 0.5;
        d.fadeSpeed += gmlRandom(state.gmlRng, 0.02);
      }

      // Flip the knight to the other slash pose. He alternates 4->5 and 1->2,
      // and the manager's own Step walks the second frame in after animtimer.
      const mgr = manager(state);
      if (mgr) {
        mgr.image_index = mgr.image_index >= 4 ? 1 : 4;
        mgr.animtimer = 0;
      }

      // `snd_stop(snd_wideslash_low); snd_stop(snd_knight_hurtb);` then
      // `snd_play_x(snd_wideslash_low, 0.8, 0.9 + random(4) / 10)`.
      //
      // The STOP matters here — Flurry cuts every ~20 frames and the sample is
      // longer than that, so without it each slash layers over the last into a
      // continuous roar instead of a series of strikes. The gain is 0.8, which
      // this was passing as 1: `snd_play_x` is (name, GAIN, PITCH) and only the
      // pitch had been carried across.
      cueStop(state, 'snd_wideslash_low');
      cueStop(state, 'snd_knight_hurtb');
      cue(state, 'snd_wideslash_low', 0.9 + gmlRandom(state.gmlRng, 4) / 10, 0.8);
    }

    if (e.timer === 34) {
      e.active = false;
    }

    // Animation End. spr_rk_quickslash is 4 frames at image_speed 1, started
    // at timer 30, so it wraps on timer 34.
    if (e.slash && e.timer >= 34 && !e.playerstrike) {
      // CleanUp_0 is one line — `safe_delete(slashmarker)` — and this engine has
      // no CleanUp hook, so it is carried at each site that destroys the slash.
      // Without it the marker outlives its slash holding image_alpha 1 and the
      // cut's last animation frame, and the arena keeps a frozen slash on it
      // until the end-of-turn sweep.
      if (e.slashmarker) destroy(e.slashmarker);
      destroy(e);
      return;
    }

    if (e.timer === 35 + e.hurt_delay && e.playerstrike) {
      e.playerstrike = 0;
      // Hand the soul back its own drawing — see onHit.
      if (state.soul) state.soul.image_alpha = 1;

      // THE DAMAGE, and it was missing entirely.
      //
      //     if (target != 3) scr_damage_maxhp(0.66, false, true);
      //
      // Flurry's slash does not deal a damage NUMBER — it takes 66% of the
      // target's MAX HP, ignoring DF, halved to 33% by the ShadowMantle, and
      // clamped so it can never fell you. The contact handler deals nothing;
      // it only sets `playerstrike` and the hurt lands here, `35 + hurt_delay`
      // frames later, after the box has finished splitting. That delay is the
      // attack: you are cut, and then a beat afterwards it hurts.
      if (e.target !== 3) scrDamageMaxhp(state, 0.66, false, true, { target: 0 });

      // `global.inv = global.invc * 30`. This wrote `state.inv`, which is
      // READ NOWHERE — a write-only variable, the same class of bug CLAUDE.md
      // catalogues in the original's GML, only this one was mine. The field
      // the damage path actually gates on is `invTimer`. The same-frame
      // post-decrement the trace shows (11 at f1094, not 12) comes from the
      // soul's inv decrement living in the motion phase — see sim/soul.js.
      state.invTimer = state.invc * 30;
      // CleanUp_0: `safe_delete(slashmarker)` — see the other destroy site.
      if (e.slashmarker) destroy(e.slashmarker);
      destroy(e);
    }
  },

  /**
   * The contact test: `if (active == 1 && scr_precise_hit(3))`.
   *
   * NOT a mask-vs-mask overlap. spr_rk_quickslash's mask is a RotatedRect, so
   * this is a 3x3 box around the soul's CENTRE (x+10, y+10) against the cut's
   * rotated, scaled bbox — an oriented-box test (sim/masks.js).
   */
  collides(e, heart, state) {
    // A scene that REPLAYS contacts from a recording must suppress the
    // computed one, or it gets both. Only oracle scenes set this; the playable
    // build never does.
    if (state && state.replayContacts) return false;
    if (e.active !== true && e.active !== 1) return false;
    return scrPreciseHitRotatedRect(heart, e, QUICKSLASH_SHAPE, 3);
  },

  other15(e, state) {
    this.onHit(e, state);
  },

  /** Other_15's body. */
  onHit(e, state) {
    const heart = state.soul;
    // NO SOUL, NO TARGET. obj_heart exists only during the bullet phase — the
    // Knight delivers it per turn via scr_moveheart and it is gone by the
    // party's menu — so a bullet that outlives its turn by a frame has
    // nothing to aim at. Skipping the frame leaves it where it was until the
    // turn sweep takes it; inventing a position would make it lunge at a soul
    // that is not there.
    if (!heart) return;
    e.playerstrike = 1;
    e.active = 0;
    e.memheartx = heart.x;
    e.memhearty = heart.y;
    // `global.inv = -1` — clears invulnerability so the deferred hurt above
    // is guaranteed to land. Same write-only-variable bug as below.
    state.invTimer = -1;

    // THE SOUL IS HIDDEN AND REDRAWN BY THE SLASH. `obj_heart.image_alpha = 0`
    // stops the heart drawing itself; from here the splitslash's Draw event
    // draws it, jittering it a pixel per axis, with `spr_rk_slash_heartslice`
    // over it. That is the whole "you got cut" moment, and without the alpha
    // the soul renders twice — once steady, once shaking.
    heart.image_alpha = 0;

    // WHICH FRAME OF THE SLICE, chosen by WHERE the cut crossed the soul:
    // `remap_clamped(-16, 16, 1, 14, obj_heart.y - (y - 8))` maps the soul's
    // offset from the slash line onto the sprite's 14 frames, so the mark
    // appears at the height it actually landed rather than always centred.
    const off = heart.y - (e.y - 8);
    e.cuty = Math.round(1 + (14 - 1) * clamp01((off - -16) / 32));

    const splitter = organism(state);
    if (splitter) {
      splitter.split_delay = 5;
      e.hurt_delay = splitter.split_wait;
    }
    const mg = manager(state);
    if (mg) {
      // Getting hit DELAYS the next cut and LENGTHENS the turn.
      mg.timer -= 5;
      mg.local_turntimer += 5;
    }
  },

  /** End Step: while the soul is held, drag it back toward where it was caught,
   *  one pixel per axis per frame. */
  endStep(e, state) {
    if (e.playerstrike === 1) {
      const heart = state.soul;
      if (heart.x !== e.memheartx) heart.x = e.memheartx + sign(heart.x - e.memheartx);
      if (heart.y !== e.memhearty) heart.y = e.memhearty + sign(heart.y - e.memhearty);
      e.memheartx = heart.x;
      e.memhearty = heart.y;
    }
  },
};
