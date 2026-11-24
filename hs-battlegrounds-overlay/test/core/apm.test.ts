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
    // The log has 183 top-level PLAY/POWER blocks by the local player (buys, sells, rolls,
    // plays, levels, Activates) and 17 Discover picks in the shop (the 18th is the hero pick).
    expect(total).toBe(200);
    expect(apm.pastActions).toBe(total);
    for (const t of perTurn.values()) expect(t.ms).toBeGreaterThan(0);
    // Every finished shop phase is kept for the graph and saved with the match.
    expect(apm.history?.map((h) => h.turn)).toEqual([...perTurn.keys()].sort((a, b) => a - b));
    expect(tracker.getMatchRecord()?.apm?.length).toBe(perTurn.size);
    // Turn 1 is short: only a few actions.
    expect(perTurn.get(1)!.actions).toBeLessThan(6);
  });
});

describe('block nesting from indentation', () => {
  it('a BLOCK_START the game never closes does not stop the APM count', async () => {
    const { PowerLogParser } = await import('../../src/core/log/powerLogParser');
    const p = new PowerLogParser();
    const out: { type: string; level?: number }[] = [];
    const L = (s: string) => `D 12:00:00.0000000 GameState.DebugPrintPower() - ${s}`;
    for (const l of [
      L('BLOCK_START BlockType=PLAY Entity=[entityName=Victorious Geomant id=5 zone=PLAY zonePos=1 cardId=BG36_370 player=2] EffectCardId=System.Collections.Generic.List`1[System.String] EffectIndex=0 Target=0 SubOption=-1 '),
      L('    BLOCK_START BlockType=TRIGGER Entity=[entityName=X id=6 zone=PLAY zonePos=2 cardId=BG36_370 player=2] EffectCardId=System.Collections.Generic.List`1[System.String] EffectIndex=0 Target=0 SubOption=-1 '),
      L('    BLOCK_END'),
      // no BLOCK_END for the Geomant: the next action is top level again
      L('BLOCK_START BlockType=PLAY Entity=[entityName=Drag To Buy id=7 zone=PLAY zonePos=0 cardId=TB_BaconShop_DragBuy player=2] EffectCardId=System.Collections.Generic.List`1[System.String] EffectIndex=0 Target=0 SubOption=-1 '),
      L('BLOCK_END'),
    ])
      (p as unknown as { feedLine: (l: string, o: unknown[]) => void }).feedLine(l, out);
    expect(out.filter((x) => x.type === 'BlockStart' || x.type === 'BlockEnd').map((x) => `${x.type}:${x.level}`)).toEqual([
      'BlockStart:0',
      'BlockStart:1',
      'BlockEnd:1',
      'BlockStart:0',
      'BlockEnd:0',
    ]);
  });
});
