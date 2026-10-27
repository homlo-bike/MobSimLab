import type { InstanceRole } from "../db/database";

/**
 * Instance-level actions. Each API route declares exactly one with `@Requires` (or is `@Public`).
 * Project-level actions arrive with the projects module.
 */
export const ACTIONS = [
  "session.own", // see and end one's own session
  "instance.read", // read instance name and settings that every member may see
  "setup.manage", // run the setup wizard and finish setup
  "users.manage", // list users, set roles, approve, restrict, delete
  "audit.read", // read and verify the audit log
  "projects.create",
] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * The declarative policy table (05 §3.2): which instance roles may perform each action.
 * Restricted users may only see and end their own session.
 */
export const POLICY: Record<Action, readonly InstanceRole[]> = {
  "session.own": ["owner", "admin", "user", "viewer", "restricted"],
  "instance.read": ["owner", "admin", "user", "viewer"],
  "setup.manage": ["owner"],
  "users.manage": ["owner", "admin"],
  "audit.read": ["owner", "admin"],
  "projects.create": ["owner", "admin", "user"],
};

/** The minimum an actor needs for a permission decision. */
export interface Actor {
  userId: string;
  role: InstanceRole;
  status: "pending" | "active" | "deleted";
}

/**
 * Purpose: the single permission check (`PermissionService.can` in 05 §3.2).
 * Inputs: actor (or null when signed out) and action. Output: true if allowed.
 * Only active users are ever allowed anything.
 */
export function can(actor: Actor | null, action: Action): boolean {
  if (!actor || actor.status !== "active") return false;
  return POLICY[action].includes(actor.role);
}
