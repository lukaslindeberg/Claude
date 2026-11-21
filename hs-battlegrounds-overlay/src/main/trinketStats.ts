/**
 * Trinket statistics.
 *
 * - Personal: from MatchRecord.trinkets (the trinkets the local player picked), with a
 *   per-tribe breakdown from MatchRecord.availableTribes.
 * - Community: Firestone's public trinket-stats file (solo only: Firestone publishes no duos
 *   trinket file; api/bgs/duo/trinket-stats/... answers 403). Schema `BgsTrinketStats`:
 *   `{ trinketCardId, dataPoints, pickRate (0..1), averagePlacement, averagePlacementAtMmr,
 *   pickRateAtMmr }`, no tribe breakdown. Upgraded/alternate trinkets keep their own ids
 *   (e.g. BG30_MagicItem_420t), which are also the ids offered in game.
 *
 * No Electron imports. Every network/disk failure degrades to "no community stats".
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GameMode, MatchRecord, Tribe, TrinketStat, TrinketStatsBundle } from '@shared/types';
import { tribeSynergyFromGames } from '@core/stats/synergy';
import { COMMUNITY_LABEL, MIN_DATA_POINTS, decodeMaybeGzip } from './heroStats';
import { createLogger } from './logger';

const log = createLogger('trinket-stats');

export const FIRESTONE_TRINKET_STATS_URL =
  'https://static.zerotoheroes.com/api/bgs/trinket-stats/last-patch/overview-from-hourly.gz.json';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// ---------------------------------------------------------------------------
// Personal
// ---------------------------------------------------------------------------

export function computePersonalTrinketStats(history: MatchRecord[], mode: GameMode = 'solo'): TrinketStat[] {
  const slots = mode === 'duos' ? 4 : 8;
  const groups = new Map<string, { placement: number; tribes: Tribe[] }[]>();
  for (const m of history) {
    if ((m.mode ?? 'solo') !== mode) continue;
    if (!Number.isFinite(m.placement) || m.placement < 1 || !m.trinkets?.length) continue;
    const placement = Math.min(slots, Math.round(m.placement));
    for (const id of new Set(m.trinkets)) {
      if (!id) continue;
      let arr = groups.get(id);
      if (!arr) groups.set(id, (arr = []));
      arr.push({ placement, tribes: m.availableTribes ?? [] });
    }
  }
  const out: TrinketStat[] = [];
  for (const [trinketCardId, games] of groups) {
    const stat: TrinketStat = {
      trinketCardId,
      games: games.length,
      avgPlacement: round(games.reduce((a, g) => a + g.placement, 0) / games.length),
    };
    const tribeStats = tribeSynergyFromGames(games);
    if (tribeStats.length) stat.tribeStats = tribeStats;
    out.push(stat);
  }
  return out.sort((a, b) => a.avgPlacement - b.avgPlacement || b.games - a.games);
}

export function personalTrinketBundles(history: MatchRecord[]): TrinketStatsBundle[] {
  const updatedAt = new Date().toISOString();
  const bundles: TrinketStatsBundle[] = [
    { source: 'personal', label: 'Your games', updatedAt, mode: 'solo', stats: computePersonalTrinketStats(history, 'solo') },
  ];
  const duos = computePersonalTrinketStats(history, 'duos');
  if (duos.length) bundles.push({ source: 'personal', label: 'Your games (Duos)', updatedAt, mode: 'duos', stats: duos });
  return bundles;
}

// ---------------------------------------------------------------------------
// Community (Firestone public data)
// ---------------------------------------------------------------------------

/** Validates and converts a Firestone `BgsTrinketStats` payload (undefined if it looks wrong). */
export function parseFirestoneTrinketStats(payload: unknown): TrinketStat[] | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const rows = (payload as { trinketStats?: unknown }).trinketStats;
  if (!Array.isArray(rows)) return undefined;
  let valid = 0;
  const byId = new Map<string, TrinketStat>();
  for (const r of rows) {
    if (typeof r !== 'object' || r === null) continue;
    const row = r as Record<string, unknown>;
    const id = row.trinketCardId;
    const dp = row.dataPoints;
    const avg = row.averagePlacement;
    if (typeof id !== 'string' || !id || !isNum(dp) || dp <= 0 || !isNum(avg) || avg < 1 || avg > 8) continue;
    valid++;
    if (dp < MIN_DATA_POINTS || byId.has(id)) continue;
    const stat: TrinketStat = { trinketCardId: id, games: dp, avgPlacement: round(avg) };
    if (isNum(row.pickRate) && row.pickRate >= 0 && row.pickRate <= 1) stat.pickRate = round(row.pickRate, 4);
    byId.set(id, stat);
  }
  if (valid === 0) return undefined;
  return [...byId.values()].sort((a, b) => a.avgPlacement - b.avgPlacement);
}

