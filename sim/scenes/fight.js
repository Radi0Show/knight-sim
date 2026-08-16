// THE FIGHT'S REAL ATTACK ORDER, and the dispatch that launches each one.
//
// Everything here is read out of the game rather than arranged: the turn table
// comes from `obj_knight_enemy`'s Other_10 (the SELECTOR — see CLAUDE.md, "THE
// REAL FIGHT"), and the per-attack setup below comes from the knight's Step,
// which is what actually positions the arena and starts the clock.
//
// Nothing in this file invents a schedule. The previous playable scene looped
// one attack because the roster was incomplete; this replaces that.
//
// WHAT IS STILL A STAND-IN, stated plainly because the rule is that nothing
// invented ships unlabelled:
//
//   * The cone's spawn point for Stars is MEASURED from the recording rather
//     than computed — obj_dbulletcontroller's type-98 branch that creates it
//     is not translated, only the star spawner it drives.
//   * Between-turn cleanup stands in for the battle controller's end-of-turn
//     bullet sweep.
//
// NO LONGER A STAND-IN: the turn system is modelled (the party acts, then the
// Knight does), and phase 4 is entered on the real `monsterhp <= maxhp * 0.8`
// gate at the end of any turn rather than on a turn count.

import { spawn } from '../entity.js';
import { BATTLEBG_MASK } from '../masks.js';
import { KNIGHT_AT } from '../knight.js';
import { soul } from '../soul.js';
import { SOUL_START } from '../actors.js';
import { boxsplitterAttack } from '../attacks/boxsplitter-attack.js';
import { pointingCone } from '../attacks/pointing-cone.js';
import { starsController } from '../attacks/stars-controller.js';
import { spawnRotatingSlash } from '../attacks/rotating-slash.js';
import { swordTunnelManager } from '../attacks/sword-tunnel.js';
import { swordVortexManager } from '../attacks/sword-vortex.js';
import { trackingSwordsManager } from '../attacks/tracking-swords.js';
import { diagonalBulletManager } from '../attacks/diagonal-bullets.js';
import { knightStream } from '../attacks/knight-stream.js';
import { roaring2 } from '../attacks/roaring.js';
import { gmlIrandom, gmlCreate, gmlChoose, gmlRandom } from '../rng.js';
import { KNIGHT } from '../actors.js';

/**
 * The selector's table. Five turns per phase; phase 3 loops. Difficulties are
 * the bolded column in CLAUDE.md and are the main thing that changes between
 * phases — the roster is only seven attacks.
 */
export const FIGHT_TABLE = {
  1: [
    { ac: 1, difficulty: 0, name: 'Stars' },
    { ac: 11, difficulty: 0, name: 'Tracking Swords' },
    { ac: 2, difficulty: 0, name: 'Flurry' },
    { ac: 13, difficulty: 0, name: 'Sword Tunnel' },
    { ac: 5, difficulty: 0, name: 'Rotating Slash' },
  ],
  2: [
    { ac: 1, difficulty: 1, name: 'Stars' },
    { ac: 2, difficulty: 1, name: 'Flurry' },
    { ac: 13, difficulty: 3, name: 'Sword Tunnel' },
    { ac: 15, difficulty: 0, name: 'Sword Vortex' },
    { ac: 5, difficulty: 1, name: 'Rotating Slash' },
  ],
  3: [
    { ac: 1, difficulty: 2, name: 'Stars' },
    { ac: 2, difficulty: 3, name: 'Flurry' },
    { ac: 14, difficulty: 0, name: 'Tracking Swords' },
    { ac: 13, difficulty: 4, name: 'Sword Tunnel' },
    { ac: 5, difficulty: 2, name: 'Rotating Slash' },
  ],
  // PHASE 4 IS THREE TURNS, AND THE MIDDLE ONE IS EMPTY.
  //
  //     phase4turn++;
  //     if (phase4turn == 1 && rotatingslash3used == true) phase4turn = 2;
  //     if (phase4turn == 1) { myattackchoice = 5;  difficulty = 2; }
  //     if (phase4turn == 2) { myattackchoice = -1; difficulty = 1; }
  //     if (phase4turn == 3) { myattackchoice = 9;  difficulty = 0;
  //                            damagereduction = 0.4; haveusedroaring = true;
  //                            phase = 3; }
  //
  // `myattackchoice == -1` is a branch with an EMPTY BODY in the Step's arena
  // block — no `obj_growtangle`, so no board and no bullets — and it is the
  // only choice that takes no `scr_turntimer` override, keeping the default
  // 90 from the mnfight 1.5 -> 2 transition. What it does instead is
  // `chargeupcon = 1`: the Knight's wind-up, under the message "The Knight's
  // hands glow a strange color...". A turn that attacks with nothing looks
  // like a bug in a table and is the most telegraphed beat in the fight.
  //
  // The difficulty on turn 1 is 2, not the 3 this had. There is no
  // difficulty 3 rotating slash anywhere in the selector.
  4: [
    { ac: 5, difficulty: 2, name: 'Rotating Slash' },
    { ac: -1, difficulty: 1, name: 'Charge-up' },
    { ac: 9, difficulty: 0, name: 'ROARING' },
  ],
};

