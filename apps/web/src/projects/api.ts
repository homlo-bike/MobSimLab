import { get, send } from "../session/api";

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
  };
}
export type ProjectsApi = ReturnType<typeof projectsApi>;
