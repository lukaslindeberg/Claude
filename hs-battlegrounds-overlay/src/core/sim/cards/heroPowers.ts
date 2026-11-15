/**
 * Hero powers with combat effects (side-level effects, see EffectHandler), and
 * the enchantments some of them put on minions.
 */
import { LOBBY_TRIBES } from '@shared/types';
import { registerEffect, registerEnchantment } from './registry';
import {
  aliveMinions,
  attackImmediately,
  buff,
  copyMinion,
  dealDamage,
  destroy,
  endAnchor,
  giveDivineShield,
  giveTaunt,
  giveWindfury,
  hasTribe,
  highestBy,
  leftMost,
  lowestBy,
  minionFromCard,
  queueSpaceSummon,
  randomPoolMinion,
  rightMost,
  summon,
  summonForDeath,
} from './helpers';
import { cardsAddedToHand } from './aberration';
import { teammateHighest, transformInto } from './neutral';
import type { Battle, DeathrattleFn, EffectInstance, Minion, SideState } from '../engine/types';

/** Deal `dmg` to `n` random living enemy minions (re-rolled each hit). */
function hitRandomEnemies(b: Battle, side: SideState, n: number, dmg: number, distinct: boolean): void {
  const hit = new Set<Minion>();
  for (let i = 0; i < n; i++) {
    const pool = aliveMinions(side.opponent).filter((m) => !distinct || !hit.has(m));
    const t = b.rng.pick(pool);
    if (!t) return;
    hit.add(t);
    dealDamage(b, null, t, dmg);
  }
}

function grant(m: Minion, sourceCardId: string, fn: DeathrattleFn): void {
  if (m.enchantments.includes(sourceCardId)) return; // already granted (snapshot taken after SoC)
  m.extraDeathrattles.push({ sourceCardId, golden: false, fn });
}

// Enchantment deathrattles ---------------------------------------------------

/** Earth Invocation: "Deathrattle: Summon a 1/1 Elemental." */
export const EARTH_DR: DeathrattleFn = (b, self, ctx) => {
  summonForDeath(b, self, ctx, 'BG22_HERO_001p_t1et', 1);
};
/** Murloc King: "Deathrattle: Summon a 1/1 Murloc." */
export const MURLOC_KING_DR: DeathrattleFn = (b, self, ctx) => {
  summonForDeath(b, self, ctx, 'TB_BaconShop_HP_017t', 1, { name: 'Murloc', attack: 1, health: 1, tribes: ['MURLOC'], tier: 1 });
};
/** Fragrant Phylactery: "Deathrattle: Give your other minions this minion's stats." */
export const FRAGRANT_DR: DeathrattleFn = (b, self) => {
  for (const m of aliveMinions(self.side)) if (m !== self) buff(b, m, self.attack, self.maxHealth);
};

