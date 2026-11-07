/**
 * Simulator case log: `<userData>/logs/sim-cases.jsonl`, one JSON line per combat
 * with everything needed to replay it offline:
 *
 *   { key, gameId, turn, appVersion, cardBuild, input: BattleSimInput,
 *     result: BattleSimResult, actual: { result, damage }, verdict, ... }
 *
 * The three parts arrive separately (combat start from the tracker, the simulation
 * from the overlay, the outcome when the combat resolves in the log) and are merged
 * by game + turn in memory. A case is appended once it has both a result and an
 * outcome, or after a grace period with whatever it has. A part that arrives later
 * still is appended as another line with the same key; lines are merged by key when
 * the file is trimmed (at startup, to the last ~400 combats) and when exported.
 * No Electron imports.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BattleSimInput, BattleSimResult, GameMode } from '@shared/types';
import { simVerdict, type Outcome, type SimVerdict } from './describe';

export const SIM_CASES_FILE = 'sim-cases.jsonl';
export const SIM_CASES_MAX = 400;
/** Also keep the file below this size (inputs carry every tag of every minion). */
export const SIM_CASES_MAX_BYTES = 40 * 1024 * 1024;

export interface SimCase {
  v: 1;
  /** `${gameId}:${turn}` */
  key: string;
  gameId: string;
  turn: number;
  source: 'live' | 'demo';
  /** ISO times. */
  createdAt: string;
  updatedAt: string;
  appVersion: string;
  cardBuild: number;
  cardSource?: string;
  mode?: GameMode;
  input?: BattleSimInput;
  result?: BattleSimResult;
  actual?: { result: Outcome; damage: number; opponentHeroCardId?: string };
  verdict?: SimVerdict;
  /** Written by an export for a case that was still being assembled. */
  pending?: boolean;
}

export interface SimCaseMeta {
  appVersion: string;
  cardBuild: number;
  cardSource?: string;
}

export const simCaseKey = (gameId: string, turn: number) => `${gameId}:${turn}`;

/** Merges a later record of the same combat over an earlier one (defined fields win). */
export function mergeSimCase(a: SimCase, b: SimCase): SimCase {
  const out: SimCase = { ...a };
  for (const [k, v] of Object.entries(b)) if (v !== undefined) (out as unknown as Record<string, unknown>)[k] = v;
  out.createdAt = a.createdAt < b.createdAt ? a.createdAt : b.createdAt;
  if (out.result && out.actual) out.verdict = simVerdict(out.result, out.actual.result);
  if (!b.pending) delete out.pending;
  return out;
}

/** Merges records by key (in order of first appearance) and keeps the last `max`. */
export function mergeSimCases(cases: SimCase[], max = SIM_CASES_MAX): SimCase[] {
  const byKey = new Map<string, SimCase>();
  for (const c of cases) {
    if (!c || typeof c.key !== 'string') continue;
    const prev = byKey.get(c.key);
    byKey.set(c.key, prev ? mergeSimCase(prev, c) : c);
  }
  const all = [...byKey.values()];
  return all.length > max ? all.slice(all.length - max) : all;
}

/** Parses JSONL, skipping blank or corrupt lines (e.g. a line cut short by a crash). */
export function parseSimCases(text: string): SimCase[] {
  const out: SimCase[] = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const v = JSON.parse(t) as SimCase;
      if (v && typeof v === 'object' && typeof v.key === 'string') out.push(v);
    } catch {
      /* skip */
    }
  }
  return out;
}

export function toJsonl(cases: SimCase[]): string {
  return cases.map((c) => JSON.stringify(c)).join('\n') + (cases.length ? '\n' : '');
}

/** Drops the oldest cases until the JSONL is below `maxBytes`. */
function capBytes(cases: SimCase[], maxBytes: number): SimCase[] {
  const sizes = cases.map((c) => Buffer.byteLength(JSON.stringify(c)) + 1);
  let total = sizes.reduce((a, b) => a + b, 0);
  let start = 0;
  while (total > maxBytes && start < cases.length - 1) total -= sizes[start++];
  return start ? cases.slice(start) : cases;
}

export interface SimCaseLogOptions {
  file: string;
  meta: () => SimCaseMeta;
  maxCases?: number;
  maxBytes?: number;
  /** How long a combat that has its outcome waits for a late simulation result. */
  graceMs?: number;
  now?: () => number;
  /** Told about write failures. */
  onError?: (err: unknown) => void;
}

export class SimCaseLog {
  private readonly pending = new Map<string, SimCase>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly maxCases: number;
  private readonly maxBytes: number;
  private readonly graceMs: number;
  private readonly now: () => number;
  /** Cases appended this session. */
  written = 0;

