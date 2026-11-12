import type { ReactNode } from 'react';
import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store/appStore';
import { HeroPortrait } from '../../components/HeroPortrait';
import { ChevronIcon } from '../../components/Icons';
import { formatDate, num, ordinal, placementColor } from '../../lib/format';
import { perHero, sortByDate, summarize, type HeroRow } from '../../lib/stats';
import { Card, Empty, Kpi, SectionHeader, Segmented } from '../ui';

type Range = 'all' | '7d' | 'today';
type SortKey = 'heroName' | 'games' | 'avgPlacement' | 'top4Rate' | 'wins' | 'lastPlayed';

export function Stats({ tabs }: { tabs?: ReactNode }) {
  const history = useApp((s) => s.history);
  const [range, setRange] = useState<Range>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'games', dir: -1 });

  const matches = useMemo(() => {
    const now = Date.now();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return history.filter((m) => (range === 'all' ? true : range === 'today' ? m.startedAt >= start.getTime() : m.startedAt >= now - 7 * 86_400_000));
  }, [history, range]);
  const s = useMemo(() => summarize(matches), [matches]);
  const rows = useMemo(() => {
    const r = perHero(matches);
    return r.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number);
      return cmp * sort.dir || b.games - a.games;
    });
  }, [matches, sort]);
  const recent = useMemo(() => sortByDate(matches).slice(0, 30).reverse(), [matches]);

  const header = (key: SortKey, label: string, cls?: string) => (
    <th className={clsx(cls, sort.key === key && 'is-sorted')}>
      <button onClick={() => setSort({ key, dir: sort.key === key ? ((-sort.dir) as 1 | -1) : key === 'heroName' || key === 'avgPlacement' ? 1 : -1 })}>
        {label}
        {sort.key === key ? <ChevronIcon size={10} dir={sort.dir === 1 ? 'up' : 'down'} /> : null}
      </button>
    </th>
  );

  return (
    <div className="tl-section">
      <SectionHeader
        title="Matches"
        subtitle="Your placements across recorded games."
        actions={
          <>
            {tabs}
          <Segmented<Range>
            value={range}
            onChange={setRange}
            options={[
              { value: 'all', label: 'All time' },
              { value: '7d', label: 'Last 7 days' },
              { value: 'today', label: 'Today' },
            ]}
          />
          </>
        }
      />
      {matches.length === 0 ? (
        <Empty title="No games in this range">Play a few games and your stats will show up here.</Empty>
      ) : (
        <>
          <div className="tl-kpis is-5">
            <Kpi label="Games" value={s.games} />
            <Kpi label="Avg placement" value={num(s.avgPlacement, 2)} tone="gold" />
            <Kpi label="Top 4" value={`${Math.round(s.top4Rate)}%`} tone={s.top4Rate >= 50 ? 'good' : 'bad'} />
            <Kpi label="Wins" value={s.wins} hint={`${Math.round(s.winRate)}% of games`} />
            <Kpi label="Avg final tier" value={num(s.avgFinalTier, 1)} hint={`${num(s.avgTurns, 1)} turns per game`} />
          </div>
          <div className="tl-stats__grid">
            <Card title="Placement distribution">
              <Distribution counts={s.distribution} />
            </Card>
            <Card title="Recent form" extra={<span className="tl-muted tl-small">last {recent.length} games · lower is better</span>}>
              <Form placements={recent.map((m) => m.placement)} />
            </Card>
          </div>
          <Card title="By hero" pad={false}>
            <table className="tl-table">
              <thead>
                <tr>
                  {header('heroName', 'Hero', 'is-left')}
                  {header('games', 'Games')}
                  {header('avgPlacement', 'Avg place')}
                  {header('top4Rate', 'Top 4')}
                  {header('wins', 'Wins')}
                  {header('lastPlayed', 'Last played', 'is-right')}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <HeroTableRow key={r.heroCardId} r={r} />
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

function HeroTableRow({ r }: { r: HeroRow }) {
  return (
    <tr>
      <td className="is-left">
        <span className="tl-table__hero">
          <HeroPortrait cardId={r.heroCardId} size={28} />
          {r.heroName}
        </span>
      </td>
      <td>{r.games}</td>
      <td>
        <span className="tl-table__avg" style={{ color: placementColor(Math.round(r.avgPlacement)) }}>
          {num(r.avgPlacement, 2)}
        </span>
      </td>
      <td>
        <span className="tl-table__bar">
          <i style={{ width: `${r.top4Rate}%` }} />
          <span>{Math.round(r.top4Rate)}%</span>
        </span>
      </td>
      <td>{r.wins}</td>
      <td className="is-right tl-muted">{formatDate(r.lastPlayed)}</td>
    </tr>
  );
}

/** Vertical bar chart: games per placement (1st..8th). */
function Distribution({ counts }: { counts: number[] }) {
  const max = Math.max(...counts, 1);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="tl-dist">
      {counts.map((c, i) => (
        <div key={i} className="tl-dist__col">
          <span className="tl-dist__val">{c}</span>
          <span className="tl-dist__track">
            <span className="tl-dist__bar" style={{ height: `${(c / max) * 100}%`, background: placementColor(i + 1) }} />
          </span>
          <span className="tl-dist__label">{ordinal(i + 1)}</span>
          <span className="tl-dist__pct">{Math.round((c / total) * 100)}%</span>
        </div>
      ))}
    </div>
  );
}

/** Placement over the last games (1 at top), with a rolling average line. */
function Form({ placements }: { placements: number[] }) {
  const W = 460;
  const H = 168;
  const padL = 26;
  const padR = 8;
  const padT = 10;
  const padB = 18;
  const n = placements.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (W - padL - padR));
  const y = (p: number) => padT + ((p - 1) / 7) * (H - padT - padB);
  const avg = placements.map((_, i) => {
    const w = placements.slice(Math.max(0, i - 4), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  return (
    <svg className="tl-form" viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
      <rect x={padL} y={y(1) - 4} width={W - padL - padR} height={y(4.5) - y(1) + 4} fill="rgba(92,196,122,0.06)" rx="4" />
      {[1, 4, 8].map((p) => (
        <g key={p}>
          <line x1={padL} x2={W - padR} y1={y(p)} y2={y(p)} stroke="rgba(255,255,255,0.07)" />
          <text x={padL - 8} y={y(p) + 3.5} textAnchor="end" className="tl-form__axis">
            {p}
          </text>
        </g>
      ))}
      <path d={avg.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')} fill="none" stroke="#f2c14e" strokeWidth="2" strokeLinejoin="round" opacity="0.85" />
      {placements.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p)} r="4" fill={placementColor(p)} stroke="#1a120a" strokeWidth="1.5">
          <title>{ordinal(p)}</title>
        </circle>
      ))}
      <text x={W - padR} y={H - 3} textAnchor="end" className="tl-form__axis">
        newest →
      </text>
    </svg>
  );
}
