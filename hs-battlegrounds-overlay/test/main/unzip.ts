/**
 * Minimal, strict unzip for tests: walks the end record and central directory,
 * cross-checks every local header, inflates (node:zlib) and verifies CRCs and sizes.
 */
import { inflateRawSync } from 'node:zlib';
import { crc32Js } from '../../src/main/diagnostics/zip';

export interface UnzippedEntry {
  name: string;
  method: number;
  flags: number;
  crc: number;
  data: Buffer;
  compressedSize: number;
  time: number;
  date: number;
}

export function unzip(buf: Buffer): Map<string, UnzippedEntry> {
  const eocd = buf.length - 22;
  if (buf.readUInt32LE(eocd) !== 0x06054b50) throw new Error('no end of central directory record (comment not expected)');
  const count = buf.readUInt16LE(eocd + 10);
  if (buf.readUInt16LE(eocd + 8) !== count) throw new Error('entry counts differ');
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset + cdSize !== eocd) throw new Error('central directory does not end at the end record');
  const out = new Map<string, UnzippedEntry>();
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`bad central header #${i}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const time = buf.readUInt16LE(p + 12);
    const date = buf.readUInt16LE(p + 14);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;

    if (buf.readUInt32LE(local) !== 0x04034b50) throw new Error(`bad local header for ${name}`);
    const lflags = buf.readUInt16LE(local + 6);
    const lmethod = buf.readUInt16LE(local + 8);
    const lcrc = buf.readUInt32LE(local + 14);
    const lcsize = buf.readUInt32LE(local + 18);
    const lusize = buf.readUInt32LE(local + 22);
    const lnlen = buf.readUInt16LE(local + 26);
    const lxlen = buf.readUInt16LE(local + 28);
    const lname = buf.subarray(local + 30, local + 30 + lnlen).toString('utf8');
    if (lname !== name || lflags !== flags || lmethod !== method || lcrc !== crc || lcsize !== csize || lusize !== usize) {
      throw new Error(`local header of ${name} disagrees with the central directory`);
    }
    const start = local + 30 + lnlen + lxlen;
    const body = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(body);
    else if (method === 8) data = inflateRawSync(body);
    else throw new Error(`unsupported method ${method}`);
    if (data.length !== usize) throw new Error(`size mismatch for ${name}`);
    if (crc32Js(data) !== crc) throw new Error(`CRC mismatch for ${name}`);
    if (out.has(name)) throw new Error(`duplicate entry ${name}`);
    out.set(name, { name, method, flags, crc, data, compressedSize: csize, time, date });
  }
  return out;
}
