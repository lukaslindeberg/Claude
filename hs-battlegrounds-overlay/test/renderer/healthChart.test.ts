import { describe, expect, it } from 'vitest';
import type { CombatRecord, PlayerState } from '../../src/shared/types';
import { biggestHits, buildHealthChart, healthChartFromGame, healthChartFromRecord, valueAt } from '../../src/renderer/src/lib/healthChart';
import { match } from '../main/fixtures';

const combat = (turn: number, result: CombatRecord['result'], damage: number, opponentPlayerId = 2): CombatRecord => ({ turn, result, damage, opponentPlayerId, opponentHeroCardId: `H${opponentPlayerId}` });

function player(partial: Partial<PlayerState>): PlayerState {
  return {
    playerId: 1,
    heroEntityId: 1,
    heroCardId: 'H',
    heroName: 'Hero',
    isLocal: false,
    health: 30,
    maxHealth: 30,
    armor: 0,
    tavernTier: 3,
    triples: 0,
    leaderboardPlace: 1,
    dead: false,
    isNextOpponent: false,
    tierHistory: [],
    combatsAgainst: [],
    healthHistory: [],
    ...partial,
  };
}

describe('health chart data', () => {
  it('valueAt takes the last point at or before the turn', () => {
    const pts = [
      { turn: 1, value: 40 },
      { turn: 3, value: 34 },
    ];
    expect(valueAt(pts, 0)).toBeUndefined();
    expect(valueAt(pts, 2)).toBe(40);
    expect(valueAt(pts, 5)).toBe(34);
  });

  it('marks the lost fights that cost the most, once per turn', () => {
    const hits = biggestHits([combat(3, 'won', 9), combat(4, 'lost', 3), combat(6, 'lost', 8), combat(6, 'lost', 8, 5), combat(7, 'lost', 8), combat(9, 'lost', 12), combat(10, 'tied', 0)]);
    expect(hits.map((h) => [h.turn, h.damage])).toEqual([
      [9, 12],
      [6, 8],
      [7, 8],
    ]);
  });

  it('builds the chart and places markers on your line', () => {
    const d = buildHealthChart({
      mine: [
        { turn: 2, value: 40 },
        { turn: 1, value: 40 },
        { turn: 3, value: 33 },
      ],
      others: [{ key: 'x', label: 'X', points: [{ turn: 1, value: 45 }, { turn: 4, value: 20 }] }, { key: 'y', label: 'Y', points: [{ turn: 1, value: 30 }] }],
      combats: [combat(3, 'lost', 7)],
    })!;
    expect(d.mine.map((p) => p.turn)).toEqual([1, 2, 3]);
    expect(d.others.map((l) => l.key)).toEqual(['x']); // single-point lines dropped
    expect(d.hits).toEqual([{ turn: 3, damage: 7, opponentPlayerId: 2, opponentHeroCardId: 'H2', value: 33 }]);
    expect([d.minTurn, d.maxTurn, d.maxValue]).toEqual([1, 4, 45]);
    expect(buildHealthChart({ mine: [{ turn: 1, value: 30 }] })).toBeUndefined();
  });

  it('from a live solo game: one faint line per opponent, hits from combatsAgainst', () => {
    const d = healthChartFromGame({
      mode: 'solo',
      players: [
        player({ playerId: 1, isLocal: true, healthHistory: [{ turn: 1, value: 40 }, { turn: 2, value: 35 }] }),
        player({ playerId: 2, name: 'Bob#1', healthHistory: [{ turn: 1, value: 30 }, { turn: 2, value: 30 }], combatsAgainst: [combat(2, 'lost', 5, 2)] }),
        player({ playerId: 3, healthHistory: [{ turn: 1, value: 30 }, { turn: 2, value: 22 }] }),
      ],
    })!;
    expect(d.others.map((l) => l.label)).toEqual(['Bob', 'Hero']);
    expect(d.hits).toHaveLength(1);
    expect(d.hits[0]).toMatchObject({ turn: 2, damage: 5, value: 35 });
  });

  it('in Duos: one line per other team, not per player, and no teammate line', () => {
    const team = (teamId: number, v: number) => [{ turn: 1, value: v }, { turn: 2, value: v - 5 }];
    const d = healthChartFromGame({
      mode: 'duos',
      players: [
        player({ playerId: 1, isLocal: true, teamId: 1, healthHistory: team(1, 50) }),
        player({ playerId: 2, isTeammate: true, teamId: 1, healthHistory: team(1, 50) }),
        player({ playerId: 3, teamId: 2, heroName: 'A', healthHistory: team(2, 45), combatsAgainst: [combat(2, 'lost', 5, 3)] }),
        player({ playerId: 4, teamId: 2, heroName: 'B', healthHistory: team(2, 45), combatsAgainst: [combat(2, 'lost', 5, 4)] }),
      ],
    })!;
    expect(d.others.map((l) => l.label)).toEqual(['A & B']);
    expect(d.hits).toHaveLength(1);
  });

  it('from a saved match: your line and your hits', () => {
    const d = healthChartFromRecord(
      match({
        healthHistory: [
          { turn: 1, value: 30 },
          { turn: 2, value: 24 },
        ],
        combats: [combat(2, 'lost', 6)],
      }),
    )!;
    expect(d.others).toEqual([]);
    expect(d.hits[0]).toMatchObject({ turn: 2, value: 24 });
  });
});
