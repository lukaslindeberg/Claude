import type { HeroStat, LobbyEstimate, Tribe, TribeSynergy } from '@shared/types';

/**
 * Expected placement of a hero in a lobby with the given tribes: the hero's overall
 * average plus the impact of each lobby tribe it has data for.
 *
 * Community data only has one-tribe-at-a-time breakdowns, so impacts are summed
 * (additive approximation) and the result is clamped to the valid placement range.
 * Returns undefined when the hero has no tribe data or no lobby tribe matches.
 */
export function lobbyEstimate(
  stat: Pick<HeroStat, 'avgPlacement' | 'tribeStats'>,
  lobbyTribes: readonly Tribe[],
  opts: { maxPlace?: number; minGames?: number } = {},
): LobbyEstimate | undefined {
  const maxPlace = opts.maxPlace ?? 8;
  const minGames = opts.minGames ?? 1;
  if (!stat.tribeStats?.length || !lobbyTribes.length) return undefined;
  const byTribe = new Map<Tribe, TribeSynergy>();
  for (const t of stat.tribeStats) if (t.games >= minGames) byTribe.set(t.tribe, t);
  const contributions = lobbyTribes
    .map((tribe) => byTribe.get(tribe))
    .filter((t): t is TribeSynergy => !!t)
    .map((t) => ({ tribe: t.tribe, impact: t.impact }))
    .sort((a, b) => a.impact - b.impact);
  if (!contributions.length) return undefined;
  const raw = stat.avgPlacement + contributions.reduce((sum, c) => sum + c.impact, 0);
  return {
    avgPlacement: Math.min(maxPlace, Math.max(1, raw)),
    tribes: contributions.map((c) => c.tribe),
    contributions,
  };
}

/** The tribes that help / hurt a hero most (by impact), for "best with / worst with" chips. */
export function bestAndWorstTribes(
  stat: Pick<HeroStat, 'tribeStats'>,
  count = 2,
  opts: { minGames?: number; minAbsImpact?: number } = {},
): { best: TribeSynergy[]; worst: TribeSynergy[] } {
  const minGames = opts.minGames ?? 1;
  const minAbs = opts.minAbsImpact ?? 0.05;
  const list = (stat.tribeStats ?? []).filter((t) => t.games >= minGames && Math.abs(t.impact) >= minAbs);
  const sorted = [...list].sort((a, b) => a.impact - b.impact);
  return {
    best: sorted.filter((t) => t.impact < 0).slice(0, count),
    worst: sorted.filter((t) => t.impact > 0).reverse().slice(0, count),
  };
}
