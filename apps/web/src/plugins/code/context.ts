import { DEFAULT_LIMITS, type PluginLimits } from "./runtime";

/**
 * What the open project's plugin code runs with (ADR-0036 Phase 2): the project, the Admins' limits, and the
 * package hash of each installed plugin (where its tab pages are served). Set when the project's plugins load.
 */
export interface PluginRuntime {
  projectId: string | null;
  limits: PluginLimits;
  /** Plugin id → package SHA-256, for installed plugins the project has on. */
  packages: Record<string, string>;
}

let runtime: PluginRuntime = { projectId: null, limits: DEFAULT_LIMITS, packages: {} };

/** Purpose: the current plugin runtime. */
export function pluginRuntime(): PluginRuntime {
  return runtime;
}

/** Purpose: set part of the plugin runtime (the project's plugins loaded, or the limits arrived). */
export function setPluginRuntime(next: Partial<PluginRuntime>): void {
  runtime = { ...runtime, ...next };
}
