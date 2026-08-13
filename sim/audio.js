// Sound CUES, not sound.
//
// sim/ names what should play and when; it never loads, decodes or plays
// anything, so the headless verifier is unaffected and the simulation stays a
// pure function of its inputs. The renderer drains `state.audioCues` each
// frame and plays whatever the player has supplied.
//
// WHY IT WORKS THIS WAY. The project does not ship audio: DELTARUNE's
// soundtrack is sold separately and is the most sensitive asset here
// (CLAUDE.md, "Assets"). Cues let the timing be exact and verifiable while the
// actual samples stay the player's own — point the loader at a local folder
// and the fight has sound; ship it without and every cue is a no-op.
//
// The cue name is the original's sound asset name, so it is traceable back to
// the GML line that plays it.

/** snd_play_x(name, gain, pitch) — recorded, not played. */
export function cue(state, name, pitch = 1, gain = 1) {
  if (!state.audioCues) state.audioCues = [];
  state.audioCues.push({ name, pitch, gain, frame: state.frame });
}

/**
 * `if (!audio_is_playing(x)) snd_play_x(x, ...)` — the guard the sword tunnel
 * and its finale use, and it is load-bearing.
 *
 * GameMaker's `audio_is_playing` is per sound ASSET, globally: while one copy
 * of snd_knight_cut is sounding, no second copy starts, no matter how many
 * instances ask. Sixteen swords all dashing on the same frame produce ONE cut,
 * not sixteen — and over the dash they produced 473 here before this existed,
 * a solid wall of noise where the game plays a handful of strikes.
 *
 * Modelled as a busy-until-frame per name. The holds are MEASURED from the
 * extracted samples (`python3 -c "import wave; ..."`), not guessed:
 *
 *     snd_knight_cut    1020 ms = 30.6 frames
 *     snd_knight_jump   1532 ms = 46.0 frames
 *
 * A name with no measurement is not suppressed — silence is never invented,
 * and an unlisted sound simply behaves as a plain cue.
 */
const SOUND_FRAMES = {
  snd_knight_cut: 31,
  snd_knight_jump: 46,
};

export function cueIfIdle(state, name, pitch = 1, gain = 1) {
  if (!state.audioBusy) state.audioBusy = Object.create(null);
  const until = state.audioBusy[name] ?? -Infinity;
  if (state.frame < until) return;
  const hold = SOUND_FRAMES[name];
  if (hold !== undefined) state.audioBusy[name] = state.frame + hold;
  cue(state, name, pitch, gain);
}

/**
 * `snd_loop(name)` / `snd_stop(name)` — a SUSTAINED cue, not a one-shot.
 *
 * Rotating slash holds `snd_knight_rotatingslash_line` under its whole aim
 * phase and stops it at the top of the next one, so a one-shot would either
 * cut off or stack. The renderer keeps one looping source per name and starts
 * or stops it as these arrive.
 */
export function cueLoop(state, name, pitch = 1, gain = 1) {
  if (!state.audioCues) state.audioCues = [];
  state.audioCues.push({ name, pitch, gain, loop: true, frame: state.frame });
}

/**
 * A sustained ONE-SHOT that can be retuned while it sounds — GameMaker's
 *
 *     sound = snd_play_pitch(snd_knight_stretch, 0.1);
 *     ...
 *     audio_sound_pitch(sound, audio_sound_get_pitch(sound) + 0.000535);
 *
 * The roar is preceded by a note that bends slowly upward for the whole
 * approach; a plain one-shot cannot do that, and a loop is wrong because it
 * plays once. Tracked by name so `cueTune` can find it.
 */
export function cueSustain(state, name, pitch = 1, gain = 1) {
  if (!state.audioCues) state.audioCues = [];
  state.audioCues.push({ name, pitch, gain, sustain: true, frame: state.frame });
}

/** Retune a sustained cue. Silently does nothing if it is not sounding. */
export function cueTune(state, name, pitch) {
  if (!state.audioCues) state.audioCues = [];
  state.audioCues.push({ name, pitch, tune: true, frame: state.frame });
}

export function cueStop(state, name) {
  if (!state.audioCues) state.audioCues = [];
  state.audioCues.push({ name, stop: true, frame: state.frame });
}

/** Called by the driver after rendering a frame. */
export function drainCues(state) {
  const out = state.audioCues ?? [];
  state.audioCues = [];
  return out;
}
