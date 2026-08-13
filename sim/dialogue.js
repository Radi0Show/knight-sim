// THE FIGHT'S DIALOGUE — obj_knight_enemy's Step.
//
// It is a TWO-BEAT EXCHANGE, one per turn, and reading it as a single stream
// of lines gets the shape wrong:
//
//     balloonturn++;                       once a turn, and ONLY if Susie
//                                          is alive (`global.hp[2] > 0`)
//     balloonturn == N  ->  the Knight's taunt, and `ballooncon = N - 5`
//     button3_p() or the writer finishing  ->  Susie's reply for that
//                                              ballooncon, then ballooncon = 0
//
// So the Knight speaks, you press C, Susie answers. Both balloons, one turn.
//
// **IT STARTS ON TURN 6.** `balloonturn` counts from 0 and the first line is
// at 6, so the first five turns are silent — the taunting begins once the
// fight has gone on long enough to be going badly.
//
// **IT STOPS IF SUSIE FALLS.** The increment is inside `if (global.hp[2] > 0)`,
// so a downed Susie freezes the exchange where it stands rather than skipping
// ahead. She is the one being talked to.
//
// `&` is GameMaker's line break inside a message; `/%` closes it.

/** `balloonturn == N` — the Knight's taunt. */
export const KNIGHT_LINES = {
  6: "Heheh...",
  7: "Thing is,&you actually...",
  8: "You? You're all&damn alone...",
  9: "Even... even if&you knock me down...",
  10: "As long as Kris has got&a hand to lift me up with...",
  11: "So... give up.",
  12: "You know you can't&win... so... give up!",
  13: "... You won't even...",
  14: "... heh... heheheh...",
};

/** `ballooncon == N` — Susie's reply, N = balloonturn - 5. */
export const SUSIE_LINES = {
  1: "Didn't... think&we'd still be&standing, did you?",
  2: "You actually messed up,&picking a fight with US!",
  3: "Me? I got...&Kris and Ralsei&behind me.",
  4: "As long as Kris,&Ralsei, are here...",
  5: "As long as&I'm here...",
  6: "Heh... you're never gonna&win, you hear me?!",
  7: "... say a thing, huh...",
  8: "Man, I'm done talking.",
  9: "... people like you...&just piss me off.",
};

/**
 * Two of the Knight's lines have alternates for when KRIS AND RALSEI ARE BOTH
 * DOWN — `global.hp[1] < 1 && global.hp[3] < 1`. The taunt changes from "even
 * if you knock me down" to "even if you knock THEM down", because at that
 * point Susie is the only one still standing and the Knight is talking about
 * the others rather than about her.
 */
export const KNIGHT_ALONE = {
  9: "Even... even if&you knock them down...",
  10: "As long as I'm here to&lift them back up...",
};

/** ACT results, which go to the CHATBOX rather than a balloon. */
export const ACT_TEXT = {
  check: "* Kris analyzed the enemy!&* But Kris couldn't learn anything.",
  point: "* Kris points into the distance.&* Nothing happened.",
  holdbreath_first: "* Kris held their breath.&* Their heartbeat quickened."
    + "&* The SOUL now moves faster.",
  holdbreath_again: "* Kris held their breath...&* Kris smiled.&* Nothing happened.",
  susie: "* Susie talked to the Knight!",
  susie_done: "* (Susie will not ACT any more.)",
  ralsei: "* Ralsei tried talking...",
  ralsei_done: "* (... but nothing happened.)",
};

/** `msgsetloc` uses `&` for a line break. */
export const msgLines = (s) => String(s).split('&');

/** The first turn a taunt appears. */
export const FIRST_BALLOON_TURN = 6;

export function createDialogue() {
  return { balloonturn: 0, ballooncon: 0, text: null, speaker: null, timer: 0 };
}

/**
 * One turn's advance. Called when a turn begins.
 *
 * Returns the Knight's line, or null on the silent early turns.
 */
export function advanceBalloon(dlg, state) {
  // `if (global.hp[2] > 0)` — Susie must be standing for the exchange to move.
  if (state.partyHp[1] <= 0) return null;
  dlg.balloonturn += 1;
  const n = dlg.balloonturn;
  let line = KNIGHT_LINES[n];
  if (!line) return null;
  // Kris AND Ralsei both down swaps two of them.
  if (KNIGHT_ALONE[n] && state.partyHp[0] < 1 && state.partyHp[2] < 1) {
    line = KNIGHT_ALONE[n];
  }
  dlg.ballooncon = n - 5;
  dlg.text = line;
  dlg.speaker = 'knight';
  dlg.timer = 0;
  return line;
}

/** The second beat: C, or the writer running out. */
export function advanceReply(dlg) {
  if (!dlg.ballooncon) return null;
  const line = SUSIE_LINES[dlg.ballooncon] ?? null;
  dlg.ballooncon = 0;
  dlg.text = line;
  dlg.speaker = 'susie';
  dlg.timer = 0;
  return line;
}

export function clearDialogue(dlg) {
  dlg.text = null;
  dlg.speaker = null;
}

/**
 * `global.typer = 81` — the writer reveals roughly two characters a frame.
 *
 * PURE TEXT LOGIC, so it lives in sim/ rather than render/. The turn loop has
 * to know when a line has finished typing (to decide whether C advances or
 * the line auto-holds), and a sim module importing from render/ to find that
 * out is the dependency arrow pointing the wrong way — sim/ is the half that
 * must run headless.
 */
export const CHARS_PER_FRAME = 2;

export function revealed(text, timer) {
  const n = Math.floor(timer * CHARS_PER_FRAME);
  const lines = msgLines(text);
  let left = n;
  const out = [];
  for (const line of lines) {
    if (left <= 0) break;
    out.push(line.slice(0, left));
    left -= line.length;
  }
  return out;
}

export function dialogueDone(text, timer) {
  return Math.floor(timer * CHARS_PER_FRAME) >= msgLines(text).join('').length;
}
