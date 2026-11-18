import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useApp } from '../../store/appStore';
import { tierCurveFor, tierPace, turnReached } from '@core/stats/tierCurve';
import { PlacementPips, TierBadge, TribeEmblem } from '../../components/Bits';
import { DeltaBadge } from '../../components/Synergy';
import { Tooltip } from '../../components/Tooltip';
import { cleanCardText, num } from '../../lib/format';
import { sortByDate, summarize, todays } from '../../lib/stats';
import { tribeLabel } from '../../lib/tribes';
import { heroStatFor, heroSynergy, signedDelta, useLobbyTribes } from '../../lib/synergy';
import { useViewport } from '../../hooks/useViewport';
import { DragHandle, FloatingWidget } from '../Widget';
import { bottomLeftMaxWidth } from '../layout';

/** Rendered height of the dock (window px, 0 when hidden): the hero-pick tribe picker sits above it. */
export const useDock = create<{ height: number }>(() => ({ height: 0 }));
const reportSize = (size: { height: number }) => useDock.setState({ height: Math.round(size.height) });

/**
 * One small plaque in the bottom-left corner. Lobby line: turn, the lobby's tribes, your
 * hero's expected placement here, the anomaly. Session line: games today, average and
 * the last placements. Details are in the hover tooltips. Either line can be turned off
 * (Lobby info / Session tracker); the session line hides while the post-match summary,
 * which has its own session section, is up.
 */
export function DockWidget({ lobby: lobbyOn, session: sessionOn, tierPace = false }: { lobby: boolean; session: boolean; tierPace?: boolean }) {
  const game = useApp((s) => s.game);
  const history = useApp((s) => s.history);
  const postMatchUp = useApp(
    (s) => s.game?.phase === 'gameOver' && s.dismissedPostMatch !== s.game.gameId && s.settings.widgets.postMatch !== false && !s.hidden.postMatch,
  );
  const vp = useViewport();
  const showLobby = lobbyOn && !!game && game.active && game.phase !== 'idle' && game.phase !== 'gameOver';
  const showSession = sessionOn && !postMatchUp && history.length > 0;
  const shown = showLobby || showSession;
  useEffect(() => {
    if (!shown) useDock.setState({ height: 0 });
  }, [shown]);
  if (!shown) return null;
  return (
    <FloatingWidget id="lobbyInfo" defaultPosition={(vp, size) => ({ left: 10, top: vp.height - size.height - 10 })} zIndex={20} maxWidth={bottomLeftMaxWidth(vp)} onSize={reportSize}>
      {(handle) => (
        <div className="tl-panel tl-dock">
          <DragHandle handle={handle} />
          <div className="tl-dock__lines">
            {showLobby ? <LobbyLine tierPace={tierPace} /> : null}
            {showSession ? <SessionLine /> : null}
          </div>
        </div>
      )}
    </FloatingWidget>
  );
}

