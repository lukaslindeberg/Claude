import { afterEach, describe, expect, it } from 'vitest';
import type { BgEvent } from '../../src/shared/types';
import { BgTracker } from '../../src/core/bg/tracker';
import type { Packet } from '../../src/core/log/powerLogParser';
import { GameFeed } from '../../src/main/gameFeed';
import { configureLogger, onLogEntry, resetLogger, type LogEntry } from '../../src/main/logger';
import { fixtureLines, ofType, runFixture } from '../core/helpers';

const FIXTURE = 'bg_139963_perfect_game.power.log.gz';

afterEach(() => resetLogger());

type Internals = { handle(pk: Packet): void; onBlockStart(...a: unknown[]): void };

describe('tracker error isolation', () => {
  it('logs a packet that throws (with its line) and keeps tracking the game', () => {
    const baseline = runFixture(FIXTURE);
    const baseEnd = ofType(baseline.events, 'gameEnd')[0];
    expect(baseEnd).toBeDefined();

    configureLogger({ console: false });
    const entries: LogEntry[] = [];
    const off = onLogEntry((e) => entries.push(e));

    const tracker = new BgTracker({ now: () => 1_700_000_000_000 });
    const t = tracker as unknown as Internals;
    // Three packets fail after being applied (a bug in later bookkeeping) ...
    const handle = t.handle.bind(tracker);
    let tagChanges = 0;
    t.handle = (pk: Packet) => {
      handle(pk);
      if (pk.type === 'TagChange' && ++tagChanges % 20000 === 0 && tagChanges <= 60000) throw new Error(`injected failure #${tagChanges}`);
    };
    // ... and one fails half-way through a BLOCK_START (block depth must stay balanced).
    const onBlockStart = t.onBlockStart.bind(tracker);
    let blocks = 0;
    t.onBlockStart = (...a: unknown[]) => {
      if (++blocks === 1) throw new TypeError('injected block failure');
      onBlockStart(...a);
    };

    const events: BgEvent[] = [];
    const feed = new GameFeed({ label: 'live', tracker, onState: () => undefined, onEvents: (e) => events.push(...e), throttleMs: 0 });
    const lines = fixtureLines(FIXTURE);
    // A malformed packet line somewhere in the middle.
    const malformed = 'D 13:20:00.0000000 GameState.DebugPrintPower() -     FULL_ENTITY - Creating garbage';
    const mid = Math.floor(lines.length / 2);
    const fed = [...lines.slice(0, mid), malformed, ...lines.slice(mid)];
    for (let i = 0; i < fed.length; i += 5000) feed.feed(fed.slice(i, i + 5000));
    for (const e of tracker.flush()) events.push(e);
    off();

    const d = tracker.diagnostics();
    expect(d.packetErrors).toBe(4);
    expect(d.unparsed).toBe(1);
    expect(d.lastUnparsed).toBe(malformed);

    const errors = entries.filter((e) => e.level === 'error' && e.text.includes('tracker failed on a'));
    expect(errors).toHaveLength(4);
    expect(errors.some((e) => e.text.includes('BlockStart packet') && e.text.includes('injected block failure'))).toBe(true);
    const tagErr = errors.find((e) => e.text.includes('injected failure #20000'))!;
    expect(tagErr.text).toMatch(/tracker failed on a TagChange packet at log time \d\d:\d\d:\d\d/);
    expect(tagErr.text).toMatch(/\nline: D \d\d:\d\d:\d\d\.\d+ GameState\.DebugPrintPower\(\) - +TAG_CHANGE/);
    expect(tagErr.text).toContain('\npacket: {"type":"TagChange"');
    expect(entries.some((e) => e.level === 'warn' && e.text.includes('1 log line did not parse') && e.text.includes('FULL_ENTITY - Creating garbage'))).toBe(true);

    // Tracking went on: same game result as the clean run.
    const end = ofType(events, 'gameEnd')[0];
    expect(end).toBeDefined();
    expect(end.record.placement).toBe(baseEnd.record.placement);
    expect(end.record.combats.length).toBe(baseEnd.record.combats.length);
    expect(end.record.combats.map((c) => c.result)).toEqual(baseEnd.record.combats.map((c) => c.result));
  });

  it('logs tracker events, phase changes and per-game counters', () => {
    configureLogger({ console: false });
    const entries: LogEntry[] = [];
    const off = onLogEntry((e) => entries.push(e));
    const tracker = new BgTracker({ now: () => 1_700_000_000_000 });
    const feed = new GameFeed({ label: 'demo', tracker, onState: () => undefined, onEvents: () => undefined, throttleMs: 0 });
    const lines = fixtureLines(FIXTURE);
    for (let i = 0; i < lines.length; i += 2000) feed.feed(lines.slice(i, i + 2000));
    off();
    const text = entries.filter((e) => e.scope === 'demo' && e.level === 'info').map((e) => e.text);
    const has = (re: RegExp) => expect(text.some((l) => re.test(l)), String(re)).toBe(true);
    has(/^game start \S+ · solo · GT_BATTLEGROUNDS/);
    has(/^hero options: /);
    has(/^hero chosen: /);
    has(/^turn 1$/);
    has(/^combat start t\d+ \(solo\): us .+ \[p\d\] tier \d hp \d+\+\d+, \d+ minions \d+\/\d+, hand \d+ vs /);
    has(/^combat end t\d+: (won \d+|lost \d+|tied) vs /);
    has(/^game end \S+: #\d with .+ after \d+ turns/);
    has(/^phase none -> \w+ · turn \d+/);
    has(/^phase \w+ -> combat · turn \d+ · line \d\d:\d\d:\d\d\.\d+ · (follows playback|GameState stream)/);
    has(/^tracker counters for game \S+: \d+ lines, 0 unparsed, 0 packet errors/);
  });
});
