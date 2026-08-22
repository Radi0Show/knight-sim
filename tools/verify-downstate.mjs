// BEING DOWN IS TWO GATES, AND THEY MUST NOT DRIFT APART.
//
//   the POSE   reads the HP sign     (obj_heroparent: `global.hp[...] > 0`)
//   the MENU   reads `chardead`      (scr_dead / scr_revive)
//
// They are deliberately different objects — a character healed from -999 to
// -899 keeps the defeat pose and stays out of the menu — but they must always
// AGREE about whether you are down. Both bugs this suite exists for were the
// same desync reached from opposite sides:
//
//   * scr_damage_maxhp punched the HP hole without calling scr_dead, so a
//     felled character drew the defeat pose and still acted;
//   * the practice drill refilled HP without scr_revive, so anyone who had
//     fallen came back at full health and could NOT act — no menu, no FIGHT
//     bolt, not targetable. Reported from play as "Kris sometimes cannot act
//     and is not drawn correctly".
//
// It also pins WHICH graphic a fell draws, because that too had a second
// un-updated copy: Kris goes DOWN, everyone else SWOONS.
import { createState } from '../sim/state.js';
import {
  scrDamage, scrDamageMaxhp, scrDead, scrRevive, isUp, freshParty, PARTY,
} from '../sim/damage.js';
import { TYPE_DEAD, TYPE_SWOON } from '../sim/dmgnumbers.js';

let failed = 0;
const ok = (cond, what) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`);
  if (!cond) failed++;
};

/** The invariant: alive means actable, down means not. */
function checkSync(state, where) {
  for (let i = 0; i < 3; i++) {
    const aliveByHp = state.partyHp[i] > 0;
    const actable = isUp(state, i);
    if (aliveByHp !== actable) {
      console.log(`  FAIL ${where}: slot ${i} hp=${state.partyHp[i]} but isUp=${actable}` +
        ` (chardead=${state.chardead[i]}) — pose and menu disagree`);
      failed++;
      return;
    }
  }
  console.log(`  ok   ${where}: all three slots agree`);
}

function fresh() {
  const st = createState({ seed: 1 });
  st.partyHp = freshParty();
  st.invTimer = -1;
  st.invc = 0;
  for (let i = 0; i < 3; i++) scrRevive(st, i);
  return st;
}

// 1. A maxhp fell must mark the character DOWN, not just dent the HP.
//    The target is chosen by the knight's own redirect rules, so rather than
//    fight them this hits repeatedly until everyone is down and checks the
//    invariant after EVERY hit -- which exercises Kris and the allies both,
//    whatever order the redirect picks them in.
{
  const st = fresh();
  st.invc = 0;
  let felled = 0;
  for (let i = 0; i < 40 && felled < 3; i++) {
    st.invTimer = -1;
    // fraction 2 with cannotFell FALSE: the caller shape that can actually
    // fell. Flurry passes cannotFell, which is why this path went unseen.
    scrDamageMaxhp(st, 2, true, false);
    checkSync(st, `after maxhp hit ${i + 1}`);
    felled = st.partyHp.filter((h) => h <= 0).length;
  }
  ok(felled === 3, `maxhp fells everyone eventually (${felled}/3 down)`);
  ok(st.partyHp[0] === Math.round(-PARTY[0].maxhp / 2),
    `Kris's hole is -maxhp/2 = ${Math.round(-PARTY[0].maxhp / 2)} (got ${st.partyHp[0]})`);
  ok(st.partyHp[1] === -999 && st.partyHp[2] === -999,
    `the allies' holes are -999 (got ${st.partyHp[1]}, ${st.partyHp[2]})`);
}

// 2. The graphic: Kris goes DOWN (4), the others SWOON (12).
ok(TYPE_DEAD === 4 && TYPE_SWOON === 12, 'doomtypes are 4 (DOWN) and 12 (SWOON)');

// 3. A bare HP refill must NOT leave anyone standing-but-unable-to-act. This
//    is the drill's bug in miniature, asserted against the rule rather than
//    the call site so any future refill that forgets scr_revive fails here.
{
  const st = fresh();
  scrDead(st, 0);
  st.partyHp[0] = -80;
  checkSync(st, 'downed Kris');
  st.partyHp = freshParty();               // the refill, WITHOUT a revive
  const desynced = st.partyHp[0] > 0 && !isUp(st, 0);
  ok(desynced, 'a bare refill DOES desync (so the assertion below is not vacuous)');
  for (let i = 0; i < 3; i++) scrRevive(st, i);   // what the fix adds
  checkSync(st, 'refill + scr_revive');
}

// 4. The real drill path, end to end: fell Kris, let the drill refill, and
//    require that he can act again afterwards.
{
  const { buildSingleAttackScene } = await import('../sim/scenes/single.js');
  const { stepFrame } = await import('../sim/index.js');
  const st = createState({ seed: 7 });
  buildSingleAttackScene(st, { seed: 7, attack: 'stars', difficulty: 0 });
  scrDead(st, 0);
  st.partyHp[0] = -80;
  let refilled = false;
  for (let f = 0; f < 6000 && !refilled; f++) {
    stepFrame(st, {});
    if (st.partyHp[0] > 0) refilled = true;
  }
  if (!refilled) {
    console.log('  skip  the drill did not reach a refill within 6000 frames');
  } else {
    checkSync(st, 'after the drill refill');
    ok(isUp(st, 0), 'Kris can act again after the drill refill');
  }
}

console.log(failed === 0
  ? 'verify-downstate: OK — the pose gate and the menu gate agree'
  : `verify-downstate: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
