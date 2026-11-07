/**
 * Lobby-aware stats for the UI: which tribes are in this lobby (game state or the user's
 * own pick), hero estimates for those tribes, trinket stats and tribe relevance, play tips.
 */
import { useMemo } from 'react';
import {
  LOBBY_TRIBES,
  TRIBE_LABELS,
  type BgCard,
  type GameMode,
  type HeroStat,
  type HeroStatsBundle,
  type LobbyEstimate,
  type MatchRecord,
  type PlayTip,
  type Tribe,
  type TribeSynergy,
  type TrinketStat,
  type TrinketStatsBundle,
} from '@shared/types';
import { bestAndWorstTribes, lobbyEstimate } from '@core/stats/lobby';
import { getPlayTip } from '@core/cards/tips';
import type { CardDb } from '@core/cards/cardDb';
import { useApp } from '../store/appStore';

// ---------------------------------------------------------------------------
// Lobby tribes
// ---------------------------------------------------------------------------

export interface LobbyTribes {
  tribes: Tribe[];
  /** 'game' = from the log / inferred by the tracker, 'manual' = picked by the user. */
  source: 'game' | 'manual' | 'none';
  /** The tracker inferred them from shop offers (not listed by the log). */
  inferred: boolean;
}

/** Tribes of the current lobby: the tracker's once known, else the user's manual pick. */
export function useLobbyTribes(): LobbyTribes {
  const known = useApp((s) => s.game?.availableTribes);
  const inferred = useApp((s) => s.game?.tribesSource === 'inferred');
  const gameId = useApp((s) => s.game?.gameId);
  const picks = useApp((s) => (gameId ? s.lobbyPicks[gameId] : undefined));
  return useMemo(() => {
    if (known?.length) return { tribes: known, source: 'game', inferred };
    if (picks?.length) return { tribes: picks, source: 'manual', inferred: false };
    return { tribes: [], source: 'none', inferred: false };
  }, [known, picks, inferred]);
}

/** "Beasts", "Mechs", ... for sentences. */
export function tribePlural(t: Tribe): string {
  const label = TRIBE_LABELS[t];
  return t === 'ALL' ? 'all types' : `${label}s`;
}

