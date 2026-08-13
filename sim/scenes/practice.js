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
import { gmlCreate } from '../rng.js';
import { FIGHT_TABLE, launchAttack, openArena, clearTurn, nextTurn } from './fight.js';
import { createMenu, stepMenu, openMenu } from '../menu.js';
import { partyWiped, PARTY as PARTY_STATS, isUp } from '../damage.js';
import { createFightBar, stepFightBar, fightTp } from '../fightbar.js';
import { endTurnItems } from '../menu.js';
import { createHeroes, stepHeroes, heroAct, HERO_ATTACK, HERO_SPELL } from '../heroes.js';
import { spawnDmgNumber, stepDmgNumbers, resetDmgStack } from '../dmgnumbers.js';
import { spawnImpact, stepAttackVfx } from '../attackvfx.js';
import { stepRudeBuster, rudeBusterBusy } from '../rudebuster.js';
import { castSpell } from '../spells.js';
import { rngNext } from '../rng.js';
import {
  fightDamage, damageKnight, advanceTurn, stepKnightAnim, phase4Reached,
  endCutsceneReached, startEndCutscene, DR_PHASE4,
} from '../knight.js';
import { scrTensionheal } from '../tension.js';
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
const TURN_GAP = 20;

/** How long bullets get to leave on their own before the sweep. */
const DRAIN_FRAMES = 90;

