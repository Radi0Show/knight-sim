// Fixed timestep. Rule 1: no delta ever reaches game logic.
//
// This module is pure arithmetic — it owns no timer and calls no clock. The
// driver (browser rAF loop, or the headless runner) measures real elapsed time
// and asks this how many whole frames to run. `sim/` itself only ever advances
// one discrete frame at a time.

export const FPS = 30;
export const MS_PER_FRAME = 1000 / FPS;

/**
 * Drain an accumulator into whole frames.
 *
 * @param {number} accumulatorMs  carried-over remainder from last call
 * @param {number} elapsedMs      real time since last call
 * @param {number} maxSteps       backlog cap
 * @returns {{steps: number, accumulator: number}}
 *
 * If the caller falls further behind than `maxSteps` frames — a background tab,
 * a long GC pause — the backlog is dropped rather than repaid. Repaying it
 * causes a burst of catch-up frames, which is both visibly wrong and a source
 * of input-timing divergence. Dropping is the lesser evil; a replay run never
 * hits this path because it does not consult real time at all.
 */
export function drain(accumulatorMs, elapsedMs, maxSteps = 5) {
  let acc = accumulatorMs + elapsedMs;
  let steps = 0;

  while (acc >= MS_PER_FRAME && steps < maxSteps) {
    acc -= MS_PER_FRAME;
    steps += 1;
  }

  if (steps === maxSteps && acc >= MS_PER_FRAME) {
    acc = 0;
  }

  return { steps, accumulator: acc };
}
