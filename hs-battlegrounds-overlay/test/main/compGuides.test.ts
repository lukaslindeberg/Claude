import { describe, expect, it } from 'vitest';
import { applyCompStats, parseCompStrategies, sortCompGuides } from '../../src/main/compGuides';

const strategies = [
  { compId: '', name: '', cards: [], tips: [] },
  {
    compId: 'beast_example',
    name: 'Beast Example',
    powerLevel: 'a',
    difficulty: 'Medium',
    cards: [
      { cardId: 'BG_A', status: 'CORE' },
      { cardId: 'BG_B', status: 'ADDON' },
      { cardId: 'BG_C', status: 'CYCLE' },
      { cardId: 'BG_A', status: 'ADDON' },
    ],
    tips: [
      { author: 'old', language: 'enUS', tip: 'Old tip.', date: '2026-01-01' },
      { author: 'new', language: 'enUS', tip: 'New tip.', whenToCommit: 'A + B', date: '2026-10-01' },
      { author: 'fr', language: 'frFR', tip: 'Astuce.', date: '2026-11-01' },
    ],
  },
  { compId: 'neutral_other', name: 'Neutral Other', powerLevel: 'S', cards: [{ cardId: 'BG_D', status: 'CORE' }], tips: [] },
];

describe('comp guides', () => {
  it('parses strategies: roles, tribe from the id, newest English tip', () => {
    const g = parseCompStrategies(strategies);
    expect(g.map((x) => x.id)).toEqual(['beast_example', 'neutral_other']);
    expect(g[0]).toMatchObject({ tribe: 'BEAST', tier: 'A', difficulty: 'Medium', tip: 'New tip.', whenToCommit: 'A + B', author: 'new' });
    expect(g[0].cards).toEqual([
      { cardId: 'BG_A', role: 'core' },
      { cardId: 'BG_B', role: 'addon' },
      { cardId: 'BG_C', role: 'cycle' },
    ]);
    expect(g[1].tribe).toBeUndefined();
    expect(parseCompStrategies({})).toEqual([]);
  });

  it('adds stats and sorts by power level, then placement', () => {
    const g = parseCompStrategies(strategies);
    applyCompStats(g, {
      compStats: [
        { archetype: 'beast_example', dataPoints: 100, averagePlacement: 3.456, placementDistribution: [{ rank: 1, totalMatches: 25 }, { rank: 4, totalMatches: 25 }, { rank: 7, totalMatches: 50 }] },
        { archetype: 'neutral_other', dataPoints: 5, averagePlacement: 2 },
      ],
    });
    expect(g[0]).toMatchObject({ games: 100, avgPlacement: 3.46, firstRate: 0.25, top4Rate: 0.5 });
    expect(g[1].games).toBeUndefined();
    expect(sortCompGuides(g).map((x) => x.id)).toEqual(['neutral_other', 'beast_example']);
  });
});
