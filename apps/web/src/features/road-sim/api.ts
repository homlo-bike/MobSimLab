/** The project's road runs on the server (apps/api/src/simulation): list, start, follow, stop and the replay. */
import { get, send } from "../../session/api";
import type { RunStatus } from "../capacity/server";
import type { Replay, RoadParams, RoadResult, RoadScenario, RoadStep } from "./types";

/** One saved road run in the project's list. */
export interface RoadRun {
  id: string;
  kind: "road";
  status: RunStatus;
  network: {
    kind: "road";
    lines: { index: number; name: string; mode: string; color: string }[];
    depots: number;
    tiles: number;
  };
  params: RoadParams;
  error: string | null;
  cancelRequested: boolean;
  createdBy: { id: string; displayName: string | null } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface RoadRunDetail extends RoadRun {
  progress: RoadStep | null;
  result: RoadResult | null;
}

export interface RoadRunsApi {
  list(): Promise<RoadRun[]>;
  get(id: string): Promise<RoadRunDetail>;
  start(params: RoadParams, scenario: RoadScenario): Promise<RoadRunDetail>;
  cancel(id: string): Promise<RoadRunDetail>;
  rerun(id: string): Promise<RoadRunDetail>;
  remove(id: string): Promise<void>;
  replay(id: string): Promise<Replay>;
  /** The scenario the run ran (its lines, legs and departures); the noise map uses it. */
  scenario(id: string): Promise<RoadScenario>;
}

/** Purpose: the road runs of one project, through the session cookie and CSRF token. */
export function projectRoadRuns(projectId: string, csrf: string): RoadRunsApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/simulation-runs`;
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
  return {
    list: async () =>
      ((await get<{ runs?: { kind: string }[] }>(base)).runs ?? []).filter(
        (r): r is RoadRun => r.kind === "road",
      ),
    get: async (id) => (await get<{ run: RoadRunDetail }>(one(id))).run,
    start: async (params, scenario) =>
      (await send<{ run: RoadRunDetail }>("POST", base, csrf, { kind: "road", params, scenario })).run,
    cancel: async (id) => (await send<{ run: RoadRunDetail }>("POST", `${one(id)}/cancel`, csrf, {})).run,
    rerun: async (id) => (await send<{ run: RoadRunDetail }>("POST", `${one(id)}/rerun`, csrf, {})).run,
    remove: async (id) => {
      await send<{ ok: true }>("DELETE", one(id), csrf);
    },
    // Sent gzipped with Content-Encoding: the browser unpacks it.
    replay: (id) => get<Replay>(`${one(id)}/replay`),
    scenario: (id) => get<RoadScenario>(`${one(id)}/scenario`),
  };
}
