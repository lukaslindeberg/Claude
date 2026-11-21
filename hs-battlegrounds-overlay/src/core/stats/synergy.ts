import { LOBBY_TRIBES } from '@shared/types';
import type { Tribe, TribeSynergy } from '@shared/types';

/** Hearthstone Race enum value -> lobby tribe (as used by Firestone's `tribeStats[].tribe`). */
export const RACE_TO_TRIBE: Readonly<Record<number, Tribe>> = {
  11: 'UNDEAD',
  14: 'MURLOC',
  15: 'DEMON',
  17: 'MECHANICAL',
  18: 'ELEMENTAL',
  20: 'BEAST',
  23: 'PIRATE',
  24: 'DRAGON',
  43: 'QUILBOAR',
  92: 'NAGA',
  126: 'ABERRATION',
};

export function tribeFromRace(race: unknown): Tribe | undefined {
  return typeof race === 'number' ? RACE_TO_TRIBE[race] : undefined;
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

/** Best (most negative impact) first; ties in tribe order. */
export function sortSynergies(list: TribeSynergy[]): TribeSynergy[] {
  return list.sort((a, b) => a.impact - b.impact || LOBBY_TRIBES.indexOf(a.tribe) - LOBBY_TRIBES.indexOf(b.tribe));
}

/**
 * Per-tribe placement from individual games. Games whose lobby tribes are unknown (empty)
 * are ignored, and `impact` is relative to the average of the games with known tribes.
 */
export function tribeSynergyFromGames(games: readonly { placement: number; tribes: readonly Tribe[] }[]): TribeSynergy[] {
  const known = games.filter((g) => g.tribes.length > 0 && Number.isFinite(g.placement) && g.placement >= 1);
  if (!known.length) return [];
  const overall = known.reduce((a, g) => a + g.placement, 0) / known.length;
  const out: TribeSynergy[] = [];
  for (const tribe of LOBBY_TRIBES) {
    let n = 0;
    let sum = 0;
    for (const g of known) {
      if (g.tribes.includes(tribe)) {
        n++;
        sum += g.placement;
      }
    }
    if (!n) continue;
    const avg = sum / n;
    const s: TribeSynergy = { tribe, games: n, avgPlacement: round(avg), impact: round(avg - overall) };
    const nWithout = known.length - n;
    if (nWithout > 0) {
      const sumAll = known.reduce((a, g) => a + g.placement, 0);
      s.avgPlacementWithout = round((sumAll - sum) / nWithout);
    }
    out.push(s);
  }
  return sortSynergies(out);
}
