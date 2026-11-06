/**
 * Polling Power.log tailer. No Electron imports (testable).
 *
 * fs.watch is unreliable on Windows for files that are being appended to by
 * another process, so we poll `stat` every ~100 ms and read whatever was appended.
 * - Bytes are buffered until a newline so only complete lines are emitted.
 * - Truncation (size < position) and rotation (inode change) restart at 0.
 * - `resolvePath` is re-evaluated every couple of seconds so a newer
 *   `Hearthstone_*` session folder is picked up (read from its beginning). A switch
 *   from no file at all (Hearthstone found later) catches up like the initial file.
 * - On start, if the current file contains a game in progress, reading starts at
 *   the LAST CREATE_GAME so the tracker catches up; otherwise at end of file.
 */
import { open, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createLogger } from '../logger';

const log = createLogger('tailer');

const GS_CREATE = 'GameState.DebugPrintPower() - CREATE_GAME';
const ANY_CREATE = 'DebugPrintPower() - CREATE_GAME';
const COMPLETE = 'TAG_CHANGE Entity=GameEntity tag=STATE value=COMPLETE';

export type FileChangeReason = 'initial' | 'switched' | 'truncated' | 'rotated';

export interface LogTailerOptions {
  /** Returns the Power.log path to follow (re-evaluated every `resolveIntervalMs`). */
  resolvePath: () => string | undefined;
  /** Complete lines (without line terminators), in order. */
  onLines: (lines: string[], path: string) => void;
  /** Called when the followed file changes or restarts. */
  onFileChange?: (info: { path: string | undefined; reason: FileChangeReason; startOffset: number }) => void;
  pollIntervalMs?: number;
  resolveIntervalMs?: number;
  /** Max bytes read per tick (keeps the main thread responsive during catch-up). */
  maxReadBytes?: number;
  /** Start from the last CREATE_GAME when the initial file has a game in progress (default true). */
  catchUpOnStart?: boolean;
}

interface MarkerHit {
  offset: number; // byte offset of the start of the line
  kind: 'gsCreate' | 'create' | 'complete';
}

/**
 * Scans a log backwards and returns the byte offset of the line that starts the
 * game in progress (the last CREATE_GAME with no `STATE value=COMPLETE` after it),
 * or undefined if the last game is finished / no game found.
 *
 * Prefers the GameState CREATE_GAME of the last game over the PowerTaskList one
 * (PowerTaskList re-prints packets slightly later) so the parser picks GameState.
 */
export async function findGameInProgressOffset(
  path: string,
  opts: { chunkSize?: number; maxScanBytes?: number } = {},
): Promise<number | undefined> {
  const chunkSize = opts.chunkSize ?? 1024 * 1024;
  const maxScan = opts.maxScanBytes ?? 96 * 1024 * 1024;
  const PAD = 1024;
  let fh: FileHandle | undefined;
  try {
    fh = await open(path, 'r');
    const size = (await fh.stat()).size;
    const hits: MarkerHit[] = [];
    let chunkEnd = size;
    let lastCreate: MarkerHit | undefined;
    while (chunkEnd > 0 && size - chunkEnd < maxScan) {
      const chunkStart = Math.max(0, chunkEnd - chunkSize);
      const readStart = Math.max(0, chunkStart - PAD);
      const readEnd = Math.min(size, chunkEnd + PAD);
      const buf = Buffer.alloc(readEnd - readStart);
      await fh.read(buf, 0, buf.length, readStart);
      // latin1 keeps string indices == byte offsets (markers are ASCII).
      const text = buf.toString('latin1');
      const chunkHits: MarkerHit[] = [];
      const collect = (needle: string, kindOf: (idx: number) => MarkerHit['kind']) => {
        let idx = text.indexOf(needle);
        while (idx >= 0) {
          const abs = readStart + idx;
          if (abs >= chunkStart && abs < chunkEnd) {
            const nl = text.lastIndexOf('\n', idx);
            chunkHits.push({ offset: nl >= 0 ? readStart + nl + 1 : readStart, kind: kindOf(idx) });
          }
          idx = text.indexOf(needle, idx + needle.length);
        }
      };
      collect(ANY_CREATE, (idx) =>
        text.slice(Math.max(0, idx - 10), idx + ANY_CREATE.length).endsWith(GS_CREATE) ? 'gsCreate' : 'create',
      );
      collect(COMPLETE, () => 'complete');
      hits.push(...chunkHits);
      if (!lastCreate) {
        const creates = chunkHits.filter((h) => h.kind !== 'complete').sort((a, b) => b.offset - a.offset);
        if (creates.length) lastCreate = creates[0];
      }
      if (lastCreate) {
        if (lastCreate.kind === 'gsCreate') break;
        // PowerTaskList CREATE_GAME: keep looking back for the GameState one of the
        // same game until any earlier marker shows up (or we've gone far enough).
        const anchor = lastCreate.offset;
        if (hits.some((h) => h.offset < anchor) || anchor - chunkStart >= 8 * 1024 * 1024 || chunkStart === 0) break;
      }
      chunkEnd = chunkStart;
    }
    if (!lastCreate) return undefined;
    let chosen = lastCreate.offset;
    if (lastCreate.kind !== 'gsCreate') {
      // Look for the GameState CREATE_GAME of the same game (no COMPLETE in between).
      const before = hits.filter((h) => h.offset < lastCreate!.offset).sort((a, b) => b.offset - a.offset);
      for (const h of before) {
        if (h.kind === 'complete') break;
        if (h.kind === 'gsCreate') {
          chosen = h.offset;
          break;
        }
        if (h.kind === 'create') break; // an older game
      }
    }
    const finished = hits.some((h) => h.kind === 'complete' && h.offset > chosen);
    return finished ? undefined : chosen;
  } catch {
    return undefined;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}

/** Splits buffered bytes into complete lines + remainder. Exported for tests. */
export function splitLines(pending: Buffer, chunk: Buffer): { lines: string[]; rest: Buffer } {
  const data = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  const lastNl = data.lastIndexOf(0x0a);
  if (lastNl < 0) return { lines: [], rest: data };
  const text = data.subarray(0, lastNl).toString('utf8');
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line.length) lines.push(line);
  }
  return { lines, rest: Buffer.from(data.subarray(lastNl + 1)) };
}

