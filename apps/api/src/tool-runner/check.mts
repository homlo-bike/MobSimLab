import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import { Worker } from "node:worker_threads";

/**
 * The `sandbox-check` tool: tries what a tool must not be able to do and reports, for each, whether the sandbox
 * stopped it. The tests run it on every system the API runs on; every value must be true.
 */
export function sandboxCheck(): Record<string, boolean> {
  const blocked = (f: () => unknown): boolean => {
    try {
      f();
      return false;
    } catch {
      return true;
    }
  };
  return {
    readSystemFiles: blocked(() => readFileSync("/etc/passwd")),
    writeOutsideScratch: blocked(() => writeFileSync("/tmp/msl-sandbox-check", "x")),
    startProcess: blocked(() => {
      const r = spawnSync("/bin/true");
      if (r.error) throw r.error;
    }),
    startWorker: blocked(() => new Worker("1", { eval: true })),
    openConnection: blocked(() => net.connect(80, "127.0.0.1")),
    noEnvironment: Object.keys(process.env).every((k) => k === "LANG"),
  };
}
