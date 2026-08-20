// The playable scene: the soul in the battle box, running THE REAL FIGHT.
//
// The attack ORDER, the difficulties, the arena position and scale per attack,
// the turn lengths and the invulnerability multiplier all come from
// sim/scenes/fight.js, which reads them out of the knight's selector and Step.
// Nothing here is arranged by hand.
//
// This replaces a loop of a single attack (Flurry), which was all the roster
// supported at the time.
//
// STILL A SANDBOX, and the HUD says so, for reasons that are all turn-system
// rather than bullet-behaviour: there is no ACT menu, no HP, and no party, so
// phase 4 is entered on a turn count instead of the real HP < 80%, and a turn
// ends when its clock runs out rather than when the party acts. The attacks
// themselves are the verified ones.

import { spawn } from '../entity.js';
import { soul } from '../soul.js';
import { battlebox, settleBox } from '../battlebox.js';
import { gmlCreate, gmlChoose, gmlIrandom, gmlRandom } from '../rng.js';
import { FIGHT_TABLE, launchAttack, openArena, clearTurn, nextTurn, phase4Entry, turnLength } from './fight.js';
import { battleMsgFor, OPENING_MSG } from '../battlemsg.js';
import { createMenu, stepMenu, openMenu, bagOf } from '../menu.js';
import { partyWiped, PARTY as PARTY_STATS, isUp } from '../damage.js';
import { createFightBar, stepFightBar, fightTp } from '../fightbar.js';
import { endTurnItems } from '../menu.js';
import { applyItem } from '../items.js';
import { createHeroes, stepHeroes, heroAct, HERO_ATTACK, HERO_IDLE, HERO_ITEM, HERO_SPELL } from '../heroes.js';
import {
  advanceBalloon, advanceReply, clearDialogue, dialogueDone, dialogueSkipTimer,
  textSoundChar,
} from '../dialogue.js';
import {
  spawnDmgNumber, stepDmgNumbers, stepHealWriters, resetDmgStack,
} from '../dmgnumbers.js';
import { spawnImpact, stepAttackVfx } from '../attackvfx.js';
import { stepRudeBuster, rudeBusterBusy } from '../rudebuster.js';
import { castSpell } from '../spells.js';
import { rngNext } from '../rng.js';
import {
  fightDamage, damageKnight, advanceTurn, stepKnightAnim, phase4Reached,
  endCutsceneReached, startEndCutscene, stepEndCutscene, DR_PHASE4, KNIGHT_MAXHP,
} from '../knight.js';
import { scrTensionheal } from '../tension.js';
import { cueLoop, cue, cueStop } from '../audio.js';
import { knightActor, partyActor, PARTY, KNIGHT, BOX, SOUL_START } from '../actors.js';


export const IS_SANDBOX = true;
export const SANDBOX_NOTE =
  'THE REAL FIGHT ORDER — verified attacks, real difficulties, real HP · phase 4 opens at 5840';

// THE BUFFERS BETWEEN TURNS, all three from the dump. This was one invented
// constant (`TURN_GAP = 45`) standing in for a sequence with real timings.
//
// `obj_knight_enemy`'s Step, once the bullet phase starts:
//
//     if (scr_isphase("bullets") && attacked == 0 && end_cutscene_version == 0)
//     {
//         rtimer += 1;
//         if (rtimer == 12) { ...spawn the attack... }
//     }
//
// So the arena is up and empty for **12 frames** before anything comes at you.
// That beat is what makes the board's grow-in readable.
const RTIMER_SPAWN = 12;

// `obj_attackpress`'s Create: `timermax = 50`, and its Draw counts `posttimer`
// up to it once every bolt is resolved (`goahead == 1`). Then `fade = 1` and
// `fadeamt += 0.08` per frame until it passes 1 — 13 more frames — before the
// object destroys itself and hands back to `global.mnfight = 1`.
const ATTACKPRESS_HOLD = 50;
const ATTACKPRESS_FADE = 13;

/** The beat after a turn ends, before the panels rise. */
/**
 * The beat between a turn ending and the menu reopening — ONE FRAME, from the
 * game rather than from taste.
 *
 *     // obj_battlecontroller Create
 *     myfightreturntimer = 1;
 *
 *     // obj_battlecontroller Step
 *     if (global.myfight == 5) {
 *         myfightreturntimer--;
 *         if (myfightreturntimer <= 0) {
 *             scr_mnendturn();        // mnfight = 0; myfight = 0;
 *             global.spelldelay = 10; // bmenuno = 0; charturn = 0;
 *
 * `scr_mnendturn` reopens the menu with no delay of its own, so the whole gap
 * is this one countdown. (`scr_wincombat` sets it to 15, but that is the
 * victory path, not a turn.)
 *
 * THIS WAS 20 — invented, and flagged as a stand-in in its own comment ever
 * since. The whole-fight diff caught it as soon as the oracle's menu column
 * read the right variable: the real menu is open on frame 1 and the sim's did
 * not appear until frame 20. It was the last invented timing constant in the
 * turn loop.
 */
const TURN_GAP = 1;



/**
 * obj_moveheart — the soul flying to the board. Create aims it and arms
 * `alarm[0] = flytime` (8); the alarm snaps it to the destination, creates
 * obj_heart there, and destroys itself. The burst at the launch point is
 * obj_heartburst, visual only.
 */
const moveheart = {
  name: 'obj_moveheart',
  create(e) {
    e.image_alpha = 0;
    e.image_speed = 0;
  },
  alarm: {
    0(e, state) {
      e.x = e.distx;
      e.y = e.disty;
      if (!state.soul) {
        state.soul = spawn(state, soul, { x: e.distx, y: e.disty });
      }
      e.alive = false;
    },
  },
};

/**
 * obj_battlecontroller's ONE translated Step line: `turntimer -= 1` during the
 * bullet phase. It gets its own entity because ORDER is the point — the
 * battle controller is created at fight start, before any knight object, so
 * its Step runs first and every attack reads the ALREADY-DECREMENTED clock.
 * The director (order 0) cannot host it: the cone steps at -1 and the stars
 * controller at -2, and both key transitions off `turntimer`. Measured at
 * whole-fight f241: the cone's release (all stars -> con 1, friction 0.5,
 * growth stops) fired one frame late with the decrement behind it.
 *
 * NOTE the phase within the frame: STEP, not Begin Step — GML alarms fire
 * before any Step event, so an alarm that read `turntimer` would see the
 * PRE-decrement value. Putting this in beginStep would break that.
 */
