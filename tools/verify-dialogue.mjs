#!/usr/bin/env node
// THE FIGHT'S DIALOGUE — obj_knight_enemy's Step.
//
// A TWO-BEAT EXCHANGE, one per turn, and reading it as a single stream of
// lines gets the shape wrong. What this pins:
//
//   * it is SILENT for five turns — `balloonturn` counts from 0 and the first
//     line is at 6, so the taunting starts once the fight is going badly
//   * the Knight speaks, then C (or the writer finishing) brings Susie's reply
//   * TWO LINES HAVE ALTERNATES for when Kris and Ralsei are both down
//   * a DOWNED SUSIE FREEZES IT — `balloonturn++` is inside
//     `if (global.hp[2] > 0)`, so the exchange holds rather than skipping
//     ahead. She is the one being talked to.

import {
  createDialogue, advanceBalloon, advanceReply, clearDialogue,
  KNIGHT_LINES, SUSIE_LINES, KNIGHT_ALONE, msgLines, revealed, dialogueDone,
  FIRST_BALLOON_TURN,
} from '../sim/dialogue.js';

const failures = [];
const UP = { partyHp: [160, 190, 140] };

// Nine pairs, and they must line up: ballooncon is balloonturn - 5.
if (Object.keys(KNIGHT_LINES).length !== Object.keys(SUSIE_LINES).length) {
  failures.push('the taunts and the replies are different lengths');
}
for (const n of Object.keys(KNIGHT_LINES)) {
  if (!SUSIE_LINES[Number(n) - 5]) failures.push(`turn ${n} has no reply at ballooncon ${n - 5}`);
}

// ── SILENT UNTIL TURN 6 ──────────────────────────────────────────────────
{
  const d = createDialogue();
  for (let t = 1; t < FIRST_BALLOON_TURN; t++) {
    if (advanceBalloon(d, UP) !== null) failures.push(`turn ${t} spoke — it should be silent`);
  }
  const first = advanceBalloon(d, UP);
  if (!first) failures.push(`turn ${FIRST_BALLOON_TURN} was silent — the exchange should start`);
  if (first !== KNIGHT_LINES[6]) failures.push('the first taunt is not the turn-6 line');
}

// ── THE TWO BEATS ────────────────────────────────────────────────────────
{
  const d = createDialogue();
  d.balloonturn = 5;
  advanceBalloon(d, UP);
  if (d.speaker !== 'knight') failures.push('the first beat is not the Knight');
  const reply = advanceReply(d);
  if (d.speaker !== 'susie') failures.push('the second beat is not Susie');
  if (reply !== SUSIE_LINES[1]) failures.push('the reply is not the matching ballooncon');
  // ballooncon is consumed, so a second press cannot re-fire it.
  if (advanceReply(d) !== null) failures.push('the reply fired twice');
  clearDialogue(d);
  if (d.text) failures.push('clearDialogue left text up');
}

// ── THE ALONE VARIANTS ───────────────────────────────────────────────────
// `global.hp[1] < 1 && global.hp[3] < 1` — Kris AND Ralsei, not either.
for (const n of Object.keys(KNIGHT_ALONE)) {
  const turn = Number(n);
  const normal = createDialogue();
  normal.balloonturn = turn - 1;
  const a = advanceBalloon(normal, UP);

  const alone = createDialogue();
  alone.balloonturn = turn - 1;
  const b = advanceBalloon(alone, { partyHp: [-999, 190, -999] });

  if (a === b) failures.push(`turn ${turn} did not swap when Kris and Ralsei are down`);
  if (b !== KNIGHT_ALONE[n]) failures.push(`turn ${turn} swapped to the wrong line`);

  // ONE of them down is not enough.
  const half = createDialogue();
  half.balloonturn = turn - 1;
  if (advanceBalloon(half, { partyHp: [-999, 190, 140] }) !== a) {
    failures.push(`turn ${turn} swapped with only Kris down — it needs both`);
  }
}

// ── A DOWNED SUSIE FREEZES IT ────────────────────────────────────────────
{
  const d = createDialogue();
  d.balloonturn = 7;
  if (advanceBalloon(d, { partyHp: [160, -999, 140] }) !== null) {
    failures.push('the exchange advanced with Susie down');
  }
  if (d.balloonturn !== 7) failures.push('a downed Susie still incremented balloonturn');
  // ...and it resumes where it left off, not where the turn count would be.
  if (advanceBalloon(d, UP) !== KNIGHT_LINES[8]) failures.push('it did not resume at turn 8');
}

// ── THE TYPING ───────────────────────────────────────────────────────────
// `global.typer = 81` — about two characters a frame, and `&` is a line break.
{
  const t = SUSIE_LINES[1];
  if (msgLines(t).length < 2) failures.push('the reply did not split on &');
  if (revealed(t, 0).length !== 0) failures.push('text was visible on frame 0');
  if (dialogueDone(t, 0)) failures.push('a line was done before it started');
  const full = revealed(t, 999).join('');
  if (full !== msgLines(t).join('')) failures.push('the full reveal lost characters');
  if (!dialogueDone(t, 999)) failures.push('a fully typed line never reports done');
  // It reveals PROGRESSIVELY — a jump straight to full is a subtitle, not speech.
  const mid = revealed(t, 8).join('');
  if (mid.length === 0 || mid.length >= full.length) {
    failures.push(`mid-type reveal is ${mid.length} of ${full.length} — not progressive`);
  }
}

console.log(`${Object.keys(KNIGHT_LINES).length} taunts, ${Object.keys(SUSIE_LINES).length} replies,`
  + ` starting turn ${FIRST_BALLOON_TURN}`);
console.log(`turn 9 normal: ${KNIGHT_LINES[9].replace(/&/g, ' / ')}`);
console.log(`turn 9 alone:  ${KNIGHT_ALONE[9].replace(/&/g, ' / ')}`);

if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`→ FAILURE  ${f}`);
  process.exit(1);
}
console.log('\nPASS  the fight dialogue (no oracle — see header)');
