/** Pirate handlers. */
import { registerMinion } from './registry';
import { attackImmediately, buffAll, sd, summonForDeath } from './helpers';

export function registerPirates(): void {
  // Blade Collector (T4): Also damages the enemies next to whomever this attacks.
  registerMinion('BG26_817', { init: (_b, self) => void (self.cleave = true) });

  // Ship Master Eudora (T5): Deathrattle: Give your minions +8/+8 (golden: twice).
  registerMinion('BG33_828', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) buffAll(b, self.side, sd(b, self, 1, 8), sd(b, self, 2, 8));
    },
  });

  // Scallywag: Deathrattle: Summon a 1/1 Pirate. It attacks immediately.
  registerMinion('BGS_061', {
    deathrattle: (b, self, ctx) => {
      const [p] = summonForDeath(b, self, ctx, ctx.golden ? 'TB_BaconUps_141t' : 'BGS_061t', 1);
      if (p) attackImmediately(b, p);
    },
  });

  registerMinion(
    [
      'BG26_135', // Southsea Busker
      'BG36_520', // Bilgewater Breakout
      'BG36_342', // Clever Castaway
      'BG32_235', // Surfing Sylvar
      'BG33_830', // Azsharan Cutlassier
      'BG36_369', // Greedy Conniver
      'BG36_521', // Locked-up Mutineer (deathrattle: Lockbox)
      'BG36_763', // Treasure Parrot
      'BGDUO31_207', // Wheeled Crewmate
      'BGDUO_118', // Plunder Pal
      'BG33_822', // Bigwig Bandit (Rally: get a Bounty)
      'BG26_810', // Gunpowder Courier
      'BG26_814', // Lovesick Balladist
      'BG36_524', // Maritime Extortionist (stats in snapshot)
      'BG32_231', // Elite Navigator
      'BG36_523', // Enterprising Escapee
      'BG33_825', // Proud Privateer
      'BG33_821', // Shipwrecked Rascal (deathrattle: get a Bounty)
      'BG36_344', // Hooktusk, Master Marauder
      'BG36_343', // Silent Deliverer
      'BG33_823', // Sky Admiral Rogers
      'BG25_034', // Captain Sanders
      'BGS_061t', // Sky Pirate
    ],
    { noCombatEffect: true },
  );
}
