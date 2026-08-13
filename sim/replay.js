// REPLAY TOKENS — a bug report you can run.
//
// The whole point of this project's architecture is that `sim/` is a pure
// function of (state, input) with a seeded PRNG and no wall clock, and
// `verify-determinism` proves it byte-identical across ten runs in separate
// Node processes. That property has been sitting there unused by anything a
// PLAYER touches.
//
// It means a playtester never has to describe a bug. The seed plus the input
// stream reproduces the exact frame, on any machine, headlessly. So a report
// is a string, and once you have the string the bug is a regression test.
//
// THE ENCODING. Seven buttons fit in one byte, and input barely changes from
// frame to frame — a held direction is one value for fifty frames — so the
// stream run-length encodes to almost nothing. A two-minute run of ordinary
// play is a few hundred bytes before base64, which pastes into a GitHub issue
// without wrapping.
//
//     K1.<seed>.<mode>.<attack>.<difficulty>.<frames>.<base64url of RLE>
//
// The prefix is deliberately human-readable: you can see the seed and the
// length without decoding anything, and a truncated paste is obvious rather
// than silently decoding to garbage.

const BITS = {
  left: 1, right: 2, up: 4, down: 8, focus: 16, confirm: 32, cancel: 64,
  // BUTTON3 IS THE DIALOGUE ADVANCE (C), and it has to be in the token.
  //
  // obj_knight_enemy's enemy-talk state waits on it:
  //
  //     if (talked == 0.5) {
  //         talktimer++;
  //         if ((button3_p() && talktimer > 15) || !i_ex(obj_writer)) { ... }
  //
  // Without it the writer is never dismissed, `talked` sticks at 0.5, and the
  // fight stalls before the Knight's setup — which is why the oracle harness
  // forced `talked = 1` and, in doing so, silently dropped every other side
  // effect of that branch (scr_randomtarget, obj_darkener, balloonturn++,
  // rtimer = 0). Three separate bugs came out of that one shortcut.
  //
  // Adding a bit is backward compatible: older tokens simply never set it.
  button3: 128,
};
const KEYS = Object.keys(BITS);

export const TOKEN_VERSION = 'K1';

/** Pack one input object into a byte. */
export function packInput(input) {
  let b = 0;
  for (const k of KEYS) if (input?.[k]) b |= BITS[k];
  return b;
}

/** Unpack a byte back into the input object sim/ expects. */
export function unpackInput(b) {
  const out = {};
  for (const k of KEYS) out[k] = (b & BITS[k]) !== 0;
  return out;
}

/**
 * A recorder. Feed it every frame's input; it keeps a run-length list.
 *
 * Recording is unconditional and costs one comparison a frame — cheaper than
 * deciding when to start, and a bug you did not expect is the only kind worth
 * a recorder.
 */
export function createRecorder(meta = {}) {
  return {
    meta: {
      seed: meta.seed ?? 0,
      mode: meta.mode ?? 'fight',
      attack: meta.attack ?? '',
      difficulty: meta.difficulty ?? 0,
    },
    runs: [],   // [byte, count] pairs
    frames: 0,
  };
}

export function recordInput(rec, input) {
  const b = packInput(input);
  const last = rec.runs[rec.runs.length - 1];
  // Counts are one byte, so a run longer than 255 frames splits. Standing
  // still through a long attack is exactly that case and it costs 2 bytes per
  // 255 frames, which is nothing.
  if (last && last[0] === b && last[1] < 255) last[1] += 1;
  else rec.runs.push([b, 1]);
  rec.frames += 1;
}

// base64url without padding — safe in a URL, a filename and a shell argument,
// which matters because the token is pasted into all three.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function toB64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}

function fromB64(str) {
  const bytes = [];
  let buf = 0;
  let bits = 0;
  for (const ch of str) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 0xff);
    }
  }
  return bytes;
}

export function encodeReplay(rec) {
  const bytes = [];
  for (const [b, n] of rec.runs) {
    bytes.push(b, n);
  }
  const m = rec.meta;
  return [
    TOKEN_VERSION,
    m.seed,
    m.mode,
    m.attack || '-',
    m.difficulty,
    rec.frames,
    toB64(bytes),
  ].join('.');
}

/**
 * Decode. Returns `{ meta, frames, inputAt }` — `inputAt(frame)` is the same
 * shape `makeInputTable` produces, so a decoded replay drops into any harness
 * that already takes one.
 *
 * Throws on a malformed token rather than returning something plausible: a
 * token that decodes to the wrong inputs would reproduce a DIFFERENT bug and
 * send the fix somewhere useless.
 */
export function decodeReplay(token) {
  const parts = String(token).trim().split('.');
  if (parts.length !== 7) {
    throw new Error(`not a replay token (${parts.length} fields, expected 7)`);
  }
  const [ver, seed, mode, attack, difficulty, frames, payload] = parts;
  if (ver !== TOKEN_VERSION) {
    throw new Error(`token version ${ver}, this build reads ${TOKEN_VERSION}`);
  }

  const bytes = fromB64(payload);
  if (bytes.length % 2 !== 0) throw new Error('truncated payload');

  const table = [];
  for (let i = 0; i < bytes.length; i += 2) {
    const input = unpackInput(bytes[i]);
    for (let n = 0; n < bytes[i + 1]; n++) table.push(input);
  }
  if (table.length !== Number(frames)) {
    throw new Error(`payload is ${table.length} frames, header says ${frames}`);
  }

  const idle = unpackInput(0);
  return {
    meta: {
      seed: Number(seed),
      mode,
      attack: attack === '-' ? '' : attack,
      difficulty: Number(difficulty),
    },
    frames: table.length,
    inputAt: (f) => table[f] ?? idle,
  };
}
