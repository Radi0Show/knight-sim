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
function installF32Builtins(e) {
  const store = Object.create(null);
  for (const k of F32_BUILTINS) {
    store[k] = typeof e[k] === 'number' ? Math.fround(e[k]) : e[k];
    delete e[k];
    Object.defineProperty(e, k, {
      enumerable: true,
      configurable: true,
      get() {
        return store[k];
      },
      set(v) {
        store[k] = typeof v === 'number' ? Math.fround(v) : v;
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
export function spawn(state, type, vars = {}) {
  const e = {
    seq: state.nextSpawnSeq++,
    type,
    alive: true,
    alarm: new Array(ALARM_COUNT).fill(-1),
    x: 0,
    y: 0,
    ...vars,
  };

  installF32Builtins(e);

  state.entities.push(e);
  if (type.create) type.create(e, state);
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
function phaseList(state) {
  return state.entities.filter((e) => e.alive).sort((a, b) => a.seq - b.seq);
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
