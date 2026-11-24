import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { computePersonalHeroStats, parseFirestoneHeroStats } from '../../src/main/heroStats';
import {
  CommunityTrinketStatsProvider,
  FIRESTONE_TRINKET_STATS_URL,
  computePersonalTrinketStats,
  parseFirestoneTrinketStats,
  personalTrinketBundles,
} from '../../src/main/trinketStats';
import { tribeFromRace, tribeSynergyFromGames } from '../../src/core/stats/synergy';
import { lobbyEstimate } from '../../src/core/stats/lobby';
import { match } from './fixtures';

/** Trimmed copies of Firestone's public files (static.zerotoheroes.com, fetched Nov 2026). */
const FIXTURES = fileURLToPath(new URL('../fixtures/stats/', import.meta.url));
const real = (f: string): unknown => JSON.parse(readFileSync(join(FIXTURES, f), 'utf8'));

describe('Firestone tribeStats (real data)', () => {
  it('maps Race numbers to tribes', () => {
    expect([11, 14, 15, 17, 18, 20, 23, 24, 43, 92, 126].map(tribeFromRace)).toEqual([
      'UNDEAD', 'MURLOC', 'DEMON', 'MECHANICAL', 'ELEMENTAL', 'BEAST', 'PIRATE', 'DRAGON', 'QUILBOAR', 'NAGA', 'ABERRATION',
    ]);
    expect(tribeFromRace(26)).toBeUndefined();
    expect(tribeFromRace('20')).toBeUndefined();
  });

  it('parses solo hero tribe synergies', () => {
    const stats = parseFirestoneHeroStats(real('firestone-hero-stats-solo.json'), 'solo')!;
    expect(stats).toHaveLength(4);
    const h = stats.find((s) => s.heroCardId === 'BG25_HERO_100')!;
    expect(h).toMatchObject({ games: 492, avgPlacement: 4.31 });
    // 10 tribes in rotation (no Naga), best (most negative impact) first.
    expect(h.tribeStats).toHaveLength(10);
    expect(h.tribeStats!.some((t) => t.tribe === 'NAGA')).toBe(false);
    expect(h.tribeStats![0]).toEqual({ tribe: 'BEAST', games: 237, avgPlacement: 4.07, avgPlacementWithout: 4.5, impact: -0.24 });
    expect(h.tribeStats!.find((t) => t.tribe === 'DRAGON')).toEqual({
      tribe: 'DRAGON',
      games: 219,
      avgPlacement: 4.52,
      avgPlacementWithout: 4.19,
      impact: 0.21,
    });
    const impacts = h.tribeStats!.map((t) => t.impact);
    expect(impacts).toEqual([...impacts].sort((a, b) => a - b));
    // Rows with 1-2 games are dropped (BG34_HERO_004 has Aberration at 2 games, impact -2.96).
    const odd = stats.find((s) => s.heroCardId === 'BG34_HERO_004')!;
    expect(odd.tribeStats!.map((t) => t.tribe)).not.toContain('ABERRATION');
    expect(odd.tribeStats).toHaveLength(9);
    const est = lobbyEstimate(h, ['DRAGON', 'BEAST'])!;
    expect(est.tribes).toEqual(['BEAST', 'DRAGON']);
    expect(est.avgPlacement).toBeCloseTo(4.31 - 0.24 + 0.21, 5);
  });

  it('parses duos hero tribe synergies and merges skins', () => {
    const payload = real('firestone-hero-stats-duos.json') as { heroStats: Record<string, unknown>[] };
    const stats = parseFirestoneHeroStats(payload, 'duos')!;
    const h = stats.find((s) => s.heroCardId === 'TB_BaconShop_HERO_62')!;
    expect(h.tribeStats!.find((t) => t.tribe === 'ABERRATION')).toEqual({
      tribe: 'ABERRATION',
      games: 112,
      avgPlacement: 2.21,
      avgPlacementWithout: 2.41,
      impact: -0.14,
    });
    // A skin row with the same numbers merges into the base hero (weighted by data points).
    const skin = { ...payload.heroStats[1], heroCardId: 'TB_BaconShop_HERO_62_SKIN_A' };
    const merged = parseFirestoneHeroStats({ heroStats: [payload.heroStats[1], skin] }, 'duos', (id) =>
      id.replace(/_SKIN_.*/, ''),
    )!;
    expect(merged).toHaveLength(1);
    expect(merged[0].games).toBe(480);
    expect(merged[0].tribeStats!.find((t) => t.tribe === 'ABERRATION')).toMatchObject({ games: 224, avgPlacement: 2.21, impact: -0.14 });
  });
});

