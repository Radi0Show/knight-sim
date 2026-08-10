// Sprite loading for the renderer.
//
// Art is extracted from the player's own data file into assets/sprites (see
// knight-research/tools/patches — the dump is a UTMT `dump --sprites`, then
// filtered to the ~96 sprites the fight code actually references).
//
// manifest.json carries what the PNGs cannot: GameMaker's per-sprite ORIGIN.
// Every draw is positioned relative to it, so without these the art lands
// offset from where the physics is — the classic sprite/hitbox mismatch this
// project exists to avoid.

const BASE = '../assets/sprites/';

/** Object type name -> sprite name. Entities may override with `sprite`. */
export const SPRITE_FOR = {
  obj_heart: 'spr_dodgeheart',
  obj_growtangle: 'spr_battlebg_0',
  obj_roaringknight_split_bullet: 'spr_roaringknight_tooth',
  obj_roaringknight_fountain_bullet: 'spr_rk_fountain_bullet',
  obj_roaringknight_slash: 'spr_rk_quickslash_marker',
  obj_knight_enemy: 'spr_roaringknight_idle',
};

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    // A missing frame must not wedge startup; the renderer falls back to the
    // collision-mask drawing for anything that fails.
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * Load the manifest and every frame it lists.
 * @returns {Promise<Map<string, {meta: object, frames: HTMLImageElement[]}>>}
 */
export async function loadSprites(base = BASE) {
  const res = await fetch(base + 'manifest.json');
  if (!res.ok) throw new Error(`sprite manifest not found at ${base}manifest.json`);
  const manifest = await res.json();

  const out = new Map();
  const jobs = Object.entries(manifest).map(async ([name, meta]) => {
    const frames = await Promise.all(meta.files.map((f) => loadImage(base + f)));
    out.set(name, { meta, frames: frames.filter(Boolean) });
  });
  await Promise.all(jobs);
  return out;
}