/**
 * `scr_turntimer(...)` per attack, from the knight's Step. The `else` arm is
 * 240, which is what Stars, Rotating Slash and Roaring all get — their own
 * controllers then extend it (Stars adds 30, and another 60 at difficulty 2).
 */
function turnLength(ac, difficulty) {
  // TYPES 104 AND 107 SET `global.turntimer = 999999` in the controller,
  // overriding whatever `scr_turntimer` just asked for. Both attacks run far
  // longer than a normal turn and end it themselves — rotating slash by
  // destroying itself on Alarm_3, Roaring by setting the clock to -1 at
  // roaring_timer 375. Using the knight's 240 here cut Roaring off mid-spiral
  // and then relaunched it.
  if (ac === 5 || ac === 9) return 999999;
  // ac 16 launches the type-104 controller too, so it gets the same 999999
  // override and the rotating slash ends the turn itself; the tracking
  // manager rides along (its own gate is `turntimer < 70`).
  if (ac === 16) return 999999;
  // The charge-up turn takes NO override. Every other choice ends its arm of
  // the `attacked == 0` block with its own `scr_turntimer(...)`; `ac -1` sets
  // `chargeupcon = 1` and nothing else, so the turn keeps the 90 assigned at
  // the mnfight 1.5 -> 2 transition. It is the shortest turn in the fight.
  if (ac === -1) return 90;
  if (ac === 2) return 350;
  if (ac === 11) return difficulty === 0 ? 292 : 300;
  if (ac === 13) return difficulty === 3 ? 360 : 330;
  if (ac === 14 || ac === 15 || ac === 12) return 300;
  return 240;
}

/** `global.invc` per attack — the multiplier on invulnerability after a hit. */
function invcFor(ac) {
  if (ac === 1 || ac === 5 || ac === 9) return 1;
  if (ac === 13) return 0.14;
  return 0.4;
}

/**
 * Where the arena goes, straight out of the knight's Step. Only three attacks
 * move or resize it; everything else uses the default.
 */
function arenaFor(ac) {
  // `if (myattackchoice == 4) { obj_growtangle.maxxscale = 3.5;
  //  obj_growtangle.maxyscale = 3.5; }` — the widest arena in the dispatch.
  if (ac === 4) return { x: 320, y: 170, xscale: 3.5, yscale: 3.5 };
  if (ac === 11) return { x: 320, y: 190, xscale: 2, yscale: 2 };
  if (ac === 13) return { x: 300, y: 190, xscale: 3, yscale: 2 };
  if (ac === 1) return { x: 320, y: 170, xscale: 2.25, yscale: 1.75 };
  return { x: 320, y: 170, xscale: 2, yscale: 2 };
}

/** MEASURED from traces/stars2.csv. See the header note. */
const CONE_POS = { x: 425, y: 78.56589 };

