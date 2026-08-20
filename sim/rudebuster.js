// RUDE BUSTER — `obj_rudebuster_anim` and `obj_rudebuster_bolt`.
//
// Susie's spell is not a damage number; it is a TIMING MINIGAME, and this
// build had it as an instant subtraction. The whole point is the press while
// the bolt is in flight.
//
// ── the animation ─────────────────────────────────────────────────────────
//
//     Create   image_speed = 0; with (obj_herosusie) visible = 0;
//     Step     image_index = t / 2;              // HALF speed
//              if (t == 10) { snd_rudebuster_swing; spawn the bolt at
//                             (x + 40, y + 30) }
//              if (t >= 28) { Susie visible again; destroy }
//
// Susie is HIDDEN and the animation object stands in for her — it is not an
// effect drawn over her, it replaces her for 28 frames. `image_index = t / 2`
// means the sheet plays at half speed, which is the same 0.5-per-frame rule
// obj_heroparent uses for everything else.
//
// ── the bolt ──────────────────────────────────────────────────────────────
//
//     direction = point_direction(...) - 20;    // aimed 20 degrees OFF
//     speed = 24; friction = -1.5;              // NEGATIVE — it accelerates
//     each frame: direction += angle_difference(dir, direction) / 4
//     lands when point_distance(x, y, cx, cy) <= 40
//
// It is fired deliberately wide and then homes, and it SPEEDS UP the whole
// way. So the flight time is not a fixed number of frames — which is exactly
// what makes the timing minigame a minigame rather than a memorised count.
//
// Against the Knight the aim point is raised: `targety -= 50`.
//
// ── THE EXTRA DAMAGE ──────────────────────────────────────────────────────
//
//     if (button1_p() && bolt_timer >= 4 && chosen_bolt == 0 && !lockdamage) {
//         chosen_bolt = bolt_timer; lockdamage = true;
//     }
//     ...on impact, final_bolt = bolt_timer:
//         chosen == final       +30
//         chosen == final - 1   +28
//         chosen == final - 2   +22
//         chosen == final - 3   +20
//         chosen == final - 4   +13
//         chosen == final - 5   +11
//         chosen == final - 6   +10
//         abs(chosen - final) <= 2   ->   snd_scytheburst, bursts at speed 40
//
// **PRESS AS LATE AS YOU DARE.** The bonus is measured backwards from the
// frame it lands, so the reward is for pressing just before impact, and there
// is no penalty for pressing early beyond getting less. One press only —
// `chosen_bolt == 0` locks it — and it does not count before frame 4.
//
// **THE KNIGHT HALVES IT, AND HE HALVES THE BONUS TOO:**
//
//     if (i_ex(obj_knight_enemy)) damage = round(damage / 2);
//
// applied AFTER the bonus is added. So a perfect +30 is worth 15 against him.
// Halving before would make the bonus worth double what it is.

import { gmlRound } from './gml.js';
import { cue } from './audio.js';
import { damageKnight, KNIGHT_MAXHP } from './knight.js';
import { scrOflash } from './fx.js';
import { spawnDmgNumber, resetDmgStack } from './dmgnumbers.js';

/** `t >= 28` ends the animation; the bolt leaves at `t == 10`. */
export const ANIM_FRAMES = 28;
export const BOLT_LAUNCH = 10;

/** The bonus table, indexed by `final_bolt - chosen_bolt`. */
export const BONUS = [30, 28, 22, 20, 13, 11, 10];

export function createRudeBuster() {
  return { anim: null, bolt: null };
}

/**
 * Start the spell. Returns nothing — the damage lands when the bolt does,
 * which is the point.
 */
export function castRudeBuster(state, susieX, susieY, damage, targetX, targetY) {
  state.rude = state.rude ?? createRudeBuster();
  state.rude.anim = { t: 0, x: susieX, y: susieY, index: 0 };
  state.rude.pending = { damage, targetX, targetY };
}

