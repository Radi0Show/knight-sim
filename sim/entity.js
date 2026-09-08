// Entities and the GameMaker event phases.
//
// An entity type is a plain object of handlers:
//
//   { name, create, beginStep, step, endStep, alarm: { 0: fn, 1: fn, ... } }
//
// Every handler receives (self, state). Handlers mutate — see the note on
// mutation in state.js.

import { objectIndex } from './data/object-order.js';

export const ALARM_COUNT = 12;

/**
 * Built-in instance fields that the runner stores in FLOAT32.
 *
 * Measured directly (knight-research/tools/patches/oracle_f32_probe.csx):
 * assigning 1/3 to each and reading it back gives 0.3333333433 — the f32
 * value — for every field below, while plain instance variables give
 * 0.3333333333. hspeed/vspeed are excluded because they are derived from
 * speed/direction rather than stored independently.
 *
 * This matters beyond position: `image_angle`, `image_xscale` and
 * `image_yscale` feed the rotated-mask collision test, so an f64 angle
 * reaching masksOverlap is a latent divergence sitting inside the calibrated
 * mechanism. Narrowing is enforced structurally here rather than at each
 * assignment site, so a future translation cannot forget.
 */
export const F32_BUILTINS = [
  'x', 'y', 'xstart', 'ystart',
  'speed', 'direction',
  'image_angle', 'image_xscale', 'image_yscale',
  'image_index', 'image_speed', 'image_alpha',
  'friction', 'gravity', 'gravity_direction',
  'depth',
];

/**
 * Replace the listed fields with accessors that fround on write. Values
 * already present are narrowed in place.
 */
/**
 * Fields GameMaker NORMALISES to [0, 360) on store, on top of narrowing them.
 *
 * `direction` is documented as 0-360 and the runner wraps it: `direction = 360`
 * reads back 0, `direction = -45` reads back 315. `image_angle` does NOT wrap —
 * it happily holds 720 — so it is deliberately absent here.
 *
 * This is not cosmetic. obj_tracking_swords_manager's anti-repeat wheel
 * compares a fresh heading against the last eight (`if (inst.direction ==
 * directionprev[i]) inst.direction += 45;`), and `choose` can hand it 315.
 * Without the wrap that becomes 360, which matches nothing in the history — so
 * the wheel silently stops nudging on one heading in eight, and the attack
 * fires the same corner twice in a row exactly where it is designed not to.
 * Nothing failed; the guarantee just quietly did not hold.
 *
 * ── THE ORDER IS NARROW, THEN WRAP — AND IT WAS THE OTHER WAY ROUND ───────
 *
 * This normaliser used to be `Math.fround(((v % 360) + 360) % 360)`: wrap in
 * f64, narrow afterwards. GameMaker narrows the built-in to f32 on store and
 * THEN normalises, and the two orders disagree on exactly the values that sit
 * within half an f32 ulp of 360 — where the f64 wrap sees a number strictly
 * below 360, leaves it alone, and `fround` rounds it back UP to 360. The old
 * order could therefore store `direction = 360`, a value GameMaker's own
 * [0, 360) contract makes impossible, and the anti-repeat wheel above is one
 * of the readers that then matches nothing.
 *
 * MEASURED, on EnderCat8's Kaizo Roaring Knight v2.3.3
 * (kaizo_oracle_seq_deep.csv / _sideb, atk_Splitter1's diagonal fan). The
 * splitter walks `_direction += 360 / 13` thirteen times; the 13th heading
 * accumulates to 359.99999999999989 in f64, which f32 rounds to exactly 360.
 * The recording carries `image_angle 360.0000000000` beside
 * `direction 0.0000000000` ON THE SAME ROW — and image_angle is f32-with-no-wrap
 * (it is deliberately absent from this set), so that one row discriminates the
 * two orders on its own: the mod narrowed first, hit 360, and wrapped it to 0.
 * Wrapping first cannot produce that pair.
 *
 * Sub-ulp in motion, decisive in comparison: it is the EQUALITY tests that
 * read a stored heading — the wheel above, and `key()`-style set compares in
 * the checkers — that see 360 where the game has 0.
 *
 * A SECOND, INDEPENDENT SIGNATURE, from the same recordings and much wider
 * than one row: narrowing at the RAW magnitude leaves the stored heading on
 * the f32 grid of the binade it occupied BEFORE the wrap, not the finer grid
 * of where it landed. The mod's ac-5 aim fans are `base + a * 45` walks that
 * run well past 360, and every wrapped member carries that coarse grid —
 * atk_Multislash3's fans, from kaizo_oracle_seq_deep.csv, decoded to their
 * exact f32 bits:
 *
 *     19.1109313965   sits at magnitude 19  (native grid 2^-19) — on 2^-15
 *     36.3674621582   magnitude 36          (native 2^-18)      — on 2^-15
 *     61.0306091309   magnitude 61          (native 2^-18)      — on 2^-15
 *    106.0306091309   magnitude 106         (native 2^-17)      — on 2^-15
 *    196.0306396484   magnitude 196         (native 2^-16)      — on 2^-13
 *
 * Wrapping in f64 first and narrowing after would put each of these on its
 * OWN native grid; landing on the pre-wrap one twelve times over is not a
 * coincidence. The last row is the loudest: 196.0306396484 is two 2^-16 steps
 * off its three fan-mates because its raw value was past 512, where the f32
 * grid is 2^-14 — and that single member IS the 3.052e-5 "worst within-fan
 * spread" that check-oracle-multislash quotes as the mod's own bound. The old
 * order could not produce that spread at all: wrapping first caps every fan's
 * quantisation at 2^-15, so the sim was structurally tighter than the game and
 * that comparison passed vacuously.
 */
