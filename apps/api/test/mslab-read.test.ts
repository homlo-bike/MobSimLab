import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/mslab/migrations.mts";
import { ToolInputError, ToolRunner } from "../src/tool-runner/runner";
import { writeZip } from "../src/tool-runner/zip.mts";

/** The sandboxed .mslab reader (ADR-0021): fixtures of each format version, and files it must refuse. */
const FIXTURES = join(__dirname, "fixtures", "mslab");

/** Purpose: the files of a fixture folder, path → bytes. */
function folder(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p).split("\\").join("/"), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

/** Purpose: the files with the manifest's checksums brought up to date (for files changed by a test). */
function resign(files: Map<string, Buffer>, change: (m: Record<string, unknown>) => void = () => {}) {
  const m = JSON.parse(files.get("manifest.json")!.toString()) as Record<string, unknown>;
  const listed: Record<string, { sha256: string; bytes: number }> = {};
  for (const [n, b] of files)
    if (n !== "manifest.json")
      listed[n] = { sha256: createHash("sha256").update(b).digest("hex"), bytes: b.length };
  m.files = listed;
  change(m);
  files.set("manifest.json", Buffer.from(JSON.stringify(m)));
  return files;
}

describe("mslab reader", () => {
  const runner = new ToolRunner();
  const read = (zip: Buffer) => runner.run("mslab-read", zip, async (r) => r as Record<string, unknown>);
  const refused = async (zip: Buffer, message: RegExp) => {
    const e = await read(zip).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(ToolInputError);
    expect((e as Error).message).toMatch(message);
  };

  it("reads a file saved in format 1.0.0", async () => {
    const r = await read(writeZip(folder(join(FIXTURES, "1.0.0"))));
    expect(r).toMatchObject({
      formatVersion: "1.0.0",
      migratedFrom: null,
      project: { name: "Lakeside tram", areaName: "Lakeside", modes: ["tram", "bus"] },
      plugins: [{ id: "org.mobsimlab.gtfs", enabled: true, version: null }],
      drawings: [
        { kind: "preferences", file: "drawing-preferences.json" },
        { kind: "railway", file: "drawing-railway.json" },
        { kind: "street-lines", file: "drawing-street-lines.json" },
      ],
      runs: [{ file: "run-1.json", network: "run-1-network.txt", lines: "run-1-lines.txt", replay: null }],
      skipped: [],
    });
  });

  it("leaves out drawings of tools this version does not have, and newer drawing versions", async () => {
    const files = folder(join(FIXTURES, "1.0.0"));
    files.set(
      "data/tunnels.json",
      Buffer.from(
        JSON.stringify({ kind: "tunnels", schemaVersion: 1, updatedAt: "2026-11-16T10:00:00Z", doc: {} }),
      ),
    );
    const rail = JSON.parse(files.get("data/railway.json")!.toString());
    files.set("data/railway.json", Buffer.from(JSON.stringify({ ...rail, schemaVersion: 2 })));
    const r = await read(writeZip(resign(files)));
    expect((r.drawings as { kind: string }[]).map((d) => d.kind)).toEqual(["preferences", "street-lines"]);
    expect(r.skipped).toEqual([
      "railway: saved as version 2, this MobSimLab reads 1",
      "tunnels: this MobSimLab does not have this tool",
    ]);
  });

  it("refuses files from a newer MobSimLab", async () => {
    for (const v of ["1.7.0", "2.0.0"]) {
      const files = resign(folder(join(FIXTURES, "1.0.0")), (m) => (m.formatVersion = v));
      await refused(writeZip(files), /newer MobSimLab/);
    }
  });

  it("reads a file with map data (format 1.1) and leaves the map data out", async () => {
    const files = folder(join(FIXTURES, "1.0.0"));
    files.set(
      "map/area.json",
      Buffer.from(JSON.stringify({ bbox: [0, 0, 1, 1], zoom: 14, kinds: [], tiles: [] })),
    );
    files.set("map/streets/8192-8191.xml", Buffer.from("<osm/>"));
    files.set("map/buildings/8192-8191.json", Buffer.from('{"buildings":[]}'));
    const r = await read(
      writeZip(
        resign(files, (m) => {
          m.formatVersion = "1.1.0";
          m.includes = { runs: true, map: true };
        }),
      ),
    );
    expect(r).toMatchObject({ formatVersion: "1.1.0", migratedFrom: null, skipped: [] });
    expect((r.drawings as unknown[]).length).toBe(3);

    const unlisted = folder(join(FIXTURES, "1.0.0"));
    unlisted.set("map/water.json", Buffer.from("{}"));
    await refused(
      writeZip(resign(unlisted, (m) => (m.formatVersion = "1.1.0"))),
      /holds map data but its manifest says it does not/,
    );
  });

  it("reads a file with saved results (format 1.2) and hands them over", async () => {
    const files = folder(join(FIXTURES, "1.0.0"));
    const result = {
      kind: "noise",
      inputs: "0123456789abcdef",
      computedAt: "2026-11-18T17:00:00.000Z",
      doc: { version: 1, value: { result: { kind: "done" } } },
    };
    files.set("results/noise.json", Buffer.from(JSON.stringify(result)));
    const r = await read(writeZip(resign(files, (m) => (m.formatVersion = "1.2.0"))));
    expect(r).toMatchObject({
      formatVersion: "1.2.0",
      results: [{ kind: "noise", file: "result-noise.json" }],
      skipped: [],
    });

    const wrong = folder(join(FIXTURES, "1.0.0"));
    wrong.set("results/noise.json", Buffer.from(JSON.stringify({ ...result, kind: "walk-coverage" })));
    await refused(
      writeZip(resign(wrong, (m) => (m.formatVersion = "1.2.0"))),
      /holds a result of kind "walk-coverage"/,
    );
    const bad = folder(join(FIXTURES, "1.0.0"));
    bad.set("results/noise.json", Buffer.from(JSON.stringify({ ...result, inputs: "not a fingerprint!" })));
    await refused(writeZip(resign(bad, (m) => (m.formatVersion = "1.2.0"))), /results\/noise\.json/);
  });

  it("reads comments, the history of changed values and a run's files (format 1.5)", async () => {
    const run = "0194f3a2-6c1d-7b2e-9f00-4a5b6c7d8e9f";
    const files = folder(join(FIXTURES, "1.0.0"));
    const runJson = JSON.parse(files.get(`runs/${run}/run.json`)!.toString()) as Record<string, unknown>;
    files.set(
      `runs/${run}/run.json`,
      Buffer.from(
        JSON.stringify({ ...runJson, files: [{ name: "od.omx", mediaType: "application/x-hdf5" }] }),
      ),
    );
    files.set(`runs/${run}/files/od.omx`, Buffer.from("OMX"));
    const comment = {
      id: "0194f3a2-6c1d-7b2e-9f00-000000000001",
      objectType: "station",
      objectId: "s1",
      parentId: null,
      body: "Move the entrance",
      author: "Rana",
      createdAt: "2026-11-18T17:00:00.000Z",
      editedAt: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    files.set("collab/comments.json", Buffer.from(JSON.stringify({ comments: [comment] })));
    const change = {
      id: "street.mixed_traffic_delay_share",
      kind: "changed",
      before: { value: null, reason: null },
      after: { value: 0.25, reason: "survey" },
      reason: "survey",
      at: "2026-11-18T17:00:00.000Z",
      by: "Rana",
    };
    files.set("history/values.json", Buffer.from(JSON.stringify({ entries: [change] })));
    const r = await read(writeZip(resign(files, (m) => (m.formatVersion = "1.5.0"))));
    expect(r).toMatchObject({
      formatVersion: "1.5.0",
      comments: "comments.json",
      history: "history.json",
      runs: [{ files: [{ name: "od.omx", mediaType: "application/x-hdf5", file: "run-1-file-1.bin" }] }],
      skipped: [],
    });

    // A run file its run does not list, and a comment without its fields, are refused.
    const extra = folder(join(FIXTURES, "1.0.0"));
    extra.set(`runs/${run}/files/od.omx`, Buffer.from("OMX"));
    await refused(writeZip(resign(extra, (m) => (m.formatVersion = "1.5.0"))), /is not listed in/);
    const bad = folder(join(FIXTURES, "1.0.0"));
    bad.set("collab/comments.json", Buffer.from(JSON.stringify({ comments: [{ ...comment, body: "" }] })));
    await refused(writeZip(resign(bad, (m) => (m.formatVersion = "1.5.0"))), /collab\/comments\.json/);
  });

  it("reads fetched and imported data (format 1.6)", async () => {
    const files = folder(join(FIXTURES, "1.0.0"));
    const at = "2026-11-20T09:00:00.000Z";
    files.set(
      "fetched/facts.json",
      Buffer.from(JSON.stringify({ entries: [{ key: "climate/52.4,4.9", fetchedAt: at, body: "{}" }] })),
    );
    files.set(
      "fetched/live-osm-1.json",
      Buffer.from(
        JSON.stringify({
          kind: "osm",
          entries: [{ key: "streets/14/8415/5384", dataDate: at, body: "<osm/>" }],
        }),
      ),
    );
    const tile = deflateSync(Buffer.from(new Float32Array([1, 2, 3, 4]).buffer));
    const elevation = {
      imports: [
        {
          kind: "dem",
          method: "copernicus",
          bbox: [4.8, 52.3, 4.9, 52.4],
          bufferKm: 2,
          source: { name: "Copernicus GLO-30" },
          finishedAt: at,
          tiles: [
            {
              chunk: 1,
              offset: 0,
              bytes: tile.length,
              priority: 0,
              width: 2,
              height: 2,
              originLon: 4.8,
              originLat: 52.4,
              stepLon: 0.001,
              stepLat: 0.001,
            },
          ],
        },
      ],
    };
    files.set("fetched/elevation.json", Buffer.from(JSON.stringify(elevation)));
    files.set("fetched/elevation-1.bin", tile);
    const layer = {
      name: "WorldPop 2025",
      source: "worldpop",
      kind: "grid",
      licence: "CC BY 4.0",
      sourceUrl: "https://www.worldpop.org",
      citation: "",
      confidence: "medium",
      referenceYear: 2025,
      resolutionM: 100,
      coverage: [4.8, 52.3, 4.9, 52.4],
      peopleTotal: 12,
      featureCount: 1,
      isPrimary: true,
      options: {},
      updatedAt: at,
      files: 1,
    };
    files.set("fetched/population.json", Buffer.from(JSON.stringify({ layers: [layer] })));
    // POINT(4.85 52.35) as WKB.
    const point = "01010000006666666666661340cdcccccccc2c4a40";
    files.set("fetched/population-1-1.ndjson", Buffer.from(`${JSON.stringify([0, null, 12, point])}\n`));
    const r = await read(writeZip(resign(files, (m) => (m.formatVersion = "1.6.0"))));
    expect(r).toMatchObject({
      formatVersion: "1.6.0",
      fetched: {
        facts: "fetched-facts.json",
        live: ["fetched-live-1.json"],
        elevation: { index: "fetched-elevation.json", chunks: [{ n: 1, file: "fetched-elevation-1.bin" }] },
        population: {
          index: "fetched-population.json",
          files: [{ layer: 1, n: 1, file: "fetched-population-1-1.ndjson" }],
        },
      },
      skipped: [],
    });

    // A tile that does not hold width × height values, a chunk without its index, a feature line that is not
    // one, and a feature file its index does not count are refused.
    const refuse = async (change: (f: Map<string, Buffer>) => void, why: RegExp) => {
      const f = new Map(files);
      change(f);
      await refused(writeZip(resign(f, (m) => (m.formatVersion = "1.6.0"))), why);
    };
    await refuse(
      (f) => f.set("fetched/elevation-1.bin", Buffer.from("not deflated")),
      /names an elevation tile|not valid/,
    );
    await refuse((f) => f.delete("fetched/elevation.json"), /fetched\/elevation\.json is missing/);
    await refuse(
      (f) => f.set("fetched/population-1-1.ndjson", Buffer.from('[0,null,-1,"00"]\n')),
      /not a population feature/,
    );
    await refuse(
      (f) => f.set("fetched/population-1-2.ndjson", Buffer.from("")),
      /not used by fetched\/population\.json/,
    );
    await refuse(
      (f) => f.set("fetched/live-height-1.json", Buffer.from(JSON.stringify({ kind: "osm", entries: [] }))),
      /holds data of kind/,
    );
  });

  it("refuses changed, missing and extra files", async () => {
    const changed = folder(join(FIXTURES, "1.0.0"));
    changed.set(
      "project.json",
      Buffer.from(changed.get("project.json")!.toString().replace("Lakeside", "Seaside")),
    );
    await refused(writeZip(changed), /does not match its checksum/);

    const extra = folder(join(FIXTURES, "1.0.0"));
    extra.set("data/extra.json", Buffer.from("{}"));
    await refused(writeZip(extra), /not in its manifest/);

    const missing = folder(join(FIXTURES, "1.0.0"));
    missing.delete("data/railway.json");
    await refused(writeZip(missing), /listed in the manifest but missing/);

    const odd = resign(folder(join(FIXTURES, "1.0.0")));
    odd.set("notes.txt", Buffer.from("hi"));
    await refused(writeZip(resign(odd)), /not a file a MobSimLab project file can hold/);
  });

  it("refuses unsafe ZIP files", async () => {
    await refused(Buffer.from("not a zip at all, just text"), /not a ZIP file/);
    await refused(writeZip([["../evil.json", "{}"]]), /not an allowed file name/);
    await refused(writeZip([["/etc/passwd", "x"]]), /not an allowed file name/);
    await refused(writeZip([["bomb.json", Buffer.alloc(8 * 1024 * 1024)]]), /ZIP bomb/);
    await refused(writeZip([["readme.txt", "x"]]), /no manifest\.json/);
  });

  it("refuses a drawing that does not have the editor's shape", async () => {
    const files = folder(join(FIXTURES, "1.0.0"));
    const rail = JSON.parse(files.get("data/railway.json")!.toString());
    delete rail.doc.origin;
    files.set("data/railway.json", Buffer.from(JSON.stringify(rail)));
    await refused(writeZip(resign(files)), /data\/railway\.json: doc.*origin/);
  });

  it("upgrades older formats step by step", () => {
    const steps = [
      {
        from: "0.9.0",
        to: "0.9.5",
        up: (f: Map<string, Buffer>) => new Map([...f, ["a", Buffer.from("1")]]),
      },
      {
        from: "0.9.5",
        to: "1.0.0",
        up: (f: Map<string, Buffer>) => new Map([...f, ["b", Buffer.from("2")]]),
      },
    ];
    const out = migrate(new Map(), "0.9.0", steps);
    expect(out.version).toBe("1.0.0");
    expect([...out.files.keys()]).toEqual(["a", "b"]);
    expect(migrate(new Map(), "1.0.0", steps).version).toBe("1.0.0");
  });
});
