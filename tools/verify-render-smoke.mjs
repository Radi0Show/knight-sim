#!/usr/bin/env node
// THE RENDERER MUST NOT THROW. Nothing else in this project draws anything.
//
// Every other suite checks sim state, and the whole-fight diff compares
// numbers the renderer never touches — so a renderer that throws on its FIRST
// frame passed all 58 of them. It happened: the draw-call refactor started
// handing blit() a GameMaker colour INTEGER where tinted() requires an
// [r, g, b] array and throws a TypeError by design. That killed the
// requestAnimationFrame loop on the first knight draw, and the app froze at
// the end of the intro with no Knight and no fight — reported from play,
// invisible to everything here.
//
// This drives real frames through the real renderer against a stub canvas.
// It is a SMOKE TEST: it asserts nothing about what the pixels look like,
// only that drawing them does not throw. That is the class of bug it exists
// for, and the class the suites had no cover for at all.
//
// The sprite map hands back a FAKE entry rather than nothing, because the
// bug hid behind exactly that: a headless probe with no sprites never reaches
// blit(), so the throw never fires.
const noop = () => {};
const VALUE_PROPS = new Set(['fillStyle', 'strokeStyle', 'globalAlpha',
  'globalCompositeOperation', 'font', 'lineWidth', 'lineCap', 'lineJoin',
  'textAlign', 'textBaseline', 'imageSmoothingEnabled', 'shadowBlur',
  'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'miterLimit', 'direction',
  'filter']);
const mkCtx = () => new Proxy({}, {
  get(t, p) {
    if (p === 'canvas') return { width: 640, height: 480 };
    if (p === 'measureText') return () => ({ width: 10 });
    if (p === 'createLinearGradient' || p === 'createRadialGradient') {
      return () => ({ addColorStop: noop });
    }
    if (p === 'createPattern') return () => ({});
    if (p === 'getImageData' || p === 'createImageData') {
      return (a, b, w, h) => {
        const W = (p === 'createImageData' ? a : w) || 1;
        const H = (p === 'createImageData' ? b : h) || 1;
        return { data: new Uint8ClampedArray(W * H * 4), width: W, height: H };
      };
    }
    if (VALUE_PROPS.has(p)) return t[p] ?? '';
    return () => undefined;
  },
  set(t, p, v) { t[p] = v; return true; },
});
globalThis.document = {
  createElement: (tag) => {
    if (tag !== 'canvas') return {};
    const c = { width: 0, height: 0, style: {} };
    c.getContext = () => mkCtx();
    return c;
  },
};
globalThis.window = globalThis;
globalThis.devicePixelRatio = 1;

const { createState, stepFrame } = await import('../sim/index.js');
const { buildPracticeScene } = await import('../sim/scenes/practice.js');
const { createRenderer } = await import('../render/canvas.js');

const failures = [];
const canvas = { width: 640, height: 480, style: {}, getContext: () => mkCtx() };
const renderer = await createRenderer(canvas);

// A believable sprite entry, so blit() and tinted() actually run.
const fakeImg = { width: 32, height: 32, src: 'stub://frame' };
const fakeEntry = { frames: [fakeImg], meta: { ox: 16, oy: 16, w: 32, h: 32 } };
const realGet = renderer.sprites.get.bind(renderer.sprites);
renderer.sprites.get = (name) => realGet(name) ?? fakeEntry;

const st = createState({ seed: 3 });
buildPracticeScene(st, { seed: 3 });
st.keepAlive = true;
// What the intro hands over at the seam — the frame the freeze was reported on.
st.vistaFsBase = 44.3;

let f = 0;
try {
  for (; f < 900; f++) {
    renderer.draw(st);
    stepFrame(st, {});
  }
  console.log(`  ${f} frames drawn, no throw`);
} catch (e) {
  failures.push(`the renderer threw on frame ${f}: ${e.message}`);
  console.log(String(e.stack).split('\n').slice(0, 4).join('\n'));
}

if (failures.length) {
  console.log('');
  for (const x of failures) console.log(`→ FAILURE  ${x}`);
  process.exit(1);
}
console.log('\nPASS  render smoke — the renderer survives a real fight (stub canvas)');
