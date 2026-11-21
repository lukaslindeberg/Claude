/**
 * Runtime card-data refresh. Starts from the bundled data, then (in the
 * background, never blocking startup):
 *  1. loads a previously converted copy from `<cacheDir>/bg-cards.json` if newer;
 *  2. downloads HearthSim hsdata (CardDefs.Bacon.xml + RaceTagMap.xml) with ETag
 *     caching and converts it when its build is newer than what we have;
 *  3. repeats every 6 h.
 * No Electron imports.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BgCardData } from '@shared/types';
import { CardDb } from '@core/cards/cardDb';
import { convertHsData, HSDATA_BACON_URL, HSDATA_RACETAGMAP_URL } from '@core/cards/hsdataConverter';
import { createLogger } from './logger';

const log = createLogger('card-data');

const REFRESH_MS = 6 * 60 * 60 * 1000;
const CONVERTED_FILE = 'bg-cards.json';
const META_FILE = 'hsdata-meta.json';

interface Meta {
  baconEtag?: string;
  raceHash?: string;
  build?: number;
  checkedAt?: number;
}

/** Reads the `build` attribute of `<CardDefs build="...">` without parsing the whole XML. */
export function peekHsDataBuild(xml: string): number | undefined {
  const m = /<CardDefs[^>]*\bbuild="(\d+)"/.exec(xml.slice(0, 4096));
  return m ? Number(m[1]) : undefined;
}

export function isValidCardData(d: unknown): d is BgCardData {
  const x = d as BgCardData;
  return !!x && typeof x.build === 'number' && Array.isArray(x.cards) && x.cards.length > 500;
}

interface SimpleResponse {
  status: number;
  ok: boolean;
  etag?: string;
  body: string;
}

export interface CardDataServiceOptions {
  cacheDir: string;
  bundled: CardDb;
  fetch?: typeof fetch;
  onUpdate?: (db: CardDb) => void;
  refreshIntervalMs?: number;
  timeoutMs?: number;
}

export class CardDataService {
  private db: CardDb;
  private timer: ReturnType<typeof setInterval> | undefined;
  private refreshing: Promise<void> | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: CardDataServiceOptions) {
    this.db = opts.bundled;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  get current(): CardDb {
    return this.db;
  }

  /** Kicks off cache load + periodic refresh. Returns immediately. */
  start(initialDelayMs = 3000): void {
    setTimeout(() => {
      void (async () => {
        await this.loadCached();
        await this.refresh();
      })();
    }, initialDelayMs);
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshIntervalMs ?? REFRESH_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private adopt(data: BgCardData, origin: string): void {
    if (data.build <= this.db.build) return;
    this.db = new CardDb(data);
    log.info(`using card data build ${data.build} (${data.cards.length} cards) from ${origin}`);
    try {
      this.opts.onUpdate?.(this.db);
    } catch (err) {
      log.error('onUpdate failed', err);
    }
  }

  private async readMeta(): Promise<Meta> {
    try {
      return JSON.parse(await readFile(join(this.opts.cacheDir, META_FILE), 'utf8')) as Meta;
    } catch {
      return {};
    }
  }

  private async writeAtomic(name: string, content: string): Promise<void> {
    await mkdir(this.opts.cacheDir, { recursive: true });
    const p = join(this.opts.cacheDir, name);
    await writeFile(`${p}.tmp`, content, 'utf8');
    await rename(`${p}.tmp`, p);
  }

  async loadCached(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(join(this.opts.cacheDir, CONVERTED_FILE), 'utf8')) as unknown;
      if (isValidCardData(data)) this.adopt(data, 'cache');
    } catch {
      /* no cache */
    }
  }

  private async get(url: string, headers: Record<string, string> = {}): Promise<SimpleResponse> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 120000);
    try {
      const res = await this.fetchImpl(url, { headers, signal: ctrl.signal });
      // Read the body while the timeout is still armed.
      const body = res.status === 304 ? '' : await res.text();
      return { status: res.status, ok: res.ok, etag: res.headers.get('etag') ?? undefined, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Downloads hsdata if it changed; converts if its build is newer. Never throws. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      try {
        const meta = await this.readMeta();
        const raceRes = await this.get(HSDATA_RACETAGMAP_URL);
        if (!raceRes.ok) throw new Error(`RaceTagMap HTTP ${raceRes.status}`);
        const raceXml = raceRes.body;
        const raceHash = createHash('sha1').update(raceXml).digest('hex');
        const headers: Record<string, string> = {};
        if (meta.baconEtag && meta.raceHash === raceHash) headers['If-None-Match'] = meta.baconEtag;
        const baconRes = await this.get(HSDATA_BACON_URL, headers);
        if (baconRes.status === 304) {
          log.info('hsdata unchanged (304)');
          await this.writeAtomic(META_FILE, JSON.stringify({ ...meta, checkedAt: Date.now() }));
          return;
        }
        if (!baconRes.ok) throw new Error(`CardDefs.Bacon HTTP ${baconRes.status}`);
        const baconXml = baconRes.body;
        const build = peekHsDataBuild(baconXml);
        const newMeta: Meta = {
          baconEtag: baconRes.etag || undefined,
          raceHash,
          build,
          checkedAt: Date.now(),
        };
        if (build !== undefined && build <= this.db.build) {
          log.info(`hsdata build ${build} is not newer than ${this.db.build}`);
          await this.writeAtomic(META_FILE, JSON.stringify(newMeta));
          return;
        }
        // Let the event loop breathe before the ~0.2-0.5 s conversion.
        await new Promise((r) => setTimeout(r, 0));
        const data = convertHsData(baconXml, raceXml);
        if (!isValidCardData(data)) throw new Error('converted data looks invalid');
        await this.writeAtomic(CONVERTED_FILE, JSON.stringify(data));
        await this.writeAtomic(META_FILE, JSON.stringify({ ...newMeta, build: data.build }));
        this.adopt(data, 'hsdata');
      } catch (err) {
        log.warn(`card data refresh skipped: ${(err as Error)?.message ?? err}`);
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }
}
