/**
 * Minions that rotated out of the current pool but show up in older games (and may rotate back):
 * the cards reported most often when replaying the fixture logs. Effects follow the bundled card
 * text; golden versions read `self.mult` / script data like the pool handlers.
 *
 * Still reported: cards missing from the bundled data (pre-2021 ids such as CFM_316).
 */
import { LOBBY_TRIBES } from '@shared/types';
import { registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  dealDamage,
  giveDivineShield,
  giveReborn,
  giveTaunt,
  giveVenomous,
  giveWindfury,
  hasTribe,
  highestBy,
  minionFromCard,
  randomFriendlies,
  randomFriendly,
  randomPoolMinion,
  sd,
  summon,
  summonForDeath,
  summonRightOf,
} from './helpers';
import { cardsAddedToHand } from './aberration';
import { makeGolden } from './neutral';
import type { Battle, Minion } from '../engine/types';

/**
 * Number of different minion types among `minions`. An all-type minion fills one type that no other
 * minion has (it is not counted as every type at once).
 */
export function minionTypeCount(minions: Minion[]): number {
  const seen = new Set<string>();
  let all = 0;
  for (const m of minions) {
    if (m.tribes.includes('ALL')) all++;
    else for (const t of m.tribes) if (LOBBY_TRIBES.includes(t)) seen.add(t);
  }
  return Math.min(LOBBY_TRIBES.length, seen.size + all);
}

function getCards(b: Battle, self: Minion, n: number): void {
  cardsAddedToHand(b, self.side, n);
}

