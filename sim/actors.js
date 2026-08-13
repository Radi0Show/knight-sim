import { spawn } from './entity.js';
import { afterimage } from './fx.js';
// The battle board: the Roaring Knight and the party.
//
// VISUAL ONLY. This project is dodge-only (CLAUDE.md) — no turn system, no HP,
// no ACT menu — and nothing here can affect a single frame of bullet state.
// They exist because an empty arena does not read as the Knight fight.
//
// They live in sim/ rather than render/ because their sprite and frame are
// instance state, advanced by the engine's animation phase exactly like a
// bullet's, so the renderer stays a pure function of sim state.
//
// EVERY NUMBER BELOW IS MEASURED, not chosen. It comes from
// knight-research/traces/flurry2.csv, recorded from the real fight at phase 1
// turn 3 with the universal harness. The camera sits at (0,0) for the whole
// turn, so these room coordinates are screen coordinates.
//
//   object                x        y         sprite                       depth
//   obj_herokris        126      104         spr_krisb_idle                 200
//   obj_herosusie        80      142         spr_susieb_idle                180
//   obj_heroralsei       58      190         spr_ralsei_idle                160
//   obj_knight_enemy    425   bobbing        spr_roaringknight_idle          88
//   obj_growtangle      320      170         spr_battlebg_0                   5
//   obj_heart           310      160         spr_dodgeheart                   1
//
// An earlier version of this file had the party in a tidy column at x=100,
// y=130/210/290 with `spr_susieb_idle_serious` and `spr_ralseib_idle`. Every
// one of those was wrong: the real layout is a diagonal, and two of the three
// sprites were the wrong asset.

/**
 * obj_knight_enemy. During Flurry the controller sets its image_alpha to 0 and
 * obj_roaringknight_boxsplitter_attack draws the visible pose instead — so
 * this is present, bobbing, and invisible for most of the turn.
 *
 * The bob is its Draw event, exactly: `siner2++; y = ystart + cos(siner2/8)*8`.
 * Amplitude 8 about ystart 78, one cycle per ~50 frames.
 */
// eslint-disable-next-line
export const knightActor = {
  name: 'obj_knight_enemy',
  create(e) {
    e.sprite_index = 'spr_roaringknight_idle';
    e.image_index = 0;
    e.image_speed = 0;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.image_alpha = 1;
    e.depth = 88;
    e.siner2 = 0;
    e.aetimer = 0;
    e.ystart = KNIGHT.ystart;
    e.isActor = true;
  },
  step(e, state) {
    e.siner2 += 1;
    e.y = e.ystart + Math.cos(e.siner2 / 8) * 8;

    // THE HURT STROBE. `state == 3 && hurttimer >= 0` alternates the idle
    // sprite with `spr_roaringknight_ball_transition` FRAME 7 — one specific
    // frame of a ten-frame sheet, not the whole animation — every other
    // frame, and ONLY while `stronghurtanim` is set, which needs a hit of 100
    // or more. See sim/knight.js.
    //
    // `blockanim` swaps the idle for `spr_roaringknight_block_ol` for 15
    // frames instead. It only fires while `damagereduction < 0.1`, so in this
    // fight that is the 0.04 opening and nothing else.
    const k = state.knight;
    // The Draw applies `x + shakex` at every draw site rather than moving the
    // instance. Nothing in this renderer reads a `shakex` field, so it goes
    // onto the position — the visible result is identical and it needs no new
    // plumbing through the generic blit.
    e.x = KNIGHT.x + (k?.shakex ?? 0);
    if (k?.blockanim) {
      e.sprite_index = 'spr_roaringknight_block_ol';
    } else if (k?.animState === 3 && k.stronghurtanim && k.hurttimer % 2 !== 0) {
      e.sprite_index = 'spr_roaringknight_ball_transition';
      e.image_index = 7;
    } else {
      e.sprite_index = 'spr_roaringknight_idle';
    }

    // THE AFTERIMAGE TRAIL, from his Draw event. Every fourth frame he leaves
    // a ghost of himself at 0.6 alpha that fades at 0.02 and drifts right at
    // hspeed 2 — the shimmer that makes him read as barely-contained rather
    // than a static sprite.
    //
    // Gated exactly as the original gates it: not while he is hidden
    // (`image_alpha != 0`, which Flurry sets to 0 when its manager becomes the
    // visible knight), and not during ROARING, which draws its own knight.
    e.aetimer += 1;
    if (e.aetimer % 4 !== 0) return;
    if (!e.image_alpha || e.visible === false) return;
    if (state.entities.some((x) => x.alive && x.type.name === 'obj_knight_roaring2')) return;

    const a = spawn(state, afterimage, { x: e.x, y: e.y });
    a.sprite_index = 'spr_roaringknight_idle';
    a.image_index = e.image_index;
    a.image_alpha = 0.6;
    a.fadeSpeed = 0.02;
    a.image_speed = 0;
    a.image_xscale = e.image_xscale;
    a.image_yscale = e.image_yscale;
    a.depth = e.depth + 1;
    // hspeed 2: GameMaker's component motion, which sim/index.js drives.
    a.componentMotion = true;
    a.hspeed = 2;
    a.vspeed = 0;
  },
};

/** One party member. Sprite, position and depth come from PARTY below. */
export const partyActor = {
  name: 'actor_party',
  create(e) {
    e.image_index = 0;
    // `image_speed = 0` — THE ANIMATION IS DRIVEN, not played.
    //
    // This actor used to run a free 0.2/frame idle loop, measured from a
    // trace, with the comment that the real source "is not worth translating
    // for a cosmetic actor". It is worth translating: 0.2 is `siner / 5` from
    // obj_heroparent's state 0, and the same state machine also picks the
    // ATTACK, ITEM, SPELL, ACT, DEFEND and DEFEAT poses. A free-running index
    // can only ever be the idle.
    //
    // sim/heroes.js is that machine; this actor now mirrors its output.
    e.image_speed = 0;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.image_alpha = 1;
    e.isActor = true;
  },
  step(e, state) {
    const h = state.heroes?.[e.slot];
    if (!h || !h.sprite) return;
    e.sprite_index = h.sprite;
    // GAMEMAKER WRAPS `image_index` AT THE FRAME COUNT. `index = siner / 5`
    // grows without bound — 80 after a few seconds of standing still — and
    // the engine's own wrap is what keeps a 6-frame idle looping. Nothing
    // wraps it here, because `image_speed` is 0 and runAnimation only wraps
    // what it advances, so the pose ran off the end of every sprite.
    const n = state.spriteFrames?.[h.sprite] ?? 0;
    e.image_index = n > 1 ? ((h.index % n) + n) % n : 0;
  },
};

export const PARTY = [
  { sprite: 'spr_krisb_idle', x: 126, y: 104, depth: 200 },
  { sprite: 'spr_susieb_idle', x: 80, y: 142, depth: 180 },
  { sprite: 'spr_ralsei_idle', x: 58, y: 190, depth: 160 },
];

export const KNIGHT = { x: 425, ystart: 78 };

/** The battle box, as obj_knight_enemy builds it for this attack. */
export const BOX = { x: 320, y: 170 };

/** scr_moveheart's landing spot for this turn. */
export const SOUL_START = { x: 310, y: 160 };
