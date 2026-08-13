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
    const k = state.knight;
    const roaring = state.entities.some(
      (x) => x.alive && x.type.name === 'obj_knight_roaring2',
    );

    // `if (!i_ex(obj_knight_roaring2)) siner2++;` — THE BOB FREEZES DURING
    // ROARING. It is the first line of the Draw and it is guarded, so the
    // phase-4 finale holds him still while his own attack draws him. Running
    // the counter through it left him bobbing under a knight that is supposed
    // to be locked in place.
    if (!roaring) e.siner2 += 1;

    // `if (i_ex(obj_knight_swordtunnelanim)) exit;` — during Sword Tunnel a
    // separate object performs the whole animation, and this Draw stops dead:
    // no bob, no afterimages, no sprite. Without this he bobbed and trailed
    // ghosts behind his own performance.
    if (state.entities.some(
      (x) => x.alive && x.type.name === 'obj_knight_swordtunnelanim',
    )) return;

    // THE HURT STROBE. `state == 3 && hurttimer >= 0` alternates the idle
    // sprite with `spr_roaringknight_ball_transition` FRAME 7 — one specific
    // frame of a ten-frame sheet, not the whole animation — every other
    // frame, and ONLY while `stronghurtanim` is set, which needs a hit of 100
    // or more. See sim/knight.js.
    //
    // `blockanim` swaps the idle for `spr_roaringknight_block_ol` for 15
    // frames instead. It only fires while `damagereduction < 0.1`, so in this
    // fight that is the 0.04 opening and nothing else.
    // The Draw applies `x + shakex` at every draw site rather than moving the
    // instance. Nothing in this renderer reads a `shakex` field, so it goes
    // onto the position — the visible result is identical and it needs no new
    // plumbing through the generic blit.
    //
    // `+ hurtspriteoffx / + hurtspriteoffy` are in every one of those draw
    // sites too and are NOT translated, deliberately: `scr_enemy_object_init`
    // sets both to 0 and a whole-dump grep finds no other assignment. They are
    // write-only, the same family as `linex` and `splitbox`. Adding fields
    // that are provably always zero would only invite someone to "fix" them.
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
    // than a static sprite. He is otherwise motionless: `siner` is set to 0 in
    // his Create and incremented NOWHERE, so `draw_sprite_ext(idlesprite,
    // siner, ...)` draws frame 0 for the entire fight. The bob and this trail
    // are the whole of his idle animation.
    //
    // THE BOB AND THE TRAIL LIVE INSIDE THE STATE GATE:
    //
    //     if (state == 0 || state == 3) {
    //         image_index = 0;
    //         y = ystart + (cos(siner2 / 8) * 8);
    //         aetimer++;
    //         if ((aetimer % 4) == 0 && image_alpha != 0 && chargeupcon == 0)
    //
    // so both stop in any other state, and `aetimer` does not even advance —
    // which means the trail resumes on its own cadence rather than catching
    // up. `siner2` keeps counting outside the gate, so the bob resumes at the
    // phase of the clock rather than where it left off.
    if (k && k.animState !== 0 && k.animState !== 3) return;
    e.y = e.ystart + Math.cos(e.siner2 / 8) * 8;
    e.aetimer += 1;
    if (e.aetimer % 4 !== 0) return;
    // Not while he is hidden — Flurry sets image_alpha to 0 when its manager
    // becomes the visible knight.
    if (!e.image_alpha || e.visible === false) return;
    // `chargeupcon == 0`: NO TRAIL WHILE HE WINDS UP. The charge-up turn is
    // the one where he holds still and glows, and a trail during it reads as
    // movement at exactly the moment the fight wants stillness.
    if (k?.chargeupcon) return;
    // `if (state == 0 && !i_ex(obj_knight_roaring2))` — the idle branch is
    // additionally gated on ROARING, which draws its own knight.
    if (roaring && (k?.animState ?? 0) === 0) return;

    const a = spawn(state, afterimage, { x: e.x, y: e.y });
    // The state-3 branch spawns the STROBE, not the idle:
    //
    //     if ((hurttimer % 2) == 0 || stronghurtanim == false)
    //         afterimage.sprite_index = idlesprite;
    //     else { sprite_index = spr_roaringknight_ball_transition;
    //            image_index = 7; }
    //
    // The ghosts alternate with the body, so a heavy hit strobes the whole
    // trail rather than the sprite alone. Spawning idle ghosts behind a
    // strobing knight was half the effect.
    if (k?.animState === 3 && k.stronghurtanim && k.hurttimer % 2 !== 0) {
      a.sprite_index = 'spr_roaringknight_ball_transition';
      a.image_index = 7;
    } else {
      a.sprite_index = 'spr_roaringknight_idle';
      a.image_index = e.image_index;
    }
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
    // `with (obj_herosusie) visible = 0` — obj_rudebuster_anim REPLACES her
    // for its 28 frames rather than drawing over her. Leaving her visible
    // gives you two Susies, one of them casting.
    e.visible = !(e.slot === 1 && state.rude?.anim);
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

/**
 * Where the soul starts the fight, MEASURED against the real game rather than
 * rounded: `instance_create(obj_growtangle.x - 6, obj_growtangle.y - 8,
 * obj_heart)` with the board at (320, 170) puts it at (314, 162).
 *
 * This was (310, 160) — four pixels left and two up — and the whole-fight
 * diff caught it on frame 0 of the first real recording. Two pixels of soul
 * is two pixels of hitbox in a fight whose corridors are measured in single
 * digits, so this is not cosmetic.
 */
export const SOUL_START = { x: 314, y: 162 };
