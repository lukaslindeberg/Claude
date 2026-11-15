/**
 * Calibration guard: replays the modern fixture logs and checks that no combat ended with a result the
 * simulator gave under 5% while reporting nothing as unsupported ("confidently wrong").
 */
import { describe, expect, it } from 'vitest';
import type { BattleSimInput, CombatRecord } from '@shared/types';
import { simulateBattle } from '../../src/core/sim';
import { runFixture } from '../core/helpers';

const FIXTURES = [
  'bg_duos_aberrations_deity_2026.power.log.gz',
  'bg_duos_trinkets_206605.power.log.gz',
  'bg_hero_reroll_213490.power.log.gz',
];
const MIN_PROBABILITY = 5;

interface Combat {
  input: BattleSimInput;
  record?: CombatRecord;
}

function combats(file: string): Combat[] {
  const out: Combat[] = [];
  let open: Combat | undefined;
  runFixture(file, (e) => {
    if (e.type === 'combatStart') {
      open = { input: e.input };
      out.push(open);
    } else if (e.type === 'combatEnd') {
      if (open) open.record = e.record;
      open = undefined;
    }
  });
  return out.filter((c) => c.record);
}

describe('simulator calibration on fixture games', () => {
  it.each(FIXTURES)('%s: no unflagged combat result below 5%%', (file) => {
    const all = combats(file);
    expect(all.length).toBeGreaterThan(0);
    const surprises: string[] = [];
    for (const c of all) {
      const r = simulateBattle(c.input, { iterations: 2000, maxDurationMs: 5000, seed: 7 });
      const p = c.record!.result === 'won' ? r.win : c.record!.result === 'lost' ? r.loss : r.tie;
      if (p < MIN_PROBABILITY && r.unsupported.length === 0) {
        surprises.push(`turn ${c.input.turn}: ${c.record!.result} at ${p.toFixed(1)}% (W ${r.win.toFixed(1)} / T ${r.tie.toFixed(1)} / L ${r.loss.toFixed(1)})`);
      }
    }
    expect(surprises).toEqual([]);
  });
});
