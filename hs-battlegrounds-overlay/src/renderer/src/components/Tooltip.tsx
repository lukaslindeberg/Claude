import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';

export interface TooltipProps {
  content: ReactNode | (() => ReactNode);
  children: ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  tipClassName?: string;
  delay?: number;
  disabled?: boolean;
  as?: 'span' | 'div';
}

/**
 * Hover tooltip rendered in a portal and kept inside the viewport. Works in the
 * click-through overlay too, because the main process forwards mouse moves.
 */
export function Tooltip({ content, children, placement = 'top', className, tipClassName, delay = 120, disabled, as = 'span' }: TooltipProps) {
  const anchor = useRef<HTMLElement | null>(null);
  const tip = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const show = () => {
    if (disabled) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  };

  useLayoutEffect(() => {
    if (!open || !anchor.current || !tip.current) return;
    const a = anchor.current.getBoundingClientRect();
    const t = tip.current.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = placement;
    if (side === 'top' && a.top - t.height - gap < 0) side = 'bottom';
    else if (side === 'bottom' && a.bottom + t.height + gap > vh) side = 'top';
    else if (side === 'left' && a.left - t.width - gap < 0) side = 'right';
    else if (side === 'right' && a.right + t.width + gap > vw) side = 'left';
    let left = 0;
    let top = 0;
    if (side === 'top' || side === 'bottom') {
      left = a.left + a.width / 2 - t.width / 2;
      top = side === 'top' ? a.top - t.height - gap : a.bottom + gap;
    } else {
      top = a.top + a.height / 2 - t.height / 2;
      left = side === 'left' ? a.left - t.width - gap : a.right + gap;
    }
    left = Math.max(6, Math.min(left, vw - t.width - 6));
    top = Math.max(6, Math.min(top, vh - t.height - 6));
    setPos({ left, top });
  }, [open, placement]);

  const Tag = as;
  return (
    <>
      <Tag
        ref={anchor as never}
        className={clsx('tl-tip-anchor', className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onPointerDown={hide}
      >
        {children}
      </Tag>
      {open
        ? createPortal(
            <div
              ref={tip}
              className={clsx('tl-tooltip', tipClassName)}
              style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
              role="tooltip"
            >
              <div className="tl-tooltip__body">{typeof content === 'function' ? content() : content}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
