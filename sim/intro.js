// THE FIGHT'S OPENING — the encounter room's pre-battle sequence, from the
// roar to the sword draw to the battle handoff. Driver-side like the victory
// scene: never touches sim state, so replay tokens, the whole-fight diff and
// every suite are byte-identical with or without it.
//
// SOURCES (all read from the dump, none guessed):
//   obj_knight_roaring_fx Create/Step/Draw      — the roar itself
//   obj_knight_circle Create/Step/Draw          — the red screen layer
//   obj_afterimage_screen Create/Draw           — the screen-copy ghosts
//   obj_ch3_PTB02 Create/Step (cons 3..4)       — staging, timing, sword draw
//   obj_ch3_PTB02_roaringknight Create/Step/Draw — hover, draw_sword sequence
//   obj_dw_snow_zone_parallax Create/Draw       — the room's vista (the room
//                                                 itself is black, no tiles;
//                                                 see dump_room.csx)
//
// THE TIMELINE, per the room's cutscene script (con 3 -> 3.1 -> 4):
//   30f    the tableau — snow zone backdrop, the party halted at the fountain
//          (Kris 2356,104 / Susie 2310,142 / Ralsei 2288,190, camera 2230),
//          the Knight hovering at (2655, 106 + cos(siner2/8)*8)
//   +1f    knight hidden, obj_knight_roaring_fx at (x+20, y-20)
//   ~254f  the roar (64 intro + 190 roarendtimer):
//            t8/t32 shudder; t16 crush ring; t24 whiteout + stretch @0.75
//            climax: pose_ol, snd_knight_roar, THE CIRCLE (below), and
//            obj_afterimage_screen repeated at 2-frame intervals over 8
//            (scr_script_repeat(instance_create, 8, 2, px, py, 46) — the 46
//            resolved via the object-id dump); each later cycle puffs @0.15
//            and throws screen ghosts every 3rd frame
//   then   knight reappears (idle_overworld) and DRAWS THE SWORD:
//            actor: draw_timer ticked every move_speed=4 frames;
//              t1  sword_active, spr_roaringknight_sword_appear @0.3
//              t3  freeze; sword_appear; alpha 0->1 and y_base_pos -266,
//                  both over 15f "out" — the sword RISES, flashing
//              t8  flash off      t12 spr_roaringknight_sword_appear_new,
//                  grab_hand, frames 0..7 on stamps [2,2,2,2,2,4,2,2] (ticks)
//            room: marker takes over, frames 7..11 on delays [8,1,6,6]
//                  (sword_draw_timestamps[0..3]), ready at frame 11
//   then   the handoff: the scenery FADES out over 45 frames while the
//          Knight glides from his overworld anchor to the battle's
//          (425, 78) — the fight is underneath, its fountain already in
//          line with the vista's (battle column x 138, vista glow x 140)
//
// THE RED LAYER (obj_knight_circle, created white at the climax): its Step
// walks g and b toward 0 at 255/28 a frame but never walks r — the approach
// line for r simply isn't there, and the destroy test reads `b == 0` twice
// (ORIGINAL BUG: r stays 255, so the white flash turns PURE RED and stays).
// Drawn additive, a black-centre -> (r,g,b)-edge gradient circle growing 40 a
// frame toward radius 960 — the whole screen layered red until the fx dies,
// then image_alpha -= 0.1 fades it out.
//
// LABELLED APPROXIMATIONS: the screen ghosts mirror the canvas rather than
// GameMaker's application surface (the original's Draw re-copies the live
// screen EVERY frame — a scaled, fading echo of the current frame, never a
// frozen snapshot); the in-rush particles keep counts/ring/pull but not
// scr_lerpvar's exact curves; the sword materialise uses canvas compositing
// with the original's below-hand slot cut out rather than dest-alpha GPU
// blending; the final handoff fades the scenery over 45 frames and glides
// the Knight to his battle anchor (the real entry is scr_battle's swirl +
// darkener, not staged — this stand-in is player-directed). Skippable with
// confirm/cancel — a practice-tool addition.

// The only import: the ease family, so the sword draw runs the source's own
// `scr_lerpvar` curves rather than shapes fitted by eye.
import { scrEaseOut } from './gml.js';

