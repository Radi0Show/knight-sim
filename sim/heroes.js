// THE PARTY'S ANIMATION — `obj_heroparent`'s Step, which is one state machine
// shared by all three and parameterised by the sprite set its Create picks.
//
// Two fields drive everything:
//
//   `state`       what the character is DOING       0 idle · 1 attack ·
//                                                   2 spell · 4 item · 6 act ·
//                                                   7 victory
//   `faceaction`  what they are ABOUT to do, which
//                 picks the standing pose in state 0
//
// `faceaction` is the one that is easy to miss, because it does nothing until
// the character is idle: state 0 reads it to swap `idlesprite` for one of the
// *ready* poses. So choosing ITEM does not animate anything — it makes Kris
// hold the item out and WAIT, and the animation plays later when the turn
// resolves. A build that only tracked `state` would have three characters
// standing in neutral through the entire command phase.
//
//     0 idle · 1 attackready · 2 spellready · 3 itemready
//     4 defend · 6 actready · 9 defeat
//
// EVERY ANIMATION ADVANCES AT 0.5 A FRAME, not 1 — `attacktimer += 0.5`,
// `acttimer += 0.5`, `defendtimer += 0.5`. The battle runs at 30fps and the
// party animates at 15. Playing them at 1 makes everyone twitch.
//
// The idle bob is `index = siner / 5`, a fifth of a frame per step, so a
// 6-frame idle cycles over 30 frames — a second.
//
// SPRITE SETS, from obj_heroparent's Create. Kris has no spells, so his
// `spellready`/`spell` are literally his ACT sprites — which is consistent
// with `global.spell[1][0] = 7` being named "ACT".

/** `global.faceaction[]`. */
export const FACE_IDLE = 0;
export const FACE_ATTACK = 1;
export const FACE_SPELL = 2;
export const FACE_ITEM = 3;
export const FACE_DEFEND = 4;
export const FACE_ACT = 6;
export const FACE_DEFEAT = 9;

/** `state`. 3 and 5 are unused by this fight; 8 is the Tenna card trick. */
export const HERO_IDLE = 0;
export const HERO_ATTACK = 1;
export const HERO_SPELL = 2;
export const HERO_ITEM = 4;
export const HERO_ACT = 6;
export const HERO_VICTORY = 7;

/**
 * Per-character sprites and frame counts, verbatim from the Create.
 *
 * `frames` are NOT the sprites' own frame counts — they are the clamp the Step
 * uses (`if (attacktimer < attackframes) image_index = attacktimer`), and they
 * differ. `spr_krisb_act` has 11 frames but `actframes` is 7 and
 * `actreturnframes` is 10: the pose holds on frame 7 while the timer runs on
 * to 10, THEN the state ends. Using the sprite's own count would end the ACT
 * three frames early and skip the hold.
 */
export const HERO_SPRITES = [
  {
    name: 'KRIS',
    idle: 'spr_krisb_idle',
    defend: 'spr_krisb_defend',
    hurt: 'spr_krisb_hurt',
    attackready: 'spr_krisb_attackready',
    attack: 'spr_krisb_attack',
    item: 'spr_krisb_item',
    itemready: 'spr_krisb_itemready',
    actready: 'spr_krisb_actready',
    act: 'spr_krisb_act',
    // Kris has no spells; the Create points both at his ACT sprites.
    spellready: 'spr_krisb_actready',
    spell: 'spr_krisb_act',
    defeat: 'spr_krisb_defeat',
    victory: 'spr_krisb_victory',
    attackframes: 6, itemframes: 6, defendframes: 5,
    actframes: 7, actreturnframes: 10, spellframes: 10,
  },
  {
    name: 'SUSIE',
    idle: 'spr_susieb_idle',
    defend: 'spr_susieb_defend',
    hurt: 'spr_susieb_hurt',
    attackready: 'spr_susieb_attackready',
    attack: 'spr_susieb_attack',
    item: 'spr_susieb_item',
    itemready: 'spr_susieb_itemready',
    actready: 'spr_susieb_actready',
    act: 'spr_susieb_act',
    spellready: 'spr_susieb_spellready',
    spell: 'spr_susieb_spell',
    defeat: 'spr_susieb_defeat',
    victory: 'spr_susieb_victory',
    // THE ROWS WERE SHIFTED BY ONE CHARACTER. This read 6/6/7 — Ralsei's
    // counts — while obj_heroparent's Create gives Susie 5/5/5. The visible
    // result was her FIGHT swing: the animation clamps at `attackframes`, so
    // a 6 ran it one frame past the end of spr_susieb_attack (6 frames, 0-5)
    // and the wrap landed the HELD pose on frame 0, the wind-up. She finished
    // every swing by snapping back into the start of it and standing there —
    // reported from play as a mid-axe-swing stuck over her idle.
    attackframes: 5, itemframes: 5, defendframes: 5,
    actframes: 7, actreturnframes: 10, spellframes: 8,
  },
  {
    name: 'RALSEI',
    idle: 'spr_ralsei_idle',
    defend: 'spr_ralsei_defend',
    hurt: 'spr_ralsei_hurt_fixed',
    attackready: 'spr_ralsei_attackready',
    attack: 'spr_ralsei_attack',
    item: 'spr_ralsei_item',
    itemready: 'spr_ralsei_itemready',
    actready: 'spr_ralsei_actready',
    act: 'spr_ralsei_act',
    spellready: 'spr_ralsei_spellready',
    spell: 'spr_ralsei_spell',
    defeat: 'spr_ralsei_defeat',
    victory: 'spr_ralsei_victory',
    // ...and this row was NOELLE's (4/9/0, spell 6) — she is the next block
    // down in the same Create and is not even in this fight. The note that
    // used to sit here explained Ralsei's `defendframes = 0` as faithful; it
    // was Noelle's zero, and it meant his defend pose never animated at all.
    // Ralsei's block assigns no spellframes, so he keeps the Create's default
    // of 10 rather than Noelle's 6.
    attackframes: 6, itemframes: 6, defendframes: 7,
    actframes: 7, actreturnframes: 10, spellframes: 10,
  },
];

