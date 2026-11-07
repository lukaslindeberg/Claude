/**
 * Wraps a BgTracker: feeds it log lines and publishes `BgGameState` snapshots
 * throttled to ~8/s, but immediately whenever the tracker emits events.
 * Used for both the live log and the demo replay. No Electron imports.
 */
import type { BgEvent, BgGameState } from '@shared/types';
import { createLogger, isDebugLogging } from './logger';

/** The subset of `BgTracker` the main process relies on. */
export interface TrackerLike {
  feedLines(lines: string[]): BgEvent[];
  getState(): BgGameState;
  readonly version: number;
  reset(opts?: { keepUnfinishedGame?: boolean }): void;
  /** End of input: emits a buffered packet and a pending gameEnd. */
  flush?(): BgEvent[];
  /** Periodic re-check of time-based state while the log is silent. */
  tick?(): boolean;
}

/** Leading + trailing throttle. `request(true)` fires synchronously. */
export class Throttle {
  private last = -Infinity;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly fn: () => void,
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  request(immediate = false): void {
    if (immediate) return this.fire();
    if (this.timer) return;
    const wait = this.last + this.intervalMs - this.now();
    if (wait <= 0) this.fire();
    else this.timer = setTimeout(() => this.fire(), wait);
  }

  fire(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.last = this.now();
    this.fn();
  }

  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export interface GameFeedOptions {
  label: string;
  tracker: TrackerLike;
  onState: (state: BgGameState) => void;
  onEvents: (events: BgEvent[]) => void;
  throttleMs?: number;
  /** Log phase/turn transitions to stdout (dev). */
  logTransitions?: boolean;
}

export class GameFeed {
  private tracker: TrackerLike;
  private publishedVersion = -1;
  private readonly throttle: Throttle;
  private readonly log;
  private lastTransition = '';
  private readonly logTransitions: boolean;

  constructor(private readonly opts: GameFeedOptions) {
    this.tracker = opts.tracker;
    this.log = createLogger(opts.label);
    this.throttle = new Throttle(() => this.publish(), opts.throttleMs ?? 125);
    this.logTransitions = opts.logTransitions ?? isDebugLogging();
  }

  get version(): number {
    return this.tracker.version;
  }

  getState(): BgGameState {
    return this.tracker.getState();
  }

  /** Feeds lines; returns the tracker's events (already forwarded to `onEvents`). */
  feed(lines: string[]): BgEvent[] {
    let events: BgEvent[] = [];
    try {
      events = this.tracker.feedLines(lines);
    } catch (err) {
      this.log.error('tracker failed on a batch of lines', err);
      return [];
    }
    if (events.length) {
      this.throttle.request(true);
      try {
        this.opts.onEvents(events);
      } catch (err) {
        this.log.error('event handler failed', err);
      }
    } else if (this.tracker.version !== this.publishedVersion) {
      this.throttle.request(false);
    }
    return events;
  }

  /** Swaps the tracker (e.g. new card data) and publishes the new state. */
  replaceTracker(tracker: TrackerLike): void {
    this.tracker = tracker;
    this.publishedVersion = -1;
    this.throttle.request(true);
  }

  reset(): void {
    this.tracker.reset();
    this.publishedVersion = -1;
    this.throttle.request(true);
  }

  /**
   * The followed log was replaced (new client session, truncation). A game whose end
   * was already seen is finished (and its gameEnd emitted) instead of being dropped; a
   * game still in progress is kept so a reconnect in the new log continues it.
   */
  restartLog(): BgEvent[] {
    let events: BgEvent[] = [];
    try {
      events = this.tracker.flush?.() ?? [];
    } catch (err) {
      this.log.error('tracker flush failed', err);
    }
    if (events.length) {
      try {
        this.opts.onEvents(events);
      } catch (err) {
        this.log.error('event handler failed', err);
      }
    }
    this.tracker.reset({ keepUnfinishedGame: true });
    this.publishedVersion = -1;
    this.throttle.request(true);
    return events;
  }

  /** Call every few seconds: lets time-based state (a stalled playback) expire while the log is silent. */
  tick(): void {
    try {
      this.tracker.tick?.();
    } catch (err) {
      this.log.error('tracker tick failed', err);
      return;
    }
    if (this.tracker.version !== this.publishedVersion) this.throttle.request(false);
  }

  /** Publishes the current state now (even if unchanged). */
  publishNow(): void {
    this.publishedVersion = -1;
    this.throttle.request(true);
  }

  dispose(): void {
    this.throttle.cancel();
  }

  private publish(): void {
    if (this.tracker.version === this.publishedVersion) return;
    this.publishedVersion = this.tracker.version;
    let state: BgGameState;
    try {
      state = this.tracker.getState();
    } catch (err) {
      this.log.error('getState failed', err);
      return;
    }
    if (this.logTransitions) {
      const t = `active=${state.active} phase=${state.phase} turn=${state.turn}`;
      if (t !== this.lastTransition) {
        this.lastTransition = t;
        this.log.info(`[state] ${t} players=${state.players.length} hero=${state.chosenHeroCardId ?? '-'}`);
      }
    }
    try {
      this.opts.onState(state);
    } catch (err) {
      this.log.error('state handler failed', err);
    }
  }
}