/** The fx at the knight's overworld offset. */
export function createIntroFx(x, y) {
  return {
    x,
    y,
    timer: 0,
    frame: 0, // drives the renderer's frame-seeded randoms and the bob
    spin: 1, // `choose(1, -1)` — cosmetic
    counter: 0,
    attack_speed: 0,
    sprite_index: 'spr_roaringknight_shift_ol',
    image_index: 1,
    image_speed: 0,
    image_xscale: 2,
    image_yscale: 2,
    fxState: 'intro',
    whiteout: false,
    whiteout_counter: 0,
    shudder: 0,
    bar: 0,
    roarendtimer: 0,
    roarendtimermax: 190,
    crushTimer: -1, // -1 idle; 0..24 the converging ring
    circleFlash: 0, // frames since the climax (the white ring flash)
    done: false,
  };
}

/**
 * One 30Hz tick of the fx. Pushes {name, pitch, gain} onto `cues`, and ghost
 * birth frames onto `sc.ghosts` when a scene is supplied.
 */
export function stepIntroFx(e, cues, sc) {
  if (e.done) return;
  e.frame += 1;
  if (e.shudder) e.shudder -= 1;
  // 24 frames of wind-up plus the alarm's 64-frame bright collapse.
  if (e.crushTimer >= 0 && e.crushTimer < 96) e.crushTimer += 1;
  if (e.circleFlash > 0) e.circleFlash += 1;

  if (e.whiteout) {
    // `scr_approach(whiteout_counter, 1, 1/48)`.
    e.whiteout_counter = Math.min(1, e.whiteout_counter + 1 / 48);
    // THE LAST FRAME THE IMPLOSION SPAWNED. The Step's particle burst is
    // gated `if (whiteout) { if (state != "roaring") { ...spawn... } }` —
    // only the SPAWNING stops when the roar begins. Everything already in
    // flight keeps rushing in on its own 32-frame ramp until it is inside
    // 32px and destroyed. The renderer reconstructs particles from their
    // birth frame, so it needs to know when births were allowed rather than
    // testing the CURRENT state: gating on the latter made every streak
    // vanish mid-flight the instant fxState flipped, which is why the
    // implosion appeared to stop dead instead of collapsing.
    if (e.fxState === 'intro') e.inrushLast = e.frame;
  }

  if (e.fxState === 'intro') {
    e.timer += 1;
    if (e.timer === 8) e.shudder = 999;
    if (e.timer === 16) e.crushTimer = 0;
    if (e.timer === 24) {
      e.whiteout = true;
      cues.push({ name: 'snd_knight_stretch', pitch: 0.75, gain: 1 });
    }
    if (e.timer === 32) e.shudder = 999;
    if (e.timer === 64) {
      e.fxState = 'roaring';
      e.timer = -20;
    }
  }

  if (e.fxState === 'roaring') {
    e.timer += 1;
    if (e.timer === 16 && !e.attack_speed) e.bar = 24;
    // Ghost screens every 3rd frame while the roar accelerates
    // (scr_afterimage_grow + obj_afterimage_screen, faderate 0.05).
    if (sc && e.timer % 3 === 0 && e.attack_speed > 0) {
      sc.ghosts.push({ born: sc.t, faderate: 0.05 });
    }
    if (e.timer === 24 - e.attack_speed) {
      if (e.attack_speed === 0) {
        e.sprite_index = 'spr_roaringknight_pose_ol';
        e.image_index = 0;
        e.image_speed = 0.5;
        cues.push({ name: 'snd_knight_roar', pitch: 1, gain: 1 });
        e.whiteout = false;
        e.circleFlash = 1;
        if (sc) {
          // THE CIRCLE — white at birth, red by original bug (header).
          sc.circle = { size: 0, r: 255, g: 255, b: 255, alpha: 1 };
          // scr_script_repeat(instance_create, 8, 2, ...): screen copies at
          // 2-frame intervals across the next 8 frames (faderate default).
          for (let d = 2; d <= 8; d += 2) {
            sc.ghostSchedule.push({ at: sc.t + d, faderate: 0.00625 });
          }
        }
      } else {
        cues.push({ name: 'snd_knight_puff', pitch: 0.15, gain: 1 });
      }
    }
    if (e.timer === 28 - e.attack_speed) {
      e.spin *= -1;
      e.counter += 1;
      e.attack_speed = Math.min(14, e.attack_speed + 1);
      if (e.counter < 30) e.timer = 0;
    }
    e.roarendtimer += 1;
    if (e.roarendtimer >= e.roarendtimermax) e.done = true;
  }

  // The pose sprite animates at 0.5; two frames in the pack.
  if (e.image_speed) e.image_index = (e.image_index + e.image_speed) % 2;

  // The flash bar's decay is per-frame state (the GML does it in Draw, but
  // a renderer must not advance numbers — the 30Hz rule).
  if (e.bar) {
    e.bar *= 0.65;
    if (e.bar < 0.5) e.bar = 0;
  }
}

