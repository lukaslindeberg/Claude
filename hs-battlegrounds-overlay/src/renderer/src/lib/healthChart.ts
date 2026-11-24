import type { BgGameState, CombatRecord, MatchRecord } from '@shared/types';

/**
 * Data for the post-match health graph: your health (+armor) per turn, the other players
 * (Duos: teams) as faint lines, and the fights that cost you the most health.
 * Pure data shaping; the SVG lives in components/HealthChart.tsx.
 */

export interface HealthPoint {
  turn: number;
  value: number;
}

export interface HealthLine {
  key: string;
  /** Player (Duos: team) the line belongs to, for hover text. */
  label: string;
  points: HealthPoint[];
}

export interface HealthHit {
  turn: number;
  damage: number;
  opponentPlayerId: number;
  opponentHeroCardId: string;
  /** Your health after that fight (where the marker sits). */
  value: number;
}

export interface HealthChartData {
  mine: HealthPoint[];
  others: HealthLine[];
  hits: HealthHit[];
  minTurn: number;
  maxTurn: number;
  maxValue: number;
}

/** Fights marked on the graph. */
export const MAX_HITS = 3;

const sortPoints = (pts: readonly HealthPoint[]) =>
  pts.filter((p) => Number.isFinite(p.turn) && Number.isFinite(p.value)).slice().sort((a, b) => a.turn - b.turn);

/** Your health after `turn`: the last point at or before it. */
export function valueAt(points: readonly HealthPoint[], turn: number): number | undefined {
  let v: number | undefined;
  for (const p of points) if (p.turn <= turn) v = p.value;
  return v;
}

/**
 * The `count` lost fights that cost the most health (biggest first, earlier turn on ties).
 * Duplicate records of one turn (Duos: one fight logged against both opponents) count once.
 */
export function biggestHits(combats: readonly CombatRecord[], count = MAX_HITS): CombatRecord[] {
  const byTurn = new Map<number, CombatRecord>();
  for (const c of combats) {
    if (c.result !== 'lost' || !(c.damage > 0)) continue;
    const prev = byTurn.get(c.turn);
    if (!prev || c.damage > prev.damage) byTurn.set(c.turn, c);
  }
  return [...byTurn.values()].sort((a, b) => b.damage - a.damage || a.turn - b.turn).slice(0, count);
}

export function buildHealthChart(input: { mine: readonly HealthPoint[]; others?: readonly HealthLine[]; combats?: readonly CombatRecord[]; maxHits?: number }): HealthChartData | undefined {
  const mine = sortPoints(input.mine);
  if (mine.length < 2) return undefined;
  const others = (input.others ?? []).map((l) => ({ ...l, points: sortPoints(l.points) })).filter((l) => l.points.length >= 2);
  const hits: HealthHit[] = [];
  for (const c of biggestHits(input.combats ?? [], input.maxHits ?? MAX_HITS)) {
    const value = valueAt(mine, c.turn);
    if (value === undefined) continue;
    hits.push({ turn: c.turn, damage: c.damage, opponentPlayerId: c.opponentPlayerId, opponentHeroCardId: c.opponentHeroCardId, value });
  }
  const all = [mine, ...others.map((l) => l.points)].flat();
  return {
    mine,
    others,
    hits,
    minTurn: Math.min(...all.map((p) => p.turn)),
    maxTurn: Math.max(...all.map((p) => p.turn)),
    maxValue: Math.max(1, ...all.map((p) => p.value)),
  };
}

/**
 * From the live game: your line, one faint line per other player (Duos: per other team,
 * whose members share one health pool), and your lost fights from `combatsAgainst`.
 */
export function healthChartFromGame(game: Pick<BgGameState, 'players' | 'mode'>, nameOf: (p: BgGameState['players'][number]) => string = (p) => p.name?.split('#')[0] || p.heroName): HealthChartData | undefined {
  const local = game.players.find((p) => p.isLocal);
  if (!local) return undefined;
  const duos = game.mode === 'duos';
  const myTeam = duos ? local.teamId : undefined;
  const sameTeam = (p: (typeof game.players)[number]) => p.isLocal || p.isTeammate || (myTeam !== undefined && p.teamId === myTeam);
  const others: HealthLine[] = [];
  if (duos) {
    const teams = new Map<string, (typeof game.players)[number][]>();
    for (const p of game.players) {
      if (sameTeam(p)) continue;
      const key = p.teamId !== undefined ? `team-${p.teamId}` : `p-${p.playerId}`;
      teams.set(key, [...(teams.get(key) ?? []), p]);
    }
    for (const [key, ps] of teams) {
      const best = ps.reduce((a, b) => (b.healthHistory.length > a.healthHistory.length ? b : a));
      others.push({ key, label: ps.map(nameOf).join(' & '), points: best.healthHistory });
    }
  } else {
    for (const p of game.players) if (!p.isLocal) others.push({ key: `p-${p.playerId}`, label: nameOf(p), points: p.healthHistory });
  }
  const combats = game.players.filter((p) => !sameTeam(p)).flatMap((p) => p.combatsAgainst);
  return buildHealthChart({ mine: local.healthHistory, others, combats });
}

/** From a saved match: your line and your lost fights (other players' health isn't saved). */
export function healthChartFromRecord(m: Pick<MatchRecord, 'healthHistory' | 'combats'>): HealthChartData | undefined {
  return buildHealthChart({ mine: m.healthHistory, combats: m.combats });
}