/** One frame of both objects. `press` is `button1_p()` — an EDGE. */
export function stepRudeBuster(state, press = false) {
  const r = state.rude;
  if (!r) return;

  // ---- obj_rudebuster_anim ------------------------------------------------
  if (r.anim) {
    const a = r.anim;
    a.index = a.t / 2;
    if (a.t === BOLT_LAUNCH && r.pending) {
      cue(state, 'snd_rudebuster_swing');
      // `instance_create(x + 40, y + 30, obj_rudebuster_bolt)`
      const { damage, targetX, targetY } = r.pending;
      const bx = a.x + 40;
      const by = a.y + 30;
      // `targety -= 50` for the Knight lives in the CALLER now, together with
      // the rest of the aim offset — applying it here too shifted the impact
      // 50px above his head.
      const cy = targetY;
      let dir = (Math.atan2(-(cy - by), targetX - bx) * 180) / Math.PI;
      if (dir < 0) dir += 360;
      r.bolt = {
        x: bx,
        y: by,
        cx: targetX,
        cy,
        // Fired 20 degrees WIDE, then homes back.
        direction: dir - 20,
        speed: 24,
        damage,
        t: 0,
        boltTimer: 0,
        chosen: 0,
        locked: false,
        explode: 0,
        alpha: 0,
        trail: [],
        bonusAnim: 0,
        dealt: 0,
      };
      r.pending = null;
      // A SPAWNED OBJECT DOES NOT STEP ON ITS CREATION FRAME — CLAUDE.md
      // records this from the vortex swords. The bolt's own Step does its
      // setup at `t == 0` and only moves from the frame after, so homing and
      // advancing it here would put the whole arc one frame early and start
      // the press window a frame too soon.
      r.justSpawned = true;
    }
    a.t += 1;
    if (a.t >= ANIM_FRAMES) r.anim = null;
  }

  // ---- obj_rudebuster_bolt ------------------------------------------------
  const b = r.bolt;
  if (!b) return;
  if (r.justSpawned) {
    r.justSpawned = false;
    return;
  }

  if (b.alpha < 1) b.alpha = Math.min(1, b.alpha + 0.25);

  if (b.explode === 0) {
    b.boltTimer += 1;

    // THE PRESS. One only, and not before frame 4.
    if (press && b.boltTimer >= 4 && b.chosen === 0 && !b.locked) {
      b.chosen = b.boltTimer;
      b.locked = true;
    }

    // Home: turn a quarter of the way toward the target each frame.
    let want = (Math.atan2(-(b.cy - b.y), b.cx - b.x) * 180) / Math.PI;
    if (want < 0) want += 360;
    let diff = ((want - b.direction + 540) % 360) - 180;
    b.direction = (b.direction + diff / 4 + 360) % 360;

    // `friction = -1.5` on a positive speed ACCELERATES — GML reduces the
    // magnitude by friction and a negative one adds to it.
    b.speed -= -1.5;
    const rad = (b.direction * Math.PI) / 180;
    b.x += b.speed * Math.cos(rad);
    b.y += -b.speed * Math.sin(rad);

    b.trail.push({ x: b.x, y: b.y, angle: b.direction, scale: 1.8, alpha: b.alpha - 0.2 });

    if (Math.hypot(b.cx - b.x, b.cy - b.y) <= 40) {
      // IMPACT. `final_bolt = bolt_timer`, and the bonus is measured back
      // from here.
      const final = b.boltTimer;
      let dmg = b.damage;
      if (b.chosen > 0) {
        const gap = final - b.chosen;
        if (gap >= 0 && gap < BONUS.length) dmg += BONUS[gap];
        if (Math.abs(b.chosen - final) <= 2) {
          b.bonusAnim = 1;
          cue(state, 'snd_scytheburst');
        }
      }
      // The Knight halves it — AFTER the bonus, so the bonus halves too.
      dmg = gmlRound(dmg / 2);
      b.dealt = dmg;
      damageKnight(state, dmg);
      // `scr_damage_enemy(star, damage)` — and THAT is what makes the number
      // purple. `dm.type = global.char[caster] - 1`, and Susie is character 2,
      // so type 1, which obj_dmgwriter draws in
      // `lightf = merge_color(c_purple, c_white, 0.6)`.
      //
      // The bolt calling scr_damage_enemy rather than touching HP directly is
      // the whole reason the popup exists at all; subtracting HP here and
      // stopping — which is what this did — landed the damage with no number.
      //
      // `global.hittarget[star] = 0` first, so the number starts at the bottom
      // of the stack instead of above whatever the attack bar left there.
      resetDmgStack(state);
      spawnDmgNumber(state, b.cx, b.cy, dmg, 1, 2);
      cue(state, 'snd_rudebuster_hit');
      // `with (target) __of = scr_oflash();` — the Knight lights up in his own
      // silhouette for about ten frames. Reported as issue #7: the bolt landed,
      // the number appeared, and he did not react. `red == 1` (the empowered
      // bolt, `damage += 90`) would recolour it c_red; nothing reachable here
      // casts that variant, so the white one is the only one spawned.
      const knight = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_knight_enemy',
      );
      if (knight) scrOflash(state, knight);
      b.explode = 1;
      b.t = 1;
      // Eight bursts, four at 45+i*90 and four more on the same angles —
      // the second set decays slower (0.8 against 0.75).
      b.bursts = Array.from({ length: 8 }, (_, i) => ({
        x: b.cx,
        y: b.cy,
        angle: 45 + i * 90,
        speed: b.bonusAnim === 1 ? 40 : 25,
        scale: 1,
        slow: i < 4 ? 0.75 : 0.8,
      }));
      return;
    }
  } else {
    b.t += 1;
    for (const s of b.bursts ?? []) {
      s.x += Math.cos((s.angle * Math.PI) / 180) * s.speed;
      s.y += -Math.sin((s.angle * Math.PI) / 180) * s.speed;
      s.speed *= s.slow;
      s.scale *= 0.8;
    }
    if (b.t >= 18) r.bolt = null;
  }

  // The trail fades whether or not it exploded, faster once it has.
  for (const a of b.trail) {
    a.scale -= 0.1;
    if (b.explode === 1) {
      a.alpha -= 0.07;
      a.scale *= 0.9;
    }
  }
  b.trail = b.trail.filter((a) => a.scale > 0.1 && a.alpha > 0);
}

/** Is the spell still resolving? The turn must wait for it. */
export function rudeBusterBusy(state) {
  const r = state.rude;
  return !!(r && (r.anim || r.bolt || r.pending));
}

export { KNIGHT_MAXHP };