export function registerLegacy(): void {
  // Rat Pack: Deathrattle: Summon a number of 1/1 Rats equal to this minion's Attack (golden: 2/2 Rats).
  registerMinion('BG_CFM_316', {
    deathrattle: (b, self, ctx) => {
      const opts = ctx.golden ? { attack: 2, health: 2 } : {};
      summonForDeath(b, self, ctx, 'BG_CFM_316t', Math.min(7, self.attack), opts);
    },
  });
  // Icky Imp: Deathrattle: Summon two 1/1 Imps (golden: four).
  registerMinion('BG21_029', {
    deathrattle: (b, self, ctx) => void summonForDeath(b, self, ctx, 'BG_BRM_006t', 2 * ctx.mult),
  });
  // Imprisoner: Taunt. Deathrattle: Summon a 1/1 Imp (golden: a 2/2 Imp).
  registerMinion('BGS_014', {
    deathrattle: (b, self, ctx) => void summonForDeath(b, self, ctx, 'BG_BRM_006t', 1, { golden: ctx.golden }),
  });
  // Mecharoo (golden only in the data): Deathrattle: Summon a 2/2 Jo-E Bot.
  registerMinion('TB_BaconUps_002', {
    deathrattle: (b, self, ctx) => void summonForDeath(b, self, ctx, 'TB_BaconUps_002t', 1),
  });
  // Sneed's Old Shredder: Deathrattle: Summon a random Legendary minion.
  registerMinion('BGS_006', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const card = randomPoolMinion(b, 'legendary', (c) => c.mechanics.includes('ELITE'));
        if (!card || !summonForDeath(b, self, ctx, card.id, 1).length) break;
      }
    },
  });
  // Tunnel Blaster: Taunt. Deathrattle: Deal 3 damage to all minions (golden: twice).
  registerMinion('BG_DAL_775', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        for (const m of [...aliveMinions(self.side), ...aliveMinions(self.side.opponent)]) dealDamage(b, self, m, 3);
      }
    },
  });
  // Arid Atrocity: Deathrattle: Summon a 5/5 Golem, improved by each friendly minion type that died this
  // combat. A Power.log (fixture bg_hero_reroll_213490) shows script data 1 going X -> 2X -> 3X as types die
  // and the Golem summoned as X/X plus an X/X enchantment per type: the Golem is X x (1 + types) (golden X = 10).
  registerMinion('BG29_864', {
    deathrattle: (b, self, ctx) => {
      const x = sd(b, self, 1, 5 * ctx.mult);
      const n = 1 + minionTypeCount(self.side.deadThisCombat.filter((m) => m !== self));
      summonForDeath(b, self, ctx, 'BG29_864t', 1, { golden: ctx.golden, attack: x * n, health: x * n });
    },
  });
  // Kangor's Apprentice: Deathrattle: Summon plain copies of your first 2 Mechs that died this combat (golden: 4).
  registerMinion('BGS_012', {
    deathrattle: (b, self, ctx) => {
      const mechs = self.side.deadThisCombat.filter((m) => m !== self && hasTribe(m, 'MECHANICAL')).slice(0, 2 * ctx.mult);
      for (const d of mechs) if (!summon(b, self.side, minionFromCard(b, self.side, d.cardId), ctx.anchor)) break;
    },
  });

  // Security Rover (golden only in the data): Whenever this minion takes damage, summon a 4/6 Mech with Taunt.
  registerMinion('TB_BaconUps_041', {
    onDamaged: (b, self) => void summonRightOf(b, self, 'TB_BaconUps_041t', 1),
  });
  // Imp Mama: Whenever this minion takes damage, summon a random Demon and give it Taunt (golden: 2).
  registerMinion('BGS_044', {
    onDamaged: (b, self) => {
      for (let i = 0; i < self.mult; i++) {
        const card = randomPoolMinion(b, 'demon-not-mama', (c) => c.tribes.includes('DEMON') && c.name !== 'Imp Mama');
        if (!card) break;
        const [m] = summonRightOf(b, self, card.id, 1);
        if (!m) break;
        giveTaunt(m);
      }
    },
  });
  // Soul Juggler: After a friendly Demon dies, deal 4 damage to the highest-Health enemy minion (golden: twice).
  registerMinion('BGS_002', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead === self || !hasTribe(dead, 'DEMON')) return;
      for (let i = 0; i < self.mult; i++) {
        const t = highestBy(b, aliveMinions(self.side.opponent), (m) => m.health);
        if (t) dealDamage(b, self, t, sd(b, self, 1, 4));
      }
    },
  });
  // Scavenging Hyena: Whenever a friendly Beast dies, gain +2/+1 (golden +4/+2).
  registerMinion('BG_EX1_531', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead !== self && hasTribe(dead, 'BEAST')) buff(b, self, 2 * self.mult, self.mult);
    },
  });

  // Pack Leader: Whenever you summon a Beast, give it +2 Attack (golden +4).
  registerMinion('BGS_017', {
    onFriendlySummon: (b, self, summoned) => {
      if (hasTribe(summoned, 'BEAST')) buff(b, summoned, 2 * self.mult, 0);
    },
  });
  // Swampstriker: Windfury. After you summon a Murloc, gain +1 Attack (golden +2).
  registerMinion('BG22_401', {
    afterFriendlySummon: (b, self, summoned) => {
      if (hasTribe(summoned, 'MURLOC')) buff(b, self, self.mult, 0);
    },
  });
  // Saltscale Honcho: After you summon a Murloc, give a friendly Murloc other than it +2 Health (golden +4).
  registerMinion('BG21_008', {
    afterFriendlySummon: (b, self, summoned) => {
      if (!hasTribe(summoned, 'MURLOC')) return;
      const t = randomFriendly(b, self.side, (m) => m !== summoned && hasTribe(m, 'MURLOC'));
      if (t) buff(b, t, 0, sd(b, self, 2, 2 * self.mult));
    },
  });
  // Salty Looter: Has +1/+1 for each Pirate you've summoned this game (golden +2/+2): Pirates summoned in combat.
  registerMinion('BGS_081', {
    afterFriendlySummon: (b, self, summoned) => {
      if (hasTribe(summoned, 'PIRATE')) buff(b, self, self.mult, self.mult);
    },
  });

  // Ripsnarl Captain: Whenever a friendly Pirate attacks, give it +3 Attack (golden +6).
  registerMinion('BGS_056', {
    onFriendlyAttack: (b, self, attacker) => {
      if (hasTribe(attacker, 'PIRATE')) buff(b, attacker, 3 * self.mult, 0);
    },
  });
  // Dozy Whelp: Taunt. Whenever this is attacked, gain +1 Attack permanently (golden +2).
  registerMinion('BG24_300', {
    onFriendlyAttacked: (b, self, _attacker, target) => {
      if (target === self) buff(b, self, self.mult, 0);
    },
  });
  // Phaerix, Wrath of the Sun: Divine Shield. Avenge (4): Give a random friendly minion Divine Shield (golden: two).
  registerMinion('BG28_403', {
    avenge: 4,
    onAvenge: (b, self) => {
      for (const t of randomFriendlies(b, self.side, self.mult, (m) => !m.divineShield)) giveDivineShield(b, t);
    },
  });

  // Start of Combat
  // Mantid Queen: Venomous. For each of your minion types gain +5/+5, Windfury, Reborn, or Taunt (golden: twice).
  registerMinion('BG22_402', {
    startOfCombat: (b, self) => {
      const n = minionTypeCount(aliveMinions(self.side)) * self.mult;
      for (let i = 0; i < n; i++) {
        const r = b.rng.int(4);
        if (r === 0) buff(b, self, 5, 5);
        else if (r === 1) giveWindfury(self);
        else if (r === 2) giveReborn(self);
        else giveTaunt(self);
      }
    },
  });
  // Yu'lon, Fortune Granter: Make your lowest-Tier minion Golden, except Yu'lon (golden: two).
  registerMinion('BG29_811', {
    startOfCombat: (b, self) => {
      for (let i = 0; i < self.mult; i++) {
        const ok = aliveMinions(self.side).filter((m) => !m.golden && !!b.db.goldenOf(m.cardId) && !m.name.startsWith("Yu'lon"));
        if (!ok.length) return;
        const low = Math.min(...ok.map((m) => m.tier));
        const t = b.rng.pick(ok.filter((m) => m.tier === low));
        if (t) makeGolden(b, t);
      }
    },
  });

  // Spells cast in combat
  // The Glad-iator: Divine Shield. Whenever you cast a spell, gain +1 Attack (golden +2).
  registerMinion('BG27_025', { onSpellCast: (b, self) => buff(b, self, self.mult, 0) });
  // Daggerspine Thrasher: Whenever you cast a spell, gain Divine Shield, Windfury, or Venomous.
  registerMinion('BG27_024', {
    onSpellCast: (b, self) => {
      const r = b.rng.int(3);
      if (r === 0) giveDivineShield(b, self);
      else if (r === 1) giveWindfury(self);
      else giveVenomous(self);
    },
  });

  // Blood Gems
  // Tough Tusk: After a Blood Gem is played on this, gain Divine Shield.
  registerMinion('BG20_102', { onBloodGem: (b, self) => giveDivineShield(b, self) });
  // Groundshaker: After a Blood Gem is played on this, give your other minions +2 Attack (golden +4).
  registerMinion('BG20_106', {
    onBloodGem: (b, self) => {
      for (const m of aliveMinions(self.side)) if (m !== self) buff(b, m, 2 * self.mult, 0);
    },
  });

  // Stat gains
  // Master of Realities: Taunt. After a friendly Elemental gains stats, gain +2/+2 (golden +4/+4).
  registerMinion('BG21_036', {
    init: (b) => void (b.watchStatGain = true),
    onFriendlyGainedStats: (b, self, target) => {
      if (target !== self && hasTribe(target, 'ELEMENTAL')) buff(b, self, sd(b, self, 1, 2 * self.mult), sd(b, self, 2, 2 * self.mult));
    },
  });
  // Spacefarer: Whenever another friendly Pirate gains Attack, gain +2 Health (golden +4).
  registerMinion('BG31_820', {
    init: (b) => void (b.watchAttackGain = true),
    onFriendlyGainedAttack: (b, self, target) => {
      if (target !== self && hasTribe(target, 'PIRATE')) buff(b, self, 0, 2 * self.mult);
    },
  });
  // Hunter of Gatherers: Whenever this gains Attack, give your minions +2 Health (golden +4).
  registerMinion('BG25_027', {
    init: (b) => void (b.watchAttackGain = true),
    onFriendlyGainedAttack: (b, self, target) => {
      if (target !== self) return;
      for (const m of aliveMinions(self.side)) buff(b, m, 0, 2 * self.mult);
    },
  });

  // "Get a card" effects: only the hand count matters in combat.
  // Gentle Djinni: Taunt. Battlecry and Deathrattle: Get a random Elemental (golden: 2).
  registerMinion('BGS_121', { deathrattle: (b, self, ctx) => getCards(b, self, ctx.mult) });
  // Briny Bootlegger: Deathrattle: Get a Tavern Coin (golden: 2).
  registerMinion('BG21_017', { deathrattle: (b, self, ctx) => getCards(b, self, ctx.mult) });
  // Pashmar the Vengeful: Avenge (3): Get a Spellcraft spell (golden: 2).
  registerMinion('BG23_014', { avenge: 3, onAvenge: (b, self) => getCards(b, self, self.mult) });
  // Whirling Lass-o-Matic: Divine Shield, Windfury. Rally: Get a random Tavern spell (golden: 2).
  registerMinion('BG28_635', { rally: (b, self) => getCards(b, self, self.mult) });
  // Gemsplitter: Divine Shield. After a friendly minion loses Divine Shield, get a Blood Gem (golden: 2).
  registerMinion('BG21_037', { onFriendlyDivineShieldLost: (b, self) => getCards(b, self, self.mult) });

  registerMinion(
    [
      'BG21_020', // Dazzling Lightspawn (Avenge: buffs Elementals in the Tavern)
      'BG30_117', // Volcanic Visitor (Spellcraft)
      'BGS_027', // Micro Machine (start of each turn)
      'BG29_877', // Fiery Felblood (Deathrattle: buffs the Tavern)
      'BG26_535', // Rock Rock (after you play an Elemental)
      'BG_GVG_100', // Floating Watcher (your hero takes damage on your turn)
    ],
    { noCombatEffect: true },
  );
}
