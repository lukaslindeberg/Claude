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

describe('bundled comp list', () => {
  it('has valid tiers and only real card ids', async () => {
    const { bundledCompGuides } = await import('../../src/core/stats/comps');
    const { CardDb } = await import('../../src/core/cards/cardDb');
    const db = CardDb.bundled();
    const b = bundledCompGuides();
    expect(b.comps.length).toBeGreaterThanOrEqual(30);
    expect(new Set(b.comps.map((c) => c.id)).size).toBe(b.comps.length);
    for (const c of b.comps) {
      expect(['S', 'A', 'B', 'C']).toContain(c.tier);
      expect(c.cards.some((x) => x.role === 'core')).toBe(true);
      for (const x of [...c.cards.map((y) => y.cardId), ...(c.enablers ?? [])]) expect(db.get(x), `${c.id}: ${x}`).toBeTruthy();
    }
  });

  it('takes stats only from a clearly matching community comp, one each', async () => {
    const { attachMatchedStats } = await import('../../src/core/stats/comps');
    const mine = (id: string, core: string[]) => ({ id, name: id, tribe: 'BEAST' as const, cards: core.map((cardId) => ({ cardId, role: 'core' as const })) });
    const a = mine('a', ['X1', 'X2', 'X3']);
    const b = mine('b', ['X1', 'Y2']);
    const support = mine('c', ['BG_LOE_077', 'BG33_823']); // Brann + Sky Admiral Rogers: support cards only
    const f = { id: 'f', name: 'f', tribe: 'BEAST' as const, games: 500, avgPlacement: 3.2, cards: ['X1', 'X2', 'X3', 'Y2', 'BG_LOE_077', 'BG33_823'].map((cardId) => ({ cardId, role: 'core' as const })) };
    attachMatchedStats([a, b, support], [f]);
    expect(a).toMatchObject({ avgPlacement: 3.2, games: 500 });
    expect((b as { games?: number }).games).toBeUndefined(); // f already taken by the better match
    expect((support as { games?: number }).games).toBeUndefined();
  });
});
