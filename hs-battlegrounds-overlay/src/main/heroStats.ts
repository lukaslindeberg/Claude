/**
 * Hero statistics.
 *
 * - Personal: aggregated from the local match history by base hero id.
 * - Community: Firestone's public, static Battlegrounds hero-stats files
 *   (https://github.com/Zero-to-Heroes/firestone, libs/battlegrounds/data-access/
 *   src/lib/meta-heroes/bgs-meta-hero-stats-access.service.ts; the files are written by
 *   @firestone-hs/bgs-global-stats to s3://static.zerotoheroes.com/api/bgs/... as
 *   gzipped JSON with Content-Encoding: gzip, schema `BgsHeroStatsV2`).
 *
 * No Electron imports. Every network/disk failure degrades to "no community stats".
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { GameMode, HeroStat, HeroStatsBundle, MatchRecord } from '@shared/types';
import { createLogger } from './logger';

const log = createLogger('hero-stats');

// ---------------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------------

/** Converts a duos placement (1..4) to the solo scale (1..8) so thresholds can be shared. */
export function toSoloScale(avgPlacement: number, mode: GameMode): number {
  return mode === 'duos' ? 1 + ((avgPlacement - 1) * 7) / 3 : avgPlacement;
}

/** Fixed thresholds on the solo placement scale (used for personal stats). */
export function tierForAvgPlacement(avgPlacement: number, mode: GameMode = 'solo'): HeroStat['tier'] {
  const p = toSoloScale(avgPlacement, mode);
  if (p <= 3.5) return 'S';
  if (p <= 4.0) return 'A';
  if (p <= 4.5) return 'B';
  if (p <= 5.0) return 'C';
  return 'D';
}

/** Relative tiers (z-score of avg placement within the population) for community stats. */
export function assignRelativeTiers(stats: HeroStat[]): HeroStat[] {
  if (stats.length < 4) return stats.map((s) => ({ ...s, tier: tierForAvgPlacement(s.avgPlacement) }));
  const xs = stats.map((s) => s.avgPlacement);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
  return stats.map((s) => {
    const z = (s.avgPlacement - mean) / sd;
    const tier: HeroStat['tier'] = z <= -1.25 ? 'S' : z <= -0.4 ? 'A' : z <= 0.4 ? 'B' : z <= 1.25 ? 'C' : 'D';
    return { ...s, tier };
  });
}

// ---------------------------------------------------------------------------
// Personal stats
// ---------------------------------------------------------------------------

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Aggregates personal hero stats from history (only games of `mode`).
 * `normalize` maps an offered hero id to its base id (skins) for pick rates.
 */
export function computePersonalHeroStats(
  history: MatchRecord[],
  mode: GameMode = 'solo',
  normalize: (heroCardId: string) => string = (id) => id,
): HeroStat[] {
  const slots = mode === 'duos' ? 4 : 8;
  const top4Cut = mode === 'duos' ? 2 : 4;
  const groups = new Map<string, number[]>();
  const offered = new Map<string, number>();
  for (const m of history) {
    if ((m.mode ?? 'solo') !== mode) continue;
    if (!Number.isFinite(m.placement) || m.placement < 1) continue;
    const id = m.baseHeroCardId || normalize(m.heroCardId);
    if (!id) continue;
    let arr = groups.get(id);
    if (!arr) groups.set(id, (arr = []));
    arr.push(Math.min(slots, Math.round(m.placement)));
    for (const o of new Set((m.heroOptions ?? []).map(normalize))) offered.set(o, (offered.get(o) ?? 0) + 1);
  }
  const out: HeroStat[] = [];
  for (const [heroCardId, places] of groups) {
    const games = places.length;
    const avg = places.reduce((a, b) => a + b, 0) / games;
    const dist = new Array<number>(slots).fill(0);
    for (const p of places) dist[p - 1]++;
    const timesOffered = offered.get(heroCardId);
    out.push({
      heroCardId,
      games,
      avgPlacement: round(avg),
      top4Rate: round((100 * places.filter((p) => p <= top4Cut).length) / games, 1),
      winRate: round((100 * places.filter((p) => p === 1).length) / games, 1),
      pickRate: timesOffered ? round(Math.min(100, (100 * games) / timesOffered), 1) : undefined,
      placementDistribution: dist.map((n) => round(n / games, 4)),
      tier: tierForAvgPlacement(avg, mode),
    });
  }
  return out.sort((a, b) => a.avgPlacement - b.avgPlacement || b.games - a.games);
}

