import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { WidgetId } from '@shared/types';
import { useApp } from '../store/appStore';
import { acquireInteractive, releaseInteractive } from './useInteractive';
import { useViewport, type Viewport } from './useViewport';

export interface Size {
  width: number;
  height: number;
}

export type DefaultPosition = (vp: Viewport, size: Size) => { left: number; top: number };

/**
 * Positions a widget absolutely. If the user dragged it, the saved position
 * (fraction of the game window, top-left corner) is used; otherwise the
 * default is computed from the viewport and the widget's measured size.
 */
export function useDraggable(id: WidgetId, computeDefault: DefaultPosition, enabled = true) {
  const vp = useViewport();
  const saved = useApp((s) => s.settings.positions?.[id]);
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const [dragPos, setDragPos] = useState<{ left: number; top: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number; startX: number; startY: number; moved: boolean; key: symbol } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.width - r.width) > 0.5 || Math.abs(s.height - r.height) > 0.5 ? { width: r.width, height: r.height } : s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Once the saved position catches up with the drag, drop the local override.
  useEffect(() => {
    if (!drag.current) setDragPos(null);
  }, [saved?.x, saved?.y]);

  const base = saved ? { left: saved.x * vp.width, top: saved.y * vp.height } : computeDefault(vp, size);
  const raw = dragPos ?? base;
  const pos = {
    left: Math.round(Math.max(0, Math.min(raw.left, vp.width - size.width))),
    top: Math.round(Math.max(0, Math.min(raw.top, vp.height - size.height))),
  };

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!enabled || e.button !== 0 || !ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const key = Symbol('drag');
      drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top, startX: e.clientX, startY: e.clientY, moved: false, key };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      ref.current.dataset.tlDragging = 'true';
      acquireInteractive(key);
      e.preventDefault();
    },
    [enabled],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) return;
    d.moved = true;
    setDragPos({ left: e.clientX - d.dx, top: e.clientY - d.dy });
  }, []);

  const finish = useCallback(
    (e: React.PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      drag.current = null;
      if (ref.current) delete ref.current.dataset.tlDragging;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      releaseInteractive(d.key);
      if (!d.moved) return;
      const left = Math.max(0, Math.min(e.clientX - d.dx, vp.width - size.width));
      const top = Math.max(0, Math.min(e.clientY - d.dy, vp.height - size.height));
      const { settings, updateSettings } = useApp.getState();
      void updateSettings({
        positions: { ...settings.positions, [id]: { x: left / vp.width, y: top / vp.height } },
      });
    },
    [id, vp.width, vp.height, size.width, size.height],
  );

  const reset = useCallback(() => {
    const { settings, updateSettings } = useApp.getState();
    const positions = { ...settings.positions };
    delete positions[id];
    setDragPos(null);
    void updateSettings({ positions });
  }, [id]);

  const handleProps = enabled
    ? {
        onPointerDown,
        onPointerMove,
        onPointerUp: finish,
        onPointerCancel: finish,
        onDoubleClick: reset,
        title: 'Drag to move · double-click to reset',
      }
    : {};

  return { ref, pos, size, vp, dragging: dragPos !== null, handleProps };
}
