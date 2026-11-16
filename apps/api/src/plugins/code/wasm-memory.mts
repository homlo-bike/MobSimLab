/**
 * Memory limit for plugin code (ADR-0036 §4): rewrites the memory section of a core WebAssembly module so every
 * memory it defines has a maximum of at most `maxPages` (64 KiB each). `memory.grow` past it fails inside the
 * module, so a plugin cannot take more memory than the instance allows, in Node or in a browser.
 *
 * Refuses shared memories (threads) and 64-bit memories, which plugins may not use. The same code is in
 * apps/web/src/plugins/code/wasmMemory.ts for the browser; keep the two in step.
 */

/** A module that cannot run as plugin code; the message is for the Admin who installs it. */
export class WasmModuleError extends Error {}

const MAGIC = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
const MEMORY_SECTION = 5;

function readU32(b: Uint8Array, at: number): [number, number] {
  let v = 0;
  let shift = 0;
  for (let i = at; i < Math.min(b.length, at + 5); i++) {
    v += (b[i]! & 0x7f) * 2 ** shift;
    if ((b[i]! & 0x80) === 0) return [v, i + 1];
    shift += 7;
  }
  throw new WasmModuleError("the module is cut short or not WebAssembly");
}

function writeU32(v: number): number[] {
  const out: number[] = [];
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v !== 0) byte |= 0x80;
    out.push(byte);
  } while (v !== 0);
  return out;
}

/**
 * Purpose: cap the memories of a core module. Input: the module bytes and the most 64 KiB pages a memory may have.
 * Output: new module bytes (the input when it defines no memory). Throws WasmModuleError for a module that is not
 * a core module, or that uses shared or 64-bit memory, or whose memory starts above the cap.
 */
export function capMemory(bytes: Uint8Array, maxPages: number): Uint8Array {
  if (bytes.length < 8 || MAGIC.some((m, i) => bytes[i] !== m))
    throw new WasmModuleError("not a core WebAssembly module");
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at < bytes.length) {
    const id = bytes[at]!;
    const [size, body] = readU32(bytes, at + 1);
    const end = body + size;
    if (end > bytes.length) throw new WasmModuleError("a section runs past the end of the module");
    if (id !== MEMORY_SECTION) {
      parts.push(bytes.subarray(at, end));
      at = end;
      continue;
    }
    let [count, p] = readU32(bytes, body);
    const out: number[] = writeU32(count);
    while (count-- > 0) {
      const flags = bytes[p++]!;
      if (flags & 0x02) throw new WasmModuleError("plugins may not use shared memory (threads)");
      if (flags & ~0x01) throw new WasmModuleError("plugins may not use 64-bit or custom-page memories");
      let min: number;
      [min, p] = readU32(bytes, p);
      let max = maxPages;
      if (flags & 0x01) [max, p] = readU32(bytes, p);
      if (min > maxPages)
        throw new WasmModuleError(
          `the module needs ${Math.ceil(min / 16)} MB of memory at start, more than the ${Math.floor(maxPages / 16)} MB allowed`,
        );
      out.push(0x01, ...writeU32(min), ...writeU32(Math.min(max, maxPages)));
    }
    if (p !== end) throw new WasmModuleError("the memory section is malformed");
    parts.push(Uint8Array.of(MEMORY_SECTION, ...writeU32(out.length), ...out));
    at = end;
  }
  const total = parts.reduce((n, x) => n + x.length, 0);
  const result = new Uint8Array(total);
  let o = 0;
  for (const x of parts) {
    result.set(x, o);
    o += x.length;
  }
  return result;
}

/** Purpose: the number of 64 KiB pages in `mb` megabytes. */
export const pagesOf = (mb: number) => Math.max(1, Math.floor((mb * 1024 * 1024) / 65536));
