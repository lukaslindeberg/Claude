/**
 * Public API of the Battlegrounds combat simulator.
 *
 *   import { simulateBattle } from '@core/sim';
 *   const result = simulateBattle(input, { iterations: 4000, seed: 1 });
 */
export {
  simulateBattle,
  simulateOnce,
  findUnsupportedCards,
  DEFAULT_ITERATIONS,
  DEFAULT_MAX_DURATION_MS,
} from './simulate';
export type { SimWorkerRequest, SimWorkerResponse } from './worker';
export {
  ensureCardsRegistered,
  registerMinion,
  registerEffect,
  registerEnchantment,
  getMinionHandler,
  getEffectHandler,
  registeredMinionIds,
  registeredEffectIds,
} from './cards';
export { Rng } from './engine/rng';
export { createBattle, runBattle, type BattleOutcome } from './engine/battle';
export type {
  Battle,
  CardHandler,
  EffectHandler,
  EnchantmentHandler,
  Minion,
  SideState,
  DeathContext,
  AttackInfo,
} from './engine/types';
