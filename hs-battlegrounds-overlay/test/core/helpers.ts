import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { BgEvent, BgGameState } from '@shared/types';
import { BgTracker } from '../../src/core/bg';

export const FIXTURE_DIR = fileURLToPath(new URL('../fixtures/logs/', import.meta.url));

const cache = new Map<string, string[]>();

/** Lines of a gzipped fixture log in test/fixtures/logs. */
export function fixtureLines(file: string): string[] {
  let l = cache.get(file);
  if (!l) {
    l = gunzipSync(readFileSync(FIXTURE_DIR + file)).toString('utf8').split('\n');
    cache.set(file, l);
  }
  return l;
}

export interface Run {
  tracker: BgTracker;
  events: BgEvent[];
  state: BgGameState;
  ms: number;
}

/** Feed all lines one by one (plus flush) with a deterministic clock. */
export function runFixture(file: string, onEvent?: (e: BgEvent, t: BgTracker) => void): Run {
  const lines = fixtureLines(file);
  const tracker = new BgTracker({ now: () => 1_700_000_000_000 });
  const events: BgEvent[] = [];
  const t0 = performance.now();
  for (const line of lines) {
    const evs = tracker.feedLine(line);
    for (const e of evs) {
      events.push(e);
      onEvent?.(e, tracker);
    }
  }
  for (const e of tracker.flush()) {
    events.push(e);
    onEvent?.(e, tracker);
  }
  const ms = performance.now() - t0;
  return { tracker, events, state: tracker.getState(), ms };
}

export function ofType<T extends BgEvent['type']>(events: BgEvent[], type: T): Extract<BgEvent, { type: T }>[] {
  return events.filter((e): e is Extract<BgEvent, { type: T }> => e.type === type);
}

/** Small deterministic PRNG for chunking tests. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const P = 'D 12:00:00.0000000 GameState.DebugPrintPower() - ';
/** Build a GameState.DebugPrintPower() line. */
export function power(payload: string): string {
  return P + payload;
}
export function game(payload: string): string {
  return 'D 12:00:00.0000000 GameState.DebugPrintGame() - ' + payload;
}
