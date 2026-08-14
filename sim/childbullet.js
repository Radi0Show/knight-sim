// scr_childbullet — the copy half. The GML creates the instance and then
// copies the parent's bullet bookkeeping onto it, each field guarded by a
// `!= -1` sentinel:
//
//     damage, grazepoints, timepoints, inv, target, grazed, grazetimer
//     element (unconditional)
//
// **`grazed` AND `grazetimer` TRAVEL TO THE CHILDREN.** A star that bursts
// while its grazed flag is up spawns six shards that are ALL born already
// grazed — their first touch of the graze box pays the 1/30 trickle, not the
// full entry bonus. Measured at whole-fight f287: the recording pays
// +2.0667 (one fresh star + one inherited-graze trickle) where the sim,
// spawning children with a clean flag, paid +4. Nothing in the child ever
// clears the flag (obj_knight_pointing_starchild has no graze logic of its
// own), so an inherited graze trickles for the shard's whole life.
export function scrChildbulletCopy(child, parent) {
  for (const f of [
    'damage', 'grazepoints', 'timepoints', 'inv', 'target',
    'grazed', 'grazetimer',
  ]) {
    const v = parent[f];
    if (v !== undefined && v !== -1) child[f] = v;
  }
  child.element = parent.element;
  return child;
}
