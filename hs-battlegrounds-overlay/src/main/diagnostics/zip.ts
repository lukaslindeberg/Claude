/**
 * Minimal ZIP writer (PKWARE APPNOTE 6.3: local headers, central directory, end
 * record; methods 0 = stored and 8 = deflate; UTF-8 names; no ZIP64, so every
 * entry and the whole archive must stay below 4 GiB). Writes sequentially to a
 * `.partial` file that is renamed into place by `close()`, so a failed export never
 * leaves a half-written zip behind. No Electron imports.
 */
import { closeSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';

const deflateRawAsync = promisify(zlib.deflateRaw);

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3), as used by zip and gzip
// ---------------------------------------------------------------------------

let table: Uint32Array | undefined;

function crcTable(): Uint32Array {
  if (table) return table;
  table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

/** CRC-32 in plain JS (reference implementation; `crc32` prefers zlib's native one). */
export function crc32Js(data: Uint8Array, crc = 0): number {
  const t = crcTable();
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const nativeCrc = (zlib as unknown as { crc32?: (data: Uint8Array, value?: number) => number }).crc32;

export function crc32(data: Uint8Array): number {
  return nativeCrc ? nativeCrc(data) >>> 0 : crc32Js(data);
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** MS-DOS date/time fields (local time, 2-second resolution, years 1980..2107). */
export function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff,
    date: (((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff,
  };
}

export interface ZipAddOptions {
  /** Store without compression (for data that is already compressed, e.g. .gz). Default: deflate. */
  store?: boolean;
  /** Modification time stored in the entry (default: now). */
  mtime?: Date;
}

export interface ZipEntryInfo {
  name: string;
  size: number;
  compressedSize: number;
  method: 0 | 8;
}

interface CentralEntry extends ZipEntryInfo {
  nameBytes: Buffer;
  crc: number;
  time: number;
  date: number;
  offset: number;
}

const U32_MAX = 0xffffffff;
const FLAG_UTF8 = 0x0800;
const VERSION = 20; // 2.0: deflate

export class ZipWriter {
  private fd: number | undefined;
  private offset = 0;
  private readonly entries: CentralEntry[] = [];
  private readonly names = new Set<string>();
  private readonly tmp: string;

  constructor(readonly path: string) {
    this.tmp = `${path}.partial`;
    this.fd = openSync(this.tmp, 'w');
  }

  get entryList(): ZipEntryInfo[] {
    return this.entries.map(({ name, size, compressedSize, method }) => ({ name, size, compressedSize, method }));
  }

  /** Adds a file, compressing it synchronously (fine for small files). */
  add(name: string, data: Buffer | string, opts: ZipAddOptions = {}): void {
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const deflated = opts.store ? undefined : zlib.deflateRawSync(raw, { level: 6 });
    this.addPrepared(name, raw, deflated, opts.mtime);
  }

  /** Adds a file, compressing it on the libuv thread pool (large files). */
  async addAsync(name: string, data: Buffer | string, opts: ZipAddOptions = {}): Promise<void> {
    const raw = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const deflated = opts.store ? undefined : await deflateRawAsync(raw, { level: 6 });
    this.addPrepared(name, raw, deflated, opts.mtime);
  }

  private addPrepared(name: string, raw: Buffer, deflated: Buffer | undefined, mtime?: Date): void {
    if (this.fd === undefined) throw new Error('zip already closed');
    const clean = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!clean || clean.split('/').some((seg) => !seg || seg === '.' || seg === '..')) throw new Error(`bad zip entry name: ${name}`);
    if (this.names.has(clean)) throw new Error(`duplicate zip entry: ${clean}`);
    // Deflate only when it actually saves space.
    const method: 0 | 8 = deflated && deflated.length < raw.length ? 8 : 0;
    const body = method === 8 ? deflated! : raw;
    if (raw.length >= U32_MAX || body.length >= U32_MAX || this.offset + body.length + 1024 >= U32_MAX) {
      throw new Error(`zip entry too large: ${clean}`);
    }
    const nameBytes = Buffer.from(clean, 'utf8');
    const crc = crc32(raw);
    const { time, date } = dosDateTime(mtime ?? new Date());

    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(VERSION, 4);
    h.writeUInt16LE(FLAG_UTF8, 6);
    h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10);
    h.writeUInt16LE(date, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(raw.length, 22);
    h.writeUInt16LE(nameBytes.length, 26);
    h.writeUInt16LE(0, 28);

    const offset = this.offset;
    this.write(h);
    this.write(nameBytes);
    this.write(body);
    this.names.add(clean);
    this.entries.push({ name: clean, nameBytes, crc, time, date, offset, size: raw.length, compressedSize: body.length, method });
  }

  /** Writes the central directory, closes and renames the file into place. Returns the archive size. */
  close(): number {
    if (this.fd === undefined) throw new Error('zip already closed');
    const cdStart = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(VERSION, 4); // made by: MS-DOS, 2.0
      c.writeUInt16LE(VERSION, 6);
      c.writeUInt16LE(FLAG_UTF8, 8);
      c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12);
      c.writeUInt16LE(e.date, 14);
      c.writeUInt32LE(e.crc, 16);
      c.writeUInt32LE(e.compressedSize, 20);
      c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBytes.length, 28);
      c.writeUInt16LE(0, 30); // extra
      c.writeUInt16LE(0, 32); // comment
      c.writeUInt16LE(0, 34); // disk
      c.writeUInt16LE(0, 36); // internal attributes
      c.writeUInt32LE(0, 38); // external attributes
      c.writeUInt32LE(e.offset, 42);
      this.write(c);
      this.write(e.nameBytes);
    }
    const cdSize = this.offset - cdStart;
    if (this.entries.length > 0xffff) throw new Error('too many zip entries');
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(cdSize, 12);
    end.writeUInt32LE(cdStart, 16);
    end.writeUInt16LE(0, 20);
    this.write(end);
    closeSync(this.fd);
    this.fd = undefined;
    renameSync(this.tmp, this.path);
    return this.offset;
  }

  /** Gives up: closes and deletes the partial file. */
  abort(): void {
    if (this.fd !== undefined) {
      try {
        closeSync(this.fd);
      } catch {
        /* ignore */
      }
      this.fd = undefined;
    }
    try {
      unlinkSync(this.tmp);
    } catch {
      /* ignore */
    }
  }

  private write(buf: Buffer): void {
    let done = 0;
    while (done < buf.length) done += writeSync(this.fd!, buf, done, buf.length - done);
    this.offset += buf.length;
  }
}
