import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BattleSimResult } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { BoardCards } from '../../components/GameCard';
import { Gem, PlacementBadge, PlacementPips, TierTimeline } from '../../components/Bits';
import { CheckIcon, CloseIcon, CrossIcon } from '../../components/Icons';
import { duration, num, ordinal, placementColor } from '../../lib/format';
import { outcomeLetter, predictedOutcome, sortByDate, summarize, todays } from '../../lib/stats';
import { DragHandle, FloatingWidget } from '../Widget';
import { bottomReserve } from '../layout';

/** The summary closes itself after this long unless the pointer rests on it. */
export const POST_MATCH_AUTO_DISMISS_MS = 40_000;

const TITLES: Record<number, string> = {
  1: 'Victory!',
  2: 'So close!',
  3: 'Strong finish',
  4: 'Top four',
};

/**
 * End-of-game summary: a parchment scroll docked at the right edge (Hearthstone's own
 * end screen owns the centre). Dismissed by its close button, by any overlay hotkey
 * (see OverlayApp), or automatically after 40 s; the timer pauses while hovered.
 */
export function PostMatchWidget() {
  const game = useApp((s) => s.game);
  const dismissed = useApp((s) => s.dismissedPostMatch);
  if (!game || game.phase !== 'gameOver' || dismissed === game.gameId) return null;
  return <PostMatchScroll key={game.gameId} gameId={game.gameId} />;
}

function PostMatchScroll({ gameId }: { gameId: string }) {
  const dismiss = useApp((s) => s.dismissPostMatch);
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(POST_MATCH_AUTO_DISMISS_MS);

  // Auto-dismiss, paused while the pointer is over the scroll.
  useEffect(() => {
    if (hovered) return;
    const started = Date.now();
    const t = setTimeout(() => dismiss(gameId), Math.max(0, remaining.current));
    return () => {
      clearTimeout(t);
      remaining.current -= Date.now() - started;
    };
  }, [hovered, gameId, dismiss]);

  return (
    <FloatingWidget
      id="postMatch"
      className="tl-postmatch"
      zIndex={50}
      onHoverChange={setHovered}
      defaultPosition={(vp, size) => ({ left: vp.width - size.width - Math.round(vp.height * 0.02), top: Math.round(vp.height * 0.07) })}
    >
      {(handle) => <PostMatchBody handle={handle} hovered={hovered} />}
    </FloatingWidget>
  );
}

function PostMatchBody({ handle, hovered }: { handle: Parameters<typeof DragHandle>[0]['handle']; hovered: boolean }) {
  const game = useApp((s) => s.game)!;
  const history = useApp((s) => s.history);
  const dismiss = useApp((s) => s.dismissPostMatch);
  const bridge = useApp((s) => s.bridge);
  const sims = useApp((s) => s.sims);
  const vp = useViewport();
  const session = useMemo(() => sortByDate(todays(history)), [history]);

  const local = game.players.find((p) => p.isLocal);
  const place = game.finalPlacement ?? local?.leaderboardPlace;
  const heroId = local?.heroCardId ?? game.chosenHeroCardId ?? '';
  const duos = game.mode === 'duos';
  const color = placementColor(place, duos);
  const cut = duos ? 2 : 4;
  const tone = !place ? 'none' : place === 1 ? 'win' : place <= cut ? 'top' : 'bottom';
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
  const title = place ? (TITLES[place] ?? `${ordinal(place)} place`) : 'Game over';

  return (
    <div className={clsx('tl-pm', `is-${tone}`)} style={{ '--place': color } as React.CSSProperties}>
      <div className="tl-pm__banner">
        <span className="tl-pm__medal">
          <PlacementBadge place={place} size="xl" duos={duos} />
        </span>
        <span className="tl-pm__ribbon">
          <span className="tl-pm__kicker">{title}</span>
        </span>
        <button className="tl-pm__close" onClick={() => dismiss(game.gameId)} title="Close (also: any overlay hotkey)" aria-label="Close summary">
          <CloseIcon size={16} />
        </button>
      </div>

      <div className="tl-pm__scroll tl-parchment tl-scroll" style={{ maxHeight: `calc(${Math.round(vp.height * 0.93 - bottomReserve(vp))}px / var(--tl-scale) - 66px)` }}>
        <div className="tl-pm__hero">
          <DragHandle handle={handle} className="tl-pm__grip" />
          <HeroPortrait cardId={heroId} size={46} />
          <div className="tl-pm__title">
            <span className="tl-pm__heroname">{local?.heroName ?? 'Unknown hero'}</span>
            <span className="tl-pm__facts">
              <span>
                <b>{game.turn}</b> turns
              </span>
              <span>
                <b>{local?.triples ?? 0}</b> triples
              </span>
              {game.endedAt ? <span>{duration(game.endedAt - game.startedAt)}</span> : null}
              {ratingDelta !== undefined ? (
                <span className={ratingDelta >= 0 ? 'is-up' : 'is-down'}>
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
              <BoardCards minions={game.localBoard} width={88} className="tl-pm__cards" />
            ) : (
              <span className="tl-muted">Board unknown</span>
            )}
          </div>
        </section>

        <section className="tl-pm__section">
          <header className="tl-pm__sechead">
            <span className="tl-heading">Tavern tiers</span>
          </header>
          <TierTimeline history={local?.tierHistory ?? []} />
        </section>

        <section className="tl-pm__section">
          <header className="tl-pm__sechead">
            <span className="tl-heading">Combats</span>
            {predictedTotal ? (
              <span className="tl-pm__note">
                Simulator called {predictedRight}/{predictedTotal}
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
                  <span className="tl-pm__res">
                    {a ? <Gem tone={a.result === 'won' ? 'win' : a.result === 'lost' ? 'loss' : 'tie'} size={8} /> : null}
                    {a ? outcomeLetter(a.result) : '?'}
                  </span>
                  <span className="tl-pm__dmg">{a && a.damage ? (a.result === 'lost' ? `−${a.damage}` : `+${a.damage}`) : '·'}</span>
                  {b.result ? (
                    <span className="tl-pm__pred">
                      <span className="tl-pm__predbar">
                        <i className="w" style={{ height: `${b.result.win}%` }} />
                        <i className="l" style={{ height: `${b.result.loss}%` }} />
                      </span>
                      {a && pred ? pred === a.result ? <CheckIcon size={10} className="is-yes" /> : <CrossIcon size={9} className="is-no" /> : null}
                    </span>
                  ) : (
                    <span className="tl-pm__pred tl-muted">—</span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="tl-pm__section">
          <header className="tl-pm__sechead">
            <span className="tl-heading">Session</span>
            <span className="tl-pm__note">
              {sessionPlaces.length} today · avg {num(sessionAvg, 2)}
              {allTime.games ? ` · all-time ${num(allTime.avgPlacement, 2)}` : ''}
            </span>
          </header>
          <PlacementPips placements={sessionPlaces} size={18} />
        </section>

        <footer className="tl-pm__footer">
          <span className="tl-pm__note">{place ? `Finished ${ordinal(place)} of ${duos ? 4 : 8}` : ''}</span>
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
      <span className="tl-pm__timerwrap" title={hovered ? 'Paused while the pointer is here' : 'Closes by itself'}>
        <span className={clsx('tl-pm__timer', hovered && 'is-paused')} style={{ animationDuration: `${POST_MATCH_AUTO_DISMISS_MS}ms` }} />
      </span>
    </div>
  );
}
