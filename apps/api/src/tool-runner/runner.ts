import { spawn, spawnSync } from "node:child_process";
import { constants, existsSync, readFileSync, realpathSync } from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { Injectable, Logger } from "@nestjs/common";

/**
 * The tool-runner (03 §1, 05 §3.3, threat model TB6): runs a tool from `tools.mts` on untrusted bytes in a child
 * process that can do as little as possible:
 *
 * - Node's permission model (`--permission`): reads only the API's own code and its npm packages, writes only
 *   a fresh scratch folder, and may not start processes or worker threads or load native add-ons.
 * - No network: its own empty network namespace (`unshare --net --map-root-user`) where the system allows
 *   user namespaces, and in any case a guard that makes every network call throw (guard.mts).
 * - Limits: heap size (`--max-old-space-size`), CPU seconds, open files, file size and no core dumps
 *   (`prlimit`, when the system has it), and a wall-clock timeout after which the process is killed.
 * - An empty environment, so no secret or setting of the API reaches the tool.
 *
 * Reuse: register a tool in `tools.mts` and call `run`. The plugin host (ADR-0036) can run plugin code here.
 */

/** Limits for one tool run. */
export interface ToolLimits {
  /** Most bytes of input. */
  inputBytes: number;
  /** Heap of the tool process in MB (V8 old space); buffers outside the heap come on top. */
  memoryMb: number;
  /** CPU seconds before the system stops the process. */
  cpuSeconds: number;
  /** Wall-clock milliseconds before the runner kills the process. */
  wallMs: number;
  /** Most bytes of the JSON result on stdout. */
  outputBytes: number;
  /** Largest file the tool may write into its scratch folder. */
  fileBytes: number;
}

/** Defaults: a small, quick tool. */
export const DEFAULT_TOOL_LIMITS: ToolLimits = {
  inputBytes: 10 * 1024 * 1024,
  memoryMb: 256,
  cpuSeconds: 30,
  wallMs: 60_000,
  outputBytes: 4 * 1024 * 1024,
  fileBytes: 10 * 1024 * 1024,
};

/** How the runner isolates tools on this system; logged at startup, shown in tests. */
export interface ToolIsolation {
  network: "namespace" | "guard";
  limits: "prlimit" | "node";
}

/** A tool refused its input; `message` is for the person who uploaded it. */
export class ToolInputError extends Error {}

/** The tool crashed, ran out of time or memory, or broke the protocol; the message is for the logs. */
export class ToolFailedError extends Error {}

/** What a finished tool left in its scratch folder, readable until `use` returns. */
export interface ToolScratch {
  /** Read one file the tool wrote. Throws ToolFailedError for a bad name, a link, or a file over the limit. */
  read(name: string): Promise<Buffer>;
}

const SCRATCH_NAME = /^[A-Za-z0-9_-]{1,80}(\.[A-Za-z0-9]{1,10}){0,2}$/;

/** Purpose: the first of these programs that exists, or null. */
function program(names: string[]): string | null {
  for (const dir of ["/usr/bin", "/bin", "/usr/sbin", "/sbin"])
    for (const n of names) if (existsSync(join(dir, n))) return join(dir, n);
  return null;
}

/** Purpose: the folder of the API package (with its package.json), from this file in `src/` or `dist/`. */
function packageRoot(): string {
  let d = __dirname;
  for (let i = 0; i < 6; i++) {
    const pkg = join(d, "package.json");
    if (
      existsSync(pkg) &&
      (JSON.parse(readFileSync(pkg, "utf8")) as { name?: string }).name === "@mobsimlab/api"
    )
      return d;
    d = dirname(d);
  }
  throw new Error("tool-runner: cannot find the API package folder");
}

/** Purpose: the folder holding the API's npm packages as they are on disk (pnpm keeps them in `.pnpm`). */
function packagesRoot(): string {
  const real = realpathSync(dirname(require.resolve("ajv/package.json")));
  const pnpm = real.lastIndexOf(`${sep}node_modules${sep}.pnpm${sep}`);
  if (pnpm >= 0) return real.slice(0, pnpm + `${sep}node_modules${sep}.pnpm`.length);
  const nm = real.lastIndexOf(`${sep}node_modules${sep}`);
  return nm >= 0 ? real.slice(0, nm + `${sep}node_modules`.length) : dirname(real);
}

@Injectable()
export class ToolRunner {
  private readonly logger = new Logger(ToolRunner.name);
  private readonly root = packageRoot();
  private readonly packages = packagesRoot();
  /** The compiled host in `dist/`, or the TypeScript source when the API runs from source (tests). */
  private readonly host = existsSync(join(__dirname, "host.mjs"))
    ? join(__dirname, "host.mjs")
    : join(__dirname, "host.mts");
  private readonly unshare: string | null;
  private readonly prlimit = program(["prlimit"]);

