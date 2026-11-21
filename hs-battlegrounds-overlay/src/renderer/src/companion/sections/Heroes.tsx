import { useEffect, useMemo, useState } from 'react';
import type { HeroStat, HeroStatsBundle, Tribe } from '@shared/types';
import { refreshHeroStats, useApp } from '../../store/appStore';
import { HeroPortrait } from '../../components/HeroPortrait';
import { HeroTierBadge } from '../../components/Bits';
import { SearchIcon } from '../../components/Icons';
import { DeltaBadge, SynergyChip } from '../../components/Synergy';
import { compact, num } from '../../lib/format';
import { TIER_COLORS, summarize, tierFromAvg } from '../../lib/stats';
import { heroSynergy, tipFor, useLobbyTribes, type HeroSynergy } from '../../lib/synergy';
import { Card, Empty, SectionHeader, Segmented } from '../ui';
import { TribeFilter } from '../TribeFilter';

type TierKey = NonNullable<HeroStat['tier']>;
const TIERS: TierKey[] = ['S', 'A', 'B', 'C', 'D'];

interface Row {
  stat: HeroStat;
  syn: HeroSynergy;
  /** Placement used for ranking: the lobby estimate when tribes are picked. */
  value: number;
  tier: TierKey | '?';
}

/** Tier for a placement using the bundle's own tier boundaries (worst avg placement in each tier). */
function tierScale(stats: HeroStat[]): (v: number) => TierKey {
  const max = new Map<TierKey, number>();
  for (const s of stats) if (s.tier) max.set(s.tier, Math.max(max.get(s.tier) ?? -Infinity, s.avgPlacement));
  return (v) => TIERS.find((t) => max.has(t) && v <= max.get(t)!) ?? 'D';
}

