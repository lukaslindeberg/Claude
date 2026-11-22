import { describe, expect, it } from 'vitest';
import { BgTracker } from '../../src/core/bg';
import { fixtureLines } from './helpers';

describe('APM counter', () => {
  it("counts the local player's shop actions per turn and their shop time", () => {
    const lines = fixtureLines('bg_duos_aberrations_deity_2026.power.log.gz');
    const tracker = new BgTracker({ now: () => 1 });
    const perTurn = new Map<number, { actions: number; ms: number }>();
    for (const l of lines) {
      if (!tracker.feedLines([l]).some((e) => e.type === 'combatStart')) continue;
      const last = tracker.getState().apm?.last;
      if (last) perTurn.set(last.turn, { actions: last.actions, ms: last.ms });
    }
    const apm = tracker.getState().apm!;
    expect(perTurn.size).toBeGreaterThan(5);
    const total = [...perTurn.values()].reduce((a, t) => a + t.actions, 0);
    // The log has ~140 top-level shop actions by the local player (buys, sells, rolls, plays, levels).
    expect(total).toBeGreaterThan(100);
    expect(total).toBeLessThan(200);
    expect(apm.pastActions).toBe(total);
    for (const t of perTurn.values()) expect(t.ms).toBeGreaterThan(0);
    // Turn 1 is short: only a few actions.
    expect(perTurn.get(1)!.actions).toBeLessThan(6);
  });
});
