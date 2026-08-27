// PRACTICE MODE — one attack, on repeat, at a difficulty you pick.
//
// The fight scene walks the selector's table; this runs a single entry from it
// forever, which is what practising a pattern actually needs. It reuses
// `launchAttack` and `clearTurn` from fight.js rather than re-deriving the
// per-attack setup, so an arena position or turn length fixed in one place is
// fixed for both.
//
// The menu is built from ATTACK_MENU below rather than from FIGHT_TABLE,
// because the table lists each attack once per turn it appears in and a
// practice list wants each attack once, with its real difficulties offered as
// options.

import { spawn, destroy } from '../entity.js';
import { soul } from '../soul.js';
import { battlebox, settleBox } from '../battlebox.js';
import { gmlCreate } from '../rng.js';
import { knightActor, partyActor, PARTY, KNIGHT, BOX, SOUL_START } from '../actors.js';
import { launchAttack, openArena, clearTurn, FIGHT_TABLE } from './fight.js';
import { createMenu } from '../menu.js';
import { freshParty, scrRevive } from '../damage.js';
import { COMBO_ATTACKS } from '../attacks/combination.js';

/** The objects a combination turn can hand itself to. */
const COMBO_SEGMENT_NAMES = new Set(Object.values(COMBO_ATTACKS).map((a) => a.name));

/**
 * Every attack the fight can select, with the difficulties it actually appears
 * at — plus the DEBUG CONTENT at the bottom: attacks the selector can never
 * choose (`nextTurn`'s fall-through analysis), reachable in the real game only
 * through `if (scr_debug() && overrideAttack > 0)`. They are launched with the
 * dispatch table's exact parameters and labelled UNUSED where the player sees
 * them, per the project rule.
 *
 * The difficulties are the selector's raw values; the UI shows them 1-based
 * (see difficultyBlurb) so the player picks "DIFFICULTY 1/2/3", not 0/3/4.
 *
 * Rotating Slash previously offered a difficulty 3 here — no selector row and
 * no branch in obj_knight_rotating_slash's Other_10 uses one (it branches on
 * 1 and 2 only), so it was invented content and is gone.
 */
export const ATTACK_MENU = [
  { id: 'stars', ac: 1, name: 'Stars', difficulties: [0, 1, 2], where: 'phase 1/2/3 opener' },
  { id: 'tracking11', ac: 11, name: 'Tracking Swords', difficulties: [0], where: 'phase 1 turn 2' },
  { id: 'flurry', ac: 2, name: 'Flurry (box splitter)', difficulties: [0, 1, 3], where: 'phase 1/2/3' },
  { id: 'tunnel', ac: 13, name: 'Sword Tunnel', difficulties: [0, 3, 4], where: 'phase 1/2/3' },
  { id: 'rotating', ac: 5, name: 'Rotating Slash', difficulties: [0, 1, 2], where: 'closes every phase' },
  { id: 'vortex', ac: 15, name: 'Sword Vortex + Tracking', difficulties: [0], where: 'phase 2 turn 4' },
  { id: 'tracking14', ac: 14, name: 'Tracking Swords (late)', difficulties: [0], where: 'phase 3 turn 3' },
  { id: 'roaring', ac: 9, name: 'ROARING', difficulties: [0], where: 'phase 4 finale' },
  { id: 'stream', ac: 4, name: 'X Attacks (stream)', difficulties: [0], where: 'UNUSED', unused: true },
  { id: 'swordfall', ac: 10, name: 'Swords Falling', difficulties: [0, 1], where: 'UNUSED', unused: true },
  { id: 'underbox', ac: 6, name: 'Orbs Under the Box', difficulties: [0], where: 'UNUSED', unused: true },
  { id: 'knightlines', ac: 20, name: 'Knightlines (spears)', difficulties: [0], where: 'UNUSED', unused: true },
  { id: 'swordslash', ac: 0, name: 'Swordslash (crescents)', difficulties: [0, 1], where: 'UNUSED', unused: true },
  // The last unused attack, and the only roster entry that is PARTIAL: the
  // combination chains three attacks and its third is obj_knight_tunnel_
  // slasher_2_revised, ac 3's own untranslated attack. Labelled where the
  // player sees it, per the project rule.
  { id: 'tunnel2', ac: 3, name: 'Sword Tunnel (revised)', difficulties: [0], where: 'UNUSED', unused: true },
  { id: 'combination', ac: 7, name: 'Combination', difficulties: [0], where: 'UNUSED', unused: true },
  { id: 'diagonal', ac: 12, name: 'Diagonal Bullets', difficulties: [0], where: 'UNUSED', unused: true },
  { id: 'rotating16', ac: 16, name: 'Rotating + Tracking', difficulties: [0], where: 'UNUSED', unused: true },
  { id: 'tracking17', ac: 17, name: 'Tracking Swords (multi)', difficulties: [0], where: 'UNUSED', unused: true },
];

