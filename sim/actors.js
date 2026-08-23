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

  /**
   * THE SWORDSLASH CLAMP — obj_knight_enemy's End Step, in full:
   *
   *     if (scr_isphase("bullets") && myattackchoice == 0)
   *         if (i_ex(obj_heart) && obj_heart.x > camerax() + 165)
   *             obj_heart.x = camerax() + 165;
   *
   * This project has met this line before, from the wrong end. A freshly
   * created knight defaults to `myattackchoice = 0`, so any harness that
   * forced `mnfight = 2` had him dragging the soul to x 165 EVERY FRAME with
   * no attack running — the "soul outside the box" root cause CLAUDE.md
   * records as costing many game runs and presenting as four unrelated bugs.
   *
   * It is not a bug. It is Swordslash's arena wall: the box for ac 0 is a
   * 37-pixel slot at x 168, and this keeps you inside it. Now that ac 0 is
   * translated the line finally has its attack around it, and it is gated the
   * way the original gates it — on the CURRENT CHOICE, not on the generator
   * existing, so it holds for the whole turn including the empty stretch after
   * the generator deletes itself at `turntimer < 20`.
   */
  endStep(e, state) {
    // THE BOB IS SET IN THE DRAW, WHICH RUNS AFTER EVERY STEP.
    //
    //     if (state == 0 || state == 3) { image_index = 0;
    //                                     y = ystart + (cos(siner2 / 8) * 8); }
    //
    // Computing it in the knight's own step read the entity list too early:
    // on the frame obj_knight_swordtunnelanim destroys itself, the anim's Step
    // has not run yet when the knight's has, so the knight still saw it alive,
    // took the `exit` path and left `y` FROZEN for one frame. The game's Draw
    // runs after all Steps, sees the anim gone, and recomputes — a 15.6 pixel
    // difference on the single frame the tunnel ends, five times a fight.
    //
    // endStep is the phase that matches: everything else has moved. The gates
    // are the Draw's own, in its order — invisible instances have no Draw at
    // all, con 2 exits above this, and the sword-tunnel anim exits above it
    // too.
    {
      const kb = state.knight;
      // `if (chargeupcon == 2) { chargeuptimer++; ...draw...; if
      // (chargeuptimer == 10) { chargeupcon = 3; image_alpha = 0; } exit; }`
      //
      // In endStep because it is Draw logic and the Draw runs after every
      // Step: obj_knight_roaring2's Create sets con 2 during the controller's
      // step, and a tick in the knight's own step happens before that, so the
      // burn-out ran one frame behind for its whole ten-frame life.
      if (kb && kb.chargeupcon === 2) {
        kb.chargeuptimer = (kb.chargeuptimer ?? 0) + 1;
        if (kb.chargeuptimer === 10) {
          kb.chargeupcon = 3;
          e.image_alpha = 0;
          e.fog = false;
        }
        return;
      }
      // `if (!i_ex(obj_knight_roaring2)) siner2++;` — the FIRST line of the
      // Draw, so it runs above both exits (the sword tunnel and the charge-up
      // still tick it) but not at all while he is invisible.
      //
      // It lives in endStep with the y below it because the increment must
      // come AFTER every Step: obj_knight_rotating_slash's Step pins
      // `obj_knight_enemy.siner2 = 0` on every one of its frames, and the
      // Draw then ticks it to 1. Incremented during the knight's own step it
      // raced that pin and the bob kept swinging where the game holds it.
      if (e.visible !== false
        && !state.entities.some((x) => x.alive && x.type.name === 'obj_knight_roaring2')) {
        e.siner2 += 1;
      }
      const drawRuns = kb
        && e.visible !== false
        && kb.chargeupcon !== 2
        && !state.entities.some(
          (x) => x.alive && x.type.name === 'obj_knight_swordtunnelanim',
        );
      if (drawRuns && (kb.animState === 0 || kb.animState === 3)) {
        e.y = e.ystart + Math.cos(e.siner2 / 8) * 8;
      }
    }
    if (state.currentAc !== 0) return;
    if (!state.soul || !state.soul.alive) return;
    if (state.soul.x > state.view.x + 165) state.soul.x = state.view.x + 165;
  },
  create(e) {
    e.sprite_index = 'spr_roaringknight_idle';
    e.image_index = 0;
    e.image_speed = 0;
    e.image_xscale = 2;
    e.image_yscale = 2;
    e.image_alpha = 1;
    e.depth = 88;
    // ONE, NOT ZERO. The Knight's Draw has already run once — and so has its
    // `siner2++` — before the first frame this trace covers, so a counter
    // started at 0 puts the whole bob one frame behind the game's for the
    // rest of the fight. Measured off the draw log: with 0 the sim's y at
    // frame N is exactly the game's at N-1, all fight; with 1 they agree to
    // float noise.
    e.siner2 = 1;
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
    // ...AND ONLY WHILE THE DRAW EVENT RUNS. `siner2++` is the first line of
    // obj_knight_enemy's Draw, ABOVE both `exit`s — so it keeps ticking during
    // the sword tunnel and the charge-up — but an INVISIBLE instance has no
    // Draw event at all, and the Stars cone hides him for ~250 frames a turn,
    // six times.
    //
    // Ungated, the bob ran on through every Stars turn and came back out of
    // phase: the draw log measured the Knight's y as much as 15.9 PIXELS from
    // where the game puts it. That is not a rounding difference, it is him
    // sitting visibly wrong on screen, and no traced column could see it —
    // the knight's y is not among the 176.


    // THE SELECTION FLASH, and it is REAL game behaviour -- the note that
    // used to sit in the renderer calling it "a deliberate addition, nothing
    // in the dump ever sets becomeflash" was a bad negative grep, the fourth
    // in this project. obj_battlecontroller's Draw, inside the enemy-select
    // block (bmenuno 1/3/11/12/13), does:
    //
    //     with (global.monsterinstance[global.bmenucoord[bmenuno][charturn]])
    //     {
    //         if (flash == 0) fsiner = 0;
    //         flash = 1;
    //         becomeflash = 1;
    //     }
    //
    // and every enemy's own Draw counts `fsiner += 1` each frame and, while
    // flashing, draws ITSELF at
    //
    //     (-cos(fsiner / 5) * 0.4) + 0.6
    //
    // so the highlight is the enemy PULSING IN OPACITY between 0.2 and 1.0
    // over ~31 frames -- not a halo, not a tint. `fsiner` is zeroed on the
    // 0 -> 1 edge only, so the pulse always starts near transparent and
    // rises, and re-entering the menu restarts it from the same phase.
    //
    // THE KNIGHT REALLY DOES FLASH -- this is not a deviation, and calling it
    // one was a THIRD bad negative grep on the same behaviour. His own Draw
    // contains no flash code, which is what two greps of that file reported;
    // the call is three levels down, in a shared helper:
    //
    //     knight Draw -> scr_enemy_drawidle_generic(1/6) -> draw_monster_body_part:
    //
    //         draw_sprite_ext(spr, idx, x, y, xs, ys, ang, blend, image_alpha);
    //         if (flash == 1)
    //             draw_sprite_ext_flash(spr, idx, x, y, xs, ys, ang, blend,
    //                                   (-cos(fsiner / 5) * 0.4) + 0.6);
    //
    // and draw_sprite_ext_flash is `d3d_set_fog(true, arg7, 0, 1)` around the
    // same draw -- so the overlay is fogged to IMAGE_BLEND, which is white for
    // the Knight. CLAUDE.md's rule that a negative grep only counts over the
    // WHOLE dump applies to helper indirection too, not just to filenames.
    //
    // TWO CONSEQUENCES, both of which the old model got wrong: `fsiner`
    // advances inside scr_enemy_drawidle_generic, which is gated on
    // `state == 0` -- so it counts while IDLE, not while flashing -- and the
    // flash draw lives on that same idle path, so a Knight who is mid-HURT
    // shows no highlight at all.
    //
    // These live on `state.knight`, NOT on the entity, because that is where
    // the Knight's other Draw-state variables are (whiteflash, hurttimer,
    // stronghurtanim) and it is what the renderer reads. The entity and
    // state.knight are two different objects here; writing to the wrong one
    // is silent, which is exactly what verify-selectflash caught.
    if (k) {
      // `becomeflash` IS A ONE-FRAME LATCH, and dropping it cost 88 frames of
      // highlight. The two halves live in different objects and run in this
      // order:
      //
      //     obj_battlecontroller Draw:  flash = 1; becomeflash = 1;
      //     obj_knight_enemy Draw tail: if (becomeflash == 0) flash = 0;
      //                                 becomeflash = 0;
      //
      // The Knight DRAWS the flash and only afterwards clears it, so on the
      // frame you leave the enemy row the controller stops renewing the latch
      // but `flash` is still 1 when the sprite goes down — the highlight
      // outlives the menu state by exactly one frame. Modelled instantaneously
      // it died a frame early EVERY time, which the replay token exposes as a
      // 3-on/1-off pattern against the sim's 2-on/2-off: the recorded inputs
      // step in and out of the row repeatedly, so the missing frame recurs
      // three times per turn, all fight.
      //
      // The clear runs FIRST here, against LAST frame's latch, because that is
      // where it sits relative to the controller in the real frame order.
      // WHETHER THE DRAW EVENT RUNS AT ALL, which gates everything below.
      // `siner`, `fsiner` and the becomeflash tail all live INSIDE
      // obj_knight_enemy's Draw, so none of them tick on a frame the event
      // never reaches: an invisible instance (the Stars cone hides him), the
      // sword-tunnel anim's `exit`, or the charge-up's con-2 `exit`, which
      // returns before scr_enemy_drawidle_generic. con 3 does NOT exit, so the
      // roar still ticks them — which is why the oracle's index keeps climbing
      // through it.
      //
      // Ticking regardless is what made `siner` drift: the draw calls all
      // matched while the index they carried wandered by hundreds.
      const drawRuns = e.visible !== false
        && k.chargeupcon !== 2
        && !state.entities.some(
          (x) => x.alive && x.type.name === 'obj_knight_swordtunnelanim',
        );
      if (drawRuns) {
        if (!k.becomeflash) k.flash = 0;
        k.becomeflash = 0;
      }
      // THREE MENU STATES, not two. There are TWO flash sites in
      // obj_battlecontroller's Draw and only the first is the enemy row:
      //
      //   * the enemy-select block (bmenuno 1/3/11/12/13) flashes
      //     `monsterinstance[bmenucoord[bmenuno][charturn]]` — the FIGHT row
      //     and ACT's enemy picker;
      //   * the ACT OPTION GRID (bmenuno 9) flashes
      //     `monsterinstance[bmenucoord[11][charturn]]` — index 11 HARDCODED,
      //     i.e. whichever enemy the ACT picker landed on. So the highlight
      //     carries through from choosing the target to choosing the act.
      //
      // Missing the second left two frames per ACT unflashed, which the draw
      // log showed as a 5-frame burst in the game against the sim's 3.
      const selecting = !!(state.menu?.open
        && (state.menu.submenu === 'enemy'
          || state.menu.submenu === 'actpick'
          || state.menu.submenu === 'actgrid'));
      if (selecting) {
        if (!k.flash) k.fsiner = 0;
        k.flash = 1;
        k.becomeflash = 1;
      }
      // `fsiner += 1` is the first line of scr_enemy_drawidle_generic's
      // `state == 0` branch, so it runs while IDLE whether or not anything is
      // flashing. It matters only while flashing, and the controller zeroes it
      // on entry, so the visible pulse is the same either way -- but a Knight
      // knocked into state 3 mid-menu stops advancing it, and that is the
      // behaviour worth being right about.
      if (drawRuns && k.animState === 0) {
        k.fsiner = (k.fsiner ?? 0) + 1;
        // `siner += arg0` on the same line of scr_enemy_drawidle_generic, with
        // arg0 = 1/6 from the Knight's call. spr_roaringknight_idle has ONE
        // frame so it changes nothing on screen, but it is the image_index
        // every one of his draws passes and the draw log compares it.
        k.siner = (k.siner ?? 0) + (1 / 6);
      }
    }

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
    // THE SHAKE IS NOT ON THE INSTANCE. `obj_knight_enemy.x` never includes
    // it: the Draw adds `x + shakex` at the sites that shake (the hurt strobe
    // and the whiteflash copy) and draw_monster_body_part uses plain `x`.
    //
    // This used to fold shakex into the position, on the reasoning that
    // nothing read a shakex field so the visible result was identical. That
    // stopped being true when render/knightdraw.js started adding shakex at
    // the strobe sites the way the Draw does — the strobe then got it TWICE —
    // and it was never quite right anyway: anything reading the knight's x
    // (attacks spawn at it, the Stars cone lerps to it) saw a shaken value the
    // game never exposes.
    //
    // `+ hurtspriteoffx / + hurtspriteoffy` are in every one of those draw
    // sites too and are NOT translated, deliberately: `scr_enemy_object_init`
    // sets both to 0 and a whole-dump grep finds no other assignment. They are
    // write-only, the same family as `linex` and `splitbox`. Adding fields
    // that are provably always zero would only invite someone to "fix" them.
    e.x = KNIGHT.x;

    // THE FAILED PACIFY'S COLOUR FLASH — obj_pacifyspell's `fail` path.
    // con 6 walks image_blend toward c_blue at 0.12 a frame for 8 frames,
    // then con 8 walks it back to c_white at 0.16 for 8 more, then con 9
    // sets white and the object destroys. `merge_color` is a per-channel
    // lerp, and GameMaker packs colours BGR — c_blue is 0xFF0000 in that
    // order, not 0x0000FF.
    if (state.pacifyFail) {
      const pf = state.pacifyFail;
      const merge = (a, b, amt) => {
        const ch = (v, n) => (v >> n) & 255;
        const mix = (n) => Math.round(ch(a, n) + (ch(b, n) - ch(a, n)) * amt) & 255;
        return mix(0) | (mix(8) << 8) | (mix(16) << 16);
      };
      const C_BLUE = 16711680;
      const C_WHITE = 16777215;
      if (pf.con === 6) {
        e.image_blend = merge(e.image_blend ?? C_WHITE, C_BLUE, 0.12);
        pf.alarm -= 1;
        if (pf.alarm <= 0) { pf.con = 8; pf.alarm = 8; }
      } else if (pf.con === 8) {
        e.image_blend = merge(e.image_blend ?? C_WHITE, C_WHITE, 0.16);
        pf.alarm -= 1;
        if (pf.alarm <= 0) { e.image_blend = C_WHITE; state.pacifyFail = null; }
      }
    }
    // THE ENDING STROBES SLOWER. The normal strong-hurt alternates on %2;
    // the win's block reads `(hurttimer % 3) == 0` for the idle frame — two
    // ball frames for every idle one, so he reads as losing the shape rather
    // than as flinching.
    const strobeMod = k?.endCutscene > 0 ? 3 : 2;
    const strobing = k?.animState === 3 && k.stronghurtanim
      && (k.hurttimer % strobeMod) !== 0;
    // THE WHITE DISSOLVE INTO ROARING. His Draw's second branch, which runs
    // before everything below it and exits:
    //
    //     if (chargeupcon == 2) {
    //         chargeuptimer++;
    //         d3d_set_fog(true, c_white, 0, 1);
    //         draw_sprite_ext(idlesprite, siner, x, y, ..., (10 - chargeuptimer) / 10);
    //         d3d_set_fog(false, c_black, 0, 0);
    //         if (chargeuptimer == 10) { chargeupcon = 3; image_alpha = 0; }
    //         exit;
    //     }
    //
    // ROARING's Create sets `chargeupcon = 2`, so he burns out to white over
    // ten frames and only THEN goes invisible for the attack. The sim drove
    // image_alpha straight to 0 on the launch frame instead, so he vanished
    // in one frame and the phantom took over as a separate event — half of
    // the "appears, then appears again" report. `fog` is the GPU replace, not
    // a multiply tint (see render/draw/gm.js).
    if (k?.chargeupcon === 2) {
      // The `chargeuptimer++` moved to endStep — see there. It is Draw logic,
      // and running it here ticked it before obj_knight_roaring2's Create had
      // set con 2, so the ten-frame burn-out ran a full step behind: the sim
      // opened at alpha 1.0 where the game opens at 0.9 and never showed the
      // final 0.0 frame at all.
      e.sprite_index = 'spr_roaringknight_idle';
      e.image_index = 0;
      e.fog = true;
      e.image_alpha = (10 - k.chargeuptimer) / 10;
      // `if (chargeuptimer == 10)`, and it is checked AFTER the draw — so the
      // alpha-0 frame at 10 is drawn before con flips. `>=` only differed
      // while the timer arrived already past 10, which is exactly the bug
      // above; it is written as the game writes it now that it cannot.
      return;
    }
    e.fog = false;

    if (k?.blockanim) {
      e.sprite_index = 'spr_roaringknight_block_ol';
    } else if (strobing) {
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
