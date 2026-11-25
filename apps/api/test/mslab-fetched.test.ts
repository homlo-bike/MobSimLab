import { describe, expect, it } from "vitest";
import { decodeValues, encodeValues } from "../src/geodata/dem-tiles";
import { coarseTile, factGroup, parseFetched } from "../src/mslab/fetched";

/** The fetched data of a `.mslab` file (format 1.6): coarser elevation outside full detail, and the second check. */
describe("mslab fetched data", () => {
  it("keeps every third sample of a tile and its outer rows and columns", () => {
    const values = new Float32Array(7 * 4).map((_, i) => i);
    const c = coarseTile(encodeValues(values), 7, 4)!;
    expect([c.width, c.height]).toEqual([3, 2]);
    expect([...decodeValues(c.data, 3, 2)]).toEqual([0, 3, 6, 21, 24, 27]);
    // A size that would lose its last row or column is saved as it is.
    expect(coarseTile(encodeValues(new Float32Array(30)), 6, 5)).toBeNull();
    expect(coarseTile(encodeValues(new Float32Array(4)), 2, 2)).toBeNull();
    // A whole stored tile: 256 → 86 samples a side.
    const big = coarseTile(encodeValues(new Float32Array(256 * 256)), 256, 256)!;
    expect([big.width, big.height]).toEqual([86, 86]);
  });

  it("sorts the kept facts into the switches of Saved project files", () => {
    expect(factGroup("climate/52.4,4.9")).toBe("facts");
    expect(factGroup("holidays/NL/2026")).toBe("facts");
    expect(factGroup("economy/NL/2023")).toBe("economy");
    expect(factGroup("economy-countries")).toBe("economy");
    expect(factGroup("benefit-indicators/NLD")).toBe("economy");
    expect(factGroup("osm-areas/4.900000,52.400000")).toBe("otherFetched");
  });

  it("checks what the reader wrote once more", async () => {
    const at = "2026-11-20T09:00:00.000Z";
    const files: Record<string, string> = {
      "facts.json": JSON.stringify({ entries: [{ key: "climate/1,2", fetchedAt: at, body: "{}" }] }),
      "pop.json": JSON.stringify({
        layers: [
          {
            name: "Zones",
            source: "upload",
            kind: "zones",
            licence: "",
            sourceUrl: "",
            citation: "",
            confidence: "high",
            referenceYear: null,
            resolutionM: null,
            coverage: null,
            peopleTotal: 5,
            featureCount: 1,
            isPrimary: false,
            options: {},
            updatedAt: at,
            files: 1,
          },
        ],
      }),
      "pop-1.ndjson": '[0,"a",5,"0101000000000000000000f03f0000000000000040"]\n',
      "bad.ndjson": '[0,"a",5,"xyz"]\n',
    };
    const file = async (n: string) => Buffer.from(files[n]!);
    const ok = await parseFetched(
      {
        facts: "facts.json",
        live: [],
        elevation: null,
        population: { index: "pop.json", files: [{ layer: 1, n: 1, file: "pop-1.ndjson" }] },
      },
      file,
    );
    expect(ok.facts).toHaveLength(1);
    expect(ok.population!.features.get(1)).toEqual([
      [[0, "a", 5, "0101000000000000000000f03f0000000000000040"]],
    ]);
    const bad = (population: { layer: number; n: number; file: string }[]) =>
      parseFetched(
        { facts: null, live: [], elevation: null, population: { index: "pop.json", files: population } },
        file,
      );
    await expect(bad([{ layer: 1, n: 1, file: "bad.ndjson" }])).rejects.toThrow(/not valid/);
    await expect(bad([{ layer: 2, n: 1, file: "pop-1.ndjson" }])).rejects.toThrow(/not valid/);
  });
});