/**
 * Launch one turn. Returns the object that owns it, so the director can tell
 * when the attack has torn itself down.
 */
/**
 * Place the arena for a turn and START ITS GROW-IN.
 *
 * Split out of `launchAttack` because the two happen at DIFFERENT TIMES in the
 * original: `obj_knight_enemy`'s Step creates the growtangle under
 * `mnfight == 1.5`, and the attack itself spawns 12 frames later, on
 * `rtimer == 12` under `mnfight == 2`. So the board is already opening while
 * the arena is still empty, and the attack arrives into a finished box.
 *
 * Doing both at launch made the board appear and the bullets arrive on the
 * same frame; doing the grow twice — once here and once from the director's
 * rtimer window — restarted it halfway and the board visibly stuttered.
 */
export function openArena(state, entry) {
  // `myattackchoice == -1` has an EMPTY branch where every other choice
  // creates an obj_growtangle. No board rises on the charge-up turn — the
  // Knight winds up over an empty screen. Opening one here would put an
  // arena on the one turn of the fight that deliberately has none.
  if (entry.ac === -1) return;
  const arena = arenaFor(entry.ac);
  const gt = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
  if (!gt) return;
  gt.x = state.view.x + arena.x;
  gt.y = state.view.y + arena.y;
  gt.xstart = gt.x;
  gt.ystart = gt.y;
  gt.maxxscale = arena.xscale;
  gt.maxyscale = arena.yscale;
  // THE BOX IS NEW EACH TURN in the game — created in the mnfight-1.5 block
  // with its scales already assigned, so its `!init` first-Step block (the
  // scale snap and the hitbox-mask swap, sim/battlebox.js) runs once per
  // TURN. The sim's growtangle persists, so re-arm it here or the snap fires
  // exactly once at build, with the default 2 x 2 still in place, and every
  // custom arena keeps the unsnapped scale and the wrong wall.
  gt.init = false;
  gt.mask = BATTLEBG_MASK;
  gt.growcon = 1;
  gt.timer = 0;
  gt.image_xscale = 0;
  gt.image_yscale = 0;
  gt.image_angle = 180;
  gt.visible = true;
}

/**
 * `scr_bulletspawner`: `__dc.damage = global.monsterat[myself] * 5;`
 *
 * THE ROOT OF EVERY BULLET'S DAMAGE, and the reason most attacks were doing
 * exactly 1. The Knight's AT is 40, so the controller carries **200**, and
 * `scr_bullet_inherit` copies it down the whole chain:
 *
 *     dc.damage = 200
 *       -> _manager.damage = damage          (obj_dbulletcontroller Step)
 *         -> inst.damage = damage            (the manager's Step)
 *           -> slash.damage = damage         (the sword's Step)
 *
 * The last one matters most: `obj_tracking_sword_slash`'s own Create sets
 * `damage = 1`, and the parent OVERWRITES it two lines after creating it. That
 * 1 is dead code in the original — and it is exactly the value this build kept,
 * because it read each object's Create and never modelled the inheritance.
 *
 * So the managers were launched with 1 and 10 instead of 200, every bullet
 * inherited that, and `scr_damage_calculation` floored the result at 1. Six of
 * the seven attacks did one point of damage a hit.
 */
const CONTROLLER_DAMAGE = KNIGHT_AT * 5;

/**
 * `scr_bulletspawner`, re-anchored — the RNG counterpart of the shuffle
 * replay.
 *
 * The live stream BETWEEN launches is unmatchable: the game consumes draws in
 * random-pitch sounds and other engine noise the sim has no business
 * modelling (a scan put the first star's roll thousands of draws from the
 * sim's position). The oracle patch reseeds inside scr_bulletspawner — the
 * one gate every knight attack passes through — and this is the sim's half:
 * same seed arithmetic, advanced once per SPAWNER CALL, which is once per
 * launch except ac 15, whose branch calls it twice (type 154, then 151).
 *
 * DEVIATION, and reported as one: the real game's stream is continuous.
 * "Mechanics one-to-one, RNG re-anchored per launch" is the claim, exactly
 * as "shuffle order replayed" is. In free play (no oracle) the anchoring is
 * invisible: the stream is random per playthrough either way.
 */
