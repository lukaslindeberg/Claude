/** Naga handlers (Spellcraft is a shop mechanic; a few react to spells cast in combat). */
import { registerMinion } from './registry';
import { buff, buffAll, castSpell, hasTribe, neighbours, sd, tribeFilter } from './helpers';
import { cardsAddedToHand } from './aberration';

const isNaga = tribeFilter('NAGA');

export function registerNaga(): void {
  // Fleeing Fugitive (T1): Whenever you cast a spell on this, gain +1 Health.
  registerMinion('BG36_921', {
    onSpellCast: (b, self, _spell, target) => {
      if (target === self) buff(b, self, 0, sd(b, self, 1, self.mult));
    },
  });

  // Abyssal Bruiser (T4): Divine Shield. Has +2/+1 for each Tavern spell you've cast this game.
  registerMinion('BG35_921', {
    onSpellCast: (b, self) => buff(b, self, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, self.mult)),
  });

  // Seafloor Recruiter (T4): Rally: Cast Chef's Choice on the minion to the right (golden: twice).
  registerMinion('BG34_925', {
    rally: (b, self) => {
      const board = self.side.board;
      const i = board.indexOf(self);
      const right = neighbours(self).find((n) => board.indexOf(n) > i);
      if (!right) return;
      const before = self.side.spellsCastThisCombat;
      for (let k = 0; k < self.mult; k++) castSpell(b, self.side, 'BG28_518', right);
      // Each Chef's Choice cast gets a card.
      cardsAddedToHand(b, self.side, self.side.spellsCastThisCombat - before);
    },
  });

  // Showy Cyclist (T5): Deathrattle: Give all your Naga +2/+X (improves; tags SD2/SD4).
  registerMinion('BG31_925', {
    deathrattle: (b, self, ctx) =>
      buffAll(b, self.side, sd(b, self, 2, 2 * ctx.mult), sd(b, self, 4, ctx.mult), isNaga),
  });

  // Torrential Ruiner (T6): Whenever you cast a spell on a Naga, give your minions +2/+3.
  registerMinion('BG36_622', {
    onSpellCast: (b, self, _spell, target) => {
      if (target && hasTribe(target, 'NAGA')) {
        buffAll(b, self.side, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 3 * self.mult));
      }
    },
  });

  registerMinion(
    [
      'BG23_000', // Mini-Myrmidon
      'BG23_009', // Lava Lurker
      'BG23_002', // Shell Collector
      'BG31_924', // Thaumaturgist
      'BG23_004', // Deep-Sea Angler
      'BG23_007', // Waverider
      'BG36_508', // Cagey Conjurer
      'BG33_319', // Rimescale Priestess
      'BG26_505', // Zesty Shaker
      'BGDUO31_209', // Private Chef
      'BG31_920', // Darkcrest Strategist
      'BG23_008', // Glowscale (Taunt)
      'BG32_835', // Tranquil Meditative
      'BG31_035', // Groundbreaker
      'BG32_837', // Fauna Whisperer
      'BG27_514', // Sea Witch Zar'jira
      'BGDUO_122', // Storm Splitter
    ],
    { noCombatEffect: true },
  );
}
