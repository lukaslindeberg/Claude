import type { BattleSimResult, HeroStat, HeroStatsBundle, MatchRecord } from '@shared/types';
import { isToday } from './format';

export interface Summary {
  games: number;
  avgPlacement: number;
  top4Rate: number;
  winRate: number;
  wins: number;
  avgFinalTier: number;
  avgTurns: number;
  /** count per placement, index 0 = 1st. */
  distribution: number[];
}

export function summarize(matches: MatchRecord[]): Summary {
  const distribution = new Array(8).fill(0);
  let sum = 0;
  let top4 = 0;
  let wins = 0;
  let tier = 0;
  let turns = 0;
  for (const m of matches) {
    const p = Math.min(8, Math.max(1, m.placement));
    distribution[p - 1]++;
    sum += p;
    const cut = m.mode === 'duos' ? 2 : 4;
    if (p <= cut) top4++;
    if (p === 1) wins++;
    tier += m.finalTier;
    turns += m.turns;
  }
  const n = matches.length;
  return {
    games: n,
    avgPlacement: n ? sum / n : NaN,
    top4Rate: n ? (top4 / n) * 100 : NaN,
    winRate: n ? (wins / n) * 100 : NaN,
    wins,
    avgFinalTier: n ? tier / n : NaN,
    avgTurns: n ? turns / n : NaN,
    distribution,
  };
}

export interface HeroRow extends Summary {
  heroCardId: string;
  heroName: string;
  lastPlayed: number;
}

export function perHero(matches: MatchRecord[]): HeroRow[] {
  const groups = new Map<string, MatchRecord[]>();
  for (const m of matches) {
    const id = m.baseHeroCardId || m.heroCardId;
    const arr = groups.get(id) ?? [];
    arr.push(m);
    groups.set(id, arr);
  }
  return [...groups.entries()].map(([heroCardId, ms]) => ({
    heroCardId,
    heroName: ms[0].heroName,
    lastPlayed: Math.max(...ms.map((m) => m.startedAt)),
    ...summarize(ms),
  }));
}

export function todays(matches: MatchRecord[]): MatchRecord[] {
  return matches.filter((m) => isToday(m.startedAt));
}

/** Newest first. */
export function sortByDate(matches: MatchRecord[]): MatchRecord[] {
  return [...matches].sort((a, b) => b.startedAt - a.startedAt);
}

export function tierFromAvg(avg: number): HeroStat['tier'] {
  if (avg <= 3.7) return 'S';
  if (avg <= 4.05) return 'A';
  if (avg <= 4.35) return 'B';
  if (avg <= 4.7) return 'C';
  return 'D';
}

export const TIER_COLORS: Record<NonNullable<HeroStat['tier']>, string> = {
  S: '#f2c14e',
  A: '#7fd88f',
  B: '#59b7e8',
  C: '#b48df0',
  D: '#d9786a',
};

/** Find the best stat for a hero across bundles, preferring community data. */
export function findHeroStat(
  bundles: HeroStatsBundle[],
  heroId: string,
  preferCommunity = true,
): { stat: HeroStat; bundle: HeroStatsBundle } | undefined {
  const ordered = [...bundles].sort((a, b) =>
    preferCommunity ? (a.source === 'community' ? -1 : 1) - (b.source === 'community' ? -1 : 1) : 0,
  );
  for (const b of ordered) {
    const s = b.stats.find((x) => x.heroCardId === heroId);
    if (s && s.games > 0) return { stat: s, bundle: b };
  }
  return undefined;
}

/** Personal hero stats bundle computed from match history. */
export function personalBundle(matches: MatchRecord[]): HeroStatsBundle {
  return {
    source: 'personal',
    label: 'Your games',
    updatedAt: new Date().toISOString(),
    stats: perHero(matches).map((r) => ({
      heroCardId: r.heroCardId,
      avgPlacement: r.avgPlacement,
      games: r.games,
      top4Rate: r.top4Rate,
      winRate: r.winRate,
      placementDistribution: r.distribution.map((c) => c / r.games),
      tier: r.games >= 3 ? tierFromAvg(r.avgPlacement) : undefined,
    })),
  };
}

export type Outcome = 'won' | 'lost' | 'tied';

export function predictedOutcome(r: BattleSimResult): Outcome {
  if (r.win >= r.loss && r.win >= r.tie) return 'won';
  if (r.loss >= r.win && r.loss >= r.tie) return 'lost';
  return 'tied';
}

export function outcomeLetter(o: Outcome): 'W' | 'L' | 'T' {
  return o === 'won' ? 'W' : o === 'lost' ? 'L' : 'T';
}
