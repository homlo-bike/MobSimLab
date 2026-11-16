// Starts the bundled MobSimLab server the way the desktop app does (without Electron), checks it, stops it and
// starts it once more on the same data. Used in CI on Windows, macOS and Linux before the installers are built.
//   node scripts/smoke.mjs [runtime folder, default ./runtime]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const { LocalStack } = require("../dist/local.js");
const { runtimeAt } = require("../dist/runtime.js");

const runtime = runtimeAt(resolve(process.argv[2] ?? "runtime"));
const dataDir = mkdtempSync(join(tmpdir(), "mobsimlab-smoke-"));
const log = (m) => process.stdout.write(`${m}\n`);
const fail = (m) => {
  throw new Error(m);
};

async function check(stack, first) {
  const me = await (await fetch(`${stack.url}/api/auth/me`)).json();
  if (me.instance?.local !== true) fail(`instance.local is ${me.instance?.local}`);
  if (me.instance?.agents !== false) fail("AI agents should be off by default");
  if ((await fetch(`${stack.url}/mcp`, { method: "POST" })).status !== 404) fail("/mcp should be off");

  const refused = await fetch(`${stack.url}/api/auth/local`, {
    method: "POST",
    headers: { Origin: stack.url },
  });
  if (refused.status !== 404) fail(`local sign-in without the key answered ${refused.status}`);
  const signIn = await fetch(`${stack.url}/api/auth/local`, {
    method: "POST",
    headers: { Origin: stack.url, "X-MobSimLab-Local-Key": stack.launchKey },
  });
  if (signIn.status !== 200) fail(`local sign-in answered ${signIn.status}`);
  const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0];
  const signedIn = await (await fetch(`${stack.url}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  if (signedIn.user?.role !== "owner") fail(`signed in as ${JSON.stringify(signedIn.user)}`);
  if (signedIn.instance?.mode !== "open") fail(`instance mode ${signedIn.instance?.mode}`);
  const page = await (await fetch(`${stack.url}/`)).text();
  if (!page.includes('<div id="root">')) fail("the web app is not served");
  // The simulation worker connects to the database as its own role and waits for runs.
  const workerLog = join(dataDir, "logs", "worker.log");
  for (let i = 0; ; i++) {
    let text = "";
    try {
      text = readFileSync(workerLog, "utf8");
    } catch {
      // not written yet
    }
    if (text.includes("worker started") && !/error|Traceback/i.test(text.split("--- ").at(-1) ?? "")) break;
    if (i > 60) fail(`the worker did not start:\n${text.slice(-2000)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  log(`  ${first ? "first" : "second"} start: signed in as the local Owner on ${stack.url}; worker running`);
}

const env = { ...process.env };
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
const inherited = env[pathKey] ?? "";
delete env[pathKey];
env.PATH = [...runtime.path, inherited].join(delimiter);
const run = (cmd, args) => execFileSync(cmd, args, { env, encoding: "utf8" }).trim().split("\n")[0];

try {
  log(`node ${run(runtime.node, ["--version"])}`);
  log(
    run(runtime.python, [
      "-c",
      "import sys, sumo, libsumo, mobsim_worker, mobsim_kernels; print('python', sys.version.split()[0], 'with SUMO')",
    ]),
  );
  log(run(runtime.python, ["-c", "import os, sumo; print(os.path.join(sumo.SUMO_HOME, 'bin'))"]));
  log(`osmium ${run("osmium", ["--version"])}`);
  execFileSync("osm2pgsql", ["--version"], { env, stdio: "ignore" });
  log("osm2pgsql ok");

  for (const first of [true, false]) {
    const stack = new LocalStack({ runtime, dataDir, agents: false, status: (t) => log(`  ${t}`) });
    stack.onCrash = (what, code) => log(`  ${what} stopped with ${code}`);
    try {
      await stack.start();
      await check(stack, first);
    } finally {
      await stack.stop();
    }
  }
  log("smoke test passed");
} catch (e) {
  process.stderr.write(`smoke test failed: ${e.stack ?? e}\n`);
  for (const f of ["postgres", "initdb", "psql", "migrate", "api", "worker"]) {
    try {
      process.stderr.write(
        `--- ${f}.log\n${readFileSync(join(dataDir, "logs", `${f}.log`), "utf8").slice(-4000)}\n`,
      );
    } catch {
      // no such log
    }
  }
  process.exitCode = 1;
} finally {
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5 });
}