function reanchorRng(state) {
  state.spawnn = state.spawnn ?? 0;
  state.gmlRng = gmlCreate((state.seed + state.spawnn * 1000) >>> 0);
  state.spawnn += 1;
}

export function launchAttack(state, entry) {
  const { ac, difficulty } = entry;

  // The charge-up turn spawns no controller. `chargeupcon = 1` is the whole
  // of its arm in the Step, and that drives the Knight's own Draw, not a
  // bullet spawner.
  if (ac === -1) {
    state.knight.chargeupcon = 1;
    return null;
  }

  const arena = arenaFor(ac);
  const gt = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
  // The arena was placed and started growing at the top of the rtimer window
  // (see openArena). Re-running the grow here would restart it 12 frames in.
  if (gt && gt.arenaOpened !== ac) {
    gt.x = state.view.x + arena.x;
    gt.y = state.view.y + arena.y;
    gt.xstart = gt.x;
    gt.ystart = gt.y;
    // RESTART THE GROW-IN rather than snapping to size. obj_growtangle opens
    // over 15 frames at the top of a turn (sim/battlebox.js); setting the
    // drawn scale directly skipped that entirely.
    //
    // One scale now — see battlebox.js. The walls follow the drawing, so an
    // attack that resizes the arena resizes what the soul can reach.
    gt.maxxscale = arena.xscale;
    gt.maxyscale = arena.yscale;
    // Re-arm the per-turn init — see the note at the other assignment.
    gt.init = false;
    gt.mask = BATTLEBG_MASK;
    gt.growcon = 1;
    gt.timer = 0;
    gt.image_xscale = 0;
    gt.image_yscale = 0;
    gt.image_angle = 180;
    gt.visible = true;
  }
  if (gt) gt.arenaOpened = null;

  // NO SOUL PLACEMENT HERE. This block used to stand in for scr_moveheart()
  // by snapping the soul to the arena at the LAUNCH frame — but the real
  // delivery is obj_moveheart (sim/scenes/practice.js), which lands the heart
  // 8 frames after the arena opens and 4 before the attack launches. By
  // launch the player has been steering for those 4 frames, and the snap
  // yanked them back to the drop point: the whole-fight diff caught it as
  // soul_x 330 -> 310 on the rtimer-12 frame. The ac-13 destination override
  // lives with the moveheart now, where the knight's Step actually applies it.

  // `obj_knight_enemy.myattackchoice == 2 && (difficulty == 1 || 3)` — Flurry
  // at those two difficulties takes a further third off the damage, inside
  // scr_damage's HP write. Set here because it is a property of the TURN.
  state.flurrySoftened = ac === 2 && (difficulty === 1 || difficulty === 3);

  state.invc = invcFor(ac);
  state.turntimer = turnLength(ac, difficulty);

  const knight = state.entities.find((e) => e.alive && e.type.name === 'obj_knight_enemy');
  const kx = knight ? knight.x : KNIGHT.x;
  const ky = knight ? knight.y : KNIGHT.ystart;

  // The knight carries the turn's difficulty, and at least one attack reads it
  // off HIM rather than off its own manager — obj_sword_tunnel_manager's Create
  // takes `finishtimermax` from `obj_knight_enemy.difficulty`. Set it before
  // anything is spawned.
  if (knight) knight.difficulty = difficulty;

  reanchorRng(state);

  switch (ac) {
    case 1: {
      // SPAWN ORDER IS STREAM ORDER. The game creates the CONTROLLER first
      // (scr_bulletspawner returns the dc; its type-98 init then creates the
      // cone), so dc.seq < cone.seq and on any later frame the dc STEPS
      // FIRST. That decides who touches the stream first on the frame the
      // first star spawns: the dc rolls size/special at stream position 38,
      // and the cone's two drag draws come AFTER. This used to spawn the
      // cone first, which put those two drags BEFORE the size roll — the
      // final two-draw offset the anchored diff kept showing.
      const endtimer = difficulty >= 2 ? 210 : 120;
      const dc = spawn(state, starsController, { ...CONE_POS });
      dc.difficulty = difficulty;
      dc.endtimer = endtimer;
      const cone = spawn(state, pointingCone, { ...CONE_POS });
      cone.difficulty = difficulty;
      cone.con = 1;
      cone.endtimer = endtimer;
      // `if (difficulty == 0) side = choose(-1, 1);` — the last line of the
      // type-98 init, and a REAL draw on the anchored stream. It cannot live
      // in the controller's create: `difficulty` is assigned after spawn
      // returns, so a create-time check reads undefined and silently skips —
      // the first version did exactly that and consumed nothing. Difficulty 2
      // draws its side per star instead (choose(0, 66, -66), in the spawn
      // branch).
      if (difficulty === 0 && state.gmlRng) {
        dc.side = gmlChoose(state.gmlRng, [-1, 1]);
      }
      // FOUR DRAWS, MEASURED AND NOT YET ATTRIBUTED. The oracle's first star
      // rolls its size at raw position 38 of the anchored stream; the
      // accounted consumers — the cone's yoff irandom (2), the side choose
      // (1), fifteen con-2 drag frames (30), the star's own dir choose (1) —
      // total 34. Something in the recording's window consumes four more,
      // and every candidate audited (growtangle, darkener, heart, follower,
      // burst, the knight's Draw, scr_childbullet, the sounds in play) draws
      // zero. Padded here, directly after the side, so the whole diff can
      // confirm or refine the placement: the pad is wrong ONLY if star 2+
      // aligns while star 1 does not, since later stars ride relative
      // offsets. ORACLE-FITTED — replace with the real consumer when it is
      // found.
      if (ac === 1 && state.gmlRng) {
        for (let pad = 0; pad < 4; pad++) gmlRandom(state.gmlRng, 1);
      }
      if (difficulty >= 2) state.turntimer += 60;
      return dc;
    }

    case 2: {
      // type 99 creates this AT THE KNIGHT and then hides him — from here on
      // the manager is the visible knight.
      const mg = spawn(state, boxsplitterAttack, { x: kx, y: ky });
      mg.difficulty = difficulty;
      if (knight) knight.image_alpha = 0;
      return mg;
    }

    case 5:
      return spawnRotatingSlash(state, kx, ky, { difficulty });

    case 9: {
      const r = spawn(state, roaring2, { x: state.view.x + 320, y: state.view.y + 88 });
      r.rand_angle = gmlIrandom(state.gmlRng, 360);
      return r;
    }

    case 11:
    case 14: {
      const mg = spawn(state, trackingSwordsManager, { x: arena.x, y: state.view.y });
      // THE DISPATCH HARDCODES THE VARIANT, it does not pass the selector's
      // `difficulty` through: ac 11 sets `dc.difficulty = 0`, ac 14 sets
      // `dc.difficulty = 3` (and the debug ac 17 sets 2) while the selector's
      // own variable is 0 for all three. `mg.variant = difficulty` ran phase
      // 3's tracking swords at variant 0 (rate 32 decaying to 16) instead of
      // the real variant 3 (rate 20 decaying to 13) — a visibly slower wave.
      mg.variant = ac === 14 ? 3 : 0;
      mg.damage = CONTROLLER_DAMAGE;
      trackingSwordsManager.init(mg, state);
      return mg;
    }

    // ------ DEBUG CONTENT from here to case 17: attacks the selector can
    // never choose (the phase blocks reassign `phaseturn` before their rows
    // can fire — see nextTurn). They exist for the SINGLE practice mode,
    // launched exactly as the dispatch table would.

    case 4: {
      // `dc.type = 103`: the arena is blown up to 3.5 x 3.5 (both in the
      // knight's Step and again in the controller), the knight is hidden, and
      // the manager takes over.
      if (knight) knight.image_alpha = 0;
      const mg = spawn(state, knightStream, { x: kx, y: ky });
      return mg;
    }

    case 12: {
      // `dc.type = 152` — obj_diagonal_bullet_manager at (growtangle.x,
      // cameray()), damage inherited from the spawner's monsterat * 5.
      const mg = spawn(state, diagonalBulletManager, { x: arena.x, y: state.view.y });
      mg.damage = CONTROLLER_DAMAGE;
      return mg;
    }

    case 16: {
      // Two spawner calls: rotating slash (104, difficulty 0), then tracking
      // swords (151, difficulty 0) with an explicit `dc.damage = 206` — the
      // only place the tracking damage is overridden off its inherited 200.
      const mg = spawnRotatingSlash(state, kx, ky, { difficulty: 0 });
      reanchorRng(state);
      const tr = spawn(state, trackingSwordsManager, { x: arena.x, y: state.view.y });
      tr.variant = 0;
      tr.damage = 206;
      trackingSwordsManager.init(tr, state);
      return mg;
    }

    case 17: {
      // `dc.type = 151; dc.difficulty = 2; dc.damage = 206` — the multisword
      // variant (pairs 4 frames apart along a fixed compass sweep), unused by
      // the fight.
      const mg = spawn(state, trackingSwordsManager, { x: arena.x, y: state.view.y });
      mg.variant = 2;
      mg.damage = 206;
      trackingSwordsManager.init(mg, state);
      return mg;
    }

    case 13: {
      const mg = spawn(state, swordTunnelManager, { x: arena.x, y: state.view.y });
      mg.timer = -40 + gmlIrandom(state.gmlRng, 10);
      mg.difficulty = difficulty;
      mg.knightDifficulty = difficulty;
      mg.damage = CONTROLLER_DAMAGE;
      swordTunnelManager.init(mg, state);
      return mg;
    }

    case 15: {
      // ac 15 is TWO controllers: the vortex, then tracking swords over it.
      const mg = spawn(state, swordVortexManager, { x: arena.x, y: arena.y });
      mg.damage = CONTROLLER_DAMAGE;
      // The SECOND scr_bulletspawner call of the ac-15 branch (type 151).
      reanchorRng(state);
      const tr = spawn(state, trackingSwordsManager, { x: arena.x, y: state.view.y });
      tr.variant = 0;
      tr.damage = CONTROLLER_DAMAGE;
      trackingSwordsManager.init(tr, state);
      return mg;
    }

    default:
      return null;
  }
}

