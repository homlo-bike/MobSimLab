/** The project's demand model runs on the server (apps/api/src/simulation): list, start, follow, stop. */
import { get, send } from "../../session/api";
import type { RunStatus } from "../capacity/server";
import type { Bundle } from "./bundle";

export type Mode = "car" | "transit" | "walk" | "cycle";
export const MODES: Mode[] = ["transit", "car", "walk", "cycle"];
export type Purpose = "hbw" | "hbe" | "hbo" | "nhb";
export const PURPOSES: Purpose[] = ["hbw", "hbe", "hbo", "nhb"];
export type Period = "am" | "md" | "pm" | "ev" | "nt";

/** What the worker reports while a demand run goes (worker `demand/model.py` `Reporter`). */
export interface DemandStep {
  step?: string;
  period?: string;
  round?: number;
  gap?: number;
  [k: string]: unknown;
}

/** Trips, boardings and loads of one stopping pattern, by period and for the weekday (`day`). */
export interface PatternLoads {
  stops: string[];
  boardings: Record<string, number[]>;
  alightings: Record<string, number[]>;
  /** Riders on board between consecutive stops. */
  load: Record<string, number[]>;
}

/** The result of a demand run (worker `DemandModel._result`). */
export interface DemandResult {
  version: 1;
  uncalibrated: boolean;
  attribution: string;
  currency: string;
  notes: string[];
  zones_count: number;
  period_hours: Record<string, number>;
  totals: {
    trips: number;
    by_mode: Record<Mode, number>;
    by_period: Record<string, Record<Mode, number>>;
    by_purpose: Record<string, Record<Mode, number>>;
    car_km: number | null;
    walk_min: number | null;
    cycle_min: number | null;
  };
  convergence: Record<string, unknown>;
  zones: {
    id: string;
    centre: boolean;
    productions: Record<Purpose, number>;
    attractions: Record<Purpose, number>;
    origins: Record<Mode, number>;
    destinations: Record<Mode, number>;
  }[];
  desire_lines: ({ from: string; to: string } & Record<Mode, number>)[];
  road: { columns: string[]; links: [number, number, number, number][]; rgap: Record<string, number> };
  transit: {
    lines: { id: string; name: string; mode: string; patterns: PatternLoads[] }[];
    stops: Record<string, { name: string; boardings: number; alightings: number }>;
  };
  /** What the catchment effects did over the weekday (cycle lanes, bike and ride, shared bikes, steps). */
  catchment?: {
    cycle_lane_km: number;
    cycle_track_km: number;
    pedestrian_km: number;
    bike_parkings: number;
    shared_bike_stations: number;
    stops_with_steps: number;
    stops_step_free: number;
    shared_bike_trips: number;
    shared_bike_to_transit: number;
    shared_bike_from_transit: number;
    bike_and_ride: number;
    transit_by_bike_owners: number;
  };
  /** How the calibrated run fits what was observed (worker `demand/calibrate.py`); absent without data. */
  calibration?: Calibration;
  files: string[];
}

/** How a run fits the observed data, the rounds it took and the values it fitted. */
export interface Calibration {
  mode_shares: Record<Mode, { observed: number | null; modelled: number }>;
  mean_car_km: { observed: number | null; modelled: number | null };
  counts: {
    kind: "line" | "stop";
    id: string;
    observed: number;
    modelled: number | null;
    geh: number | null;
  }[];
  matched: number;
  rmse_pct: number | null;
  geh_under_5_share: number | null;
  rounds: { round: number; gap: number; rmse_pct: number | null; shares: Record<Mode, number> }[];
  /** Mode constants and deterrence the run ended with, where they differ from the project's. */
  fitted: Record<string, number>;
}

/** Observed data a run calibrates to (apps/api `ObservedDemand`). */
export interface ObservedDemand {
  mode_shares?: Record<Mode, number>;
  mean_car_km?: number;
  counts?: { kind: "line" | "stop"; id: string; value: number }[];
}

/** One saved demand run in the project's list. */
export interface DemandRun {
  id: string;
  kind: "demand";
  status: RunStatus;
  network: { kind: "demand"; zones: number; stops: number; lines: number };
  error: string | null;
  cancelRequested: boolean;
  createdBy: { id: string; displayName: string | null } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DemandRunDetail extends DemandRun {
  progress: DemandStep | null;
  result: DemandResult | null;
}

export interface DemandRunsApi {
  list(): Promise<DemandRun[]>;
  get(id: string): Promise<DemandRunDetail>;
  start(
    bundle: Bundle,
    values: Record<string, number>,
    summary: { zones: number; stops: number; lines: number },
    /** The GBFS feed of the project's shared-bike scheme. */
    gbfsUrl?: string,
    /** What was observed, to calibrate to. */
    observed?: ObservedDemand,
  ): Promise<DemandRunDetail>;
  cancel(id: string): Promise<DemandRunDetail>;
  remove(id: string): Promise<void>;
  /** Where the browser downloads a file the run saved (the OD matrices, `od.omx`). */
  fileUrl(id: string, name: string): string;
}

/** Most street tiles one demand run may take (apps/api `MAX_DEMAND_TILES`). */
export const MAX_DEMAND_TILES = 160;

/** Purpose: the web-mercator tile at zoom 14 holding a point (apps/api `tileOf`). */
function tileOf(lon: number, lat: number): [number, number] {
  const n = 2 ** 14;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))];
}

/**
 * Purpose: the street tiles the server adds to a demand run: the tile of every zone centre and the tiles
 * around it (apps/api `demandTiles`, which must agree).
 */
export function demandTiles(centres: [number, number][]): [number, number][] {
  const seen = new Map<string, [number, number]>();
  for (const [lon, lat] of centres) {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 85) continue;
    const [x0, y0] = tileOf(lon, lat);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) seen.set(`${x0 + dx}/${y0 + dy}`, [x0 + dx, y0 + dy]);
  }
  return [...seen.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Purpose: the demand runs of one project, through the session cookie and CSRF token. */
export function projectDemandRuns(projectId: string, csrf: string): DemandRunsApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/simulation-runs`;
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
  return {
    list: async () =>
      ((await get<{ runs?: { kind: string }[] }>(base)).runs ?? []).filter(
        (r): r is DemandRun => r.kind === "demand",
      ),
    get: async (id) => (await get<{ run: DemandRunDetail }>(one(id))).run,
    start: async (bundle, values, summary, gbfsUrl, observed) =>
      (
        await send<{ run: DemandRunDetail }>("POST", base, csrf, {
          kind: "demand",
          bundle: JSON.stringify(bundle),
          values,
          summary,
          ...(gbfsUrl ? { gbfsUrl } : {}),
          ...(observed ? { observed } : {}),
        })
      ).run,
    cancel: async (id) => (await send<{ run: DemandRunDetail }>("POST", `${one(id)}/cancel`, csrf, {})).run,
    remove: async (id) => {
      await send<{ ok: true }>("DELETE", one(id), csrf);
    },
    fileUrl: (id, name) => `${one(id)}/files/${encodeURIComponent(name)}`,
  };
}

/** Purpose: whether a run is still queued or running. */
export function isOpen(r: { status: RunStatus }): boolean {
  return r.status === "queued" || r.status === "running";
}
