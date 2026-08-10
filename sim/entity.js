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
        if (fn) fn(e, state);
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
