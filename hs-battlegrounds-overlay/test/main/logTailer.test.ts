import { appendFileSync, mkdtempSync, truncateSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LogTailer, findGameInProgressOffset, splitLines } from '../../src/main/hearthstone/logTailer';

const GS = (ts: string, body: string) => `D ${ts} GameState.DebugPrintPower() - ${body}\n`;
const PTL = (ts: string, body: string) => `D ${ts} PowerTaskList.DebugPrintPower() - ${body}\n`;

function gameText(n: number, finished: boolean, withPowerTaskList = false): string {
  let s = GS(`10:0${n}:00.0000000`, 'CREATE_GAME');
  s += GS(`10:0${n}:00.0000000`, '    GameEntity EntityID=1');
  if (withPowerTaskList) s += PTL(`10:0${n}:00.1000000`, 'CREATE_GAME');
  for (let t = 1; t <= 5; t++) s += GS(`10:0${n}:0${t}.0000000`, `TAG_CHANGE Entity=GameEntity tag=TURN value=${t} `);
  if (finished) s += GS(`10:0${n}:09.0000000`, 'TAG_CHANGE Entity=GameEntity tag=STATE value=COMPLETE ');
  return s;
}

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'tl-tail-'));
}

function collector() {
  const lines: string[] = [];
  return { lines, onLines: (l: string[]) => lines.push(...l) };
}

async function drain(t: LogTailer): Promise<void> {
  for (let i = 0; i < 50; i++) if (!(await t.tick())) return;
}

describe('splitLines', () => {
  it('buffers partial lines and strips CR', () => {
    const a = splitLines(Buffer.alloc(0), Buffer.from('one\r\ntw'));
    expect(a.lines).toEqual(['one']);
    expect(a.rest.toString()).toBe('tw');
    const b = splitLines(a.rest, Buffer.from('o\n\nthree'));
    expect(b.lines).toEqual(['two']);
    expect(b.rest.toString()).toBe('three');
  });
  it('does not break multi-byte characters split across reads', () => {
    const full = Buffer.from('Zoë\n');
    const a = splitLines(Buffer.alloc(0), full.subarray(0, 3));
    const b = splitLines(a.rest, full.subarray(3));
    expect(b.lines).toEqual(['Zoë']);
  });
});

describe('findGameInProgressOffset', () => {
  it('finds the last CREATE_GAME when the game is in progress', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    const done = gameText(1, true);
    writeFileSync(f, done + gameText(2, false));
    expect(await findGameInProgressOffset(f)).toBe(Buffer.byteLength(done));
  });
  it('returns undefined when the last game is finished or there is none', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    writeFileSync(f, gameText(1, true) + gameText(2, true));
    expect(await findGameInProgressOffset(f)).toBeUndefined();
    writeFileSync(f, 'D 10:00:00.0000000 GameState.DebugPrintOptions() - id=1\n');
    expect(await findGameInProgressOffset(f)).toBeUndefined();
  });
  it('prefers the GameState CREATE_GAME over the PowerTaskList one of the same game', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    const done = gameText(1, true, true);
    writeFileSync(f, done + gameText(2, false, true));
    expect(await findGameInProgressOffset(f)).toBe(Buffer.byteLength(done));
  });
  it('works across chunk boundaries', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    const filler = 'D 09:00:00.0000000 GameState.DebugPrintOptions() - filler line of text\n'.repeat(200);
    const done = gameText(1, true) + filler;
    writeFileSync(f, done + gameText(2, false) + filler);
    expect(await findGameInProgressOffset(f, { chunkSize: 97 })).toBe(Buffer.byteLength(done));
  });
});