const turnClock = {
  name: 'turn_clock',
  stepOrder: -100,
  create(e) {},
  // END STEP, and the whole frame's ordering hangs on it. Three measured
  // constraints pin the decrement's slot:
  //
  //   * the knight's `scr_turntimer(240)` on the rtimer-12 frame ends that
  //     frame at 239 — the decrement runs AFTER the knight's Step;
  //   * the cone's star release reads the PRE-decrement clock: with the
  //     clocks aligned to the diag, the recording releases on the frame the
  //     previous frame's value crosses 120, not its own — the decrement runs
  //     AFTER the cone's Step too;
  //   * the heart's destruction fires on the POST-decrement value of the
  //     same frame (f327: 0.7 - 1 <= 0), inside the same controller block.
  //
  // A Step-phase decrement at order -100 satisfied only the third. All
  // steps, then the decrement: End Step.
  step(e, state) {
    // THE HEART DIES BEFORE ITS OWN STEP on the frame the clock expires.
    // The controller's block runs [decrement; if <= 0 destroy obj_heart] and
    // the controller steps BEFORE the per-turn heart — so on the expiry
    // frame the heart never runs, and the recording's inv column FREEZES on
    // the previous frame's value (-79 at f327, where the sim's soul stepped
    // once more and left -80). Read pre-decrement, `<= 1` here IS the
    // controller's post-decrement `<= 0`. The rest of the teardown stays in
    // the director's endStep, which sees the same expiry after the End-Step
    // decrement below.
    const d = e.director;
    if (d?.started && state.soul && state.turntimer <= 1 && state.turntimer > -900000) {
      state.soul.alive = false;
      state.soul = null;
    }
  },

  endStep(e, state) {
    // `clockOn` covers the WHOLE bullet phase, spawn delay included — the
    // controller decrements on every `mnfight == 2` frame, and the oracle's
    // diag shows the clock falling from the first rtimer frame (f77: 120 ->
    // 119) eleven frames before the attack exists. `started` alone began the
    // countdown at launch, which left the charge-up turn (whose 90 is set at
    // mnfight 1.5 and NEVER overridden at launch) twelve frames long.
    const d = e.director;
    if ((d?.started || d?.clockOn) && state.turntimer > 0) state.turntimer -= 1;
  },
};

/**
 * THE DRAW-PHASE RNG TAIL. The split organism consumes from the live stream
 * in its DRAW events: obj_knight_split_growtangle rolls four
 * irandom_range(-1,1) shakes (8 draws) every frame it exists, and every
 * living split tooth burns two random_range draws a frame. The per-attack
 * scenes strip these as a documented deviation (their oracles pin outcomes
 * instead), but the whole-fight runs the anchored stream LIVE — skipping
 * them desynced every roll after the first Flurry split (slash 2's xoffset
 * came out -3.53 against the recording's -4.0991321728). Runs at the end of
 * the frame, after all step-phase draws, which is where the Draw phase sits.
 */
const drawRngTail = {
  name: 'draw_rng_tail',
  stepOrder: 9999,
  create(e) {},
  endStep(e, state) {
    if (!state.gmlRng) return;
    let n = 0;
    for (const x of state.entities) {
      if (!x.alive) continue;
      // `(distance > 0) ? irandom_range(-1, 1) : 0` x4 — the shake only
      // rolls WHILE THE BOX IS SPLIT; a ternary's untaken arm draws nothing.
      if (x.type.name === 'obj_knight_split_growtangle' && (x.distance ?? 0) > 0) n += 8;
      else if (x.type.name === 'obj_roaringknight_split_bullet') n += 2;
    }
    for (let i = 0; i < n; i++) gmlRandom(state.gmlRng, 1);
  },
};

