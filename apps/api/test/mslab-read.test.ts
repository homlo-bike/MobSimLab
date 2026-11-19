import { createHash } from "node:crypto";
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
    for (const v of ["1.4.0", "2.0.0"]) {
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
