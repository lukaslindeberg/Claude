import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { MinionToken } from '../../components/MinionToken';
import { HealthBar, ResultChip, TierBadge, TriplesBadge } from '../../components/Bits';
import { ordinal } from '../../lib/format';
import { leaderboardSlots } from '../layout';
import { boardFor, seenAgo } from './OpponentsPanel';
import { RelevanceLine } from '../../components/Synergy';
import { tipFor, tribeRelevance, useLobbyTribes, wantedTribes } from '../../lib/synergy';

/**
 * Invisible hover zones over the in-game leaderboard. Hover is detected from the
 * forwarded mousemove stream WITHOUT making the window interactive, so the game
 * keeps receiving clicks. The panel itself is pointer-transparent.
 */
export function LeaderboardHover() {
  const game = useApp((s) => s.game);
  const cal = useApp((s) => s.settings.leaderboardCalibration);
  const calibrating = useApp((s) => !!s.settings.leaderboardCalibrationMode);
  const forced = useApp((s) => s.demo) ? Number(new URLSearchParams(location.search).get('hover') ?? NaN) : NaN;
  const vp = useViewport();
  const db = useApp((s) => s.cardDb);
  const lobby = useLobbyTribes();
  const [hover, setHover] = useState<number | null>(Number.isFinite(forced) ? forced : null);

  const players = useMemo(() => [...(game?.players ?? [])].sort((a, b) => a.leaderboardPlace - b.leaderboardPlace), [game?.players]);
  const count = players.length || 8;
  const slots = useMemo(() => leaderboardSlots(cal, vp, count), [cal, vp, count]);
  const inGame = !!game && (game.phase === 'recruit' || game.phase === 'combat') && players.length > 0;

  useEffect(() => {
    if (!inGame || Number.isFinite(forced)) return;
    const onMove = (e: MouseEvent) => {
      const x = e.clientX;
      const y = e.clientY;
      const idx = slots.findIndex((r) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height);
      setHover(idx >= 0 ? idx : null);
    };
    const onLeave = () => setHover(null);
    window.addEventListener('mousemove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
    };
  }, [slots, inGame, forced]);

  const outlines = calibrating ? (
    <div className="tl-lbcal" aria-hidden>
      {slots.map((r, i) => (
        <div key={i} className={clsx('tl-lbcal__slot', hover === i && 'is-hover')} style={{ left: r.left, top: r.top, width: r.width, height: r.height }}>
          <span>{i + 1}</span>
        </div>
      ))}
      <div className="tl-lbcal__hint" style={{ left: slots[0].left, top: Math.max(4, slots[0].top - 26) }}>
        Leaderboard calibration — align the boxes with the hero portraits
      </div>
    </div>
  ) : null;

  if (!inGame) return outlines;
  const p = hover !== null ? players[hover] : undefined;
  if (!p) return outlines;
  const slot = slots[hover!];
  const board = boardFor(game!, p);
  const last = p.combatsAgainst[p.combatsAgainst.length - 1];
  const seen = seenAgo(game!, p);
  const tip = tipFor(db, p.heroCardId);
  const rel = tip ? tribeRelevance(wantedTribes(db.get(p.heroCardId), tip), lobby.tribes) : undefined;

  return (
    <>
      {outlines}
      <div className="tl-lbhover__zone" style={{ left: slot.left, top: slot.top, width: slot.width, height: slot.height }} />
      <ClampedPanel left={slot.left + slot.width + 14} centerY={slot.top + slot.height / 2} viewportHeight={vp.height}>
          <div className={clsx('tl-panel tl-lbhover__panel', p.dead && 'is-dead')}>
            <div className="tl-lbhover__head">
              <HeroPortrait
                cardId={p.heroCardId}
                name={p.heroName}
                size={52}
                dead={p.dead}
                shape="rounded"
                glow={p.isNextOpponent ? 'next' : p.isLocal ? 'local' : undefined}
              />
              <div className="tl-lbhover__title">
                <div className="tl-lbhover__name">
                  {p.isLocal ? `${p.heroName} (you)` : p.heroName}
                  {p.name && !p.isLocal ? <span className="tl-muted"> · {p.name.split('#')[0]}</span> : null}
                </div>
                <div className="tl-lbhover__meta">
                  <span className="tl-lbhover__place">{ordinal(p.leaderboardPlace)}</span>
                  {p.dead ? (
                    <span className="tl-muted">Eliminated{p.diedOnTurn ? ` on turn ${p.diedOnTurn}` : ''}</span>
                  ) : (
                    <span className="tl-lbhover__hp">
                      <HealthBar health={p.health} maxHealth={p.maxHealth} armor={p.armor} />
                    </span>
                  )}
                </div>
              </div>
              <div className="tl-lbhover__badges">
                <span className="tl-lbhover__badge">
                  <TierBadge tier={p.tavernTier} size={20} gold />
                  <span>Tier</span>
                </span>
                <span className="tl-lbhover__badge">
                  <TriplesBadge count={p.triples} />
                  <span>Triples</span>
                </span>
                {last ? (
                  <span className="tl-lbhover__badge">
                    <ResultChip result={last.result} damage={last.damage} />
                    <span>T{last.turn}</span>
                  </span>
                ) : null}
              </div>
            </div>
            {tip ? (
              <div className="tl-lbhover__tip tl-parchment">
                <span className="tl-lbhover__tiptext">{tip.tip}</span>
                {rel && rel.status !== 'none' && rel.status !== 'unknown' ? <RelevanceLine rel={rel} /> : null}
              </div>
            ) : null}
            <div className="tl-lbhover__boardhead">
              <span className="tl-heading">{p.isLocal ? 'Your board' : 'Last seen board'}</span>
              {seen && !p.isLocal ? (
                <span className="tl-muted tl-small">
                  {seen}
                  {p.lastBoard ? ` · turn ${p.lastBoard.turn}` : ''}
                </span>
              ) : null}
            </div>
            {board && board.length ? (
              <div className="tl-lbhover__board">
                {board.map((m) => (
                  <MinionToken key={m.entityId} minion={m} size="lg" showName tooltip={false} />
                ))}
              </div>
            ) : (
              <div className="tl-lbhover__empty">Haven't seen this board yet — it appears after you face them or watch their combat.</div>
            )}
          </div>
      </ClampedPanel>
    </>
  );
}

/** Positions the hover panel beside the slot, vertically centred and kept on screen. */
function ClampedPanel({ left, centerY, viewportHeight, children }: { left: number; centerY: number; viewportHeight: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    if (ref.current) setH(ref.current.getBoundingClientRect().height);
  });
  const top = Math.max(8, Math.min(centerY - h / 2, viewportHeight - h - 8));
  return (
    <div ref={ref} className="tl-widget tl-lbhover" style={{ left, top, visibility: h ? 'visible' : 'hidden' }} data-widget="leaderboardHover">
      <div className="tl-widget__scale">{children}</div>
    </div>
  );
}