export function personalBundles(
  history: MatchRecord[],
  normalize?: (id: string) => string,
): HeroStatsBundle[] {
  const updatedAt = new Date().toISOString();
  const bundles: HeroStatsBundle[] = [
    {
      source: 'personal',
      label: 'Your games',
      updatedAt,
      mode: 'solo',
      stats: computePersonalHeroStats(history, 'solo', normalize),
    },
  ];
  const duos = computePersonalHeroStats(history, 'duos', normalize);
  if (duos.length) bundles.push({ source: 'personal', label: 'Your games (Duos)', updatedAt, mode: 'duos', stats: duos });
  return bundles;
}

// ---------------------------------------------------------------------------
// Community stats (Firestone public data)
// ---------------------------------------------------------------------------

export const FIRESTONE_HERO_STATS_URL = {
  solo: 'https://static.zerotoheroes.com/api/bgs/hero-stats/mmr-100/last-patch/overview-from-hourly.gz.json',
  duos: 'https://static.zerotoheroes.com/api/bgs/duo/hero-stats/mmr-100/last-patch/overview-from-hourly.gz.json',
} as const;

export const COMMUNITY_LABEL = 'Community (Firestone public data)';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Firestone itself drops heroes with fewer data points as unreliable. */
const MIN_DATA_POINTS = 30;

/** Decodes a response body that may still be gzipped (if no Content-Encoding was applied). */
export function decodeMaybeGzip(buf: Uint8Array): string {
  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) return gunzipSync(buf).toString('utf8');
  return Buffer.from(buf).toString('utf8');
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Validates and converts a Firestone `BgsHeroStatsV2` payload. Returns undefined if
 * the payload doesn't look right. Entries for skins are merged into the base hero
 * (weighted by data points).
 */
export function parseFirestoneHeroStats(
  payload: unknown,
  mode: GameMode,
  normalize: (heroCardId: string) => string = (id) => id,
): HeroStat[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const rows = (payload as { heroStats?: unknown }).heroStats;
  if (!Array.isArray(rows)) return undefined;
  const slots = mode === 'duos' ? 4 : 8;
  const top4Cut = mode === 'duos' ? 2 : 4;
  interface Acc {
    dataPoints: number;
    posSum: number;
    offered: number;
    picked: number;
    dist: number[]; // match counts per rank
    distPoints: number;
  }
  const acc = new Map<string, Acc>();
  let valid = 0;
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const row = r as Record<string, unknown>;
    if (typeof row.heroCardId !== 'string' || !isNum(row.dataPoints) || !isNum(row.averagePosition)) continue;
    if (row.averagePosition < 1 || row.averagePosition > slots || row.dataPoints <= 0) continue;
    valid++;
    const id = normalize(row.heroCardId) || row.heroCardId;
    let a = acc.get(id);
    if (!a) acc.set(id, (a = { dataPoints: 0, posSum: 0, offered: 0, picked: 0, dist: new Array(slots).fill(0), distPoints: 0 }));
    a.dataPoints += row.dataPoints;
    a.posSum += row.averagePosition * row.dataPoints;
    if (isNum(row.totalOffered) && isNum(row.totalPicked)) {
      a.offered += row.totalOffered;
      a.picked += row.totalPicked;
    }
    if (Array.isArray(row.placementDistribution)) {
      let rowTotal = 0;
      const counts = new Array<number>(slots).fill(0);
      for (const p of row.placementDistribution as unknown[]) {
        if (typeof p !== 'object' || p === null) continue;
        const { rank, totalMatches, percentage } = p as Record<string, unknown>;
        if (!isNum(rank) || rank < 1 || rank > slots) continue;
        const n = isNum(totalMatches) ? totalMatches : isNum(percentage) ? (percentage / 100) * row.dataPoints : 0;
        counts[rank - 1] += n;
        rowTotal += n;
      }
      if (rowTotal > 0) {
        counts.forEach((n, i) => (a!.dist[i] += n));
        a.distPoints += rowTotal;
      }
    }
  }
  if (valid === 0) return undefined;
  const stats: HeroStat[] = [];
  for (const [heroCardId, a] of acc) {
    if (a.dataPoints < MIN_DATA_POINTS) continue;
    const dist = a.distPoints > 0 ? a.dist.map((n) => round(n / a.distPoints, 4)) : undefined;
    stats.push({
      heroCardId,
      games: a.dataPoints,
      avgPlacement: round(a.posSum / a.dataPoints),
      top4Rate: dist ? round(100 * dist.slice(0, top4Cut).reduce((x, y) => x + y, 0), 1) : undefined,
      winRate: dist ? round(100 * dist[0], 1) : undefined,
      pickRate: a.offered > 0 ? round((100 * a.picked) / a.offered, 1) : undefined,
      placementDistribution: dist,
    });
  }
  return assignRelativeTiers(stats).sort((a, b) => a.avgPlacement - b.avgPlacement);
}

