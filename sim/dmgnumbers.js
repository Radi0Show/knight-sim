// obj_dmgwriter — THE FLOATING DAMAGE NUMBER.
//
// Created by `scr_damage_enemy` at
//
//     instance_create(global.monsterx[t],
//                     (global.monstery[t] + 20) - (global.hittarget[t] * 20),
//                     obj_dmgwriter)
//
// `hittarget` increments per hit in the same turn, so three characters hitting
// the Knight stack their numbers 20px apart going UP rather than overlapping.
//
// It is the fight's only quantitative feedback: the Knight's HP is "???", so
// the number that pops off him is the sole way to know whether a bar was worth
// anything.
//
// THE MOTION, from its Draw, and every part of it is load-bearing:
//
//   delay 2 (8 when obj_heroparent sets it)  nothing happens for the first
//                                            frames — the number lands AFTER
//                                            the swing connects, not with it
//   vspeed = -5 - random(2), hspeed = 10     it is thrown up and to the right
//   hspeed decays by 1 a frame toward 0      so the arc straightens out
//   vspeed += 1 while bounces < 2            gravity
//   y > ystart -> y = ystart,                TWO BOUNCES, each half the last
//                 vspeed = vstart / 2
//   killtimer > 35 -> kill += 0.08,          then it rises and fades over 13
//                     y -= 4                 frames and destroys itself
//
// THE SQUASH IS THE WHOLE LOOK. It is drawn
//
//     draw_text_transformed(x + 30, y, msg, 2 - stretch, stretch + kill, 0)
//
// with `stretch` starting at **0.2** and rising 0.4 a frame until it passes
// 1.2, where it clamps to 1. So the scale runs
//
//     (1.8, 0.2) -> (1.4, 0.6) -> (1.0, 1.0)
//
// — the number starts as a wide flat smear and snaps to square in three
// frames. Drawing it at a constant scale loses the impact entirely.
//
// And the fade reuses `kill` in BOTH the alpha and the Y SCALE: `stretch +
// kill` means the number stretches vertically as it disappears.

import { PARTY } from './damage.js';

// `type` is the writer's colour selector, and IT MEANS DIFFERENT THINGS in the
// two directions:
//
//   damage TO the enemy   `dm.type = global.char[caster] - 1`   0/1/2, tinted
//                                                               by the attacker
//   damage TO the party   `dmgwriter.type = doomtype`           **-1** normally
//
// and obj_dmgwriter's Draw opens with `draw_set_color(c_white)` before any of
// the type branches. -1 matches none of them, so **party damage numbers are
// WHITE** — the per-character tints are for damage you DEAL, not damage you
// take. Colouring an incoming hit by who took it is wrong and reads as if the
// party were hitting themselves.
//
// `doomtype` is 4 on death (c_red, and `message = 2` swaps the digits for the
// DOWN graphic) and 12 for the other death branch.
const LIGHTB = [128, 255, 255]; // merge_color(c_aqua, c_white, 0.5)   Kris
const LIGHTF = [255, 153, 255]; // merge_color(c_purple, c_white, 0.6) Susie
const LIGHTG = [128, 255, 128]; // merge_color(c_lime, c_white, 0.5)   Ralsei
export const DMG_COLORS = [LIGHTB, LIGHTF, LIGHTG];

/** `doomtype`. -1 is an ordinary hit on the party; 4 is a death. */
export const TYPE_PARTY = -1;
export const TYPE_DEAD = 4;
const C_WHITE = [255, 255, 255];
const C_RED = [255, 0, 0];

/** The colour for a writer's `type`, exactly as the Draw's branches pick it. */
export function dmgColor(type) {
  if (type === 0) return LIGHTB;
  if (type === 1) return LIGHTF;
  if (type === 2) return LIGHTG;
  if (type === TYPE_DEAD) return C_RED;
  return C_WHITE;
}

/** Damage numbers live on state, not as entities — they touch nothing else. */
export function createDmgNumbers() {
  return { list: [], hittarget: 0 };
}

/**
 * `scr_damage_enemy`'s `instance_create`, plus obj_heroparent's `dm.delay = 8`.
 *
 * @param {number} type   `dm.type`: 0/1/2 for damage DEALT by that
 *                        character, -1 for damage taken, 4 for a death
 * @param {number} damage 0 draws the "MISS" message sprite instead
 */
export function spawnDmgNumber(state, x, y, damage, type, delay = 8) {
  const d = state.dmg;
  if (!d) return;
  d.list.push({
    x,
    // `(monstery + 20) - (hittarget * 20)` — each hit this turn sits 20px
    // higher than the last, which is what keeps three simultaneous hits
    // readable instead of stacked on one another.
    y: y + 20 - d.hittarget * 20,
    ystart: y + 20 - d.hittarget * 20,
    damage,
    type,
    delay,
    delaytimer: 0,
    hspeed: 0,
    vspeed: 0,
    vstart: 0,
    bounces: 0,
    stretch: 0.2,
    stretchgo: 1,
    killtimer: 0,
    killactive: 0,
    kill: 0,
  });
  d.hittarget += 1;
}

/** `global.hittarget[t] = 0` for every enemy at the top of a turn. */
export function resetDmgStack(state) {
  if (state.dmg) state.dmg.hittarget = 0;
}

export function stepDmgNumbers(state, rng) {
  const d = state.dmg;
  if (!d) return;
  for (const n of d.list) {
    // NOTHING HAPPENS UNTIL THE DELAY ELAPSES. With `delay = 8` the number
    // appears eight frames after the hit registers — after the character's
    // swing has connected, which is why it reads as a consequence.
    if (n.delaytimer < n.delay) {
      n.delaytimer += 1;
      if (n.delaytimer === n.delay) {
        // `vspeed = -5 - random(2)` — the throw is randomised, so three
        // numbers from one turn do not travel in lockstep.
        n.vspeed = -5 - (rng ? rng() * 2 : 1);
        n.vstart = n.vspeed;
        n.hspeed = 10;
      }
      continue;
    }

    if (n.hspeed > 0) n.hspeed -= 1;
    else if (n.hspeed < 0) n.hspeed += 1;
    if (Math.abs(n.hspeed) < 1) n.hspeed = 0;
    n.x += n.hspeed;

    if (n.bounces < 2) n.vspeed += 1;
    n.y += n.vspeed;
    if (n.y > n.ystart && n.bounces < 2 && n.killactive === 0) {
      n.y = n.ystart;
      n.vspeed = n.vstart / 2;
      n.bounces += 1;
    }
    if (n.bounces >= 2 && n.killactive === 0) {
      n.vspeed = 0;
      n.y = n.ystart;
    }

    if (n.stretchgo === 1) n.stretch += 0.4;
    if (n.stretch >= 1.2) {
      n.stretch = 1;
      n.stretchgo = 0;
    }

    n.killtimer += 1;
    if (n.killtimer > 35) n.killactive = 1;
    if (n.killactive === 1) {
      n.kill += 0.08;
      n.y -= 4;
    }
  }
  d.list = d.list.filter((n) => n.kill <= 1);
}
