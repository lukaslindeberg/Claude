import { useEffect, useMemo, useState } from 'react';
import type { HeroStat, HeroStatsBundle } from '@shared/types';
import { refreshHeroStats, useApp } from '../../store/appStore';
import { HeroPortrait } from '../../components/HeroPortrait';
import { HeroTierBadge } from '../../components/Bits';
import { SearchIcon } from '../../components/Icons';
import { compact, num } from '../../lib/format';
import { TIER_COLORS, tierFromAvg } from '../../lib/stats';
import { Empty, SectionHeader, Segmented } from '../ui';

const TIERS: NonNullable<HeroStat['tier']>[] = ['S', 'A', 'B', 'C', 'D'];

export function Heroes() {
  const bundles = useApp((s) => s.heroStats);
  const history = useApp((s) => s.history);
  const db = useApp((s) => s.cardDb);
  const [source, setSource] = useState<HeroStatsBundle['source']>(() => (bundles.some((b) => b.source === 'community') ? 'community' : 'personal'));
  const [query, setQuery] = useState('');

  useEffect(() => {
    void refreshHeroStats();
  }, [history.length]);

  const bundle = bundles.find((b) => b.source === source) ?? bundles[0];
  const q = query.trim().toLowerCase();
  const grouped = useMemo(() => {
    const out = new Map<string, HeroStat[]>();
    for (const s of bundle?.stats ?? []) {
      if (q && !db.name(s.heroCardId).toLowerCase().includes(q)) continue;
      const tier = s.tier ?? (s.games >= 3 ? tierFromAvg(s.avgPlacement) : undefined) ?? '?';
      const arr = out.get(tier) ?? [];
      arr.push(s);
      out.set(tier, arr);
    }
    for (const arr of out.values()) arr.sort((a, b) => a.avgPlacement - b.avgPlacement);
    return out;
  }, [bundle, q, db]);

  return (
    <div className="tl-section">
      <SectionHeader
        title="Heroes"
        subtitle={bundle ? `${bundle.label} · updated ${new Date(bundle.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Hero tier list'}
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
                options={bundles.map((b) => ({ value: b.source, label: b.source === 'community' ? 'Community' : 'Your games' }))}
              />
            ) : null}
          </>
        }
      />
      {!bundle || bundle.stats.length === 0 ? (
        <Empty title="No hero stats yet">Community stats can be enabled in Settings; your own stats appear after a few games.</Empty>
      ) : (
        <div className="tl-tierlist">
          {[...TIERS, '?'].map((t) => {
            const stats = grouped.get(t);
            if (!stats?.length) return null;
            const c = t === '?' ? '#6b7080' : TIER_COLORS[t as keyof typeof TIER_COLORS];
            return (
              <div key={t} className="tl-tierlist__row" style={{ '--c': c } as React.CSSProperties}>
                <div className="tl-tierlist__tier">
                  {t === '?' ? <span className="tl-tierlist__unranked">Too few games</span> : <HeroTierBadge tier={t as HeroStat['tier']} size="lg" />}
                </div>
                <div className="tl-tierlist__heroes">
                  {stats.map((s) => (
                    <div key={s.heroCardId} className="tl-herotile" title={`${db.name(s.heroCardId)} · ${s.games} games`}>
                      <HeroPortrait cardId={s.heroCardId} size={46} />
                      <span className="tl-herotile__name">{db.name(s.heroCardId)}</span>
                      <span className="tl-herotile__stats">
                        <b>{num(s.avgPlacement, 2)}</b>
                        <span className="tl-muted">· {compact(s.games)}</span>
                      </span>
                    </div>
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
