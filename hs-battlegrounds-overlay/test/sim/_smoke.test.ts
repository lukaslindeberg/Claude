import { it } from 'vitest';
import { simulateBattle } from '../../src/core/sim';
import { battle, minion, side, vanilla } from './helpers';

import { appendFileSync } from 'node:fs';
const log = (...a: unknown[]) => appendFileSync('/tmp/claude-0/-home-user/c8c7d4b0-1f63-5d18-af69-c30c0eb9f10d/scratchpad/smoke.log', a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');
it('smoke', () => {
  const r1 = simulateBattle(battle(side([vanilla(3, 3)]), side([vanilla(2, 2)])), { iterations: 100, seed: 1 });
  log('3/3 vs 2/2', r1);
  const r2 = simulateBattle(battle(side([vanilla(1, 1)]), side([vanilla(1, 1)])), { iterations: 100, seed: 1 });
  log('1/1 vs 1/1', r2.win, r2.tie, r2.loss);
  const board = () => [minion('BG28_300'), minion('BG30_125'), minion('BG31_803'), minion('BGS_018'), minion('BG25_010'), minion('BG_BOT_606'), minion('BG29_611')];
  const t0 = Date.now();
  const r3 = simulateBattle(battle(side(board(), { tavernTier: 5 }), side(board(), { tavernTier: 5 })), { iterations: 4000, seed: 7, maxDurationMs: 100000 });
  log('sym', r3, Date.now() - t0);
});
