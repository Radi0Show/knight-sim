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
import { battlebox, settleBox } from '../battlebox.js';
import { gmlCreate } from '../rng.js';
import { knightActor, partyActor, PARTY, KNIGHT, BOX } from '../actors.js';
import { launchAttack, openArena, clearTurn, deliverHeart, FIGHT_TABLE } from './fight.js';
import { createMenu } from '../menu.js';
import { freshParty, scrRevive, partyWiped } from '../damage.js';
import { cueLoop } from '../audio.js';
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
    e.musicStarted = false;
    // THE SELECTOR PICKS THE ATTACK AT THE TOP OF THE TURN, so anything gated
    // on `myattackchoice` is live from then — not from the board opening and
    // certainly not from the attack object spawning. Swordslash's soul clamp
    // is the one that notices: set any later and there is a frame where the
    // choice is current and the clamp has not run, because the Knight's End
    // Step comes before the director's.
    state.currentAc = state.practiceEntry.ac;
  },

  step(e, state) {
    // THE REBUILD RUNS IN STEP, NOT ENDSTEP — historically for the soul's
    // sake (a soul spawned in this director's endStep went unclamped by the
    // knight's ac-0 wall clamp, which runs in HIS endStep, before ours, for
    // one frame; verify-swordslash held the line). ONLY THE BOARD is rebuilt
    // here now: the soul is delivered by obj_moveheart at arena-open (below),
    // and an alarm-created instance steps on its birth frame with the
    // knight's endStep still ahead of it (sim/entity.js, runPhase's note),
    // so the clamp ordering holds without anything being spawned here.
    //
    // The board is a placeholder: openArena needs a live obj_growtangle to
    // place and grow, and this is where the fight's growtangle would be
    // sitting hidden between turns.
    if (e.rebuild) {
      e.rebuild = false;
      settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
    }
  },
  endStep(e, state) {
    // THE DRILL CAN DIE. Same gate as the fight director's (practice.js):
    // `partyWiped` latches gameOver and everything below stops, so a wipe is
    // never undone by the between-run refill further down. Reported from
    // play: "you cannot die in single attack". The driver takes it from
    // here (the Knight's own game over, then GO BACK rebuilds the drill).
    //
    // NOTE the early return also freezes the turn clock, so a headless drill
    // that must outlive a wipe sets `state.keepAlive` (sim/index.js refills,
    // revives and clears gameOver every frame on that path) — as
    // tools/verify-graze.mjs does; its scripted dodge wipes a full-HP party
    // mid-run on several attacks.
    if (!state.gameOver && partyWiped(state)) state.gameOver = true;
    if (state.gameOver) return;
    // obj_battlecontroller's Create loops `global.batmusic` for every
    // battle; the drill is one too. Cued on the first STEPPED frame, not at
    // build, exactly as the fight director does it — a state built under
    // the title screen is never stepped, so it never sounds, and the
    // driver's reset() stops the loop before rebuilding. Reported from play:
    // "no music in single attack".
    if (!e.musicStarted) {
      e.musicStarted = true;
      cueLoop(state, 'mus_knight');
    }
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
      // Torn down THIS frame; the board is rebuilt on the NEXT (step, above)
      // and the soul NOT UNTIL ARENA-OPEN, by obj_moveheart, as the Knight
      // delivers it. The drill used to respawn the soul with the board, 33
      // frames early, inside a settled placeholder box — and a soul steered
      // to that box's wall was outside the ring when openArena collapsed it
      // to scale 0 at the attack's own arena. Reject-on-entry collision never
      // pulls a soul back IN, so it walked out of the growing box and dodged
      // from the free half of the screen. Reported by email: "when the soul
      // recenters move to a corner; when the box animation plays you get out
      // of bounds" — and measured wider than a corner: any held direction
      // did it, single-axis included.
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
      // THE SOUL FLIES IN; IT DOES NOT APPEAR — the fight's own delivery,
      // from the same arena-open block the Knight uses (`scr_moveheart` in
      // obj_baseenemy's mnfight-1.5 setup): obj_moveheart leaves Kris now
      // and its alarm creates obj_heart at (gt.x - 10, gt.y - 10) eight
      // frames later, at grow timer 8, when the ring already encloses the
      // drop point — four frames before the attack launches. There is no
      // soul before this, so there is nothing to steer outside the box.
      // Guard is the Knight's `!i_ex(obj_heart)` (ac is never -1 here).
      // Measured headlessly (soul centre past the ring's outer edge while
      // the box is solid): 0 escape frames across 12 attacks x 8 held
      // directions x 2 runs, against 30-410 per cell before.
      if (!state.soul) deliverHeart(state, gt, state.practiceEntry.ac);
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
  // NO SOUL AT BUILD — same as the fight scene. Run 1's arena-open delivers
  // it via obj_moveheart (director.endStep); building one here gave run 1
  // the same 33-frame steer-out-of-the-box window every later run had.
  state.soul = null;
  spawn(state, director);
  return state;
}