export function registerHeroPowers(): void {
  registerEnchantment('BG22_HERO_001p_t1e', { deathrattle: EARTH_DR });
  registerEnchantment('TB_BaconShop_HP_017e', { deathrattle: MURLOC_KING_DR });
  registerEnchantment(['BG20_HERO_282pe', 'BG20_HERO_282pe2'], { deathrattle: FRAGRANT_DR });

  // Deadeye passives (Take aim!): Start of Combat: Deal 99 damage to the chosen enemy minion.
  const aim = (pick: (b: Battle, enemies: Minion[]) => Minion | undefined) => ({
    startOfCombat: (b: Battle, e: EffectInstance) => {
      const t = pick(b, aliveMinions(e.side.opponent));
      if (t) dealDamage(b, null, t, 99);
    },
  });
  registerEffect('BG22_HERO_000p_t1', aim((_b, en) => en[0]));
  registerEffect('BG22_HERO_000p_t2', aim((b, en) => lowestBy(b, en, (m) => m.health)));
  registerEffect('BG22_HERO_000p_t3', aim((b, en) => highestBy(b, en, (m) => m.health)));
  registerEffect('BG22_HERO_000p_t4', aim((_b, en) => en[en.length - 1]));

  // Earth Invocation: Give 4 random friendly minions "Deathrattle: Summon a 1/1 Elemental."
  registerEffect('BG22_HERO_001p_t1', {
    startOfCombat: (b, e) => {
      for (const m of b.rng.sample(aliveMinions(e.side), 4)) grant(m, 'BG22_HERO_001p_t1e', EARTH_DR);
    },
  });
  // Fire Invocation: Double your left-most minion's Attack.
  registerEffect('BG22_HERO_001p_t2', {
    startOfCombat: (b, e) => {
      const m = leftMost(e.side);
      if (m) buff(b, m, m.attack, 0);
    },
  });
  // Water Invocation: Give your right-most minion Divine Shield and Taunt.
  registerEffect('BG22_HERO_001p_t3', {
    startOfCombat: (b, e) => {
      const m = rightMost(e.side);
      if (!m) return;
      giveDivineShield(b, m);
      giveTaunt(m);
    },
  });
  // Lightning Invocation: Deal 1 damage to 5 random enemy minions.
  registerEffect('BG22_HERO_001p_t4', {
    startOfCombat: (b, e) => hitRandomEnemies(b, e.side, 5, 1, true),
  });

  // Frostwolf Fervor / Stormpike Strength: When you have space, summon a copy of your
  // highest-Attack / highest-Health minion (from turn 7).
  const copyWhenSpace = (key: (m: Minion) => number) => ({
    startOfCombat: (b: Battle, e: EffectInstance) => {
      if ((b.input.turn ?? 0) < 7) return;
      queueSpaceSummon(e.side, {
        remaining: 1,
        make: (bb, s) => {
          const src = highestBy(bb, aliveMinions(s), key);
          return src ? copyMinion(bb, src) : null;
        },
      });
    },
  });
  registerEffect('BG22_HERO_002p', copyWhenSpace((m) => m.attack));
  registerEffect('BG22_HERO_003p', copyWhenSpace((m) => m.health));

  // Onyxia - Broodmother: Avenge (4): Summon a 1/1 Whelp that attacks immediately. Improve by +1/+1.
  registerEffect('BG22_HERO_305p', {
    avenge: 4,
    onAvenge: (b, e) => {
      const base = Math.max(1, e.scriptData1 ?? 1);
      const bonus = e.data.bonus ?? 0;
      const whelp = minionFromCard(b, e.side, 'BG22_HERO_305t', { attack: base + bonus, health: base + bonus });
      e.data.bonus = bonus + 1;
      if (summon(b, e.side, whelp, endAnchor(e.side))) attackImmediately(b, whelp);
    },
  });

  // Ozumat - Tentacular: When you have space in combat, summon a 2/2 Tentacle with Taunt (improves).
  registerEffect('BG23_HERO_201p', {
    startOfCombat: (b, e) => {
      const stats = Math.max(2, e.scriptData1 ?? 2);
      queueSpaceSummon(e.side, {
        remaining: 1,
        make: (bb, s) => minionFromCard(bb, s, 'BG23_HERO_201pt', { attack: stats, health: stats, taunt: true }),
      });
    },
  });

  // Murloc King: At the start of next combat, give your minions "Deathrattle: Summon a 1/1 Murloc."
  registerEffect('TB_BaconShop_HP_017', {
    startOfCombat: (_b, e) => {
      if (!e.side.heroPowerUsed) return;
      for (const m of aliveMinions(e.side)) grant(m, 'TB_BaconShop_HP_017e', MURLOC_KING_DR);
    },
  });

  // Ragnaros - DIE, INSECTS!: Deal 8 damage to two random enemy minions.
  registerEffect('TB_BaconShop_HP_019', {
    startOfCombat: (b, e) => hitRandomEnemies(b, e.side, 2, 8, false),
  });
  // Fire the Cannons!: Deal 4 damage to two random enemy minions.
  registerEffect('TB_BaconShop_HP_027', {
    startOfCombat: (b, e) => hitRandomEnemies(b, e.side, 2, 4, false),
  });
  // Nefarian - Nefarious Fire: Deal 1 damage to all enemy minions.
  registerEffect('TB_BaconShop_HP_043', {
    startOfCombat: (b, e) => {
      for (const m of aliveMinions(e.side.opponent)) dealDamage(b, null, m, 1);
    },
  });
  // ALL Will Burn!: Give ALL minions +2 Attack permanently.
  registerEffect('TB_BaconShop_HP_061', {
    startOfCombat: (b, e) => {
      for (const m of [...aliveMinions(e.side), ...aliveMinions(e.side.opponent)]) buff(b, m, 2, 0);
    },
  });
  // Illidan - Wingmen: Your left- and right-most minions gain +2/+1 and attack immediately.
  registerEffect('TB_BaconShop_HP_069', {
    startOfCombat: (b, e) => {
      const l = leftMost(e.side);
      const r = rightMost(e.side);
      for (const m of l && r && l !== r ? [l, r] : l ? [l] : []) {
        buff(b, m, 2, 1);
        attackImmediately(b, m);
      }
    },
  });
  // Swatting Insects: Give your left-most minion Windfury, Divine Shield, and Taunt.
  registerEffect('TB_BaconShop_HP_086', {
    startOfCombat: (b, e) => {
      const m = leftMost(e.side);
      if (!m) return;
      giveWindfury(m);
      giveDivineShield(b, m);
      giveTaunt(m);
    },
  });
  // Embrace Your Rage: Start of Combat: Summon (and get) a minion of your Tier.
  registerEffect('TB_BaconShop_HP_103', {
    startOfCombat: (b, e) => {
      const tier = Math.min(6, e.side.tavernTier);
      const card = randomPoolMinion(b, `tier-${tier}`, (c) => c.tier === tier);
      if (!card) return;
      summon(b, e.side, minionFromCard(b, e.side, card.id), endAnchor(e.side));
      cardsAddedToHand(b, e.side, 1);
    },
  });

  // Rokara - Glory of Combat: After a friendly minion kills an enemy, give it +1 Attack permanently.
  registerEffect('BG20_HERO_100p', {
    onEnemyDeath: (b, e, dead) => {
      const k = dead.killedBy;
      if (k && k.side === e.side && !k.removed && k.health > 0 && !k.destroyed) buff(b, k, 1, 0);
    },
  });

  // Flobbidinous Floop - Glorious Gloop (Duos): Start of Combat: Transform the chosen minion
  // (enchanted "In the Gloop") into your teammate's highest-Tier minion.
  registerEffect('BGDUO_HERO_101p', {
    startOfCombat: (b, e) => {
      const m = aliveMinions(e.side).find((x) => x.enchantments.includes('BGDUO_HERO_101pe2'));
      const t = m && teammateHighest(b, e.side, (s) => s.tier ?? b.db.tier(s.cardId) ?? 1);
      if (m && t) transformInto(b, m, t);
    },
  });
  // Sprout It Out!: Give +1/+2 and Taunt to minions you summon during combat.
  registerEffect('TB_BaconShop_HP_107', {
    init: (_b, e) => {
      e.side.summonBuffs.push({ attack: 1, health: 2, taunt: true });
    },
  });
  // Fragrant Phylactery: Give your lowest-Attack minion "Deathrattle: Give your other minions this minion's stats."
  registerEffect('BG20_HERO_282p', {
    startOfCombat: (b, e) => {
      const m = lowestBy(b, aliveMinions(e.side), (x) => x.attack);
      if (m) grant(m, 'BG20_HERO_282pe', FRAGRANT_DR);
    },
  });
  // Rapid Reanimation: Start of Combat: destroy the chosen minion (enchanted with "Impending Death"),
  // resummon an exact copy when you have space.
  registerEffect('BG25_HERO_103p', {
    startOfCombat: (b, e) => {
      const m = aliveMinions(e.side).find((x) => x.enchantments.includes('BG25_HERO_103pe'));
      if (!m) return;
      const copy = copyMinion(b, m);
      copy.enchantments = copy.enchantments.filter((id) => id !== 'BG25_HERO_103pe');
      destroy(b, m);
      queueSpaceSummon(e.side, { remaining: 1, make: () => copy });
    },
  });

  // Wax Warband (Queen Wagtoggle, passive): Start of Combat: Give a friendly minion of each type +X/+X.
  // X = hero power script data 3 (improves after spending 10 Gold); a minion is picked for one type only.
  registerEffect('TB_BaconShop_HP_037a', {
    startOfCombat: (b, e) => {
      const x = e.scriptData3 && e.scriptData3 > 0 ? e.scriptData3 : (b.db.get(e.cardId)?.tags?.TAG_SCRIPT_DATA_NUM_3 ?? 1);
      const used = new Set<Minion>();
      for (const tribe of LOBBY_TRIBES) {
        const t = b.rng.pick(aliveMinions(e.side).filter((m) => !used.has(m) && m.tribes.length > 0 && hasTribe(m, tribe)));
        if (!t) continue;
        used.add(t);
        buff(b, t, x, x);
      }
    },
  });
  // Lock and Load (Tavish Stormpike): Remove a minion in the Tavern. When you have space next combat,
  // fire it at a random enemy minion. Which minion was removed is not in the input: still reported
  // when the hero power was used this turn (or its state is unknown); otherwise it does nothing.
  registerEffect('BG22_HERO_000p_Alt', { unsupportedWhen: ({ used }) => used !== false });

  // Passive hero powers whose effect is already reflected in the board snapshot.
  registerEffect(
    [
      'TB_BaconShop_HP_010', // Boon of Light
      'TB_BaconShop_HP_024', // Reborn Rites
      'TB_BaconShop_HP_105', // Avatar of N'Zoth (the Fish is a minion)
      'BG21_HERO_030p', // Pilot the Shredder
      'BG31_HERO_005p', // Cloning Gallery
      'TB_BaconShop_HP_080', // Kel'Thuzad's Kitty
      'BG22_HERO_001p', // Embrace the Elements (choice; the chosen _t* power is what's equipped)
    ],
    { noCombatEffect: true },
  );
}
