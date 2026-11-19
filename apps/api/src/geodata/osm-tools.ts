import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The command-line tools of the OpenStreetMap import (06-gis §2.1): osmium cuts and merges OSM files, and
 * osm2pgsql writes them into PostGIS with our flex style (tools/osm). Each tool runs as a child process without
 * a shell, with arguments as a list, a time limit, and its error output in the error message.
 */

/** Error from a tool run; `message` ends with the last lines the tool wrote to stderr. */
export class ToolError extends Error {}

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs: number;
  /** Bytes written to the tool's stdin. */
  input?: Buffer;
  /** Largest stdout kept, bytes. */
  maxOutput?: number;
  /** Answer the last 4 kB of stderr instead of stdout (osm2pgsql prints its version there). */
  stderr?: boolean;
}

/**
 * Purpose: run a tool and collect its standard output.
 * Output: stdout. Throws ToolError on a non-zero exit, a timeout, or output over `maxOutput`.
 */
export function runTool(cmd: string, args: string[], o: RunOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env: o.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let outLen = 0;
    let err = "";
    let failed: Error | null = null;
    const timer = setTimeout(() => {
      failed = new ToolError(`${cmd} took longer than ${Math.round(o.timeoutMs / 60_000)} min`);
      child.kill("SIGKILL");
    }, o.timeoutMs);
    child.stdout.on("data", (d: Buffer) => {
      outLen += d.length;
      if (o.maxOutput !== undefined && outLen > o.maxOutput) {
        failed ??= new ToolError(`${cmd} wrote more than ${o.maxOutput} bytes`);
        child.kill("SIGKILL");
        return;
      }
      out.push(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString("utf8")).slice(-4_000);
    });
    child.on("error", (e) => {
      failed ??= new ToolError(
        (e as NodeJS.ErrnoException).code === "ENOENT" ? `${cmd} is not installed` : e.message,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failed) return reject(failed);
      if (code !== 0) {
        const tail = err.trim().split("\n").slice(-5).join("\n");
        return reject(new ToolError(`${cmd} failed (exit ${code})${tail ? `: ${tail}` : ""}`));
      }
      resolve(o.stderr ? Buffer.from(err, "utf8") : Buffer.concat(out));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(o.input);
  });
}

/** Purpose: the folder holding mobsimlab-flex.lua and tag_mapping.lua (`MOBSIMLAB_OSM_STYLE_DIR`). */
export function styleDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MOBSIMLAB_OSM_STYLE_DIR) return env.MOBSIMLAB_OSM_STYLE_DIR;
  const repo = join(__dirname, "..", "..", "..", "..", "tools", "osm");
  return existsSync(join(repo, "mobsimlab-flex.lua")) ? repo : "/app/osm";
}

/** `[west, south, east, north]` in degrees. */
export type Box = [number, number, number, number];

const boxArg = (b: Box) => b.map((v) => v.toFixed(7)).join(",");

export class OsmTools {
  private osm2pgsqlVersion: Promise<[number, number]> | null = null;

  constructor(private readonly timeoutMs: number) {}

  /** Purpose: sort one OSM file (Overpass answers are not always in file order). */
  async sort(input: string, output: string): Promise<void> {
    await runTool("osmium", ["sort", "--overwrite", "-o", output, input], { timeoutMs: this.timeoutMs });
  }

  /** Purpose: merge sorted OSM files into one; an object found in several files is written once. */
  async merge(inputs: string[], output: string): Promise<void> {
    await runTool("osmium", ["merge", "--overwrite", "-o", output, ...inputs], { timeoutMs: this.timeoutMs });
  }

  /**
   * Purpose: cut an OSM file to the project area's polygons (a GeoJSON file, area-polygons.ts
   * `polygonsGeoJson`). `smart` keeps whole ways and multipolygons that cross the edge, so roads and buildings at
   * the edge are complete.
   */
  async extractPolygons(input: string, polygonFile: string, output: string): Promise<void> {
    await runTool(
      "osmium",
      ["extract", "--overwrite", "-s", "smart", "-p", polygonFile, "-o", output, input],
      { timeoutMs: this.timeoutMs },
    );
  }

