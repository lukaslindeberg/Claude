import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useApp } from '../../store/appStore';
import { useViewport } from '../../hooks/useViewport';
import { effectiveScale } from '../layout';

export interface PickRowProps {
  /** Horizontal centre of each card (window px). */
  centers: number[];
  top: number;
  /** The cards must end above this y (window px): the game's own cards start there. */
  bottom: number;
  /** Unscaled card width (CSS px). */
  cardWidth: number;
  className?: string;
  keys: (string | number)[];
  children: (index: number) => ReactNode;
}

/**
 * A row of stat cards centred over the game's pick cards (heroes, trinkets). The row
 * zooms like the rest of the overlay, but shrinks when the cards would overlap each
 * other or reach down into the game's cards (large scale settings, 4:3 windows).
 */
export function PickRow({ centers, top, bottom, cardWidth, className, keys, children }: PickRowProps) {
  const vp = useViewport();
  const want = useApp((s) => effectiveScale(s.settings.scale, vp));
  const ref = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState(0);
  const spacing = centers.length > 1 ? centers[1] - centers[0] : Infinity;
  const fitW = (spacing - 10) / cardWidth;
  const fitH = natural ? (bottom - top) / natural : Infinity;
  const zoom = Math.max(0.55, Math.min(want, fitW, fitH));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      let h = 0;
      for (const card of el.querySelectorAll<HTMLElement>('[data-pick-card]')) h = Math.max(h, card.getBoundingClientRect().height);
      // Unzoomed height: the measured height over the zoom it was rendered at.
      const n = Math.round(h / zoomRef.current);
      setNatural((cur) => (Math.abs(cur - n) > 2 ? n : cur));
    };
    const ro = new ResizeObserver(measure);
    for (const card of el.querySelectorAll<HTMLElement>('[data-pick-card]')) ro.observe(card);
    measure();
    return () => ro.disconnect();
  }, [keys.join('|')]);

  return (
    <div ref={ref} className={clsx('tl-heropick', className)} style={{ top, '--tl-scale': String(zoom) } as React.CSSProperties}>
      {centers.map((x, i) => (
        <div key={keys[i] ?? i} className="tl-heropick__slot" style={{ left: x }}>
          <div className="tl-widget__scale" data-pick-card>
            {children(i)}
          </div>
        </div>
      ))}
    </div>
  );
}
