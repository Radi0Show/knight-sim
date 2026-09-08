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
    if (p === 'drawImage' || p === 'fillText') {
      return () => { globalThis.__drawCount = (globalThis.__drawCount ?? 0) + 1; };
    }
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

// THE ACT'S TEXT REACHES state.battlemsg WITH THE MENU SHUT.
//
// This is the SIM half of a bug whose other half is in render/menu.js:
// drawBattleMsg used to sit inside the button-row branch, so the flavour line
// only drew while the menu was OPEN — and the director does not even reach the
// ACT writer until `state.menu.open` is false. Selecting HoldBreath queued the
// right three lines, typed them out, and drew nothing.
//
// The RENDER half is not asserted here and that is a real gap: drawBattleMsg
// returns early on `!font?.ready`, and no font loads in this stub harness, so
// a draw-count probe cannot tell the fixed and broken versions apart. Only
// the state contract below is covered.
{
  const { createState: mk } = await import('../sim/state.js');
  const { stepFrame: step } = await import('../sim/index.js');
  const { buildPracticeScene: build } = await import('../sim/scenes/practice.js');
  const st3 = mk({ seed: 3 });
  build(st3, { seed: 3 });
  st3.keepAlive = true;
  let guard = 0;
  while (!st3.menu?.open && guard++ < 2000) step(st3, {});
  const tap = (k) => { step(st3, { [k]: true }); step(st3, {}); };
  st3.menu.selected[0] = 1; tap('confirm'); tap('confirm');
  st3.menu.gridIndex = 1; tap('confirm');            // Kris: HoldBreath
  st3.menu.selected[st3.menu.charturn] = 4; tap('confirm');
  st3.menu.selected[st3.menu.charturn] = 4; tap('confirm');
  for (let i = 0; i < 4; i++) step(st3, {});
  if (st3.menu.open) {
    console.log('  skip  the menu did not close');
  } else if (!String(st3.battlemsg ?? '').includes('held their breath')) {
    failures.push(`with the menu shut the ACT's text never reached battlemsg (got ${JSON.stringify(st3.battlemsg)})`);
  }
}

// THE TITLE'S PAGES ALL RENDER. The fight smoke above never reaches the
// title, and the GEAR / ITEMS hub was added as a new page branch — a throw
// in any page's draw would freeze the menu exactly like the tinted() crash
// froze the fight. Stub canvas, every page, including the new hub.
{
  const { drawTitle } = await import('../render/title.js');
  const { createTitle } = await import('../sim/modes.js');
  const ctx2 = mkCtx();
  const pages = [null, 'gearhub', 'equip', 'items', 'audio', 'graphics', 'credits'];
  for (const page of pages) {
    const t = createTitle();
    if (page !== undefined && page !== 'title') {
      t.settings = {
        page,
        root: page === 'gearhub' || page === 'credits',
        cursor: 0,
        equip: { stage: 'char', char: 0, row: 0, pocket: 0 },
        items: { stage: 'slots', slot: 0, pick: 0 },
      };
    }
    try {
      drawTitle(ctx2, t, renderer.sprites, []);
    } catch (err) {
      failures.push(`drawTitle threw on page ${JSON.stringify(page)}: ${err.message}`);
    }
  }
}

