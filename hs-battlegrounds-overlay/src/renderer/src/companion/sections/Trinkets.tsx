import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Tribe } from '@shared/types';
import { refreshTrinketStats, useApp } from '../../store/appStore';
import { GameCard } from '../../components/GameCard';
import { ChevronIcon, SearchIcon } from '../../components/Icons';
import { RelevanceLine } from '../../components/Synergy';
import { Toggle } from '../../components/Bits';
import { Tooltip } from '../../components/Tooltip';
import { compact, num, placementColor } from '../../lib/format';
import { tipFor, trinketKind, tribeRelevance, useLobbyTribes, useTrinketBundles, wantedTribes, type TrinketKind } from '../../lib/synergy';
import { Card, Empty, SectionHeader, Segmented } from '../ui';
import { TribeFilter } from '../TribeFilter';

type SortKey = 'name' | 'avg' | 'pick' | 'games' | 'mine';
type KindFilter = 'all' | TrinketKind;

export function Trinkets() {
  const db = useApp((s) => s.cardDb);
  const history = useApp((s) => s.history);
  const bundles = useTrinketBundles();
  const live = useLobbyTribes();
  const [kind, setKind] = useState<KindFilter>('all');
  const [tribes, setTribes] = useState<Tribe[]>(() => live.tribes);
  const [tribeOnly, setTribeOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'avg', dir: 1 });

  useEffect(() => {
    void refreshTrinketStats();
  }, [history.length]);

  const community = bundles.find((b) => b.source === 'community');
  const personal = bundles.find((b) => b.source === 'personal');
  const rows = useMemo(() => {
    const ids = new Set([...(community?.stats ?? []), ...(personal?.stats ?? [])].map((s) => s.trinketCardId));
    const q = query.trim().toLowerCase();
    return [...ids].flatMap((id) => {
      const card = db.get(id);
      const name = card?.name ?? id;
      const k = trinketKind(card);
      if (kind !== 'all' && k !== kind) return [];
      if (q && !name.toLowerCase().includes(q) && !(card?.text ?? '').toLowerCase().includes(q)) return [];
      const tip = tipFor(db, id);
      const wanted = wantedTribes(card, tip);
      const rel = tribeRelevance(wanted, tribes);
      // With tribes picked: hide trinkets for tribes that are missing (or, "tribe trinkets
      // only", everything that does not want one of the picked tribes).
      if (tribes.length && (tribeOnly ? rel.status !== 'ok' : rel.status === 'missing')) return [];
      const c = community?.stats.find((s) => s.trinketCardId === id);
      const p = personal?.stats.find((s) => s.trinketCardId === id);
      return [{ id, name, kind: k, tip, rel, c, p }];
    });
  }, [community, personal, db, kind, query, tribes, tribeOnly]);

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]): number | string => {
      switch (sort.key) {
        case 'name':
          return r.name;
        case 'avg':
          return r.c?.avgPlacement ?? 99;
        case 'pick':
          return -(r.c?.pickRate ?? -1);
        case 'games':
          return -(r.c?.games ?? -1);
        case 'mine':
          return r.p?.avgPlacement ?? 99;
      }
    };
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * sort.dir;
    });
  }, [rows, sort]);

  const head = (key: SortKey, label: string, cls?: string) => (
    <button className={clsx(cls, sort.key === key && 'is-sorted')} onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}>
      {label}
      {sort.key === key ? <ChevronIcon size={10} dir={sort.dir === 1 ? 'down' : 'up'} /> : null}
    </button>
  );

  return (
    <div className="tl-section">
      <SectionHeader
        title="Trinkets"
        subtitle={community ? `${community.label} · updated ${new Date(community.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Your trinket picks'}
        actions={
          <label className="tl-search">
            <SearchIcon size={13} />
            <input className="tl-input" placeholder="Search name or text…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
        }
      />
      <div className="tl-toolbar">
        <Segmented<KindFilter>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'All' },
            { value: 'lesser', label: 'Lesser' },
            { value: 'greater', label: 'Greater' },
          ]}
        />
        <Toggle checked={tribeOnly} onChange={setTribeOnly} label="Tribe trinkets only" disabled={!tribes.length} />
        <span className="tl-muted tl-toolbar__count">{sorted.length} trinkets</span>
      </div>
      <TribeFilter value={tribes} onChange={setTribes} />
      {sorted.length === 0 ? (
        <Empty title={rows.length || community || personal?.stats.length ? 'Nothing matches' : 'No trinket stats yet'}>
          {community || personal?.stats.length ? 'Try another type, tribe or search.' : 'Community stats can be enabled in Settings; your own appear after games with trinkets.'}
        </Empty>
      ) : (
        <Card pad={false}>
          <div className="tl-rank tl-rank--trinkets">
            <div className="tl-rank__head">
              <span>#</span>
              {head('name', 'Trinket', 'is-left')}
              {head('avg', 'Avg place')}
              {head('pick', 'Picked')}
              {head('games', 'Games')}
              {head('mine', 'You')}
              <span className="is-left">Tribes</span>
            </div>
            {sorted.map((r, i) => (
              <div key={r.id} className={clsx('tl-rank__row', r.rel.status === 'missing' && 'is-warn')}>
                <span className="tl-rank__n">{i + 1}</span>
                <span className="tl-rank__who">
                  <Tooltip placement="right" tipClassName="tl-tooltip--card" content={() => <GameCard cardId={r.id} width={210} />}>
                    <GameCard cardId={r.id} width={44} className="tl-rank__card" />
                  </Tooltip>
                  <span className="tl-rank__text">
                    <span className="tl-rank__name">
                      {r.name}
                      {r.kind ? <span className={`tl-trinketkind is-${r.kind}`}>{r.kind}</span> : null}
                    </span>
                    {r.tip ? (
                      <span className="tl-rank__tip">
                        <b>How to play</b>
                        {r.tip.tip}
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="tl-rank__value" style={{ '--c': r.c ? placementColor(Math.round(r.c.avgPlacement)) : '#a08d70' } as React.CSSProperties}>
                  <b>{r.c ? num(r.c.avgPlacement, 2) : '—'}</b>
                </span>
                <span>{r.c?.pickRate !== undefined ? `${Math.round(r.c.pickRate * 100)}%` : '—'}</span>
                <span className="tl-muted">{r.c ? compact(r.c.games) : '—'}</span>
                <span>
                  {r.p ? (
                    <>
                      <b>{num(r.p.avgPlacement, 1)}</b> <span className="tl-muted">×{r.p.games}</span>
                    </>
                  ) : (
                    <span className="tl-muted">—</span>
                  )}
                </span>
                <span className="tl-rank__chips">{r.rel.status === 'none' ? <span className="tl-muted tl-small">Any lobby</span> : <RelevanceLine rel={r.rel} />}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
