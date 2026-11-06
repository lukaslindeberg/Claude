/** Neutral (no tribe) and all-type minion handlers. */
import { LOBBY_TRIBES } from '@shared/types';
import { registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  dealDamage,
  destroy,
  giveDivineShield,
  hasTribe,
  isAlive,
  randomFriendly,
  randomFriendlies,
  sd,
} from './helpers';
import type { Minion } from '../engine/types';

export function registerNeutrals(): void {
  // Boom-in-a-Box (T4): Taunt. Start of Combat: Deal 3 damage to all other minions (golden: twice).
  registerMinion('BG36_620', {
    startOfCombat: (b, self) => {
      const dmg = sd(b, self, 1, 3);
      for (let i = 0; i < self.mult; i++) {
        const victims = [...aliveMinions(self.side), ...aliveMinions(self.side.opponent)].filter((m) => m !== self);
        for (const v of victims) dealDamage(b, self, v, dmg);
      }
    },
  });

  // Heroic Underdog (T4): Stealth. Rally: Gain the target's Attack (golden: double).
  registerMinion('BG34_604', {
    rally: (b, self, target) => buff(b, self, target.attack * self.mult, 0),
  });

  // Sin'dorei Straight Shot (T4): Divine Shield, Windfury. Rally: Remove Reborn and Taunt from the target.
  registerMinion('BG25_016', {
    rally: (_b, _self, target) => {
      target.reborn = false;
      target.taunt = false;
    },
  });

  // Leeroy the Reckless (T5): Deathrattle: Destroy the minion that killed this.
  registerMinion('BG23_318', {
    deathrattle: (b, self, ctx) => {
      const k = ctx.killer;
      if (k && k.side !== self.side && isAlive(k)) destroy(b, k, self);
    },
  });

  // Selfless Hero: Deathrattle: Give a random friendly minion Divine Shield (golden: 2).
  registerMinion('BG_OG_221', {
    deathrattle: (b, self, ctx) => {
      for (const t of randomFriendlies(b, self.side, ctx.mult, (m) => !m.divineShield, self)) giveDivineShield(b, t);
    },
  });

  // The Last One Standing (T7): Rally: Give a friendly minion of each type +10/+10 (golden: twice).
  // ("improve this" is not simulated.)
  registerMinion('BG34_320', {
    rally: (b, self) => {
      const a = sd(b, self, 1, 10);
      const h = sd(b, self, 2, 10);
      for (let r = 0; r < self.mult; r++) {
        const used = new Set<Minion>();
        for (const tribe of LOBBY_TRIBES) {
          const t = randomFriendly(b, self.side, (m) => !used.has(m) && m.tribes.length > 0 && hasTribe(m, tribe));
          if (!t) continue;
          used.add(t);
          buff(b, t, a, h);
        }
      }
    },
  });

  // Titus Rivendare and Balinda Stonehearth are handled by the engine (deathrattle multiplier,
  // targeted spell casts).
  registerMinion(['BG25_354', 'BG35_883'], { noCombatEffect: true });

  registerMinion(
    [
      'BGDUO_114', // Passenger
      'BG36_345', // Suspicious Prisonguard
      'BG36_354', // Decoy Conjurer
      'BGDUO_104', // Friendly Saloonkeeper
      'BG32_237', // Intrepid Botanist
      'BG24_715', // Patient Scout
      'BGDUO_100', // Wanderer Cho
      'BGS_131', // Deadly Spore (Venomous)
      'BG36_346', // Fruit Vendor
      'BG27_000', // Iron Groundskeeper
      'BGDUO_115', // Jumping Jack
      'BGDUO_119', // Orc-estra Conductor
      'BG28_303', // Disguised Graverobber
      'BG36_372', // Holy Vanguard (stats in snapshot)
      'BG32_341', // Humon'gozz
      'BG24_018', // Tortollan Blue Shell
      'BG_LOE_077', // Brann Bronzebeard
      'BG35_123', // Cataclysmic Harbinger
      'BG26_ICC_901', // Drakkari Enchanter
      'BG28_550', // Rodeo Performer
      'BG32_111', // Nightmare Par-tea Guest (deathrattle: get a card)
      'BG36_356', // Tyrael
      'BG34_319', // Highkeeper Ra (gets cards)
      'BGDUO_108', // Mirror Monster
      'BGDUO_120', // Well Wisher
      'BGDUO31_212', // Mantid King (triggers on Pass: shop)
      'TB_BaconShop_HP_033t', // Amalgam (Venomous)
      'BG28_Reward_518t', // Totally Normal Horse
    ],
    { noCombatEffect: true },
  );
}
