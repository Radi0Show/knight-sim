// obj_basicattack — THE IMPACT on the Knight when a FIGHT hit lands.
//
// `obj_heroparent`'s Step, inside `if (knightblock == 0)`:
//
//     attack = instance_create(monsterx + random(6), monstery + random(6),
//                              obj_basicattack);
//     [Susie]   sprite_index = spr_attack_mash2; image_speed = 0.5;
//               maxindex = 4; snd_play(snd_impact); instance_create(0,0,obj_shake);
//     [Ralsei]  sprite_index = spr_attack_slap1;  image_speed = 0.5; maxindex = 4;
//     [weapon 26] sprite_index = spr_attack_shard; image_speed = 0.334;
//     if (points == 150) { image_xscale = 2.5; image_yscale = 2.5; }
//
// and its own Create/Step:
//
//     image_xscale = 2; image_yscale = 2; image_speed = 0.334; maxindex = 3;
//     with (obj_battlecontroller) damagenoise = 1;
//     if (critical == 1) { image_xscale += 0.1; image_yscale += 0.1; }
//     if (image_index >= maxindex) instance_destroy();
//
// THREE THINGS WORTH NOTING:
//
// 1. **KRIS GETS NO OVERRIDE.** Only Susie, Ralsei and Noelle assign a sprite,
//    so Kris's impact is `obj_basicattack`'s OWN sprite — set on the object,
//    not in any event, and therefore invisible to a grep of the code dump.
//    `knight-research/tools/patches/object_sprite.csx` reads it off the object
//    definition; see KRIS_IMPACT below for what it resolved to.
//
// 2. **ONLY SUSIE SHAKES THE SCREEN AND PLAYS A SOUND.** `snd_impact` and
//    `obj_shake` are inside her branch alone. Giving all three the shake makes
//    every hit feel like hers.
//
// 3. **A CRITICAL IS BIGGER, NOT DIFFERENT.** `points == 150` scales the same
//    sprite to 2.5 from the default 2 — a 25% bigger impact, no separate art.
//
// `damagenoise = 1` is the FLAG pattern this project already models: the
// controller's Step turns it into one `snd_damage` per frame however many
// impacts asked for it.

import { cue } from './audio.js';
import { scrShakescreen } from './shake.js';

/**
 * Kris's impact is `obj_basicattack`'s OWN sprite — **`spr_attack_cut1`**.
 *
 * Read off the object definition with
 * `knight-research/tools/patches/object_sprite.csx`, which is new and exists
 * because of this: a sprite assigned on the object and never in an event is
 * invisible to every grep of the code dump. CLAUDE.md already records the
 * numeric-asset-id version of this trap (`knight_sprite = 664`); this is the
 * same gap through a different hole, and the fix is the same — go and read the
 * thing that actually holds the value.
 */
export const KRIS_IMPACT = 'spr_attack_cut1';

/** Per-slot sprite and playback, from the Step's branches. */
export const IMPACT = [
  { sprite: KRIS_IMPACT, speed: 0.334, maxindex: 3, shake: false },
  { sprite: 'spr_attack_mash2', speed: 0.5, maxindex: 4, shake: true },
  { sprite: 'spr_attack_slap1', speed: 0.5, maxindex: 4, shake: false },
];

export function createAttackVfx() {
  return [];
}

/**
 * Spawn one impact.
 *
 * @param {number} slot     party slot
 * @param {boolean} critical `points == 150`
 */
export function spawnImpact(state, x, y, slot, critical, rng) {
  const spec = IMPACT[slot];
  if (!spec) return;
  const { sprite } = spec;
  const r = () => (rng ? rng() : 0.5);
  state.attackVfx.push({
    // `+ random(6)` on both axes — the impact does not land in the same spot
    // twice, so three hits in a turn scatter across the Knight.
    x: x + r() * 6,
    y: y + r() * 6,
    sprite,
    index: 0,
    speed: spec.speed,
    maxindex: spec.maxindex,
    // The object's Create sets scale 2; a critical overrides it to 2.5.
    scale: critical ? 2.5 : 2,
    critical,
  });
  // `damagenoise = 1` — a FLAG. The controller turns however many impacts
  // asked into ONE sound.
  cue(state, 'snd_damage');
  // Susie's branch alone plays snd_impact and creates obj_shake.
  //
  // scrShakescreen, NOT a `state.shakeRequest` flag. That flag was written
  // here and READ BY NOTHING -- the same dead-write failure this project
  // already recorded for `state.pinnedShuffle`, and invisible for the same
  // reason: no suite asserts on the camera, so a shake that never exists
  // costs nothing anyone was checking.
  //
  // It is gameplay, not decoration. Every wall cull compares against
  // camerax() (obj_regularbullet destroys on `x < view.x - 80`), so four
  // pixels of shake move every despawn boundary by four pixels. Missing this
  // one dropped a shake per party turn: measured against the oracle's new
  // camera sidecar, 40 bursts of the fight's ~256 were absent, and the one at
  // f6830 is exactly why verify37 diverged at f6832 -- the bound sat at -77
  // in the game and -80 in the sim, and a Flurry tooth at -78.9147 fell
  // between them.
  //
  // UNGUARDED, matching the original: heroparent calls
  // `instance_create(0, 0, obj_shake)` with no exists-test, unlike
  // scr_damage's guarded call. obj_shake's own Create handles the collision
  // by setting `active = -1` on any second instance.
  if (spec.shake) {
    cue(state, 'snd_impact');
    scrShakescreen(state);
  }
}

export function stepAttackVfx(state) {
  const list = state.attackVfx;
  if (!list || !list.length) return;
  for (const v of list) {
    // `if (critical == 1) { image_xscale += 0.1; image_yscale += 0.1; }` — a
    // critical keeps GROWING for its whole three frames rather than sitting at
    // 2.5, so it blooms.
    if (v.critical) v.scale += 0.1;
    v.index += v.speed;
  }
  // `if (image_index >= maxindex) instance_destroy();`
  state.attackVfx = list.filter((v) => v.index < v.maxindex);
}