function LobbyLine({ tierPace }: { tierPace: boolean }) {
  const game = useApp((s) => s.game)!;
  const db = useApp((s) => s.cardDb);
  const lobby = useLobbyTribes();
  const anomaly = db.get(game.anomalyCardId);
  const manual = lobby.source === 'manual';
  return (
    <div className="tl-dock__line">
      <span className="tl-dock__turn">{game.phase === 'heroSelection' ? 'Hero pick' : `Turn ${game.turn}`}</span>
      {game.phase === 'heroSelection' ? null : lobby.tribes.length ? (
        <Tooltip
          placement="top"
          content={
            <div>
              <b>{lobby.tribes.map(tribeLabel).join(' · ')}</b>
              <div>{manual ? 'Your pick at hero selection.' : lobby.inferred ? 'Inferred from the minions seen so far.' : 'Minion types in this lobby.'}</div>
            </div>
          }
        >
          <span className={manual || lobby.inferred ? 'tl-dock__tribes is-inferred' : 'tl-dock__tribes'}>
            {lobby.tribes.map((t) => (
              <TribeEmblem key={t} tribe={t} size={19} />
            ))}
          </span>
        </Tooltip>
      ) : (
        <span className="tl-muted tl-small">Tribes unknown</span>
      )}
      {game.phase !== 'heroSelection' ? <HeroEstimate /> : null}
      {tierPace && game.phase === 'recruit' ? <TierPaceChip /> : null}
      {anomaly ? (
        <Tooltip
          placement="top"
          content={
            <div className="tl-anomaly-tip">
              <div className="tl-cardtip__name">{anomaly.name}</div>
              <p className="tl-cardtip__body" dangerouslySetInnerHTML={{ __html: cleanCardText(anomaly.text) }} />
            </div>
          }
        >
          <span className="tl-dock__anomaly">
            <i>✦</i>
            {anomaly.name}
          </span>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Your hero's expected placement in this lobby (overall average + tribe impacts). */
function HeroEstimate() {
  const db = useApp((s) => s.cardDb);
  const game = useApp((s) => s.game);
  const bundles = useApp((s) => s.heroStats);
  const community = useApp((s) => s.settings.communityStats);
  const lobby = useLobbyTribes();
  const local = game?.players.find((p) => p.isLocal);
  const heroId = db.baseHeroId(game?.chosenHeroCardId ?? local?.heroCardId ?? '');
  if (!heroId || !lobby.tribes.length) return null;
  const found = heroStatFor(bundles, heroId, { mode: game?.mode, community });
  if (!found) return null;
  const syn = heroSynergy(found.stat, found.bundle.source, lobby.tribes, game?.mode);
  if (!syn.estimate || syn.delta === undefined) return null;
  return (
    <Tooltip
      placement="top"
      content={
        <div className="tl-picktip">
          <div className="tl-cardtip__name">{db.name(heroId)} in this lobby</div>
          <div className="tl-picktip__row">
            <span>Overall average</span>
            <b>{num(found.stat.avgPlacement, 2)}</b>
          </div>
          {syn.estimate.contributions.map((c) => (
            <div key={c.tribe} className="tl-picktip__row">
              <span>
                <TribeEmblem tribe={c.tribe} size={14} /> {tribeLabel(c.tribe)}
              </span>
              <b className={c.impact < 0 ? 'is-good' : 'is-bad'}>{signedDelta(c.impact)}</b>
            </div>
          ))}
          <div className="tl-picktip__row is-total">
            <span>Expected placement</span>
            <b>≈ {num(syn.estimate.avgPlacement, 2)}</b>
          </div>
        </div>
      }
    >
      <span className="tl-dock__est">
        <b>≈{num(syn.estimate.avgPlacement, 2)}</b>
        <DeltaBadge delta={syn.delta} />
      </span>
    </Tooltip>
  );
}

/**
 * Tier-up pace: your tavern tier against the turn your top-4 games (with this hero, else
 * with any hero) usually reach it. Hidden unless there is history behind the curve.
 */
function TierPaceChip() {
  const db = useApp((s) => s.cardDb);
  const game = useApp((s) => s.game);
  const bundles = useApp((s) => s.heroStats);
  const local = game?.players.find((p) => p.isLocal);
  const heroId = db.baseHeroId(game?.chosenHeroCardId ?? local?.heroCardId ?? '');
  const curve = heroId ? tierCurveFor(bundles, heroId, game?.mode) : undefined;
  if (!game || !local || !curve) return null;
  const pace = tierPace(curve, local.tavernTier, game.turn);
  if (!pace) return null;
  const tone = pace.delta < 0 ? 'is-behind' : pace.delta > 0 ? 'is-ahead' : 'is-even';
  const top = game.mode === 'duos' ? 'top-2' : 'top-4';
  return (
    <Tooltip
      placement="top"
      content={
        <div className="tl-picktip tl-pacetip">
          <div className="tl-cardtip__name">Tier-up timing</div>
          <div className="tl-pacetip__grid">
            <span className="tl-pacetip__h">Tier</span>
            <span className="tl-pacetip__h">Usually</span>
            <span className="tl-pacetip__h">This game</span>
            {[2, 3, 4, 5, 6].map((tier) => {
              const row = curve.tiers.find((t) => t.tier === tier);
              const mine = turnReached(local.tierHistory, tier);
              const typical = row ? Math.round(row.turn) : undefined;
              const cls = mine !== undefined && typical !== undefined ? (mine < typical ? 'is-good' : mine > typical ? 'is-bad' : '') : '';
              return [
                <span key={`t${tier}`}>
                  <TierBadge tier={tier} size={13} />
                </span>,
                <b key={`u${tier}`}>{typical !== undefined ? `turn ${typical}` : '—'}</b>,
                <b key={`m${tier}`} className={cls}>
                  {mine !== undefined ? `turn ${mine}` : '·'}
                </b>,
              ];
            })}
          </div>
          <div className="tl-pacetip__note">
            Median over your {curve.games} {top} games{curve.scope === 'hero' ? ` with ${db.name(heroId)}` : ' (all heroes)'}.
          </div>
        </div>
      }
    >
      <span className={`tl-dock__pace ${tone}`}>
        <TierBadge tier={pace.tier} size={13} title="" />
        <span>{pace.label}</span>
      </span>
    </Tooltip>
  );
}

function SessionLine() {
  const history = useApp((s) => s.history);
  const rating = useApp((s) => s.settings.manualRating);
  const sorted = useMemo(() => sortByDate(history), [history]);
  const today = useMemo(() => summarize(todays(history)), [history]);
  const last = sorted.slice(0, 8).map((m) => m.placement).reverse();
  const latestRating = sorted.find((m) => m.ratingAfter)?.ratingAfter ?? rating;
  return (
    <Tooltip
      as="div"
      placement="top"
      content={
        <div>
          <b>Today:</b> {today.games} game{today.games === 1 ? '' : 's'}
          {today.games ? ` · average ${num(today.avgPlacement, 2)} · top 4 ${Math.round(today.top4Rate)}%` : ''}
          {latestRating ? <div>Rating {latestRating.toLocaleString()}</div> : null}
        </div>
      }
    >
      <div className="tl-dock__line is-session">
        <span className="tl-dock__today">
          <b>{today.games}</b> today{today.games ? <> · avg <b>{num(today.avgPlacement, 2)}</b></> : null}
        </span>
        <PlacementPips placements={last} size={14} />
      </div>
    </Tooltip>
  );
}
