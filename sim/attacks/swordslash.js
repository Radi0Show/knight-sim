// obj_bullet_knight_crescentGenerator + obj_bullet_knightcrescent — the
// SWORDSLASH, myattackchoice 0, reached through obj_dbulletcontroller
// `type = 109`.
//
// *** NOT IN THE FIGHT. *** No row of the selector assigns ac 0. It is the
// FIRST entry of the unused list and the one this project has already met
// once, from the other side: a freshly created knight defaults to
// `myattackchoice = 0`, and his End Step then drags the soul to
// `camerax() + 165` every frame — the "soul outside the box" bug that CLAUDE.md
// records costing many game runs. That drag is not a bug at all; it is THIS
// ATTACK's arena clamp, running with no attack around it.
//
// THE SHAPE. The arena becomes a narrow vertical SLOT on the far left and
// crescent blades are thrown down it at you.
//
//   the box       `instance_create(view.x + 320 - 152, view.y + 170)` with
//                 `maxxscale = 0.5` — 37 pixels wide and full height, at
//                 x 168. maxyscale is left alone, so it is 0.5 x 2.
//   the clamp     obj_knight_enemy's END STEP, gated on `myattackchoice == 0`:
//                 `if (obj_heart.x > camerax() + 165) obj_heart.x = ...165`.
//                 You cannot leave the slot to the right.
//   type 109      the Knight warps OUT and the generator is created at
//                 `(camerax() + 480, cameray() + 160)` — off to the right,
//                 INVISIBLE (it has no object sprite, and its Draw event's
//                 only loop is behind `drawline = 0`, a debug line left in).
//   difficulty 1  `d.type = 3`, which is the same attack plus the DIAGONAL
//                 sweep below.
//
// SIX LANES. `ypos[i] = box.y - boxheight/2 + (boxheight / (yposcount + 1)) *
// (i + 1)` for i in 0..5 — six evenly spaced heights inside the slot, and
// every crescent is aimed at one of them.
//
// EACH SHOT IS A PAIR. `shootrate` frames apart (15, or 20 while the Knight
// is still at his 0.04 opening reduction), the generator drops two crescents
// at its own y +-5, the second mirrored with `image_yscale = -2`, and lerps
// them 30 frames toward `ypos[curpos] -+ 12`: they SPLIT APART as they fly, so
// a pair is a closing pincer rather than one wide bullet. `hspeed = -1` with
// `friction = -0.35` — NEGATIVE friction, so they accelerate leftward the
// whole way down the screen.
//
// THE GENERATOR MOVES TOO, on `movecon`, lerping its own y to a RANDOM lane
// after every shot — so the pair that is about to fire and the pair already in
// flight rarely share a height.
//
// `curpos` never stands still: `neverstaystill` is set for every type the
// dispatch can reach, so the target lane walks `irandom_range(1, posrange) *
// choose(-1, 1)` each shot, bouncing off the ends (`>= yposcount` subtracts 2,
// `< 0` REFLECTS to `-curpos`).
//
// THE DIAGONAL (type 3 only, every 150 frames): con 10. It settles on a lane,
// waits 30 frames, then sweeps straight up or down — away from the box's
// centre — for 15 frames at `obj_heart.wspeed`, THE SOUL'S OWN WALKING SPEED,
// firing a pair every third frame. A wall you cannot outrun by walking,
// because it is moving at exactly your speed.
//
// VERIFICATION STATUS: translated from the dump, not oracle-diffed — the
// attack is unreachable, so there is nothing to record it against.

import { spawn, destroy } from '../entity.js';
import { scrApproach, gmlEq } from '../gml.js';
import { gmlIrandom, gmlIrandomRange, gmlChoose, gmlRandomRange } from '../rng.js';
import {
  regularbulletCreate, regularbulletStep, collidebulletOther15,
} from '../bullets/regularbullet.js';
import { scrLerpvar } from '../lerpvar.js';
import { scrAfterimage, knightWarp, knightWarpIn, knightWarpOut } from '../fx.js';
import { CRESCENT_MASK, enginePairHit } from '../masks.js';
import { cue } from '../audio.js';