export function menuEntry(id) {
  return ATTACK_MENU.find((a) => a.id === id) ?? ATTACK_MENU[0];
}

/**
 * Where an (ac, difficulty) pair actually appears, read off the selector's
 * own table — so the difficulty picker can say "phase 2" without a second
 * hand-maintained list going stale.
 */
export function difficultyBlurb(ac, diff) {
  const phases = [];
  for (const p of [1, 2, 3, 4]) {
    for (const row of FIGHT_TABLE[p]) {
      if (row.ac === ac && row.difficulty === diff && !phases.includes(p)) phases.push(p);
    }
  }
  if (!phases.length) return 'UNUSED';
  return `phase ${phases.join(' & ')}`;
}

const GAP = 45;
const DRAIN = 90;
/** `rtimer == 12` — the beat between the board opening and the attack. */
const RTIMER_SPAWN = 12;

const director = {
  name: 'practice_director',

  create(e, state) {
    e.started = false;
    e.gap = GAP;
    e.drain = 0;
    e.elapsed = 0;
    e.owner = null;
    e.runs = 0;
    // THE SELECTOR PICKS THE ATTACK AT THE TOP OF THE TURN, so anything gated
    // on `myattackchoice` is live from then — not from the board opening and
    // certainly not from the attack object spawning. Swordslash's soul clamp
    // is the one that notices: set any later and there is a frame where the
    // choice is current and the clamp has not run, because the Knight's End
    // Step comes before the director's.
    state.currentAc = state.practiceEntry.ac;
  },

  step(e, state) {
    // THE REBUILD RUNS IN STEP, NOT ENDSTEP, and the difference is one frame
    // of clamp. The knight is the scene's oldest entity, so his endStep — the
    // ac-0 wall clamp among other things — runs before this director's
    // endStep. A soul spawned there went unclamped until the next frame;
    // spawned here, the knight's endStep still lies ahead in the same frame
    // and catches it. verify-swordslash held the line: one violating frame.
    if (e.rebuild) {
      e.rebuild = false;
      settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
      state.soul = spawn(state, soul, { ...SOUL_START });
    }
  },
  endStep(e, state) {
    if (e.started && state.turntimer > 0) state.turntimer -= 1;

    const entry = state.practiceEntry;
    state.phase = `${entry.name} · difficulty ${entry.difficulty} · run ${e.runs}`;

    if (e.started) {
      e.elapsed += 1;
      // THE COMBINATION HANDS THE TURN ON, so "the owner died" is not "the
      // turn is over" for ac 7. Each segment destroys itself as it creates the
      // next, and the drill's owner is only the FIRST — without this the turn
      // was declared finished the moment swordfall handed off to the rotating
      // slash, and the second segment was swept a few frames later.
      //
      // Adopting the live successor is the same shape the real turn has: the
      // clock stays pinned at 999999 until the LAST segment's CleanUp sets it
      // to -1, so the chain, not the first object, is what owns the turn.
      if (e.owner && !e.owner.alive) {
        const next = state.entities.find(
          (x) => x.alive && COMBO_SEGMENT_NAMES.has(x.type.name),
        );
        if (next) e.owner = next;
      }
      const ownerAlive = e.owner && e.owner.alive;
      const bulletsLeft = state.entities.some(
        (x) => x.alive && x.isBullet && x.type.name !== 'obj_heart',
      );
      // Same rule as the fight: the clock decides, with a short drain so
      // bullets can leave on their own before the sweep.
      const timeUp = state.turntimer <= 0 || !ownerAlive;
      if (timeUp) e.drain += 1;
      if (!(timeUp && (!bulletsLeft || e.drain >= DRAIN))) return;

      e.started = false;
      e.gap = GAP;
      e.runs += 1;
      // A DRILL REFILLS. Practice mode repeats one attack forever, so the
      // party is restored between runs — otherwise the third or fourth
      // repetition is unplayable for reasons that have nothing to do with the
      // pattern being practised. The full fight does NOT do this.
      state.partyHp = freshParty();
      // AND STAND THEM BACK UP. Refilling HP does not undo scr_dead -- being
      // down is `chardead`, and the pose reads the HP sign while the MENU
      // reads chardead, so a bare refill left anyone who had fallen during
      // the previous run standing at full health and unable to act: no menu,
      // no FIGHT bolt, not targetable. Reported from play as "Kris sometimes
      // cannot act, and he is not drawn correctly".
      //
      // This is CLAUDE.md's "Restoring HP does not stand anyone up" landing
      // for the second time -- the whole-fight keep-alive path in
      // sim/index.js already pairs its refill with scr_revive, and this drill
      // was the copy that did not.
      for (let i = 0; i < 3; i++) scrRevive(state, i);
      state.invTimer = -1;
      clearTurn(state);
      // AND GIVE THE HEART BACK. The real fight spawns obj_heart per TURN —
      // obj_battlecontroller's Alarm 11 destroys the soul and the board
      // together at the end of each one, and the next turn makes new ones.
      // This drill built its soul ONCE, at scene setup, so any attack that
      // destroys it left every later run with no heart at all.
      //
      // ROARING is exactly that attack: it pulls the soul into the vortex and
      // destroys it partway through, which is why the drill for it went
      // heartless after the first pass while every other attack looked fine.
      //
      // AND THE BOARD GOES WITH IT — Alarm 11 is `with (obj_heart)
      // instance_destroy(); with (obj_growtangle) instance_destroy();`, both
      // together, every turn. The drill used to keep ONE board and ONE soul
      // for its whole life, and Stars is where that showed: the cone drags
      // the board ~90px left during a run, the reused board never goes back
      // (launchAttack's placement is gated on `arenaOpened !== ac`, which a
      // reused board always fails), and a soul left where the previous run
      // ended can sit OUTSIDE the next run's grow-in — the wall sweeps out
      // through it, reject-on-entry keeps it out, and the player dodges from
      // the free half of the screen. Reported from play: "you can glitch
      // outside the box and dodge way easier".
      //
      // Destroying and respawning BOTH each run is the fight's own turn
      // cycle, not a patch.
      // Torn down THIS frame, rebuilt on the NEXT — Alarm 11's frame has no
      // soul and no board either, and rebuilding in the same endStep left the
      // fresh soul unclamped for exactly one frame (verify-swordslash caught
      // it: the ac-0 wall clamp runs in the knight's endStep, before this).
      if (state.soul?.alive) destroy(state.soul);
      state.soul = null;
      const oldGt = state.entities.find(
        (x) => x.alive && x.type.name === 'obj_growtangle',
      );
      if (oldGt) destroy(oldGt);
      e.rebuild = true;
      // …and the drill's next turn has already chosen it, being the same one.
      state.currentAc = state.practiceEntry.ac;
      return;
    }

    e.gap -= 1;
    // THE BOARD OPENS BEFORE THE ATTACK, by the same 12 frames the fight uses.
    //
    // `obj_knight_enemy` creates the growtangle in his `mnfight == 1.5` block
    // and spawns the attack 12 frames later on `rtimer == 12` — so the arena
    // is already most of the way through its 15-frame grow-in when the bullets
    // start. This drill used to do both on one frame, which is fine for an
    // attack that only reads the box's POSITION and wrong for one that reads
    // its SIZE: Swordslash computes its six lanes from `box.sprite_height`
    // once, at con 0, and with the board still at 40% scale they came out 22
    // pixels apart instead of 150.
    //
    // The fight scene has always done it in this order (see openArena's note);
    // this makes the drill agree with it.
    if (e.gap === RTIMER_SPAWN) {
      openArena(state, state.practiceEntry);
      // launchAttack re-opens the arena unless it is told this one is already
      // open — the same handshake practice.js uses. Without it the grow-in
      // restarts on the launch frame and the twelve frames are given back.
      const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
      if (gt) gt.arenaOpened = state.practiceEntry.ac;
    }
    if (e.gap > 0) return;
    e.owner = launchAttack(state, state.practiceEntry);
    e.started = true;
    e.elapsed = 0;
    e.drain = 0;
  },
};

/**
 * @param opts.attack      an id from ATTACK_MENU
 * @param opts.difficulty  one of that entry's difficulties
 */
export function buildSingleAttackScene(state, { seed = 12345, attack = 'stars', difficulty = 0 } = {}) {
  const m = menuEntry(attack);
  // The practice scene skips the menu (it drills ONE attack on repeat), but
  // the renderer always draws the charboxes, so the state has to exist.
  state.menu = createMenu();
  state.hp = 0;
  state.invTimer = -1;
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.gmlRng = gmlCreate(seed);
  state.turntimer = 0;
  state.invc = 1;
  state.practiceEntry = {
    ac: m.ac,
    name: m.name,
    difficulty: m.difficulties.includes(difficulty) ? difficulty : m.difficulties[0],
  };
  state.phase = m.name;

  spawn(state, knightActor, { x: KNIGHT.x, y: KNIGHT.ystart });
  for (const p of PARTY) {
    spawn(state, partyActor, { x: p.x, y: p.y, sprite_index: p.sprite, depth: p.depth });
  }

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, director);
  return state;
}
