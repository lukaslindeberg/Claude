import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store/appStore';
import { HeroPortrait } from '../../components/HeroPortrait';
import { MinionToken } from '../../components/MinionToken';
import { HealthBar, PlacementBadge, PlacementPips, TierBadge, TribeChip } from '../../components/Bits';
import { PlayIcon, StopIcon } from '../../components/Icons';
import { SetupNotice } from './SetupChecks';
import { formatDate, num, ordinal } from '../../lib/format';
import { sortByDate, summarize, todays } from '../../lib/stats';
import { Card, Kpi, SectionHeader } from '../ui';

export function Overview() {
  const status = useApp((s) => s.status);
  const bridge = useApp((s) => s.bridge);
  const [starting, setStarting] = useState(false);

  const toggleDemo = async () => {
    if (!bridge) return;
    setStarting(true);
    try {
      if (status?.demo.running) await bridge.stopDemo();
      else await bridge.startDemo();
    } finally {
      setStarting(false);
    }
  };

  const demoRunning = !!status?.demo.running;

  return (
    <div className="tl-section">
      <SectionHeader
        title="Overview"
        subtitle="Your current game, recent games and today at a glance."
        actions={
          <span className={clsx('tl-pill', status?.watching ? 'is-ok' : 'is-off')}>
            <span className="tl-dot" />
            {status?.watching ? 'Watching' : 'Idle'}
          </span>
        }
      />
      <div className="tl-overview">
        <SetupNotice />

        <div className="tl-overview__col">
          <CurrentGame />
          <RecentGames />
        </div>
        <div className="tl-overview__col">
          <Card className="tl-demo-card">
            <div className="tl-demo-card__body">
              <div>
                <h2 className="tl-card__title">Try it without a game</h2>
                <p className="tl-muted">Replays a recorded Battlegrounds game through the tracker and simulator so you can see every overlay widget.</p>
              </div>
              <button className={clsx('tl-bigbtn', demoRunning && 'is-running')} onClick={toggleDemo} disabled={starting}>
                {demoRunning ? <StopIcon size={16} /> : <PlayIcon size={16} />}
                {demoRunning ? 'Stop demo' : 'Start demo'}
              </button>
            </div>
            {demoRunning ? (
              <div className="tl-progress">
                <span style={{ width: `${Math.round((status?.demo.progress ?? 0) * 100)}%` }} />
              </div>
            ) : null}
          </Card>
          <TodayCard />
        </div>
      </div>
    </div>
  );
}

function CurrentGame() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  if (!game || !game.active) {
    return (
      <Card title="Current game" className="tl-overview__game">
        <div className="tl-nogame">
          <span className="tl-nogame__title">No game in progress</span>
          <span className="tl-muted">Queue up for Battlegrounds — the overlay wakes up when the hero choice appears.</span>
        </div>
      </Card>
    );
  }
  const local = game.players.find((p) => p.isLocal);
  const next = game.players.find((p) => p.playerId === game.nextOpponentPlayerId);
  const anomaly = db.get(game.anomalyCardId);
  const phaseLabel = { idle: 'Idle', heroSelection: 'Choosing a hero', recruit: 'Recruit phase', combat: 'Combat', gameOver: 'Game over' }[game.phase];
  return (
    <Card title="Current game" extra={<span className="tl-pill is-live">{phaseLabel}</span>} className="tl-overview__game">
      {game.phase === 'heroSelection' ? (
        <div className="tl-curgame__picks">
          {game.heroOptions.map((h) => (
            <div key={h.cardId} className="tl-curgame__pick">
              <HeroPortrait cardId={h.cardId} size={52} />
              <span>{h.name}</span>
            </div>
          ))}
        </div>
      ) : local ? (
        <>
          <div className="tl-curgame">
            <HeroPortrait cardId={local.heroCardId} size={64} />
            <div className="tl-curgame__info">
              <div className="tl-curgame__hero">{local.heroName}</div>
              <div className="tl-curgame__facts">
                <span>
                  Turn <b>{game.turn}</b>
                </span>
                <span className="tl-curgame__tier">
                  <TierBadge tier={local.tavernTier} size={18} /> Tier
                </span>
                <span>
                  Place <b>{ordinal(game.finalPlacement ?? local.leaderboardPlace)}</b>
                </span>
                {next ? (
                  <span>
                    Next: <b>{next.heroName}</b>
                  </span>
                ) : null}
              </div>
              <div className="tl-curgame__hp">
                <HealthBar health={local.health} maxHealth={local.maxHealth} armor={local.armor} />
              </div>
            </div>
          </div>
          <div className="tl-curgame__board">
            {game.localBoard.map((m) => (
              <MinionToken key={m.entityId} minion={m} size="sm" />
            ))}
          </div>
          <div className="tl-curgame__lobby">
            {game.availableTribes.map((t) => (
              <TribeChip key={t} tribe={t} compact />
            ))}
            {anomaly ? <span className="tl-curgame__anomaly">✦ {anomaly.name}</span> : null}
          </div>
        </>
      ) : (
        <span className="tl-muted">Waiting for the game to start…</span>
      )}
    </Card>
  );
}

function RecentGames() {
  const history = useApp((s) => s.history);
  const recent = useMemo(() => sortByDate(history).slice(0, 4), [history]);
  return (
    <Card
      title="Recent games"
      className="tl-overview__recent"
      extra={
        history.length ? (
          <button className="tl-btn tl-btn--ghost" onClick={() => (window.location.hash = 'history')}>
            All games →
          </button>
        ) : null
      }
    >
      {recent.length ? (
        <div className="tl-recent">
          {recent.map((m) => (
            <div key={m.id} className="tl-recent__row">
              <PlacementBadge place={m.placement} size="sm" duos={m.mode === 'duos'} />
              <HeroPortrait cardId={m.heroCardId} size={28} />
              <span className="tl-recent__hero">
                <span className="tl-recent__name">{m.heroName}</span>
                <span className="tl-muted tl-small tl-nowrap">{formatDate(m.startedAt)}</span>
              </span>
              <span className="tl-recent__board">
                {m.finalBoard.slice(0, 7).map((x) => (
                  <MinionToken key={x.entityId} minion={x} size="xs" tooltip={false} />
                ))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <span className="tl-muted">Your finished games will show up here.</span>
      )}
    </Card>
  );
}

function TodayCard() {
  const history = useApp((s) => s.history);
  const today = useMemo(() => sortByDate(todays(history)), [history]);
  const s = summarize(today);
  return (
    <Card title="Today" className="tl-overview__today">
      <div className="tl-kpis is-3">
        <Kpi label="Games" value={s.games} />
        <Kpi label="Avg place" value={s.games ? num(s.avgPlacement, 2) : '—'} tone="gold" />
        <Kpi label="Top 4" value={s.games ? `${Math.round(s.top4Rate)}%` : '—'} />
      </div>
      {today.length ? (
        <div className="tl-today__pips">
          <PlacementPips placements={today.map((m) => m.placement).reverse()} size={20} />
        </div>
      ) : (
        <span className="tl-muted">No games yet today.</span>
      )}
    </Card>
  );
}