// THE CUSTOM ARENA'S NINE-SLICE PATH. The fight smoke above cannot reach it:
// the fake entry has ONE frame and drawGrowtangle falls back to the plain
// spr_battlebg_0 path when spr_battlebg_stretch_hitbox has fewer than two.
// So drive it directly, with a two-frame entry, through every state the
// grow-in passes: born at scale 0 (must draw nothing, not hand drawImage a
// zero width), a box smaller than its 4px guides (corners clamp, edges hit
// zero), the grow-in (growcon 1, the baked custom box), steady (growcon 2)
// and the collapse (growcon 3) — plus a bare drawSpriteExtNineSlice at
// negative scale, which must simply return.
{
  const { drawGrowtangle, drawSpriteExtNineSlice } = await import('../render/draw/gm.js');
  const twoFrames = { frames: [fakeImg, { ...fakeImg, src: 'stub://frame1' }], meta: { ox: 37, oy: 37, w: 75, h: 75 } };
  const sprites = new Map([['spr_battlebg_0', twoFrames], ['spr_battlebg_stretch_hitbox', twoFrames]]);
  // The counting stub swallows anything; a browser's drawImage does not throw
  // on a zero-width slice either — it silently draws nothing, or worse,
  // draws the wrong region from a negative one. So this context is STRICT:
  // a non-finite or non-positive size in the nine-argument form is a failure.
  const inner = mkCtx();
  const ctx3 = new Proxy(inner, {
    get(t, p) {
      if (p !== 'drawImage') return t[p];
      return (...a) => {
        const r = a.slice(1);
        if (r.some((v) => !Number.isFinite(v))) throw new Error(`drawImage got ${r.join(',')}`);
        if (r.length === 8 && (r[2] <= 0 || r[3] <= 0 || r[6] <= 0 || r[7] <= 0)) {
          throw new Error(`nine-slice drawImage with a non-positive size: ${r.join(',')}`);
        }
        return t.drawImage(...a);
      };
    },
    set(t, p, v) { t[p] = v; return true; },
  });
  let step = 'nine-slice at scale 0 / negative';
  try {
    drawSpriteExtNineSlice(ctx3, twoFrames, 0, 0, 0, 0, 0, 0, null, 1, 4);
    drawSpriteExtNineSlice(ctx3, twoFrames, 1, 0, 0, -2, 2, 45, [0, 192, 0], 0.5, 4);
    drawSpriteExtNineSlice(ctx3, twoFrames, 0, 10, 10, 0.02, 0.02, 90, [0, 192, 0], 1, 4);
    const box = (over) => ({
      x: 320, y: 240, customBox: true, maxxscale: 2.24, maxyscale: 1.76, growscale: 2,
      maxtimer: 15, image_blend: [0, 192, 0], image_alpha: 1, image_angle: 0, ...over,
    });
    const cases = [
      ['born at 0', box({ growcon: 1, timer: 0, image_xscale: 0, image_yscale: 0 })],
      ['tinier than the guides', box({ growcon: 1, timer: 1, image_xscale: 2.24 / 15, image_yscale: 1.76 / 15, image_angle: 192 })],
      ['mid grow-in', box({ growcon: 1, timer: 7, image_xscale: 2.24 * 7 / 15, image_yscale: 1.76 * 7 / 15, image_angle: 264 })],
      ['landed', box({ growcon: 2, timer: 15, image_xscale: 2.24, image_yscale: 1.76 })],
      ['collapsing', box({ growcon: 3, timer: 3, image_xscale: 2.24 * 3 / 15, image_yscale: 1.76 * 3 / 15 })],
      ['stale flag on a 2x2 tween', box({ growcon: 2, timer: 15, maxxscale: 2, maxyscale: 2, image_xscale: 9.5, image_yscale: 7.1 })],
    ];
    for (const [name, e] of cases) {
      step = name;
      const handled = drawGrowtangle(ctx3, e, sprites, 'spr_battlebg_0');
      const custom = e.maxxscale !== 2 || e.maxyscale !== 2;
      if (handled !== custom) {
        failures.push(`drawGrowtangle(${name}) returned ${handled}; a custom arena must return true (drawn entirely) and a 2x2 box false (draw_self follows)`);
      }
    }
  } catch (err) {
    failures.push(`the custom-arena draw threw at "${step}": ${err.message}`);
  }
}

if (failures.length) {
  console.log('');
  for (const x of failures) console.log(`→ FAILURE  ${x}`);
  process.exit(1);
}
console.log('\nPASS  render smoke — the renderer survives a real fight (stub canvas)');
