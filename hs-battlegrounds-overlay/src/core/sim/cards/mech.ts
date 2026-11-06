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
      for (let i = 0; i < self.mult; i++) buff(b, target, sd(b, self, 1, 5), sd(b, self, 2, 5));
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
      'BG31_177', // Mechagnome Interpreter
      'BG26_147', // Accord-o-Tron
      'BG_BOT_911', // Annoy-o-Module (keywords)
      'BG34_170', // Auto Accelerator
      'BG36_854', // Rescue Bot (deathrattle: get a card)
      'BG_DEEP_015', // Prosthetic Hand (keywords)
      'BG34_171', // Conveyor Construct (deathrattle: get a card)
      'BG36_506', // Drone Duplicator
      'BG35_341', // Enchanted Sentinel
      'BG36_851', // Spark Snapper
      'BG36_366', // Resourceful Robot
      'BGDUO_109', // Support System
      'BG36_367', // Auto Reveille
      'BG26_152', // Utility Drone
      'BG26_149', // Polarizing Beatboxer
      'BGDUO31_211', // Transport Reactor
      'BG31_171t', // Satellite
      'BG34_Giant_610t', // Satellite
      'BG_BOT_312t', // Microbot
      'BG_EX1_556t', // Damaged Golem
    ],
    { noCombatEffect: true },
  );
}
