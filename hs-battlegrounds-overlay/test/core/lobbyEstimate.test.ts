import { describe, expect, it } from 'vitest';
import { bestAndWorstTribes, lobbyEstimate } from '../../src/core/stats/lobby';
import type { HeroStat } from '../../src/shared/types';

const hero: HeroStat = {
  heroCardId: 'X',
  avgPlacement: 4.0,
  games: 1000,
  tribeStats: [
    { tribe: 'UNDEAD', games: 500, avgPlacement: 3.6, impact: -0.4 },
    { tribe: 'MURLOC', games: 480, avgPlacement: 4.3, impact: 0.3 },
    { tribe: 'BEAST', games: 3, avgPlacement: 2.0, impact: -2.0 },
    { tribe: 'MECHANICAL', games: 510, avgPlacement: 4.02, impact: 0.02 },
  ],
};

describe('lobbyEstimate', () => {
  it('adds the impact of each lobby tribe with data', () => {
    const e = lobbyEstimate(hero, ['UNDEAD', 'MURLOC', 'NAGA'], { minGames: 30 })!;
    expect(e.avgPlacement).toBeCloseTo(3.9, 5);
    expect(e.tribes).toEqual(['UNDEAD', 'MURLOC']);
    expect(e.contributions[0]).toEqual({ tribe: 'UNDEAD', impact: -0.4 });
  });
  it('ignores tribes with too little data and clamps to 1..maxPlace', () => {
    expect(lobbyEstimate(hero, ['BEAST'], { minGames: 30 })).toBeUndefined();
    expect(lobbyEstimate({ avgPlacement: 1.2, tribeStats: hero.tribeStats }, ['BEAST'])!.avgPlacement).toBe(1);
  });
  it('is undefined without tribe data or lobby tribes', () => {
    expect(lobbyEstimate({ avgPlacement: 4 }, ['UNDEAD'])).toBeUndefined();
    expect(lobbyEstimate(hero, [])).toBeUndefined();
  });
});

describe('bestAndWorstTribes', () => {
  it('splits tribes by impact sign and skips negligible ones', () => {
    const r = bestAndWorstTribes(hero, 2, { minGames: 30 });
    expect(r.best.map((t) => t.tribe)).toEqual(['UNDEAD']);
    expect(r.worst.map((t) => t.tribe)).toEqual(['MURLOC']);
  });
});
