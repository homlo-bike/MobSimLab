import { useCallback, useEffect, useRef, useState } from "react";
import { get, send } from "../../session/api";
import type { CommentObjectType, ProjectComment } from "./api";

/** A new comment or reply on one of the person's projects, as `GET /api/comments/new` returns it. */
export interface CommentNotice extends ProjectComment {
  projectId: string;
  projectName: string;
}

/** Purpose: the API of the notices of new comments. Every write sends the session's CSRF token. */
export function commentNoticesApi(csrf: string) {
  return {
    list: () => get<{ total: number; comments: CommentNotice[] }>("/api/comments/new"),
    read: (body: { ids: string[] } | { all: true }) =>
      send<{ ok: true }>("POST", "/api/comments/read", csrf, body),
  };
}
export type CommentNoticesApi = ReturnType<typeof commentNoticesApi>;

/** How often the bell asks for new comments while the page is open, besides when the window gets focus. */
const POLL_MS = 120_000;

/** What the bell knows about new comments. */
export interface CommentNotices {
  total: number;
  comments: CommentNotice[];
  /** Mark comments read (they leave the bell at once), or all of them. */
  markRead: (which: { ids: string[] } | { all: true }) => void;
}

/**
 * Purpose: the person's new comments for the bell. Loads on start, when the window gets focus and every two
 * minutes. Without an API (static viewer) or when loading fails, there are none: the bell then shows only the
 * checks.
 */
export function useCommentNotices(api: CommentNoticesApi | null): CommentNotices {
  const [state, setState] = useState<{ total: number; comments: CommentNotice[] }>({
    total: 0,
    comments: [],
  });
  const live = useRef(true);
  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const r = await api.list();
      if (live.current) setState({ total: r.total, comments: r.comments });
    } catch {
      // The bell keeps what it had; the checks still show.
    }
  }, [api]);

  useEffect(() => {
    live.current = true;
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(onFocus, POLL_MS);
    return () => {
      live.current = false;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [reload]);

  const markRead = useCallback(
    (which: { ids: string[] } | { all: true }) => {
      if (!api) return;
      if ("ids" in which && which.ids.length === 0) return;
      setState((s) => {
        if ("all" in which) return { total: 0, comments: [] };
        const gone = new Set(which.ids);
        const comments = s.comments.filter((c) => !gone.has(c.id));
        return { total: Math.max(0, s.total - (s.comments.length - comments.length)), comments };
      });
      api
        .read(which)
        .then(() => reload())
        .catch(() => void reload());
    },
    [api, reload],
  );

  return { total: state.total, comments: state.comments, markRead };
}

/** An object whose comments should open once its project has opened (a notice of another project was chosen). */
let pending: { projectId: string; type: CommentObjectType; id: string } | null = null;

/** Purpose: remember to open an object's comments when the given project opens. */
export function openCommentsLater(projectId: string, type: CommentObjectType, id: string): void {
  pending = { projectId, type, id };
}

/** Purpose: the object to open in this project, if one was asked for; forgets it. */
export function takePendingComments(projectId: string): { type: CommentObjectType; id: string } | null {
  if (!pending || pending.projectId !== projectId) return null;
  const p = pending;
  pending = null;
  return { type: p.type, id: p.id };
}
