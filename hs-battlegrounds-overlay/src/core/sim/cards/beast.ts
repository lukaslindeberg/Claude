/** Beast handlers. */
import { registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  buffAll,
  counter,
  hasDeathrattle,
  hasTribe,
  improveBeetles,
  isRallyMinion,
  leftMost,
  minionFromCard,
  randomFriendly,
  randomPoolMinion,
  rightOfAnchor,
  sd,
  setCounter,
  summon,
  summonBeetles,
  summonForDeath,
  summonRightOf,
  summonTokens,
  triggerDeathrattlesArtificially,
  tribeFilter,
} from './helpers';
import type { CardHandler } from '../engine/types';

const isBeast = tribeFilter('BEAST');

/** "Deathrattle: Summon a 2/2 Beetle" (golden: two). */
const beetleDeathrattle: CardHandler['deathrattle'] = (b, self, ctx) => {
  summonBeetles(b, self.side, ctx.mult, ctx.anchor);
};

export function registerBeasts(): void {
  // Buzzing Vermin (T1): Taunt. Deathrattle: Summon a 2/2 Beetle.
  registerMinion('BG31_803', { deathrattle: beetleDeathrattle });
  // Forest Rover (T2): Battlecry: Beetles +X/+X. Deathrattle: Summon a 2/2 Beetle.
  registerMinion('BG31_801', { deathrattle: beetleDeathrattle });
  // Nest Swarmer: Deathrattle: Summon three 2/2 Beetles.
  registerMinion('BG31_807', {
    deathrattle: (b, self, ctx) => {
      summonBeetles(b, self.side, 3 * ctx.mult, ctx.anchor);
    },
  });
  // Turquoise Skitterer (T5): Deathrattle: Your Beetles have +X/+X this game. Summon a 2/2 Beetle.
  registerMinion('BG31_809', {
    deathrattle: (b, self, ctx) => {
      improveBeetles(b, self.side, sd(b, self, 3, 5 * ctx.mult), sd(b, self, 4, 5 * ctx.mult));
      summonBeetles(b, self.side, ctx.mult, ctx.anchor);
    },
  });
  // Runed Progenitor: Avenge (3): Your Beetles have +X/+X this game. Deathrattle: Summon a 2/2 Beetle.
  registerMinion('BG31_808', {
    avenge: 3,
    onAvenge: (b, self) => improveBeetles(b, self.side, sd(b, self, 3, 3 * self.mult), sd(b, self, 4, 2 * self.mult)),
    deathrattle: beetleDeathrattle,
  });
  // Silky Shimmermoth: Whenever this takes damage, Beetles +X/+X. Deathrattle: Summon a 2/2 Beetle.
  registerMinion('BG32_204', {
    onDamaged: (b, self) => improveBeetles(b, self.side, sd(b, self, 3, 2 * self.mult), sd(b, self, 4, 2 * self.mult)),
    deathrattle: beetleDeathrattle,
  });
  // Timewarped Nest Swarmer: Battlecry, Deathrattle and Rally: Beetles +X/+X. Summon a 2/2 Beetle.
  registerMinion('BG34_Giant_687', {
    rally: (b, self) => {
      improveBeetles(b, self.side, sd(b, self, 3, 2 * self.mult), sd(b, self, 4, 2 * self.mult));
      summonBeetles(b, self.side, self.mult, rightOfAnchor(self));
    },
    deathrattle: (b, self, ctx) => {
      improveBeetles(b, self.side, sd(b, self, 3, 2 * ctx.mult), sd(b, self, 4, 2 * ctx.mult));
      summonBeetles(b, self.side, ctx.mult, ctx.anchor);
    },
  });
  // Ravaging Scorpid (T6): After a friendly minion attacks, your Beetles have +X/+X this game.
  // Deathrattle: Summon a 2/2 Beetle.
  registerMinion('BG36_209', {
    afterFriendlyAttack: (b, self) =>
      improveBeetles(b, self.side, sd(b, self, 3, 4 * self.mult), sd(b, self, 4, 4 * self.mult)),
    deathrattle: beetleDeathrattle,
  });

  // Flittering Bat (T1): Rally: Summon a 1/1 Beast.
  registerMinion('BG36_200', {
    rally: (b, self) => {
      summonRightOf(b, self, 'BG36_200t', self.mult);
    },
  });

  // Humming Bird (T2): Start of Combat: For the rest of this combat, your Beasts have +1 Attack.
  registerMinion('BG26_805', {
    startOfCombat: (b, self) => {
      const a = self.mult;
      buffAll(b, self.side, a, 0, isBeast);
      self.side.summonBuffs.push({ tribe: 'BEAST', attack: a, health: 0 });
    },
  });

  // Tasty Lobster (T3): Deathrattle: Give a random friendly Beast +2/+1.
  registerMinion('BG36_202', {
    deathrattle: (b, self, ctx) => {
      const t = randomFriendly(b, self.side, isBeast, self);
      if (t) buff(b, t, sd(b, self, 1, 2 * ctx.mult), sd(b, self, 2, 1 * ctx.mult));
    },
  });

  // Wolf Pup (T3): Rally: Give your other minions +4/+1.
  registerMinion('BG36_207', {
    rally: (b, self) => buffAll(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 1 * self.mult), undefined, self),
  });

  // Banana Slamma (T4): After you summon a Beast in combat, double (golden: triple) its Attack.
  registerMinion('BG26_802', {
    afterFriendlySummon: (b, self, summoned) => {
      if (!hasTribe(summoned, 'BEAST')) return;
      buff(b, summoned, summoned.attack * (self.golden ? 2 : 1), 0);
    },
  });

  // Cage Gnawer (T4): Whenever a friendly Beast attacks, give your Beasts +2/+1.
  registerMinion('BG36_211', {
    onFriendlyAttack: (b, self, attacker) => {
      if (!hasTribe(attacker, 'BEAST')) return;
      buffAll(b, self.side, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 1 * self.mult), isBeast);
    },
  });

  // Hoarding Hyena (T4): Rally: Summon a Tasty Lobster (golden: a Golden Tasty Lobster).
  registerMinion('BG36_210', {
    rally: (b, self) => {
      summonRightOf(b, self, 'BG36_202', 1, { golden: self.golden });
    },
  });

  // Ghastcoiler (T5): Deathrattle: Summon 2 random Deathrattle minions.
  registerMinion('BGS_008', {
    deathrattle: (b, self, ctx) => {
      const n = 2 * ctx.mult;
      for (let i = 0; i < n; i++) {
        const card = randomPoolMinion(b, 'deathrattle-no-ghast', (c) => c.mechanics.includes('DEATHRATTLE') && c.id !== 'BGS_008');
        if (!card) break;
        if (!summonForDeath(b, self, ctx, card.id, 1).length) break;
      }
    },
  });

  // Goldrinn, the Great Wolf (T5): Deathrattle: Your Beasts have +7/+7 until next turn.
  registerMinion('BGS_018', {
    deathrattle: (b, self, ctx) => {
      const a = sd(b, self, 1, 7 * ctx.mult);
      const h = sd(b, self, 2, 7 * ctx.mult);
      buffAll(b, self.side, a, h, isBeast);
      self.side.summonBuffs.push({ tribe: 'BEAST', attack: a, health: h });
    },
  });

  // Lurking Leviathan (T5): Whenever you summon a Beast, give it +3 Attack (and improve - not simulated).
  registerMinion('BG35_602', {
    onFriendlySummon: (b, self, summoned) => {
      if (hasTribe(summoned, 'BEAST')) buff(b, summoned, sd(b, self, 2, 3 * self.mult), 0);
    },
  });

  // Sewer Lord (T5): Deathrattle: Summon two Sewer Rats (golden: two Golden Sewer Rats).
  registerMinion('BG35_604', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, 'BG19_010', 2, { golden: ctx.golden });
    },
  });
  // Sewer Rat: Deathrattle: Summon a 2/3 Turtle with Taunt (golden: 4/6).
  registerMinion('BG19_010', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, 'BG19_010t', 1, { golden: ctx.golden });
    },
  });

  // Deathstrider (T6): After a friendly Rally minion attacks, trigger your left-most Deathrattle.
  registerMinion('BG36_208', {
    afterFriendlyAttack: (b, self, info) => {
      if (!isRallyMinion(b, info.attacker)) return;
      const dr = leftMost(self.side, hasDeathrattle);
      if (dr) triggerDeathrattlesArtificially(b, dr, self.mult);
    },
  });

  // Stalwart Kodo (T7): After you summon a different minion in combat, give it double
  // (golden: triple) this minion's maximum stats. (3 times per combat.)
  registerMinion('BG34_322', {
    afterFriendlySummon: (b, self, summoned) => {
      const left = counter(self, 'left', 3);
      if (left <= 0) return;
      setCounter(self, 'left', left - 1);
      const k = self.golden ? 3 : 2;
      buff(b, summoned, self.attack * k, self.maxHealth * k);
    },
  });

  // Fish of N'Zoth: After a different friendly Deathrattle minion dies, gain its Deathrattle.
  registerMinion('TB_BaconShop_HP_105t', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead === self) return;
      const times = self.golden ? 2 : 1;
      for (let i = 0; i < times; i++) {
        const own = dead.handler?.deathrattle;
        if (own) self.extraDeathrattles.push({ sourceCardId: dead.cardId, golden: dead.golden, fn: own });
        for (const g of dead.extraDeathrattles) self.extraDeathrattles.push(g);
      }
    },
  });

  // Cave Hydra: Also damages the minions next to whomever this attacks.
  registerMinion('BG_LOOT_078', { init: (_b, self) => void (self.cleave = true) });

  // Stomping Stegodon (portrait): Rally: Give your other Beasts +3 Attack (and this Rally - not simulated).
  registerMinion('BG33_840', {
    rally: (b, self) => buffAll(b, self.side, sd(b, self, 1, 3 * self.mult), 0, isBeast, self),
  });

  // Fishbait: Deathrattle: Give the minion that killed this +5/+5.
  registerMinion('BG36_205', {
    deathrattle: (b, self, ctx) => {
      if (ctx.killer && !ctx.killer.removed) buff(b, ctx.killer, sd(b, self, 1, 5 * ctx.mult), sd(b, self, 2, 5 * ctx.mult));
    },
  });

  // Shop-only beasts (no combat effect beyond keywords/stats).
  registerMinion(
    [
      'BG36_201', // Lurking Lionfish
      'BG27_084', // Sprightly Scarab
      'BG36_204', // Headhunter Gryphon (Rally: get a card)
      'BG36_206', // Snarky Shark
      'BG26_801', // Rylak Metalhead (deathrattle triggers a Battlecry: shop effects)
    ],
    { noCombatEffect: true },
  );

  void aliveMinions;
  void minionFromCard;
  void summon;
  void summonTokens;
}
