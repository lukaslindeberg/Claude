import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZipWriter, crc32, crc32Js, dosDateTime } from '../../src/main/diagnostics/zip';
import { unzip } from './unzip';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tl-zip-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('crc32', () => {
  it('matches the standard check value', () => {
    const data = Buffer.from('123456789');
    expect(crc32Js(data)).toBe(0xcbf43926);
    expect(crc32(data)).toBe(0xcbf43926);
    expect(crc32Js(Buffer.alloc(0))).toBe(0);
  });
  it('agrees with gzip trailers', () => {
    const data = Buffer.from('Tavern Lens '.repeat(1000));
    const gz = gzipSync(data);
    expect(crc32(data)).toBe(gz.readUInt32LE(gz.length - 8));
  });
});

describe('dosDateTime', () => {
  it('packs local date and time with 2 s resolution', () => {
    const { time, date } = dosDateTime(new Date(2026, 10, 7, 15, 33, 59));
    expect(time >> 11).toBe(15);
    expect((time >> 5) & 63).toBe(33);
    expect((time & 31) * 2).toBe(58);
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 15).toBe(11);
    expect(date & 31).toBe(7);
  });
});

describe('ZipWriter', () => {
  it('round-trips deflated, stored, empty, binary and UTF-8 named entries', async () => {
    const path = join(dir, 'out.zip');
    const z = new ZipWriter(path);
    const text = 'line of a log file\n'.repeat(5000);
    const binary = Buffer.from(Array.from({ length: 70000 }, (_, i) => (i * 7919) & 0xff));
    const gz = gzipSync(Buffer.from('D 13:18:11.0621247 GameState.DebugPrintPower() - CREATE_GAME\n'.repeat(100)));
    z.add('README.txt', 'hello\r\n');
    z.add('logs/tavern-lens.log', text);
    await z.addAsync('logs/sim-cases.jsonl', '{"a":1}\n');
    z.add('empty.txt', '');
    z.add('bin/data.bin', binary);
    await z.addAsync('hearthstone/Hearthstone_2026_11_07_10_00_00/Power.log.gz', gz, { store: true });
    z.add('名前/ü.txt', 'utf8 name');
    const size = z.close();

    const buf = readFileSync(path);
    expect(buf.length).toBe(size);
    expect(existsSync(`${path}.partial`)).toBe(false);
    const entries = unzip(buf);
    expect([...entries.keys()]).toEqual([
      'README.txt',
      'logs/tavern-lens.log',
      'logs/sim-cases.jsonl',
      'empty.txt',
      'bin/data.bin',
      'hearthstone/Hearthstone_2026_11_07_10_00_00/Power.log.gz',
      '名前/ü.txt',
    ]);
    expect(entries.get('README.txt')!.data.toString()).toBe('hello\r\n');
    const log = entries.get('logs/tavern-lens.log')!;
    expect(log.method).toBe(8);
    expect(log.compressedSize).toBeLessThan(text.length / 20);
    expect(log.data.toString()).toBe(text);
    expect(entries.get('logs/sim-cases.jsonl')!.data.toString()).toBe('{"a":1}\n');
    expect(entries.get('empty.txt')!.data.length).toBe(0);
    expect(entries.get('bin/data.bin')!.data.equals(binary)).toBe(true);
    const stored = entries.get('hearthstone/Hearthstone_2026_11_07_10_00_00/Power.log.gz')!;
    expect(stored.method).toBe(0);
    expect(gunzipSync(stored.data).toString()).toContain('CREATE_GAME');
    const utf = entries.get('名前/ü.txt')!;
    expect(utf.flags & 0x0800).toBe(0x0800);
    expect(utf.data.toString()).toBe('utf8 name');
  });

  it('rejects duplicate and unsafe names', () => {
    const z = new ZipWriter(join(dir, 'bad.zip'));
    z.add('a.txt', 'x');
    expect(() => z.add('a.txt', 'y')).toThrow(/duplicate/);
    expect(() => z.add('../evil.txt', 'y')).toThrow(/bad zip entry/);
    expect(() => z.add('logs//x', 'y')).toThrow(/bad zip entry/);
    z.add('tavern-lens.1.log', 'fine');
    z.abort();
    expect(existsSync(join(dir, 'bad.zip'))).toBe(false);
    expect(existsSync(join(dir, 'bad.zip.partial'))).toBe(false);
  });

  it('writes a valid empty archive', () => {
    const path = join(dir, 'empty.zip');
    const z = new ZipWriter(path);
    expect(z.close()).toBe(22);
    expect(unzip(readFileSync(path)).size).toBe(0);
  });
});
