/**
 * Comp guides: Firestone's public community comp strategies (core and add-on minions, a
 * short tip, when to commit, power level) joined with Firestone's comp stats (average
 * placement of final boards matched to each comp).
 *
 * No Electron imports. Network/disk failures degrade to the cached copy, else no guides.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CompGuide, CompGuideCard, CompGuidesBundle, Tribe } from '@shared/types';
import { decodeMaybeGzip } from './heroStats';
import { createLogger } from './logger';

const log = createLogger('comps');

export const FIRESTONE_COMP_STRATEGIES_URL = 'https://static.zerotoheroes.com/hearthstone/data/battlegrounds-strategies/bgs-comps-strategies.gz.json';
export const FIRESTONE_COMP_STATS_URL = 'https://static.zerotoheroes.com/api/bgs/comp-stats/last-patch/overview-from-hourly.gz.json';
export const COMP_GUIDES_SOURCE = 'Firestone community comp guides';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_GAMES = 30;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

const TRIBE_PREFIX: Record<string, Tribe> = {
  aberration: 'ABERRATION',
  beast: 'BEAST',
  demon: 'DEMON',
  dragon: 'DRAGON',
  elemental: 'ELEMENTAL',
  mech: 'MECHANICAL',
  murloc: 'MURLOC',
  naga: 'NAGA',
  pirate: 'PIRATE',
  quilboar: 'QUILBOAR',
  undead: 'UNDEAD',
};

const ROLE: Record<string, CompGuideCard['role']> = { CORE: 'core', ADDON: 'addon', CYCLE: 'cycle' };
const TIER_ORDER = ['S', 'A', 'B', 'C', 'D'];

/** Firestone's `bgs-comps-strategies` file -> guides (entries without an id or cards are skipped). */
export function parseCompStrategies(payload: unknown): CompGuide[] {
  if (!Array.isArray(payload)) return [];
  const out: CompGuide[] = [];
  for (const row of payload) {
    if (!isObj(row)) continue;
    const id = str(row.compId);
    const name = str(row.name);
    if (!id || !name || !Array.isArray(row.cards)) continue;
    const cards: CompGuideCard[] = [];
    for (const c of row.cards) {
      if (!isObj(c)) continue;
      const cardId = str(c.cardId);
      const role = ROLE[String(c.status ?? '').toUpperCase()] ?? 'addon';
      if (cardId && !cards.some((x) => x.cardId === cardId)) cards.push({ cardId, role });
    }
    if (!cards.length) continue;
    const guide: CompGuide = { id, name, cards };
    const tribe = TRIBE_PREFIX[id.split('_')[0]];
    if (tribe) guide.tribe = tribe;
    const tier = str(row.powerLevel)?.toUpperCase();
    if (tier && TIER_ORDER.includes(tier)) guide.tier = tier;
    const difficulty = str(row.difficulty);
    if (difficulty) guide.difficulty = difficulty;
    // The newest English tip.
    const tips = (Array.isArray(row.tips) ? row.tips : []).filter((t): t is Record<string, unknown> => isObj(t) && !!str(t.tip));
    const en = tips.filter((t) => !t.language || t.language === 'enUS');
    const tip = (en.length ? en : tips).sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))[0];
    if (tip) {
      guide.tip = str(tip.tip);
      const when = str(tip.whenToCommit);
      if (when) guide.whenToCommit = when;
      const author = str(tip.author);
      if (author) guide.author = author;
    }
    out.push(guide);
  }
  return out;
}