  constructor() {
    // User namespaces are often switched off in containers; use them only where a quick probe succeeds.
    const unshare = program(["unshare"]);
    this.unshare =
      unshare &&
      spawnSync(unshare, ["--net", "--map-root-user", "--", "/bin/true"], { timeout: 5000, stdio: "ignore" })
        .status === 0
        ? unshare
        : null;
  }

  /** Purpose: how tools are isolated on this system. */
  isolation(): ToolIsolation {
    return { network: this.unshare ? "namespace" : "guard", limits: this.prlimit ? "prlimit" : "node" };
  }

  /**
   * Purpose: run a tool on untrusted bytes in the sandbox.
   * Inputs: the tool name (tools.mts), the input bytes, `use` which gets the tool's JSON result and its scratch
   * files, and limits. Output: what `use` returns.
   * Throws ToolInputError when the tool refused the input (message for the person), ToolFailedError when it
   * crashed, ran over a limit or broke the protocol. The scratch folder is removed when `use` settles.
   */
  async run<T>(
    tool: string,
    input: Buffer,
    use: (result: unknown, scratch: ToolScratch) => Promise<T>,
    limits: Partial<ToolLimits> = {},
  ): Promise<T> {
    const l = { ...DEFAULT_TOOL_LIMITS, ...limits };
    if (input.length > l.inputBytes) throw new ToolInputError("the file is too large");
    const scratch = await mkdtemp(join(tmpdir(), "msl-tool-"));
    try {
      const result = await this.spawn(tool, input, scratch, l);
      return await use(result, {
        read: async (name: string) => {
          if (!SCRATCH_NAME.test(name))
            throw new ToolFailedError(`tool ${tool} named a file "${name.slice(0, 80)}"`);
          const path = join(scratch, name);
          const st = await lstat(path).catch(() => null);
          if (!st?.isFile()) throw new ToolFailedError(`tool ${tool} did not write ${name}`);
          if (st.size > l.fileBytes)
            throw new ToolFailedError(`tool ${tool} wrote ${name} over the size limit`);
          // O_NOFOLLOW: never read through a link the tool may have put in place since the check.
          const fh = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            return await fh.readFile();
          } finally {
            await fh.close();
          }
        },
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /** Purpose: start the host, feed it the input, and parse its one line of JSON. */
  private spawn(tool: string, input: Buffer, scratch: string, l: ToolLimits): Promise<unknown> {
    const node = [
      "--permission",
      `--allow-fs-read=${this.root}`,
      `--allow-fs-read=${this.packages}`,
      `--allow-fs-read=${scratch}`,
      `--allow-fs-write=${scratch}`,
      `--max-old-space-size=${l.memoryMb}`,
      "--disable-warning=ExperimentalWarning",
      this.host,
      tool,
      String(l.inputBytes),
    ];
    let argv: string[] = [process.execPath, ...node];
    if (this.prlimit)
      argv = [
        this.prlimit,
        `--cpu=${l.cpuSeconds}`,
        "--nofile=64",
        "--core=0",
        `--fsize=${l.fileBytes}`,
        "--",
        ...argv,
      ];
    if (this.unshare) argv = [this.unshare, "--net", "--map-root-user", "--", ...argv];

    return new Promise((resolve, reject) => {
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd: scratch,
        env: { LANG: "C.UTF-8" },
        stdio: ["pipe", "pipe", "pipe"],
      });
      const out: Buffer[] = [];
      let outBytes = 0;
      let err = "";
      let over = false;
      const timer = setTimeout(() => {
        over = true;
        child.kill("SIGKILL");
      }, l.wallMs);
      child.stdout.on("data", (c: Buffer) => {
        outBytes += c.length;
        if (outBytes > l.outputBytes) {
          over = true;
          child.kill("SIGKILL");
        } else out.push(c);
      });
      child.stderr.on("data", (c: Buffer) => {
        if (err.length < 8192) err += c.toString("utf8");
      });
      child.stdin.on("error", () => {}); // The host may stop reading early (input over the limit).
      child.on("error", (e) => {
        clearTimeout(timer);
        reject(new ToolFailedError(`tool ${tool} could not start: ${e.message}`));
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (over) return reject(new ToolFailedError(`tool ${tool} ran over its time or output limit`));
        if (code !== 0) {
          this.logger.warn(`tool ${tool} exited with ${code ?? signal}: ${err.slice(0, 2000)}`);
          return reject(new ToolFailedError(`tool ${tool} stopped (${code ?? signal})`));
        }
        let msg: { ok?: unknown; result?: unknown; error?: unknown };
        try {
          msg = JSON.parse(Buffer.concat(out).toString("utf8")) as typeof msg;
        } catch {
          return reject(new ToolFailedError(`tool ${tool} did not answer in JSON`));
        }
        if (msg.ok === true) return resolve(msg.result);
        if (msg.ok === false && typeof msg.error === "string") return reject(new ToolInputError(msg.error));
        reject(new ToolFailedError(`tool ${tool} broke the protocol`));
      });
      child.stdin.end(input);
    });
  }
}
