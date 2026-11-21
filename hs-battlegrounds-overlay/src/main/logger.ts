/**
 * Main-process logger. Human-readable lines, one entry per line (continuation lines of
 * multi-line entries such as stacks are indented by four spaces):
 *
 *   2026-11-07T15:33:01.123+01:00 INFO  [live] combat end t5: won 7 {"sim":"won 62%"}
 *
 * Times are local with their UTC offset, so they line up with Power.log timestamps
 * (which are local). Written to stdout/stderr and, once configured, to
 * `<userData>/logs/tavern-lens.log`, rotated at ~5 MB with 5 files kept
 * (`tavern-lens.log`, `tavern-lens.1.log` ... `tavern-lens.4.log`). Writes are
 * synchronous so the last lines before a crash are on disk.
 *
 * No Electron imports so every main-process module can use it in tests.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = ['error', 'warn', 'info', 'debug'];

export const LOG_FILE_NAME = 'tavern-lens.log';
export const LOG_MAX_BYTES = 5 * 1024 * 1024;
export const LOG_MAX_FILES = 5;
/** Longest JSON rendering of one argument. */
const MAX_JSON_CHARS = 8000;

// ---------------------------------------------------------------------------
// Rotating file writer
// ---------------------------------------------------------------------------

/** `dir/tavern-lens.log` -> `dir/tavern-lens.<n>.log` (n >= 1); n = 0 is the file itself. */
export function rotatedName(file: string, n: number): string {
  if (n <= 0) return file;
  const ext = extname(file);
  return join(dirname(file), `${basename(file, ext)}.${n}${ext}`);
}

/** Existing log files of a rotation set, newest first. */
export function listLogFiles(file: string, maxFiles = LOG_MAX_FILES + 5): string[] {
  const out: string[] = [];
  for (let n = 0; n < maxFiles; n++) {
    const f = rotatedName(file, n);
    if (existsSync(f)) out.push(f);
  }
  return out;
}

/** Appends to a file and rotates it when it would grow past `maxBytes`. */
export class LogFileWriter {
  private fd: number | undefined;
  private size = 0;
  private rotateAt: number;

  constructor(
    readonly file: string,
    readonly maxBytes = LOG_MAX_BYTES,
    readonly maxFiles = LOG_MAX_FILES,
  ) {
    mkdirSync(dirname(file), { recursive: true });
    this.rotateAt = maxBytes;
    this.open();
  }

  get isOpen(): boolean {
    return this.fd !== undefined;
  }

  /** Current size of the active file. */
  get bytes(): number {
    return this.size;
  }

  write(text: string): void {
    if (this.fd === undefined) return;
    const buf = Buffer.from(text, 'utf8');
    if (this.size > 0 && this.size + buf.length > this.rotateAt) this.rotate();
    if (this.fd === undefined) return;
    try {
      writeSync(this.fd, buf);
      this.size += buf.length;
    } catch {
      /* disk full, file deleted under us...: nothing sensible to do */
    }
  }

  /** Shifts `file` -> `.1` -> `.2` ...; the oldest beyond `maxFiles` is deleted. */
  rotate(): void {
    this.closeFd();
    try {
      if (this.maxFiles <= 1) {
        unlinkSync(this.file);
      } else {
        try {
          unlinkSync(rotatedName(this.file, this.maxFiles - 1));
        } catch {
          /* not there */
        }
        for (let n = this.maxFiles - 1; n >= 1; n--) {
          const from = rotatedName(this.file, n - 1);
          if (existsSync(from)) renameSync(from, rotatedName(this.file, n));
        }
      }
      this.rotateAt = this.maxBytes;
    } catch {
      // Locked (antivirus, an editor holding it): keep appending, try again a bit later.
      this.rotateAt = this.size + Math.max(64 * 1024, Math.floor(this.maxBytes / 10));
    }
    this.open();
  }

  close(): void {
    this.closeFd();
  }

  private open(): void {
    try {
      this.fd = openSync(this.file, 'a');
      try {
        this.size = statSync(this.file).size;
      } catch {
        this.size = 0;
      }
    } catch {
      this.fd = undefined;
    }
  }

  private closeFd(): void {
    if (this.fd === undefined) return;
    try {
      closeSync(this.fd);
    } catch {
      /* ignore */
    }
    this.fd = undefined;
  }
}

