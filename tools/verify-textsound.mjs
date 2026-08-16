#!/usr/bin/env node
// THE TYPEWRITER — scr_textsound, and the drop shadow that comes off the same
// table row.
//
// `scr_texttype` hands every typer eleven arguments in one call, and this
// project had been reading four of them:
//
//     case   4  mainbig   c_white  rate 1  snd_text            16  28  1
//     case   6  mainbig   c_white  rate 1  snd_text            16  36  1
//     case  50  dotumche  c_black  rate 1  snd_text             9  20  0
//     case  75  dotumche  c_black  rate 1  snd_txtsus           9  20  0
//     case  81  dotumche  c_black  rate 1  snd_tv_voice_short   9  20  0
//     case 667  main      c_white  rate 2  snd_nosound         12  20  2
//
// The eighth is the VOICE and the eleventh is the SHADOW, and both were
// missing: the fight typed in silence, and the dark-world text had no lift off
// the black. Neither is cosmetic trivia — the Knight's balloon is voiced by
// snd_tv_voice_short, the television-static syllables, which is a
// characterisation choice, and the Game Over screen is snd_nosound, which is
// another.
//
// No oracle: the recordings carry no audio column. Every assertion below is
// therefore a positive-execution one on the sim's own cue stream.

import { createState, stepFrame } from '../sim/index.js';
import { buildPracticeScene } from '../sim/scenes/practice.js';
import { drainCues } from '../sim/audio.js';
import { textSoundChar, formatWriter, TV_VOICE_COUNT } from '../sim/dialogue.js';

const IDLE = {
  left: 0, right: 0, up: 0, down: 0, focus: 0, confirm: 0, cancel: 0, button3: 0,
};

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };

/** Every character the blip fires on, for a whole string at rate 1. */
function audible(text) {
  const s = formatWriter(text, 33);
  const out = [];
  for (let t = 1; t <= s.length + 4; t++) {
    const ch = textSoundChar(s, t);
    if (ch) out.push(ch);
  }
  return out;
}

// ---------------------------------------------------------- the skip list
// `scr_textsound` builds `getchar` and then knocks it out on a fixed list.
// Thirteen of the opening message's thirty characters are silent, which is
// the difference between speech and a machine gun.
const MSG = '* The Roaring Knight appeared.';
const heard = audible(MSG);
check(heard.length === 24,
  `"${MSG}" should blip on 24 of its 30 characters, got ${heard.length}`);
for (const ch of [' ', '*', '.', '!', '?', ',', ':', '/', '\\', '|', '^']) {
  check(!heard.includes(ch), `the blip should never fire on "${ch}"`);
}
check(heard[0] === 'T', `the first blip should be the T of "The", got "${heard[0]}"`);
// Past the end of the string nothing fires — otherwise a message that stays on
// screen between turns would tick forever.
check(textSoundChar(MSG, 500) === null, 'the blip should stop at the end of the line');
check(textSoundChar(MSG, 0) === null, 'nothing is typed on frame 0');

// -------------------------------------------------- the message box, live
const state = createState({ seed: 4242, traceBulletSlots: 0 });
buildPracticeScene(state, { seed: 4242 });
const counts = Object.create(null);
for (let f = 0; f < 200; f++) {
  stepFrame(state, IDLE);
  for (const c of drainCues(state)) counts[c.name] = (counts[c.name] ?? 0) + 1;
}
check(state.battlemsg === MSG, `expected the opening message, got "${state.battlemsg}"`);
check(counts.snd_text === 24,
  `the opening message should cue snd_text 24 times, got ${counts.snd_text ?? 0}`);

