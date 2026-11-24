import { LOBBY_TRIBES, type Tribe } from '@shared/types';
import { TribeChip } from '../components/Bits';
import { useLobbyTribes } from '../lib/synergy';

/**
 * Row of the 11 tribes: pick the tribes of a lobby (or take the live game's). Used by
 * the Heroes and Trinkets sections to re-rank and filter.
 */
export function TribeFilter({ value, onChange, label = 'Lobby tribes' }: { value: Tribe[]; onChange: (t: Tribe[]) => void; label?: string }) {
  const live = useLobbyTribes();
  const set = new Set(value);
  const toggle = (t: Tribe) => onChange(LOBBY_TRIBES.filter((x) => (x === t ? !set.has(t) : set.has(x))));
  const sameAsLive = live.tribes.length > 0 && live.tribes.length === value.length && live.tribes.every((t) => set.has(t));
  return (
    <div className="tl-toolbar tl-toolbar--tribes tl-tribefilter">
      <span className="tl-tribefilter__label">{label}</span>
      {LOBBY_TRIBES.map((t) => (
        <TribeChip key={t} tribe={t} compact onClick={() => toggle(t)} active={set.size === 0 || set.has(t)} />
      ))}
      {live.tribes.length && !sameAsLive ? (
        <button className="tl-btn tl-btn--ghost" onClick={() => onChange(live.tribes)}>
          Use live lobby
        </button>
      ) : null}
      {value.length ? (
        <button className="tl-btn tl-btn--ghost" onClick={() => onChange([])}>
          Clear
        </button>
      ) : null}
    </div>
  );
}