const ANGLE_BUILTINS = new Set(['direction', 'gravity_direction']);

function installF32Builtins(e) {
  const store = Object.create(null);
  for (const k of F32_BUILTINS) {
    const norm = ANGLE_BUILTINS.has(k)
      ? (v) => {
        const f = Math.fround(v);
        return Math.fround(((f % 360) + 360) % 360);
      }
      : (v) => Math.fround(v);
    store[k] = typeof e[k] === 'number' ? norm(e[k]) : e[k];
    delete e[k];
    Object.defineProperty(e, k, {
      enumerable: true,
      configurable: true,
      get() {
        return store[k];
      },
      set(v) {
        store[k] = typeof v === 'number' ? norm(v) : v;
      },
    });
  }
}

/**
 * Create an entity. `seq` is a monotonic spawn counter and is the only
 * ordering key used anywhere: the trace sorts bullets by it, and phases
 * iterate by it. Never order by array index or by object identity — both
 * shift when entities are added or reaped.
 */
/**
 * GameMaker's built-in instance defaults. Every instance has these before its
 * Create event runs, whether or not the object mentions them.
 *
 * STRUCTURAL, for the same reason the f32 accessors and xstart/ystart are: an
 * object that relies on a default it never assigns is indistinguishable from
 * one that forgot, and JS gives `undefined` rather than GameMaker's value.
 * `undefined` then propagates silently — it is not zero, it poisons arithmetic
 * to NaN and comparisons to false.
 *
 * Found via obj_sword_tunnel_sword, which never sets `image_xscale` because
 * GameMaker already made it 1. Here it stayed undefined, so every mask-overlap
 * test involving a tunnel sword returned false and that entire contact path
 * was dead — while looking like a merely-negative result.
 */
const INSTANCE_DEFAULTS = {
  image_xscale: 1,
  image_yscale: 1,
  image_angle: 0,
  image_alpha: 1,
  image_index: 0,
  image_speed: 1,
  speed: 0,
  direction: 0,
  friction: 0,
  gravity: 0,
  gravity_direction: 270,
};

