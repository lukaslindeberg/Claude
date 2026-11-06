import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BgEvent, BgGameState } from '../../src/shared/types';
import { GameFeed, Throttle, type TrackerLike } from '../../src/main/gameFeed';

describe('Throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires at most once per interval with a trailing call, immediately on demand', () => {
    const fn = vi.fn();
    const t = new Throttle(fn, 125, () => Date.now());
    t.request();
    expect(fn).toHaveBeenCalledTimes(1);
    t.request();
    t.request();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(130);
    expect(fn).toHaveBeenCalledTimes(2);
    t.request(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

class FakeTracker implements TrackerLike {
  version = 0;
  private events: BgEvent[] = [];
  queue(e: BgEvent) {
    this.events.push(e);
  }
  feedLines(lines: string[]): BgEvent[] {
    this.version += lines.length;
    const e = this.events;
    this.events = [];
    return e;
  }
  getState(): BgGameState {
    return { gameId: 'x', phase: 'recruit', turn: this.version, players: [], active: true } as unknown as BgGameState;
  }
  resets: unknown[] = [];
  pendingOnFlush: BgEvent[] = [];
  reset(opts?: { keepUnfinishedGame?: boolean }): void {
    this.resets.push(opts);
    this.version++;
  }
  flush(): BgEvent[] {
    const e = this.pendingOnFlush;
    this.pendingOnFlush = [];
    return e;
  }
}

describe('GameFeed', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('throttles state but publishes immediately with events', () => {
    const tracker = new FakeTracker();
    const states: number[] = [];
    const events: BgEvent[][] = [];
    const feed = new GameFeed({
      label: 'test',
      tracker,
      onState: (s) => states.push(s.turn),
      onEvents: (e) => events.push(e),
      logTransitions: false,
    });
    feed.feed(['a']);
    feed.feed(['b']);
    feed.feed(['c']);
    expect(states).toEqual([1]);
    vi.advanceTimersByTime(200);
    expect(states).toEqual([1, 3]);
    feed.feed(['d']);
    tracker.queue({ type: 'turnStart', turn: 2 });
    feed.feed(['e']);
    expect(states).toEqual([1, 3, 5]);
    expect(events).toEqual([[{ type: 'turnStart', turn: 2 }]]);
    vi.advanceTimersByTime(500);
    expect(states).toEqual([1, 3, 5]); // nothing new
    feed.dispose();
  });

  it('restartLog finishes a pending game and keeps one in progress for a reconnect', () => {
    const tracker = new FakeTracker();
    const events: BgEvent[][] = [];
    const states: number[] = [];
    const feed = new GameFeed({
      label: 'test',
      tracker,
      onState: (s) => states.push(s.turn),
      onEvents: (e) => events.push(e),
      logTransitions: false,
    });
    const end = { type: 'gameEnd', record: { id: 'g1' } } as unknown as BgEvent;
    tracker.pendingOnFlush = [end];
    expect(feed.restartLog()).toEqual([end]);
    expect(events).toEqual([[end]]);
    expect(tracker.resets).toEqual([{ keepUnfinishedGame: true }]);
    expect(states).toHaveLength(1); // published right away
    feed.dispose();
  });
});
