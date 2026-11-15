/**
 * Non-pool minions that current games can still produce: hero Buddies (heroes in the current hero
 * pool), hero-power tokens (Protoss / Zerg minions, Sneed's New Shredder). Found by following card
 * text, token ids and `BACON_EVOLUTION_CARD_ID` from the pool, the heroes and trinkets in play.
 *
 * Buddies whose text matches a Timewarped minion reuse its handler (registered after timewarped.ts).
 * Not simulated (reported): Festergut (random "Undead Creation", parts not in the card data), Mishmash
 * (copies its Amalgam's stat gains) and Titanic Guardian (copies other minions' Health gains): the engine
 * has no "gains stats" event for other minions.
 */
import { getEffectHandler, getMinionHandler, registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  buffAll,
  copyMinion,
  counter,
  dealDamage,
  giveDivineShield,
  hasTribe,
  highestInHand,
  isAlive,
  minionFromCard,
  neighbours,
  randomPoolMinion,
  rightOfAnchor,
  sd,
  setCounter,
  summon,
  summonForDeath,
  summonFromHand,
} from './helpers';
import { cardsAddedToHand, getsCards, avengeGetsCards } from './aberration';
import { makeGolden } from './neutral';
import { IMMUNE_WHILE_ATTACKING } from '../engine/attack';
import type { Battle, EffectInstance, Minion } from '../engine/types';
import type { Tribe } from '@shared/types';

/** Buddy / token id -> Timewarped minion with the same text. */
const SAME_AS_TIMEWARPED: Record<string, string> = {
  BG23_HERO_201_Buddy: 'BG34_Giant_595', // Tamuzo: After you summon a minion in combat, double its stats
  BG31_HERO_802pt4: 'BG34_Giant_597', // Immortal: Start of Combat: Gain the stats of adjacent minions
  BG31_HERO_811t10: 'BG34_Treasure_994', // Ultralisk: Cleave. Start of Combat: Double this minion's stats
  TB_BaconShop_HERO_37_Buddy: 'BG34_Giant_584', // Kil'rek: Deathrattle: Get a random Demon
  TB_BaconShop_HERO_56_Buddy: 'BG34_Giant_585', // Vaelastrasz: Rally: Get a random Dragon
  TB_BaconShop_HERO_76_Buddy: 'BG34_Giant_592', // Spirit of Air: Deathrattle: Windfury, Divine Shield, Taunt
  BG21_HERO_030_Buddy: 'BG34_Giant_599', // Piloted Whirl-O-Tron: Start of Combat: Copy two left-most Deathrattles
};

/** Largest number of minions that can each be given a different type (Elder Taggawag). */
function distinctTypeMatching(minions: Minion[]): number {
  const owner = new Map<Tribe, Minion>();
  const tryAssign = (m: Minion, seen: Set<Tribe>): boolean => {
    const tribes = m.tribes.includes('ALL')
      ? (['BEAST', 'DEMON', 'DRAGON', 'ELEMENTAL', 'MECHANICAL', 'MURLOC', 'NAGA', 'PIRATE', 'QUILBOAR', 'UNDEAD', 'ABERRATION'] as Tribe[])
      : m.tribes;
    for (const t of tribes) {
      if (seen.has(t)) continue;
      seen.add(t);
      const cur = owner.get(t);
      if (!cur || tryAssign(cur, seen)) {
        owner.set(t, m);
        return true;
      }
    }
    return false;
  };
  let n = 0;
  for (const m of minions) if (m.tribes.length && tryAssign(m, new Set())) n++;
  return n;
}

const ELEMENT_RECOLLECTIONS: Record<string, string> = {
  BG22_HERO_001_Buddy_e1: 'BG22_HERO_001p_t1', // Earth
  BG22_HERO_001_Buddy_e2: 'BG22_HERO_001p_t2', // Fire
  BG22_HERO_001_Buddy_e3: 'BG22_HERO_001p_t3', // Water
  BG22_HERO_001_Buddy_e4: 'BG22_HERO_001p_t4', // Lightning
};

/** Run an Invocation hero power's Start of Combat effect for `self`'s side (Spirit Raptor). */
function callUponElement(b: Battle, self: Minion, heroPowerId: string): void {
  const handler = getEffectHandler(heroPowerId, b.db);
  if (!handler?.startOfCombat) return;
  const e: EffectInstance = { cardId: heroPowerId, kind: 'listener', handler, side: self.side, progress: 0, data: {} };
  handler.startOfCombat(b, e);
}