const director = {
  name: 'fight_director',

  create(e, state) {
    e.phase = 1;
    e.turn = 0;
    // `*downmessage` — one-shot per character per FIGHT, never cleared.
    state.downSeen = { kris: false, susie: false, ralsei: false };
    state.battlemsg = OPENING_MSG;
    e.owner = null;
    e.gap = TURN_GAP;
    e.started = false;
    e.clockOn = false;
    e.menuShown = false;
    e.soulHold = null;
    e.bar = null;
    e.barHold = 0;
    e.arenaOpen = false;
    e.spawnDelay = RTIMER_SPAWN;
    e.turnsRun = 0;
    e.elapsed = 0;
    e.drain = 0;
  },

  endStep(e, state) {
    // THE BATTLE MESSAGE'S TYPEWRITER CLOCK. obj_writer reveals one character
    // a frame (typer 4, rate 1); the renderer reads this timer and the sim
    // resets it whenever a new message is set, so text scrolls in rather than
    // popping whole — the writer is created fresh per message in the game.
    if (state.battlemsg !== e.lastBattlemsg) {
      e.lastBattlemsg = state.battlemsg;
      state.battlemsgTimer = 0;
    } else {
      state.battlemsgTimer = (state.battlemsgTimer ?? 0) + 1;
      // ...and the blip that goes with each character. Typer 4's sound is
      // `snd_text`; scr_textsound skips spaces and punctuation, so the line
      // ticks rather than rattles. Held X mutes it, as it does the typing.
      if (state.battlemsg
        && textSoundChar(state.battlemsg, state.battlemsgTimer)
        && !state.input?.focus) {
        cue(state, 'snd_text', 1, 1);
      }
    }

    // THE FIGHT IS LOST when all three are down. The real game goes to its
    // Game Over screen; here the run simply stops and the HUD says so, which
    // is the honest stand-in — the retry flow is turn-system machinery.
    if (!state.gameOver && partyWiped(state)) {
      state.gameOver = true;
      state.menu.open = false;
    }
    if (state.gameOver) return;

    // THE DYING BAR, fading over the start of the enemy phase. The object
    // outlives the turn handoff by 13 frames (`fadeamt += 0.08` past 1), and
    // its Draw keeps running whole — boltx counts on through the fade. Stepped
    // here, outside the turn machinery, because the turn has already moved on.
    if (e.fadingBar) {
      stepFightBar(e.fadingBar, !!state.input?.confirm);
      e.fadingBar.fadeamt = (e.fadingBar.fadeamt ?? 0) + 0.08;
      state.fightBar = e.fadingBar;
      if (e.fadingBar.fadeamt > 1) {
        e.fadingBar = null;
        state.fightBar = null;
      }
    }

    // The menu runs in sim/, not the renderer: it is state the player drives
    // and it must be reproducible headlessly like everything else.
    stepMenu(state, state.input ?? {});
    // obj_heroparent's Step, for all three. Runs every frame including the
    // bullet phase — the party keeps their pose while you dodge, which is how
    // a chosen DEFEND stays visibly held for the whole enemy turn.
    stepHeroes(state);
    // obj_knight_enemy's reaction timers — hurt strobe, shake, block vfx.
    stepKnightAnim(state);
    // obj_dmgwriter's Draw, for every live number. It consumes randomness
    // (`vspeed = -5 - random(2)`), so it draws from the sim's generator and a
    // replayed seed replays the same arcs.
    stepDmgNumbers(state, () => rngNext(state.rng));
    // obj_healwriter has no delay and no RNG — it rises and fades on its own.
    stepHealWriters(state);
    stepAttackVfx(state);
    // obj_rudebuster_anim + obj_rudebuster_bolt. The press is an EDGE, and it
    // is the same button that confirms in the menu — but the menu is closed
    // while the bolt is in flight, so they cannot collide.
    const rudePress = !!state.input?.confirm && !e.rudeHeld;
    e.rudeHeld = !!state.input?.confirm;
    stepRudeBuster(state, rudePress);

    // THE FIGHT'S END. `haveusedroaring && hp <= maxhp * 0.8` — both, and only
    // then. `end_cutscene_version > 0` makes obj_battlecontroller's Draw, the
    // tension bar's and obj_attackpress's all exit on their first line, so the
    // whole battle UI goes at once.
    // `global.batmusic[1] = mus_loop_ext(global.batmusic[0], ...)` in
    // obj_battlecontroller's Create — the fight's track LOOPS for the whole
    // battle. `knight.ogg`, set as batmusic[0] by the room.
    if (!e.musicStarted) {
      e.musicStarted = true;
      cueLoop(state, 'mus_knight');
    }

    // ENDLESS never reaches the ending — that is the mode's entire promise.
    // The fight wraps back to phase 1 instead, and the Knight's HP resets so
    // the 5840 gate can be crossed again rather than sitting permanently open.
    if (state.runMode === 'endless' && endCutsceneReached(state)) {
      state.knight.hp = KNIGHT_MAXHP;
      state.knight.haveusedroaring = false;
      e.phase = 1;
      e.turn = 0;
      e.turnsRun = 0;
    } else if (endCutsceneReached(state)) {
      startEndCutscene(state);
      state.menu.open = false;
      state.fightBar = null;
      e.bar = null;
    }
    // The ending's own clock: the white fadeout at 32, the UI teardown and
    // the tension bar's exit past 45. See stepEndCutscene.
    stepEndCutscene(state);

    // THE BOARD AND THE SOUL ONLY EXIST DURING THE BULLET PHASE.
    //
    // `obj_battlecontroller`'s Alarm 11 destroys both together —
    // `with (obj_heart) instance_destroy(); with (obj_growtangle)
    // instance_destroy();` — and obj_knight_enemy's Step recreates the board
    // per attack, at that attack's own coordinates:
    //
    //     if (!instance_exists(obj_growtangle))
    //         instance_create(xview + 320 - 152, yview + 170, obj_growtangle);
    //
    // So during the command phase there is no arena at all: the party stand in
    // front of the Knight with nothing between them. This build kept the box
    // on screen the whole time, which made the menu look like it was floating
    // over a live fight.
    //
    // Hidden rather than destroyed, because several translated attacks read the
    // box's geometry in their Create and a genuinely absent one would need each
    // of them re-checked. The visible behaviour is the same; the deviation is
    // recorded here rather than left implicit.
    // DERIVED FROM `arenaOpen`, NOT `started`. `e.started` is assigned at the
    // BOTTOM of this event and read here at the top, so on the frame an attack
    // launches this line saw the previous value and the board blinked out for
    // exactly one frame, mid-grow, every single turn.
    //
    // `arenaOpen` is set where the board's life actually changes — when
    // openArena runs, and cleared when the turn ends — so it cannot lag.
    state.boardVisible = !!e.arenaOpen;

    // THE BOARD'S WALLS LIVE AND DIE WITH THE BOARD.
    //
    // `obj_growtangle`'s parent is `obj_battlesolid`, so the box IS the wall —
    // and the Knight only creates it in his `mnfight == 1.5` setup, after the
    // party has finished acting. During the party's menu there is no board at
    // all, and the soul is not enclosed by anything.
    //
    // This scene spawns one board at build and keeps it for the whole fight,
    // which is fine for drawing but was walling the soul in during a phase
    // where the real one is free: the whole-fight diff is exact to frame 15
    // and then the oracle's soul travels on through 378, 382, 386 while the
    // sim's stops dead at 374 — the wall rest position for a box at (320,170)
    // scale 2.
    //
    // Clearing `isSolid` rather than destroying the instance keeps openArena's
    // lookup and the grow-in animation intact; the collision phase filters on
    // `alive && isSolid && mask`, so a board that is not open is not a wall.
    const gtSolid = state.entities.find(
      (x) => x.alive && x.type.name === 'obj_growtangle',
    );
    if (gtSolid) gtSolid.isSolid = !!e.arenaOpen;
    if (state.menu.open && state.soul) {
      if (e.soulHold) {
        state.soul.x = e.soulHold.x;
        state.soul.y = e.soulHold.y;
      } else {
        e.soulHold = { x: state.soul.x, y: state.soul.y };
      }
    } else {
      e.soulHold = null;
    }

    // global.turntimer's decrement lives in `turnClock` (stepOrder -100), not
    // here: obj_battlecontroller is the oldest instance in the room, so its
    // Step — the decrement — runs BEFORE every knight object's. The director
    // sits at order 0, AFTER the cone's -1, and decrementing from here made
    // the cone read yesterday's clock: its star release (`turntimer <=
    // endtimer`) fired at whole-fight f242 where the recording fires at f241.

    const entry = FIGHT_TABLE[e.phase][e.turn];
    state.phase = `phase ${e.phase} · turn ${e.turn + 1} · ${entry.name}`;
    // Numeric, for the wide trace — a diff should point at a turn, not at prose.
    state.phaseNum = e.phase;
    state.turnNum = e.turn;

    if (e.started) {
      e.elapsed += 1;

      // WHEN IS A TURN OVER? Not "the manager died" — several managers never
      // destroy themselves. Stars' controller just sets `init = 3` and sits
      // there once the clock passes its endtimer, so waiting on it hangs the
      // fight forever (it did, for 12,000 frames).
      //
      // The clock is the real signal, as it is in the game: attacks stop
      // spawning on `turntimer`, and the turn ends once the last bullet they
      // launched has cleared. A manager that DOES tear itself down early ends
      // the turn early too.
      // THE CLOCK IS THE WHOLE RULE — obj_battlecontroller's Step:
      //
      //     if (global.mnfight == 2 && timeron == 1) {
      //         global.turntimer -= 1;
      //         if (global.turntimer <= 0 && reset == 0) {
      //             with (obj_bulletparent) instance_destroy();   // sweep NOW
      //             with (obj_heart) { instance_create(x, y, obj_returnheart);
      //                                instance_destroy(); }      // soul NOW
      //             reset = 1;
      //             if (noreturn == 0) alarm[2] = 15;             // then wait
      //
      // No drain, no waiting for bullets to leave, no manager-death shortcut
      // — the sweep lands ON the frame the clock reaches zero, with whatever
      // is still flying (the anchor recording drops 33 live bullets and the
      // soul on f345 exactly). The sim's old grace period held the soul for
      // eleven extra frames every turn, which shifted every later turn's
      // menus, bars and attacks — the f345/f357 group in the triage map.
      // The controller's own form: `turntimer <= 0` tested right after its
      // decrement. This endStep runs AFTER turnClock's (stepOrder -100
      // orders End Steps too), so the value here IS the post-decrement one.
      const finished = state.turntimer <= 0;
      if (!finished) return;

      e.started = false;
      e.clockOn = false;
      e.balloonDone = false;
      e.arenaOpen = false;
      // THE SOUL DOES NOT SURVIVE THE TURN. obj_heart is created per bullet
      // phase and gone by the menu — see the arena-open block below.
      if (state.soul) {
        state.soul.alive = false;
        state.soul = null;
      }
      // `alarm[2] = 15` — the beat between the sweep and anything else
      // appearing. The recording tears down on f345 and shows its first
      // post-turn state on f360, fifteen frames later, exactly the alarm the
      // battle controller arms next to the sweep. TURN_GAP (the one-frame
      // myfightreturntimer) still applies after it inside the menu flow.
      e.gap = 15;
      e.spawnDelay = RTIMER_SPAWN;
      e.turnsRun += 1;
      clearTurn(state);

      // THE FLAVOUR LINE, set at the END of a turn — the same block that
      // holds the phase-4 gate:
      //
      //     if (global.mnfight == 2 && global.turntimer <= 1
      //         && setdownmessage == false) { ... turns += 1;
      //         if (phase == 1) { if (phaseturn == 0) battlemsg[0] = "..."; }
      //
      // It is written here, not when the menu opens, because the message for
      // a phase's turn 0 is the line that plays as the fight CROSSES INTO
      // that phase — phase 1's last turn has already done `phase = 2;
      // phaseturn = 0` by the time this runs. See sim/battlemsg.js.
      //
      // `global.battlemsg[0]` is never cleared between turns, so a null here
      // leaves the previous line up rather than blanking the box.
      {
        // PHASE4TURN IS 1-BASED AND THIS PASSED THE 0-BASED ROW INDEX.
        // `phase4turn++` runs at the top of the selector, so the turn that
        // launches ROARING reads 3 — while the sim's phase-4 rows are 0/1/2.
        // Every phase-4 line therefore arrived one turn late, and the value
        // 3 was never reached at all, which is where the NO-DAMAGE line
        // lives:
        //
        //     if (phase4turn == 3 && progamer == true)
        //         "* Kris coughed.&* The enemy slowly tilted its head..."
        //
        // so a flawless run could not produce it. Reported from play.
        //
        // Three cases, in the game's own order:
        //
        //  * THE GATE TRIPS. `if (hp <= maxhp * 0.8 ...) phase = 4;` sits
        //    directly ABOVE the message block, so the turn that opens phase
        //    4 already reads as phase 4 with `phase4turn` still 0 — the
        //    entry line, "Your heartbeat becomes twisted."
        //  * INSIDE PHASE 4. Row index + 1.
        //  * AFTER ROARING. The counter FREEZES at 3 (Other_10 only
        //    increments it inside `if (phase == 4)`) while `haveusedroaring`
        //    keeps the block alive, so the guard-drop line — or the progamer
        //    line — stays up for every remaining turn. That is the fight
        //    telling you to swing.
        const gateTrips = state.runMode !== 'endless' && e.phase !== 4
          && phase4Reached(state) && !state.knight?.haveusedroaring;
        let p4;
        if (gateTrips) p4 = 0;
        else if (e.phase === 4) p4 = e.turn + 1;
        else if (state.knight?.haveusedroaring) p4 = 3;

        const msg = battleMsgFor(e.phase, state.phaseturn ?? 0, {
          phase4turn: p4,
          partyHp: state.partyHp,
          haveusedroaring: state.knight?.haveusedroaring,
          progamer: state.knight?.progamer,
          downSeen: state.downSeen,
        });
        if (msg) state.battlemsg = msg;
      }

      const prevPhase = e.phase;
      const prevTurn = e.turn;
      const nx = nextTurn(e.phase, e.turn);
      e.phase = nx.phase;
      e.turn = nx.turn;

      // ROARING DOES NOT REWIND THE SCHEDULE. The selector's first line is
      //
      //     if (phase != 4) { turn++; phaseturn++; }
      //
      // so `phaseturn` FREEZES while phase 4 runs, and the ROARING branch
      // sets `phase = 3` without touching it — the fight resumes phase 3's
      // table at the position the HP gate interrupted, one turn on. (The
      // frozen counter can even come from phase 1 or 2: it is reinterpreted
      // against phase 3's rows.) Restarting the loop at Stars here was why
      // Flurry difficulty 3 — phase 3's second row — could effectively never
      // be seen: the fight ends on the first hit after ROARING, which usually
      // lands during that always-first Stars turn. Reported from play.
      if (prevPhase === 4 && prevTurn === 2) {
        e.turn = e.resumeTurn ?? 0;
      }

      // PHASE 4 IS ENTERED ON HP < 80%, and now that the Knight has real HP
      // that is the trigger rather than a turn count.
      //
      // 5840 had been a spec number with no dump source. It has one now, from
      // an unrelated place: obj_bgfountaintest computes
      //
      //     battleprog = 1 - (((monsterhp - maxhp * 0.8) / maxhp) * 5)
      //
      // which is 0 at full HP and exactly 1 at `maxhp * 0.8` = 5840. The
      // background is fully lit at the instant phase 4 opens, which is not a
      // coincidence — it is the same threshold.
      //
      // The turn-count fallback stays as a floor so a player who never
      // attacks still reaches the finale rather than looping phase 3 forever.
      // ENDLESS skips phase 4 entirely and keeps looping phase 3, since
      // phase 4 is the run-ending sequence.
      // `rotatingslash3used` is set by PHASE 3's TURN 5 and only that one. It
      // decides whether phase 4 opens on the rotating slash or skips straight
      // to the charge-up, so it has to be latched where that turn ends.
      if (prevPhase === 3 && prevTurn === 4) state.knight.rotatingslash3used = true;

      // THE PHASE-4 GATE FIRES AT THE END OF ANY TURN, from the knight's Step:
      //
      //     if (global.mnfight == 2 && global.turntimer <= 1
      //         && setdownmessage == false) {
      //         setdownmessage = true;
      //         if (global.monsterhp[myself] <= (global.monstermaxhp[myself] * 0.8)
      //             && haveusedroaring == false && phase != 4)
      //             phase = 4;
      //
      // Not at a phase boundary — at EVERY turn's end. This used to test
      // `e.phase === 3 && e.turn === 0`, so a party that burned the Knight to
      // 5840 during phase 1 or 2 kept playing the rest of the script and only
      // entered phase 4 when phase 3 next came round to its first turn. The
      // whole point of an HP gate is that it can cut the script short.
      //
      // `haveusedroaring == false` is what keeps it one-shot: after ROARING
      // the fight drops back into the phase-3 loop with HP still under the
      // threshold, and without that term it would re-enter phase 4 forever.
      //
      // THE TURN-COUNT FALLBACK IS GONE. `e.turnsRun >= 15` forced the finale
      // on a player who never attacked; the real fight simply loops phase 3
      // until someone does enough damage, and inventing an ending is exactly
      // what the project's rules forbid. ENDLESS still skips the gate, which
      // is that mode's stated purpose rather than a claim about the fight.
      if (state.runMode !== 'endless' && e.phase !== 4
        && phase4Reached(state) && !state.knight.haveusedroaring) {
        e.phase = 4;
        e.turn = phase4Entry(state.knight.rotatingslash3used);
        // The position the gate is interrupting — the natural next turn's
        // index, which is exactly frozen-phaseturn + 1 read against phase 3's
        // table (a phase's LAST turn has already reset phaseturn to 0 at
        // selection, and nx.turn is 0 there too).
        e.resumeTurn = nx.turn;
      }
      return;
    }

    e.gap -= 1;
    if (e.gap > 0) return;

    // THE MENU COMES FIRST. A turn in the real fight is: each of the three
    // party members picks from their button row, and only when the last one
    // confirms does the enemy attack. The gap above is the beat before the
    // panels rise.
    if (state.dialogue.text) {
      // X HELD JUMPS THE TYPING TO THE END. obj_writer's Draw:
      //
      //     if (halt == 0 && button2 == 1 && pos < length && skippable == 1)
      //         skipme = 1;
      //     if (skipme == 1) { pos = string_length(mystring) + 1; ... }
      //
      // so it is not a faster crawl, it is the whole line at once.
      if (state.input?.focus) {
        state.dialogue.timer = Math.max(
          state.dialogue.timer, dialogueSkipTimer(state.dialogue.text));
      }
      state.dialogue.timer += 1;
      // THE BALLOON'S VOICE IS snd_txtsus FOR BOTH SPEAKERS, and the previous
      // reading of this was wrong in a way that is audible.
      //
      // The enemy-talk block opens with `global.typer = 81` — the TV-static
      // voice — and that is where the last pass stopped reading. Both balloon
      // creations OVERWRITE it before any writer exists:
      //
      //     global.typer = 81;                       // line 110, and then
      //     ...
      //     if (createballoon) { global.typer = 75;  // the Knight's line
      //                          scr_enemyblcon(susie.x + 92, ...); }
      //     ...
      //     global.typer = 75;                       // Susie's reply
      //     scr_enemyblcon(susie.x + 92, ...);
      //
      // `scr_enemyblcon` is what creates obj_writer, and it reads the typer at
      // that moment — 75 both times. So 81 is a DEAD ASSIGNMENT here, another
      // `linex`, and giving the Knight's lines the television voice put
      // Tenna's blurb on half the exchange. Both balloons are anchored over
      // SUSIE's head (`obj_herosusie.x + 92`), so to anyone watching it read
      // as Susie occasionally speaking in someone else's voice — which is
      // exactly how it was reported.
      if (!state.input?.focus
        && textSoundChar(state.dialogue.text, state.dialogue.timer)) {
        cue(state, 'snd_txtsus', 1, 1);
      }
      const done = dialogueDone(state.dialogue.text, state.dialogue.timer);

      // TWO BUTTONS ADVANCE THIS, and only one of them was wired up.
      //
      // The knight's own Step takes C: `(button3_p() && talktimer > 15)`.
      // But the SAME condition's other arm is `|| !i_ex(obj_writer)`, and
      // the writer dismisses ITSELF on Z once the line has finished typing:
      //
      //     if (halt != 0 && button1 == 1 && siner > 0) { ... instance_destroy(); }
      //
      // (`button1_p()` is Z or Enter; `button3_p()` is C or Ctrl — the
      // default control map, input_k[4] and input_k[6].) So Z really does
      // advance the exchange in the real game, one indirection away, and
      // modelling only the C arm left the tool's own confirm key dead here —
      // reported from play as the dialogue not being skippable with Z.
      const cPress = !!state.input?.button3 && !e.talkHeld;
      e.talkHeld = !!state.input?.button3;
      const zPress = !!state.input?.confirm && !e.talkConfirmHeld;
      e.talkConfirmHeld = !!state.input?.confirm;

      if (globalThis.process?.env?.KNIGHT_TALK_DEBUG) {
        console.error(`[talk] f=${globalThis.__simFrame} spk=${state.dialogue.speaker}`
          + ` timer=${state.dialogue.timer} done=${done} c=${cPress ? 1 : 0} z=${zPress ? 1 : 0}`);
      }
      if ((cPress && state.dialogue.timer > 15)
        || (zPress && done)
        || (done && state.dialogue.timer > 90)) {
        if (state.dialogue.speaker === 'knight') advanceReply(state.dialogue);
        else clearDialogue(state.dialogue);
        // The press that dismissed this line must not also eat the next one
        // (the writer's `prevent_mash_buffer`, and the held-across-a-
        // transition rule this project keeps relearning).
        e.talkConfirmHeld = true;
        e.talkHeld = true;
      }
      return;
    }

    if (!e.menuShown) {
      e.menuShown = true;
      // `for (__hiti...) global.hittarget[__hiti] = 0;` — scr_attackphase
      // clears the stack so each turn's numbers start at the bottom again.
      resetDmgStack(state);
      openMenu(state);
      // PROCESS THIS FRAME'S INPUT TOO. `stepMenu` runs earlier in the same
      // endStep (see above), when the menu was still closed and it did
      // nothing — so without this the menu opens at the end of frame N and
      // first sees input on frame N+1, losing a frame the game does not.
      //
      // obj_battlecontroller opens and reads the menu in the SAME Step, so a
      // confirm held on the opening frame is acted on immediately. The
      // whole-fight diff showed the cost: the oracle had already advanced
      // charturn and banked DEFEND's 40 TP before its frame 1, while the sim
      // took until frame 3.
      //
      // Safe to call twice in one frame: the earlier call was a no-op with
      // the menu closed, so this processes the frame's input exactly once.
      stepMenu(state, state.input ?? {});
      return;
    }
    if (state.menu.open) return;

    // `scr_endturn()` — COMMIT. The last character's snapshot becomes the real
    // inventory and all three resync to it. Until this runs, everything spent
    // this turn is still recoverable with cancel.
    if (state.menu.needsCommit) {
      endTurnItems(state);
      state.menu.needsCommit = false;
    }

    // ---- THE RESOLVE PHASE: obj_attackpress ---------------------------------
    //
    // Its Create and Draw define the whole order, and this build had two parts
    // of it wrong.
    //
    //     Create:  for each char with charaction 4 (item) or 2 (spell):
    //                  if (maxdelay == 0) maxdelay = 25;
    //                  maxdelay += 15;
    //     Draw:    maxdelaytimer += 1;
    //              at maxdelaytimer == spelldelay[xyz] -> that character's
    //                  state = 4 or 2, i.e. their animation STARTS
    //              if (maxdelaytimer >= maxdelay) active = 1;   // bolts run
    //
    // So the bar EXISTS from the moment the menu closes but sits inactive
    // while the spells and items play out. Rude Buster happens first, the
    // bolts come after — which is the order you actually see.
    if (state.menu.fight.some(Boolean) && !e.bar) {
      const order = [0, 1, 2].filter((c) => state.menu.fight[c] && isUp(state, c));
      // The schedule is RANDOM, so the bar draws from the sim's generator —
      // which also means a replayed seed replays the same bolt pattern.
      if (order.length) {
        // Replay the oracle's schedule when one was supplied — see
        // sim/fightbar.js. Consumed in creation order, one per bar.
        const rec = state.boltSchedules?.[state.boltIndex];
        if (rec) state.boltIndex += 1;
        e.bar = createFightBar(state.rng, order, true, rec);
      }
      e.resolved = [false, false, false];
      // Swings whose damage has not landed yet — see the finishattacktimer
      // block below.
      e.pendingSwing = [];
    }

    // `maxdelay` — 0 with no spells or items, otherwise 25 + 15 per caster.
    if (e.maxdelay === undefined) {
      // `for each char with charaction 4 (ITEM) or 2 (SPELL)` — obj_attackpress's
      // Create counts BOTH, so a turn with two items holds the bar exactly as
      // long as a turn with two spells.
      const casters = [0, 1, 2].filter(
        (c) => state.pendingSpell?.[c] || state.pendingItem?.[c],
      ).length;
      e.maxdelay = casters ? 25 + 15 * casters : 0;
      e.maxdelaytimer = 0;
      // `spelldelay[xyz]` defaults to 10 for all three, so the first caster's
      // animation starts ten frames in and the rest follow at the same offset
      // — they overlap, which is why a two-spell turn does not take twice as
      // long as a one-spell turn.
      e.spellFired = [false, false, false];
    }

    if (e.maxdelaytimer < e.maxdelay) {
      e.maxdelaytimer += 1;
      for (let c = 0; c < 3; c++) {
        if (e.spellFired[c] || e.maxdelaytimer < 10) continue;
        const p = state.pendingSpell?.[c];
        const it = state.pendingItem?.[c];
        if (p) {
          e.spellFired[c] = true;
          heroAct(state, c, HERO_SPELL);
          castSpell(state, c, p.id, p.target, { alreadyPaid: true });
        } else if (it) {
          // THE ITEM LANDS HERE, not when it was chosen. `state = 4` and the
          // effect both fire at `maxdelaytimer == spelldelay[c]`, so a Revive
          // used this turn cannot give that character a turn — by the time it
          // resolves the command phase is over.
          e.spellFired[c] = true;
          heroAct(state, c, HERO_ITEM);
          applyItem(state, it.id, it.target);
        }
      }
      return;
    }
    // Everything queued has fired; the bolt may still be flying.
    if (rudeBusterBusy(state)) return;
    if (state.pendingSpell) state.pendingSpell = [];
    if (state.pendingItem) state.pendingItem = [];

    if (e.bar) {
      // STEPPED EVERY FRAME THE OBJECT EXISTS, done or not. obj_attackpress
      // has no such gate: `boltx += 1`, the pressbuffer decrements, imagetimer
      // and the burstbolt Steps all keep running straight through the
      // post-bolt hold, and a press after the last bolt still calls
      // scr_boltcheck_onebutton — it finds nothing alive and only flashes the
      // window. Freezing the bar at `done` held `boltx` at its last value,
      // which the whole-fight diff caught at frame 38: oracle 31, sim stuck
      // on 30 for the rest of the hold.
      //
      // ONE BUTTON, edge-triggered. A single press scans every live bolt and
      // scores the nearest, so the director hands it one boolean.
      stepFightBar(e.bar, !!state.input?.confirm);
      state.fightBar = e.bar;

      // EACH CHARACTER SWINGS AS THEIR OWN BOLT CLEARS, not all together at
      // the end. obj_attackpress fires `event_user(1)` per character the frame
      // `boltcount[i]` hits zero:
      //
      //     if (boltcount[i] == 0 && havechar[i] == 1 && attacked[i] == 0)
      //         { attacked[i] = 1; target = i; event_user(1); }
      //
      // `stepFightBar` already latches `attacked[i]` for exactly this. Scoring
      // the whole party at once made three characters swing on one frame with
      // one shared animation length, when their attack sprites are 6, 6 and 4
      // frames and their bolts land at different times.
      // THE SWING STARTS NOW; THE DAMAGE LANDS ELEVEN FRAMES LATER.
      //
      // obj_heroparent, state 1, first frame (`attacked == 0`):
      //
      //     attacked = 1;
      //     finishattacktimer = 11;
      //
      // and the damage block lives in its Other_10, gated on that timer
      // counting OUT — `if (finishattacktimer > 0) { finishattacktimer--;
      // if (finishattacktimer == 0) { ...scr_damage_enemy, the writer, the
      // TP... } }`. So the pipeline is: bolts exhausted -> event_user(1) ->
      // state 1 -> eleven frames of swing -> the hit lands, all of it at once.
      //
      // This used to resolve EVERYTHING on the latch frame, and the fresh
      // whole-fight recording caught it as the FIRST divergence of the run:
      // frame 25, sim tension 47 / knight 7288 while the oracle held 40 /
      // 7300 — and then landed the identical +7 TP and -12 HP at frame 36,
      // eleven frames later. The player's report was the same fact from the
      // outside: "after you attack it feels like it is incorrect".
      // `attacked[]` arrives ONE CHARACTER PER FRAME — obj_attackpress's
      // shared-`i` quirk, implemented and documented at the latch in
      // sim/fightbar.js — so this loop starts at most one swing a frame
      // without any pacing of its own.
      for (let c = 0; c < 3; c++) {
        if (!e.bar.attacked[c] || e.resolved[c]) continue;
        e.resolved[c] = true;
        const acc = e.bar.points[c];
        heroAct(state, c, HERO_ATTACK);
        // `if (points == 150) { snd_stop(snd_criticalswing); snd_play(...); }`
        // — obj_heroparent's FIRST state-1 frame, i.e. the swing's start, not
        // its connect. The sound leads the damage by the same eleven frames.
        if (acc === 150) {
          cueStop(state, 'snd_criticalswing');
          cue(state, 'snd_criticalswing');
        }
        e.pendingSwing.push({ at: state.frame + 11, c, points: acc, done: false });
      }
      for (const s of e.pendingSwing) {
        if (s.done || state.frame < s.at) continue;
        s.done = true;
        if (s.points <= 0) {
          // A missed bolt still writes a number — `scr_damage_enemy` creates
          // the writer before the `arg1 > 0` test, and a zero draws MISS.
          spawnDmgNumber(state, KNIGHT.x, KNIGHT.ystart + 40, 0, s.c);
          continue;
        }
        const dealt = fightDamage(state, s.c, s.points);
        if (dealt > 0) {
          damageKnight(state, dealt);
          scrTensionheal(state, fightTp(s.points));
          spawnImpact(state, KNIGHT.x, KNIGHT.ystart + 40, s.c, s.points === 150,
            () => rngNext(state.rng));
        }
        spawnDmgNumber(state, KNIGHT.x, KNIGHT.ystart + 40, dealt, s.c);
      }

      if (!e.bar.done) return;

      // `posttimer` runs to `timermax` and the black fade takes 13 more
      // frames. That hold is where the attack animations actually play out.
      //
      // AND THE BAR IS WHAT ENDS THEM. At `posttimer > timermax` — the moment
      // the fade starts, not when it finishes — obj_attackpress reaches
      // through and resets everyone:
      //
      //     if (posttimer > timermax) {
      //         fade = 1;
      //         with (obj_heroparent) {
      //             if (state == 1) state = 0;
      //             attacked = 0;
      //             itemed = 0;
      //         }
      //         ...
      //         global.mnfight = 1;
      //         global.myfight = -1;
      //     }
      //
      // Without it a character who attacked stays in state 1 — frozen on the
      // last frame of their swing — until something else happens to reset
      // them. Reported as "Susie's animation stops on one sprite for a bit",
      // and that is exactly what it is: the pose held for the whole 63-frame
      // hold because nothing ended it.
      //
      // `state == 1` is tested specifically, so a character mid-ITEM or
      // mid-SPELL is left alone; only the attack pose is cut.
      // `posttimer > timermax`, counted by the bar itself — see stepFightBar.
      if (!e.bar.holdDone) return;

      // `posttimer > timermax` — and the SAME block that starts the fade also
      // sets `global.mnfight = 1; global.myfight = -1;`. THE TURN ADVANCES
      // THE MOMENT THE FADE STARTS, not thirteen frames later when the object
      // dies: the enemy-talk phase begins UNDER the black fade, which is why
      // the flavour text is already up as the bar dissolves.
      //
      // Waiting out the fade too put the sim a fixed 13 frames behind at
      // every turn boundary — the whole-fight diff caught it at frame 88,
      // where the oracle's `turn` and its DR ramp both moved while the sim
      // was still fading. The dying bar is handed to `e.fadingBar`, which the
      // top of endStep keeps stepping (boltx counts through the fade — the
      // increment is inside `if (active)` with nothing else gating it) while
      // the turn machinery moves on below.
      for (const h of state.heroes ?? []) {
        if (h.state === HERO_ATTACK) h.state = HERO_IDLE;
        h.attacked = false;
        h.itemed = false;
      }
      // `fade = 1` — the bar paints a black rectangle over itself for the
      // next 13 frames rather than vanishing. See render/fightbar.js.
      e.bar.fade = true;
      // `fadeamt += 0.08` runs in the SAME Draw that set `fade = 1`, so the
      // first faded frame is already at 0.08 — and the object dies the frame
      // fadeamt passes 1, thirteen v-frames total. Starting from 0 kept the
      // sim's bar alive one frame past the oracle's.
      e.bar.fadeamt = 0.08;
      e.fadingBar = e.bar;
      e.barHold = 0;
      e.bar = null;
      state.menu.fight = [false, false, false];
      e.maxdelay = undefined;
      // `global.mnfight = 1` is assigned HERE, in the bar's Draw — but the
      // knight's enemy-talk branch reads it in his STEP, which runs next
      // frame. Returning gives the handoff that one-frame lag: the next call
      // finds `e.bar` empty and falls through to the enemy phase, which is
      // where the oracle's turn column moves.
      return;
    }
    e.maxdelay = undefined;

    // ---- ENEMY TALK, and it belongs HERE, not before the menu ------------
    //
    // The phase order is `myfight 0` (the party's menu) -> the attack bar ->
    // `mnfight 1` (enemytalk) -> `mnfight 1.5` (setup) -> `mnfight 2`
    // (bullets). obj_attackpress sets `global.mnfight = 1` when the bar
    // finishes, and only THEN does the Knight's talk branch run:
    //
    //     if (scr_isphase("enemytalk") && talked == 0 && ...) {
    //         ...
    //         if (global.hp[2] > 0) balloonturn++;
    //
    // This ran before the menu, so the sim's `balloonturn` was one turn ahead
    // of the game's for the whole fight — the whole-fight diff caught it on
    // frame 1 as `oracle 0 / sim 1`.
    //
    // `balloonturn++` sits inside `if (global.hp[2] > 0)`, so a downed Susie
    // freezes the exchange where it stands rather than skipping ahead — she
    // is the one being talked to.
    if (!e.balloonDone) {
      e.balloonDone = true;
      // `scr_randomtarget()` — the FIRST line of the talk block, and it
      // CONSUMES: `mytarget = choose(0, 1, 2)`, one draw, then re-draws while
      // the picked slot has `charcantarget == 0`. The sim skipped it, so from
      // the first enemy phase onward its gmlRng stream ran one draw ahead of
      // the game's — and the first place that showed was the first star's
      // speed, 2px of drift per frame at whole-fight frame 145. The chapter-3
      // tail sets mytarget = 4 with no further draws; only the choose()s
      // touch the stream, so only they are reproduced.
      if (state.gmlRng) {
        let t = gmlChoose(state.gmlRng, [0, 1, 2]);
        const anyUp = [0, 1, 2].some((c) => isUp(state, c));
        if (anyUp) {
          while (!isUp(state, t)) t = gmlChoose(state.gmlRng, [0, 1, 2]);
        }
      }
      advanceBalloon(state.dialogue, state);
    }
    if (state.dialogue.text) return;

    // `rtimer` — the arena is up and EMPTY for 12 frames before the attack
    // spawns. That beat is what makes the board's arrival readable, and it is
    // the one inter-turn buffer the dump states outright.
    //
    // THE BOARD GROWS IN HERE, rather than blinking on. `obj_growtangle`'s
    // Step already models it — `growcon 1` ramps `timer` 0 -> `maxtimer` (15)
    // with the scale, the 180-degree spin and the alpha all derived from
    // `timer / maxtimer`. It was only ever used at scene build; the turn loop
    // hid and unhid a fully-grown box instead, which is why the arena
    // appeared out of nowhere.
    //
    // Safe to animate here precisely BECAUSE the arena is empty: CLAUDE.md
    // warns that mid-grow collision runs against a rotating fractional-scale
    // mask that this project has never pinned against an oracle, and during
    // these 12 frames there is nothing to collide with.
    if (e.spawnDelay > 0) {
      if (e.spawnDelay === RTIMER_SPAWN) {
        // `damagereduction += 0.01`, HERE and not after the party's turn.
        //
        //     if (global.mnfight == 1.5 && end_cutscene_version == 0) {
        //         if (!instance_exists(obj_growtangle)) {
        //             event_user(0);
        //             setdownmessage = false;
        //             if (damagereduction >= 0.2 && damagereduction < 0.35)
        //                 damagereduction += 0.01;
        //
        // It sits in the Knight's attack SETUP — the same block that creates
        // the board and runs the selector — so it applies before the FIRST
        // attack, not after the first party turn. The oracle reads 0.21 on
        // frame 1 of turn 1; the sim read 0.20 for the whole of turn 1 and
        // was one ramp step behind for the rest of the fight.
        // THE KNIGHT DELIVERS THE SOUL, in this same setup block:
        //
        //     if (!instance_exists(obj_moveheart) && !i_ex(obj_heart)
        //         && myattackchoice != -1)
        //         scr_moveheart();
        //
        //     function scr_moveheart() {
        //         global.inv = 0;
        //         return instance_create(obj_herokris.x + 10,
        //                                obj_herokris.y + 40, obj_moveheart);
        //     }
        //
        // scr_moveheart does NOT create the soul — it launches an
        // `obj_moveheart` from Kris that flies to the box and creates
        // obj_heart on landing, resetting `global.inv = 0` on the way.
        //
        // So there is no soul during the party's menu at all. This scene kept
        // one alive for the whole fight and froze it while the menu was open,
        // which the whole-fight diff caught: the oracle's soul was gone and
        // the sim's sat at a fixed position.
        //
        // `myattackchoice != -1` MEANS THE CHARGE-UP TURN GETS NO SOUL —
        // no board, no bullets, no soul. Independent confirmation of the
        // phase-4 charge-up finding, from a completely different line.
        //
        // The flight itself is not modelled yet; the soul appears at its
        // landing spot. That is a renderer gap, not a sim one.
        advanceTurn(state);
        // `phaseturn++` — the SELECTOR's own first line, which is GUARDED:
        // `if (phase != 4) { turn++; phaseturn++; }`. So the counter FREEZES
        // through phase 4 and resumes after ROARING. For phases 1-3 the live
        // value is the row index + 1 (identical to the old increment in every
        // normal-flow case, and correct on the post-ROARING resume turn,
        // where the increment had accumulated through phase 4).
        state.phaseturn = e.phase === 4 ? (state.phaseturn ?? 0) : e.turn + 1;
        const upcoming = FIGHT_TABLE[e.phase][e.turn];
        // The mnfight 1.5 -> 2 transition's own `scr_turntimer(90)` — a
        // FLOOR, not an assignment — and the clock starting. Attacks with a
        // launch override floor it away twelve frames later; the charge-up
        // and knightlines keep this 90, already worn down by the spawn
        // window, exactly as the recording's diag shows.
        if (state.turntimer < 90) state.turntimer = 90;
        e.clockOn = true;
        openArena(state, upcoming);
        const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
        if (gt) gt.arenaOpened = upcoming.ac;
        // THE CHARGE-UP TURN RAISES NO BOARD. `openArena` already refuses it
        // (`myattackchoice == -1` is an EMPTY branch where every other choice
        // creates an obj_growtangle) — but this flag was set unconditionally
        // straight afterwards, so the board became VISIBLE again carrying the
        // previous turn's geometry, flashed, and only then did the wind-up
        // start. GitHub #4: "the battle box shows briefly before the charging
        // animation begins". The Knight winds up over an empty screen.
        e.arenaOpen = upcoming.ac !== -1;
        // THE SOUL FLIES IN; IT DOES NOT APPEAR. obj_baseenemy's mnfight-1.5
        // block calls `scr_moveheart()`, which sets `global.inv = 0` and
        // creates obj_moveheart at Kris (+10, +40). Its Create aims it at the
        // marker, `alarm[0] = flytime` with **flytime = 8**, and only when
        // that alarm fires does `obj_heart` exist:
        //
        //     dist = point_distance(x, y, distx, disty);
        //     move_towards_point(distx, disty, dist / flytime);
        //     alarm[0] = flytime;
        //     instance_create(x, y, obj_heartburst);
        //
        // Spawning the soul directly put it on the board 8 frames before the
        // oracle's — the whole-fight diff's soul_x column moved at frame 88
        // in the sim and 96 in the recording, and 96 - 88 is this flytime.
        if (upcoming.ac !== -1 && !state.soul) {
          // scr_moveheart's `global.inv = 0`. This wrote `state.inv`, WHICH
          // NOTHING READS — the traced clock is `state.invTimer` — so the
          // second turn's soul arrived still carrying turn 1's -79 while the
          // recording restarts from 0 (whole-fight f438). Turn 1 masked it:
          // inv is 0 at fight start anyway. The write-only-variable trap,
          // again (CLAUDE.md lists `state.inv` by name).
          state.invTimer = 0;
          const kris = PARTY[0];
          const mh = spawn(state, moveheart, { x: kris.x + 10, y: kris.y + 40 });
          // No obj_heartmarker exists in this fight (only the watercooler
          // enemy ever creates one), so the destination is the moveheart
          // Create's growtangle branch: `(gt.x - 10, gt.y - 10)` — with the
          // knight's own ac-13 override reaching in afterwards:
          //
          //     if (myattackchoice == 13) { distx = gt.x - 40; disty = gt.y - 8; }
          //
          // NOT SOUL_START. (314, 162) is where the TESTER creates its heart
          // (growtangle - 6/-8), and the per-attack suites still use it; the
          // fight lands 4 left and 2 up of that, and the oracle's first soul
          // row — (314, 160), i.e. (310, 160) plus one movement step of 4,
          // because the newborn heart DOES step on its birth frame — is what
          // separated the two.
          if (gt && upcoming.ac === 13) {
            mh.distx = gt.x - 40;
            mh.disty = gt.y - 8;
          } else {
            mh.distx = (gt ? gt.x : state.view.x + 320) - 10;
            mh.disty = (gt ? gt.y : state.view.y + 170) - 10;
          }
          const dist = Math.hypot(mh.distx - mh.x, mh.disty - mh.y);
          mh.builtinMotion = true;
          mh.speed = dist / 8;
          mh.direction = (Math.atan2(-(mh.disty - mh.y), mh.distx - mh.x) * 180) / Math.PI;
          mh.alarm[0] = 8;
        }
      }
      // THE CLOCK ARMS ON THE KNIGHT'S OWN FRAME. rtimer hits 12 during the
      // knight's Step and `scr_turntimer(<attack>)` floors the clock right
      // there — one frame before this director's launch (whose cone-creation
      // timing already absorbs the offset). The battlecontroller's decrement
      // follows the knight within the same frame, so the floored value ends
      // the frame one lower: the oracle diag reads 239 for a 240 attack. The
      // controller's +30 then lands on ITS first step (fight.js /
      // stars-controller.js). Arming at launch instead ran the whole turn's
      // clock one frame late — one unit high — which pushed the
      // battlecontroller's `turntimer <= 0` heart-destruction one frame past
      // the recording's at f327.
      if (e.spawnDelay === 1) {
        const up = FIGHT_TABLE[e.phase][e.turn];
        const tl = turnLength(up.ac, up.difficulty);
        if (tl > 0 && state.turntimer < tl) state.turntimer = tl - 1;
        state.turntimerArmed = true;
      }
      e.spawnDelay -= 1;
      return;
    }

    e.menuShown = false;
    const entryNow = FIGHT_TABLE[e.phase][e.turn];
    // `Other_10`, `phase4turn == 3`: `haveusedroaring = true` alongside
    // `myattackchoice = 9` and `damagereduction = 0.4`. It is one half of the
    // end condition, so it has to be set where Roaring actually launches.
    if (entryNow?.name?.toLowerCase().includes('roaring')) {
      state.knight.haveusedroaring = true;
      state.knight.damagereduction = DR_PHASE4;
    }
    e.owner = launchAttack(state, entryNow);
    e.started = true;
    e.elapsed = 0;
    e.drain = 0;
  },
};

