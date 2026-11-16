import { get, send } from "../../session/api";

/** Objects a comment can be on (apps/api/src/comments/comments.service.ts). */
export type CommentObjectType =
  "station" | "track" | "switch" | "signal" | "street-line" | "service-line" | "depot";

/** One comment as `GET /api/projects/:id/comments` returns it. Replies carry `parentId`. */
export interface ProjectComment {
  id: string;
  objectType: CommentObjectType;
  objectId: string;
  parentId: string | null;
  body: string;
  author: { id: string; displayName: string | null } | null;
  createdAt: string;
  editedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: { id: string; displayName: string | null } | null;
}

/** Purpose: the comments API of one project. Every write sends the session's CSRF token. */
export function projectComments(projectId: string, csrf: string) {
  const base = `/api/projects/${encodeURIComponent(projectId)}/comments`;
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`;
  return {
    list: () => get<{ comments: ProjectComment[] }>(base).then((r) => r.comments),
    add: (body: { objectType: CommentObjectType; objectId: string; body: string; parentId?: string }) =>
      send<{ comment: ProjectComment }>("POST", base, csrf, body).then((r) => r.comment),
    edit: (id: string, body: string) =>
      send<{ comment: ProjectComment }>("PATCH", one(id), csrf, { body }).then((r) => r.comment),
    resolve: (id: string, resolved: boolean) =>
      send<{ comment: ProjectComment }>("PUT", `${one(id)}/resolved`, csrf, { resolved }).then(
        (r) => r.comment,
      ),
    remove: (id: string) => send<{ ok: true }>("DELETE", one(id), csrf),
  };
}
export type CommentsApi = ReturnType<typeof projectComments>;
