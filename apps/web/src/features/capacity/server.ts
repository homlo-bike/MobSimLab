import { get, send } from "../../session/api";
import type { CapacityParams, CapacityRun, LineInfo, Point } from "./types";

/** How a saved run stands (apps/api/src/simulation/runs.service.ts). */
export type RunStatus = "queued" | "running" | "done" | "failed" | "cancelled";

/** One saved run in the project's list. */
export interface SavedRun {
  id: string;
  kind: "capacity";
  status: RunStatus;
  network: { kind: "example" } | { kind: "files"; topologyName: string; linesName: string };
  params: Partial<CapacityParams> & { from_s: number; to_s: number };
  sweep: boolean;
  verdict: string | null;
  error: string | null;
  cancelRequested: boolean;
  createdBy: { id: string; displayName: string | null } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** What the worker is doing now (worker/src/mobsim_worker/jobs/capacity.py). */
export type RunStep =
  { step: "planning" } | { step: "sweeping"; line: string; headway_s?: number; n?: number; total?: number };

/** What the worker has found: the planned period, then the sweep of each line as it goes. */
export interface RunResult {
  notes: string[];
  run: CapacityRun | null;
  lines: { info: LineInfo; planned: Point; sweep: Point[]; sweeping: boolean }[];
}

/** One saved run with its progress and result. */
export interface SavedRunDetail extends SavedRun {
  progress: RunStep | null;
  result: RunResult | null;
}

/** What to run: the example metro, or the railway editor's topology and a lines file (JSON texts). */
export type ServerNetwork =
  | { kind: "example" }
  | { kind: "files"; topology: string; topologyName: string; lines: string; linesName: string };

/** The project's saved capacity runs on the server (a fake in tests). */
export interface RunsApi {
  list(): Promise<SavedRun[]>;
  get(id: string): Promise<SavedRunDetail>;
  start(network: ServerNetwork, params: SavedRun["params"], sweep: boolean): Promise<SavedRunDetail>;
  cancel(id: string): Promise<SavedRunDetail>;
  /** Run a saved run again with the same network and settings, replacing its result. */
  rerun(id: string): Promise<SavedRunDetail>;
  /** Delete a saved run for everyone. */
  remove(id: string): Promise<void>;
}

/** Purpose: the runs API of one project, through the session cookie and CSRF token. */
export function projectRuns(projectId: string, csrf: string): RunsApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/simulation-runs`;
  return {
    list: async () => (await get<{ runs?: SavedRun[] }>(base)).runs ?? [],
    get: async (id) => (await get<{ run: SavedRunDetail }>(`${base}/${encodeURIComponent(id)}`)).run,
    start: async (network, params, sweep) =>
      (await send<{ run: SavedRunDetail }>("POST", base, csrf, { kind: "capacity", network, params, sweep }))
        .run,
    rerun: async (id) =>
      (await send<{ run: SavedRunDetail }>("POST", `${base}/${encodeURIComponent(id)}/rerun`, csrf, {})).run,
    remove: async (id) => {
      await send<{ ok: true }>("DELETE", `${base}/${encodeURIComponent(id)}`, csrf);
    },
    cancel: async (id) =>
      (await send<{ run: SavedRunDetail }>("POST", `${base}/${encodeURIComponent(id)}/cancel`, csrf, {})).run,
  };
}

/** Purpose: whether a run may still change. */
export const isOpen = (r: { status: RunStatus }) => r.status === "queued" || r.status === "running";
