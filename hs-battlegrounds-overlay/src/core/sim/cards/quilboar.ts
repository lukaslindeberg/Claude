/** Quilboar handlers (Blood Gems). */
import { registerMinion } from './registry';
import {
  aliveMinions,
  attackImmediately,
  minionFromCard,
  playBloodGem,
  randomFriendly,
  rightOfAnchor,
  sd,
  summon,
} from './helpers';

import { getsCards } from './aberration';

export const JAILBIRD_GOLEM = 'BG36_333t';

export function registerQuilboar(): void {
  // Tusked Camper (T1): Rally: This plays a Blood Gem on itself (golden: 2).
  registerMinion('BG33_886', {
    rally: (b, self) => playBloodGem(b, self, self.mult),
  });

  // Prodigious Tusker (T2): Whenever another friendly minion attacks, this plays a Blood Gem on it.
  registerMinion('BG33_430', {
    onFriendlyAttack: (b, self, attacker) => {
      if (attacker !== self) playBloodGem(b, attacker, self.mult);
    },
  });

  // Bonker (T4): Windfury. Rally: This plays a Blood Gem on all your other minions (golden: 2).
  registerMinion('BG20_104', {
    rally: (b, self) => {
      const n = sd(b, self, 1, self.mult);
      for (const m of aliveMinions(self.side)) if (m !== self) playBloodGem(b, m, n);
    },
  });

  // Geomagus Roogug (T4): Divine Shield. Whenever a Blood Gem is played on this, this plays a
  // Blood Gem on a different friendly minion (golden: 2).
  registerMinion('BG28_583', {
    onBloodGem: (b, self) => {
      const t = randomFriendly(b, self.side, undefined, self);
      if (t) playBloodGem(b, t, self.mult);
    },
  });

  // Razorfen Vineweaver (T5): Rally: This plays 4 permanent Blood Gems on itself (golden: 8).
  registerMinion('BG33_883', {
    rally: (b, self) => playBloodGem(b, self, sd(b, self, 1, 4 * self.mult)),
  });

  // Sanguine Refiner (T5): Rally: Your Blood Gems give an extra +1/+1 this game.
  registerMinion('BG33_885', {
    rally: (b, self) => {
      self.side.bloodGemAttack += sd(b, self, 1, self.mult);
      self.side.bloodGemHealth += sd(b, self, 2, self.mult);
    },
  });

  // Sanguine Champion (T6): Battlecry and Deathrattle: Your Blood Gems give an extra +2/+1 this game.
  registerMinion('BG23_017', {
    deathrattle: (b, self, ctx) => {
      self.side.bloodGemAttack += sd(b, self, 1, 2 * ctx.mult);
      self.side.bloodGemHealth += sd(b, self, 2, ctx.mult);
    },
  });

  // Jailbird Juggernaut (T7): Rally: Summon a Golem with this minion's stats (golden: double) to
  // attack the target first.
  registerMinion('BG36_333', {
    rally: (b, self, target) => {
      const k = self.mult;
      const golem = minionFromCard(b, self.side, JAILBIRD_GOLEM, {
        name: 'Golem',
        attack: self.attack * k,
        health: self.health * k,
        tribes: [],
        tier: 1,
      });
      if (summon(b, self.side, golem, rightOfAnchor(self))) attackImmediately(b, golem, target);
    },
  });

  // Cards gained in combat (only the hand count matters, for The Shadow of Doubt; golden: 2):
  registerMinion('BG20_101', getsCards(1, 'rally')); // Roadboar: Rally: Get a Blood Gem
  registerMinion('BG36_331', getsCards(1, 'rally')); // Bramble Tunneler: Rally: Get a Choose One card
  registerMinion('BG34_682', getsCards(1, 'deathrattle')); // Razorfen Flapper: Deathrattle: Get a Blood Gem Barrage
  registerMinion('BGDUO_111', getsCards(1, 'deathrattle')); // Generous Geomancer: Deathrattle: Get a Blood Gem

  registerMinion(
    [
      'BG20_100', // Razorfen Geomancer
      'BG31_320', // Crater Miner
      'BG30_123', // Fearless Foodie
      'BG31_326', // Gem Rat
      'BG28_582', // Mangled Bandit
      'BG36_330', // Sly Infiltrator
      'BG31_327', // Thorned Trailblazer
      'BG34_684', // Trench Fighter
      'BG36_332', // Snare Trapper
      'BG30_121', // Hot-Air Surveyor
      'BG31_323', // Turbo Hogrider
      'BG36_341', // Veteran Brigand
      'BG36_370', // Victorious Geomant
      'BGDUO31_202', // Loyal Mobster
      'BG24_707', // Bristlemane Scrapsmith (gets Blood Gems)
      JAILBIRD_GOLEM,
    ],
    { noCombatEffect: true },
  );
}
