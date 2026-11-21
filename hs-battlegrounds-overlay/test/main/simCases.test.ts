import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BattleSimInput } from '../../src/shared/types';
import { SimCaseLog, mergeSimCases, parseSimCases, simCaseKey, type SimCase } from '../../src/main/diagnostics/simCases';
import { simVerdict } from '../../src/main/diagnostics/describe';
import { sim } from './fixtures';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-simcases-'));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

const meta = () => ({ appVersion: '1.2.3', cardBuild: 4242, cardSource: 'bundled' });

function input(turn: number): BattleSimInput {
  const side = (playerId: number) => ({
    playerId,
    heroCardId: `HERO_${playerId}`,
    tavernTier: 3,
    health: 30,
    armor: 5,
    minions: [],
    hand: [],
    trinkets: [],
    questRewards: [],
    playerTags: {},
    heroTags: {},
  });
  return { turn, player: side(1), opponent: side(2), availableTribes: ['BEAST'], mode: 'solo' };
}

function kase(gameId: string, turn: number, extra: Partial<SimCase> = {}): SimCase {
  return {
    v: 1,
    key: simCaseKey(gameId, turn),
    gameId,
    turn,
    source: 'live',
    createdAt: `2026-11-07T10:00:${String(turn).padStart(2, '0')}.000Z`,
    updatedAt: `2026-11-07T10:00:${String(turn).padStart(2, '0')}.000Z`,
    appVersion: '1.0.0',
    cardBuild: 1,
    ...extra,
  };
}

const lines = (file: string) => parseSimCases(readFileSync(file, 'utf8'));

describe('mergeSimCases', () => {
  it('merges records of the same combat by key, later fields win, and computes the verdict', () => {
    const merged = mergeSimCases([
      kase('g1', 3, { input: input(3) }),
      kase('g1', 4, { input: input(4) }),
      kase('g1', 3, { result: sim(70), createdAt: '2026-11-07T11:00:00.000Z' }),
      kase('g1', 3, { actual: { result: 'lost', damage: 6 } }),
    ]);
    expect(merged.map((c) => c.key)).toEqual(['g1:3', 'g1:4']);
    const c = merged[0];
    expect(c.input?.turn).toBe(3);
    expect(c.result?.win).toBe(70);
    expect(c.actual).toEqual({ result: 'lost', damage: 6 });
    expect(c.createdAt).toBe('2026-11-07T10:00:03.000Z');
    expect(c.verdict).toEqual({ predicted: 'won', matched: false, actualChance: 30, surprise: false });
  });

  it('keeps the newest max cases', () => {
    const cases = Array.from({ length: 10 }, (_, i) => kase('g', i + 1));
    expect(mergeSimCases(cases, 4).map((c) => c.turn)).toEqual([7, 8, 9, 10]);
  });

  it('skips corrupt lines', () => {
    const text = `${JSON.stringify(kase('g', 1))}\n{"key":"g:2",\n\n${JSON.stringify(kase('g', 3))}\n`;
    expect(parseSimCases(text).map((c) => c.turn)).toEqual([1, 3]);
  });
});

describe('simVerdict', () => {
  it('compares the most likely outcome with the actual one and flags surprises', () => {
    expect(simVerdict({ win: 60, tie: 10, loss: 30 }, 'won')).toEqual({ predicted: 'won', matched: true, actualChance: 60, surprise: false });
    expect(simVerdict({ win: 1, tie: 2, loss: 97 }, 'won')).toMatchObject({ predicted: 'lost', matched: false, surprise: true });
    expect(simVerdict({ win: 20, tie: 50, loss: 30 }, 'tied').predicted).toBe('tied');
  });
});

