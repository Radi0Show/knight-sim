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

import { PARTY_POS } from './damage.js';
import { gmlRandom } from './rng.js';

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
/**
 * `scr_charbox_x(i)` for a three-character party — 0, 212, 424. NOT the 213 /
 * 426 the panels are drawn at: the charbox script and the panel `xchunk` are
 * two different numbers in the game, and obj_healwriter is placed off THIS one.
 */
const CHARBOX_X = [0, 212, 424];

const LIGHTB = [128, 255, 255]; // merge_color(c_aqua, c_white, 0.5)   Kris
const LIGHTF = [255, 153, 255]; // merge_color(c_purple, c_white, 0.6) Susie
const LIGHTG = [128, 255, 128]; // merge_color(c_lime, c_white, 0.5)   Ralsei
export const DMG_COLORS = [LIGHTB, LIGHTF, LIGHTG];

/** `doomtype`. -1 is an ordinary hit on the party; 4 is a death. */
export const TYPE_PARTY = -1;
export const TYPE_DEAD = 4;
/** `type = 3` — a HEAL, drawn in c_lime. Every heal writer in the dump uses it. */
export const TYPE_HEAL = 3;
const C_WHITE = [255, 255, 255];
const C_RED = [255, 0, 0];
const C_LIME = [0, 255, 0];

/**
 * `specialmessage`, which swaps the digits for a frame of `spr_battlemsg`:
 *
 *     message 1  frame 0   MISS   (damage == 0)
 *     message 2  frame 1   DOWN   (type == 4, c_red)
 *     message 3  frame 2   MAX    (c_lime)
 *
 * MAX is set by every heal in the game at the same place and on the same test
 * — `if (global.hp[char] >= global.maxhp[char]) dmgwr.specialmessage = 3` —
 * in scr_healitemspell, scr_healallitemspell, scr_raise_party, scr_spell,
 * scr_bullet_heal and obj_battlecontroller's heart button. A heal that fills
 * the bar shows MAX instead of a number, exactly as a killing blow shows DOWN.
 */
export const MSG_MAX = 3;

/** The colour for a writer's `type`, exactly as the Draw's branches pick it. */
export function dmgColor(type) {
  if (type === 0) return LIGHTB;
  if (type === 1) return LIGHTF;
  if (type === 2) return LIGHTG;
  if (type === TYPE_HEAL) return C_LIME;
  if (type === TYPE_DEAD) return C_RED;
  return C_WHITE;
}

/**
 * Damage numbers live on state, not as entities — they touch nothing else.
 *
 * `heals` is the SECOND writer: `obj_healwriter`, which is a different object
 * from obj_dmgwriter and appears somewhere else entirely. See spawnHealWriter.
 */
export function createDmgNumbers() {
  return { list: [], heals: [], hittarget: 0, tu: [0, 0, 0] };
}

/**
 * `scr_damage_enemy`'s `instance_create`, plus obj_heroparent's `dm.delay = 8`.
 *
 * @param {number} type   `dm.type`: 0/1/2 for damage DEALT by that
 *                        character, -1 for damage taken, 4 for a death
 * @param {number} damage 0 draws the "MISS" message sprite instead
 */
