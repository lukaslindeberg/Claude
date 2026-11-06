/** Murloc handlers (several interact with the hand). */
import { registerMinion } from './registry';
import {
  buff,
  buffAll,
  endAnchor,
  giveVenomous,
  handMinions,
  hasTribe,
  highestInHand,
  minionFromSnapshot,
  queueSpaceSummon,
  randomFriendlies,
  sd,
  summon,
  summonFromHand,
  tribeFilter,
} from './helpers';

const isMurloc = tribeFilter('MURLOC');

export function registerMurlocs(): void {
  // Flighty Scout (T1): Start of Combat: If this minion is in your hand, summon a copy of it
  // (golden: with double stats).
  registerMinion('BG32_330', {
    handStartOfCombat: (b, card, side) => {
      const m = minionFromSnapshot(b, side, { ...card.snapshot, entityId: b.nextEntityId++ });
      if (card.golden) {
        m.attack *= 2;
        m.health *= 2;
        m.maxHealth = m.health;
      }
      summon(b, side, m, endAnchor(side));
    },
  });

  // Diremuck Forager (T3): Start of Combat: When you have space, summon the highest-Attack Murloc
  // from your hand for this combat only (golden: two).
  registerMinion('BG27_556', {
    startOfCombat: (b, self) => {
      const side = self.side;
      queueSpaceSummon(side, {
        remaining: self.mult,
        make: (bb, s) => {
          const card = highestInHand(bb, s, 'attack', (h) => hasTribe(h, 'MURLOC'));
          if (!card) return null;
          const i = s.hand.indexOf(card);
          if (i >= 0) s.hand.splice(i, 1);
          return minionFromSnapshot(bb, s, { ...card.snapshot, entityId: bb.nextEntityId++ });
        },
      });
    },
  });

  // Bile Spitter (T5): Venomous. Rally: Give another friendly Murloc Venomous (golden: 2).
  registerMinion('BG33_318', {
    rally: (b, self) => {
      const pool = (m: Parameters<typeof isMurloc>[0]) => isMurloc(m) && !m.venomous;
      for (const t of randomFriendlies(b, self.side, self.mult, pool, self)) giveVenomous(t);
    },
  });

  // Costume Enthusiast (T5): Divine Shield. Start of Combat: Gain the Attack of the highest-Attack
  // minion in your hand (golden: double).
  registerMinion('BG34_142', {
    startOfCombat: (b, self) => {
      const card = highestInHand(b, self.side, 'attack');
      if (card) buff(b, self, card.attack * self.mult, 0);
    },
  });

  // Choral Mrrrglr (T6): Start of Combat: Gain the stats of all the minions in your hand (golden: twice).
  registerMinion('BG26_354', {
    startOfCombat: (b, self) => {
      let a = 0;
      let h = 0;
      for (const c of handMinions(b, self.side)) {
        a += c.attack;
        h += c.health;
      }
      buff(b, self, a * self.mult, h * self.mult);
    },
  });

  // Shamanic Tidecaller (T5): Whenever you cast a spell on a Murloc, give Murlocs in your hand and
  // board +3/+4.
  registerMinion('BG36_704', {
    onSpellCast: (b, self, _spell, target) => {
      if (!target || !hasTribe(target, 'MURLOC')) return;
      const a = sd(b, self, 1, 3 * self.mult);
      const h = sd(b, self, 2, 4 * self.mult);
      buffAll(b, self.side, a, h, isMurloc);
      for (const c of self.side.hand) {
        if (hasTribe(c, 'MURLOC')) {
          c.attack += a;
          c.health += h;
        }
      }
    },
  });

  // Bassgill: Deathrattle: Summon the highest-Health Murloc from your hand for this combat only.
  registerMinion('BG26_350', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const card = highestInHand(b, self.side, 'health', (h) => hasTribe(h, 'MURLOC'));
        if (!card || !summonFromHand(b, self.side, card, ctx.anchor)) break;
      }
    },
  });

  registerMinion(
    [
      'BG31_149', // Bubble Gunner
      'BG27_023', // Murcules (buffs the hand)
      'BG22_202', // Tad
      'BG29_300', // Very Hungry Winterfinner (buffs the hand)
      'BG32_860', // Shoalfin Mystic
      'BG26_137', // Bream Counter
      'BG36_701', // Kelp Keeper
      'BG32_336', // Gormling Gourmet (deathrattle: get a card)
      'BG36_703', // Twilight Tidehunter (buffs the hand)
      'BG36_764', // Gearfin
      'BG31_148', // Hackerfin
      'BGS_020', // Primalfin Lookout
      'BG36_700', // Sewer Escapee
      'BG33_891', // Magicfin Mycologist
      'BG22_403', // Young Murk-Eye
      'BG34_145', // Futurefin
      'BGDUO_117', // Puddle Prancer
      'BGDUO33_140', // Bottom Feeder
    ],
    { noCombatEffect: true },
  );
}