interface CacheFile {
  fetchedAt: number;
  bundle: TrinketStatsBundle;
}

export interface CommunityTrinketStatsOptions {
  cacheDir: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  ttlMs?: number;
  now?: () => number;
}

export class CommunityTrinketStatsProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ttl: number;
  private readonly now: () => number;
  private mem: CacheFile | undefined;
  private inflight: Promise<CacheFile | undefined> | undefined;

  constructor(private readonly opts: CommunityTrinketStatsOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10000;
    this.ttl = opts.ttlMs ?? CACHE_TTL_MS;
    this.now = opts.now ?? Date.now;
  }

  private get cachePath(): string {
    return join(this.opts.cacheDir, 'community-trinket-stats-solo.json');
  }

  private async loadCache(): Promise<CacheFile | undefined> {
    if (this.mem) return this.mem;
    try {
      const c = JSON.parse(await readFile(this.cachePath, 'utf8')) as CacheFile;
      if (isNum(c?.fetchedAt) && Array.isArray(c?.bundle?.stats)) return (this.mem = c);
    } catch {
      /* no cache */
    }
    return undefined;
  }

  private fetchFresh(): Promise<CacheFile | undefined> {
    if (this.inflight) return this.inflight;
    const p = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const res = await this.fetchImpl(FIRESTONE_TRINKET_STATS_URL, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = JSON.parse(decodeMaybeGzip(new Uint8Array(await res.arrayBuffer()))) as { lastUpdateDate?: unknown };
        const stats = parseFirestoneTrinketStats(payload);
        if (!stats?.length) throw new Error('unexpected payload');
        const updated =
          typeof payload.lastUpdateDate === 'string' && !Number.isNaN(Date.parse(payload.lastUpdateDate))
            ? new Date(payload.lastUpdateDate).toISOString()
            : new Date(this.now()).toISOString();
        const cache: CacheFile = {
          fetchedAt: this.now(),
          bundle: { source: 'community', label: COMMUNITY_LABEL, updatedAt: updated, mode: 'solo', stats },
        };
        this.mem = cache;
        await mkdir(this.opts.cacheDir, { recursive: true });
        const tmp = `${this.cachePath}.tmp`;
        await writeFile(tmp, JSON.stringify(cache), 'utf8');
        await rename(tmp, this.cachePath);
        log.info(`community trinket stats: ${stats.length} trinkets`);
        return cache;
      } catch (err) {
        log.warn(`community trinket stats unavailable: ${(err as Error)?.message ?? err}`);
        return undefined;
      } finally {
        clearTimeout(timer);
        this.inflight = undefined;
      }
    })();
    this.inflight = p;
    return p;
  }

  /** Cached bundle, refreshed when stale; a stale copy is served if the refresh fails. */
  async getBundles(): Promise<TrinketStatsBundle[]> {
    try {
      let c = await this.loadCache();
      if (!c || this.now() - c.fetchedAt > this.ttl) c = (await this.fetchFresh()) ?? c;
      return c ? [c.bundle] : [];
    } catch {
      return [];
    }
  }

  /** Background refresh (e.g. at startup). */
  prefetch(): void {
    void this.getBundles().catch(() => undefined);
  }
}
