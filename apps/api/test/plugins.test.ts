import { generateKeyPairSync } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import { checkChecksums, checkSignature, parsePublicKey } from "../src/plugins/signature";
import { examplePlugin, samplePlugin, signed } from "./support/plugins";
import { BUNDLED, checkPlugin, claims, MOBSIMLAB_VERSION, satisfies } from "../src/plugins/validate";
import { PackageError, unzip, zip } from "../src/plugins/zip";

const REPO = join(__dirname, "..", "..", "..");

/** Purpose: every file of a folder, by its path inside the folder. */
function folder(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(dir, p).split("\\").join("/"), readFileSync(p));
    }
  };
  walk(dir);
  return out;
}

describe("plugin checks (ADR-0036)", () => {
  it("renders the bundled plugins exactly as tools/plugins/check.py does", () => {
    for (const p of BUNDLED) {
      const dir = readdirSync(join(REPO, "plugins")).find((d) => {
        try {
          return (
            JSON.parse(readFileSync(join(REPO, "plugins", d, "mobsimlab-plugin.json"), "utf8")).id === p.id
          );
        } catch {
          return false;
        }
      });
      const r = checkPlugin(folder(join(REPO, "plugins", dir!)), [], { bundled: true });
      expect(r.ok ? null : r.errors).toBeNull();
      if (r.ok) expect(JSON.parse(JSON.stringify(r.entry))).toEqual(p);
    }
  });

  it("accepts a third-party data plugin and renders its defaults", () => {
    const r = checkPlugin(samplePlugin(), BUNDLED.map(claims));
    expect(r.ok ? null : r.errors).toBeNull();
    if (r.ok) {
      expect(r.entry.bundled).toBe(false);
      expect(r.entry.defaults.water_taxi?.["*"]?.["water_taxi.speed_kn"]).toEqual({
        low: 8,
        central: 12,
        high: 20,
      });
      expect(r.entry.tools[0]?.kit).toBe("water-route");
    }
  });

  it("refuses a bundled flag, other licences, views in tabs and clashes with other plugins", () => {
    const bad = checkPlugin(
      samplePlugin({
        bundled: true,
        tiers: ["data", "compute"],
        license: "Proprietary",
        engines: { mobsimlab: ">=2", pluginApi: "1" },
      }),
      [],
    );
    expect(bad.ok).toBe(false);
    const errs = bad.ok ? [] : bad.errors.join("\n");
    expect(errs).toContain('may say "bundled"');
    expect(errs).toContain("licence Proprietary");
    expect(errs).toContain("made for MobSimLab >=2");

    const tab = checkPlugin(
      samplePlugin({
        contributes: {
          modes: [{ id: "water_taxi", file: "modes/water_taxi.json" }],
          parameters: [{ file: "assumptions/parameters.yaml" }],
          sources: [{ file: "assumptions/sources.yaml" }],
          tabs: [{ id: "taxis", label: "Taxis", view: "taxis", calculations: [] }],
        },
      }),
      [],
    );
    expect(tab.ok ? [] : tab.errors).toContain(
      "org.example.water-taxi: tab taxis: installed plugins bring their own page (ui)",
    );

    // Tiles may come only from the hosts the CSP lists, so basemaps ship with MobSimLab.
    const basemap = checkPlugin(
      samplePlugin({
        contributes: {
          modes: [{ id: "water_taxi", file: "modes/water_taxi.json" }],
          parameters: [{ file: "assumptions/parameters.yaml" }],
          sources: [{ file: "assumptions/sources.yaml" }],
          basemaps: [
            {
              id: "example-imagery",
              label: "Example imagery",
              tiles: ["https://tiles.example.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              maxzoom: 18,
              attribution: { text: "Example" },
            },
          ],
        },
      }),
      [],
    );
    expect(basemap.ok ? [] : basemap.errors).toContain(
      "org.example.water-taxi: basemaps are for bundled plugins only",
    );

    const clash = checkPlugin(samplePlugin({}, "org.example.other"), [
      {
        id: "org.example.water-taxi",
        version: "1.0.0",
        modes: ["water_taxi"],
        parameters: ["water_taxi.speed_kn"],
      },
    ]);
    expect(clash.ok ? [] : clash.errors).toEqual([
      "org.example.other: mode water_taxi is also contributed by org.example.water-taxi",
      "org.example.other: water_taxi.speed_kn is also a parameter of org.example.water-taxi",
    ]);
    // Another version of the same plugin may reuse its own ids.
    const update = checkPlugin(samplePlugin({ version: "1.1.0" }), [
      {
        id: "org.example.water-taxi",
        version: "1.0.0",
        modes: ["water_taxi"],
        parameters: ["water_taxi.speed_kn"],
      },
    ]);
    expect(update.ok).toBe(true);
    const core = checkPlugin(samplePlugin(), [...BUNDLED.map(claims)]);
    expect(core.ok).toBe(true);
  });

  it("accepts the example plugin with code and a tab page (Phase 2)", () => {
    const r = checkPlugin(examplePlugin(), []);
    expect(r.ok ? [] : r.errors).toEqual([]);
    if (!r.ok) return;
    expect(r.entry.tiers).toEqual(["compute", "ui"]);
    expect(r.entry.tabs[0]!.ui).toBe("tab/index.html");
    const noPerm = checkPlugin(examplePlugin({ permissions: [] }), []);
    expect(noPerm.ok ? [] : noPerm.errors).toEqual([
      "org.example.timetable-csv: calculation route_summary reads timetable, which needs the read:timetable permission",
      "org.example.timetable-csv: importer csv_import adds to the project, which needs the write:scenario permission",
      "org.example.timetable-csv: exporter csv_export reads the timetable, which needs the read:timetable permission",
    ]);
    const files = examplePlugin();
    files.delete("wasm/importer.wasm");
    const missing = checkPlugin(files, []);
    expect(missing.ok ? [] : missing.errors).toEqual([
      "org.example.timetable-csv: wasm/importer.wasm does not exist",
    ]);
  });

  it("applies the assumption library rules to plugin parameters", () => {
    const files = samplePlugin();
    files.set(
      "assumptions/parameters.yaml",
      Buffer.from(`- key: water_taxi.speed_kn
  label: Speed
  group: Water taxis
  unit: kn
  used_by: [running time]
  values:
    - context: { mode: water_taxi }
      low: 30
      central: 12
      high: 20
      basis: guess
      sources: [nowhere]
      check: unverified
      rationale: x
`),
    );
    const r = checkPlugin(files, []);
    const errs = r.ok ? "" : r.errors.join("\n");
    expect(errs).toContain("needs low <= central <= high");
    expect(errs).toContain("basis must be one of");
    expect(errs).toContain("unknown source nowhere");
    expect(errs).toContain("no global fallback entry");
    expect(errs).toContain("source example-survey defined but never used");
  });

  it("compares versions with ranges", () => {
    expect(MOBSIMLAB_VERSION).toBe(pkg.version);
    expect(satisfies("0.1.0", ">=0.1 <1")).toBe(true);
    expect(satisfies("1.0.0", ">=0.1 <1")).toBe(false);
    expect(satisfies("1.4.2", "^1.2")).toBe(true);
    expect(satisfies("2.0.0", "^1.2")).toBe(false);
    expect(satisfies("1.2.9", "~1.2")).toBe(true);
    expect(satisfies("1.0.0", "nonsense")).toBe(false);
  });
});

describe("plugin packages", () => {
  it("round-trips a ZIP and refuses unsafe names", () => {
    const files = unzip(zip(samplePlugin()));
    expect([...files.keys()]).toContain("modes/water_taxi.json");
    expect(() => unzip(zip({ "../evil.json": "{}" }))).toThrow(PackageError);
    expect(() => unzip(zip({ "/etc/passwd": "x" }))).toThrow(PackageError);
    expect(() => unzip(Buffer.from("not a zip at all, just text"))).toThrow("not a ZIP");
  });

  it("refuses a file that unpacks to more than it claims", () => {
    const z = zip({ "a.json": "x".repeat(10_000) });
    // Lower the size recorded in the central directory (offset 24 of the only entry).
    const cd = z.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    z.writeUInt32LE(10, cd + 24);
    expect(() => unzip(z)).toThrow(PackageError);
  });

  it("checks checksums and signatures against trusted keys", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const ed = generateKeyPairSync("ed25519");
    const pem = (k: typeof ec.publicKey) => k.export({ type: "spki", format: "pem" }).toString();
    const keys = [
      { id: "k1", name: "Example Transit Lab", publicKey: pem(ec.publicKey) },
      { id: "k2", name: "Other lab", publicKey: pem(ed.publicKey) },
    ];
    expect(parsePublicKey(keys[0]!.publicKey).fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(() => parsePublicKey("hello")).toThrow("not a PEM public key");

    const byEc = signed(samplePlugin(), ec.privateKey);
    checkChecksums(byEc);
    expect(checkSignature(byEc, keys)).toEqual({
      status: "trusted",
      keyId: "k1",
      keyName: "Example Transit Lab",
    });
    expect(checkSignature(signed(samplePlugin(), ed.privateKey), keys)).toMatchObject({
      status: "trusted",
      keyId: "k2",
    });
    expect(checkSignature(byEc, keys.slice(1))).toEqual({ status: "untrusted" });
    expect(checkSignature(signed(samplePlugin()), keys)).toEqual({ status: "unsigned" });
    expect(checkSignature(samplePlugin(), keys)).toEqual({ status: "unsigned" });

    const tampered = new Map(byEc);
    tampered.set("modes/water_taxi.json", Buffer.from("{}"));
    expect(() => checkChecksums(tampered)).toThrow("does not match its checksum");
    const extra = new Map(byEc);
    extra.set("extra.txt", Buffer.from("hi"));
    expect(() => checkChecksums(extra)).toThrow("does not list extra.txt");
  });
});
