// GameMaker `place_meeting` against obj_battlesolid.
//
// The soul's mask is spr_dodgeheartmask, 20x20, origin (0,0), SepMasks =
// AxisAlignedRect — so the soul occupies a plain 20x20 box anchored at its
// top-left. obj_battlesolid has *no* sprite on the object itself, so each
// instance is given a mask at runtime; solids here carry explicit w/h.
//
// UNVERIFIED, and the most likely source of the first T3 divergence: GameMaker
// bounding boxes are inclusive integer ranges (bbox L0 R19 means columns 0..19,
// i.e. 20 px), and it floors instance positions before testing. This
// implementation uses a half-open float AABB instead. They agree on integer
// positions, which is all the soul ever occupies while walking at speed 4 — but
// they will disagree the moment a sub-pixel position reaches the test. Settle
// it against the oracle before trusting any attack that pushes the soul.

export const SOUL_W = 20;
export const SOUL_H = 20;

export function placeMeetingSolid(state, x, y, w = SOUL_W, h = SOUL_H) {
  for (const o of state.entities) {
    if (!o.alive || !o.isSolid) continue;
    if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) {
      return true;
    }
  }
  return false;
}
