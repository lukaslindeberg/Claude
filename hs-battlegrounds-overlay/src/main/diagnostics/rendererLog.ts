/**
 * Intake for log events forwarded by the renderer windows (`bridge.logEvent`):
 * validates and truncates them, and rate-limits each window to ~50 per minute so a
 * render loop that throws on every frame cannot flood the log. No Electron imports.
 */
import { RateLimiter, safeJson, writeLog, type LogLevel } from '../logger';

export const RENDERER_LOG_PER_MINUTE = 50;
const LEVELS: ReadonlySet<string> = new Set(['error', 'warn', 'info', 'debug']);
const MAX_MESSAGE = 4000;
const MAX_DATA = 8000;

export interface RendererLogEvent {
  level: LogLevel;
  scope: string;
  message: string;
  data?: string;
}

/** Validates an IPC payload. Returns undefined for garbage. */
export function sanitizeRendererLog(level: unknown, scope: unknown, message: unknown, data?: unknown): RendererLogEvent | undefined {
  if (typeof level !== 'string' || !LEVELS.has(level)) return undefined;
  if (typeof message !== 'string' || !message) return undefined;
  const sc = typeof scope === 'string' && scope ? scope.replace(/[^\w:./-]/g, '_').slice(0, 48) : 'renderer';
  const msg = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message;
  const ev: RendererLogEvent = { level: level as LogLevel, scope: sc, message: msg };
  if (data !== undefined && data !== null) ev.data = safeJson(data, MAX_DATA);
  return ev;
}

export interface RendererLogSinkOptions {
  perMinute?: number;
  now?: () => number;
  /** Where accepted entries go (default: the main log). */
  write?: (level: LogLevel, scope: string, args: unknown[]) => void;
}

export class RendererLogSink {
  private readonly limiter: RateLimiter;
  private readonly forwarding = new Set<number>();
  private readonly write: (level: LogLevel, scope: string, args: unknown[]) => void;
  /** Accepted / dropped counts (diagnostics). */
  accepted = 0;
  dropped = 0;

  constructor(opts: RendererLogSinkOptions = {}) {
    this.limiter = new RateLimiter(opts.perMinute ?? RENDERER_LOG_PER_MINUTE, 60_000, opts.now);
    this.write = opts.write ?? writeLog;
  }

  /** True once a window forwards its own errors (its console-message errors are then duplicates). */
  isForwarding(senderId: number): boolean {
    return this.forwarding.has(senderId);
  }

  /** Logs one renderer event; returns whether it was accepted. */
  handle(senderId: number, window: string, level: unknown, scope: unknown, message: unknown, data?: unknown): boolean {
    const ev = sanitizeRendererLog(level, scope, message, data);
    if (!ev) return false;
    this.forwarding.add(senderId);
    const key = String(senderId);
    const { allowed, suppressed } = this.limiter.take(key);
    if (suppressed) this.write('warn', `renderer:${window}`, [`${suppressed} more messages from this window in the previous minute were dropped (rate limit)`]);
    if (!allowed) {
      this.dropped++;
      return false;
    }
    this.accepted++;
    const args: unknown[] = [ev.message];
    if (ev.data) args.push(ev.data);
    this.write(ev.level, `renderer:${window}/${ev.scope}`, args);
    return true;
  }

  /** Reports windows whose rate-limit window ended with dropped messages. Call periodically. */
  drain(windowName: (senderId: number) => string = String): void {
    for (const { key, suppressed } of this.limiter.drainExpired()) {
      this.write('warn', `renderer:${windowName(Number(key))}`, [`${suppressed} messages from this window were dropped (rate limit)`]);
    }
  }

  /** The window was destroyed. */
  forget(senderId: number): void {
    this.forwarding.delete(senderId);
    this.limiter.forget(String(senderId));
  }
}

/** The app's sink (shared with windows.ts to de-duplicate console messages). */
export const rendererLogs = new RendererLogSink();