const director = {
  name: 'fight_director',

  create(e) {
    e.phase = 1;
    e.turn = 0;
    e.owner = null;
    e.gap = TURN_GAP;
    e.started = false;
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
    // THE FIGHT IS LOST when all three are down. The real game goes to its
    // Game Over screen; here the run simply stops and the HUD says so, which
    // is the honest stand-in — the retry flow is turn-system machinery.
    if (!state.gameOver && partyWiped(state)) {
      state.gameOver = true;
      state.menu.open = false;
    }
    if (state.gameOver) return;

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
    if (endCutsceneReached(state)) {
      startEndCutscene(state);
      state.menu.open = false;
      state.fightBar = null;
      e.bar = null;
    }

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

    // The battle controller decrements global.turntimer every frame of the
    // bullet phase. That object is not translated (turn system, out of scope),
    // so the director stands in for exactly this one line — attacks read the
    // clock to decide when to stop spawning and close out.
    if (e.started && state.turntimer > 0) state.turntimer -= 1;

    const entry = FIGHT_TABLE[e.phase][e.turn];
    state.phase = `phase ${e.phase} · turn ${e.turn + 1} · ${entry.name}`;

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
      const ownerAlive = e.owner && e.owner.alive;
      const bulletsLeft = state.entities.some(
        (x) => x.alive && x.isBullet && x.type.name !== 'obj_heart',
      );
      // THE CLOCK IS THE AUTHORITY, and waiting for the arena to empty is
      // not a substitute for it. Requiring `!bulletsLeft` hung the Stars turn
      // for 1,500 frames: 96 starchildren home in on the soul and simply hover
      // there, so they never leave the screen and the turn could never end.
      // In the game the battle controller ends the turn when `turntimer` runs
      // out and sweeps whatever is still flying — that sweep is `clearTurn`.
      //
      // The DRAIN is the small piece of grace that costs nothing: once the
      // clock is out, give bullets a moment to fly off on their own so the
      // sweep is invisible in the common case, then end the turn regardless.
      const timeUp = state.turntimer <= 0 || !ownerAlive;
      if (timeUp) e.drain += 1;
      const finished = timeUp && (!bulletsLeft || e.drain >= DRAIN_FRAMES);
      if (!finished) return;

      e.started = false;
      e.arenaOpen = false;
      e.gap = TURN_GAP;
      e.spawnDelay = RTIMER_SPAWN;
      e.turnsRun += 1;
      clearTurn(state);
      const nx = nextTurn(e.phase, e.turn);
      e.phase = nx.phase;
      e.turn = nx.turn;

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
      if (e.phase === 3 && e.turn === 0 && (phase4Reached(state) || e.turnsRun >= 15)) {
        e.phase = 4;
        e.turn = 0;
      }
      return;
    }

    e.gap -= 1;
    if (e.gap > 0) return;

    // THE MENU COMES FIRST. A turn in the real fight is: each of the three
    // party members picks from their button row, and only when the last one
    // confirms does the enemy attack. The gap above is the beat before the
    // panels rise.
    if (!e.menuShown) {
      e.menuShown = true;
      // `for (__hiti...) global.hittarget[__hiti] = 0;` — scr_attackphase
      // clears the stack so each turn's numbers start at the bottom again.
      resetDmgStack(state);
      openMenu(state);
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
      if (order.length) e.bar = createFightBar(state.rng, order);
      e.resolved = [false, false, false];
    }

    // `maxdelay` — 0 with no spells or items, otherwise 25 + 15 per caster.
    if (e.maxdelay === undefined) {
      const casters = (state.pendingSpell ?? []).filter(Boolean).length;
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
        const p = state.pendingSpell?.[c];
        if (p && !e.spellFired[c] && e.maxdelaytimer >= 10) {
          e.spellFired[c] = true;
          heroAct(state, c, HERO_SPELL);
          castSpell(state, c, p.id, p.target, { alreadyPaid: true });
        }
      }
      return;
    }
    // Everything queued has fired; the bolt may still be flying.
    if (rudeBusterBusy(state)) return;
    if (state.pendingSpell) state.pendingSpell = [];

    if (e.bar) {
      if (!e.bar.done) {
        // ONE BUTTON, edge-triggered. A single press scans every live bolt and
        // scores the nearest, so the director hands it one boolean.
        stepFightBar(e.bar, !!state.input?.confirm);
        state.fightBar = e.bar;
      }

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
      for (let c = 0; c < 3; c++) {
        if (!e.bar.attacked[c] || e.resolved[c]) continue;
        e.resolved[c] = true;
        const acc = e.bar.points[c];
        heroAct(state, c, HERO_ATTACK);
        if (acc <= 0) {
          // A missed bolt still writes a number — `scr_damage_enemy` creates
          // the writer before the `arg1 > 0` test, and a zero draws MISS.
          spawnDmgNumber(state, KNIGHT.x, KNIGHT.ystart + 40, 0, c);
          continue;
        }
        const dealt = fightDamage(state, c, acc);
        if (dealt > 0) {
          damageKnight(state, dealt);
          scrTensionheal(state, fightTp(acc));
          spawnImpact(state, KNIGHT.x, KNIGHT.ystart + 40, c, acc === 150,
            () => rngNext(state.rng));
        }
        spawnDmgNumber(state, KNIGHT.x, KNIGHT.ystart + 40, dealt, c);
      }

      if (!e.bar.done) return;

      // `posttimer` runs to `timermax` and the black fade takes 13 more
      // frames. That hold is where the attack animations actually play out.
      if ((e.barHold ?? 0) < ATTACKPRESS_HOLD + ATTACKPRESS_FADE) {
        e.barHold = (e.barHold ?? 0) + 1;
        return;
      }
      e.barHold = 0;
      e.bar = null;
      state.fightBar = null;
      state.menu.fight = [false, false, false];
      // `damagereduction += 0.01` once per resolved turn, inside [0.2, 0.35).
      advanceTurn(state);
      e.maxdelay = undefined;
      return;
    }
    e.maxdelay = undefined;

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
        const upcoming = FIGHT_TABLE[e.phase][e.turn];
        openArena(state, upcoming);
        const gt = state.entities.find((x) => x.alive && x.type.name === 'obj_growtangle');
        if (gt) gt.arenaOpened = upcoming.ac;
        e.arenaOpen = true;
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
  state.invTimer = -1;
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
  state.soul = spawn(state, soul, { ...SOUL_START });
  spawn(state, director);
  return state;
}
