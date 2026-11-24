import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import type { BgGameState, MinionSnapshot, PlayerState } from '@shared/types';
import { useApp } from '../../store/appStore';
import { useInteractive } from '../../hooks/useInteractive';
import { useViewport } from '../../hooks/useViewport';
import { HeroPortrait } from '../../components/HeroPortrait';
import { MinionToken } from '../../components/MinionToken';
import { HealthBar, ResultChip, Sparkline, StatGem, TierBadge, TierTimeline, TriplesBadge } from '../../components/Bits';
import { ChevronIcon } from '../../components/Icons';
import { ordinal } from '../../lib/format';
import { Tooltip } from '../../components/Tooltip';
import { CardTooltip } from '../../components/CardTooltip';
import { BoardCards } from '../../components/GameCard';
import { tipFor } from '../../lib/synergy';
import { bottomReserve } from '../layout';

const COLLAPSE_KEY = 'tl-opponents-collapsed';
/** Duos keeps its own choice: the expanded panel would cover the teammate portal. */
const COLLAPSE_KEY_DUOS = 'tl-opponents-collapsed-duos';

function readCollapsed(duos: boolean): boolean {
  try {
    const v = localStorage.getItem(duos ? COLLAPSE_KEY_DUOS : COLLAPSE_KEY);
    return v === null ? duos : v === '1';
  } catch {
    return duos;
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

/** Duos: a team of two sharing one health pool and one place. */
export interface DuoTeam {
  teamId: number;
  /** Local player first, else the next / current opponent first, else by PLAYER_ID. */
  members: PlayerState[];
  place: number;
  dead: boolean;
  local: boolean;
  next: boolean;
  fighting: boolean;
}

/** Groups a Duos lobby into teams by `teamId`; undefined when the teams are not known (yet). */
export function duoTeams(game: BgGameState): DuoTeam[] | undefined {
  if (game.mode !== 'duos' || !game.players.length || game.players.some((p) => p.teamId === undefined)) return undefined;
  const by = new Map<number, PlayerState[]>();
  for (const p of game.players) by.set(p.teamId!, [...(by.get(p.teamId!) ?? []), p]);
  if ([...by.values()].some((l) => l.length > 2)) return undefined;
  const fightingPid = game.phase === 'combat' ? game.currentOpponentPlayerId : undefined;
  const rank = (p: PlayerState) => (p.isLocal ? 0 : p.playerId === fightingPid ? 1 : p.playerId === game.nextOpponentPlayerId ? 2 : 3);
  return [...by.entries()]
    .map(([teamId, l]) => {
      const members = [...l].sort((a, b) => rank(a) - rank(b) || a.playerId - b.playerId);
      const fighting = members.some((p) => p.playerId === fightingPid);
      return {
        teamId,
        members,
        place: Math.min(...members.map((p) => p.leaderboardPlace || 99)),
        dead: members.every((p) => p.dead),
        local: members.some((p) => p.isLocal),
        next: !fighting && members.some((p) => p.isNextOpponent || p.playerId === game.nextOpponentPlayerId || p.playerId === game.nextOpponentTeammatePlayerId),
        fighting,
      };
    })
    .sort((a, b) => a.place - b.place || a.teamId - b.teamId);
}

/** Right-edge panel: every player by leaderboard place, with their last-seen board (Duos: by team). */
export function OpponentsPanel() {
  const game = useApp((s) => s.game);
  const pulse = useApp((s) => s.togglePulse.opponentsPanel ?? 0);
  const vp = useViewport();
  const duos = game?.mode === 'duos';
  const [collapsed, setCollapsedState] = useState(() => readCollapsed(duos));
  const [expanded, setExpanded] = useState<number | null>(null);
  const inter = useInteractive();
  const firstPulse = useRef(pulse);
  const setCollapsed = (next: boolean) => {
    setCollapsedState(next);
    try {
      localStorage.setItem(duos ? COLLAPSE_KEY_DUOS : COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  };

  useEffect(() => setCollapsedState(readCollapsed(duos)), [duos]);
  useEffect(() => {
    if (pulse !== firstPulse.current) setCollapsed(!collapsed);
  }, [pulse]);

  const players = useMemo(
    () => [...(game?.players ?? [])].sort((a, b) => a.leaderboardPlace - b.leaderboardPlace || a.playerId - b.playerId),
    [game?.players],
  );
  const teams = useMemo(() => (game ? duoTeams(game) : undefined), [game]);
  if (!game || (game.phase !== 'recruit' && game.phase !== 'combat') || players.length === 0) return null;
  const alive = teams ? teams.filter((t) => !t.dead).length : players.filter((p) => !p.dead).length;
  const top = Math.round(vp.height * 0.07);
  // Ends above the game's menu gear (bottom-right corner).
  const maxHeight = vp.height - top - bottomReserve(vp);

  return (
    <div className={clsx('tl-widget tl-opp', collapsed && 'is-collapsed')} style={{ top, right: 6 }} {...inter} data-widget="opponentsPanel">
      <div className="tl-widget__scale">
        <div className="tl-panel tl-opp__panel" style={{ maxHeight: `calc(${maxHeight}px / var(--tl-scale))` }}>
          <div className="tl-opp__header">
            {collapsed ? null : (
              <>
                <span className="tl-plate">Leaderboard</span>
                <span className="tl-opp__meta">
                  Turn {game.turn} · {teams ? `${alive} ${alive === 1 ? 'team' : 'teams'} alive` : `${alive} alive`}
                </span>
              </>
            )}
            <button className="tl-btn tl-btn--ghost tl-btn--icon tl-opp__toggle" onClick={() => setCollapsed(!collapsed)} title={collapsed ? 'Expand panel' : 'Collapse panel'}>
              <ChevronIcon size={14} dir={collapsed ? 'left' : 'right'} />
            </button>
          </div>
          <div className="tl-opp__list tl-scroll">
            {teams
              ? teams.map((t) =>
                  collapsed ? (
                    <CollapsedTeam key={t.teamId} game={game} team={t} />
                  ) : (
                    <TeamBlock key={t.teamId} game={game} team={t} expanded={expanded} onToggle={(pid) => setExpanded(expanded === pid ? null : pid)} />
                  ),
                )
              : players.map((p) =>
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
      <HeroPortrait
        cardId={p.heroCardId}
        name={p.heroName}
        size={34}
        dead={p.dead}
        shape="rounded"
        glow={fighting ? 'fighting' : p.isNextOpponent ? 'next' : p.isLocal || p.isTeammate ? 'local' : undefined}
      >
        <span className="tl-opp__mini-place">{p.leaderboardPlace}</span>
      </HeroPortrait>
      {p.dead ? <span className="tl-opp__mini-dead">Out</span> : <StatGem kind="hp" value={p.health + p.armor} size={19} className="tl-opp__mini-hp" />}
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
  const label = p.isLocal ? 'You' : p.heroName || 'Unknown hero';
  const db = useApp((s) => s.cardDb);
  const tip = tipFor(db, p.heroCardId);
  const portrait = (
    <HeroPortrait
      cardId={p.heroCardId}
      name={p.heroName}
      size={36}
      dead={p.dead}
      shape="rounded"
      tier={p.tavernTier}
      glow={fighting ? 'fighting' : p.isNextOpponent ? 'next' : p.isLocal || p.isTeammate ? 'local' : undefined}
    />
  );
  return (
    <div
      className={clsx('tl-opp__row', p.dead && 'is-dead', p.isNextOpponent && !fighting && 'is-next', fighting && 'is-fighting', p.isLocal && 'is-local', expanded && 'is-expanded')}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}
    >
      <Tooltip
        as="div"
        placement="left"
        delay={220}
        tipClassName="tl-tooltip--card"
        disabled={!board?.length && !tip}
        content={() => (
          <div className="tl-panel tl-boardtip">
            <div className="tl-boardtip__head">
              <span className="tl-boardtip__name">{p.isLocal ? 'Your board' : `${label}'s board`}</span>
              {seen && !p.isLocal ? <span className="tl-boardtip__seen">{seen}</span> : null}
            </div>
            {board?.length ? <BoardCards minions={board} width={board.length > 5 ? 128 : 150} /> : null}
            {tip && !p.isLocal ? (
              <div className="tl-boardtip__tip tl-parchment">
                <b>{p.heroName}:</b> {tip.tip}
              </div>
            ) : null}
          </div>
        )}
      >
        <div className="tl-opp__main">
          <span className={clsx('tl-opp__place', p.leaderboardPlace === 1 && 'is-first')}>{p.leaderboardPlace}</span>
          {portrait}
          <div className="tl-opp__info">
            <div className="tl-opp__line">
              <span className="tl-opp__hero" title={p.isLocal ? undefined : label}>
                {label}
              </span>
              {p.isTeammate ? <span className="tl-tag is-mate">Mate</span> : null}
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
              <MinionToken key={m.entityId} minion={m} size="sm" tooltip={false} />
            ))}
          </div>
        ) : (
          <div className="tl-opp__noboard">{p.isLocal || p.lastBoard ? 'Empty board' : 'Board not seen yet'}</div>
        )}
      </Tooltip>
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
  const db = useApp((s) => s.cardDb);
  return (
    <div className="tl-opp__detail" onClick={(e) => e.stopPropagation()}>
      {p.trinkets?.length ? (
        <div className="tl-opp__section">
          <span className="tl-opp__label">Trinkets</span>
          <span className="tl-opp__trinkets">
            {p.trinkets.map((id) => (
              <Tooltip key={id} placement="left" tipClassName="tl-tooltip--card" content={() => <CardTooltip cardId={id} />}>
                <span className="tl-opp__trinket">{db.name(id)}</span>
              </Tooltip>
            ))}
          </span>
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

// ---------------------------------------------------------------------------
// Duos: one plank per team (shared health and place), a sub-row per player
// ---------------------------------------------------------------------------

/** Both members' boards, side by side in one tooltip. */
function TeamBoardsTip({ game, team }: { game: BgGameState; team: DuoTeam }) {
  return (
    <div className="tl-panel tl-boardtip tl-boardtip--team">
      {team.members.map((p) => {
        const board = boardFor(game, p);
        const seen = seenAgo(game, p);
        return (
          <div key={p.playerId} className="tl-boardtip__member">
            <div className="tl-boardtip__head">
              <span className="tl-boardtip__name">{p.isLocal ? 'Your board' : `${p.heroName}${p.isTeammate ? ' (teammate)' : ''}`}</span>
              {seen && !p.isLocal ? <span className="tl-boardtip__seen">{seen}</span> : null}
            </div>
            {board?.length ? <BoardCards minions={board} width={board.length > 5 ? 112 : 128} /> : <div className="tl-opp__noboard">{p.lastBoard || p.isLocal ? 'Empty board' : 'Board not seen yet'}</div>}
          </div>
        );
      })}
    </div>
  );
}

function teamGlow(team: DuoTeam, p: PlayerState, game: BgGameState): 'fighting' | 'next' | 'local' | undefined {
  if (game.phase === 'combat' && game.currentOpponentPlayerId === p.playerId) return 'fighting';
  if (team.next) return 'next';
  return team.local ? 'local' : undefined;
}

function TeamBlock({ game, team, expanded, onToggle }: { game: BgGameState; team: DuoTeam; expanded: number | null; onToggle: (pid: number) => void }) {
  const [a, b] = team.members;
  const lead = a;
  const label = team.local ? (b ? `You & ${b.heroName}` : 'You') : team.members.map((p) => p.heroName || 'Unknown hero').join(' & ');
  // Our combats against this team (recorded against either member), latest first.
  const combats = team.local ? [] : team.members.flatMap((p) => p.combatsAgainst).sort((x, y) => x.turn - y.turn);
  const last = combats[combats.length - 1];
  const hasBoards = team.members.some((p) => boardFor(game, p)?.length);
  return (
    <div className={clsx('tl-opp__row tl-opp__team', team.dead && 'is-dead', team.next && 'is-next', team.fighting && 'is-fighting', team.local && 'is-local')}>
      <Tooltip as="div" placement="left" delay={220} tipClassName="tl-tooltip--card" disabled={!hasBoards} content={() => <TeamBoardsTip game={game} team={team} />}>
        <div className="tl-opp__main">
          <span className={clsx('tl-opp__place', team.place === 1 && 'is-first')}>{team.place < 99 ? team.place : ''}</span>
          <span className="tl-opp__duo">
            {team.members.map((p) => (
              <HeroPortrait key={p.playerId} cardId={p.heroCardId} name={p.heroName} size={28} dead={p.dead} shape="rounded" glow={teamGlow(team, p, game)} />
            ))}
          </span>
          <div className="tl-opp__info">
            <div className="tl-opp__line">
              <span className="tl-opp__hero" title={label}>
                {label}
              </span>
              {team.next ? <span className="tl-tag is-next">Next</span> : null}
              {team.fighting ? <span className="tl-tag is-fighting">Fighting</span> : null}
              {!team.next && !team.fighting && last ? <ResultChip result={last.result} damage={last.damage} size="sm" /> : null}
            </div>
            {team.dead ? (
              <div className="tl-opp__dead">
                Eliminated{lead.diedOnTurn ? ` T${lead.diedOnTurn}` : ''} · <b>{ordinal(team.place)}</b>
              </div>
            ) : (
              <div className="tl-opp__line">
                <HealthBar health={lead.health} maxHealth={lead.maxHealth} armor={lead.armor} compact />
              </div>
            )}
          </div>
        </div>
      </Tooltip>
      {team.members.map((p) => (
        <MemberRow key={p.playerId} game={game} team={team} p={p} expanded={expanded === p.playerId} onToggle={() => onToggle(p.playerId)} />
      ))}
    </div>
  );
}

function MemberRow({ game, team, p, expanded, onToggle }: { game: BgGameState; team: DuoTeam; p: PlayerState; expanded: boolean; onToggle: () => void }) {
  const fighting = game.phase === 'combat' && game.currentOpponentPlayerId === p.playerId;
  const board = boardFor(game, p);
  const seen = seenAgo(game, p);
  // Your own board and eliminated teams stay one line unless expanded.
  const compactRow = p.isLocal || team.dead;
  const db = useApp((s) => s.cardDb);
  const tip = tipFor(db, p.heroCardId);
  return (
    <div
      className={clsx('tl-opp__member', p.isLocal && 'is-local', fighting && 'is-fighting', expanded && 'is-expanded')}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}
    >
      <Tooltip
        as="div"
        placement="left"
        delay={220}
        tipClassName="tl-tooltip--card"
        disabled={!board?.length && !tip}
        content={() => (
          <div className="tl-panel tl-boardtip">
            <div className="tl-boardtip__head">
              <span className="tl-boardtip__name">{p.isLocal ? 'Your board' : `${p.heroName}'s board`}</span>
              {seen && !p.isLocal ? <span className="tl-boardtip__seen">{seen}</span> : null}
            </div>
            {board?.length ? <BoardCards minions={board} width={board.length > 5 ? 128 : 150} /> : null}
            {tip && !p.isLocal ? (
              <div className="tl-boardtip__tip tl-parchment">
                <b>{p.heroName}:</b> {tip.tip}
              </div>
            ) : null}
          </div>
        )}
      >
        <div className="tl-opp__mline">
          <TierBadge tier={p.tavernTier} size={15} />
          <span className="tl-opp__mname" title={p.heroName}>
            {p.isLocal ? 'You' : p.heroName || 'Unknown hero'}
          </span>
          {p.isTeammate ? <span className="tl-tag is-mate">Mate</span> : null}
          {fighting ? <span className="tl-tag is-fighting">Fighting</span> : null}
          <TriplesBadge count={p.triples} />
          {seen && !p.isLocal && !(compactRow && !expanded) ? (
            <span className="tl-opp__mseen" title={p.lastBoard ? `Turn ${p.lastBoard.turn}` : undefined}>
              {seen.replace('Seen ', '')}
            </span>
          ) : null}
        </div>
        {compactRow && !expanded ? null : board && board.length ? (
          <div className="tl-opp__board">
            {board.map((m) => (
              <MinionToken key={m.entityId} minion={m} size="sm" tooltip={false} />
            ))}
          </div>
        ) : (
          <div className="tl-opp__noboard">{p.isLocal || p.lastBoard ? 'Empty board' : 'Board not seen yet'}</div>
        )}
      </Tooltip>
      {expanded ? <OpponentDetail game={game} p={p} board={board} /> : null}
    </div>
  );
}

function CollapsedTeam({ game, team }: { game: BgGameState; team: DuoTeam }) {
  const lead = team.members[0];
  return (
    <div
      className={clsx('tl-opp__mini tl-opp__mini--duo', team.dead && 'is-dead', team.next && 'is-next', team.fighting && 'is-fighting', team.local && 'is-local')}
      title={`${team.members.map((p) => (p.isLocal ? 'You' : p.heroName)).join(' & ')} · ${lead.health + lead.armor} hp`}
    >
      <span className="tl-opp__mini-place">{team.place < 99 ? team.place : ''}</span>
      <span className="tl-opp__mini-duo">
        {team.members.map((p) => (
          <HeroPortrait key={p.playerId} cardId={p.heroCardId} name={p.heroName} size={25} dead={p.dead} shape="rounded" glow={teamGlow(team, p, game)} />
        ))}
      </span>
      {team.dead ? <span className="tl-opp__mini-dead">Out</span> : <StatGem kind="hp" value={lead.health + lead.armor} size={19} className="tl-opp__mini-hp" />}
    </div>
  );
}