export function Heroes() {
  const bundles = useApp((s) => s.heroStats);
  const history = useApp((s) => s.history);
  const db = useApp((s) => s.cardDb);
  const live = useLobbyTribes();
  const [source, setSource] = useState<HeroStatsBundle['source']>(() => (bundles.some((b) => b.source === 'community') ? 'community' : 'personal'));
  const [query, setQuery] = useState('');
  const [tribes, setTribes] = useState<Tribe[]>(() => live.tribes);

  useEffect(() => {
    void refreshHeroStats();
  }, [history.length]);

  const bundle = bundles.find((b) => b.source === source && (b.mode ?? 'solo') === 'solo') ?? bundles.find((b) => b.source === source) ?? bundles[0];
  const q = query.trim().toLowerCase();
  const ranked_ = useMemo<Row[]>(() => {
    const out = new Map<string, Row[]>();
    if (!bundle) return [] as Row[];
    const toTier = tierScale(bundle.stats);
    for (const s of bundle.stats) {
      if (q && !db.name(s.heroCardId).toLowerCase().includes(q)) continue;
      const syn = heroSynergy(s, bundle.source, tribes, bundle.mode, 2);
      const value = syn.estimate?.avgPlacement ?? s.avgPlacement;
      const base = s.tier ?? (s.games >= 3 ? tierFromAvg(s.avgPlacement) : undefined);
      const tier: Row['tier'] = !base ? '?' : syn.estimate ? toTier(value) : base;
      const arr = out.get(tier) ?? [];
      arr.push({ stat: s, syn, value, tier });
      out.set(tier, arr);
    }
    return [...out.values()].flat().sort((a, b) => Number(a.tier === '?') - Number(b.tier === '?') || a.value - b.value);
  }, [bundle, q, db, tribes]);
  const ranked = tribes.length > 0;

  return (
    <div className="tl-section">
      <SectionHeader
        title="Heroes"
        subtitle={
          bundle
            ? `${bundle.label} · updated ${new Date(bundle.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${ranked ? ' · ranked for the picked lobby' : ''}`
            : 'Hero ranking'
        }
        actions={
          <>
            <label className="tl-search">
              <SearchIcon size={13} />
              <input className="tl-input" placeholder="Find a hero…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            {bundles.length > 1 ? (
              <Segmented<HeroStatsBundle['source']>
                value={source}
                onChange={setSource}
                options={[...new Set(bundles.map((b) => b.source))].map((s) => ({ value: s, label: s === 'community' ? 'Community' : 'Your games' }))}
              />
            ) : null}
          </>
        }
      />
      <TribeFilter value={tribes} onChange={setTribes} label="Rank for a lobby with" />
      {!bundle || bundle.stats.length === 0 ? (
        <Empty title="No hero stats yet">Community stats can be enabled in Settings; your own stats appear after a few games.</Empty>
      ) : ranked_.length === 0 ? (
        <Empty title="Nothing matches">Try another search.</Empty>
      ) : (
        <Card pad={false}>
          <div className="tl-rank tl-rank--heroes">
            <div className="tl-rank__head">
              <span>#</span>
              <span className="is-left">Hero</span>
              <span>{ranked ? 'This lobby' : 'Avg place'}</span>
              <span>Top 4</span>
              <span>Games</span>
              <span>You</span>
              <span className="is-left">{ranked ? 'Lobby tribes' : 'Best / worst tribes'}</span>
            </div>
            {ranked_.map((r, i) => (
              <HeroRankRow key={r.stat.heroCardId} row={r} rank={i + 1} tribes={tribes} />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function HeroRankRow({ row, rank, tribes }: { row: Row; rank: number; tribes: Tribe[] }) {
  const db = useApp((s) => s.cardDb);
  const history = useApp((s) => s.history);
  const { stat, syn } = row;
  const name = db.name(stat.heroCardId);
  const tip = tipFor(db, stat.heroCardId);
  const mine = useMemo(() => summarize(history.filter((m) => (m.baseHeroCardId || m.heroCardId) === stat.heroCardId)), [history, stat.heroCardId]);
  // With a lobby: every picked tribe's effect. Without: the hero's best and worst tribes.
  const chips = syn.estimate
    ? syn.estimate.contributions.map((c) => ({ ...c, games: stat.tribeStats?.find((t) => t.tribe === c.tribe)?.games ?? 0 }))
    : [...syn.best, ...syn.worst];
  return (
    <div className="tl-rank__row">
      <span className="tl-rank__n">{rank}</span>
      <span className="tl-rank__who">
        <HeroTierBadge tier={row.tier === '?' ? undefined : row.tier} size="sm" />
        <HeroPortrait cardId={stat.heroCardId} size={40} />
        <span className="tl-rank__text">
          <span className="tl-rank__name">{name}</span>
          {tip ? (
            <span className="tl-rank__tip">
              <b>How to play</b>
              {tip.tip}
            </span>
          ) : null}
        </span>
      </span>
      <span className="tl-rank__value" style={{ '--c': row.tier === '?' ? '#a08d70' : TIER_COLORS[row.tier] } as React.CSSProperties}>
        <b>{num(row.value, 2)}</b>
        {syn.delta !== undefined ? <DeltaBadge delta={syn.delta} /> : null}
        {syn.estimate ? <small>{num(stat.avgPlacement, 2)} overall</small> : null}
      </span>
      <span>{stat.top4Rate !== undefined ? `${Math.round(stat.top4Rate)}%` : '—'}</span>
      <span className="tl-muted">{compact(stat.games)}</span>
      <span>
        {mine.games ? (
          <>
            <b>{num(mine.avgPlacement, 1)}</b> <span className="tl-muted">×{mine.games}</span>
          </>
        ) : (
          <span className="tl-muted">—</span>
        )}
      </span>
      <span className="tl-rank__chips">
        {chips.length ? chips.map((c) => <SynergyChip key={c.tribe} syn={c} lobby={tribes} size={15} />) : <span className="tl-muted">—</span>}
      </span>
    </div>
  );
}
