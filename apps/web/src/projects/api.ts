import type { ProjectPlugin } from "../plugins/registry";
import { get, send } from "../session/api";
import { projectRuns } from "../features/capacity/server";
import { projectPopulation } from "../features/population/api";
import { projectRoadRuns } from "../features/road-sim/api";
import { type DrawingKind, loadDrawings, saveDrawing } from "./drawings";

export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";

/** One project as `GET /api/projects` returns it. */
export interface Project {
  id: string;
  name: string;
  description: string;
  areaName: string | null;
  modes: string[];
  myRole: ProjectRole;
  viaLink: boolean;
  owner: { id: string; displayName: string | null };
  memberCount: number;
  linkAccess: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
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

/** Where a project shows on the projects home. */
export type Shelf = "mine" | "shared" | "viewOnly";

/** Purpose: the home shelf for a role: own projects, shared ones the caller can edit, and read-only ones. */
export function shelfOf(p: Pick<Project, "myRole">): Shelf {
  if (p.myRole === "owner") return "mine";
  if (p.myRole === "editor") return "shared";
  return "viewOnly";
}

/** What the caller may do with a project, by role. */
export const can = {
  edit: (p: Pick<Project, "myRole">) => p.myRole === "owner" || p.myRole === "editor",
  manage: (p: Pick<Project, "myRole">) => p.myRole === "owner",
};

const base = "/api/projects";
const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

/** Thin client for the projects API. Every write sends the session's CSRF token. */
export function projectsApi(csrf: string) {
  return {
    list: (archived = false) =>
      get<{ projects: Project[] }>(archived ? `${base}?archived=true` : base).then((r) => r.projects),
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
    setLink: (id: string, linkAccess: boolean) =>
      send<{ project: Project }>("PUT", `${one(id)}/link`, csrf, { linkAccess }).then((r) => r.project),
    /** The plugins the project can use, with whether each is on (ADR-0036 §9). */
    plugins: (id: string) =>
      get<{ plugins?: ProjectPlugin[] }>(`${one(id)}/plugins`).then((r) => r.plugins ?? []),
    /** Turn a plugin on or off for the project (Owners), pinning the version of an installed plugin. */
    setPlugin: (id: string, pluginId: string, enabled: boolean, version?: string) =>
      send<{ plugins: ProjectPlugin[] }>(
        "PUT",
        `${one(id)}/plugins/${encodeURIComponent(pluginId)}`,
        csrf,
        version ? { enabled, version } : { enabled },
      ).then((r) => r.plugins),
    /** Where to download the project as a `.mslab` file (ADR-0021), with or without its simulation runs. */
    mslabUrl: (id: string, runs: boolean) => `${one(id)}/mslab${runs ? "?runs=true" : ""}`,
    /** Open a `.mslab` file as a new project owned by the caller; `skipped` lists what was left out. */
    importMslab: (file: Blob) => importMslab(csrf, file),
    drawings: (id: string) => loadDrawings(id),
    saveDrawing: <T>(id: string, kind: DrawingKind, doc: T, baseVersion: number | null) =>
      saveDrawing(csrf, id, kind, doc, baseVersion),
    /** The project's simulation runs on the background worker, saved with the project. */
    runs: (id: string) => projectRuns(id, csrf),
    /** The project's road simulation runs (SUMO) on the background worker, with their replays. */
    roadRuns: (id: string) => projectRoadRuns(id, csrf),
    /** The project's population layers (GIS tab): imports, uploads, the layer the project uses. */
    population: (id: string) => projectPopulation(id, csrf),
  };
}
export type ProjectsApi = ReturnType<typeof projectsApi>;

/** Purpose: upload a `.mslab` file as the raw request body. Output: the new project and what was left out. */
async function importMslab(csrf: string, file: Blob): Promise<{ project: Project; skipped: string[] }> {
  const res = await fetch(`${base}/import`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", "X-CSRF-Token": csrf },
    body: file,
  });
  const body = (await res.json().catch(() => ({}))) as {
    project?: Project;
    skipped?: string[];
    message?: string | string[];
  };
  if (!res.ok || !body.project) {
    const m = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    throw new Error(m ?? `POST ${base}/import failed: ${res.status}`);
  }
  return { project: body.project, skipped: body.skipped ?? [] };
}
