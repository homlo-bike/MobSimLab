// Assembles desktop/runtime for this operating system (CI, .github/workflows/release-desktop.yml):
//   runtime/app      the built API (with its production node_modules and WebAssembly), web app, migrations, OSM style
//   runtime/node     this Node.js binary, which runs the API
//   runtime/python   a relocatable Python 3.12 (python-build-standalone, via uv) with the worker, SUMO and the kernels
// PostgreSQL with PostGIS and the OpenStreetMap tools (runtime/conda, and runtime/pgsql on Windows) are added by
// the workflow before this runs.
//   node scripts/assemble-runtime.mjs --app <built app folder> --wheels <folder with the mobsim-kernels wheel>
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    wheels: { type: "string" },
    out: { type: "string", default: "runtime" },
  },
});
if (!values.app || !values.wheels) throw new Error("--app and --wheels are required");
const win = process.platform === "win32";
const repo = resolve(import.meta.dirname, "..", "..");
const out = resolve(values.out);
const log = (m) => process.stdout.write(`${m}\n`);
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });

mkdirSync(out, { recursive: true });

log("app: API, web app, migrations, OSM style");
rmSync(join(out, "app"), { recursive: true, force: true });
cpSync(resolve(values.app), join(out, "app"), { recursive: true, verbatimSymlinks: true });

log(`node: ${process.version}`);
rmSync(join(out, "node"), { recursive: true, force: true });
const nodeTarget = win ? join(out, "node", "node.exe") : join(out, "node", "bin", "node");
mkdirSync(dirname(nodeTarget), { recursive: true });
cpSync(process.execPath, nodeTarget);

log("python: 3.12 from python-build-standalone");
sh("uv", ["python", "install", "3.12"]);
const found = execFileSync("uv", ["python", "find", "--managed-python", "3.12"], { encoding: "utf8" }).trim();
// …/cpython-3.12.x-<platform>/bin/python3.12 (or …\python.exe on Windows): copy the whole installation.
const pyRoot = win ? dirname(found) : dirname(dirname(found));
rmSync(join(out, "python"), { recursive: true, force: true });
cpSync(pyRoot, join(out, "python"), { recursive: true, verbatimSymlinks: true });
const python = win ? join(out, "python", "python.exe") : join(out, "python", "bin", "python3");

log("python: worker dependencies from worker/uv.lock (with the SUMO extra), the worker and the kernels");
const req = join(tmpdir(), `mobsimlab-worker-${process.pid}.txt`);
writeFileSync(
  req,
  execFileSync(
    "uv",
    ["export", "--frozen", "--no-dev", "--extra", "sim", "--no-emit-project", "--no-header", "--no-hashes"],
    { cwd: join(repo, "worker"), encoding: "utf8" },
  ),
);
const pip = ["pip", "install", "--python", python, "--break-system-packages", "--no-cache"];
sh("uv", [...pip, "-r", req]);
const wheels = readdirSync(resolve(values.wheels))
  .filter((f) => f.endsWith(".whl"))
  .map((f) => join(resolve(values.wheels), f));
if (!wheels.length) throw new Error(`no wheel in ${values.wheels}`);
sh("uv", [...pip, "--no-deps", join(repo, "worker"), ...wheels]);
rmSync(req);
// C headers and manual pages are not needed to run.
for (const dir of ["include", "share/man"])
  rmSync(join(out, "python", dir), { recursive: true, force: true });

for (const p of [nodeTarget, python, join(out, "app", "api", "dist", "main.js")])
  if (!existsSync(p)) throw new Error(`missing ${p}`);
log(`runtime assembled in ${out}`);
