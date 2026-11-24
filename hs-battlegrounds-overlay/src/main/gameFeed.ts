/**
 * Wraps a BgTracker: feeds it log lines and publishes `BgGameState` snapshots
 * throttled to ~8/s, but immediately whenever the tracker emits events.
 * Used for both the live log and the demo replay. No Electron imports.
 *
 * Also the tracker's diagnostics log: every event, phase transitions (with how far
 * behind the clock the log line was), packets the tracker failed on, lines that did
 * not parse, and per-game counters.
 */
import type { PacketErrorInfo, TrackerDiagnostics } from '@core/bg/tracker';
import type { BgEvent, BgGameState, Tribe } from '@shared/types';
import { describeEvent, formatDuration, logLineAgeMs } from './diagnostics/describe';
import { RateLimiter, createLogger, isDebugLogging } from './logger';

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
  /** Counters and playback timing (diagnostics). */
  diagnostics?(): TrackerDiagnostics;
  /** Lobby tribes read from the hero-pick screen. */
  setLobbyTribes?(tribes: Tribe[]): boolean;
  /** Set by GameFeed: a packet whose handling threw (skipped). */
  onPacketError?: (err: unknown, info: PacketErrorInfo) => void;
}

/** Packet errors / unparsed lines logged in full per minute; the rest are only counted. */
const DETAILED_PER_MINUTE = 20;

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
  /** Log every published state change (active/phase/turn/players) at info instead of debug. */
  logTransitions?: boolean;
  /** Compare phase changes with the wall clock (the live log; not a replay). */
  measureLag?: boolean;
  /** Card names for the log. */
  cardName?: (cardId: string) => string | undefined;
  /** Wall clock (tests). */
  now?: () => Date;
}

interface GameCounters {
  gameId: string;
  startedAt: number;
  base: Pick<TrackerDiagnostics, 'lines' | 'unparsed' | 'packetErrors'>;
}

export class GameFeed {
  private tracker: TrackerLike;
  private publishedVersion = -1;
  private readonly throttle: Throttle;
  private readonly log;
  private lastTransition = '';
  private readonly logTransitions: boolean;
  private lastPhase = '';
  private lastUnparsed = 0;
  private readonly limiter = new RateLimiter(DETAILED_PER_MINUTE, 60_000);
  private game: GameCounters | undefined;

  constructor(private readonly opts: GameFeedOptions) {
    this.tracker = opts.tracker;
    this.log = createLogger(opts.label);
    this.throttle = new Throttle(() => this.publish(), opts.throttleMs ?? 125);
    this.logTransitions = opts.logTransitions ?? isDebugLogging();
    this.attach(this.tracker);
  }

  /** Counters of the current tracker (undefined if it has none). */
  diagnostics(): TrackerDiagnostics | undefined {
    try {
      return this.tracker.diagnostics?.();
    } catch {
      return undefined;
    }
  }

  private attach(tracker: TrackerLike): void {
    tracker.onPacketError = (err, info) => this.packetError(err, info);
    this.lastUnparsed = this.diagnostics()?.unparsed ?? 0;
  }

  private packetError(err: unknown, info: PacketErrorInfo): void {
    const { allowed, suppressed } = this.limiter.take('packet');
    if (suppressed) this.log.warn(`${suppressed} more tracker packet errors in the previous minute (not shown)`);
    if (!allowed) return;
    this.log.error(
      `tracker failed on a ${info.packetType} packet at log time ${info.ts || '?'} (skipped, tracking goes on)\n` +
        `line: ${info.line}\npacket: ${info.packet}\nerror:`,
      err,
    );
  }

  /** New lines that looked like packets but did not parse. */
  private checkUnparsed(d: TrackerDiagnostics | undefined): void {
    if (!d) return;
    if (d.unparsed < this.lastUnparsed) this.lastUnparsed = 0;
    const n = d.unparsed - this.lastUnparsed;
    if (n <= 0) return;
    this.lastUnparsed = d.unparsed;
    const { allowed, suppressed } = this.limiter.take('unparsed');
    if (suppressed) this.log.warn(`${suppressed} more unparsed-line reports in the previous minute (not shown)`);
    if (allowed) this.log.warn(`${n} log line${n > 1 ? 's' : ''} did not parse (${d.unparsed} total); latest: ${d.lastUnparsed ?? '?'}`);
  }

