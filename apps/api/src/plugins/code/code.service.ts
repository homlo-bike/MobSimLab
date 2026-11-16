import { createHash } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { DATABASE, type Database } from "../../db/database";
import type { ProjectActor } from "../../projects/projects.service";
import { ToolFailedError, ToolInputError, ToolRunner } from "../../tool-runner/runner";
import { PluginsService, type PluginLimits } from "../plugins.service";
import type { CodeItem, PluginEntry } from "../validate";
import { pack } from "./frame.mts";
import { pagesOf } from "./wasm-memory.mts";
import type { World } from "./worlds.mts";

/** One run of plugin code on the server, as the agent tools and the API return it. */
export interface PluginRun {
  /** Parsed JSON the plugin returned (calculation, importer), or the files (exporter). */
  output?: unknown;
  files?: { name: string; data: Buffer }[];
  /** The plugin's own message when it refused the input. */
  error?: string;
  logs: [string, string][];
}

/** The plugin's code could not run (it crashed, ran out of time or memory); the message is for the person. */
export class PluginCodeError extends Error {}

/**
 * Plugin code (ADR-0036 Phase 2): serves the compiled code of an installed plugin to the project's members (the
 * browser runs it in a Web Worker), serves tab pages, and runs calculations in the sandboxed tool-runner for the
 * agent tools. Only plugins the project has turned on, at the version it pinned.
 */
