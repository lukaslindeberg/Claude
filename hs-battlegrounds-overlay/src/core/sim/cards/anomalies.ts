/**
 * Anomalies with combat effects. The anomaly is added as an effect to BOTH sides,
 * so handlers act on `e.side` only.
 */
import { registerEffect } from './registry';
import {
  aliveMinions,
  copyMinion,
  giveDivineShield,
  giveReborn,
  highestBy,
  leftMost,
  rightMost,
  rightOfAnchor,
  summon,
} from './helpers';

export function registerAnomalies(): void {
  // Curse of Aggramar: Your hero can only take 1 damage at a time (combat damage is capped at 1).
  registerEffect('BG27_Anomaly_006', {
    init: (b) => {
      const cap = b.input.damageCap;
      if (!(typeof cap === 'number' && cap > 0 && cap <= 1)) b.input = { ...b.input, damageCap: 1 };
    },
  });

  // Anomalous Twin: Start of Combat: Summon a copy of your highest-Health minion.
  registerEffect('BG27_Anomaly_560', {
    startOfCombat: (b, e) => {
      const m = highestBy(b, aliveMinions(e.side), (x) => x.health);
      if (m) summon(b, e.side, copyMinion(b, m), rightOfAnchor(m));
    },
  });
  // Blessed or Blighted: Start of Combat: Give your left-most minion Divine Shield and your
  // right-most minion Reborn.
  registerEffect('BG27_Anomaly_726', {
    startOfCombat: (b, e) => {
      const l = leftMost(e.side);
      const r = rightMost(e.side);
      if (l) giveDivineShield(b, l);
      if (r) giveReborn(r);
    },
  });
  // Echoes of Argus: Your Battlecries and Deathrattles trigger an extra time.
  registerEffect('BG27_Anomaly_802', { init: (_b, e) => void (e.side.extraDeathrattleTriggers += 1) });

  registerEffect(
    [
      'BG27_Anomaly_505', // Reckless Enhancement (Tavern)
      'BG27_Anomaly_558', // Feline Fortune
      'BG27_Anomaly_714', // Everything's on Fire!
      'BG27_Anomaly_810', // Bring in the Buddies
      'BG27_Anomaly_Buddies',
      'BG33_Anomaly_005', // Colorful Camaraderie
      'BG27_Anomaly_575', // Eleventh Hour (affects hero health, not the fight)
    ],
    { noCombatEffect: true },
  );
}
