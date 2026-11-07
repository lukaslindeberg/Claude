import { useEffect, useMemo, useState } from 'react';
import type { HeroStat, HeroStatsBundle, Tribe } from '@shared/types';
import { refreshHeroStats, useApp } from '../../store/appStore';
import { HeroPortrait } from '../../components/HeroPortrait';
import { HeroTierBadge } from '../../components/Bits';
import { SearchIcon } from '../../components/Icons';
import { DeltaBadge, SynergyChip } from '../../components/Synergy';
import { Tooltip } from '../../components/Tooltip';
import { compact, num } from '../../lib/format';
import { TIER_COLORS, tierFromAvg } from '../../lib/stats';
import { heroSynergy, tipFor, useLobbyTribes, type HeroSynergy } from '../../lib/synergy';
import { Empty, SectionHeader, Segmented } from '../ui';
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
  const grouped = useMemo(() => {
    const out = new Map<string, Row[]>();
    if (!bundle) return out;
    const toTier = tierScale(bundle.stats);
    for (const s of bundle.stats) {
      if (q && !db.name(s.heroCardId).toLowerCase().includes(q)) continue;
      const syn = heroSynergy(s, bundle.source, tribes, bundle.mode, 1);
      const value = syn.estimate?.avgPlacement ?? s.avgPlacement;
      const base = s.tier ?? (s.games >= 3 ? tierFromAvg(s.avgPlacement) : undefined);
      const tier: Row['tier'] = !base ? '?' : syn.estimate ? toTier(value) : base;
      const arr = out.get(tier) ?? [];
      arr.push({ stat: s, syn, value, tier });
      out.set(tier, arr);
    }
    for (const arr of out.values()) arr.sort((a, b) => a.value - b.value);
    return out;
  }, [bundle, q, db, tribes]);
  const ranked = tribes.length > 0;

  return (
    <div className="tl-section">
      <SectionHeader
        title="Heroes"
        subtitle={
          bundle
            ? `${bundle.label} · updated ${new Date(bundle.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}${ranked ? ' · ranked for the picked lobby' : ''}`
            : 'Hero tier list'
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
      ) : (
        <div className="tl-tierlist">
          {[...TIERS, '?'].map((t) => {
            const rows = grouped.get(t);
            if (!rows?.length) return null;
            const c = t === '?' ? '#6b7080' : TIER_COLORS[t as TierKey];
            return (
              <div key={t} className="tl-tierlist__row" style={{ '--c': c } as React.CSSProperties}>
                <div className="tl-tierlist__tier">
                  {t === '?' ? <span className="tl-tierlist__unranked">Too few games</span> : <HeroTierBadge tier={t as TierKey} size="lg" />}
                </div>
                <div className="tl-tierlist__heroes">
                  {rows.map((r) => (
                    <HeroTile key={r.stat.heroCardId} row={r} tribes={tribes} source={bundle.source} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HeroTile({ row, tribes, source }: { row: Row; tribes: Tribe[]; source: 'personal' | 'community' }) {
  const db = useApp((s) => s.cardDb);
  const { stat, syn } = row;
  const name = db.name(stat.heroCardId);
  const tip = tipFor(db, stat.heroCardId);
  // With a lobby: its biggest tribe effects. Without: the hero's best and worst tribe.
  const chips = syn.estimate
    ? [...syn.estimate.contributions].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3).map((c) => ({ ...c, games: stat.tribeStats?.find((t) => t.tribe === c.tribe)?.games ?? 0 }))
    : [...syn.best, ...syn.worst];
  const full = useMemo(() => heroSynergy(stat, source, tribes, undefined, 3), [stat, source, tribes]);
  return (
    <Tooltip
      as="div"
      placement="top"
      className="tl-herotile-anchor"
      content={() => (
        <div className="tl-tiptip">
          <div className="tl-cardtip__name">{name}</div>
          <div className="tl-tiptip__meta">
            Avg {num(stat.avgPlacement, 2)} · {stat.games.toLocaleString()} games
            {syn.estimate ? ` · this lobby ≈ ${num(syn.estimate.avgPlacement, 2)}` : ''}
          </div>
          {full.best.length || full.worst.length ? (
            <div className="tl-tiptip__syn">
              {full.best.length ? (
                <span>
                  <b>Best with</b> {full.best.map((t) => <SynergyChip key={t.tribe} syn={t} lobby={tribes} size={15} />)}
                </span>
              ) : null}
              {full.worst.length ? (
                <span>
                  <b>Worst with</b> {full.worst.map((t) => <SynergyChip key={t.tribe} syn={t} lobby={tribes} size={15} />)}
                </span>
              ) : null}
            </div>
          ) : null}
          {tip ? <p className="tl-tiptip__body">{tip.tip}</p> : null}
        </div>
      )}
    >
      <div className="tl-herotile">
        <HeroPortrait cardId={stat.heroCardId} size={46} />
        <span className="tl-herotile__name">
          {name}
          {tip ? <span className="tl-tipmark is-inline" title="Has a play tip" /> : null}
        </span>
        <span className="tl-herotile__stats">
          <b>{num(row.value, 2)}</b>
          {syn.delta !== undefined ? <DeltaBadge delta={syn.delta} /> : null}
          <span className="tl-muted">· {compact(stat.games)}</span>
        </span>
        {chips.length ? (
          <span className="tl-herotile__chips">
            {chips.map((c) => (
              <SynergyChip key={c.tribe} syn={c} lobby={tribes} size={14} />
            ))}
          </span>
        ) : null}
      </div>
    </Tooltip>
  );
}
