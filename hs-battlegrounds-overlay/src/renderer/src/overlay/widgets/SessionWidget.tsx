import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { useApp } from '../../store/appStore';
import { PlacementPips } from '../../components/Bits';
import { num } from '../../lib/format';
import { sortByDate, summarize, todays } from '../../lib/stats';
import { useViewport } from '../../hooks/useViewport';
import { DragHandle, FloatingWidget } from '../Widget';
import { bottomLeftMaxWidth } from '../layout';

/** Rendered height of the session plaque (window px, 0 when hidden): the lobby badge docks above it. */
export const useSessionDock = create<{ height: number }>(() => ({ height: 0 }));
const reportSize = (size: { height: number }) => useSessionDock.setState({ height: Math.round(size.height) });

/**
 * Games today, average placement and the last 10 placements. Shown in every phase
 * except while the post-match summary (which has its own session section) is up.
 */
export function SessionWidget() {
  const history = useApp((s) => s.history);
  const postMatchUp = useApp(
    (s) => s.game?.phase === 'gameOver' && s.dismissedPostMatch !== s.game.gameId && s.settings.widgets.postMatch !== false && !s.hidden.postMatch,
  );
  const rating = useApp((s) => s.settings.manualRating);
  const vp = useViewport();
  const sorted = useMemo(() => sortByDate(history), [history]);
  const today = useMemo(() => summarize(todays(history)), [history]);
  const shown = !postMatchUp && history.length > 0;
  useEffect(() => {
    if (!shown) useSessionDock.setState({ height: 0 });
  }, [shown]);
  if (!shown) return null;
  const last10 = sorted.slice(0, 10).map((m) => m.placement).reverse();
  const latestRating = sorted.find((m) => m.ratingAfter)?.ratingAfter ?? rating;
  return (
    <FloatingWidget id="sessionStats" defaultPosition={(vp, size) => ({ left: 10, top: vp.height - size.height - 10 })} zIndex={10} onSize={reportSize} maxWidth={bottomLeftMaxWidth(vp)}>
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
            <PlacementPips placements={last10} size={14} />
            <span className="tl-session__label">last {last10.length}</span>
          </div>
        </div>
      )}
    </FloatingWidget>
  );
}
