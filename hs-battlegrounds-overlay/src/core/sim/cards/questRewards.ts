/** Quest rewards with combat effects (side-level effects). */
import { registerEffect } from './registry';
import {
  destroy,
  aliveMinions,
  attackImmediately,
  buff,
  buffAll,
  copyMinion,
  dealDamage,
  giveDivineShield,
  highestBy,
  leftMost,
  minionFromCard,
  queueSpaceSummon,
  rightMost,
  rightOfAnchor,
  summon,
} from './helpers';
import { makeGolden } from './neutral';
import { cardsAddedToHand } from './aberration';

export function registerQuestRewards(): void {
  // Stolen Gold: Start of Combat: Make your left and right-most minions Golden.
  registerEffect('BG24_Reward_109', {
    startOfCombat: (b, e) => {
      const l = leftMost(e.side);
      const r = rightMost(e.side);
      if (l) makeGolden(b, l);
      if (r && r !== l) makeGolden(b, r);
    },
  });

  // Staff of Origination: Start of Combat: Give your minions +12/+12.
  registerEffect('BG24_Reward_312', { startOfCombat: (b, e) => buffAll(b, e.side, 12, 12) });
  // Evil Twin: Start of Combat: Summon a copy of your highest-Health minion.
  registerEffect('BG24_Reward_111', {
    startOfCombat: (b, e) => {
      const m = highestBy(b, aliveMinions(e.side), (x) => x.health);
      if (m) summon(b, e.side, copyMinion(b, m), rightOfAnchor(m));
    },
  });
  // Righteous Charge: Start of Combat: Your left-most minion gains Divine Shield and attacks immediately.
  registerEffect('BG33_Reward_003', {
    startOfCombat: (b, e) => {
      const m = leftMost(e.side);
      if (!m) return;
      giveDivineShield(b, m);
      attackImmediately(b, m);
    },
  });
  // Boom Squad: Avenge (3): Deal 10 damage to the highest-Health enemy minion.
  registerEffect('BG27_Reward_502', {
    avenge: 3,
    onAvenge: (b, e) => {
      const t = highestBy(b, aliveMinions(e.side.opponent), (m) => m.health);
      if (t) dealDamage(b, null, t, 10);
    },
  });
  // Turbulent Tombs: Your Deathrattles trigger an extra time.
  registerEffect('BG27_Reward_803', { init: (_b, e) => void (e.side.extraDeathrattleTriggers += 1) });
  // Tumbling Disaster: Whenever you summon a minion in combat, give it +1/+1. Avenge (4): Improve this.
  registerEffect('BG28_Reward_505', {
    init: (_b, e) => void (e.data.bonus = Math.max(1, e.scriptData1 ?? 1)),
    onFriendlySummon: (b, e, m) => buff(b, m, e.data.bonus, e.data.bonus),
    avenge: 4,
    onAvenge: (_b, e) => void (e.data.bonus += 1),
  });
  // Stable Amalgamation: Avenge (7): When you have space, summon a 50/50 Amalgam.
  registerEffect('BG28_Reward_518', {
    avenge: 7,
    onAvenge: (_b, e) =>
      queueSpaceSummon(e.side, { remaining: 1, make: (bb, s) => minionFromCard(bb, s, 'BG28_Reward_518t') }),
  });

  // Cycle of Energy: Avenge (3): Get a random Tavern spell (only the hand count matters in combat).
  registerEffect('BG28_Reward_504', { avenge: 3, onAvenge: (b, e) => void cardsAddedToHand(b, e.side, 1) });

  // Volatile Venom: Your minions have +7/+7. After they attack, they die. Horribly.
  // Snapshot stats include the +7/+7; minions summoned in combat get it on summon.
  registerEffect('BG24_Reward_364', {
    init: (_b, e) => void e.side.summonBuffs.push({ attack: 7, health: 7 }),
    afterFriendlyAttack: (b, _e, info) => {
      if (!info.attacker.removed) destroy(b, info.attacker);
    },
  });

  registerEffect(
    [
      'BG24_Reward_113', // Ritual Dagger (permanent stats on dead minions)
      'BG33_Reward_004', // Grim Freshener (free Refresh)
      'BG24_Reward_138', // Victim's Specter (after combat: get a copy)
      'BG24_Reward_708', // Blood Goblet (end of turn: Attack on the right-most minion, in the snapshot)
    ],
    { noCombatEffect: true },
  );
}