describe('LogTailer', () => {
  it('starts at EOF when no game is in progress, then emits appended complete lines', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    writeFileSync(f, gameText(1, true));
    const c = collector();
    const t = new LogTailer({ resolvePath: () => f, onLines: c.onLines });
    await drain(t);
    expect(c.lines).toEqual([]);
    appendFileSync(f, 'line A\nline B part');
    await drain(t);
    expect(c.lines).toEqual(['line A']);
    appendFileSync(f, ' two\r\n');
    await drain(t);
    expect(c.lines).toEqual(['line A', 'line B part two']);
  });

  it('catches up from the last CREATE_GAME of a game in progress', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    writeFileSync(f, gameText(1, true) + gameText(2, false));
    const c = collector();
    const t = new LogTailer({ resolvePath: () => f, onLines: c.onLines });
    await drain(t);
    expect(c.lines[0]).toContain('D 10:02:00.0000000 GameState.DebugPrintPower() - CREATE_GAME');
    expect(c.lines).toHaveLength(7);
  });

  it('restarts from 0 after truncation', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    writeFileSync(f, 'old 1\nold 2\n');
    const c = collector();
    const changes: string[] = [];
    const t = new LogTailer({ resolvePath: () => f, onLines: c.onLines, onFileChange: (i) => changes.push(i.reason) });
    await drain(t);
    truncateSync(f, 0);
    appendFileSync(f, 'new\n');
    await drain(t);
    expect(c.lines).toEqual(['new']);
    expect(changes).toEqual(['initial', 'truncated']);
  });

  it('switches to a newer session folder and reads it from the start', async () => {
    const logs = tmpDir();
    const d1 = join(logs, 'Hearthstone_2025_01_01_10_00_00');
    mkdirSync(d1);
    writeFileSync(join(d1, 'Power.log'), 'previous session\n');
    let current = join(d1, 'Power.log');
    const c = collector();
    const t = new LogTailer({ resolvePath: () => current, onLines: c.onLines, resolveIntervalMs: 0 });
    await drain(t);
    expect(c.lines).toEqual([]);
    const d2 = join(logs, 'Hearthstone_2025_01_02_10_00_00');
    mkdirSync(d2);
    current = join(d2, 'Power.log');
    await drain(t); // file does not exist yet
    writeFileSync(current, 'first\nsecond\n');
    await drain(t);
    expect(c.lines).toEqual(['first', 'second']);
    expect(t.currentPath).toBe(current);
  });

  it('catches up (instead of replaying finished games) when a log is found only later', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    writeFileSync(f, gameText(1, true) + gameText(2, false));
    let current: string | undefined; // Hearthstone not found at startup
    const c = collector();
    const changes: string[] = [];
    const t = new LogTailer({
      resolvePath: () => current,
      onLines: c.onLines,
      onFileChange: (i) => changes.push(i.reason),
      resolveIntervalMs: 0,
    });
    await drain(t);
    current = f; // e.g. the folder was set in Settings
    await drain(t);
    expect(changes).toEqual(['initial', 'switched']);
    expect(c.lines[0]).toContain('D 10:02:00.0000000 GameState.DebugPrintPower() - CREATE_GAME');
    expect(c.lines).toHaveLength(7);
  });

  it('keeps following the current file while the path cannot be resolved', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    writeFileSync(f, gameText(1, true));
    let current: string | undefined = f;
    const c = collector();
    const changes: string[] = [];
    const t = new LogTailer({
      resolvePath: () => current,
      onLines: c.onLines,
      onFileChange: (i) => changes.push(i.reason),
      resolveIntervalMs: 0,
    });
    await drain(t);
    current = undefined; // Logs folder briefly unreadable
    appendFileSync(f, 'a\n');
    await drain(t);
    current = f;
    appendFileSync(f, 'b\n');
    await drain(t);
    expect(c.lines).toEqual(['a', 'b']);
    expect(changes).toEqual(['initial']);
  });

  it('reads large backlogs in bounded chunks', async () => {
    const dir = tmpDir();
    const f = join(dir, 'Power.log');
    writeFileSync(f, '');
    const c = collector();
    const t = new LogTailer({ resolvePath: () => f, onLines: c.onLines, maxReadBytes: 64 });
    await drain(t);
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    appendFileSync(f, lines.join('\n') + '\n');
    let more = true;
    let ticks = 0;
    while (more && ticks < 1000) {
      more = await t.tick();
      ticks++;
    }
    expect(ticks).toBeGreaterThan(5);
    expect(c.lines).toEqual(lines);
  });
});
