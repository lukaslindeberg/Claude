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
  hasTribe,
  highestBy,
  sd,
  summon,
  summonForDeath,
} from './helpers';
import type { Minion } from '../engine/types';

const TENTACLE = 'BGFYM_002t';

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
    rally: (b, self) => giveDeity(b, self.side, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 4 * self.mult)),
    deathrattle: (b, self, ctx) => giveDeity(b, self.side, sd(b, self, 1, 4 * ctx.mult), sd(b, self, 2, 4 * ctx.mult)),
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

  registerMinion(
    [
      'BG36_110', // Joyous (battlecry)
      'BG36_098', // Zoatroid
      'BG36_099', // Brain Rotter
      'BG36_100', // Wandering Willbreaker
      'BG36_311', // Abyssal Envoy
      'BG36_112', // Fetid Corroder
      'BG36_101', // Unwilling Slacker (deathrattle: get a spell)
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
      'BG36_103', // N'raqi Sapper (deathrattle: get a card)
      'BG36_104', // Dark Puppeteer (deathrattle: Tavern spells)
      'BG36_109', // The Shadow of Doubt (cards added to hand; not simulated in combat)
      TENTACLE,
      'TB_BaconShop_HERO_29_Buddy', // Tentacle of C'Thun
    ],
    { noCombatEffect: true },
  );
}
