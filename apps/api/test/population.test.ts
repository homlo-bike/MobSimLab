import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OverpassClient } from "../src/gateway/overpass.client";
import {
  CELL_DEG,
  emptyGrid,
  lzwDecode,
  pickEntry,
  readHeader,
  WorldPopClient,
  worldPopSettings,
} from "../src/gateway/worldpop.client";
import { countries, countryQuery, PopulationService } from "../src/population/population.service";
import { buildingHomes, footprints } from "../src/street-network/street-network.service";

/** TIFF LZW encoder (MSB first, early change), the inverse of the reader's decoder. */
function lzwEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let nacc = 0;
  let width = 9;
  const emit = (code: number) => {
    acc = (acc << width) | code;
    nacc += width;
    while (nacc >= 8) {
      out.push((acc >>> (nacc - 8)) & 0xff);
      nacc -= 8;
    }
    acc &= (1 << nacc) - 1;
  };
  const dict = new Map<string, number>();
  let next = 258;
  const code = (w: string) => (w.length === 1 ? w.charCodeAt(0) : dict.get(w)!);
  emit(256);
  let w = String.fromCharCode(data[0]!);
  for (let i = 1; i < data.length; i++) {
    const c = String.fromCharCode(data[i]!);
    if (dict.has(w + c)) {
      w += c;
      continue;
    }
    emit(code(w));
    dict.set(w + c, next++);
    if (next >= 1 << width) width++;
    w = c;
  }
  emit(code(w));
  emit(257);
  if (nacc > 0) out.push((acc << (8 - nacc)) & 0xff);
  return new Uint8Array(out);
}

const NODATA = -99999;

/**
 * A small WorldPop-like BigTIFF: `width` × `height` cells of 3 arc seconds from the top-left corner
 * (`lon`, `lat`), float32 people, LZW with the horizontal predictor, 16 × 16 tiles, image
 * directory after the tiles.
 */
function buildGrid(
  lon: number,
  lat: number,
  width: number,
  height: number,
  value: (c: number, r: number) => number,
) {
  const T = 16;
  const across = Math.ceil(width / T);
  const down = Math.ceil(height / T);
  const tiles: Uint8Array[] = [];
  for (let ty = 0; ty < down; ty++)
    for (let tx = 0; tx < across; tx++) {
      const words = new Uint32Array(T * T);
      const f = new Float32Array(words.buffer);
      for (let r = 0; r < T; r++)
        for (let c = 0; c < T; c++) {
          const [gc, gr] = [tx * T + c, ty * T + r];
          f[r * T + c] = gc < width && gr < height ? value(gc, gr) : NODATA;
        }
      // Horizontal predictor on the 32-bit words.
      for (let r = 0; r < T; r++)
        for (let c = T - 1; c > 0; c--) words[r * T + c] = (words[r * T + c]! - words[r * T + c - 1]!) >>> 0;
      const bytes = new Uint8Array(T * T * 4);
      const dv = new DataView(bytes.buffer);
      words.forEach((w, i) => dv.setUint32(4 * i, w, true));
      tiles.push(lzwEncode(bytes));
    }
  const parts: Uint8Array[] = [new Uint8Array(16)];
  let at = 16;
  const offsets: number[] = [];
  for (const t of tiles) {
    offsets.push(at);
    parts.push(t);
    at += t.length;
  }
  const nodata = new TextEncoder().encode(`${NODATA}\0`);
  const entries: Array<[number, number, number[] | Uint8Array]> = [
    [256, 3, [width]],
    [257, 3, [height]],
    [258, 3, [32]],
    [259, 3, [5]],
    [277, 3, [1]],
    [317, 3, [2]],
    [322, 3, [T]],
    [323, 3, [T]],
    [324, 16, offsets],
    [325, 16, tiles.map((t) => t.length)],
    [339, 3, [3]],
    [33550, 12, [CELL_DEG, CELL_DEG, 0]],
    [33922, 12, [0, 0, 0, lon, lat, 0]],
    [42113, 2, nodata],
  ];
  const size = (type: number, n: number) => ({ 2: 1, 3: 2, 12: 8, 16: 8 })[type]! * n;
  const ifd = at;
  let extra = ifd + 8 + entries.length * 20 + 8;
  const dir = new DataView(new ArrayBuffer(8 + entries.length * 20 + 8));
  dir.setBigUint64(0, BigInt(entries.length), true);
  const tail: Uint8Array[] = [];
  const encode = (type: number, vals: number[] | Uint8Array) => {
    if (vals instanceof Uint8Array) return vals;
    const b = new DataView(new ArrayBuffer(size(type, vals.length)));
    vals.forEach((v, i) => {
      if (type === 3) b.setUint16(2 * i, v, true);
      else if (type === 12) b.setFloat64(8 * i, v, true);
      else b.setBigUint64(8 * i, BigInt(v), true);
    });
    return new Uint8Array(b.buffer);
  };
  entries.forEach(([tag, type, vals], i) => {
    const e = 8 + i * 20;
    const bytes = encode(type, vals);
    dir.setUint16(e, tag, true);
    dir.setUint16(e + 2, type, true);
    dir.setBigUint64(e + 4, BigInt(vals.length), true);
    if (bytes.length <= 8) new Uint8Array(dir.buffer).set(bytes, e + 12);
    else {
      dir.setBigUint64(e + 12, BigInt(extra), true);
      tail.push(bytes);
      extra += bytes.length;
    }
  });
  parts.push(new Uint8Array(dir.buffer), ...tail);
  const head = new DataView(parts[0]!.buffer);
  head.setUint8(0, 0x49);
  head.setUint8(1, 0x49);
  head.setUint16(2, 43, true);
  head.setUint16(4, 8, true);
  head.setBigUint64(8, BigInt(ifd), true);
  return Buffer.concat(parts);
}