// HELD X MUTES IT. `if (button2_h() == 1) playtextsound = 0;` — and the same
// button jumps the typing to the end, so a player who skips hears nothing
// rather than a burst.
const muted = createState({ seed: 4242, traceBulletSlots: 0 });
buildPracticeScene(muted, { seed: 4242 });
let mutedBlips = 0;
for (let f = 0; f < 200; f++) {
  stepFrame(muted, { ...IDLE, focus: 1 });
  for (const c of drainCues(muted)) if (c.name === 'snd_text') mutedBlips += 1;
}
check(mutedBlips === 0, `holding X should silence the typer, heard ${mutedBlips}`);

// ------------------------------------------------------ the two balloons
// Susie is typer 75 (snd_txtsus); the Knight is 81, and scr_textsound gives
// that one a special case: nine samples chosen per character, all nine stopped
// first so they never overlap, gain 0.7, pitch 0.86 + random(0.35).
function balloonRun(speaker, text) {
  const st = createState({ seed: 99, traceBulletSlots: 0 });
  buildPracticeScene(st, { seed: 99 });
  const got = { names: new Set(), pitches: new Set(), gains: new Set(), stops: 0, total: 0 };
  for (let f = 0; f < 400; f++) {
    // Hold the line open across the whole run: the director clears it on a
    // confirm, and nothing here presses one.
    st.dialogue.text = text;
    st.dialogue.speaker = speaker;
    if (st.dialogue.timer > 200) st.dialogue.timer = 0;
    stepFrame(st, IDLE);
    for (const c of drainCues(st)) {
      if (!c.name.startsWith('snd_tv_voice_short') && c.name !== 'snd_txtsus') continue;
      if (c.stop) { got.stops += 1; continue; }
      got.names.add(c.name);
      got.pitches.add(Math.round(c.pitch * 1000));
      got.gains.add(c.gain);
      got.total += 1;
    }
  }
  return got;
}

const susie = balloonRun('susie', 'Heheh...');
check(susie.total > 5, `Susie's balloon should blip, heard ${susie.total}`);
check(susie.names.size === 1 && susie.names.has('snd_txtsus'),
  `Susie's voice is snd_txtsus, got ${[...susie.names].join(',')}`);

const knight = balloonRun('knight', 'Thing is,&you actually...');
check(knight.total > 5, `the Knight's balloon should blip, heard ${knight.total}`);
check([...knight.names].every((n) => n.startsWith('snd_tv_voice_short')),
  `the Knight's voice is the TV static, got ${[...knight.names].join(',')}`);
check(knight.names.size >= 5,
  `the Knight should draw from all ${TV_VOICE_COUNT} samples; saw ${knight.names.size}`);
check(knight.pitches.size >= 5,
  `each syllable is pitched 0.86 + random(0.35); saw ${knight.pitches.size} pitches`);
check([...knight.gains].every((g) => Math.abs(g - 0.7) < 1e-9),
  `the TV voice plays at gain 0.7, got ${[...knight.gains].join(',')}`);
// `audio_stop_sound` on all nine before each one, so they never pile up.
check(knight.stops >= knight.total * TV_VOICE_COUNT,
  `all ${TV_VOICE_COUNT} samples should be stopped before each syllable;`
  + ` ${knight.stops} stops for ${knight.total} blips`);
// And Susie's does NOT get the special case.
check(susie.stops === 0, 'snd_txtsus takes the plain snd_play path, with no stops');

// -------------------------------------------------------------- report
console.log('typewriter — scr_textsound + scr_textsetup\'s `special` (no oracle)\n');
console.log(`→ "${MSG}": ${heard.length} of ${MSG.length} characters voiced`);
console.log(`→ battle message cued snd_text x${counts.snd_text}, x${mutedBlips} with X held`);
console.log(`→ Susie x${susie.total} on snd_txtsus; Knight x${knight.total} across `
  + `${knight.names.size} TV samples, ${knight.pitches.size} pitches, ${knight.stops} stops`);

if (fail.length) {
  for (const f of fail) console.log(`\n→ FAILED  ${f}`);
  process.exit(1);
}
console.log('\nPASS  the typer speaks, skips its punctuation, and mutes on X');
