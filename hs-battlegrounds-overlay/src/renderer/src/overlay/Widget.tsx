import clsx from 'clsx';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { WidgetId } from '@shared/types';
import { useDraggable, type DefaultPosition } from '../hooks/useDraggable';
import { useInteractive } from '../hooks/useInteractive';
import { GripIcon } from '../components/Icons';
import { useApp } from '../store/appStore';
import { useViewport } from '../hooks/useViewport';
import { effectiveScale } from './layout';

export type HandleProps = ReturnType<typeof useDraggable>['handleProps'];

export interface FloatingWidgetProps {
  id: WidgetId;
  defaultPosition: DefaultPosition;
  draggable?: boolean;
  /** Capture the mouse while hovered (needed for clicks and drags). */
  interactive?: boolean;
  className?: string;
  children: (handle: HandleProps) => ReactNode;
  zIndex?: number;
  /** Told when the pointer enters or leaves the widget (interactive widgets only). */
  onHoverChange?: (inside: boolean) => void;
  /** Zoom for this widget instead of the overlay scale (to fit beside the game's buttons). */
  scale?: number;
  /** Told the widget's rendered size (window px) whenever it changes. */
  onSize?: (size: { width: number; height: number }) => void;
  /** Widest the widget may render (window px): it shrinks (down to 85 %) to stay within. */
  maxWidth?: number;
}

/** Absolutely positioned, scale-aware overlay widget. */
export function FloatingWidget({ id, defaultPosition, draggable = true, interactive = true, className, children, zIndex, onHoverChange, scale, onSize, maxWidth }: FloatingWidgetProps) {
  const { ref, pos, size, handleProps, dragging } = useDraggable(id, defaultPosition, draggable);
  const vp = useViewport();
  const overlayScale = useApp((s) => effectiveScale(s.settings.scale, vp));
  const want = scale ?? overlayScale;
  const [fit, setFit] = useState<number | undefined>();
  const zoom = fit !== undefined ? Math.min(want, fit) : want;
  useEffect(() => onSize?.(size), [size, onSize]);
  // Shrink-to-fit: the content never wraps, so its unzoomed width is the measured width
  // over the zoom it was measured at (re-evaluated only when a new measurement lands).
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const natural = useRef(0);
  useEffect(() => {
    if (size.width) natural.current = size.width / zoomRef.current;
  }, [size.width]);
  useEffect(() => {
    if (!maxWidth || !natural.current) return setFit(undefined);
    const f = Math.max(0.85, maxWidth / natural.current);
    setFit((cur) => (f >= want - 0.005 ? undefined : cur !== undefined && Math.abs(cur - f) < 0.01 ? cur : f));
  }, [maxWidth, size.width, want]);
  const inter = useInteractive(interactive, onHoverChange);
  return (
    <div
      ref={ref}
      className={clsx('tl-widget', `tl-widget--${id}`, dragging && 'is-dragging', className)}
      style={{ left: pos.left, top: pos.top, zIndex, ...(zoom !== overlayScale ? ({ '--tl-scale': String(zoom) } as React.CSSProperties) : null) }}
      data-widget={id}
      {...(interactive ? inter : {})}
    >
      <div className="tl-widget__scale">{children(handleProps)}</div>
    </div>
  );
}

export function DragHandle({ handle, className }: { handle: HandleProps; className?: string }) {
  if (!('onPointerDown' in handle)) return null;
  return (
    <span className={clsx('tl-grip', className)} {...handle}>
      <GripIcon size={13} />
    </span>
  );
}
