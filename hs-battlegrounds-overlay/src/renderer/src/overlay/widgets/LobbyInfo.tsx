import { useApp } from '../../store/appStore';
import { TribeChip } from '../../components/Bits';
import { Tooltip } from '../../components/Tooltip';
import { cleanCardText } from '../../lib/format';
import { useViewport } from '../../hooks/useViewport';
import { DragHandle, FloatingWidget } from '../Widget';
import { bottomLeftMaxWidth, effectiveScale } from '../layout';
import { SESSION_HEIGHT } from './SessionWidget';

/**
 * Small badge: mode, turn, lobby tribes and anomaly. Docked bottom-left, just above the
 * session widget, in every phase (the top of the screen belongs to the tier bar and the
 * battle plaque, the bottom centre to the hand), so it never jumps between phases.
 */
export function LobbyInfoWidget() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  const settingsScale = useApp((s) => s.settings.scale);
  const sessionShown = useApp(
    (s) => s.history.length > 0 && s.settings.widgets.sessionStats !== false && !s.hidden.sessionStats,
  );
  const vp = useViewport();
  if (!game || !game.active || game.phase === 'idle' || game.phase === 'gameOver') return null;
  const anomaly = db.get(game.anomalyCardId);
  const inferred = game.tribesSource === 'inferred';
  const scale = effectiveScale(settingsScale, vp);
  return (
    <FloatingWidget
      id="lobbyInfo"
      defaultPosition={(vp, size) => ({ left: 10, top: vp.height - size.height - 10 - (sessionShown ? Math.round(SESSION_HEIGHT * scale) + 6 : 0) })}
      zIndex={20}
    >
      {(handle) => (
        <div className="tl-plaque tl-lobby" style={{ maxWidth: `calc(${Math.round(bottomLeftMaxWidth(vp))}px / var(--tl-scale))` }}>
          <DragHandle handle={handle} />
          <span className="tl-lobby__mode">{game.mode === 'duos' ? 'Duos' : 'Solo'}</span>
          <span className="tl-lobby__turn">{game.phase === 'heroSelection' ? 'Hero pick' : `Turn ${game.turn}`}</span>
          {game.availableTribes.length ? (
            <Tooltip
              content={
                inferred
                  ? 'Tribes inferred from minions seen so far (the log did not list them).'
                  : 'Minion types in this lobby.'
              }
              placement="top"
            >
              <span className={inferred ? 'tl-lobby__tribes is-inferred' : 'tl-lobby__tribes'}>
                {game.availableTribes.map((t) => (
                  <TribeChip key={t} tribe={t} compact />
                ))}
                {inferred ? <span className="tl-lobby__inferred">inferred</span> : null}
              </span>
            </Tooltip>
          ) : (
            <span className="tl-muted tl-small">Tribes unknown</span>
          )}
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