export class LogTailer {
  private readonly opts: Required<Omit<LogTailerOptions, 'onFileChange'>> & Pick<LogTailerOptions, 'onFileChange'>;
  private path: string | undefined;
  private pos = 0;
  private ino: number | bigint | undefined;
  private pending: Buffer = Buffer.alloc(0);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private busy = false;
  private lastResolve = 0;
  private started = false;
  private exists = false;
  private lastActivity = 0;

  constructor(options: LogTailerOptions) {
    this.opts = {
      pollIntervalMs: 100,
      resolveIntervalMs: 2000,
      maxReadBytes: 1024 * 1024,
      catchUpOnStart: true,
      ...options,
    };
  }

  get currentPath(): string | undefined {
    return this.path;
  }
  get position(): number {
    return this.pos;
  }
  /** Whether the followed file currently exists. */
  get fileExists(): boolean {
    return this.exists;
  }
  /** Epoch ms of the last time new bytes were read. */
  get lastActivityAt(): number {
    return this.lastActivity;
  }
  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  /** Forces `resolvePath` to be re-evaluated on the next tick. */
  refreshPath(): void {
    this.lastResolve = 0;
  }

  private schedule(ms: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().then((more) => this.schedule(more ? 0 : this.opts.pollIntervalMs));
    }, ms);
  }

  /** One poll step. Returns true if more data is immediately available. Public for tests. */
  async tick(): Promise<boolean> {
    if (this.busy) return false;
    this.busy = true;
    try {
      const now = Date.now();
      if (!this.started || now - this.lastResolve >= this.opts.resolveIntervalMs) {
        this.lastResolve = now;
        let next: string | undefined;
        try {
          next = this.opts.resolvePath();
        } catch {
          next = this.path;
        }
        if (!this.started) {
          this.started = true;
          await this.switchTo(next, 'initial');
        } else if (next !== undefined && next !== this.path) {
          // (undefined = can't tell right now, e.g. the Logs folder is unreadable: keep
          // following the current file rather than dropping and later re-reading it.)
          await this.switchTo(next, 'switched');
        }
      }
      if (!this.path) return false;
      return await this.readMore();
    } catch (err) {
      log.warn('tick failed', err);
      return false;
    } finally {
      this.busy = false;
    }
  }

  private async switchTo(path: string | undefined, reason: FileChangeReason): Promise<void> {
    // Following nothing before (Hearthstone not found yet, Logs folder unreadable): an
    // existing file's content was never seen, so treat it like the initial file and only
    // catch up on a game in progress. Reading it from 0 would replay (and save to history
    // again) every finished game of the session.
    const catchUp = reason === 'initial' || this.path === undefined;
    this.path = path;
    this.pending = Buffer.alloc(0);
    this.pos = 0;
    this.ino = undefined;
    this.exists = false;
    if (path) {
      try {
        const st = await stat(path);
        this.exists = true;
        this.ino = st.ino;
        if (catchUp) {
          const offset = this.opts.catchUpOnStart ? await findGameInProgressOffset(path) : undefined;
          this.pos = offset ?? st.size;
          if (offset !== undefined) log.info(`game in progress: catching up from byte ${offset} of ${path}`);
        }
      } catch {
        // Not created yet: will be read from the start once it appears.
      }
    }
    log.info(`following ${path ?? '(none)'} (${reason}, offset ${this.pos})`);
    this.opts.onFileChange?.({ path, reason, startOffset: this.pos });
  }

  private async readMore(): Promise<boolean> {
    const path = this.path!;
    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(path);
    } catch {
      this.exists = false;
      return false;
    }
    this.exists = true;
    if (this.ino !== undefined && st.ino && this.ino && st.ino !== this.ino) {
      this.restart('rotated');
    } else if (st.size < this.pos) {
      this.restart('truncated');
    }
    this.ino = st.ino;
    if (st.size <= this.pos) return false;

    const toRead = Math.min(st.size - this.pos, this.opts.maxReadBytes);
    const buf = Buffer.alloc(toRead);
    let bytesRead = 0;
    const fh = await open(path, 'r');
    try {
      ({ bytesRead } = await fh.read(buf, 0, toRead, this.pos));
    } finally {
      await fh.close().catch(() => undefined);
    }
    if (bytesRead <= 0) return false;
    this.pos += bytesRead;
    this.lastActivity = Date.now();
    const { lines, rest } = splitLines(this.pending, buf.subarray(0, bytesRead));
    // Guard against a runaway partial line (binary garbage without newlines).
    this.pending = rest.length > 4 * 1024 * 1024 ? Buffer.alloc(0) : rest;
    if (lines.length) {
      try {
        this.opts.onLines(lines, path);
      } catch (err) {
        log.error('onLines handler failed', err);
      }
    }
    return this.pos < st.size;
  }

  private restart(reason: 'truncated' | 'rotated'): void {
    log.info(`${this.path} ${reason}; restarting at 0`);
    this.pos = 0;
    this.pending = Buffer.alloc(0);
    this.opts.onFileChange?.({ path: this.path, reason, startOffset: 0 });
  }
}
