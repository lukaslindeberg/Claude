import { describe, expect, it } from 'vitest';
import type { HeroStatsBundle, TierTimingCurve } from '../../src/shared/types';
import { computeTierCurve, tierCurveFor, tierCurves, tierPace, turnReached } from '../../src/core/stats/tierCurve';
import { personalBundles } from '../../src/main/heroStats';
import { match } from '../main/fixtures';

/** Tier history from the turns tiers 2.. were reached. */
const tiers = (...turns: number[]) => [{ tier: 1, turn: 1 }, ...turns.map((turn, i) => ({ tier: i + 2, turn }))];

describe('turnReached', () => {
  it('takes the first turn at or above the tier (skipped tiers count)', () => {
    const h = [
      { tier: 1, turn: 1 },
      { tier: 2, turn: 2 },
      { tier: 4, turn: 6 },
    ];
    expect(turnReached(h, 2)).toBe(2);
    expect(turnReached(h, 3)).toBe(6);
    expect(turnReached(h, 4)).toBe(6);
    expect(turnReached(h, 5)).toBeUndefined();
  });
});

describe('computeTierCurve', () => {
  it('uses only top-4 games and takes the median turn per tier', () => {
    const games = [
      match({ placement: 1, tierHistory: tiers(2, 4, 6, 8, 10) }),
      match({ placement: 2, tierHistory: tiers(2, 5, 7, 9, 11) }),
      match({ placement: 4, tierHistory: tiers(3, 5, 6, 9, 12) }),
      match({ placement: 8, tierHistory: tiers(2, 3, 4, 5, 6) }), // bottom four: ignored
    ];
    const c = computeTierCurve(games, { scope: 'all', minGames: 3 })!;
    expect(c.games).toBe(3);
    expect(c.scope).toBe('all');
    expect(c.basis).toBe('personalTopHalf');
    expect(c.tiers.map((t) => [t.tier, t.turn, t.games])).toEqual([
      [2, 2, 3],
      [3, 5, 3],
      [4, 6, 3],
      [5, 9, 3],
      [6, 11, 3],
    ]);
  });

  it('needs enough games and drops tiers most strong games never reached', () => {
    const few = [match({ placement: 1, tierHistory: tiers(2, 4) }), match({ placement: 2, tierHistory: tiers(2, 4) })];
    expect(computeTierCurve(few, { scope: 'hero' })).toBeUndefined();
    const games = [
      match({ placement: 1, tierHistory: tiers(2, 4, 6, 8, 10) }),
      match({ placement: 2, tierHistory: tiers(2, 4, 7, 9) }),
      match({ placement: 3, tierHistory: tiers(3, 5, 6, 8) }),
      match({ placement: 4, tierHistory: tiers(2, 5, 7, 9) }),
    ];
    const c = computeTierCurve(games, { scope: 'hero' })!;
    expect(c.tiers.map((t) => t.tier)).toEqual([2, 3, 4, 5]); // tier 6: 1 of 4 games
    expect(c.tiers.find((t) => t.tier === 4)!.turn).toBe(6.5);
  });

  it('keeps solo and duos apart (duos top half = top 2)', () => {
    const duos = [1, 2, 2, 3].map((placement) => match({ mode: 'duos', placement, tierHistory: tiers(2, 4, 6) }));
    expect(computeTierCurve(duos, { scope: 'all', mode: 'solo', minGames: 1 })).toBeUndefined();
    expect(computeTierCurve(duos, { scope: 'all', mode: 'duos', minGames: 3 })!.games).toBe(3);
  });

  it('builds per-hero curves only for heroes with enough games', () => {
    const a = [1, 2, 3].map((placement) => match({ baseHeroCardId: 'A', placement, tierHistory: tiers(2, 4, 6, 8) }));
    const b = [1, 3].map((placement) => match({ baseHeroCardId: 'B', placement, tierHistory: tiers(2, 5, 7, 9) }));
    const { all, byHero } = tierCurves([...a, ...b], 'solo');
    expect([...byHero.keys()]).toEqual(['A']);
    expect(all!.games).toBe(5);
  });
});

describe('tierCurveFor', () => {
  const curve = (games: number, scope: TierTimingCurve['scope']): TierTimingCurve => ({ tiers: [{ tier: 2, turn: 2, games }], games, scope, basis: 'personalTopHalf' });
  const bundles: HeroStatsBundle[] = [
    { source: 'community', label: 'c', updatedAt: '', stats: [{ heroCardId: 'A', avgPlacement: 4, games: 1000 }] },
    { source: 'personal', label: 'p', updatedAt: '', mode: 'solo', tierCurve: curve(9, 'all'), stats: [{ heroCardId: 'A', avgPlacement: 3, games: 4, tierCurve: curve(4, 'hero') }, { heroCardId: 'B', avgPlacement: 5, games: 2 }] },
  ];
  it("prefers the hero's own curve, then the all-heroes one, matching the mode", () => {
    expect(tierCurveFor(bundles, 'A')!.scope).toBe('hero');
    expect(tierCurveFor(bundles, 'B')!.scope).toBe('all');
    expect(tierCurveFor(bundles, 'A', 'duos')).toBeUndefined();
  });

  it('is plumbed through the personal hero-stats bundles', () => {
    const history = [1, 2, 3, 4, 2].map((placement) => match({ baseHeroCardId: 'H', placement, tierHistory: tiers(2, 4, 6, 8, 10) }));
    const solo = personalBundles(history)[0];
    expect(solo.tierCurve?.games).toBe(5);
    expect(solo.stats[0].tierCurve?.scope).toBe('hero');
    expect(tierCurveFor([solo], 'H')!.tiers.map((t) => t.turn)).toEqual([2, 4, 6, 8, 10]);
  });
});

describe('tierPace', () => {
  const c: TierTimingCurve = {
    tiers: [
      { tier: 2, turn: 2, games: 5 },
      { tier: 3, turn: 4, games: 5 },
      { tier: 4, turn: 6, games: 5 },
      { tier: 5, turn: 8.4, games: 5 },
    ],
    games: 5,
    scope: 'all',
    basis: 'personalTopHalf',
  };
  it('is on curve while the next tier is still due this turn', () => {
    expect(tierPace(c, 1, 1)!.label).toBe('on curve');
    expect(tierPace(c, 1, 2)!.label).toBe('on curve');
    expect(tierPace(c, 3, 6)).toMatchObject({ delta: 0, label: 'on curve' });
  });
  it('counts turns behind once the next tier is overdue', () => {
    expect(tierPace(c, 3, 7)).toMatchObject({ tier: 3, delta: -1, label: '1 turn behind' });
    expect(tierPace(c, 2, 7)).toMatchObject({ delta: -3, label: '3 turns behind' });
  });
  it('counts turns ahead when holding a tier early', () => {
    expect(tierPace(c, 4, 4)).toMatchObject({ delta: 2, label: '2 turns ahead' });
    expect(tierPace(c, 5, 7)).toMatchObject({ delta: 1, label: '1 turn ahead' }); // 8.4 rounds to 8
  });
  it('has no verdict without curve data for the current or next tier', () => {
    expect(tierPace(undefined, 3, 5)).toBeUndefined();
    expect(tierPace(c, 6, 12)).toBeUndefined();
    expect(tierPace(c, 5, 12)!.label).toBe('on curve'); // tier 5 known, tier 6 unknown: not "behind"
  });
});
