/**
 * Tiny logger for the main process: prints to stdout/stderr and (once a file is
 * configured) appends to `<userData>/logs/main.log` (rotated at ~2 MB).
 * No Electron imports so every main-process module can use it in tests.
 */
import { appendFile, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

type Level = 'debug' | 'info' | 'warn' | 'error';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

let logFile: string | undefined;
let debugEnabled = !!process.env.TL_DEBUG;
let pending: string[] = [];
let flushing = false;

export function configureLogger(opts: { file?: string; debug?: boolean }): void {
  if (opts.debug !== undefined) debugEnabled = opts.debug;
  if (opts.file) {
    try {
      mkdirSync(dirname(opts.file), { recursive: true });
      try {
        if (statSync(opts.file).size > MAX_FILE_BYTES) renameSync(opts.file, `${opts.file}.1`);
      } catch {
        /* no file yet */
      }
      logFile = opts.file;
    } catch {
      logFile = undefined;
    }
  }
}

export function isDebugLogging(): boolean {
  return debugEnabled;
}

function fmt(arg: unknown): string {
  if (arg instanceof Error) return arg.stack ?? `${arg.name}: ${arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function flush(): void {
  if (flushing || !logFile || pending.length === 0) return;
  flushing = true;
  const chunk = pending.join('');
  pending = [];
  appendFile(logFile, chunk, () => {
    flushing = false;
    if (pending.length) flush();
  });
}

function write(level: Level, scope: string, args: unknown[]): void {
  if (level === 'debug' && !debugEnabled) return;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} [${scope}] ${args.map(fmt).join(' ')}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
  if (logFile) {
    pending.push(line + '\n');
    if (pending.length > 2000) pending.splice(0, pending.length - 2000);
    flush();
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
    debug: (...a) => write('debug', scope, a),
    info: (...a) => write('info', scope, a),
    warn: (...a) => write('warn', scope, a),
    error: (...a) => write('error', scope, a),
  };
}