export function joinTribes(tribes: Tribe[]): string {
  const names = tribes.map(tribePlural);
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Heroes
// ---------------------------------------------------------------------------

/** Community tribe rows below this many games are noise (Firestone has 1-game rows). */
export const COMMUNITY_MIN_TRIBE_GAMES = 100;
const PERSONAL_MIN_TRIBE_GAMES = 3;

export function minTribeGames(source: 'personal' | 'community'): number {
  return source === 'community' ? COMMUNITY_MIN_TRIBE_GAMES : PERSONAL_MIN_TRIBE_GAMES;
}

/** The best hero stat for `heroId`: community first, matching the game mode (absent = solo). */
export function heroStatFor(
  bundles: HeroStatsBundle[],
  heroId: string,
  opts: { mode?: GameMode; community?: boolean } = {},
): { stat: HeroStat; bundle: HeroStatsBundle } | undefined {
  const mode = opts.mode ?? 'solo';
  const allowed = bundles.filter((b) => (opts.community === false ? b.source === 'personal' : true));
  const rank = (b: HeroStatsBundle) => ((b.mode ?? 'solo') === mode ? 0 : 2) + (b.source === 'community' ? 0 : 1);
  for (const b of [...allowed].sort((a, b) => rank(a) - rank(b))) {
    const s = b.stats.find((x) => x.heroCardId === heroId);
    if (s && s.games > 0) return { stat: s, bundle: b };
  }
  return undefined;
}

export interface HeroSynergy {
  estimate?: LobbyEstimate;
  /** estimate - overall average (negative = better in this lobby). */
  delta?: number;
  best: TribeSynergy[];
  worst: TribeSynergy[];
}

export function heroSynergy(stat: HeroStat, source: 'personal' | 'community', lobby: Tribe[], mode: GameMode = 'solo', count = 2): HeroSynergy {
  const minGames = minTribeGames(source);
  const estimate = lobby.length ? lobbyEstimate(stat, lobby, { minGames, maxPlace: mode === 'duos' ? 4 : 8 }) : undefined;
  const { best, worst } = bestAndWorstTribes(stat, count, { minGames });
  return { estimate, delta: estimate ? estimate.avgPlacement - stat.avgPlacement : undefined, best, worst };
}

/** Personal record with a hero in lobbies that had each tribe. */
export function personalTribeRecord(history: MatchRecord[], heroId: string, tribes: Tribe[]): { tribe: Tribe; games: number; avg: number }[] {
  const games = history.filter((m) => (m.baseHeroCardId || m.heroCardId) === heroId && m.availableTribes?.length);
  return tribes
    .map((tribe) => {
      const with_ = games.filter((m) => m.availableTribes.includes(tribe));
      return { tribe, games: with_.length, avg: with_.reduce((a, m) => a + m.placement, 0) / Math.max(1, with_.length) };
    })
    .filter((r) => r.games > 0)
    .sort((a, b) => b.games - a.games || a.avg - b.avg);
}

/** Signed impact for chips: "−.09" / "+.15" (placements: negative is good). */
export function signedImpact(v: number, digits = 2): string {
  const s = Math.abs(v).toFixed(digits).replace(/^0(?=\.)/, '');
  return `${v < 0 ? '−' : '+'}${s}`;
}

export function signedDelta(v: number, digits = 2): string {
  return `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(digits)}`;
}

// ---------------------------------------------------------------------------
// Trinkets
// ---------------------------------------------------------------------------

export type TrinketKind = 'lesser' | 'greater';

/** Lesser / greater from the trinket's spell school (11 = lesser, 12 = greater trinket). */
export function trinketKind(card: BgCard | undefined): TrinketKind | undefined {
  const school = card?.tags?.SPELL_SCHOOL;
  return school === 11 ? 'lesser' : school === 12 ? 'greater' : undefined;
}

export function trinketStatFor(bundles: TrinketStatsBundle[], id: string, source: 'personal' | 'community'): TrinketStat | undefined {
  for (const b of bundles) {
    if (b.source !== source) continue;
    const s = b.stats.find((x) => x.trinketCardId === id);
    if (s && s.games > 0) return s;
  }
  return undefined;
}

/** Personal trinket stats from the match history (used when the main process has none). */
export function personalTrinketBundle(history: MatchRecord[]): TrinketStatsBundle {
  const groups = new Map<string, MatchRecord[]>();
  for (const m of history) for (const id of new Set(m.trinkets ?? [])) groups.set(id, [...(groups.get(id) ?? []), m]);
  const stats: TrinketStat[] = [...groups.entries()].map(([trinketCardId, ms]) => {
    const avg = ms.reduce((a, m) => a + m.placement, 0) / ms.length;
    const tribeStats: TribeSynergy[] = LOBBY_TRIBES.flatMap((tribe) => {
      const w = ms.filter((m) => m.availableTribes?.includes(tribe));
      if (!w.length) return [];
      const a = w.reduce((s, m) => s + m.placement, 0) / w.length;
      return [{ tribe, games: w.length, avgPlacement: a, impact: a - avg }];
    });
    return { trinketCardId, avgPlacement: avg, games: ms.length, tribeStats };
  });
  return { source: 'personal', label: 'Your games', updatedAt: new Date().toISOString(), stats };
}

/** Bundles to show: the bridge's, with a personal bundle derived from history if it sent none. */
export function useTrinketBundles(): TrinketStatsBundle[] {
  const bundles = useApp((s) => s.trinketStats);
  const history = useApp((s) => s.history);
  const community = useApp((s) => s.settings.communityStats);
  return useMemo(() => {
    const list = community ? bundles : bundles.filter((b) => b.source === 'personal');
    return list.some((b) => b.source === 'personal') ? list : [...list, personalTrinketBundle(history)];
  }, [bundles, history, community]);
}

const TRIBE_WORDS: [RegExp, Tribe][] = [
  [/\bBeasts?\b/, 'BEAST'],
  [/\bDemons?\b/, 'DEMON'],
  [/\bDragons?\b/, 'DRAGON'],
  [/\bElementals?\b/, 'ELEMENTAL'],
  [/\bMechs?\b/, 'MECHANICAL'],
  [/\bMurlocs?\b/, 'MURLOC'],
  [/\bNaga\b/, 'NAGA'],
  [/\bPirates?\b/, 'PIRATE'],
  [/\bQuilboar\b/, 'QUILBOAR'],
  [/\bUndead\b/, 'UNDEAD'],
  [/\bAberrations?\b/, 'ABERRATION'],
];

/**
 * Tribes a hero or trinket wants: its play tip's, the card data's `relatedTribes`, and
 * (when the card data predates that field) tribe names in the card text.
 */
export function wantedTribes(card: BgCard | undefined, tip?: PlayTip): Tribe[] {
  const out = new Set<Tribe>(tip?.wantsTribes ?? []);
  if (card?.relatedTribes) card.relatedTribes.forEach((t) => out.add(t));
  else if (card?.text) for (const [re, t] of TRIBE_WORDS) if (re.test(card.text)) out.add(t);
  out.delete('ALL');
  return [...out];
}

export interface TribeRelevance {
  wanted: Tribe[];
  present: Tribe[];
  missing: Tribe[];
  /** 'ok' some wanted tribe is in the lobby, 'missing' none is, 'unknown' lobby unknown, 'none' wants nothing. */
  status: 'ok' | 'missing' | 'unknown' | 'none';
}

export function tribeRelevance(wanted: Tribe[], lobby: Tribe[]): TribeRelevance {
  if (!wanted.length) return { wanted, present: [], missing: [], status: 'none' };
  if (!lobby.length) return { wanted, present: [], missing: [], status: 'unknown' };
  const present = wanted.filter((t) => lobby.includes(t));
  const missing = wanted.filter((t) => !lobby.includes(t));
  return { wanted, present, missing, status: present.length ? 'ok' : 'missing' };
}

// ---------------------------------------------------------------------------
// Play tips
// ---------------------------------------------------------------------------

/** Play tip for a card (skins and golden copies resolve to their base card). */
export function tipFor(db: CardDb, cardId: string | undefined): PlayTip | undefined {
  if (!cardId) return undefined;
  try {
    return getPlayTip(cardId) ?? getPlayTip(db.baseHeroId(cardId)) ?? getPlayTip(db.normalOf(cardId));
  } catch {
    return undefined;
  }
}
