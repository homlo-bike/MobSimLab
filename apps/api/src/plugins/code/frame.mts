/**
 * How the API hands plugin code and data to the sandboxed tool host in one buffer (stdin): a JSON header and
 * named binary parts. Layout: 4 bytes header length (big-endian), the header as UTF-8 JSON
 * `{ "meta": …, "parts": [[name, size], …] }`, then the parts in order.
 */

/** A frame that does not follow the layout. */
export class FrameError extends Error {}

/** Purpose: pack a JSON header and binary parts. */
export function pack(meta: unknown, parts: Record<string, Uint8Array>): Buffer {
  const names = Object.keys(parts);
  const head = Buffer.from(JSON.stringify({ meta, parts: names.map((n) => [n, parts[n]!.length]) }), "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(head.length);
  return Buffer.concat([len, head, ...names.map((n) => parts[n]!)]);
}

/** Purpose: unpack a frame. Throws FrameError when the sizes do not add up. */
export function unpack(buf: Buffer): { meta: unknown; parts: Map<string, Buffer> } {
  if (buf.length < 4) throw new FrameError("frame too short");
  const n = buf.readUInt32BE(0);
  if (4 + n > buf.length) throw new FrameError("frame header runs past the end");
  let head: { meta?: unknown; parts?: unknown };
  try {
    head = JSON.parse(buf.subarray(4, 4 + n).toString("utf8")) as typeof head;
  } catch {
    throw new FrameError("frame header is not JSON");
  }
  if (!Array.isArray(head.parts)) throw new FrameError("frame header has no parts");
  const parts = new Map<string, Buffer>();
  let at = 4 + n;
  for (const p of head.parts as unknown[]) {
    if (!Array.isArray(p) || typeof p[0] !== "string" || !Number.isSafeInteger(p[1]) || (p[1] as number) < 0)
      throw new FrameError("frame part is malformed");
    const size = p[1] as number;
    if (at + size > buf.length) throw new FrameError("frame part runs past the end");
    parts.set(p[0], buf.subarray(at, at + size));
    at += size;
  }
  if (at !== buf.length) throw new FrameError("frame has bytes left over");
  return { meta: head.meta, parts };
}
