import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BgGameState, MinionSnapshot, PlayerState } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useInteractive } from '../../hooks/useInteractive';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { MinionToken } from '../../components/MinionToken';
import { HealthBar, ResultChip, Sparkline, TierBadge, TierTimeline, TriplesBadge } from '../../components/Bits';
import { ChevronIcon, KeywordIcons } from '../../components/Icons';
import { ordinal } from '../../lib/format';

const COLLAPSE_KEY = 'tl-opponents-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

export function seenAgo(game: BgGameState, p: PlayerState): string | undefined {
  if (!p.lastBoard) return undefined;
  const d = Math.max(0, game.turn - p.lastBoard.turn);
  if (p.isLocal) return 'Your board';
  if (d === 0) return 'Seen this turn';
  return `Seen ${d} turn${d === 1 ? '' : 's'} ago`;
}

export function boardFor(game: BgGameState, p: PlayerState): MinionSnapshot[] | undefined {
  if (p.isLocal && game.localBoard.length) return game.localBoard;
  return p.lastBoard?.minions;
}

/** Right-edge panel: every player by leaderboard place, with their last-seen board. */
export function OpponentsPanel() {
  const game = useApp((s) => s.game);
  const pulse = useApp((s) => s.togglePulse.opponentsPanel ?? 0);
  const vp = useViewport();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [expanded, setExpanded] = useState<number | null>(null);
  const inter = useInteractive();
  const firstPulse = useRef(pulse);

  useEffect(() => {
    if (pulse !== firstPulse.current) setCollapsed((c) => !c);
  }, [pulse]);
  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const players = useMemo(
    () => [...(game?.players ?? [])].sort((a, b) => a.leaderboardPlace - b.leaderboardPlace || a.playerId - b.playerId),
    [game?.players],
  );
  if (!game || (game.phase !== 'recruit' && game.phase !== 'combat') || players.length === 0) return null;
  const alive = players.filter((p) => !p.dead).length;
  const top = Math.round(vp.height * 0.07);

  return (
    <div className={clsx('tl-widget tl-opp', collapsed && 'is-collapsed')} style={{ top, right: 6 }} {...inter} data-widget="opponentsPanel">
      <div className="tl-widget__scale">
        <div className="tl-panel tl-opp__panel" style={{ maxHeight: `calc(${vp.height - top - 16}px / var(--tl-scale))` }}>
          <div className="tl-opp__header">
            {collapsed ? null : (
              <>
                <span className="tl-heading">Lobby</span>
                <span className="tl-opp__meta">
                  Turn {game.turn} · {alive} alive
                </span>
              </>
            )}
            <button className="tl-btn tl-btn--ghost tl-btn--icon tl-opp__toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand panel' : 'Collapse panel'}>
              <ChevronIcon size={14} dir={collapsed ? 'left' : 'right'} />
            </button>
          </div>
          <div className="tl-opp__list tl-scroll">
            {players.map((p) =>
              collapsed ? (
                <CollapsedRow key={p.playerId} game={game} p={p} />
              ) : (
                <OpponentRow
                  key={p.playerId}
                  game={game}
                  p={p}
                  expanded={expanded === p.playerId}
                  onToggle={() => setExpanded(expanded === p.playerId ? null : p.playerId)}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CollapsedRow({ game, p }: { game: BgGameState; p: PlayerState }) {
  const fighting = game.phase === 'combat' && game.currentOpponentPlayerId === p.playerId;
  return (
    <div className={clsx('tl-opp__mini', p.dead && 'is-dead', p.isNextOpponent && !fighting && 'is-next', fighting && 'is-fighting', p.isLocal && 'is-local')} title={`${p.heroName} · ${p.health + p.armor} hp`}>
      <HeroPortrait cardId={p.heroCardId} name={p.heroName} size={34} dead={p.dead}>
        <span className="tl-opp__mini-place">{p.leaderboardPlace}</span>
      </HeroPortrait>
      <span className="tl-opp__mini-hp">{p.dead ? '✕' : p.health + p.armor}</span>
    </div>
  );
}

function OpponentRow({ game, p, expanded, onToggle }: { game: BgGameState; p: PlayerState; expanded: boolean; onToggle: () => void }) {
  const fighting = game.phase === 'combat' && game.currentOpponentPlayerId === p.playerId;
  const last = p.combatsAgainst[p.combatsAgainst.length - 1];
  const board = boardFor(game, p);
  const seen = seenAgo(game, p);
  // Your own row and eliminated players stay one line unless expanded.
  const compactRow = p.isLocal || p.dead;
  return (
    <div
      className={clsx('tl-opp__row', p.dead && 'is-dead', p.isNextOpponent && !fighting && 'is-next', fighting && 'is-fighting', p.isLocal && 'is-local', expanded && 'is-expanded')}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}
    >
      <div className="tl-opp__main">
        <span className={clsx('tl-opp__place', p.leaderboardPlace === 1 && 'is-first')}>{p.leaderboardPlace}</span>
        <HeroPortrait cardId={p.heroCardId} name={p.heroName} size={36} dead={p.dead} ring={p.isNextOpponent ? '#f2c14e' : fighting ? '#e0564f' : undefined}>
          {!p.dead ? <TierBadge tier={p.tavernTier} size={16} className="tl-opp__tier" /> : null}
        </HeroPortrait>
        <div className="tl-opp__info">
          <div className="tl-opp__line">
            <span className="tl-opp__hero">{p.isLocal ? 'You' : p.heroName}</span>
            {p.isNextOpponent && !fighting ? <span className="tl-tag is-next">Next</span> : null}
            {fighting ? <span className="tl-tag is-fighting">Fighting</span> : null}
            {!p.isNextOpponent && !fighting && last ? <ResultChip result={last.result} damage={last.damage} size="sm" /> : null}
          </div>
          {p.dead ? (
            <div className="tl-opp__dead">
              Eliminated{p.diedOnTurn ? ` T${p.diedOnTurn}` : ''} · <b>{ordinal(p.leaderboardPlace)}</b>
            </div>
          ) : (
            <div className="tl-opp__line">
              <HealthBar health={p.health} maxHealth={p.maxHealth} armor={p.armor} compact />
              <TriplesBadge count={p.triples} />
            </div>
          )}
        </div>
      </div>
      {compactRow && !expanded ? null : board && board.length ? (
        <div className="tl-opp__board">
          {board.map((m) => (
            <MinionToken key={m.entityId} minion={m} size="sm" />
          ))}
        </div>
      ) : (
        <div className="tl-opp__noboard">{p.isLocal || p.lastBoard ? 'Empty board' : 'Board not seen yet'}</div>
      )}
      {seen && !p.isLocal && !(compactRow && !expanded) ? (
        <div className="tl-opp__seen">
          {seen}
          {p.lastBoard ? <span className="tl-muted"> · T{p.lastBoard.turn}</span> : null}
          {p.name ? <span className="tl-opp__tag" title={p.name}>{p.name.split('#')[0]}</span> : null}
        </div>
      ) : null}
      {expanded ? <OpponentDetail game={game} p={p} board={board} /> : null}
    </div>
  );
}

function OpponentDetail({ p, board }: { game: BgGameState; p: PlayerState; board?: MinionSnapshot[] }) {
  return (
    <div className="tl-opp__detail" onClick={(e) => e.stopPropagation()}>
      {board && board.length ? (
        <div className="tl-opp__fullboard">
          {board.map((m) => (
            <div key={m.entityId} className="tl-opp__minion">
              <MinionToken minion={m} size="xs" tooltip={false} />
              <span className="tl-opp__minion-name">{m.name}</span>
              <KeywordIcons keywords={m.keywords} size={10} max={3} />
              <span className="tl-opp__minion-stats">
                <b className="atk">{m.attack}</b>/<b className={m.health < m.maxHealth ? 'hp is-damaged' : 'hp'}>{m.health}</b>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="tl-opp__section">
        <span className="tl-opp__label">Tiers</span>
        <TierTimeline history={p.tierHistory} compact />
      </div>
      <div className="tl-opp__section">
        <span className="tl-opp__label">Health</span>
        <Sparkline points={p.healthHistory} width={170} height={30} color={p.dead ? '#8a8ea6' : '#5cc47a'} />
      </div>
      {p.combatsAgainst.length ? (
        <div className="tl-opp__section">
          <span className="tl-opp__label">Vs you</span>
          <span className="tl-opp__combats">
            {p.combatsAgainst.map((c) => (
              <span key={c.turn} className="tl-opp__combat">
                <span className="tl-muted">T{c.turn}</span>
                <ResultChip result={c.result} damage={c.damage} size="sm" />
              </span>
            ))}
          </span>
        </div>
      ) : null}
    </div>
  );
}
