import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import {
  COMMUNITY_LABEL,
  CommunityHeroStatsProvider,
  FIRESTONE_HERO_STATS_URL,
  assignRelativeTiers,
  computePersonalHeroStats,
  decodeMaybeGzip,
  parseFirestoneHeroStats,
  personalBundles,
  tierForAvgPlacement,
} from '../../src/main/heroStats';
import { match } from './fixtures';

describe('personal hero stats', () => {
  const history = [
    match({ baseHeroCardId: 'A', heroCardId: 'A_SKIN_1', placement: 1, heroOptions: ['A_SKIN_1', 'B', 'C'] }),
    match({ baseHeroCardId: 'A', heroCardId: 'A', placement: 3, heroOptions: ['A', 'B'] }),
    match({ baseHeroCardId: 'A', heroCardId: 'A', placement: 8, heroOptions: ['A', 'C'] }),
    match({ baseHeroCardId: 'B', heroCardId: 'B', placement: 5, heroOptions: ['B', 'A', 'C', 'D'] }),
    match({ baseHeroCardId: 'D', heroCardId: 'D', placement: 2, mode: 'duos' }),
  ];
  const normalize = (id: string) => id.replace(/_SKIN_\d+$/, '');

  it('aggregates by base hero', () => {
    const stats = computePersonalHeroStats(history, 'solo', normalize);
    expect(stats.map((s) => s.heroCardId)).toEqual(['A', 'B']);
    const a = stats[0];
    expect(a.games).toBe(3);
    expect(a.avgPlacement).toBe(4);
    expect(a.top4Rate).toBeCloseTo(66.7, 1);
    expect(a.winRate).toBeCloseTo(33.3, 1);
    expect(a.placementDistribution).toHaveLength(8);
    expect(a.placementDistribution![0]).toBeCloseTo(1 / 3, 3);
    expect(a.placementDistribution![7]).toBeCloseTo(1 / 3, 3);
    expect(a.pickRate).toBe(75); // offered 4 times, picked 3
    expect(a.tier).toBe('A');
    expect(stats[1]).toMatchObject({ heroCardId: 'B', games: 1, avgPlacement: 5, top4Rate: 0, winRate: 0, tier: 'C' });
  });

  it('separates duos (placements 1..4)', () => {
    const duos = computePersonalHeroStats(history, 'duos');
    expect(duos).toHaveLength(1);
    expect(duos[0]).toMatchObject({ heroCardId: 'D', games: 1, avgPlacement: 2, top4Rate: 100 });
    expect(duos[0].placementDistribution).toEqual([0, 1, 0, 0]);
    const bundles = personalBundles(history, normalize);
    expect(bundles.map((b) => [b.source, b.mode])).toEqual([
      ['personal', 'solo'],
      ['personal', 'duos'],
    ]);
    expect(personalBundles([])).toHaveLength(1);
  });

  it('assigns tiers from average placement', () => {
    expect(tierForAvgPlacement(3.2)).toBe('S');
    expect(tierForAvgPlacement(3.9)).toBe('A');
    expect(tierForAvgPlacement(4.4)).toBe('B');
    expect(tierForAvgPlacement(4.9)).toBe('C');
    expect(tierForAvgPlacement(5.5)).toBe('D');
    expect(tierForAvgPlacement(1.5, 'duos')).toBe('S');
    expect(tierForAvgPlacement(3.2, 'duos')).toBe('D');
    const rel = assignRelativeTiers(
      [3.6, 4.0, 4.2, 4.4, 4.5, 4.6, 4.8, 5.2].map((p, i) => ({ heroCardId: `H${i}`, avgPlacement: p, games: 100 })),
    );
    expect(rel[0].tier).toBe('S');
    expect(rel[7].tier).toBe('D');
  });
});

const payload = {
  lastUpdateDate: '2026-11-01T10:00:00.000Z',
  mmrPercentiles: [],
  dataPoints: 3000,
  heroStats: [
    {
      heroCardId: 'H1',
      dataPoints: 1000,
      totalOffered: 4000,
      totalPicked: 1000,
      averagePosition: 3.8,
      standardDeviation: 2,
      standardDeviationOfTheMean: 0.1,
      conservativePositionEstimate: 3.9,
      placementDistribution: [1, 2, 3, 4, 5, 6, 7, 8].map((rank) => ({ rank, totalMatches: 125, percentage: 12.5 })),
      tribeStats: [],
      mmrPercentile: 100,
      timePeriod: 'last-patch',
    },
    { heroCardId: 'H1_SKIN_A', dataPoints: 1000, averagePosition: 4.2, tribeStats: [] },
    { heroCardId: 'H2', dataPoints: 10, averagePosition: 2, tribeStats: [] }, // too few data points
    { heroCardId: 'H3', dataPoints: 500, averagePosition: 9, tribeStats: [] }, // invalid
    { heroCardId: 'H4', dataPoints: 500, averagePosition: 4.9, tribeStats: [] },
    'garbage',
  ],
};

describe('Firestone community stats', () => {
  it('parses and validates BgsHeroStatsV2', () => {
    const stats = parseFirestoneHeroStats(payload, 'solo', (id) => id.replace(/_SKIN_.*/, ''))!;
    expect(stats.map((s) => s.heroCardId)).toEqual(['H1', 'H4']);
    expect(stats[0]).toMatchObject({ games: 2000, avgPlacement: 4, pickRate: 25, top4Rate: 50, winRate: 12.5 });
    expect(stats[0].placementDistribution).toHaveLength(8);
    expect(parseFirestoneHeroStats({ nope: true }, 'solo')).toBeUndefined();
    expect(parseFirestoneHeroStats({ heroStats: [] }, 'solo')).toBeUndefined();
    expect(parseFirestoneHeroStats(null, 'solo')).toBeUndefined();
  });

  it('decodes gzip bodies that were not transparently decompressed', () => {
    const json = JSON.stringify({ a: 1 });
    expect(decodeMaybeGzip(gzipSync(json))).toBe(json);
    expect(decodeMaybeGzip(new TextEncoder().encode(json))).toBe(json);
  });

  it('fetches, caches for 6 h and survives failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-community-'));
    let now = 1_000_000;
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(FIRESTONE_HERO_STATS_URL.solo);
      return new Response(gzipSync(JSON.stringify(payload)), { status: 200 });
    });
    const p = new CommunityHeroStatsProvider({
      cacheDir: dir,
      fetch: fetchMock as unknown as typeof fetch,
      now: () => now,
      modes: ['solo'],
    });
    const b1 = await p.getBundles();
    expect(b1).toHaveLength(1);
    expect(b1[0]).toMatchObject({ source: 'community', label: COMMUNITY_LABEL, mode: 'solo' });
    expect(b1[0].updatedAt).toBe('2026-11-01T10:00:00.000Z');
    await p.getBundles();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A new provider reads the disk cache.
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    const p2 = new CommunityHeroStatsProvider({
      cacheDir: dir,
      fetch: failing as unknown as typeof fetch,
      now: () => now,
      modes: ['solo'],
    });
    expect(await p2.getBundles()).toHaveLength(1);
    expect(failing).not.toHaveBeenCalled();
    // Stale: refetch fails -> stale cache is still served.
    now += 7 * 60 * 60 * 1000;
    expect(await p2.getBundles()).toHaveLength(1);
    expect(failing).toHaveBeenCalledTimes(1);

    // No cache + failure -> nothing.
    const p3 = new CommunityHeroStatsProvider({
      cacheDir: join(dir, 'empty'),
      fetch: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch,
      modes: ['solo'],
    });
    expect(await p3.getBundles()).toEqual([]);
  });
});
