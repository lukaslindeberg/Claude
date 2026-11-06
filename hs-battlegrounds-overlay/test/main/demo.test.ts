import { describe, expect, it } from 'vitest';
import {
  DEMO_MAX_GAP_MS,
  buildDemoSchedule,
  demoDelayMs,
  parseLogTimestampMs,
  totalDemoDurationMs,
} from '../../src/main/demo';

describe('demo pacing', () => {
  it('parses log timestamps', () => {
    expect(parseLogTimestampMs('D 13:17:54.2795495 GameState.DebugPrintPower() - CREATE_GAME')).toBeCloseTo(
      ((13 * 60 + 17) * 60 + 54) * 1000 + 279.5495,
      3,
    );
    expect(parseLogTimestampMs('D 01:02:03 something')).toBe(3723000);
    expect(parseLogTimestampMs('garbage')).toBeUndefined();
  });

  it('divides gaps by speed and caps long pauses', () => {
    expect(demoDelayMs(1000, 1400, 4)).toBe(100);
    expect(demoDelayMs(0, 10_000, 4)).toBe(DEMO_MAX_GAP_MS / 4);
    expect(demoDelayMs(0, 10_000, 1, 2000)).toBe(2000);
    expect(demoDelayMs(500, 400, 4)).toBe(0); // clock went backwards
    expect(demoDelayMs(86_399_900, 100, 2)).toBe(100); // midnight wrap: 200 ms / 2
    expect(demoDelayMs(0, 400, 0)).toBe(100); // invalid speed -> default 4x
  });

  it('batches lines by timestamp group', () => {
    const lines = [
      'D 10:00:00.000 a',
      'D 10:00:00.000 b',
      'D 10:00:00.010 c', // +10 ms -> 2.5 ms at 4x (below min wait, merged)
      'D 10:00:01.000 d', // +990 ms -> 247.5 ms
      'continuation without timestamp',
      'D 10:00:30.000 e', // +29 s -> capped 300 ms
    ];
    const steps = buildDemoSchedule(lines, 4);
    expect(steps).toEqual([
      { end: 3, waitMs: 2.5 + 247.5 },
      { end: 5, waitMs: 300 },
      { end: 6, waitMs: 0 },
    ]);
    expect(totalDemoDurationMs(steps)).toBe(550);
    expect(buildDemoSchedule([], 4)).toEqual([{ end: 0, waitMs: 0 }]);
  });
});