  /**
   * Purpose: cut an OSM file to a box. `smart` keeps whole ways and multipolygons that cross the edge, so
   * roads and buildings at the edge are complete.
   */
  async extract(input: string, box: Box, output: string): Promise<void> {
    await runTool(
      "osmium",
      ["extract", "--overwrite", "-s", "smart", "-b", boxArg(box), "-o", output, input],
      { timeoutMs: this.timeoutMs },
    );
  }

  /**
   * Purpose: the OSM data date of a file: the replication timestamp in its header (Geofabrik), else the
   * newest object timestamp; null when the file has neither (Overpass answers without metadata).
   */
  async dataTimestamp(file: string): Promise<string | null> {
    const get = async (args: string[]) =>
      (await runTool("osmium", ["fileinfo", ...args, file], { timeoutMs: this.timeoutMs }))
        .toString("utf8")
        .trim();
    const header = await get(["-g", "header.option.osmosis_replication_timestamp"]).catch(() => "");
    if (header) return header;
    const last = await get(["-e", "-g", "data.timestamp.last"]).catch(() => "");
    return last || null;
  }

  /**
   * Purpose: OSM XML for the ways of a box that match osmium tag filters (such as `w/highway=primary,secondary`),
   * with every node they use, like the Overpass tile queries of the street-network service.
   * Inputs: the project's extract, the box, the filters. Output: OSM XML.
   */
  async filteredXml(input: string, box: Box, filters: string[], maxBytes: number): Promise<string> {
    // tags-filter reads its input twice (to add the nodes of the ways it keeps), so the cut goes to a file.
    const dir = await mkdtemp(join(tmpdir(), "msl-tile-"));
    try {
      const cut = join(dir, "tile.osm.pbf");
      await runTool("osmium", ["extract", "-s", "complete_ways", "-b", boxArg(box), "-o", cut, input], {
        timeoutMs: this.timeoutMs,
      });
      const xml = await runTool("osmium", ["tags-filter", "-f", "osm", "-o", "-", cut, ...filters], {
        timeoutMs: this.timeoutMs,
        maxOutput: maxBytes,
      });
      return xml.toString("utf8");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Purpose: import an OSM file into `schema` with the flex style; existing tables there are replaced.
   * Inputs: the file, the target schema, whether planned roads are kept, and the database login.
   * Side effects: creates the `osm_*` tables (and osm2pgsql's properties table) in `schema`.
   */
  async osm2pgsql(
    file: string,
    o: {
      schema: string;
      planned: boolean;
      db: { host: string; port: number; name: string; user: string; password: string };
    },
  ): Promise<void> {
    const [major, minor] = await this.version();
    const args = [
      "--create",
      // Slim mode keeps the node locations in the database rather than memory, so large extracts fit in the
      // container's memory limit; --drop removes those tables when the import ends.
      "--slim",
      "--drop",
      `--middle-schema=${o.schema}`,
      "--output=flex",
      `--style=${join(styleDir(), "mobsimlab-flex.lua")}`,
      `--host=${o.db.host}`,
      `--port=${o.db.port}`,
      `--database=${o.db.name}`,
      `--user=${o.db.user}`,
      "--log-progress=false",
    ];
    // From 1.9 osm2pgsql keeps a properties table, by default in the public schema the app role cannot write.
    if (major > 1 || (major === 1 && minor >= 9)) args.push(`--schema=${o.schema}`);
    args.push(file);
    await runTool("osm2pgsql", args, {
      timeoutMs: this.timeoutMs,
      env: {
        PATH: process.env.PATH,
        PGPASSWORD: o.db.password,
        MOBSIMLAB_OSM_SCHEMA: o.schema,
        MOBSIMLAB_OSM_PLANNED: o.planned ? "1" : "0",
      },
    });
  }

  /** Purpose: osm2pgsql's version as [major, minor]. */
  version(): Promise<[number, number]> {
    this.osm2pgsqlVersion ??= runTool("osm2pgsql", ["--version"], { timeoutMs: 30_000, stderr: true })
      .then((b) => {
        const m = b.toString("utf8").match(/version (\d+)\.(\d+)/);
        return (m ? [Number(m[1]), Number(m[2])] : [1, 8]) as [number, number];
      })
      .catch((e) => {
        this.osm2pgsqlVersion = null;
        throw e;
      });
    return this.osm2pgsqlVersion;
  }
}
