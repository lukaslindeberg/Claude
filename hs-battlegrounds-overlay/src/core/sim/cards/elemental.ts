/** Elemental handlers. */
import { registerMinion } from './registry';
import { buffAll, dealDamage, neighbours, sd, tribeFilter } from './helpers';
import { TAG } from '../engine/constants';

const isElemental = tribeFilter('ELEMENTAL');

export function registerElementals(): void {
  // Wildfire Elemental (T3): After this attacks and kills a minion, deal excess damage to an
  // adjacent enemy (golden: both adjacent enemies).
  registerMinion('BGS_126', {
    afterAttack: (b, self, info) => {
      if (!info.killed || info.excess <= 0) return;
      const adj = neighbours(info.target);
      const targets = self.golden ? adj : b.rng.sample(adj, 1);
      for (const t of targets) dealDamage(b, self, t, info.excess);
    },
  });

  // Ultraviolet Ascendant (T6): Start of Combat: Give your other Elementals +4/+4 (improves; tags).
  registerMinion('BG31_810', {
    startOfCombat: (b, self) =>
      buffAll(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 4 * self.mult), isElemental, self),
  });

  // Flourishing Frostling (token): Has +2/+1 for each Elemental you played this game.
  registerMinion('BG26_537', {
    init: (b, self) => {
      if (self.snapshot) return; // snapshot stats already include the bonus
      const played = self.side.playerTags[TAG.ELEMENTALS_PLAYED] ?? 0;
      self.attack += sd(b, self, 1, 2 * self.mult) * played;
      self.health += sd(b, self, 2, self.mult) * played;
      self.maxHealth = self.health;
    },
  });

  registerMinion(
    [
      'BG31_815', // Dune Dweller
      'BG31_816', // Fire Baller
      'BGS_115', // Sellemental
      'BG31_818', // Snow Baller
      'BGDUO31_201', // Gathering Stormer
      'BG34_856', // Waveling (deathrattle affects the Tavern)
      'BG36_181', // Air Baller
      'BG34_865', // En-Djinn Blazer
      'BG35_881', // Leyline Surfacer (deathrattle: get a card)
      'BG36_180', // Living Prison
      'BGS_116', // Refreshing Anomaly
      'BGS_123', // Tavern Tempest
      'BGDUO_110', // Feisty Freshwater (deathrattle: refreshes)
      'BG31_812', // Ichoron the Protector
      'BG34_858', // Air Revenant
      'BG35_882', // Firelands Fugitive
      'BG28_707', // Living Azerite (buffs the Tavern)
      'BG26_175', // Elemental of Surprise
      'BG36_352', // Unbound Tempest
      'BG34_950', // Stone Age Slab
    ],
    { noCombatEffect: true },
  );
}
