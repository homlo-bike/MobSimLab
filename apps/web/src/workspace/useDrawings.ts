import { useCallback, useEffect, useRef, useState } from "react";
import { type Drawing, DrawingConflict, type DrawingKind, DrawingSaveError } from "../projects/drawings";

/** How the project's drawings stand against the server, worst first. */
export type SaveStatus = "conflict" | "failed" | "offline" | "saving" | "saved";

/** Someone else saved a drawing while this person was changing it. */
export interface DrawingClash {
  kind: DrawingKind;
  by: string | null;
  at: string | null;
}

interface Entry {
  doc: unknown;
  /** The JSON last loaded or saved, so an unchanged document is not saved again. */
  json: string;
  /** The JSON of the save on its way, if any. */
  sending: string | null;
  version: number | null;
  dirty: boolean;
  inFlight: boolean;
  /** Bumped when the document is replaced from the server, so editors start again from it. */
  generation: number;
  failures: number;
  clash: Drawing | null | undefined;
  error: string | null;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** Wait after the last change before saving, ms. */
const SAVE_DELAY_MS = 800;
const RETRY_MAX_MS = 30_000;

const empty = (): Entry => ({
  doc: null,
  json: "null",
  sending: null,
  version: null,
  dirty: false,
  inFlight: false,
  generation: 0,
  failures: 0,
  clash: undefined,
  error: null,
  timer: undefined,
});

/** What the hook needs of the projects API. */
export interface DrawingsApi {
  drawings(projectId: string): Promise<Partial<Record<DrawingKind, Drawing>>>;
  saveDrawing(
    projectId: string,
    kind: DrawingKind,
    doc: unknown,
    baseVersion: number | null,
  ): Promise<Drawing>;
}

/**
 * Purpose: the drawings of one project (street lines, railway, street setups), loaded from the server and saved
 * back a moment after each change (10 §1.2 optimistic locking). Saves of one kind go one at a time, each based on
 * the version the last one returned; when someone else saved first, saving that kind stops until the person
 * keeps their own drawing or takes the other one.
 * Inputs: the projects API, project id, and whether the caller may edit (viewers never save).
 * Output: the documents and their save status, and the actions on them.
 * Side effects: GET and PUT `/api/projects/:id/drawings`; warns before the page closes with unsaved changes.
 */
export function useDrawings(api: DrawingsApi, projectId: string, editable: boolean) {
  const entries = useRef(new Map<DrawingKind, Entry>());
  const session = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [, setTick] = useState(0);
  const tick = useCallback(() => setTick((n) => n + 1), []);
  const live = useRef({ api, projectId, editable });
  live.current = { api, projectId, editable };

  const entry = (kind: DrawingKind) => {
    let e = entries.current.get(kind);
    if (!e) entries.current.set(kind, (e = empty()));
    return e;
  };

  const push = useCallback(
    (kind: DrawingKind) => {
      const e = entries.current.get(kind);
      if (!e || !e.dirty || e.inFlight || e.clash !== undefined || !live.current.editable) return;
      clearTimeout(e.timer);
      e.timer = undefined;
      const mine = session.current;
      const { api: client, projectId: pid } = live.current;
      const doc = e.doc;
      const json = JSON.stringify(doc);
      e.inFlight = true;
      e.sending = json;
      e.dirty = false;
      tick();
      client.saveDrawing(pid, kind, doc, e.version).then(
        (d) => {
          if (session.current !== mine) return;
          e.inFlight = false;
          e.sending = null;
          e.version = d.version;
          e.json = json;
          e.failures = 0;
          e.error = null;
          if (e.dirty) push(kind);
          tick();
        },
        (err: unknown) => {
          if (session.current !== mine) return;
          e.inFlight = false;
          e.sending = null;
          e.dirty = true;
          if (err instanceof DrawingConflict) e.clash = err.current;
          else if (err instanceof DrawingSaveError && !err.retry) e.error = err.message;
          else {
            e.failures++;
            e.error = null;
            const wait = Math.min(RETRY_MAX_MS, 2000 * 2 ** (e.failures - 1));
            e.timer = setTimeout(() => push(kind), wait);
          }
          tick();
        },
      );
    },
    [tick],
  );

  const flush = useCallback(() => {
    for (const k of entries.current.keys()) push(k);
  }, [push]);

  // Load on open; on leaving the project, send what is still waiting.
  useEffect(() => {
    const mine = ++session.current;
    entries.current = new Map();
    setLoaded(false);
    setLoadError(null);
    live.current.api.drawings(projectId).then(
      (all) => {
        if (session.current !== mine) return;
        for (const [k, d] of Object.entries(all) as [DrawingKind, Drawing][]) {
          const e = entry(k);
          e.doc = d.doc;
          e.json = JSON.stringify(d.doc);
          e.version = d.version;
        }
        setLoaded(true);
      },
      (err: unknown) => {
        if (session.current === mine) setLoadError(err instanceof Error ? err.message : String(err));
      },
    );
    const map = entries;
    return () => {
      for (const [k, e] of map.current) {
        clearTimeout(e.timer);
        if (e.dirty && !e.inFlight && e.clash === undefined && live.current.editable)
          void live.current.api.saveDrawing(projectId, k, e.doc, e.version).catch(() => undefined);
      }
      session.current++;
    };
  }, [projectId, attempt]);

  const unsaved = [...entries.current.values()].some((e) => e.dirty || e.inFlight);
  useEffect(() => {
    if (!unsaved || !editable) return;
    const warn = (ev: BeforeUnloadEvent) => ev.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, editable]);

  const all = [...entries.current.entries()];
  const clashAt = all.find(([, e]) => e.clash !== undefined);
  const status: SaveStatus = clashAt
    ? "conflict"
    : all.some(([, e]) => e.error)
      ? "failed"
      : all.some(([, e]) => e.failures > 0)
        ? "offline"
        : unsaved
          ? "saving"
          : "saved";

  return {
    loaded,
    loadError,
    /** Try loading again after a failure. */
    reload: () => setAttempt((n) => n + 1),
    status,
    /** The first save error the server gave, when it will not help to try again. */
    error: all.find(([, e]) => e.error)?.[1].error ?? null,
    clash: clashAt
      ? ({
          kind: clashAt[0],
          by: clashAt[1].clash?.updatedBy?.displayName ?? null,
          at: clashAt[1].clash?.updatedAt ?? null,
        } satisfies DrawingClash)
      : null,
    /** Purpose: the document of a kind, or null if none was drawn yet. */
    doc: <T>(kind: DrawingKind): T | null => (entries.current.get(kind)?.doc as T | undefined) ?? null,
    /** Purpose: a key that changes when the document was replaced from the server. */
    generation: (kind: DrawingKind) => entries.current.get(kind)?.generation ?? 0,
    /** Purpose: replace a document; it is saved shortly after the last change. */
    set: (kind: DrawingKind, doc: unknown) => {
      const e = entry(kind);
      e.doc = doc;
      const json = JSON.stringify(doc);
      const changed = json !== (e.sending ?? e.json);
      if (!changed) {
        if (e.dirty) {
          e.dirty = false;
          tick();
        }
        return;
      }
      if (!live.current.editable) return;
      const was = e.dirty;
      e.dirty = true;
      if (e.clash === undefined && e.failures === 0) {
        clearTimeout(e.timer);
        e.timer = setTimeout(() => push(kind), SAVE_DELAY_MS);
      }
      if (!was) tick();
    },
    /** Purpose: save now instead of after the pause. */
    flush,
    /** Purpose: after a clash, save this person's drawing over the other one. */
    keepMine: () => {
      if (!clashAt) return;
      const [k, e] = clashAt;
      e.version = e.clash?.version ?? null;
      e.clash = undefined;
      e.dirty = true;
      push(k);
    },
    /** Purpose: after a clash, drop this person's changes and open the other drawing. */
    takeTheirs: () => {
      if (!clashAt) return;
      const [, e] = clashAt;
      e.doc = e.clash?.doc ?? null;
      e.json = JSON.stringify(e.doc);
      e.version = e.clash?.version ?? null;
      e.clash = undefined;
      e.dirty = false;
      e.generation++;
      tick();
    },
  };
}

export type Drawings = ReturnType<typeof useDrawings>;
