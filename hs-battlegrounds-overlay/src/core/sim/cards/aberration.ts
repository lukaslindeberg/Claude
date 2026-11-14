/**
 * Aberration handlers, incl. the Deity (Old God) mechanic.
 *
 * Deity model: the side's Deity (from playerTags BACON_GLOBAL_OLD_GOD_DBID /
 * BACON_OLD_GOD_ATTACK / BACON_OLD_GOD_HEALTH) awakens - is summoned - after 4
 * friendly Aberrations died this combat. "Give your Deity +X/+Y" buffs the
 * pending stats, or the awakened minion.
 */
import { registerMinion } from './registry';
import {
  aliveMinions,
  buff,
  buffAll,
  copyMinion,
  dealDamage,
  giveDeity,
  giveTeamDeities,
  hasTribe,
  highestBy,
  sd,
  summon,
  summonForDeath,
} from './helpers';
import type { Battle, CardHandler, Minion, SideState } from '../engine/types';

const TENTACLE = 'BGFYM_002t';
const HAND_LIMIT = 10;

// ---------------------------------------------------------------------------
// Cards added to the hand during combat. Only The Shadow of Doubt reacts to it;
// the "get a card" effects of the group-2 files (and a few side effects) call this.
// ---------------------------------------------------------------------------

/** The Shadow of Doubt (T6): Whenever a card is added to your hand, give your Deity +4/+5. */
const SHADOW_OF_DOUBT: CardHandler = {};
const addedThisCombat = new WeakMap<SideState, number>();

/**
 * `n` cards are added to `side`'s hand in combat (stops at the 10-card hand limit; the
 * combat hand holds every card in hand). Returns how many fit.
 */
export function cardsAddedToHand(b: Battle, side: SideState, n: number): number {
  const added = addedThisCombat.get(side) ?? 0;
  const k = Math.min(n, Math.max(0, HAND_LIMIT - side.hand.length - added));
  if (k <= 0) return 0;
  addedThisCombat.set(side, added + k);
  for (const m of aliveMinions(side)) {
    if (m.handler !== SHADOW_OF_DOUBT) continue;
    const a = sd(b, m, 1, 4 * m.mult);
    const h = sd(b, m, 2, 5 * m.mult);
    for (let i = 0; i < k; i++) giveDeity(b, side, a, h);
  }
  for (const m of aliveMinions(side)) (m.handler as HandAddHandler | undefined)?.onCardsAddedToHand?.(b, m, k);
  return k;
}

/** Minions reacting to cards added to the hand in combat (Timewarped Peggy) implement this extra hook. */
export interface HandAddHandler extends CardHandler {
  onCardsAddedToHand?(b: Battle, self: Minion, count: number): void;
}

/** Handler for "Deathrattle / Rally / Avenge: Get N card(s)" (golden: double): only notifies the hand. */
export const getsCards = (n: number, ...hooks: ('deathrattle' | 'rally')[]): CardHandler => {
  const h: CardHandler = {};
  for (const hook of hooks) {
    if (hook === 'deathrattle') h.deathrattle = (b, self, ctx) => void cardsAddedToHand(b, self.side, n * ctx.mult);
    else h.rally = (b, self) => void cardsAddedToHand(b, self.side, n * self.mult);
  }
  return h;
};

/** "Avenge (X): Get N card(s)" (golden: double). */
export const avengeGetsCards = (avenge: number, n: number): CardHandler => ({
  avenge,
  onAvenge: (b, self) => void cardsAddedToHand(b, self.side, n * self.mult),
});

