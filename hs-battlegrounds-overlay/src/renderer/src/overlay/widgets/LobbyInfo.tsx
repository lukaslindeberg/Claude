import { useApp } from '../../store/appStore';
import { TribeChip } from '../../components/Bits';
import { Tooltip } from '../../components/Tooltip';
import { cleanCardText } from '../../lib/format';
import { DragHandle, FloatingWidget } from '../Widget';

/** Small badge: mode, turn, lobby tribes and anomaly. */
export function LobbyInfoWidget() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  if (!game || !game.active || game.phase === 'idle' || game.phase === 'gameOver') return null;
  const anomaly = db.get(game.anomalyCardId);
  const inferred = game.tribesSource === 'inferred';
  return (
    <FloatingWidget id="lobbyInfo" defaultPosition={() => ({ left: 10, top: 52 })} zIndex={20}>
      {(handle) => (
        <div className="tl-panel tl-lobby">
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
              placement="bottom"
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
              placement="bottom"
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
