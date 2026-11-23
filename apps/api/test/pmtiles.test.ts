import { describe, expect, it } from "vitest";
import { tileId, writeArchive } from "../src/mslab/pmtiles";
import { readArchive } from "./support/pmtiles";

describe("PMTiles archive writer", () => {
  it("numbers tiles along the Hilbert curve as the spec does", () => {
    // Values from the spec's examples and the reference implementation's tests.
    expect(tileId(0, 0, 0)).toBe(0);
    expect(tileId(1, 0, 0)).toBe(1);
    expect(tileId(1, 0, 1)).toBe(2);
    expect(tileId(1, 1, 1)).toBe(3);
    expect(tileId(1, 1, 0)).toBe(4);
    expect(tileId(2, 0, 0)).toBe(5);
    expect(tileId(12, 3423, 1763)).toBe(19078479);
  });

  it("writes tiles a reader finds again, keeping identical tiles once", () => {
    const tiles = [
      { z: 14, x: 9000, y: 6000, body: Buffer.from("<osm>a</osm>") },
      { z: 14, x: 9001, y: 6000, body: Buffer.from("<osm>b</osm>") },
      { z: 14, x: 9000, y: 6001, body: Buffer.from("<osm>a</osm>") },
    ];
    const b = writeArchive(tiles, { kind: "streets" }, [36, 33, 37, 34]);
    const read = readArchive(b);
    expect(Object.fromEntries(read)).toEqual({
      "14/9000/6000": "<osm>a</osm>",
      "14/9001/6000": "<osm>b</osm>",
      "14/9000/6001": "<osm>a</osm>",
    });
    // Three tiles, two contents.
    expect(Number(b.readBigUInt64LE(72))).toBe(3);
    expect(Number(b.readBigUInt64LE(88))).toBe(2);
  });

  it("keeps the root directory in the first 16 KiB with leaf directories for many tiles", () => {
    // 20,000 tiles scattered over a 600 × 600 block, with bodies of different lengths: a directory too large
    // to be the root.
    let r = 12345;
    const rnd = () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296;
    const at = new Map<string, string>();
    while (at.size < 20_000) {
      const key = `14/${9000 + Math.floor(rnd() * 600)}/${6000 + Math.floor(rnd() * 600)}`;
      if (!at.has(key)) at.set(key, `${key} ${"x".repeat(Math.floor(rnd() * 3000))}`);
    }
    const tiles = [...at].map(([key, body]) => {
      const [z, x, y] = key.split("/").map(Number) as [number, number, number];
      return { z, x, y, body: Buffer.from(body) };
    });
    const b = writeArchive(tiles, {}, [36, 33, 37, 34]);
    expect(Number(b.readBigUInt64LE(8)) + Number(b.readBigUInt64LE(16))).toBeLessThanOrEqual(16_384);
    expect(Number(b.readBigUInt64LE(48))).toBeGreaterThan(0);
    const read = readArchive(b);
    expect(read).toEqual(at);
  });

  it("writes an empty archive", () => {
    expect(readArchive(writeArchive([], {}, [0, 0, 1, 1])).size).toBe(0);
  });
});
