// The guard must be evaluated before any tool module: ES modules run in import order.
import "./guard.mts";
import { writeFileSync } from "node:fs";
import { ToolError } from "./errors.mts";
import { SCRATCH_NAME, TOOLS } from "./tools.mts";

/**
 * Entry of the sandboxed tool host (runner.ts starts it). Arguments: the tool name and the most bytes to read.
 * Reads the input from stdin, runs the tool with the current folder as its scratch folder, and writes one line
 * of JSON to stdout: `{ "ok": true, "result": … }`, or `{ "ok": false, "error": "…" }` for a file the tool
 * refused (the message is for the person), or exits non-zero on a crash.
 */
const [toolName = "", maxArg = "0"] = process.argv.slice(2);
const tool = Object.hasOwn(TOOLS, toolName) ? TOOLS[toolName] : undefined;
const maxBytes = Number(maxArg);

const chunks: Buffer[] = [];
let size = 0;
process.stdin.on("data", (c: Buffer) => {
  size += c.length;
  if (size > maxBytes) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: "the file is too large" })}\n`);
    process.exit(0);
  }
  chunks.push(c);
});
process.stdin.on("end", () => {
  if (!tool) {
    process.stderr.write(`unknown tool ${toolName}\n`);
    process.exit(2);
  }
  const ctx = {
    write(name: string, data: Uint8Array | string) {
      if (!SCRATCH_NAME.test(name)) throw new Error(`a tool may not name a file "${name.slice(0, 80)}"`);
      writeFileSync(name, data, { flag: "wx" });
    },
  };
  let out: string;
  try {
    out = JSON.stringify({ ok: true, result: tool(Buffer.concat(chunks), ctx) ?? null });
  } catch (e) {
    // Errors a tool throws on purpose name what is wrong with the file; anything else is a crash.
    if (e instanceof ToolError) out = JSON.stringify({ ok: false, error: e.message.slice(0, 500) });
    else {
      process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
      process.exit(3);
    }
  }
  process.stdout.write(`${out}\n`, () => process.exit(0));
});