// ---------------------------------------------------------------------------
// Rate limiting (renderer messages, repeated tracker errors)
// ---------------------------------------------------------------------------

/** Fixed-window rate limiter per key. */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number; suppressed: number }>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Whether one more event for `key` may pass. `suppressed` is the number of events
   * dropped in the key's previous window, reported once when a new window starts.
   */
  take(key: string): { allowed: boolean; suppressed: number } {
    const t = this.now();
    let w = this.windows.get(key);
    let suppressed = 0;
    if (!w || t - w.start >= this.windowMs) {
      suppressed = w?.suppressed ?? 0;
      w = { start: t, count: 0, suppressed: 0 };
      this.windows.set(key, w);
    }
    if (w.count < this.max) {
      w.count++;
      return { allowed: true, suppressed };
    }
    w.suppressed++;
    return { allowed: false, suppressed };
  }

  /** Suppressed counts of windows that have ended (and are forgotten). */
  drainExpired(): Array<{ key: string; suppressed: number }> {
    const t = this.now();
    const out: Array<{ key: string; suppressed: number }> = [];
    for (const [key, w] of this.windows) {
      if (t - w.start < this.windowMs) continue;
      if (w.suppressed > 0) out.push({ key, suppressed: w.suppressed });
      this.windows.delete(key);
    }
    return out;
  }

  forget(key: string): void {
    this.windows.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** ISO-8601 local time with UTC offset: `2026-11-07T15:33:01.123+01:00`. */
export function localIsoTime(d: Date = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** JSON.stringify that survives cycles, BigInt, Maps/Sets and errors, capped in length. */
export function safeJson(value: unknown, maxChars = MAX_JSON_CHARS): string {
  const seen = new WeakSet<object>();
  let out: string;
  try {
    out =
      JSON.stringify(value, (_k, v: unknown) => {
        if (typeof v === 'bigint') return `${v}n`;
        if (v instanceof Error) return { name: v.name, message: v.message };
        if (v instanceof Map) return Object.fromEntries(v);
        if (v instanceof Set) return [...v];
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        return v;
      }) ?? String(value);
  } catch {
    out = String(value);
  }
  return out.length > maxChars ? `${out.slice(0, maxChars)}…(${out.length} chars)` : out;
}

function errorText(err: Error): { head: string; stack?: string } {
  const head = `${err.name || 'Error'}: ${err.message}`;
  let stack = typeof err.stack === 'string' ? err.stack : undefined;
  // V8 stacks start with the "Name: message" line; keep only the frames.
  if (stack?.startsWith(head)) stack = stack.slice(head.length).replace(/^\n/, '');
  const cause = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) stack = `${stack ?? ''}\ncaused by ${cause.name}: ${cause.message}`.trim();
  return { head, stack: stack?.trim() || undefined };
}

/** Renders log arguments: strings as-is, errors inline with their stack below, objects as compact JSON. */
export function formatArgs(args: unknown[]): string {
  const parts: string[] = [];
  const stacks: string[] = [];
  for (const a of args) {
    if (a instanceof Error) {
      const { head, stack } = errorText(a);
      parts.push(head);
      if (stack) stacks.push(stack);
    } else if (typeof a === 'string') parts.push(a);
    else if (typeof a === 'number' || typeof a === 'boolean' || a === undefined || a === null) parts.push(String(a));
    else parts.push(safeJson(a));
  }
  return [parts.join(' '), ...stacks].join('\n');
}

/** One log entry as text (with a trailing newline); continuation lines are indented. */
export function formatEntry(at: Date, level: LogLevel, scope: string, text: string): string {
  const body = text.includes('\n') ? text.replace(/\r?\n/g, '\n    ') : text;
  return `${localIsoTime(at)} ${level.toUpperCase().padEnd(5)} [${scope}] ${body}\n`;
}

// ---------------------------------------------------------------------------
// Logger state
// ---------------------------------------------------------------------------

export interface LogEntry {
  at: number;
  level: LogLevel;
  scope: string;
  /** Formatted text (may span lines). */
  text: string;
}

export interface LogStats {
  errors: number;
  warnings: number;
  /** Last few errors this session (oldest first), first line only. */
  recentErrors: { at: number; scope: string; message: string }[];
}

const MAX_RECENT_ERRORS = 10;
const EARLY_BUFFER_LINES = 1000;

let writer: LogFileWriter | undefined;
let debugEnabled = !!process.env.TL_DEBUG;
let consoleEnabled = true;
let early: string[] = [];
const listeners = new Set<(e: LogEntry) => void>();
const stats: LogStats = { errors: 0, warnings: 0, recentErrors: [] };

export interface LoggerConfig {
  /** Log file path (`.../tavern-lens.log`). */
  file?: string;
  debug?: boolean;
  maxBytes?: number;
  maxFiles?: number;
  /** Echo to stdout/stderr (default true). */
  console?: boolean;
}

export function configureLogger(opts: LoggerConfig): void {
  if (opts.debug !== undefined) debugEnabled = opts.debug;
  if (opts.console !== undefined) consoleEnabled = opts.console;
  if (opts.file && opts.file !== writer?.file) {
    writer?.close();
    try {
      writer = new LogFileWriter(opts.file, opts.maxBytes ?? LOG_MAX_BYTES, opts.maxFiles ?? LOG_MAX_FILES);
      if (!writer.isOpen) writer = undefined;
    } catch {
      writer = undefined;
    }
    if (writer && early.length) {
      writer.write(early.join(''));
      early = [];
    }
  }
}

export function setDebugLogging(on: boolean): void {
  debugEnabled = on;
}

export function isDebugLogging(): boolean {
  return debugEnabled;
}

/** The active log file, if any. */
export function logFilePath(): string | undefined {
  return writer?.file;
}

/** Every rotated file of the active log, newest first. */
export function logFiles(): string[] {
  return writer ? listLogFiles(writer.file) : [];
}

/** Log file names in a folder (`tavern-lens*.log`), newest rotation first. */
export function logFilesIn(dir: string): string[] {
  try {
    const names = readdirSync(dir).filter((n) => /^tavern-lens(\.\d+)?\.log$/i.test(n));
    const rank = (n: string) => Number(/\.(\d+)\.log$/i.exec(n)?.[1] ?? 0);
    return names.sort((a, b) => rank(a) - rank(b)).map((n) => join(dir, n));
  } catch {
    return [];
  }
}

export function getLogStats(): LogStats {
  return { errors: stats.errors, warnings: stats.warnings, recentErrors: [...stats.recentErrors] };
}

/** Subscribe to every entry that passes the level filter. */
export function onLogEntry(fn: (e: LogEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Closes the file and forgets state (tests). */
export function resetLogger(): void {
  writer?.close();
  writer = undefined;
  early = [];
  debugEnabled = !!process.env.TL_DEBUG;
  consoleEnabled = true;
  stats.errors = 0;
  stats.warnings = 0;
  stats.recentErrors = [];
}

export function writeLog(level: LogLevel, scope: string, args: unknown[]): void {
  if (level === 'debug' && !debugEnabled) return;
  const at = new Date();
  const text = formatArgs(args);
  const line = formatEntry(at, level, scope, text);
  if (consoleEnabled) {
    if (level === 'error' || level === 'warn') process.stderr.write(line);
    else process.stdout.write(line);
  }
  if (writer) writer.write(line);
  else {
    early.push(line);
    if (early.length > EARLY_BUFFER_LINES) early.splice(0, early.length - EARLY_BUFFER_LINES);
  }
  if (level === 'error') {
    stats.errors++;
    const first = text.split('\n', 1)[0];
    stats.recentErrors.push({ at: at.getTime(), scope, message: first.length > 300 ? `${first.slice(0, 300)}…` : first });
    if (stats.recentErrors.length > MAX_RECENT_ERRORS) stats.recentErrors.shift();
  } else if (level === 'warn') stats.warnings++;
  if (listeners.size) {
    const entry: LogEntry = { at: at.getTime(), level, scope, text };
    for (const l of listeners) {
      try {
        l(entry);
      } catch {
        /* a listener must never break logging */
      }
    }
  }
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...a) => writeLog('debug', scope, a),
    info: (...a) => writeLog('info', scope, a),
    warn: (...a) => writeLog('warn', scope, a),
    error: (...a) => writeLog('error', scope, a),
  };
}
