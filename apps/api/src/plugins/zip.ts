import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/** Limits for a plugin package (ADR-0036 §11, PL3): an upload can never unpack to more than this. */
export const ZIP_LIMITS = {
  /** Size of the uploaded file. */
  packageBytes: 10 * 1024 * 1024,
  /** Number of files in it. */
  files: 500,
  /** Unpacked size of one file. */
  fileBytes: 5 * 1024 * 1024,
  /** Unpacked size of all files together. */
  totalBytes: 25 * 1024 * 1024,
} as const;

/** A package that cannot be read; the message is shown to the Admin. */
export class PackageError extends Error {}

/** Allowed file paths: relative, forward slashes, no `..`, no hidden or odd characters. */
const SAFE_PATH = /^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

/**
 * Purpose: unpack a ZIP file (a `.msplugin` package) into memory, safely.
 * Inputs: the file's bytes. Output: path → bytes, for files only (folder entries are skipped).
 * Only stored and deflated entries are accepted; encrypted entries, ZIP64, absolute or `..` paths, duplicate
 * names and anything over ZIP_LIMITS are refused with a PackageError, before more than the limit is inflated.
 */
export function unzip(buf: Buffer): Map<string, Buffer> {
  if (buf.length > ZIP_LIMITS.packageBytes) throw new PackageError("the package is larger than 10 MB");
  // End of central directory: 22 bytes plus a comment of up to 65535 bytes, at the end of the file.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new PackageError("the file is not a ZIP package");
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new PackageError("ZIP64 packages are not supported");
  if (count > ZIP_LIMITS.files) throw new PackageError(`the package has more than ${ZIP_LIMITS.files} files`);
  if (cdOffset + cdSize > eocd) throw new PackageError("the ZIP directory is damaged");

  const files = new Map<string, Buffer>();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== 0x02014b50)
      throw new PackageError("the ZIP directory is damaged");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    if (flags & 0x1) throw new PackageError(`${name}: encrypted files are not supported`);
    if (!SAFE_PATH.test(name) || name.length > 200)
      throw new PackageError(`${name.slice(0, 80)}: not an allowed file name`);
    if (files.has(name)) throw new PackageError(`${name}: the package has this file twice`);
    if (size > ZIP_LIMITS.fileBytes) throw new PackageError(`${name}: larger than 5 MB unpacked`);
    total += size;
    if (total > ZIP_LIMITS.totalBytes) throw new PackageError("the package unpacks to more than 25 MB");

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50)
      throw new PackageError(`${name}: the ZIP entry is damaged`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + compressed > buf.length) throw new PackageError(`${name}: the ZIP entry is damaged`);
    const raw = buf.subarray(start, start + compressed);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try {
        data = inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
      } catch {
        throw new PackageError(`${name}: could not be unpacked`);
      }
    } else throw new PackageError(`${name}: compression method ${method} is not supported`);
    if (data.length !== size)
      throw new PackageError(`${name}: the unpacked size does not match the ZIP directory`);
    files.set(name, data);
  }
  return files;
}

/**
 * Purpose: write files into a ZIP (deflated). Used by the tests to build packages.
 * Inputs: path → bytes. Output: the ZIP file's bytes.
 */
export function zip(files: ReadonlyMap<string, Buffer> | Record<string, Buffer | string>): Buffer {
  const entries = files instanceof Map ? [...files] : Object.entries(files);
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const data = typeof value === "string" ? Buffer.from(value) : value;
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, body);
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
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
