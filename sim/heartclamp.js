// scr_heartclamp — translated from gml_GlobalScript_scr_heartclamp.
//
// The only caller in the entire game is obj_roaringknight_slash's End Step.
// Bounds derive from the box's live position and scale:
//   x in [gt.x - 75 + xthick + arg0,  gt.x + 75 - (20 + xthick + arg0)]
// with xthick = image_xscale*2 + 1 (= 5 at battle scale 2), via scr_get_box
// returning gt.x ± sprite_width*0.5. Oracle-verified: t4-slash rows 61-64,
// soul clamped to gt.x + 50 each jitter frame.

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function scrHeartclamp(state, arg0 = 0, arg1 = 0) {
  const gt = state.entities.find((e) => e.alive && e.type.name === 'obj_growtangle');
  if (!gt) return; // i_ex(obj_growtangle)

  const heart = state.soul;
  if (!heart || !heart.alive) return;

  const xthick = gt.image_xscale * 2 + 1;
  const ythick = gt.image_yscale * 2 + 1;
  const halfW = (gt.mask.w * gt.image_xscale) * 0.5; // sprite_width * 0.5
  const halfH = (gt.mask.h * gt.image_yscale) * 0.5;

  heart.x = clamp(heart.x, gt.x - halfW + xthick + arg0, gt.x + halfW - (20 + xthick + arg0));
  heart.y = clamp(heart.y, gt.y - halfH + ythick + arg1, gt.y + halfH - (20 + ythick + arg1));
}
