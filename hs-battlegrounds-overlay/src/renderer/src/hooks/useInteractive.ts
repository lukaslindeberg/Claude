import { useCallback, useEffect, useRef } from 'react';
import { useApp } from '../store/appStore';

/**
 * The overlay window is click-through by default; the main process forwards
 * mouse moves so pointerenter/leave still fire. Interactive widgets "hold" the
 * window interactive while the pointer is over them (or while dragging).
 *
 * Holders are reference counted so nested interactive elements and moving
 * directly from one widget to another never flicker, and a drag keeps the
 * window interactive even if the pointer briefly leaves the widget.
 */
const holders = new Set<symbol>();
let current = false;
let scheduled = false;

function apply() {
  scheduled = false;
  const want = holders.size > 0;
  if (want === current) return;
  current = want;
  useApp.getState().bridge?.setInteractive(want);
}

function schedule(immediate: boolean) {
  if (immediate) {
    apply();
    return;
  }
  if (scheduled) return;
  scheduled = true;
  // Defer releases one frame: leaving widget A and entering widget B happen in
  // the same dispatch, so B's hold arrives before we would release.
  requestAnimationFrame(apply);
}

export function acquireInteractive(key: symbol) {
  holders.add(key);
  schedule(true);
}

export function releaseInteractive(key: symbol) {
  if (holders.delete(key)) schedule(false);
}

/** Release everything (pointer left the window). */
export function releaseAllInteractive() {
  holders.clear();
  schedule(false);
}

if (typeof document !== 'undefined') {
  document.documentElement.addEventListener('mouseleave', releaseAllInteractive);
  window.addEventListener('blur', () => {
    // Keep drags alive; otherwise drop holds when the window loses focus.
    if (!document.querySelector('[data-tl-dragging="true"]')) releaseAllInteractive();
  });
}

export interface InteractiveProps {
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
}

/**
 * Spread the returned props on an interactive element:
 * `<div {...useInteractive()}>`. Pass `false` to disable (e.g. collapsed).
 */
export function useInteractive(enabled = true): InteractiveProps {
  const key = useRef<symbol>(Symbol('interactive'));
  const inside = useRef(false);

  useEffect(() => {
    const k = key.current;
    if (!enabled && inside.current) releaseInteractive(k);
    else if (enabled && inside.current) acquireInteractive(k);
    return () => releaseInteractive(k);
  }, [enabled]);

  const onPointerEnter = useCallback(() => {
    inside.current = true;
    if (enabled) acquireInteractive(key.current);
  }, [enabled]);
  const onPointerLeave = useCallback(() => {
    inside.current = false;
    releaseInteractive(key.current);
  }, []);
  return { onPointerEnter, onPointerLeave };
}

/** Hold the window interactive while `active` is true (e.g. an open menu). */
export function useHoldInteractive(active: boolean) {
  const key = useRef<symbol>(Symbol('hold'));
  useEffect(() => {
    const k = key.current;
    if (active) acquireInteractive(k);
    else releaseInteractive(k);
    return () => releaseInteractive(k);
  }, [active]);
}