/**
 * What SURVIVES a turn — everything else is swept.
 *
 * This used to be the other way round, a list of names to remove, and it was
 * wrong the moment it was written: it said `obj_knight_tracking_sword` and
 * `obj_knight_tracking_sword_manager`, while the actual types are
 * `obj_tracking_sword1` and `obj_tracking_swords_manager`. Nothing matched, so
 * tracking swords outlived their turn and flew around during Flurry.
 *
 * A keep-list cannot fail that way. Getting a name wrong here removes
 * something visible immediately, instead of silently leaking a bullet into the
 * next attack — and a newly translated attack is swept correctly without
 * anyone remembering to register it.
 */
const SURVIVES_TURN = new Set([
  'obj_heart',
  'obj_growtangle',
  'obj_knight_enemy',
  'actor_party',
  'fight_director',
  'practice_director',
  // obj_battlecontroller's stand-in (the turntimer decrement). The real
  // controller lives for the whole fight; sweeping it froze the clock at the
  // second turn's 292 and the fight never advanced again.
  'turn_clock',
]);

/**
 * THE END-OF-TURN SWEEP, and it is a stand-in — see the header. The real game
 * clears leftover bullets through the battle controller when the turn ends,
 * which is turn-system machinery this project does not model. It only ever
 * runs BETWEEN turns, so nothing live during an attack is touched.
 */