export function spawn(state, type, vars = {}) {
  const e = {
    seq: state.nextSpawnSeq++,
    // The frame this instance was born — collision catch-up ordering needs
    // it: a bullet created mid-frame gets its heart hit BEFORE its graze,
    // while bullets alive at frame start graze first (sim/index.js).
    bornFrame: state.frame,
    type,
    alive: true,
    alarm: new Array(ALARM_COUNT).fill(-1),
    x: 0,
    y: 0,
    ...INSTANCE_DEFAULTS,
    ...vars,
  };

  installF32Builtins(e);

  // GameMaker sets xstart/ystart from the creation position, before the Create
  // event runs. Objects used to do this by hand (`e.xstart = e.x`), which is
  // fine until one forgets — and `x = xstart` is how several attacks snap back
  // to their spawn point. Structural, like the f32 accessors above.
  e.xstart = e.x;
  e.ystart = e.y;

  state.entities.push(e);
  if (type.create) type.create(e, state);

  // `e.type` IS THIS ENGINE'S ENTITY DESCRIPTOR, and GML objects have instance
  // variables of their own with ordinary names — including `type`.
  // obj_bullet_knight_crescentGenerator's Create ends `type = 2`, its
  // difficulty variant, and translating that line literally REPLACED the
  // entity's descriptor with the number 2. Nothing threw: the object simply
  // stopped having a `step`, never initialised, and vanished from every
  // `type.name` lookup — so it read as "the attack does nothing" with no error
  // anywhere. Half an hour to find, and it would have been half an hour again
  // the next time.
  //
  // A translated object that needs a GML variable called `type` renames it
  // (the generator uses `variant`); this makes the mistake impossible to make
  // quietly.
  if (e.type !== type) {
    throw new Error(
      `${type.name ?? 'an object'}'s create() overwrote e.type — that field is `
      + 'the entity descriptor. Rename the GML variable (see sim/entity.js).',
    );
  }
  return e;
}

/** GML `instance_destroy()`. The entity is reaped at end of frame. */
/**
 * `instance_destroy()` -- and GameMaker runs the instance's CLEANUP EVENT
 * as it goes, with the instance still counted among the living. A type that
 * declares `cleanUp(e, state)` gets it here, once, when the caller passes
 * the state (every site that does not is one the original destroys with no
 * CleanUp work to run, or a vanilla type that declares none). The turn's
 * end goes through clearTurn (sim/scenes/fight.js), which sweeps the way
 * `with (obj_bulletparent) instance_destroy()` does.
 */
export function destroy(e, state) {
  if (!e.alive) return;
  // THE DESTROY EVENT FIRES ON EVERY instance_destroy -- the bullet's own
  // wall test, a hit's destroyonhit, and the turn end's
  // `with (obj_bulletparent) instance_destroy()` alike; GML runs Destroy,
  // then CleanUp. Only a room/game end skips Destroy, which this engine
  // never models. MEASURED (_probeall f667, the Crescent turn's end): the
  // game drew one u32 per crescent there -- obj_bullet_knightcrescent's
  // Destroy_0 afterimage `vspeed = random_range(-0.5, 0.5)` -- and the sim,
  // whose turn end ran CleanUp only, was two u32 short from that frame on.
  // A type translates its Destroy_0 as `destroyEvent(e, state)`; it runs
  // once, before cleanUp, on whichever path destroys the instance.
  if (state && typeof e.type?.destroyEvent === 'function' && !e.destroyed) {
    e.destroyed = true;
    e.type.destroyEvent(e, state);
  }
  if (state && typeof e.type?.cleanUp === 'function' && !e.cleanedUp) {
    e.cleanedUp = true;
    e.type.cleanUp(e, state);
  }
  e.alive = false;
}

/**
 * Snapshot of live entities in spawn order.
 *
 * DECISION, unverified against the oracle: entities spawned during a phase do
 * not run that same phase — the list is fixed when the phase begins. Real
 * GameMaker is subtler; an instance created mid-Step can still get its own Step
 * that frame depending on where it lands in the processing order. Revisit at T4
 * with a trace diff on an attack that spawns bullets mid-Step. Until then, do
 * not assume this matches.
 */