// ---------------------------------------------------------------------------
// The full scene.

// Exported for the fight renderer: the battle happens IN THIS ROOM at this
// same camera (scr_battle never changes rooms), so the vista stays behind the
// fight while obj_bgfountaintest's alphafactor fades the battle dark over it.
export const CAM_X = 2230;

export function createIntroScene() {
  return {
    t: 0,
    phase: 'tableau', // tableau -> roar -> reappear -> sword -> marker -> entry -> done
    phaseT: 0,
    camX: CAM_X,
    done: false,
    // The party, halted where the run left them (con 3's walkdirects).
    actors: {
      kris: { x: 2356, y: 104, sprite: 'spr_krisb_idle', index: 0, speed: 0.2 },
      susie: { x: 2310, y: 142, sprite: 'spr_susie_idle_serious', index: 0, speed: 0.2 },
      ralsei: { x: 2288, y: 190, sprite: 'spr_ralsei_walk_right_unhappy', index: 0, speed: 0 },
    },
    // First-run staging: created at (2350, cameray() + 100) in con 0, then
    // the con-3 script lerps x by +310+10 — so the roar and the sword draw
    // happen at x 2670. (2655/106 is the REVISIT branch's placement.)
    knight: {
      x: 2670,
      ystart: 100,
      y: 100,
      siner2: 0,
      aetimer: 0,
      visible: true,
      sprite: 'spr_roaringknight_idle_overworld',
      index: 0,
      speed: 0.1,
      // draw_sword machinery (obj_ch3_PTB02_roaringknight).
      draw_sword: false,
      draw_timer: 0,
      sword_active: false,
      sword_appear: false,
      sword_flash: true,
      sword_alpha: 0,
      alpha_siner: 0,
      y_base_pos: 0, // set when the draw starts, from the live y (per Create)
      y_base_from: 0,
      y_base_t: -1, // lerp clock for the 15f rise, -1 idle
      grab_hand: false,
      stampIndex: 0,
      stampTimer: 0,
      battle_ready: false,
    },
    marker: null, // { index, delayIndex, timer } — the room's takeover frames
    fx: null,
    circle: null, // the red layer
    ghosts: [], // { born, faderate } — renderer snapshots the canvas at birth
    ghostSchedule: [], // climax repeats not yet born
    bg: { fountain_speed: 0.2, fadeAlpha: 1 },
  };
}

// The actor stamps: spr_roaringknight_sword_appear_new frames 0..7 on
// tick-counted delays (the whole block sits inside `aetimer % move_speed`).
const ACTOR_STAMPS = [2, 2, 2, 2, 2, 4, 2, 2];
// The room marker's per-frame delays, [8, 1, 6, 6, ...] — but PTB02's
// sword_draw_timer field starts at 0 (Create), so the FIRST decrement fires
// immediately: frame 7 shows for one frame, then index 1 (the SLASH, frame 8)
// for timestamps[1] = 1 frame, then 9 and 10 for 6 each, then 11 -> ready.
// timestamps[0] = 8 is never consumed. Holding frame 7 for those 8 frames
// (the earlier reading) stalled the flourish, reported from play.
const MARKER_DELAYS = [8, 1, 6, 6];