describe("LZW", () => {
  it("decodes what the TIFF encoder wrote, across code width changes", () => {
    const data = new Uint8Array(5000).map((_, i) => ((i * 7919) % 251) ^ (i >> 5));
    const enc = lzwEncode(data);
    expect(Array.from(lzwDecode(enc, data.length))).toEqual(Array.from(data));
  });
});

describe("WorldPop catalogue", () => {
  const answer = {
    data: [2015, 2025, 2026, 2030].map((y) => ({
      popyear: String(y),
      doi: "10.5258/SOTON/WP00839",
      citation: `cite ${y}`,
      files: [`https://data.worldpop.org/GIS/x/${y}/LUX/lux_pop_${y}.tif`],
    })),
  };

  it("picks the year nearest the current one", () => {
    expect(pickEntry(answer, "LUX", 2026)?.year).toBe(2026);
    expect(pickEntry(answer, "LUX", 2041)?.year).toBe(2030);
    expect(pickEntry(answer, "LUX", 2026)?.url).toBe(
      "https://data.worldpop.org/GIS/x/2026/LUX/lux_pop_2026.tif",
    );
  });

  it("takes files from WorldPop's file server only", () => {
    const other = { data: [{ popyear: "2026", files: ["https://example.org/lux.tif"] }] };
    expect(pickEntry(other, "LUX", 2026)).toBeNull();
    expect(pickEntry({}, "LUX", 2026)).toBeNull();
  });

  it("reads its settings from the environment", () => {
    const s = worldPopSettings({ MOBSIMLAB_DATA_DIR: "/srv", MOBSIMLAB_WORLDPOP_MAX_FILE_MB: "10" });
    expect(s.cacheDir).toBe("/srv/worldpop");
    expect(s.maxFileBytes).toBe(10 * 1024 * 1024);
    expect(() => worldPopSettings({ MOBSIMLAB_WORLDPOP_API: "http://insecure.example" })).toThrow();
  });
});

