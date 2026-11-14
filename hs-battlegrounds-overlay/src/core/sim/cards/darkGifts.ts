/**
 * Dark Gifts: minion bonuses of the BG36 mid-game event (`BG36_MidGameEffect_000t*` spells).
 * Each gift is an enchantment on the minion; the enchantment id that marks the gift was read
 * from real game logs (marker = the enchantment present on the board before combat):
 *   Jaws of Death t16e, Admiration t9e2, Hostility t71e, Offensive Sacrifice te2 (te3 = its
 *   +10 Attack, te = the buff it hands over), Defensive Sacrifice t2e2, Golemancy t61e.
 * For Resistance, Transcendence and Worship the marker was not observed: both ids are
 * registered and the effect runs once per minion.
 *
 * Stat-only gifts (Fortitude, Titanic Strength, "Has +X/+X for each ...") and keyword gifts
 * (Harpy's Talons, Toxicity, Furtiveness) are already part of the snapshot. Shop-only gifts are
 * listed in `DARK_GIFT_SHOP_ONLY` so that they count as known.
 */
import { IMMUNE_WHILE_ATTACKING } from '../engine/attack';
import { FULL_REBORN } from '../engine/minion';
import type { Battle, CardHandler, DeathrattleFn, Minion } from '../engine/types';
import { cardsAddedToHand } from './aberration';
import {
  SHIELD_HITS,
  aliveMinions,
  buff,
  copyMinion,
  counter,
  indexOf,
  minionFromCard,
  randomFriendly,
  rightOfAnchor,
  setCounter,
  summon,
  triggerDeathrattlesArtificially,
} from './helpers';
import { registerEnchantment } from './registry';

const P = 'BG36_MidGameEffect_000';

/** Gifts without any effect during combat (end of turn, on play, Activate, sell, passive stats). */
export const DARK_GIFT_SHOP_ONLY: readonly string[] = [
  't10e2', // Echoing Voice
  't11e', 't11e2', // Double Vision
  't13e', // Harpy's Talons (keywords in the snapshot)
  't14e', // Gilding
  't18e', // Replication
  't21e', // Time Turning
  't28e', 't28te', // Battle Scars
  't2e', 't2e3', // Defensive Sacrifice: stats
  't4e', 't4e2', 't4e3', 't4e4', // Incubation
  't50e', // Tarecgosa's Blessing
  't51e', 't51e2', // Steady Growth
  't52e', // Fresh Perspective (Deathrattle: free Refreshes)
  't61e2', // Golemancy: the Golem's stats
  't62e', // Sunken Persistence
  't64e', 't64e2', 't64te', 't64te2', // Dexterity
  't65e', // Polarization
  't66e', // Demonology
  't69e', // Toxicity (keyword)
  't71e2', // Hostility: the doubled Attack
  't72e', // Titanic Strength
  't73e', // Fortitude
  't74e', 't74e2', // Sharpened Sword
  't75e', 't75e2', // Toughened Shield
  't78e', // Efficiency
  't79e', // Furtiveness (keyword)
  't82e', // Affinity
  't88e', // Desecration
  't9e', // Admiration: the gained Attack
  'te', 'te3', // Offensive Sacrifice: stats
].map((s) => P + s);

/** Run a Start of Combat gift once per minion even when two of its enchantment ids are present. */
function once(name: string, fn: (b: Battle, self: Minion) => void): Partial<CardHandler> {
  return {
    startOfCombat: (b, self) => {
      if (counter(self, `gift:${name}`, 0) > 0) return;
      setCounter(self, `gift:${name}`, 1);
      fn(b, self);
    },
  };
}

function other(b: Battle, self: Minion): Minion | undefined {
  return randomFriendly(b, self.side, (m) => m !== self);
}

const GOLEM: DeathrattleFn = (b, self, ctx) => {
  const golem = minionFromCard(b, self.side, `${P}t61t`, {
    attack: self.attack,
    health: self.maxHealth,
    name: 'Golem',
    tier: 1,
    tribes: [],
  });
  summon(b, self.side, golem, ctx.anchor);
};