export function registerAberrations(): void {
  // Underrot Spawn (T2): Deathrattle: Summon an 0/2 Tentacle with Taunt. Give your minions +1 Attack.
  registerMinion('BG36_116', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, TENTACLE, ctx.mult);
      buffAll(b, self.side, sd(b, self, 1, ctx.mult), 0);
    },
  });

  // Drifting Sacrifice (T3): Reborn. Deathrattle: Give your Deity +2/+1.
  registerMinion('BG36_113', {
    deathrattle: (b, self, ctx) => giveDeity(b, self.side, sd(b, self, 1, 2 * ctx.mult), sd(b, self, 2, ctx.mult)),
  });

  // Faceless Converter (T5): Deathrattle: Give your Deity +2/+1 (improved by spells; tags).
  registerMinion('BG36_318', {
    deathrattle: (b, self, ctx) => giveDeity(b, self.side, sd(b, self, 1, 2 * ctx.mult), sd(b, self, 2, ctx.mult)),
  });

  // Vicious Mindslasher (T3): Whenever you cast a Tavern spell, give this and your Deity +1/+2.
  registerMinion('BG36_108', {
    onSpellCast: (b, self) => {
      const a = sd(b, self, 1, self.mult);
      const h = sd(b, self, 2, 2 * self.mult);
      buff(b, self, a, h);
      giveDeity(b, self.side, a, h);
    },
  });

  // C'Thrax Wrecker (T5, Duos): Battlecry, Deathrattle, and Rally: Give your team's Deities +4/+4.
  registerMinion('BGDUO_701', {
    rally: (b, self) => giveTeamDeities(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 4 * self.mult)),
    deathrattle: (b, self, ctx) => giveTeamDeities(b, self.side, sd(b, self, 1, 4 * ctx.mult), sd(b, self, 2, 4 * ctx.mult)),
  });

  // De-volition-ist (T5): After this attacks, deal damage equal to this minion's Attack (golden:
  // double) to the highest-Health enemy minion.
  registerMinion('BG36_102', {
    afterAttack: (b, self) => {
      const t = highestBy(b, aliveMinions(self.side.opponent), (m) => m.health);
      if (t) dealDamage(b, self, t, self.attack * self.mult);
    },
  });

  // Sha of Fear (T7): Whenever you cast a Tavern spell, give your minions and Deity +3/+3.
  registerMinion('BG36_111', {
    onSpellCast: (b, self) => {
      const a = sd(b, self, 1, 3 * self.mult);
      const h = sd(b, self, 2, 3 * self.mult);
      buffAll(b, self.side, a, h);
      giveDeity(b, self.side, a, h);
    },
  });

  // C'Thun (Deity): After this awakens, give this minion's stats split amongst your other minions.
  registerMinion('BGFYM_000', {
    onSummoned: (b, self) => {
      if (!self.isDeity) return;
      const others = aliveMinions(self.side).filter((m) => m !== self);
      if (!others.length) return;
      const k = self.mult;
      const atk = self.attack * k;
      const hp = self.health * k;
      // Split as evenly as possible, remainder to random minions.
      const n = others.length;
      for (const m of others) buff(b, m, Math.floor(atk / n), Math.floor(hp / n));
      for (const m of b.rng.sample(others, atk % n)) buff(b, m, 1, 0);
      for (const m of b.rng.sample(others, hp % n)) buff(b, m, 0, 1);
    },
  });

  // Y'Shaarj (Deity): Deathrattle: Summon your first 2 Aberrations that died this combat with their
  // maximum stats (except Deities).
  registerMinion('BGFYM_011', {
    deathrattle: (b, self, ctx) => {
      const n = sd(b, self, 1, 2 * ctx.mult);
      const dead = self.side.deadThisCombat.filter((m: Minion) => hasTribe(m, 'ABERRATION') && !m.isDeity && m !== self);
      for (const d of dead.slice(0, n)) {
        const m = copyMinion(b, d);
        m.health = m.maxHealth;
        if (!summon(b, self.side, m, ctx.anchor)) break;
      }
    },
  });

  // Dark Puppeteer (T6): Deathrattle: Your Tavern spells give an extra +4 Health this game.
  registerMinion('BG36_104', {
    deathrattle: (b, self, ctx) => void (self.side.spellHealthBonus += sd(b, self, 1, 4 * ctx.mult)),
  });

  registerMinion('BG36_109', SHADOW_OF_DOUBT);
  // Unwilling Slacker (T3): Deathrattle: Get a random 1-Cost Tavern spell (golden: two).
  registerMinion('BG36_101', getsCards(1, 'deathrattle'));
  // N'raqi Sapper (T5): Battlecry and Deathrattle: Get an Energizing Chamber (golden: two).
  registerMinion('BG36_103', getsCards(1, 'deathrattle'));

  registerMinion(
    [
      'BG36_110', // Joyous (battlecry)
      'BG36_098', // Zoatroid
      'BG36_099', // Brain Rotter
      'BG36_100', // Wandering Willbreaker
      'BG36_311', // Abyssal Envoy
      'BG36_112', // Fetid Corroder
      'BGDUO_700', // Voidpriest Cloner
      'BG36_106', // Cutthroat K'Thir (discard)
      'BG36_308', // Faceless Operative
      'BG36_312', // Mindbending Recruiter
      'BG36_115', // Nightmare Corroder
      'BG36_114', // Parasitic Fleshling
      'BGFYM_005', // Harbinger Aph'lass (discard)
      'BG36_097', // Mindbender Ghur'sha (discard)
      'BG36_320', // Mysterious K'Thir
      'BG36_300', // N'raqi Frostcaller
      TENTACLE,
      'TB_BaconShop_HERO_29_Buddy', // Tentacle of C'Thun
    ],
    { noCombatEffect: true },
  );
}
