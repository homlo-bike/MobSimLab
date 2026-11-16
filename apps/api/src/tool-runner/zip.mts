import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";
import { ToolError } from "./errors.mts";

/**
 * Safe ZIP reading and writing for files people upload (05 §3.3): limits on the number of entries, on each
 * entry's and the total unpacked size and on the compression ratio, so an upload can never unpack to more than
 * the limit, and no entry may have an absolute, `..`, hidden or odd path. Plain ESM with erasable types only,
 * so the sandboxed tool host (host.mts) can load it without a build step in tests.
 */

/** Limits for one ZIP file. */
export interface ZipLimits {
  /** Size of the ZIP file itself. */
  zipBytes: number;
  /** Number of entries, folders included. */
  entries: number;
  /** Unpacked size of one file. */
  fileBytes: number;
  /** Unpacked size of all files together. */
  totalBytes: number;
  /** Largest unpacked size ÷ packed size of a file over 1 MB unpacked (a ratio far above JSON's is a ZIP bomb). */
  maxRatio: number;
}

/** A ZIP file that cannot be read safely; the message is shown to the person who uploaded it. */
export class ZipError extends ToolError {}

/** Allowed entry paths: relative, forward slashes, no `..`, no hidden or odd characters, at most 200 characters. */
const SAFE_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

const MB = 1024 * 1024;

/** Purpose: a size in MB for messages. */
function mb(bytes: number): string {
  return `${Math.round(bytes / MB)} MB`;
}

/**
 * Purpose: unpack a ZIP file into memory, safely.
 * Inputs: the file's bytes and its limits. Output: path → bytes, for files only (folder entries are skipped).
 * Only stored and deflated entries are accepted; encrypted entries, ZIP64, symbolic links, absolute or `..`
 * paths, duplicate names and anything over the limits are refused with a ZipError, before more than the limit
 * is inflated.
 */
export function readZip(buf: Uint8Array, limits: ZipLimits): Map<string, Buffer> {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length > limits.zipBytes) throw new ZipError(`the file is larger than ${mb(limits.zipBytes)}`);
  if (b.length < 22) throw new ZipError("the file is not a ZIP file");
  // End of central directory: 22 bytes plus a comment of up to 65535 bytes, at the end of the file.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("the file is not a ZIP file");
  const count = b.readUInt16LE(eocd + 10);
  const cdSize = b.readUInt32LE(eocd + 12);
  const cdOffset = b.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 files are not supported");
  if (count > limits.entries) throw new ZipError(`the file has more than ${limits.entries} entries`);
  if (cdOffset + cdSize > eocd) throw new ZipError("the ZIP directory is damaged");

  const files = new Map<string, Buffer>();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || b.readUInt32LE(p) !== 0x02014b50) throw new ZipError("the ZIP directory is damaged");
    const madeBy = b.readUInt16LE(p + 4) >> 8;
    const flags = b.readUInt16LE(p + 8);
    const method = b.readUInt16LE(p + 10);
    const crcDir = b.readUInt32LE(p + 16);
    const compressed = b.readUInt32LE(p + 20);
    const size = b.readUInt32LE(p + 24);
    const nameLen = b.readUInt16LE(p + 28);
    const extraLen = b.readUInt16LE(p + 30);
    const commentLen = b.readUInt16LE(p + 32);
    const external = b.readUInt32LE(p + 38);
    const local = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    // Unix file type in the high bits of the external attributes: 0o120000 is a symbolic link.
    if (madeBy === 3 && ((external >>> 16) & 0o170000) === 0o120000)
      throw new ZipError(`${name.slice(0, 80)}: symbolic links are not allowed`);
    if (name.endsWith("/")) {
      if (!SAFE_PATH.test(name.slice(0, -1)))
        throw new ZipError(`${name.slice(0, 80)}: not an allowed folder name`);
      continue;
    }
    if (flags & 0x1) throw new ZipError(`${name.slice(0, 80)}: encrypted files are not supported`);
    if (!SAFE_PATH.test(name) || name.length > 200)
      throw new ZipError(`${name.slice(0, 80)}: not an allowed file name`);
    if (files.has(name)) throw new ZipError(`${name}: the file has this entry twice`);
    if (size > limits.fileBytes) throw new ZipError(`${name}: larger than ${mb(limits.fileBytes)} unpacked`);
    if (size > MB && size / Math.max(compressed, 1) > limits.maxRatio)
      throw new ZipError(`${name}: packed too tightly to be a real file (a ZIP bomb?)`);
    total += size;
    if (total > limits.totalBytes)
      throw new ZipError(`the file unpacks to more than ${mb(limits.totalBytes)}`);

    if (local + 30 > b.length || b.readUInt32LE(local) !== 0x04034b50)
      throw new ZipError(`${name}: the ZIP entry is damaged`);
    const start = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    if (start + compressed > b.length) throw new ZipError(`${name}: the ZIP entry is damaged`);
    const raw = b.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new ZipError(`${name}: could not be unpacked`);
      }
    } else throw new ZipError(`${name}: compression method ${method} is not supported`);
    if (data.length !== size)
      throw new ZipError(`${name}: the unpacked size does not match the ZIP directory`);
    if (crc32(data) >>> 0 !== crcDir) throw new ZipError(`${name}: the file is damaged (CRC mismatch)`);
    files.set(name, data);
  }
  return files;
}

/**
 * Purpose: write files into a ZIP, deflated, with UTF-8 names.
 * Inputs: path → bytes or text, in the order they should appear. Output: the ZIP file's bytes.
 * Entries are limited to 4 GB each and 65535 in all (no ZIP64), far above what a project holds.
 */
export function writeZip(files: Iterable<[string, Uint8Array | string]>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  for (const [name, value] of files) {
    const data = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data) >>> 0;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    parts.push(head, nameBuf, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + body.length;
    count++;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
