import type { GameMode, HeroStatsBundle, MatchRecord, TierTimingCurve } from '@shared/types';

/**
 * Tier-up timing: the turn on which strong games usually reach each tavern tier.
 *
 * Firestone's public hero-stats files (checked Nov 2026: `warbandStats`, `combatWinrate`,
 * `tribeStats`, `placementDistribution`) carry no tier timings, so the curve comes from
 * the user's own top-half games (top 4 solo, top 2 duos): the median turn each tier was
 * first reached. A tier is only part of the curve when enough of those games reached it,
 * so the curve never claims a typical turn the data doesn't back.
 */

/** Tiers the curve covers (tier 1 is where everyone starts). */
export const CURVE_TIERS = [2, 3, 4, 5, 6] as const;
/** Top-half games needed for a per-hero curve. */
export const MIN_HERO_CURVE_GAMES = 3;
/** Top-half games needed for the all-heroes curve. */
export const MIN_ALL_CURVE_GAMES = 5;
/** Games that reached a tier, needed for that tier to be on the curve. */
export const MIN_TIER_SAMPLES = 3;
/** Share of the games that must have reached a tier for it to be "usually reached". */
export const MIN_TIER_SHARE = 0.5;

/** Turn on which `tier` (or higher) was first reached, from a tier history. */
export function turnReached(history: readonly { tier: number; turn: number }[], tier: number): number | undefined {
  let best: number | undefined;
  for (const h of history) if (h.tier >= tier && (best === undefined || h.turn < best)) best = h.turn;
  return best;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const isTopHalf = (m: MatchRecord) => Number.isFinite(m.placement) && m.placement >= 1 && m.placement <= ((m.mode ?? 'solo') === 'duos' ? 2 : 4);

/**
 * Median tier-up turns over `matches`' top-half games of `mode`. Returns undefined when
 * there are fewer than `minGames` such games (with a tier history) or no tier qualifies.
 */
export function computeTierCurve(matches: readonly MatchRecord[], opts: { mode?: GameMode; minGames?: number; scope: TierTimingCurve['scope'] }): TierTimingCurve | undefined {
  const mode = opts.mode ?? 'solo';
  const minGames = opts.minGames ?? (opts.scope === 'hero' ? MIN_HERO_CURVE_GAMES : MIN_ALL_CURVE_GAMES);
  const games = matches.filter((m) => (m.mode ?? 'solo') === mode && isTopHalf(m) && m.tierHistory?.length);
  if (games.length < minGames) return undefined;
  const tiers: TierTimingCurve['tiers'] = [];
  for (const tier of CURVE_TIERS) {
    const turns = games.map((m) => turnReached(m.tierHistory, tier)).filter((t): t is number => t !== undefined && t >= 1);
    if (turns.length < MIN_TIER_SAMPLES || turns.length < games.length * MIN_TIER_SHARE) continue;
    tiers.push({ tier, turn: Math.round(median(turns) * 10) / 10, games: turns.length });
  }
  return tiers.length ? { tiers, games: games.length, scope: opts.scope, basis: 'personalTopHalf' } : undefined;
}

/** Per-hero curves (keyed by base hero id) plus the all-heroes curve, for one mode. */
export function tierCurves(
  matches: readonly MatchRecord[],
  mode: GameMode,
  baseId: (m: MatchRecord) => string = (m) => m.baseHeroCardId || m.heroCardId,
): { all?: TierTimingCurve; byHero: Map<string, TierTimingCurve> } {
  const groups = new Map<string, MatchRecord[]>();
  for (const m of matches) {
    if ((m.mode ?? 'solo') !== mode) continue;
    const id = baseId(m);
    if (!id) continue;
    let arr = groups.get(id);
    if (!arr) groups.set(id, (arr = []));
    arr.push(m);
  }
  const byHero = new Map<string, TierTimingCurve>();
  for (const [id, ms] of groups) {
    const c = computeTierCurve(ms, { mode, scope: 'hero' });
    if (c) byHero.set(id, c);
  }
  return { all: computeTierCurve(matches, { mode, scope: 'all' }), byHero };
}

/**
 * The curve to compare against for `heroId`: the hero's own curve from a personal bundle
 * of the game's mode, else that bundle's all-heroes curve.
 */
export function tierCurveFor(bundles: readonly HeroStatsBundle[], heroId: string, mode: GameMode = 'solo'): TierTimingCurve | undefined {
  const personal = bundles.filter((b) => b.source === 'personal' && (b.mode ?? 'solo') === mode);
  for (const b of personal) {
    const c = b.stats.find((s) => s.heroCardId === heroId)?.tierCurve;
    if (c) return c;
  }
  for (const b of personal) if (b.tierCurve) return b.tierCurve;
  return undefined;
}

export interface TierPace {
  /** Current tavern tier. */
  tier: number;
  /** Turns ahead of (> 0) or behind (< 0) the curve; 0 = on curve. */
  delta: number;
  /** Short label: "on curve", "1 turn behind", "2 turns ahead". */
  label: string;
}

/** Typical turn for `tier` on the curve, rounded to a whole turn. */
export function curveTurn(curve: TierTimingCurve, tier: number): number | undefined {
  const row = curve.tiers.find((t) => t.tier === tier);
  return row ? Math.round(row.turn) : undefined;
}

/**
 * Compares the current tier on shop turn `turn` with the curve.
 * - Behind: the next tier's typical turn has already passed (you could level on that turn,
 *   so being one tier lower *during* that turn is still on curve).
 * - Ahead: you already hold a tier the curve only reaches on a later turn.
 * Returns undefined when the curve has neither the current nor the next tier (no basis).
 */
export function tierPace(curve: TierTimingCurve | undefined, tier: number, turn: number): TierPace | undefined {
  if (!curve || turn < 1 || tier < 1) return undefined;
  const next = tier < 6 ? curveTurn(curve, tier + 1) : undefined;
  const cur = tier > 1 ? curveTurn(curve, tier) : undefined;
  if (next === undefined && cur === undefined) return undefined;
  let delta = 0;
  if (next !== undefined && turn > next) delta = next - turn;
  else if (cur !== undefined && cur > turn) delta = cur - turn;
  const n = Math.abs(delta);
  const label = delta === 0 ? 'on curve' : `${n} turn${n === 1 ? '' : 's'} ${delta < 0 ? 'behind' : 'ahead'}`;
  return { tier, delta, label };
}