/** The Knight's opening near-immunity, which this attack reads as a difficulty. */
const DR_OPENING = 0.04;

export const knightCrescent = {
  name: 'obj_bullet_knightcrescent',

  create(e, state) {
    regularbulletCreate(e, state); // event_inherited()
    e.sprite_index = 'spr_bullet_knightcrescent'; // object definition
    e.damage = 206;
    // `if (obj_knight_enemy.damagereduction == 0.04) damage = 50;` — the
    // Knight's CREATE value, before his first Step raises it to 0.2. So a
    // crescent thrown in that one-frame window hits for a quarter. Faithful,
    // and effectively unreachable; gmlEq because a GML `==` on a real is
    // epsilon-based (sim/gml.js).
    if (gmlEq(state.knight?.damagereduction ?? 0, DR_OPENING)) e.damage = 50;
    e.grazepoints = 3;
    e.timer = 0;
    e.element = 5;
    // THE MASK IS NOT THE SPRITE. `mask_index = spr_bullet_knightcrescent_hitbox`
    // — a Precise crescent, where the drawn sprite's own mask is the whole
    // 36x34 rectangle. See sim/masks.js.
    e.mask = CRESCENT_MASK;
  },

  step(e, state) {
    regularbulletStep(e, state); // event_inherited()
    e.timer += 1;
    // ONE GHOST PER FRAME, per crescent, each drifting on its own random
    // vertical speed — which is a real draw from the shared stream, not a
    // renderer flourish.
    const a = scrAfterimage(state, e);
    a.speed = 0;
    a.vspeed = gmlRandomRange(state.gmlRng, -0.5, 0.5);
    a.builtinMotion = true;
    a.image_alpha = 0.35;
    if (state.soul) a.depth = (state.soul.depth ?? 0) + 1;
  },

  collides(e, heart) {
    if (e.active !== 1 && e.active !== true) return false;
    return enginePairHit(heart, e, CRESCENT_MASK);
  },

  other15: collidebulletOther15,
};

/**
 * obj_knight_crescentslash_slashinganimation — the wind-up, created FOUR
 * FRAMES before each shot (`shoottimer == shootrate - 4`).
 *
 * Eight frames at image_speed 0.5, darkening as it goes (white -> 40% black at
 * frame 5, 80% at 6, black at 7), and on frame 1 it throws two `obj_marker`
 * copies of the crescent sprite apart on opposite gravity — the visual echo of
 * the pair that is about to be fired — plus `snd_knight_cut2` at pitch 1.3.
 */
export const crescentSlashAnim = {
  name: 'obj_knight_crescentslash_slashinganimation',

  create(e) {
    e.image_xscale = 2; // scr_darksize()
    e.image_yscale = 2;
    e.image_speed = 0.5;
    e.sprite_index = 'spr_knight_crescentslash'; // object definition
    e.image_index = 0;
    e.slash1 = 0;
    e.slash2 = 0;
  },

  step(e, state) {
    e.image_index += e.image_speed;
    if (e.image_index > 7) {
      destroy(e);
      return;
    }
    if (e.image_index >= 5) e.image_blend = [153, 153, 153];
    if (e.image_index >= 6) e.image_blend = [51, 51, 51];
    if (e.image_index >= 7) e.image_blend = [0, 0, 0];

    // `if (image_index == 1)` — image_speed 0.5, so this lands exactly on the
    // second Step. gmlEq for the usual reason.
    if (gmlEq(e.image_index, 1)) {
      cue(state, 'snd_knight_cut2', 1.3, 0.5);
      const lifetime = 8;
      const startalpha = 0.5;
      for (const which of [0, 1]) {
        const m = spawn(state, crescentMarker, { x: e.x - 12, y: e.y - 18 });
        m.sprite_index = 'spr_bullet_knightcrescent';
        m.image_xscale = 2;
        m.image_yscale = which === 0 ? 2 : -2;
        m.image_index = which;
        m.image_alpha = startalpha;
        m.builtinMotion = true;
        m.gravity = which === 0 ? -0.5 : 0.5;
        m.speed = 2;
        m.direction = 0;
        m.doom = lifetime + 1;
        scrLerpvar(state, spawn, m, 'image_alpha', startalpha, 0, lifetime, 2);
        scrLerpvar(state, spawn, m, 'image_yscale',
          m.image_yscale, m.image_yscale * 2, lifetime, 2);
      }
    }

    const fade = scrAfterimage(state, e);
    fade.image_alpha = 0.3;
    fade.fadeSpeed = 0.05;
    fade.image_blend = e.image_blend;
    fade.depth = (e.depth ?? 0) + 1000;
  },
};

