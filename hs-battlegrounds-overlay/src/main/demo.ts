/**
 * Demo mode: replays a bundled (gzipped) Power.log through its own tracker,
 * paced by the log's timestamps. No Electron imports.
 */
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { createLogger } from './logger';

const log = createLogger('demo');
const gunzipAsync = promisify(gunzip);

/** File name of the bundled demo log inside `<resources>/demo/`. */
export const DEMO_LOG_FILE = 'demo.power.log.gz';
export const DEFAULT_DEMO_SPEED = 4;
/** Longest real-time gap (ms) honoured between two log timestamps before dividing by speed. */
export const DEMO_MAX_GAP_MS = 1200;
/** Batches whose accumulated wait is below this are fed together (fewer timers). */
export const DEMO_MIN_WAIT_MS = 16;

const DAY_MS = 24 * 60 * 60 * 1000;
const TS_RE = /^[DIWE] (\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,7}))?\s/;

/** `D 13:17:54.2795495 ...` -> milliseconds since midnight (fractional), or undefined. */
export function parseLogTimestampMs(line: string): number | undefined {
  const m = TS_RE.exec(line);
  if (!m) return undefined;
  const frac = m[4] ? Number(`0.${m[4]}`) * 1000 : 0;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + frac;
}

/** Wait between two log timestamps at a replay speed (handles midnight wrap, caps long gaps). */
export function demoDelayMs(prevMs: number, nextMs: number, speed: number, capMs = DEMO_MAX_GAP_MS): number {
  let dt = nextMs - prevMs;
  if (dt < -DAY_MS / 2) dt += DAY_MS; // crossed midnight
  if (!(dt > 0)) return 0;
  const s = speed > 0 && Number.isFinite(speed) ? speed : DEFAULT_DEMO_SPEED;
  return Math.min(dt, capMs) / s;
}

export interface DemoStep {
  /** Feed lines [previous step's end, end). */
  end: number;
  /** Then wait this long (ms). */
  waitMs: number;
}

/** Precomputes the replay schedule. */
export function buildDemoSchedule(
  lines: string[],
  speed: number,
  opts: { capMs?: number; minWaitMs?: number } = {},
): DemoStep[] {
  const steps: DemoStep[] = [];
  const minWait = opts.minWaitMs ?? DEMO_MIN_WAIT_MS;
  let prevTs: number | undefined;
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    const ts = parseLogTimestampMs(lines[i]);
    if (ts === undefined) continue;
    if (prevTs !== undefined && ts !== prevTs) {
      acc += demoDelayMs(prevTs, ts, speed, opts.capMs);
      if (acc >= minWait) {
        // Lines before i belong to the previous timestamp group.
        steps.push({ end: i, waitMs: acc });
        acc = 0;
      }
    }
    prevTs = ts;
  }
  steps.push({ end: lines.length, waitMs: 0 });
  return steps;
}

export function totalDemoDurationMs(steps: DemoStep[]): number {
  return steps.reduce((a, s) => a + s.waitMs, 0);
}

export async function loadDemoLines(path: string): Promise<string[]> {
  const raw = await readFile(path);
  const buf = raw[0] === 0x1f && raw[1] === 0x8b ? await gunzipAsync(raw) : raw;
  return buf
    .toString('utf8')
    .split('\n')
    .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
    .filter((l) => l.length > 0);
}

export interface DemoPlayerOptions {
  loadLines: () => Promise<string[]>;
  /** Receives each batch of lines (feed them to the demo tracker). */
  onLines: (lines: string[]) => void;
  onProgress?: (progress: number) => void;
  /** Called when playback reaches the end (not when stopped). */
  onFinished?: () => void;
}

export class DemoPlayer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lines: string[] = [];
  private steps: DemoStep[] = [];
  private stepIdx = 0;
  private lineIdx = 0;
  private generation = 0;
  private _running = false;
  private _speed = DEFAULT_DEMO_SPEED;
  private lastProgressAt = 0;

  constructor(private readonly opts: DemoPlayerOptions) {}

  get running(): boolean {
    return this._running;
  }
  get speed(): number {
    return this._speed;
  }
  get progress(): number {
    return this.lines.length ? this.lineIdx / this.lines.length : 0;
  }

  async start(speed = DEFAULT_DEMO_SPEED): Promise<void> {
    this.stop();
    const gen = ++this.generation;
    this._speed = speed > 0 && Number.isFinite(speed) ? Math.min(speed, 200) : DEFAULT_DEMO_SPEED;
    this._running = true;
    const lines = await this.opts.loadLines();
    if (gen !== this.generation) return; // stopped/restarted while loading
    this.lines = lines;
    this.steps = buildDemoSchedule(lines, this._speed);
    this.stepIdx = 0;
    this.lineIdx = 0;
    log.info(
      `replaying ${lines.length} lines at ${this._speed}x (~${Math.round(totalDemoDurationMs(this.steps) / 1000)} s)`,
    );
    this.opts.onProgress?.(0);
    this.next(gen);
  }

  stop(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this._running = false;
    this.lines = [];
    this.steps = [];
  }

  private next(gen: number): void {
    if (gen !== this.generation) return;
    const step = this.steps[this.stepIdx++];
    if (!step) {
      this._running = false;
      this.opts.onProgress?.(1);
      this.opts.onFinished?.();
      return;
    }
    const batch = this.lines.slice(this.lineIdx, step.end);
    this.lineIdx = step.end;
    if (batch.length) {
      try {
        this.opts.onLines(batch);
      } catch (err) {
        log.error('demo batch failed', err);
      }
    }
    const now = Date.now();
    if (now - this.lastProgressAt > 500) {
      this.lastProgressAt = now;
      this.opts.onProgress?.(this.progress);
    }
    this.timer = setTimeout(() => this.next(gen), step.waitMs);
  }
}
