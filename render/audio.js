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

// Module-relative, not document-relative — same rule as render/sprites.js.
const BASE = new URL('../assets/audio/', import.meta.url).href;

/**
 * @param {object} [opts]
 * @param {Object<string,string>} [opts.overrides] - cue name -> replacement
 *   file. A bare name resolves against the vanilla audio folder like any
 *   manifest entry; an absolute URL (or a root-relative path) is used as it
 *   stands, which is how a LANE ships its own audio from its own directory.
 *   The kaizo build replaces `mus_knight` this way. Omit it and nothing about
 *   this module changes.
 */
export function createAudio({ overrides } = {}) {
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
  /** Live streamed elements (music), so a gesture can start ones autoplay refused. */
  const streams = new Set();

  const resume = () => {
    const c = audioCtx();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    // An <audio> element is refused before a gesture exactly as the context is,
    // and unlike the context nothing else retries it.
    for (const el of streams) if (el.paused) el.play().catch(() => {});
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
      // THE LANE'S OWN CUES WIN, and they are applied here rather than at the
      // call site so `preloadAll` below decodes the replacement instead of the
      // file it replaces -- decoding both would cost a player a download of a
      // song that never plays.
      if (overrides) for (const [k, v] of Object.entries(overrides)) available.set(k, v);
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
    for (const name of available.keys()) {
      // THE MUSIC IS NOT PRELOADED WITH THE REST. `knight.ogg` is 2.1 MB —
      // larger than every sprite, font and sound effect on the site put
      // together — and preloading decodes it into raw PCM, which is far
      // bigger again. Blocking the fight's first frame on that is the wrong
      // trade when the SFX are a few KB each.
      //
      // It is fetched on the frame the track is first cued instead. The
      // first-cue-is-silent problem that made preloadAll necessary does not
      // apply: a looping track that starts a beat late is inaudible as a
      // fault, where a missing hit sound is not.
      if (name.startsWith('mus_')) continue;
      buffer(name);
    }
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

    // An override may carry a whole URL; a manifest entry is a bare filename
    // under BASE. Telling them apart here keeps every other caller unchanged.
    const file = available.get(name);
    const url = /^(?:[a-z]+:)?\/\//i.test(file) || file.startsWith('/') ? file : `${BASE}${file}`;
    const p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('404'))))
      .then((buf) => c.decodeAudioData(buf))
      .then((decoded) => {
        buffers.set(name, decoded);
        pending.delete(name);
        // A LOOP CUED BEFORE ITS BUFFER EXISTED must start when the decode
        // lands. One-shots can be dropped — they are cued again next time
        // the thing that makes them happens — but a loop is cued ONCE, so a
        // null buffer at that moment is permanent silence. That is what kept
        // the music from ever playing: `mus_knight` is deliberately not
        // preloaded, so its first and only cue always arrived early.
        if (wantedLoops.has(name)) startLoop(name, wantedLoops.get(name));
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
  /** Loops asked for while their buffer was still decoding. */
  const wantedLoops = new Map();

  function startLoop(name, opts) {
    wantedLoops.delete(name);
    if (loops.has(name)) return;
    // TRACK THE SOURCE, exactly as the `c.loop` branch does. Discarding it
    // here meant `stopLoop` had nothing to find — and since the music is the
    // one cue that is never preloaded, EVERY music start goes through this
    // deferred path, so the Q key could flip the flag and never stop a note.
    const src = fire(name, opts.pitch, opts.gain, true);
    if (src) loops.set(name, src);
  }

  function stopLoop(name) {
    wantedLoops.delete(name);
    const node = loops.get(name);
    if (!node) return;
    try {
      node.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    loops.delete(name);
  }

  // MASTER VOLUMES — the settings sliders. Loops are the music channel (the
  // track is the only sustained loop the driver starts), one-shots are SFX.
  // Live gain nodes are tracked so a slider move retunes what is already
  // playing rather than only the next cue.
  let musicVol = 1;
  let sfxVol = 1;
  const liveGains = new Set();

  /**
   * A MASTER TRIM UNDER THE SLIDERS — the whole output, halved.
   *
   * The samples are the game's own, at the game's own levels, and the game
   * mixes them against a system volume the player has already set for
   * everything else. A browser tab has no such context: it plays at whatever
   * the machine is at, and this fight is wall-to-wall loud. Reported as far
   * too loud even after the default slider dropped to 50.
   *
   * It sits BELOW the sliders on purpose, so the sliders keep their full
   * 0..100 range and their labels stay honest — 100 still means "as loud as
   * this tool goes", it is simply a quieter ceiling. Scaling the slider values
   * instead would have made the top of the range unreachable and the numbers
   * a lie.
   */
  const MASTER = 0.5;

  const levelFor = (entry) => (
    Math.min(1, entry.base) * (entry.loop ? musicVol : sfxVol) * MASTER
  );

  function setVolumes(music, sfx) {
    musicVol = music;
    sfxVol = sfx;
    for (const entry of liveGains) {
      entry.g.gain.value = levelFor(entry);
    }
  }

  /**
   * MUSIC STREAMS; EFFECTS DECODE.
   *
   * `fire` below decodes a cue to an AudioBuffer, which is right for effects:
   * they are a few KB, they overlap, and they need sample-accurate starts. It
   * is the wrong shape for a song. decodeAudioData expands a track to raw
   * 32-bit PCM and holds all of it — a few minutes of 44.1kHz stereo is on the
   * order of a hundred megabytes from a four-megabyte file, and the decode
   * itself is a visible stall on the frame the track is cued.
   *
   * An <audio> element streams instead: it starts on the first buffered chunk,
   * holds no decoded copy, and loops natively. Routing it through
   * createMediaElementSource keeps it inside the same gain graph as everything
   * else, so the music slider, the MASTER ceiling and stopLoop all keep
   * working with no change at their end.
   *
   * The returned object presents the three surfaces the rest of this module
   * uses on a BufferSource — `stop()`, `playbackRate.value` and
   * `addEventListener` — so `play`, `startLoop` and `stopLoop` do not know the
   * difference. Returning null falls back to the decode path, which is what
   * happens if the browser refuses createMediaElementSource.
   */
  function fireStream(name, pitch, gain, loop) {
    const c = audioCtx();
    const file = available?.get(name);
    if (!c || !file) return null;
    const url = /^(?:[a-z]+:)?\/\//i.test(file) || file.startsWith('/') ? file : `${BASE}${file}`;
    const el = new Audio();
    el.src = url;
    el.loop = !!loop;
    el.preload = 'auto';
    el.playbackRate = pitch ?? 1;

    let node;
    try {
      node = c.createMediaElementSource(el);
    } catch {
      return null; // let the caller decode it the ordinary way
    }

    const g = c.createGain();
    const entry = { g, base: gain ?? 1, loop: !!loop };
    g.gain.value = levelFor(entry);
    liveGains.add(entry);
    node.connect(g).connect(c.destination);

    streams.add(el);
    el.play().catch(() => { /* refused until a gesture; `resume` retries */ });

    return {
      playbackRate: {
        get value() { return el.playbackRate; },
        set value(v) { el.playbackRate = v; },
      },
      addEventListener: (...a) => el.addEventListener(...a),
      stop() {
        streams.delete(el);
        liveGains.delete(entry);
        try { el.pause(); } catch { /* already gone */ }
        // Drop the source so the browser can release what it buffered; an
        // element left with a src holds its network buffer indefinitely.
        el.removeAttribute('src');
        try { el.load(); } catch { /* nothing to reload */ }
        try { node.disconnect(); g.disconnect(); } catch { /* already detached */ }
      },
    };
  }

  function fire(name, pitch, gain, loop) {
    // The music is the one cue worth streaming — see fireStream.
    if (name.startsWith('mus_')) {
      const streamed = fireStream(name, pitch, gain, loop);
      if (streamed) return streamed;
    }
    const buf = buffer(name);
    const c = audioCtx();
    if (!buf || !c) {
      // Remember the intent so the decode's `then` can honour it.
      if (loop && c) wantedLoops.set(name, { pitch, gain });
      return null;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = pitch ?? 1;
    src.loop = !!loop;
    const g = c.createGain();
    const base = gain ?? 1;
    const entry = { g, base, loop: !!loop };
    g.gain.value = levelFor(entry);
    liveGains.add(entry);
    src.onended = () => liveGains.delete(entry);
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
    // AND THE ONES STILL DECODING. A loop cued before its buffer landed sits
    // in `wantedLoops` and starts when the decode does — right for a fight,
    // wrong for one that has just been LEFT: exit a run (Escape, Start, a
    // held R) inside mus_knight's first-load window and the title screen
    // began playing the fight's music a beat later. Forgetting the wish
    // here is what makes stopAll mean everything, not just the sounding.
    // (The music streams now, so the window is the stream's own start-up
    // rather than a decode; the wish is still recorded and still cleared.)
    wantedLoops.clear();
  }

  return {
    play,
    stopAll,
    // Exposed so the Q key can silence the MUSIC without touching the SFX —
    // the effects are feedback and muting them makes the fight harder to read.
    stopLoop,
    // The settings sliders (0..1 each) — retunes live sources too.
    setVolumes,
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
