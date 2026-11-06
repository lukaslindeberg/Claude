/**
 * Persistence for settings.json and history.json in the app's userData folder.
 * No Electron imports: the directory is passed in (testable).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/types';
import type { BattleSimResult, MatchRecord, Settings } from '@shared/types';
import { createLogger } from './logger';

const log = createLogger('store');

export const HISTORY_CAP = 2000;
export const SETTINGS_FILE = 'settings.json';
export const HISTORY_FILE = 'history.json';

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merges `saved` over `defaults`:
 *  - plain objects are merged recursively (new default keys appear, unknown saved keys are kept);
 *  - values whose type doesn't match the default's type are ignored (default wins);
 *  - keys absent from defaults (optional settings) are taken as-is.
 */
export function deepMergeDefaults<T>(defaults: T, saved: unknown): T {
  if (!isPlainObject(defaults)) {
    if (saved === undefined || saved === null) return defaults;
    if (Array.isArray(defaults)) return (Array.isArray(saved) ? saved : defaults) as T;
    return (typeof saved === typeof defaults ? saved : defaults) as T;
  }
  if (!isPlainObject(saved)) return structuredClone(defaults);
  const out: Json = {};
  for (const [k, dv] of Object.entries(defaults as Json)) {
    out[k] = k in saved ? deepMergeDefaults(dv, saved[k]) : structuredClone(dv);
  }
  for (const [k, sv] of Object.entries(saved)) {
    if (!(k in out) && sv !== undefined) out[k] = sv;
  }
  return out as T;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Deep-merge over DEFAULT_SETTINGS and clamp numeric ranges. */
export function normalizeSettings(saved: unknown): Settings {
  const s = deepMergeDefaults(DEFAULT_SETTINGS, saved);
  s.scale = Number.isFinite(s.scale) ? clamp(s.scale, 0.6, 1.6) : DEFAULT_SETTINGS.scale;
  s.opacity = Number.isFinite(s.opacity) ? clamp(s.opacity, 0.3, 1) : DEFAULT_SETTINGS.opacity;
  s.simIterations = Number.isFinite(s.simIterations)
    ? Math.round(clamp(s.simIterations, 100, 100000))
    : DEFAULT_SETTINGS.simIterations;
  if (s.hearthstonePath !== undefined && typeof s.hearthstonePath !== 'string') delete s.hearthstonePath;
  if (s.hearthstonePath === '') delete s.hearthstonePath;
  if (s.manualRating !== undefined && !Number.isFinite(s.manualRating)) delete s.manualRating;
  return s;
}

/**
 * Applies a renderer patch to the current settings.
 * - `positions` is replaced wholesale (so `{ positions: {} }` resets all widget positions);
 * - other nested objects (widgets, hotkeys, leaderboardCalibration) are shallow-merged;
 * - an explicit `undefined`/`null` removes an optional key (e.g. hearthstonePath).
 */
export function applySettingsPatch(current: Settings, patch: Partial<Settings>): Settings {
  const next: Json = structuredClone(current) as unknown as Json;
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === undefined || v === null) {
      delete next[k];
    } else if (k !== 'positions' && isPlainObject(v) && isPlainObject(next[k])) {
      next[k] = { ...(next[k] as Json), ...v };
    } else {
      next[k] = structuredClone(v);
    }
  }
  return normalizeSettings(next);
}

/** Fills `prediction` on each combat from sim results reported by the renderer (keyed by BG turn). */
export function mergeSimPredictions(
  record: MatchRecord,
  predictions: ReadonlyMap<number, BattleSimResult> | Record<number, BattleSimResult>,
): MatchRecord {
  const get = (turn: number): BattleSimResult | undefined =>
    predictions instanceof Map ? predictions.get(turn) : (predictions as Record<number, BattleSimResult>)[turn];
  return {
    ...record,
    combats: record.combats.map((c) => {
      const p = c.prediction ?? get(c.turn);
      return p ? { ...c, prediction: p } : c;
    }),
  };
}

/** Inserts a record (newest first), replacing any record with the same id, capped. */
export function addMatchToHistory(history: MatchRecord[], record: MatchRecord, cap = HISTORY_CAP): MatchRecord[] {
  const rest = history.filter((m) => m.id !== record.id);
  const next = [record, ...rest].sort((a, b) => (b.endedAt || b.startedAt) - (a.endedAt || a.startedAt));
  return next.slice(0, cap);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    log.warn(`could not parse ${path}; keeping a backup`, err);
    try {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
    } catch {
      /* ignore */
    }
    return undefined;
  }
}

/** Serialised, coalescing atomic writer (tmp file + rename). */
export class AtomicJsonFile {
  private chain: Promise<void> = Promise.resolve();
  private latest: unknown;
  private queued = false;

  constructor(readonly path: string) {}

  write(data: unknown): Promise<void> {
    this.latest = data;
    if (this.queued) return this.chain;
    this.queued = true;
    this.chain = this.chain.then(async () => {
      this.queued = false;
      const json = JSON.stringify(this.latest);
      const tmp = `${this.path}.tmp`;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await writeFile(tmp, json, 'utf8');
          await rename(tmp, this.path);
          return;
        } catch (err) {
          if (attempt === 2) {
            log.error(`failed to write ${this.path}`, err);
            await unlink(tmp).catch(() => undefined);
          } else {
            await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
          }
        }
      }
    });
    return this.chain;
  }

  /** Synchronous write used on quit. */
  writeSync(data: unknown): void {
    this.latest = data;
    const tmp = `${this.path}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(data), 'utf8');
      renameSync(tmp, this.path);
    } catch (err) {
      log.error(`failed to write ${this.path}`, err);
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
  }

  flush(): Promise<void> {
    return this.chain;
  }
}

function isMatchRecord(v: unknown): v is MatchRecord {
  return (
    isPlainObject(v) &&
    typeof v.id === 'string' &&
    typeof v.placement === 'number' &&
    typeof v.heroCardId === 'string' &&
    Array.isArray(v.combats)
  );
}

export class Store {
  readonly settingsFile: AtomicJsonFile;
  readonly historyFile: AtomicJsonFile;
  /** True when no settings.json existed (first launch). */
  readonly firstRun: boolean;
  private settings: Settings;
  private history: MatchRecord[];

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    const settingsPath = join(dir, SETTINGS_FILE);
    const historyPath = join(dir, HISTORY_FILE);
    this.firstRun = !existsSync(settingsPath);
    this.settingsFile = new AtomicJsonFile(settingsPath);
    this.historyFile = new AtomicJsonFile(historyPath);
    this.settings = normalizeSettings(readJson(settingsPath));
    const rawHistory = readJson(historyPath);
    this.history = Array.isArray(rawHistory) ? rawHistory.filter(isMatchRecord).slice(0, HISTORY_CAP) : [];
    if (this.firstRun) void this.settingsFile.write(this.settings);
  }

  getSettings(): Settings {
    return this.settings;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.settings = applySettingsPatch(this.settings, patch);
    void this.settingsFile.write(this.settings);
    return this.settings;
  }

  getHistory(): MatchRecord[] {
    return this.history;
  }

  addMatch(record: MatchRecord): MatchRecord[] {
    this.history = addMatchToHistory(this.history, record);
    void this.historyFile.write(this.history);
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
    void this.historyFile.write(this.history);
  }

  async flush(): Promise<void> {
    await Promise.all([this.settingsFile.flush(), this.historyFile.flush()]);
  }
}
