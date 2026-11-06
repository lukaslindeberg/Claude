/** Undead handlers. */
import { registerMinion } from './registry';
import {
  attackImmediately,
  buff,
  copyMinion,
  counter,
  destroy,
  giveDivineShield,
  giveReborn,
  improveUndeadAttack,
  neighbours,
  randomFriendlies,
  randomFriendly,
  randomPoolMinion,
  rightMost,
  sd,
  setCounter,
  summon,
  summonForDeath,
  summonRightOf,
  tribeFilter,
} from './helpers';
import { avengeGetsCards, cardsAddedToHand } from './aberration';
import type { Minion } from '../engine/types';

const isUndead = tribeFilter('UNDEAD');
const SKELETON = 'BG_ICC_026t';
const ETERNAL_KNIGHT = 'BG25_008';
const ETERNAL_KNIGHT_G = 'BG25_008_G';

function isEternalKnight(m: Minion): boolean {
  return m.cardId === ETERNAL_KNIGHT || m.cardId === ETERNAL_KNIGHT_G;
}

export function registerUndead(): void {
  // Harmless Bonehead (T1): Deathrattle: Summon two 1/1 Skeletons (golden: four).
  registerMinion('BG28_300', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, SKELETON, 2 * ctx.mult);
    },
  });

  // Cadaver Caretaker (T3): Deathrattle: Summon three 1/1 Skeletons (golden: six).
  registerMinion('BG30_125', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, SKELETON, 3 * ctx.mult);
    },
  });

  // Rot Hide Gnoll (T1): Has +1 Attack for each friendly minion that died this combat.
  registerMinion('BG25_013', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead !== self) buff(b, self, self.mult, 0);
    },
  });

  // Eternal Knight (T2): Has +4/+2 for each friendly Eternal Knight that died this game.
  registerMinion(ETERNAL_KNIGHT, {
    init: (b, self) => {
      if (self.snapshot) return; // snapshot stats already include the bonus
      const n = self.side.eternalKnightsDead;
      self.attack += sd(b, self, 1, 4 * self.mult) * n;
      self.health += sd(b, self, 2, 2 * self.mult) * n;
      self.maxHealth = self.health;
    },
    onSelfDeath: (_b, self) => {
      self.side.eternalKnightsDead++;
    },
    onFriendlyDeath: (b, self, dead) => {
      if (dead !== self && isEternalKnight(dead)) buff(b, self, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 2 * self.mult));
    },
  });

  // Scarlet Skull (T2): Reborn. Deathrattle: Give a friendly Undead +1/+2.
  registerMinion('BG25_022', {
    deathrattle: (b, self, ctx) => {
      const t = randomFriendly(b, self.side, isUndead, self);
      if (t) buff(b, t, ctx.mult, 2 * ctx.mult);
    },
  });

  // Handless Forsaken (T3): Deathrattle: Summon a 2/1 Hand with Reborn (golden: two).
  registerMinion('BG25_010', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, 'BG25_010t', ctx.mult);
    },
  });

  // Mummifier (T3): Deathrattle: Give a different friendly Undead Reborn (golden: 2).
  registerMinion('BG28_309', {
    deathrattle: (b, self, ctx) => {
      // "Different": not another Mummifier (normal or golden).
      const pool = (m: Minion) => isUndead(m) && !m.reborn && m.cardId !== 'BG28_309' && m.cardId !== 'BG28_309_G';
      for (const t of randomFriendlies(b, self.side, ctx.mult, pool, self)) giveReborn(t);
    },
  });

  // Plaguerunner (T4): Deathrattle: Your Undead have +2 Attack this game, wherever they are.
  registerMinion('BG34_690', {
    deathrattle: (b, self, ctx) => improveUndeadAttack(b, self.side, sd(b, self, 1, 2 * ctx.mult)),
  });

  // Barrier Banshee (T5): After a friendly minion is Reborn, gain Divine Shield and +8/+8.
  registerMinion('BG36_514', {
    onFriendlyReborn: (b, self) => {
      giveDivineShield(b, self);
      buff(b, self, sd(b, self, 1, 8 * self.mult), sd(b, self, 2, 8 * self.mult));
    },
  });

  // Eternal Summoner (T5): Reborn. Deathrattle: Summon 1 Eternal Knight (golden: a Golden one).
  registerMinion('BG25_009', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, ETERNAL_KNIGHT, 1, { golden: ctx.golden });
    },
  });

  // Eternal Tycoon (T5): Avenge (5): Summon an Eternal Knight. It attacks immediately.
  registerMinion('BG34_403', {
    avenge: 5,
    onAvenge: (b, self) => {
      const [k] = summonRightOf(b, self, ETERNAL_KNIGHT, 1, { golden: self.golden });
      if (k) attackImmediately(b, k);
    },
  });

  // Deathly Striker (T6): Avenge (4): Get a random Undead. Deathrattle: Summon it from your hand
  // for this combat only (golden: 2 each).
  registerMinion('BG31_835', {
    avenge: 4,
    onAvenge: (b, self) => setCounter(self, 'got', counter(self, 'got', 0) + cardsAddedToHand(b, self.side, self.mult)),
    deathrattle: (b, self, ctx) => {
      const n = counter(self, 'got', 0);
      for (let i = 0; i < n; i++) {
        const card = randomPoolMinion(b, 'undead', (c) => c.tribes.includes('UNDEAD'));
        if (!card || !summonForDeath(b, self, ctx, card.id, 1).length) break;
      }
      if (!ctx.artificial) setCounter(self, 'got', 0);
    },
  });

  // Forsaken Weaver (T6): After you cast a Tavern spell, your Undead have +3 Attack this game.
  registerMinion('BG34_692', {
    onSpellCast: (b, self) => improveUndeadAttack(b, self.side, sd(b, self, 1, 3 * self.mult)),
  });

  // Snazzy Phantom (T6): After a friendly minion is Reborn, give stats equal to its Attack to your
  // right-most Undead (golden: double).
  registerMinion('BG36_515', {
    onFriendlyReborn: (b, self, reborn) => {
      const t = rightMost(self.side, isUndead);
      const x = reborn.attack * self.mult;
      if (t && x > 0) buff(b, t, x, x);
    },
  });

  // Stitched Salvager (T7): Start of Combat: Destroy the minion to the left (golden: adjacent
  // minions). Deathrattle: Summon an exact copy of it.
  registerMinion('BG31_999', {
    startOfCombat: (b, self) => {
      const board = self.side.board;
      const i = board.indexOf(self);
      const adj = neighbours(self);
      const victims = self.golden ? adj : adj.filter((n) => board.indexOf(n) < i);
      for (const v of victims) {
        if (v.cardId === 'BG31_999' || v.cardId === 'BG31_999_G') continue;
        (self.stash ??= []).push(copyMinion(b, v));
        destroy(b, v, self);
      }
    },
    deathrattle: (b, self, ctx) => {
      for (const s of self.stash ?? []) {
        const m = copyMinion(b, s);
        if (!summon(b, self.side, m, ctx.anchor)) break;
      }
    },
  });

  // San'layn Scribe (Duos): Has +4/+4 for each of your team's Scribes that died this game.
  registerMinion('BGDUO31_208', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead !== self && dead.cardId.startsWith('BGDUO31_208')) buff(b, self, 4 * self.mult, 4 * self.mult);
    },
  });

  // Friendly Geist (T4): Deathrattle: Your Tavern spells give an extra +1 Attack this game.
  registerMinion('BG32_880', {
    deathrattle: (b, self, ctx) => void (self.side.spellAttackBonus += sd(b, self, 1, ctx.mult)),
  });
  // Drustfallen Butcher (T5): Avenge (4): Get a Butchering. Lichling Hoarder (T5): Avenge (3): Get a
  // plain copy of a minion (golden: 2). Only the cards reaching the hand matter in combat.
  registerMinion('BG32_324', avengeGetsCards(4, 1));
  registerMinion('BG36_848', avengeGetsCards(3, 1));

  registerMinion(
    [
      'BG25_001', // Risen Rider (keywords)
      'BG25_011', // Nerubian Deathswarmer (battlecry)
      'BG28_303', // Disguised Graverobber
      'BG36_511', // Dead Bellringer
      'BG32_340', // Maw Caster
      'BGDUO_112', // Grave Narrator (Avenge: teammate gets a card)
      'BG34_Giant_330', // Timewarped Radio Star (deathrattle: get a card)
      SKELETON,
      'BG25_010t', // Helping Hand (Reborn)
    ],
    { noCombatEffect: true },
  );

}
