# Tool-runner

Runs code on untrusted input (uploaded files, and later plugin code) in a child process that can do as little
as possible (05 §3.3, threat model TB6). First used by the `.mslab` importer (ADR-0021).

| File | What it is |
|------|------------|
| `runner.ts` | `ToolRunner` (Nest provider): starts the host, feeds it the input, reads its answer and scratch files |
| `host.mts` | Entry of the child process: reads stdin, runs the tool, writes one line of JSON |
| `guard.mts` | Makes every network call in the child throw; loaded before any tool |
| `tools.mts` | The registry of tools, and `ToolContext` |
| `errors.mts` | `ToolError`: a refusal whose message is shown to the person |
| `zip.mts` | Safe ZIP reader (entry, size and ratio limits, no `..`, absolute paths or links) and writer |
| `check.mts` | The `sandbox-check` tool: reports what the sandbox stops |

## What a tool cannot do

- **Files**: Node's permission model (`--permission`). Reads only the API package and its npm packages, writes
  only its own scratch folder (a fresh folder under the system temp folder, removed after the run).
- **Processes, worker threads, native add-ons**: not allowed by the permission model.
- **Network**: its own empty network namespace (`unshare --net --map-root-user`) when the system allows user
  namespaces (the runner probes this once), and in every case `guard.mts`. In the Docker image with the default
  seccomp profile, user namespaces are refused, so the guard is what holds there.
- **Resources**: heap (`--max-old-space-size`), CPU seconds, open files, file size and core dumps (`prlimit`,
  part of util-linux), a wall-clock timeout, and caps on the input and on the JSON answer.
- **Secrets**: the child gets an empty environment (only `LANG`).

`ToolRunner.isolation()` says which network isolation and limits are active. `test/tool-runner.test.ts` runs
`sandbox-check` with and without the namespace.

## Adding a tool

1. Write it as an ES module (`.mts`, erasable TypeScript only: no enums, decorators or parameter properties) so
   Node can run it from source in tests. Import other `.mts` files with their `.mts` extension; the build
   rewrites them to `.mjs`.
2. Export a function `(input: Buffer, ctx: ToolContext) => result`. Throw a `ToolError` (or a subclass) with a
   plain message when the input is not acceptable; any other error counts as a crash and is only logged.
   Write bulky output with `ctx.write(name, bytes)`.
3. Register it in `tools.mts` and call it from the API:

   ```ts
   await toolRunner.run("my-tool", bytes, async (result, scratch) => { ... await scratch.read("out.json") ... },
     { memoryMb: 512, wallMs: 60_000 });
   ```

   Check the result and every scratch file again in the API: nothing from the sandbox is trusted.
