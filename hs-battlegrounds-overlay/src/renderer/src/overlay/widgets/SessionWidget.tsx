import { useMemo } from 'react';
import { useApp } from '../../store/appStore';
import { PlacementPips } from '../../components/Bits';
import { num } from '../../lib/format';
import { sortByDate, summarize, todays } from '../../lib/stats';
import { DragHandle, FloatingWidget } from '../Widget';

/** Games today, average placement and the last 10 placements. */
export function SessionWidget() {
  const history = useApp((s) => s.history);
  const phase = useApp((s) => s.game?.phase);
  const rating = useApp((s) => s.settings.manualRating);
  const sorted = useMemo(() => sortByDate(history), [history]);
  const today = useMemo(() => summarize(todays(history)), [history]);
  if (phase === 'combat' || phase === 'gameOver' || history.length === 0) return null;
  const last10 = sorted.slice(0, 10).map((m) => m.placement).reverse();
  const latestRating = sorted.find((m) => m.ratingAfter)?.ratingAfter ?? rating;
  return (
    <FloatingWidget id="sessionStats" defaultPosition={(vp, size) => ({ left: 10, top: vp.height - size.height - 10 })} zIndex={10}>
      {(handle) => (
        <div className="tl-plaque tl-session">
          <DragHandle handle={handle} />
          <div className="tl-session__block">
            <span className="tl-session__value">{today.games}</span>
            <span className="tl-session__label">today</span>
          </div>
          <div className="tl-session__block">
            <span className="tl-session__value">{today.games ? num(today.avgPlacement, 2) : '—'}</span>
            <span className="tl-session__label">avg place</span>
          </div>
          {latestRating ? (
            <div className="tl-session__block">
              <span className="tl-session__value tl-gold">{latestRating.toLocaleString()}</span>
              <span className="tl-session__label">rating</span>
            </div>
          ) : null}
          <div className="tl-session__pips">
            <PlacementPips placements={last10} size={15} />
            <span className="tl-session__label">last {last10.length}</span>
          </div>
        </div>
      )}
    </FloatingWidget>
  );
}