/**
 * Entities in EVENT order: `type.stepOrder` first (default 0), then spawn
 * order, oldest first.
 *
 * The exception is measured, not assumed: obj_sword_vortex reads its manager's
 * `siner` and drifting centre every frame and gets the PREVIOUS frame's values
 * — at trace frame 19 the sword's `len` uses `siner = 5` while the manager
 * already holds 6 — so that sword steps BEFORE the older manager that spawned
 * it. It declares `stepOrder: -1`.
 *
 * A NEAR-MISS WORTH RECORDING. The Stars attack turned out to need reverse
 * order for its `with (obj_knight_pointing_star)` loop (see
 * sim/attacks/pointing-cone.js), which looked like the general rule this knob
 * was standing in for — two sightings of "newest first" ought to beat one
 * special case. It is not: flipping THIS function to newest-first makes
 * verify-flurry diverge at frame 96, while Stars needs the flip to be exact.
 *
 * So they are two different mechanisms. `with (obj_x)` iteration order is not
 * the Step-event order, and only the former is established as newest-first.
 * The vortex's ordering remains unexplained and stays a per-type knob.
 */
function phaseList(state) {
  // NEWEST-FIRST is the runner's measured step order (memory: three receipts --
  // a newborn soul tests the arena's pre-step grow state; a same-frame slide
  // needs the box's un-stepped ring; a step-phase payoff lands before the
  // heart's inv decrement), and the kaizo lane has a fourth: _tok3 f1212, the
  // second Flurry slash (newer) writes `con = 1; timer = 0` on the cut box and
  // the box STEPS IN THE SAME FRAME -- timer 1, the split effect born at 1212,
  // the teeth at 1215 -- where oldest-first stepped the box before the write
  // and put every one of them a frame late (POPULATION front f1215). The
  // vanilla lane keeps oldest-first: flipping it globally moved verify-flurry
  // to a f96 divergence (the note below), so the order is a per-state choice
  // the kaizo scenes make (`state.stepNewestFirst`, kaizo-fight.js) and the
  // vanilla fights do not. Step-created instances still wait a frame either
  // way (the list is taken at phase start); alarm-created ones step.
  const newestFirst = state.stepNewestFirst === true;
  return state.entities
    .filter((e) => e.alive)
    // ── OBJECT INDEX AS THE TIEBREAK WAS TRIED HERE AND REVERTED ────────────
    //
    // `alarmList` below uses object index because GameMaker visits instances
    // grouped by object in index order, and that is MEASURED for the alarm
    // phase. The obvious next step is to use it here too, as a tiebreak under
    // `stepOrder`, reordering only entities that currently tie and fall back to
    // creation order.
    //
    // IT BREAKS THE FIGHT, and precisely: all six whole-fight diffs stay
    // byte-exact for 11,759 frames and then diverge on `soul_x` at f11760 —
    // inside ROARING, on the roar's pull. obj_knight_roaring2 is index 536 and
    // obj_heart is 1462, so the index model steps the roar BEFORE the soul,
    // where creation order (the roar is born mid-fight) steps it after. The
    // byte-exact behaviour depends on the latter.
    //
    // Note the comment above this function, which was already there: `with
    // (obj_x)` iteration order is NOT the Step-event order, and only the former
    // is established as newest-first. The roar reads the heart through a `with`
    // (CLAUDE.md, "the roar's pull reading the CLAMPED heart"), so this is
    // plausibly two orderings being conflated rather than the index model being
    // wrong — but plausibly is not measured, and the fight says no.
    //
    // Kept as creation order because the change buys nothing demonstrable: the
    // vanilla fight is already byte-exact without it and no kaizo check
    // improves with it. What would reopen this: a divergence that the index
    // model explains and creation order does not, the way the underbox arming
    // chain did for alarms. Then it is worth giving the roar its own stepOrder
    // and re-running the diff.
    .sort((a, b) => (a.type.stepOrder ?? 0) - (b.type.stepOrder ?? 0)
      || (newestFirst ? b.seq - a.seq : a.seq - b.seq));
}