/** One 30Hz tick of the whole scene. */
export function stepIntroScene(sc, cues) {
  if (sc.done) return;
  sc.t += 1;
  sc.phaseT += 1;
  const k = sc.knight;

  // The hover runs whenever the knight exists (siner2++ unconditional here:
  // reach_interrupt/stopsiner2 never fire in this sequence).
  k.siner2 += 1;
  k.y = k.ystart + Math.cos(k.siner2 / 8) * 8;
  if (k.speed && !k.draw_sword) k.index += k.speed;

  // The party idle at their actor rates.
  for (const key of Object.keys(sc.actors)) {
    const a = sc.actors[key];
    if (a.speed) a.index += a.speed;
  }

  // The backdrop fountain animates in Draw (`fountain_speed += 0.1` when no
  // parallax object exists) — stepped here under the 30Hz rule.
  sc.bg.fountain_speed += 0.1;

  // Climax ghost repeats falling due.
  while (sc.ghostSchedule.length && sc.ghostSchedule[0].at <= sc.t) {
    sc.ghosts.push({ born: sc.t, faderate: sc.ghostSchedule.shift().faderate });
  }
  // Ghosts age out when fully faded (alpha 0.5 at birth).
  sc.ghosts = sc.ghosts.filter((g) => 0.5 - (sc.t - g.born) * g.faderate > 0);

  // The circle — Step translated: g/b approach 0 at 255/28, r NEVER (the
  // original's missing line); size approaches 960 at 40; alpha fades only
  // once the fx is gone.
  if (sc.circle) {
    const c = sc.circle;
    c.g = Math.max(0, c.g - 255 / 28);
    c.b = Math.max(0, c.b - 255 / 28);
    c.size = Math.min(960, c.size + 40);
    if (!sc.fx || sc.fx.done) {
      c.alpha -= 0.1;
      if (c.alpha < 0) sc.circle = null;
    }
  }

  switch (sc.phase) {
    case 'tableau':
      // c_wait(30), then state 99 + visible 0 + the fx one frame later.
      if (sc.phaseT >= 31) {
        k.visible = false;
        // The fx lives in SCREEN space (its draw has no camera term), and is
        // created at the knight's LIVE hover y — the original passes
        // roaring_knight.y, so the swap inherits the hover phase instead of
        // snapping to ystart (which popped up to 8px).
        sc.fx = createIntroFx(k.x - sc.camX + 20, k.y - 20);
        sc.phase = 'roar';
        sc.phaseT = 0;
      }
      break;
    case 'roar':
      stepIntroFx(sc.fx, cues, sc);
      if (sc.fx.done) {
        k.visible = true;
        k.sprite = 'spr_roaringknight_idle_overworld';
        k.index = 0;
        sc.phase = 'reappear';
        sc.phaseT = 0;
      }
      break;
    case 'reappear':
      // The script rolls straight into con 3.1 -> 4: draw_sword — the block
      // handoff is a c_waitcustom cycle, two frames, not a held beat.
      if (sc.phaseT >= 2) {
        k.draw_sword = true;
        sc.phase = 'sword';
        sc.phaseT = 0;
      }
      break;
    case 'sword': {
      // The actor's Step: everything below gates on aetimer % move_speed(4).
      k.aetimer += 1;
      // The 15f sword rise runs on real frames (scr_lerpvar is per-frame).
      //
      // THE CURVES ARE THE SOURCE'S, not shapes that look about right:
      //
      //     scr_lerpvar("sword_alpha", 0, 1, 15, 4, "out");
      //     scr_lerpvar("y_base_pos", y_base_pos, y_base_pos - 266, 15, -1, "out");
      //
      // Curve -1 is `ease_out_back` — the blade OVERSHOOTS its stop and
      // settles back into the hand, which is the snap the flourish is built
      // around. This ran a plain quadratic (curve 2) and a hand-fitted
      // `min(1, t * 1.4)` alpha instead, so the draw glided up and stopped
      // dead: reported from play as the sword looking wonky. Curve 4 is the
      // quartic ease-out, `1 - (t - 1)^4`.
      if (k.y_base_t >= 0 && k.y_base_t < 15) {
        k.y_base_t += 1;
        const t = k.y_base_t / 15;
        k.y_base_pos = k.y_base_from - 266 * scrEaseOut(t, -1);
        k.sword_alpha = scrEaseOut(t, 4);
      }
      if (k.sword_appear) k.alpha_siner += 1.5;

      // THE SPRITE ANIMATES EVERY FRAME, not once per 4-frame tick.
      // `image_speed = 0.3` is set at draw_timer 1 and zeroed at 3, and
      // GameMaker advances image_index by image_speed on EVERY step — the
      // `aetimer % move_speed` gate below only decides when the draw_timer
      // beats fire. Folding the animation into the gate (`index + 0.3 * 4`
      // once every four frames) made the unsheathe jump in two hard steps
      // instead of playing: part of the wonkiness reported from play.
      k.index += k.speed;

      if (k.aetimer % 4 === 0) {
        k.draw_timer += 1;
        if (k.draw_timer === 1) {
          k.sword_active = true;
          k.sprite = 'spr_roaringknight_sword_appear';
          k.index = 0;
          k.speed = 0.3;
        }
        if (k.draw_timer === 3) {
          // `image_speed = 0` — the unsheathe pose FREEZES here and the
          // blade's own rise takes over.
          k.speed = 0;
          k.sword_appear = true;
          k.y_base_from = k.y + 152; // y_base_pos anchors off the live y
          k.y_base_pos = k.y_base_from;
          k.y_base_t = 0;
        }
        if (k.draw_timer === 8) {
          k.sword_flash = false;
          k.sword_appear = false;
        }
        if (k.draw_timer === 12) {
          k.sprite = 'spr_roaringknight_sword_appear_new';
          k.index = 0;
          k.grab_hand = true;
          k.stampIndex = 0;
          k.stampTimer = ACTOR_STAMPS[0];
        }
        if (k.grab_hand && !k.battle_ready) {
          k.stampTimer -= 1;
          if (k.stampTimer <= 0) {
            k.stampIndex += 1;
            if (k.stampIndex >= ACTOR_STAMPS.length) {
              k.battle_ready = true;
            } else {
              k.stampTimer = ACTOR_STAMPS[k.stampIndex];
              k.index = k.stampIndex;
            }
          }
        }
      }
      if (k.battle_ready) {
        // The room takes over: knight hidden, the marker at frame 7, timer 0
        // — the first decrement advances it on the very next frame (header
        // note on MARKER_DELAYS).
        k.visible = false;
        sc.marker = { index: 7, delayIndex: 0, timer: 0 };
        sc.phase = 'marker';
        sc.phaseT = 0;
      }
      break;
    }
    case 'marker': {
      const m = sc.marker;
      m.timer -= 1;
      if (m.timer <= 0) {
        m.delayIndex += 1;
        m.index = 7 + m.delayIndex;
        if (m.index >= 11) {
          // sword_draw_ready -> PTB02 con 4 fires scr_battle(115) THAT frame,
          // and the seam is obj_encounterbasic, not a fade: the party's
          // overworld instances become dark markers, the knight's marker is
          // handed to scr_move_to_point_over_time, and 25 frames later
          // obj_battlecontroller exists. See the 'entry' case below.
          sc.phase = 'entry';
          sc.phaseT = 0;
          // The knight marker's glide (scr_battle's monstertype-104 branch):
          // scr_move_to_point_over_time(heromakex, PTB02.ystart + hover, 20)
          // with stopsiner2 — a LINEAR lerp over 20 frames (obj_move_to_point
          // Step is `lerp(x, movex, movetimer / movemax)`), onto the fight
          // actor's exact FIRST-FRAME hover: the fight's siner2 starts at 0,
          // so its opening y is 78 + cos(0)*8 = 86. Handing off mid-bob
          // popped the swap frame by up to 16px (reported from play).
          k.hoverPause = true;
          // THE GLIDE IS HORIZONTAL. scr_battle's monstertype-104 branch:
          //
          //     with (obj_ch3_PTB02_roaringknight) stopsiner2 = true;
          //     scr_move_to_point_over_time(global.monstermakex[__ien],
          //         obj_ch3_PTB02_roaringknight.ystart
          //             + cos(obj_ch3_PTB02_roaringknight.siner2 / 8) * 8, 20);
          //
          // the target Y is the OVERWORLD knight's OWN frozen hover — his
          // ystart plus the cosine at the moment `stopsiner2` stopped it —
          // not the battle anchor's. So the marker slides sideways and holds
          // its height; the vertical difference between the two anchors
          // (overworld ystart 100, battle ystart 78) is resolved in the
          // single frame where obj_doom destroys the marker and
          // obj_knight_enemy takes its place, under the battle's own opening.
          //
          // Gliding to 86 instead made him drift DOWNWARD across the handoff,
          // which is the part that read as floaty. Horizontally it is only
          // 2670 -> 2655, fifteen pixels, which is why the real seam does not
          // look like a move at all.
          sc.glide = {
            fromX: k.x,
            fromY: k.y,
            toX: sc.camX + 425,
            toY: k.y,
          };
          // obj_encounterbasic's Create: the party become dark markers at
          // their overworld spots — Kris spr_kris_sword_jump_down, Susie
          // spr_susier_wall (her rsprite is spr_susier_dark, which the
          // encounter swaps), Ralsei his ch3 rsprite spr_ralsei_walk_right —
          // held on frame 0 (scr_dark_marker sets image_speed = 0). Their
          // stations ARE where the tableau left them: encountersetup 115's
          // heromake (126,104)/(80,142)/(58,190) equals the actors' positions
          // minus CAM_X, so the "fly-in" (speed = distance/10) covers zero
          // distance in this fight and the party transforms in place.
          sc.actors.kris.sprite = 'spr_kris_sword_jump_down';
          sc.actors.susie.sprite = 'spr_susier_wall';
          sc.actors.ralsei.sprite = 'spr_ralsei_walk_right';
          for (const key of Object.keys(sc.actors)) {
            sc.actors[key].index = 0;
            sc.actors[key].speed = 0;
          }
          sc.flightGhosts = [];
        } else {
          m.timer = MARKER_DELAYS[m.delayIndex];
        }
      }
      break;
    }
    case 'entry': {
      // obj_encounterbasic's Step, both cons. An earlier version of this
      // phase was an invented 45-frame scenery fade — the real seam never
      // fades the room; the fight's own backdrop (obj_bgfountaintest) fades
      // IN over it once the battle starts (render/background.js alphafactor).
      //
      // The knight marker's linear 20-frame glide (obj_move_to_point).
      const t = Math.min(1, sc.phaseT / 20);
      k.x = sc.glide.fromX + (sc.glide.toX - sc.glide.fromX) * t;
      k.y = sc.glide.fromY + (sc.glide.toY - sc.glide.fromY) * t;

      // fightcon 1: `if (counttimer < 10)` — afterimages of every marker,
      // alpha 0.5, fading at obj_afterimage's 0.04/frame. counttimer has
      // already been incremented when the test runs, so frames 1..9 spawn.
      if (sc.phaseT < 10) {
        for (const key of Object.keys(sc.actors)) {
          const a = sc.actors[key];
          sc.flightGhosts.push({
            sprite: a.sprite, index: Math.floor(a.index), x: a.x, y: a.y, born: sc.t,
          });
        }
      }
      sc.flightGhosts = sc.flightGhosts.filter((g) => 0.5 - (sc.t - g.born) * 0.04 > 0);

      // `counttimer >= 10`: snd_impact at 0.7 + snd_weaponpull_fast at 0.8,
      // and the flourish — THE attack animation the fight opens on: Kris
      // spr_krisb_attack, Susie spr_susieb_attack, Ralsei his own
      // spr_ralsei_battleintro, all from frame 0 at image_speed 0.5.
      if (sc.phaseT === 10) {
        cues.push({ name: 'snd_impact', pitch: 1, gain: 0.7 });
        cues.push({ name: 'snd_weaponpull_fast', pitch: 1, gain: 0.8 });
        sc.actors.kris.sprite = 'spr_krisb_attack';
        sc.actors.susie.sprite = 'spr_susieb_attack';
        sc.actors.ralsei.sprite = 'spr_ralsei_battleintro';
        for (const key of Object.keys(sc.actors)) {
          sc.actors[key].index = 0;
          sc.actors[key].speed = 0.5;
        }
      }

      // fightcon 2: 15 more frames, then the markers are destroyed and
      // obj_battlecontroller is created — the fight's frame 0.
      if (sc.phaseT >= 25) {
        sc.done = true;
      }
      break;
    }
  }
}
