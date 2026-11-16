import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The programs the desktop app brings with it (assembled by scripts/assemble-runtime.mjs and shipped as
 * `resources/runtime`): Node for the API, Python with the simulation worker and SUMO, PostgreSQL with PostGIS,
 * the OpenStreetMap tools, and the built API and web app.
 */
export interface Runtime {
  root: string;
  node: string;
  python: string;
  /** PostgreSQL's programs (initdb, postgres, pg_ctl, pg_isready, psql). */
  pgBin: string;
  /** Folders put first on PATH for the API and the worker (osmium, osm2pgsql and their libraries). */
  path: string[];
  /** PROJ's data for osm2pgsql. */
  projData: string;
  api: string;
  web: string;
  migrations: string;
  osmStyle: string;
}

const win = process.platform === "win32";

/** Purpose: where each program is inside a runtime folder. Throws when the folder is not a complete runtime. */
export function runtimeAt(root: string): Runtime {
  const conda = join(root, "conda");
  const condaLib = win ? join(conda, "Library") : conda;
  const r: Runtime = {
    root,
    node: win ? join(root, "node", "node.exe") : join(root, "node", "bin", "node"),
    python: win ? join(root, "python", "python.exe") : join(root, "python", "bin", "python3"),
    // Windows: the PostgreSQL and PostGIS builds for Windows (conda-forge has no PostGIS for Windows).
    pgBin: win ? join(root, "pgsql", "bin") : join(conda, "bin"),
    path: win ? [join(condaLib, "bin"), join(root, "pgsql", "bin")] : [join(conda, "bin")],
    projData: join(condaLib, "share", "proj"),
    api: join(root, "app", "api"),
    web: join(root, "app", "web"),
    migrations: join(root, "app", "migrations"),
    osmStyle: join(root, "app", "osm"),
  };
  const missing = [r.node, r.python, pgProgram(r, "postgres"), join(r.api, "dist", "main.js")].filter(
    (p) => !existsSync(p),
  );
  if (missing.length) throw new Error(`the bundled runtime is incomplete: ${missing.join(", ")} missing`);
  return r;
}

/**
 * Purpose: the path of a PostgreSQL program. On Windows the server build has no client programs (psql), which
 * come from conda-forge instead.
 */
export function pgProgram(r: Runtime, name: string): string {
  const exe = win ? `${name}.exe` : name;
  const server = join(r.pgBin, exe);
  if (!win || existsSync(server)) return server;
  const client = join(r.root, "conda", "Library", "bin", exe);
  return existsSync(client) ? client : server;
}
