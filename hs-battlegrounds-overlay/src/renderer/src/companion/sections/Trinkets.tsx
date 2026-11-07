import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import type { Tribe } from '@shared/types';
import { refreshTrinketStats, useApp } from '../../store/appStore';
import { CardArt } from '../../components/CardArt';
import { CardTooltip } from '../../components/CardTooltip';
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

  const header = (key: SortKey, label: string, cls?: string) => (
    <th className={clsx(cls, sort.key === key && 'is-sorted')}>
      <button onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : 1 }))}>
        {label}
        {sort.key === key ? <ChevronIcon size={10} dir={sort.dir === 1 ? 'down' : 'up'} /> : null}
      </button>
    </th>
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
          <table className="tl-table tl-trinkettable">
            <thead>
              <tr>
                {header('name', 'Trinket', 'is-left')}
                {header('avg', 'Avg place')}
                {header('pick', 'Picked')}
                {header('games', 'Games')}
                {header('mine', 'You')}
                <th className="is-left">
                  <button disabled>Tribes</button>
                </th>
                <th className="is-left">
                  <button disabled>How to play it</button>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className={clsx(r.rel.status === 'missing' && 'is-warn')}>
                  <td className="is-left">
                    <Tooltip placement="right" tipClassName="tl-tooltip--card" content={() => <CardTooltip cardId={r.id} />}>
                      <span className="tl-trinketrow">
                        <span className="tl-trinketrow__art">
                          <CardArt cardId={r.id} name={r.name} initialsSize={11} />
                        </span>
                        <span className="tl-trinketrow__name">{r.name}</span>
                        {r.kind ? <span className={`tl-trinketkind is-${r.kind}`}>{r.kind}</span> : null}
                      </span>
                    </Tooltip>
                  </td>
                  <td>
                    {r.c ? (
                      <span className="tl-table__avg" style={{ color: placementColor(Math.round(r.c.avgPlacement)) }}>
                        {num(r.c.avgPlacement, 2)}
                      </span>
                    ) : (
                      <span className="tl-muted">—</span>
                    )}
                  </td>
                  <td>
                    {r.c?.pickRate !== undefined ? (
                      <span className="tl-table__bar">
                        <i style={{ width: `${Math.round(r.c.pickRate * 100)}%` }} />
                        <span>{Math.round(r.c.pickRate * 100)}%</span>
                      </span>
                    ) : (
                      <span className="tl-muted">—</span>
                    )}
                  </td>
                  <td className="tl-muted">{r.c ? compact(r.c.games) : '—'}</td>
                  <td>
                    {r.p ? (
                      <span>
                        <b>{num(r.p.avgPlacement, 1)}</b> <span className="tl-muted">×{r.p.games}</span>
                      </span>
                    ) : (
                      <span className="tl-muted">—</span>
                    )}
                  </td>
                  <td className="is-left">
                    {r.rel.status === 'none' ? <span className="tl-muted tl-small">Any lobby</span> : <RelevanceLine rel={r.rel} />}
                  </td>
                  <td className="is-left tl-trinkettable__tip">
                    {r.tip ? (
                      <Tooltip as="div" placement="left" content={r.tip.tip} disabled={r.tip.tip.length < 90}>
                        <span className="tl-trinkettable__tiptext">{r.tip.tip}</span>
                      </Tooltip>
                    ) : (
                      <span className="tl-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
