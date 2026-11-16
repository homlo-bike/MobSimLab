import { readMslab } from "../mslab/read.mts";
import { compilePlugin } from "../plugins/code/compile.mts";
import { runPlugin } from "../plugins/code/run.mts";
import { sandboxCheck } from "./check.mts";

/**
 * The tools the sandboxed tool host can run (05 §3.3). A tool reads untrusted bytes, checks them and returns a
 * plain JSON result; bulky output goes into its scratch folder through `ctx.write`. To add one (an importer, a
 * plugin's own code), add it here and call it from the API with `ToolRunner.run("<name>", bytes)`.
 *
 * Tools run in a child process with no network, no access to the file system outside the code and the scratch
 * folder, no child processes, and CPU, memory and time limits (runner.ts). They may throw an Error whose
 * message is shown to the person: name what is wrong with their file, never internals.
 */

/** What a tool may do besides returning its result. */
export interface ToolContext {
  /** Write a file into the scratch folder. Names: letters, digits, `-`, `_` and one `.` extension. */
  write(name: string, data: Uint8Array | string): void;
}

/** A tool: takes the uploaded bytes, returns a JSON-serialisable result (or a promise of one). */
export type Tool = (input: Buffer, ctx: ToolContext) => unknown;

/** Registered tools by name. */
export const TOOLS: Record<string, Tool> = {
  /** Read and check a `.mslab` project file (ADR-0021). */
  "mslab-read": readMslab,
  /** Check and transpile an uploaded plugin component (ADR-0036 §4); needs worker threads (runner.ts). */
  "plugin-compile": compilePlugin,
  /** Run one call of an installed plugin's code (ADR-0036 §4). */
  "plugin-run": runPlugin,
  /** Report what the sandbox stops (check.mts); for the tests and for checking a new deployment. */
  "sandbox-check": sandboxCheck,
};

/** Names a tool may give its scratch files. */
export const SCRATCH_NAME = /^[A-Za-z0-9_-]{1,80}(\.[A-Za-z0-9]{1,10}){0,2}$/;
