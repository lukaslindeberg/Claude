/** Dragon handlers. */
import { registerMinion } from './registry';
import {
  attackImmediately,
  buff,
  buffAll,
  castSpell,
  counter,
  dealDamage,
  giveDivineShield,
  hasTribe,
  neighbours,
  randomFriendlies,
  sd,
  setCounter,
  tribeFilter,
} from './helpers';

const isDragon = tribeFilter('DRAGON');

export function registerDragons(): void {
  // Glim Guardian (T1): Rally: Gain +2 Attack.
  registerMinion('BG29_888', {
    rally: (b, self) => buff(b, self, sd(b, self, 1, 2 * self.mult), 0),
  });

  // Scarlet Survivor (T1): Once this reaches 6 Attack, gain Divine Shield.
  registerMinion('BG35_814', {
    init: (b, self) => setCounter(self, 'done', self.attack >= sd(b, self, 1, 6) ? 1 : 0),
    onStatsChanged: (b, self) => {
      if (counter(self, 'done', 0)) return;
      if (self.attack >= sd(b, self, 1, 6)) {
        setCounter(self, 'done', 1);
        giveDivineShield(b, self);
      }
    },
  });

  // Electric Synthesizer (T2): Battlecry and Start of Combat: Give your other Dragons +1/+1.
  registerMinion('BG26_963', {
    startOfCombat: (b, self) => buffAll(b, self.side, self.mult, self.mult, isDragon, self),
  });

  // Amber Guardian (T3): Taunt. Start of Combat: Give another friendly Dragon +2/+2 and Divine Shield.
  registerMinion('BG24_500', {
    startOfCombat: (b, self) => {
      const targets = randomFriendlies(b, self.side, self.mult, isDragon, self);
      for (const t of targets) {
        buff(b, t, sd(b, self, 1, 2), sd(b, self, 2, 2));
        giveDivineShield(b, t);
      }
    },
  });

  // Blue Whelp (T3): Rally: Your Tavern spells give an extra +1 Health this game.
  registerMinion('BG33_924', {
    rally: (b, self) => {
      self.side.spellHealthBonus += sd(b, self, 1, self.mult);
    },
  });

  // Roaring Recruiter (T3): Whenever another friendly Dragon attacks, give it +3/+1.
  registerMinion('BG29_816', {
    onFriendlyAttack: (b, self, attacker) => {
      if (attacker !== self && hasTribe(attacker, 'DRAGON')) {
        buff(b, attacker, sd(b, self, 1, 3 * self.mult), sd(b, self, 2, 1 * self.mult));
      }
    },
  });

  // Runic Arcanist (T4): Start of Combat: Cast Shiny Ring twice (golden: 4 times).
  registerMinion('BG36_245', {
    startOfCombat: (b, self) => {
      for (let i = 0; i < 2 * self.mult; i++) castSpell(b, self.side, 'BG28_168');
    },
  });

  // Hopebringer (T5): Start of Combat: Give your minions +4/+3 (improves; read from tags).
  registerMinion('BG36_364', {
    startOfCombat: (b, self) => buffAll(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 3 * self.mult)),
  });

  // Crimson Vindicator (T6): Divine Shield. Windfury. Rally: Cast Mighty Dragonbreath (golden: twice).
  registerMinion('BG36_241', {
    rally: (b, self) => {
      for (let i = 0; i < self.mult; i++) castSpell(b, self.side, 'BG36_246');
    },
  });

  // Heroic Broodmother (T6): Rally: Gain Divine Shield. Start of Combat: Attack immediately (golden: twice).
  registerMinion('BG36_849', {
    rally: (b, self) => giveDivineShield(b, self),
    startOfCombat: (b, self) => {
      for (let i = 0; i < self.mult; i++) attackImmediately(b, self);
    },
  });

  // Nadina the Red (T6): Deathrattle: Give 3 (golden: 6) friendly Dragons Divine Shield.
  registerMinion('BGS_040', {
    deathrattle: (b, self, ctx) => {
      const targets = randomFriendlies(b, self.side, 3 * ctx.mult, (m) => isDragon(m) && !m.divineShield, self);
      for (const t of targets) giveDivineShield(b, t);
    },
  });

  // Obsidian Ravager (T7): Rally: Deal damage equal to this minion's Attack to the target and an
  // adjacent minion (golden: and its neighbours).
  registerMinion('BG27_017', {
    rally: (b, self, target) => {
      const adj = neighbours(target);
      const extra = self.golden ? adj : b.rng.sample(adj, 1);
      const dmg = self.attack;
      dealDamage(b, self, target, dmg);
      for (const n of extra) dealDamage(b, self, n, dmg);
    },
  });

  // Timecap'n Hooktail (T3, Pirate/Dragon): Whenever you cast a Tavern spell, give your minions +1 Attack.
  registerMinion('BG27_005', {
    onSpellCast: (b, self) => buffAll(b, self.side, sd(b, self, 1, 1) * self.mult, 0),
  });

  // Prized Promo-Drake: Start of Combat: Give your Dragons +4/+4.
  registerMinion('BG21_014', {
    startOfCombat: (b, self) => buffAll(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 4 * self.mult), isDragon),
  });

  registerMinion(
    [
      'BG36_240', // Hired Mount
      'BG36_242', // Bronze Timewalker (Rally: get a card)
      'BG29_813', // Persistent Poet (keeps stats: shop)
      'BG34_633', // Draconic Warden (deathrattle: get a card)
      'BGS_041', // Kalecgos (battlecry trigger)
      'BG32_820', // Firescale Hoarder (deathrattle: get a card)
      'BG21_015', // Tarecgosa
      'BG36_243', // Sky-hatch Runaway
      'BGDUO_107', // Doting Dracthyr
      'BGDUO31_205', // Selfless Sightseer
      'BG22_HERO_305_Buddy', // Many Whelps (permanent stats)
      'BG32_821', // Felfire Conjurer (end of turn)
      'BGS_034', // Bronze Warden (keywords only: Divine Shield, Reborn)
    ],
    { noCombatEffect: true },
  );
}
