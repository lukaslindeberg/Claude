/**
 * Renderer diagnostics: forwards errors from this window to the main-process log
 * (`bridge.logEvent`), where they end up in tavern-lens.log and the error counter.
 *
 * - `window` error events and unhandled promise rejections;
 * - `console.error` calls (the original still prints);
 * - React render errors (via ErrorBoundary / the root's error callbacks);
 * - simulator worker failures and timeouts (watched through the store's sim runs,
 *   so the simulator hook itself needs no changes).
 *
 * Events before the bridge is known are buffered. Identical messages within a few
 * seconds are collapsed; the main process also rate-limits each window.
 */
import type { TavernLensBridge } from '@shared/ipc';
import type { LogLevel } from '@shared/types';
import { useApp, type SimRun } from './store/appStore';

type Entry = [LogLevel, string, string, unknown?];

let bridge: TavernLensBridge | null = null;
let installed = false;
let sending = false;
const early: Entry[] = [];
const recent = new Map<string, { at: number; repeats: number }>();
const REPEAT_WINDOW_MS = 5000;

function describe(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    const s = JSON.stringify(v);
    return s === undefined ? String(v) : s.length > 500 ? `${s.slice(0, 500)}…` : s;
  } catch {
    return String(v);
  }
}

function errorData(err: unknown): Record<string, unknown> | undefined {
  if (err instanceof Error) return { name: err.name, stack: err.stack?.slice(0, 4000) };
  return undefined;
}

/** Sends one entry to the main log (buffered until the bridge is attached). */
export function rendererLog(level: LogLevel, scope: string, message: string, data?: unknown): void {
  if (sending) return; // an error while forwarding must not loop
  const key = `${level}|${scope}|${message}`;
  const now = Date.now();
  const r = recent.get(key);
  if (r && now - r.at < REPEAT_WINDOW_MS) {
    r.repeats++;
    return;
  }
  if (r?.repeats) message = `${message} (and ${r.repeats} identical before)`;
  recent.set(key, { at: now, repeats: 0 });
  if (recent.size > 200) recent.delete(recent.keys().next().value!);
  if (!bridge) {
    if (early.length < 50) early.push([level, scope, message, data]);
    return;
  }
  sending = true;
  try {
    bridge.logEvent?.(level, scope, message, data);
  } catch {
    /* the bridge is gone (window closing) */
  } finally {
    sending = false;
  }
}

/** Reports a caught error with its stack. */
export function reportError(scope: string, err: unknown, extra?: Record<string, unknown>): void {
  rendererLog('error', scope, describe(err), { ...errorData(err), ...extra });
}

/** Installs the global hooks. Safe to call more than once. */
export function installRendererDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  // In Electron the preload bridge exists before any app code runs.
  if (window.tavernLens) bridge = window.tavernLens;

  window.addEventListener('error', (e: ErrorEvent) => {
    // Resource load failures (card art offline...) are not ErrorEvents with a message.
    if (!e.message && !e.error) return;
    rendererLog('error', 'window', e.error ? describe(e.error) : e.message, {
      source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
      ...errorData(e.error),
    });
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    rendererLog('error', 'promise', `unhandled rejection: ${describe(e.reason)}`, errorData(e.reason));
  });

  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    if (sending) return;
    const err = args.find((a) => a instanceof Error);
    rendererLog('error', 'console', args.map(describe).join(' ').slice(0, 2000), errorData(err));
  };
}

/** Attaches the bridge (flushes what was buffered) and says hello. */
export function attachDiagnosticsBridge(b: TavernLensBridge, windowKind: string): void {
  bridge = b;
  const pending = early.splice(0);
  for (const [level, scope, message, data] of pending) {
    try {
      b.logEvent?.(level, scope, message, data);
    } catch {
      /* ignore */
    }
  }
  rendererLog('info', 'boot', `${windowKind} window started`, {
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio,
    language: navigator.language,
  });
}

/**
 * Watches the overlay's simulator runs: failures and timeouts are logged (successful
 * runs are reported to the main process by the simulator hook itself).
 */
export function watchSimRuns(): () => void {
  const seen = new Set<string>();
  return useApp.subscribe((s, prev) => {
    if (s.sims === prev.sims) return;
    for (const run of Object.values(s.sims) as SimRun[]) {
      if (run.status !== 'error' || seen.has(run.key)) continue;
      seen.add(run.key);
      const timedOut = /timed out/i.test(run.error ?? '');
      // A timeout means the worker got stuck (the run itself stops after ~2.5 s): a bug either way.
      rendererLog('error', 'sim', `simulation ${timedOut ? 'timed out' : 'failed'} on turn ${run.turn}: ${run.error ?? '?'}`, {
        key: run.key,
        elapsedMs: Date.now() - run.startedAt,
        keptQuickEstimate: !!run.result,
        quick: run.result ? { win: run.result.win, tie: run.result.tie, loss: run.result.loss, iterations: run.result.iterations } : undefined,
      });
    }
  });
}
