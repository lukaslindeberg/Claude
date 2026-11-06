import clsx from 'clsx';
import type { ReactNode } from 'react';
import type { WidgetId } from '@shared/types';
import { useDraggable, type DefaultPosition } from '../hooks/useDraggable';
import { useInteractive } from '../hooks/useInteractive';
import { GripIcon } from '../components/Icons';

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
}

/** Absolutely positioned, scale-aware overlay widget. */
export function FloatingWidget({ id, defaultPosition, draggable = true, interactive = true, className, children, zIndex }: FloatingWidgetProps) {
  const { ref, pos, handleProps, dragging } = useDraggable(id, defaultPosition, draggable);
  const inter = useInteractive(interactive);
  return (
    <div
      ref={ref}
      className={clsx('tl-widget', `tl-widget--${id}`, dragging && 'is-dragging', className)}
      style={{ left: pos.left, top: pos.top, zIndex }}
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
      <GripIcon size={12} />
    </span>
  );
}