export function buildPracticeScene(state, { seed = 12345 } = {}) {
  state.menu = createMenu();
  state.hp = 0;
  // `global.inv` STARTS AT 0, not -1.
  //
  // scr_moveheart sets `global.inv = 0` when it launches the soul, and
  // scr_gamestart initialises it to 0. The only thing that decrements it is
  // obj_heart's own Step (`global.inv -= 1`), so with no soul on screen it
  // simply sits where it was — 0 through the whole opening menu.
  //
  // This started at -1, which is the value it reaches after one frame of a
  // live soul, not its resting value. The whole-fight diff showed it as
  // `oracle 0.0 / sim -1.0` from frame 1, which reads like a fault in the inv
  // clock and is only a wrong initial constant.
  state.invTimer = 0;
  state.phase = 'practice';
  state.view = { x: 0, y: 0 };
  state.flag22 = 0;
  state.gmlRng = gmlCreate(seed);
  state.turntimer = 0;
  state.invc = 1;

  // Visual only — see sim/actors.js. None of these can touch bullet state.
  // Every position is measured from traces/flurry2.csv.
  spawn(state, knightActor, { x: KNIGHT.x, y: KNIGHT.ystart });
  PARTY.forEach((p, i) => {
    spawn(state, partyActor, { x: p.x, y: p.y, sprite_index: p.sprite, depth: p.depth, slot: i });
  });

  settleBox(spawn(state, battlebox, { x: BOX.x, y: BOX.y }));
  // NO SOUL AT BUILD. The first turn's arena-open delivers it, exactly as the
  // Knight does via scr_moveheart. Starting with one put a soul on screen
  // through the opening menu, where the real fight has none.
  state.soul = null;
  const d = spawn(state, director);
  spawn(state, turnClock, { director: d });
  spawn(state, drawRngTail, {});
  return state;
}
