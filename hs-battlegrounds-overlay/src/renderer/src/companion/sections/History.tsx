import { useMemo, useState } from 'react';
import clsx from 'clsx';
import type { MatchRecord } from '@shared/types';
import { useApp } from '../../store/appStore';
import { HeroPortrait } from '../../components/HeroPortrait';
import { MinionToken } from '../../components/MinionToken';
import { PlacementBadge, ResultChip, Sparkline, TierTimeline, TribeChip } from '../../components/Bits';
import { CheckIcon, ChevronIcon, CrossIcon, SearchIcon } from '../../components/Icons';
import { duration, formatDate, ordinal, placementColor } from '../../lib/format';
import { predictedOutcome, sortByDate } from '../../lib/stats';
import { Card, Empty, SectionHeader, Segmented } from '../ui';

type ResultFilter = 'all' | 'wins' | 'top4' | 'bottom4';
type ModeFilter = 'all' | 'solo' | 'duos';

export function History() {
  const history = useApp((s) => s.history);
  const bridge = useApp((s) => s.bridge);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<ResultFilter>('all');
  const [mode, setMode] = useState<ModeFilter>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortByDate(history).filter((m) => {
      if (q && !m.heroName.toLowerCase().includes(q)) return false;
      if (mode !== 'all' && m.mode !== mode) return false;
      const cut = m.mode === 'duos' ? 2 : 4;
      if (result === 'wins' && m.placement !== 1) return false;
      if (result === 'top4' && m.placement > cut) return false;
      if (result === 'bottom4' && m.placement <= cut) return false;
      return true;
    });
  }, [history, query, result, mode]);

  const clear = async () => {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setConfirm(false);
    await bridge?.clearHistory();
  };

  return (
    <div className="tl-section">
      <SectionHeader
        title="Match history"
        subtitle={`${history.length} game${history.length === 1 ? '' : 's'} recorded on this computer`}
        actions={
          <button className={clsx('tl-btn tl-btn--danger', confirm && 'is-armed')} onClick={clear} disabled={!history.length}>
            {confirm ? 'Click again to clear everything' : 'Clear history'}
          </button>
        }
      />
      <div className="tl-toolbar">
        <label className="tl-search tl-toolbar__search">
          <SearchIcon size={13} />
          <input className="tl-input" placeholder="Filter by hero…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <Segmented<ResultFilter>
          value={result}
          onChange={setResult}
          options={[
            { value: 'all', label: 'All' },
            { value: 'wins', label: 'Wins' },
            { value: 'top4', label: 'Top 4' },
            { value: 'bottom4', label: 'Bottom 4' },
          ]}
        />
        <Segmented<ModeFilter>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'all', label: 'Any mode' },
            { value: 'solo', label: 'Solo' },
            { value: 'duos', label: 'Duos' },
          ]}
        />
        <span className="tl-muted tl-toolbar__count">{list.length} shown</span>
      </div>
      {list.length === 0 ? (
        <Empty title={history.length ? 'No games match these filters' : 'No games yet'}>
          {history.length ? 'Try clearing the filters.' : 'Finished Battlegrounds games appear here automatically.'}
        </Empty>
      ) : (
        <div className="tl-hist">
          {list.map((m) => (
            <MatchRow key={m.id} m={m} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchRow({ m, open, onToggle }: { m: MatchRecord; open: boolean; onToggle: () => void }) {
  const delta = m.ratingAfter !== undefined && m.ratingBefore !== undefined ? m.ratingAfter - m.ratingBefore : undefined;
  return (
    <div className={clsx('tl-hist__item', open && 'is-open')} style={{ '--c': placementColor(m.placement, m.mode === 'duos') } as React.CSSProperties}>
      <button className="tl-hist__row" onClick={onToggle}>
        <PlacementBadge place={m.placement} size="md" duos={m.mode === 'duos'} />
        <HeroPortrait cardId={m.heroCardId} name={m.heroName} size={40} />
        <span className="tl-hist__hero">
          <span className="tl-hist__name">{m.heroName}</span>
          <span className="tl-hist__meta">
            {formatDate(m.startedAt)} · {m.turns} turns · {duration(m.endedAt - m.startedAt)}
            {m.mode === 'duos' ? ' · Duos' : ''}
          </span>
        </span>
        <span className="tl-hist__board">
          {m.finalBoard.slice(0, 7).map((x) => (
            <MinionToken key={x.entityId} minion={x} size="xs" tooltip={false} />
          ))}
        </span>
        <span className="tl-hist__tiers">
          <TierTimeline history={m.tierHistory} compact />
        </span>
        <span className={clsx('tl-hist__delta', delta !== undefined && (delta >= 0 ? 'tl-up' : 'tl-down'))}>
          {delta !== undefined ? `${delta >= 0 ? '+' : ''}${delta}` : ''}
        </span>
        <ChevronIcon size={14} dir={open ? 'up' : 'down'} className="tl-hist__chev" />
      </button>
      {open ? <MatchDetail m={m} /> : null}
    </div>
  );
}

function MatchDetail({ m }: { m: MatchRecord }) {
  const db = useApp((s) => s.cardDb);
  const anomaly = db.get(m.anomalyCardId);
  const lobby = [...m.lobby].sort((a, b) => a.place - b.place);
  const predicted = m.combats.filter((c) => c.prediction);
  const correct = predicted.filter((c) => predictedOutcome(c.prediction!) === c.result).length;
  return (
    <div className="tl-hist__detail">
      <div className="tl-hist__detail-main">
        <Card title="Final board" pad>
          <div className="tl-hist__fullboard">
            {m.finalBoard.map((x) => (
              <MinionToken key={x.entityId} minion={x} size="md" showName />
            ))}
          </div>
        </Card>
        <Card
          title="Combats"
          extra={predicted.length ? <span className="tl-muted tl-small">Simulator called {correct}/{predicted.length}</span> : null}
        >
          <div className="tl-hist__combats">
            {m.combats.map((c) => {
              const ok = c.prediction ? predictedOutcome(c.prediction) === c.result : undefined;
              return (
                <div key={c.turn} className="tl-hist__combat" title={c.prediction ? `Predicted ${c.prediction.win.toFixed(0)}% win` : 'No prediction'}>
                  <span className="tl-muted">T{c.turn}</span>
                  <ResultChip result={c.result} damage={c.damage} size="sm" />
                  <span className="tl-hist__pred">
                    {ok === undefined ? <span className="tl-muted">·</span> : ok ? <CheckIcon size={10} className="tl-up" /> : <CrossIcon size={9} className="tl-down" />}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
      <div className="tl-hist__detail-side">
        <Card title="Lobby">
          <div className="tl-hist__lobby">
            {lobby.map((p) => (
              <div key={p.playerId} className={clsx('tl-hist__lobbyrow', p.heroCardId === m.heroCardId && p.place === m.placement && 'is-me')}>
                <span className="tl-hist__lobbyplace" style={{ color: placementColor(p.place) }}>
                  {ordinal(p.place)}
                </span>
                <HeroPortrait cardId={p.heroCardId} size={22} />
                <span className="tl-hist__lobbyname">{db.name(p.heroCardId)}</span>
                <span className="tl-muted tl-small">{p.name?.split('#')[0]}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Game">
          <div className="tl-hist__facts">
            <div>
              <span className="tl-label">Tiers</span>
              <TierTimeline history={m.tierHistory} compact />
            </div>
            <div>
              <span className="tl-label">Health</span>
              <Sparkline points={m.healthHistory} width={220} height={36} color={placementColor(m.placement)} />
            </div>
            <div>
              <span className="tl-label">Tribes</span>
              <span className="tl-hist__tribes">
                {m.availableTribes.map((t) => (
                  <TribeChip key={t} tribe={t} compact />
                ))}
              </span>
            </div>
            {anomaly ? (
              <div>
                <span className="tl-label">Anomaly</span>
                <span>{anomaly.name}</span>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  );
}
