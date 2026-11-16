/**
 * Purpose: write a zip of text files, stored without compression, which every GTFS consumer reads. The same
 * writer as the web app's GTFS plugin panel (apps/web/src/features/gtfs/zip.ts), for the API's `export_gtfs`.
 */

let crcTable: Uint32Array | null = null;

/** Purpose: the CRC-32 of bytes, as zip needs it. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Purpose: a zip of the files (name → text). Output: the zip's bytes. */
export function writeZip(files: Record<string, string>): Buffer {
  const entries = Object.entries(files).map(([name, text]) => {
    const n = Buffer.from(name, "utf8");
    const data = Buffer.from(text, "utf8");
    return { n, data, crc: crc32(data) };
  });
  const localSize = entries.reduce((s, e) => s + 30 + e.n.length + e.data.length, 0);
  const dirSize = entries.reduce((s, e) => s + 46 + e.n.length, 0);
  const out = Buffer.alloc(localSize + dirSize + 22);
  let p = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(p);
    out.writeUInt32LE(0x04034b50, p);
    out.writeUInt16LE(20, p + 4);
    out.writeUInt16LE(0x0800, p + 6); // names in UTF-8
    out.writeUInt32LE(e.crc, p + 14);
    out.writeUInt32LE(e.data.length, p + 18);
    out.writeUInt32LE(e.data.length, p + 22);
    out.writeUInt16LE(e.n.length, p + 26);
    e.n.copy(out, p + 30);
    e.data.copy(out, p + 30 + e.n.length);
    p += 30 + e.n.length + e.data.length;
  }
  const dir = p;
  entries.forEach((e, i) => {
    out.writeUInt32LE(0x02014b50, p);
    out.writeUInt16LE(20, p + 4);
    out.writeUInt16LE(20, p + 6);
    out.writeUInt16LE(0x0800, p + 8);
    out.writeUInt32LE(e.crc, p + 16);
    out.writeUInt32LE(e.data.length, p + 20);
    out.writeUInt32LE(e.data.length, p + 24);
    out.writeUInt16LE(e.n.length, p + 28);
    out.writeUInt32LE(offsets[i]!, p + 42);
    e.n.copy(out, p + 46);
    p += 46 + e.n.length;
  });
  out.writeUInt32LE(0x06054b50, p);
  out.writeUInt16LE(entries.length, p + 8);
  out.writeUInt16LE(entries.length, p + 10);
  out.writeUInt32LE(p - dir, p + 12);
  out.writeUInt32LE(dir, p + 16);
  return out;
}
