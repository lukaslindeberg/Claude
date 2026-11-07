import { useApp } from '../../store/appStore';
import { TribeChip } from '../../components/Bits';
import { Tooltip } from '../../components/Tooltip';
import { cleanCardText } from '../../lib/format';
import { useViewport } from '../../hooks/useViewport';
import { DragHandle, FloatingWidget } from '../Widget';
import { bottomLeftMaxWidth } from '../layout';
import { useSessionDock } from './SessionWidget';

/**
 * Small badge: mode, turn, lobby tribes and anomaly. Docked bottom-left, just above the
 * session widget, in every phase (the top of the screen belongs to the tier bar and the
 * battle plaque, the bottom centre to the hand), so it never jumps between phases.
 */
export function LobbyInfoWidget() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  // Docked above the session plaque (its measured height; 0 when it isn't shown).
  const sessionHeight = useSessionDock((s) => s.height);
  const vp = useViewport();
  if (!game || !game.active || game.phase === 'idle' || game.phase === 'gameOver') return null;
  const anomaly = db.get(game.anomalyCardId);
  const inferred = game.tribesSource === 'inferred';
  return (
    <FloatingWidget
      id="lobbyInfo"
      defaultPosition={(vp, size) => ({ left: 10, top: vp.height - size.height - 10 - (sessionHeight ? sessionHeight + 6 : 0) })}
      zIndex={20}
      maxWidth={bottomLeftMaxWidth(vp)}
    >
      {(handle) => (
        <div className="tl-plaque tl-lobby">
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
