import { get } from "../session/api";

/** What a project keeps drawings of (apps/api/src/projects/drawings.ts). */
export type DrawingKind = "street-lines" | "railway" | "street-setups" | "rail-timetable";
export const DRAWING_KINDS: readonly DrawingKind[] = [
  "street-lines",
  "railway",
  "street-setups",
  "rail-timetable",
];

/** One saved drawing as the API returns it. */
export interface Drawing<T = unknown> {
  kind: DrawingKind;
  schemaVersion: number;
  doc: T;
  /** The version the next save must be based on. */
  version: number;
  updatedAt: string;
  updatedBy: { id: string; displayName: string | null } | null;
}

/** Someone else saved the drawing first; `current` is what they saved (null if it was removed). */
export class DrawingConflict extends Error {
  constructor(readonly current: Drawing | null) {
    super("someone else saved this drawing since you opened it");
  }
}

/** The API refused or could not take a save; `retry` is false when sending the same thing again cannot help. */
export class DrawingSaveError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

const path = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/drawings`;

/** Purpose: every drawing saved in a project, by kind. Kinds never saved are absent. */
export async function loadDrawings(projectId: string): Promise<Partial<Record<DrawingKind, Drawing>>> {
  const r = await get<{ drawings?: Partial<Record<DrawingKind, Drawing>> }>(path(projectId));
  return r.drawings ?? {};
}

/**
 * Purpose: save one drawing. Inputs: the whole document and the version it was based on (null if none was
 * saved yet). Output: the saved drawing. Throws DrawingConflict on 409 and DrawingSaveError otherwise.
 */
export async function saveDrawing<T>(
  csrf: string,
  projectId: string,
  kind: DrawingKind,
  doc: T,
  baseVersion: number | null,
): Promise<Drawing<T>> {
  let res: Response;
  try {
    res = await fetch(`${path(projectId)}/${kind}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({ doc, baseVersion }),
    });
  } catch {
    throw new DrawingSaveError("no connection to the server", true);
  }
  const body = (await res.json().catch(() => ({}))) as {
    drawing?: Drawing<T>;
    current?: Drawing | null;
    message?: string | string[];
  };
  if (res.status === 409) throw new DrawingConflict(body.current ?? null);
  if (!res.ok || !body.drawing) {
    const msg = Array.isArray(body.message) ? body.message.join("; ") : body.message;
    throw new DrawingSaveError(msg ?? `save failed: ${res.status}`, res.status >= 500 || res.status === 429);
  }
  return body.drawing;
}