/** obj_marker with `scr_doom` — a sprite that flies off and expires. */
export const crescentMarker = {
  name: 'obj_marker',
  create(e) {
    e.image_speed = 0;
    e.doom = -1;
  },
  step(e) {
    if (e.doom > 0) {
      e.doom -= 1;
      if (e.doom === 0) destroy(e);
    }
  },
};

export const crescentGenerator = {
  name: 'obj_bullet_knight_crescentGenerator',

  create(e, state) {
    e.image_speed = 0;
    // NO SPRITE. The object definition carries none and its Draw event's only
    // loop is gated on `drawline = 0` — a debug line-drawing pass left in the
    // shipped game. The generator is invisible; what you see is the slash
    // animation it spawns and the crescents themselves.
    e.visible = false;
    e.con = 0;
    e.timer = 0;
    e.box = -1;
    e.yposcount = 7;
    e.posrange = 2;
    e.ypos = [0];
    e.curpos = 3;
    e.shoottimer = 0;
    e.shootrate = 30;
    e.movementmode = 0;
    e.movecon = 0;
    e.moverate = 5;
    e.init = 0;
    e.neverstaystill = false;
    e.movedown = 0;
    e.bulcount = 0;
    e.diagtimer = 0;
    e.subcon = 0;
    e.framecount = 0;
    e.subtimer = 0;
    e.movetimer = 0;
    e.diagattack = false;
    e.diagattackrate = 150;
    // `type` IN THE ORIGINAL, `variant` HERE. The GML instance variable is
    // called `type`, and `e.type` is this engine's entity descriptor — writing
    // the number over it leaves the object with no `step` and no name, silently
    // (sim/entity.js now throws instead). Create assigns 0 and then 2 four
    // lines later; the second wins, so difficulty 0 is variant 2, and the
    // controller overwrites it with 3 for difficulty 1.
    e.variant = 2;
    e.slowdelaycount = 0;
    e.createslash = 0;
    e.myspeed = -1;
    e.myfrict = -0.35;
    e.boxheight = 150;
  },

  step(e, state) {
    const box = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');

    if (e.init === 0) {
      // Types 0, 1 and 4 are unreachable from the dispatch (it can only send 2
      // or 3), and are translated anyway because they are two lines each and
      // the table is the clearest statement of what the knobs mean.
      if (e.variant === 0) {
        e.movementmode = 0; e.shootrate = 30; e.posrange = 2; e.yposcount = 6;
        e.neverstaystill = 1; e.myspeed = -1; e.myfrict = -0.5;
      } else if (e.variant === 1) {
        e.movementmode = 1; e.shootrate = 20; e.posrange = 2; e.yposcount = 6;
        e.myspeed = -1; e.myfrict = -0.5;
      } else if (e.variant === 2) {
        e.movementmode = 1; e.shootrate = 15; e.posrange = 2; e.yposcount = 6;
        e.neverstaystill = 1; e.myspeed = -1; e.myfrict = -0.35;
        // THE OPENING-REDUCTION EASY MODE, again — 0.04 is the Knight's Create
        // value and his first Step raises it, so this is a one-frame window.
        if (gmlEq(state.knight?.damagereduction ?? 0, DR_OPENING)) {
          e.shootrate = 20;
          e.myfrict = -0.3;
        }
      } else if (e.variant === 3) {
        e.diagattack = true; e.diagattackrate = 150;
        e.movementmode = 1; e.shootrate = 15; e.posrange = 2; e.yposcount = 6;
        e.neverstaystill = 1; e.myspeed = -1; e.myfrict = -0.35;
      } else if (e.variant === 4) {
        e.movementmode = 1; e.shootrate = 20; e.posrange = 1; e.yposcount = 6;
        e.myspeed = -1; e.myfrict = -0.5; e.neverstaystill = true;
        e.slowdelaycount = 0;
      }
      e.moverate = e.shootrate - 5;

      // `if (box == -1) with (obj_growtangle) other.box = id; else { ...; init = 1 }`
      // — so it takes a WHOLE EXTRA FRAME to start: the frame it finds the box
      // only records it, and `init` is set on the next pass.
      if (e.box === -1) {
        if (box) e.box = box;
      } else {
        e.init = 1;
      }
      return;
    }

    if (e.con === 0) {
      e.timer += 1;
      if (e.timer >= 1) {
        e.boxheight = (e.box?.image_yscale ?? 2) * 75;
        e.con = 1;
        e.timer = 0;
        // SIX LANES across the slot.
        for (let i = 0; i < e.yposcount; i++) {
          e.ypos[i] = (e.box.y - e.boxheight / 2)
            + (e.boxheight / (e.yposcount + 1)) * (i + 1);
        }
        e.curpos = Math.round(e.yposcount / 2) - 1;
      }
    }

    if (e.con === 1) {
      // THE TURN CLOCK IS THE ATTACK'S CLOCK. It fires only while more than
      // 50 frames remain and deletes itself under 20, so the last stretch of
      // the turn is deliberately empty — time to clear what is already flying.
      if (state.turntimer > 50) {
        e.shoottimer += 1;
        e.timer += 1;
      } else if (state.turntimer < 20) {
        // THE CLEANUP IS WHAT BRINGS HIM BACK, and this engine has no CleanUp
        // hook, so it runs at the one site that ends the object:
        //
        //     with (obj_knight_enemy) { x = xstart; hspeed = 0; }
        //     with (obj_knight_enemy)
        //         with (instance_create_depth(x, y, depth, obj_knight_warp))
        //             { master = other.id; event_user(0); }
        //
        // event_user(0) is the warp IN — the direction that hands the master
        // his alpha back (sim/fx.js). The warp OUT the controller used has no
        // such courtesy, so without this he stays invisible until the scene's
        // end-of-turn sweep restores him.
        const knight = state.entities.find(
          (k) => k.alive && k.type.name === 'obj_knight_enemy',
        );
        if (knight) {
          knight.x = knight.xstart;
          knight.hspeed = 0;
          const w = spawn(state, knightWarp, { x: knight.x, y: knight.y });
          w.master = knight;
          knightWarpIn(state, w);
        }
        destroy(e);
        return;
      }

      if (e.diagattack === true) {
        e.diagtimer += 1;
        if (e.diagtimer === e.diagattackrate) {
          e.diagtimer = 0;
          e.con = 10;
          e.subcon = 0;
          e.shoottimer = 0;
          e.movetimer = 0;
          e.movecon = 0;
        }
      }

      if (e.shoottimer === e.shootrate - 4) e.createslash = 1;

      if (e.shoottimer >= e.shootrate) {
        e.bulcount += 1;
        const pair = firePair(state, e);
        if (e.movementmode === 0) {
          scrLerpvar(state, spawn, pair[0], 'y', pair[0].y, pair[0].y - 14, 25);
          scrLerpvar(state, spawn, pair[1], 'y', pair[1].y, pair[1].y + 14, 25);
          e.movecon = 1;
        }
        if (e.movementmode === 1) {
          scrLerpvar(state, spawn, pair[0], 'y', pair[0].y, e.ypos[e.curpos] - 12, 30);
          scrLerpvar(state, spawn, pair[1], 'y', pair[1].y, e.ypos[e.curpos] + 12, 30);
          // type 4's occasional slow pair — unreachable from the dispatch,
          // kept because the `choose(0, 0, 1)` is a real draw in its stream.
          if (e.variant === 4 && gmlChoose(state.gmlRng, [0, 0, 1]) === 1
            && e.slowdelaycount <= 0) {
            e.slowdelaycount = 2;
            for (const b of pair) { b.friction *= 0.25; b.speed *= 0.5; }
            pair[0].image_yscale = 1;
            pair[1].image_yscale = -1;
          }
          e.movecon = 1;
        }

        // THE LANE WALK. `neverstaystill` is set for every reachable type, so
        // the second arm is the live one: a step of 1..posrange in a random
        // direction, which cannot be zero — the target never repeats.
        if (!e.neverstaystill) {
          e.curpos += gmlIrandomRange(state.gmlRng, -e.posrange, e.posrange);
        } else {
          e.curpos += gmlIrandomRange(state.gmlRng, 1, e.posrange)
            * gmlChoose(state.gmlRng, [-1, 1]);
        }
        // The ends are not clamped, they BOUNCE: over the top subtracts two,
        // and below zero reflects. `curpos = -curpos` on -1 gives 1, not 0.
        if (e.curpos >= e.yposcount) e.curpos -= 2;
        if (e.curpos < 0) e.curpos = -e.curpos;

        e.shoottimer = 0;
        if (e.slowdelaycount === 1) {
          e.shoottimer = -e.shootrate / 2;
          e.slowdelaycount = -1;
        }
        e.slowdelaycount -= 1;
      }

      if (e.movecon === 1) {
        // THE GENERATOR RELOCATES AFTER EVERY SHOT. Mode 0 follows the lane it
        // just fired at; mode 1 — the one both reachable types use — jumps to
        // a RANDOM lane, so where the next pair comes from is never where the
        // last one did.
        if (e.movementmode === 0) {
          scrLerpvar(state, spawn, e, 'y', e.y, e.ypos[e.curpos], e.moverate, 2);
          e.movecon = 0;
        }
        if (e.movementmode === 1) {
          scrLerpvar(state, spawn, e, 'y', e.y,
            e.ypos[gmlIrandom(state.gmlRng, e.yposcount - 1)], e.moverate, 2);
          e.movecon = 0;
        }
      }
    }

    // ---- con 10: THE DIAGONAL SWEEP (type 3 only) --------------------------
    if (e.con === 10) {
      if (e.subcon === 0) {
        // Wait for the relocation lerp to finish — `yprevious == y` is "I did
        // not move this frame", held for three frames.
        if (e.yprevious === e.y) {
          e.diagtimer += 1;
          if (e.diagtimer === 3) e.subcon = 1;
        }
      }
      if (e.subcon === 1) {
        const desy = gmlIrandom(state.gmlRng, e.yposcount - 2) + 1;
        scrLerpvar(state, spawn, e, 'y', e.y, e.ypos[desy], 10, 2);
        e.subcon = 2;
        e.diagtimer = 0;
      } else if (e.subcon === 2) {
        e.diagtimer += 1;
        if (e.diagtimer >= 30) {
          e.subcon = 3;
          e.diagtimer = 0;
          // AWAY FROM THE MIDDLE: above the box's centre sweeps DOWN, below
          // sweeps up. So the wall always crosses the whole slot.
          e.movedown = -1;
          if (e.box && e.box.alive && e.y < e.box.y) e.movedown = 1;
          // AT YOUR OWN WALKING SPEED. `obj_heart.wspeed` is the soul's speed
          // (4 for the red soul), so the sweep travels exactly as fast as you
          // can run from it — the whole point of the move.
          const heartmovespeed = state.soul?.wspeed ?? 4;
          e.framecount = 15;
          scrLerpvar(state, spawn, e, 'y', e.y,
            e.y + e.framecount * e.movedown * heartmovespeed, e.framecount);
          e.subtimer = 0;
        }
      } else if (e.subcon === 3) {
        if (e.diagtimer === 2) e.createslash = 1;
        if (e.diagtimer <= 0) {
          const pair = firePair(state, e);
          scrLerpvar(state, spawn, pair[0], 'y', pair[0].y, pair[0].y - 16, 25);
          scrLerpvar(state, spawn, pair[1], 'y', pair[1].y, pair[1].y + 16, 25);
          e.diagtimer = 3;
        }
        e.diagtimer -= 1;
        e.subtimer += 1;
        if (e.box && e.box.alive) {
          const half = (e.box.image_yscale ?? 2) * 75 * 0.5;
          if ((e.movedown === 1 && e.y > e.box.y + half - 30)
            || (e.movedown === -1 && e.y < e.box.y - half + 30)) {
            e.subtimer = e.framecount + 1;
          }
        }
        if (e.subtimer >= e.framecount) {
          e.con = 1;
          e.diagtimer = 0;
          e.subcon = 0;
          e.timer = 0;
          e.subtimer = 0;
          // A SHORT REPRIEVE: the normal cadence restarts ten frames in debt.
          e.shoottimer = -10;
          e.movetimer = 0;
        }
      }
    }

    if (e.createslash) {
      const s = spawn(state, crescentSlashAnim, { x: e.x + 12, y: e.y + 18 });
      s.depth = (e.depth ?? 0) - 20 - s.y;
      e.createslash = 0;
    }
    e.yprevious = e.y;
  },
};