export function createHeroes() {
  return [0, 1, 2].map(() => ({
    state: HERO_IDLE,
    faceaction: FACE_IDLE,
    siner: 0,
    attacktimer: 0,
    acttimer: 0,
    defendtimer: 0,
    hurttimer: 0,
    hurt: 0,
    index: 0,
    sprite: null,
    // `itemed` / `spelltimer` — the SPELL and ITEM poses' exit, see stepHero.
    itemed: false,
    spelltimer: 0,
  }));
}

/**
 * One frame for one character: the hp-wrapped pose machine, then the one
 * block obj_heroparent's Step runs OUTSIDE that wrapper.
 */
function stepHero(h, spec, down) {
  stepHeroPose(h, spec, down);

  // THE SPELL AND ITEM POSES END THEMSELVES, sixteen frames after entry.
  // obj_heroparent Step:444-461, top level — AFTER the `global.hp > 0`
  // wrapper closes at :444, so it counts down through a flinch and through
  // a defeat alike:
  //
  //     if (spelltimer > 0) {
  //         spelltimer--;
  //         if (spelltimer == 0) {
  //             if (spellframes > 0) global.faceaction[myself] = 0;
  //             if (scr_monsterpop() > 0) scr_spell(global.charspecial[myself], myself);
  //             state = 0;
  //             attacktimer = 0;
  //         }
  //     }
  //
  // Both the state-2 and the state-4 blocks arm it on entry (`if (itemed ==
  // 0) { itemed = 1; spelltimer = 16; }`, :118-124 and :149-156), and the
  // entry frame's own countdown takes it to 15 — so the pose lasts exactly
  // sixteen Steps, for every character, whatever its frame count. The sim
  // used to hold ITEM until `attacktimer > itemframes + 8` and SPELL until
  // `spellframes + 8` — an invented exit that held Susie's item pose 27
  // frames and her spell 33, Kris's and Ralsei's 29 / 37 (repro: stepped
  // headlessly from heroAct until state returned to 0). The report asked for
  // the poses to be KEPT; the game does the opposite, and the sim was
  // already the one holding too long.
  //
  // The scr_spell call is NOT here: the sim resolves castSpell / applyItem
  // at the delayed entry (practice.js), sixteen frames before the game does.
  // That is a separate, trace-visible question (HP and TP columns) and is
  // deliberately left where it is.
  if (h.spelltimer > 0) {
    h.spelltimer -= 1;
    if (h.spelltimer === 0) {
      if (spec.spellframes > 0) h.faceaction = FACE_IDLE;
      h.state = HERO_IDLE;
      h.attacktimer = 0;
    }
  }
}

/**
 * The pose machine. Mirrors the Step's branch order, which matters because
 * `hurt` short-circuits every other state: a character being hit does not
 * carry on with their item animation, they flinch.
 */