/** Adds Firestone comp stats (`compStats[]` by `archetype`) to the guides, in place. */
export function applyCompStats(guides: CompGuide[], payload: unknown): void {
  const rows = isObj(payload) && Array.isArray(payload.compStats) ? payload.compStats : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of rows) if (isObj(r) && typeof r.archetype === 'string') byId.set(r.archetype, r);
  for (const g of guides) {
    const r = byId.get(g.id);
    if (!r || !isNum(r.dataPoints) || r.dataPoints < MIN_GAMES || !isNum(r.averagePlacement)) continue;
    g.games = r.dataPoints;
    g.avgPlacement = round(r.averagePlacement);
    const dist = Array.isArray(r.placementDistribution) ? r.placementDistribution.filter(isObj) : [];
    const total = dist.reduce((a, d) => a + (isNum(d.totalMatches) ? d.totalMatches : 0), 0);
    if (total > 0) {
      const at = (pred: (rank: number) => boolean) =>
        dist.reduce((a, d) => a + (isNum(d.rank) && pred(d.rank) && isNum(d.totalMatches) ? d.totalMatches : 0), 0) / total;
      g.firstRate = round(at((rank) => rank === 1), 3);
      g.top4Rate = round(at((rank) => rank <= 4), 3);
    }
  }
}

/** Best first: power level, then average placement. */
export function sortCompGuides(guides: CompGuide[]): CompGuide[] {
  const tierRank = (t?: string) => (t ? TIER_ORDER.indexOf(t) : TIER_ORDER.length);
  return guides.sort((a, b) => tierRank(a.tier) - tierRank(b.tier) || (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9) || a.name.localeCompare(b.name));
}

interface CacheFile {
  fetchedAt: number;
  bundle: CompGuidesBundle;
}

export interface CompGuidesOptions {
  cacheDir: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
}

export class CompGuidesProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private mem: CacheFile | undefined;
  private inflight: Promise<CacheFile | undefined> | undefined;

  constructor(private readonly opts: CompGuidesOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  private get cachePath(): string {
    return join(this.opts.cacheDir, 'comp-guides.json');
  }

  private async getJson(url: string): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 15000);
    try {
      const res = await this.fetchImpl(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return JSON.parse(decodeMaybeGzip(new Uint8Array(await res.arrayBuffer())));
    } finally {
      clearTimeout(timer);
    }
  }

  private async loadCache(): Promise<CacheFile | undefined> {
    if (this.mem) return this.mem;
    try {
      const c = JSON.parse(await readFile(this.cachePath, 'utf8')) as CacheFile;
      if (isNum(c?.fetchedAt) && Array.isArray(c?.bundle?.comps)) return (this.mem = c);
    } catch {
      /* no cache */
    }
    return undefined;
  }

  private fetchFresh(): Promise<CacheFile | undefined> {
    this.inflight ??= (async () => {
      try {
        const [strategies, stats] = await Promise.all([
          this.getJson(FIRESTONE_COMP_STRATEGIES_URL),
          this.getJson(FIRESTONE_COMP_STATS_URL).catch((err) => {
            log.warn(`comp stats unavailable: ${(err as Error)?.message ?? err}`);
            return undefined;
          }),
        ]);
        const comps = parseCompStrategies(strategies);
        if (!comps.length) throw new Error('no comps in the strategies file');
        if (stats) applyCompStats(comps, stats);
        const updated = isObj(stats) && typeof stats.lastUpdateDate === 'string' ? stats.lastUpdateDate : new Date(this.now()).toISOString();
        const cache: CacheFile = { fetchedAt: this.now(), bundle: { source: COMP_GUIDES_SOURCE, updatedAt: updated, comps: sortCompGuides(comps) } };
        this.mem = cache;
        await mkdir(this.opts.cacheDir, { recursive: true });
        const tmp = `${this.cachePath}.tmp`;
        await writeFile(tmp, JSON.stringify(cache), 'utf8');
        await rename(tmp, this.cachePath);
        log.info(`comp guides: ${comps.length} comps`);
        return cache;
      } catch (err) {
        log.warn(`comp guides unavailable: ${(err as Error)?.message ?? err}`);
        return undefined;
      } finally {
        this.inflight = undefined;
      }
    })();
    return this.inflight;
  }

  /** Cached guides, refreshed when stale; a stale copy is served if the refresh fails. */
  async get(): Promise<CompGuidesBundle | undefined> {
    let c = await this.loadCache();
    if (!c || this.now() - c.fetchedAt > CACHE_TTL_MS) c = (await this.fetchFresh()) ?? c;
    return c?.bundle;
  }

  prefetch(): void {
    void this.get().catch(() => undefined);
  }
}
