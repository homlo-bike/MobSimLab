import type { SchematicThumb } from "../features/schematic/thumb";
import { areaEstimator, projectAreaApi } from "../features/area/api";
import { setPluginRuntime } from "../plugins/code/context";
import type { PluginLimits } from "../plugins/code/runtime";
import type { ProjectPlugin } from "../plugins/registry";
import { get, send } from "../session/api";
import { projectRuns } from "../features/capacity/server";
import { projectComments } from "../features/comments/api";
import { commentNoticesApi } from "../features/comments/notices";
import { projectDemandRuns } from "../features/demand/api";
import { projectPopulation } from "../features/population/api";
import { projectRoadRuns } from "../features/road-sim/api";
import { projectResults } from "./results";
import { projectGeodata } from "../features/geodata/api";
import { projectCalendarRuns } from "../features/calendar-run/api";
import { type DrawingKind, loadDrawings, saveDrawing } from "./drawings";
import { withApiMsg } from "../i18n/engine";
import { FETCHED_IDS, type FetchedId, type SavedDataRow } from "../workspace/savedFiles";

export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";

/** One project as `GET /api/projects` returns it. */
export interface Project {
  id: string;
  name: string;
  description: string;
  areaName: string | null;
  modes: string[];
  myRole: ProjectRole;
  /** True when the caller is not a member and sees the project only because it is public (read-only). */
  viaPublic: boolean;
  owner: { id: string; displayName: string | null };
  memberCount: number;
  /** Private: only members open it. Public: anyone signed in to this MobSimLab opens it read-only. */
  visibility: "private" | "public";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  /** The network as the Schematic tab last drew it, for the card; absent or null until it has lines. */
  thumb?: SchematicThumb | null;
}

export interface Member {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: ProjectRole;
}

/** Modes a project can plan for, grouped as the Create tab groups them. */
export const STREET_MODES = ["bus", "brt", "trolleybus", "intercity_bus"] as const;
export const RAIL_MODES = [
  "tram",
  "light_rail",
  "metro",
  "commuter_rail",
  "regional_rail",
  "intercity_rail",
  "high_speed_rail",
] as const;
export type Mode = (typeof STREET_MODES)[number] | (typeof RAIL_MODES)[number];

/** One recorded change of a project value (GET /api/projects/:id/value-history), newest first. */
export interface ValueHistoryEntry {
  seq: number;
  /** Assumption id, for example `mode.dwell_s.tram`. */
  id: string;
  /** "changed": the value changed; "reason": only a new reason was given. */
  kind: "changed" | "reason";
  /** The value before and after; a null value means the library's applies. */
  before: { value: number | null; reason: string | null };
  after: { value: number | null; reason: string | null };
  reason: string | null;
  at: string;
  by: { id: string; displayName: string | null } | null;
  /** The change came with the .mslab file the project was opened from: read-only, after the project's own. */
  fromFile?: boolean;
}

/** Where a project shows on the projects home. */
export type Shelf = "mine" | "shared" | "viewOnly" | "public";

/**
 * Purpose: the home shelf of a project: own projects, shared ones the caller can edit, read-only ones, and public
 * projects the caller is not a member of.
 */
export function shelfOf(p: Pick<Project, "myRole" | "viaPublic">): Shelf {
  if (p.viaPublic) return "public";
  if (p.myRole === "owner") return "mine";
  if (p.myRole === "editor") return "shared";
  return "viewOnly";
}

/** What the caller may do with a project, by role. */
export const can = {
  edit: (p: Pick<Project, "myRole">) => p.myRole === "owner" || p.myRole === "editor",
  manage: (p: Pick<Project, "myRole">) => p.myRole === "owner",
  comment: (p: Pick<Project, "myRole">) => p.myRole !== "viewer",
};