/** The two crescents, at the generator's y +-5, the lower one mirrored. */
function firePair(state, e) {
  const bul = spawn(state, knightCrescent, { x: e.x, y: e.y + 5 });
  const bul2 = spawn(state, knightCrescent, { x: e.x, y: e.y - 5 });
  for (const b of [bul, bul2]) {
    b.image_xscale = 2; // scr_darksize
    b.image_yscale = 2;
    // `hspeed = myspeed` with `myspeed = -1`. GameMaker derives speed and
    // direction from the components, so hspeed -1 / vspeed 0 IS speed 1 at
    // direction 180 — and it has to be modelled that way here, because
    // `friction` acts on the speed MAGNITUDE and this engine's component-motion
    // path deliberately skips friction (it exists for obj_diagonal_bullet,
    // which has none). Routing the crescents through components would have
    // left them drifting at a flat -1 for the whole screen instead of
    // accelerating.
    b.builtinMotion = true;
    b.speed = 1;
    b.direction = 180;
    // NEGATIVE FRICTION ACCELERATES. `speed = speed - friction` with friction
    // -0.35 adds a third of a pixel per frame, every frame, so a crescent
    // crosses the last part of the screen far faster than the first.
    b.friction = e.myfrict;
  }
  // `bul2.image_yscale = -2` — the pair is one blade and its mirror image.
  bul2.image_yscale = -2;
  return [bul, bul2];
}

/**
 * The `type = 109` branch. The Knight warps OUT here and it is the generator's
 * CLEANUP that brings him back (`x = xstart`, `hspeed = 0`, and an
 * obj_knight_warp event_user(0), which is the direction that restores alpha).
 */
export function launchSwordslash(state, difficulty = 0) {
  const knight = state.entities.find(
    (k) => k.alive && k.type.name === 'obj_knight_enemy',
  );
  if (knight) {
    // `with (creatorid) with (instance_create_depth(...obj_knight_warp))
    //  { master = other.id; event_user(1); }` — the warp OUT.
    const w = spawn(state, knightWarp, { x: knight.x, y: knight.y });
    w.master = knight;
    knightWarpOut(state, w);
    knight.image_alpha = 0;
  }
  const e = spawn(state, crescentGenerator, {
    x: state.view.x + 480,
    y: state.view.y + 160,
  });
  if (difficulty === 1) e.variant = 3;
  return e;
}