  private logEvents(events: BgEvent[]): void {
    for (const e of events) {
      try {
        this.log.info(describeEvent(e, this.opts.cardName));
        if (e.type === 'gameStart') {
          const d = this.diagnostics();
          this.game = {
            gameId: e.gameId,
            startedAt: Date.now(),
            base: { lines: d?.lines ?? 0, unparsed: d?.unparsed ?? 0, packetErrors: d?.packetErrors ?? 0 },
          };
        } else if (e.type === 'gameEnd') this.logGameCounters(e.record.id);
      } catch (err) {
        this.log.warn('could not describe an event', err);
      }
    }
  }

  private logGameCounters(gameId: string): void {
    const d = this.diagnostics();
    const g = this.game?.gameId === gameId ? this.game : undefined;
    if (!d) return;
    const base = g?.base ?? { lines: 0, unparsed: 0, packetErrors: 0 };
    this.log.info(
      `tracker counters for game ${gameId}: ${d.lines - base.lines} lines, ${d.unparsed - base.unparsed} unparsed, ` +
        `${d.packetErrors - base.packetErrors} packet errors${g ? `, tracked for ${formatDuration(Date.now() - g.startedAt)}` : ''}`,
    );
    this.game = undefined;
  }

  /** `phase recruit -> combat · turn 5 · line 15:33:01.1234567, 2.1 s before now · playback 12.0 s behind GameState` */
  private logPhase(prev: string, state: BgGameState): void {
    const d = this.diagnostics();
    const parts = [`phase ${prev || 'none'} -> ${state.active ? state.phase : 'idle'}`, `turn ${state.turn}`];
    if (d?.logTs) {
      let line = `line ${d.logTs}`;
      if (this.opts.measureLag) {
        const age = logLineAgeMs(d.logTs, this.opts.now?.() ?? new Date());
        if (!Number.isNaN(age)) line += age >= 0 ? `, ${formatDuration(age)} before now` : `, ${formatDuration(-age)} in the future (clock skew?)`;
      }
      parts.push(line);
    }
    if (d && state.active) {
      parts.push(
        d.followsPlayback
          ? `follows playback${d.playbackLagMs !== undefined ? ` ${formatDuration(d.playbackLagMs)} behind GameState` : ''}`
          : d.playbackTurn
            ? `GameState stream (playback at turn ${d.playbackTurn}, GameState at ${d.gsTurn})`
            : 'GameState stream (no animated playback seen)',
      );
    }
    this.log.info(parts.join(' · '));
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
    this.checkUnparsed(this.diagnostics());
    if (events.length) {
      this.logEvents(events);
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
    this.tracker.onPacketError = undefined;
    this.tracker = tracker;
    this.attach(tracker);
    this.game = undefined;
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
      this.logEvents(events);
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
  /** Passes lobby tribes read from the screen to the tracker and publishes the change. */
  setLobbyTribes(tribes: Tribe[]): boolean {
    const changed = !!this.tracker.setLobbyTribes?.(tribes);
    if (changed) this.throttle.request(true);
    return changed;
  }

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
    const phase = state.active ? state.phase : 'idle';
    if (phase !== this.lastPhase) {
      const prev = this.lastPhase;
      this.lastPhase = phase;
      try {
        this.logPhase(prev, state);
      } catch {
        /* diagnostics only */
      }
    }
    const t = `active=${state.active} phase=${state.phase} turn=${state.turn}`;
    if (t !== this.lastTransition) {
      this.lastTransition = t;
      const line = `[state] ${t} players=${state.players.length} hero=${state.chosenHeroCardId ?? '-'}`;
      if (this.logTransitions) this.log.info(line);
      else this.log.debug(line);
    }
    try {
      this.opts.onState(state);
    } catch (err) {
      this.log.error('state handler failed', err);
    }
  }
}