export function spawnDmgNumber(state, x, y, damage, type, delay = 8, opts = {}) {
  const d = state.dmg;
  if (!d) return;
  // `stack: false` is the SELF-CHAR path. obj_dmgwriter is one object with two
  // spawn sites and they count on DIFFERENT variables: hits on the enemy step
  // by `global.hittarget[t]`, writers over a party member by that character's
  // own `tu`. Running a party-wide heal through the enemy counter climbs 60px
  // up one character instead of one step each.
  const { special = 0, stack = true, yoff = 0 } = opts;
  const top = stack ? y + 20 - d.hittarget * 20 : y + yoff;
  // `damage = round(random(600))` in obj_dmgwriter's CREATE — a placeholder
  // the caller overwrites on the next line, but the roll still happens, and
  // it comes from the same WELL512 stream every bullet draws from. Skipping
  // it desynced the whole-fight diff four frames after the first landed hit:
  // scr_damage_all spawns THREE writers, the next star (b15, f205) rolled
  // three positions early and flew the opposite direction.
  if (state.gmlRng) gmlRandom(state.gmlRng, 600);
  d.list.push({
    x,
    // `(monstery + 20) - (hittarget * 20)` — each hit this turn sits 20px
    // higher than the last, which is what keeps three simultaneous hits
    // readable instead of stacked on one another.
    y: top,
    ystart: top,
    damage,
    type,
    special,
    delay,
    delaytimer: 0,
    // NO TICK ON THE BIRTH FRAME. Writers are created during the collision
    // phase, and the runner's draw pass that frame iterates a list that does
    // not yet contain them — measured at verify21j f1720-1722: the writers'
    // one-shot `vspeed = -5 - random(2)` landed at spawn+2 (stream positions
    // 100-102, seed 4021), bracketed by the slash jitter pairs at 98-99 and
    // 103-104. delay=2 with a first tick at spawn+1 puts it exactly there; a
    // first tick at spawn (the old behaviour) put it one frame early. Turns
    // 1-4 never noticed because nothing else consumed in that window — the
    // ORDER only became observable when the jitter interleaved with it.
    // A consumed-once flag, not a frame compare: harnesses that step without
    // advancing state.frame (verify-dmgnumbers) must skip exactly one tick.
    //
    // ...EXCEPT for STEP-DISPATCHED damage. The tunnel sword deals its hit
    // from its own Step (the swept `event_user(5)` at
    // obj_sword_tunnel_sword's line 91), and a writer created during a step
    // phase runs its draw the same frame — the balloon writer measurement
    // (pos 2 at birth) and the turn-8 boundary ledger agree: the sweep-hit
    // writers' throws land at birth+1 (verify21j f2970/f2975), where the
    // collision-born ones land at birth+2 (f1722). One stream position at
    // the 2976 boundary was the whole fingerprint.
    skipBirthTick: !state.damageFromStep,
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
  if (stack) d.hittarget += 1;
}

/** `global.hittarget[t] = 0` for every enemy at the top of a turn. */
export function resetDmgStack(state) {
  if (state.dmg) {
    state.dmg.hittarget = 0;
    state.dmg.tu = [0, 0, 0];
  }
}

/**
 * `scr_dmgwriter_selfchar()` — the writer that appears over a PARTY MEMBER
 * rather than over the enemy:
 *
 *     return instance_create(x, (y + myheight) - 24 - (tu * 20), obj_dmgwriter);
 *
 * `tu` is that character's own stack counter, so a party-wide heal puts three
 * numbers at three heights the way `hittarget` does for three hits on the
 * Knight. It is a DIFFERENT counter from hittarget — sharing one would make a
 * three-target heal climb 60px up one character instead of one step each.
 *
 * Every caller then does the same four things, so they live here:
 *
 *     dmgwr.delay = 8; dmgwr.type = 3; dmgwr.damage = amount;
 *     if (global.hp[char] >= global.maxhp[char]) dmgwr.specialmessage = 3;
 *
 * `maxed` is that test, taken by the caller AFTER the heal lands.
 */
export function spawnSelfHealNumber(state, target, amount, maxed) {
  const d = state.dmg;
  if (!d) return;
  const pos = PARTY_POS[target];
  const tu = d.tu[target] ?? 0;
  // PARTY_POS already IS `(x, y + myheight - 24)` — scr_damage_fixed and
  // scr_damage_maxhp build a party writer at exactly that point, and it is
  // where damage taken already appears. Only the `tu` step is new.
  spawnDmgNumber(state, pos.x, pos.y, amount, TYPE_HEAL, 8,
    { special: maxed ? MSG_MAX : 0, stack: false, yoff: -tu * 20 });
  d.tu[target] = tu + 1;
}

/**
 * `obj_healwriter` — THE OTHER HEAL DISPLAY, and the one ITEMS use.
 *
 *     // scr_healitem
 *     healtext = instance_create(scr_charbox_x(t) + 70 + xx, yy + 430,
 *                                obj_healwriter);
 *     healtext.healamt = arg1;
 *
 * It is not obj_dmgwriter with different settings: it is a separate object
 * that appears over the CHARBOX instead of over the character, rises with
 * friction instead of bouncing, and has no message sprite at all — so an item
 * that fills the bar shows `+150`, never MAX. Only the spell/raise path gets
 * the MAX graphic. Treating the two as one would put MAX on a Spincake.
 *
 *     Create: healamt, vspeed = -6, friction = 0.2, image_alpha = 1.5
 *     Draw:   mainbig, c_lime, "+" + healamt, image_alpha -= 0.1, die at < 0
 *
 * IT SHOWS THE REQUESTED AMOUNT, not what landed — `healamt = arg1`, the
 * argument, while `scr_heal` clamps at maxhp and returns the difference. A
 * Spincake on a full party still reads +150. Faithful, and load-bearing for
 * the reported case: a ReviveMint goes through scr_itemuse case 2 into
 * scr_healitem, so what you see is the revive amount it tried to give.
 */
export function spawnHealWriter(state, target, amount) {
  const d = state.dmg;
  if (!d) return;
  d.heals.push({
    x: CHARBOX_X[target] + 70,
    y: 430,
    healamt: amount,
    // GML `friction` reduces the SPEED MAGNITUDE and clamps at zero on
    // crossing; the writer only ever moves up, so this is vspeed climbing
    // toward 0 by 0.2 a frame.
    vspeed: -6,
    alpha: 1.5,
  });
}

/** obj_healwriter's Draw, which is also its whole step. */
export function stepHealWriters(state) {
  const d = state.dmg;
  if (!d || !d.heals.length) return;
  for (const h of d.heals) {
    h.y += h.vspeed;
    h.vspeed = h.vspeed + 0.2 > 0 ? 0 : h.vspeed + 0.2;
    // `image_alpha` starts at 1.5 and GameMaker CLAMPS draw_set_alpha at 1,
    // so the first five frames are fully opaque and the fade is the last ten.
    h.alpha -= 0.1;
  }
  d.heals = d.heals.filter((h) => h.alpha >= 0);
}

export function stepDmgNumbers(state, rng) {
  const d = state.dmg;
  if (!d) return;
  for (const n of d.list) {
    // See `skipBirthTick` at the spawn site: the runner never draws an
    // instance on its creation frame, so the delay clock starts a tick late.
    if (n.skipBirthTick) {
      n.skipBirthTick = false;
      continue;
    }
    // NOTHING HAPPENS UNTIL THE DELAY ELAPSES. With `delay = 8` the number
    // appears eight frames after the hit registers — after the character's
    // swing has connected, which is why it reads as a consequence.
    if (n.delaytimer < n.delay) {
      n.delaytimer += 1;
      if (n.delaytimer === n.delay) {
        // `vspeed = -5 - random(2)` — the throw is randomised, so three
        // numbers from one turn do not travel in lockstep. It fires in the
        // DRAW event, once, at delay-elapse — and like every Draw-event
        // random it consumes from the global stream, so it must come from
        // gmlRng when the state carries one (the scene's mulberry fallback
        // predates the RNG discovery and stays only for rng-less callers).
        n.vspeed = -5 - (state.gmlRng ? gmlRandom(state.gmlRng, 2)
          : (rng ? rng() * 2 : 1));
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