interface CacheFile {
  fetchedAt: number;
  bundle: HeroStatsBundle;
}

export interface CommunityStatsOptions {
  cacheDir: string;
  fetch?: typeof fetch;
  normalize?: (heroCardId: string) => string;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
  modes?: GameMode[];
}

export class CommunityHeroStatsProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ttl: number;
  private readonly now: () => number;
  private readonly modes: GameMode[];
  private mem = new Map<GameMode, CacheFile>();
  private inflight = new Map<GameMode, Promise<CacheFile | undefined>>();
  private normalize: (heroCardId: string) => string;

  constructor(private readonly opts: CommunityStatsOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.ttl = opts.ttlMs ?? CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
    this.modes = opts.modes ?? ['solo', 'duos'];
    this.normalize = opts.normalize ?? ((id) => id);
  }

  setNormalizer(fn: (heroCardId: string) => string): void {
    this.normalize = fn;
  }

  private cachePath(mode: GameMode): string {
    return join(this.opts.cacheDir, `community-hero-stats-${mode}.json`);
  }

  private async loadCache(mode: GameMode): Promise<CacheFile | undefined> {
    const m = this.mem.get(mode);
    if (m) return m;
    try {
      const c = JSON.parse(await readFile(this.cachePath(mode), 'utf8')) as CacheFile;
      if (isNum(c?.fetchedAt) && Array.isArray(c?.bundle?.stats)) {
        this.mem.set(mode, c);
        return c;
      }
    } catch {
      /* no cache */
    }
    return undefined;
  }

  private async fetchMode(mode: GameMode): Promise<CacheFile | undefined> {
    const existing = this.inflight.get(mode);
    if (existing) return existing;
    const p = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(FIRESTONE_HERO_STATS_URL[mode], { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = decodeMaybeGzip(new Uint8Array(await res.arrayBuffer()));
        const payload = JSON.parse(body) as { lastUpdateDate?: unknown };
        const stats = parseFirestoneHeroStats(payload, mode, this.normalize);
        if (!stats?.length) throw new Error('unexpected payload');
        const updated =
          typeof payload.lastUpdateDate === 'string' && !Number.isNaN(Date.parse(payload.lastUpdateDate))
            ? new Date(payload.lastUpdateDate).toISOString()
            : new Date(this.now()).toISOString();
        const cache: CacheFile = {
          fetchedAt: this.now(),
          bundle: {
            source: 'community',
            label: mode === 'duos' ? `${COMMUNITY_LABEL} · Duos` : COMMUNITY_LABEL,
            updatedAt: updated,
            mode,
            stats,
          },
        };
        this.mem.set(mode, cache);
        await mkdir(this.opts.cacheDir, { recursive: true });
        const tmp = `${this.cachePath(mode)}.tmp`;
        await writeFile(tmp, JSON.stringify(cache), 'utf8');
        await rename(tmp, this.cachePath(mode));
        log.info(`community hero stats (${mode}): ${stats.length} heroes`);
        return cache;
      } catch (err) {
        log.warn(`community hero stats (${mode}) unavailable: ${(err as Error)?.message ?? err}`);
        return undefined;
      } finally {
        clearTimeout(timer);
        this.inflight.delete(mode);
      }
    })();
    this.inflight.set(mode, p);
    return p;
  }

  /**
   * Returns cached bundles; refreshes stale ones. If a fresh copy can't be had,
   * falls back to the stale cache; if there's nothing, returns no bundle.
   */
  async getBundles(): Promise<HeroStatsBundle[]> {
    const out: HeroStatsBundle[] = [];
    await Promise.all(
      this.modes.map(async (mode) => {
        try {
          let c = await this.loadCache(mode);
          if (!c || this.now() - c.fetchedAt > this.ttl) c = (await this.fetchMode(mode)) ?? c;
          if (c) out.push(c.bundle);
        } catch {
          /* never fail */
        }
      }),
    );
    return out.sort((a, b) => (a.mode === 'solo' ? -1 : 1) - (b.mode === 'solo' ? -1 : 1));
  }

  /** Background refresh (e.g. at startup). */
  prefetch(): void {
    void this.getBundles().catch(() => undefined);
  }
}