@Injectable()
export class PluginCodeService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly plugins: PluginsService,
    private readonly tools: ToolRunner,
  ) {}

  /** Purpose: the instance's limits for plugin code. */
  async limits(): Promise<PluginLimits> {
    const r = await this.db
      .selectFrom("iam.instance")
      .select(["plugin_memory_mb", "plugin_time_s"])
      .executeTakeFirstOrThrow();
    return { memoryMb: r.plugin_memory_mb, timeS: r.plugin_time_s };
  }

  /**
   * Purpose: an installed plugin the project has on. 404 when it is off, bundled or unknown (members only).
   * Output: its registry entry and version.
   */
  async enabled(
    actor: ProjectActor,
    projectId: string,
    pluginId: string,
  ): Promise<{ entry: PluginEntry; version: string }> {
    const list = await this.plugins.forProject(actor, projectId);
    const p = list.find((x) => x.id === pluginId && !x.bundled && x.enabled && x.entry);
    if (!p) throw new NotFoundException("the plugin is not turned on in this project");
    return { entry: p.entry!, version: p.version };
  }

  /**
   * Purpose: one compiled file of a component of an enabled plugin (`glue.js`, `glue.core.wasm`, …).
   * Inputs: the component's path as the manifest names it, and the file name.
   */
  async codeFile(actor: ProjectActor, projectId: string, pluginId: string, component: string, file: string) {
    const { entry, version } = await this.enabled(actor, projectId, pluginId);
    if (!componentOf(entry, component)) throw new NotFoundException("no such component");
    if (file === "files.json") {
      // The list of the component's compiled files, so the browser knows which modules to fetch.
      const names = (await this.codeFiles(pluginId, version, component)).map((f) =>
        f.path.slice(`code/${component}/`.length),
      );
      const data = Buffer.from(JSON.stringify(names.sort()));
      return { data, mediaType: "application/json", sha256: createHash("sha256").update(data).digest("hex") };
    }
    const row = await this.db
      .selectFrom("plugin.file")
      .select(["data", "media_type", "sha256"])
      .where("plugin_id", "=", pluginId)
      .where("version", "=", version)
      .where("path", "=", `code/${component}/${file}`)
      .executeTakeFirst();
    if (!row) throw new NotFoundException("no such file");
    return { data: row.data, mediaType: row.media_type, sha256: row.sha256 };
  }

  /** Purpose: the names of a component's compiled files. */
  private async codeFiles(pluginId: string, version: string, component: string) {
    return this.db
      .selectFrom("plugin.file")
      .select(["path", "data"])
      .where("plugin_id", "=", pluginId)
      .where("version", "=", version)
      .where("path", "like", `code/${component.replace(/[%_\\]/g, "\\$&")}/%`)
      .execute();
  }

  /**
   * Purpose: a file of a tab page, by the package's SHA-256 (ADR-0036 §6). Tab pages run in a frame with an
   * opaque origin, which sends no cookies, so this needs no session: the hash is only shown to members of
   * projects that use the plugin, and the files are the plugin's own static pages.
   */
  async uiFile(sha256: string, path: string) {
    const row = await this.db
      .selectFrom("plugin.file as f")
      .innerJoin("plugin.package as p", (j) =>
        j.onRef("p.plugin_id", "=", "f.plugin_id").onRef("p.version", "=", "f.version"),
      )
      .select(["f.data", "f.media_type"])
      .where("p.sha256", "=", sha256)
      .where("f.path", "=", `ui/${path}`)
      .executeTakeFirst();
    if (!row) throw new NotFoundException("no such file");
    return { data: row.data, mediaType: row.media_type };
  }

  /**
   * Purpose: run a calculation, importer or exporter of an enabled plugin in the sandboxed tool-runner.
   * Inputs: the item's id, its world, and the call's data: `input` (JSON text) for a calculation or exporter,
   * `files` for an importer, `options` for an importer. Output: what the plugin returned, or its message.
   * Throws PluginCodeError when the code crashed or ran over a limit.
   */
  async run(
    actor: ProjectActor,
    projectId: string,
    pluginId: string,
    world: World,
    id: string,
    data: { input?: string; files?: { name: string; data: Buffer }[]; options?: unknown },
  ): Promise<PluginRun> {
    const { entry, version } = await this.enabled(actor, projectId, pluginId);
    const list = (
      world === "calculation" ? entry.calculations : world === "importer" ? entry.importers : entry.exporters
    ) as CodeItem[] | undefined;
    const item = (list ?? []).find((x) => x.id === id && x.runtime === "component");
    if (!item?.component) throw new NotFoundException(`the plugin has no ${world} ${id}`);
    const code = await this.codeFiles(pluginId, version, item.component);
    if (code.length === 0) throw new NotFoundException("the plugin's code is missing; install it again");
    const limits = await this.limits();
    const parts: Record<string, Uint8Array> = {};
    for (const f of code) parts[f.path.slice(`code/${item.component}/`.length)] = f.data;
    if (data.input !== undefined) parts.input = Buffer.from(data.input, "utf8");
    (data.files ?? []).forEach((f, i) => (parts[`file:${i}:${f.name}`] = f.data));
    const frame = pack({ world, id, maxPages: pagesOf(limits.memoryMb), options: data.options ?? {} }, parts);
    try {
      return await this.tools.run(
        "plugin-run",
        frame,
        async (result, scratch) => {
          const r = result as { ok?: unknown; error?: unknown; logs?: unknown; files?: unknown };
          const logs = Array.isArray(r.logs) ? (r.logs as [string, string][]).slice(0, 200) : [];
          if (r.ok === false) return { error: String(r.error).slice(0, 1000), logs };
          if (world === "exporter") {
            const names = Array.isArray(r.files) ? (r.files as unknown[]).slice(0, 100) : [];
            const files = await Promise.all(
              names.map(async (n, i) => ({
                name: String(n).slice(0, 200),
                data: await scratch.read(`out-${i}.bin`),
              })),
            );
            return { files, logs };
          }
          const text = (await scratch.read("result.json")).toString("utf8");
          try {
            return { output: JSON.parse(text) as unknown, logs };
          } catch {
            return { error: "the plugin did not return JSON", logs };
          }
        },
        {
          inputBytes: 64 * 1024 * 1024,
          // The heap holds the glue; WebAssembly memory is capped in the modules themselves.
          memoryMb: 256,
          cpuSeconds: limits.timeS,
          wallMs: limits.timeS * 1000 + 5000,
          outputBytes: 1024 * 1024,
          fileBytes: 32 * 1024 * 1024,
        },
      );
    } catch (e) {
      if (e instanceof ToolInputError) throw new UnprocessableEntityException(e.message);
      if (e instanceof ToolFailedError)
        throw new PluginCodeError(
          `${entry.name} stopped: it crashed or ran over the limits (${limits.memoryMb} MB, ${limits.timeS} s)`,
        );
      throw e;
    }
  }
}

/** Purpose: whether `component` is one of the entry's components. */
function componentOf(entry: PluginEntry, component: string): boolean {
  return [entry.calculations, entry.importers ?? [], entry.exporters ?? []].some((l) =>
    (l as CodeItem[]).some((x) => x.runtime === "component" && x.component === component),
  );
}

/** Purpose: refuse a path that is not a plain relative path. */
export function safePath(p: string): string {
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_.-]+)*\.[a-z0-9]+$/.test(p) || p.includes("..") || p.length > 240)
    throw new BadRequestException("not a file path");
  return p;
}
