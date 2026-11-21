/** Demon handlers. */
import { registerMinion } from './registry';
import { buff, hasTribe, randomFriendly, sd, summonRightOf } from './helpers';
import { adjacentTo } from './timewarped';

/** Impulsive Portrait (trinket): "Your Impulsive Tricksters' Deathrattles target adjacent minions." */
const IMPULSIVE_PORTRAIT = 'BG32_MagicItem_820';

export function registerDemons(): void {
  // Devout Hellcaller (T3): After another friendly Demon deals damage, gain +2/+2 permanently.
  registerMinion('BG33_155', {
    onFriendlyDealtDamage: (b, self, dealer) => {
      if (dealer !== self && hasTribe(dealer, 'DEMON')) buff(b, self, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 2 * self.mult));
    },
  });

  // Impulsive Trickster: Deathrattle: Give this minion's maximum Health to another friendly minion.
  // With Impulsive Portrait it targets the adjacent minions instead.
  registerMinion('BG21_006', {
    deathrattle: (b, self, ctx) => {
      if (self.side.effects.some((e) => e.cardId === IMPULSIVE_PORTRAIT)) {
        for (let i = 0; i < ctx.mult; i++) for (const t of adjacentTo(self, ctx)) buff(b, t, 0, self.maxHealth);
        return;
      }
      for (let i = 0; i < ctx.mult; i++) {
        const t = randomFriendly(b, self.side, undefined, self);
        if (t) buff(b, t, 0, self.maxHealth);
      }
    },
  });

  // Imp Gang Boss: Whenever this minion takes damage, summon a 1/1 Imp (golden 2/2).
  registerMinion('BG_BRM_006', {
    onDamaged: (b, self) => {
      summonRightOf(b, self, 'BG_BRM_006t', 1, { golden: self.golden });
    },
  });

  registerMinion(
    [
      'BGS_004', // Wrath Weaver
      'BG31_330', // Ominous Seer
      'BG35_150', // Laboratory Assistant
      'BG23_357', // Mind Muck
      'BG26_174', // Soul Rewinder (hero damage rewind: shop)
      'BG26_524', // Malchezaar
      'BG36_730', // Trapped Clapper (deathrattle affects the Tavern)
      'BG32_873', // Ashen Corruptor
      'BG36_731', // Imp-lusionist (deathrattle: get a card)
      'BG26_525', // Imposing Percussionist
      'BG36_362', // Sacrificial Wrathguard (deathrattle affects the Tavern)
      'BG36_503', // Soulkeeping Jailer
      'BG34_500', // Flaming Enforcer
      'BG36_621', // Deft Deserter
      'BG36_762', // Devilish Distractor (buffs the Tavern)
      'BG28_633', // Felboar
      'BG21_004', // Insatiable Ur'zul
      'BG26_523', // Tichondrius (hero damage happens outside combat)
      'BG36_733', // Eredar Escapist
      'BG35_155', // Twisted Wrathguard
      'BG27_016', // Champion of Sargeras (deathrattle affects the Tavern)
      'BGDUO_121', // Man'ari Messenger
      'BGDUO33_150', // Dark Dazzler
    ],
    { noCombatEffect: true },
  );
}
