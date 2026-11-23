/** The project's calendar runs on the server (apps/api/src/simulation): list, start, follow, stop and delete. */
import type { EngineNote } from "../../i18n/engine";
import { get, send } from "../../session/api";
import type { RunStatus, ServerNetwork } from "../capacity/server";
import type { DayTypeId } from "../../workspace/calendar";
import type { CalendarPlan, DayFigures } from "./model";
import type { Variant } from "./weather";

/** One saved calendar run in the project's list. */
export interface CalendarRun {
  id: string;
  kind: "calendar";
  status: RunStatus;
  network:
    { kind: "example" } | { kind: "files"; topologyName: string; linesName: string } | { kind: "none" };
  plan: CalendarPlan;
  verdict: string | null;
  error: string | null;
  cancelRequested: boolean;
  createdBy: { id: string; displayName: string | null } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** What the worker is doing now (worker/src/mobsim_worker/jobs/calendar.py). */
export type CalendarStep =
  | { step: "day"; day_type: DayTypeId; variant?: Variant | null; n: number; total: number }
  | { step: "expanding" };

/** A representative day's rail run, as the calendar run keeps it. */
export interface RailDay {
  verdict: string | null;
  trips: number | null;
  vehicles: number | null;
  peak_out: number | null;
  /** The hours the run covered, s after midnight (a heat variant covers its restriction hours). */
  from_s?: number;
  to_s?: number;
  lines: {
    line: string;
    name: string;
    verdict: string | null;
    punctuality: number | null;
    disturbed_punctuality: number | null;
  }[];
}

/** What the worker found: each day type's day, and each period's totals. */
export interface CalendarResult {
  mode: CalendarPlan["mode"];
  notes: EngineNote[];
  run: { verdict: string | null };
  day_types: Partial<
    Record<
      DayTypeId,
      {
        from_s: number;
        to_s: number;
        per_day: DayFigures;
        days: number;
        rail?: RailDay;
        /** Expected days and the rail run of each weather variant that occurs. */
        weather?: Partial<Record<Variant, { days: number; rail?: RailDay }>>;
      }
    >
  >;
  periods: ({
    label: string;
    counts: Record<DayTypeId, number>;
    /** Expected days per weather variant (absent in runs without a climate). */
    weather?: Record<Variant, number>;
    days: number;
    /** The weather's energy, kWh, included in `energy_kwh`. */
    extra?: { hvac_kwh?: number; switch_heating_kwh?: number };
  } & DayFigures)[];
}

export interface CalendarRunDetail extends CalendarRun {
  progress: CalendarStep | null;
  result: CalendarResult | null;
}

export interface CalendarRunsApi {
  list(): Promise<CalendarRun[]>;
  get(id: string): Promise<CalendarRunDetail>;
  start(
    network: ServerNetwork | null,
    plan: CalendarPlan,
    params?: Record<string, unknown>,
  ): Promise<CalendarRunDetail>;
  cancel(id: string): Promise<CalendarRunDetail>;
  rerun(id: string): Promise<CalendarRunDetail>;
  remove(id: string): Promise<void>;
}

/** Purpose: the calendar runs of one project, through the session cookie and CSRF token. */
export function projectCalendarRuns(projectId: string, csrf: string): CalendarRunsApi {
  const base = `/api/projects/${encodeURIComponent(projectId)}/simulation-runs`;
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
  return {
    list: async () =>
      ((await get<{ runs?: { kind: string }[] }>(base)).runs ?? []).filter(
        (r): r is CalendarRun => r.kind === "calendar",
      ),
    get: async (id) => (await get<{ run: CalendarRunDetail }>(one(id))).run,
    start: async (network, plan, params = {}) =>
      (
        await send<{ run: CalendarRunDetail }>("POST", base, csrf, {
          kind: "calendar",
          network,
          params,
          plan,
        })
      ).run,
    cancel: async (id) => (await send<{ run: CalendarRunDetail }>("POST", `${one(id)}/cancel`, csrf, {})).run,
    rerun: async (id) => (await send<{ run: CalendarRunDetail }>("POST", `${one(id)}/rerun`, csrf, {})).run,
    remove: async (id) => {
      await send<{ ok: true }>("DELETE", one(id), csrf);
    },
  };
}
