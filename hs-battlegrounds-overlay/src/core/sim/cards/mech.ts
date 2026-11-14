/** Mech handlers. */
import { registerMinion } from './registry';
import { TAG } from '../engine/constants';
import {
  aliveMinions,
  buff,
  dealDamage,
  giveDivineShield,
  hasTribe,
  sd,
  summonForDeath,
} from './helpers';
import type { Battle, CardHandler, Minion } from '../engine/types';

/** Mech handlers may react to a Magnetization made in combat (Glambot's Satellites). */
export interface MagnetHandler extends CardHandler {
  onMagnetize?(b: Battle, self: Minion, host: Minion): void;
}

const BEATBOXER = 'BG26_149';

/**
 * Magnetize a Mech with `attack`/`health` to `host` during combat: the host gains the stats,
 * then "whenever you Magnetize" triggers run (Mechagnome Interpreter), then Polarizing
 * Beatboxer copies the Magnetization to itself (golden: twice). Echoes do not echo again.
 */
export function magnetize(b: Battle, host: Minion, attack: number, health: number, echo = true): void {
  if (host.removed) return;
  buff(b, host, attack, health);
  for (const m of aliveMinions(host.side)) (m.handler as MagnetHandler | undefined)?.onMagnetize?.(b, m, host);
  if (!echo) return;
  for (const m of aliveMinions(host.side)) {
    if (m === host || b.db.normalOf(m.cardId) !== BEATBOXER) continue;
    for (let i = 0; i < m.mult; i++) magnetize(b, m, attack, health, false);
  }
}

export function registerMechs(): void {
  // Cord Puller (T1): Divine Shield. Deathrattle: Summon a 1/1 Microbot (golden: a 2/2 Microbot).
  registerMinion('BG29_611', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, ctx.golden ? 'TB_BaconUps_032t' : 'BG_BOT_312t', 1);
    },
  });

  // Relentless Deflector (T3): Has Taunt while this has Divine Shield. Avenge (3): Gain Divine Shield.
  registerMinion('BG34_405', {
    init: (_b, self) => {
      self.taunt = self.divineShield;
    },
    onDivineShieldChanged: (_b, self, has) => {
      self.taunt = has;
    },
    avenge: 3,
    onAvenge: (b, self) => giveDivineShield(b, self),
  });

  // Glambot (T4): Whenever you cast a spell on a Mech, Magnetize a 5/5 Satellite to it (golden: twice).
  registerMinion('BG36_853', {
    onSpellCast: (b, self, _spell, target) => {
      if (!target || !hasTribe(target, 'MECHANICAL')) return;
      for (let i = 0; i < self.mult; i++) magnetize(b, target, sd(b, self, 1, 5), sd(b, self, 2, 5));
    },
  });

  // Mechagnome Interpreter (T2): Whenever you play or Magnetize a Mech, give it +3/+1 (golden +6/+2).
  // In combat only Magnetizations happen (Glambot); the magnetized Mech's stats go to the host.
  const interpreter: MagnetHandler = {
    onMagnetize: (b, self, host) => buff(b, host, sd(b, self, 1, 3 * self.mult), sd(b, self, 2, self.mult)),
  };
  registerMinion('BG31_177', interpreter);

  // Polarizing Beatboxer (T7): Whenever you Magnetize to a different minion, it also Magnetizes to
  // this (golden: twice). Implemented inside `magnetize`.
  const beatboxer: MagnetHandler = {};
  registerMinion(BEATBOXER, beatboxer);

  // Enchanted Sentinel (T4): Magnetic. Your Tavern spells give an extra +1/+X (golden +2/+X).
  // The aura is part of the player's TAVERN_SPELL_*_INCREASE tags while it is on the board: remove it
  // when it dies, add it when one is summoned in combat. (Magnetized copies are not tracked.)
  registerMinion('BG35_341', {
    onSummoned: (b, self) => {
      self.side.spellAttackBonus += sd(b, self, 2, self.mult);
      self.side.spellHealthBonus += sd(b, self, 3, self.mult);
    },
    onSelfDeath: (b, self) => {
      const s = self.side;
      s.spellAttackBonus = Math.max(0, s.spellAttackBonus - sd(b, self, 2, self.mult));
      s.spellHealthBonus = Math.max(0, s.spellHealthBonus - sd(b, self, 3, self.mult));
    },
  });

  // Charging Czarina (T5): Whenever you cast a Tavern spell, give your minions with Divine Shield +4 Attack.
  registerMinion('BG28_741', {
    onSpellCast: (b, self) => {
      const a = sd(b, self, 1, 4 * self.mult);
      for (const m of aliveMinions(self.side)) if (m.divineShield) buff(b, m, a, 0);
    },
  });

  // Falling Sky Golem (T6): Has +4/+2 for each Deathrattle you've triggered this game (wherever this is).
  registerMinion('BG35_342', {
    onDeathrattleTriggered: (b, self) => buff(b, self, sd(b, self, 1, 4 * self.mult), sd(b, self, 2, 2 * self.mult)),
  });

  // Kaboom Bot: Deathrattle: Deal 4 damage to a random enemy minion (golden: twice).
  registerMinion('BG_BOT_606', {
    deathrattle: (b, self, ctx) => {
      for (let i = 0; i < ctx.mult; i++) {
        const t = b.rng.pick(aliveMinions(self.side.opponent));
        if (t) dealDamage(b, self, t, sd(b, self, 1, 4));
      }
    },
  });

  // Harvest Golem: Deathrattle: Summon a 2/1 Damaged Golem.
  registerMinion('BG_EX1_556', {
    deathrattle: (b, self, ctx) => {
      summonForDeath(b, self, ctx, 'BG_EX1_556t', 1, { golden: ctx.golden });
    },
  });

  // Foe Reaper 4000: Also damages the minions next to whomever it attacks.
  registerMinion('BG_GVG_113', { init: (_b, self) => void (self.cleave = true) });

  // Ancestral Automaton: Has +3/+2 for each other Ancestral Automaton you've summoned this game.
  registerMinion('BG_TTN_401', {
    init: (_b, self) => {
      if (self.snapshot) return;
      const n = self.side.playerTags[TAG.AUTOMATONS_SUMMONED] ?? 0;
      self.attack += 3 * self.mult * n;
      self.health += 2 * self.mult * n;
      self.maxHealth = self.health;
    },
  });

  registerMinion(
    [
      'BG26_146', // Lullabot
      'BG34_170t2', // Blue Volumizer
      'BG34_170t3', // Green Volumizer
      'BG34_170t', // Red Volumizer
      'BG26_147', // Accord-o-Tron
      'BG_BOT_911', // Annoy-o-Module (keywords)
      'BG34_170', // Auto Accelerator
      'BG36_854', // Rescue Bot (deathrattle: get a card)
      'BG_DEEP_015', // Prosthetic Hand (keywords)
      'BG34_171', // Conveyor Construct (deathrattle: get a card)
      'BG36_506', // Drone Duplicator
      'BG36_851', // Spark Snapper
      'BG36_366', // Resourceful Robot
      'BGDUO_109', // Support System
      'BG36_367', // Auto Reveille
      'BG26_152', // Utility Drone
      'BGDUO31_211', // Transport Reactor
      'BG31_171t', // Satellite
      'BG34_Giant_610t', // Satellite
      'BG_BOT_312t', // Microbot
      'BG_EX1_556t', // Damaged Golem
    ],
    { noCombatEffect: true },
  );
}
