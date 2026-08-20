// Entities and the GameMaker event phases.
//
// An entity type is a plain object of handlers:
//
//   { name, create, beginStep, step, endStep, alarm: { 0: fn, 1: fn, ... } }
//
// Every handler receives (self, state). Handlers mutate — see the note on
// mutation in state.js.

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
 */
const ANGLE_BUILTINS = new Set(['direction', 'gravity_direction']);

function installF32Builtins(e) {
  const store = Object.create(null);
  for (const k of F32_BUILTINS) {
    const norm = ANGLE_BUILTINS.has(k)
      ? (v) => Math.fround(((v % 360) + 360) % 360)
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
export function destroy(e) {
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
  return state.entities
    .filter((e) => e.alive)
    .sort((a, b) => (a.type.stepOrder ?? 0) - (b.type.stepOrder ?? 0) || a.seq - b.seq);
}

export function runPhase(state, phase) {
  state.eventPhase = phase;
  for (const e of phaseList(state)) {
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
export function runAlarms(state) {
  state.eventPhase = 'alarm';
  for (const e of phaseList(state)) {
    if (!e.alive) continue;

    for (let i = 0; i < ALARM_COUNT; i++) {
      if (e.alarm[i] > 0) e.alarm[i] -= 1;

      if (e.alarm[i] === 0) {
        e.alarm[i] = -1;
        const fn = e.type.alarm && e.type.alarm[i];
        if (fn) {
          state.counters.alarmFires += 1;
          fn(e, state);
        }
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
