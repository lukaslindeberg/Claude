import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LogFileWriter,
  RateLimiter,
  configureLogger,
  createLogger,
  formatArgs,
  formatEntry,
  getLogStats,
  listLogFiles,
  localIsoTime,
  logFilesIn,
  onLogEntry,
  resetLogger,
  rotatedName,
  safeJson,
  setDebugLogging,
} from '../../src/main/logger';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-logger-'));
});
afterEach(() => {
  resetLogger();
  rmSync(dir, { recursive: true, force: true });
});

describe('LogFileWriter rotation', () => {
  it('names rotated files tavern-lens.N.log', () => {
    expect(rotatedName('/x/tavern-lens.log', 0)).toBe('/x/tavern-lens.log');
    expect(rotatedName('/x/tavern-lens.log', 3)).toBe(join('/x', 'tavern-lens.3.log'));
  });

  it('rotates at maxBytes and keeps maxFiles files, newest content in the base file', () => {
    const file = join(dir, 'tavern-lens.log');
    const w = new LogFileWriter(file, 100, 5);
    // 40 lines of 25 bytes: 4 lines per file before the next would exceed 100 bytes.
    for (let i = 0; i < 40; i++) w.write(`line ${String(i).padStart(3, '0')} ${'x'.repeat(14)}\n`);
    w.close();
    const files = readdirSync(dir).sort();
    expect(files).toEqual(['tavern-lens.1.log', 'tavern-lens.2.log', 'tavern-lens.3.log', 'tavern-lens.4.log', 'tavern-lens.log']);
    for (const f of files) expect(readFileSync(join(dir, f)).length).toBeLessThanOrEqual(100);
    // Newest lines in the base file, older ones in .1, .2 ... ; the oldest were dropped.
    expect(readFileSync(file, 'utf8')).toContain('line 039');
    expect(readFileSync(join(dir, 'tavern-lens.1.log'), 'utf8')).toContain('line 035');
    expect(readFileSync(join(dir, 'tavern-lens.4.log'), 'utf8')).toContain('line 020');
    const all = files.map((f) => readFileSync(join(dir, f), 'utf8')).join('');
    expect(all).not.toContain('line 019');
    expect(listLogFiles(file)).toHaveLength(5);
    expect(logFilesIn(dir).map((f) => f.slice(dir.length + 1))).toEqual([
      'tavern-lens.log',
      'tavern-lens.1.log',
      'tavern-lens.2.log',
      'tavern-lens.3.log',
      'tavern-lens.4.log',
    ]);
  });

  it('appends to an existing file and counts its size', () => {
    const file = join(dir, 'tavern-lens.log');
    writeFileSync(file, 'a'.repeat(90));
    const w = new LogFileWriter(file, 100, 3);
    expect(w.bytes).toBe(90);
    w.write('b'.repeat(20)); // would exceed: rotate first
    w.close();
    expect(readFileSync(file, 'utf8')).toBe('b'.repeat(20));
    expect(readFileSync(join(dir, 'tavern-lens.1.log'), 'utf8')).toBe('a'.repeat(90));
  });

  it('never rotates an empty file even for a huge entry', () => {
    const file = join(dir, 'tavern-lens.log');
    const w = new LogFileWriter(file, 10, 3);
    w.write('x'.repeat(50));
    w.close();
    expect(existsSync(join(dir, 'tavern-lens.1.log'))).toBe(false);
  });
});

describe('format', () => {
  it('writes ISO local time with offset, padded level, scope, message and JSON', () => {
    const at = new Date(2026, 10, 7, 15, 33, 1, 123);
    const iso = localIsoTime(at);
    expect(iso).toMatch(/^2026-11-07T15:33:01\.123[+-]\d{2}:\d{2}$/);
    const line = formatEntry(at, 'info', 'live', formatArgs(['combat end t5: won 7', { sim: 'won 62%' }]));
    expect(line).toBe(`${iso} INFO  [live] combat end t5: won 7 {"sim":"won 62%"}\n`);
  });

  it('puts error stacks on indented continuation lines', () => {
    const err = new Error('boom');
    const text = formatArgs(['tracker failed', err]);
    const line = formatEntry(new Date(), 'error', 'live', text);
    const lines = line.trimEnd().split('\n');
    expect(lines[0]).toMatch(/ERROR \[live\] tracker failed Error: boom$/);
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines.slice(1)) expect(l.startsWith('    ')).toBe(true);
  });

  it('survives cycles and BigInt', () => {
    const o: Record<string, unknown> = { n: 1n };
    o.self = o;
    expect(safeJson(o)).toBe('{"n":"1n","self":"[circular]"}');
  });
});

describe('logger', () => {
  it('buffers entries until a file is configured, filters debug, counts errors', () => {
    configureLogger({ console: false, debug: false });
    const log = createLogger('test');
    log.info('early line');
    log.debug('hidden');
    const file = join(dir, 'tavern-lens.log');
    configureLogger({ file });
    log.error('it broke', new Error('x'));
    log.warn('careful');
    setDebugLogging(true);
    log.debug('now visible');
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('INFO  [test] early line');
    expect(text).not.toContain('hidden');
    expect(text).toContain('DEBUG [test] now visible');
    const st = getLogStats();
    expect(st.errors).toBe(1);
    expect(st.warnings).toBe(1);
    expect(st.recentErrors[0]).toMatchObject({ scope: 'test', message: 'it broke Error: x' });
  });

  it('notifies listeners', () => {
    configureLogger({ console: false });
    const seen: string[] = [];
    const off = onLogEntry((e) => seen.push(`${e.level}:${e.scope}:${e.text}`));
    createLogger('s').warn('w');
    off();
    createLogger('s').warn('ignored');
    expect(seen).toEqual(['warn:s:w']);
  });
});

describe('RateLimiter', () => {
  it('allows max per window per key and reports what was suppressed', () => {
    let t = 0;
    const rl = new RateLimiter(3, 1000, () => t);
    expect([1, 2, 3, 4, 5].map(() => rl.take('a').allowed)).toEqual([true, true, true, false, false]);
    expect(rl.take('b').allowed).toBe(true);
    t = 1000;
    const next = rl.take('a');
    expect(next).toEqual({ allowed: true, suppressed: 2 });
    t = 2500;
    rl.take('a');
    rl.take('a');
    rl.take('a');
    rl.take('a');
    t = 4000;
    expect(rl.drainExpired()).toEqual([{ key: 'a', suppressed: 1 }]);
    expect(rl.drainExpired()).toEqual([]);
  });
});
