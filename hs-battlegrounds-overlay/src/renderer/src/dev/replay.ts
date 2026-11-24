/**
 * Browser replay of a recorded Power.log through the real BgTracker (demo only).
 * The fixture is served by the demo dev server (vite.demo.config.ts) at /__fixtures/.
 */
import type { CardDb } from '@core/cards/cardDb';
import type { BgEvent, BgGameState, GamePhase } from '@shared/types';

export const REPLAY_FIXTURE = '/__fixtures/logs/bg_139963_perfect_game.power.log.gz';

export interface ReplayOptions {
  cardDb: CardDb;
  /** Log-time multiplier (40 = 40x real time). */
  speed: number;
  url?: string;
  onState(state: BgGameState): void;
  onEvent(event: BgEvent): void;
  onProgress(progress: number): void;
  onError(error: string): void;
  /** Pause the replay once this returns true (screenshots / debugging). */
  until?: (state: BgGameState) => boolean;
}

const TS = /^[DWEI] (\d\d):(\d\d):(\d\d)\.(\d{3})/;

function lineTime(line: string): number | undefined {
  const m = TS.exec(line);
  if (!m) return undefined;
  return ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4];
}

/** Parses `?until=combat@8` style specs. */
export function parseUntil(spec: string | null): ((s: BgGameState) => boolean) | undefined {
  if (!spec) return undefined;
  const [phase, turn] = spec.split('@');
  return (s) => s.phase === (phase as GamePhase) && (!turn || s.turn >= Number(turn));
}

export function runReplay(opts: ReplayOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  (async () => {
    const { BgTracker } = await import('@core/bg/tracker');
    const res = await fetch(opts.url ?? REPLAY_FIXTURE);
    if (!res.ok || !res.body) throw new Error(`fixture HTTP ${res.status}`);
    const text = await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).text();
    const lines = text.split(/\r?\n/);
    const tracker = new BgTracker({ cardDb: opts.cardDb });

    let i = 0;
    let clock: number | undefined;
    let dayOffset = 0;
    let prevRaw = 0;
    const TICK = 50;
    const MAX_GAP = 4000; // never wait more than 4 s of log time between lines

    const step = () => {
      if (stopped) return;
      if (clock === undefined) {
        const first = lines.find((l) => lineTime(l) !== undefined);
        clock = (first && lineTime(first)) || 0;
        prevRaw = clock;
      }
      clock += TICK * opts.speed;
      const batch: string[] = [];
      while (i < lines.length) {
        const raw = lineTime(lines[i]);
        if (raw !== undefined) {
          if (raw < prevRaw - 12 * 3600_000) dayOffset += 24 * 3600_000;
          prevRaw = raw;
          const t = raw + dayOffset;
          if (t > clock) {
            // Skip long idle gaps (menus, hero pick timers); otherwise wait.
            if (batch.length === 0 && t - clock > MAX_GAP) clock = t;
            else break;
          }
        }
        batch.push(lines[i]);
        i++;
        if (batch.length > 4000) break;
      }
      if (batch.length) {
        const events = tracker.feedLines(batch);
        for (const ev of events) opts.onEvent(ev);
        const state = tracker.getState();
        opts.onState(state);
        opts.onProgress(i / lines.length);
        if (opts.until?.(state)) return;
      }
      if (i >= lines.length) {
        opts.onProgress(1);
        return;
      }
      timer = setTimeout(step, TICK);
    };
    step();
  })().catch((err) => opts.onError(err instanceof Error ? err.message : String(err)));

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