function stepHeroPose(h, spec, down) {
  // `if (global.hp[global.char[myself]] > 0)` wraps the WHOLE machine. A
  // downed character runs none of it and holds the defeat pose.
  if (down) {
    h.sprite = spec.defeat;
    h.index = 0;
    return;
  }

  if (h.hurt > 0) {
    h.hurt -= 1;
    h.sprite = spec.hurt;
    h.index = 0;
    return;
  }

  if (h.state === HERO_IDLE) {
    h.acttimer = 0;
    let sprite = spec.idle;
    if (h.faceaction === FACE_ATTACK) sprite = spec.attackready;
    if (h.faceaction === FACE_ITEM) sprite = spec.itemready;
    if (h.faceaction === FACE_SPELL) sprite = spec.spellready;
    if (h.faceaction === FACE_ACT) sprite = spec.actready;
    if (h.faceaction === FACE_DEFEAT) sprite = spec.defeat;

    if (h.faceaction === FACE_DEFEND) {
      // DEFEND is the one ready-pose that ANIMATES while standing: its timer
      // ramps to `defendframes` and holds. Every other pose is a still frame
      // over the idle bob.
      sprite = spec.defend;
      h.index = h.defendtimer;
      if (h.defendtimer < spec.defendframes) h.defendtimer += 0.5;
    } else {
      h.defendtimer = 0;
      h.index = h.siner / 5;
    }
    h.sprite = sprite;
    h.siner += 1;
    return;
  }

  // The three timed animations are the same shape: run the timer to the
  // clamp, hold there, and let whatever set the state decide when it ends.
  const run = (frames, sprite) => {
    h.index = Math.min(h.attacktimer, frames);
    h.sprite = sprite;
    h.attacktimer += 0.5;
  };

  if (h.state === HERO_ATTACK) {
    h.siner += 1;
    run(spec.attackframes, spec.attack);
    // `finishattacktimer = 11` — the pose holds past the last frame before the
    // character drops back to idle.
    if (h.attacktimer > spec.attackframes + 5) {
      h.state = HERO_IDLE;
      h.attacktimer = 0;
      h.faceaction = FACE_IDLE;
    }
    return;
  }
  // `if (itemed == 0) { itemed = 1; spelltimer = 16; }` — the first frame
  // of state 2 (:118-124) and of state 4 (:149-156), inside their `hurt == 0`
  // gates. The countdown that ends the pose is in stepHero, outside the hp
  // wrapper, where the GML has it.
  const arm = () => {
    if (!h.itemed) {
      h.itemed = true;
      h.spelltimer = 16;
    }
  };

  if (h.state === HERO_SPELL) {
    arm();
    run(spec.spellframes, spec.spell);
    return;
  }
  if (h.state === HERO_ITEM) {
    arm();
    run(spec.itemframes, spec.item);
    return;
  }
  if (h.state === HERO_ACT) {
    // ACT runs its own timer and has TWO clamps: the pose stops at
    // `actframes` but the state runs to `actreturnframes`, so there is a hold
    // at the end of the swing before the character straightens up.
    if (h.acttimer < spec.actframes) h.acttimer += 0.5;
    else h.acttimer += 0.5;
    h.sprite = spec.act;
    h.index = Math.min(h.acttimer, spec.actframes);
    if (h.acttimer >= spec.actreturnframes) {
      h.acttimer = 0;
      h.state = HERO_IDLE;
      h.faceaction = FACE_IDLE;
    }
    return;
  }
  if (h.state === HERO_VICTORY) {
    h.sprite = spec.victory;
    h.index = h.attacktimer;
    h.attacktimer += 0.5;
    return;
  }

  h.sprite = spec.idle;
}

export function stepHeroes(state) {
  if (!state.heroes) return;
  for (let c = 0; c < 3; c++) {
    // THE POSE GATE IS THE HP SIGN, not `chardead` — obj_heroparent reads
    // `global.hp[global.char[myself]] > 0` in both its Step and its Draw. So a
    // character healed from -999 to -899 keeps the defeat pose (still
    // negative) while `chardead` is what keeps them out of the menu and off
    // the target list. Two different gates on purpose; verify-animation
    // catches a swap in either direction.
    stepHero(state.heroes[c], HERO_SPRITES[c], (state.partyHp?.[c] ?? 1) <= 0);
  }
}

/** Put a character into a timed animation. Resets the timer, as the Step does. */
export function heroAct(state, c, heroState) {
  const h = state.heroes?.[c];
  if (!h) return;
  h.state = heroState;
  h.attacktimer = 0;
  h.acttimer = 0;
  // Re-arm the SPELL/ITEM exit. The game enters state 2/4 ONCE, at
  // obj_attackpress's `maxdelaytimer == spelldelay` (Draw:13-35), and so does
  // the sim now (practice.js) — sim/menu.js used to enter the pose at the
  // selection as well, and that early copy expired mid-menu once the exit
  // counted the game's sixteen frames. Resetting here keeps the count from
  // whichever entry is the latest. The fade reset in practice.js clears
  // `itemed` too, as obj_attackpress Draw:225-234 does.
  h.itemed = false;
  h.spelltimer = 0;
}

/** `hurt` — the flinch, which overrides everything for its duration. */
export function heroHurt(state, c, frames = 12) {
  const h = state.heroes?.[c];
  if (h) h.hurt = frames;
}
