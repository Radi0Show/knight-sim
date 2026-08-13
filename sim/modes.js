// THE FOUR PRACTICE MODES, and the title screen that picks between them.
//
// This replaces the HTML `<select>` boxes that sat above the canvas. Those
// were the fastest thing to build and they looked like a debug tool bolted to
// a game — a dropdown reading "Stars — phase 1/2/3 opener" is a developer's
// index, not something you hand a playtester.
//
// The menu is drawn ON THE CANVAS with the game's own assets: `fnt_mainbig`
// for the text, `spr_heart` for the cursor, and the same dark-fountain
// background the fight uses. That is not decoration for its own sake — it
// means the menu cannot drift stylistically from the thing it launches,
// because it IS the thing it launches, one frame earlier.
//
// The modes:
//
//   NORMAL    the real fight, the real order, and it ends when it ends
//   HITLESS   one hit and it restarts — the practice loop for learning a
//             pattern, and the reason most people open a tool like this
//   ENDLESS   never stops; the phase order wraps back to the start, so you
//             can stay in the fight as long as you like
//   SINGLE    one attack on repeat, chosen from the roster
//
// HITLESS is the mode this project has been implicitly built for the whole
// time — a deterministic sim with instant restart is exactly the shape a
// hitless practice loop wants — and it was the one thing the UI could not
// express.

export const MODES = [
  {
    id: 'normal',
    name: 'NORMAL',
    blurb: 'The real fight, in order.',
  },
  {
    id: 'hitless',
    name: 'HITLESS',
    blurb: 'One hit and it starts over.',
  },
  {
    id: 'endless',
    name: 'ENDLESS',
    blurb: 'It never stops. The order loops.',
  },
  {
    id: 'single',
    name: 'SINGLE ATTACK',
    blurb: 'One attack, on repeat.',
  },
];

export function createTitle() {
  return {
    /** null while the menu is up; the chosen mode id once it is not. */
    mode: null,
    index: 0,
    /** Which attack, for SINGLE. An index into the attack roster. */
    attackIndex: 0,
    /** True once the mode is picked and SINGLE needs its second choice. */
    pickingAttack: false,
    siner: 0,
    held: {},
  };
}

/**
 * One frame of the title screen. Returns true on the frame a mode is chosen.
 *
 * Edge-detected like the battle menu — the same `pressed()` shape, because a
 * held key walking the cursor down a four-item list is unusable.
 */
export function stepTitle(title, input, attackCount) {
  title.siner += 1;
  const pressed = (k) => {
    const down = !!input?.[k];
    const was = !!title.held[k];
    title.held[k] = down;
    return down && !was;
  };

  const list = title.pickingAttack ? attackCount : MODES.length;
  const cur = title.pickingAttack ? 'attackIndex' : 'index';
  let moved = false;

  if (pressed('up')) {
    title[cur] = (title[cur] + list - 1) % list;
    moved = true;
  }
  if (pressed('down')) {
    title[cur] = (title[cur] + 1) % list;
    moved = true;
  }

  if (pressed('cancel') && title.pickingAttack) {
    title.pickingAttack = false;
    return { moved: true, chosen: false };
  }

  if (pressed('confirm')) {
    if (!title.pickingAttack && MODES[title.index].id === 'single') {
      // SINGLE needs a second choice, so it opens the roster rather than
      // starting. Everything else starts immediately.
      title.pickingAttack = true;
      return { moved: false, chosen: false, selected: true };
    }
    title.mode = MODES[title.index].id;
    return { moved: false, chosen: true, selected: true };
  }

  return { moved, chosen: false };
}
