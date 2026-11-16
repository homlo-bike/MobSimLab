import { describe, expect, it } from "vitest";
import { ToolFailedError, ToolInputError, ToolRunner } from "../src/tool-runner/runner";

/** The sandboxed tool-runner (05 §3.3): what a tool can and cannot do, and its limits. */
describe("tool-runner", () => {
  const runner = new ToolRunner();

  it("stops a tool from reading or writing files, starting processes and opening connections", async () => {
    const result = await runner.run("sandbox-check", Buffer.alloc(0), async (r) => r);
    expect(result).toEqual({
      readSystemFiles: true,
      writeOutsideScratch: true,
      startProcess: true,
      startWorker: true,
      openConnection: true,
      noEnvironment: true,
    });
    expect(["namespace", "guard"]).toContain(runner.isolation().network);
  });

  it("refuses an unknown tool and input over the limit", async () => {
    await expect(runner.run("no-such-tool", Buffer.alloc(0), async (r) => r)).rejects.toBeInstanceOf(
      ToolFailedError,
    );
    await expect(
      runner.run("sandbox-check", Buffer.alloc(2048), async (r) => r, { inputBytes: 1024 }),
    ).rejects.toBeInstanceOf(ToolInputError);
  });

  it("kills a tool that runs over its time", async () => {
    await expect(
      runner.run("sandbox-check", Buffer.alloc(0), async (r) => r, { wallMs: 1 }),
    ).rejects.toBeInstanceOf(ToolFailedError);
  });
});

describe("tool-runner without a network namespace", () => {
  it("still stops connections with the guard", async () => {
    const runner = new ToolRunner();
    // Containers often forbid user namespaces; the guard alone must hold.
    Object.assign(runner, { unshare: null });
    expect(runner.isolation().network).toBe("guard");
    const result = (await runner.run("sandbox-check", Buffer.alloc(0), async (r) => r)) as Record<string, boolean>;
    expect(result.openConnection).toBe(true);
  });
});
