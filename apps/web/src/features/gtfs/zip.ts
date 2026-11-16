/**
 * Purpose: read and write zip files for GTFS feeds in the browser, without a library. Reading takes
 * stored and deflated entries (DecompressionStream); writing stores the entries uncompressed, which every
 * GTFS consumer reads.
 */

const decoder = new TextDecoder();
const encoder = new TextEncoder();

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

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const source = new ReadableStream<BufferSource>({
    start(c) {
      c.enqueue(data as Uint8Array<ArrayBuffer>);
      c.close();
    },
  });
  const stream = source.pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Purpose: the text files of a zip, by name (folders kept in the name).
 * Input: the zip's bytes; `keep` picks the entries to read (all `.txt` files by default).
 * Output: name → text. Throws when the file is not a zip or uses a compression other than deflate.
 */
export async function readZip(
  bytes: Uint8Array,
  keep: (name: string) => boolean = (n) => n.toLowerCase().endsWith(".txt"),
): Promise<Record<string, string>> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last record, within the 64 KiB comment.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65_535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) throw new Error("broken zip directory");
    const method = v.getUint16(p + 10, true);
    const size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/") || !keep(name)) continue;
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error(`broken zip entry ${name}`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    if (method === 0) out[name] = decoder.decode(data);
    else if (method === 8) out[name] = decoder.decode(await inflate(data));
    else throw new Error(`${name} uses a zip compression the app does not read (${method})`);
  }
  return out;
}

/** Purpose: a zip of text files, stored without compression. Output: the zip's bytes. */
export function writeZip(files: Record<string, string>): Uint8Array {
  const entries = Object.entries(files).map(([name, text]) => {
    const n = encoder.encode(name);
    const data = encoder.encode(text);
    return { n, data, crc: crc32(data) };
  });
  const localSize = entries.reduce((s, e) => s + 30 + e.n.length + e.data.length, 0);
  const dirSize = entries.reduce((s, e) => s + 46 + e.n.length, 0);
  const out = new Uint8Array(localSize + dirSize + 22);
  const v = new DataView(out.buffer);
  let p = 0;
  const offsets: number[] = [];
  for (const e of entries) {
    offsets.push(p);
    v.setUint32(p, 0x04034b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 0x0800, true); // names in UTF-8
    v.setUint32(p + 14, e.crc, true);
    v.setUint32(p + 18, e.data.length, true);
    v.setUint32(p + 22, e.data.length, true);
    v.setUint16(p + 26, e.n.length, true);
    out.set(e.n, p + 30);
    out.set(e.data, p + 30 + e.n.length);
    p += 30 + e.n.length + e.data.length;
  }
  const dir = p;
  entries.forEach((e, i) => {
    v.setUint32(p, 0x02014b50, true);
    v.setUint16(p + 4, 20, true);
    v.setUint16(p + 6, 20, true);
    v.setUint16(p + 8, 0x0800, true);
    v.setUint32(p + 16, e.crc, true);
    v.setUint32(p + 20, e.data.length, true);
    v.setUint32(p + 24, e.data.length, true);
    v.setUint16(p + 28, e.n.length, true);
    v.setUint32(p + 42, offsets[i]!, true);
    out.set(e.n, p + 46);
    p += 46 + e.n.length;
  });
  v.setUint32(p, 0x06054b50, true);
  v.setUint16(p + 8, entries.length, true);
  v.setUint16(p + 10, entries.length, true);
  v.setUint32(p + 12, p - dir, true);
  v.setUint32(p + 16, dir, true);
  return out;
}