/**
 * THE DRAW SLOT RUNS IN GAMEMAKER'S DRAW ORDER: higher depth first (further
 * back is painted first), and it matters because Draw-event RNG is stream
 * RNG -- the kaizo teeth (depth +1) jitter before the cut box that owns them
 * (kaizo/attacks/flurry-split-*.js). Same-depth order is taken as creation
 * order; UNVERIFIED (no recording exposes it -- every draw-slot value it
 * would reorder is untraced, and the COUNT, which is what the stream
 * alignment needs, is order-blind). Vanilla's only draw-slot user, the
 * knight bob, is order-insensitive: whole-fight unchanged.
 */
function drawList(state) {
  return state.entities
    .filter((e) => e.alive)
    .sort((a, b) => ((b.depth ?? 0) - (a.depth ?? 0)) || a.seq - b.seq);
}

export function runPhase(state, phase) {
  state.eventPhase = phase;
  for (const e of (phase === 'draw' ? drawList(state) : phaseList(state))) {
    if (!e.alive) continue;
    const fn = e.type[phase];
    if (fn) fn(e, state);
  }
}

/**
 * Alarms. Rule 5: these fire between Begin Step and Step, and an alarm is not
 * a step counter.
 *
 * GameMaker clears the alarm before running its handler, so a handler is free
 * to re-arm itself. Setting `alarm[i] = 1` fires on the next frame.
 */
/**
 * The order GameMaker visits instances in during the ALARM phase.
 *
 * GameMaker runs an event by walking instances grouped BY OBJECT, in object
 * index order, and only then by instance id. `phaseList` sorts by creation
 * order (`seq`), which agrees only when the objects involved happen to have
 * been created in index order — and an object that CREATES instances of a
 * LOWER-indexed object breaks that every time.
 *
 * MEASURED, and it is why this function exists. The mod's underbox manager
 * writes a fuse onto an orb from inside its own alarm event
 * (obj_knight_weird_bottom_manager Alarm_1: `with (orb) { alarm[1] = ... }`).
 * The object table says:
 *
 *     obj_knight_weird_circle           index  373
 *     obj_knight_weird_bottom_manager   index 1173
 *
 * so the GAME reaches the orb first, its alarms are already decremented, and
 * the fuse written a moment later survives the frame whole. The sim reached the
 * manager first — it created the orbs, so it is earlier by `seq` — decremented
 * the fresh fuse in the same pass, and fired one frame early: mod 29 against
 * sim 28, and 40/39 and 38/37, on four independent arming chains across both
 * routes. Always exactly one, never more.
 *
 * `stepOrder` is deliberately NOT consulted here. Those constants are hand-fitted
 * corrections to the STEP phase's ordering, each added after a whole-fight
 * divergence, and several of them turn out to be manual restatements of the very
 * indices this function now reads (obj_knight_split_growtangle 909 < obj_heart
 * 1462 is the `-0.5`; obj_growtangle 1516 > 1462 is the `0.5`). Applying a
 * step-phase correction to the alarm phase was incidental, never evidenced.
 *
 * A type the sim INVENTED has no index and sorts last. `null` is handled
 * explicitly rather than defaulting to 0, which would sort it first — the one
 * answer certainly wrong.
 *
 * SCOPE: this is the alarm phase only. The same model very probably governs
 * Step, but that is a much larger change and it must earn its own whole-fight
 * diff before the hand-fitted constants are retired in favour of it.
 */