export function registerBuddies(): void {
  for (const [id, tw] of Object.entries(SAME_AS_TIMEWARPED)) {
    const h = getMinionHandler(tw);
    if (h) registerMinion(id, h);
  }

  // Shop-only buddies (play / Tavern / Hero Power / hero damage outside combat).
  registerMinion(
    [
      'BG20_HERO_101_Buddy', // Baby Elekk: whenever you play a minion
      'BG26_HERO_101_Buddy', // Shining Sailor: Tavern offers an extra Pirate
      'BG26_HERO_102_Buddy', // Solemn Serenader: after you use your Hero Power
      'TB_BaconShop_HERO_15_Buddy', // Karl the Lost: after you use your Hero Power
      'TB_BaconShop_HERO_25_Buddy', // Unearthed Underling: your hero takes damage (only outside combat)
      'TB_BaconShop_HERO_60_Buddy', // Crimson Hand Centurion: after 'Verdant Spheres' (Hero Power)
    ],
    { noCombatEffect: true },
  );

  // Master Gadrin: Start of Combat: Give the minion to the left of this Health equal to its Attack
  // (golden: adjacent minions).
  registerMinion('BG20_HERO_201_Buddy', {
    startOfCombat: (b, self) => {
      const i = self.side.board.indexOf(self);
      const targets = self.golden ? neighbours(self) : [self.side.board[i - 1]].filter((m) => m && isAlive(m));
      for (const t of targets) buff(b, t, 0, t.attack);
    },
  });
  // Monstrosity: After a friendly minion dies, gain its Attack (golden: twice).
  registerMinion('BG20_HERO_282_Buddy', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead !== self && isAlive(self)) buff(b, self, dead.attack * self.mult, 0);
    },
  });
  // Sneed's New Shredder: Deathrattle: Summon the highest-Health minion from your hand and give it
  // Divine Shield (golden: 2).
  registerMinion('BG21_HERO_030t', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const card = highestInHand(b, self.side, 'health');
        if (!card) return;
        const m = summonFromHand(b, self.side, card, ctx.anchor);
        if (!m) return;
        giveDivineShield(b, m);
      }
    },
  });
  // Spirit Raptor: Deathrattle: Call upon the remembered Elements (its "Recollection" enchantments;
  // golden: twice).
  registerMinion('BG22_HERO_001_Buddy', {
    deathrattle: (b, self, ctx) => {
      const elements = self.enchantments.map((e) => ELEMENT_RECOLLECTIONS[e]).filter(Boolean);
      for (let i = 0; i < ctx.mult; i++) for (const hp of elements) callUponElement(b, self, hp);
    },
  });
  // Shadowy Construct: Whenever a friendly minion dies, gain its maximum stats (once per combat;
  // golden: twice).
  registerMinion('BG25_HERO_103_Buddy', {
    onFriendlyDeath: (b, self, dead) => {
      if (dead === self || !isAlive(self)) return;
      const used = counter(self, 'gains', 0);
      if (used >= self.mult) return;
      setCounter(self, 'gains', used + 1);
      buff(b, self, dead.attack, dead.maxHealth);
    },
  });
  // Colossus: Rally: Deal 2 damage to the target's neighbors (improves; script data 2; golden 4).
  registerMinion('BG31_HERO_802pt', {
    rally: (b, self, target) => {
      const dmg = sd(b, self, 2, 2 * self.mult);
      for (const n of neighbours(target)) dealDamage(b, self, n, dmg);
    },
  });
  // Carrier: Avenge (4): Summon a 7/7 Interceptor (script data 2; golden 14/14). Then improve this
  // permanently (the improvement within the same combat is not simulated).
  registerMinion('BG31_HERO_802pt1', {
    avenge: 4,
    onAvenge: (b, self) => {
      const x = sd(b, self, 2, 7 * self.mult);
      const id = self.golden ? (b.db.goldenOf('BG31_HERO_802pt1t') ?? 'BG31_HERO_802pt1t') : 'BG31_HERO_802pt1t';
      summon(b, self.side, minionFromCard(b, self.side, id, { attack: x, health: x }), rightOfAnchor(self));
    },
  });
  // Void Ray: Divine Shield. Whenever a friendly minion attacks, give it and this minion +5 Attack
  // permanently (golden +10).
  registerMinion('BG31_HERO_802pt5', {
    onFriendlyAttack: (b, self, attacker) => {
      const a = 5 * self.mult;
      buff(b, attacker, a, 0);
      if (attacker !== self) buff(b, self, a, 0);
    },
  });
  // Mothership: Avenge (4): Get a random Protoss minion (golden: 2).
  registerMinion('BG31_HERO_802pt7', avengeGetsCards(4, 1));
  // Zergling: Start of Combat: Summon a copy of this minion (golden: 2).
  registerMinion('BG31_HERO_811t2', {
    startOfCombat: (b, self) => {
      for (let i = 0; i < self.mult; i++) {
        const c = copyMinion(b, self);
        if (!summon(b, self.side, c, rightOfAnchor(self))) return;
      }
    },
  });
  // Hydralisk: Windfury. Rally: Gain Attack equal to your Tier permanently (golden: twice).
  registerMinion('BG31_HERO_811t4', {
    rally: (b, self) => buff(b, self, Math.max(1, self.side.tavernTier) * self.mult, 0),
  });
  // Baneling: Deathrattle: Deal damage equal to this minion's Attack to a random enemy minion (golden: twice).
  registerMinion('BG31_HERO_811t5', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const t = b.rng.pick(aliveMinions(self.side.opponent));
        if (t) dealDamage(b, self, t, self.attack);
      }
    },
  });
  // Mutalisk: After a friendly minion kills an enemy, gain +3 Attack permanently (golden +6).
  registerMinion('BG31_HERO_811t6', {
    onEnemyDeath: (b, self, dead) => {
      if (isAlive(self) && dead.killedBy && dead.killedBy.side === self.side) buff(b, self, 3 * self.mult, 0);
    },
  });
  // Lurker: Stealth. Avenge (1): Gain +1/+1 permanently (golden +2/+2).
  registerMinion('BG31_HERO_811t7', { avenge: 1, onAvenge: (b, self) => buff(b, self, self.mult, self.mult) });

  // Zippers: Deathrattle: Get a helpful card (golden: 2).
  registerMinion('BG32_HERO_002_Buddy', getsCards(1, 'deathrattle'));
  // Tuskarr Raider: Battlecry, Deathrattle, and Rally: Get a random Bounty (golden: 2).
  registerMinion('TB_BaconShop_HERO_18_Buddy', getsCards(1, 'deathrattle', 'rally'));

  // Eclipsion Illidari: Your first minion that attacks has "Immune while Attacking" for one attack
  // only (golden: first two).
  registerMinion('TB_BaconShop_HERO_08_Buddy', {
    onFriendlyAttack: (_b, self, attacker) => {
      const used = counter(self, 'attacks', 0);
      setCounter(self, 'attacks', used + 1);
      if (used >= self.mult || attacker.counters?.[IMMUNE_WHILE_ATTACKING]) return;
      setCounter(attacker, IMMUNE_WHILE_ATTACKING, 1);
      setCounter(self, 'immuneFor', attacker.entityId);
    },
    afterFriendlyAttack: (_b, self, info) => {
      if (self.counters?.immuneFor !== info.attacker.entityId) return;
      setCounter(info.attacker, IMMUNE_WHILE_ATTACKING, 0);
      setCounter(self, 'immuneFor', -1);
    },
  });
  // Elder Taggawag: Start of Combat: If you control 4 minions with different types, gain your minions'
  // highest Attack and Health (golden: double).
  registerMinion('TB_BaconShop_HERO_14_Buddy', {
    startOfCombat: (b, self) => {
      const mine = aliveMinions(self.side);
      if (distinctTypeMatching(mine) < 4) return;
      const a = Math.max(...mine.map((m) => m.attack));
      const h = Math.max(...mine.map((m) => m.health));
      buff(b, self, a * self.mult, h * self.mult);
    },
  });
  // Elementium Squirrel Bomb: Deathrattle: Deal 4 damage to a random enemy minion for each of your
  // Mechs that died this combat (golden: 8).
  registerMinion('TB_BaconShop_HERO_17_Buddy', {
    deathrattle: (b, self, ctx) => {
      const n = self.side.deadThisCombat.filter((m) => hasTribe(m, 'MECHANICAL')).length;
      for (let i = 0; i < n; i++) {
        const t = b.rng.pick(aliveMinions(self.side.opponent));
        if (!t) return;
        dealDamage(b, self, t, 4 * ctx.mult);
      }
    },
  });
  // Arfus: After a friendly minion is Reborn, give it this minion's Attack (golden: twice).
  registerMinion('TB_BaconShop_HERO_22_Buddy', {
    onFriendlyReborn: (b, self, reborn) => {
      if (isAlive(self) && reborn !== self) buff(b, reborn, self.attack * self.mult, 0);
    },
  });
  // Sr. Tomb Diver: Deathrattle: Make your right-most minion Golden (golden: two right-most).
  registerMinion('TB_BaconShop_HERO_41_Buddy', {
    deathrattle: (b, self, ctx) => {
      const board = aliveMinions(self.side).filter((m) => m !== self && !m.golden);
      for (const m of board.slice(-ctx.mult)) makeGolden(b, m);
    },
  });
  // Brann's Epic Egg: Deathrattle: Summon and get a random Battlecry minion (golden: 2).
  registerMinion('TB_BaconShop_HERO_43_Buddy', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const card = randomPoolMinion(b, 'battlecry', (c) => c.mechanics.includes('BATTLECRY'));
        if (card) summonForDeath(b, self, ctx, card.id, 1);
      }
      cardsAddedToHand(b, self.side, ctx.mult);
    },
  });
  // Sinestra: Whenever a friendly minion gains Attack during combat, give it +1 Health permanently (golden +2).
  registerMinion('TB_BaconShop_HERO_52_Buddy', {
    init: (b) => void (b.watchAttackGain = true),
    onFriendlyGainedAttack: (b, self, target) => buff(b, target, 0, self.mult),
  });
  // Mawsworn Soulkeeper: Deathrattle: Summon 2 random Undead (golden: 4).
  registerMinion('TB_BaconShop_HERO_702_Buddy', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < 2 * ctx.mult; i++) {
        const card = randomPoolMinion(b, 'undead', (c) => c.tribes.includes('UNDEAD'));
        if (!card || !summonForDeath(b, self, ctx, card.id, 1).length) break;
      }
    },
  });
  // Icesnarl the Mighty: After a friendly minion kills an enemy, gain +3 Health permanently (golden +6).
  registerMinion('BG20_HERO_100_Buddy', {
    onEnemyDeath: (b, self, dead) => {
      if (isAlive(self) && dead.killedBy && dead.killedBy.side === self.side) buff(b, self, 0, 3 * self.mult);
    },
  });
  // Viper (Zerg): Venomous. Immune while attacking.
  registerMinion('BG31_HERO_811t8', { init: (_b, self) => setCounter(self, IMMUNE_WHILE_ATTACKING, 1) });
  // Wandering Treant: Whenever a friendly Taunt minion is attacked, give your minions +1/+1 permanently (golden +2/+2).
  registerMinion('TB_BaconShop_HERO_95_Buddy', {
    onFriendlyAttacked: (b, self, _attacker, target) => {
      if (target.taunt) buffAll(b, self.side, self.mult, self.mult);
    },
  });
  // Valithria Dreamwalker: Whenever a Dragon enters your warband (or the Tavern), gain +1/+1 (golden +2/+2).
  registerMinion('TB_BaconShop_HERO_53_Buddy', {
    afterFriendlySummon: (b, self, summoned) => {
      if (hasTribe(summoned, 'DRAGON')) buff(b, self, self.mult, self.mult);
    },
  });
  // Loyal Henchman: After you kill a second minion each combat, get a plain copy of it (hand count only).
  registerMinion('TB_BaconShop_HERO_45_Buddy', {
    onEnemyDeath: (b, self, dead) => {
      if (!isAlive(self) || dead.killedBy?.side !== self.side) return;
      const kills = counter(self, 'kills', 0) + 1;
      setCounter(self, 'kills', kills);
      if (kills === 2) cardsAddedToHand(b, self.side, self.mult);
    },
  });
  // Roach (Zerg): Taunt; its Health gain happens at the end of the turn (in the snapshot).
  registerMinion('BG31_HERO_811t3', { noCombatEffect: true });
  // Tide Oracle Morgl (Poisonous; its kill trigger only buffs a card in hand) - keywords only.
  registerMinion('BG27_513', { noCombatEffect: true });
  // Baby Y'Shaarj: After you summon a minion of your Tier, give your minions +1/+1 (golden +2/+2).
  registerMinion('TB_BaconShop_HERO_92_Buddy', {
    afterFriendlySummon: (b, self, summoned) => {
      if (summoned.tier === self.side.tavernTier) buffAll(b, self.side, self.mult, self.mult);
    },
  });
}