export function clearTurn(state) {
  for (const e of state.entities) {
    if (e.alive && !SURVIVES_TURN.has(e.type.name)) e.alive = false;
  }

  // THE SOUL IS NOT RESURRECTED HERE. It used to be, as stand-in machinery for
  // ROARING — whose finale cuts the screen and obj_heart with it.
  //
  // But the Knight creates the soul per bullet phase (scr_moveheart, from his
  // `mnfight == 1.5` setup) and the director now does the same at arena-open,
  // so a respawn here fired at TURN END and put the soul straight back for the
  // party's menu, where the real fight has none. It defeated the whole
  // lifecycle fix silently: the oracle correctly reported no soul while the
  // sim reported one moving, and the sim change looked like it had not worked.
  //
  // ROARING is still covered — the next turn's arena-open creates the soul
  // again, which is what the real fight does.
  if (state.soul && !state.soul.alive) state.soul = null;
  state.view.x = 0;
  state.view.y = 0;
  const knight = state.entities.find((e) => e.alive && e.type.name === 'obj_knight_enemy');
  if (knight) {
    // Attacks hide him in two different ways and both have to be undone:
    // Flurry's manager sets image_alpha = 0 (it becomes the visible knight),
    // and the Stars cone sets visible = false (it draws itself as the pointing
    // pose). obj_knight_pointing_cone's CleanUp restores this in the original.
    knight.image_alpha = 1;
    knight.visible = true;
  }
}