describe('personal tribe synergies', () => {
  it('computes per-tribe placement and skips games with unknown tribes', () => {
    const syn = tribeSynergyFromGames([
      { placement: 1, tribes: ['BEAST', 'MURLOC'] },
      { placement: 3, tribes: ['BEAST', 'DEMON'] },
      { placement: 8, tribes: ['DEMON', 'MURLOC'] },
      { placement: 8, tribes: [] }, // unknown: ignored
    ]);
    // overall = 4
    expect(syn).toEqual([
      { tribe: 'BEAST', games: 2, avgPlacement: 2, avgPlacementWithout: 8, impact: -2 },
      { tribe: 'MURLOC', games: 2, avgPlacement: 4.5, avgPlacementWithout: 3, impact: 0.5 },
      { tribe: 'DEMON', games: 2, avgPlacement: 5.5, avgPlacementWithout: 1, impact: 1.5 },
    ]);
    expect(tribeSynergyFromGames([{ placement: 2, tribes: [] }])).toEqual([]);
  });

  it('adds tribeStats to personal hero stats', () => {
    const history = [
      match({ baseHeroCardId: 'A', placement: 2, availableTribes: ['BEAST', 'UNDEAD'] }),
      match({ baseHeroCardId: 'A', placement: 6, availableTribes: ['UNDEAD', 'NAGA'] }),
      match({ baseHeroCardId: 'A', placement: 5, availableTribes: [] }),
      match({ baseHeroCardId: 'B', placement: 4 }),
    ];
    const [a, b] = computePersonalHeroStats(history, 'solo').sort((x, y) => x.heroCardId.localeCompare(y.heroCardId));
    expect(a.games).toBe(3);
    expect(a.tribeStats).toEqual([
      { tribe: 'BEAST', games: 1, avgPlacement: 2, avgPlacementWithout: 6, impact: -2 },
      { tribe: 'UNDEAD', games: 2, avgPlacement: 4, impact: 0 },
      { tribe: 'NAGA', games: 1, avgPlacement: 6, avgPlacementWithout: 2, impact: 2 },
    ]);
    expect(b.tribeStats).toBeUndefined();
  });
});

describe('trinket stats', () => {
  it('parses the real Firestone trinket file', () => {
    const stats = parseFirestoneTrinketStats(real('firestone-trinket-stats.json'))!;
    // BG30_MagicItem_981 (19 games) and BGDUO_MagicItem_001 (1 game) are below the threshold.
    expect(stats.map((s) => s.trinketCardId)).toEqual(['BG30_MagicItem_426', 'BG30_MagicItem_420t', 'BG30_MagicItem_435']);
    expect(stats[0]).toEqual({ trinketCardId: 'BG30_MagicItem_426', games: 4893, avgPlacement: 3.77, pickRate: 0.3254 });
    expect(parseFirestoneTrinketStats({ heroStats: [] })).toBeUndefined();
    expect(parseFirestoneTrinketStats({ trinketStats: [{ trinketCardId: 'X', dataPoints: 50, averagePlacement: 12 }] })).toBeUndefined();
  });

  it('computes personal trinket stats with tribes', () => {
    const history = [
      match({ placement: 1, trinkets: ['T1', 'T2'], availableTribes: ['BEAST', 'PIRATE'] }),
      match({ placement: 5, trinkets: ['T1'], availableTribes: ['PIRATE', 'DEMON'] }),
      match({ placement: 7, trinkets: ['T3'], availableTribes: [] }),
      match({ placement: 3 }),
      match({ placement: 2, trinkets: ['T1'], mode: 'duos' }),
    ];
    const solo = computePersonalTrinketStats(history, 'solo');
    expect(solo.map((s) => [s.trinketCardId, s.games, s.avgPlacement])).toEqual([
      ['T2', 1, 1],
      ['T1', 2, 3],
      ['T3', 1, 7],
    ]);
    expect(solo[1].tribeStats).toEqual([
      { tribe: 'BEAST', games: 1, avgPlacement: 1, avgPlacementWithout: 5, impact: -2 },
      { tribe: 'PIRATE', games: 2, avgPlacement: 3, impact: 0 },
      { tribe: 'DEMON', games: 1, avgPlacement: 5, avgPlacementWithout: 1, impact: 2 },
    ]);
    expect(solo[2].tribeStats).toBeUndefined();
    const bundles = personalTrinketBundles(history);
    expect(bundles.map((b) => [b.source, b.mode, b.stats.length])).toEqual([
      ['personal', 'solo', 3],
      ['personal', 'duos', 1],
    ]);
  });

  it('fetches community trinket stats, caches them and survives failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-trinkets-'));
    let now = 5_000_000;
    const body = readFileSync(join(FIXTURES, 'firestone-trinket-stats.json'));
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe(FIRESTONE_TRINKET_STATS_URL);
      return new Response(gzipSync(body), { status: 200 });
    });
    const p = new CommunityTrinketStatsProvider({ cacheDir: dir, fetch: fetchMock as unknown as typeof fetch, now: () => now });
    const [b] = await p.getBundles();
    expect(b).toMatchObject({ source: 'community', label: 'Community (Firestone public data)', mode: 'solo' });
    expect(b.updatedAt).toBe('2026-11-07T12:10:35.688Z');
    expect(b.stats).toHaveLength(3);
    await p.getBundles();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const failing = vi.fn(async () => new Response('nope', { status: 403 }));
    const p2 = new CommunityTrinketStatsProvider({ cacheDir: dir, fetch: failing as unknown as typeof fetch, now: () => now });
    now += 7 * 60 * 60 * 1000;
    expect(await p2.getBundles()).toHaveLength(1); // stale disk cache
    expect(failing).toHaveBeenCalledTimes(1);
    const p3 = new CommunityTrinketStatsProvider({ cacheDir: join(dir, 'none'), fetch: failing as unknown as typeof fetch });
    expect(await p3.getBundles()).toEqual([]);
  });
});
