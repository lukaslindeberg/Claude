import type { BattleSimResult, MatchRecord } from '../../src/shared/types';

export function sim(win: number): BattleSimResult {
  return {
    win,
    tie: 0,
    loss: 100 - win,
    avgDamageDealt: 5,
    avgDamageTaken: 4,
    lethalWin: 0,
    lethalLoss: 0,
    iterations: 1000,
    durationMs: 10,
    unsupported: [],
  };
}

let n = 0;
export function match(partial: Partial<MatchRecord> = {}): MatchRecord {
  n++;
  return {
    id: `game-${n}`,
    startedAt: 1_700_000_000_000 + n * 1000,
    endedAt: 1_700_000_000_000 + n * 1000 + 500,
    mode: 'solo',
    gameType: 'GT_BATTLEGROUNDS',
    heroCardId: 'TB_BaconShop_HERO_01',
    heroName: 'Hero',
    baseHeroCardId: 'TB_BaconShop_HERO_01',
    heroOptions: [],
    placement: 4,
    turns: 10,
    finalTier: 5,
    finalBoard: [],
    availableTribes: [],
    tierHistory: [],
    combats: [],
    healthHistory: [],
    lobby: [],
    ...partial,
  };
}