/**
 * Walks FIGHT_TABLE. `turn` is 0-based within the phase.
 *
 * The selector's phase blocks are a run of plain `if (phase == N)` tests, not
 * `else if`, and each phase's last turn reassigns `phase` and zeroes
 * `phaseturn` INSIDE that run. So the transition falls through into the next
 * phase's block in the same call with `phaseturn == 0`, which matches none of
 * its `phaseturn == 1..5` tests and therefore changes nothing.
 *
 * That fall-through is what makes PHASE 1 FIVE TURNS. Its `phaseturn == 5`
 * branch sets `phase = 2; phaseturn = 0`, so the `phaseturn == 6/7/8/9`
 * branches below it cannot fire — not that call, and not the next one, by
 * which time `phase` is 2. Attacks 12 (diagonal), 16, 17 (tracking variants)
 * and 7 (combination) are therefore UNREACHABLE in a real fight; the only way
 * in is `if (scr_debug() && overrideAttack > 0) phaseturn = overrideAttack`.
 * They are debug content, the same class as ac 6 underboxattack.
 *
 * CLAUDE.md's phase table listed all nine and is wrong; this is the third
 * time on this project that reading a table instead of the control flow
 * produced a fight that does not exist.
 */
export function nextTurn(phase, turn) {
  const list = FIGHT_TABLE[phase];
  if (turn + 1 < list.length) return { phase, turn: turn + 1 };
  // Phase 3 loops from its first turn; 1 and 2 advance.
  if (phase === 3) return { phase: 3, turn: 0 };
  // ROARING SETS `phase = 3`, so the fight falls back into the phase-3 loop
  // rather than restarting or repeating itself. It does not end here: the end
  // cutscene is gated on the Knight being HURT (see endCutsceneReached), so
  // what actually follows ROARING is one more party turn, and the fight ends
  // on the next hit that lands.
  if (phase === 4) return { phase: 3, turn: 0 };
  return { phase: phase + 1, turn: 0 };
}

/**
 * Entering phase 4. `phase4turn == 1` is SKIPPED when the phase-3 rotating
 * slash has already run:
 *
 *     phase4turn++;
 *     if (phase4turn == 1 && rotatingslash3used == true) phase4turn = 2;
 *
 * `rotatingslash3used` is set by phase 3's own turn 5, so a fight that
 * completed a phase-3 loop opens phase 4 on the charge-up. A fight whose HP
 * gate trips mid-phase-3 has not set it, and gets the rotating slash first.
 * Both are reachable, which is why this is a function and not a constant.
 */
export function phase4Entry(rotatingslash3used) {
  return rotatingslash3used ? 1 : 0;
}