export function registerDarkGifts(): void {
  for (const id of DARK_GIFT_SHOP_ONLY) registerEnchantment(id, {});

  // Offensive Sacrifice: Deathrattle: Give this minion's Attack to another friendly minion.
  registerEnchantment(`${P}te2`, {
    deathrattle: (b, self) => {
      const t = other(b, self);
      if (t) buff(b, t, self.attack, 0);
    },
  });
  // Defensive Sacrifice: Deathrattle: Give this minion's max Health to another friendly minion.
  registerEnchantment(`${P}t2e2`, {
    deathrattle: (b, self) => {
      const t = other(b, self);
      if (t) buff(b, t, 0, self.maxHealth);
    },
  });
  // Golemancy: Deathrattle: Summon a Golem with this minion's stats.
  registerEnchantment(`${P}t61e`, { deathrattle: GOLEM });
  // Mystic Essence: Deathrattle: Get a random Tavern spell (only the hand count matters).
  registerEnchantment(`${P}t5e2`, { deathrattle: (b, self) => void cardsAddedToHand(b, self.side, 1) });
  // Charisma: Rally: Get a random minion. Consanguinity: Rally: Get 2 Blood Gems.
  registerEnchantment(`${P}t3e2`, { hooks: { rally: (b, self) => void cardsAddedToHand(b, self.side, 1) } });
  registerEnchantment(`${P}t80e`, { hooks: { rally: (b, self) => void cardsAddedToHand(b, self.side, 2) } });

  // Persisting Horror: Reborn. Is Reborn with full stats and Bonus Keywords.
  registerEnchantment(`${P}t12e`, { init: (_b, self) => setCounter(self, FULL_REBORN, 1) });
  // Toreth's Blessing: This minion's Divine Shield takes 3 hits to break.
  registerEnchantment(`${P}t15e`, { init: (_b, self) => setCounter(self, SHIELD_HITS, 2) });
  // Invulnerability: Immune while attacking.
  registerEnchantment(`${P}t60e`, { init: (_b, self) => setCounter(self, IMMUNE_WHILE_ATTACKING, 1) });
  // Amalgamation: Has all minion types.
  registerEnchantment(`${P}t22e`, { init: (_b, self) => void (self.tribes = ['ALL']) });

  // Jaws of Death: Start of Combat: Trigger this minion's Deathrattles.
  registerEnchantment(`${P}t16e`, { hooks: once('jaws', (b, self) => triggerDeathrattlesArtificially(b, self)) });
  // Admiration: Start of Combat: Gain the Attack of the minion to the left.
  registerEnchantment(`${P}t9e2`, {
    hooks: once('admiration', (b, self) => {
      const left = self.side.board[indexOf(self) - 1];
      if (left && !left.removed) buff(b, self, left.attack, 0);
    }),
  });
  // Hostility: +15 Attack. Start of Combat: Double this minion's Attack.
  registerEnchantment(`${P}t71e`, { hooks: once('hostility', (b, self) => buff(b, self, self.attack, 0)) });
  // Resistance: +15 Health. Start of Combat: Double this minion's Health.
  registerEnchantment([`${P}t7e`, `${P}t7e2`], { hooks: once('resistance', (b, self) => buff(b, self, 0, self.health)) });
  // Transcendence: Start of Combat: Triple this minion's stats.
  registerEnchantment([`${P}t81e`, `${P}t81e2`], {
    hooks: once('transcendence', (b, self) => buff(b, self, 2 * self.attack, 2 * self.health)),
  });
  // Worship: Start of Combat: Gain the stats of your Deity.
  registerEnchantment([`${P}t89e`, `${P}t89e2`], {
    hooks: once('worship', (b, self) => {
      const d = self.side.deity;
      if (!d) return;
      const src = d.minion && !d.minion.removed ? d.minion : d;
      buff(b, self, src.attack, src.health);
    }),
  });
  // Doppelganger: Start of Combat: Summon a copy of this.
  registerEnchantment(`${P}t90e`, {
    hooks: once('doppelganger', (b, self) => {
      if (aliveMinions(self.side).length >= 7) return;
      summon(b, self.side, copyMinion(b, self), rightOfAnchor(self));
    }),
  });

  // Death's Embrace: Has +2/+2 (lesser: +1/+1) for each Deathrattle you've triggered this game.
  registerEnchantment(`${P}t29e`, { hooks: { onDeathrattleTriggered: (b, self) => buff(b, self, 2, 2) } });
  registerEnchantment(`${P}t29te`, { hooks: { onDeathrattleTriggered: (b, self) => buff(b, self, 1, 1) } });
  // Spell Siphon: Has +3/+3 (lesser: +2/+2) for each Tavern spell you've cast this game.
  registerEnchantment(`${P}t30e`, { hooks: { onSpellCast: (b, self) => buff(b, self, 3, 3) } });
  registerEnchantment(`${P}t30te`, { hooks: { onSpellCast: (b, self) => buff(b, self, 2, 2) } });
}
