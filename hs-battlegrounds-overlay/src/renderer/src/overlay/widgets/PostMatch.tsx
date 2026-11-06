import { useMemo } from 'react';
import clsx from 'clsx';
import type { BattleSimResult } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useInteractive } from '../../hooks/useInteractive';
import { HeroPortrait } from '../../components/HeroPortrait';
import { MinionToken } from '../../components/MinionToken';
import { PlacementBadge, PlacementPips, TierTimeline } from '../../components/Bits';
import { CheckIcon, CloseIcon, CrossIcon } from '../../components/Icons';
import { duration, num, ordinal, placementColor } from '../../lib/format';
import { outcomeLetter, predictedOutcome, sortByDate, summarize, todays } from '../../lib/stats';

const TITLES: Record<number, string> = {
  1: 'Victory!',
  2: 'So close',
  3: 'Strong finish',
  4: 'Top four',
};

export function PostMatchWidget() {
  const game = useApp((s) => s.game);
  const dismissed = useApp((s) => s.dismissedPostMatch);
  const history = useApp((s) => s.history);
  const dismiss = useApp((s) => s.dismissPostMatch);
  const bridge = useApp((s) => s.bridge);
  const sims = useApp((s) => s.sims);
  const inter = useInteractive();

  const session = useMemo(() => {
    const t = sortByDate(todays(history));
    return t;
  }, [history]);

  if (!game || game.phase !== 'gameOver' || dismissed === game.gameId) return null;
  const local = game.players.find((p) => p.isLocal);
  const place = game.finalPlacement ?? local?.leaderboardPlace;
  const heroId = local?.heroCardId ?? game.chosenHeroCardId ?? '';
  const duos = game.mode === 'duos';
  const color = placementColor(place, duos);
  const sessionPlaces = session.some((m) => m.id === game.gameId) ? session.map((m) => m.placement).reverse() : [...session.map((m) => m.placement).reverse(), ...(place ? [place] : [])];
  const sessionAvg = sessionPlaces.length ? sessionPlaces.reduce((a, b) => a + b, 0) / sessionPlaces.length : NaN;
  const record = history.find((m) => m.id === game.gameId);
  // The tracker doesn't know the simulator's predictions (they run in this renderer):
  // take them from this window's sim runs, falling back to the saved match record.
  const simByTurn = new Map<number, BattleSimResult>();
  for (const c of record?.combats ?? []) if (c.prediction) simByTurn.set(c.turn, c.prediction);
  for (const [key, run] of Object.entries(sims)) {
    if (key.startsWith(`${game.gameId}:`) && run.result) simByTurn.set(run.turn, run.result);
  }
  const allBattles = game.battles.map((b) => (b.result ? b : { ...b, result: simByTurn.get(b.turn) }));
  const battles = allBattles.filter((b) => b.actual);
  const predictedRight = battles.filter((b) => b.result && b.actual && predictedOutcome(b.result) === b.actual.result).length;
  const predictedTotal = battles.filter((b) => b.result).length;
  const ratingDelta = record?.ratingAfter && record.ratingBefore ? record.ratingAfter - record.ratingBefore : undefined;
  const allTime = summarize(history);

  return (
    <div className="tl-widget tl-postmatch" {...inter} data-widget="postMatch">
      <div className="tl-widget__scale">
        <div className="tl-panel tl-pm" style={{ '--place': color } as React.CSSProperties}>
          <button className="tl-btn tl-btn--ghost tl-btn--icon tl-pm__close" onClick={() => dismiss(game.gameId)} title="Dismiss">
            <CloseIcon size={14} />
          </button>
          <div className="tl-pm__hero">
            <div className="tl-pm__place">
              <PlacementBadge place={place} size="xl" duos={duos} />
            </div>
            <HeroPortrait cardId={heroId} size={74} ring={color} />
            <div className="tl-pm__title">
              <span className="tl-pm__kicker">{place ? (TITLES[place] ?? 'Game over') : 'Game over'}</span>
              <span className="tl-pm__heroname">{local?.heroName ?? 'Unknown hero'}</span>
              <span className="tl-pm__facts">
                <span>
                  <b>{game.turn}</b> turns
                </span>
                <span>
                  Tier <b>{local?.tavernTier ?? '—'}</b>
                </span>
                <span>
                  <b>{local?.triples ?? 0}</b> triples
                </span>
                {game.endedAt ? <span>{duration(game.endedAt - game.startedAt)}</span> : null}
                {ratingDelta !== undefined ? (
                  <span className={ratingDelta >= 0 ? 'tl-up' : 'tl-down'}>
                    {ratingDelta >= 0 ? '+' : ''}
                    {ratingDelta} rating
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          <section className="tl-pm__section">
            <header className="tl-pm__sechead">
              <span className="tl-heading">Final board</span>
            </header>
            <div className="tl-pm__board">
              {game.localBoard.length ? (
                game.localBoard.map((m) => <MinionToken key={m.entityId} minion={m} size="md" showName />)
              ) : (
                <span className="tl-muted">Board unknown</span>
              )}
            </div>
          </section>

          <div className="tl-pm__grid">
            <section className="tl-pm__section">
              <header className="tl-pm__sechead">
                <span className="tl-heading">Tavern tiers</span>
              </header>
              <TierTimeline history={local?.tierHistory ?? []} />
            </section>
            <section className="tl-pm__section">
              <header className="tl-pm__sechead">
                <span className="tl-heading">Session</span>
                <span className="tl-muted tl-small">
                  {sessionPlaces.length} today · avg {num(sessionAvg, 2)}
                  {allTime.games ? ` · all-time ${num(allTime.avgPlacement, 2)}` : ''}
                </span>
              </header>
              <PlacementPips placements={sessionPlaces} size={18} />
            </section>
          </div>

          <section className="tl-pm__section">
            <header className="tl-pm__sechead">
              <span className="tl-heading">Combats</span>
              {predictedTotal ? (
                <span className="tl-muted tl-small">
                  Simulator called {predictedRight}/{predictedTotal} correctly
                </span>
              ) : null}
            </header>
            <div className="tl-pm__combats">
              {allBattles.map((b) => {
                const a = b.actual;
                const pred = b.result ? predictedOutcome(b.result) : undefined;
                return (
                  <div key={b.turn} className={clsx('tl-pm__combat', a && `is-${a.result}`)} title={b.result ? `Predicted ${b.result.win.toFixed(0)}% win / ${b.result.loss.toFixed(0)}% loss` : undefined}>
                    <span className="tl-pm__turn">T{b.turn}</span>
                    <span className="tl-pm__res">{a ? outcomeLetter(a.result) : '?'}</span>
                    <span className="tl-pm__dmg">{a && a.damage ? (a.result === 'lost' ? `−${a.damage}` : `+${a.damage}`) : '·'}</span>
                    {b.result ? (
                      <span className="tl-pm__pred">
                        <span className="tl-pm__predbar">
                          <i className="w" style={{ height: `${b.result.win}%` }} />
                          <i className="l" style={{ height: `${b.result.loss}%` }} />
                        </span>
                        {a && pred ? pred === a.result ? <CheckIcon size={10} className="tl-up" /> : <CrossIcon size={9} className="tl-down" /> : null}
                      </span>
                    ) : (
                      <span className="tl-pm__pred tl-muted">—</span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <footer className="tl-pm__footer">
            <span className="tl-muted tl-small">{place ? `Finished ${ordinal(place)} of ${duos ? 4 : 8}` : ''}</span>
            <span className="tl-pm__actions">
              <button className="tl-btn" onClick={() => bridge?.openSettings()}>
                Match history
              </button>
              <button className="tl-btn tl-btn--gold" onClick={() => dismiss(game.gameId)}>
                Dismiss
              </button>
            </span>
          </footer>
        </div>
      </div>
    </div>
  );
}
