import { create } from 'zustand';
import { useEffect } from 'react';
import { useApp } from '../../store/appStore';
import { TribeChip, TribeEmblem } from '../../components/Bits';
import { DeltaBadge } from '../../components/Synergy';
import { Tooltip } from '../../components/Tooltip';
import { cleanCardText, num } from '../../lib/format';
import { tribeLabel } from '../../lib/tribes';
import { heroStatFor, heroSynergy, signedDelta, useLobbyTribes } from '../../lib/synergy';
import { useViewport } from '../../hooks/useViewport';
import { DragHandle, FloatingWidget } from '../Widget';
import { bottomLeftMaxWidth } from '../layout';
import { useSessionDock } from './SessionWidget';

/** Rendered height of the lobby plaque (window px, 0 when hidden): the hero-pick tribe picker docks above it. */
export const useLobbyDock = create<{ height: number }>(() => ({ height: 0 }));
const reportSize = (size: { height: number }) => useLobbyDock.setState({ height: Math.round(size.height) });

/**
 * Small badge: mode, turn, lobby tribes, your hero's expected placement in this lobby and
 * the anomaly. Docked bottom-left, just above the session widget, in every phase (the top
 * of the screen belongs to the tier bar and the battle plaque, the bottom centre to the
 * hand), so it never jumps between phases.
 */
export function LobbyInfoWidget() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  // Docked above the session plaque (its measured height; 0 when it isn't shown).
  const sessionHeight = useSessionDock((s) => s.height);
  const vp = useViewport();
  const lobby = useLobbyTribes();
  const shown = !!game && game.active && game.phase !== 'idle' && game.phase !== 'gameOver';
  useEffect(() => {
    if (!shown) useLobbyDock.setState({ height: 0 });
  }, [shown]);
  if (!shown || !game) return null;
  const anomaly = db.get(game.anomalyCardId);
  const manual = lobby.source === 'manual';
  return (
    <FloatingWidget
      id="lobbyInfo"
      defaultPosition={(vp, size) => ({ left: 10, top: vp.height - size.height - 10 - (sessionHeight ? sessionHeight + 6 : 0) })}
      zIndex={20}
      maxWidth={bottomLeftMaxWidth(vp)}
      onSize={reportSize}
    >
      {(handle) => (
        <div className="tl-plaque tl-lobby">
          <DragHandle handle={handle} />
          <span className="tl-lobby__mode">{game.mode === 'duos' ? 'Duos' : 'Solo'}</span>
          <span className="tl-lobby__turn">{game.phase === 'heroSelection' ? 'Hero pick' : `Turn ${game.turn}`}</span>
          {lobby.tribes.length ? (
            <Tooltip
              content={
                manual
                  ? 'Tribes you picked at hero selection (the log has not listed them yet).'
                  : lobby.inferred
                    ? 'Tribes inferred from minions seen so far (the log did not list them).'
                    : 'Minion types in this lobby.'
              }
              placement="top"
            >
              <span className={manual || lobby.inferred ? 'tl-lobby__tribes is-inferred' : 'tl-lobby__tribes'}>
                {lobby.tribes.map((t) => (
                  <TribeChip key={t} tribe={t} compact />
                ))}
                {manual ? <span className="tl-lobby__inferred">your pick</span> : lobby.inferred ? <span className="tl-lobby__inferred">inferred</span> : null}
              </span>
            </Tooltip>
          ) : (
            <span className="tl-muted tl-small">Tribes unknown</span>
          )}
          {game.phase !== 'heroSelection' ? <HeroEstimate /> : null}
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
              <span className="tl-lobby__anomaly">
                <i>✦</i>
                {anomaly.name}
              </span>
            </Tooltip>
          ) : null}
        </div>
      )}
    </FloatingWidget>
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
        <div className="tl-esttip">
          <div className="tl-cardtip__name">{db.name(heroId)} in this lobby</div>
          <div className="tl-esttip__row">
            <span>Overall average</span>
            <b>{num(found.stat.avgPlacement, 2)}</b>
          </div>
          {syn.estimate.contributions.map((c) => (
            <div key={c.tribe} className="tl-esttip__row">
              <span>
                <TribeEmblem tribe={c.tribe} size={14} /> {tribeLabel(c.tribe)}
              </span>
              <b className={c.impact < 0 ? 'is-good' : 'is-bad'}>{signedDelta(c.impact)}</b>
            </div>
          ))}
          <div className="tl-esttip__row is-total">
            <span>Expected placement</span>
            <b>≈ {num(syn.estimate.avgPlacement, 2)}</b>
          </div>
        </div>
      }
    >
      <span className="tl-lobby__est">
        <span className="tl-lobby__est-label">You ≈</span>
        <b>{num(syn.estimate.avgPlacement, 2)}</b>
        <DeltaBadge delta={syn.delta} />
      </span>
    </Tooltip>
  );
}