describe('SimCaseLog', () => {
  it('writes one complete line once input, result and outcome are known', () => {
    const file = join(dir, 'sim-cases.jsonl');
    const log = new SimCaseLog({ file, meta });
    log.combatStart('g1', 5, input(5), 'live');
    log.simResult('g1', 5, sim(80));
    expect(log.written).toBe(0);
    const c = log.combatEnd('g1', 5, { result: 'won', damage: 7, opponentHeroCardId: 'HERO_2' });
    expect(c.verdict?.matched).toBe(true);
    const out = lines(file);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: 'g1:5',
      gameId: 'g1',
      turn: 5,
      appVersion: '1.2.3',
      cardBuild: 4242,
      cardSource: 'bundled',
      mode: 'solo',
      actual: { result: 'won', damage: 7, opponentHeroCardId: 'HERO_2' },
      verdict: { predicted: 'won', matched: true },
    });
    expect(out[0].input?.player.heroCardId).toBe('HERO_1');
    expect(out[0].result?.win).toBe(80);
  });

  it('waits a grace period for a late result, then writes what it has', () => {
    vi.useFakeTimers();
    const file = join(dir, 'sim-cases.jsonl');
    const log = new SimCaseLog({ file, meta, graceMs: 1000 });
    log.combatStart('g1', 2, input(2), 'live');
    log.combatEnd('g1', 2, { result: 'lost', damage: 3 });
    log.combatStart('g1', 3, input(3), 'live');
    log.combatEnd('g1', 3, { result: 'tied', damage: 0 });
    vi.advanceTimersByTime(500);
    log.simResult('g1', 2, sim(10)); // in time: written immediately, merged
    expect(lines(file).map((c) => c.key)).toEqual(['g1:2']);
    vi.advanceTimersByTime(600);
    const out = lines(file);
    expect(out.map((c) => c.key)).toEqual(['g1:2', 'g1:3']);
    expect(out[1].result).toBeUndefined();
    expect(out[0].verdict?.matched).toBe(true);
  });

  it('a result arriving after the case was written is appended and merged by trim()', () => {
    vi.useFakeTimers();
    const file = join(dir, 'sim-cases.jsonl');
    const log = new SimCaseLog({ file, meta, graceMs: 100 });
    log.combatStart('g1', 4, input(4), 'live');
    log.combatEnd('g1', 4, { result: 'won', damage: 5 });
    vi.advanceTimersByTime(200);
    log.simResult('g1', 4, sim(55));
    log.endGame('g1');
    vi.advanceTimersByTime(200);
    expect(lines(file)).toHaveLength(2);
    expect(log.trim()).toEqual({ before: 2, after: 1 });
    const [c] = lines(file);
    expect(c.input?.turn).toBe(4);
    expect(c.result?.win).toBe(55);
    expect(c.actual?.result).toBe('won');
    expect(c.verdict?.matched).toBe(true);
  });

  it('trim() keeps the last N combats', () => {
    const file = join(dir, 'sim-cases.jsonl');
    writeFileSync(file, '');
    for (let i = 1; i <= 30; i++) appendFileSync(file, JSON.stringify(kase('g', i)) + '\n');
    appendFileSync(file, 'garbage line\n');
    const log = new SimCaseLog({ file, meta, maxCases: 12 });
    expect(log.trim()).toEqual({ before: 30, after: 12 });
    expect(lines(file).map((c) => c.turn)).toEqual([19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it('trim() also caps the file size', () => {
    const file = join(dir, 'sim-cases.jsonl');
    const big = (i: number) => kase('g', i, { input: { ...input(i), availableTribes: Array(200).fill('BEAST') } });
    writeFileSync(file, Array.from({ length: 20 }, (_, i) => JSON.stringify(big(i + 1))).join('\n') + '\n');
    const one = Buffer.byteLength(JSON.stringify(big(20))) + 1;
    const log = new SimCaseLog({ file, meta, maxBytes: one * 5 + 10 });
    log.trim();
    expect(lines(file).map((c) => c.turn)).toEqual([16, 17, 18, 19, 20]);
  });

  it('snapshot() includes cases still being assembled, marked pending', () => {
    const file = join(dir, 'sim-cases.jsonl');
    const log = new SimCaseLog({ file, meta });
    log.combatStart('g1', 1, input(1), 'live');
    log.simResult('g1', 1, sim(50));
    log.combatEnd('g1', 1, { result: 'won', damage: 2 });
    log.combatStart('g1', 2, input(2), 'demo');
    const snap = parseSimCases(log.snapshot());
    expect(snap.map((c) => [c.key, !!c.pending, c.source])).toEqual([
      ['g1:1', false, 'live'],
      ['g1:2', true, 'demo'],
    ]);
    log.flushAll();
    expect(lines(file).map((c) => c.key)).toEqual(['g1:1', 'g1:2']);
  });
});