  constructor(private readonly opts: SimCaseLogOptions) {
    this.maxCases = opts.maxCases ?? SIM_CASES_MAX;
    this.maxBytes = opts.maxBytes ?? SIM_CASES_MAX_BYTES;
    this.graceMs = opts.graceMs ?? 15_000;
    this.now = opts.now ?? Date.now;
  }

  get file(): string {
    return this.opts.file;
  }

  /** Merges duplicate keys and keeps the newest cases. Call at startup. */
  trim(): { before: number; after: number } {
    const file = this.opts.file;
    if (!existsSync(file)) return { before: 0, after: 0 };
    const raw = parseSimCases(readFileSync(file, 'utf8'));
    const kept = capBytes(mergeSimCases(raw, this.maxCases), this.maxBytes);
    if (kept.length !== raw.length || statSync(file).size > this.maxBytes) {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, toJsonl(kept), 'utf8');
      renameSync(tmp, file);
    }
    return { before: raw.length, after: kept.length };
  }

  /** The file merged with the cases still being assembled (for an export). */
  snapshot(): string {
    let fromFile: SimCase[] = [];
    try {
      if (existsSync(this.opts.file)) fromFile = parseSimCases(readFileSync(this.opts.file, 'utf8'));
    } catch {
      /* ignore */
    }
    const open = [...this.pending.values()].map((c) => ({ ...c, pending: true }));
    return toJsonl(mergeSimCases([...fromFile, ...open], this.maxCases + open.length));
  }

  combatStart(gameId: string, turn: number, input: BattleSimInput, source: SimCase['source']): void {
    const c = this.get(gameId, turn, source);
    c.input = input;
    c.mode = input.mode;
    this.touch(c);
  }

  simResult(gameId: string, turn: number, result: BattleSimResult, source: SimCase['source'] = 'live'): SimCase {
    const c = this.get(gameId, turn, source);
    c.result = result;
    this.touch(c);
    if (c.actual) this.write(c.key);
    return c;
  }

  combatEnd(gameId: string, turn: number, actual: NonNullable<SimCase['actual']>, source: SimCase['source'] = 'live'): SimCase {
    const c = this.get(gameId, turn, source);
    c.actual = actual;
    this.touch(c);
    if (c.result) this.write(c.key);
    else this.schedule(c.key);
    return c;
  }

  /** The game is over: write its open cases after the grace period. */
  endGame(gameId: string): void {
    for (const c of this.pending.values()) if (c.gameId === gameId) this.schedule(c.key);
  }

  /** Writes every open case now (quit). */
  flushAll(): void {
    for (const key of [...this.pending.keys()]) this.write(key);
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  /** Read access for logging (the open case of a combat). */
  peek(gameId: string, turn: number): SimCase | undefined {
    return this.pending.get(simCaseKey(gameId, turn));
  }

  private get(gameId: string, turn: number, source: SimCase['source']): SimCase {
    const key = simCaseKey(gameId, turn);
    let c = this.pending.get(key);
    if (!c) {
      const iso = new Date(this.now()).toISOString();
      const m = this.opts.meta();
      c = { v: 1, key, gameId, turn, source, createdAt: iso, updatedAt: iso, appVersion: m.appVersion, cardBuild: m.cardBuild };
      if (m.cardSource) c.cardSource = m.cardSource;
      this.pending.set(key, c);
      // Never let abandoned cases pile up.
      if (this.pending.size > 64) this.write(this.pending.keys().next().value!);
    }
    return c;
  }

  private touch(c: SimCase): void {
    c.updatedAt = new Date(this.now()).toISOString();
    if (c.result && c.actual) c.verdict = simVerdict(c.result, c.actual.result);
  }

  private schedule(key: string): void {
    if (this.timers.has(key)) return;
    const t = setTimeout(() => {
      this.timers.delete(key);
      this.write(key);
    }, this.graceMs);
    (t as { unref?: () => void }).unref?.();
    this.timers.set(key, t);
  }

  private write(key: string): void {
    const t = this.timers.get(key);
    if (t) clearTimeout(t);
    this.timers.delete(key);
    const c = this.pending.get(key);
    if (!c) return;
    this.pending.delete(key);
    try {
      mkdirSync(dirname(this.opts.file), { recursive: true });
      appendFileSync(this.opts.file, JSON.stringify(c) + '\n', 'utf8');
      this.written++;
    } catch (err) {
      this.opts.onError?.(err);
    }
  }
}
