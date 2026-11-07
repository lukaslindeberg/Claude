import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
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
/** Holds that belong to a drag: they survive the pointer leaving the window. */
const dragHolders = new Set<symbol>();
let current = false;
let scheduled = false;
let lastSent = 0;

function send(want: boolean) {
  current = want;
  lastSent = Date.now();
  useApp.getState().bridge?.setInteractive(want);
}

function apply() {
  scheduled = false;
  const want = holders.size > 0;
  if (want === current) return;
  send(want);
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

/**
 * `reassert`: send the request even if this window believes it is already interactive.
 * The main process resets the window to click-through whenever it hides the overlay
 * (and drops requests that race the hide), so a stale "already interactive" belief would
 * leave a hovered widget unclickable: its clicks would fall through to the game.
 */
export function acquireInteractive(key: symbol, reassert = false) {
  holders.add(key);
  if (reassert && current) send(true);
  else schedule(true);
}

export function releaseInteractive(key: symbol) {
  dragHolders.delete(key);
  if (holders.delete(key)) schedule(false);
}

/** A drag's hold: kept when the pointer leaves the window mid-drag (released by the drag). */
export function acquireDragInteractive(key: symbol) {
  dragHolders.add(key);
  acquireInteractive(key);
}

/**
 * Last pointer position seen by this window (forwarded mouse moves included),
 * or null once the pointer left it. A widget that mounts under a stationary
 * cursor gets no pointerenter, so it checks this on mount instead.
 */
let lastPointer: { x: number; y: number } | null = null;

/** Release everything except running drags (pointer left the window). */
export function releaseAllInteractive() {
  for (const k of [...holders]) if (!dragHolders.has(k)) holders.delete(k);
  schedule(false);
}

/** While held, re-send the request at most this often as the pointer moves (self-healing). */
const REASSERT_MS = 1000;

if (typeof document !== 'undefined') {
  const track = (e: MouseEvent) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    // Heal a desync with the main process (see acquireInteractive): a hovered widget
    // becomes clickable again on the next mouse move instead of staying click-through.
    if (current && holders.size > 0 && Date.now() - lastSent > REASSERT_MS) send(true);
  };
  window.addEventListener('mousemove', track, { passive: true, capture: true });
  window.addEventListener('pointermove', track, { passive: true, capture: true });
  document.documentElement.addEventListener('mouseleave', () => {
    lastPointer = null;
    releaseAllInteractive();
  });
  window.addEventListener('blur', () => releaseAllInteractive());
}

function pointerInside(el: Element): boolean {
  // The last real pointer position wins: `:hover` is stale after a layout change under a
  // stationary cursor (no mouse move, no new hit test).
  if (lastPointer) {
    const r = el.getBoundingClientRect();
    return lastPointer.x >= r.left && lastPointer.x <= r.right && lastPointer.y >= r.top && lastPointer.y <= r.bottom;
  }
  try {
    return el.matches(':hover');
  } catch {
    return false;
  }
}

export interface InteractiveProps {
  onPointerEnter: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  /** Lets the hook find its element (to detect a pointer already over it on mount). */
  'data-tl-hold': string;
}

let holdSeq = 0;

/**
 * Spread the returned props on an interactive element:
 * `<div {...useInteractive()}>`. Pass `false` to disable (e.g. collapsed).
 * `onHover` is told when the pointer enters or leaves the element.
 */
export function useInteractive(enabled = true, onHover?: (inside: boolean) => void): InteractiveProps {
  const key = useRef<symbol>(Symbol('interactive'));
  const id = useRef<string>('');
  if (!id.current) id.current = `h${++holdSeq}`;
  const inside = useRef(false);
  const hovered = useRef<Element | null>(null);
  /** Detach the "entered without pointerenter" tracker (see below). */
  const untrack = useRef<(() => void) | null>(null);
  const hoverCb = useRef(onHover);
  hoverCb.current = onHover;

  const setInside = useCallback((v: boolean, el: Element | null) => {
    if (inside.current === v && hovered.current === el) return;
    const changed = inside.current !== v;
    inside.current = v;
    hovered.current = el;
    if (changed) hoverCb.current?.(v);
  }, []);

  useEffect(() => {
    const k = key.current;
    if (!enabled && inside.current) releaseInteractive(k);
    else if (enabled && inside.current) acquireInteractive(k);
    return () => releaseInteractive(k);
  }, [enabled]);

  // Appeared (or re-enabled) under a stationary cursor: Chromium sends no pointerenter
  // until the mouse moves, so the first click would fall through to the game. Hold the
  // window now, and until a real pointerenter takes over, release as soon as a move
  // lands outside the element (a missed enter also means a missed leave). Runs after
  // every render because the element may appear later than the hook (conditional UI).
  const seen = useRef('');
  useEffect(() => {
    if (!enabled) {
      seen.current = '';
      return;
    }
    const el = document.querySelector(`[data-tl-hold="${id.current}"]`);
    // Floating widgets settle their position a render after mounting (they measure
    // themselves first), so re-check whenever the element or its box changes.
    const r = el?.getBoundingClientRect();
    const sig = r ? `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}` : '';
    if (sig === seen.current) return;
    seen.current = sig;
    // Moved or shrank away from under a stationary cursor (e.g. the phase changed its
    // layout): no pointerleave comes until the mouse moves, so release the hold now or
    // the game's clicks at that spot would land on the overlay.
    if (el && inside.current && lastPointer && !pointerInside(el)) {
      untrack.current?.();
      setInside(false, null);
      releaseInteractive(key.current);
      return;
    }
    if (!el || inside.current || !pointerInside(el)) return;
    setInside(true, el);
    acquireInteractive(key.current);
    const k = key.current;
    const stop = () => {
      window.removeEventListener('mousemove', onMove, true);
      if (untrack.current === stop) untrack.current = null;
    };
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return;
      stop();
      setInside(false, null);
      releaseInteractive(k);
    };
    untrack.current?.();
    window.addEventListener('mousemove', onMove, true);
    untrack.current = stop;
  });
  useEffect(() => () => untrack.current?.(), []);

  // A hovered element that is removed from the DOM never gets a pointerleave (e.g. a
  // component that keeps this hook but renders null once its panel is dismissed or
  // the phase changes). Drop the hold then, or the overlay stays interactive over the game.
  useLayoutEffect(() => {
    if (inside.current && hovered.current && !hovered.current.isConnected) {
      untrack.current?.();
      setInside(false, null);
      releaseInteractive(key.current);
    }
  });

  const onPointerEnter = useCallback(
    (e: React.PointerEvent) => {
      untrack.current?.();
      setInside(true, e.currentTarget as Element);
      if (enabled) acquireInteractive(key.current, true);
    },
    [enabled, setInside],
  );
  const onPointerLeave = useCallback(() => {
    untrack.current?.();
    setInside(false, null);
    releaseInteractive(key.current);
  }, [setInside]);
  return { onPointerEnter, onPointerLeave, 'data-tl-hold': id.current };
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
