import { useApp } from '../../store/appStore';
import { TribeChip } from '../../components/Bits';
import { Tooltip } from '../../components/Tooltip';
import { cleanCardText } from '../../lib/format';
import { DragHandle, FloatingWidget } from '../Widget';

/** Small badge: mode, turn, lobby tribes and anomaly. */
export function LobbyInfoWidget() {
  const game = useApp((s) => s.game);
  const db = useApp((s) => s.cardDb);
  // Hidden during combat: the battle simulation owns the top of the screen then.
  if (!game || !game.active || game.phase === 'idle' || game.phase === 'gameOver' || game.phase === 'combat') return null;
  const anomaly = db.get(game.anomalyCardId);
  const inferred = game.tribesSource === 'inferred';
  return (
    <FloatingWidget
      id="lobbyInfo"
      // During the hero pick the top row belongs to the hero stat cards.
      defaultPosition={(vp, size) => (game.phase === 'heroSelection' ? { left: 10, top: vp.height - size.height - 62 } : { left: 10, top: 52 })}
      zIndex={20}
    >
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
