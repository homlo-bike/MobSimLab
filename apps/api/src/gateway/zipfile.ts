import { createReadStream, createWriteStream } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createInflateRaw } from "node:zlib";

/** A ZIP file that cannot be read. */
export class ZipFileError extends Error {}

/** One file inside a ZIP archive on disk. */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the entry's local header. */
  localOffset: number;
}

/**
 * Purpose: the files listed in a ZIP archive on disk (ZIP64 included), read from its central directory.
 * Throws ZipFileError when the archive is damaged.
 */
export async function zipEntries(path: string): Promise<ZipEntry[]> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 22 + 0xffff + 20);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0) throw new ZipFileError("The file is not a ZIP archive");
    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    // ZIP64 end of central directory locator, just before the classic record.
    if ((count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) && eocd >= 20) {
      if (tail.readUInt32LE(eocd - 20) !== 0x07064b50)
        throw new ZipFileError("The ZIP64 directory is damaged");
      const at = Number(tail.readBigUInt64LE(eocd - 20 + 8));
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, 56, at);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new ZipFileError("The ZIP64 directory is damaged");
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    if (count > 10_000 || cdSize > 64 * 1024 * 1024 || cdOffset + cdSize > size)
      throw new ZipFileError("The ZIP directory is damaged");
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const out: ZipEntry[] = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (p + 46 > cd.length || cd.readUInt32LE(p) !== 0x02014b50)
        throw new ZipFileError("The ZIP directory is damaged");
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let entrySize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const name = cd.subarray(p + 46, p + 46 + nameLen).toString("utf8");
      // ZIP64 extended information: the fields that are 0xffffffff, in order.
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (entrySize === 0xffffffff) {
            entrySize = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(cd.readBigUInt64LE(q));
            q += 8;
          }
          if (localOffset === 0xffffffff) localOffset = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      p = end + commentLen;
      if (flags & 1) throw new ZipFileError("Encrypted ZIP archives are not supported");
      if (!name.endsWith("/")) out.push({ name, method, compressedSize, size: entrySize, localOffset });
    }
    return out;
  } finally {
    await fh.close();
  }
}

/**
 * Purpose: unpack one entry of a ZIP archive on disk to `dest`, streaming, within `maxBytes`.
 * Side effects: writes `dest` through a temporary name. Throws ZipFileError on damaged data or a too large entry.
 */
export async function extractEntry(
  path: string,
  entry: ZipEntry,
  dest: string,
  maxBytes: number,
): Promise<void> {
  if (entry.method !== 0 && entry.method !== 8)
    throw new ZipFileError(`ZIP compression method ${entry.method} is not supported`);
  if (entry.size > maxBytes) throw new ZipFileError("The file in the ZIP archive is above the size limit");
  const fh = await open(path, "r");
  let dataAt: number;
  try {
    const local = Buffer.alloc(30);
    await fh.read(local, 0, 30, entry.localOffset);
    if (local.readUInt32LE(0) !== 0x04034b50) throw new ZipFileError("The ZIP archive is damaged");
    dataAt = entry.localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
  } finally {
    await fh.close();
  }
  const tmp = `${dest}.part-${process.pid}-${Date.now()}`;
  let got = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, done) {
      got += chunk.length;
      if (got > maxBytes) done(new ZipFileError("The file in the ZIP archive is above the size limit"));
      else done(null, chunk);
    },
  });
  const source = createReadStream(path, {
    start: dataAt,
    end: entry.compressedSize ? dataAt + entry.compressedSize - 1 : dataAt - 1,
  });
  try {
    if (entry.method === 8) await pipeline(source, createInflateRaw(), limit, createWriteStream(tmp));
    else await pipeline(source, limit, createWriteStream(tmp));
    if (got !== entry.size) throw new ZipFileError("The file in the ZIP archive is damaged");
    await rename(tmp, dest);
  } catch (e) {
    await rm(tmp, { force: true });
    if (e instanceof ZipFileError) throw e;
    throw new ZipFileError(
      `The ZIP archive cannot be unpacked: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