describe("countries from OpenStreetMap", () => {
  it("asks for the areas at the corners and the centre", () => {
    const q = countryQuery([6, 49.5, 6.2, 49.7]);
    expect(q.match(/is_in\(/g)).toHaveLength(5);
    expect(q).toContain('area._["ISO3166-1:alpha3"]');
  });

  it("lists each alpha-3 code once", () => {
    const json = JSON.stringify({
      elements: [
        { tags: { "ISO3166-1:alpha3": "LUX" } },
        { tags: { "ISO3166-1:alpha3": "DEU" } },
        { tags: { "ISO3166-1:alpha3": "LUX" } },
        { tags: { name: "Bundesland" } },
      ],
    });
    expect(countries(json)).toEqual(["DEU", "LUX"]);
  });
});

describe("building use from OpenStreetMap", () => {
  it("tells homes from other uses and leaves building=yes open", () => {
    expect(buildingHomes({ building: "house" })).toBe(true);
    expect(buildingHomes({ building: "apartments" })).toBe(true);
    expect(buildingHomes({ building: "retail" })).toBe(false);
    expect(buildingHomes({ building: "garage" })).toBe(false);
    expect(buildingHomes({ building: "yes" })).toBeUndefined();
  });

  it("puts the use on the footprints", () => {
    const g = [
      { lat: 50, lon: 7 },
      { lat: 50, lon: 7.001 },
      { lat: 50.001, lon: 7.001 },
      { lat: 50, lon: 7 },
    ];
    const json = JSON.stringify({
      elements: [
        { type: "way", id: 1, tags: { building: "house" }, geometry: g },
        { type: "way", id: 2, tags: { building: "church" }, geometry: g },
        { type: "way", id: 3, tags: { building: "yes" }, geometry: g },
      ],
    });
    expect(footprints(json).map((b) => b.homes)).toEqual([true, false, undefined]);
  });
});

describe("WorldPop grid", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "worldpop-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // Luxembourg-like file: 20 × 12 cells from 7° E, 50.01° N; 1 + col/10 + row people, one cell no data.
  const LON = 7;
  const LAT = 50.01;
  const people = (c: number, r: number) => (c === 3 && r === 2 ? NODATA : 1 + c / 10 + r);
  const lux = buildGrid(LON, LAT, 20, 12, people);
  const catalogue = (iso3: string) =>
    JSON.stringify({
      data: [
        {
          popyear: "2026",
          doi: "10.5258/SOTON/WP00839",
          citation: "Bondarenko M. et al. 2025",
          files: [`https://data.worldpop.org/GIS/${iso3}/${iso3.toLowerCase()}_pop_2026.tif`],
        },
      ],
    });

  function client(files: Record<string, Uint8Array | Promise<Uint8Array>>, calls: string[] = [], max = 1e9) {
    const fetchImpl = (async (url: string) => {
      calls.push(url);
      const u = new URL(url);
      if (u.hostname === "hub.worldpop.org") return new Response(catalogue(u.searchParams.get("iso3")!));
      const body = files[u.pathname.split("/")[2]!];
      if (!body) return new Response("missing", { status: 404 });
      const bytes = await body;
      return new Response(Buffer.from(bytes), { headers: { "content-length": String(bytes.length) } });
    }) as typeof fetch;
    return new WorldPopClient({
      cacheDir: dir,
      maxFileBytes: max,
      maxCacheBytes: 1e9,
      fetchImpl,
      sleep: async () => undefined,
      now: () => new Date("2026-11-10T00:00:00Z"),
    });
  }

  function overpass(codes: string[]) {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ elements: codes.map((c) => ({ tags: { "ISO3166-1:alpha3": c } })) }),
      )) as unknown as typeof fetch;
    return new OverpassClient({ fetchImpl, minIntervalMs: 0, sleep: async () => undefined });
  }

  it("reads the header of the file", async () => {
    const h = await readHeader(async (o, l) => lux.subarray(o, o + l));
    expect([h.width, h.height, h.tileWidth, h.compression, h.predictor, h.noData]).toEqual([
      20,
      12,
      16,
      5,
      2,
      NODATA,
    ]);
    expect(h.originLon).toBeCloseTo(LON, 9);
  });

  it("downloads a country once and reads the cells of an area", async () => {
    const calls: string[] = [];
    const svc = new PopulationService(overpass(["LUX"]), client({ LUX: lux }, calls));
    // Cells 2..5 east, rows 1..3 from the top.
    const bbox: [number, number, number, number] = [
      LON + 2 * CELL_DEG + 1e-7,
      LAT - 4 * CELL_DEG + 1e-7,
      LON + 6 * CELL_DEG - 1e-7,
      LAT - 1 * CELL_DEG - 1e-7,
    ];
    const a = await svc.grid(bbox);
    expect(a.status).toBe("ready");
    if (a.status !== "ready") return;
    expect([a.grid.nx, a.grid.ny]).toEqual([4, 3]);
    expect(a.grid.x0).toBeCloseTo(LON + 2 * CELL_DEG, 9);
    expect(a.grid.y0).toBeCloseTo(LAT - 4 * CELL_DEG, 9);
    // Bottom row of the grid is file row 3; the top row is file row 1.
    expect(a.grid.people.slice(0, 4)).toEqual([4.2, 4.3, 4.4, 4.5]);
    expect(a.grid.people.slice(8, 12)).toEqual([2.2, 2.3, 2.4, 2.5]);
    // The no-data cell (col 3, row 2) counts as nobody.
    expect(a.grid.people[4 + 1]).toBe(0);
    expect(a.source.countries).toEqual(["LUX"]);
    expect(a.source.year).toBe(2026);
    await svc.grid(bbox);
    expect(calls.filter((c) => c.endsWith(".tif"))).toHaveLength(1);
    expect(await readdir(dir)).toEqual(["lux_pop_2026.tif"]);
  });

  it("adds up the countries that share an area", async () => {
    // The neighbour's file covers the 10 cells east of the first.
    const deu = buildGrid(LON + 20 * CELL_DEG, LAT, 10, 12, () => 2);
    const svc = new PopulationService(overpass(["DEU", "LUX"]), client({ LUX: lux, DEU: deu }));
    const a = await svc.grid([
      LON + 18.5 * CELL_DEG,
      LAT - 1.5 * CELL_DEG,
      LON + 21.5 * CELL_DEG,
      LAT - 0.5 * CELL_DEG,
    ]);
    expect(a.status).toBe("ready");
    if (a.status !== "ready") return;
    expect([a.grid.nx, a.grid.ny]).toEqual([4, 2]);
    // Top row of the grid is file row 0: 2.8, 2.9 in the first country, then 2 and 2.
    expect(a.grid.people.slice(4)).toEqual([2.8, 2.9, 2, 2]);
  });

  it("answers loading while a country is still downloading, then ready", async () => {
    let release: (b: Uint8Array) => void = () => undefined;
    const slow = new Promise<Uint8Array>((r) => (release = r));
    const svc = new PopulationService(overpass(["LUX"]), client({ LUX: slow }));
    const bbox: [number, number, number, number] = [LON + 0.001, LAT - 0.005, LON + 0.004, LAT - 0.001];
    const first = await svc.grid(bbox, 20);
    expect(first.status).toBe("loading");
    release(lux);
    await new Promise((r) => setTimeout(r, 50));
    expect((await svc.grid(bbox, 2_000)).status).toBe("ready");
  });

  it("answers unavailable when a country file is above the size limit", async () => {
    const svc = new PopulationService(overpass(["LUX"]), client({ LUX: lux }, [], 100));
    const a = await svc.grid([LON + 0.001, LAT - 0.005, LON + 0.004, LAT - 0.001]);
    expect(a.status).toBe("unavailable");
    if (a.status === "unavailable") expect(a.reason).toMatch(/limit/);
    expect(await readdir(dir)).toEqual([]);
  });

  it("answers unavailable at sea and refuses areas that are too large", async () => {
    const svc = new PopulationService(overpass([]), client({}));
    expect((await svc.grid([3, 54, 3.01, 54.01])).status).toBe("unavailable");
    await expect(svc.grid([3, 54, 3.5, 54.1])).rejects.toThrow(RangeError);
  });

  it("lays the area on the 3-arc-second lattice", () => {
    const g = emptyGrid([7.0001, 50.0001, 7.0019, 50.0009]);
    expect([g.nx, g.ny]).toEqual([3, 2]);
    expect(g.x0).toBeCloseTo(7, 9);
  });

  it("writes nothing for a file it never got", async () => {
    await writeFile(join(dir, "keep.txt"), "x");
    const svc = new PopulationService(overpass(["LUX"]), client({}));
    expect((await svc.grid([LON + 0.001, LAT - 0.005, LON + 0.004, LAT - 0.001])).status).toBe("unavailable");
    expect(await readdir(dir)).toEqual(["keep.txt"]);
  });
});
