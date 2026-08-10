// Input state shape, shared by the browser binder and the headless runner.
//
// Pure — no DOM here. The browser binder (added at T5) produces one of these
// per frame; the headless runner reads them from a frame-indexed table. sim/
// never polls, it is handed one of these per frame.

export function createInput(over = {}) {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    focus: false,
    confirm: false,
    cancel: false,
    ...over,
  };
}

export const NO_INPUT = Object.freeze(createInput());

/**
 * Build a frame-indexed input source from a sparse spec.
 *
 * Each entry is `{ from, ...buttons }` and stays in effect until the next
 * entry's `from`. CLAUDE.md calls for a hardcoded frame-indexed table for
 * early spikes rather than a recorder, precisely so a trace is reproducible
 * without a human at the keyboard.
 *
 *   const at = makeInputTable([
 *     { from: 0,  right: true },
 *     { from: 40, right: true, focus: true },
 *     { from: 80 },
 *   ]);
 */
export function makeInputTable(spec) {
  const entries = [...spec].sort((a, b) => a.from - b.from);
  const cache = entries.map(({ from, ...buttons }) => createInput(buttons));

  return function inputAt(frame) {
    let chosen = NO_INPUT;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].from <= frame) chosen = cache[i];
      else break;
    }
    return chosen;
  };
}
