// Plays the cues sim/audio.js records — if, and only if, the player has
// supplied the samples.
//
// NOTHING IS SHIPPED. `assets/audio/` is gitignored and empty in the repo.
// DELTARUNE's audio is sold separately and is the most sensitive asset here
// (CLAUDE.md, "Assets"), so the tool ships silent and each player points it at
// their own copy. `tools/extract-audio.sh` pulls the handful of cues this
// build uses out of a local game file into that folder.
//
// Every miss is a silent no-op, deliberately: a missing sample must never be
// an error, because silent is the shipped default.
//
// WEB AUDIO, not <audio> elements. The first version cloned an Audio node per
// cue, and `cloneNode()` re-requests the source — with the dev server sending
// `Cache-Control: no-store` that meant re-downloading a 150 KB sample on every
// single hit, hundreds of times a fight, each with a fetch's worth of latency
// before it made a sound. Decoding once into an AudioBuffer and firing buffer
// sources is both instant and free, and it is what lets sixteen tunnel swords
// overlap without competing for element state.
//
// GATED ON A MANIFEST, and that is not tidiness either. Requesting samples
// speculatively meant the shipped default — no audio folder — logged one 404
// per distinct cue: fifty console errors on every load, in the normal case,
// which is exactly the kind of noise that makes a real error invisible. The
// extractor writes `index.json` listing what it pulled; without that file the
// player has supplied nothing and we ask for nothing.

const BASE = '../assets/audio/';

export function createAudio() {
  /** name -> AudioBuffer, once decoded. */
  const buffers = new Map();
  /** name -> in-flight decode, so a burst of cues fetches once. */
  const pending = new Map();
  const missing = new Set();
  let enabled = true;
  /** Cue name -> file, from the manifest. Null until the probe resolves. */
  let available = null;

  // Created lazily: constructing an AudioContext before a user gesture leaves
  // it suspended and logs a warning in some browsers.
  let ctx = null;
  function audioCtx() {
    if (ctx) return ctx;
    const C = window.AudioContext ?? window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    return ctx;
  }

  // Autoplay policy: the context starts suspended until the page has been
  // interacted with. The fight is keyboard-driven, so the first key resumes it.
  const resume = () => {
    const c = audioCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
  };
  window.addEventListener('keydown', resume, { passive: true });
  window.addEventListener('pointerdown', resume, { passive: true });

  // One request, once. Failure is the expected case.
  //
  // `index.json` maps CUE NAME -> FILE, because the game stores some of these
  // as WAV and some as OGG and the loader must not guess: all 19 of the
  // knight's cues come out as .wav, so a hardcoded .ogg found none of them.
  fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => {
      if (Array.isArray(list)) {
        // Older manifests were a bare name list; assume .ogg for those.
        available = new Map(list.map((n) => [n, `${n}.ogg`]));
      } else if (list && typeof list === 'object') {
        available = new Map(Object.entries(list));
      } else {
        available = new Map();
      }
      preloadAll();
    })
    .catch(() => {
      available = new Map();
    });

  /**
   * DECODE EVERYTHING UP FRONT, and this is not an optimisation.
   *
   * Lazily decoding on first use means the FIRST cue of every sound is silent —
   * `buffer()` returns null while the fetch and decode are in flight. Stars
   * fires most of its cues exactly once per run (three `drawpower` on one frame,
   * three `star_explosion_close` on another, one `rocket_long`), so lazily it
   * was inaudible almost in its entirety. Sounds that repeat fared worse than
   * silence: the first hit dropped and a later one played, which reads as the
   * sound arriving LATE.
   *
   * Nineteen samples, a few MB, decoded once while the intro plays. There is
   * nothing to gain by deferring it and a whole class of "why did that not make
   * a noise" to lose.
   */
  function preloadAll() {
    if (!available) return;
    for (const name of available.keys()) buffer(name);
  }

  function buffer(name) {
    if (buffers.has(name)) return buffers.get(name);
    // Probe not back yet, or the player supplied nothing / not this cue.
    if (available === null || !available.has(name)) {
      missing.add(name);
      return null;
    }
    if (pending.has(name)) return null; // decoding; this cue is simply missed
    const c = audioCtx();
    if (!c) return null;
    // decodeAudioData works on a SUSPENDED context, so the preload does not
    // have to wait for the player's first keypress — only playback does.

    const p = fetch(`${BASE}${available.get(name)}`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
      .then((buf) => c.decodeAudioData(buf))
      .then((decoded) => {
        buffers.set(name, decoded);
        pending.delete(name);
      })
      .catch(() => {
        buffers.set(name, null);
        missing.add(name);
        pending.delete(name);
      });
    pending.set(name, p);
    return null;
  }

  // ONE sustained source per name, for snd_loop/snd_stop. A one-shot per frame
  // would stack into a drone; a single source that is started and stopped is
  // what `snd_loop(snd_knight_rotatingslash_line)` actually is.
  const loops = new Map();

  function stopLoop(name) {
    const node = loops.get(name);
    if (!node) return;
    try {
      node.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    loops.delete(name);
  }

  function fire(name, pitch, gain, loop) {
    const buf = buffer(name);
    const c = audioCtx();
    if (!buf || !c) return null;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch ?? 1;
    src.loop = !!loop;
    const g = c.createGain();
    g.gain.value = Math.min(1, gain ?? 1);
    src.connect(g).connect(c.destination);
    src.start();
    return src;
  }

  /**
   * @param cues  drained from state.audioCues — {name, pitch, gain, loop, stop}
   */
  function play(cues) {
    if (!enabled || !cues.length) return;
    for (const c of cues) {
      if (c.stop) {
        stopLoop(c.name);
        continue;
      }
      if (c.tune) {
        const node = loops.get(c.name);
        if (node) node.playbackRate.value = c.pitch ?? 1;
        continue;
      }
      if (c.sustain) {
        // Tracked like a loop so it can be retuned and stopped, but it plays
        // through once. It untracks itself when it ends.
        stopLoop(c.name);
        const src = fire(c.name, c.pitch, c.gain, false);
        if (src) {
          loops.set(c.name, src);
          src.addEventListener('ended', () => {
            if (loops.get(c.name) === src) loops.delete(c.name);
          });
        }
        continue;
      }
      if (c.loop) {
        // `snd_loop` on a name already looping restarts it, as the original's
        // `snd_stop` + `snd_loop` pair does.
        stopLoop(c.name);
        const src = fire(c.name, c.pitch, c.gain, true);
        if (src) loops.set(c.name, src);
        continue;
      }
      fire(c.name, c.pitch, c.gain, false);
    }
  }

  /** Every loop off — the driver calls this on reset and on pause. */
  function stopAll() {
    for (const name of [...loops.keys()]) stopLoop(name);
  }

  return {
    play,
    stopAll,
    get enabled() {
      return enabled;
    },
    set enabled(v) {
      enabled = v;
      if (!v) stopAll();
    },
    /** Names the sim asked for that have no sample on disk. */
    get missing() {
      return [...missing];
    },
    /** Names decoded and ready. Exposed for the browser smoke check. */
    get loaded() {
      return [...buffers.keys()].filter((k) => buffers.get(k));
    },
  };
}