const base = "/api/projects";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** Thin client for the projects API. Every write sends the session's CSRF token. */
export function projectsApi(csrf: string) {
  return {
    list: (archived = false) =>
      get<{ projects: Project[] }>(archived ? `${base}?archived=true` : base).then((r) => r.projects),
    /** Public projects the caller is not a member of. */
    listPublic: () => get<{ projects: Project[] }>(`${base}?public=true`).then((r) => r.projects),
    get: (id: string) => get<{ project: Project }>(one(id)).then((r) => r.project),
    create: (body: { name: string; areaName?: string | null; modes?: string[]; description?: string }) =>
      send<{ project: Project }>("POST", base, csrf, body).then((r) => r.project),
    update: (id: string, body: Partial<Pick<Project, "name" | "description" | "areaName" | "modes">>) =>
      send<{ project: Project }>("PATCH", one(id), csrf, body).then((r) => r.project),
    duplicate: (id: string, name?: string) =>
      send<{ project: Project }>("POST", `${one(id)}/duplicate`, csrf, name ? { name } : {}).then(
        (r) => r.project,
      ),
    archive: (id: string, archived: boolean) =>
      send<{ project: Project }>("POST", `${one(id)}/${archived ? "archive" : "unarchive"}`, csrf).then(
        (r) => r.project,
      ),
    remove: (id: string, confirmName: string) => send<{ ok: true }>("DELETE", one(id), csrf, { confirmName }),
    members: (id: string) => get<{ members: Member[] }>(`${one(id)}/members`).then((r) => r.members),
    addMember: (id: string, email: string, role: Exclude<ProjectRole, "owner">) =>
      send<{ members: Member[] }>("POST", `${one(id)}/members`, csrf, { email, role }).then((r) => r.members),
    setRole: (id: string, userId: string, role: Exclude<ProjectRole, "owner">) =>
      send<{ members: Member[] }>("PUT", `${one(id)}/members/${encodeURIComponent(userId)}`, csrf, {
        role,
      }).then((r) => r.members),
    removeMember: (id: string, userId: string) =>
      send<{ ok: true }>("DELETE", `${one(id)}/members/${encodeURIComponent(userId)}`, csrf),
    /** Make a project public (after the Owner confirmed the licence notice) or private again. Owners only. */
    setVisibility: (id: string, visibility: Project["visibility"]) =>
      send<{ project: Project }>("PUT", `${one(id)}/visibility`, csrf, {
        visibility,
        ...(visibility === "public" && { licenceAccepted: true }),
      }).then((r) => r.project),
    /** The plugins the project can use, with whether each is on (ADR-0036 §9). */
    plugins: (id: string) =>
      get<{ plugins?: ProjectPlugin[]; limits?: PluginLimits }>(`${one(id)}/plugins`).then((r) => {
        // The Admins' limits for plugin code, which the browser's plugin host runs with.
        if (r.limits) setPluginRuntime({ limits: r.limits });
        return r.plugins ?? [];
      }),
    /** Turn a plugin on or off for the project (Owners), pinning the version of an installed plugin. */
    setPlugin: (id: string, pluginId: string, enabled: boolean, version?: string) =>
      send<{ plugins: ProjectPlugin[] }>(
        "PUT",
        `${one(id)}/plugins/${encodeURIComponent(pluginId)}`,
        csrf,
        version ? { enabled, version } : { enabled },
      ).then((r) => r.plugins),
    /** The change history of the project's values, newest first; `before` is a `seq`, for the next page. */
    valueHistory: (id: string, opts: { before?: number; limit?: number } = {}) => {
      const q = new URLSearchParams();
      if (opts.before !== undefined) q.set("before", String(opts.before));
      if (opts.limit !== undefined) q.set("limit", String(opts.limit));
      const qs = q.toString();
      return get<{ history?: ValueHistoryEntry[] }>(`${one(id)}/value-history${qs ? `?${qs}` : ""}`).then(
        (r) => r.history ?? [],
      );
    },
    /**
     * The history of changed values the project was opened with from a `.mslab` file (read-only), newest first,
     * in the shape of `valueHistory`; empty for a project not opened from a file.
     */
    fileValueHistory: (id: string) =>
      get<{
        history?: (Omit<ValueHistoryEntry, "seq" | "by" | "fromFile"> & {
          n: number;
          byName: string | null;
        })[];
      }>(`${one(id)}/value-history/file`).then((r) =>
        (r.history ?? []).map((h): ValueHistoryEntry => ({
          seq: -1 - h.n,
          id: h.id,
          kind: h.kind,
          before: h.before,
          after: h.after,
          reason: h.reason,
          at: h.at,
          by: h.byName ? { id: "", displayName: h.byName } : null,
          fromFile: true,
        })),
      ),
    /**
     * Where to download the project as a `.mslab` file (ADR-0021), with or without its simulation runs, and with
     * or without the map data of its area for the static viewer, and without the results or own vehicles when the
     * Saved project files choices leave them out.
     */
    mslabUrl: (
      id: string,
      runs: boolean,
      map = false,
      more: {
        results?: boolean;
        vehicles?: boolean;
        comments?: boolean;
        history?: boolean;
        /** Kinds of fetched and imported data to leave out (false); the others are in the file. */
        fetched?: Partial<Record<FetchedId, boolean>>;
      } = {},
    ) => {
      const q = [
        runs && "runs=true",
        map && "map=true",
        more.results === false && "results=false",
        more.vehicles === false && "vehicles=false",
        more.comments === false && "comments=false",
        more.history === false && "history=false",
        ...FETCHED_IDS.map((id) => more.fetched?.[id] === false && `${id}=false`),
      ]
        .filter(Boolean)
        .join("&");
      return `${one(id)}/mslab${q ? `?${q}` : ""}`;
    },
    /** What the project holds of each kind of data a `.mslab` file can carry: size, date and source. */
    mslabContents: (id: string) =>
      get<{ rows?: SavedDataRow[] }>(`${one(id)}/mslab/contents`).then((r) => r.rows ?? []),
    /** Open a `.mslab` file as a new project owned by the caller; `skipped` lists what was left out. */
    importMslab: (file: Blob) => importMslab(csrf, file),
    drawings: (id: string) => loadDrawings(id),
    saveDrawing: <T>(id: string, kind: DrawingKind, doc: T, baseVersion: number | null) =>
      saveDrawing(csrf, id, kind, doc, baseVersion),
    /** The project's simulation runs on the background worker, saved with the project. */
    runs: (id: string) => projectRuns(id, csrf),
    /** The project's road simulation runs (SUMO) on the background worker, with their replays. */
    roadRuns: (id: string) => projectRoadRuns(id, csrf),
    /** Results the project's tools worked out, saved with it (noise map, walk coverage…). */
    results: (id: string) => projectResults(id),
    /** The project's OpenStreetMap and elevation imports (GIS tab, Map data). */
    geodata: (id: string) => projectGeodata(id, csrf),
    /** The project's calendar runs: many years, one date or a row of dates (ADR-0020). */
    calendarRuns: (id: string) => projectCalendarRuns(id, csrf),
    /** The project's demand model runs (AequilibraE) on the background worker, with their OD matrices. */
    demandRuns: (id: string) => projectDemandRuns(id, csrf),
    /** The project's population layers (GIS tab): imports, uploads, the layer the project uses. */
    population: (id: string) => projectPopulation(id, csrf),
    /** Comments on the project's objects: threads, replies, resolving. */
    comments: (id: string) => projectComments(id, csrf),
    /** The new comments and replies on the caller's projects, for the bell. */
    commentNotices: () => commentNoticesApi(csrf),
    /** The project area from OpenStreetMap regions, and the imports its saving queues. */
    area: (id: string) => projectAreaApi(id, csrf),
    /** What a drawn area would hold, before the project exists (New project, Select area). */
    estimateArea: areaEstimator(csrf),
  };
}
export type ProjectsApi = ReturnType<typeof projectsApi>;

/**
 * Purpose: upload a `.mslab` file as the raw request body. Output: the new project, what was left out, and the
 * kinds of data a job is still bringing in from the file ("osm").
 */
async function importMslab(
  csrf: string,
  file: Blob,
): Promise<{ project: Project; skipped: string[]; queued: string[] }> {
  const res = await fetch(`${base}/import`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": csrf },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as {
    project?: Project;
    skipped?: string[];
    queued?: string[];
    message?: string | string[];
  };
  if (!res.ok || !body.project) {
    const m = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    throw withApiMsg(new Error(m ?? `POST ${base}/import failed: ${res.status}`), body);
  }
  return { project: body.project, skipped: body.skipped ?? [], queued: body.queued ?? [] };
}