function alarmList(state) {
  return state.entities
    .filter((e) => e.alive)
    .sort((a, b) => {
      const ai = objectIndex(a.type.name) ?? Number.POSITIVE_INFINITY;
      const bi = objectIndex(b.type.name) ?? Number.POSITIVE_INFINITY;
      return ai - bi || a.seq - b.seq;
    });
}

// ── A TWO-PASS SPLIT WAS TRIED HERE AND REVERTED. DO NOT RETRY IT BLIND. ───
//
// This loop interleaves: it decrements entity E's alarms and dispatches them
// before moving to the next entity. So an alarm HANDLER THAT WRITES AN ALARM
// ONTO A DIFFERENT ENTITY that sorts LATER has its fuse decremented in the same
// frame, and the target fires one frame early. The mod does exactly that —
// obj_knight_weird_bottom_manager's Alarm_1 runs
// `with (orb) { alarm[1] = (_d * other.amount) - ... }`, where the `other.`
// references give away that `alarm[1]` is the ORB's.
//
// The obvious fix is two passes: decrement every entity, THEN dispatch every
// entity, so a fuse written during dispatch survives the frame intact. It was
// implemented and measured against the recording, and IT DOES NOT FIX THIS:
//
//     orbs -> first volley      mod 29      mod 40 (route C) / 38 (route D)
//       one pass (this code)    sim 28      sim 39 / 37
//       two passes              sim 30      sim 41 / 39
//
// Both models are wrong by one, in OPPOSITE directions, on all four measured
// arming chains. So the missing frame is NOT the decrement order — something
// else in the chain (most likely the orb's creation frame relative to the
// manager's fire, or the volley's own trigger) accounts for it, and two-pass
// merely moves the error rather than removing it.
//
// The two-pass version passed all 60 suites including the six byte-exact
// whole-fight diffs, so it is not detectably WRONG for vanilla either — which
// is precisely why it must not be kept: a global change to cross-object alarm
// timing that buys nothing is a landmine for whoever investigates this next.
// Reverted deliberately, with the measurement recorded so the next attempt
// starts from it instead of from the same hypothesis.
//
// WHAT WOULD SETTLE IT: a MODE 1 attack-lock recording of ac 3 / ac 102 with
// per-frame columns for the manager's alarm, the orb's alarm, and the orb's
// creation frame. The seq log records creations only, so the arming chain is
// currently inferred from two endpoints with three candidate frames between
// them.
export function runAlarms(state) {
  state.eventPhase = 'alarm';
  for (const e of alarmList(state)) {
    if (!e.alive) continue;

    for (let i = 0; i < ALARM_COUNT; i++) {
      // AN ALARM READS 0 ON THE FRAME IT FIRES AND -1 THE FRAME AFTER. Measured,
      // not reasoned (kaizo_oracle_probe, obj_fallingsword born f804 with
      // alarm[0] = 1 in its Create): end of f804 alarm[0] == 1; end of f805 == 0
      // with the event already fired and speed untouched; end of f806 == -1 and
      // scr_approach running. The old form wrote -1 in the firing frame, which
      // is invisible to every `!alarm[i]` translation (0 and -1 are both false
      // in GML truthiness) and exactly one frame early for an exact
      // `alarm[i] == -1` test -- the falling sword's. GameMaker also does not
      // fire an alarm that was SET to 0 (only a countdown reaching 0 fires),
      // which this form gets right and the old one got wrong; no sim code writes
      // a literal 0, so nothing depended on that.
      if (e.alarm[i] > 0) {
        e.alarm[i] -= 1;
        if (e.alarm[i] === 0) {
          const fn = e.type.alarm && e.type.alarm[i];
          if (fn) {
            state.counters.alarmFires += 1;
            fn(e, state);
          }
        }
      } else if (e.alarm[i] === 0) {
        e.alarm[i] = -1;
      }
    }
  }
}

/** Drop destroyed entities. Runs after End Step, before the trace row. */
export function reap(state) {
  if (state.entities.some((e) => !e.alive)) {
    state.entities = state.entities.filter((e) => e.alive);
  }
}
